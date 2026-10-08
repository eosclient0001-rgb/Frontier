#!/usr/bin/env python3
"""Generate a seamless, photoscan-style PBR texture set for a rocky cliff face.

There is no scanner involved. The surface is synthesised to carry the things a
photogrammetry capture gives you: real-scale micro relief, joints and bedding,
weathering pits, mineral grain, colour variation with no baked lighting, and
albedo / normal / roughness / AO / height maps that agree with each other.

Every map is periodic, so each one tiles seamlessly.

Conventions
-----------
* One tile covers ``--tile-m`` metres of cliff face (default 3 m).
* Image row 0 is the TOP of the cliff. three.js and glTF flip images so row 0
  maps to V = 1, which keeps "up" consistent in the viewer.
* ``height.png``: black = lowest, white = highest, spanning ``--relief-m``
  metres. Use it as a displacement map with a scale of ``relief-m``.
* ``normal.jpg`` (or ``normal.png`` with ``--normal-format png``): tangent-space,
  OpenGL convention (green = +V = up). JPEG at quality 95 keeps the set small.

Usage
-----
    python3 generate_rocky_cliff.py                       # 2048 px, default output
    python3 generate_rocky_cliff.py --size 1024 --out /tmp/preview
    python3 generate_rocky_cliff.py --normal-format png   # lossless normal map
    python3 generate_rocky_cliff.py --seed 11             # a different but equally valid rock
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

HERE = Path(__file__).resolve().parent
DEFAULT_OUT = HERE.parent / "viewer" / "public" / "textures" / "rocky-cliff"

BEDS = 6  # bedding layers per tile. Must be an integer so the strata tile.

# sRGB base colours (0..1) for the sedimentary beds. Kept fairly desaturated,
# because real cliff faces are mostly grey-tan with only hints of colour.
PALETTE = np.array(
    [
        [0.60, 0.55, 0.48],  # buff
        [0.49, 0.45, 0.41],  # taupe
        [0.66, 0.64, 0.60],  # pale limestone
        [0.44, 0.42, 0.40],  # dark grey
        [0.57, 0.50, 0.42],  # warm tan
    ],
    dtype=np.float32,
)
RUST = np.array([0.55, 0.33, 0.19], dtype=np.float32)  # iron-oxide staining
VARNISH = np.array([0.22, 0.18, 0.15], dtype=np.float32)  # dark desert varnish
LICHEN = np.array([0.55, 0.57, 0.45], dtype=np.float32)  # grey-green lichen
DUST = np.array([0.78, 0.76, 0.70], dtype=np.float32)  # pale dust on ledges


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def normalise(a: np.ndarray) -> np.ndarray:
    """Zero mean, unit standard deviation."""
    a = a - a.mean()
    return a / (a.std() + 1e-12)


def periodic_noise(
    n: int,
    rng: np.random.Generator,
    k_lo: float,
    k_hi: float,
    slope: float,
    aniso: tuple[float, float] = (1.0, 1.0),
) -> np.ndarray:
    """Seamless noise built from random phases with a band-limited power law.

    Frequencies are in cycles per tile, so the field repeats exactly every tile.

    ``aniso`` scales the frequency axes. Making the V factor large (for example
    (0.6, 5.0)) squeezes the spectrum along V, so features run long in V and
    read as vertical streaks or joints. Making the U factor large gives
    horizontal bands.
    """
    f = np.fft.fftfreq(n, d=1.0 / n)  # integer cycles per tile
    kx = f[np.newaxis, :] * aniso[0]
    ky = f[:, np.newaxis] * aniso[1]
    k = np.hypot(kx, ky)
    amp = np.zeros_like(k)
    nz = k > 0
    amp[nz] = k[nz] ** (-slope)
    amp *= np.exp(-((k / k_hi) ** 4))  # soft high-frequency cut-off
    amp *= 1.0 - np.exp(-((k / k_lo) ** 4))  # soft low-frequency cut-off
    spec = (rng.standard_normal((n, n)) + 1j * rng.standard_normal((n, n))) * amp
    field = np.fft.ifft2(spec).real.astype(np.float32)
    return normalise(field)


def make_points(cx: int, cy: int, rng: np.random.Generator):
    """One jittered feature point per cell, on a cx-by-cy grid of cells."""
    return rng.random((cy, cx), dtype=np.float32), rng.random((cy, cx), dtype=np.float32)


def worley(cx_map, cy_map, px, py, sx: float, sy: float):
    """Periodic Worley (cellular) noise.

    ``cx_map`` / ``cy_map`` give each pixel's position in cell units. Distances
    are scaled by ``sx`` / ``sy`` so they come out in tile units, which keeps
    feature sizes the same in every direction.

    Returns (F1, F2, nearest cell index). F2 - F1 is ~0 on cell borders.
    """
    ny, nx = px.shape
    cx_map, cy_map = np.broadcast_arrays(cx_map, cy_map)
    bx = np.floor(cx_map).astype(np.int32)
    by = np.floor(cy_map).astype(np.int32)
    f1 = np.full(cx_map.shape, np.inf, dtype=np.float32)
    f2 = np.full(cx_map.shape, np.inf, dtype=np.float32)
    cid = np.zeros(cx_map.shape, dtype=np.int32)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            nbx = bx + ox
            nby = by + oy
            wx = np.mod(nbx, nx)
            wy = np.mod(nby, ny)
            ptx = nbx + px[wy, wx]
            pty = nby + py[wy, wx]
            d = np.hypot((cx_map - ptx) * sx, (cy_map - pty) * sy).astype(np.float32)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            cid = np.where(closer, wy * nx + wx, cid)
            f1 = np.where(closer, d, f1)
    return f1, f2, cid


def height_field(n: int, rng: np.random.Generator, U: np.ndarray, V: np.ndarray) -> dict:
    """Build the raw height field plus the masks the other maps reuse."""
    # 1. Broad undulation, so the face is not a flat plane.
    broad = periodic_noise(n, rng, 1.0, 3.0, 2.0)

    # 2. Joints. The nodal lines of a smooth random field are long, wandering
    #    cracks. The first set is biased vertical, the second is isotropic.
    jv = periodic_noise(n, rng, 1.0, 5.0, 2.2, aniso=(0.6, 2.0))
    jo = periodic_noise(n, rng, 1.0, 5.0, 2.2)
    # Each joint has a soft, wide groove and a sharper core.
    groove = np.maximum(np.exp(-((jv / 0.10) ** 2)), 0.6 * np.exp(-((jo / 0.09) ** 2)))
    core = np.maximum(np.exp(-((jv / 0.035) ** 2)), 0.6 * np.exp(-((jo / 0.03) ** 2)))
    # Joints break up along their length, so they are not uniform lines.
    breakup = smoothstep(-1.0, 0.3, periodic_noise(n, rng, 2.0, 8.0, 1.5))
    groove *= breakup
    core *= breakup
    # Each side of a joint sits at a slightly different height.
    step = 0.08 * np.tanh(1.6 * jv) + 0.04 * np.tanh(1.6 * jo)
    crack = (0.35 * groove + 0.65 * core).astype(np.float32)
    groove = groove.astype(np.float32)
    core = core.astype(np.float32)

    # 3. Bedding. Each layer is slightly more or less resistant. Layers sit
    #    proud at their base and recede toward the top. The bed boundaries
    #    wobble at two scales, so they are never ruler-straight.
    # Uneven bed thicknesses that still sum to one tile. Equal beds would stack
    # into a regular grid as the tile repeats on the cliff.
    thick = rng.uniform(0.55, 1.45, BEDS)
    edges = np.concatenate([[0.0], np.cumsum(thick) / thick.sum()])  # BEDS + 1 values in [0, 1]
    wb = periodic_noise(n, rng, 1.0, 8.0, 2.0) * 0.025 + periodic_noise(n, rng, 10.0, 30.0, 1.5) * 0.005
    Vw = np.mod(V + wb, 1.0).astype(np.float32)  # wobbling bed coordinate, periodic
    bed = np.clip(np.searchsorted(edges, Vw, side="right") - 1, 0, BEDS - 1).astype(np.int32)
    lo = edges[bed].astype(np.float32)
    hi = edges[bed + 1].astype(np.float32)
    s = ((Vw - lo) / (hi - lo)).astype(np.float32)  # 0 at a bed base, 1 at its top
    resist = rng.uniform(0.35, 1.0, BEDS).astype(np.float32)
    strata = resist[bed] * (1.0 - s) ** 2.5

    # 4. Ridged detail. This gives fractured faces their sharp crests.
    ridge_src = periodic_noise(n, rng, 4.0, 40.0, 1.25)
    ridge = (1.0 - np.clip(np.abs(ridge_src) / 2.3, 0.0, 1.0)) ** 2

    # 5. Soft rounding and fine grain.
    mid = periodic_noise(n, rng, 1.0, 12.0, 1.9)
    fine = periodic_noise(n, rng, 30.0, n // 2, 1.1)

    # 6. Weathering pits, roughly 2 cm across on a 3 m tile.
    pc = 56
    ppx, ppy = make_points(pc, pc, rng)
    pf1, _, pcid = worley(U * pc, V * pc, ppx, ppy, 1 / pc, 1 / pc)
    pit_on = (rng.random(pc * pc) < 0.35).astype(np.float32)[pcid]
    pit_depth = rng.uniform(0.5, 1.0, pc * pc).astype(np.float32)[pcid]
    pit = pit_on * pit_depth * (1.0 - smoothstep(0.0, 0.26 / pc, pf1))

    # 7. Mineral grain. Each grain gets its own tone, with faint dark seams.
    gc = 200
    gpx, gpy = make_points(gc, gc, rng)
    gf1, gf2, gcid = worley(U * gc, V * gc, gpx, gpy, 1 / gc, 1 / gc)
    gtone = rng.uniform(-1.0, 1.0, gc * gc).astype(np.float32)[gcid]
    gseam = 1.0 - smoothstep(0.0, 0.35 / gc, gf2 - gf1)

    h = (
        0.20 * broad
        + 0.18 * strata
        + 0.14 * ridge
        + 0.06 * mid
        + 0.012 * fine
        + step
        - 0.30 * crack
        - 0.10 * pit
        - 0.012 * gseam
    ).astype(np.float32)

    return {
        "h": h,
        "crack": crack,
        "groove": groove,
        "core": core,
        "pit": pit,
        "bed": bed,
        "s": s,
        "mid": mid,
        "fine": fine,
        "gtone": gtone,
        "gseam": gseam,
        "broad": broad,
    }


def normalise_height(h: np.ndarray) -> np.ndarray:
    lo, hi = np.percentile(h[::4, ::4], [0.2, 99.8])
    return np.clip((h - lo) / (hi - lo), 0.0, 1.0).astype(np.float32)


def periodic_gradients(H: np.ndarray):
    """Central differences that wrap at the tile edges.

    Returns (d/dcol, d/drow) per pixel. Rows increase downward, so d/drow is
    minus d/dV.
    """
    gcol = (np.roll(H, -1, axis=1) - np.roll(H, 1, axis=1)) * 0.5
    grow = (np.roll(H, -1, axis=0) - np.roll(H, 1, axis=0)) * 0.5
    return gcol, grow


def cavity_ao(H: np.ndarray) -> np.ndarray:
    """Cavity AO: darken spots that sit lower than their surroundings."""
    b1 = gaussian_filter(H, 1.5, mode="wrap")
    b2 = gaussian_filter(H, 6.0, mode="wrap")
    b3 = gaussian_filter(H, 24.0, mode="wrap")
    concave = np.maximum((b1 - H) + 0.8 * (b2 - H) + 0.5 * (b3 - H), 0.0)
    scale = np.percentile(concave[::4, ::4], 99.0) + 1e-6
    ao = 1.0 - 0.85 * np.clip(concave / scale, 0.0, 1.0)
    ao *= 0.80 + 0.20 * H  # low ground is a little more occluded
    return np.clip(ao, 0.18, 1.0).astype(np.float32)


def build_maps(size: int, seed: int, tile_m: float, relief_m: float) -> dict[str, np.ndarray]:
    rng = np.random.default_rng(seed)
    n = size
    u = ((np.arange(n, dtype=np.float32) + 0.5) / n)[np.newaxis, :]  # columns
    v = (1.0 - (np.arange(n, dtype=np.float32) + 0.5) / n)[:, np.newaxis]  # rows

    parts = height_field(n, rng, u, v)
    H = normalise_height(parts["h"])
    crack, pit = parts["crack"], parts["pit"]
    mid, fine, broad = parts["mid"], parts["fine"], parts["broad"]
    bed, s = parts["bed"], parts["s"]
    gcol, grow = periodic_gradients(H)

    # ---- Height -----------------------------------------------------------
    height_u8 = np.round(H * 255).astype(np.uint8)

    # ---- Normal -----------------------------------------------------------
    # Physical slope = (metres of relief per pixel) / (metres per pixel).
    px_m = tile_m / n
    slope_u = gcol * relief_m / px_m
    slope_v = grow * relief_m / px_m  # +row (down) is -V; green = +V, so keep sign
    nx = -slope_u
    ny = slope_v
    nz = np.ones_like(nx)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.stack([nx / length, ny / length, nz / length], axis=-1)
    normal_u8 = np.round((normal * 0.5 + 0.5) * 255).astype(np.uint8)

    # ---- AO ---------------------------------------------------------------
    ao = cavity_ao(H)

    # ---- Roughness --------------------------------------------------------
    mid_n = normalise(mid)
    fine_n = normalise(fine)
    rough = 0.80 + 0.07 * mid_n + 0.04 * fine_n + 0.10 * crack + 0.06 * pit
    rough = np.clip(rough, 0.45, 1.0).astype(np.float32)
    rough_u8 = np.round(rough * 255).astype(np.uint8)

    # ---- Albedo -----------------------------------------------------------
    # Bed colours. Each bed blends into the next across its top 20%, so the
    # boundaries are soft instead of hard stripes.
    pal = PALETTE[rng.integers(0, len(PALETTE), size=BEDS)]
    next_bed = (bed + 1) % BEDS
    blend = smoothstep(0.80, 1.0, s)[..., np.newaxis]
    base = pal[bed] * (1.0 - blend) + pal[next_bed] * blend

    # Multi-scale mottling: colour patches that keep the stone from looking flat.
    patch_n = normalise(periodic_noise(n, rng, 3.0, 20.0, 1.6))
    tone = 1.0 + 0.10 * mid_n + 0.06 * normalise(broad) + 0.05 * patch_n + 0.03 * fine_n
    tone = tone + 0.03 * parts["gtone"]
    col = base * tone[..., np.newaxis]

    # Iron-oxide staining, along the lower part of two beds.
    rust_beds = np.zeros(BEDS, dtype=np.float32)
    rust_beds[rng.choice(BEDS, size=2, replace=False)] = 1.0
    bed_rust = rust_beds[bed] * (1.0 - smoothstep(0.10, 0.55, s))
    bed_rust *= smoothstep(-0.4, 0.8, mid_n)
    col = col * (1 - 0.45 * bed_rust[..., None]) + RUST * (0.45 * bed_rust[..., None])

    # Dark desert varnish: sparse, narrow vertical streaks.
    streak = periodic_noise(n, rng, 3.0, 30.0, 1.5, aniso=(0.6, 3.0))
    varnish = smoothstep(1.0, 2.6, streak) * (0.35 + 0.25 * smoothstep(-0.5, 0.8, broad))
    col = col * (1 - 0.4 * varnish[..., None]) + VARNISH * (0.4 * varnish[..., None])

    # Lichen: small grey-green clusters.
    lich_mask = smoothstep(0.7, 1.5, periodic_noise(n, rng, 2.0, 6.0, 2.0))
    lich_fine = smoothstep(1.2, 2.2, periodic_noise(n, rng, 24.0, 90.0, 1.0))
    lichen = np.clip(lich_mask * lich_fine * 0.75, 0.0, 1.0)
    col = col * (1 - lichen[..., None]) + LICHEN * lichen[..., None]

    # Pale dust settles on up-facing ledges.
    up = np.clip(grow * 110.0, 0.0, 1.0) * 0.18
    col = col * (1 - up[..., None]) + DUST * up[..., None]

    # Dirt in joints and pits, and cavity shading. The albedo stays unlit.
    col *= (1.0 - 0.14 * parts["groove"] - 0.06 * parts["core"])[..., None]
    col *= (1.0 - 0.20 * pit)[..., None]
    col *= (0.74 + 0.26 * ao)[..., None]  # subtle baked cavity shade; the AO map has the full range
    col *= (1.0 - 0.08 * parts["gseam"])[..., None]

    # Sub-pixel speckle, so the surface does not look smooth up close.
    speckle = gaussian_filter(rng.standard_normal((n, n)).astype(np.float32), 0.6, mode="wrap")
    col *= (1.0 + 0.025 * normalise(speckle))[..., None]

    albedo_u8 = np.round(np.clip(col, 0.0, 1.0) * 255).astype(np.uint8)
    ao_u8 = np.round(ao * 255).astype(np.uint8)

    return {
        "albedo": albedo_u8,
        "normal": normal_u8,
        "roughness": rough_u8,
        "ao": ao_u8,
        "height": height_u8,
    }


def save_maps(maps: dict[str, np.ndarray], out_dir: Path, prefix: str, normal_ext: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    # name -> (extension, PIL mode, JPEG quality). JPEGs use no chroma subsampling.
    jobs = {
        "albedo": ("jpg", "RGB", 93),
        "normal": (normal_ext, "RGB", 95),
        "roughness": ("jpg", "L", 92),
        "ao": ("jpg", "L", 92),
        "height": ("png", "L", None),
    }
    for name, (ext, mode, quality) in jobs.items():
        # Remove a stale copy in the other format so the folder never has two.
        for other in ("jpg", "png"):
            stale = out_dir / f"{prefix}_{name}.{other}"
            if other != ext and stale.exists():
                stale.unlink()
        img = Image.fromarray(maps[name], mode=mode)
        path = out_dir / f"{prefix}_{name}.{ext}"
        if ext == "jpg":
            img.save(path, quality=quality, subsampling=0, optimize=True)
        else:
            img.save(path, optimize=True)
        print(f"  wrote {path.name:<32} {img.size[0]}x{img.size[1]}  {path.stat().st_size / 1e6:6.2f} MB")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--size", type=int, default=2048, help="texture size in pixels (power of two)")
    parser.add_argument("--seed", type=int, default=7, help="random seed (same seed, same texture)")
    parser.add_argument("--tile-m", type=float, default=3.0, help="metres of cliff covered by one tile")
    parser.add_argument("--relief-m", type=float, default=0.35, help="height range in metres encoded by height.png")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output folder")
    parser.add_argument("--prefix", default="rocky_cliff", help="file name prefix")
    parser.add_argument(
        "--normal-format",
        choices=("jpg", "png"),
        default="jpg",
        help="normal map format. jpg (q95) is ~4x smaller; png is lossless",
    )
    args = parser.parse_args()

    if args.size < 256 or args.size & (args.size - 1):
        parser.error("--size must be a power of two >= 256")

    t0 = time.time()
    print(f"Generating {args.size}px rocky cliff set (seed {args.seed}, tile {args.tile_m} m, relief {args.relief_m} m)")
    maps = build_maps(args.size, args.seed, args.tile_m, args.relief_m)
    save_maps(maps, args.out, args.prefix, args.normal_format)
    print(f"Done in {time.time() - t0:.1f}s -> {args.out}")


if __name__ == "__main__":
    main()
