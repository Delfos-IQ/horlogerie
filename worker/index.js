/**
 * Cloudflare Worker — Horlogerie API v8
 * Worker URL: https://horlogerie.pedicode-app.workers.dev
 *
 * Multi-user: each user identified by a UUID generated on their device.
 * Data stored in KV under key: user:{userId}:watches
 *
 * Secrets needed in Cloudflare dashboard:
 *   GROQ_API_KEY   — required
 *   EBAY_APP_ID    — optional (market prices)
 *   EBAY_CERT_ID   — optional
 *
 * KV Binding: HORLOGERIE_KV
 */

const CORS_ORIGIN    = '*';
const MODEL_VISION   = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MODEL_COMPOUND = 'compound-beta';
const MODEL_FALLBACK = 'meta-llama/llama-4-scout-17b-16e-instruct';

// KV key limits: max 30 days TTL for user data (optional, remove if you want permanent)
// Set to null for no expiry
const USER_DATA_TTL = null;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(null, 204);
    if (!env.GROQ_API_KEY) return cors({ error: 'GROQ_API_KEY not configured.' }, 500);

    const url = new URL(request.url);
    try {
      if (url.pathname === '/identify'    && request.method === 'POST')   return await handleIdentify(request, env);
      if (url.pathname === '/details'     && request.method === 'POST')   return await handleDetails(request, env);
      if (url.pathname === '/sync/push'   && request.method === 'POST')   return await handleSyncPush(request, env);
      if (url.pathname === '/sync/pull'   && request.method === 'GET')    return await handleSyncPull(request, env);
      if (url.pathname === '/sync/clear'  && request.method === 'DELETE') return await handleSyncClear(request, env);
      if (url.pathname === '/sync/exists' && request.method === 'GET')    return await handleSyncExists(request, env);
      if (url.pathname === '/' || url.pathname === '/health')
        return cors({ status: 'ok', version: '8.0', kv: !!env.HORLOGERIE_KV }, 200);
      return cors({ error: 'Not found' }, 404);
    } catch (e) {
      console.error('[worker]', e.message);
      return cors({ error: e.message }, 500);
    }
  }
};

/* ── KV key per user ── */
function userKey(userId) {
  if (!userId || userId.length < 8) throw new Error('Invalid userId');
  // Sanitize: only allow alphanumeric and hyphens
  const safe = userId.replace(/[^a-zA-Z0-9-]/g, '');
  if (safe.length < 8) throw new Error('Invalid userId after sanitization');
  return `user:${safe}:watches`;
}

/* ═══════════════════════════════════════
   SYNC — per-user KV storage
═══════════════════════════════════════ */
async function handleSyncPush(request, env) {
  if (!env.HORLOGERIE_KV) return cors({ error: 'KV not configured.' }, 503);
  const body = await request.json();
  const { userId, watches } = body;
  if (!userId) return cors({ error: 'Missing userId' }, 400);
  if (!Array.isArray(watches)) return cors({ error: 'Invalid watches payload' }, 400);

  const key     = userKey(userId);
  const payload = { watches, updatedAt: Date.now(), version: 2, userId };
  const opts    = USER_DATA_TTL ? { expirationTtl: USER_DATA_TTL } : {};
  await env.HORLOGERIE_KV.put(key, JSON.stringify(payload), opts);
  return cors({ ok: true, count: watches.length, updatedAt: payload.updatedAt }, 200);
}

async function handleSyncPull(request, env) {
  if (!env.HORLOGERIE_KV) return cors({ error: 'KV not configured.' }, 503);
  const url    = new URL(request.url);
  const userId = url.searchParams.get('userId');
  if (!userId) return cors({ error: 'Missing userId' }, 400);

  const key = userKey(userId);
  const raw = await env.HORLOGERIE_KV.get(key);
  if (!raw) return cors({ watches: [], updatedAt: null, exists: false }, 200);
  const data = JSON.parse(raw);
  return cors({ ...data, exists: true }, 200);
}

async function handleSyncExists(request, env) {
  if (!env.HORLOGERIE_KV) return cors({ error: 'KV not configured.' }, 503);
  const url    = new URL(request.url);
  const userId = url.searchParams.get('userId');
  if (!userId) return cors({ error: 'Missing userId' }, 400);

  const key   = userKey(userId);
  const value = await env.HORLOGERIE_KV.get(key, { type: 'text' });
  if (!value) return cors({ exists: false }, 200);
  const data  = JSON.parse(value);
  return cors({
    exists:    true,
    count:     data.watches?.length || 0,
    updatedAt: data.updatedAt || null,
  }, 200);
}

async function handleSyncClear(request, env) {
  if (!env.HORLOGERIE_KV) return cors({ error: 'KV not configured.' }, 503);
  const url    = new URL(request.url);
  const userId = url.searchParams.get('userId');
  if (!userId) return cors({ error: 'Missing userId' }, 400);
  await env.HORLOGERIE_KV.delete(userKey(userId));
  return cors({ ok: true }, 200);
}

/* ═══════════════════════════════════════
   IDENTIFY — 2-pass photo ID
═══════════════════════════════════════ */
async function handleIdentify(request, env) {
  const { image, mediaType } = await request.json();
  if (!image) return cors({ error: 'Missing image' }, 400);

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

  const p2 = await groqCall(env, MODEL_VISION, [{
    role: 'user',
    content: `You are a master horologist with encyclopedic knowledge of all watch brands worldwide, including Chinese microbrands (Berny, Pagani Design, San Martin, Cadisen, CIGA Design, Seagull, etc.).

VISUAL ANALYSIS of a watch photo:
${visual}

Identification rules:
- Trust dial text above everything — if a brand name is literally quoted, use it
- Chinese watches often have brand name printed at 12 o'clock
- Never attribute Rolex, AP, or Patek unless their specific logo is clearly quoted
- Output "Desconocido" only if truly unidentifiable

Output ONLY valid JSON, no markdown:
{"brand":"exact brand","model":"exact model name","ref":"reference or empty","type":"automatic|quartz|manual","confidence":"high|medium|low","reasoning":"1-2 sentences on decisive visual clues"}`
  }], 400, 0.05);

  const result = parseJSON(p2?.choices?.[0]?.message?.content || '{}');
  result._visual = visual;
  return cors(result, 200);
}

/* ═══════════════════════════════════════
   DETAILS — web search + eBay
═══════════════════════════════════════ */
async function handleDetails(request, env) {
  const { brand, model, ref, type } = await request.json();
  if (!brand || !model) return cors({ error: 'Missing brand or model' }, 400);

  const watchId = [brand, model, ref].filter(Boolean).join(' ');
  const [webRes, ebayRes] = await Promise.allSettled([
    webSearchSpecs(env, watchId, brand, model, ref, type),
    ebaySearch(watchId, brand, env),
  ]);

  const webData  = webRes.status  === 'fulfilled' ? webRes.value  : null;
  const ebayData = ebayRes.status === 'fulfilled' ? ebayRes.value : null;

  const result = webData || { specs: emptySpecs(), price: { value: '', note: '' }, _source: 'none', _warning: 'No se encontró información.' };

  if (ebayData?.price?.value && !result.price?.value) {
    result.price   = ebayData.price;
    result._source = (result._source || '') + '+ebay';
    result._ebay   = ebayData._ebay;
  }
  if (ebayData?.specs) {
    for (const [k, v] of Object.entries(ebayData.specs)) {
      if (v && !result.specs?.[k]) result.specs[k] = v;
    }
  }
  return cors(result, 200);
}

async function webSearchSpecs(env, watchId, brand, model, ref, type) {
  const mov = type === 'automatic' ? 'automatic' : type === 'quartz' ? 'quartz' : 'manual';
  const systemPrompt = `You are a precise watch specification extractor. Search the web for REAL technical specifications. Extract ONLY data from real sources. If a field is not found, use empty string "". NEVER invent specs.`;
  const userPrompt = `Search for specifications of: ${watchId} (${mov}). Return ONLY this JSON (no markdown, empty string if not found):
{"specs":{"calibre":"","movimiento":"","cristal":"","brazalete":"","esfera":"","caja":"","resistencia":"","reserva":"","diametro":"","grosor":""},"price":{"value":"","note":""},"_sources":""}`;

  try {
    const res = await groqRaw(env, { model: MODEL_COMPOUND, max_tokens: 1000, temperature: 0.05,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] });
    if (res.ok) {
      const data   = await res.json();
      const parsed = parseJSON(data.choices?.[0]?.message?.content || '');
      if (parsed?.specs) { parsed._source = 'compound_web'; return parsed; }
    }
  } catch {}

  try {
    const res2   = await groqCall(env, MODEL_FALLBACK,
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], 800, 0.05);
    const parsed2 = parseJSON(res2?.choices?.[0]?.message?.content || '');
    if (parsed2?.specs) { parsed2._source = 'llm_scout'; parsed2._warning = 'Datos del modelo — verifica.'; return parsed2; }
  } catch {}
  return null;
}

/* ── eBay ── */
const EBAY_TOKEN_URL  = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const EBAY_SCOPE      = 'https://api.ebay.com/oauth/api_scope';
const EBAY_CAT_WATCH  = '31387';

async function ebayGetToken(env) {
  if (!env.EBAY_APP_ID || !env.EBAY_CERT_ID) return null;
  if (env.HORLOGERIE_KV) {
    try {
      const cached = await env.HORLOGERIE_KV.get('ebay_token_v2');
      if (cached) { const { token, exp } = JSON.parse(cached); if (Date.now() < exp - 60000) return token; }
    } catch {}
  }
  const creds = btoa(`${env.EBAY_APP_ID}:${env.EBAY_CERT_ID}`);
  const res   = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${creds}` },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(EBAY_SCOPE)}`,
  });
  if (!res.ok) return null;
  const { access_token: token, expires_in = 7200 } = await res.json();
  if (!token) return null;
  const exp = Date.now() + expires_in * 1000;
  if (env.HORLOGERIE_KV) {
    try { await env.HORLOGERIE_KV.put('ebay_token_v2', JSON.stringify({ token, exp }), { expirationTtl: expires_in }); } catch {}
  }
  return token;
}

async function ebaySearch(watchId, brand, env) {
  const token = await ebayGetToken(env);
  if (!token) return null;
  const params = new URLSearchParams({ q: watchId, category_ids: EBAY_CAT_WATCH, limit: '8', sort: 'bestMatch', fieldgroups: 'EXTENDED' });
  try {
    const res = await fetch(`${EBAY_SEARCH_URL}?${params}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_ES', 'Content-Type': 'application/json' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = data.itemSummaries || [];
    if (!items.length) return null;
    const amounts  = items.map(i => parseFloat(i.price?.value||'0')).filter(v=>v>0).sort((a,b)=>a-b);
    const currency = items[0]?.price?.currency || 'EUR';
    let priceValue = '';
    if (amounts.length === 1) priceValue = `~${amounts[0].toFixed(0)} ${currency}`;
    else if (amounts.length > 1) priceValue = `${amounts[0].toFixed(0)} – ${amounts[amounts.length-1].toFixed(0)} ${currency}`;
    const agg = {};
    for (const item of items) {
      for (const s of (item.localizedAspects||[])) {
        const k = (s.localizedName||s.name||'').toLowerCase().trim();
        const v = Array.isArray(s.value)?s.value[0]:(s.localizedValue?.[0]||s.value||'');
        if (k && v && !agg[k]) agg[k] = String(v).trim();
      }
    }
    const g = (...keys) => { for (const k of keys) { if (agg[k]) return agg[k]; const m=Object.keys(agg).find(ak=>ak.includes(k)); if(m) return agg[m]; } return ''; };
    return {
      specs: { calibre:g('movement','caliber'), movimiento:g('movement type'), cristal:g('crystal','glass'), brazalete:g('band material','strap material'), esfera:g('dial colour','dial color'), caja:g('case material'), resistencia:g('water resistance depth','water resistance'), reserva:g('power reserve'), diametro:g('case size','case diameter'), grosor:g('case thickness','thickness') },
      price: { value: priceValue, note: `${items.length} anuncio(s) en eBay` },
      _ebay: { count: items.length, sample: items[0]?.title || '' }
    };
  } catch { return null; }
}

/* ── Helpers ── */
async function groqRaw(env, payload) {
  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify(payload),
  });
}
async function groqCall(env, model, messages, maxTokens=800, temperature=0.1) {
  const res = await groqRaw(env, { model, max_tokens: maxTokens, temperature, messages });
  if (!res.ok) { const err = await res.text(); throw new Error(`Groq ${res.status}: ${err.slice(0,200)}`); }
  return res.json();
}
function emptySpecs() {
  return { calibre:'',movimiento:'',cristal:'',brazalete:'',esfera:'',caja:'',resistencia:'',reserva:'',diametro:'',grosor:'' };
}
function parseJSON(text) {
  if (!text) return {};
  const clean = text.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
  try { return JSON.parse(clean); } catch {}
  const m = clean.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return {};
}
function cors(data, status=200) {
  return new Response(data===null?'':JSON.stringify(data), {
    status,
    headers: { 'Content-Type':'application/json','Access-Control-Allow-Origin':CORS_ORIGIN,'Access-Control-Allow-Methods':'POST,GET,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type' }
  });
}
