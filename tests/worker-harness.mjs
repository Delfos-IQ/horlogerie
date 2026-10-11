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
const env = { HORLOGERIE_KV: KV, GROQ_API_KEY: 'test-key', ALLOW_LOCAL_FETCH: '1' };

// Simulated Groq: answers according to markers in the source text, so tests
// never call the real API. It deliberately invents one value ("grosor") to
// check that the Worker drops values that are not in the page.
const groqCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('https://api.groq.com/')) {
    const body = JSON.parse(init.body);
    groqCalls.push({ model: body.model, response_format: body.response_format });
    const text = body.messages.map(m => m.content).join('\n');
    let out = {};
    if (text.includes('SD1975S')) out = { brand: 'Steeldive', model: 'SD1975S Tuna Diver', ref: 'SD1975S', type: 'automatic',
      calibre: 'Seiko NH35', movimiento: 'Automático, 21600 bph, 24 rubíes', cristal: 'Zafiro', diametro: '44 mm',
      grosor: '15 mm', resistencia: '200 m', reserva: '41 h', caja: 'Acero inoxidable 316L', asas: '22 mm',
      esfera: '', precio: '139 EUR', notas: '' };
    else if (text.includes('Orient Bambino')) out = { brand: 'Orient', model: 'Bambino', calibre: 'F6724', diametro: '38,4 mm', cristal: 'Mineral' };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(input, init);
};
const log = [];
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  };
  // Test-only introspection
  if (req.url.startsWith('/__kv')) {
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    return res.end(JSON.stringify({ keys: [...store.keys()], data: Object.fromEntries(store), log, groqCalls }));
  }
  const headers = { ...req.headers }; delete headers.origin; delete headers.host;
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
