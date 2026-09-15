"""Launch the service: ``python -m frontier.service.run --port 8010``."""
from __future__ import annotations

import argparse
import os


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8010)
    ap.add_argument("--reload", action="store_true")
    a = ap.parse_args()
    import uvicorn
    uvicorn.run("frontier.service.app:app", host=a.host, port=a.port,
                reload=a.reload, log_level="info")


if __name__ == "__main__":
    main()
