// check-sw.mjs — falla si algún módulo que importa la app no está en la lista
// SHELL de sw.js (sin él, la app no arrancaría sin conexión).
// Uso: node tools/check-sw.mjs
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const seen = new Set();
const missing = [];
(function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const rel = relative(root, file).replaceAll('\\', '/');
  if (!new RegExp('\\$\\{BASE\\}/' + rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\?v=[^`]*)?`').test(sw)) missing.push(rel);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) walk(join(dirname(file), m[1]));
})(join(root, 'js/main.js'));
if (missing.length) { console.log('Faltan en la lista SHELL de sw.js:', missing.join(', ')); process.exit(1); }
console.log(`✓ ${seen.size} módulos, todos en la caché sin conexión`);
