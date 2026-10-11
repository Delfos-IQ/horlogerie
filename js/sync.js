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

const SYNC_META_KEY = 'horlogerie_session_v1';
const SYNC_EL       = 'sync-status-indicator';
const USER_HEADER   = 'X-Horlogerie-User';
const CLOUD_LIMIT   = 3 * 1024 * 1024;   // must match MAX_SYNC_PAYLOAD in the Worker

/* ════════════════════════════════════════
   META + SESSION ID
════════════════════════════════════════ */
function getSyncMeta() {
  try { return JSON.parse(localStorage.getItem(SYNC_META_KEY) || '{}'); } catch { return {}; }
}
function setSyncMeta(d) {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify({ ...getSyncMeta(), ...d }));
  } catch (e) {
    if (typeof showToast === 'function') showToast('⚠️ No se pudo guardar la sesión localmente');
  }
}

function newUUID() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

/* Short recovery key (Worker v13+): 16 Crockford base32 characters, 80 bits,
   shown in groups of four: 7KQ2-M4XR-9TBW-2HNF */
const KEY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SHORT_KEY_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;
const UUID_KEY_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function newShortKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map(b => KEY_ALPHABET[b & 31]).join('');   // 32 symbols → 5 bits each, no bias
  return chars.match(/.{4}/g).join('-');
}
function isShortKey(k) { return SHORT_KEY_RE.test(k || ''); }

/**
 * Turn whatever the user typed into a session key, or null.
 * Accepts the short key with or without dashes/spaces, lower case and the
 * usual look-alikes (O→0, I/L→1), and old UUID keys.
 */
function normalizeKey(input) {
  const raw = String(input || '').trim();
  if (UUID_KEY_RE.test(raw)) return raw.toLowerCase();
  const c = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(c)) return null;
  return c.match(/.{4}/g).join('-');
}
/** 6-character linking code typed by the user, or null */
function normalizePairCode(input) {
  const c = String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return /^[2-9A-HJKMNP-Z]{6}$/.test(c) ? c : null;
}
window.normalizeKey = normalizeKey;
window.normalizePairCode = normalizePairCode;
window.isShortKey = isShortKey;

function getSessionId() {
  const meta = getSyncMeta();
  if (meta.userId) return meta.userId;
  const id = newUUID();
  setSyncMeta({ userId: id });
  return id;
}

/** Cloud on/off. Installs that already synced before this version stay on. */
function isCloudEnabled() {
  const m = getSyncMeta();
  return typeof m.cloudEnabled === 'boolean' ? m.cloudEnabled : !!m.lastPush;
}

/** Ids known to be in the cloud after the last successful sync */
function getSyncedIds(meta = getSyncMeta()) {
  if (Array.isArray(meta.syncedIds)) return meta.syncedIds;
  return Object.keys(meta.watchHashes || {});   // migration from v2.1
}

/* ════════════════════════════════════════
   WORKER API
════════════════════════════════════════ */
let _capsPromise = null;
/** Ask the Worker what it supports (v11+: user id in header, wishlist in cloud) */
function workerCaps() {
  if (!_capsPromise) {
    _capsPromise = fetch(`${CONFIG.WORKER_URL}/health`)
      .then(r => r.ok ? r.json() : {})
      .then(h => {
        const major = parseInt(String(h.version || '0'), 10);
        return { userHeader: major >= 11, wishlist: major >= 11, version: h.version || '?',
                 importUrl: !!h.caps?.importUrl, importText: !!h.caps?.importText,
                 shortKey: !!h.caps?.shortKey, pairing: !!h.caps?.pairing, importSource: !!h.caps?.importSource };
      })
      .catch(() => { _capsPromise = null; return { userHeader: false, wishlist: false, version: null }; });
  }
  return _capsPromise;
}

/**
 * fetch() against the Worker with the session id attached the safest way the
 * Worker supports. `userId` defaults to the current session.
 */
async function syncApi(path, { method = 'GET', body = null, userId = getSessionId() } = {}) {
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
function setSyncUI(state, msg) {
  setSyncMeta({ lastState: state, lastStateMsg: msg || '', ...(state === 'ok' ? { lastSyncAt: Date.now() } : {}) });
  // The header only shows the cloud when something is wrong; the rest lives in Ajustes
  const el = document.getElementById(SYNC_EL);
  if (el) {
    el.hidden = state !== 'error';
    el.title  = msg || '';
    el.setAttribute('aria-label', `Problema con la copia en la nube${msg ? ': ' + msg : ''}. Ver en Ajustes`);
  }
  if (typeof renderSystemStatus === 'function' && document.getElementById('view-settings')?.classList.contains('active')) {
    renderSystemStatus();
  }
}

/* ════════════════════════════════════════
   HASHES — skip unchanged items on push
════════════════════════════════════════ */
async function shortHash(s) {
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  } catch {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(16);
  }
}
function hashWatch(w) {
  return shortHash(JSON.stringify({
    brand: w.brand, model: w.model, ref: w.ref, type: w.type,
    notes: w.notes, specs: w.specs, price: w.price,
    wearStart: w.wearStart, history: w.history, updatedAt: w.updatedAt,
  }));
}
function hashPhoto(dataUrl) {
  return dataUrl ? shortHash(dataUrl.length + ':' + dataUrl.slice(0, 2000) + dataUrl.slice(-2000)) : Promise.resolve(null);
}

/* ════════════════════════════════════════
   PUSH
════════════════════════════════════════ */
let _pushQueue = Promise.resolve();
function syncPush(forceFull = false) {
  // Serialize pushes: each call waits for the previous one to finish
  const p = _pushQueue.then(() => _syncPush(forceFull));
  _pushQueue = p.catch(() => {});
  return p;
}

async function _syncPush(forceFull) {
  if (!isCloudEnabled()) { setSyncUI('off', 'Copia en la nube desactivada'); return false; }
  setSyncUI('syncing', 'Guardando en la nube…');
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
      setSyncUI('ok', `Al día · ${new Date(meta.lastPush).toLocaleTimeString('es-ES')}`);
      return true;
    }

    const body = { watches: changed, mode: full ? 'full' : 'diff', deletedIds, wishlist: wl };
    const size = JSON.stringify(body).length;
    if (size > CLOUD_LIMIT) {
      const mb = (size / 1024 / 1024).toFixed(1);
      showToast(`⚠️ La colección ocupa ${mb} MB y la nube admite 3 MB. Haz una copia JSON: tus datos siguen en este dispositivo.`, 6000);
      throw new Error(`Colección demasiado grande para la nube (${mb} MB)`);
    }

    const res = await syncApi('/sync/push', { method: 'POST', body });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 413) showToast('⚠️ La nube está llena (máx. 3 MB). Tus datos siguen en este dispositivo.', 6000);
      throw new Error(err.error || `HTTP ${res.status}`);
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

    const label = data.mode === 'diff' ? `${data.changed} cambio(s)` : `${data.count} reloj(es)`;
    const kb = data.sizeBytes ? ` · ${(data.sizeBytes / 1024).toFixed(0)} KB` : '';
    setSyncUI('ok', `Guardado · ${label}${kb} · ${new Date(data.updatedAt).toLocaleTimeString('es-ES')}`);
    return true;

  } catch (e) {
    setSyncUI('error', e.message);
    console.warn('[sync] push failed:', e.message);
    return false;
  }
}

/* ════════════════════════════════════════
   PULL — merge cloud into local, then push the merged result
════════════════════════════════════════ */
async function syncPull(silent = false) {
  if (!isCloudEnabled()) { setSyncUI('off', 'Copia en la nube desactivada'); return false; }
  if (!silent) setSyncUI('syncing', 'Descargando…');
  try {
    const res = await syncApi('/sync/pull');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const meta = getSyncMeta();

    const cloudWatches = Array.isArray(data.watches) ? data.watches : [];
    if (!data.exists && !cloudWatches.length) {
      // Nothing in the cloud yet: upload what we have
      if (getWatches().length || getWishlist().length) await syncPush(true);
      else setSyncUI('idle', 'Sin datos en la nube');
      return false;
    }

    const cloudTs = data.updatedAt || 0;
    if (cloudTs <= (meta.lastPush || 0)) {
      setSyncUI('ok', 'Ya estás al día');
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
    await syncPush(true);

    if (!silent) {
      const s = mw.stats;
      const extra = s.droppedLocal ? ` · ${s.droppedLocal} borrado(s) en otro dispositivo` : '';
      showToast(`Colección sincronizada${extra}`);
    }
    return true;

  } catch (e) {
    if (!silent) setSyncUI('error', e.message);
    console.warn('[sync] pull failed:', e.message);
    return false;
  }
}

/* ════════════════════════════════════════
   SESSION MANAGEMENT
════════════════════════════════════════ */

/** Use the collection of another device. Local watches are merged in, not lost. */
async function importSession(userId) {
  setSyncUI('syncing', 'Verificando sesión…');
  try {
    const res = await syncApi('/sync/exists', { userId });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.exists) throw new Error('Sesión no encontrada. Comprueba el ID.');
    setSyncMeta({ userId, cloudEnabled: true, lastPush: 0, watchHashes: {}, photoHashes: {},
                  wishlistHash: null, syncedIds: [], syncedWishlistIds: [], keySavedAt: Date.now() });
    await syncPull(false);
    showToast('Sesión importada correctamente');
    return true;
  } catch (e) {
    setSyncUI('error', e.message);
    showToast('Error: ' + e.message);
    return false;
  }
}

/** Turn the cloud copy on/off. Turning it off keeps whatever is in the cloud. */
async function setCloudEnabled(on) {
  setSyncMeta({ cloudEnabled: !!on });
  if (!on) { setSyncUI('off', 'Copia en la nube desactivada'); return true; }
  const m = getSyncMeta();
  if (!m.lastPush && !isShortKey(m.userId) && (await workerCaps()).shortKey) {
    setSyncMeta({ userId: newShortKey(), keySavedAt: null });   // never used: nothing to migrate
  }
  getSessionId();
  const pulled = await syncPull(false);
  if (!pulled) await syncPush(true);
  return true;
}

/**
 * New secret key: upload everything under a new id, then delete the old copy.
 * Other devices must import the new id afterwards.
 */
async function rotateSessionKey() {
  if (!isCloudEnabled()) throw new Error('Activa la copia en la nube primero');
  const oldId = getSessionId();
  const newId = (await workerCaps()).shortKey ? newShortKey() : newUUID();
  const ws = await getWatchesWithPhotos();
  const wl = getWishlist();
  const res = await syncApi('/sync/push', { method: 'POST', userId: newId,
    body: { watches: ws, mode: 'full', deletedIds: [], wishlist: wl } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  const data = await res.json();
  setSyncMeta({ userId: newId, lastPush: data.updatedAt, watchHashes: {}, photoHashes: {}, keySavedAt: null,
                wishlistHash: null, syncedIds: ws.map(w => w.id), syncedWishlistIds: wl.map(i => i.id) });
  await syncApi('/sync/clear', { method: 'DELETE', userId: oldId }).catch(() => {});
  return newId;
}

/** Delete this collection from the cloud and turn the cloud copy off. Local data stays. */
async function deleteCloudData() {
  const res = await syncApi('/sync/clear', { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  setSyncMeta({ userId: newUUID(), cloudEnabled: false, lastPush: 0, watchHashes: {}, photoHashes: {},
                wishlistHash: null, syncedIds: [], syncedWishlistIds: [], keySavedAt: null });
  setSyncUI('off', 'Copia en la nube desactivada');
  return true;
}

/* ════════════════════════════════════════
   DEVICE LINKING (Worker v13+)
════════════════════════════════════════ */
/** Ask the Worker for a one-use 6-character code pointing to this session (10 min) */
async function pairCreate() {
  if (!(await workerCaps()).pairing) throw new Error('El servidor aún no admite códigos de vinculación');
  if (!getSyncMeta().lastPush) await syncPush(true);
  let res = await syncApi('/pair/create', { method: 'POST', body: {} });
  if (res.status === 404) {             // no copy under this key yet (or it was deleted): upload, then retry
    await syncPush(true);
    res = await syncApi('/pair/create', { method: 'POST', body: {} });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;   // { code, expiresAt }
}

/** Swap a linking code for the session id and use that session here */
async function pairClaim(code) {
  const res = await fetch(`${CONFIG.WORKER_URL}/pair/claim`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) throw new Error('Demasiados intentos. Prueba dentro de una hora.');
  if (!res.ok || !data.userId) throw new Error(data.error || 'Código no válido o caducado');
  return importSession(data.userId);
}
window.pairCreate = pairCreate;
window.pairClaim  = pairClaim;

/* ════════════════════════════════════════
   AUTO + MANUAL
════════════════════════════════════════ */
async function syncAuto() {
  getSessionId();
  let _t = null;
  window._debouncedPush = () => {
    if (!isCloudEnabled()) return;
    clearTimeout(_t); _t = setTimeout(() => syncPush(), 3000);
  };
  window.addEventListener('online', () => { if (isCloudEnabled()) syncPush(); });

  if (!isCloudEnabled()) { setSyncUI('off', 'Copia en la nube desactivada'); return; }
  const pulled = await syncPull(true);
  if (pulled) {
    renderHome();
    if (typeof renderSettings === 'function') renderSettings();
    if (typeof renderWishlist === 'function') renderWishlist();
  } else {
    await syncPush();   // uploads anything changed while offline
  }
}

async function syncManual() {
  if (!isCloudEnabled()) {
    showToast('La copia en la nube está desactivada. Puedes activarla en Ajustes.');
    return;
  }
  setSyncUI('syncing', 'Sincronizando…');
  const pulled = await syncPull(false);
  if (pulled) {
    renderHome();
    if (typeof renderSettings === 'function') renderSettings();
    if (typeof renderWishlist === 'function') renderWishlist();
  } else {
    const ok = await syncPush();
    showToast(ok ? 'Sincronización completada' : 'No se pudo sincronizar. Lo reintentaré al volver la conexión.');
  }
}

window.syncPush         = syncPush;
window.syncPull         = syncPull;
window.syncAuto         = syncAuto;
window.syncManual       = syncManual;
window.syncApi          = syncApi;
window.workerCaps       = workerCaps;
window.getSessionId     = getSessionId;
window.getSyncMeta      = getSyncMeta;
window.isCloudEnabled   = isCloudEnabled;
window.setCloudEnabled  = setCloudEnabled;
window.importSession    = importSession;
window.rotateSessionKey = rotateSessionKey;
window.deleteCloudData  = deleteCloudData;
