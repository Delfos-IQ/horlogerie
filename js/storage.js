/**
 * storage.js — the data layer, one import for the rest of the app.
 *
 * Metadata in localStorage, photos in IndexedDB. Split by topic in js/data/:
 *   persist  safe reads, persistence, hooks to the UI and the cloud
 *   photos   IndexedDB and compression
 *   watches  the collection (CRUD, wearing now)
 *   wear     days worn, stats, maintenance, add/remove days
 *   merge    sanitizing, tombstones, merging with the cloud
 *   backup   JSON backups
 *   wishlist the wishlist
 *   care     Rotor Pro: maintenance log, accuracy, straps, collection value
 */
export * from './data/persist.js';
export * from './data/photos.js';
export * from './data/watches.js';
export * from './data/wear.js';
export * from './data/merge.js';
export * from './data/backup.js';
export * from './data/wishlist.js';
export * from './data/care.js';
