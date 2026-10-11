/**
 * sw.js v6 — Network-first for app shell
 *
 * Strategy:
 *  - HTML/JS/CSS: network-first → always get latest version
 *  - Fonts, icons, vendor libs (bundled, versioned): cache-first
 *  - API calls:   always network
 *  - On new SW detected: force reload so user always gets latest app
 */

const CACHE   = 'horlogerie-v2.13.0';
const BASE    = '/horlogerie';

// Files to pre-cache on install
const SHELL = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/ayuda.html`,
  `${BASE}/licencias.html`,
  `${BASE}/privacidad.html`,
  `${BASE}/css/app.css?v=2.13.0`,
  `${BASE}/css/fonts.css?v=2.13.0`,
  `${BASE}/css/icons.css?v=2.13.0`,
  `${BASE}/css/icons/tabler-icons-2a4af5f0.woff2`,
  `${BASE}/css/fonts/bodoni-moda-latin-400-normal.woff2`,
  `${BASE}/css/fonts/bodoni-moda-latin-500-normal.woff2`,
  `${BASE}/css/fonts/bodoni-moda-latin-600-normal.woff2`,
  `${BASE}/css/fonts/jost-latin-300-normal.woff2`,
  `${BASE}/css/fonts/jost-latin-400-normal.woff2`,
  `${BASE}/css/fonts/jost-latin-500-normal.woff2`,
  `${BASE}/css/fonts/jost-latin-600-normal.woff2`,
  `${BASE}/css/fonts/jost-latin-400-italic.woff2`,
  `${BASE}/js/vendor/jspdf-2.5.1.umd.min.js`,
  `${BASE}/js/db.js`,              // módulo ES: se importa sin ?v (la caché cambia de nombre con cada versión)
  `${BASE}/js/storage.js`,
  `${BASE}/js/data/persist.js`,
  `${BASE}/js/data/photos.js`,
  `${BASE}/js/data/watches.js`,
  `${BASE}/js/data/wear.js`,
  `${BASE}/js/data/merge.js`,
  `${BASE}/js/data/backup.js`,
  `${BASE}/js/data/wishlist.js`,
  `${BASE}/js/modules/sheet.js`,
  `${BASE}/js/api.js`,
  `${BASE}/js/sync.js`,
  `${BASE}/js/cloud2.js`,
  `${BASE}/js/export.js`,
  `${BASE}/js/modules/core.js`,
  `${BASE}/js/modules/home-detail.js`,
  `${BASE}/js/modules/modals.js`,
  `${BASE}/js/modules/history.js`,
  `${BASE}/js/modules/settings.js`,
  `${BASE}/js/modules/wishlist.js`,
  `${BASE}/js/modules/session.js`,
  `${BASE}/js/modules/updates.js`,
  `${BASE}/js/spec-parser.js?v=2.13.0`,
  `${BASE}/js/main.js?v=2.13.0`,
  `${BASE}/js/modules/url-import.js`,
  `${BASE}/js/vendor/qrcode-generator-1.4.4.js`,
  `${BASE}/brand/rotor-symbol.svg`,
  `${BASE}/manifest.json`,
  `${BASE}/watches_db.json`,  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`,
  `${BASE}/icons/icon-maskable-192.png`,
  `${BASE}/icons/icon-maskable-512.png`,
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
      url.pathname.endsWith('/version.json')) {
    e.respondWith(fetch(e.request).catch(() =>
      new Response(JSON.stringify({ error: 'Offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })
    ));
    return;
  }

  // 2. Fonts, icon font and third-party libraries bundled with the app —
  //    cache-first (versioned file names, they never change)
  if (url.origin === self.location.origin &&
      /\/(css\/fonts|css\/icons|js\/vendor)\//.test(url.pathname)) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // 3. App shell (HTML, JS, CSS, JSON) — network-first
  //    → Always fetches latest from GitHub Pages
  //    → Falls back to cache if offline
  e.respondWith(networkFirst(e.request));
});

/* ── Network-first with a time limit: fresh files when the connection is
   good; after 2.5 s on a bad connection, the cached copy is served while the
   download carries on and refreshes the cache for next time. ── */
const NET_TIMEOUT_MS = 2500;
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request, { cache: 'no-cache' }).then(fresh => {
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  });
  network.catch(() => {});   // a late failure after serving the cache is fine
  const cached = await cache.match(request);
  if (!cached) {
    try { return await network; }
    catch { return (await cache.match(`${BASE}/index.html`)) || new Response('Sin conexión', { status: 503 }); }
  }
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), NET_TIMEOUT_MS));
  try {
    const first = await Promise.race([network, timeout]);
    return first || cached;
  } catch {
    return cached;
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
