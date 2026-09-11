#!/usr/bin/env python3
"""Frontier SDF dev server — same as http.server but sends no-store headers,
so the browser never runs stale JS/GLSL during iteration."""
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):
        pass  # quiet

if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8077
    with ThreadingHTTPServer(("0.0.0.0", port), NoCacheHandler) as httpd:
        print(f"Frontier SDF dev server on :{port} (no-cache)")
        httpd.serve_forever()
