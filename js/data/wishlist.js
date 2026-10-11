/**
 * data/wishlist.js — Wishlist, stored in localStorage.
 */
import { addTombstone, isSafeUrl } from './merge.js';
import { changed, notify, readJSON } from './persist.js';

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
  changed();
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
