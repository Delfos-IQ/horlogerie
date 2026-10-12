/**
 * data/moments.js — «Momentos» de cada reloj: para qué ocasión, con qué ánimo y en qué
 * estación apetece. Sirven para proponer el reloj del día según cómo te sientes, en vez
 * de imponer «el que toca».
 *
 * Los textos se marcan con tk() y se traducen con t() donde se muestran.
 */
import { tk } from '../i18n.js';

/** @type {{ id: string, label: string, items: { id: string, label: string, icon: string }[] }[]} */
export const MOMENT_GROUPS = [
  { id: 'occasion', label: tk('Ocasión'), items: [
    { id: 'trabajo',  label: tk('Trabajo'),           icon: 'ti-briefcase' },
    { id: 'evento',   label: tk('Cena o evento'),      icon: 'ti-glass-full' },
    { id: 'deporte',  label: tk('Deporte y aventura'), icon: 'ti-mountain' },
    { id: 'mar',      label: tk('Mar y piscina'),      icon: 'ti-ripple' },
    { id: 'viaje',    label: tk('Viaje'),              icon: 'ti-plane' },
    { id: 'finde',    label: tk('Fin de semana'),      icon: 'ti-coffee' },
  ] },
  { id: 'mood', label: tk('Ánimo'), items: [
    { id: 'clasico',  label: tk('Clásico'),  icon: 'ti-crown' },
    { id: 'atrevido', label: tk('Atrevido'), icon: 'ti-flame' },
    { id: 'discreto', label: tk('Discreto'), icon: 'ti-feather' },
    { id: 'vintage',  label: tk('Vintage'),  icon: 'ti-hourglass' },
  ] },
  { id: 'season', label: tk('Estación'), items: [
    { id: 'primavera', label: tk('Primavera'), icon: 'ti-plant' },
    { id: 'verano',    label: tk('Verano'),    icon: 'ti-sun' },
    { id: 'otono',     label: tk('Otoño'),     icon: 'ti-leaf' },
    { id: 'invierno',  label: tk('Invierno'),  icon: 'ti-snowflake' },
  ] },
];

export const MOMENTS = MOMENT_GROUPS.flatMap(g => g.items.map(i => ({ ...i, group: g.id })));
export const MOMENT_IDS = MOMENTS.map(m => m.id);
export const momentById = id => MOMENTS.find(m => m.id === id) || null;

/** Only known ids, no repeats, in the canonical order @param {unknown} v @returns {string[]} */
export function cleanMoments(v) {
  if (!Array.isArray(v)) return [];
  const set = new Set(v.filter(x => typeof x === 'string'));
  return MOMENT_IDS.filter(id => set.has(id));
}

/* Southern hemisphere by the region of the browser language (es-AR, pt-BR, en-AU…) */
const SOUTH = ['AR', 'AU', 'BO', 'BR', 'CL', 'NZ', 'PE', 'PY', 'UY', 'ZA'];

/** Season id for a date @param {number} [now] @param {string} [language] */
export function currentSeason(now = Date.now(), language = (typeof navigator !== 'undefined' && navigator.language) || '') {
  const m = new Date(now).getMonth();            // 0 = January
  const north = m <= 1 || m === 11 ? 'invierno' : m <= 4 ? 'primavera' : m <= 7 ? 'verano' : 'otono';
  const region = (language.split('-')[1] || '').toUpperCase();
  if (!SOUTH.includes(region)) return north;
  return { invierno: 'verano', verano: 'invierno', primavera: 'otono', otono: 'primavera' }[north];
}
