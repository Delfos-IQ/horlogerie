/**
 * data/backup.js — JSON backups: build and restore (merging, never deleting).
 */
import { mergeById, sanitizeWatch, sanitizeWishlistItem } from './merge.js';
import { applyWatchList, enforceSingleActive, getWatchesWithPhotos, save } from './watches.js';
import { getWishlist, setWishlistSilently } from './wishlist.js';

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
