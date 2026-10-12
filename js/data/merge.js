/**
 * data/merge.js — Validation and merging: sanitizing anything that comes from outside (cloud, backups), tombstones for deletions and per-item merge.
 */
import { readJSON } from './persist.js';

/* ═══════════════════════════════════════
   TOMBSTONES — ids deleted locally that the cloud still has to hear about.
   Cleared by sync.js after a successful push.
═══════════════════════════════════════ */
export const TOMB_KEY = 'horlogerie_tombstones_v1';

export function getTombstones() {
  const t = readJSON(TOMB_KEY, /** @type {{ watches?: string[], wishlist?: string[] }} */ ({}), v => v && typeof v === 'object');
  return { watches: t.watches || [], wishlist: t.wishlist || [] };
}
export function setTombstones(t) {
  try { localStorage.setItem(TOMB_KEY, JSON.stringify(t)); } catch {}
}
export function addTombstone(kind, id) {
  const t = getTombstones();
  if (!t[kind].includes(id)) t[kind].push(id);
  setTombstones(t);
}
export function clearTombstones(kind, ids) {
  const t = getTombstones();
  const done = new Set(ids);
  t[kind] = t[kind].filter(id => !done.has(id));
  setTombstones(t);
}

/* ═══════════════════════════════════════
   MERGE — combine local and cloud lists item by item.
   Pure function (no side effects) so it can be tested in isolation.

   local, cloud   arrays of { id, updatedAt?, created? , ... }
   syncedIds      ids known to be in the cloud after the last successful sync
   localDeleted   ids deleted here and not yet pushed

   Rules:
   - In both            → keep the most recently modified (tie → cloud)
   - Only local         → was synced before? then the cloud deleted it → drop
                          never synced? it is new here → keep
   - Only in cloud      → deleted here and not pushed yet? → drop; else → add
═══════════════════════════════════════ */
export function itemStamp(x) {
  if (!x) return 0;
  if (typeof x.updatedAt === 'number') return x.updatedAt;
  let s = typeof x.created === 'number' ? x.created : 0;
  if (typeof x.wearStart === 'number') s = Math.max(s, x.wearStart);
  for (const h of (Array.isArray(x.history) ? x.history : [])) {
    s = Math.max(s, h?.end || h?.start || 0);
  }
  return s;
}

export function mergeById(local, cloud, syncedIds = [], localDeleted = []) {
  const synced  = new Set(syncedIds);
  const deleted = new Set(localDeleted);
  const cloudMap = new Map((cloud || []).filter(x => x && x.id).map(x => [x.id, x]));
  const out = [];
  const stats = { keptLocal: 0, fromCloud: 0, droppedLocal: 0, droppedCloud: 0 };

  for (const l of (local || [])) {
    if (!l || !l.id) continue;
    const c = cloudMap.get(l.id);
    if (c) {
      if (itemStamp(l) > itemStamp(c)) { out.push(l); stats.keptLocal++; }
      else { out.push(c); stats.fromCloud++; }
      cloudMap.delete(l.id);
    } else if (synced.has(l.id)) {
      stats.droppedLocal++;            // deleted on another device
    } else {
      out.push(l); stats.keptLocal++;  // new on this device
    }
  }
  for (const c of cloudMap.values()) {
    if (deleted.has(c.id)) { stats.droppedCloud++; continue; }
    out.push(c); stats.fromCloud++;
  }
  return { items: out, stats };
}
/* ═══════════════════════════════════════
   SANITIZE — anything coming from a backup file or the cloud
═══════════════════════════════════════ */
export const WATCH_TYPES = ['automatic', 'quartz', 'manual'];
export const SPEC_KEYS   = ['calibre','movimiento','cristal','brazalete','esfera','caja','resistencia','reserva','diametro','grosor','asas'];
export const MAX_PHOTO_CHARS = 3 * 1024 * 1024;

export function isSafePhoto(p) {
  return typeof p === 'string' && p.length < MAX_PHOTO_CHARS &&
    /^data:image\/(webp|jpeg|jpg|png);base64,[A-Za-z0-9+/=]+$/.test(p);
}
export function isSafeUrl(u) {
  if (typeof u !== 'string' || u.length > 2000) return false;
  try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; }
}
export const _str = (v, max = 500) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
export const _num = v => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);

/** Anything from outside (cloud, backups) goes through here @param {any} raw @returns {Watch | null} */
export function sanitizeWatch(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const brand = _str(raw.brand, 80).trim(), model = _str(raw.model, 120).trim();
  if (!brand || !model) return null;
  const id = /^[A-Za-z0-9_-]{1,64}$/.test(raw.id || '') ? raw.id
    : 'w_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const specs = {};
  for (const k of SPEC_KEYS) if (raw.specs?.[k]) specs[k] = _str(raw.specs[k], 200);
  const history = (Array.isArray(raw.history) ? raw.history : [])
    .map(h => ({ start: _num(h?.start), end: _num(h?.end) }))
    .filter(h => h.start && h.end && h.end >= h.start);
  const w = {
    id, brand, model,
    ref:   _str(raw.ref, 80),
    type:  WATCH_TYPES.includes(raw.type) ? raw.type : 'automatic',
    notes: _str(raw.notes, 2000),
    specs,
    price: raw.price && typeof raw.price === 'object'
      ? { value: _str(raw.price.value, 80), note: _str(raw.price.note, 200) } : null,
    history,
    wearStart: _num(raw.wearStart),
    created:   _num(raw.created) || Date.now(),
  };
  if (_num(raw.updatedAt)) w.updatedAt = raw.updatedAt;
  if (typeof raw.favorite === 'boolean') w.favorite = raw.favorite;
  if (typeof raw.rotation === 'boolean') w.rotation = raw.rotation;
  for (const k of ['purchasePrice', 'purchaseDate', 'lastService', 'batteryChanged']) {
    if (_num(raw[k])) w[k] = raw[k];
  }
  // Rotor Pro fields
  if (raw.serial) w.serial = _str(raw.serial, 80);
  if (_num(raw.currentValue)) w.currentValue = raw.currentValue;
  if (Array.isArray(raw.serviceLog)) {
    const log = raw.serviceLog.slice(0, 200)
      .filter(e => e && _num(e.date) && ['service', 'battery', 'strap', 'polish', 'repair', 'other'].includes(e.kind))
      .map(e => {
        const o = { id: /^[A-Za-z0-9_-]{1,40}$/.test(e.id || '') ? e.id : 's_' + Math.random().toString(36).slice(2, 10), date: e.date, kind: e.kind };
        if (typeof e.cost === 'number' && isFinite(e.cost) && e.cost >= 0) o.cost = e.cost;
        if (e.note) o.note = _str(e.note, 300);
        return o;
      });
    if (log.length) w.serviceLog = log;
  }
  if (Array.isArray(raw.accuracy)) {
    const acc = raw.accuracy.slice(0, 500)
      .filter(r => r && _num(r.ts) && typeof r.offset === 'number' && isFinite(r.offset) && Math.abs(r.offset) <= 86400)
      .map(r => (r.setAfter === true ? { ts: r.ts, offset: r.offset, setAfter: true } : { ts: r.ts, offset: r.offset }));
    if (acc.length) w.accuracy = acc;
  }
  if (Array.isArray(raw.straps)) {
    const st = raw.straps.slice(0, 50).filter(x => x && _str(x.name, 80).trim()).map(x => {
      const o = { id: /^[A-Za-z0-9_-]{1,40}$/.test(x.id || '') ? x.id : 'st_' + Math.random().toString(36).slice(2, 10), name: _str(x.name, 80).trim() };
      if (x.material) o.material = _str(x.material, 60);
      if (x.width) o.width = _str(x.width, 20);
      if (x.note) o.note = _str(x.note, 200);
      if (x.fitted === true) o.fitted = true;
      return o;
    });
    if (st.length) w.straps = st;
  }
  if (raw._source)  w._source  = _str(raw._source, 80);
  if (isSafeUrl(raw.sourceUrl)) w.sourceUrl = raw.sourceUrl;
  if (raw._warning) w._warning = _str(raw._warning, 200);
  if (isSafePhoto(raw.photo)) w.photo = raw.photo;
  return w;
}
/** @param {any} raw @returns {WishlistItem | null} */
export function sanitizeWishlistItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const brand = _str(raw.brand, 80).trim(), model = _str(raw.model, 120).trim();
  if (!brand || !model) return null;
  const specs = {};
  for (const k of SPEC_KEYS) if (raw.specs?.[k]) specs[k] = _str(raw.specs[k], 200);
  const it = {
    id: /^[A-Za-z0-9_-]{1,64}$/.test(raw.id || '') ? raw.id
      : 'wl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    brand, model,
    ref:      _str(raw.ref, 80),
    type:     WATCH_TYPES.includes(raw.type) ? raw.type : 'automatic',
    priority: ['high','medium','low'].includes(raw.priority) ? raw.priority : 'medium',
    precio:   _str(raw.precio, 80),
    notas:    _str(raw.notas, 2000),
    specs,
    created:  _num(raw.created) || Date.now(),
  };
  if (_num(raw.updatedAt)) it.updatedAt = raw.updatedAt;
  if (isSafeUrl(raw.sourceUrl)) it.sourceUrl = raw.sourceUrl;
  return it;
}
