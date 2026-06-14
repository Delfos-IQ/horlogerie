/**
 * Cloudflare Worker — Horlogerie API v10
 *
 * Secrets (Cloudflare dashboard → Settings → Variables):
 *   GROQ_API_KEY   — required
 *   EBAY_APP_ID    — optional (market prices)
 *   EBAY_CERT_ID   — optional
 *
 * KV Binding: HORLOGERIE_KV
 *
 * Security (Fase 2):
 *   - CORS restricted to GitHub Pages origin only
 *   - Rate limiting on AI endpoints (20 req/hour per IP via KV)
 *   - Payload size validation on /sync/push (max 3MB)
 *   - UUID validation on all userId inputs
 *   - Error logging to KV (24h TTL) — no public debug endpoint
 *   - Structured error responses (no stack trace leakage)
 */

/* ── Origins ── */
const ALLOWED_ORIGINS = [
  'https://delfos-iq.github.io',
  // Add your custom domain here if you set one up
];

/* ── Models ── */
const MODEL_VISION   = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MODEL_COMPOUND = 'compound-beta';
const MODEL_FALLBACK = 'meta-llama/llama-4-scout-17b-16e-instruct';

/* ── Limits ── */
const USER_DATA_TTL     = null;           // null = permanent; set seconds to expire
const RATE_LIMIT_MAX    = 20;             // requests per window
const RATE_LIMIT_WINDOW = 3600;           // 1 hour in seconds
const MAX_SYNC_PAYLOAD  = 3 * 1024 * 1024; // 3MB

/* ── UUID regex ── */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ══════════════════════════════════════════
   MAIN HANDLER
══════════════════════════════════════════ */
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, origin);
    }

    // Validate origin for non-preflight requests
    // Fail open in development (no origin header = server-to-server or curl)
    if (origin && !isAllowedOrigin(origin)) {
      return corsResponse({ error: 'Origin not allowed' }, 403, origin);
    }

    if (!env.GROQ_API_KEY) {
      return corsResponse({ error: 'Server misconfigured' }, 500, origin);
    }

    const url = new URL(request.url);
    const ip  = request.headers.get('CF-Connecting-IP') || 'unknown';

    try {
      // Rate-limited endpoints (call external paid APIs)
      const RATE_LIMITED = ['/identify', '/details', '/import-url'];
      if (RATE_LIMITED.includes(url.pathname)) {
        const limited = await checkRateLimit(env, ip, url.pathname);
        if (limited) {
          return corsResponse({
            error: 'Demasiadas solicitudes. Inténtalo en una hora.',
            retryAfter: RATE_LIMIT_WINDOW,
          }, 429, origin);
        }
      }

      // Route
      const { pathname, method } = { pathname: url.pathname, method: request.method };
      if (pathname === '/sync/push'   && method === 'POST')   return await handleSyncPush(request, env, origin);
      if (pathname === '/sync/pull'   && method === 'GET')    return await handleSyncPull(request, env, origin);
      if (pathname === '/sync/exists' && method === 'GET')    return await handleSyncExists(request, env, origin);
      if (pathname === '/sync/clear'  && method === 'DELETE') return await handleSyncClear(request, env, origin);
      if (pathname === '/import-url'  && method === 'POST')   return await handleImportUrl(request, env, origin);
      if (pathname === '/identify'    && method === 'POST')   return await handleIdentify(request, env, origin);
      if (pathname === '/details'     && method === 'POST')   return await handleDetails(request, env, origin);
      if (pathname === '/health'      || pathname === '/')    return corsResponse({ status: 'ok', version: '10.0', kv: !!env.HORLOGERIE_KV }, 200, origin);

      return corsResponse({ error: 'Not found' }, 404, origin);

    } catch (e) {
      await logError(env, url.pathname, e, ip);
      // Never leak stack traces or internal error details
      return corsResponse({ error: 'Error interno del servidor' }, 500, origin);
    }
  }
};

/* ══════════════════════════════════════════
   CORS — strict origin allowlist
══════════════════════════════════════════ */
function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o + '/'));
}

function corsResponse(data, status = 200, origin = '') {
  // Only echo back origin if it's in the allowlist
  const allowOrigin = isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0];
  return new Response(data === null ? '' : JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age':       '86400',
      'X-Content-Type-Options':       'nosniff',
    }
  });
}

/* ══════════════════════════════════════════
   UUID VALIDATION
══════════════════════════════════════════ */
function isValidUUID(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

function userKey(userId) {
  if (!isValidUUID(userId)) throw new Error('Invalid userId format');
  return `user:${userId.toLowerCase()}:watches`;
}

/* ══════════════════════════════════════════
   RATE LIMITING — per IP per endpoint
   KV key: ratelimit:{ip_hash}:{endpoint}
   Fails open if KV unavailable.
══════════════════════════════════════════ */
async function checkRateLimit(env, ip, pathname) {
  if (!env.HORLOGERIE_KV) return false;
  const endpoint = pathname.replace(/\//g, '_');
  // Hash the IP for privacy (first 7 chars of hex)
  const ipHash   = await hashString(ip);
  const key      = `rl:${ipHash}:${endpoint}`;
  try {
    const raw   = await env.HORLOGERIE_KV.get(key);
    const count = raw ? parseInt(raw, 10) : 0;
    if (count >= RATE_LIMIT_MAX) return true;
    await env.HORLOGERIE_KV.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW });
    return false;
  } catch {
    return false; // fail open on error
  }
}

async function hashString(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('').slice(0, 12);
}

/* ══════════════════════════════════════════
   ERROR LOGGING — 24h TTL, no public endpoint
══════════════════════════════════════════ */
async function logError(env, pathname, error, ip) {
  if (!env.HORLOGERIE_KV) return;
  try {
    const ipHash = await hashString(ip);
    await env.HORLOGERIE_KV.put(
      `errlog:${Date.now()}`,
      JSON.stringify({
        time: new Date().toISOString(),
        pathname,
        message: error.message?.slice(0, 200) || 'unknown',
        ipHash,  // hashed, not raw IP
      }),
      { expirationTtl: 86400 }
    );
  } catch {} // never throw from error logger
}

/* ══════════════════════════════════════════
   SYNC — /sync/push  /sync/pull  /sync/exists  /sync/clear
══════════════════════════════════════════ */
async function handleSyncPush(request, env, origin) {
  if (!env.HORLOGERIE_KV) return corsResponse({ error: 'KV not configured' }, 503, origin);

  // Validate Content-Length before reading body
  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (contentLength > MAX_SYNC_PAYLOAD) {
    return corsResponse({
      error: `Payload demasiado grande (máx ${MAX_SYNC_PAYLOAD / 1024 / 1024}MB)`,
      maxBytes: MAX_SYNC_PAYLOAD,
    }, 413, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return corsResponse({ error: 'JSON inválido' }, 400, origin);
  }

  const { userId, watches } = body;

  if (!isValidUUID(userId)) {
    return corsResponse({ error: 'userId inválido (debe ser UUID v4)' }, 400, origin);
  }
  if (!Array.isArray(watches)) {
    return corsResponse({ error: 'watches debe ser un array' }, 400, origin);
  }
  if (watches.length > 500) {
    return corsResponse({ error: 'Demasiados relojes (máx 500)' }, 400, origin);
  }

  // Secondary size check on actual payload (Content-Length might be absent)
  const serialized = JSON.stringify({ watches, updatedAt: Date.now(), version: 2, userId });
  if (serialized.length > MAX_SYNC_PAYLOAD) {
    return corsResponse({
      error: `Colección demasiado grande (máx ${MAX_SYNC_PAYLOAD / 1024 / 1024}MB). Considera reducir el tamaño de las fotos.`,
    }, 413, origin);
  }

  const opts = USER_DATA_TTL ? { expirationTtl: USER_DATA_TTL } : {};
  await env.HORLOGERIE_KV.put(userKey(userId), serialized, opts);
  return corsResponse({ ok: true, count: watches.length, updatedAt: Date.now() }, 200, origin);
}

async function handleSyncPull(request, env, origin) {
  if (!env.HORLOGERIE_KV) return corsResponse({ error: 'KV not configured' }, 503, origin);
  const userId = new URL(request.url).searchParams.get('userId');
  if (!isValidUUID(userId)) {
    // Graceful: return empty instead of error on first launch
    return corsResponse({ watches: [], updatedAt: null, exists: false }, 200, origin);
  }
  try {
    const raw = await env.HORLOGERIE_KV.get(userKey(userId));
    if (!raw) return corsResponse({ watches: [], updatedAt: null, exists: false }, 200, origin);
    return corsResponse({ ...JSON.parse(raw), exists: true }, 200, origin);
  } catch {
    return corsResponse({ watches: [], updatedAt: null, exists: false }, 200, origin);
  }
}

async function handleSyncExists(request, env, origin) {
  if (!env.HORLOGERIE_KV) return corsResponse({ error: 'KV not configured' }, 503, origin);
  const userId = new URL(request.url).searchParams.get('userId');
  if (!isValidUUID(userId)) return corsResponse({ exists: false }, 200, origin);
  try {
    const raw = await env.HORLOGERIE_KV.get(userKey(userId));
    if (!raw) return corsResponse({ exists: false }, 200, origin);
    const data = JSON.parse(raw);
    return corsResponse({ exists: true, count: data.watches?.length || 0, updatedAt: data.updatedAt || null }, 200, origin);
  } catch {
    return corsResponse({ exists: false }, 200, origin);
  }
}

async function handleSyncClear(request, env, origin) {
  if (!env.HORLOGERIE_KV) return corsResponse({ error: 'KV not configured' }, 503, origin);
  const userId = new URL(request.url).searchParams.get('userId');
  if (!isValidUUID(userId)) return corsResponse({ error: 'userId inválido' }, 400, origin);
  await env.HORLOGERIE_KV.delete(userKey(userId));
  return corsResponse({ ok: true }, 200, origin);
}

/* ══════════════════════════════════════════
   IMPORT URL — Extract specs from product URL
══════════════════════════════════════════ */
async function handleImportUrl(request, env, origin) {
  let body;
  try { body = await request.json(); } catch { return corsResponse({ error: 'JSON inválido' }, 400, origin); }

  const { url: pageUrl } = body;
  if (!pageUrl || typeof pageUrl !== 'string') return corsResponse({ error: 'url requerida' }, 400, origin);

  // Validate URL format
  let parsedUrl;
  try { parsedUrl = new URL(pageUrl); } catch { return corsResponse({ error: 'URL inválida' }, 400, origin); }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) return corsResponse({ error: 'URL inválida' }, 400, origin);

  const hostname = parsedUrl.hostname.replace('www.', '');

  // Sites that block datacenter scraping → use compound-beta web search
  const USE_GROQ_SEARCH = [
    'amazon.com','amazon.es','amazon.co.uk','amazon.de','amazon.fr',
    'aliexpress.com','aliexpress.es','aliexpress.ru','alibaba.com',
    'ebay.com','ebay.es','ebay.co.uk',
  ].some(b => hostname.endsWith(b));

  if (USE_GROQ_SEARCH) return await importViaGroqSearch(env, pageUrl, hostname, origin);
  return await importViaScrape(env, pageUrl, hostname, origin);
}

async function importViaGroqSearch(env, pageUrl, hostname, origin) {
  const prompt = `Visit this product page and extract ALL watch technical specifications: ${pageUrl}

Extract: brand, model, reference, movement type (automatic/quartz/manual), caliber name (e.g. Miyota 8215, NH35A), crystal type, case diameter in mm, thickness in mm, water resistance, power reserve, case material, strap/bracelet, dial color, price with currency.
Return ONLY valid JSON (no markdown, no explanation):
{"brand":"","model":"","ref":"","type":"automatic or quartz or manual","calibre":"","cristal":"","diametro":"","grosor":"","resistencia":"","reserva":"","caja":"","brazalete":"","esfera":"","precio":"","notas":""}
Use "" for any field not found. NEVER invent data.`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: MODEL_COMPOUND, max_tokens: 700, temperature: 0.05, messages: [{ role: 'user', content: prompt }] }),
    });
    if (res.ok) {
      const data   = await res.json();
      const result = parseJSON(data.choices?.[0]?.message?.content || '{}');
      if (result.brand || result.model || result.calibre) {
        result._source = hostname;
        result._method = 'compound_web';
        return corsResponse(result, 200, origin);
      }
    }
  } catch {}
  return corsResponse({ _blocked: true, _domain: hostname, _message: `No se pudo leer ${hostname}. Introduce los datos manualmente.` }, 200, origin);
}

async function importViaScrape(env, pageUrl, hostname, origin) {
  let html = '';
  try {
    const res = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) html = await res.text();
  } catch {}

  if (!html) return corsResponse({ _blocked: true, _domain: hostname, _message: 'No se pudo acceder a la página.' }, 200, origin);

  const structured = extractJsonLd(html);
  const meta       = extractMeta(html);
  const title      = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1]?.trim() || '';
  const bodyText   = html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s{2,}/g,' ').trim().slice(0, 3500);

  const context = [title && `Título: ${title}`, meta.desc && `Descripción: ${meta.desc}`, structured.name && `Producto: ${structured.name}`, structured.brand && `Marca: ${structured.brand}`, structured.price && `Precio: ${structured.price}`, bodyText && `Texto:\n${bodyText}`].filter(Boolean).join('\n\n');

  const groqRes = await groqCall(env, MODEL_VISION, [{ role: 'user', content: `Extract watch specifications from this product page. Return ONLY valid JSON. Empty string if not found. NEVER invent.\n\n${context}\n\n{"brand":"","model":"","ref":"","type":"automatic|quartz|manual","calibre":"","cristal":"","diametro":"","grosor":"","resistencia":"","reserva":"","caja":"","brazalete":"","esfera":"","precio":"","notas":""}` }], 600, 0.05);

  const result = parseJSON(groqRes?.choices?.[0]?.message?.content || '{}');
  if (structured.brand && !result.brand) result.brand = structured.brand;
  if (structured.name  && !result.model) result.model = structured.name;
  if (structured.price && !result.precio) result.precio = structured.price;
  result._source = hostname;
  return corsResponse(result, 200, origin);
}

/* ══════════════════════════════════════════
   IDENTIFY — photo identification
══════════════════════════════════════════ */
async function handleIdentify(request, env, origin) {
  let body;
  try { body = await request.json(); } catch { return corsResponse({ error: 'JSON inválido' }, 400, origin); }

  const { image, mediaType } = body;
  if (!image || typeof image !== 'string') return corsResponse({ error: 'image requerida' }, 400, origin);
  if (!mediaType || !mediaType.startsWith('image/')) return corsResponse({ error: 'mediaType inválido' }, 400, origin);
  // Basic size check on base64 (~750KB limit = ~1MB original)
  if (image.length > 1_000_000) return corsResponse({ error: 'Imagen demasiado grande (máx 750KB)' }, 413, origin);

  const p1 = await groqCall(env, MODEL_VISION, [{ role: 'user', content: [
    { type: 'image_url', image_url: { url: `data:${mediaType};base64,${image}` } },
    { type: 'text', text: `Expert watch analyst. Extract ALL visible details precisely:\n1. DIAL TEXT: Quote EXACTLY every word and brand name on the dial\n2. HANDS: shape, color, luminous?\n3. MARKERS: baton/Arabic/Roman, applied/printed\n4. BEZEL: smooth/fluted/rotating/ceramic, markings\n5. CASE: shape, crown guards, pushers\n6. BRACELET: type, color\n7. COMPLICATIONS: date position, chronograph subdials, GMT\n8. DIAL color and finish\n9. Size impression (<36mm/38-42mm/>42mm)\nBe precise. Quote all dial text literally.` }
  ]}], 900, 0.1);

  const visual = p1?.choices?.[0]?.message?.content || '';

  const p2 = await groqCall(env, MODEL_VISION, [{ role: 'user', content: `Master horologist. Identify this watch from visual analysis.\n\nVISUAL:\n${visual}\n\nRules:\n- Trust dial text above all — if brand name is quoted literally, use it\n- Chinese brands: Berny, Pagani Design, San Martin, Cadisen, CIGA Design, Seagull, Steeldive\n- Output "Desconocido" only if truly unidentifiable\n\nReturn ONLY valid JSON:\n{"brand":"","model":"","ref":"","type":"automatic|quartz|manual","confidence":"high|medium|low","reasoning":"1-2 sentences"}` }], 400, 0.05);

  const result = parseJSON(p2?.choices?.[0]?.message?.content || '{}');
  result._visual = visual;
  return corsResponse(result, 200, origin);
}

/* ══════════════════════════════════════════
   DETAILS — specs + eBay pricing
══════════════════════════════════════════ */
async function handleDetails(request, env, origin) {
  let body;
  try { body = await request.json(); } catch { return corsResponse({ error: 'JSON inválido' }, 400, origin); }

  const { brand, model, ref, type } = body;
  if (!brand || !model) return corsResponse({ error: 'brand y model son requeridos' }, 400, origin);
  // Sanitize to prevent prompt injection
  const watchId = [brand, model, ref].filter(Boolean).map(s => String(s).slice(0, 100)).join(' ');

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
  return corsResponse(result, 200, origin);
}

async function webSearchSpecs(env, watchId, brand, model, ref, type) {
  const mov = type === 'automatic' ? 'automatic' : type === 'quartz' ? 'quartz' : 'manual';
  const systemPrompt = `Precise watch specification extractor. Only use data from real sources. If field not found, use "". NEVER invent specs.`;
  const userPrompt = `Find specifications for: ${watchId} (${mov}).\nReturn ONLY this JSON (empty string if not found):\n{"specs":{"calibre":"","movimiento":"","cristal":"","brazalete":"","esfera":"","caja":"","resistencia":"","reserva":"","diametro":"","grosor":""},"price":{"value":"","note":""},"_sources":""}`;

  try {
    const res = await groqRaw(env, { model: MODEL_COMPOUND, max_tokens: 1000, temperature: 0.05, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] });
    if (res.ok) {
      const parsed = parseJSON((await res.json()).choices?.[0]?.message?.content || '');
      if (parsed?.specs) { parsed._source = 'compound_web'; return parsed; }
    }
  } catch {}

  try {
    const res2   = await groqCall(env, MODEL_FALLBACK, [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], 800, 0.05);
    const parsed = parseJSON(res2?.choices?.[0]?.message?.content || '');
    if (parsed?.specs) { parsed._source = 'llm'; parsed._warning = 'Datos del modelo — verifica.'; return parsed; }
  } catch {}
  return null;
}

/* ── eBay ── */
const EBAY_TOKEN_URL  = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const EBAY_SCOPE      = 'https://api.ebay.com/oauth/api_scope';

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
  if (env.HORLOGERIE_KV) {
    try { await env.HORLOGERIE_KV.put('ebay_token_v2', JSON.stringify({ token, exp: Date.now() + expires_in * 1000 }), { expirationTtl: expires_in }); } catch {}
  }
  return token;
}

async function ebaySearch(watchId, brand, env) {
  const token = await ebayGetToken(env);
  if (!token) return null;
  const params = new URLSearchParams({ q: watchId, category_ids: '31387', limit: '8', sort: 'bestMatch', fieldgroups: 'EXTENDED' });
  try {
    const res = await fetch(`${EBAY_SEARCH_URL}?${params}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_ES' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const items    = (await res.json()).itemSummaries || [];
    if (!items.length) return null;
    const amounts  = items.map(i => parseFloat(i.price?.value || '0')).filter(v => v > 0).sort((a, b) => a - b);
    const currency = items[0]?.price?.currency || 'EUR';
    const priceVal = amounts.length === 1 ? `~${amounts[0].toFixed(0)} ${currency}` : amounts.length > 1 ? `${amounts[0].toFixed(0)}–${amounts[amounts.length-1].toFixed(0)} ${currency}` : '';
    const agg = {};
    for (const item of items) {
      for (const s of (item.localizedAspects || [])) {
        const k = (s.localizedName || s.name || '').toLowerCase().trim();
        const v = Array.isArray(s.value) ? s.value[0] : (s.localizedValue?.[0] || s.value || '');
        if (k && v && !agg[k]) agg[k] = String(v).trim();
      }
    }
    const g = (...keys) => { for (const k of keys) { if (agg[k]) return agg[k]; const m = Object.keys(agg).find(ak => ak.includes(k)); if (m) return agg[m]; } return ''; };
    return {
      specs: { calibre: g('movement','caliber'), movimiento: g('movement type'), cristal: g('crystal','glass'), brazalete: g('band material','strap material'), esfera: g('dial colour','dial color'), caja: g('case material'), resistencia: g('water resistance'), reserva: g('power reserve'), diametro: g('case size','case diameter'), grosor: g('case thickness','thickness') },
      price: { value: priceVal, note: `${items.length} anuncio(s) en eBay` },
      _ebay: { count: items.length, sample: items[0]?.title || '' }
    };
  } catch { return null; }
}

/* ── Helpers ── */
function extractJsonLd(html) {
  const out = { name: '', brand: '', price: '' };
  const re  = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      for (const d of [].concat(JSON.parse(m[1]))) {
        if (!out.name  && d.name)   out.name  = String(d.name);
        if (!out.brand && d.brand)  out.brand = typeof d.brand === 'string' ? d.brand : d.brand?.name || '';
        if (!out.price && d.offers) { const o = [].concat(d.offers)[0]; if (o?.price) out.price = `${o.price} ${o.priceCurrency || 'EUR'}`; }
      }
    } catch {}
  }
  return out;
}

function extractMeta(html) {
  const get = (attr, val) => {
    const r1 = new RegExp(`<meta[^>]+${attr}=["']${val}["'][^>]+content=["']([^"']+)["']`, 'i');
    const r2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${val}["']`, 'i');
    return (html.match(r1) || html.match(r2) || [])[1] || '';
  };
  return { desc: get('name', 'description') || get('property', 'og:description') };
}

async function groqRaw(env, payload) {
  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
}

async function groqCall(env, model, messages, maxTokens = 800, temperature = 0.1) {
  const res = await groqRaw(env, { model, max_tokens: maxTokens, temperature, messages });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  return res.json();
}

function emptySpecs() {
  return { calibre: '', movimiento: '', cristal: '', brazalete: '', esfera: '', caja: '', resistencia: '', reserva: '', diametro: '', grosor: '' };
}

function parseJSON(text) {
  if (!text) return {};
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(clean); } catch {}
  const m = clean.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return {};
}
