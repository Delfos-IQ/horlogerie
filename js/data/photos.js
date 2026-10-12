/**
 * data/photos.js — Photos in IndexedDB (one record per watch) and compression to WebP/JPEG.
 *
 * Since v2.16 each photo is stored as a Blob, not as base64 text (a third smaller,
 * and out of the JavaScript heap). Watch objects never carry the photo: the screen
 * shows it through an object URL (photoSrc), and the cloud and the backups ask for
 * the data URL only when they need it (getPhotoDataUrl / idbGetAllPhotos).
 *
 * Record: { id, blob, tag }   tag = first 16 hex of SHA-256 of the data URL, so the
 * cloud can tell whether a photo changed without reading it (same value the cloud
 * code computed before v2.16: no photo is uploaded again after the update).
 * Records from older versions ({ id, photo: 'data:…' }) are converted on first load.
 */

export const IDB_NAME = 'horlogerie_photos'; // IndexedDB database name
export const IDB_STORE = 'photos';           // object store name
export const IDB_VER  = 1;
export let _idb    = null;  // IndexedDB connection

/** id → object URL of the photo shown on screen */
const urls = new Map();
/** id → tag, kept in step with the records */
const tags = new Map();

/* ─── IndexedDB ─── */
export function openIDB() {
  if (_idb) return Promise.resolve(_idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => { _idb = req.result; resolve(_idb); };
    req.onerror   = () => reject(req.error);
  });
}
function tx(mode, fn) {
  return openIDB().then(db => new Promise((res, rej) => {
    const t = db.transaction(IDB_STORE, mode);
    const out = fn(t.objectStore(IDB_STORE));
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
  }));
}

/* ─── Conversions (no fetch: the CSP does not allow fetching data: URLs) ─── */
export function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
export async function photoTagOf(dataUrl) {
  if (!dataUrl) return '';
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
function setUrl(id, blob) {
  const old = urls.get(id);
  if (old) URL.revokeObjectURL(old);
  if (blob) urls.set(id, URL.createObjectURL(blob)); else urls.delete(id);
}

/* ─── Public API ─── */
/** Object URL to show the photo of a watch, or null */
export function photoSrc(id) { return urls.get(id) || null; }

/** @param {string} id @param {string} dataUrl */
export async function idbSavePhoto(id, dataUrl) {
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) return;
  try {
    const tag = await photoTagOf(dataUrl);
    await tx('readwrite', s => s.put({ id, blob, tag }));
    tags.set(id, tag);
    setUrl(id, blob);
  } catch (e) { console.warn('IDB save failed:', e); }
}

export async function idbDeletePhoto(id) {
  try { await tx('readwrite', s => s.delete(id)); } catch {}
  tags.delete(id);
  setUrl(id, null);
}

/** Raw records, converting old base64 ones to Blob on the way */
async function records() {
  let all = [];
  try { all = await tx('readonly', s => s.getAll()) || []; } catch { return []; }
  const out = [];
  for (const r of all) {
    if (r?.blob instanceof Blob) { out.push(r); continue; }
    if (typeof r?.photo === 'string') {               // record from before v2.16
      const blob = dataUrlToBlob(r.photo);
      if (!blob) continue;
      const rec = { id: r.id, blob, tag: await photoTagOf(r.photo) };
      try { await tx('readwrite', s => s.put(rec)); } catch {}
      out.push(rec);
    }
  }
  return out;
}

/** At start: object URLs and tags for every stored photo */
export async function loadPhotoIndex() {
  const recs = await records();
  for (const r of recs) { tags.set(r.id, r.tag || ''); if (!urls.has(r.id)) setUrl(r.id, r.blob); }
  return recs.length;
}

/** id → tag of every stored photo (cheap: no photo is read) */
export function photoTags() { return new Map(tags); }

/** The photo as a data URL (for the cloud, backups and the PDF), or null */
export async function getPhotoDataUrl(id) {
  try {
    const r = await tx('readonly', s => s.get(id));
    if (r?.blob instanceof Blob) return await blobToDataUrl(r.blob);
    return typeof r?.photo === 'string' ? r.photo : null;
  } catch { return null; }
}

/** Every photo as { id, photo: dataUrl } (backups and the old cloud protocol) */
export async function idbGetAllPhotos() {
  const recs = await records();
  return Promise.all(recs.map(async r => ({ id: r.id, photo: await blobToDataUrl(r.blob) })));
}

/* ─── Photo compression → WebP ─── */
/**
 * Compresses a photo to a target suitable for cloud sync.
 * maxDim 600px × quality 0.72 → ~40-60KB per photo.
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
