/**
 * data/moon.js — Lunar phase, computed on the device (no network, nothing sent).
 *
 * Times of new and full moon: J. Meeus, «Astronomical Algorithms» (2nd ed.), chapter 49,
 * with the periodic terms for new/full moon (the small planetary terms, under a minute, are left out).
 * Accuracy: a few minutes — far more than a moon-phase disc needs (it moves one step a day).
 * Between phases the age is interpolated, and the lit fraction comes from the age.
 */
const SYNODIC = 29.530588861;              // mean synodic month, days
const DAY_MS = 86400000;
const JD_UNIX = 2440587.5;                 // Julian day of 1970-01-01 00:00 UTC
const rad = d => d * Math.PI / 180;

const toJD = ms => ms / DAY_MS + JD_UNIX;
const fromJD = jd => (jd - JD_UNIX) * DAY_MS;

/**
 * Julian Ephemeris Day of the new (phase 0) or full (phase 0.5) moon of lunation k.
 * k = 0 is the new moon of 6 January 2000. The result is in Terrestrial Time (phaseTime converts to UTC).
 * @param {number} k integer lunation  @param {0|0.5} phase
 */
export function phaseJDE(k, phase) {
  const kk = k + phase;
  const T = kk / 1236.85, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  let jde = 2451550.09766 + 29.530588861 * kk + 0.00015437 * T2 - 0.000000150 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M  = rad(2.5534 + 29.10535670 * kk - 0.0000014 * T2 - 0.00000011 * T3);
  const Mp = rad(201.5643 + 385.81693528 * kk + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4);
  const F  = rad(160.7108 + 390.67050284 * kk - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4);
  const Om = rad(124.7746 - 1.56375588 * kk + 0.0020672 * T2 + 0.00000215 * T3);
  const s = Math.sin;
  const c = phase === 0
    ? [-0.40720, 0.17241 * E, 0.01608, 0.01039, 0.00739 * E, -0.00514 * E, 0.00208 * E * E, -0.00111, -0.00057, 0.00056 * E,
       -0.00042, 0.00042 * E, 0.00038 * E, -0.00024 * E, -0.00017, -0.00007, 0.00004, 0.00004, 0.00003, 0.00003, -0.00003, 0.00003,
       -0.00002, -0.00002, 0.00002]
    : [-0.40614, 0.17302 * E, 0.01614, 0.01043, 0.00734 * E, -0.00515 * E, 0.00209 * E * E, -0.00111, -0.00057, 0.00056 * E,
       -0.00042, 0.00042 * E, 0.00038 * E, -0.00024 * E, -0.00017, -0.00007, 0.00004, 0.00004, 0.00003, 0.00003, -0.00003, 0.00003,
       -0.00002, -0.00002, 0.00002];
  const args = [Mp, M, 2 * Mp, 2 * F, Mp - M, Mp + M, 2 * M, Mp - 2 * F, Mp + 2 * F, 2 * Mp + M, 3 * Mp, M + 2 * F, M - 2 * F,
    2 * Mp - M, Om, Mp + 2 * M, 2 * Mp - 2 * F, 3 * M, Mp + M - 2 * F, 2 * Mp + 2 * F, Mp + M + 2 * F, Mp - M + 2 * F,
    Mp - M - 2 * F, 3 * Mp + M, 4 * Mp];
  for (let i = 0; i < c.length; i++) jde += c[i] * s(args[i]);
  return jde;
}

/** Time (ms, UTC) of the new or full moon of lunation k. ΔT = TT − UTC ≈ 69 s in the 2020s */
export const phaseTime = (k, phase) => fromJD(phaseJDE(k, phase)) - 69000;

/** The lunation whose new moon is the last one at or before `ms` */
function lunationAt(ms) {
  let k = Math.floor((toJD(ms) - 2451550.09766) / SYNODIC);
  while (phaseTime(k + 1, 0) <= ms) k++;
  while (phaseTime(k, 0) > ms) k--;
  return k;
}

export const PHASES = ['new', 'waxing-crescent', 'first-quarter', 'waxing-gibbous', 'full', 'waning-gibbous', 'last-quarter', 'waning-crescent'];

/**
 * Everything the screen needs about the moon at a moment.
 * @param {number} [ms]
 * @returns {{ age: number, fraction: number, illumination: number, phase: string, waxing: boolean,
 *   lastNew: number, nextNew: number, lastFull: number, nextFull: number, daysSinceFull: number }}
 *   fraction: 0 = new, 0.5 = full, → 1; illumination 0–1; times in ms
 */
export function moonAt(ms = Date.now()) {
  const k = lunationAt(ms);
  const lastNew = phaseTime(k, 0), nextNew = phaseTime(k + 1, 0);
  const full = phaseTime(k, 0.5);
  const lastFull = full <= ms ? full : phaseTime(k - 1, 0.5);
  const nextFull = full > ms ? full : phaseTime(k + 1, 0.5);
  // Piecewise: new → full and full → new each map to half a cycle (keeps «full» exactly at full moon)
  const fraction = ms < full ? 0.5 * (ms - lastNew) / (full - lastNew) : 0.5 + 0.5 * (ms - full) / (nextNew - full);
  const illumination = (1 - Math.cos(2 * Math.PI * fraction)) / 2;
  // Names: «new», «full» and the quarters within ±1 day of the exact moment, as almanacs do
  const day = 1 / SYNODIC;
  const near = x => Math.abs(fraction - x) < day || Math.abs(fraction - x - 1) < day;
  const phase = near(0) ? 'new' : near(0.5) ? 'full' : near(0.25) ? 'first-quarter' : near(0.75) ? 'last-quarter'
    : fraction < 0.25 ? 'waxing-crescent' : fraction < 0.5 ? 'waxing-gibbous' : fraction < 0.75 ? 'waning-gibbous' : 'waning-crescent';
  return {
    age: (ms - lastNew) / DAY_MS, fraction, illumination, phase, waxing: fraction < 0.5,
    lastNew, nextNew, lastFull, nextFull, daysSinceFull: (ms - lastFull) / DAY_MS,
  };
}

/**
 * Clicks to set a moon-phase disc: put it on full moon, then advance one click per day since
 * the last full moon (the usual method in watch manuals). Days are counted by calendar day.
 * @param {number} [ms]
 */
export function moonClicks(ms = Date.now()) {
  const { lastFull } = moonAt(ms);
  const a = new Date(lastFull); a.setHours(12, 0, 0, 0);
  const b = new Date(ms); b.setHours(12, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** Does this watch look like it has a moon-phase display? (name, model, ref or specs) */
export function hasMoonPhase(w) {
  const text = `${w?.brand || ''} ${w?.model || ''} ${w?.ref || ''} ${Object.values(w?.specs || {}).join(' ')}`.toLowerCase();
  return /moon ?phase|fase lunar|fases? da lua|phase de lune|mondphase|lunar|moonphase/.test(text);
}
