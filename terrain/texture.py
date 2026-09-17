"""SATMAP-driven terrain texturing (Gaea-style material stack).

Instead of hand-painting, every material layer is masked by one or more
SATMAPs — exactly like Gaea's SatMaps workflow:

* bedrock / cliff  <- slope + concavity + strata bands
* scree + talus    <- deposition + mid slope
* grass / meadow   <- low slope + low altitude + low flow
* sediment wash    <- flow + wear (channel beds)
* snow             <- altitude + flatness (+ peak bonus)
* wetness/AO       <- global multiply (darkening in gullies)

Transitions are broken up with fractal noise so layer boundaries meander
naturally instead of forming contour rings.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .noise import fbm, make_permutation


@dataclass
class TextureParams:
    seed: int = 4242
    palette: str = "alpine"  # alpine | desert | volcanic | arctic
    snowline: float = 0.62  # height01 where snow starts
    snow_slope_limit: float = 0.55  # slope01 above which snow can't stick
    grassline: float = 0.45  # height01 above which grass fades
    rock_saturation: float = 1.0
    snow_amount: float = 1.0
    wet_darkening: float = 0.45
    ao_strength: float = 0.55
    strata_strength: float = 0.35
    variation: float = 0.16  # albedo breakup noise amount


PALETTES: dict[str, dict[str, tuple[float, float, float]]] = {
    "alpine": {
        "bedrock": (0.32, 0.29, 0.27),
        "cliff": (0.45, 0.40, 0.35),
        "scree": (0.55, 0.48, 0.38),
        "grass": (0.29, 0.42, 0.20),
        "meadow": (0.42, 0.52, 0.24),
        "sediment": (0.62, 0.55, 0.42),
        "snow": (0.93, 0.94, 0.97),
    },
    "desert": {
        "bedrock": (0.45, 0.30, 0.22),
        "cliff": (0.62, 0.42, 0.28),
        "scree": (0.74, 0.58, 0.40),
        "grass": (0.45, 0.42, 0.22),
        "meadow": (0.55, 0.50, 0.28),
        "sediment": (0.80, 0.68, 0.48),
        "snow": (0.95, 0.94, 0.92),
    },
    "volcanic": {
        "bedrock": (0.16, 0.15, 0.16),
        "cliff": (0.28, 0.24, 0.22),
        "scree": (0.38, 0.30, 0.26),
        "grass": (0.20, 0.32, 0.14),
        "meadow": (0.30, 0.38, 0.16),
        "sediment": (0.42, 0.34, 0.28),
        "snow": (0.90, 0.91, 0.94),
    },
    "arctic": {
        "bedrock": (0.30, 0.32, 0.35),
        "cliff": (0.42, 0.44, 0.47),
        "scree": (0.55, 0.56, 0.57),
        "grass": (0.35, 0.40, 0.30),
        "meadow": (0.45, 0.48, 0.36),
        "sediment": (0.60, 0.59, 0.55),
        "snow": (0.96, 0.97, 1.00),
    },
}


def _smoothstep(a: float, b: float, x: np.ndarray) -> np.ndarray:
    d = b - a
    if d == 0.0:
        d = 1e-9
    t = np.clip((np.asarray(x, dtype=np.float64) - a) / d, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def render_albedo(
    height: np.ndarray,
    maps: dict[str, np.ndarray],
    params: TextureParams | None = None,
) -> np.ndarray:
    """Render an RGB albedo (uint8) from height + SATMAPs."""
    if params is None:
        params = TextureParams()
    pal = PALETTES.get(params.palette, PALETTES["alpine"])
    n = height.shape[0]
    h = np.asarray(height, dtype=np.float64)
    g = lambda k, d=0.0: (
        np.asarray(maps[k], dtype=np.float64) if k in maps else np.full((n, n), d)
    )
    height01 = g("height")
    slope01 = g("slope")
    flow = g("flow")
    wear = g("wear")
    depo = g("deposition")
    pointy = g("pointiness")
    concave = g("concavity")
    peak = g("peak")
    ao = g("ao", 1.0)
    wet = g("wetness")

    # Breakup noise (tile-space fBm, two scales).
    perm = make_permutation(params.seed)
    ax = np.linspace(0, 1, n)
    U, V = np.meshgrid(ax, ax)
    breakup = fbm(U * 5.0, V * 5.0, perm, octaves=4).astype(np.float64) * 0.5 + 0.5
    fine = fbm(U * 24.0 + 7.0, V * 24.0 + 3.0, perm, octaves=3).astype(np.float64) * 0.5 + 0.5

    c = {k: np.asarray(v, dtype=np.float64).reshape(1, 1, 3) for k, v in pal.items()}

    # -- base: bedrock with strata banding ----------------------------------
    strata = 0.5 + 0.5 * np.sin(
        h * 1.9 + breakup * 4.0 + concave * 2.0
    )
    strata = strata[..., None]
    base = c["bedrock"] * (1.0 + params.strata_strength * (strata - 0.5))
    # Large-scale tonal patches.
    base *= 1.0 + params.variation * (breakup - 0.5)[..., None] * 2.0
    albedo = base

    # -- cliff faces on steeps ------------------------------------------------
    cliff_m = _smoothstep(0.50, 0.68, slope01 + (breakup - 0.5) * 0.22)
    cliff_col = c["cliff"] * (1.0 + params.variation * (fine - 0.5)[..., None] * 2.5)
    albedo = albedo * (1 - cliff_m[..., None]) + cliff_col * cliff_m[..., None]

    # -- scree / talus aprons where material settled --------------------------
    scree_m = (
        _smoothstep(0.18, 0.55, depo + (breakup - 0.5) * 0.2)
        * _smoothstep(0.55, 0.30, slope01)  # not on cliffs
        * _smoothstep(0.05, 0.25, slope01 + 0.15)  # not on flats either... (soft)
    )
    scree_m = np.clip(scree_m * 1.4, 0, 1)
    scree_col = c["scree"] * (1.0 + params.variation * (fine - 0.5)[..., None] * 2.0)
    albedo = albedo * (1 - scree_m[..., None]) + scree_col * scree_m[..., None]

    # -- sediment wash in active channels --------------------------------------
    wash_m = _smoothstep(0.25, 0.7, np.maximum(flow, wear * 0.7))
    wash_m *= _smoothstep(0.75, 0.45, slope01)  # beds, not walls
    albedo = albedo * (1 - wash_m[..., None] * 0.85) + c["sediment"] * (
        wash_m[..., None] * 0.85
    )

    # -- grass / meadow on gentle low ground -----------------------------------
    grass_m = (
        _smoothstep(0.42, 0.20, slope01 + (breakup - 0.5) * 0.18)
        * _smoothstep(params.grassline + 0.12, params.grassline - 0.10, height01)
        * _smoothstep(0.60, 0.18, flow)
    )
    meadow_patch = _smoothstep(0.35, 0.65, breakup)
    grass_col = c["grass"] * (1 - meadow_patch[..., None]) + c["meadow"] * meadow_patch[
        ..., None
    ]
    grass_col *= 1.0 + params.variation * (fine - 0.5)[..., None] * 2.0
    albedo = albedo * (1 - grass_m[..., None]) + grass_col * grass_m[..., None]

    # -- snow ------------------------------------------------------------------
    snow_h = _smoothstep(
        params.snowline - 0.08, params.snowline + 0.10,
        height01 + pointy * 0.06 + peak * 0.10 + (breakup - 0.5) * 0.10,
    )
    snow_s = _smoothstep(
        params.snow_slope_limit + 0.10, params.snow_slope_limit - 0.12, slope01
    )
    snow_m = np.clip(snow_h * snow_s * params.snow_amount, 0, 1)
    snow_col = c["snow"] * (1.0 + 0.05 * (fine - 0.5)[..., None] * 2.0)
    # Wind-blown rock showing through on convex ribs.
    snow_m *= 1.0 - 0.35 * pointy * _smoothstep(0.4, 0.8, slope01)
    albedo = albedo * (1 - snow_m[..., None]) + snow_col * snow_m[..., None]

    # -- ridge highlight + cavity grime ----------------------------------------
    albedo *= 1.0 + 0.06 * pointy[..., None]
    albedo *= 1.0 - params.ao_strength * 0.55 * (1.0 - ao[..., None])

    # -- wet darkening -----------------------------------------------------------
    albedo *= 1.0 - params.wet_darkening * wet[..., None]
    # Slight saturation lift in the wet for a damp look.
    lum = albedo.mean(axis=-1, keepdims=True)
    albedo = albedo + (albedo - lum) * (0.25 * wet[..., None])

    albedo = np.clip(albedo, 0.0, 1.0)
    return (albedo * 255.0 + 0.5).astype(np.uint8)


def hillshade(height: np.ndarray, cell: float, az_deg: float = 315.0,
              alt_deg: float = 45.0) -> np.ndarray:
    """Classic hillshade 0..1 for 2D previews."""
    gz, gx = np.gradient(np.asarray(height, dtype=np.float64), cell)
    az = np.deg2rad(az_deg)
    alt = np.deg2rad(alt_deg)
    slope = np.arctan(np.sqrt(gx * gx + gz * gz))
    aspect = np.arctan2(gx, -gz)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(
        az - aspect
    )
    shade = np.clip(shade, 0.0, 1.0)
    return ((shade - shade.min()) / max(float(np.ptp(shade)), 1e-9)).astype(np.float32)
