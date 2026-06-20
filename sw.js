/**
 * sw.js v6 — Network-first for app shell
 *
 * Strategy:
 *  - HTML/JS/CSS: network-first → always get latest version
 *  - Fonts/icons: cache-first → fast loading, rarely change
 *  - API calls:   always network
 *  - On new SW detected: force reload so user always gets latest app
 */

const CACHE   = 'horlogerie-v21';
const BASE    = '/horlogerie';

// Files to pre-cache on install
const SHELL = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/css/app.css?v=2.1.2`,
  `${BASE}/js/db.js?v=2.1.2`,
  `${BASE}/js/storage.js?v=2.1.2`,
  `${BASE}/js/api.js?v=2.1.2`,
  `${BASE}/js/sync.js?v=2.1.2`,
  `${BASE}/js/export.js?v=2.1.2`,
  `${BASE}/js/modules/core.js?v=2.1.2`,
  `${BASE}/js/modules/home-detail.js?v=2.1.2`,
  `${BASE}/js/modules/modals.js?v=2.1.2`,
  `${BASE}/js/modules/history.js?v=2.1.2`,
  `${BASE}/js/modules/settings.js?v=2.1.2`,
  `${BASE}/js/modules/wishlist.js?v=2.1.2`,
  `${BASE}/js/modules/session.js?v=2.1.2`,
  `${BASE}/js/modules/updates.js?v=2.1.2`,
  `${BASE}/js/modules/url-import.js?v=2.1.2`,
  `${BASE}/manifest.json`,
  `${BASE}/watches_db.json`,  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`,
  `${BASE}/icons/apple-touch-icon.png`,
  `${BASE}/favicon.ico`,
];

/* ── INSTALL: pre-cache shell, resilient to individual fetch failures ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async cache => {
      // addAll() fails entirely if ANY single URL fails (flaky network, etc).
      // Use allSettled so a single failed asset doesn't block the whole install.
      const results = await Promise.allSettled(
        SHELL.map(url => cache.add(url))
      );
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length) {
        console.warn(`SW install: ${failed.length}/${SHELL.length} assets failed to pre-cache`);
      }
      return self.skipWaiting();
    })
  );
});

/* ── ACTIVATE: delete old caches, claim all clients ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())   // take control of all open tabs
      .then(() => {
        // Tell all clients to reload now that new SW is active
        self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
        });
      })
  );
});

/* ── FETCH ── */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 1. API calls + version.json — always network, never cache
  if (url.hostname.includes('workers.dev') ||
      url.hostname.includes('groq.com') ||
      url.hostname.includes('api.ebay.com') ||
      url.pathname.endsWith('/version.json')) {
    e.respondWith(fetch(e.request).catch(() =>
      new Response(JSON.stringify({ error: 'Offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })
    ));
    return;
  }

  // 2. External fonts & icons — cache-first (they never change)
  if (url.hostname === 'fonts.gstatic.com' ||
      url.hostname.includes('jsdelivr.net') ||
      url.hostname === 'fonts.googleapis.com') {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // 3. App shell (HTML, JS, CSS, JSON) — network-first
  //    → Always fetches latest from GitHub Pages
  //    → Falls back to cache if offline
  e.respondWith(networkFirst(e.request));
});

/* ── Network-first: try network, update cache, fallback to cache ── */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request, { cache: 'no-cache' });
    if (fresh.ok) {
      // Update cache with fresh response
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    // Offline — serve from cache
    const cached = await cache.match(request);
    return cached || cache.match(`${BASE}/index.html`) ||
      new Response('Sin conexión', { status: 503 });
  }
}

/* ── Cache-first: serve from cache, fetch if missing ── */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    return new Response('', { status: 503 });
  }
}
