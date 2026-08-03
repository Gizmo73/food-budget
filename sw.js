/* Offline shell. Supermarket signal is unreliable, and scanning must work
   without it, so everything the app needs is kept in a cache.

   The app's own files are fetched fresh when there is signal and fall back to
   that cache; everything else comes from the cache first. Bump CACHE when
   anything changes, so a phone with no signal is not left on a half old and
   half new set of files. */

const PREFIX = "fortnight-shop-v";
const CACHE = `${PREFIX}29`;

/* The test build that used to live in ./next/ is gone, promoted to be this
   one. Its caches are still on any phone that opened it, and nothing will
   ever ask for them again, so they are swept once here. Its database is left
   alone: it is the last copy of anything entered in that build, and deleting
   somebody's data is not this file's business. */
const GONE = "fortnight-shop-next-";
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
          keys
            .filter((k) => k !== CACHE && (k.startsWith(PREFIX) || k.startsWith(GONE)))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* Which requests are the app itself. These change every time anything is
   deployed, so they are fetched fresh when there is signal. The vendored
   barcode decoder is deliberately not one of them: it is a megabyte of wasm
   that has never changed, and re-fetching it would cost a second of a shop
   trip for nothing. */
function isShell(request, url) {
  if (request.mode === "navigate") return true;
  if (url.pathname.includes("/lib/vendor/")) return false;
  return /\.(html|js|css|webmanifest)$/.test(url.pathname) || url.pathname.endsWith("/");
}

/* Fresh if the network answers quickly, otherwise whatever was cached.

   Cache first was the wrong way round for the app's own files. It served the
   previous version on every load and refreshed behind your back, so a deploy
   only appeared on the load after the one you were looking at, and "the
   update has not come through" was the honest reading of it. The offline
   copy is still there, and still the whole point in a supermarket, but it is
   now the fallback rather than the answer. */
const SLOW = 3000;

async function freshFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    /* reload, not a plain fetch. Without it this asks the browser's own HTTP
       cache, which is holding the copy we are trying to replace: Pages serves
       these with ten minutes of freshness, so for ten minutes after a deploy
       the refetch returned the old file and the app looked like it had not
       updated. This is the request that has to reach the network. */
    const res = await Promise.race([
      fetch(request.url, { cache: "reload", credentials: "same-origin" }),
      new Promise((_, no) => setTimeout(() => no(new Error("slow")), SLOW)),
    ]);
    if (res && res.ok) {
      cache.put(request, res.clone());
      return res;
    }
    // a 404 or 500 is a real answer; only fall back when there was no answer
    const stale = await cache.match(request);
    return stale || res;
  } catch (err) {
    const stale = await cache.match(request);
    if (stale) return stale;
    if (request.mode === "navigate") {
      const home = await cache.match("./index.html");
      if (home) return home;
    }
    throw err;
  }
}

/* Everything else: cached copy if there is one, otherwise fetch and keep it.
   This is how the barcode decoder gets stored on browsers that need it. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Never cache API traffic. Stale prices or stale tokens would be worse than an error.
  if (url.hostname !== self.location.hostname) return;
  if (e.request.method !== "GET") return;

  e.respondWith(isShell(e.request, url) ? freshFirst(e.request) : cacheFirst(e.request));
});

/* So the app can say which copy it is running, and ask for a new one. Being
   able to read the version off the screen turns "I think the update has not
   come through" from a guess into a fact. */
self.addEventListener("message", (e) => {
  if (e.data === "version" && e.source) e.source.postMessage({ version: CACHE });
});
