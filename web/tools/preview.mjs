// Vista previa local: sirve dist/ en http://localhost:8090/
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain', '.json': 'application/json', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  
  p = join(DIST, p.slice(1));
  try { if ((await stat(p)).isDirectory()) p = join(p, 'index.html'); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(await readFile(p)); }
  catch { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); res.end(await readFile(join(DIST, '404.html'))); }
}).listen(process.env.PORT || 8090, () => console.log(`Vista previa: http://localhost:${process.env.PORT || 8090}/`));
