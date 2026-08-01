/* Offline shell. Supermarket signal is unreliable, and scanning must work
   without it. Bump CACHE when you change any file, or the old copy sticks. */

const CACHE = "fortnight-shop-v14";
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Never cache API traffic. Stale prices or stale tokens would be worse than an error.
  if (url.hostname !== self.location.hostname) return;
  if (e.request.method !== "GET") return;

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
