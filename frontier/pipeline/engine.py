"""The document / pipeline engine.

Deliberately **not** a node graph.  The document is a fixed, ordered pipeline of
authoring stages -- the way Gaea's "Build" tab works in practice:

    base (structure noise)  ->  sculpt (SDF stamps + brushes)  ->  paths (splines)
    ->  erosion (height-based simulation)  ->  deposition (sand)  ->  texture
    ->  satmap

Each stage has typed parameters and an enable flag, stages can be re-ordered and
disabled, and everything is reproducible from a JSON document.  The engine bakes
at any resolution from the same world-space parameters, so the UI can preview at
128^2 and bake final assets at 1024^2-4096^2.

Scaling laws: every geomorphic parameter is expressed in world units (m, m/yr,
m^2/yr) so changing the grid resolution does *not* change the morphology -- only
its detail.  That is the property that makes the preview trustworthy.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from ..core.grid import Terrain, _bilinear
from ..core.noise import fractal_surface, fbm2d, warp_field
from ..layers.lithology import Stratigraphy
from ..sdf.volume import SDFVolume, surface_nets
from ..sdf import sculpt as S
from ..spline.path import PathSpec
from ..erosion.stream_power import FluvialParams, run_fluvial
from ..erosion.hydraulic import HydraulicParams, erode_hydraulic, thermal_relax
from ..erosion.aeolian import AeolianParams, erode_aeolian
from ..texture.satmap import (Attributes, SatMapConfig, compute_attributes,
                              synthesize_satmap)
from ..texture.export import export_all


# --------------------------------------------------------------------------
@dataclass
class BaseStage:
    """Tectonic / structural template.

    The spectrum is built explicitly from three bands rather than one fBm sum,
    because real landscapes are dominated by *long* wavelengths: the hypsometry
    (how much of the area sits at each elevation) is set by the 2-10 km
    structure, while the 100 m - 1 km bands are mostly *produced* by the erosion
    solver.  Feeding a white-ish fractal into the erosion model instead gives a
    uniformly rugged surface, and -- worse -- it swamps the drainage network, so
    the channels never organise and the result reads as noise, not landscape.

    ``relief``     total structural relief (m)
    ``scale``      wavelength of the dominant (first) structural band (m)
    ``detail``     amplitude of the channel-scale "seed" roughness (0..1, as a
                   fraction of relief) -- this is what the erosion network grows
                   out of, so it must be small compared with the structure
    """

    kind: str = "plateau"          # plateau | basin | fault_block | plain
    relief: float = 520.0          # total structural relief (m)
    scale: float = 6000.0          # dominant structural wavelength (m)
    octaves: int = 4               # structural octaves (each halving the scale)
    detail: float = 0.12           # seed roughness amplitude (fraction of relief)
    detail_octaves: int = 2
    ridged_mix: float = 0.45       # ridged vs fbm character of the structure
    warp_strength: float = 240.0   # domain warp (m) -> sinuous rims
    warp_scale: float = 3200.0
    tilt: float = -140.0           # regional tilt (m across the domain)
    tilt_dir_deg: float = 95.0
    terraces: float = 0.0          # quantise to bedding steps (0 = off)
    terrace_step: float = 45.0
    seed: int = 1
    enabled: bool = True

    # legacy-friendly aliases used by the presets
    @property
    def height(self):
        return self.relief

    @property
    def feature_size(self):
        return self.scale


@dataclass
class SculptStroke:
    tool: str                      # raise|lower|smooth|flatten|terrace|talus|sand
                                   # |mesa|hoodoo|arch|alcove|slot|rocks|gully
    x: float = 0.0
    y: float = 0.0
    radius: float = 300.0
    strength: float = 0.6
    param: float = 0.0             # tool-specific (depth/height/angle...)
    mask: Optional[str] = None     # mask layer name to multiply by
    seed: int = 1
    sdf: bool = False


@dataclass
class ErosionStage:
    # --- fluvial (stream power / Davy-Lague)
    fluvial_enabled: bool = True
    years: float = 6.0e5
    dt: float = 2.0e4
    m: float = 0.5
    n: float = 1.0
    K: float = 2.0e-5
    uplift: float = 1.2e-4
    uplift_gradient: float = 0.0   # extra uplift towards the domain centre
    base_level_fall: float = 0.0   # m/yr at the boundaries
    deposition_G: float = 0.0      # Davy-Lague G
    hillslope_Kd: float = 2.0e-3
    nonlinear_hillslope: bool = True
    Sc: float = 1.0
    precip: float = 1.0
    precip_gradient: float = 0.0
    use_lithology: bool = True     # erodibility from the stratigraphic column
    hardness_exponent: float = 1.6
    reroute_every: int = 4
    route_smooth: float = 1.0
    # --- hydraulic detail pass
    hydraulic_enabled: bool = True
    hyd_iterations: int = 90
    hyd_rain: float = 1.0
    hyd_Kc: float = 1.2
    hyd_thermal: float = 0.3
    # --- aeolian (sand)
    aeolian_enabled: bool = True
    wind_speed: float = 13.0
    wind_dir_deg: float = 270.0
    aeolian_iterations: int = 40
    aeolian_years: float = 4.0e4
    sand_supply: float = 0.02      # m of loose sand supplied per aeolian step
    sand_source_mask: Optional[str] = None
    # --- talus
    thermal_enabled: bool = True
    thermal_iterations: int = 24
    repose_deg: float = 33.0


@dataclass
class TextureStage:
    sun_az_deg: float = 315.0
    sun_el_deg: float = 42.0
    haze: float = 0.16
    dust: float = 0.35
    vegetation: float = 0.0
    sand_max_slope: float = 22.0
    macro_variation: float = 0.18
    micro_variation: float = 0.10
    detail_scale: float = 40.0
    compute_horizon: bool = True
    enabled: bool = True


@dataclass
class Document:
    name: str = "untitled"
    nx: int = 512
    ny: int = 512
    world_size: float = 8192.0     # m (square)
    sdf_res: int = 128             # SDF lateral resolution
    sdf_layers: int = 96           # SDF vertical resolution
    sdf_z_min: float = -600.0
    strat: str = "colorado_plateau"
    base: BaseStage = field(default_factory=BaseStage)
    strokes: List[SculptStroke] = field(default_factory=list)
    paths: List[PathSpec] = field(default_factory=list)
    erosion: ErosionStage = field(default_factory=ErosionStage)
    texture: TextureStage = field(default_factory=TextureStage)
    masks: Dict[str, Any] = field(default_factory=dict)   # name -> painted 0..1 map
    stage_order: List[str] = field(default_factory=lambda: [
        "base", "sculpt", "paths", "fluvial", "hydraulic", "thermal", "aeolian", "texture"])
    seed: int = 1

    # -------------------------------------------------------------- helpers
    @property
    def cell(self) -> float:
        return self.world_size / self.nx

    def stratigraphy(self) -> Stratigraphy:
        if self.strat == "soft_sand":
            return Stratigraphy.soft_sand()
        return Stratigraphy.colorado_plateau()

    def to_json(self) -> str:
        d = asdict(self)
        d["paths"] = [asdict(p) for p in self.paths]
        return json.dumps(d, indent=1)

    @staticmethod
    def from_json(s: str) -> "Document":
        d = json.loads(s)
        paths = [PathSpec(**p) for p in d.pop("paths", [])]
        base = BaseStage(**d.pop("base", {}))
        erosion = ErosionStage(**d.pop("erosion", {}))
        texture = TextureStage(**d.pop("texture", {}))
        strokes = [SculptStroke(**s2) for s2 in d.pop("strokes", [])]
        doc = Document(**d)
        doc.base, doc.erosion, doc.texture, doc.strokes, doc.paths = base, erosion, texture, strokes, paths
        return doc


# --------------------------------------------------------------------------
@dataclass
class BakeResult:
    terrain: Terrain
    sdf: Optional[SDFVolume]
    attrs: Optional[Attributes]
    sat: Dict[str, np.ndarray]
    stats: Dict[str, Any]
    timings: Dict[str, float]
    doc: Optional[Document] = None


# --------------------------------------------------------------------------
def structural_bands(nx: int, ny: int, cell: float, relief: float, scale: float,
                     detail: float, ridged_mix: float, seed: int,
                     octaves: int = 4, detail_octaves: int = 2
                     ) -> tuple[np.ndarray, np.ndarray]:
    """Sum of three band-limited fractal bands with controlled amplitudes.

    Returns ``(structure, seed_roughness)``:

    * ``structure`` -- long wavelengths (``scale``, 2 octaves) that carry the
      hypsometry; amplitude ~0.55 * relief.
    * ``seed_roughness`` -- the 100 m - 1 km band (0.04 * relief by default)
      that the drainage network organises from.  It is deliberately weak: the
      erosion solver is supposed to *make* the medium-scale relief, not inherit
      it.  Too much seed roughness and the channels cannot compete with the
      pre-existing local minima.

    Every band is band-limited to the grid (see ``noise.max_octaves``), so the
    same document baked at 256^2 and 2048^2 describes the same landscape.
    """
    from ..core.noise import max_octaves
    lam_min = 6.0 * cell

    def band(fs0, octaves, seed_i):
        fs0 = max(fs0, lam_min)
        n = min(int(octaves), max_octaves(cell, fs0))
        f = fractal_surface(nx, ny, cell, "fbm", n, fs0, 2.0, 0.5, seed_i,
                            bandlimit=False)
        r = fractal_surface(nx, ny, cell, "ridged", n, fs0, 2.0, 0.5, seed_i + 31,
                            bandlimit=False)
        f = (f - f.mean()) / max(f.std(), 1e-9)
        r = (r - r.mean()) / max(r.std(), 1e-9)
        return f * (1.0 - ridged_mix) + r * ridged_mix

    structure = relief * 0.55 * band(scale, octaves, seed)
    seed_rough = relief * max(detail, 0.0) * band(max(scale / 8.0, lam_min),
                                                  detail_octaves, seed + 101)
    return structure.astype(np.float32), seed_rough.astype(np.float32)


def build_base(doc: Document) -> Terrain:
    """Structure (tectonic) base: fractal bands + warp + tilt + terraces."""
    nx, ny, cell = doc.nx, doc.ny, doc.cell
    b = doc.base
    z = np.zeros((ny, nx), dtype=np.float32)
    if b.enabled:
        structure, seed_rough = structural_bands(nx, ny, cell, b.relief, b.scale,
                                                 b.detail, b.ridged_mix, b.seed,
                                                 b.octaves, b.detail_octaves)
        z = structure + seed_rough
        # normalise the band sum so that ``relief`` means the actual relief (m)
        rng = float(z.max() - z.min())
        if rng > 1e-6:
            z = z * (b.relief / rng)
        if b.warp_strength > 0.0:
            dx, dy = warp_field(nx, ny, cell, 4, 1.0 / max(b.warp_scale, 1.0),
                                2.0, 0.5, b.seed + 5, b.warp_strength)
            xs = np.clip(np.arange(nx)[None, :] * np.ones((ny, 1), dtype=np.float64)
                         + dx / cell, 0, nx - 1).astype(np.int32)
            ys = np.clip(np.arange(ny)[:, None] * np.ones((1, nx), dtype=np.float64)
                         + dy / cell, 0, ny - 1).astype(np.int32)
            z = z[ys, xs]                       # sinuous, organic rims
        if abs(b.tilt) > 1e-9:
            a = np.radians(b.tilt_dir_deg)
            gx = (np.arange(nx)[None, :] / max(nx - 1, 1))
            gy = (np.arange(ny)[:, None] / max(ny - 1, 1))
            z = z + (gx * np.cos(a) + gy * np.sin(a)) * b.tilt
        if b.terraces > 0.0:
            step = max(b.terrace_step, 1.0)
            quant = np.round(z / step) * step
            z = z * (1.0 - b.terraces) + quant * b.terraces
        z = z - z.mean()
    t = Terrain(nx, ny, cell, z.astype(np.float32))
    t.meta["world_size"] = doc.world_size
    return t


def apply_sculpt(t: Terrain, doc: Document, only_index: Optional[int] = None):
    """Apply the *surface brush* strokes (height-based tools).

    Strokes are stored in the document and re-applied on every bake, so
    sculpting stays parameteric and reproducible.  CSG/SDF tools are handled
    separately by :func:`apply_sdf_sculpt` because they need the volume.
    """
    for k, st in enumerate(doc.strokes):
        if only_index is not None and k != only_index:
            continue
        if st.tool in ("mesa", "hoodoo", "arch", "alcove", "slot", "rocks"):
            continue
        mask = doc.masks.get(st.mask) if st.mask else None
        if mask is not None:
            mask = np.asarray(mask, dtype=np.float32)
        if st.tool == "raise":
            S.brush_raise(t, st.x, st.y, st.radius, abs(st.strength) * 100.0, 0.6, "smooth", mask, 1.0)
        elif st.tool == "lower":
            S.brush_raise(t, st.x, st.y, st.radius, abs(st.strength) * 100.0, 0.6, "smooth", mask, -1.0)
        elif st.tool == "smooth":
            S.brush_smooth(t, st.x, st.y, st.radius, min(1.0, st.strength), 0.4, mask)
        elif st.tool == "flatten":
            S.brush_flatten(t, st.x, st.y, st.radius, None, min(1.0, st.strength), 0.35, mask)
        elif st.tool == "terrace":
            step = st.param if st.param > 1.0 else 40.0
            S.brush_terrace(t, st.x, st.y, st.radius, step, min(1.0, st.strength), 0.3, mask)
        elif st.tool == "talus":
            S.brush_slope_limit(t, st.x, st.y, st.radius,
                                st.param if st.param > 1.0 else 33.0, 14, mask)
        elif st.tool == "sand":
            S.brush_sand(t, st.x, st.y, st.radius, st.strength * 12.0, 0.3, mask)
        elif st.tool == "gully":
            S.brush_gully(t, st.x, st.y, st.radius, max(2.0, st.strength * 40.0),
                          count=6, seed=st.seed, hardness=0.4)


def apply_sdf_sculpt(sdf: SDFVolume, t: Terrain, doc: Document):
    """Apply the CSG tools (mesa, hoodoo, arch, alcove, slot, rock scatter)."""
    n = 0
    for st in doc.strokes:
        if st.tool in ("mesa", "hoodoo", "arch", "alcove", "slot", "rocks"):
            _sdf_tool(sdf, t, st)
            n += 1
    return n


def _sdf_tool(sdf: SDFVolume, t: Terrain, st: SculptStroke):
    z = t.z
    j = int(np.clip(st.y / t.cell, 0, t.ny - 1))
    i = int(np.clip(st.x / t.cell, 0, t.nx - 1))
    zc = float(z[j, i])
    r = st.radius
    if st.tool == "mesa":
        h = st.param if st.param > 1.0 else 120.0
        S.stamp_alias = None
        from ..sdf.volume import stamp_box
        stamp_box(sdf.phi, sdf.origin, sdf.cell, st.x, st.y, zc + h * 0.1,
                  r, r * 0.85, h * 0.5, 0, 0.0, sdf.cell * 0.8)
    elif st.tool == "hoodoo":
        h = st.param if st.param > 1.0 else 90.0
        n = 3 + int(st.strength * 6)
        rng = np.random.default_rng(st.seed)
        from ..sdf.volume import stamp_cone
        for _ in range(n):
            ox = st.x + rng.normal(0, r * 0.5)
            oy = st.y + rng.normal(0, r * 0.5)
            jj = int(np.clip(oy / t.cell, 0, t.ny - 1))
            ii = int(np.clip(ox / t.cell, 0, t.nx - 1))
            zb = float(z[jj, ii])
            stamp_cone(sdf.phi, sdf.origin, sdf.cell, ox, oy, zb - h * 0.3,
                       ox + rng.normal(0, r * 0.1), oy + rng.normal(0, r * 0.1),
                       zb + h * rng.uniform(0.6, 1.2), r * rng.uniform(0.25, 0.5),
                       r * rng.uniform(0.08, 0.2), 0, 0.0)
    elif st.tool == "arch":
        from ..sdf.volume import stamp_sphere, stamp_capsule
        h = st.param if st.param > 1.0 else 80.0
        span = r * 1.6
        stamp_sphere(sdf.phi, sdf.origin, sdf.cell, st.x, st.y, zc + h,
                     r * 0.9, 1, 0.0, 0.0, 0.0, 0)            # punch a tunnel
        stamp_sphere(sdf.phi, sdf.origin, sdf.cell, st.x, st.y, zc + h * 1.05,
                     r * 0.6, 0, 0.0, 0.0, 0.0, 0)
        stamp_capsule(sdf.phi, sdf.origin, sdf.cell, st.x - span, st.y, zc + h,
                      st.x + span, st.y, zc + h, r * 0.55, 1, 0.0)
    elif st.tool == "alcove":
        d = st.param if st.param > 1.0 else 45.0
        from ..sdf.volume import stamp_sphere
        stamp_sphere(sdf.phi, sdf.origin, sdf.cell, st.x, st.y, zc - d * 0.2,
                     r * 0.8, 1, sdf.cell * 1.5, 0.0, 0.0, 0)
    elif st.tool == "slot":
        S.sdf_stamp_along_path(sdf, PathSpec(points=[(st.x - r, st.y), (st.x + r, st.y)],
                                             width=max(r * 0.35, sdf.cell * 2),
                                             depth=st.param if st.param > 1 else 120.0,
                                             bank_width=r * 0.3), 1.0, "subtract")
    elif st.tool == "rocks":
        S.sdf_scatter_rocks(sdf, t, count=int(8 + st.strength * 40),
                            size_range=(max(sdf.cell * 1.5, r * 0.05), r * 0.35),
                            density_mask=None, seed=st.seed, base_z=t.z)


def apply_paths(t: Terrain, doc: Document, sdf: Optional[SDFVolume] = None):
    for p in doc.paths:
        if not p.enabled:
            continue
        if p.kind in ("river", "canyon", "road"):
            S.carve_path(t, p, floor_from_dem=(p.kind == "river"))
            if sdf is not None and p.kind == "canyon":
                S.sdf_stamp_along_path(sdf, p, 1.0, "subtract")
        elif p.kind in ("ridge", "fault"):
            S.uplift_path(t, p)
        elif p.kind == "levee":
            S.deposit_levee(t, p, height=max(3.0, p.depth * 0.15))


# --------------------------------------------------------------------------
def bake(doc: Document, nx: Optional[int] = None, ny: Optional[int] = None,
         resolution_scale: float = 1.0, progress=None,
         include_sdf: Optional[bool] = None, run_erosion: Optional[bool] = None
         ) -> BakeResult:
    """Run the whole pipeline.  `nx`/`ny` override the document resolution
    (used for the interactive preview) without changing the world size."""
    t0 = time.time()
    timings: Dict[str, float] = {}
    nx = nx or doc.nx
    ny = ny or doc.ny
    work = Document.from_json(doc.to_json())
    work.nx, work.ny = nx, ny
    cell = work.cell
    erosion_stages = work.stage_order
    include_sdf = bool(include_sdf) if include_sdf is not None else (nx >= 256)
    run_erosion = True if run_erosion is None else run_erosion

    # ---- 1. structure
    t = build_base(work)
    timings["base"] = time.time() - t0

    # ---- 2. surface brushes (height-based sculpting)
    t1 = time.time()
    if "sculpt" in erosion_stages and work.strokes:
        apply_sculpt(t, work)
    # ---- 3. paths (splines) -> carve / uplift / levee
    if "paths" in erosion_stages and work.paths:
        apply_paths(t, work)
    timings["sculpt"] = time.time() - t1

    if progress:
        progress(0.10, "sculpt + paths done")

    # ---- 4. SDF volume: build from the sculpted height, apply the CSG tools,
    #         then push the structure edit back into the heightfield.
    sdf = None
    z_sdf = None
    if include_sdf:
        t1 = time.time()
        zmin0, zmax0 = float(t.z.min()), float(t.z.max())
        nxs = int(min(nx, max(32, work.sdf_res)))
        scell = work.world_size / nxs                     # cubic voxels
        z0 = float(np.floor((zmin0 - 12.0 * scell) / scell) * scell)
        nzs = int(np.clip(round((zmax0 + 12.0 * scell - z0) / scell) + 1, 16, 320))
        sdf = SDFVolume(nxs, nxs, nzs, scell, (0.0, 0.0, z0))
        z_sdf = _bilinear(t.z, nxs, nxs).astype(np.float32)
        sdf.from_heightfield(z_sdf, thickness=6.0 * scell)
        timings["sdf_build"] = time.time() - t1

        if "sculpt" in erosion_stages:
            t1 = time.time()
            n_stamps = apply_sdf_sculpt(sdf, t, work)
            if n_stamps > 0:
                sdf.reinit(iters=3)
                # baseline: the same ray-cast on the pre-stamp volume
                base = SDFVolume(nxs, nxs, nzs, scell, (0.0, 0.0, z0))
                base.from_heightfield(z_sdf, thickness=6.0 * scell)
                zh0, ok0, _ = base.to_heightfield(z0 - scell, nx, ny, cell)
                zh1, ok1, _ = sdf.to_heightfield(z0 - scell, nx, ny, cell)
                ok = ok0 & ok1 & np.isfinite(zh0) & np.isfinite(zh1)
                delta = np.zeros_like(t.z, dtype=np.float32)
                delta[ok] = (zh1 - zh0)[ok]
                t.z[...] = t.z + delta        # CSG edits enter the heightfield
                del base
            timings["sdf_sculpt"] = time.time() - t1

    if progress:
        progress(0.20, "structure done")

    z_surface_ref = t.z.copy()          # reference for the SDF advection

    # ---- 5. layer hardness (lithology) -> erodibility / diffusivity fields
    relief0 = float(t.z.max() - t.z.min())
    strat = work.stratigraphy().fit_to_elevation(float(t.z.max()), max(relief0, 1.0))
    idx, hard, frac = strat.hardness_map(t.z, nx, ny, cell)
    # Erodibility is normalised about the median rock so that the document's
    # `K` keeps its literal meaning (m^(1-2m)/yr of the reference lithology) and
    # `hardness_exponent` only controls the *contrast* between beds.
    kraw = (1.0 / np.maximum(hard, 1e-3) ** work.erosion.hardness_exponent).astype(np.float32)
    Krel = (kraw / max(float(np.median(kraw)), 1e-6)).astype(np.float32)
    if work.erosion.use_lithology:
        for nm in ("hardness", "erosion"):
            m = work.masks.get(nm)
            if m is not None:
                Krel = Krel * np.asarray(m, dtype=np.float32)

    # ---- 6. fluvial (stream power / Davy-Lague) + hillslope
    if run_erosion and "fluvial" in erosion_stages and work.erosion.fluvial_enabled:
        t1 = time.time()
        e = work.erosion
        U = np.full((ny, nx), e.uplift, dtype=np.float32)
        if e.uplift_gradient > 0.0:
            yy, xx = np.mgrid[0:ny, 0:nx]
            cx, cy = (nx - 1) * 0.5, (ny - 1) * 0.5
            rr = np.hypot(xx - cx, yy - cy) / (0.5 * max(nx, ny))
            U = (e.uplift + e.uplift_gradient * (1.0 - rr)).astype(np.float32)
        P = np.full((ny, nx), e.precip, dtype=np.float32)
        if e.precip_gradient > 0.0:
            yy, xx = np.mgrid[0:ny, 0:nx]
            P = (e.precip + e.precip_gradient * (yy / max(ny - 1, 1))).astype(np.float32)
        fp = FluvialParams(
            m=e.m, n=e.n, K=e.K, U=e.uplift, years=e.years, dt=e.dt,
            G=e.deposition_G, Kd=e.hillslope_Kd,
            nonlinear_hillslope=e.nonlinear_hillslope, Sc=e.Sc,
            precipitation=e.precip, precip_field=P,
            erodibility_field=Krel, uplift_field=U,
            boundary="fixed", reroute_every=e.reroute_every,
            base_level_fall=e.base_level_fall, route_smooth=e.route_smooth)
        znew, fdiag = run_fluvial(t.z, cell, fp,
                                  progress=(lambda s, f: progress(0.15 + 0.35 * f, f"fluvial {f:.0%}")
                                            if progress else None))
        t.set_surface(znew)
        timings["fluvial"] = time.time() - t1
    elif run_erosion:
        fdiag = None
    else:
        fdiag = None

    if progress:
        progress(0.55, "fluvial done")

    # ---- 7. hydraulic detail pass
    if run_erosion and "hydraulic" in erosion_stages and work.erosion.hydraulic_enabled:
        t1 = time.time()
        e = work.erosion
        hp = HydraulicParams(iterations=e.hyd_iterations, rain_rate=e.hyd_rain,
                             Kc=e.hyd_Kc, thermal=e.hyd_thermal,
                             material_Kc=1.0 + 0.8 * (1.0 - np.clip(hard, 0, 3) / 3.0),
                             erode_mask=(np.asarray(work.masks["erosion"], dtype=np.float32)
                                         if "erosion" in work.masks else None))
        erode_hydraulic(t.z_rock, t.z_sed, cell, hp)
        timings["hydraulic"] = time.time() - t1

    # ---- 8. thermal (talus)
    if run_erosion and "thermal" in erosion_stages and work.erosion.thermal_enabled:
        t1 = time.time()
        thermal_relax(t.z_rock, t.z_sed, cell, work.erosion.repose_deg,
                      work.erosion.thermal_iterations, 0.5)
        timings["thermal"] = time.time() - t1

    # ---- 9. aeolian sand
    if run_erosion and "aeolian" in erosion_stages and work.erosion.aeolian_enabled:
        t1 = time.time()
        e = work.erosion
        steps = max(2, int(min(e.aeolian_iterations,
                               np.ceil(e.aeolian_years / max(3600.0 * 4.0, 1.0)))))
        dt_aeo = e.aeolian_years / steps
        # ``sand_supply`` is metres of loose sand laid down per aeolian step;
        # AeolianParams.sand_source uses exactly that unit.
        rate = e.sand_supply
        src = None
        if e.sand_source_mask and e.sand_source_mask in work.masks:
            src = np.asarray(work.masks[e.sand_source_mask], dtype=np.float32) * rate
        elif e.sand_supply > 0.0:
            # sand is supplied from the low, gentle parts of the domain: these are
            # the traps and floors a real wind would scavenge first
            from ..core.grid import slope_aspect
            sl, _ = slope_aspect(t.z, cell)
            low = 1.0 - np.clip((t.z - np.percentile(t.z, 35)) / 120.0, 0.0, 1.0)
            src = (rate * low * (1.0 - np.clip(np.degrees(sl) / 25.0, 0, 1))).astype(np.float32)
        ap = AeolianParams(wind_speed=e.wind_speed, wind_dir_deg=e.wind_dir_deg,
                           iterations=steps, dt=dt_aeo, sand_source=src)
        erode_aeolian(t.z_rock, t.z_sed, cell, ap)
        timings["aeolian"] = time.time() - t1

    # ---- structure field follows the height-based simulation: exact level-set
    # advection of the SDF by the vertical erosion/deposition field, so caves,
    # arches and overhangs created by the CSG tools survive the erosion.
    if sdf is not None:
        t1 = time.time()
        dz_full = (t.z - z_surface_ref).astype(np.float32)
        dz_sdf = _bilinear(dz_full, sdf.ny, sdf.nx).astype(np.float32)
        S.advect_height_delta(sdf.phi, sdf.origin, sdf.cell, dz_sdf)
        sdf.reinit(iters=2)
        timings["sdf_sync"] = time.time() - t1

    if progress:
        progress(0.75, "erosion done")

    # ---- 10. texture + satmap
    t1 = time.time()
    attrs = None
    sat = {}
    if "texture" in erosion_stages and work.texture.enabled:
        tx = work.texture
        cfg = SatMapConfig(sun_az_deg=tx.sun_az_deg, sun_el_deg=tx.sun_el_deg,
                           haze=tx.haze, dust=tx.dust, vegetation=tx.vegetation,
                           sand_max_slope=tx.sand_max_slope,
                           macro_variation=tx.macro_variation,
                           micro_variation=tx.micro_variation,
                           detail_scale=tx.detail_scale, strat=strat)
        attrs = compute_attributes(t, sdf=sdf, sun_az_deg=tx.sun_az_deg,
                                   sun_el_deg=tx.sun_el_deg,
                                   compute_horizon=tx.compute_horizon)
        attrs.strata_index = idx
        attrs.hardness = hard
        sat = synthesize_satmap(t, attrs, cfg, sdf=sdf)
    timings["texture"] = time.time() - t1
    timings["total"] = time.time() - t0

    stats = dict(
        relief=float(t.z.max() - t.z.min()),
        z_min=float(t.z.min()), z_max=float(t.z.max()),
        cell=float(cell), nx=nx, ny=ny,
        mean_slope_deg=float(np.degrees(np.arctan(np.hypot(
            *np.gradient(t.z.astype(np.float64), cell)))).mean()) if nx > 2 else 0.0,
        sand_volume_m3=float(t.z_sed.sum()) * cell * cell,
        sand_fraction=float((t.z_sed > 0.25).mean()),
        bedrock_fraction=float((t.z_sed <= 0.25).mean()),
        sediment_max=float(t.z_sed.max()),
    )
    if fdiag is not None:
        stats["fluvial"] = dict(steps=fdiag.steps, relief_end=fdiag.relief_end,
                                mean_slope_deg=fdiag.mean_slope_deg,
                                net_volume_change_m3=fdiag.extra.get("net_volume_change_m3", 0.0))
    return BakeResult(terrain=t, sdf=sdf, attrs=attrs, sat=sat, stats=stats,
                      timings=timings, doc=work)


# --------------------------------------------------------------------------
# presets
# --------------------------------------------------------------------------
def preset_rocky_canyon() -> Document:
    """Colorado-Plateau style: layered caprock, deep fluvial incision, talus."""
    d = Document(name="Rocky Canyon", nx=512, ny=512, world_size=8192.0,
                 sdf_res=128, sdf_layers=96, sdf_z_min=-600.0, strat="colorado_plateau")
    d.base = BaseStage(kind="plateau", relief=560.0, scale=6000.0, octaves=5,
                       detail=0.10, ridged_mix=0.22, warp_strength=300.0, warp_scale=3400.0,
                       tilt=-150.0, tilt_dir_deg=95.0, terraces=0.20, terrace_step=60.0,
                       seed=42)
    d.erosion = ErosionStage(
        fluvial_enabled=True, years=2.0e6, dt=2.5e3, m=0.5, n=1.0, K=2.0e-6,
        uplift=1.0e-4, uplift_gradient=4.0e-5, base_level_fall=0.0,
        deposition_G=0.0, hillslope_Kd=8.0e-3, nonlinear_hillslope=True, Sc=1.0,
        precip=1.0, precip_gradient=0.25, use_lithology=True, hardness_exponent=1.7,
        reroute_every=2,
        hydraulic_enabled=True, hyd_iterations=300, hyd_rain=1.0, hyd_Kc=1.2, hyd_thermal=0.3,
        aeolian_enabled=True, wind_speed=11.0, wind_dir_deg=280.0,
        aeolian_iterations=24, aeolian_years=2.0e4, sand_supply=0.006,
        thermal_enabled=True, thermal_iterations=20, repose_deg=34.0)
    d.texture = TextureStage(sun_az_deg=315.0, sun_el_deg=38.0, haze=0.20, dust=0.45,
                             vegetation=0.05, sand_max_slope=20.0)
    d.paths = [PathSpec(name="main canyon", kind="river",
                        points=[(900.0, 6400.0), (2400.0, 5200.0), (3600.0, 4200.0),
                                (4300.0, 3000.0), (5600.0, 2100.0), (7200.0, 900.0)],
                        width=260.0, depth=95.0, bank_width=420.0, profile="u",
                        smooth=0.45, noise=6.0, noise_scale=220.0, seed=9)]
    return d


def preset_sandy_canyon() -> Document:
    """Arid, sand-filled canyon: soft beds, big sand supply, dunes on the floor."""
    d = Document(name="Sandy Canyon", nx=512, ny=512, world_size=8192.0,
                 sdf_res=128, sdf_layers=96, sdf_z_min=-600.0, strat="soft_sand")
    d.base = BaseStage(kind="basin", relief=430.0, scale=7000.0, octaves=5,
                       detail=0.12, ridged_mix=0.20, warp_strength=380.0, warp_scale=3800.0,
                       tilt=-90.0, tilt_dir_deg=80.0, terraces=0.15, terrace_step=45.0,
                       seed=77)
    d.erosion = ErosionStage(
        fluvial_enabled=True, years=1.5e6, dt=2.5e3, m=0.5, n=1.0, K=3.0e-6,
        uplift=8.0e-5, uplift_gradient=3.0e-5, base_level_fall=0.0,
        deposition_G=0.4, hillslope_Kd=4.0e-3, nonlinear_hillslope=True, Sc=1.0,
        precip=0.55, precip_gradient=0.15, use_lithology=True, hardness_exponent=1.5,
        reroute_every=2,
        hydraulic_enabled=True, hyd_iterations=200, hyd_rain=0.7, hyd_Kc=1.3, hyd_thermal=0.35,
        aeolian_enabled=True, wind_speed=14.0, wind_dir_deg=265.0,
        aeolian_iterations=40, aeolian_years=1.2e5, sand_supply=0.05,
        thermal_enabled=True, thermal_iterations=26, repose_deg=33.0)
    d.texture = TextureStage(sun_az_deg=300.0, sun_el_deg=44.0, haze=0.22, dust=0.55,
                             vegetation=0.0, sand_max_slope=26.0)
    d.paths = [PathSpec(name="dry wash", kind="river",
                        points=[(700.0, 7000.0), (2600.0, 5600.0), (3900.0, 4400.0),
                                (5100.0, 3200.0), (6400.0, 1900.0), (7600.0, 700.0)],
                        width=340.0, depth=70.0, bank_width=520.0, profile="parabolic",
                        smooth=0.6, noise=8.0, noise_scale=260.0, seed=13),
              PathSpec(name="ridge", kind="ridge",
                       points=[(200.0, 5600.0), (2200.0, 5000.0), (4200.0, 5400.0),
                               (6200.0, 4600.0), (7900.0, 4200.0)],
                       width=700.0, bank_width=1100.0, uplift=140.0, profile="u",
                       smooth=0.7, seed=21)]
    return d


def preset_badlands() -> Document:
    """Fine-grained, heavily rilled badlands (good 'rocky' detail reference)."""
    d = Document(name="Badlands", nx=512, ny=512, world_size=4096.0,
                 sdf_res=128, sdf_layers=96, sdf_z_min=-400.0, strat="soft_sand")
    d.base = BaseStage(relief=230.0, scale=1800.0, octaves=5, detail=0.12, ridged_mix=0.3,
                       warp_strength=140.0, warp_scale=1400.0, tilt=-60.0,
                       tilt_dir_deg=100.0, terraces=0.30, terrace_step=20.0, seed=5)
    d.erosion = ErosionStage(
        fluvial_enabled=True, years=1.0e6, dt=1.5e3, m=0.5, n=1.0, K=3.0e-6,
        uplift=1.2e-4, base_level_fall=0.0, deposition_G=0.15,
        hillslope_Kd=2.0e-3, nonlinear_hillslope=True, precip=1.2,
        use_lithology=True, hardness_exponent=2.0, reroute_every=1,
        hydraulic_enabled=True, hyd_iterations=400, hyd_rain=1.6, hyd_Kc=1.4,
        hyd_thermal=0.25,
        aeolian_enabled=False, thermal_enabled=True, thermal_iterations=18)
    d.texture = TextureStage(sun_az_deg=320.0, sun_el_deg=45.0, haze=0.12, dust=0.25)
    return d


PRESETS = {
    "rocky_canyon": preset_rocky_canyon,
    "sandy_canyon": preset_sandy_canyon,
    "badlands": preset_badlands,
}
