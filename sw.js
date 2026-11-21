/* Sol service worker: makes the site installable and readable offline.
   - Pages, CSS, JS: network first (always fresh online), cached copy offline
   - Libraries, fonts, covers: cache first (they never change at the same URL)
   - Book list from Supabase: network first, cached copy offline
   Downloaded chapters live in IndexedDB (js/offline.js), not here.
   `npm run build` fills in PRECACHE and VERSION. */
const VERSION = "dev";
const PRECACHE = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png"];

const SHELL = "sol-shell-" + VERSION;
const STATIC = "sol-static-v2";   /* v2: CDN scripts load with SRI (CORS), old opaque copies dropped */
const DATA = "sol-data-v1";
const SUPABASE = "whxtkvavyisbvisdemhn.supabase.co";
const CACHE_FIRST_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    /* one missing file must not stop the whole install */
    await Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL, STATIC, DATA];
    for (const key of await caches.keys()) {
      if (key.startsWith("sol-") && !keep.includes(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch (err) {
    const hit = (await cache.match(request, { ignoreVary: true, ignoreSearch: request.mode === "navigate" })) ||
      (await caches.match(request, { ignoreVary: true })) ||
      (fallbackUrl && (await caches.match(fallbackUrl)));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response && (response.ok || response.type === "opaque")) cache.put(request, response.clone()).catch(() => {});
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname === "/sw.js") return;
    if (request.mode === "navigate") {
      event.respondWith(networkFirst(request, SHELL, "/index.html"));
    } else {
      event.respondWith(networkFirst(request, SHELL));
    }
    return;
  }

  if (CACHE_FIRST_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.hostname === SUPABASE) {
    if (url.pathname.startsWith("/storage/v1/object/public/")) {
      event.respondWith(cacheFirst(request));
    } else if (url.pathname === "/rest/v1/books") {
      event.respondWith(networkFirst(request, DATA));
    }
    /* everything else (auth, chapters, payments) goes straight to the network */
  }
});

/* lets the page ask "which version is running?" */
self.addEventListener("message", (event) => {
  if (event.data === "version" && event.ports[0]) event.ports[0].postMessage(VERSION);
});
