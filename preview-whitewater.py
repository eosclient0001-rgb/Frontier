"""Serve the second HTML experiment at / without changing the original index.html.

Run: python3 preview-whitewater.py --port 8002
The original pond remains available at /index.html on this server.
"""
import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


class WhitewaterHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # This is an editable preview: never mix cached modules from different revisions.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if urlsplit(self.path).path == "/":
            self.path = "/whitewater.html"
        super().do_GET()

    def do_HEAD(self):
        if urlsplit(self.path).path == "/":
            self.path = "/whitewater.html"
        super().do_HEAD()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8002)
    args = parser.parse_args()
    handler = functools.partial(WhitewaterHandler, directory=str(Path(__file__).resolve().parent))
    server = ThreadingHTTPServer(("0.0.0.0", args.port), handler)
    print(f"Whitewater Lab on port {args.port}; original pond at /index.html", flush=True)
    server.serve_forever()
