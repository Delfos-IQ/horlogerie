/**
 * data/families.js — «Familia» of each watch: the usual types every collector knows.
 * Fixed list (no custom families): one per watch, used to filter the collection.
 * Rotor only PROPOSES one from the brand, model and water resistance; the user decides.
 */
/* Marks text for translation (tools/check-i18n.mjs finds it); translated with t() where shown.
   Kept local so the data layer does not depend on i18n.js. */
const tk = s => s;

/** @type {{ id: string, label: string, icon: string, color: string, hint?: string }[]} */
export const FAMILIES = [
  { id: 'diver',  label: tk('Buceo'),       icon: 'ti-ripple',       color: '#4FC3F7' },
  { id: 'chrono', label: tk('Cronógrafo'),  icon: 'ti-stopwatch',    color: '#EF9A9A' },
  { id: 'gmt',    label: tk('GMT'),         icon: 'ti-world',        color: '#80CBC4' },
  { id: 'pilot',  label: tk('Piloto'),      icon: 'ti-plane',        color: '#FFB74D' },
  { id: 'field',  label: tk('Campo'),       icon: 'ti-mountain',     color: '#AED581' },
  { id: 'dress',  label: tk('Vestir'),      icon: 'ti-tie',          color: '#F48FB1' },
  { id: 'sport',  label: tk('Deportivo'),   icon: 'ti-run',          color: '#A5D6A7' },
  // «CUCO»: the watch for everything. id stays 'other' so saved data keeps working
  { id: 'other',  label: tk('CUCO'),        icon: 'ti-infinity',     color: '#C9BFAE', hint: tk('Cualquier uso, cualquier ocasión') },
];
export const FAMILY_IDS = FAMILIES.map(f => f.id);
export const familyById = id => FAMILIES.find(f => f.id === id) || null;
/** A known family id, or null @param {unknown} v */
export const cleanFamily = v => (typeof v === 'string' && FAMILY_IDS.includes(v) ? v : null);

/* Whole words only: «sea» must not match «Seagull», nor «air» «Airking» */
/** @type {[string, string[]][]} */
const RULES = [
  ['gmt',    ['gmt', 'dual time', 'world time', 'worldtimer', 'world timer']],
  ['chrono', ['chrono', 'chronograph', 'cronografo', 'cronógrafo', 'chronographe', 'speedmaster', 'daytona', 'valjoux', 'vk63', 'vk64', '1963']],
  ['diver',  ['diver', 'divers', 'dive', 'submariner', 'sub', 'tuna', 'seamaster', 'sea-dweller', 'prospex', 'marinemaster', 'turtle', 'samurai', 'fathom', 'fifty fathoms', 'triton', 'kamasu', 'mako', 'aquis', 'black bay', 'skx', 'scuba', 'deep sea']],
  ['pilot',  ['pilot', 'pilots', 'flieger', 'aviator', 'aviation', 'navitimer', 'b-uhr', 'big pilot']],
  ['field',  ['field', 'khaki', 'explorer', 'military', 'militar', 'campo', 'hamilton khaki']],
  ['dress',  ['dress', 'presage', 'bambino', 'calatrava', 'patrimony', 'slim', 'ultra thin', 'tank', 'open heart', 'cocktail']],
  ['sport',  ['royal oak', 'nautilus', 'prx', 'aquanaut', 'overseas', 'tissot prx', 'integrated']],
];
const words = s => ` ${String(s || '').toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, ' ')} `;

/** Proposed family for a watch (or null if nothing points to one) @param {{ brand?: string, model?: string, specs?: Record<string, string> }} w */
export function guessFamily(w) {
  const text = words(`${w.brand || ''} ${w.model || ''} ${w.specs?.calibre || ''}`);
  for (const [id, kws] of RULES) if (kws.some(k => text.includes(` ${k} `))) return id;
  const wr = parseInt(String(w.specs?.resistencia || '').replace(/\D+/g, ' ').trim().split(' ')[0], 10);
  if (wr >= 200) return 'diver';            // 200 m or more: almost always a diver
  return null;
}
