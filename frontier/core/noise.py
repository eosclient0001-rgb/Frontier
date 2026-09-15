"""Procedural noise used for the *initial* surface and for texture detail.

Implemented from the primary literature rather than from GPU tutorials:

* Perlin gradient noise, improved (Ken Perlin, SIGGRAPH 2002 course notes).
* Fractional Brownian motion / ridged multifractal (Musgrave, Kolb & Mace 1989,
  "The synthesis and rendering of eroded fractal terrains", SIGGRAPH'89; and
  Ebert et al. 2003, *Texturing & Modeling: A Procedural Approach*, ch. 16).
* Domain warping (Perlin & Hoffert 1989, "Hypertexture", SIGGRAPH'89).
* Erosion-filtered initial surfaces are *not* faked here: we let the actual
  geomorphic solvers (frontier.erosion.*) do the shaping.  Noise only supplies
  the tectonic/structural template, exactly as in Braun & Willett (2013) style
  landscape-evolution initial conditions.
"""
from __future__ import annotations

import numpy as np
from numba import njit

_P = np.array([
    151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69,
    142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219,
    203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
    74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230,
    220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76,
    132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186,
    3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59,
    227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70,
    221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178,
    185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81,
    51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115,
    121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195,
    78, 66, 215, 61, 156, 180], dtype=np.int64)


def _perm_table(seed: int) -> np.ndarray:
    """Seeded permutation table (Fisher-Yates), doubled to 512 entries."""
    rng = np.random.default_rng(int(seed) & 0x7FFFFFFF)
    p = np.arange(256, dtype=np.int64)
    rng.shuffle(p)
    return np.concatenate([p, p])


@njit(cache=True, fastmath=True)
def _fade(t):
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


@njit(cache=True, fastmath=True)
def _grad2(h, x, y):
    # 8 gradient directions, classic Perlin 2D
    h = h & 7
    if h == 0:
        u, v = x, y
    elif h == 1:
        u, v = -x, y
    elif h == 2:
        u, v = x, -y
    elif h == 3:
        u, v = -x, -y
    elif h == 4:
        u, v = y, x
    elif h == 5:
        u, v = -y, x
    elif h == 6:
        u, v = y, -x
    else:
        u, v = -y, -x
    return u + v


@njit(cache=True, fastmath=True)
def perlin2(x, y, perm):
    """Perlin gradient noise, output ~[-1, 1]."""
    xi = np.floor(x)
    yi = np.floor(y)
    xf = x - xi
    yf = y - yi
    X = np.int64(xi) & 255
    Y = np.int64(yi) & 255
    u = _fade(xf)
    v = _fade(yf)
    aa = perm[perm[X] + Y]
    ab = perm[perm[X] + Y + 1]
    ba = perm[perm[X + 1] + Y]
    bb = perm[perm[X + 1] + Y + 1]
    x1 = _grad2(aa, xf, yf)
    x2 = _grad2(ba, xf - 1.0, yf)
    x3 = _grad2(ab, xf, yf - 1.0)
    x4 = _grad2(bb, xf - 1.0, yf - 1.0)
    a = x1 + u * (x2 - x1)
    b = x3 + u * (x4 - x3)
    return a + v * (b - a)


@njit(cache=True, fastmath=True, parallel=False)
def _fbm2d(nx, ny, cell, octaves, freq, lacunarity, gain, perm, offset=(0.0, 0.0)):
    """Fractional Brownian motion (Musgrave et al. 1989) with unit gain
    normalisation so that amplitude stays independent of `octaves`."""
    out = np.zeros((ny, nx), dtype=np.float32)
    amp = 1.0
    norm = 0.0
    f = freq / max(cell, 1e-6)          # freq is cycles per metre
    for _ in range(octaves):
        norm += amp
        amp *= gain
    amp = 1.0
    f = freq / max(cell, 1e-6)
    for o in range(octaves):
        for j in range(ny):
            y = (j * cell + offset[1]) * f
            for i in range(nx):
                x = (i * cell + offset[0]) * f
                out[j, i] += amp * perlin2(x, y, perm)
        amp *= gain
        f *= lacunarity
    return out / max(norm, 1e-9)


@njit(cache=True, fastmath=True)
def _ridged_fbm2d(nx, ny, cell, octaves, freq, lacunarity, gain, perm,
                  offset=(0.0, 0.0), sharpness=1.0):
    """Ridged multifractal (Musgrave 1989/1994).

    1 - |noise| creates C1-discontinuous crest lines; the classic construction
    for mountain ridges and canyon rims.  `sharpness` raises the crest
    exponent.
    """
    out = np.zeros((ny, nx), dtype=np.float32)
    total = 0.0
    amp = 1.0
    f = freq / max(cell, 1e-6)
    weight = np.ones((ny, nx), dtype=np.float32)
    for o in range(octaves):
        amp = np.float32(gain) ** o
        sig = np.zeros((ny, nx), dtype=np.float32)
        total += amp
        for j in range(ny):
            y = (j * cell + offset[1]) * f
            for i in range(nx):
                x = (i * cell + offset[0]) * f
                sig[j, i] = 1.0 - abs(perlin2(x, y, perm))
        if sharpness != 1.0:
            for j in range(ny):
                for i in range(nx):
                    v = sig[j, i]
                    if v < 0.0:
                        v = 0.0
                    sig[j, i] = v ** sharpness
        # weighting by previous octave gives the multifractal character
        for j in range(ny):
            for i in range(nx):
                out[j, i] += amp * sig[j, i] * weight[j, i]
                weight[j, i] = min(1.0, max(0.0, sig[j, i] * 2.0))
        f *= lacunarity
    return out / max(total, 1e-9)


@njit(cache=True, fastmath=True)
def _billow_fbm2d(nx, ny, cell, octaves, freq, lacunarity, gain, perm, offset=(0.0, 0.0)):
    """Billow noise: |noise| piles - gives 'lumpy' badland/gypsum forms."""
    out = np.zeros((ny, nx), dtype=np.float32)
    total = 0.0
    f = freq / max(cell, 1e-6)
    for o in range(octaves):
        amp = np.float32(gain) ** o
        total += amp
        for j in range(ny):
            y = (j * cell + offset[1]) * f
            for i in range(nx):
                x = (i * cell + offset[0]) * f
                out[j, i] += amp * (2.0 * abs(perlin2(x, y, perm)) - 1.0)
        f *= lacunarity
    return out / max(total, 1e-9)


@njit(cache=True, fastmath=True)
def _warp_field(nx, ny, cell, octaves, freq, lacunarity, gain, perm, strength, offset=(0.0, 0.0)):
    """Domain warp displacement field (Perlin & Hoffert 1989).

    Returns (dx, dy) in world units.  Warping the *sampling coordinate* of the
    structural noise is what turns isotropic fBm into sinuous, dendritic canyon
    rims instead of radially symmetric bumps.
    """
    dx = np.zeros((ny, nx), dtype=np.float32)
    dy = np.zeros((ny, nx), dtype=np.float32)
    f = freq / max(cell, 1e-6)
    total = 0.0
    for o in range(octaves):
        amp = np.float32(gain) ** o
        total += amp
        for j in range(ny):
            y = (j * cell + offset[1]) * f
            for i in range(nx):
                x = (i * cell + offset[0]) * f
                dx[j, i] += amp * perlin2(x + 13.37, y - 4.21, perm)
                dy[j, i] += amp * perlin2(x - 7.77, y + 9.13, perm)
        f *= lacunarity
    sc = strength / max(total, 1e-9)
    for j in range(ny):
        for i in range(nx):
            dx[j, i] *= sc
            dy[j, i] *= sc
    return dx, dy


# --------------------------------------------------------------------------
# python-level wrappers (seeded tables are built outside the JIT)
# --------------------------------------------------------------------------
def fbm2d(nx, ny, cell, octaves, freq, lacunarity, gain, seed, offset=(0.0, 0.0)):
    return _fbm2d(nx, ny, cell, int(octaves), float(freq), float(lacunarity),
                  float(gain), _perm_table(seed), (float(offset[0]), float(offset[1])))


def ridged_fbm2d(nx, ny, cell, octaves, freq, lacunarity, gain, seed,
                 offset=(0.0, 0.0), sharpness=1.0):
    return _ridged_fbm2d(nx, ny, cell, int(octaves), float(freq), float(lacunarity),
                         float(gain), _perm_table(seed),
                         (float(offset[0]), float(offset[1])), float(sharpness))


def billow_fbm2d(nx, ny, cell, octaves, freq, lacunarity, gain, seed, offset=(0.0, 0.0)):
    return _billow_fbm2d(nx, ny, cell, int(octaves), float(freq), float(lacunarity),
                         float(gain), _perm_table(seed),
                         (float(offset[0]), float(offset[1])))


def warp_field(nx, ny, cell, octaves, freq, lacunarity, gain, seed, strength,
               offset=(0.0, 0.0)):
    return _warp_field(nx, ny, cell, int(octaves), float(freq), float(lacunarity),
                       float(gain), _perm_table(seed + 7717), float(strength),
                       (float(offset[0]), float(offset[1])))


# --------------------------------------------------------------------------
# fractal surface helpers used by the pipeline
# --------------------------------------------------------------------------
def max_octaves(cell: float, feature_size: float, lacunarity: float = 2.0,
                min_wavelength_cells: float = 6.0) -> int:
    """Largest octave count that stays resolvable on a grid of ``cell``.

    The finest octave must have a wavelength of at least
    ``min_wavelength_cells`` cells, otherwise the sampler aliases sub-cell
    structure into uncorrelated per-pixel hash -- which destroys the drainage
    network the erosion solvers need and shows up as fine debris in the
    hillshade.  Six cells per wavelength is the usual practical bound for
    Perlin noise generated on the sampling grid itself.
    """
    if cell <= 0 or feature_size <= 0 or lacunarity <= 1.0:
        return 1
    lam_min = min_wavelength_cells * cell
    if feature_size <= lam_min:
        return 1
    n = int(np.floor(np.log(feature_size / lam_min) / np.log(lacunarity))) + 1
    return int(max(1, n))


def fractal_surface(nx, ny, cell, kind="fbm", octaves=8, feature_size=800.0,
                    lacunarity=2.0, gain=0.5, seed=1, offset=(0.0, 0.0),
                    sharpness=1.0, bandlimit: bool = True,
                    min_wavelength_cells: float = 6.0):
    """Generate a unit-amplitude fractal template.

    `feature_size` (m) is the wavelength of the *first* octave - a physically
    meaningful control (e.g. 300 m canyon spacing) rather than "frequency 1.7".

    ``octaves`` is automatically reduced to what the grid can resolve
    (:func:`max_octaves`) unless ``bandlimit=False``.  This keeps the terrain
    resolution-independent: baking the same document at 256^2 and at 2048^2
    gives the same landforms with more (or less) fine detail, instead of
    aliased noise at the coarse end.
    """
    freq = 1.0 / max(feature_size, 1e-6)
    if bandlimit:
        octaves = min(int(octaves), max_octaves(cell, feature_size, lacunarity,
                                                min_wavelength_cells))
    if kind == "fbm":
        return fbm2d(nx, ny, cell, octaves, freq, lacunarity, gain, seed, offset)
    if kind == "ridged":
        return ridged_fbm2d(nx, ny, cell, octaves, freq, lacunarity, gain, seed,
                            offset, sharpness)
    if kind == "billow":
        return billow_fbm2d(nx, ny, cell, octaves, freq, lacunarity, gain, seed, offset)
    raise ValueError(f"unknown fractal kind {kind!r}")
