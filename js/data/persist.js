/**
 * data/persist.js — Local storage helpers: safe JSON reads that never lose data, persistence request, and the hooks that connect the data layer with the UI and the cloud.
 */

/* The data layer has no UI dependencies (it also runs in the Node tests): the
   app plugs in its toast with setNotifier() and the cloud upload with setOnChange(). */
/** @type {(msg: string) => void} */
let _notify = () => {};
/** @param {(msg: string) => void} fn */
export function setNotifier(fn) { _notify = typeof fn === 'function' ? fn : () => {}; }
/** @param {string} msg */
export function notify(msg) { _notify(msg); }
let _onChange = () => {};
export function setOnChange(fn) { _onChange = typeof fn === 'function' ? fn : () => {}; }
/** Called after every local change */
export function changed() { _onChange(); }
/* ─── Metadata (localStorage) ─── */
/**
 * Read JSON from localStorage without ever losing data: if the stored text
 * can't be parsed (or has the wrong shape), it is copied untouched to
 * `<key>_corrupt_<date>` before the app starts with the fallback, so the next
 * save can't overwrite the only copy. The UI is told via `storageRecovered`.
 */
export const storageRecovered = [];
/**
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @param {(v: any) => boolean} [isValid]
 * @returns {T}
 */
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
