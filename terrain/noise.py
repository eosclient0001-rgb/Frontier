"""Seeded gradient (Perlin) noise, fractal stacks and domain warping.

All routines are vectorized NumPy and operate on normalized coordinates.
Heights are derived from these in :mod:`terrain.mountain`.
"""

from __future__ import annotations

import numpy as np

_GRAD2 = np.array(
    [
        [1.0, 1.0],
        [-1.0, 1.0],
        [1.0, -1.0],
        [-1.0, -1.0],
        [1.0, 0.0],
        [-1.0, 0.0],
        [0.0, 1.0],
        [0.0, -1.0],
    ],
    dtype=np.float64,
)


def make_permutation(seed: int) -> np.ndarray:
    """Deterministic shuffled permutation table (length 512)."""
    rng = np.random.default_rng(int(seed) & 0xFFFFFFFF)
    p = np.arange(256, dtype=np.int64)
    rng.shuffle(p)
    return np.concatenate([p, p])


def _fade(t: np.ndarray) -> np.ndarray:
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def perlin2(x: np.ndarray, y: np.ndarray, perm: np.ndarray) -> np.ndarray:
    """Classic improved Perlin noise in ~[-1, 1]. Broadcasts over x/y."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)

    xi = np.floor(x).astype(np.int64)
    yi = np.floor(y).astype(np.int64)
    xf = x - xi
    yf = y - yi
    xi0 = xi & 255
    yi0 = yi & 255
    xi1 = (xi0 + 1) & 255
    yi1 = (yi0 + 1) & 255

    h_aa = perm[perm[xi0] + yi0] & 7
    h_ba = perm[perm[xi1] + yi0] & 7
    h_ab = perm[perm[xi0] + yi1] & 7
    h_bb = perm[perm[xi1] + yi1] & 7

    g = _GRAD2
    x1 = xf - 1.0
    y1 = yf - 1.0
    d_aa = g[h_aa, 0] * xf + g[h_aa, 1] * yf
    d_ba = g[h_ba, 0] * x1 + g[h_ba, 1] * yf
    d_ab = g[h_ab, 0] * xf + g[h_ab, 1] * y1
    d_bb = g[h_bb, 0] * x1 + g[h_bb, 1] * y1

    u = _fade(xf)
    v = _fade(yf)
    x1i = d_aa + u * (d_ba - d_aa)
    x2i = d_ab + u * (d_bb - d_ab)
    # Perlin's gradient set peaks at ~0.707; rescale to roughly [-1, 1].
    return ((x1i + v * (x2i - x1i)) * 1.41421356).astype(np.float64)


def fbm(
    x: np.ndarray,
    y: np.ndarray,
    perm: np.ndarray,
    octaves: int = 5,
    lacunarity: float = 2.0,
    gain: float = 0.5,
) -> np.ndarray:
    """Fractional Brownian motion, roughly in [-1, 1]."""
    total = np.zeros_like(np.asarray(x, dtype=np.float64))
    amp = 1.0
    norm = 0.0
    fx = np.asarray(x, dtype=np.float64)
    fy = np.asarray(y, dtype=np.float64)
    for _ in range(max(1, int(octaves))):
        total += amp * perlin2(fx, fy, perm)
        norm += amp
        amp *= gain
        fx = fx * lacunarity + 13.7
        fy = fy * lacunarity + 7.3
    return (total / max(norm, 1e-9)).astype(np.float64)


def billow(
    x: np.ndarray,
    y: np.ndarray,
    perm: np.ndarray,
    octaves: int = 5,
    lacunarity: float = 2.0,
    gain: float = 0.5,
) -> np.ndarray:
    """Billow noise (abs of Perlin), roughly in [0, 1]."""
    total = np.zeros_like(np.asarray(x, dtype=np.float64))
    amp = 1.0
    norm = 0.0
    fx = np.asarray(x, dtype=np.float64)
    fy = np.asarray(y, dtype=np.float64)
    for _ in range(max(1, int(octaves))):
        total += amp * np.abs(perlin2(fx, fy, perm))
        norm += amp
        amp *= gain
        fx = fx * lacunarity + 11.1
        fy = fy * lacunarity + 5.7
    return (total / max(norm, 1e-9)).astype(np.float64)


def ridged_multifractal(
    x: np.ndarray,
    y: np.ndarray,
    perm: np.ndarray,
    octaves: int = 6,
    lacunarity: float = 2.15,
    gain: float = 0.55,
    offset: float = 0.9,
) -> np.ndarray:
    """Ridged multifractal (sharp crests, soft valleys), roughly in [0, 1].

    Each octave is ``(offset - |noise|)^2`` with a signal-dependent weight so
    later octaves concentrate on the ridges — the classic mountain recipe.
    """
    fx = np.asarray(x, dtype=np.float64)
    fy = np.asarray(y, dtype=np.float64)
    total = np.zeros_like(fx)
    amp = 0.5
    weight = np.ones_like(fx)
    norm = 0.0
    for _ in range(max(1, int(octaves))):
        signal = offset - np.abs(perlin2(fx, fy, perm))
        signal = signal * signal
        total += signal * amp * weight
        norm += amp
        weight = np.clip(signal * gain * 2.0, 0.0, 1.0)
        fx = fx * lacunarity + 17.3
        fy = fy * lacunarity + 9.1
        amp *= 0.5
    total = total / max(norm, 1e-9)
    # Normalize to a stable 0..1 range (theoretical max ~= offset^2 * 2).
    return np.clip(total / max(offset * offset * 1.15, 1e-9), 0.0, 1.0)


def domain_warp(
    x: np.ndarray,
    y: np.ndarray,
    perm: np.ndarray,
    strength: float,
    octaves: int = 3,
    scale: float = 2.0,
    seed_offset: float = 0.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Cheap domain warp: offset coordinates by two fBm fields."""
    if strength <= 0.0:
        return x, y
    qx = fbm(
        x * scale + 5.2 + seed_offset,
        y * scale + 1.3 + seed_offset * 0.7,
        perm,
        octaves=octaves,
    )
    qy = fbm(
        x * scale + 8.9 + seed_offset * 1.3,
        y * scale + 3.7 + seed_offset,
        perm,
        octaves=octaves,
    )
    return x + strength * 0.35 * qx, y + strength * 0.35 * qy


def smoothstep(a: float, b: float, x: np.ndarray) -> np.ndarray:
    d = b - a
    if d == 0.0:
        d = 1e-9
    t = np.clip((np.asarray(x, dtype=np.float64) - a) / d, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def max_effective_octaves(
    base_wavelength_m: float, voxel_m: float, lacunarity: float, requested: int
) -> tuple[int, float]:
    """Clamp fractal octaves so the finest wavelength stays above Nyquist.

    Returns (effective_octaves, finest_wavelength_m). Detail finer than
    ~2 voxels cannot be represented on the grid and only adds aliasing, so
    extra octaves are reported as clamped. This is one half of the
    voxel/detail matching guarantee.
    """
    lac = max(float(lacunarity), 1.01)
    eff = int(requested)
    lam = base_wavelength_m / (lac ** max(eff - 1, 0))
    nyquist = 2.0 * voxel_m
    while eff > 1 and lam < nyquist:
        eff -= 1
        lam = base_wavelength_m / (lac ** max(eff - 1, 0))
    return eff, lam
