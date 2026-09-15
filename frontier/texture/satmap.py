"""Terrain attributes, material splatting and satellite-map (albedo) synthesis.

Attributes (all standard terrain-analysis products):
* slope / aspect / profile & plan curvature / mean curvature (Laplacian)
* topographic position index, multi-scale (Weiss 2001, ESRI-style TPI)
* roughness = local std-dev of elevation (Dartnell 2000 style)
* sky-view / openness from horizon ray-marching (Yokoyama et al. 2002,
  "Visualizing topography by openness"; applied here as a texture attribute)
* cavity from the SDF ambient occlusion when a structure field exists
* flow accumulation, wetness TWI = ln(a/tan b) (Beven & Kirkby 1979),
  height above nearest drainage (Nobre et al. 2011)
* sun exposure: aspect/slope against the sun vector, plus cast shadows

Materials are combined with fuzzy membership products (a standard technique in
geomorphological mapping; e.g. Burrough & McDonnell 1998, *Principles of
Geographical Information Systems*) instead of hard thresholds, which is what
avoids the "cut-out sticker" look of thresholded masks.  Bedrock colours are
taken from the stratigraphic column so cliffs band correctly.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from ..core.grid import gradient, slope_aspect, laplacian, gaussian_blur


# --------------------------------------------------------------------------
def ramp(x: np.ndarray, lo: float, hi: float, soft: bool = True) -> np.ndarray:
    """Fuzzy membership: 0 below lo, 1 above hi (soft = smoothstep)."""
    if hi == lo:
        return (x >= hi).astype(np.float32)
    t = np.clip((x - lo) / (hi - lo), 0.0, 1.0)
    if soft:
        t = t * t * (3.0 - 2.0 * t)
    return t.astype(np.float32)


def band(x: np.ndarray, lo: float, hi: float, softness: float = 0.25) -> np.ndarray:
    """Membership of a range with soft edges."""
    w = max((hi - lo) * softness, 1e-6)
    return (ramp(x, lo - w, lo + w) * (1.0 - ramp(x, hi - w, hi + w))).astype(np.float32)


# --------------------------------------------------------------------------
@dataclass
class Attributes:
    slope_deg: np.ndarray
    aspect_deg: np.ndarray
    curvature: np.ndarray        # mean curvature (Laplacian, 1/m)
    profile_curv: np.ndarray
    plan_curv: np.ndarray
    tpi: np.ndarray              # topographic position index (m)
    roughness: np.ndarray
    openness: np.ndarray         # sky-view fraction 0..1
    sun: np.ndarray              # direct sun factor 0..1
    shadow: np.ndarray           # cast shadow 0..1 (1 = lit)
    flow: np.ndarray             # specific catchment area (m)
    wetness: np.ndarray
    hand: np.ndarray
    cavity: np.ndarray           # 0..1 (1 = deep in a concavity/alcove)
    strata_index: np.ndarray
    hardness: np.ndarray
    sediment: np.ndarray
    elevation: np.ndarray


def compute_attributes(t, sdf=None, sun_az_deg: float = 315.0,
                       sun_el_deg: float = 40.0, horizon_dirs: int = 8,
                       compute_horizon: bool = True) -> Attributes:
    z = t.z.astype(np.float32)
    cell = t.cell
    slope, aspect = slope_aspect(z, cell)
    lap = laplacian(z, cell)
    gx, gy = gradient(z, cell)
    # profile (downslope) and plan (contour) curvature, after Zevenbergen &
    # Thorne (1987) / ArcGIS conventions, in 1/m
    gnorm = np.maximum(np.hypot(gx, gy), 1e-6)
    # second derivatives
    zxx = np.zeros_like(z)
    zyy = np.zeros_like(z)
    zxy = np.zeros_like(z)
    zxx[:, 1:-1] = (z[:, 2:] - 2 * z[:, 1:-1] + z[:, :-2]) / (cell * cell)
    zyy[1:-1, :] = (z[2:, :] - 2 * z[1:-1, :] + z[:-2, :]) / (cell * cell)
    zxy[1:-1, 1:-1] = (z[2:, 2:] - z[2:, :-2] - z[:-2, 2:] + z[:-2, :-2]) / (4 * cell * cell)
    profile = -(zxx * gx * gx + 2 * zxy * gx * gy + zyy * gy * gy) / (gnorm ** 3)
    plan = (zxx * gy * gy - 2 * zxy * gx * gy + zyy * gx * gx) / (gnorm ** 2)

    # multi-scale TPI: elevation minus the mean of an annulus
    tpi = np.zeros_like(z)
    for r in (2, 6, 14):
        smooth = gaussian_blur(z, float(r))
        tpi += (z - smooth) / 3.0
    rough = _roughness(z, max(1, int(3 / 1)))

    openness = np.ones_like(z)
    shadow = np.ones_like(z)
    if compute_horizon:
        openness = sky_view(z, cell, horizon_dirs)
        shadow = cast_shadow(z, cell, sun_az_deg, sun_el_deg)

    saz = np.radians(sun_az_deg)
    sel = np.radians(sun_el_deg)
    sun = np.clip(np.sin(sel) * np.cos(slope) + np.cos(sel) * np.sin(slope)
                  * np.cos(saz - aspect), 0.0, 1.0).astype(np.float32)
    sun = sun * shadow

    from ..erosion.flow import flow_accumulation_mfd, wetness_index, height_above_nearest_drainage
    flow = flow_accumulation_mfd(z, cell).astype(np.float32)
    wet = wetness_index(z, cell).astype(np.float32)
    hand = height_above_nearest_drainage(z, cell)

    cavity = np.zeros_like(z)
    if sdf is not None:
        cav = sdf_face_ao(sdf, t)
        cavity = cav
    else:
        # curvature-based cavity: concavities are negative Laplacian, normalised
        cavity = np.clip(-lap / (np.percentile(np.abs(lap), 95) + 1e-9), 0.0, 1.0).astype(np.float32)

    return Attributes(
        slope_deg=np.degrees(slope).astype(np.float32),
        aspect_deg=np.degrees(aspect).astype(np.float32),
        curvature=lap.astype(np.float32),
        profile_curv=profile.astype(np.float32),
        plan_curv=plan.astype(np.float32),
        tpi=tpi.astype(np.float32),
        roughness=rough.astype(np.float32),
        openness=openness.astype(np.float32),
        sun=sun.astype(np.float32),
        shadow=shadow.astype(np.float32),
        flow=flow,
        wetness=wet,
        hand=hand,
        cavity=cavity,
        strata_index=np.zeros_like(z, dtype=np.int32),
        hardness=np.ones_like(z, dtype=np.float32),
        sediment=t.z_sed.copy(),
        elevation=z,
    )


def _roughness(z: np.ndarray, r: int) -> np.ndarray:
    """Local standard deviation of elevation (Dartnell 2000)."""
    k = 2 * r + 1
    zf = z.astype(np.float64)
    pad = np.pad(zf, r, mode="edge")
    mean = np.zeros_like(zf)
    meansq = np.zeros_like(zf)
    for dj in range(k):
        for di in range(k):
            sub = pad[dj:dj + zf.shape[0], di:di + zf.shape[1]]
            mean += sub
            meansq += sub * sub
    mean /= (k * k)
    meansq /= (k * k)
    var = np.maximum(meansq - mean * mean, 0.0)
    return np.sqrt(var).astype(np.float32)


def sky_view(z: np.ndarray, cell: float, ndir: int = 8, radius: int = 24) -> np.ndarray:
    """Sky-view factor by multi-directional horizon search (Yokoyama et al. 2002)."""
    ny, nx = z.shape
    dem = z.astype(np.float64)
    angles = np.linspace(0.0, 2.0 * np.pi, ndir, endpoint=False)
    horizon = np.zeros((ny, nx), dtype=np.float64)
    for a in angles:
        dx = np.cos(a)
        dy = np.sin(a)
        best = np.zeros((ny, nx), dtype=np.float64)
        for r in range(1, radius + 1):
            ii = (np.arange(nx)[None, :] + dx * r).astype(np.int64)
            jj = (np.arange(ny)[:, None] + dy * r).astype(np.int64)
            valid = (ii >= 0) & (ii < nx) & (jj >= 0) & (jj < ny)
            ii = np.clip(ii, 0, nx - 1)
            jj = np.clip(jj, 0, ny - 1)
            dz = (dem[jj, ii] - dem) / (r * cell)
            dz = np.where(valid, dz, -1e9)
            best = np.maximum(best, dz)
        horizon += np.arctan(best)
    horizon /= ndir
    sv = np.clip(1.0 - horizon / (np.pi / 2.0), 0.0, 1.0)
    return sv.astype(np.float32)


def cast_shadow(z: np.ndarray, cell: float, az_deg: float, el_deg: float,
                max_dist_cells: int = 400, step: int = 1) -> np.ndarray:
    """Hard shadows by vectorised ray-marching towards the sun.

    The shadow test for a cell at distance ``r`` is
    ``z(x + r d) - z(x) > r * cell * tan(elevation)``, i.e. the terrain along
    the sun ray rises faster than the ray itself.  ``step`` must stay small:
    marching in strides of k cells makes every *k*-th cell sample the same
    neighbour, which prints a regular comb of fake shadows across the map, so
    the default stride is one cell.
    """
    ny, nx = z.shape
    dem = z.astype(np.float64)
    az = np.radians(az_deg)
    el = np.radians(el_deg)
    dx = -np.sin(az)          # direction the light travels
    dy = np.cos(az)
    tan_el = np.tan(el)
    ii0 = np.arange(nx)[None, :]
    jj0 = np.arange(ny)[:, None]
    blocked = np.zeros((ny, nx), dtype=bool)
    max_dist = int(min(max_dist_cells, 2 * max(nx, ny)))
    for r in range(1, max_dist, max(1, int(step))):
        ii = np.clip((ii0 + dx * r).astype(np.int32), 0, nx - 1)
        jj = np.clip((jj0 + dy * r).astype(np.int32), 0, ny - 1)
        blocked |= (dem[jj, ii] - dem) > (tan_el * r * cell)
    return (~blocked).astype(np.float32)


def sdf_face_ao(sdf, t) -> np.ndarray:
    """Baked ambient occlusion of the terrain surface, sampled from the SDF.

    The SDF carries geometry a heightfield cannot (alcoves, arches, overhangs,
    caves), so this is the only place that "sees" those shaded cavities.  The
    AO volume is sampled trilinearly so that the (coarser) voxel lattice does
    not show up as blocks in the satmap.

    Returns ``cavity = 1 - AO`` in [0, 1] on the terrain grid.
    """
    ao = sdf.ambient_occlusion(directions=6, max_dist_cells=20,
                               field_bias=sdf.cell * 1.5)
    nz, nyv, nxv = ao.shape
    z = t.z
    ny, nx = z.shape
    jj0, ii0 = np.mgrid[0:ny, 0:nx]
    fx = (ii0.astype(np.float32) + 0.5) * t.cell / sdf.cell - 0.5
    fy = (jj0.astype(np.float32) + 0.5) * t.cell / sdf.cell - 0.5
    fz = ((z - sdf.origin[2]) / sdf.cell).astype(np.float32)
    i0 = np.clip(np.floor(fx).astype(np.int32), 0, nxv - 2)
    j0 = np.clip(np.floor(fy).astype(np.int32), 0, nyv - 2)
    k0 = np.clip(np.floor(fz).astype(np.int32), 0, nz - 2)
    tx = np.clip(fx - i0, 0.0, 1.0)
    ty = np.clip(fy - j0, 0.0, 1.0)
    tz = np.clip(fz - k0, 0.0, 1.0)
    i1, j1, k1 = i0 + 1, j0 + 1, k0 + 1
    c00 = ao[k0, j0, i0] * (1 - tx) + ao[k0, j0, i1] * tx
    c01 = ao[k0, j1, i0] * (1 - tx) + ao[k0, j1, i1] * tx
    c10 = ao[k1, j0, i0] * (1 - tx) + ao[k1, j0, i1] * tx
    c11 = ao[k1, j1, i0] * (1 - tx) + ao[k1, j1, i1] * tx
    c0 = c00 * (1 - ty) + c01 * ty
    c1 = c10 * (1 - ty) + c11 * ty
    outv = c0 * (1 - tz) + c1 * tz
    return (1.0 - outv).astype(np.float32)      # cavity = 1 - AO


# --------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------
@dataclass
class Material:
    name: str
    color: Sequence[float]
    color2: Sequence[float] = (0.5, 0.5, 0.5)
    roughness: float = 0.8
    metallic: float = 0.0
    veg_ok: float = 0.0


@dataclass
class SatMapConfig:
    sun_az_deg: float = 315.0
    sun_el_deg: float = 42.0
    haze: float = 0.16
    haze_color: Sequence[float] = (0.72, 0.78, 0.86)
    macro_variation: float = 0.18
    micro_variation: float = 0.10
    detail_scale: float = 40.0
    dust: float = 0.35
    moisture_darken: float = 0.22
    sand_max_slope: float = 22.0
    talus_min_slope: float = 29.0
    talus_max_slope: float = 40.0
    vegetation: float = 0.0
    seed: int = 11
    strat: Optional[object] = None


def build_materials(cfg: SatMapConfig) -> Dict[str, Material]:
    return {
        "caprock": Material("caprock", (0.70, 0.56, 0.40), (0.78, 0.66, 0.50), 0.85),
        "sandstone": Material("sandstone", (0.76, 0.51, 0.31), (0.84, 0.62, 0.40), 0.8),
        "mudstone": Material("mudstone", (0.44, 0.35, 0.30), (0.50, 0.41, 0.35), 0.92),
        "limestone": Material("limestone", (0.66, 0.63, 0.56), (0.72, 0.69, 0.63), 0.7),
        "talus": Material("talus", (0.55, 0.47, 0.40), (0.62, 0.54, 0.46), 0.95),
        "sand": Material("sand", (0.85, 0.71, 0.47), (0.92, 0.80, 0.58), 0.55),
        "gravel": Material("gravel", (0.58, 0.52, 0.45), (0.66, 0.60, 0.53), 0.9),
        "wash": Material("wash", (0.72, 0.64, 0.52), (0.80, 0.72, 0.60), 0.7),
        "vegetation": Material("vegetation", (0.30, 0.34, 0.20), (0.38, 0.42, 0.24), 0.9, veg_ok=1.0),
        "bedrock": Material("bedrock", (0.34, 0.30, 0.29), (0.40, 0.36, 0.34), 0.85),
    }


def splat_materials(attrs: Attributes, cfg: SatMapConfig,
                    extra: Optional[Dict[str, np.ndarray]] = None) -> Dict[str, np.ndarray]:
    """Soft membership for every material; returns unnormalised weights."""
    a = attrs
    w: Dict[str, np.ndarray] = {}
    slope = a.slope_deg
    sed = a.sediment

    # --- rock, split by stratigraphic hardness (cliffs vs slopes)
    hard = ramp(a.hardness, 1.2, 2.4)
    soft = 1.0 - ramp(a.hardness, 0.7, 1.3)
    steep = ramp(slope, 32.0, 55.0)
    gentle = 1.0 - ramp(slope, 12.0, 26.0)
    long_slope = band(slope, 15.0, 34.0)
    w["caprock"] = np.clip(hard * steep, 0, 1) ** 0.8
    w["sandstone"] = np.clip(hard * (1.0 - steep) * (1.0 - gentle), 0, 1)
    w["mudstone"] = np.clip(soft * (1.0 - steep), 0, 1)
    w["limestone"] = np.clip(hard * gentle * 0.6, 0, 1)
    w["bedrock"] = np.clip((1.0 - hard) * steep * 0.7, 0, 1)

    # --- loose material
    sand_slope = 1.0 - ramp(slope, cfg.sand_max_slope, cfg.sand_max_slope + 12.0)
    in_valley = 1.0 - ramp(a.hand, 12.0, 60.0)
    sand_amount = ramp(sed, 0.25, 2.0)
    dry = 1.0 - ramp(a.wetness, 6.0, 9.0)
    w["sand"] = np.clip(sand_amount * sand_slope * (0.4 + 0.6 * in_valley) * (0.5 + 0.5 * dry), 0, 1)

    talus_slope = band(slope, cfg.talus_min_slope, cfg.talus_max_slope, 0.35)
    below_cliff = ramp(a.cavity, 0.25, 0.75) * 0.6 + 0.4
    w["talus"] = np.clip(talus_slope * below_cliff * (1.0 - sand_amount * 0.5), 0, 1)

    w["gravel"] = np.clip(band(slope, 8.0, 30.0, 0.5) * ramp(a.roughness, 0.4, 2.5) * 0.8, 0, 1)
    w["wash"] = np.clip(ramp(a.flow, 6.0e3, 6.0e4) * (1.0 - sand_amount * 0.7)
                        * (1.0 - ramp(slope, 25.0, 45.0)), 0, 1)
    w["vegetation"] = np.zeros_like(slope)
    if cfg.vegetation > 0.0:
        w["vegetation"] = (cfg.vegetation * (1.0 - ramp(slope, 18.0, 32.0))
                           * ramp(a.wetness, 4.0, 8.0) * 0.8).astype(np.float32)
    if extra:
        for k, v in extra.items():
            w[k] = np.clip(v, 0, 1)
    return w


def normalize_weights(w: Dict[str, np.ndarray], softness: float = 1.15):
    tot = np.zeros_like(next(iter(w.values())), dtype=np.float32)
    for v in w.values():
        tot += v ** softness
    tot = np.maximum(tot, 1e-6)
    return {k: ((v ** softness) / tot).astype(np.float32) for k, v in w.items()}, tot


def synthesize_satmap(t, attrs: Attributes, cfg: SatMapConfig,
                      sdf=None, materials: Optional[Dict[str, Material]] = None,
                      splat_override: Optional[Dict[str, np.ndarray]] = None):
    """Produce albedo, shading, normal, AO and splat maps for the terrain."""
    mats = materials or build_materials(cfg)
    weights = splat_override if splat_override is not None else splat_materials(attrs, cfg)
    weights, _ = normalize_weights(weights)

    # ---- colour: weighted material albedo, then strata banding + variation
    alb = np.zeros((t.ny, t.nx, 3), dtype=np.float32)
    for name, wgt in weights.items():
        m = mats.get(name)
        if m is None:
            continue
        base = np.asarray(m.color, dtype=np.float32)
        alt = np.asarray(m.color2, dtype=np.float32)
        alb += wgt[..., None] * base[None, None, :]
        # subtle per-material variation
        alb += wgt[..., None] * alt[None, None, :] * 0.0

    # stratigraphic banding: shift the colour of rock materials with bed index
    if cfg.strat is not None and hasattr(cfg.strat, "beds"):
        idx = attrs.strata_index
        hard = attrs.hardness
        for i, bed in enumerate(cfg.strat.beds):
            sel = (idx == i)
            if not sel.any():
                continue
            col = np.asarray(bed.color, dtype=np.float32)
            rock_w = np.zeros((t.ny, t.nx), dtype=np.float32)
            for name in ("caprock", "sandstone", "mudstone", "limestone", "bedrock"):
                if name in weights:
                    rock_w += weights[name]
            rock_w = np.clip(rock_w, 0.0, 1.0)
            m = sel.astype(np.float32) * rock_w
            alb = alb * (1.0 - m[..., None]) + col[None, None, :] * m[..., None]

    # ---- macro + micro variation (breaks up the flat colour fields)
    from ..core.noise import fbm2d
    macro = fbm2d(t.nx, t.ny, t.cell, 4, 1.0 / max(cfg.detail_scale * 25.0, 1.0),
                  2.0, 0.5, cfg.seed)
    micro = fbm2d(t.nx, t.ny, t.cell, 4, 1.0 / max(cfg.detail_scale, 1.0),
                  2.0, 0.5, cfg.seed + 3)
    var = 1.0 + cfg.macro_variation * macro + cfg.micro_variation * micro
    alb *= var[..., None]

    # dust / varnish accumulates on gentle, sheltered surfaces
    dust = (cfg.dust * (1.0 - ramp(attrs.slope_deg, 10.0, 35.0))
            * (0.5 + 0.5 * (1.0 - attrs.cavity))).astype(np.float32)
    dust_col = np.array([0.78, 0.68, 0.55], dtype=np.float32)
    alb = alb * (1.0 - dust[..., None]) + dust_col[None, None, :] * dust[..., None]

    # moisture darkens valley floors
    moist = (cfg.moisture_darken * ramp(attrs.wetness, 5.0, 9.5)).astype(np.float32)
    alb *= (1.0 - moist)[..., None]

    alb = np.clip(alb, 0.0, 1.0)

    # ---- shading: sun + ambient sky occlusion + SDF cavity
    amb = 0.30 + 0.45 * attrs.openness
    if sdf is not None:
        amb = amb * (0.35 + 0.65 * (1.0 - attrs.cavity))
    shade = np.clip(amb + 0.85 * attrs.sun, 0.0, 1.6)
    lit = np.clip(alb * shade[..., None], 0.0, 1.0)

    # ---- aerial perspective (simple distance haze; keeps the wide shots readable)
    if cfg.haze > 0:
        h = np.linspace(0.0, 1.0, t.ny)[:, None]
        fog = cfg.haze * (0.35 + 0.65 * h)
        hz = np.asarray(cfg.haze_color, dtype=np.float32)
        lit = lit * (1.0 - fog[..., None]) + hz[None, None, :] * fog[..., None]

    # ---- normal map from the heightfield (world-space scale)
    gx, gy = gradient(t.z, t.cell)
    nx_ = -gx
    ny_ = gy
    nz_ = np.ones_like(gx)
    ln = np.sqrt(nx_ * nx_ + ny_ * ny_ + nz_ * nz_)
    normal = np.stack([nx_ / ln, ny_ / ln, nz_ / ln], axis=-1)

    ao = (attrs.openness * (1.0 - 0.6 * attrs.cavity)).astype(np.float32)

    return dict(albedo=alb, image=lit, normal=normal.astype(np.float32), ao=ao,
                weights=weights, shade=shade.astype(np.float32))
