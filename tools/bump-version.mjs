#!/usr/bin/env node
/**
 * bump-version.mjs — version.json es la única fuente de la versión.
 *
 * Uso:
 *   node tools/bump-version.mjs 2.1.3 "Notas de la versión"   → fija versión y la propaga
 *   node tools/bump-version.mjs                                → propaga la versión actual de version.json
 *   node tools/bump-version.mjs --check                        → falla si algún archivo no coincide
 *
 * Archivos que actualiza:
 *   - version.json                 (version, date, notes)
 *   - js/modules/updates.js        (const APP_VERSION)
 *   - index.html                   (?v= de los CSS/JS locales)
 *   - sw.js                        (nombre de la caché y ?v= de la lista SHELL)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = f => join(ROOT, f);
const read = f => readFileSync(p(f), 'utf8');

const args  = process.argv.slice(2);
const check = args.includes('--check');
const [newVersion, notes] = args.filter(a => a !== '--check');

const vjson = JSON.parse(read('version.json'));
if (newVersion) {
  if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
    console.error(`Versión no válida: "${newVersion}" (formato esperado: 2.1.3)`);
    process.exit(1);
  }
  vjson.version = newVersion;
  vjson.date    = new Date().toISOString().slice(0, 10);
  if (notes) vjson.notes = notes;
}
const V = vjson.version;

// Each rule: [file, regex, replacement]
const rules = [
  ['js/modules/updates.js', /const APP_VERSION = '[^']*';/, `const APP_VERSION = '${V}';`],
  ['index.html', /(href|src)="(\.\/(?:css|js)\/[^"?]+\.(?:css|js))\?v=[^"]*"/g, `$1="$2?v=${V}"`],
  ['sw.js', /const CACHE\s*=\s*'[^']*';/, `const CACHE   = 'horlogerie-v${V}';`],
  ['sw.js', /(\$\{BASE\}\/(?:css|js)\/[^`?]+\.(?:css|js))\?v=[^`]*`/g, `$1?v=${V}\``],
];

let mismatches = 0;
const out = {};
for (const [file, re, rep] of rules) {
  const before = out[file] ?? read(file);
  if (!re.test(before)) { console.error(`✗ ${file}: no encuentro el patrón ${re}`); process.exit(1); }
  re.lastIndex = 0;
  const after = before.replace(re, rep);
  if (after !== before) mismatches++;
  out[file] = after;
}

if (check) {
  if (mismatches) {
    console.error(`✗ Versión desalineada con version.json (${V}). Ejecuta: node tools/bump-version.mjs`);
    process.exit(1);
  }
  console.log(`✓ Todo en ${V}`);
  process.exit(0);
}

writeFileSync(p('version.json'), JSON.stringify(vjson, null, 2) + '\n');
for (const [file, content] of Object.entries(out)) writeFileSync(p(file), content);
console.log(`✓ Versión ${V} propagada a version.json, updates.js, index.html y sw.js`);
