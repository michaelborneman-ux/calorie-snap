// Service worker: cache the app shell for offline launch.
// Bump CACHE on any shell change so old assets are evicted.
const CACHE = "calorie-snap-v1";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/db.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Analysis needs connectivity — never serve it from cache.
  if (url.pathname.startsWith("/api/")) return;

  // Cache-first for the shell; fall back to network and cache new GETs.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request)
          .then((resp) => {
            if (resp.ok && url.origin === self.location.origin) {
              const copy = resp.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return resp;
          })
          .catch(() => caches.match("/index.html")),
    ),
  );
});
