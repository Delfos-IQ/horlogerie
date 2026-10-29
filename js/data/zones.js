/**
 * data/zones.js — Second time zone (GMT complication): a short list of cities and the time there.
 * Uses the time-zone database built into the browser (Intl): no network, daylight saving included.
 */
/* Marks city names for translation (tools/check-i18n.mjs); translated with t() where shown */
const tk = s => s;

/** @type {{ id: string, name: string }[]} id = IANA time zone */
export const GMT_CITIES = [
  { id: 'UTC', name: tk('UTC (Greenwich)') },
  { id: 'Atlantic/Azores', name: tk('Azores') },
  { id: 'Atlantic/Canary', name: tk('Canarias') },
  { id: 'Europe/Lisbon', name: tk('Lisboa') },
  { id: 'Europe/London', name: tk('Londres') },
  { id: 'Europe/Madrid', name: tk('Madrid') },
  { id: 'Europe/Paris', name: tk('París') },
  { id: 'Europe/Zurich', name: tk('Ginebra') },
  { id: 'Europe/Berlin', name: tk('Berlín') },
  { id: 'Europe/Athens', name: tk('Atenas') },
  { id: 'Europe/Moscow', name: tk('Moscú') },
  { id: 'Africa/Luanda', name: tk('Luanda') },
  { id: 'Africa/Maputo', name: tk('Maputo') },
  { id: 'Asia/Dubai', name: tk('Dubái') },
  { id: 'Asia/Kolkata', name: tk('Bombay') },
  { id: 'Asia/Bangkok', name: tk('Bangkok') },
  { id: 'Asia/Singapore', name: tk('Singapur') },
  { id: 'Asia/Hong_Kong', name: tk('Hong Kong') },
  { id: 'Asia/Shanghai', name: tk('Shanghái') },
  { id: 'Asia/Tokyo', name: tk('Tokio') },
  { id: 'Australia/Sydney', name: tk('Sídney') },
  { id: 'Pacific/Auckland', name: tk('Auckland') },
  { id: 'Pacific/Honolulu', name: tk('Honolulu') },
  { id: 'America/Los_Angeles', name: tk('Los Ángeles') },
  { id: 'America/Denver', name: tk('Denver') },
  { id: 'America/Chicago', name: tk('Chicago') },
  { id: 'America/Mexico_City', name: tk('Ciudad de México') },
  { id: 'America/New_York', name: tk('Nueva York') },
  { id: 'America/Sao_Paulo', name: tk('São Paulo') },
  { id: 'America/Argentina/Buenos_Aires', name: tk('Buenos Aires') },
];
export const cityById = id => GMT_CITIES.find(c => c.id === id) || GMT_CITIES[0];

/** Wall-clock time in a zone: { h, m, s, dayKey: 'YYYY-MM-DD' } (null if the zone is unknown) */
export function zoneTime(zone, now = Date.now()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(now));
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    return { h: Number(p.hour) % 24, m: Number(p.minute), s: Number(p.second), dayKey: `${p.year}-${p.month}-${p.day}` };
  } catch { return null; }
}

/** Minutes the zone is ahead of this device right now (negative = behind) */
export function zoneDiffMinutes(zone, now = Date.now()) {
  const z = zoneTime(zone, now);
  if (!z) return 0;
  const d = new Date(now);
  const local = d.getHours() * 60 + d.getMinutes();
  const localKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dayShift = z.dayKey === localKey ? 0 : z.dayKey > localKey ? 1440 : -1440;
  return z.h * 60 + z.m + dayShift - local;
}
