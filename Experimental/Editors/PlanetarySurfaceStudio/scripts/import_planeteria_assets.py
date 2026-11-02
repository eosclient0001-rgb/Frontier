#!/usr/bin/env python3
"""Extract the explicitly documented Planeteria gh-pages derivative payloads.

Usage:
  python3 scripts/import_planeteria_assets.py /path/to/planeteria-gh-pages

Only surface WebP data URLs and little-endian int16 height grids are imported.
The Moon's CGI Kit surface image is deliberately excluded; only its LOLA-derived
height grid is retained. The resulting files remain subject to each upstream
raster provider's attribution and reuse terms.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import sys
from pathlib import Path

BODIES_WITH_IMAGES = ("earth", "mars", "mercury", "venus", "ceres", "pluto")
BODIES_WITH_HEIGHT = ("moon", *BODIES_WITH_IMAGES)


def write_payload(source: Path, destination: Path, pattern: str) -> str:
    text = source.read_text(encoding="utf-8")
    match = re.search(pattern, text, re.DOTALL)
    if not match:
        raise ValueError(f"Expected data payload not found in {source}")
    content = base64.b64decode(match.group(1), validate=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)
    return hashlib.sha256(content).hexdigest()


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    upstream = Path(sys.argv[1]).resolve()
    output = Path(__file__).resolve().parents[1] / "assets" / "planet-data"
    hashes: dict[str, dict[str, str]] = {}

    for body in BODIES_WITH_HEIGHT:
        source = upstream / body / f"{body}_height.js"
        text = source.read_text(encoding="utf-8")
        match = re.search(r"window\.[A-Z]+_HEIGHT=(\{.*\});?\s*$", text, re.DOTALL)
        if not match:
            raise ValueError(f"Expected height object not found in {source}")
        grid = json.loads(match.group(1))
        raw = base64.b64decode(grid["b64"], validate=True)
        if (grid.get("w"), grid.get("h"), len(raw)) != (1024, 512, 1024 * 512 * 2):
            raise ValueError(f"Unexpected height-grid shape for {body}: {grid.get('w')}×{grid.get('h')}")
        destination = output / f"{body}-height.i16le"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(raw)
        hashes.setdefault(body, {})[destination.name] = hashlib.sha256(raw).hexdigest()

    for body in BODIES_WITH_IMAGES:
        source = upstream / body / f"{body}_texture.js"
        destination = output / f"{body}-surface.webp"
        digest = write_payload(
            source,
            destination,
            r'data:image/webp;base64,([A-Za-z0-9+/=]+)',
        )
        header = destination.read_bytes()
        if header[:4] != b"RIFF" or header[8:12] != b"WEBP" or header[12:16] != b"VP8 ":
            raise ValueError(f"Invalid lossy VP8 WebP texture for {body}")
        width = int.from_bytes(header[26:28], "little") & 0x3FFF
        height = int.from_bytes(header[28:30], "little") & 0x3FFF
        if (width, height) != (4096, 2048):
            raise ValueError(f"Unexpected texture dimensions for {body}: {width}×{height}")
        hashes.setdefault(body, {})[destination.name] = digest

    print(f"Extracted research-display derivatives to {output}")
    for body in BODIES_WITH_HEIGHT:
        print(f"{body}: {hashes[body]}")
    print("Moon imagery intentionally omitted; Vesta omitted because its published int16 height grid clips elevations above 32,767 m.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
