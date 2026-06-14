/**
 * storage.js v2 — Persistent data layer
 *
 * Watch METADATA (everything except photos) → localStorage  (fast, sync)
 * Watch PHOTOS (base64)                    → IndexedDB      (no 5MB limit)
 *
 * Public API (same as before, fully backward-compatible):
 *   getWatches()           → array of watch objects (photo field populated async)
 *   getWatch(id)           → single watch
 *   addWatch(data)         → creates and saves
 *   updateWatch(id,changes)→ merges and saves
 *   deleteWatch(id)        → removes from both stores
 *   startWearing(id)       → sets wearStart
 *   stopWearing(id)        → records history interval
 *   getActiveWatch()       → watch with wearStart set
 *   save()                 → persist metadata; triggers debounced cloud push
 *   loadPhotos()           → async: populates .photo on all watches from IDB
 */

const DB_KEY   = 'horlogerie_v3';     // localStorage key for metadata
const IDB_NAME = 'horlogerie_photos'; // IndexedDB database name
const IDB_STORE = 'photos';           // object store name
const IDB_VER  = 1;

let watches = [];
let _idb    = null;  // IndexedDB connection

/* ─── IndexedDB ─── */
function openIDB() {
  if (_idb) return Promise.resolve(_idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(IDB_STORE, { keyPath: 'id' });
    };
    req.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
    req.onerror   = () => reject(req.error);
  });
}

async function idbSavePhoto(id, dataUrl) {
  if (!dataUrl) return;
  try {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ id, photo: dataUrl });
      tx.oncomplete = res;
      tx.onerror    = () => rej(tx.error);
    });
  } catch (e) { console.warn('IDB save failed:', e); }
}

async function idbGetPhoto(id) {
  try {
    const db = await openIDB();
    return new Promise((res) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(id);
      req.onsuccess = () => res(req.result?.photo || null);
      req.onerror   = () => res(null);
    });
  } catch { return null; }
}

async function idbDeletePhoto(id) {
  try {
    const db = await openIDB();
    return new Promise((res) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = res;
    });
  } catch {}
}

async function idbGetAllPhotos() {
  try {
    const db = await openIDB();
    return new Promise((res) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror   = () => res([]);
    });
  } catch { return []; }
}

/* ─── Photo compression → WebP ─── */
/**
 * Compresses a photo to a target suitable for cloud sync.
 * maxDim 600px × quality 0.72 → ~40-60KB per photo (was 900px/0.82 → ~120-150KB)
 * A 30-watch collection stays under 2MB total in KV.
 */
async function compressPhoto(dataUrl, maxDim = 600, quality = 0.72) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale  = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w      = Math.round(img.width  * scale);
      const h      = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      // Try WebP first (smaller), fallback to JPEG
      const webp = canvas.toDataURL('image/webp', quality);
      const jpeg = canvas.toDataURL('image/jpeg', quality);
      resolve(webp.length < jpeg.length ? webp : jpeg);
    };
    img.onerror = () => resolve(dataUrl); // passthrough on error
    img.src = dataUrl;
  });
}
window.compressPhoto = compressPhoto;

/* ─── Metadata (localStorage) ─── */
function loadData() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    // Also migrate old key
    const old = !raw && localStorage.getItem('horlogerie_v2');
    const source = raw || old;
    watches = source ? JSON.parse(source) : [];
    // Strip base64 photos from metadata (they live in IDB now)
    watches.forEach(w => { if (w.photo && w.photo.startsWith('data:')) delete w.photo; });
  } catch { watches = []; }
}

function saveMeta() {
  try {
    // Never store photo in localStorage
    const slim = watches.map(w => {
      const { photo, ...rest } = w;
      return rest;
    });
    localStorage.setItem(DB_KEY, JSON.stringify(slim));
  } catch (e) {
    if (typeof showToast === 'function') showToast('⚠️ Error guardando datos locales');
  }
}

function save() {
  saveMeta();
  if (typeof window._debouncedPush === 'function') window._debouncedPush();
}

/* ─── Load photos from IDB into watch objects ─── */
async function loadPhotos() {
  const all = await idbGetAllPhotos();
  const map = {};
  all.forEach(r => { map[r.id] = r.photo; });
  watches.forEach(w => { if (map[w.id]) w.photo = map[w.id]; });
}
window.loadPhotos = loadPhotos;

/* ─── CRUD ─── */
function getWatches() { return watches; }
function getWatch(id) { return watches.find(w => w.id === id) || null; }

async function addWatch(data) {
  const id = 'w_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const photo = data.photo || null;
  const w = {
    id, brand: data.brand, model: data.model,
    ref: data.ref || '', type: data.type || 'automatic',
    notes: data.notes || '', specs: {}, price: null,
    history: [], wearStart: null, created: Date.now()
  };
  if (photo) {
    const compressed = await compressPhoto(photo);
    await idbSavePhoto(id, compressed);
    w.photo = compressed; // keep in memory for current session
  }
  watches.push(w);
  save();
  return w;
}
window.addWatch = addWatch;

async function updateWatch(id, changes) {
  const w = getWatch(id);
  if (!w) return null;
  const { photo, ...rest } = changes;
  Object.assign(w, rest);
  if (photo !== undefined) {
    if (photo) {
      const compressed = await compressPhoto(photo);
      await idbSavePhoto(id, compressed);
      w.photo = compressed;
    } else {
      await idbDeletePhoto(id);
      w.photo = null;
    }
  }
  save();
  return w;
}
window.updateWatch = updateWatch;

function deleteWatch(id) {
  watches = watches.filter(w => w.id !== id);
  idbDeletePhoto(id);
  save();
}

function getActiveWatch() { return watches.find(w => w.wearStart) || null; }

function startWearing(id) {
  const active = getActiveWatch();
  if (active && active.id !== id) return false;
  const w = getWatch(id);
  if (!w || w.wearStart) return false;
  w.wearStart = Date.now();
  save();
  return true;
}

function stopWearing(id) {
  const w = getWatch(id);
  if (!w || !w.wearStart) return false;
  if (!w.history) w.history = [];
  w.history.push({ start: w.wearStart, end: Date.now() });
  w.wearStart = null;
  save();
  return true;
}

/* ─── Cloud sync helpers (used by sync.js) ─── */

// Returns watches with photos embedded (for KV push)
async function getWatchesWithPhotos() {
  const all = await idbGetAllPhotos();
  const photoMap = {};
  all.forEach(r => { photoMap[r.id] = r.photo; });
  return watches.map(w => ({ ...w, photo: photoMap[w.id] || null }));
}
window.getWatchesWithPhotos = getWatchesWithPhotos;

// Restore from cloud (photos included in payload)
async function restoreFromCloud(cloudWatches) {
  // Separate photos from metadata
  const metas  = [];
  for (const w of cloudWatches) {
    const { photo, ...meta } = w;
    metas.push(meta);
    if (photo) await idbSavePhoto(w.id, photo);
  }
  watches.length = 0;
  metas.forEach(m => watches.push(m));
  // Re-attach photos to in-memory objects
  await loadPhotos();
  saveMeta();
}
window.restoreFromCloud = restoreFromCloud;

// Init
loadData();

/* ═══════════════════════════════════════
   WISHLIST — stored in localStorage
   Separate from watches collection.
═══════════════════════════════════════ */
const WL_KEY = 'horlogerie_wishlist_v1';

function getWishlist() {
  try { return JSON.parse(localStorage.getItem(WL_KEY) || '[]'); } catch { return []; }
}

function saveWishlist(items) {
  try { localStorage.setItem(WL_KEY, JSON.stringify(items)); } catch {}
}

function addWishlistItem(data) {
  const items = getWishlist();
  const item = {
    id:       'wl_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
    brand:    data.brand    || '',
    model:    data.model    || '',
    ref:      data.ref      || '',
    type:     data.type     || 'automatic',
    priority: data.priority || 'medium',
    precio:   data.precio   || '',
    notas:    data.notas    || '',
    specs: {
      calibre:    data.calibre    || '',
      cristal:    data.cristal    || '',
      diametro:   data.diametro   || '',
      grosor:     data.grosor     || '',
      resistencia:data.resistencia|| '',
      reserva:    data.reserva    || '',
      caja:       data.caja       || '',
      brazalete:  data.brazalete  || '',
      esfera:     data.esfera     || '',
    },
    created: Date.now(),
  };
  items.push(item);
  saveWishlist(items);
  return item;
}

function updateWishlistItem(id, changes) {
  const items = getWishlist();
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return null;
  Object.assign(items[idx], changes);
  if (changes.calibre !== undefined || changes.cristal !== undefined) {
    items[idx].specs = { ...items[idx].specs, ...changes };
  }
  saveWishlist(items);
  return items[idx];
}

function deleteWishlistItem(id) {
  saveWishlist(getWishlist().filter(i => i.id !== id));
}

function promoteWishlistToCollection(id) {
  const item = getWishlist().find(i => i.id === id);
  if (!item) return null;
  // Map wishlist item to watch format
  return {
    brand: item.brand,
    model: item.model,
    ref:   item.ref,
    type:  item.type,
    notes: item.notas,
    photo: null,
    specs: item.specs,
    price: item.precio ? { value: item.precio, note: 'Precio objetivo' } : null,
  };
}

window.getWishlist          = getWishlist;
window.saveWishlist         = saveWishlist;
window.addWishlistItem      = addWishlistItem;
window.updateWishlistItem   = updateWishlistItem;
window.deleteWishlistItem   = deleteWishlistItem;
window.promoteWishlistToCollection = promoteWishlistToCollection;
