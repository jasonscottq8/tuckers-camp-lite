// sw.js — Tucker's Camp Lite
const APP_VERSION = "lite-2.9.1";
const CACHE_NAME  = `tuckers-camp-lite-${APP_VERSION}`;

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/firebase.js",
  "/Images/wood-back.jpg",
  "/Images/cabinpicture.jpg",
  "/Images/icon-192.png",
  "/Images/icon-512.png"
];

// Install — skip waiting IMMEDIATELY
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(STATIC_ASSETS.map(url => cache.add(url).catch(() => null)))
    )
  );
});

// Activate — claim all clients immediately, delete old caches
self.addEventListener("activate", (e) => {
  e.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      ),
      self.clients.claim()
    ])
  );
});

// Fetch — network first, cache fallback, skip external URLs
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.hostname !== self.location.hostname) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Messages
self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (e.data?.type === "GET_VERSION")  e.ports[0]?.postMessage({ version: APP_VERSION });
  if (e.data?.type === "CLEAR_CACHE") {
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: "CACHE_CLEARED" }))
      ));
  }
});
