/**
 * db.js — Local watch database (Chinese brands)
 * Loads watches_db.json and provides fast fuzzy search.
 * Used during "Add watch" to autocomplete specs from known models.
 */

import { lang } from './i18n.js';

export let _db = [];
/** The entry in the active language: values come from its `en` / `pt` block (Spanish is the base) */
export function localize(w) {
  if (!w) return w;
  const l = lang(), loc = l !== 'es' ? w[l] : null;
  const out = { ...w };
  delete out.en; delete out.pt;
  if (!loc) return out;
  out.specs = { ...w.specs, ...(loc.specs || {}) };
  if (loc.notas) out.notas = loc.notas;
  if (w.price && loc.priceNote) out.price = { ...w.price, note: loc.priceNote };
  return out;
}
export let _loaded = false;

export async function dbLoad() {
  if (_loaded) return;
  try {
    const res = await fetch('./watches_db.json');
    if (res.ok) { _db = await res.json(); _loaded = true; }
  } catch { _db = []; }
}

/**
 * Search the local DB by brand + model text.
 * Returns up to `limit` matches sorted by relevance.
 */
export function dbSearch(query, limit = 5) {
  if (!query || !_db.length) return [];
  const q = query.toLowerCase().trim();
  const terms = q.split(/\s+/);

  return _db
    .map(w => {
      const text = `${w.brand} ${w.model} ${w.ref}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (text.includes(t)) score += t.length; // longer match = higher score
      }
      return { watch: w, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(r => localize(r.watch));
}

/** Get exact match by brand + model (for auto-filling specs after selection) */
export function dbGet(brand, model) {
  const b = (brand || '').toLowerCase();
  const m = (model || '').toLowerCase();
  return localize(_db.find(w =>
    w.brand.toLowerCase() === b &&
    (w.model.toLowerCase() === m || w.model.toLowerCase().includes(m))
  )) || null;
}

