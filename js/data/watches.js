/**
 * data/watches.js — The collection: load/save the metadata in localStorage, CRUD, wearing now, and helpers used by the cloud copy.
 */
import { addTombstone, isSafePhoto } from './merge.js';
import { changed, notify, readJSON, requestPersistence, storageRecovered } from './persist.js';
import { compressPhoto, idbDeletePhoto, idbGetAllPhotos, idbSavePhoto, loadPhotoIndex } from './photos.js';

export const DB_KEY   = 'horlogerie_v3';     // localStorage key for metadata

/** @type {Watch[]} */
export let watches = [];
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
  changed();
}

/* ─── Photos: object URLs for the screen (they stay in IndexedDB as Blobs) ─── */
export async function loadPhotos() {
  watches.forEach(w => { delete w.photo; });
  await loadPhotoIndex();
}
/* ─── CRUD ─── */
export function getWatches() { return watches; }
/** @param {string} id @returns {Watch | null} */
export function getWatch(id) { return watches.find(w => w.id === id) || null; }

/** @param {Partial<Watch> & { brand: string, model: string }} data @returns {Promise<Watch>} */
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
  }
  watches.push(w);
  save();
  requestPersistence();
  return w;
}
/** @param {string} id @param {Partial<Watch>} changes @returns {Promise<Watch | null>} */
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
    } else {
      await idbDeletePhoto(id);
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

/** @returns {Watch | null} */
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
/* Only one watch can be "on the wrist" at a time */
export function enforceSingleActive(list) {
  const active = list.filter(w => w.wearStart).sort((a, b) => b.wearStart - a.wearStart);
  active.slice(1).forEach(w => { w.wearStart = null; });
  return list;
}

// Load the collection as soon as the module is imported
loadData();
