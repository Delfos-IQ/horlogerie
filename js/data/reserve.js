/**
 * data/reserve.js — Power reserve of mechanical watches and the date to set after they stop.
 *
 * From the reserve in the spec sheet («41 h», «3 días») and the moment the watch was last
 * taken off (end of its last wear interval), estimate when it stops. Assumes it was fully
 * wound when taken off: an estimate, and the screen says so.
 * Quartz watches have no reserve here (their battery is in the maintenance reminders).
 */
import { DAY_MS, startOfDay, wearIntervals } from './wear.js';

const HOUR_MS = 3600000;
/** Typical reserve of today's automatics when the sheet says nothing */
export const DEFAULT_RESERVE_H = 40;

/** Hours from «41 h», «42 horas», «3 days», «72h», «3 días»; null if there is no number */
export function parseReserveHours(s) {
  const txt = String(s || '').toLowerCase().replace(',', '.');
  const m = /(\d+(?:\.\d+)?)\s*(d[ií]as?|days?|dias?|j(?:ours)?\b|tage?|h|hours?|horas?|hrs?|stunden)?/.exec(txt);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const days = m[2] && /^(d|j|t)/.test(m[2]);
  const h = days ? n * 24 : n;
  return h >= 8 && h <= 24 * 60 ? h : null;      // sanity: between 8 h and 60 days
}

/** Moment the watch was last taken off (end of its last wear interval), or null */
export function lastTakenOff(w, now = Date.now()) {
  const ivs = wearIntervals(w, now).filter(iv => !iv.active && iv.end <= now);
  return ivs.length ? Math.max(...ivs.map(iv => iv.end)) : null;
}

/**
 * Date-wheel steps from the date shown when the watch stopped to today's date.
 * A simple date wheel has 31 positions: after the 30th of a 30-day month it still has to pass the 31.
 */
export function dateClicks(stopAt, now = Date.now()) {
  let d = new Date(startOfDay(stopAt));
  const end = startOfDay(now);
  let steps = 0, guard = 0;
  while (d.getTime() < end && guard++ < 400) {
    const next = new Date(d); next.setDate(d.getDate() + 1);
    steps += next.getDate() === 1 ? 32 - d.getDate() : 1;
    d = next;
  }
  return steps;
}

/** Between 21:00 and 03:00 the date change is engaged: setting the date then can damage the movement */
export function dateDangerZone(now = Date.now()) {
  const h = new Date(now).getHours();
  return h >= 21 || h < 3;
}

/**
 * @returns {null | { state: 'wearing' | 'unknown', hours: number, estimated: boolean }
 *   | { state: 'running', hours: number, estimated: boolean, offAt: number, stopAt: number, remainingH: number, fraction: number }
 *   | { state: 'stopped', hours: number, estimated: boolean, offAt: number, stopAt: number, stoppedDays: number, dateClicks: number }}
 */
export function reserveStatus(w, now = Date.now()) {
  if (!w || w.type === 'quartz') return null;
  const parsed = parseReserveHours(w.specs?.reserva);
  const hours = parsed ?? DEFAULT_RESERVE_H;
  const estimated = parsed === null;
  if (w.wearStart) return { state: 'wearing', hours, estimated };
  const offAt = lastTakenOff(w, now);
  if (offAt === null) return { state: 'unknown', hours, estimated };
  const stopAt = offAt + hours * HOUR_MS;
  if (now < stopAt) {
    const remainingH = (stopAt - now) / HOUR_MS;
    return { state: 'running', hours, estimated, offAt, stopAt, remainingH, fraction: Math.min(1, remainingH / hours) };
  }
  return { state: 'stopped', hours, estimated, offAt, stopAt,
    stoppedDays: Math.floor((now - stopAt) / DAY_MS), dateClicks: dateClicks(stopAt, now) };
}
