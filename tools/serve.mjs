#!/usr/bin/env node
/**
 * Zero-dependency static server for the Frontier demo.
 *   node tools/serve.mjs [port] [--host 0.0.0.0]
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? process.env.PORT ?? 8080);
const hostIdx = args.indexOf('--host');
const host = hostIdx !== -1 ? args[hostIdx + 1] : '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wgsl': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filePath = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      res.writeHead(302, { Location: pathname + '/' }).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      // The demo must never be cached: iteration is fast and stale modules are confusing.
      'Cache-Control': 'no-store, max-age=0',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    createReadStream(filePath).pipe(res);
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 ' + req.url);
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end('500 ' + String(err));
    }
  }
});

server.listen(port, host, () => {
  console.log(`Frontier demo serving ${ROOT}`);
  console.log(`  http://localhost:${port}/`);
});
