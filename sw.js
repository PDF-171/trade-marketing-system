const CACHE_NAME = "tm-system-v1";
const CORE_ASSETS = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./auth.js",
  "./sheets.js",
  "./config.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for everything (Sheets/Drive calls must always go live);
// falls back to cache only for the core app shell files when offline.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isCoreAsset = url.origin === location.origin;
  if (!isCoreAsset) return; // let API calls to Google pass straight through

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
