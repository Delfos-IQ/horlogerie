/**
 * Cloudflare Worker — Horlogerie (Rotor) API v13
 *
 * v13 (oct 2026):
 *   - Short recovery keys: besides UUIDs, the session id can be 16 Crockford
 *     base32 characters in groups of four (7KQ2-M4XR-9TBW-2HNF, 80 bits).
 *   - Device linking: /pair/create stores a one-use 6-character code for
 *     10 minutes that points to the session; /pair/claim swaps it for the
 *     session id. Claims are limited to 10 per hour per IP.
 *
 * v12 (oct 2026):
 *   - /import-url rebuilt: the Worker downloads the page itself, extracts the
 *     spec sheet (JSON-LD, tables, lists, text) and a small Groq model turns it
 *     into structured specs. Every value is checked against the page text and
 *     dropped if it does not appear there (no invented calibres or sizes).
 *   - /import-url also accepts { text } pasted by the user (for shops that
 *     block automated downloads, e.g. Amazon or Chrono24).
 *   - Results cached 30 days per URL; daily global cap to bound cost.
 *
 * v11 (oct 2026):
 *   - The session id can travel in the X-Horlogerie-User header (preferred,
 *     keeps it out of URLs and logs). ?userId= still works for older apps.
 *   - The wishlist is stored next to the collection (optional field).
 *   - GROQ_API_KEY is only required by /import-url: sync works without it.
 *   - /health reports capabilities so the app can pick the safest protocol.
 *
 * Secrets / variables (Cloudflare dashboard → Settings → Variables):
 *   GROQ_API_KEY      — needed only for /import-url
 *   GROQ_MODEL        — optional, default openai/gpt-oss-20b
 *   IMPORT_DAILY_CAP  — optional, imports per day for everyone (default 300)
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
const DEFAULT_IMPORT_MODEL = 'openai/gpt-oss-20b';   // ~0.0004 $ per import

/* ── Limits ── */
const USER_DATA_TTL     = null;           // null = permanent; set seconds to expire
const RATE_LIMIT_MAX    = 20;             // requests per window
const RATE_LIMIT_WINDOW = 3600;           // 1 hour in seconds
const MAX_SYNC_PAYLOAD  = 3 * 1024 * 1024; // 3MB

/* ── Session id formats ── */
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/i;   // Crockford base32, 80 bits

/* ── Device linking ── */
const PAIR_ALPHABET  = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';  // no 0/O, 1/I/L
const PAIR_LEN       = 6;
const PAIR_TTL       = 600;     // seconds
const PAIR_CLAIM_MAX = 10;      // claims per hour per IP

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

    const url = new URL(request.url);
    const ip  = request.headers.get('CF-Connecting-IP') || 'unknown';

    try {
      // Rate-limited endpoints (call external paid APIs)
      const RATE_LIMITED = { '/import-url': RATE_LIMIT_MAX, '/pair/create': RATE_LIMIT_MAX, '/pair/claim': PAIR_CLAIM_MAX };
      if (RATE_LIMITED[url.pathname] && request.method !== 'OPTIONS') {
        const limited = await checkRateLimit(env, ip, url.pathname, RATE_LIMITED[url.pathname]);
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
      if (pathname === '/pair/create' && method === 'POST')   return await handlePairCreate(request, env, origin);
      if (pathname === '/pair/claim'  && method === 'POST')   return await handlePairClaim(request, env, origin);
      if (pathname === '/health'      || pathname === '/')    return corsResponse({
        status: 'ok', version: '13.0', kv: !!env.HORLOGERIE_KV,
        caps: { userHeader: true, wishlist: true, importUrl: !!env.GROQ_API_KEY, importText: !!env.GROQ_API_KEY,
                shortKey: true, pairing: true },
      }, 200, origin);

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
  return new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Horlogerie-User',
      'Access-Control-Max-Age':       '86400',
      'X-Content-Type-Options':       'nosniff',
    }
  });
}

/* ══════════════════════════════════════════
   UUID VALIDATION
══════════════════════════════════════════ */
/** Valid session id: UUID (until v12) or short recovery key (v13) */
function isValidUUID(id) {
  return typeof id === 'string' && (UUID_RE.test(id) || SHORT_RE.test(id));
}

/* Session id: header first (v11 apps), then body (POST), then query (older apps) */
function getUserId(request, body = null) {
  return request.headers.get('X-Horlogerie-User')
    || (body && body.userId)
    || new URL(request.url).searchParams.get('userId');
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
async function checkRateLimit(env, ip, pathname, max = RATE_LIMIT_MAX) {
  if (!env.HORLOGERIE_KV) return false;
  const endpoint = pathname.replace(/\//g, '_');
  // Hash the IP for privacy (first 7 chars of hex)
  const ipHash   = await hashString(ip);
  const key      = `rl:${ipHash}:${endpoint}`;
  try {
    const raw   = await env.HORLOGERIE_KV.get(key);
    const count = raw ? parseInt(raw, 10) : 0;
    if (count >= max) return true;
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

  const userId = getUserId(request, body);
  const { watches, mode = 'full', deletedIds = [], wishlist } = body;

  if (!isValidUUID(userId))        return corsResponse({ error: 'userId inválido' }, 400, origin);
  if (!Array.isArray(watches))     return corsResponse({ error: 'watches debe ser un array' }, 400, origin);
  if (watches.length > 500)        return corsResponse({ error: 'Demasiados relojes (máx 500)' }, 400, origin);
  if (wishlist !== undefined && (!Array.isArray(wishlist) || wishlist.length > 500))
                                   return corsResponse({ error: 'wishlist debe ser un array (máx 500)' }, 400, origin);

  const key  = userKey(userId);
  const opts = USER_DATA_TTL ? { expirationTtl: USER_DATA_TTL } : {};
  const now  = Date.now();

  let finalWatches;

  // Current stored value (needed for diff merges and to keep the wishlist
  // when an older app pushes without one)
  let stored = {};
  try {
    const raw = await env.HORLOGERIE_KV.get(key);
    if (raw) stored = JSON.parse(raw) || {};
  } catch {}

  if (mode === 'diff') {
    // ── Differential push: merge changes, delete removed ──
    const existing = stored.watches || [];

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

  const finalWishlist = Array.isArray(wishlist) ? wishlist : (stored.wishlist || []);
  const payload    = JSON.stringify({ watches: finalWatches, wishlist: finalWishlist, updatedAt: now, version: 3, userId, mode });
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
  const userId = getUserId(request);
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
  const userId = getUserId(request);
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
  const userId = getUserId(request);
  if (!isValidUUID(userId)) return corsResponse({ error: 'userId inválido' }, 400, origin);
  await env.HORLOGERIE_KV.delete(userKey(userId));
  return corsResponse({ ok: true }, 200, origin);
}

/* ══════════════════════════════════════════
   DEVICE LINKING — one-use 6-character code, 10 minutes
   KV key: pair:{CODE} → session id
══════════════════════════════════════════ */
function randomPairCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(PAIR_LEN * 2));
  let out = '';
  for (const b of bytes) {
    if (b >= 248) continue;                       // 248 = 31 × 8: avoid modulo bias
    out += PAIR_ALPHABET[b % PAIR_ALPHABET.length];
    if (out.length === PAIR_LEN) break;
  }
  return out.length === PAIR_LEN ? out : randomPairCode();
}
function normalizePairCode(c) {
  return String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

async function handlePairCreate(request, env, origin) {
  if (!env.HORLOGERIE_KV) return corsResponse({ error: 'KV not configured' }, 503, origin);
  const userId = getUserId(request);
  if (!isValidUUID(userId)) return corsResponse({ error: 'userId inválido' }, 400, origin);
  if (!(await env.HORLOGERIE_KV.get(userKey(userId)))) {
    return corsResponse({ error: 'Aún no hay copia en la nube que vincular' }, 404, origin);
  }
  const code = randomPairCode();
  await env.HORLOGERIE_KV.put(`pair:${code}`, userId, { expirationTtl: PAIR_TTL });
  return corsResponse({ code, expiresAt: Date.now() + PAIR_TTL * 1000 }, 200, origin);
}

async function handlePairClaim(request, env, origin) {
  if (!env.HORLOGERIE_KV) return corsResponse({ error: 'KV not configured' }, 503, origin);
  let body;
  try { body = await request.json(); } catch { return corsResponse({ error: 'JSON inválido' }, 400, origin); }
  const code = normalizePairCode(body?.code);
  if (code.length !== PAIR_LEN) return corsResponse({ error: 'El código tiene 6 caracteres' }, 400, origin);
  const userId = await env.HORLOGERIE_KV.get(`pair:${code}`);
  if (!userId) return corsResponse({ error: 'Código no válido o caducado' }, 404, origin);
  await env.HORLOGERIE_KV.delete(`pair:${code}`);
  return corsResponse({ userId }, 200, origin);
}

/* ══════════════════════════════════════════
   SYNC SIZE — returns payload size for the user's collection
══════════════════════════════════════════ */
async function handleSyncSize(request, env, origin) {
  if (!env.HORLOGERIE_KV) return corsResponse({ error: 'KV not configured' }, 503, origin);
  const userId = getUserId(request);
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
   IMPORT — specs from a product page URL or from pasted text
   1. Download the page (or take the pasted text)
   2. Reduce it to the parts that carry specs (JSON-LD, tables, lists…)
   3. Ask a small model for a fixed JSON shape
   4. Keep only values that can be found in the source text
══════════════════════════════════════════ */
const IMPORT_FIELDS = ['brand','model','ref','type','calibre','movimiento','cristal','diametro','grosor',
                       'resistencia','reserva','caja','brazalete','esfera','asas','precio','notas'];
const IMPORT_CACHE_TTL = 30 * 86400;
const MAX_PAGE_BYTES   = 1_500_000;
const MAX_SOURCE_CHARS = 14_000;

async function handleImportUrl(request, env, origin) {
  if (!env.GROQ_API_KEY) return corsResponse({ error: 'Importación no disponible' }, 503, origin);
  let body;
  try { body = await request.json(); } catch { return corsResponse({ error: 'JSON inválido' }, 400, origin); }

  const pastedText = typeof body.text === 'string' ? body.text.trim() : '';
  const pageUrl    = typeof body.url  === 'string' ? body.url.trim()  : '';
  if (!pastedText && !pageUrl) return corsResponse({ error: 'Falta el enlace o el texto' }, 400, origin);

  if (!(await underDailyCap(env))) {
    return corsResponse({ _blocked: true, _message: 'Se ha alcanzado el límite diario de importaciones. Inténtalo mañana o rellena los datos a mano.' }, 200, origin);
  }

  let source, hostname = '';
  if (pastedText) {
    if (pastedText.length < 20) return corsResponse({ _empty: true, _message: 'El texto es demasiado corto. Copia la ficha técnica completa.' }, 200, origin);
    source = { text: pastedText.slice(0, MAX_SOURCE_CHARS), title: '', jsonld: null };
    hostname = 'texto pegado';
  } else {
    let u;
    try { u = new URL(pageUrl); } catch { return corsResponse({ error: 'Enlace no válido' }, 400, origin); }
    if (!['http:', 'https:'].includes(u.protocol) || isPrivateHost(u.hostname, env)) {
      return corsResponse({ error: 'Enlace no válido' }, 400, origin);
    }
    hostname = u.hostname.replace(/^www\./, '');

    const cacheKey = `imp:${await hashString(normalizeUrl(u))}`;
    const cached = env.HORLOGERIE_KV ? await env.HORLOGERIE_KV.get(cacheKey).catch(() => null) : null;
    if (cached) return corsResponse({ ...JSON.parse(cached), _cached: true }, 200, origin);

    const page = await downloadPage(u);
    if (page.blocked) {
      return corsResponse({ _blocked: true, _domain: hostname,
        _message: `${hostname} no deja leer la página automáticamente. Abre la ficha, copia el texto de las especificaciones y pégalo en «Pegar texto».` }, 200, origin);
    }
    source = buildSource(page.html);
    if (source.text.length < 40) {
      return corsResponse({ _empty: true, _domain: hostname,
        _message: 'La página no tiene texto legible (se carga con JavaScript). Copia las especificaciones y pégalas en «Pegar texto».' }, 200, origin);
    }
    const result = await extractSpecs(env, source, hostname);
    if (result._ok && env.HORLOGERIE_KV) {
      await env.HORLOGERIE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: IMPORT_CACHE_TTL }).catch(() => {});
    }
    return corsResponse(result, 200, origin);
  }

  return corsResponse(await extractSpecs(env, source, hostname), 200, origin);
}

/* ── Daily global cap (bounds the AI bill if the endpoint is abused) ── */
async function underDailyCap(env) {
  if (!env.HORLOGERIE_KV) return true;
  const cap = parseInt(env.IMPORT_DAILY_CAP || '300', 10);
  const key = `impday:${new Date().toISOString().slice(0, 10)}`;
  try {
    const n = parseInt((await env.HORLOGERIE_KV.get(key)) || '0', 10);
    if (n >= cap) return false;
    await env.HORLOGERIE_KV.put(key, String(n + 1), { expirationTtl: 2 * 86400 });
  } catch {}
  return true;
}

/* ── No fetching of internal addresses (defence in depth) ── */
function isPrivateHost(host, env) {
  if (env.ALLOW_LOCAL_FETCH === '1') return false;   // tests only
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^\[?[0-9a-f:]+\]?$/.test(h) && h.includes(':')) return true;          // IPv6 literal
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function normalizeUrl(u) {
  const keep = new URL(u.toString());
  keep.hash = '';
  // Drop tracking parameters so the same product hits the cache
  [...keep.searchParams.keys()].forEach(k => { if (/^(utm_|ref|tag|gclid|fbclid|spm|scm|_ga|psc|th)/i.test(k)) keep.searchParams.delete(k); });
  return keep.toString();
}

async function downloadPage(u) {
  let res;
  try {
    res = await fetch(u.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-ES,es;q=0.9,pt;q=0.8,en;q=0.7',
      },
      signal: AbortSignal.timeout(12000),
    });
  } catch { return { blocked: true }; }
  if (!res.ok) return { blocked: true, status: res.status };
  const type = res.headers.get('content-type') || '';
  if (!/html|xml|text/.test(type)) return { blocked: true };
  const reader = res.body.getReader();
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length; chunks.push(value);
    if (size > MAX_PAGE_BYTES) { try { await reader.cancel(); } catch {} break; }
  }
  const html = new TextDecoder().decode(concatBytes(chunks, Math.min(size, MAX_PAGE_BYTES)));
  if (/captcha|robot check|are you a robot|cf-chl|just a moment\.\.\.|access denied|perimeterx|datadome/i.test(html.slice(0, 20000)) &&
      !/application\/ld\+json/i.test(html)) {
    return { blocked: true };
  }
  return { html };
}

function concatBytes(chunks, total) {
  const out = new Uint8Array(total); let off = 0;
  for (const c of chunks) { const n = Math.min(c.length, total - off); out.set(c.subarray(0, n), off); off += n; if (off >= total) break; }
  return out;
}

/* ── Reduce a page to the text that can contain specs ── */
function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
          .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function stripTags(html) {
  return decodeEntities(html.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d|dd|dt|section)>/gi, '\n')
    .replace(/<t[dh][^>]*>/gi, ' | ').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function buildSource(html) {
  const parts = [];
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const ogTitle = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || [])[1] || '';
  const desc = (html.match(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]+content=["']([^"']+)/i) || [])[1] || '';
  if (title || ogTitle) parts.push('TÍTULO: ' + decodeEntities(ogTitle || title).trim());
  if (desc) parts.push('DESCRIPCIÓN: ' + decodeEntities(desc).trim());

  // JSON-LD Product data (most shops and brand sites publish it)
  const jsonld = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim());
      for (const d of [].concat(data['@graph'] || data)) {
        const t = [].concat(d['@type'] || []).join(',');
        if (/Product|IndividualProduct|ProductModel/i.test(t)) jsonld.push(d);
      }
    } catch {}
  }
  if (jsonld.length) {
    const p = jsonld[0];
    const brand = typeof p.brand === 'string' ? p.brand : p.brand?.name;
    const offer = [].concat(p.offers || [])[0] || {};
    const props = [].concat(p.additionalProperty || []).map(x => `${x.name}: ${x.value}`).join('\n');
    parts.push(['DATOS ESTRUCTURADOS:', p.name && `Nombre: ${p.name}`, brand && `Marca: ${brand}`,
      (p.mpn || p.sku || p.model) && `Referencia: ${p.mpn || p.model || p.sku}`,
      offer.price && `Precio: ${offer.price} ${offer.priceCurrency || ''}`,
      p.description && `Descripción: ${stripTags(String(p.description)).slice(0, 1500)}`, props].filter(Boolean).join('\n'));
  }

  // Spec-looking blocks: tables, definition lists, bullet lists
  const blocks = [];
  for (const tag of ['table', 'dl', 'ul']) {
    const r = new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, 'gi');
    let b;
    while ((b = r.exec(html)) !== null) {
      const t = stripTags(b[0]);
      if (t.length > 30 && t.length < 6000 && SPEC_HINT.test(t)) blocks.push(t);
    }
  }
  if (blocks.length) parts.push('ESPECIFICACIONES:\n' + [...new Set(blocks)].join('\n---\n'));

  // Remaining body text, as a fallback
  const body = stripTags((html.match(/<body[\s\S]*<\/body>/i) || [html])[0]);
  const specLines = body.split('\n').filter(l => SPEC_HINT.test(l) && l.length < 300);
  if (specLines.length) parts.push('LÍNEAS CON DATOS:\n' + [...new Set(specLines)].slice(0, 120).join('\n'));

  return { text: parts.join('\n\n').slice(0, MAX_SOURCE_CHARS), title: decodeEntities(ogTitle || title).trim(), jsonld: jsonld[0] || null };
}

const SPEC_HINT = /calib|caliber|movement|movimiento|movimento|automatic|autom[aá]tic|quartz|cuarzo|quartzo|cristal|crystal|vidro|zafiro|sapphire|safira|di[aá]metro|diameter|case size|caja|case|caixa|grosor|thickness|espessura|water|agua|[áa]gua|resist|\bATM\b|\bbar\b|reserva|power reserve|bracelet|brazalete|correa|strap|pulseira|dial|esfera|mostrador|lug|asas|\bmm\b|jewels|rub[ií]es|\bbph\b|NH3\d|Miyota|Seiko|ETA|Sellita|Seagull|PT5000/i;

/* ── Ask the model, then verify every value against the source ── */
async function extractSpecs(env, source, hostname) {
  const system = `Eres un extractor de fichas técnicas de relojes de pulsera. Devuelves SOLO un objeto JSON.
Reglas:
- Usa únicamente datos que aparezcan en el TEXTO. Si un dato no aparece, deja "".
- No deduzcas calibres, medidas ni materiales por conocimiento propio.
- Escribe en español, breve: "Zafiro", "Acero inoxidable 316L", "200 m (20 ATM)", "40 mm", "41 h".
- type: "automatic", "quartz" o "manual" solo si el texto lo dice (incluye "mecha-quartz" como "quartz").
- precio: tal como aparece con su moneda.
- notas: como máximo una frase con algo útil que no encaje en otro campo (complicaciones, edición limitada...).`;
  const user = `Fuente: ${hostname}
Devuelve este JSON: {"brand":"","model":"","ref":"","type":"","calibre":"","movimiento":"","cristal":"","diametro":"","grosor":"","resistencia":"","reserva":"","caja":"","brazalete":"","esfera":"","asas":"","precio":"","notas":""}
- movimiento: tipo + frecuencia (bph/Hz) + rubíes si aparecen
- asas: ancho entre asas en mm

TEXTO:
${source.text}`;

  let raw;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: env.GROQ_MODEL || DEFAULT_IMPORT_MODEL,
        temperature: 0,
        max_tokens: 900,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`Groq ${res.status}`);
    const data = await res.json();
    raw = parseJSON(data.choices?.[0]?.message?.content || '{}');
  } catch (e) {
    await logError(env, '/import-url', e, 'groq');
    return { _blocked: true, _domain: hostname, _message: 'El servicio de lectura no responde ahora. Inténtalo en un rato o rellena los datos a mano.' };
  }

  const { specs, dropped } = verifyAgainstSource(raw, source.text);
  const filled = Object.keys(specs).filter(k => specs[k]).length;
  if (!filled) {
    return { _empty: true, _domain: hostname, _message: 'No he encontrado especificaciones en esa página. Prueba con la web oficial del reloj o pega el texto de la ficha.' };
  }
  return { ...specs, _ok: true, _source: hostname, _dropped: dropped, _method: 'page+llm' };
}

/**
 * Anti-invention check: a value is kept only if its key tokens appear in the
 * source text. Numbers (40, 200, 41…) must appear literally; for text fields
 * at least one significant word must appear. Returns kept specs and the names
 * of dropped fields.
 */
function verifyAgainstSource(raw, text) {
  const hay = ' ' + text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + ' ';
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const TRANSLATIONS = { zafiro: ['sapphire', 'safira', 'zafiro'], mineral: ['mineral', 'hardlex'], acrilico: ['acrylic', 'acrilico', 'hesalite', 'plexi'],
    acero: ['steel', 'acero', 'aco', 'inox'], titanio: ['titanium', 'titanio'], bronce: ['bronze', 'bronce'], cuero: ['leather', 'cuero', 'couro', 'piel'],
    caucho: ['rubber', 'caucho', 'borracha', 'silicone', 'silicona', 'fkm'], automatico: ['automatic', 'automatico', 'self-winding', 'auto'],
    cuarzo: ['quartz', 'cuarzo', 'quartzo'], manual: ['hand-wound', 'manual', 'hand wound', 'handwound'], negro: ['black', 'negro', 'preto'],
    azul: ['blue', 'azul'], blanco: ['white', 'blanco', 'branco'], verde: ['green', 'verde'], gris: ['grey', 'gray', 'gris', 'cinza'],
    malla: ['mesh', 'milanese', 'malla'], nato: ['nato'], oro: ['gold', 'oro', 'ouro'], plata: ['silver', 'plata', 'prata'] };
  const appears = word => {
    const w = norm(word);
    if (hay.includes(w)) return true;
    for (const [k, alts] of Object.entries(TRANSLATIONS)) if (w.startsWith(k.slice(0, 5)) && alts.some(a => hay.includes(a))) return true;
    return false;
  };
  const specs = {}; const dropped = [];
  for (const f of IMPORT_FIELDS) {
    let v = raw?.[f];
    if (v === undefined || v === null) continue;
    v = String(v).trim().slice(0, f === 'notas' ? 240 : 120);
    if (!v || /^(n\/?a|no disponible|desconocido|unknown|-+)$/i.test(v)) continue;
    if (f === 'type') { if (['automatic', 'quartz', 'manual'].includes(v)) specs.type = v; continue; }
    if (f === 'notas') { specs.notas = v; continue; }            // free text, not verified
    const numbers = v.match(/\d+(?:[.,]\d+)?/g) || [];
    const numsOk = numbers.every(n => hay.includes(n) || hay.includes(n.replace(',', '.')) || hay.includes(n.replace('.', ',')));
    const words = norm(v).split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !/^(mm|atm|bar|horas|hours|metros|meters)$/.test(w));
    const wordsOk = !words.length || words.some(appears);
    const keep = ['diametro', 'grosor', 'asas', 'resistencia', 'reserva', 'precio'].includes(f) ? numbers.length > 0 && numsOk
               : (numsOk && wordsOk);
    if (keep) specs[f] = v; else dropped.push(f);
  }
  return { specs, dropped };
}

/* ── Helpers ── */
function parseJSON(text) {
  if (!text) return {};
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(clean); } catch {}
  const m = clean.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return {};
}
