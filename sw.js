/**
 * sw.js v5 — Service Worker
 * Index is at repo root → GitHub Pages serves from /Horlogerie/
 */

const CACHE_STATIC  = 'horlogerie-static-v5';
const CACHE_RUNTIME = 'horlogerie-runtime-v5';
const BASE = '/Horlogerie';

const SHELL = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/css/app.css`,
  `${BASE}/js/db.js`,
  `${BASE}/js/storage.js`,
  `${BASE}/js/api.js`,
  `${BASE}/js/sync.js`,
  `${BASE}/js/export.js`,
  `${BASE}/js/app.js`,
  `${BASE}/manifest.json`,
  `${BASE}/watches_db.json`,
  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`,
  `${BASE}/icons/apple-touch-icon.png`,
  `${BASE}/favicon.ico`,
];

const EXTERNAL = [
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=DM+Sans:wght@300;400;500&display=swap',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const staticCache = await caches.open(CACHE_STATIC);
    await staticCache.addAll(SHELL);
    const runtimeCache = await caches.open(CACHE_RUNTIME);
    await Promise.allSettled(EXTERNAL.map(url =>
      fetch(url, { mode: 'cors' })
        .then(res => { if (res.ok) runtimeCache.put(url, res); })
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE_STATIC && k !== CACHE_RUNTIME)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.hostname.includes('workers.dev') || url.hostname.includes('groq.com')) {
    e.respondWith(fetch(e.request).catch(() =>
      new Response(JSON.stringify({ error: 'Offline' }), {
        status: 503, headers: { 'Content-Type': 'application/json' }
      })
    ));
    return;
  }

  if (url.hostname === 'fonts.googleapis.com') {
    e.respondWith(networkFirstCache(e.request, CACHE_RUNTIME));
    return;
  }

  if (url.hostname === 'fonts.gstatic.com' || url.hostname.includes('jsdelivr.net')) {
    e.respondWith(cacheFirstNetwork(e.request, CACHE_RUNTIME));
    return;
  }

  e.respondWith(cacheFirstNetwork(e.request, CACHE_STATIC));
});

async function networkFirstCache(request, cacheName) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('', { status: 503 });
  }
}

async function cacheFirstNetwork(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    return caches.match(`${BASE}/index.html`) ||
           new Response('', { status: 503 });
  }
}
