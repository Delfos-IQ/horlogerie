/**
 * i18n.js — Language, currency and theme preferences.
 *
 * Texts are written in Spanish in the code and wrapped in t('…'). The Spanish
 * text is the key: t() looks it up in the dictionary of the active language
 * and falls back to the Spanish text. {name} placeholders are filled from vars.
 *
 *   t('Hace {n} días', { n: 3 })  →  'Hace 3 días' | '3 days ago'
 *
 * Static HTML is translated once at boot by translateDOM(): any text node or
 * placeholder / aria-label / title / alt whose exact text is a key is replaced.
 * tools/check-i18n.mjs (CI) checks that every key used has an English entry.
 */
import en from './i18n/en.js';

const PREFS_KEY = 'rotor_prefs_v1';
const DICTS = { en };

export const LANGS = [
  { id: 'auto', label: 'Automático' },
  { id: 'es',   label: 'Español' },
  { id: 'en',   label: 'English' },
];
export const THEMES = [
  { id: 'auto',  label: 'Automático' },
  { id: 'light', label: 'Claro' },
  { id: 'dark',  label: 'Oscuro' },
];
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'MXN', 'BRL', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN'];

/** @returns {{ lang: string, theme: string, currency: string, onboarded?: boolean }} */
function readPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch {}
  return {
    lang:     ['auto', 'es', 'en'].includes(p.lang) ? p.lang : 'auto',
    theme:    ['auto', 'light', 'dark'].includes(p.theme) ? p.theme : 'auto',
    currency: CURRENCIES.includes(p.currency) ? p.currency : defaultCurrency(),
    onboarded: !!p.onboarded,
  };
}
function defaultCurrency() {
  const nl = (typeof navigator !== 'undefined' && navigator.language) || 'es-ES';
  const region = (nl.split('-')[1] || '').toUpperCase();
  return ({ US: 'USD', GB: 'GBP', CH: 'CHF', JP: 'JPY', MX: 'MXN', BR: 'BRL', CA: 'CAD',
            AU: 'AUD', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN' })[region] || 'EUR';
}

export const prefs = readPrefs();

export function setPref(key, value) {
  prefs[key] = value;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
  if (key === 'theme') applyTheme();
}

/** Active language: 'es' or 'en' */
export function lang() {
  if (prefs.lang !== 'auto') return prefs.lang;
  const nl = ((typeof navigator !== 'undefined' && navigator.language) || 'es').toLowerCase();
  // Spanish and the languages of Spain read the Spanish version; the rest, English
  return /^(es|gl|ca|eu)\b/.test(nl) ? 'es' : 'en';
}

/** BCP-47 locale for dates and numbers */
export function locale() {
  if (lang() === 'es') return 'es-ES';
  const nl = (typeof navigator !== 'undefined' && navigator.language) || '';
  return /^en\b/i.test(nl) ? nl : 'en-GB';
}

/** Translate a Spanish text into the active language */
export function t(s, vars) {
  const d = DICTS[lang()];
  let out = (d && d[s]) || s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

/** Money in the chosen currency (no conversion: amounts are stored as typed) */
export function money(v, { decimals } = {}) {
  const n = Number(v) || 0;
  const max = decimals ?? (Math.abs(n) < 10 ? 2 : 0);
  try {
    return n.toLocaleString(locale(), { style: 'currency', currency: prefs.currency,
      minimumFractionDigits: 0, maximumFractionDigits: max });
  } catch { return `${n.toFixed(max)} ${prefs.currency}`; }
}
export function currencySymbol() {
  try {
    const p = (0).toLocaleString(locale(), { style: 'currency', currency: prefs.currency, currencyDisplay: 'narrowSymbol' });
    return p.replace(/[\d\s., ]/g, '') || prefs.currency;
  } catch { return prefs.currency; }
}

/* ─── Theme ─── */
export function applyTheme() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (prefs.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = prefs.theme;
  const dark = prefs.theme === 'dark' ||
    (prefs.theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    if (prefs.theme === 'auto') m.setAttribute('content', m.media.includes('dark') ? '#0B1220' : '#F3EEE3');
    else m.setAttribute('content', dark ? '#0B1220' : '#F3EEE3');
  });
}

/* ─── Static HTML ─── */
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
export function translateDOM(root = document.body) {
  document.documentElement.lang = lang();
  if (lang() === 'es') return;
  const d = DICTS[lang()];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const raw = n.nodeValue, key = raw.trim();
    if (key && d[key]) n.nodeValue = raw.replace(key, d[key]);
  }
  root.querySelectorAll('[data-href-en]').forEach(a => a.setAttribute('href', a.dataset.hrefEn));
  root.querySelectorAll('*').forEach(el => {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && d[v.trim()]) el.setAttribute(a, d[v.trim()]);
    }
  });
}
