#!/usr/bin/env python3
# ============================================================================================================================================
#                                                                PREVIEW.PY
# ============================================================================================================================================
# 🧩 Serve retained native cloud images and reports without pretending the browser runs the cloud renderer.

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class CloudCaptureResponse(SimpleHTTPRequestHandler):
    # 📝 HTTP override names are fixed by the standard library. Updated captures must not inherit stale validators.
    def send_head(Self):
        for Header in ("If-Modified-Since", "If-None-Match"):
            if Header in Self.headers:
                del Self.headers[Header]
        return super().send_head()

    def end_headers(Self):
        Self.send_header("Cache-Control", "no-store")
        Self.send_header("Pragma", "no-cache")
        Self.send_header("Expires", "0")
        super().end_headers()


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--port", type=int, default=4177)
    Arguments = Parser.parse_args()
    if not 0 < Arguments.port < 65536:
        Parser.error("port outside TCP range")
    Directory = Path(__file__).resolve().parents[2] / "Exhibits/PlanetaryClouds"
    RequestType = partial(CloudCaptureResponse, directory=str(Directory))
    with ThreadingHTTPServer(("0.0.0.0", Arguments.port), RequestType) as Server:
        print(f"Retained cloud capture viewer on port {Arguments.port}; not a live cloud renderer", flush=True)
        try:
            Server.serve_forever()
        except KeyboardInterrupt:
            return


if __name__ == "__main__":
    Main()
