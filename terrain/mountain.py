"""Mountain-peak terrain synthesis: gradient-masked ridged multifractal.

Recipe for a convincing 100 m test mountain:

1. A radial **gradient mask** (cone falloff) centered near the middle of the
   tile defines *where* the mountain is — plains at the edges, peak in the
   middle. The mask also scales the fractal amplitude so detail fades out
   naturally into the foothills instead of ending abruptly.
2. A domain-warped **ridged multifractal** built on gradient (Perlin) noise
   provides sharp crests and glacial cirque-like valleys.
3. Low-amplitude rolling-hill fBm keeps the plains alive, and a crevice term
   deepens the drainage lines that hydraulic erosion will later exploit.

All noise octaves are clamped to the grid Nyquist limit (see
:func:`terrain.noise.max_effective_octaves`) so requested detail always
matches the voxel resolution.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .noise import (
    billow,
    domain_warp,
    fbm,
    make_permutation,
    max_effective_octaves,
    ridged_multifractal,
    smoothstep,
)
from .sdf import SDFConfig, make_grid


@dataclass
class MountainParams:
    seed: int = 1337
    extent: float = 100.0
    res: int = 512
    peak_height: float = 30.0  # meters above base
    base_height: float = 2.0  # plains datum, meters
    mountain_radius: float = 38.0  # mask radius in meters (falloff -> 0)
    peak_sharpness: float = 1.45  # >1 sharper/narrower cone
    peak_offset_x: float = 4.0  # meters, keeps the peak off-center & natural
    peak_offset_z: float = -3.0
    octaves: int = 8  # requested ridged octaves (auto-clamped to Nyquist)
    lacunarity: float = 2.15
    gain: float = 0.55  # ridge persistence between octaves
    ridge_offset: float = 0.92  # ridged offset (higher = sharper crests)
    base_freq: float = 3.0  # coarse features across the tile
    warp_strength: float = 0.55  # 0..1 domain warp of the ridged field
    warp_octaves: int = 3
    ridge_weight: float = 0.72  # how much the cone is modulated by ridges
    crevice: float = 0.30  # 0..1 extra deepening of concave creases
    hills_amp: float = 0.85  # rolling-hill amplitude in the plains (m)
    valley_carve: float = 0.18  # 0..1 flank-valley carving strength
    notes: str = field(default="", repr=False)


@dataclass
class MountainResult:
    height: np.ndarray  # (res, res) float32 meters
    mask: np.ndarray  # mountain gradient mask 0..1
    ridged: np.ndarray  # ridged multifractal 0..1 (pre-mask)
    hills: np.ndarray  # plains hills in meters
    effective_octaves: int
    finest_wavelength_m: float
    peak_ij: tuple[int, int]
    peak_height_m: float
    min_height_m: float
    stats: dict


def generate_mountain(params: MountainParams) -> MountainResult:
    cfg = SDFConfig(extent=params.extent, res=params.res)
    X, Z, _, _ = make_grid(cfg)
    # Normalized tile coords in [-0.5, 0.5].
    nx = X / params.extent
    nz = Z / params.extent

    perm = make_permutation(params.seed)
    perm_w = make_permutation(params.seed * 31 + 7)
    perm_h = make_permutation(params.seed * 131 + 17)

    # ---- 1. radial gradient mask (the "mountain cone") --------------------
    dx = X - params.peak_offset_x
    dz = Z - params.peak_offset_z
    r = np.sqrt(dx * dx + dz * dz) / max(params.mountain_radius, 1e-6)
    # Irregular massif footprint: warp the radius with low-freq noise so the
    # mountain isn't a perfect cone — spurs and embayments emerge.
    edge_n = (
        fbm(nx * 2.5 + 3.1, nz * 2.5 + 7.7, perm_h, octaves=3, gain=0.5) * 0.5 + 0.5
    )
    r = r * (0.74 + 0.52 * edge_n)
    t = np.clip(1.0 - r, 0.0, 1.0)
    # Power-shaped cone...
    mask = np.power(t, params.peak_sharpness)
    # ...with a smooth landing so the foothill ring has zero slope at r = 1.
    landing = smoothstep(0.0, 0.12, t)
    mask = mask * landing
    # Slightly asymmetric massif: second lobe for a natural ridgeline.
    rng = np.random.default_rng(params.seed)
    lobe_ang = rng.uniform(0, 2 * np.pi)
    lobe_dist = params.mountain_radius * 0.42
    lx = params.peak_offset_x + np.cos(lobe_ang) * lobe_dist
    lz = params.peak_offset_z + np.sin(lobe_ang) * lobe_dist
    rl = np.sqrt((X - lx) ** 2 + (Z - lz) ** 2) / (params.mountain_radius * 0.62)
    tl = np.clip(1.0 - rl, 0.0, 1.0)
    lobe = np.power(tl, params.peak_sharpness * 1.2) * smoothstep(0.0, 0.15, tl)
    mask = np.clip(mask + 0.45 * lobe, 0.0, 1.0)

    # ---- 2. domain-warped ridged multifractal ------------------------------
    base_wavelength = params.extent / max(params.base_freq, 0.5)
    eff_oct, finest = max_effective_octaves(
        base_wavelength, cfg.cell, params.lacunarity, params.octaves
    )
    wx, wz = domain_warp(
        nx,
        nz,
        perm_w,
        strength=params.warp_strength,
        octaves=params.warp_octaves,
        scale=2.0,
        seed_offset=(params.seed % 100) * 0.13,
    )
    sx = (wx + 3.7) * params.base_freq
    sy = (wz + 9.2) * params.base_freq
    ridged = ridged_multifractal(
        sx,
        sy,
        perm,
        octaves=eff_oct,
        lacunarity=params.lacunarity,
        gain=params.gain,
        offset=params.ridge_offset,
    )
    # Extra warp-magnitude detail term for glacial roughness near the peak.
    warp_detail = billow(
        sx * 1.7 + 4.4, sy * 1.7 + 1.9, perm_w, octaves=3, lacunarity=2.1
    )

    # ---- 3. assemble ---------------------------------------------------------
    cone = params.peak_height * mask
    detail = (1.0 - params.ridge_weight) + params.ridge_weight * ridged
    h_mtn = cone * detail
    # Crevice deepening: concave parts of the ridged field get carved.
    h_mtn -= params.crevice * params.peak_height * mask * (1.0 - ridged) * 0.35
    # High-frequency glacial roughness, strongest near the summit.
    h_mtn += (warp_detail - 0.5) * 2.0 * params.peak_height * 0.035 * mask
    # Flank valleys: radial drainage carved into the mid slopes.
    flank = mask * (1.0 - mask) * 4.0  # peaks at mask == 0.5
    valleys = billow(
        nx * 7.0 + 11.0, nz * 7.0 + 6.0, perm_h, octaves=4, lacunarity=2.2
    )
    h_mtn -= params.valley_carve * params.peak_height * flank * valleys * 0.35

    # Rolling plains that fade out under the mountain.
    hills = params.hills_amp * fbm(
        nx * 4.5 + 21.0, nz * 4.5 + 13.0, perm_h, octaves=3, gain=0.45
    )
    h = params.base_height + h_mtn + hills * (0.25 + 0.75 * (1.0 - mask))
    h = np.maximum(h, 0.0)

    h32 = h.astype(np.float32)
    peak_idx = int(np.argmax(h32))
    peak_ij = (peak_idx // params.res, peak_idx % params.res)

    stats = {
        "extent_m": params.extent,
        "res": params.res,
        "voxel_m": cfg.cell,
        "requested_octaves": params.octaves,
        "effective_octaves": eff_oct,
        "finest_wavelength_m": float(finest),
        "octaves_clamped": eff_oct != params.octaves,
        "peak_height_m": float(h32.max()),
        "min_height_m": float(h32.min()),
        "mean_height_m": float(h32.mean()),
    }
    return MountainResult(
        height=h32,
        mask=mask.astype(np.float32),
        ridged=ridged.astype(np.float32),
        hills=(hills * (0.25 + 0.75 * (1.0 - mask))).astype(np.float32),
        effective_octaves=eff_oct,
        finest_wavelength_m=float(finest),
        peak_ij=peak_ij,
        peak_height_m=float(h32.max()),
        min_height_m=float(h32.min()),
        stats=stats,
    )
