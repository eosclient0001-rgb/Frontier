# ============================================================================================================================================
#                                                                PREVIEW.PY
# ============================================================================================================================================
# 🧩 Serve the retained native celestial capture viewer without changing shaders, captures or validation results.

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse

Root = Path(__file__).resolve().parents[2]


class CelestialBrowser(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/":
            self.send_response(302)
            self.send_header("Location", "/Exhibits/CelestialAtmosphere/Celestial.html")
            self.end_headers()
            return
        super().do_GET()


def Execute():
    Parser = argparse.ArgumentParser()
    Parser.add_argument("--port", type=int, default=4176)
    Arguments = Parser.parse_args()
    Server = ThreadingHTTPServer(("0.0.0.0", Arguments.port), partial(CelestialBrowser, directory=str(Root)))
    print(f"Celestial native capture viewer on port {Arguments.port}", flush=True)
    Server.serve_forever()


if __name__ == "__main__":
    Execute()
