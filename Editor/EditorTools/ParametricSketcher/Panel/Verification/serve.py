#!/usr/bin/env python3
"""Static server for the SolidArc panel with caching fully disabled, so a plain refresh
always loads the latest code (no 304s, no stale app.js)."""
import http.server, functools, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()
    def do_GET(self):
        # drop conditional headers so If-Modified-Since / If-None-Match can't yield a 304
        for h in ('If-Modified-Since', 'If-None-Match'):
            if h in self.headers:
                del self.headers[h]
        super().do_GET()

if __name__ == '__main__':
    handler = functools.partial(NoCache, directory=ROOT)
    http.server.ThreadingHTTPServer(('0.0.0.0', 8090), handler).serve_forever()
