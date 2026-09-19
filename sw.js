// sw.js — Tucker's Camp Lite
const APP_VERSION = "lite-2.17.0";
const CACHE_NAME  = `tuckers-camp-lite-${APP_VERSION}`;

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/firebase.js",
  "/manifest.json",
  "/Images/wood-back.jpg",
  "/Images/appiconlogo.png",
  "/Images/tuckers-icon-192.png",
  "/Images/tuckers-icon-512.png",
  "/Images/tuckers-icon-180.png",
  "/Images/tuckers-icon-maskable-512.png"
];

// The Firebase SDK — version-pinned and immutable, and served with CORS, so we
// can cache it and boot the app offline. Each file only imports firebase-app.js.
const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/10.12.0/";
const CDN_ASSETS = [
  FIREBASE_SDK + "firebase-app.js",
  FIREBASE_SDK + "firebase-auth.js",
  FIREBASE_SDK + "firebase-firestore.js",
  FIREBASE_SDK + "firebase-storage.js"
];

// Install — cache the shell + SDK, activate immediately
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        [...STATIC_ASSETS, ...CDN_ASSETS].map(url => cache.add(url).catch(() => null))
      )
    )
  );
});

// Activate — claim clients, drop old caches
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

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const isSameOrigin  = url.hostname === self.location.hostname;
  const isFirebaseSDK = e.request.url.startsWith(FIREBASE_SDK);

  if (!isSameOrigin && !isFirebaseSDK) return;   // let everything else pass through

  // Firebase SDK: cache-first (it never changes for a given version)
  if (isFirebaseSDK) {
    e.respondWith(
      caches.match(e.request).then((hit) =>
        hit || fetch(e.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          }
          return res;
        })
      )
    );
    return;
  }

  // Same-origin: network-first, fall back to cache; navigations fall back to the shell
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        if (e.request.mode === "navigate") {
          return (await caches.match("/index.html")) || (await caches.match("/"));
        }
        return Response.error();
      })
  );
});

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
