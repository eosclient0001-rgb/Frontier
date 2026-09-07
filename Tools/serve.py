#!/usr/bin/env python3
"""Dev server for Frontier live previews. Disables all caching so edits
(and the Arena preview proxy) can never serve stale JS/WGSL. stdlib only."""
import functools
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter logs
        sys.stderr.write('serve: %s\n' % (fmt % args))


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    http.server.ThreadingHTTPServer(
        ('0.0.0.0', port),
        functools.partial(NoCacheHandler, directory='/home/user/Frontier'),
    ).serve_forever()
