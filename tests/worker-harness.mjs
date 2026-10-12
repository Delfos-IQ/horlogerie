// Runs the real Worker code in Node with an in-memory KV.
// Usage: node tests/worker-harness.mjs <ruta-al-worker relativa a este archivo> <puerto>
//   p.ej. node tests/worker-harness.mjs ../worker/index.js 8711
import http from 'node:http';
const [, , workerPath, port] = process.argv;
const worker = (await import(new URL(workerPath, import.meta.url))).default;
const store = new Map();
const KV = {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v) { store.set(k, String(v)); },
  async delete(k) { store.delete(k); },
};
// D1 in memory over Node's built-in SQLite (same SQL dialect as D1)
const { DatabaseSync } = await import('node:sqlite');
const sqlite = new DatabaseSync(':memory:');
const bound = (sql, args) => ({
  sql, args,
  async first() { return sqlite.prepare(sql).get(...args) ?? null; },
  async all()   { return { results: sqlite.prepare(sql).all(...args) }; },
  async run()   { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
});
const DB = {
  prepare(sql) { const st = bound(sql, []); st.bind = (...a) => bound(sql, a); return st; },
  async batch(stmts) {
    sqlite.exec('BEGIN');
    try { const out = stmts.map(s => sqlite.prepare(s.sql).run(...s.args)); sqlite.exec('COMMIT'); return out; }
    catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  },
};
// NO_DB=1 starts the Worker without D1 (behaves like v13: cloud v1 only)
const env = { HORLOGERIE_KV: KV, ALLOW_LOCAL_FETCH: '1', ...(process.env.NO_DB ? {} : { DB }) };

// Google Play mock for Rotor Pro (NO_PRO=1 starts without it). A real RSA key signs
// the service-account JWT and the mock checks the signature, like Google would.
// Purchase tokens: valid-… (bought, not yet acknowledged), acked-…, refunded-…, pending-…; anything else is unknown.
const google = { acks: [], tokens: 0 };
if (!process.env.NO_PRO) {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
  env.GOOGLE_SERVICE_ACCOUNT = JSON.stringify({ client_email: 'rotor@test.iam', token_uri: 'https://oauth2.test/token',
    private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n` });
  const realFetch = globalThis.fetch;
  const b64d = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    if (url === 'https://oauth2.test/token') {
      const jwt = new URLSearchParams(init.body).get('assertion') || '';
      const [h, c, sig] = jwt.split('.');
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', kp.publicKey, b64d(sig || ''), new TextEncoder().encode(`${h}.${c}`));
      const claims = ok ? JSON.parse(b64d(c)) : {};
      if (!ok || claims.iss !== 'rotor@test.iam' || !claims.scope?.includes('androidpublisher')) return json({ error: 'invalid_grant' }, 400);
      google.tokens++;
      return json({ access_token: 'ya29.test', expires_in: 3600 });
    }
    if (url.startsWith('https://androidpublisher.googleapis.com/')) {
      if ((init.headers?.Authorization || '') !== 'Bearer ya29.test') return json({ error: 'unauthorized' }, 401);
      const m = url.match(/applications\/([^/]+)\/purchases\/products\/([^/]+)\/tokens\/([^/:]+)(:acknowledge)?$/);
      if (!m || m[1] !== 'com.delfosiq.rotor') return json({ error: 'not found' }, 404);
      const tok = decodeURIComponent(m[3]);
      if (m[4]) { google.acks.push(tok); return new Response(null, { status: 204 }); }
      const state = tok.startsWith('valid-') ? [0, 0] : tok.startsWith('acked-') ? [0, 1]
        : tok.startsWith('refunded-') ? [1, 1] : tok.startsWith('pending-') ? [2, 0] : null;
      if (!state) return json({ error: 'not found' }, 404);
      return json({ purchaseState: state[0], acknowledgementState: state[1], orderId: 'GPA.1234-5678', purchaseTimeMillis: '1791700000000' });
    }
    return realFetch(input, init);
  };
}

const log = [];
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  };
  // Test-only: run SQL on the in-memory D1 (to simulate tampering)
  if (req.url.startsWith('/__sql') && !process.env.NO_DB) {
    const { sql, args = [] } = JSON.parse(body.toString() || '{}');
    let out; try { out = sqlite.prepare(sql).all(...args); } catch (e) { out = { error: e.message }; }
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    return res.end(JSON.stringify(out));
  }
  // Test-only introspection
  if (req.url.startsWith('/__kv')) {
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    return res.end(JSON.stringify({ keys: [...store.keys()], data: Object.fromEntries(store), log, google,
      d1: process.env.NO_DB ? null : { users: (() => { try { return sqlite.prepare('SELECT * FROM users').all(); } catch { return []; } })(), items: (() => { try { return sqlite.prepare('SELECT uid, id, kind, updated, rev, deleted, data, LENGTH(photo) AS photoLen FROM items').all(); } catch { return []; } })() } }));
  }
  // Requests from the app (localhost in tests) arrive as if from the real app
  // origin; a test can send X-Test-Origin: none to simulate a call from outside.
  const headers = { ...req.headers }; delete headers.host;
  const testOrigin = headers['x-test-origin']; delete headers['x-test-origin'];
  if (testOrigin === 'none') delete headers.origin; else headers.origin = 'https://delfos-iq.github.io';
  const request = new Request(`https://worker.test${req.url}`, {
    method: req.method, headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : body,
  });
  log.push({ method: req.method, url: req.url, userHeader: req.headers['x-horlogerie-user'] || null });
  const r = await worker.fetch(request, env);
  const out = Object.fromEntries(r.headers);
  // Keep the Worker's own Allow-Headers so CORS behaves like production
  out['access-control-allow-origin'] = '*';
  res.writeHead(r.status, out);
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(Number(port), () => console.log('harness on', port, workerPath));
