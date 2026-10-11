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
  const now = Date.now();
  const w = {
    id, brand: data.brand, model: data.model,
    ref: data.ref || '', type: data.type || 'automatic',
    notes: data.notes || '', specs: {}, price: null,
    history: [], wearStart: null, created: now, updatedAt: now
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
  w.updatedAt = Date.now();
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
  // Mutate in place: other modules hold a reference to this array
  const idx = watches.findIndex(w => w.id === id);
  if (idx !== -1) watches.splice(idx, 1);
  idbDeletePhoto(id);
  addTombstone('watches', id);
  save();
}

function getActiveWatch() { return watches.find(w => w.wearStart) || null; }

function startWearing(id) {
  const active = getActiveWatch();
  if (active && active.id !== id) return false;
  const w = getWatch(id);
  if (!w || w.wearStart) return false;
  w.wearStart = Date.now();
  w.updatedAt = w.wearStart;
  save();
  return true;
}

function stopWearing(id) {
  const w = getWatch(id);
  if (!w || !w.wearStart) return false;
  if (!w.history) w.history = [];
  const now = Date.now();
  w.history.push({ start: w.wearStart, end: now });
  w.wearStart = null;
  w.updatedAt = now;
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

/* ═══════════════════════════════════════
   TOMBSTONES — ids deleted locally that the cloud still has to hear about.
   Cleared by sync.js after a successful push.
═══════════════════════════════════════ */
const TOMB_KEY = 'horlogerie_tombstones_v1';

function getTombstones() {
  try {
    const t = JSON.parse(localStorage.getItem(TOMB_KEY) || '{}');
    return { watches: t.watches || [], wishlist: t.wishlist || [] };
  } catch { return { watches: [], wishlist: [] }; }
}
function setTombstones(t) {
  try { localStorage.setItem(TOMB_KEY, JSON.stringify(t)); } catch {}
}
function addTombstone(kind, id) {
  const t = getTombstones();
  if (!t[kind].includes(id)) t[kind].push(id);
  setTombstones(t);
}
function clearTombstones(kind, ids) {
  const t = getTombstones();
  const done = new Set(ids);
  t[kind] = t[kind].filter(id => !done.has(id));
  setTombstones(t);
}

/* ═══════════════════════════════════════
   MERGE — combine local and cloud lists item by item.
   Pure function (no side effects) so it can be tested in isolation.

   local, cloud   arrays of { id, updatedAt?, created? , ... }
   syncedIds      ids known to be in the cloud after the last successful sync
   localDeleted   ids deleted here and not yet pushed

   Rules:
   - In both            → keep the most recently modified (tie → cloud)
   - Only local         → was synced before? then the cloud deleted it → drop
                          never synced? it is new here → keep
   - Only in cloud      → deleted here and not pushed yet? → drop; else → add
═══════════════════════════════════════ */
function itemStamp(x) {
  if (!x) return 0;
  if (typeof x.updatedAt === 'number') return x.updatedAt;
  let s = typeof x.created === 'number' ? x.created : 0;
  if (typeof x.wearStart === 'number') s = Math.max(s, x.wearStart);
  for (const h of (Array.isArray(x.history) ? x.history : [])) {
    s = Math.max(s, h?.end || h?.start || 0);
  }
  return s;
}

function mergeById(local, cloud, syncedIds = [], localDeleted = []) {
  const synced  = new Set(syncedIds);
  const deleted = new Set(localDeleted);
  const cloudMap = new Map((cloud || []).filter(x => x && x.id).map(x => [x.id, x]));
  const out = [];
  const stats = { keptLocal: 0, fromCloud: 0, droppedLocal: 0, droppedCloud: 0 };

  for (const l of (local || [])) {
    if (!l || !l.id) continue;
    const c = cloudMap.get(l.id);
    if (c) {
      if (itemStamp(l) > itemStamp(c)) { out.push(l); stats.keptLocal++; }
      else { out.push(c); stats.fromCloud++; }
      cloudMap.delete(l.id);
    } else if (synced.has(l.id)) {
      stats.droppedLocal++;            // deleted on another device
    } else {
      out.push(l); stats.keptLocal++;  // new on this device
    }
  }
  for (const c of cloudMap.values()) {
    if (deleted.has(c.id)) { stats.droppedCloud++; continue; }
    out.push(c); stats.fromCloud++;
  }
  return { items: out, stats };
}
window.mergeById = mergeById;

/* Replace the in-memory collection with a merged list.
   Photos travel inside cloud/backup items: store them in IndexedDB. */
async function applyWatchList(list) {
  const keepIds = new Set(list.map(w => w.id));
  const metas = [];
  for (const w of list) {
    const { photo, ...meta } = w;
    if (isSafePhoto(photo)) await idbSavePhoto(w.id, photo);
    metas.push(meta);
  }
  // Remove photos of watches that no longer exist
  for (const w of watches) if (!keepIds.has(w.id)) await idbDeletePhoto(w.id);
  watches.length = 0;
  metas.forEach(m => watches.push(m));
  await loadPhotos();
  saveMeta();
}
window.applyWatchList = applyWatchList;

/* ═══════════════════════════════════════
   SANITIZE — anything coming from a backup file or the cloud
═══════════════════════════════════════ */
const WATCH_TYPES = ['automatic', 'quartz', 'manual'];
const SPEC_KEYS   = ['calibre','movimiento','cristal','brazalete','esfera','caja','resistencia','reserva','diametro','grosor'];
const MAX_PHOTO_CHARS = 3 * 1024 * 1024;

function isSafePhoto(p) {
  return typeof p === 'string' && p.length < MAX_PHOTO_CHARS &&
    /^data:image\/(webp|jpeg|jpg|png);base64,[A-Za-z0-9+/=]+$/.test(p);
}
window.isSafePhoto = isSafePhoto;

const _str = (v, max = 500) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const _num = v => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);

function sanitizeWatch(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const brand = _str(raw.brand, 80).trim(), model = _str(raw.model, 120).trim();
  if (!brand || !model) return null;
  const id = /^[A-Za-z0-9_-]{1,64}$/.test(raw.id || '') ? raw.id
    : 'w_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const specs = {};
  for (const k of SPEC_KEYS) if (raw.specs?.[k]) specs[k] = _str(raw.specs[k], 200);
  const history = (Array.isArray(raw.history) ? raw.history : [])
    .map(h => ({ start: _num(h?.start), end: _num(h?.end) }))
    .filter(h => h.start && h.end && h.end >= h.start);
  const w = {
    id, brand, model,
    ref:   _str(raw.ref, 80),
    type:  WATCH_TYPES.includes(raw.type) ? raw.type : 'automatic',
    notes: _str(raw.notes, 2000),
    specs,
    price: raw.price && typeof raw.price === 'object'
      ? { value: _str(raw.price.value, 80), note: _str(raw.price.note, 200) } : null,
    history,
    wearStart: _num(raw.wearStart),
    created:   _num(raw.created) || Date.now(),
  };
  if (_num(raw.updatedAt)) w.updatedAt = raw.updatedAt;
  if (raw._source)  w._source  = _str(raw._source, 80);
  if (raw._warning) w._warning = _str(raw._warning, 200);
  if (isSafePhoto(raw.photo)) w.photo = raw.photo;
  return w;
}
window.sanitizeWatch = sanitizeWatch;

function sanitizeWishlistItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const brand = _str(raw.brand, 80).trim(), model = _str(raw.model, 120).trim();
  if (!brand || !model) return null;
  const specs = {};
  for (const k of SPEC_KEYS) if (raw.specs?.[k]) specs[k] = _str(raw.specs[k], 200);
  const it = {
    id: /^[A-Za-z0-9_-]{1,64}$/.test(raw.id || '') ? raw.id
      : 'wl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    brand, model,
    ref:      _str(raw.ref, 80),
    type:     WATCH_TYPES.includes(raw.type) ? raw.type : 'automatic',
    priority: ['high','medium','low'].includes(raw.priority) ? raw.priority : 'medium',
    precio:   _str(raw.precio, 80),
    notas:    _str(raw.notas, 2000),
    specs,
    created:  _num(raw.created) || Date.now(),
  };
  if (_num(raw.updatedAt)) it.updatedAt = raw.updatedAt;
  return it;
}
window.sanitizeWishlistItem = sanitizeWishlistItem;

/* Only one watch can be "on the wrist" at a time */
function enforceSingleActive(list) {
  const active = list.filter(w => w.wearStart).sort((a, b) => b.wearStart - a.wearStart);
  active.slice(1).forEach(w => { w.wearStart = null; });
  return list;
}

/* ═══════════════════════════════════════
   BACKUP — export / import
═══════════════════════════════════════ */
async function buildBackup() {
  return {
    app: 'horlogerie',
    version: 3,
    exported: Date.now(),
    watches: await getWatchesWithPhotos(),
    wishlist: getWishlist(),
  };
}
window.buildBackup = buildBackup;

/**
 * Import a backup (v2: {watches}, v3: {watches, wishlist}, or a bare array).
 * Merges with what is already here; on the same id the most recent wins.
 * Returns { watches: {...stats}, wishlist: {...stats}, rejected }.
 */
async function importBackup(data) {
  const rawWatches  = Array.isArray(data) ? data : (Array.isArray(data?.watches) ? data.watches : null);
  if (!rawWatches) throw new Error('Formato no reconocido');
  const rawWishlist = Array.isArray(data?.wishlist) ? data.wishlist : [];

  const incoming = rawWatches.map(sanitizeWatch).filter(Boolean);
  const wlIn     = rawWishlist.map(sanitizeWishlistItem).filter(Boolean);
  const rejected = (rawWatches.length - incoming.length) + (rawWishlist.length - wlIn.length);

  const local = await getWatchesWithPhotos();
  const mw = mergeById(local, incoming);            // nothing is deleted on import
  await applyWatchList(enforceSingleActive(mw.items));

  const ml = mergeById(getWishlist(), wlIn);
  setWishlistSilently(ml.items);

  save();   // marks everything for the next cloud push
  return { watches: mw.stats, wishlist: ml.stats, rejected, total: incoming.length, totalWishlist: wlIn.length };
}
window.importBackup = importBackup;

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

/* Write without triggering a cloud push (used when applying merges) */
function setWishlistSilently(items) {
  try { localStorage.setItem(WL_KEY, JSON.stringify(items)); } catch {
    if (typeof showToast === 'function') showToast('⚠️ Error guardando la lista de deseos');
  }
}
window.setWishlistSilently = setWishlistSilently;

/* User-initiated change: stamp modified items and schedule a cloud push */
function saveWishlist(items) {
  const prev = new Map(getWishlist().map(i => [i.id, JSON.stringify(i)]));
  const now  = Date.now();
  items.forEach(i => {
    const before = prev.get(i.id);
    const { updatedAt, ...rest } = i;
    if (!before) { i.updatedAt = i.updatedAt || now; return; }
    const { updatedAt: _u, ...beforeRest } = JSON.parse(before);
    if (JSON.stringify(rest) !== JSON.stringify(beforeRest)) i.updatedAt = now;
  });
  setWishlistSilently(items);
  if (typeof window._debouncedPush === 'function') window._debouncedPush();
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
  addTombstone('wishlist', id);
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
