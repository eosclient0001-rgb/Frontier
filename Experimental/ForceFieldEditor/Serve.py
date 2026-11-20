#!/usr/bin/env python3
"""Standalone preview server for Experimental/ForceFieldEditor on 0.0.0.0:8094."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
EDITOR_DIR = Path(__file__).resolve().parent


class ForceFieldEditorHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        path_only = self.path.split("?", 1)[0]
        if path_only in ("/", "/index.html"):
            index_file = EDITOR_DIR / "index.html"
            body = index_file.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if not path_only.startswith("/Experimental/"):
            rel = path_only.lstrip("/")
            candidate = EDITOR_DIR / rel
            if candidate.is_file():
                self.path = "/Experimental/ForceFieldEditor/" + rel
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8094
    handler = partial(ForceFieldEditorHandler, directory=str(REPO_ROOT))
    server = ThreadingHTTPServer(("0.0.0.0", port), handler)
    print(f"Frontier ForceField Editor serving on http://0.0.0.0:{port}/", flush=True)
    server.serve_forever()
