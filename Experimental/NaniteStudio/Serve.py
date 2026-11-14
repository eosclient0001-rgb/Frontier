#!/usr/bin/env python3
"""Serve Frontier Nanite Virtual Geometry Studio on 0.0.0.0:8096."""

import functools
import http.server
import os
import sys

class NaniteStudioHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'application/javascript; charset=utf-8',
        '.mjs': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.woff2': 'font/woff2',
        '.svg': 'image/svg+xml',
        '.html': 'text/html; charset=utf-8',
        '.obj': 'text/plain; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, format, *args):
        return

class ReusableThreadingHTTPServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8096
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NaniteStudioHandler, directory=root)
    server = ReusableThreadingHTTPServer(('0.0.0.0', port), handler)
    print(f'NaniteStudio Project Zero GPU listening on http://0.0.0.0:{port}/', flush=True)
    server.serve_forever()
