#!/usr/bin/env node
/**
 * Frontier Terrain Forge — zero-dependency static dev server.
 *
 * Serves the editor as a plain ES-module site (no bundler, no external CDN —
 * the app ships every byte it needs, including its fonts).
 *
 *   node tools/serve.mjs [port]
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wgsl': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = resolve(join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, '')));
    if (!target.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let stat;
    try {
      stat = statSync(target);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('404 ' + pathname);
      return;
    }
    if (stat.isDirectory()) {
      res.writeHead(302, { location: pathname + '/' }).end();
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-cache',
      // Cross-origin isolation is not required, but harmless and keeps
      // future SharedArrayBuffer-based work possible.
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
      'cross-origin-resource-policy': 'cross-origin',
    });
    createReadStream(target).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end(String(err && err.stack));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Frontier Terrain Forge → http://localhost:${PORT}/`);
  console.log(`WebGPU required (Chrome/Edge 113+, Safari 18+, Firefox 141+).`);
});
