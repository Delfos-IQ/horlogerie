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
const MODEL_COMPOUND = 'compound-beta'; // Groq model with native web search

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
      const RATE_LIMITED = ['/import-url'];
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
      if (pathname === '/sync/size'   && method === 'GET')    return await handleSyncSize(request, env, origin);
      if (pathname === '/import-url'  && method === 'POST')   return await handleImportUrl(request, env, origin);
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

  // Fast size check before reading body
  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (contentLength > MAX_SYNC_PAYLOAD) {
    return corsResponse({ error: `Colección demasiado grande (máx ${MAX_SYNC_PAYLOAD / 1024 / 1024}MB)`, maxBytes: MAX_SYNC_PAYLOAD }, 413, origin);
  }

  let body;
  try { body = await request.json(); } catch { return corsResponse({ error: 'JSON inválido' }, 400, origin); }

  const { userId, watches, mode = 'full', deletedIds = [] } = body;

  if (!isValidUUID(userId))        return corsResponse({ error: 'userId inválido (UUID v4 requerido)' }, 400, origin);
  if (!Array.isArray(watches))     return corsResponse({ error: 'watches debe ser un array' }, 400, origin);
  if (watches.length > 500)        return corsResponse({ error: 'Demasiados relojes (máx 500)' }, 400, origin);

  const key  = userKey(userId);
  const opts = USER_DATA_TTL ? { expirationTtl: USER_DATA_TTL } : {};
  const now  = Date.now();

  let finalWatches;

  if (mode === 'diff') {
    // ── Differential push: read existing, merge changes, delete removed ──
    let existing = [];
    try {
      const raw = await env.HORLOGERIE_KV.get(key);
      if (raw) existing = JSON.parse(raw).watches || [];
    } catch {}

    // Build map of existing watches
    const existingMap = {};
    existing.forEach(w => { existingMap[w.id] = w; });

    // Apply incoming changes (upsert)
    watches.forEach(w => { existingMap[w.id] = w; });

    // Remove deleted
    const deletedSet = new Set(deletedIds);
    finalWatches = Object.values(existingMap).filter(w => !deletedSet.has(w.id));
  } else {
    // ── Full push: replace entire collection ──
    finalWatches = watches;
  }

  const payload    = JSON.stringify({ watches: finalWatches, updatedAt: now, version: 2, userId, mode });
  const payloadLen = payload.length;

  if (payloadLen > MAX_SYNC_PAYLOAD) {
    return corsResponse({
      error: `Colección demasiado grande (${(payloadLen / 1024 / 1024).toFixed(1)}MB, máx ${MAX_SYNC_PAYLOAD / 1024 / 1024}MB). Reduce el tamaño de las fotos.`,
      sizeBytes: payloadLen,
    }, 413, origin);
  }

  await env.HORLOGERIE_KV.put(key, payload, opts);
  return corsResponse({
    ok:         true,
    mode,
    count:      finalWatches.length,
    changed:    watches.length,
    deleted:    deletedIds.length,
    sizeBytes:  payloadLen,
    updatedAt:  now,
  }, 200, origin);
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
   SYNC SIZE — returns payload size for the user's collection
══════════════════════════════════════════ */
async function handleSyncSize(request, env, origin) {
  if (!env.HORLOGERIE_KV) return corsResponse({ error: 'KV not configured' }, 503, origin);
  const userId = new URL(request.url).searchParams.get('userId');
  if (!isValidUUID(userId)) return corsResponse({ sizeBytes: 0, exists: false }, 200, origin);
  try {
    const raw = await env.HORLOGERIE_KV.get(userKey(userId));
    if (!raw) return corsResponse({ sizeBytes: 0, exists: false }, 200, origin);
    const data = JSON.parse(raw);
    return corsResponse({
      exists:    true,
      sizeBytes: raw.length,
      sizeMB:    parseFloat((raw.length / 1024 / 1024).toFixed(2)),
      count:     data.watches?.length || 0,
      updatedAt: data.updatedAt || null,
    }, 200, origin);
  } catch {
    return corsResponse({ sizeBytes: 0, exists: false }, 200, origin);
  }
}

/* ══════════════════════════════════════════
   IMPORT URL — Extract specs from any product URL
   Uses compound-beta (Groq web search model) for all sites.
   compound-beta can access Amazon, AliExpress, eBay and any
   other site directly — no separate scraping branch needed.
══════════════════════════════════════════ */
async function handleImportUrl(request, env, origin) {
  let body;
  try { body = await request.json(); } catch { return corsResponse({ error: 'JSON inválido' }, 400, origin); }

  const { url: pageUrl } = body;
  if (!pageUrl || typeof pageUrl !== 'string') return corsResponse({ error: 'url requerida' }, 400, origin);

  let parsedUrl;
  try { parsedUrl = new URL(pageUrl); } catch { return corsResponse({ error: 'URL inválida' }, 400, origin); }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) return corsResponse({ error: 'URL inválida' }, 400, origin);

  const hostname = parsedUrl.hostname.replace('www.', '');

  // Focused prompt: watch-specific, bilingual (EN/ES), explicit about Chinese brands
  const prompt = `You are a watch specification extractor. Visit this product page: ${pageUrl}

Read every detail carefully — title, bullet points, spec table, description.

IMPORTANT: Many watches on Amazon/AliExpress are Chinese brands:
Berny, Pagani Design, San Martin, Cadisen, OBLVLO, Seagull, CIGA Design, Carnival, Reef Tiger, Steeldive, Sugess, Benyar, Phylida.
For these, the caliber is often: Miyota 8215, NH35A, Seagull ST2130, VK63, Seagull 1963.

Return ONLY valid JSON (no markdown, no backticks, no explanation):
{
  "brand": "brand name from dial/listing",
  "model": "model name",
  "ref": "reference number if shown (e.g. AM5813L, PD-1651)",
  "type": "automatic or quartz or manual",
  "calibre": "movement caliber (e.g. Miyota 8215, NH35A, VK63, Seagull ST2130)",
  "cristal": "crystal type: Sapphire / Mineral / Acrylic + shape if known",
  "diametro": "case diameter in mm (number only, e.g. 40mm)",
  "grosor": "case thickness in mm if listed",
  "resistencia": "water resistance (e.g. 100m / 10ATM)",
  "reserva": "power reserve in hours for automatic/manual only",
  "caja": "case material (e.g. 316L Stainless Steel, Titanium, Bronze)",
  "brazalete": "bracelet/strap type and material",
  "esfera": "dial color and finish (e.g. Blue Sunburst, Black Matte)",
  "precio": "price with currency as shown (e.g. 79,99 EUR)",
  "notas": "any other useful specs in 1 sentence max"
}
Use "" for any field not found on the page. NEVER invent or guess data.`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
      body:    JSON.stringify({
        model:       MODEL_COMPOUND,
        max_tokens:  800,
        temperature: 0.05,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) throw new Error(`Groq ${res.status}`);

    const data   = await res.json();
    const text   = data.choices?.[0]?.message?.content || '{}';
    const result = parseJSON(text);

    // Validate — if model returned nothing useful, tell the user
    const hasData = result.brand || result.model || result.calibre || result.precio;
    if (!hasData) {
      return corsResponse({
        _blocked:  false,
        _empty:    true,
        _domain:   hostname,
        _message:  'No se encontraron especificaciones en esta página. Prueba con otra tienda o introduce los datos manualmente.',
      }, 200, origin);
    }

    result._source = hostname;
    result._method = 'compound_web';
    return corsResponse(result, 200, origin);

  } catch (e) {
    await logError(env, '/import-url', e, 'unknown');
    return corsResponse({
      _blocked: true,
      _domain:  hostname,
      _message: 'No se pudo leer la página. Inténtalo de nuevo o introduce los datos manualmente.',
    }, 200, origin);
  }
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
