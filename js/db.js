/**
 * db.js — Local watch database (Chinese brands)
 * Loads watches_db.json and provides fast fuzzy search.
 * Used during "Add watch" to autocomplete specs from known models.
 */

let _db = [];
let _loaded = false;

async function dbLoad() {
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
function dbSearch(query, limit = 5) {
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
    .map(r => r.watch);
}

/** Get exact match by brand + model (for auto-filling specs after selection) */
function dbGet(brand, model) {
  const b = (brand || '').toLowerCase();
  const m = (model || '').toLowerCase();
  return _db.find(w =>
    w.brand.toLowerCase() === b &&
    (w.model.toLowerCase() === m || w.model.toLowerCase().includes(m))
  ) || null;
}

window.dbLoad   = dbLoad;
window.dbSearch = dbSearch;
window.dbGet    = dbGet;
