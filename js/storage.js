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


/* storage.js has no UI dependencies (it also runs in the Node tests): the app
   plugs in its toast with setNotifier(). */
let notify = () => {};
export function setNotifier(fn) { notify = typeof fn === 'function' ? fn : () => {}; }
/* Called after every local change (the cloud copy plugs in its debounced upload). */
let onChange = () => {};
export function setOnChange(fn) { onChange = typeof fn === 'function' ? fn : () => {}; }

export const DB_KEY   = 'horlogerie_v3';     // localStorage key for metadata
export const IDB_NAME = 'horlogerie_photos'; // IndexedDB database name
export const IDB_STORE = 'photos';           // object store name
export const IDB_VER  = 1;

export let watches = [];
export let _idb    = null;  // IndexedDB connection

/* ─── IndexedDB ─── */
export function openIDB() {
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

export async function idbSavePhoto(id, dataUrl) {
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


export async function idbDeletePhoto(id) {
  try {
    const db = await openIDB();
    return new Promise((res) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = res;
    });
  } catch {}
}

export async function idbGetAllPhotos() {
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
export async function compressPhoto(dataUrl, maxDim = 600, quality = 0.72) {
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
/* ─── Metadata (localStorage) ─── */
/**
 * Read JSON from localStorage without ever losing data: if the stored text
 * can't be parsed (or has the wrong shape), it is copied untouched to
 * `<key>_corrupt_<date>` before the app starts with the fallback, so the next
 * save can't overwrite the only copy. The UI is told via `storageRecovered`.
 */
export const storageRecovered = [];
export function readJSON(key, fallback, isValid = () => true) {
  let raw = null;
  try { raw = localStorage.getItem(key); } catch { return fallback; }
  if (raw == null || raw === '') return fallback;
  try {
    const v = JSON.parse(raw);
    if (isValid(v)) return v;
  } catch { /* fall through to quarantine */ }
  try { localStorage.setItem(`${key}_corrupt_${new Date().toISOString().slice(0, 10)}`, raw); } catch {}
  storageRecovered.push(key);
  return fallback;
}
/**
 * Ask the browser not to evict our data when the device runs low on space.
 * Installed apps usually get it without a prompt. Returns true/false/null (unsupported).
 */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}
export async function isPersisted() {
  try { return navigator.storage?.persisted ? await navigator.storage.persisted() : null; } catch { return null; }
}
export function loadData() {
  const isList = v => Array.isArray(v) && v.every(w => w && typeof w === 'object' && typeof w.id === 'string');
  let list = readJSON(DB_KEY, null, isList);
  if (list === null && !storageRecovered.includes(DB_KEY)) list = readJSON('horlogerie_v2', [], isList);   // old key
  watches = list || [];
  // Photos live in IndexedDB, never in the metadata
  watches.forEach(w => { if (w.photo && String(w.photo).startsWith('data:')) delete w.photo; });
}

export function saveMeta() {
  try {
    // Never store photo in localStorage
    const slim = watches.map(w => {
      const { photo, ...rest } = w;
      return rest;
    });
    localStorage.setItem(DB_KEY, JSON.stringify(slim));
  } catch (e) {
    notify('No se pudieron guardar los datos en este dispositivo. Libera espacio o haz una copia JSON.');
  }
}

export function save() {
  saveMeta();
  onChange();
}

/* ─── Load photos from IDB into watch objects ─── */
export async function loadPhotos() {
  const all = await idbGetAllPhotos();
  const map = {};
  all.forEach(r => { map[r.id] = r.photo; });
  watches.forEach(w => { if (map[w.id]) w.photo = map[w.id]; });
}
/* ─── CRUD ─── */
export function getWatches() { return watches; }
export function getWatch(id) { return watches.find(w => w.id === id) || null; }

export async function addWatch(data) {
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
  requestPersistence();
  return w;
}
export async function updateWatch(id, changes) {
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
export function deleteWatch(id) {
  // Mutate in place: other modules hold a reference to this array
  const idx = watches.findIndex(w => w.id === id);
  if (idx !== -1) watches.splice(idx, 1);
  idbDeletePhoto(id);
  addTombstone('watches', id);
  save();
}

export function getActiveWatch() { return watches.find(w => w.wearStart) || null; }

export function startWearing(id) {
  const active = getActiveWatch();
  if (active && active.id !== id) return false;
  const w = getWatch(id);
  if (!w || w.wearStart) return false;
  w.wearStart = Date.now();
  w.updatedAt = w.wearStart;
  save();
  return true;
}

export function stopWearing(id) {
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

/* ═══════════════════════════════════════
   WEAR LOG — calendar-day semantics
   A watch "was worn on a day" if any interval touches that local calendar
   day. Two hours count as one day; two sessions on the same day count once.
═══════════════════════════════════════ */
export const DAY_MS = 86400000;

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
/** Whole calendar days between two timestamps (0 = same day) */
export function calendarDaysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

/** All intervals of a watch, including the live one */
export function wearIntervals(w, now = Date.now()) {
  const all = (w.history || []).map((h, i) => ({ start: h.start, end: h.end || h.start, idx: i }));
  if (w.wearStart) all.push({ start: w.wearStart, end: now, active: true, idx: -1 });
  return all.sort((a, b) => a.start - b.start);
}

/** Set of local day keys on which the watch was worn */
export function wornDayKeys(w, now = Date.now()) {
  const keys = new Set();
  for (const iv of wearIntervals(w, now)) {
    let t = startOfDay(iv.start);
    const last = startOfDay(iv.end);
    let guard = 0;
    while (t <= last && guard++ < 3700) {   // 10 years cap
      keys.add(dayKey(t));
      const d = new Date(t); d.setDate(d.getDate() + 1); t = d.getTime();
    }
  }
  return keys;
}

/**
 * Usage summary for one watch.
 *   daysWorn          distinct calendar days worn (all time)
 *   daysWorn90        distinct days in the last 90 days
 *   sessions          number of intervals
 *   lastWorn          timestamp of the last time it was on the wrist (null = never)
 *   daysSinceLast     calendar days since lastWorn (0 = today)
 *   costPerWear       purchasePrice / daysWorn (null if unknown)
 */
export function wearStats(w, now = Date.now()) {
  const ivs  = wearIntervals(w, now);
  const keys = wornDayKeys(w, now);
  const cutoff = dayKey(now - 89 * DAY_MS);
  let worn90 = 0;
  for (const k of keys) if (k >= cutoff) worn90++;
  const lastWorn = ivs.length ? Math.max(...ivs.map(i => i.active ? now : i.end)) : null;
  const price = typeof w.purchasePrice === 'number' && w.purchasePrice > 0 ? w.purchasePrice : null;
  return {
    daysWorn: keys.size,
    daysWorn90: worn90,
    sessions: ivs.length,
    lastWorn,
    daysSinceLast: lastWorn === null ? null : (w.wearStart ? 0 : calendarDaysBetween(lastWorn, now)),
    active: !!w.wearStart,
    costPerWear: price && keys.size ? price / keys.size : null,
  };
}

/** Maintenance alerts: quartz battery (> 24 months) and service (> 5 years) */
export const BATTERY_MONTHS = 24;
export const SERVICE_YEARS  = 5;
export function maintenanceAlerts(w, now = Date.now()) {
  const out = [];
  const months = ts => Math.floor((now - ts) / (30.44 * DAY_MS));
  if (w.type === 'quartz' && typeof w.batteryChanged === 'number') {
    const m = months(w.batteryChanged);
    if (m >= BATTERY_MONTHS) out.push({ kind: 'battery', months: m,
      text: `Pila cambiada hace ${m} meses: revísala antes de que se agote y pierda líquido` });
  }
  if (w.type !== 'quartz') {
    const ref = typeof w.lastService === 'number' ? w.lastService
              : typeof w.purchaseDate === 'number' ? w.purchaseDate : null;
    if (ref !== null) {
      const y = (now - ref) / (365.25 * DAY_MS);
      if (y >= SERVICE_YEARS) out.push({ kind: 'service', years: Math.floor(y),
        text: `${typeof w.lastService === 'number' ? 'Última revisión' : 'Comprado'} hace ${Math.floor(y)} años: toca revisión (cada ${SERVICE_YEARS} años aprox.)` });
    }
  }
  return out;
}

/* ── Wear actions ── */

/** Mark a day (or a range of days) as worn, without live tracking */
export function addWearDays(id, fromTs, toTs = fromTs) {
  const w = getWatch(id);
  if (!w) return false;
  const now = Date.now();
  const r = dayRange(fromTs, toTs, now);
  if (!r) return false;                                                   // no future days
  if (!w.history) w.history = [];
  w.history.push(r);
  w.history.sort((a, b) => a.start - b.start);
  w.updatedAt = now;
  save();
  return true;
}

/**
 * A logged day runs 09:00–21:00 so it never spills into the next date. Today
 * is clamped to "now", so logging early in the morning (00:00–08:59) still
 * counts today. Days after today are refused.
 */
export function dayRange(fromTs, toTs, now = Date.now()) {
  if (startOfDay(Math.min(fromTs, toTs)) > startOfDay(now)) return null;   // future day
  let start = startOfDay(Math.min(fromTs, toTs)) + 9 * 3600000;
  let end   = startOfDay(Math.max(fromTs, toTs)) + 21 * 3600000;
  if (start > now) start = now;
  if (end > now) end = now;
  if (start > end) start = end;
  return { start, end };
}

/** "Lo llevé hoy" — idempotent: does nothing if it already counts for today */
export function markWornToday(id) {
  const w = getWatch(id);
  if (!w) return false;
  if (wornDayKeys(w).has(dayKey(Date.now()))) return 'already';
  return addWearDays(id, Date.now());
}

export function updateHistoryEntry(id, idx, fromTs, toTs) {
  const w = getWatch(id);
  if (!w || !w.history?.[idx]) return false;
  const now = Date.now();
  const r = dayRange(fromTs, toTs, now);
  if (!r) return false;
  w.history[idx] = r;
  w.history.sort((a, b) => a.start - b.start);
  w.updatedAt = now;
  save();
  return true;
}

export function deleteHistoryEntry(id, idx) {
  const w = getWatch(id);
  if (!w || !w.history?.[idx]) return false;
  w.history.splice(idx, 1);
  w.updatedAt = Date.now();
  save();
  return true;
}

/**
 * Remove one calendar day from a watch's history. Intervals that span several
 * days are trimmed or split, so the other days stay. Returns 'active' if that
 * day belongs to the session in progress (it must be stopped first).
 */
export function removeWearDay(id, dayTs) {
  const w = getWatch(id);
  if (!w) return false;
  const day = startOfDay(dayTs);
  const next = d => { const x = new Date(d); x.setDate(x.getDate() + 1); return x.getTime(); };
  const prev = d => { const x = new Date(d); x.setDate(x.getDate() - 1); return x.getTime(); };
  if (w.wearStart && startOfDay(w.wearStart) <= day) return 'active';
  const out = [];
  let changed = false;
  for (const h of (w.history || [])) {
    const s = startOfDay(h.start), e = startOfDay(h.end || h.start);
    if (day < s || day > e) { out.push(h); continue; }
    changed = true;
    if (s === e) continue;                                              // single day: drop
    if (day === s) { out.push({ start: next(day) + 9 * 3600000, end: h.end }); continue; }
    if (day === e) { out.push({ start: h.start, end: prev(day) + 21 * 3600000 }); continue; }
    out.push({ start: h.start, end: prev(day) + 21 * 3600000 });          // split around the day
    out.push({ start: next(day) + 9 * 3600000, end: h.end });
  }
  if (!changed) return false;
  w.history = out.sort((a, b) => a.start - b.start);
  w.updatedAt = Date.now();
  save();
  return true;
}

/** Take off whatever is on the wrist and put this one on, in one step */
export function switchToWatch(id) {
  const active = getActiveWatch();
  if (active && active.id === id) return false;
  if (active) stopWearing(active.id);
  return startWearing(id);
}

export function setWatchFlag(id, key, value) {
  if (!['favorite', 'rotation'].includes(key)) return false;
  const w = getWatch(id);
  if (!w) return false;
  w[key] = !!value;
  w.updatedAt = Date.now();
  save();
  return true;
}

Object.assign(window, { dayKey, startOfDay, calendarDaysBetween, wearIntervals, wornDayKeys, wearStats,
  maintenanceAlerts, addWearDays, markWornToday, updateHistoryEntry, deleteHistoryEntry, removeWearDay, switchToWatch, setWatchFlag });

/* ─── Cloud sync helpers (used by sync.js) ─── */

// Returns watches with photos embedded (for KV push)
export async function getWatchesWithPhotos() {
  const all = await idbGetAllPhotos();
  const photoMap = {};
  all.forEach(r => { photoMap[r.id] = r.photo; });
  return watches.map(w => ({ ...w, photo: photoMap[w.id] || null }));
}
// Restore from cloud (photos included in payload)
export async function restoreFromCloud(cloudWatches) {
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
/* ═══════════════════════════════════════
   TOMBSTONES — ids deleted locally that the cloud still has to hear about.
   Cleared by sync.js after a successful push.
═══════════════════════════════════════ */
export const TOMB_KEY = 'horlogerie_tombstones_v1';

export function getTombstones() {
  const t = readJSON(TOMB_KEY, {}, v => v && typeof v === 'object');
  return { watches: t.watches || [], wishlist: t.wishlist || [] };
}
export function setTombstones(t) {
  try { localStorage.setItem(TOMB_KEY, JSON.stringify(t)); } catch {}
}
export function addTombstone(kind, id) {
  const t = getTombstones();
  if (!t[kind].includes(id)) t[kind].push(id);
  setTombstones(t);
}
export function clearTombstones(kind, ids) {
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
export function itemStamp(x) {
  if (!x) return 0;
  if (typeof x.updatedAt === 'number') return x.updatedAt;
  let s = typeof x.created === 'number' ? x.created : 0;
  if (typeof x.wearStart === 'number') s = Math.max(s, x.wearStart);
  for (const h of (Array.isArray(x.history) ? x.history : [])) {
    s = Math.max(s, h?.end || h?.start || 0);
  }
  return s;
}

export function mergeById(local, cloud, syncedIds = [], localDeleted = []) {
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
/* Replace the in-memory collection with a merged list.
   Photos travel inside cloud/backup items: store them in IndexedDB. */
export async function applyWatchList(list) {
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
/* ═══════════════════════════════════════
   SANITIZE — anything coming from a backup file or the cloud
═══════════════════════════════════════ */
export const WATCH_TYPES = ['automatic', 'quartz', 'manual'];
export const SPEC_KEYS   = ['calibre','movimiento','cristal','brazalete','esfera','caja','resistencia','reserva','diametro','grosor','asas'];
export const MAX_PHOTO_CHARS = 3 * 1024 * 1024;

export function isSafePhoto(p) {
  return typeof p === 'string' && p.length < MAX_PHOTO_CHARS &&
    /^data:image\/(webp|jpeg|jpg|png);base64,[A-Za-z0-9+/=]+$/.test(p);
}
export function isSafeUrl(u) {
  if (typeof u !== 'string' || u.length > 2000) return false;
  try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; }
}
export const _str = (v, max = 500) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
export const _num = v => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);

export function sanitizeWatch(raw) {
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
  if (typeof raw.favorite === 'boolean') w.favorite = raw.favorite;
  if (typeof raw.rotation === 'boolean') w.rotation = raw.rotation;
  for (const k of ['purchasePrice', 'purchaseDate', 'lastService', 'batteryChanged']) {
    if (_num(raw[k])) w[k] = raw[k];
  }
  if (raw._source)  w._source  = _str(raw._source, 80);
  if (isSafeUrl(raw.sourceUrl)) w.sourceUrl = raw.sourceUrl;
  if (raw._warning) w._warning = _str(raw._warning, 200);
  if (isSafePhoto(raw.photo)) w.photo = raw.photo;
  return w;
}
export function sanitizeWishlistItem(raw) {
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
  if (isSafeUrl(raw.sourceUrl)) it.sourceUrl = raw.sourceUrl;
  return it;
}
/* Only one watch can be "on the wrist" at a time */
export function enforceSingleActive(list) {
  const active = list.filter(w => w.wearStart).sort((a, b) => b.wearStart - a.wearStart);
  active.slice(1).forEach(w => { w.wearStart = null; });
  return list;
}

/* ═══════════════════════════════════════
   BACKUP — export / import
═══════════════════════════════════════ */
export async function buildBackup() {
  return {
    app: 'horlogerie',
    version: 3,
    exported: Date.now(),
    watches: await getWatchesWithPhotos(),
    wishlist: getWishlist(),
  };
}
/**
 * Import a backup (v2: {watches}, v3: {watches, wishlist}, or a bare array).
 * Merges with what is already here; on the same id the most recent wins.
 * Returns { watches: {...stats}, wishlist: {...stats}, rejected }.
 */
export async function importBackup(data) {
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
// Init
loadData();

/* ═══════════════════════════════════════
   WISHLIST — stored in localStorage
   Separate from watches collection.
═══════════════════════════════════════ */
export const WL_KEY = 'horlogerie_wishlist_v1';

export function getWishlist() {
  return readJSON(WL_KEY, [], v => Array.isArray(v));
}

/* Write without triggering a cloud push (used when applying merges) */
export function setWishlistSilently(items) {
  try { localStorage.setItem(WL_KEY, JSON.stringify(items)); } catch {
    notify('No se pudo guardar la lista de deseos en este dispositivo.');
  }
}
/* User-initiated change: stamp modified items and schedule a cloud push */
export function saveWishlist(items) {
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
  onChange();
}

export function addWishlistItem(data) {
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
      movimiento: data.movimiento || '',
      asas:       data.asas       || '',
    },
    created: Date.now(),
  };
  if (isSafeUrl(data.sourceUrl)) item.sourceUrl = data.sourceUrl;
  items.push(item);
  saveWishlist(items);
  return item;
}

export function updateWishlistItem(id, changes) {
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

export function deleteWishlistItem(id) {
  addTombstone('wishlist', id);
  saveWishlist(getWishlist().filter(i => i.id !== id));
}

export function promoteWishlistToCollection(id) {
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
    sourceUrl: item.sourceUrl || '',
  };
}

