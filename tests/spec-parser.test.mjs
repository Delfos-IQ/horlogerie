// Pruebas del lector de fichas sin IA (js/spec-parser.js).
// Uso: node tests/spec-parser.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseSpecs } = require('../js/spec-parser.js');

let ok = 0, ko = 0;
function expect(name, got, want) {
  const bad = Object.entries(want).filter(([k, v]) => v === undefined ? got[k] !== undefined : got[k] !== v);
  if (bad.length) { ko++; console.log(`  ✗ ${name}`); bad.forEach(([k, v]) => console.log(`      ${k}: ${JSON.stringify(got[k])} ≠ ${JSON.stringify(v)}`)); }
  else { ok++; console.log(`  ✓ ${name}`); }
}

// 1) Web oficial con tabla (lo que devuelve el Worker: celdas separadas por « | »)
expect('web oficial en español (tabla)', parseSpecs({
  title: 'SD1975S Tuna Diver — Steeldive Oficial',
  jsonld: { name: 'SD1975S Tuna Diver', brand: { name: 'Steeldive' }, mpn: 'SD1975S', offers: { price: '139.00', priceCurrency: 'EUR' } },
  text: [' | Movimiento | Seiko NH35 automático, 21600 bph, 24 rubíes', ' | Diámetro de la caja | 44 mm', ' | Cristal | Zafiro con tratamiento antirreflejos',
         ' | Resistencia al agua | 200 m', ' | Reserva de marcha | 41 h', ' | Material de la caja | Acero inoxidable 316L', ' | Ancho entre asas | 22 mm'].join('\n'),
}), { brand: 'Steeldive', model: 'SD1975S Tuna Diver', ref: 'SD1975S', precio: '139 €', calibre: 'Seiko NH35', type: 'automatic',
      movimiento: 'Automático · Seiko NH35 · 24 rubíes · 21 600 bph', diametro: '44 mm', cristal: 'Zafiro (antirreflejos)',
      resistencia: '200 m', reserva: '41 h', caja: 'Acero inoxidable 316L', asas: '22 mm', grosor: undefined });

// 2) Tienda Shopify (descripción en inglés con «Etiqueta: valor»), como la de Sugess
expect('Shopify en inglés (Sugess ST2130)', parseSpecs({ text: `
Specifications
Movement: Seagull ST2130 Mechanical, 21 jewels, 21600 bph
Case Size: 41mm
Thickness: 12mm
Crystal: Domed Sapphire with AR coating
Water Resistance: 30m, 3ATM
Power Reserve: 42 hours
Lug Width: 20mm
Case Material: 316L Stainless Steel
Strap: Genuine leather
Dial: Black` }), { calibre: 'Seagull ST2130', diametro: '41 mm', grosor: '12 mm', cristal: 'Zafiro abombado (antirreflejos)',
      resistencia: '30 m (3 ATM)', reserva: '42 h', asas: '20 mm', caja: 'Acero inoxidable 316L', brazalete: 'Piel', esfera: 'Negra',
      movimiento: 'Seagull ST2130 · 21 rubíes · 21 600 bph' });

// 3) Amazon copiado y pegado (tabla con tabuladores, cm y ATM)
expect('Amazon pegado (tabuladores, centímetros)', parseSpecs({ text: `Detalles del producto
Marca\tPagani Design
Número de modelo del artículo\tPD-1661
Tipo de cierre\tHebilla
Material de la caja\tAcero inoxidable
Diámetro de la caja\t4 Centímetros
Grosor de la caja\t12,5 Milímetros
Ancho de la banda\t20 Milímetros
Color de la esfera\tAzul
Resistencia al agua\t10 ATM
Movimiento\tAutomático` }), { brand: 'Pagani Design', ref: 'PD-1661', caja: 'Acero inoxidable', diametro: '40 mm', grosor: '12,5 mm',
      asas: '20 mm', esfera: 'Azul', resistencia: '100 m (10 ATM)', type: 'automatic', movimiento: 'Automático' });

// 4) Amazon en inglés con dobles espacios y caracteres invisibles
expect('Amazon en inglés (espacios y LRM)', parseSpecs({ text: `Case diameter  ‎41 Millimeters
Case Thickness  ‎11.8 Millimeters
Band width  ‎20 Millimeters
Dial window material type  ‎Sapphire
Water resistance depth  ‎100 Meters
Item model number  ‎SARB033` }), { diametro: '41 mm', grosor: '11,8 mm', asas: '20 mm', cristal: 'Zafiro', resistencia: '100 m', ref: 'SARB033' });

// 5) AliExpress (etiquetas raras)
expect('AliExpress', parseSpecs({ text: `Brand Name: CADISEN
Movement: Automatic Self-Wind
Dial Diameter: 39mm
Case Thickness: 11.5mm
Water Resistance Depth: 10Bar
Window Material Type: Sapphire Crystal
Band Material Type: Stainless Steel
Case Material: Stainless Steel` }), { brand: 'CADISEN', type: 'automatic', diametro: '39 mm', grosor: '11,5 mm', resistencia: '100 m (10 ATM)',
      cristal: 'Zafiro', brazalete: 'Acero', caja: 'Acero inoxidable' });

// 6) Portugués
expect('web en portugués', parseSpecs({ text: `Movimento: Miyota 8215 automático
Diâmetro: 40 mm
Espessura: 13 mm
Vidro: Safira
Resistência à água: 100 m
Pulseira: Couro` }), { calibre: 'Miyota 8215', type: 'automatic', diametro: '40 mm', grosor: '13 mm', cristal: 'Zafiro', resistencia: '100 m', brazalete: 'Piel' });

// 7) Descripción sin tabla (solo frases)
expect('descripción en frases', parseSpecs({ text:
  'Orient Bambino V2. Calibre F6724 automático con parada de segundero. Caja de acero de 38,4 mm, cristal mineral abombado y 30 m de resistencia al agua. Reserva de marcha de 40 horas.' }),
  { calibre: 'Orient F6724', type: 'automatic', diametro: '38,4 mm', cristal: 'Mineral abombado', resistencia: '30 m', reserva: '40 h' });

// 8) Lista de definición (etiqueta y valor en líneas distintas)
expect('etiqueta y valor en líneas distintas', parseSpecs({ text: `Calibre\nSellita SW200-1\nDiámetro\n42 mm\nCristal\nZafiro` }),
  { calibre: 'Sellita SW200-1', type: 'automatic', diametro: '42 mm', cristal: 'Zafiro' });

// 9) No inventa: sin datos, no hay campos; «lug to lug» y «peso» no se confunden
const empty = parseSpecs({ text: 'Envío gratis en 24 h. Devoluciones 30 días. Peso: 150 g. Lug to lug: 48 mm' });
expect('no inventa nada', empty, { diametro: undefined, grosor: undefined, asas: undefined, reserva: undefined, calibre: undefined, cristal: undefined });

// 10) Cada dato dice de qué línea sale
const ev = parseSpecs({ text: 'Water Resistance: 30m, 3ATM' });
expect('guarda la línea de origen', { from: ev._from.resistencia }, { from: 'Water Resistance: 30m, 3ATM' });

// 11) Cuarzo y cuerda manual
expect('cuarzo por palabra', parseSpecs({ text: 'Movement: Japanese quartz (Seiko VH31 sweep)' }), { type: 'quartz', calibre: 'Seiko VH31' });
expect('cuerda manual', parseSpecs({ text: 'Movimiento: Seagull ST3600 de cuerda manual' }), { type: 'manual', calibre: 'Seagull ST3600' });

// 12) English interface: same reading, values in English
const enSpec = `Case material: 316L stainless steel
Case diameter: 38,4 mm
Crystal: domed sapphire with anti-reflective coating
Strap: rubber
Dial colour: navy blue
Movement: Automatic, Seiko NH35, 24 jewels, hacking
Power reserve: 41 hours`;
expect('ficha en inglés para una app en inglés', parseSpecs({ text: enSpec, lang: 'en' }),
  { caja: 'Stainless steel 316L', diametro: '38.4 mm', cristal: 'Domed sapphire (anti-reflective)', brazalete: 'Rubber',
    esfera: 'Navy blue', reserva: '41 h', movimiento: 'Automatic · Seiko NH35 · 24 jewels · hacking seconds' });

// 13) Portuguese interface
expect('ficha en portugués para una app en portugués', parseSpecs({ text: enSpec, lang: 'pt' }),
  { caja: 'Aço inoxidável 316L', diametro: '38,4 mm', cristal: 'Safira abaulada (antirreflexo)', brazalete: 'Borracha',
    esfera: 'Azul-marinho', reserva: '41 h', movimiento: 'Automático · Seiko NH35 · 24 rubis · com paragem dos segundos' });

console.log(`--- ${ok}/${ok + ko} OK`);
process.exit(ko ? 1 : 0);
