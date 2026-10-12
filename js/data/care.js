/**
 * data/care.js — Rotor Pro data: maintenance log, accuracy readings, straps and collection value.
 *
 * Everything lives on the watch object (so it travels with backups and the cloud):
 *   serviceLog  [{ id, date, kind, cost?, note? }]   kind: service | battery | strap | polish | repair | other
 *   accuracy    [{ ts, offset, setAfter? }]           offset = seconds fast (+) or slow (−) against a reference clock;
 *                                                     setAfter = the watch was put right after reading it
 *   straps      [{ id, name, material?, width?, note?, fitted? }]
 *   serial, currentValue
 */
import { getWatch, getWatches, save } from './watches.js';

const DAY_MS = 86400000;
export const SERVICE_KINDS = ['service', 'battery', 'strap', 'polish', 'repair', 'other'];
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const touch = w => { w.updatedAt = Date.now(); save(); };

/* ── Maintenance log ── */
/** @param {string} id @param {{ date: number, kind: string, cost?: number|null, note?: string }} e @returns {boolean} */
export function addServiceEntry(id, e) {
  const w = getWatch(id);
  if (!w || !(e?.date > 0) || e.date > Date.now() + DAY_MS || !SERVICE_KINDS.includes(e.kind)) return false;
  if (!Array.isArray(w.serviceLog)) w.serviceLog = [];
  const entry = /** @type {ServiceEntry} */ ({ id: newId('s_'), date: e.date, kind: e.kind });
  if (typeof e.cost === 'number' && e.cost >= 0 && isFinite(e.cost)) entry.cost = e.cost;
  if (e.note) entry.note = String(e.note).slice(0, 300);
  w.serviceLog.push(entry);
  w.serviceLog.sort((a, b) => b.date - a.date);
  // The reminders read lastService / batteryChanged: keep them in step with the log
  if (e.kind === 'service' && !(w.lastService >= e.date)) w.lastService = e.date;
  if (e.kind === 'battery' && !(w.batteryChanged >= e.date)) w.batteryChanged = e.date;
  touch(w);
  return true;
}
export function deleteServiceEntry(id, entryId) {
  const w = getWatch(id);
  if (!w || !Array.isArray(w.serviceLog)) return false;
  const before = w.serviceLog.length;
  w.serviceLog = w.serviceLog.filter(x => x.id !== entryId);
  if (w.serviceLog.length === before) return false;
  touch(w);
  return true;
}
/** Total spent on maintenance */
export function serviceCost(w) {
  return (w?.serviceLog || []).reduce((s, x) => s + (typeof x.cost === 'number' ? x.cost : 0), 0);
}

/* ── Accuracy (seconds per day) ── */
/** @param {string} id @param {{ ts: number, offset: number, setAfter?: boolean }} r */
export function addAccuracyReading(id, r) {
  const w = getWatch(id);
  if (!w || !(r?.ts > 0) || typeof r.offset !== 'number' || !isFinite(r.offset) || Math.abs(r.offset) > 86400) return false;
  if (!Array.isArray(w.accuracy)) w.accuracy = [];
  const reading = { ts: r.ts, offset: Math.round(r.offset * 10) / 10 };
  if (r.setAfter) reading.setAfter = true;
  w.accuracy.push(reading);
  w.accuracy.sort((a, b) => a.ts - b.ts);
  touch(w);
  return true;
}
export function deleteAccuracyReading(id, ts) {
  const w = getWatch(id);
  if (!w || !Array.isArray(w.accuracy)) return false;
  const before = w.accuracy.length;
  w.accuracy = w.accuracy.filter(x => x.ts !== ts);
  if (w.accuracy.length === before) return false;
  touch(w);
  return true;
}
/**
 * Rate between consecutive readings (at least 12 h apart):
 *   rate = (offset now − offset before) / days, where "before" is 0 if the watch was set after that reading.
 * @returns {{ rates: { from: number, to: number, days: number, rate: number }[], last: number|null, avg: number|null, offset: number|null }}
 */
export function accuracyStats(w) {
  const rs = [...(w?.accuracy || [])].sort((a, b) => a.ts - b.ts);
  const rates = [];
  for (let i = 1; i < rs.length; i++) {
    const prev = rs[i - 1], cur = rs[i];
    const days = (cur.ts - prev.ts) / DAY_MS;
    if (days < 0.5) continue;
    const base = prev.setAfter ? 0 : prev.offset;
    rates.push({ from: prev.ts, to: cur.ts, days, rate: (cur.offset - base) / days });
  }
  const recent = rates.slice(-3);
  // Average weighted by days, so a 7-day run counts more than a 1-day one
  const totalDays = recent.reduce((s, r) => s + r.days, 0);
  const avg = recent.length ? recent.reduce((s, r) => s + r.rate * r.days, 0) / totalDays : null;
  return {
    rates,
    last: rates.length ? rates[rates.length - 1].rate : null,
    avg,
    offset: rs.length ? (rs[rs.length - 1].setAfter ? 0 : rs[rs.length - 1].offset) : null,
  };
}

/* ── Straps ── */
/** @param {string} id @param {{ name: string, material?: string, width?: string, note?: string }} s */
export function addStrap(id, s) {
  const w = getWatch(id);
  const name = String(s?.name || '').trim().slice(0, 80);
  if (!w || !name) return null;
  if (!Array.isArray(w.straps)) w.straps = [];
  const strap = { id: newId('st_'), name };
  if (s.material) strap.material = String(s.material).slice(0, 60);
  if (s.width) strap.width = String(s.width).slice(0, 20);
  if (s.note) strap.note = String(s.note).slice(0, 200);
  if (!w.straps.length) strap.fitted = true;          // the first one is the one on the watch
  w.straps.push(strap);
  touch(w);
  return strap;
}
export function fitStrap(id, strapId) {
  const w = getWatch(id);
  if (!w || !w.straps?.some(s => s.id === strapId)) return false;
  w.straps.forEach(s => { if (s.id === strapId) s.fitted = true; else delete s.fitted; });
  touch(w);
  return true;
}
export function deleteStrap(id, strapId) {
  const w = getWatch(id);
  if (!w || !Array.isArray(w.straps)) return false;
  const wasFitted = w.straps.find(s => s.id === strapId)?.fitted;
  w.straps = w.straps.filter(s => s.id !== strapId);
  if (wasFitted && w.straps[0]) w.straps[0].fitted = true;
  touch(w);
  return true;
}

/* ── Collection value ── */
/**
 * paid      sum of purchase prices (watches with a price)
 * value     sum of current values, using the purchase price where no value was entered
 * service   money spent on maintenance
 * perWear   (paid + service) / days worn across the collection
 */
/** @param {Watch[]} [ws] @param {(w: Watch) => number} [wornDays] */
export function collectionValue(ws = getWatches(), wornDays = () => 0) {
  let paid = 0, value = 0, service = 0, priced = 0, valued = 0, days = 0;
  const byBrand = new Map(), byType = new Map();
  for (const w of ws) {
    const p = typeof w.purchasePrice === 'number' && w.purchasePrice > 0 ? w.purchasePrice : 0;
    const v = typeof w.currentValue === 'number' && w.currentValue > 0 ? w.currentValue : p;
    if (p) priced++;
    if (typeof w.currentValue === 'number' && w.currentValue > 0) valued++;
    paid += p; value += v; service += serviceCost(w); days += wornDays(w);
    byBrand.set(w.brand, (byBrand.get(w.brand) || 0) + v);
    byType.set(w.type, (byType.get(w.type) || 0) + v);
  }
  const sortDesc = m => [...m.entries()].filter(([, x]) => x > 0).sort((a, b) => b[1] - a[1]);
  return {
    count: ws.length, priced, valued, paid, value, service,
    change: paid ? (value - paid) / paid : null,
    perWear: days ? (paid + service) / days : null,
    byBrand: sortDesc(byBrand), byType: sortDesc(byType),
  };
}
