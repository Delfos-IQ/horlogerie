/**
 * data/photos.js — Photos in IndexedDB (one record per watch) and compression to WebP/JPEG.
 */

export const IDB_NAME = 'horlogerie_photos'; // IndexedDB database name
export const IDB_STORE = 'photos';           // object store name
export const IDB_VER  = 1;
export let _idb    = null;  // IndexedDB connection

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
