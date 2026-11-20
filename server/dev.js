import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from './app.js';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const name of ['.env.local', '.env']) if (existsSync(path.join(root, name))) process.loadEnvFile(path.join(root, name));
const handler = createHandler();
const deployment = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer(async (req, res) => {
  for (const header of deployment.headers[0].headers) res.setHeader(header.key, header.value);
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/a/')) return handler(req, res);
  const publicDir = path.join(root, 'public'), target = path.resolve(publicDir, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!target.startsWith(publicDir + path.sep)) { res.writeHead(403); return res.end(); }
  try { if (!(await stat(target)).isFile()) throw new Error(); res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(await readFile(target)); }
  catch { res.writeHead(404); res.end('Não encontrado. Execute node scripts/build.js antes de iniciar.'); }
}).listen(Number(process.env.PORT) || 7778, '127.0.0.1', () => console.log(`SceneLingo Vercel preview: http://127.0.0.1:${Number(process.env.PORT) || 7778}`));
