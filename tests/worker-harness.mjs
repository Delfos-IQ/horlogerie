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
    return res.end(JSON.stringify({ keys: [...store.keys()], data: Object.fromEntries(store), log,
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
