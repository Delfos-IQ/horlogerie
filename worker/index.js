/**
 * Cloudflare Worker — Horlogerie (Rotor) API v14
 *
 * v14 (oct 2026) — cloud 2.0, needs a D1 database bound as DB:
 *   - End-to-end encryption: the app encrypts every watch, wishlist item and
 *     photo (AES-GCM) with a key derived from the recovery key. This Worker
 *     only sees an opaque account id, a write token hash and ciphertext.
 *   - One row per item (no 3 MB ceiling), photos stored apart, and
 *     incremental sync by revision (/v2/sync), atomic per batch in D1.
 *   - Linking codes v2: the app encrypts the key with the code before
 *     sending it; the code never reaches the server (/v2/pair*).
 *   - /sync/* (v1) stays for older apps and answers 409 once the account
 *     has moved to v2, so an old device can't recreate a plain copy.
 *   Without DB the Worker behaves like v13 and the app keeps using v1.
 *
 * v13 (oct 2026):
 *   - Short recovery keys: besides UUIDs, the session id can be 16 Crockford
 *     base32 characters in groups of four (7KQ2-M4XR-9TBW-2HNF, 80 bits).
 *   - Device linking: /pair/create stores a one-use 6-character code for
 *     10 minutes that points to the session; /pair/claim swaps it for the
 *     session id. Claims are limited to 10 per hour per IP.
 *   - /import-url no longer uses AI (Groq removed): it downloads the page the
 *     user links to and returns the spec-bearing text; the app parses it.
 *     GROQ_API_KEY is no longer needed and can be deleted from Cloudflare.
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
 *   - (v11) GROQ_API_KEY was only required by /import-url; v13 does not use it.
 *   - /health reports capabilities so the app can pick the safest protocol.
 *
 * Secrets / variables (Cloudflare dashboard → Settings → Variables):
 *   IMPORT_DAILY_CAP  — optional, page reads per day for everyone (default 300)
 *
 * KV Binding: HORLOGERIE_KV
 *
 * Security (Fase 2):
 *   - CORS restricted to GitHub Pages origin only
 *   - Rate limiting on page reads and linking codes (per IP via KV)
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
      // Endpoints that only make sense from the app: refuse calls without its
      // origin (stops casual use of the page reader as an open proxy; not a
      // security boundary, a script can fake the header).
      const APP_ONLY = ['/import-url', '/pair/create', '/pair/claim', '/v2/pair', '/v2/pair/claim'];
      if (APP_ONLY.includes(url.pathname) && request.method !== 'OPTIONS' && !isAllowedOrigin(origin)) {
        return corsResponse({ error: 'Origin not allowed' }, 403, origin);
      }
      const RATE_LIMITED = { '/import-url': [RATE_LIMIT_MAX, false], '/pair/create': [RATE_LIMIT_MAX, false], '/pair/claim': [PAIR_CLAIM_MAX, true],
                             '/v2/pair': [RATE_LIMIT_MAX, false], '/v2/pair/claim': [PAIR_CLAIM_MAX, true], '/v2/sync': [V2_SYNC_MAX, false] };
      if (RATE_LIMITED[url.pathname] && request.method !== 'OPTIONS') {
        const [max, durable] = RATE_LIMITED[url.pathname];
        const limited = await checkRateLimit(env, ip, url.pathname, max, durable);
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
      if (pathname === '/v2/sync'       && method === 'POST')   return await handleV2Sync(request, env, origin);
      if (pathname === '/v2/account'    && method === 'GET')    return await handleV2Account(request, env, origin);
      if (pathname === '/v2/account'    && method === 'DELETE') return await handleV2Delete(request, env, origin);
      if (pathname === '/v2/pair'       && method === 'POST')   return await handleV2PairCreate(request, env, origin);
      if (pathname === '/v2/pair/claim' && method === 'POST')   return await handleV2PairClaim(request, env, origin);
      if (pathname === '/health'      || pathname === '/')    return corsResponse({
        status: 'ok', version: '14.0', kv: !!env.HORLOGERIE_KV, db: !!env.DB,
        caps: { userHeader: true, wishlist: true, importUrl: true, importSource: true, shortKey: true, pairing: true,
                v2: !!env.DB, e2e: !!env.DB, pairingV2: !!env.HORLOGERIE_KV },
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
      'Access-Control-Allow-Headers': 'Content-Type, X-Horlogerie-User, X-Rotor-Id, X-Rotor-Auth',
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
   - In memory (per Worker instance) for cheap endpoints: no KV writes, which
     matter because the free plan allows 1,000 KV writes a day in total.
   - In KV only where a global count matters (linking-code guesses).
   Fails open if KV is unavailable.
══════════════════════════════════════════ */
const _memHits = new Map();   // key → { n, reset }
function memLimited(key, max, windowSec) {
  const now = Date.now();
  const e = _memHits.get(key);
  if (!e || e.reset < now) { _memHits.set(key, { n: 1, reset: now + windowSec * 1000 }); return false; }
  if (_memHits.size > 5000) _memHits.clear();   // bounded memory
  e.n++;
  return e.n > max;
}
async function checkRateLimit(env, ip, pathname, max = RATE_LIMIT_MAX, durable = false) {
  const endpoint = pathname.replace(/\//g, '_');
  const ipHash   = await hashString(ip);
  if (!durable || !env.HORLOGERIE_KV) return memLimited(`${ipHash}:${endpoint}`, max, RATE_LIMIT_WINDOW);
  const key = `rl:${ipHash}:${endpoint}`;
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
  if (await movedToV2(env, userId)) {
    return corsResponse({ error: 'Esta copia ya usa la nube cifrada. Actualiza la app.', migrated: true }, 409, origin);
  }
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
  const payload    = JSON.stringify({ watches: finalWatches, wishlist: finalWishlist, updatedAt: now, version: 3, mode });
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
   CLOUD 2.0 — end-to-end encrypted, one row per item (D1)

   Schema (created on first use):
     users(uid, auth, created, updated)        auth = SHA-256 of the write token
     items(uid, id, kind, updated, rev, deleted, data, photo, photo_rev)
   uid and the write token are derived by the app from the recovery key; data
   and photo are AES-GCM ciphertext. The Worker never sees the key.
══════════════════════════════════════════ */
const V2_SYNC_MAX     = 240;           // sync calls per hour per IP (in memory)
const V2_MAX_ITEMS    = 3000;          // per account
const V2_MAX_DATA     = 64 * 1024;     // per item ciphertext (base64 chars)
const V2_MAX_PHOTO    = 2 * 1024 * 1024;
const V2_MAX_BODY     = 8 * 1024 * 1024;
const V2_PAGE_ITEMS   = 120;
const V2_PAGE_BYTES   = 4 * 1024 * 1024;
const HEX_RE          = /^[0-9a-f]{32,64}$/;
const ITEM_ID_RE      = /^[A-Za-z0-9_-]{1,64}$/;
let _schemaReady = false;

async function ensureSchema(env) {
  if (_schemaReady) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS users (uid TEXT PRIMARY KEY, auth TEXT NOT NULL, created INTEGER, updated INTEGER)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS items (uid TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL,
      updated INTEGER NOT NULL, rev INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
      data TEXT, photo TEXT, photo_rev INTEGER, PRIMARY KEY (uid, kind, id))`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS items_rev ON items (uid, rev)'),
  ]);
  _schemaReady = true;
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Same derivation as the app's id for a v1 key, so v1 endpoints can tell an account moved */
async function movedToV2(env, v1Key) {
  if (!env.DB || !isValidUUID(v1Key)) return false;
  try {
    await ensureSchema(env);
    const uid = await v2UidFromKey(v1Key);
    return !!(await env.DB.prepare('SELECT 1 FROM users WHERE uid = ?').bind(uid).first());
  } catch { return false; }
}
async function v2UidFromKey(key) {
  const k = /^[0-9a-f-]{36}$/i.test(key) ? key.toLowerCase() : key.toUpperCase();
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(k), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('rotor/v2'),
    info: new TextEncoder().encode('id') }, base, 128);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Checks X-Rotor-Id / X-Rotor-Auth. With register=true an unknown account is
 * created (first upload); otherwise it must exist.
 * @returns {Promise<{uid: string} | Response>}
 */
async function v2Auth(request, env, origin, register = false) {
  if (!env.DB) return corsResponse({ error: 'Nube 2.0 no configurada' }, 503, origin);
  const uid  = (request.headers.get('X-Rotor-Id') || '').toLowerCase();
  const auth = (request.headers.get('X-Rotor-Auth') || '').toLowerCase();
  if (!HEX_RE.test(uid) || !HEX_RE.test(auth)) return corsResponse({ error: 'Credenciales no válidas' }, 400, origin);
  await ensureSchema(env);
  const authHash = await sha256Hex(auth);
  const row = await env.DB.prepare('SELECT auth FROM users WHERE uid = ?').bind(uid).first();
  if (!row) {
    if (!register) return corsResponse({ exists: false }, 404, origin);
    const now = Date.now();
    await env.DB.prepare('INSERT OR IGNORE INTO users (uid, auth, created, updated) VALUES (?, ?, ?, ?)').bind(uid, authHash, now, now).run();
    const again = await env.DB.prepare('SELECT auth FROM users WHERE uid = ?').bind(uid).first();
    if (!again || again.auth !== authHash) return corsResponse({ error: 'Credenciales no válidas' }, 403, origin);
    return { uid };
  }
  if (row.auth !== authHash) return corsResponse({ error: 'Credenciales no válidas' }, 403, origin);
  return { uid };
}

async function handleV2Sync(request, env, origin) {
  const len = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (len > V2_MAX_BODY) return corsResponse({ error: 'Envío demasiado grande' }, 413, origin);
  let body;
  try { body = await request.json(); } catch { return corsResponse({ error: 'JSON inválido' }, 400, origin); }
  const changes = Array.isArray(body?.changes) ? body.changes : [];
  const auth = await v2Auth(request, env, origin, changes.length > 0);
  if (auth instanceof Response) {
    // Nothing uploaded yet and nothing to upload: an empty account
    if (auth.status === 404) return corsResponse({ rev: 0, items: [], more: false, exists: false }, 200, origin);
    return auth;
  }
  const { uid } = auth;

  // ── 1. Apply the changes (last writer wins per item, by the app's updated time) ──
  if (changes.length) {
    if (changes.length > 200) return corsResponse({ error: 'Demasiados cambios en un envío' }, 400, origin);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM items WHERE uid = ? AND deleted = 0').bind(uid).first();
    if ((count?.n || 0) + changes.filter(c => !c.deleted).length > V2_MAX_ITEMS + 200) {
      return corsResponse({ error: `Demasiados elementos (máx. ${V2_MAX_ITEMS})` }, 413, origin);
    }
    const base = Date.now() * 1000;
    const stmts = [];
    for (let i = 0; i < changes.length; i++) {
      const c = changes[i];
      if (!c || !ITEM_ID_RE.test(c.id || '') || !['w', 'l'].includes(c.kind) || !Number.isFinite(c.updated)) {
        return corsResponse({ error: 'Cambio no válido' }, 400, origin);
      }
      const rev = base + i;
      if (c.deleted) {
        stmts.push(env.DB.prepare(`INSERT INTO items (uid, id, kind, updated, rev, deleted, data, photo, photo_rev)
          VALUES (?1, ?2, ?3, ?4, ?5, 1, NULL, NULL, ?5)
          ON CONFLICT (uid, kind, id) DO UPDATE SET updated = ?4, rev = ?5, deleted = 1, data = NULL, photo = NULL, photo_rev = ?5
          WHERE excluded.updated >= items.updated`).bind(uid, c.id, c.kind, c.updated, rev));
        continue;
      }
      if (typeof c.data !== 'string' || c.data.length > V2_MAX_DATA) return corsResponse({ error: 'Elemento demasiado grande' }, 413, origin);
      const hasPhoto = typeof c.photo === 'string';
      if (hasPhoto && c.photo.length > V2_MAX_PHOTO) return corsResponse({ error: 'Foto demasiado grande' }, 413, origin);
      stmts.push(hasPhoto
        ? env.DB.prepare(`INSERT INTO items (uid, id, kind, updated, rev, deleted, data, photo, photo_rev)
            VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?5)
            ON CONFLICT (uid, kind, id) DO UPDATE SET updated = ?4, rev = ?5, deleted = 0, data = ?6, photo = ?7, photo_rev = ?5
            WHERE excluded.updated >= items.updated`).bind(uid, c.id, c.kind, c.updated, rev, c.data, c.photo || null)
        : env.DB.prepare(`INSERT INTO items (uid, id, kind, updated, rev, deleted, data, photo, photo_rev)
            VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, NULL, NULL)
            ON CONFLICT (uid, kind, id) DO UPDATE SET updated = ?4, rev = ?5, deleted = 0, data = ?6
            WHERE excluded.updated >= items.updated`).bind(uid, c.id, c.kind, c.updated, rev, c.data));
    }
    // A stale change (older than what is stored) is ignored, but the stored
    // row gets a new revision so the device that sent it receives the newer one.
    for (let i = 0; i < changes.length; i++) {
      const c = changes[i];
      stmts.push(env.DB.prepare('UPDATE items SET rev = ? WHERE uid = ? AND kind = ? AND id = ? AND updated > ?')
        .bind(base + i, uid, c.kind, c.id, c.updated));
    }
    stmts.push(env.DB.prepare('UPDATE users SET updated = ? WHERE uid = ?').bind(Date.now(), uid));
    await env.DB.batch(stmts);   // atomic
  }

  // ── 2. What changed since the app's last revision ──
  if (body.pull === false) return corsResponse({ ok: true, applied: changes.length }, 200, origin);
  const since = Number.isFinite(body.since) ? body.since : 0;
  const { results } = await env.DB.prepare(`SELECT id, kind, updated, rev, deleted, data,
      CASE WHEN photo_rev > ?2 THEN COALESCE(photo, '') ELSE NULL END AS photo
    FROM items WHERE uid = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3`).bind(uid, since, V2_PAGE_ITEMS + 1).all();
  const items = []; let bytes = 0, more = results.length > V2_PAGE_ITEMS;
  for (const r of results.slice(0, V2_PAGE_ITEMS)) {
    bytes += (r.data?.length || 0) + (r.photo?.length || 0);
    if (items.length && bytes > V2_PAGE_BYTES) { more = true; break; }
    const it = { id: r.id, kind: r.kind, updated: r.updated, rev: r.rev };
    if (r.deleted) it.deleted = true; else it.data = r.data;
    if (r.photo !== null && r.photo !== undefined) it.photo = r.photo;   // '' = photo removed
    items.push(it);
  }
  const rev = items.length ? items[items.length - 1].rev : since;
  return corsResponse({ rev, items, more, exists: true }, 200, origin);
}

async function handleV2Account(request, env, origin) {
  const auth = await v2Auth(request, env, origin, false);
  if (auth instanceof Response) return auth.status === 404 ? corsResponse({ exists: false }, 200, origin) : auth;
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN kind = 'w' THEN 1 ELSE 0 END) AS watches,
      COALESCE(SUM(LENGTH(data)), 0) + COALESCE(SUM(LENGTH(photo)), 0) AS bytes
    FROM items WHERE uid = ? AND deleted = 0`).bind(auth.uid).first();
  return corsResponse({ exists: true, count: r?.watches || 0, items: r?.n || 0, sizeBytes: r?.bytes || 0, maxItems: V2_MAX_ITEMS }, 200, origin);
}

async function handleV2Delete(request, env, origin) {
  const auth = await v2Auth(request, env, origin, false);
  if (auth instanceof Response) return auth.status === 404 ? corsResponse({ ok: true }, 200, origin) : auth;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM items WHERE uid = ?').bind(auth.uid),
    env.DB.prepare('DELETE FROM users WHERE uid = ?').bind(auth.uid),
  ]);
  return corsResponse({ ok: true }, 200, origin);
}

/* Linking codes v2: { lookup, blob } where lookup = PBKDF2(code) and blob =
   AES-GCM(recovery key) under another PBKDF2(code). The code itself never
   reaches the server; the record lives 10 minutes and is deleted on claim. */
async function handleV2PairCreate(request, env, origin) {
  if (!env.HORLOGERIE_KV) return corsResponse({ error: 'KV not configured' }, 503, origin);
  let body;
  try { body = await request.json(); } catch { return corsResponse({ error: 'JSON inválido' }, 400, origin); }
  if (!/^[0-9a-f]{64}$/.test(body?.lookup || '') || typeof body.blob !== 'string' || body.blob.length > 1024) {
    return corsResponse({ error: 'Datos no válidos' }, 400, origin);
  }
  await env.HORLOGERIE_KV.put(`pair2:${body.lookup}`, body.blob, { expirationTtl: PAIR_TTL });
  return corsResponse({ ok: true, expiresAt: Date.now() + PAIR_TTL * 1000 }, 200, origin);
}
async function handleV2PairClaim(request, env, origin) {
  if (!env.HORLOGERIE_KV) return corsResponse({ error: 'KV not configured' }, 503, origin);
  let body;
  try { body = await request.json(); } catch { return corsResponse({ error: 'JSON inválido' }, 400, origin); }
  if (!/^[0-9a-f]{64}$/.test(body?.lookup || '')) return corsResponse({ error: 'Datos no válidos' }, 400, origin);
  const blob = await env.HORLOGERIE_KV.get(`pair2:${body.lookup}`);
  if (!blob) return corsResponse({ error: 'Código no válido o caducado' }, 404, origin);
  await env.HORLOGERIE_KV.delete(`pair2:${body.lookup}`);
  return corsResponse({ blob }, 200, origin);
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
   IMPORT — read a product page the user links to (v13: no AI)
   1. Download the page (public pages only, size and time limits)
   2. Reduce it to the parts that carry specs (JSON-LD, tables, lists, lines)
   3. Return that text: the app reads the specs itself (js/spec-parser.js),
      so nothing is invented and the parser can improve without redeploying.
   Pasted text never reaches the server: the app parses it locally.
══════════════════════════════════════════ */
const IMPORT_CACHE_TTL = 30 * 86400;
const MAX_PAGE_BYTES   = 1_500_000;
const MAX_SOURCE_CHARS = 20_000;

async function handleImportUrl(request, env, origin) {
  let body;
  try { body = await request.json(); } catch { return corsResponse({ error: 'JSON inválido' }, 400, origin); }
  const pageUrl = typeof body.url === 'string' ? body.url.trim() : '';
  if (!pageUrl) return corsResponse({ error: 'Falta el enlace' }, 400, origin);

  let u;
  try { u = new URL(pageUrl); } catch { return corsResponse({ error: 'Enlace no válido' }, 400, origin); }
  if (!['http:', 'https:'].includes(u.protocol) || isPrivateHost(u.hostname, env)) {
    return corsResponse({ error: 'Enlace no válido' }, 400, origin);
  }
  const hostname = u.hostname.replace(/^www\./, '');

  const cacheKey = `imp2:${await hashString(normalizeUrl(u))}`;
  const cached = env.HORLOGERIE_KV ? await env.HORLOGERIE_KV.get(cacheKey).catch(() => null) : null;
  if (cached) return corsResponse({ ...JSON.parse(cached), _cached: true }, 200, origin);

  if (!(await underDailyCap(env))) {
    return corsResponse({ _blocked: true, _message: 'Se ha alcanzado el límite diario de lecturas. Pega el texto de la ficha o inténtalo mañana.' }, 200, origin);
  }

  const page = await downloadPage(u, env);
  if (page.blocked) {
    return corsResponse({ _blocked: true, _domain: hostname,
      _message: `${hostname} no deja leer la página automáticamente. Abre la ficha, copia el texto de las especificaciones y pégalo en «Pegar texto».` }, 200, origin);
  }
  const source = buildSource(page.html);
  if (source.text.length < 40 && !source.jsonld) {
    return corsResponse({ _empty: true, _domain: hostname,
      _message: 'La página no tiene texto legible (se carga con JavaScript). Copia las especificaciones y pégalas en «Pegar texto».' }, 200, origin);
  }
  const result = { _ok: true, _source: hostname, title: source.title, jsonld: source.jsonld, text: source.text };
  if (env.HORLOGERIE_KV) {
    await env.HORLOGERIE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: IMPORT_CACHE_TTL }).catch(() => {});
  }
  return corsResponse(result, 200, origin);
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
  if (/^(0x[0-9a-f]+|\d+)$/i.test(h)) return true;                         // integer IPs (2130706433)
  if (/^[\d.]+$/.test(h) && /(^|\.)0\d/.test(h)) return true;               // octal-looking parts (0177.0.0.1)
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
         (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function normalizeUrl(u) {
  const keep = new URL(u.toString());
  keep.hash = '';
  // Drop tracking parameters so the same product hits the cache
  [...keep.searchParams.keys()].forEach(k => { if (/^(utm_|ref|tag|gclid|fbclid|spm|scm|_ga|psc|th)/i.test(k)) keep.searchParams.delete(k); });
  return keep.toString();
}

async function downloadPage(u, env) {
  let res, current = u;
  try {
    // Follow redirects by hand so every hop is checked against private hosts
    for (let hop = 0; ; hop++) {
      res = await fetch(current.toString(), {
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'es-ES,es;q=0.9,pt;q=0.8,en;q=0.7',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (res.status < 300 || res.status >= 400) break;
      const loc = res.headers.get('location');
      if (!loc || hop >= 3) return { blocked: true };
      current = new URL(loc, current);
      if (!['http:', 'https:'].includes(current.protocol) || isPrivateHost(current.hostname, env)) return { blocked: true };
    }
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
  const bytes = concatBytes(chunks, Math.min(size, MAX_PAGE_BYTES));
  const html = decodePage(bytes, type);
  if (/captcha|robot check|are you a robot|cf-chl|just a moment\.\.\.|access denied|perimeterx|datadome/i.test(html.slice(0, 20000)) &&
      !/application\/ld\+json/i.test(html)) {
    return { blocked: true };
  }
  return { html };
}

/** Decode with the page's own charset (header, then <meta>), UTF-8 by default */
function decodePage(bytes, contentType) {
  let cs = (contentType.match(/charset=["']?([\w-]+)/i) || [])[1];
  if (!cs) {
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 4096));
    cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  }
  try { return new TextDecoder(cs || 'utf-8').decode(bytes); }
  catch { return new TextDecoder('utf-8').decode(bytes); }
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

  const p = jsonld[0];
  const slim = p ? { name: p.name, brand: p.brand, mpn: p.mpn, model: typeof p.model === 'string' ? p.model : undefined, sku: p.sku,
                     offers: [].concat(p.offers || []).slice(0, 1).map(o => ({ price: o.price ?? o.lowPrice, priceCurrency: o.priceCurrency })),
                     additionalProperty: [].concat(p.additionalProperty || []).slice(0, 60).map(x => ({ name: x.name, value: x.value })) } : null;
  return { text: parts.join('\n\n').slice(0, MAX_SOURCE_CHARS), title: decodeEntities(ogTitle || title).trim(), jsonld: slim };
}

const SPEC_HINT = /calib|caliber|movement|movimiento|movimento|automatic|autom[aá]tic|quartz|cuarzo|quartzo|cristal|crystal|vidro|zafiro|sapphire|safira|di[aá]metro|diameter|case size|caja|case|caixa|grosor|thickness|espessura|water|agua|[áa]gua|resist|\bATM\b|\bbar\b|reserva|power reserve|bracelet|brazalete|correa|strap|pulseira|dial|esfera|mostrador|lug|asas|\bmm\b|jewels|rub[ií]es|\bbph\b|NH3\d|Miyota|Seiko|ETA|Sellita|Seagull|PT5000/i;

