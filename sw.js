/* Offline shell. Supermarket signal is unreliable, and scanning must work
   without it. Bump CACHE when you change any file, or the old copy sticks. */

/* The test build lives in a subfolder of this same site. Caches are per origin,
   not per folder, so the two installs can see each other's. Sweeping
   "everything that is not mine" would have each one wipe the other every time
   it updated, and both would look broken offline for no reason. Only caches
   under this prefix are ever deleted. Note the trailing "v": the test build's
   caches are named "fortnight-shop-next-…" and do not match it. */
const PREFIX = "fortnight-shop-v";
const CACHE = `${PREFIX}17`;

/* Where the test build sits, resolved from this script's own URL so it stays
   right wherever the app is served from. */
const TEST = new URL("./next/", self.location.href).pathname;
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./lib/calc.js",
  "./lib/store.js",
  "./lib/scan.js",
  "./lib/qr.js",
  "./lib/vision.js",
  "./lib/sync.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE && k.startsWith(PREFIX)).map((k) => caches.delete(k))
        )
      )
      .then(() => purgeTest())
      .then(() => self.clients.claim())
  );
});

/* An earlier version of this worker answered for ./next/ as well, so a browser
   that visited the test build may be holding those files under a live cache
   key. Nothing serves them now, but they are dead weight. Clear them once. */
function purgeTest() {
  return caches.open(CACHE).then((c) =>
    c.keys().then((reqs) =>
      Promise.all(
        reqs
          .filter((r) => new URL(r.url).pathname.startsWith(TEST))
          .map((r) => c.delete(r))
      )
    )
  );
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Never cache API traffic. Stale prices or stale tokens would be worse than an error.
  if (url.hostname !== self.location.hostname) return;
  if (e.request.method !== "GET") return;

  // This worker's scope is the whole folder, so it also covers the test build
  // in ./next/ until that build's own worker installs and claims those pages.
  // Handling them here would cache the test build under live keys and serve it
  // stale on the first visit. Leave them to the network, and to their worker.
  if (url.pathname.startsWith(TEST)) return;

  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) {
        // refresh in the background so the next load is current
        fetch(e.request)
          .then((res) => res.ok && caches.open(CACHE).then((c) => c.put(e.request, res)))
          .catch(() => {});
        return hit;
      }
      // Not cached yet. Fetch it, keep a copy, and fall back to the shell offline.
      // This is how the vendored barcode decoder gets stored on browsers that need it.
      return fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
