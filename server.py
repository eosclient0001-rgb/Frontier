#!/usr/bin/env python3
"""Canyon Forge dev server.

- Guarantees correct MIME types for ES modules (.js -> text/javascript).
- Sends Cache-Control: no-store so browsers can never mix stale and fresh
  app files (the classic "UI does nothing after an update" bug).
"""
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 8000


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.json': 'application/json',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with ThreadingHTTPServer(('0.0.0.0', PORT), Handler) as httpd:
        print(f'Canyon Forge dev server on :{PORT} (no-store)')
        httpd.serve_forever()
