// check-i18n.mjs — every Spanish text that the app shows must have an entry in every dictionary
// (js/i18n/en.js, js/i18n/pt.js…), with the same {placeholders}.
//
// Keys are collected from:
//   - t('…') / t("…") / t(`…`) in js/**  (template literals without ${…})
//   - notify('…') in the data layer (main.js translates what it shows)
//   - label: '…' / l: '…' in option tables (LANGS, THEMES, SPEC_DEFS…), passed to t() later
//   - text and placeholder / aria-label / title / alt in index.html (translated at start)
// Usage: node tools/check-i18n.mjs [--missing [lang]]   (--missing prints a JSON skeleton to fill, English by default)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DICTS = {};
for (const f of readdirSync(join(root, 'js/i18n')).filter(f => f.endsWith('.js'))) {
  DICTS[f.replace('.js', '')] = (await import(pathToFileURL(join(root, 'js/i18n', f)).href)).default;
}

const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (!['vendor', 'i18n'].includes(f)) walk(p); }
    else if (f.endsWith('.js')) files.push(p);
  }
})(join(root, 'js'));

const keys = new Map();   // key → first place seen
const add = (k, where) => { k = k.trim(); if (k && /\p{L}/u.test(k) && !keys.has(k)) keys.set(k, where); };
const unescape = s => s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n');

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const rel = f.slice(root.length + 1);
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) add(unescape(m[1]), rel);
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) add(unescape(m[1]), rel);
  for (const m of src.matchAll(/\bt\(\s*`([^`$]*)`/g)) add(m[1], rel);
  for (const m of src.matchAll(/\btk\(\s*'((?:[^'\\]|\\.)*)'/g)) add(unescape(m[1]), rel);
  for (const m of src.matchAll(/\bnotify\(\s*'((?:[^'\\]|\\.)*)'/g)) add(unescape(m[1]), rel);
  if (rel.startsWith('js/data')) for (const m of src.matchAll(/new Error\(\s*'((?:[^'\\]|\\.)*)'/g)) add(unescape(m[1]), rel);
  if (/modules|i18n\.js/.test(rel)) {
    for (const m of src.matchAll(/\b(?:label|l):\s*'((?:[^'\\]|\\.)*)'/g)) {
      if (!/^(English|Español|Português)$/.test(m[1])) add(unescape(m[1]), rel);
    }
  }
  if (rel.endsWith('url-import.js')) {   // IMPORT_LABELS and TYPE_LABELS
    for (const m of src.matchAll(/\b(?:automatic|quartz|manual|brand|model|ref|type|calibre|movimiento|cristal|diametro|grosor|resistencia|reserva|caja|brazalete|esfera|asas|precio|notas):\s*'([^']+)'/g)) add(m[1], rel);
  }
}

// index.html: visible text and translatable attributes (not inside <style>, <script>, <svg>)
const html = readFileSync(join(root, 'index.html'), 'utf8')
  .replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<head>[\s\S]*?<\/head>/, '');
for (const m of html.matchAll(/>([^<>]+)</g)) {
  const txt = m[1].replace(/&nbsp;/g, ' ').trim();
  if (txt && /\p{L}/u.test(txt)) add(txt, 'index.html');
}
for (const m of html.matchAll(/\s(?:placeholder|aria-label|title|alt)="([^"]+)"/g)) add(m[1], 'index.html');

const SAME = new Set(['Rotor', 'Rotor · Delfos-IQ', 'Ranking', 'pedicode.app@gmail.com', 'Berny, Pagani Design, Seiko...',
  'Berny, Pagani Design, San Martin...', 'Open Heart, PD-1651...', 'Open Heart, Diver 300...', 'AM5813L...',
  'AM5813L, PD-1651, SN0121...', 'Berny Open Heart, Pagani PD-1651...', 'K7Q-M4X  ·  7KQ2-M4XR-9TBW-2HNF', 'Rotor Pro', 'PRO']);
const placeholders = x => (x.match(/\{\w+\}/g) || []).sort().join(',');
let failed = false, total = 0;
const wanted = process.argv.includes('--missing') ? (process.argv[process.argv.indexOf('--missing') + 1] || 'en') : null;
for (const [lang, dict] of Object.entries(DICTS)) {
  const missing = [...keys.entries()].filter(([k]) => !(k in dict) && !SAME.has(k));
  if (wanted === lang) { console.log(JSON.stringify(Object.fromEntries(missing.map(([k]) => [k, ''])), null, 2)); process.exit(0); }
  const unused = Object.keys(dict).filter(k => !keys.has(k));
  const empty = Object.entries(dict).filter(([, v]) => !v).map(([k]) => k);
  const badPh = Object.entries(dict).filter(([k, v]) => v && placeholders(k) !== placeholders(v)).map(([k]) => k);
  if (unused.length) console.log(`(aviso) ${lang}: ${unused.length} entradas sin uso:`, unused.slice(0, 6).join(' | '));
  if (missing.length) {
    failed = true;
    console.log(`Faltan ${missing.length} textos en ${lang} (js/i18n/${lang}.js):`);
    for (const [k, w] of missing.slice(0, 30)) console.log(`  [${w}] ${k}`);
  }
  if (empty.length) { failed = true; console.log(`${lang}: traducciones vacías:`, empty.slice(0, 10).join(' | ')); }
  if (badPh.length) { failed = true; console.log(`${lang}: {marcadores} distintos del original:`, badPh.slice(0, 10).join(' | ')); }
  total++;
}
if (failed) process.exit(1);
console.log(`✓ ${keys.size} textos, todos traducidos en ${total} idiomas (${Object.keys(DICTS).join(', ')})`);
