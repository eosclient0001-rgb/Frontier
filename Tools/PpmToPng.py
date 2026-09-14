#!/usr/bin/env python3
"""Convert a binary P6 PPM to PNG.

Project Zero writes frames as P6 PPM because that keeps an image encoder out of the engine. This helper
turns one into a PNG for viewing. It uses Pillow when it is installed and otherwise falls back to a small
pure-Python PNG writer, so the conversion never depends on a third-party package being present.

    python3 Tools/PpmToPng.py input.ppm output.png
"""

from __future__ import annotations

import struct
import sys
import zlib


def read_ppm(path: str) -> tuple[int, int, bytes]:
    """Read a binary P6 PPM, honouring comments and whitespace as the format specifies."""
    with open(path, "rb") as handle:
        data = handle.read()

    if not data.startswith(b"P6"):
        raise ValueError(f"{path}: not a binary P6 PPM")

    # Pull the next three integer tokens (width, height, maxval), skipping '#' comment lines.
    fields: list[int] = []
    index = 2
    while len(fields) < 3:
        while index < len(data) and data[index : index + 1].isspace():
            index += 1
        if data[index : index + 1] == b"#":
            while index < len(data) and data[index : index + 1] not in (b"\n", b"\r"):
                index += 1
            continue
        start = index
        while index < len(data) and not data[index : index + 1].isspace():
            index += 1
        fields.append(int(data[start:index]))

    index += 1  # exactly one whitespace character separates the header from the raster
    width, height, maxval = fields
    if maxval != 255:
        raise ValueError(f"{path}: only 8-bit PPMs are supported (maxval={maxval})")

    expected = width * height * 3
    raster = data[index : index + expected]
    if len(raster) != expected:
        raise ValueError(f"{path}: truncated raster ({len(raster)} of {expected} bytes)")

    return width, height, raster


def write_png(path: str, width: int, height: int, raster: bytes) -> None:
    """Write a non-interlaced 8-bit RGB PNG without requiring Pillow."""
    # Each scanline is prefixed with filter type 0 (None).
    stride = width * 3
    scanlines = bytearray()
    for y in range(height):
        scanlines.append(0)
        scanlines += raster[y * stride : (y + 1) * stride]

    def chunk(tag: bytes, payload: bytes) -> bytes:
        head = struct.pack(">I", len(payload)) + tag
        return head + payload + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(scanlines), 9))
        + chunk(b"IEND", b"")
    )

    with open(path, "wb") as handle:
        handle.write(png)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__.strip())
        return 2

    source, destination = argv[1], argv[2]
    width, height, raster = read_ppm(source)

    try:
        from PIL import Image  # type: ignore

        Image.frombytes("RGB", (width, height), raster).save(destination)
    except ImportError:
        write_png(destination, width, height, raster)

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
