/**
 * sync.js v5 — Optional per-user cloud sync
 *
 * Architecture:
 *   - The cloud copy is OPTIONAL. New installs start with it off; installs that
 *     already synced before v2.2 keep it on (migration).
 *   - Pull MERGES cloud and local item by item (mergeById in storage.js):
 *     the most recently modified copy wins, deletions travel as tombstones.
 *     After a merge the merged result is pushed in full.
 *   - Push is differential: only changed watches + ids deleted here.
 *     The wishlist travels whole (it is small).
 *   - The session id is a secret. With Worker v11+ it travels in a header,
 *     never in the URL. Older Workers still get it as ?userId= (fallback).
 */

import { setOnChange, applyWatchList, clearTombstones, enforceSingleActive, getTombstones, getWatches, getWatchesWithPhotos, getWishlist, mergeById, readJSON, sanitizeWatch, sanitizeWishlistItem, setWishlistSilently } from './storage.js';
import { CONFIG, apiError, errText } from './api.js';
import { sync2, account2, delete2, forgetKey, pairCreate2, pairClaim2 } from './cloud2.js';
import { showToast } from './modules/core.js';
import { locale, t } from './i18n.js';
import { renderHome } from './modules/home-detail.js';
import { renderSettings, renderSystemStatus } from './modules/settings.js';
import { renderWishlist } from './modules/wishlist.js';

export const SYNC_META_KEY = 'horlogerie_session_v1';
export const SYNC_EL       = 'sync-status-indicator';
export const USER_HEADER   = 'X-Horlogerie-User';
export const CLOUD_LIMIT   = 3 * 1024 * 1024;   // must match MAX_SYNC_PAYLOAD in the Worker

/* ════════════════════════════════════════
   META + SESSION ID
════════════════════════════════════════ */
export function getSyncMeta() {
  return readJSON(SYNC_META_KEY, {}, v => v && typeof v === 'object' && !Array.isArray(v));
}
export function setSyncMeta(d) {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify({ ...getSyncMeta(), ...d }));
  } catch (e) {
    if (typeof showToast === 'function') showToast(t('No se pudo guardar la sesión en este dispositivo'));
  }
}

export function newUUID() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

/* Short recovery key (Worker v13+): 16 Crockford base32 characters, 80 bits,
   shown in groups of four: 7KQ2-M4XR-9TBW-2HNF */
export const KEY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const SHORT_KEY_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;
export const UUID_KEY_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newShortKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map(b => KEY_ALPHABET[b & 31]).join('');   // 32 symbols → 5 bits each, no bias
  return chars.match(/.{4}/g).join('-');
}
export function isShortKey(k) { return SHORT_KEY_RE.test(k || ''); }

/**
 * Turn whatever the user typed into a session key, or null.
 * Accepts the short key with or without dashes/spaces, lower case and the
 * usual look-alikes (O→0, I/L→1), and old UUID keys.
 */
export function normalizeKey(input) {
  const raw = String(input || '').trim();
  if (UUID_KEY_RE.test(raw)) return raw.toLowerCase();
  const c = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(c)) return null;
  return c.match(/.{4}/g).join('-');
}
/** 6-character linking code typed by the user, or null */
export function normalizePairCode(input) {
  const c = String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return /^[2-9A-HJKMNP-Z]{6}$/.test(c) ? c : null;
}
export function getSessionId() {
  const meta = getSyncMeta();
  if (meta.userId) return meta.userId;
  const id = newUUID();
  setSyncMeta({ userId: id });
  return id;
}

/** Cloud on/off. Installs that already synced before this version stay on. */
export function isCloudEnabled() {
  const m = getSyncMeta();
  return typeof m.cloudEnabled === 'boolean' ? m.cloudEnabled : !!m.lastPush;
}

/** Ids known to be in the cloud after the last successful sync */
export function getSyncedIds(meta = getSyncMeta()) {
  if (Array.isArray(meta.syncedIds)) return meta.syncedIds;
  return Object.keys(meta.watchHashes || {});   // migration from v2.1
}

/* ════════════════════════════════════════
   WORKER API
════════════════════════════════════════ */
export let _capsPromise = null;
/** Ask the Worker what it supports (v11+: user id in header, wishlist in cloud) */
export function workerCaps() {
  if (!_capsPromise) {
    _capsPromise = fetch(`${CONFIG.WORKER_URL}/health`)
      .then(r => r.ok ? r.json() : {})
      .then(h => {
        const major = parseInt(String(h.version || '0'), 10);
        return { userHeader: major >= 11, wishlist: major >= 11, version: h.version || '?',
                 importUrl: !!h.caps?.importUrl, importText: !!h.caps?.importText,
                 shortKey: !!h.caps?.shortKey, pairing: !!h.caps?.pairing, importSource: !!h.caps?.importSource,
                 v2: !!h.caps?.v2, pairingV2: !!h.caps?.pairingV2 };
      })
      .catch(() => { _capsPromise = null; return { userHeader: false, wishlist: false, version: null }; });
  }
  return _capsPromise;
}

/**
 * fetch() against the Worker with the session id attached the safest way the
 * Worker supports. `userId` defaults to the current session.
 */
export async function syncApi(path, { method = 'GET', body = null, userId = getSessionId() } = {}) {
  const caps    = await workerCaps();
  const headers = {};
  let url = `${CONFIG.WORKER_URL}${path}`;
  if (caps.userHeader) headers[USER_HEADER] = userId;
  else if (method !== 'POST') url += `${url.includes('?') ? '&' : '?'}userId=${encodeURIComponent(userId)}`;
  if (body !== null) headers['Content-Type'] = 'application/json';
  return fetch(url, { method, headers, body: body === null ? undefined : JSON.stringify({ userId, ...body }) });
}

/* ════════════════════════════════════════
   UI
════════════════════════════════════════ */
export function setSyncUI(state, msg) {
  setSyncMeta({ lastState: state, lastStateMsg: msg || '', ...(state === 'ok' ? { lastSyncAt: Date.now() } : {}) });
  // The header only shows the cloud when something is wrong; the rest lives in Ajustes
  const el = document.getElementById(SYNC_EL);
  if (el) {
    el.hidden = state !== 'error';
    el.title  = msg || '';
    el.setAttribute('aria-label', t('Problema con la copia en la nube') + (msg ? ': ' + msg : '') + '. ' + t('Ver en Ajustes'));
  }
  if (typeof renderSystemStatus === 'function' && document.getElementById('view-settings')?.classList.contains('active')) {
    renderSystemStatus();
  }
}

/* ════════════════════════════════════════
   HASHES — skip unchanged items on push
════════════════════════════════════════ */
export async function shortHash(s) {
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  } catch {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(16);
  }
}
export function hashWatch(w) {
  return shortHash(JSON.stringify({
    brand: w.brand, model: w.model, ref: w.ref, type: w.type,
    notes: w.notes, specs: w.specs, price: w.price,
    wearStart: w.wearStart, history: w.history, updatedAt: w.updatedAt,
  }));
}
export function hashPhoto(dataUrl) {
  return dataUrl ? shortHash(dataUrl.length + ':' + dataUrl.slice(0, 2000) + dataUrl.slice(-2000)) : Promise.resolve(null);
}

/* ════════════════════════════════════════
   PUSH
════════════════════════════════════════ */
export let _pushQueue = Promise.resolve();
export function syncPushV1(forceFull = false) {
  // Serialize pushes: each call waits for the previous one to finish
  const p = _pushQueue.then(() => _syncPush(forceFull));
  _pushQueue = p.catch(() => {});
  return p;
}

export async function _syncPush(forceFull) {
  if (!isCloudEnabled()) { setSyncUI('off', t('Copia en la nube desactivada')); return false; }
  setSyncUI('syncing', t('Guardando en la nube…'));
  try {
    const meta  = getSyncMeta();
    const ws    = await getWatchesWithPhotos();
    const wl    = getWishlist();
    const tomb  = getTombstones();

    const prevHashes = meta.watchHashes || {};
    const prevPhotos = meta.photoHashes || {};
    const currentHashes = {}, currentPhotos = {};
    for (const w of ws) {
      currentHashes[w.id] = await hashWatch(w);
      currentPhotos[w.id] = await hashPhoto(w.photo);
    }
    const wlHash = await shortHash(JSON.stringify(wl));

    const localIds   = new Set(ws.map(w => w.id));
    const deletedIds = [...new Set([
      ...tomb.watches,
      ...Object.keys(prevHashes).filter(id => !localIds.has(id)),
    ])].filter(id => !localIds.has(id));

    const full = forceFull || !meta.lastPush;
    const changed = full ? ws : ws.filter(w =>
      currentHashes[w.id] !== prevHashes[w.id] || currentPhotos[w.id] !== prevPhotos[w.id]);
    const wishlistChanged = wlHash !== meta.wishlistHash || tomb.wishlist.length > 0;

    if (!full && !changed.length && !deletedIds.length && !wishlistChanged) {
      setSyncUI('ok', `${t('Al día')} · ${new Date(meta.lastPush).toLocaleTimeString(locale())}`);
      return true;
    }

    const body = { watches: changed, mode: full ? 'full' : 'diff', deletedIds, wishlist: wl };
    const size = JSON.stringify(body).length;
    if (size > CLOUD_LIMIT) {
      const mb = (size / 1024 / 1024).toFixed(1);
      showToast(t('La colección ocupa {mb} MB y la nube admite 3 MB. Haz una copia JSON: tus datos siguen en este dispositivo.', { mb }), 6000);
      throw new Error(t('Colección demasiado grande para la nube ({mb} MB)', { mb }));
    }

    const res = await syncApi('/sync/push', { method: 'POST', body });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 413) showToast(t('La nube está llena (máx. 3 MB). Tus datos siguen en este dispositivo.'), 6000);
      throw new Error(apiError(err) || `HTTP ${res.status}`);
    }
    const data = await res.json();

    setSyncMeta({
      lastPush:          data.updatedAt,
      watchHashes:       currentHashes,
      photoHashes:       currentPhotos,
      wishlistHash:      wlHash,
      syncedIds:         ws.map(w => w.id),
      syncedWishlistIds: wl.map(i => i.id),
    });
    clearTombstones('watches', deletedIds);
    clearTombstones('wishlist', tomb.wishlist);

    const label = data.mode === 'diff' ? t('{n} cambio(s)', { n: data.changed }) : t('{n} reloj(es)', { n: data.count });
    const kb = data.sizeBytes ? ` · ${(data.sizeBytes / 1024).toFixed(0)} KB` : '';
    setSyncUI('ok', `${t('Guardado')} · ${label}${kb} · ${new Date(data.updatedAt).toLocaleTimeString(locale())}`);
    return true;

  } catch (e) {
    setSyncUI('error', errText(e));
    console.warn('[sync] push failed:', e.message);
    return false;
  }
}

/* ════════════════════════════════════════
   PULL — merge cloud into local, then push the merged result
════════════════════════════════════════ */
export async function syncPullV1(silent = false) {
  if (!isCloudEnabled()) { setSyncUI('off', t('Copia en la nube desactivada')); return false; }
  if (!silent) setSyncUI('syncing', t('Descargando…'));
  try {
    const res = await syncApi('/sync/pull');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const meta = getSyncMeta();

    const cloudWatches = Array.isArray(data.watches) ? data.watches : [];
    if (!data.exists && !cloudWatches.length) {
      // Nothing in the cloud yet: upload what we have
      if (getWatches().length || getWishlist().length) await syncPushV1(true);
      else setSyncUI('idle', t('Sin datos en la nube'));
      return false;
    }

    const cloudTs = data.updatedAt || 0;
    if (cloudTs <= (meta.lastPush || 0)) {
      setSyncUI('ok', t('Ya estás al día'));
      return false;
    }

    // ── Merge watches ──
    const tomb   = getTombstones();
    const local  = await getWatchesWithPhotos();
    const cloud  = cloudWatches.map(sanitizeWatch).filter(Boolean);
    const mw     = mergeById(local, cloud, getSyncedIds(meta), tomb.watches);
    await applyWatchList(enforceSingleActive(mw.items));

    // ── Merge wishlist (only Workers v11+ store it) ──
    if (Array.isArray(data.wishlist)) {
      const cloudWl = data.wishlist.map(sanitizeWishlistItem).filter(Boolean);
      const ml = mergeById(getWishlist(), cloudWl, meta.syncedWishlistIds || [], tomb.wishlist);
      setWishlistSilently(ml.items);
    }

    // Cloud state is now known: next push must send the merged result in full
    setSyncMeta({ lastPush: cloudTs, watchHashes: {}, photoHashes: {}, wishlistHash: null,
                  syncedIds: cloud.map(w => w.id) });
    await syncPushV1(true);

    if (!silent) {
      const s = mw.stats;
      const extra = s.droppedLocal ? ' · ' + t('{n} borrado(s) en otro dispositivo', { n: s.droppedLocal }) : '';
      showToast(t('Colección sincronizada') + extra);
    }
    return true;

  } catch (e) {
    if (!silent) setSyncUI('error', errText(e));
    console.warn('[sync] pull failed:', e.message);
    return false;
  }
}

/* ════════════════════════════════════════
   SESSION MANAGEMENT
════════════════════════════════════════ */

/** Use the collection of another device. Local watches are merged in, not lost. */
export async function importSessionV1(userId) {
  setSyncUI('syncing', t('Verificando sesión…'));
  try {
    const res = await syncApi('/sync/exists', { userId });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.exists) throw new Error(t('Sesión no encontrada. Comprueba el ID.'));
    setSyncMeta({ userId, cloudEnabled: true, lastPush: 0, watchHashes: {}, photoHashes: {},
                  wishlistHash: null, syncedIds: [], syncedWishlistIds: [], keySavedAt: Date.now() });
    await syncPullV1(false);
    showToast(t('Sesión importada correctamente'));
    return true;
  } catch (e) {
    setSyncUI('error', errText(e));
    showToast(t('Error: {e}', { e: errText(e) }));
    return false;
  }
}

/* ════════════════════════════════════════
   CLOUD 2.0 (Worker v14 with D1): end-to-end encrypted, per item.
   When the server offers it, every operation goes through cloud2.js; the
   plain v1 copy is migrated once and deleted. Without it, v1 as before.
════════════════════════════════════════ */
export async function useV2() { return !!(await workerCaps()).v2; }

let _queue = Promise.resolve();
function queued(fn) { const p = _queue.then(fn); _queue = p.catch(() => {}); return p; }

/** One v2 round (upload + download). Migrates a v1 copy the first time. */
async function runV2(full = false) {
  const key = getSessionId();
  const meta = getSyncMeta();
  if (meta.protocol !== 2) {
    // Bring in what the old plain copy has, upload everything encrypted, then delete the plain copy
    const had = await syncApi('/sync/exists').then(r => r.json()).catch(() => ({}));
    if (had.exists) await syncPullV1(true);
    const r = await sync2(key, { full: true });
    if (had.exists) await syncApi('/sync/clear', { method: 'DELETE' }).catch(() => {});
    setSyncMeta({ protocol: 2 });
    return r;
  }
  return sync2(key, { full });
}

async function v2Round(full, silent) {
  if (!silent) setSyncUI('syncing', t('Sincronizando…'));
  try {
    const r = await queued(() => runV2(full));
    setSyncMeta({ lastPush: Date.now() });
    setSyncUI('ok', r.sent || r.received ? `${t('Al día')} · ${t('{s} enviado(s), {r} recibido(s)', { s: r.sent, r: r.received })}` : t('Al día'));
    return r;
  } catch (e) {
    setSyncUI('error', e.status === 403 ? t('La clave no coincide con la copia de la nube') : errText(e));
    console.warn('[sync] v2 failed:', e.message);
    return null;
  }
}

/** Upload changes (and receive any). Returns true when the cloud is up to date. */
export async function syncPush(forceFull = false) {
  if (!isCloudEnabled()) { setSyncUI('off', t('Copia en la nube desactivada')); return false; }
  if (await useV2()) return !!(await v2Round(forceFull, false));
  return syncPushV1(forceFull);
}

/** Receive remote changes. Returns true when something changed locally. */
export async function syncPull(silent = false) {
  if (!isCloudEnabled()) { setSyncUI('off', t('Copia en la nube desactivada')); return false; }
  if (await useV2()) { const r = await v2Round(false, silent); return !!(r && r.received); }
  return syncPullV1(silent);
}

/** Use the collection of another device (or recover after reinstalling). Local watches are merged in. */
export async function importSession(userId) {
  if (!(await useV2())) return importSessionV1(userId);
  setSyncUI('syncing', t('Buscando tu colección…'));
  try {
    const acc = await account2(userId).catch(() => ({ exists: false }));
    if (!acc.exists) {
      // Maybe it is still a plain v1 copy: import it the old way, then migrate
      const v1 = await syncApi('/sync/exists', { userId }).then(r => r.json()).catch(() => ({}));
      if (!v1.exists) throw new Error(t('No hay ninguna colección con esa clave.'));
      setSyncMeta({ userId, cloudEnabled: true, protocol: 1, lastPush: 0, watchHashes: {}, photoHashes: {},
                    wishlistHash: null, syncedIds: [], syncedWishlistIds: [], keySavedAt: Date.now() });
    } else {
      setSyncMeta({ userId, cloudEnabled: true, protocol: 2, lastPush: 0, keySavedAt: Date.now() });
      forgetKey(userId);
    }
    const r = await v2Round(false, true);
    if (!r) throw new Error(getSyncMeta().lastStateMsg || t('No se pudo descargar la colección'));
    showToast(t('Colección recuperada'));
    return true;
  } catch (e) {
    setSyncUI('error', errText(e));
    showToast(errText(e));
    return false;
  }
}

/** Turn the cloud copy on/off. Turning it off keeps whatever is in the cloud. */
export async function setCloudEnabled(on) {
  setSyncMeta({ cloudEnabled: !!on });
  if (!on) { setSyncUI('off', t('Copia en la nube desactivada')); return true; }
  const m = getSyncMeta();
  const caps = await workerCaps();
  if (!m.lastPush && !isShortKey(m.userId) && caps.shortKey) {
    setSyncMeta({ userId: newShortKey(), keySavedAt: null });   // never used: nothing to migrate
  }
  getSessionId();
  if (caps.v2) {
    if (!m.lastPush) setSyncMeta({ protocol: 2 });               // nothing in v1 to bring over
    return !!(await v2Round(true, false));
  }
  const pulled = await syncPullV1(false);
  if (!pulled) await syncPushV1(true);
  return true;
}

/**
 * New secret key: upload everything under the new key, then delete the old copy.
 * Other devices must be linked again afterwards.
 */
export async function rotateSessionKey() {
  if (!isCloudEnabled()) throw new Error(t('Activa la copia en la nube primero'));
  const oldId = getSessionId();
  const caps = await workerCaps();
  const newId = caps.shortKey ? newShortKey() : newUUID();
  if (caps.v2) {
    await queued(() => sync2(newId, { full: true }));
    setSyncMeta({ userId: newId, protocol: 2, keySavedAt: null, lastPush: Date.now() });
    await delete2(oldId).catch(() => {});
    await syncApi('/sync/clear', { method: 'DELETE', userId: oldId }).catch(() => {});
    return newId;
  }
  const ws = await getWatchesWithPhotos();
  const wl = getWishlist();
  const res = await syncApi('/sync/push', { method: 'POST', userId: newId,
    body: { watches: ws, mode: 'full', deletedIds: [], wishlist: wl } });
  if (!res.ok) throw new Error(apiError(await res.json().catch(() => ({}))) || `HTTP ${res.status}`);
  const data = await res.json();
  setSyncMeta({ userId: newId, lastPush: data.updatedAt, watchHashes: {}, photoHashes: {}, keySavedAt: null,
                wishlistHash: null, syncedIds: ws.map(w => w.id), syncedWishlistIds: wl.map(i => i.id) });
  await syncApi('/sync/clear', { method: 'DELETE', userId: oldId }).catch(() => {});
  return newId;
}

/** Delete this collection from the cloud and turn the cloud copy off. Local data stays. */
export async function deleteCloudData() {
  const key = getSessionId();
  if (await useV2()) await delete2(key);
  const res = await syncApi('/sync/clear', { method: 'DELETE' }).catch(() => null);
  if (!(await useV2()) && (!res || !res.ok)) throw new Error(`HTTP ${res?.status || 0}`);
  setSyncMeta({ userId: newUUID(), cloudEnabled: false, protocol: undefined, lastPush: 0, watchHashes: {}, photoHashes: {},
                wishlistHash: null, syncedIds: [], syncedWishlistIds: [], keySavedAt: null });
  setSyncUI('off', t('Copia en la nube desactivada'));
  return true;
}

/** Size and count of the cloud copy, for Ajustes */
export async function cloudInfo() {
  if (await useV2()) {
    const a = await account2(getSessionId()).catch(() => null);
    return a && a.exists ? { exists: true, count: a.count, sizeBytes: a.sizeBytes, e2e: true } : { exists: false, e2e: true };
  }
  const res = await syncApi('/sync/size');
  const d = res.ok ? await res.json() : {};
  return { exists: !!d.exists, count: d.count, sizeBytes: d.sizeBytes, e2e: false, limitBytes: CLOUD_LIMIT };
}

/* ════════════════════════════════════════
   DEVICE LINKING
   v2: the code is made on the device and encrypts the key (cloud2.js);
   v1 (Worker v13): the server keeps the key for 10 minutes under the code.
════════════════════════════════════════ */
/** One-use 6-character code for this key (10 min) → { code, expiresAt } */
export async function pairCreate() {
  const caps = await workerCaps();
  if (caps.v2 && caps.pairingV2) {
    await syncPush();                               // make sure the copy exists and is current
    return pairCreate2(getSessionId());
  }
  if (!caps.pairing) throw new Error(t('El servidor aún no admite códigos de vinculación'));
  if (!getSyncMeta().lastPush) await syncPushV1(true);
  let res = await syncApi('/pair/create', { method: 'POST', body: {} });
  if (res.status === 404) {             // no copy under this key yet (or it was deleted): upload, then retry
    await syncPushV1(true);
    res = await syncApi('/pair/create', { method: 'POST', body: {} });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiError(data) || `HTTP ${res.status}`);
  return data;
}

/** Swap a linking code for the key and use that collection here */
export async function pairClaim(code) {
  const caps = await workerCaps();
  if (caps.v2 && caps.pairingV2) return importSession(await pairClaim2(code));
  const res = await fetch(`${CONFIG.WORKER_URL}/pair/claim`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) throw new Error(t('Demasiados intentos. Prueba dentro de una hora.'));
  if (res.status === 404) throw new Error(t('Este código no es válido, ya se usó o ha caducado. Cada código sirve para un solo dispositivo: genera otro en el dispositivo que ya tiene tu colección.'));
  if (!res.ok || !data.userId) throw new Error(apiError(data) || t('Código no válido o caducado'));
  return importSession(data.userId);
}

/* ════════════════════════════════════════
   AUTO + MANUAL
════════════════════════════════════════ */
export async function syncAuto() {
  getSessionId();
  let _t = null;
  setOnChange(() => {
    if (!isCloudEnabled()) return;
    clearTimeout(_t); _t = setTimeout(() => syncPush(), 3000);
  });
  window.addEventListener('online', () => { if (isCloudEnabled()) syncPush(); });

  if (!isCloudEnabled()) { setSyncUI('off', t('Copia en la nube desactivada')); return; }
  const pulled = await syncPull(true);
  if (await useV2()) {
    if (pulled) { renderHome(); renderSettings(); renderWishlist(); }
    return;
  }
  if (pulled) {
    renderHome();
    if (typeof renderSettings === 'function') renderSettings();
    if (typeof renderWishlist === 'function') renderWishlist();
  } else {
    await syncPush();   // uploads anything changed while offline
  }
}

export async function syncManual() {
  if (!isCloudEnabled()) {
    showToast(t('La copia en la nube está desactivada. Puedes activarla en Ajustes.'));
    return;
  }
  setSyncUI('syncing', t('Sincronizando…'));
  const pulled = await syncPull(false);
  if (await useV2()) {
    if (pulled) { renderHome(); renderSettings(); renderWishlist(); }
    showToast(getSyncMeta().lastState === 'error' ? t('No se pudo sincronizar. Lo reintentaré al volver la conexión.') : t('Sincronización completada'));
    return;
  }
  if (pulled) {
    renderHome();
    if (typeof renderSettings === 'function') renderSettings();
    if (typeof renderWishlist === 'function') renderWishlist();
  } else {
    const ok = await syncPush();
    showToast(ok ? t('Sincronización completada') : t('No se pudo sincronizar. Lo reintentaré al volver la conexión.'));
  }
}

