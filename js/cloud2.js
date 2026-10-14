/**
 * cloud2.js — copia en la nube 2.0: cifrada de extremo a extremo, por elemento.
 *
 * Todo se deriva de la clave de recuperación (K) en el dispositivo, con HKDF:
 *   uid   (128 bits)  nombre de la cuenta en el servidor
 *   auth  (256 bits)  token de escritura; el servidor solo guarda su SHA-256
 *   enc   (AES-GCM 256) cifra cada reloj, deseo y foto
 * El servidor (Worker v14 + D1) solo ve uid, el hash del token y texto cifrado.
 * Cada elemento se cifra con su tipo e id como datos asociados (AAD), así que
 * el servidor no puede cambiar un registro de sitio sin que falle el descifrado.
 *
 * Sincronización: se suben los elementos cuyo sello (updatedAt) cambió desde
 * el último envío y se reciben los que tienen revisión mayor que la última
 * vista. Gana el sello más reciente, elemento a elemento.
 */
import { CONFIG, apiError } from './api.js';
import { t } from './i18n.js';
import {
  getWatches, getWishlist, setWishlistSilently, getTombstones, clearTombstones, getPhotoDataUrl, photoTags,
  sanitizeWatch, sanitizeWishlistItem, itemStamp, enforceSingleActive, applyWatchList, idbDeletePhoto, readJSON,
} from './storage.js';

const META_KEY = 'horlogerie_cloud2_v1';
const enc = new TextEncoder(), dec = new TextDecoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

/* ── Base64 for byte arrays (chunked, works for large photos) ── */
function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64); const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/* ── Keys ── */
const _keys = new Map();
/** Canonical form of a recovery key: UUIDs in lower case, short keys in upper case */
export function canonicalKey(k) { return /^[0-9a-f-]{36}$/i.test(k) ? k.toLowerCase() : String(k).toUpperCase(); }

/** @param {string} key recovery key → { uid, auth, aes } */
export async function deriveKeys(key) {
  const k = canonicalKey(key);
  if (_keys.has(k)) return _keys.get(k);
  const p = (async () => {
    const base = await crypto.subtle.importKey('raw', enc.encode(k), 'HKDF', false, ['deriveBits', 'deriveKey']);
    const params = info => ({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('rotor/v2'), info: enc.encode(info) });
    const uid  = hex(await crypto.subtle.deriveBits(params('id'), base, 128));
    const auth = hex(await crypto.subtle.deriveBits(params('auth'), base, 256));
    const aes  = await crypto.subtle.deriveKey(params('enc'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return { uid, auth, aes };
  })();
  _keys.set(k, p);
  return p;
}

/** AES-GCM with a fresh 96-bit IV; output = base64(iv ‖ ciphertext) */
export async function encryptText(aes, text, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, aes, enc.encode(text)));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return toB64(out);
}
export async function decryptText(aes, b64, aad) {
  const all = fromB64(b64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12), additionalData: enc.encode(aad) }, aes, all.subarray(12));
  return dec.decode(pt);
}

/* ── Network ── */
async function api(path, key, { method = 'GET', body } = {}) {
  const { uid, auth } = await deriveKeys(key);
  const res = await fetch(`${CONFIG.WORKER_URL}${path}`, {
    method,
    headers: { 'X-Rotor-Id': uid, 'X-Rotor-Auth': auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(apiError(data) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ── Local bookkeeping (per key) ── */
function readMeta(key) {
  const all = readJSON(META_KEY, {}, v => v && typeof v === 'object');
  const m = all[canonicalKey(key)] || {};
  return { rev: m.rev || 0, sent: m.sent || {}, photos: m.photos || {} };
}
function writeMeta(key, m) {
  const all = readJSON(META_KEY, {}, v => v && typeof v === 'object');
  all[canonicalKey(key)] = m;
  try { localStorage.setItem(META_KEY, JSON.stringify(all)); } catch {}
}
export function forgetKey(key) {
  const all = readJSON(META_KEY, {}, v => v && typeof v === 'object');
  delete all[canonicalKey(key)];
  try { localStorage.setItem(META_KEY, JSON.stringify(all)); } catch {}
}

// Same value as data/photos.js stores with each photo (SHA-256 of the data URL)
async function photoTag(photo) {
  if (!photo) return '';
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(photo))).slice(0, 16);
}

const BATCH_ITEMS = 40, BATCH_BYTES = 3 * 1024 * 1024, OVERLAP_REV = 5_000 * 1000;   // revisit the last 5 s

/**
 * Upload local changes and download remote ones.
 * @param {string} key recovery key
 * @param {{ full?: boolean }} [opts] full = send everything again (first upload, new key)
 * @returns {Promise<{ sent: number, received: number }>}
 */
export async function sync2(key, { full = false } = {}) {
  const { aes } = await deriveKeys(key);
  const m = full ? { rev: 0, sent: {}, photos: {} } : readMeta(key);

  // ── 1. Upload ──
  // Photos are only read when they changed (the tag says so without reading them)
  const tags = photoTags();
  const ws = getWatches();
  const wl = getWishlist();
  const tomb = getTombstones();
  const pending = [];
  for (const w of ws) {
    const k = 'w:' + w.id, stamp = itemStamp(w);
    const tag = tags.get(w.id) || '';
    const photoChanged = (m.photos[w.id] || '') !== tag;
    if (m.sent[k] === stamp && !photoChanged) continue;
    const { photo: _p, ...rest } = w;
    const ch = { id: w.id, kind: 'w', updated: stamp, data: await encryptText(aes, JSON.stringify(rest), k) };
    if (photoChanged) {
      const photo = tag ? await getPhotoDataUrl(w.id) : null;
      ch.photo = photo ? await encryptText(aes, photo, 'p:' + w.id) : '';
    }
    pending.push({ ch, after: () => { m.sent[k] = stamp; m.photos[w.id] = tag; } });
  }
  for (const it of wl) {
    const k = 'l:' + it.id, stamp = itemStamp(it);
    if (m.sent[k] === stamp) continue;
    pending.push({ ch: { id: it.id, kind: 'l', updated: stamp, data: await encryptText(aes, JSON.stringify(it), k) },
                   after: () => { m.sent[k] = stamp; } });
  }
  const now = Date.now();
  for (const id of tomb.watches) pending.push({ ch: { id, kind: 'w', updated: now, deleted: true }, after: () => { delete m.sent['w:' + id]; delete m.photos[id]; } });
  for (const id of tomb.wishlist) pending.push({ ch: { id, kind: 'l', updated: now, deleted: true }, after: () => { delete m.sent['l:' + id]; } });

  let batch = [], bytes = 0, sentCount = 0;
  const flush = async () => {
    if (!batch.length) return;
    await api('/v2/sync', key, { method: 'POST', body: { changes: batch.map(p => p.ch), pull: false } });
    batch.forEach(p => p.after());
    sentCount += batch.length;
    writeMeta(key, m);
    batch = []; bytes = 0;
  };
  for (const p of pending) {
    const size = (p.ch.data?.length || 0) + (p.ch.photo?.length || 0);
    if (batch.length && (batch.length >= BATCH_ITEMS || bytes + size > BATCH_BYTES)) await flush();
    batch.push(p); bytes += size;
  }
  await flush();
  if (tomb.watches.length) clearTombstones('watches', tomb.watches);
  if (tomb.wishlist.length) clearTombstones('wishlist', tomb.wishlist);

  // ── 2. Download ──
  const remoteW = new Map(), remoteL = new Map();
  let since = Math.max(0, m.rev - OVERLAP_REV), more = true, guard = 0;
  while (more && guard++ < 200) {
    const r = await api('/v2/sync', key, { method: 'POST', body: { since, changes: [] } });
    for (const it of r.items || []) (it.kind === 'w' ? remoteW : remoteL).set(it.id, it);
    more = !!r.more && r.rev > since;
    since = r.rev || since;
  }
  m.rev = Math.max(m.rev, since);

  let received = 0;
  // Watches
  if (remoteW.size) {
    const byId = new Map(getWatches().map(w => [w.id, { ...w }]));
    for (const [id, it] of remoteW) {
      const mine = byId.get(id);
      if (mine && itemStamp(mine) > it.updated) continue;            // ours is newer: it goes up next time
      if (it.deleted) {
        if (mine) { byId.delete(id); await idbDeletePhoto(id); received++; }
        delete m.sent['w:' + id]; delete m.photos[id];
        continue;
      }
      if (mine && itemStamp(mine) === it.updated && it.photo === undefined) { m.sent['w:' + id] = it.updated; continue; }
      let w;
      try { w = sanitizeWatch(JSON.parse(await decryptText(aes, it.data, 'w:' + id))); } catch { continue; }
      if (!w || w.id !== id) continue;
      w.updatedAt = it.updated;
      // Photo: new one → stored by applyWatchList; '' → removed; not sent → keep ours
      let photoTagNow = tags.get(id) || '';
      if (it.photo !== undefined) {
        if (it.photo) {
          try { w.photo = await decryptText(aes, it.photo, 'p:' + id); photoTagNow = await photoTag(w.photo); }
          catch { w.photo = null; }
        } else { w.photo = null; await idbDeletePhoto(id); photoTagNow = ''; }
      } else w.photo = null;
      const fresh = sanitizeWatch({ ...w, photo: w.photo || undefined }) || w;
      fresh.updatedAt = it.updated;
      if (w.photo) fresh.photo = w.photo;
      byId.set(id, fresh);
      m.sent['w:' + id] = it.updated;
      m.photos[id] = photoTagNow;
      received++;
    }
    await applyWatchList(enforceSingleActive([...byId.values()]));
  }
  // Wishlist
  if (remoteL.size) {
    const byId = new Map(getWishlist().map(i => [i.id, i]));
    for (const [id, it] of remoteL) {
      const mine = byId.get(id);
      if (mine && itemStamp(mine) > it.updated) continue;
      if (it.deleted) { if (mine) { byId.delete(id); received++; } delete m.sent['l:' + id]; continue; }
      let item;
      try { item = sanitizeWishlistItem(JSON.parse(await decryptText(aes, it.data, 'l:' + id))); } catch { continue; }
      if (!item || item.id !== id) continue;
      item.updatedAt = it.updated;
      byId.set(id, item);
      m.sent['l:' + id] = it.updated;
      received++;
    }
    setWishlistSilently([...byId.values()]);
  }
  writeMeta(key, m);
  return { sent: sentCount, received };
}

/** @returns {Promise<{ exists: boolean, count?: number, sizeBytes?: number, maxItems?: number }>} */
export function account2(key) { return api('/v2/account', key); }
export async function delete2(key) { await api('/v2/account', key, { method: 'DELETE' }); forgetKey(key); }

/* ── Linking codes v2: the code never leaves the devices ── */
const PAIR_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const PAIR_ITER = 150_000;
async function pairKeys(code) {
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
  const lookup = hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('rotor/pair/lookup'), iterations: PAIR_ITER }, base, 256));
  const aes = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('rotor/pair/key'), iterations: PAIR_ITER },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { lookup, aes };
}
function randomCode() {
  let out = '';
  while (out.length < 6) {
    for (const b of crypto.getRandomValues(new Uint8Array(12))) {
      if (b < 248 && out.length < 6) out += PAIR_ALPHABET[b % 31];   // 248 = 31 × 8: no bias
    }
  }
  return out;
}
/** Create a one-use code for this key → { code, expiresAt } */
export async function pairCreate2(key) {
  const code = randomCode();
  const { lookup, aes } = await pairKeys(code);
  const blob = await encryptText(aes, canonicalKey(key), 'pair');
  const res = await fetch(`${CONFIG.WORKER_URL}/v2/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lookup, blob }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiError(data) || `HTTP ${res.status}`);
  return { code, expiresAt: data.expiresAt };
}
/** Swap a code for the recovery key */
export async function pairClaim2(code) {
  const { lookup, aes } = await pairKeys(code);
  const res = await fetch(`${CONFIG.WORKER_URL}/v2/pair/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lookup }) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) throw new Error(t('Demasiados intentos. Prueba dentro de una hora.'));
  if (res.status === 404) throw new Error(t('Este código no es válido, ya se usó o ha caducado. Cada código sirve para un solo dispositivo: genera otro en el dispositivo que ya tiene tu colección.'));
  if (!res.ok || !data.blob) throw new Error(apiError(data) || t('Código no válido o caducado'));
  return decryptText(aes, data.blob, 'pair');
}

