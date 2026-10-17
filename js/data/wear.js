/**
 * data/wear.js — Wear log by calendar days: intervals, days worn, stats, maintenance alerts and the actions that add or remove days.
 */

import { getActiveWatch, getWatch, save, startWearing, stopWearing } from './watches.js';

/* ═══════════════════════════════════════
   WEAR LOG — calendar-day semantics
   A watch "was worn on a day" if any interval touches that local calendar
   day. Two hours count as one day; two sessions on the same day count once.
═══════════════════════════════════════ */
export const DAY_MS = 86400000;

/** Local calendar day "YYYY-MM-DD" @param {number} ts @returns {string} */
export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** @param {number} ts @returns {number} */
export function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
/** Whole calendar days between two timestamps (0 = same day) */
export function calendarDaysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

/** All intervals of a watch, including the live one */
export function wearIntervals(w, now = Date.now()) {
  const all = (w.history || []).map((h, i) => ({ start: h.start, end: h.end || h.start, idx: i, timed: !!h.timed }));
  if (w.wearStart) all.push({ start: w.wearStart, end: now, active: true, timed: true, idx: -1 });
  return all.sort((a, b) => a.start - b.start);
}

/** Set of local day keys on which the watch was worn */
/** Distinct calendar days worn @param {Watch} w @param {number} [now] @returns {Set<string>} */
export function wornDayKeys(w, now = Date.now()) {
  const keys = new Set();
  for (const iv of wearIntervals(w, now)) {
    let t = startOfDay(iv.start);
    const last = startOfDay(iv.end);
    let guard = 0;
    while (t <= last && guard++ < 3700) {   // 10 years cap
      keys.add(dayKey(t));
      const d = new Date(t); d.setDate(d.getDate() + 1); t = d.getTime();
    }
  }
  return keys;
}

/**
 * Usage summary for one watch.
 *   daysWorn          distinct calendar days worn (all time)
 *   daysWorn90        distinct days in the last 90 days
 *   sessions          number of intervals
 *   lastWorn          timestamp of the last time it was on the wrist (null = never)
 *   daysSinceLast     calendar days since lastWorn (0 = today)
 *   costPerWear       purchasePrice / daysWorn (null if unknown)
 */
/** @param {Watch} w @param {number} [now] @returns {WearStats} */
export function wearStats(w, now = Date.now()) {
  const ivs  = wearIntervals(w, now);
  const keys = wornDayKeys(w, now);
  const cutoff = dayKey(now - 89 * DAY_MS);
  let worn90 = 0;
  for (const k of keys) if (k >= cutoff) worn90++;
  const lastWorn = ivs.length ? Math.max(...ivs.map(i => i.active ? now : i.end)) : null;
  const price = typeof w.purchasePrice === 'number' && w.purchasePrice > 0 ? w.purchasePrice : null;
  return {
    daysWorn: keys.size,
    daysWorn90: worn90,
    sessions: ivs.length,
    lastWorn,
    daysSinceLast: lastWorn === null ? null : (w.wearStart ? 0 : calendarDaysBetween(lastWorn, now)),
    active: !!w.wearStart,
    hoursWorn: ivs.filter(i => i.timed).reduce((h, i) => h + (i.end - i.start), 0) / 3600000,
    costPerWear: price && keys.size ? price / keys.size : null,
  };
}

/** Maintenance alerts: quartz battery (> 24 months) and service (> 5 years) */
export const BATTERY_MONTHS = 24;
export const SERVICE_YEARS  = 5;
export function maintenanceAlerts(w, now = Date.now()) {
  const out = [];
  const months = ts => Math.floor((now - ts) / (30.44 * DAY_MS));
  if (w.type === 'quartz' && typeof w.batteryChanged === 'number') {
    const m = months(w.batteryChanged);
    if (m >= BATTERY_MONTHS) out.push({ kind: 'battery', months: m,
      text: `Pila cambiada hace ${m} meses: revísala antes de que se agote y pierda líquido` });
  }
  if (w.type !== 'quartz') {
    const ref = typeof w.lastService === 'number' ? w.lastService
              : typeof w.purchaseDate === 'number' ? w.purchaseDate : null;
    if (ref !== null) {
      const y = (now - ref) / (365.25 * DAY_MS);
      if (y >= SERVICE_YEARS) out.push({ kind: 'service', years: Math.floor(y), from: typeof w.lastService === 'number' ? 'service' : 'purchase',
        text: `${typeof w.lastService === 'number' ? 'Última revisión' : 'Comprado'} hace ${Math.floor(y)} años: toca revisión (cada ${SERVICE_YEARS} años aprox.)` });
    }
  }
  return out;
}

/* ── Wear actions ── */

/** Mark a day (or a range of days) as worn, without live tracking */
/** Log the days from fromTs to toTs (inclusive) @param {string} id @param {number} fromTs @param {number} [toTs] @returns {boolean} */
export function addWearDays(id, fromTs, toTs = fromTs) {
  const w = getWatch(id);
  if (!w) return false;
  const now = Date.now();
  const r = dayRange(fromTs, toTs, now);
  if (!r) return false;                                                   // no future days
  if (!w.history) w.history = [];
  w.history.push(r);
  w.history.sort((a, b) => a.start - b.start);
  w.updatedAt = now;
  save();
  return true;
}

/**
 * A logged day runs 09:00–21:00 so it never spills into the next date. Today
 * is clamped to "now", so logging early in the morning (00:00–08:59) still
 * counts today. Days after today are refused.
 */
export function dayRange(fromTs, toTs, now = Date.now()) {
  if (startOfDay(Math.min(fromTs, toTs)) > startOfDay(now)) return null;   // future day
  let start = startOfDay(Math.min(fromTs, toTs)) + 9 * 3600000;
  let end   = startOfDay(Math.max(fromTs, toTs)) + 21 * 3600000;
  if (start > now) start = now;
  if (end > now) end = now;
  if (start > end) start = end;
  return { start, end };
}

/** "Lo llevé hoy" — idempotent: does nothing if it already counts for today */
export function markWornToday(id) {
  const w = getWatch(id);
  if (!w) return false;
  if (wornDayKeys(w).has(dayKey(Date.now()))) return 'already';
  return addWearDays(id, Date.now());
}

export function updateHistoryEntry(id, idx, fromTs, toTs) {
  const w = getWatch(id);
  if (!w || !w.history?.[idx]) return false;
  const now = Date.now();
  const r = dayRange(fromTs, toTs, now);
  if (!r) return false;
  w.history[idx] = r;
  w.history.sort((a, b) => a.start - b.start);
  w.updatedAt = now;
  save();
  return true;
}

export function deleteHistoryEntry(id, idx) {
  const w = getWatch(id);
  if (!w || !w.history?.[idx]) return false;
  w.history.splice(idx, 1);
  w.updatedAt = Date.now();
  save();
  return true;
}

/**
 * Remove one calendar day from a watch's history. Intervals that span several
 * days are trimmed or split, so the other days stay. Returns 'active' if that
 * day belongs to the session in progress (it must be stopped first).
 */
/** @param {string} id @param {number} dayTs @returns {boolean | "active"} */
export function removeWearDay(id, dayTs) {
  const w = getWatch(id);
  if (!w) return false;
  const day = startOfDay(dayTs);
  const next = d => { const x = new Date(d); x.setDate(x.getDate() + 1); return x.getTime(); };
  const prev = d => { const x = new Date(d); x.setDate(x.getDate() - 1); return x.getTime(); };
  if (w.wearStart && startOfDay(w.wearStart) <= day) return 'active';
  const out = [];
  let changed = false;
  for (const h of (w.history || [])) {
    const s = startOfDay(h.start), e = startOfDay(h.end || h.start);
    if (day < s || day > e) { out.push(h); continue; }
    changed = true;
    if (s === e) continue;                                              // single day: drop
    if (day === s) { out.push({ start: next(day) + 9 * 3600000, end: h.end }); continue; }
    if (day === e) { out.push({ start: h.start, end: prev(day) + 21 * 3600000 }); continue; }
    out.push({ start: h.start, end: prev(day) + 21 * 3600000 });          // split around the day
    out.push({ start: next(day) + 9 * 3600000, end: h.end });
  }
  if (!changed) return false;
  w.history = out.sort((a, b) => a.start - b.start);
  w.updatedAt = Date.now();
  save();
  return true;
}

/** Take off whatever is on the wrist and put this one on, in one step */
export function switchToWatch(id) {
  const active = getActiveWatch();
  if (active && active.id === id) return false;
  if (active) stopWearing(active.id);
  return startWearing(id);
}

export function setWatchFlag(id, key, value) {
  if (!['favorite', 'rotation'].includes(key)) return false;
  const w = getWatch(id);
  if (!w) return false;
  w[key] = !!value;
  w.updatedAt = Date.now();
  save();
  return true;
}

Object.assign(window, { dayKey, startOfDay, calendarDaysBetween, wearIntervals, wornDayKeys, wearStats,
  maintenanceAlerts, addWearDays, markWornToday, updateHistoryEntry, deleteHistoryEntry, removeWearDay, switchToWatch, setWatchFlag });
