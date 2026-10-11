/**
 * spec-parser.js — lee la ficha técnica de un reloj a partir del texto de una página.
 *
 * Sin IA: solo copia lo que la página dice. Busca pares «etiqueta: valor»
 * (tablas, listas, «Movimiento: Seiko NH35…») en español, inglés, portugués,
 * francés, alemán e italiano, y si falta algo busca frases típicas
 * («caja de 41 mm», «100 m de resistencia al agua»). Cada dato guarda la
 * línea de la que sale (_from) para que el usuario pueda comprobarlo.
 *
 * Lo usa la app (texto pegado, o el texto que devuelve el Worker al leer un
 * enlace) y las pruebas de Node (tests/spec-parser.test.mjs).
 */
(function (root) {
  'use strict';

  /* ── Etiquetas → campo. El orden importa: la primera que encaja gana. ── */
  const LABELS = [
    ['asas',        /(lug\s*(width|size)|ancho\s*(de\s*|entre\s*)?(las\s*)?asas|entre\s*asas|anchura\s*(entre\s*asas|de\s*(la\s*)?correa)|band\s*width|strap\s*width|bracelet\s*width|ancho\s*(de\s*(la\s*)?)?(correa|banda)|largura\s*(d[ao]\s*)?(bracelete|pulseira|correia|entre)|bandanstoß|bandanstoss|entrecornes?|larghezza\s*(ansa|cinturino))/i],
    ['grosor',      /(thickness|grosor|espesor|espessura|altura\s*(de\s*la\s*)?caja|case\s*height|épaisseur|epaisseur|höhe|hoehe|dicke|spessore)/i],
    ['diametro',    /(diameter|di[aáâ]metro|diamètre|diametre|durchmesser|case\s*size|tama[ñn]o\s*(de\s*(la\s*)?)?caja|tamanho\s*(da\s*)?caixa|case\s*width|ancho\s*(de\s*la\s*)?caja|dial\s*size)/i],
    ['resistencia', /(water|agua|água|impermeab|estanque|étanch|etanch|wasserdicht|resist[eê]ncia|impermeabil)/i],
    ['reserva',     /(power\s*reserve|reserva|autonom|gangreserve|réserve|reserve\s*de\s*marche|riserva)/i],
    ['cristal',     /(crystal|cristal|glass|vidrio|vidro|verre|\bglas\b|cristallo|lens|window\s*material)/i],
    ['calibre',     /(calibre|caliber|kaliber|calibro|movement\s*(model|calibre|caliber|reference|ref\b)|modelo\s*(del?\s*)?(movimiento|mecanismo)|movement\s*brand)/i],
    ['movimiento',  /(movement|movimiento|movimento|mouvement|uhrwerk|mecanismo|mechanism|tipo\s*de\s*reloj|watch\s*type|tipo\s*de\s*movimiento)/i],
    ['caja',        /(case\s*material|material\s*(de\s*la\s*)?caja|material\s*da\s*caixa|^(case|caja|caixa|boîtier|boitier|gehäuse|cassa)$|matériau\s*du\s*boîtier|gehäusematerial)/i],
    ['brazalete',   /(band\s*material|strap\s*material|bracelet\s*material|band\s*type|strap\s*type|^(band|strap|bracelet)$|correa|brazalete|pulsera|pulseira|bracelete|correia|armband|cinturino|bracelet)/i],
    ['esfera',      /(^dial(\s*colou?r)?$|dial\s*colou?r|esfera|mostrador|cadran|zifferblatt|quadrante|colou?r\s*(de\s*(la\s*)?)?esfera|cor\s*do\s*mostrador)/i],
    ['brand',       /^(brand|marca|marque|marke|fabricante|manufacturer|brand\s*name)$/i],
    ['model',       /^(model|modelo|modèle|modell|modello|model\s*name|nombre\s*del\s*modelo|series|serie)$/i],
    ['ref',         /(^(ref(erence|erencia|erência|érence|erenz)?\.?(\s*(no|n[ºo°]|number|número))?|mpn|sku|c[óo]digo)$|model\s*number|n[úu]mero\s*de\s*(modelo|referencia)|n[ºo°]\s*de\s*modelo|part\s*number|referencia\s*del\s*fabricante)/i],
    ['precio',      /^(price|precio|preço|prix|preis|prezzo|pvp|precio\s*de\s*venta)$/i],
  ];
  const SKIP_LABEL = /(lug\s*to\s*lug|case\s*back|fondo|tapa|warranty|garant|shipping|env[ií]o|package|paquete|weight|peso|gewicht|poids|clasp|cierre|fecho|buckle|hebilla|length|longitud|comprimento|rating|valoraci|review|opini)/i;

  /* ── Calibres conocidos (para separar el calibre del texto del movimiento) ── */
  const CALIBRES = [
    [/\b(?:seiko\s*|tmi\s*|sii\s*)?(NH3[4-9]A?|NH7[0-2]A?|4R3[5-9]A?|6R\d{2}A?|7S2[6-9]|VK6[1-8]A?|VH3[1-9]A?|VD5\d|PC21|PC32)\b/i, m => `Seiko ${m[1].toUpperCase()}`],
    [/\bmiyota\s*(\d{4}|82S\d|9\d{3}|1L45|6P\d{2}|0S\d{2})\b/i, m => `Miyota ${m[1].toUpperCase()}`],
    [/\beta\s*(\d{4}(?:-\d)?|C07\.\d{3})\b/i, m => `ETA ${m[1].toUpperCase()}`],
    [/\b(?:sellita\s*)?SW\s?(\d{3}(?:-\d)?)\b/i, m => `Sellita SW${m[1]}`],
    [/\b(?:sea-?gull\s*|tianjin\s*)?ST\s?(\d{4}|\d{2}-\d{2,4})\b/i, m => `Seagull ST${m[1]}`],
    [/\b(PT5000|PT-5000)\b/i, () => 'PT5000'],
    [/\b(F6[7-9]\d{2})\b/, m => `Orient ${m[1]}`],
    [/\bronda\s*(\d{3,4}(?:\.\d)?\w?)\b/i, m => `Ronda ${m[1]}`],
    [/\bhangzhou\s*(\d{4}\w?)\b/i, m => `Hangzhou ${m[1].toUpperCase()}`],
    [/\b(DG\s?\d{4})\b/i, m => m[1].toUpperCase().replace(/\s/, '')],
  ];
  const CAL_TYPE = [
    [/NH3|NH7|4R3|6R|7S2|Miyota (8|9|82S)|ETA 2[0-9]|ETA 7750|Sellita|PT5000|Orient F6|Hangzhou|DG\d/i, 'automatic'],
    [/VK6|VH3|VD5|PC21|PC32|Miyota (0S|1L|2|6P)|Ronda/i, 'quartz'],
  ];

  const TYPES = [
    ['manual',    /(hand[-\s]?wind|hand[-\s]?wound|manual[-\s]?wind|cuerda\s*manual|carga\s*manual|corda\s*manual|remontage\s*manuel|handaufzug|carica\s*manuale)/i],
    ['automatic', /(autom[aá]tic|automatique|automatik|automatico|self[-\s]?wind|auto[-\s]?wind|autoremontaje|carga\s*autom|kinetic)/i],
    ['quartz',    /(quartz|cuarzo|quartzo|quarz|quarzo)/i],
  ];

  /* ── Traducciones de valores frecuentes ── */
  const WORDS = {
    crystal: [[/sapphire|zafiro|safira|saphir|zaffiro/i, 'Zafiro'], [/hardlex/i, 'Hardlex'], [/mineral/i, 'Mineral'],
              [/hesalite|acr[yí]lic|acr[ií]lico|plexi|acrylique|acrilico/i, 'Acrílico']],
    caseMat: [[/titan/i, 'Titanio'], [/bronze|bronce|cusn8/i, 'Bronce'], [/ceramic|cer[áa]mic/i, 'Cerámica'],
              [/stainless|inoxidable|inoxid[aá]vel|inox|edelstahl|acier|acciaio|\b316l?\b|steel|acero|aço/i, 'Acero inoxidable'],
              [/brass|lat[óo]n|lat[ãa]o/i, 'Latón'], [/alloy|aleaci[óo]n|liga/i, 'Aleación'], [/carbon/i, 'Carbono']],
    strap:   [[/leather|piel|cuero|couro|leder|cuir|pelle/i, 'Piel'], [/rubber|caucho|borracha|kautschuk|fkm/i, 'Caucho'],
              [/silicon/i, 'Silicona'], [/nato|nylon|nailon|fabric|tela|canvas/i, 'Nailon (NATO)'],
              [/mesh|malla|milanese|milan[eé]s/i, 'Malla'],
              [/stainless|steel|acero|aço|metal|edelstahl|oyster|jubilee/i, 'Acero']],
    color:   { black: 'negra', white: 'blanca', blue: 'azul', green: 'verde', silver: 'plateada', grey: 'gris', gray: 'gris',
               brown: 'marrón', red: 'roja', champagne: 'champán', gold: 'dorada', golden: 'dorada', yellow: 'amarilla',
               orange: 'naranja', purple: 'morada', pink: 'rosa', salmon: 'salmón', cream: 'crema', ivory: 'marfil',
               skeleton: 'esqueletada', sunburst: 'rayos de sol', navy: 'azul marino', teal: 'verde azulado',
               dial: '', with: 'con', and: 'y' },
  };

  /* ── Utilidades ── */
  const clean = s => String(s || '').replace(/[‎‏  ]/g, ' ').replace(/\s+/g, ' ').trim();
  const num = s => String(s).replace(',', '.');
  const fmtNum = n => { const r = Math.round(n * 100) / 100; return String(r).replace('.', ','); };
  const pick = (v, table) => { for (const [re, out] of table) if (re.test(v)) return out; return null; };
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  function mm(v, min, max) {
    let m = v.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:mm\b|millimet|milímet|milimet|millimèt)/i);
    if (m) { const n = +num(m[1]); return n >= min && n <= max ? `${fmtNum(n)} mm` : null; }
    m = v.match(/(\d(?:[.,]\d{1,2})?)\s*(?:cm\b|centimet|centímet)/i);
    if (m) { const n = +num(m[1]) * 10; return n >= min && n <= max ? `${fmtNum(n)} mm` : null; }
    m = v.match(/^\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*$/);
    if (m) { const n = +num(m[1]); return n >= min && n <= max ? `${fmtNum(n)} mm` : null; }
    return null;
  }
  function water(v) {
    const mt  = v.match(/(\d{2,4})\s*(?:m\b|mts?\b|meters?|metros?|metres?|mètres?|meter\b)/i);
    const atm = v.match(/(\d{1,3}(?:[.,]\d)?)\s*(?:atm|bar)\b/i);
    const ft  = v.match(/(\d{2,4})\s*(?:ft|feet|pies)\b/i);
    if (mt && atm) return `${mt[1]} m (${fmtNum(+num(atm[1]))} ATM)`;
    if (mt)  return `${mt[1]} m`;
    if (atm) { const a = +num(atm[1]); return `${fmtNum(a * 10)} m (${fmtNum(a)} ATM)`; }
    if (ft)  return `${Math.round(+ft[1] * 0.3048 / 10) * 10} m`;
    return null;
  }
  function hours(v) {
    const m = v.match(/(\d{2,3})\s*(?:h\b|hrs?\b|hours?|horas?|heures?|stunden|ore\b)/i);
    return m && +m[1] >= 20 && +m[1] <= 300 ? `${m[1]} h` : null;
  }
  function crystal(v) {
    const base = pick(v, WORDS.crystal);
    if (!base) return clean(v).slice(0, 60);
    const ar = /anti[-\s]?(reflect|glare)|\bAR\b|antirreflej|antirrefle|antireflet|entspiegel/i.test(v);
    const dome = /dom|abomb|bomb[ée]|curv/i.test(v);
    return base + (dome ? ' abombado' : '') + (ar ? ' (antirreflejos)' : '');
  }
  function caseMat(v) {
    const base = pick(v, WORDS.caseMat);
    if (!base) return clean(v).slice(0, 60);
    const grade = v.match(/\b(316L|904L|304|Grade\s*\d|CuSn8)\b/i);
    return grade && !base.includes(grade[1]) ? `${base} ${grade[1].replace(/grade/i, 'grado')}` : base;
  }
  function strap(v) { return pick(v, WORDS.strap) || clean(v).slice(0, 60); }
  function dialColor(v) {
    const t = clean(v);
    const words = t.toLowerCase().split(/[\s,/]+/).filter(Boolean);
    if (words.length <= 4 && words.every(w => w in WORDS.color)) {
      const out = words.map(w => WORDS.color[w]).filter(Boolean).join(' ');
      return out ? cap(out) : t;
    }
    return t.slice(0, 60);
  }
  function findCalibre(v) {
    for (const [re, f] of CALIBRES) { const m = v.match(re); if (m) return f(m); }
    return null;
  }
  function findType(v) { return pick(v, TYPES.map(([t, re]) => [re, t])); }
  function typeFromCalibre(cal) { return cal ? pick(cal, CAL_TYPE) : null; }
  const TYPE_ES = { automatic: 'Automático', quartz: 'Cuarzo', manual: 'Cuerda manual' };

  function movementText(v) {
    const parts = [];
    const t = findType(v); if (t) parts.push(TYPE_ES[t]);
    const cal = findCalibre(v); if (cal) parts.push(cal);
    const jw = v.match(/(\d{1,2})\s*(?:jewels?|rub[ií]s?|rub[ií]es|joyas|rubis|steine|rubini)/i); if (jw) parts.push(`${jw[1]} rubíes`);
    const bph = v.match(/(\d{2})[.,\s]?(\d{3})\s*(?:bph|a\/h|vph|alt\/h|oscil)/i); if (bph) parts.push(`${bph[1]} ${bph[2]} bph`);
    else { const hz = v.match(/(\d(?:[.,]\d)?)\s*hz\b/i); if (hz) parts.push(`${num(hz[1]).replace('.', ',')} Hz`); }
    if (/hack/i.test(v)) parts.push('con parada de segundero');
    return parts.length ? parts.join(' · ') : clean(v).slice(0, 80);
  }

  /* ── Normaliza el valor según el campo ── */
  function normalize(field, v) {
    v = clean(v);
    if (!v || v.length > 300) return null;
    switch (field) {
      case 'diametro':    return mm(v, 20, 60);
      case 'grosor':      return mm(v, 4, 25);
      case 'asas':        return mm(v, 10, 30);
      case 'resistencia': return water(v) || (/resist|resistant|resistente/i.test(v) ? cap(v.slice(0, 40)) : null);
      case 'reserva':     return hours(v);
      case 'cristal':     return crystal(v);
      case 'caja':        return caseMat(v);
      case 'brazalete':   return strap(v);
      case 'esfera':      return dialColor(v);
      case 'calibre':     return findCalibre(v) || v.slice(0, 40);
      case 'movimiento':  return movementText(v);
      case 'brand': case 'model': case 'ref': return v.slice(0, 60);
      case 'precio':      return price(v);
      default:            return v.slice(0, 80);
    }
  }
  function price(v, currency = '') {
    const m = String(v).match(/(\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})?|\d+(?:\.\d{1,2})?)/);
    if (!m) return null;
    let n = m[1];
    if (/,\d{1,2}$/.test(n)) n = n.replace(/[.\s]/g, '').replace(',', '.'); else n = n.replace(/[\s]/g, '');
    if (/\.\d{3}$/.test(n)) n = n.replace(/\./g, '');
    const val = +n; if (!val) return null;
    const cur = currency || (/(€|eur)/i.test(v) ? 'EUR' : /(\$|usd)/i.test(v) ? 'USD' : /(£|gbp)/i.test(v) ? 'GBP' : 'EUR');
    const s = fmtNum(Math.round(val * 100) / 100);
    return cur === 'USD' ? `${s} $` : cur === 'GBP' ? `${s} £` : `${s} €`;
  }

  /* ── Pares etiqueta/valor a partir de líneas ── */
  function labelField(label) {
    const l = clean(label).replace(/[:：\-–]+$/, '').trim();
    if (!l || l.length > 48 || SKIP_LABEL.test(l)) return null;
    for (const [field, re] of LABELS) if (re.test(l)) return field;
    return null;
  }
  function pairsFrom(text) {
    const lines = String(text).replace(/\r/g, '').split('\n').map(l => l.replace(/[‎‏]/g, '').trim()).filter(Boolean);
    const pairs = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Celdas de tabla (« | a | b ») o tabuladores (tablas copiadas)
      const cells = line.split(/\s*\|\s*|\t+/).map(clean).filter(Boolean);
      if (cells.length >= 2 && cells.length <= 4 && labelField(cells[0])) { pairs.push([cells[0], cells.slice(1).join(' '), line]); continue; }
      // «Etiqueta: valor»
      const m = line.match(/^[•·\-–*\s]*([^:：]{2,48})[:：]\s*(.+)$/);
      if (m && labelField(m[1])) { pairs.push([m[1], m[2], line]); continue; }
      // Etiqueta sola y el valor en la línea siguiente (listas de definición, fichas copiadas)
      if (labelField(line) && !line.includes(':') && i + 1 < lines.length && !labelField(lines[i + 1]) && lines[i + 1].length < 120) {
        pairs.push([line, lines[i + 1], `${line}: ${lines[i + 1]}`]); i++; continue;
      }
      // «Etiqueta   valor» de Amazon (etiqueta conocida seguida de 2+ espacios)
      const a = line.match(/^(.{2,48}?)\s{2,}(.+)$/);
      if (a && labelField(a[1])) pairs.push([a[1], a[2], line]);
    }
    return pairs;
  }

  /* ── Frases sueltas (descripciones sin tabla) ── */
  const FREE = [
    ['diametro',    /(?:case|caja|caixa|diameter|di[aá]metro|di[âa]metro|bo[îi]tier)[^\d\n]{0,25}(\d{2}(?:[.,]\d{1,2})?)\s*mm/i, m => mm(m[1] + ' mm', 20, 60)],
    ['diametro',    /(\d{2}(?:[.,]\d{1,2})?)\s*mm\s*(?:case|caja|caixa|de\s*di[aá]metro|diameter|de\s*caja|stainless)/i, m => mm(m[1] + ' mm', 20, 60)],
    ['grosor',      /(?:thickness|grosor|espesor|espessura|thick)[^\d\n]{0,20}(\d{1,2}(?:[.,]\d{1,2})?)\s*mm/i, m => mm(m[1] + ' mm', 4, 25)],
    ['grosor',      /(\d{1,2}(?:[.,]\d{1,2})?)\s*mm\s*(?:thick|de\s*grosor|de\s*espesor|de\s*espessura)/i, m => mm(m[1] + ' mm', 4, 25)],
    ['asas',        /(?:lug\s*width|entre\s*asas|ancho\s*de\s*asas|strap\s*width|band\s*width)[^\d\n]{0,15}(\d{2})\s*mm/i, m => mm(m[1] + ' mm', 10, 30)],
    ['asas',        /(\d{2})\s*mm\s*(?:lug|entre\s*asas|de\s*asas|strap|band)/i, m => mm(m[1] + ' mm', 10, 30)],
    ['resistencia', /(\d{2,4})\s*(?:m\b|meters?|metros?|metres?)[^\n]{0,20}(?:water|agua|água|wr\b|étanch)/i, m => water(m[0])],
    ['resistencia', /(?:water[-\s]?resist\w*|resistencia\s*al\s*agua|resistente\s*al\s*agua|resistência\s*à\s*água|wr)[^\d\n]{0,30}(\d{2,4}\s*(?:m\b|meters?|metros?)|\d{1,3}\s*(?:atm|bar))/i, m => water(m[1])],
    ['resistencia', /\b(\d{1,3})\s*(?:atm|bar)\b/i, m => water(m[0])],
    ['reserva',     /(\d{2,3})\s*(?:h\b|hours?|horas?|hrs?)[^\n]{0,25}(?:reserv|autonom)/i, m => hours(m[0])],
    ['reserva',     /(?:power\s*reserve|reserva\s*de\s*marcha|reserva)[^\d\n]{0,25}(\d{2,3}\s*(?:h\b|hours?|horas?|hrs?))/i, m => hours(m[1])],
    ['cristal',     /(sapphire|zafiro|safira|saphir)(?:\s+(?:crystal|cristal|glass|vidro))?|(?:cristal|vidro|verre)\s+de\s+(zafiro|safira|saphir)/i, m => crystal(m[0] + ' ' + (m.input.slice(m.index, m.index + 80)))],
    ['cristal',     /(mineral|hardlex|acr[yí]lic\w*|hesalite)\s*(?:crystal|cristal|glass|vidro)|(?:cristal|vidro)\s*(mineral|acr[ií]lico)/i, m => crystal(m.input.slice(m.index, m.index + 50))],
  ];

  /**
   * parseSpecs({ text, title, jsonld, hostname })
   * → { brand, model, ref, type, precio, calibre, movimiento, cristal, diametro,
   *     grosor, resistencia, reserva, caja, brazalete, esfera, asas, _from: {campo: línea} }
   */
  function parseSpecs({ text = '', title = '', jsonld = null } = {}) {
    const out = {}; const from = {};
    const pretty = l => clean(String(l || '').replace(/^\s*\|\s*/, '').replace(/\s*\|\s*|\t+/, ': ').replace(/\s*\|\s*|\t+/g, ' · '));
    const set = (k, v, line) => { if (v && !out[k]) { out[k] = v; from[k] = pretty(line).slice(0, 120); } };

    // 1) Datos estructurados (JSON-LD de la tienda o la marca)
    if (jsonld) {
      const brand = typeof jsonld.brand === 'string' ? jsonld.brand : jsonld.brand?.name;
      if (brand) set('brand', clean(brand), `Marca: ${brand}`);
      if (jsonld.name) {
        let model = clean(jsonld.name);
        if (brand && model.toLowerCase().startsWith(brand.toLowerCase())) model = model.slice(brand.length).trim();
        set('model', model.slice(0, 60), `Nombre: ${jsonld.name}`);
      }
      const ref = jsonld.mpn || jsonld.model || jsonld.sku;
      if (ref && typeof ref === 'string' && ref.length <= 30) set('ref', clean(ref), `Referencia: ${ref}`);
      const offer = [].concat(jsonld.offers || [])[0] || {};
      const pr = offer.price ?? offer.lowPrice;
      if (pr) set('precio', price(String(pr), offer.priceCurrency || ''), `Precio: ${pr} ${offer.priceCurrency || ''}`);
      [].concat(jsonld.additionalProperty || []).forEach(p => {
        const f = p?.name && labelField(p.name);
        if (f) set(f, normalize(f, String(p.value ?? '')), `${p.name}: ${p.value}`);
      });
    }

    // 2) Pares etiqueta/valor
    const body = [text, jsonld?.description ? String(jsonld.description) : ''].join('\n');
    for (const [label, value, line] of pairsFrom(body)) {
      const f = labelField(label);
      if (!f) continue;
      set(f, normalize(f, value), line);
      // El movimiento suele traer también el calibre y el tipo
      if (f === 'movimiento' || f === 'calibre') {
        set('calibre', findCalibre(value), line);
        set('type', findType(value), line);
      }
    }

    // 3) Frases sueltas para lo que falte
    const flat = body.replace(/\n+/g, '\n');
    for (const [f, re, fn] of FREE) {
      if (out[f]) continue;
      const m = flat.match(re);
      if (m) { const v = fn(m); const ln = (flat.slice(0, m.index).split('\n').pop() + flat.slice(m.index).split('\n')[0]); set(f, v, ln); }
    }
    if (!out.calibre) { const c = findCalibre(flat); if (c) set('calibre', c, lineWith(flat, c.split(' ').pop())); }
    if (!out.type) {
      const t = findType([out.movimiento, out.calibre, title, flat.slice(0, 4000)].filter(Boolean).join(' '));
      if (t) set('type', t, out.movimiento ? `Movimiento: ${out.movimiento}` : lineWith(flat, t === 'quartz' ? /quar|cuarzo/i : t === 'manual' ? /manual|hand/i : /autom|self/i));
      else { const t2 = typeFromCalibre(out.calibre); if (t2) set('type', t2, `Calibre ${out.calibre}`); }
    }
    if (!out.movimiento && (out.calibre || out.type)) {
      const parts = [out.type && TYPE_ES[out.type], out.calibre].filter(Boolean);
      const jw = flat.match(/(\d{1,2})\s*(?:jewels?|rub[ií]es|rubis|joyas)/i); if (jw) parts.push(`${jw[1]} rubíes`);
      const bph = flat.match(/(\d{2})[.,\s]?(\d{3})\s*(?:bph|a\/h|vph)/i); if (bph) parts.push(`${bph[1]} ${bph[2]} bph`);
      if (parts.length > 1 || jw || bph) set('movimiento', parts.join(' · '), from.calibre || from.type || '');
    }
    // Marca y modelo desde el título si no había datos estructurados
    if (!out.model && title) set('model', clean(title).split(/\s[|–—-]\s/)[0].slice(0, 60), `Título: ${title}`);

    for (const k of Object.keys(out)) if (out[k] == null || out[k] === '') { delete out[k]; delete from[k]; }
    out._from = from;
    return out;
  }
  function lineWith(text, needle) {
    const re = needle instanceof RegExp ? needle : new RegExp(String(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return (text.split('\n').find(l => re.test(l)) || '').slice(0, 120);
  }

  const api = { parseSpecs, pairsFrom, normalize, findCalibre, findType };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, { parseSpecs, SpecParser: api });
})(typeof window !== 'undefined' ? window : globalThis);
