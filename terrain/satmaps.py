"""SATMAPs — Gaea-style data maps derived from the SDF + erosion state.

Each map isolates one physical/artistic property so the texturer (and the
artist) can mask material layers precisely:

* ``height`` / ``slope`` / ``aspect`` — first-order surface properties
* ``flow`` — droplet discharge (where water travelled)
* ``sediment`` — suspended-sediment flux (transport corridors)
* ``wear`` — total incised depth (erosion intensity)
* ``deposition`` — total settled depth (fans, deltas, valley fill)
* ``pointiness`` — convexity (ridge crests, peaks)
* ``concavity`` — concave channels and gullies
* ``peak`` — summit mask (local maxima weighted by altitude)
* ``cavity`` / ``ao`` — horizon-based occlusion for crevices
* ``wetness`` — water affinity: flow + flatness + depression pooling
* ``curvature`` — signed mean curvature

All maps are float32 in 0..1 unless noted (``slope_deg``, ``curvature``,
``aspect`` keep physical units in ``meta``-documented ranges).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .erosion import HAS_NUMBA, njit
from .sdf import SDFConfig


@dataclass
class SatmapParams:
    ao_distance_m: float = 7.0
    ao_directions: int = 8
    peak_window_m: float = 3.0
    peak_blur_m: float = 1.2
    flow_gamma: float = 0.55
    wetness_flat_boost: float = 1.6


def _robust_norm(a: np.ndarray, lo: float = 1.0, hi: float = 99.0) -> np.ndarray:
    a = np.asarray(a, dtype=np.float64)
    v0, v1 = np.percentile(a, [lo, hi])
    if not np.isfinite(v0) or not np.isfinite(v1) or v1 <= v0:
        return np.zeros_like(a, dtype=np.float32)
    return np.clip((a - v0) / (v1 - v0), 0.0, 1.0).astype(np.float32)


def _log_norm(a: np.ndarray, p: float = 99.7, bg_subtract: bool = True) -> np.ndarray:
    """Log-compress an accumulator map and normalize to 0..1.

    With ``bg_subtract``, the distribution median (the uniform droplet
    background every cell receives) is subtracted first, so only genuine
    channels / scars / fans read as signal. Without this, plains show a
    high phantom "flow" that kills grass and smears sediment wash.
    """
    a = np.asarray(a, dtype=np.float64)
    la = np.log1p(np.maximum(a, 0.0))
    vmax = np.percentile(la, p)
    if vmax <= 0 or not np.isfinite(vmax):
        return np.zeros_like(a, dtype=np.float32)
    if bg_subtract:
        bg = float(np.median(la))
        # Only subtract when a real background exists (median well above 0
        # and well below the peak); sparse maps are left untouched.
        if bg > 0.05 * vmax and bg < 0.85 * vmax:
            la = np.maximum(la - bg, 0.0)
            vmax = vmax - bg
    return np.clip(la / max(vmax, 1e-12), 0.0, 1.0).astype(np.float32)


def _box_blur(a: np.ndarray, radius: int) -> np.ndarray:
    """Separable box blur with edge clamping (summed-area-table, O(1)/px)."""
    if radius < 1:
        return np.asarray(a, dtype=np.float32)
    r = int(radius)
    k = 2 * r + 1
    img = np.asarray(a, dtype=np.float64)
    padded = np.pad(img, r + 1, mode="edge")
    cc = np.cumsum(padded, axis=0)
    vert = (cc[k + 1 :, :] - cc[: -(k + 1), :]) / k
    cc2 = np.cumsum(vert, axis=1)
    horiz = (cc2[:, k + 1 :] - cc2[:, : -(k + 1)]) / k
    return horiz.astype(np.float32)


@njit(cache=True)
def _max_filter(h, out, r):
    n = h.shape[0]
    for i in range(n):
        i0 = i - r
        if i0 < 0:
            i0 = 0
        i1 = i + r + 1
        if i1 > n:
            i1 = n
        for j in range(n):
            j0 = j - r
            if j0 < 0:
                j0 = 0
            j1 = j + r + 1
            if j1 > n:
                j1 = n
            m = h[i, j]
            for ii in range(i0, i1):
                for jj in range(j0, j1):
                    v = h[ii, jj]
                    if v > m:
                        m = v
            out[i, j] = m


@njit(cache=True)
def _horizon_ao(h, ao, n, cell, max_steps, n_dirs):
    for i in range(n):
        for j in range(n):
            hc = h[i, j]
            occ = 0.0
            for d in range(n_dirs):
                ang = 2.0 * math.pi * d / n_dirs
                dx = math.cos(ang)
                dz = math.sin(ang)
                max_slope = 0.0
                for s in range(1, max_steps + 1):
                    x = j + dx * s
                    z = i + dz * s
                    xi = int(x + 0.5)
                    zi = int(z + 0.5)
                    if xi < 0 or xi >= n or zi < 0 or zi >= n:
                        break
                    dist = s * cell
                    slope = (h[zi, xi] - hc) / (dist + 1e-6)
                    if slope > max_slope:
                        max_slope = slope
                # Convert horizon slope to occlusion contribution.
                occ += max_slope / (1.0 + max_slope) if max_slope > 0.0 else 0.0
            occ /= n_dirs
            ao[i, j] = 1.0 - min(max(occ, 0.0), 1.0)


def compute_satmaps(
    height: np.ndarray,
    cfg: SDFConfig,
    flow: np.ndarray | None = None,
    sediment: np.ndarray | None = None,
    wear: np.ndarray | None = None,
    deposition: np.ndarray | None = None,
    params: SatmapParams | None = None,
    progress_cb=None,
) -> tuple[dict[str, np.ndarray], dict]:
    """Compute the full SATMAP stack. Returns (maps, meta)."""
    if params is None:
        params = SatmapParams()
    h = np.asarray(height, dtype=np.float64)
    n = h.shape[0]
    cell = cfg.cell
    maps: dict[str, np.ndarray] = {}

    def tick(frac, msg):
        if progress_cb is not None:
            progress_cb(frac, msg)

    tick(0.05, "gradients")
    gz, gx = np.gradient(h, cell)
    grad_mag = np.sqrt(gx * gx + gz * gz)
    slope_deg = np.rad2deg(np.arctan(grad_mag)).astype(np.float32)
    maps["slope"] = np.clip(slope_deg / 60.0, 0.0, 1.0).astype(np.float32)
    maps["slope_deg"] = slope_deg
    maps["aspect"] = (np.arctan2(gx, -gz)).astype(np.float32)  # -pi..pi
    hmin, hmax = float(h.min()), float(h.max())
    maps["height"] = (
        np.clip((h - hmin) / max(hmax - hmin, 1e-9), 0.0, 1.0).astype(np.float32)
    )

    tick(0.15, "curvature")
    lap = (
        np.roll(h, 1, 0) + np.roll(h, -1, 0) + np.roll(h, 1, 1) + np.roll(h, -1, 1)
        - 4.0 * h
    ) / (cell * cell)
    # Peak/ridge (convex): lap < 0. Channel (concave): lap > 0.
    convex = np.maximum(-lap, 0.0)
    concave = np.maximum(lap, 0.0)
    maps["pointiness"] = _robust_norm(convex, 2, 99.2)
    maps["concavity"] = _robust_norm(concave, 2, 99.2)
    maps["curvature"] = (-lap).astype(np.float32)  # +ve = convex, 1/m

    tick(0.30, "erosion maps")

    def _pedestal(a: np.ndarray, lo: float = 0.16, hi: float = 0.9) -> np.ndarray:
        """Suppress the uniform droplet background so only real channels,
        fans and scars read as signal (keeps grass alive on the plains)."""
        t = np.clip((a - lo) / max(hi - lo, 1e-9), 0.0, 1.0)
        return (t * t * (3.0 - 2.0 * t)).astype(np.float32)

    if flow is not None:
        f = _pedestal(_log_norm(flow))
        maps["flow"] = np.power(f, params.flow_gamma).astype(np.float32)
    else:
        maps["flow"] = np.zeros((n, n), dtype=np.float32)
    maps["sediment"] = (
        _pedestal(_log_norm(sediment), 0.18, 0.9)
        if sediment is not None
        else np.zeros((n, n), dtype=np.float32)
    )
    maps["wear"] = (
        _pedestal(_log_norm(wear), 0.14, 0.9)
        if wear is not None
        else np.zeros((n, n), dtype=np.float32)
    )
    maps["deposition"] = (
        _pedestal(_log_norm(deposition), 0.18, 0.92)
        if deposition is not None
        else np.zeros((n, n), dtype=np.float32)
    )

    tick(0.45, "peak mask")
    wr = max(int(round(params.peak_window_m / cell)), 1)
    local_max = np.empty_like(h, dtype=np.float64)
    _max_filter(h.astype(np.float64), local_max, wr)
    is_peak = (h >= local_max - 1e-6).astype(np.float64)
    br = max(int(round(params.peak_blur_m / cell)), 0)
    peak_soft = _box_blur(is_peak, br)
    # Weight by altitude so foothill bumps don't count as summits.
    peak = peak_soft * np.power(maps["height"].astype(np.float64), 1.5)
    maps["peak"] = _robust_norm(peak, 0.5, 99.8)

    tick(0.60, "ambient occlusion")
    max_steps = max(int(round(params.ao_distance_m / cell)), 4)
    max_steps = min(max_steps, n // 2)
    ao = np.empty_like(h, dtype=np.float64)
    _horizon_ao(
        h.astype(np.float64), ao, n, cell, max_steps, int(params.ao_directions)
    )
    maps["ao"] = np.clip(ao, 0.0, 1.0).astype(np.float32)
    maps["cavity"] = (1.0 - maps["ao"]).astype(np.float32)

    tick(0.85, "wetness")
    flat = np.power(1.0 - maps["slope"], params.wetness_flat_boost)
    dep_blur = _box_blur(h, max(int(round(2.0 / cell)), 1)).astype(np.float64)
    depression = np.clip((dep_blur - h) / max(cell, 1e-9), 0.0, 1.0)
    wet = (
        0.55 * maps["flow"].astype(np.float64) * (0.35 + 0.65 * flat.astype(np.float64))
        + 0.30 * maps["concavity"].astype(np.float64) * flat.astype(np.float64)
        + 0.35 * depression * flat.astype(np.float64)
        + 0.25 * maps["deposition"].astype(np.float64) * flat.astype(np.float64)
    )
    maps["wetness"] = _robust_norm(wet, 1, 99.5)

    tick(1.0, "done")
    meta = {
        "min_height_m": hmin,
        "max_height_m": hmax,
        "mean_slope_deg": float(slope_deg.mean()),
        "maps": sorted(maps.keys()),
        "numba": bool(HAS_NUMBA),
    }
    return maps, meta
