// Deez Dragons — Minimal PWA Service Worker
// Caches the shell for offline-capable install; API calls always go network-first.

const CACHE_NAME = "deez-dragons-v1";
const SHELL_ASSETS = ["/", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
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

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Always network-first for API calls and static media
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/static/")
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first for shell assets
  event.respondWith(
    caches.match(event.request).then(
      (cached) => cached ?? fetch(event.request)
    )
  );
});
