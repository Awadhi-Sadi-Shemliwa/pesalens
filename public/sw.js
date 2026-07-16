/*
 * PesaLens service worker.
 *
 * Goals:
 *   1. Make the app installable (Chrome requires a registered SW with a
 *      `fetch` handler before it surfaces the "Add to Home Screen"
 *      install prompt).
 *   2. Serve a tiny offline shell so a returning user doesn't see the
 *      Chrome dino when their connection blips.
 *   3. NEVER cache /api/* — financial data must always come from the
 *      live backend.
 *
 * Strategy:
 *   • Precache the app shell on install (HTML, manifest, icons, the
 *     hashed JS/CSS bundle is added on first network success).
 *   • Network-first for navigations (so deploys are picked up the
 *     next time the user opens the app).
 *   • Cache-first for static, hashed assets in /assets/.
 *   • Bypass for /api/* and any request that isn't GET.
 */

// Bump whenever precached shell assets (icons, manifest) change content
// without changing filename — the activate handler evicts older caches.
// v2: brand icon refresh (old wallet favicon was pinned by the v1 cache).
const CACHE_VERSION = "pesalens-v2";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

const isApi = (url) => url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/");
const isStaticAsset = (url) =>
  url.pathname.startsWith("/assets/") ||
  /\.(?:png|svg|webmanifest|ico|webp|woff2?)$/i.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Same-origin only — never cache cross-origin (fonts, ticker, CDNs).
  if (url.origin !== self.location.origin) return;

  // Backend API: always live.
  if (isApi(url)) return;

  // Static hashed assets: cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
      )
    );
    return;
  }

  // SPA navigations: network-first, fall back to cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put("/index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/index.html").then((res) => res || caches.match("/")))
    );
    return;
  }
});

// Allow the page to push us into activate immediately on demand
// (used when the page detects a waiting SW after a deploy).
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});
