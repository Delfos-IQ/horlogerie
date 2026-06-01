/**
 * Cloudflare Worker — Horlogerie API v7
 * Worker URL: https://horlogerie.pedicode-app.workers.dev
 *
 * ARCHITECTURE: 2-source parallel strategy
 *
 *   SOURCE A — Groq compound-beta (LLM with native web search)
 *     → Searches the real web, extracts specs from actual product pages,
 *       manufacturer sites, eBay listings, watch forums, Amazon, AliExpress mirrors.
 *     → Works for ALL brands: Swiss luxury, Chinese (Berny, Pagani, San Martin...),
 *       Japanese (Seiko, Casio...), and obscure microbrands.
 *     → If the model cannot find real data it returns empty strings — never invents.
 *
 *   SOURCE B — eBay Browse API (real market prices)
 *     → Returns actual sold/listed prices from eBay.
 *     → Especially powerful for Chinese brands that flood eBay with detailed listings.
 *     → Token cached in KV for 2h.
 *     → Free. Register at developer.ebay.com → Production keys → no approval needed.
 *
 * Secrets (Cloudflare dashboard → Workers → Settings → Variables and Secrets):
 *   GROQ_API_KEY  — required  (console.groq.com, free)
 *   EBAY_APP_ID   — optional  (developer.ebay.com, free)
 *   EBAY_CERT_ID  — optional  (developer.ebay.com, free)
 *
 * KV Binding:
 *   HORLOGERIE_KV — KV namespace (cloud sync + eBay token cache)
 *
 * Routes:
 *   POST /identify    — 2-pass watch photo ID (Groq Scout vision)
 *   POST /details     — Specs from web search + eBay prices
 *   POST /sync/push   — Save collection to KV
 *   GET  /sync/pull   — Load collection from KV
 *   DELETE /sync/clear
 *   GET  /health
 */

const CORS_ORIGIN    = '*';
const MODEL_VISION   = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MODEL_COMPOUND = 'compound-beta';   // Groq model with native web search
const MODEL_FALLBACK = 'meta-llama/llama-4-scout-17b-16e-instruct'; // if compound unavailable

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(null, 204);
    if (!env.GROQ_API_KEY) return cors({ error: 'GROQ_API_KEY not configured.' }, 500);

    const url = new URL(request.url);
    try {
      if (url.pathname === '/identify'   && request.method === 'POST')   return await handleIdentify(request, env);
      if (url.pathname === '/details'    && request.method === 'POST')   return await handleDetails(request, env);
      if (url.pathname === '/sync/push'  && request.method === 'POST')   return await handleSyncPush(request, env);
      if (url.pathname === '/sync/pull'  && request.method === 'GET')    return await handleSyncPull(request, env);
      if (url.pathname === '/sync/clear' && request.method === 'DELETE') return await handleSyncClear(request, env);
      if (url.pathname === '/' || url.pathname === '/health')
        return cors({ status: 'ok', version: '7.0', kv: !!env.HORLOGERIE_KV, ebay: !!(env.EBAY_APP_ID) }, 200);
      return cors({ error: 'Not found' }, 404);
    } catch (e) {
      console.error('[worker]', e.message);
      return cors({ error: e.message }, 500);
    }
  }
};

/* ═══════════════════════════════════════════════════════════
   /identify — 2-pass photo identification
   Pass 1: Scout Vision  → extract all visual evidence
   Pass 2: Scout text    → reason to brand/model/ref
═══════════════════════════════════════════════════════════ */
async function handleIdentify(request, env) {
  const { image, mediaType } = await request.json();
  if (!image) return cors({ error: 'Missing image' }, 400);

  // Pass 1 — visual evidence extraction
  const p1 = await groqCall(env, MODEL_VISION, [{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: `data:${mediaType};base64,${image}` } },
      { type: 'text', text: `You are an expert watch analyst. Study this watch photo with maximum attention.

Extract EVERY visible detail precisely:
1. DIAL TEXT: Quote EXACTLY every word, number, logo, brand name visible on the dial
2. HANDS: Shape (sword/baton/dauphine/lollipop/Mercedes/skeleton), color, luminous?
3. HOUR MARKERS: Shape (baton/Arabic/Roman/dot), applied or printed, color
4. BEZEL: Type (smooth/fluted/rotating/tachymeter/ceramic), markings, color
5. CASE: Shape, crown guards, screw-down crown, pushers visible?
6. BRACELET/STRAP: Type (oyster/jubilee/leather/rubber/NATO), color, clasp
7. COMPLICATIONS: Date window position, chronograph subdials, GMT hand, moonphase
8. DIAL COLOR and finish (matte/sunburst/guilloche/enamel)
9. OPEN CASEBACK or skeleton dial visible?
10. SIZE impression (small <36mm / medium 38-42mm / large >42mm)

Be extremely precise. Quote all dial text literally.` }
    ]
  }], 900, 0.1);

  const visual = p1?.choices?.[0]?.message?.content || '';

  // Pass 2 — identification from evidence
  const p2 = await groqCall(env, MODEL_VISION, [{
    role: 'user',
    content: `You are a master horologist with encyclopedic knowledge of all watch brands worldwide, including Chinese microbrands (Berny, Pagani Design, San Martin, Cadisen, CIGA Design, Seagull, etc.).

VISUAL ANALYSIS of a watch photo:
${visual}

Identification rules:
- Trust dial text above everything — if a brand name is literally quoted, use it
- Chinese watches often have brand name printed at 12 o'clock and "Automatic" or movement info at 6 o'clock
- Never attribute Rolex, AP, or Patek unless their specific logo is clearly quoted
- Output "Desconocido" only if truly unidentifiable

Output ONLY valid JSON, no markdown, no explanation:
{"brand":"exact brand","model":"exact model name","ref":"reference number if visible or empty","type":"automatic|quartz|manual","confidence":"high|medium|low","reasoning":"1-2 sentences on decisive visual clues"}`
  }], 400, 0.05);

  const result = parseJSON(p2?.choices?.[0]?.message?.content || '{}');
  result._visual = visual;
  return cors(result, 200);
}

/* ═══════════════════════════════════════════════════════════
   /details — Real specs from web search + eBay prices

   Both sources run in parallel.
   compound-beta searches the real web for specs.
   eBay API fetches real market prices.
═══════════════════════════════════════════════════════════ */
async function handleDetails(request, env) {
  const { brand, model, ref, type } = await request.json();
  if (!brand || !model) return cors({ error: 'Missing brand or model' }, 400);

  const watchId = [brand, model, ref].filter(Boolean).join(' ');

  // Both fire in parallel
  const [webRes, ebayRes] = await Promise.allSettled([
    webSearchSpecs(env, watchId, brand, model, ref, type),
    ebaySearch(watchId, brand, env),
  ]);

  const webData  = webRes.status  === 'fulfilled' ? webRes.value  : null;
  const ebayData = ebayRes.status === 'fulfilled' ? ebayRes.value : null;

  // Build final result
  const result = webData || {
    specs: emptySpecs(),
    price: { value: '', note: '' },
    _source: 'none',
    _warning: 'No se encontró información. Intenta añadir la referencia del reloj.'
  };

  // eBay price takes priority (real market data)
  if (ebayData?.price?.value && !result.price?.value) {
    result.price   = ebayData.price;
    result._source = (result._source || '') + '+ebay';
    result._ebay   = ebayData._ebay;
  }

  // Fill any missing specs from eBay itemSpecifics
  if (ebayData?.specs) {
    for (const [k, v] of Object.entries(ebayData.specs)) {
      if (v && !result.specs?.[k]) result.specs[k] = v;
    }
  }

  return cors(result, 200);
}

/* ─── Web search via compound-beta ─── */
async function webSearchSpecs(env, watchId, brand, model, ref, type) {
  const mov = type === 'automatic' ? 'automatic' : type === 'quartz' ? 'quartz' : 'manual';

  // System instruction: search the web, extract real data, return empty if not found
  const systemPrompt = `You are a precise watch specification extractor.
Your task: search the web for REAL technical specifications of the requested watch.

MANDATORY RULES:
1. Search multiple sources: manufacturer website, watch forums (WatchUSeek, Reddit r/Watches), eBay listings, Amazon, AliExpress, Chrono24, official brand pages.
2. For Chinese brands (Berny, Pagani Design, San Martin, Cadisen, OBLVLO, Seagull, CIGA, Pagani, Carnival, etc.) prioritize: AliExpress product pages, Amazon listings, brand's own website, YouTube reviews that list specs.
3. Extract ONLY data you actually find in real sources. If a field is not found, use empty string "".
4. NEVER invent or estimate caliber numbers, dimensions, or prices.
5. Respond ONLY with the JSON structure requested. No explanations, no markdown.`;

  const userPrompt = `Search the web and find technical specifications for this watch: ${watchId} (${mov}).

Search for these specific data points:
- Movement/caliber name and number (e.g. "NH35A", "Miyota 8285", "VK63", "Seagull ST2130")
- Crystal type (sapphire / mineral / acrylic, flat / domed / double-domed)  
- Case material (316L stainless steel, titanium, etc.)
- Water resistance (meters and ATM)
- Case diameter (mm)
- Case thickness (mm)
- Bracelet/strap material
- Dial color and features
- Power reserve (hours, for mechanical only)
- Frequency (beats per hour)
- Jewel count

After searching, respond ONLY with this JSON (no markdown, no backticks, empty string if not found):
{
  "specs": {
    "calibre": "movement name and number from real source",
    "movimiento": "movement type, frequency in bph, jewel count",
    "cristal": "crystal type and profile",
    "brazalete": "bracelet or strap type and material",
    "esfera": "dial color, features and finish",
    "caja": "case material and shape",
    "resistencia": "water resistance in meters and ATM",
    "reserva": "power reserve in hours (empty for quartz)",
    "diametro": "case diameter in mm",
    "grosor": "case thickness in mm"
  },
  "price": {
    "value": "price range found (e.g. '85 – 120 USD' or '~350 EUR'), empty if not found",
    "note": "source of price (e.g. 'Amazon.es, AliExpress official store')"
  },
  "_sources": "list of sites you actually found data on"
}`;

  try {
    // Try compound-beta first (native web search)
    const res = await groqRaw(env, {
      model: MODEL_COMPOUND,
      max_tokens: 1200,
      temperature: 0.05,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   }
      ]
    });

    if (res.ok) {
      const data = await res.json();
      // compound-beta returns text content — extract it
      const text = data.choices?.[0]?.message?.content || '';
      const parsed = parseJSON(text);
      if (parsed?.specs) {
        parsed._source = 'compound_web';
        parsed.sources = parsed._sources || '';
        return parsed;
      }
    }
  } catch (e) {
    console.warn('compound-beta failed:', e.message);
  }

  // Fallback: scout with strict no-hallucination prompt
  try {
    const res2 = await groqCall(env, MODEL_FALLBACK, [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   }
    ], 900, 0.05);

    const text2 = res2?.choices?.[0]?.message?.content || '';
    const parsed2 = parseJSON(text2);
    if (parsed2?.specs) {
      parsed2._source  = 'llm_scout';
      parsed2._warning = 'Datos basados en conocimiento del modelo — verifica en la web oficial.';
      return parsed2;
    }
  } catch {}

  return null;
}

/* ═══════════════════════════════════════════════════════════
   eBay Browse API — real market prices + specs from listings
   Free. Register: developer.ebay.com → My Apps → Get Production Keys
   No approval needed for Browse API (read-only).
═══════════════════════════════════════════════════════════ */
const EBAY_TOKEN_URL  = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const EBAY_SCOPE      = 'https://api.ebay.com/oauth/api_scope';
const EBAY_CAT_WATCH  = '31387'; // Wristwatches

async function ebayGetToken(env) {
  if (!env.EBAY_APP_ID || !env.EBAY_CERT_ID) return null;

  // Try KV cache first
  if (env.HORLOGERIE_KV) {
    try {
      const cached = await env.HORLOGERIE_KV.get('ebay_token_v2');
      if (cached) {
        const { token, exp } = JSON.parse(cached);
        if (Date.now() < exp - 60000) return token;
      }
    } catch {}
  }

  const creds = btoa(`${env.EBAY_APP_ID}:${env.EBAY_CERT_ID}`);
  const res   = await fetch(EBAY_TOKEN_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${creds}`,
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(EBAY_SCOPE)}`,
  });

  if (!res.ok) return null;
  const { access_token: token, expires_in = 7200 } = await res.json();
  if (!token) return null;

  const exp = Date.now() + expires_in * 1000;
  if (env.HORLOGERIE_KV) {
    try {
      await env.HORLOGERIE_KV.put('ebay_token_v2', JSON.stringify({ token, exp }), { expirationTtl: expires_in });
    } catch {}
  }
  return token;
}

async function ebaySearch(watchId, brand, env) {
  const token = await ebayGetToken(env);
  if (!token) return null;

  const params = new URLSearchParams({
    q:            watchId,
    category_ids: EBAY_CAT_WATCH,
    limit:        '8',
    sort:         'bestMatch',
    fieldgroups:  'EXTENDED',
  });

  try {
    const res = await fetch(`${EBAY_SEARCH_URL}?${params}`, {
      headers: {
        'Authorization':           `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_ES',
        'Content-Type':            'application/json',
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = data.itemSummaries || [];
    if (!items.length) return null;
    return parseEbayItems(items);
  } catch { return null; }
}

function parseEbayItems(items) {
  // Price range
  const amounts = items
    .map(i => parseFloat(i.price?.value || '0'))
    .filter(v => v > 0)
    .sort((a, b) => a - b);

  const currency = items[0]?.price?.currency || 'EUR';
  let priceValue = '';
  if (amounts.length === 1) priceValue = `~${amounts[0].toFixed(0)} ${currency}`;
  else if (amounts.length > 1) priceValue = `${amounts[0].toFixed(0)} – ${amounts[amounts.length-1].toFixed(0)} ${currency}`;

  // Aggregate itemSpecifics across all listings
  const agg = {};
  for (const item of items) {
    for (const s of (item.localizedAspects || [])) {
      const k = (s.localizedName || s.name || '').toLowerCase().trim();
      const v = Array.isArray(s.value) ? s.value[0] : (s.localizedValue?.[0] || s.value || '');
      if (k && v && !agg[k]) agg[k] = String(v).trim();
    }
  }

  const g = (...keys) => {
    for (const k of keys) {
      if (agg[k]) return agg[k];
      const m = Object.keys(agg).find(ak => ak.includes(k));
      if (m) return agg[m];
    }
    return '';
  };

  const specs = {
    calibre:     g('movement', 'caliber', 'calibre', 'mechanism'),
    movimiento:  g('movement type', 'watch movement'),
    cristal:     g('crystal', 'dial window material', 'glass', 'cristal'),
    brazalete:   g('band material', 'strap material', 'bracelet material', 'band type'),
    esfera:      g('dial colour', 'dial color', 'face color', 'dial'),
    caja:        g('case material', 'case metal'),
    resistencia: g('water resistance depth', 'water resistance', 'waterproof'),
    reserva:     g('power reserve'),
    diametro:    g('case size', 'case diameter', 'dial diameter', 'dial size'),
    grosor:      g('case thickness', 'thickness'),
  };

  return {
    specs,
    price: {
      value: priceValue,
      note:  `${items.length} anuncio(s) en eBay`
    },
    _ebay: {
      count:  items.length,
      sample: items[0]?.title || '',
    }
  };
}

/* ═══════════════════════════════════════════════════════════
   KV SYNC
═══════════════════════════════════════════════════════════ */
const KV_WATCHES = 'watches_v2';

async function handleSyncPush(request, env) {
  if (!env.HORLOGERIE_KV) return cors({ error: 'KV not configured.' }, 503);
  const body = await request.json();
  if (!body.watches || !Array.isArray(body.watches)) return cors({ error: 'Invalid payload' }, 400);
  await env.HORLOGERIE_KV.put(KV_WATCHES, JSON.stringify({
    watches: body.watches, updatedAt: Date.now(), version: 2
  }));
  return cors({ ok: true, count: body.watches.length, updatedAt: Date.now() }, 200);
}

async function handleSyncPull(request, env) {
  if (!env.HORLOGERIE_KV) return cors({ error: 'KV not configured.' }, 503);
  const raw = await env.HORLOGERIE_KV.get(KV_WATCHES);
  return cors(raw ? JSON.parse(raw) : { watches: [], updatedAt: null }, 200);
}

async function handleSyncClear(request, env) {
  if (!env.HORLOGERIE_KV) return cors({ error: 'KV not configured.' }, 503);
  await env.HORLOGERIE_KV.delete(KV_WATCHES);
  return cors({ ok: true }, 200);
}

/* ═══════════════════════════════════════════════════════════
   Helpers
═══════════════════════════════════════════════════════════ */
async function groqRaw(env, payload) {
  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
}

async function groqCall(env, model, messages, maxTokens = 800, temperature = 0.1) {
  const res = await groqRaw(env, { model, max_tokens: maxTokens, temperature, messages });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json();
}

function emptySpecs() {
  return { calibre:'', movimiento:'', cristal:'', brazalete:'', esfera:'', caja:'', resistencia:'', reserva:'', diametro:'', grosor:'' };
}

function parseJSON(text) {
  if (!text) return {};
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(clean); } catch {}
  const m = clean.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return {};
}

function cors(data, status = 200) {
  return new Response(data === null ? '' : JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                 'application/json',
      'Access-Control-Allow-Origin':  CORS_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
