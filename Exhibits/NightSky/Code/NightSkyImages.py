"""Convert the night-sky PPM captures to PNG using only the standard library."""

import struct
import sys
import zlib
from pathlib import Path


def read_ppm(path: Path):
    data = path.read_bytes()
    tokens, index = [], 0
    while len(tokens) < 4:
        while data[index:index + 1].isspace():
            index += 1
        if data[index:index + 1] == b"#":
            while data[index:index + 1] not in (b"\n", b""):
                index += 1
            continue
        start = index
        while not data[index:index + 1].isspace():
            index += 1
        tokens.append(data[start:index])
    index += 1
    magic, width, height, _maximum = tokens
    assert magic == b"P6", magic
    return int(width), int(height), data[index:]


def write_png(path: Path, width: int, height: int, rgb: bytes):
    raw = bytearray()
    stride = width * 3
    for row in range(height):
        raw.append(0)
        raw.extend(rgb[row * stride:(row + 1) * stride])

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def main():
    capture_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "Exhibits/NightSky/Capture")
    image_dir = Path(sys.argv[2] if len(sys.argv) > 2 else "Exhibits/NightSky/Images")
    image_dir.mkdir(parents=True, exist_ok=True)
    names = {
        "NightSky": "NightSkyMilkyWay",
        "NightSkyMoon": "NightSkyMoon",
        "SunFlare": "SunDiskLensFlare",
        "MoonPhases": "MoonPhases",
    }
    for source, target in names.items():
        width, height, rgb = read_ppm(capture_dir / f"{source}.ppm")
        write_png(image_dir / f"{target}.png", width, height, rgb)
        print(f"wrote {image_dir / (target + '.png')} {width}x{height}")


if __name__ == "__main__":
    main()
