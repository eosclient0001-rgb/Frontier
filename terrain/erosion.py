"""SDF-aware hydraulic + thermal erosion.

Classic droplet erosion (Hans Theobald Beyer / Lague) was designed for meshes /
heightfields with cell size 1 and arbitrary units. Applied raw to an SDF it
produces three characteristic failures:

1. **Sub-voxel carving** — brushes smaller than a voxel scatter energy that
   can never be sampled back. We clamp every brush to >= 1.5 voxels and use a
   normalized world-space Gaussian splat.
2. **Tearing / pitting** — a single droplet can remove far more than one
   voxel of material in one step, punching holes the field cannot represent.
   We enforce a CFL-style limit: max carve per droplet-step is a fraction of
   a voxel, and report how often the limiter engaged.
3. **Unit confusion** — capacity/gravity math assumes ``cell == 1``. Here all
   slopes are computed in true world units (dh_meters / step_meters) so the
   same parameters behave identically at any resolution; only the *detail
   limit* changes.

Outputs are the eroded heightfield plus the accumulator maps that later
become Gaea-style SATMAPs: discharge (flow), suspended sediment, wear
(eroded), deposition, and talus.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np

try:
    from numba import njit, prange  # noqa: F401

    HAS_NUMBA = True
except Exception:  # pragma: no cover
    HAS_NUMBA = False

    def njit(*a, **k):
        def wrap(f):
            return f

        if len(a) == 1 and callable(a[0]) and not k:
            return a[0]
        return wrap


from .sdf import SDFConfig, gaussian_brush


@dataclass
class ErosionParams:
    seed: int = 777
    num_particles: int = 350_000
    max_lifetime: int = 48
    inertia: float = 0.08
    gravity: float = 5.0
    evaporation: float = 0.015
    capacity_factor: float = 4.0
    min_slope: float = 0.025  # world slope (m/m) floor for capacity
    erode_speed: float = 0.30
    deposit_speed: float = 0.30
    brush_radius_world: float = 0.6  # meters; auto-clamped to >= 1.5 voxels
    cfl_voxels: float = 0.75  # max carve per droplet-step, in voxels
    initial_speed: float = 1.0
    initial_water: float = 1.0
    # Thermal (talus) erosion
    thermal_iterations: int = 14
    talus_angle_deg: float = 34.0
    talus_rate: float = 0.65
    # SDF anti-alias relaxation passes (removes sub-voxel spikes)
    sdf_relax_passes: int = 2
    sdf_relax_strength: float = 0.35
    clamp_min_height: float = 0.0


@dataclass
class ErosionResult:
    height: np.ndarray  # eroded, float32 meters
    flow: np.ndarray  # discharge accumulator, float32
    sediment: np.ndarray  # suspended-sediment accumulator, float32
    wear: np.ndarray  # total eroded depth per cell, meters float32
    deposition: np.ndarray  # total deposited depth per cell, meters float32
    talus: np.ndarray  # thermal-moved depth per cell, meters float32
    cut: np.ndarray  # initial - final (positive = incised), meters
    brush_radius_cells: float
    brush_clamped: bool
    stats: dict


# ---------------------------------------------------------------- numba cores


@njit(cache=True)
def _bilinear(h, x, z):
    n = h.shape[0]
    if x < 0.0:
        x = 0.0
    if z < 0.0:
        z = 0.0
    if x > n - 1.001:
        x = n - 1.001
    if z > n - 1.001:
        z = n - 1.001
    xi = int(x)
    zi = int(z)
    fx = x - xi
    fz = z - zi
    return (
        h[zi, xi] * (1.0 - fx) * (1.0 - fz)
        + h[zi, xi + 1] * fx * (1.0 - fz)
        + h[zi + 1, xi] * (1.0 - fx) * fz
        + h[zi + 1, xi + 1] * fx * fz
    )


@njit(cache=True)
def _droplet_chunk(
    h,
    flow,
    sed_acc,
    wear,
    depo,
    start_x,
    start_z,
    brush_off,
    brush_w,
    n,
    cell,
    max_lifetime,
    inertia,
    gravity,
    evaporation,
    capacity_factor,
    min_slope,
    erode_speed,
    deposit_speed,
    max_step_cut,
    initial_speed,
    initial_water,
    clamp_min,
    clamp_acc,  # [requested, applied] for the CFL report
):
    n_brush = brush_off.shape[0]
    for p in range(start_x.shape[0]):
        x = start_x[p]
        z = start_z[p]
        dx = 0.0
        dz = 0.0
        speed = initial_speed
        water = initial_water
        sed = 0.0
        for _step in range(max_lifetime):
            if x < 0.0 or x > n - 2.0 or z < 0.0 or z > n - 2.0:
                break
            xi = int(x)
            zi = int(z)
            fx = x - xi
            fz = z - zi
            # Bilinear height + per-cell gradient at current pos.
            h00 = h[zi, xi]
            h10 = h[zi, xi + 1]
            h01 = h[zi + 1, xi]
            h11 = h[zi + 1, xi + 1]
            old_h = (
                h00 * (1.0 - fx) * (1.0 - fz)
                + h10 * fx * (1.0 - fz)
                + h01 * (1.0 - fx) * fz
                + h11 * fx * fz
            )
            gx = (h10 - h00) * (1.0 - fz) + (h11 - h01) * fz  # per cell
            gz = (h01 - h00) * (1.0 - fx) + (h11 - h10) * fx  # per cell

            # Advect along the SDF surface gradient (world-correct dir).
            dx = dx * inertia - gx * (1.0 - inertia)
            dz = dz * inertia - gz * (1.0 - inertia)
            leng = (dx * dx + dz * dz) ** 0.5
            if leng < 1e-9:
                # No momentum and no gradient: follow steepest descent.
                gmag = (gx * gx + gz * gz) ** 0.5
                if gmag < 1e-9:
                    break
                dx = -gx / gmag
                dz = -gz / gmag
            else:
                dx /= leng
                dz /= leng

            nx = x + dx
            nz = z + dz
            if nx < 0.0 or nx > n - 2.0 or nz < 0.0 or nz > n - 2.0:
                # Droplet leaves the tile: dump sediment at the border cell.
                if sed > 0.0:
                    bx = xi
                    bz = zi
                    if 0 <= bx < n - 1 and 0 <= bz < n - 1:
                        h[bz, bx] += sed * (1.0 - fx) * (1.0 - fz)
                        depo[bz, bx] += sed * (1.0 - fx) * (1.0 - fz)
                        h[bz, bx + 1] += sed * fx * (1.0 - fz)
                        depo[bz, bx + 1] += sed * fx * (1.0 - fz)
                        h[bz + 1, bx] += sed * (1.0 - fx) * fz
                        depo[bz + 1, bx] += sed * (1.0 - fx) * fz
                        h[bz + 1, bx + 1] += sed * fx * fz
                        depo[bz + 1, bx + 1] += sed * fx * fz
                break

            new_h = _bilinear(h, nx, nz)
            dh = old_h - new_h  # meters, +ve downhill
            step_dist = cell  # unit direction => one cell of travel
            slope = dh / step_dist

            speed2 = speed * speed + dh * gravity
            speed = speed2**0.5 if speed2 > 0.0 else 0.0

            flow[zi, xi] += water
            sed_acc[zi, xi] += sed

            cap = slope
            if cap < min_slope:
                cap = min_slope
            cap = cap * speed * water * capacity_factor

            if sed > cap or (dh < 0.0 and speed < 1e-6):
                # --- deposit ------------------------------------------------
                if dh < 0.0:
                    dep_amt = sed if sed < -dh else -dh
                else:
                    dep_amt = (sed - cap) * deposit_speed
                if dep_amt > sed:
                    dep_amt = sed
                sed -= dep_amt
                h[zi, xi] += dep_amt * (1.0 - fx) * (1.0 - fz)
                depo[zi, xi] += dep_amt * (1.0 - fx) * (1.0 - fz)
                h[zi, xi + 1] += dep_amt * fx * (1.0 - fz)
                depo[zi, xi + 1] += dep_amt * fx * (1.0 - fz)
                h[zi + 1, xi] += dep_amt * (1.0 - fx) * fz
                depo[zi + 1, xi] += dep_amt * (1.0 - fx) * fz
                h[zi + 1, xi + 1] += dep_amt * fx * fz
                depo[zi + 1, xi + 1] += dep_amt * fx * fz
            else:
                # --- erode (SDF carve: CFL-limited, Gaussian splat) --------
                want = (cap - sed) * erode_speed
                if want < 0.0:
                    want = 0.0
                # Classic anti-pit rule: never remove more than the downhill
                # drop along this step, and never erode while ascending.
                if dh > 0.0:
                    if want > dh:
                        want = dh
                else:
                    want = 0.0
                # CFL limiter: the SDF must not move more than a fraction of
                # a voxel per droplet pass.
                applied = want
                if applied > max_step_cut:
                    applied = max_step_cut
                clamp_acc[0] += want
                clamp_acc[1] += applied
                if applied > 0.0:
                    for k in range(n_brush):
                        oz = brush_off[k, 0]
                        ox = brush_off[k, 1]
                        cz = zi + oz
                        cx = xi + ox
                        if 0 <= cz < n and 0 <= cx < n:
                            w = brush_w[k]
                            carve = applied * w
                            new_val = h[cz, cx] - carve
                            if new_val < clamp_min:
                                carve = h[cz, cx] - clamp_min
                                if carve < 0.0:
                                    carve = 0.0
                                new_val = clamp_min
                            h[cz, cx] = new_val
                            wear[cz, cx] += carve
                    sed += applied

            water *= 1.0 - evaporation
            if water < 0.01:
                # Droplet dries: settle remaining sediment locally.
                if sed > 0.0:
                    h[zi, xi] += sed * (1.0 - fx) * (1.0 - fz)
                    depo[zi, xi] += sed * (1.0 - fx) * (1.0 - fz)
                    h[zi, xi + 1] += sed * fx * (1.0 - fz)
                    depo[zi, xi + 1] += sed * fx * (1.0 - fz)
                    h[zi + 1, xi] += sed * (1.0 - fx) * fz
                    depo[zi + 1, xi] += sed * (1.0 - fx) * fz
                    h[zi + 1, xi + 1] += sed * fx * fz
                    depo[zi + 1, xi + 1] += sed * fx * fz
                break
            x = nx
            z = nz
        else:
            pass


@njit(cache=True)
def _thermal_pass(h, talus_map, n, talus_thresh, rate, flip):
    """One voxel-aware talus relaxation sweep (alternating direction)."""
    if flip == 0:
        i0, i1, di = 1, n - 1, 1
        j0, j1, dj = 1, n - 1, 1
    else:
        i0, i1, di = n - 2, 0, -1
        j0, j1, dj = n - 2, 0, -1
    i = i0
    while (i < i1 and di > 0) or (i > i1 and di < 0):
        j = j0
        while (j < j1 and dj > 0) or (j > j1 and dj < 0):
            hc = h[i, j]
            # 4-neighbourhood
            for nb in range(4):
                if nb == 0:
                    ni, nj = i - 1, j
                elif nb == 1:
                    ni, nj = i + 1, j
                elif nb == 2:
                    ni, nj = i, j - 1
                else:
                    ni, nj = i, j + 1
                diff = hc - h[ni, nj]
                if diff > talus_thresh:
                    move = (diff - talus_thresh) * 0.5 * rate
                    hc -= move
                    h[ni, nj] += move
                    talus_map[i, j] += move
            h[i, j] = hc
            j += dj
        i += di


@njit(cache=True)
def _relax_pass(h, tmp, n, cell, strength, max_move):
    """SDF anti-alias pass: damp sub-voxel curvature spikes only.

    Cells whose Laplacian implies detail finer than the grid can hold are
    pulled toward their neighbourhood mean, limited to ``max_move`` meters.
    Everywhere else the field is untouched, so real channels survive.
    """
    for i in range(1, n - 1):
        for j in range(1, n - 1):
            lap = h[i - 1, j] + h[i + 1, j] + h[i, j - 1] + h[i, j + 1] - 4.0 * h[i, j]
            # Curvature energy relative to one voxel of relief.
            e = abs(lap) / (cell + 1e-9)
            if e > 1.0:
                mean = (
                    h[i - 1, j] + h[i + 1, j] + h[i, j - 1] + h[i, j + 1]
                ) * 0.25
                pull = (mean - h[i, j]) * strength * min((e - 1.0) * 0.5, 1.0)
                if pull > max_move:
                    pull = max_move
                elif pull < -max_move:
                    pull = -max_move
                tmp[i, j] = h[i, j] + pull
            else:
                tmp[i, j] = h[i, j]
    for i in range(1, n - 1):
        for j in range(1, n - 1):
            h[i, j] = tmp[i, j]


def _warmup_njit() -> None:
    """Trigger Numba compilation once so timed runs are honest."""
    if not HAS_NUMBA:
        return
    n = 16
    h = np.zeros((n, n), dtype=np.float64)
    f = np.zeros_like(h)
    s = np.zeros_like(h)
    w = np.zeros_like(h)
    d = np.zeros_like(h)
    sx = np.array([4.5, 8.5], dtype=np.float64)
    sz = np.array([4.5, 8.5], dtype=np.float64)
    off = np.array([[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0]], dtype=np.int64)
    wt = np.array([0.4, 0.15, 0.15, 0.15, 0.15], dtype=np.float64)
    acc = np.zeros(2, dtype=np.float64)
    _droplet_chunk(
        h, f, s, w, d, sx, sz, off, wt, n, 0.2, 4, 0.08, 5.0, 0.015, 7.0,
        0.025, 0.55, 0.35, 0.1, 1.0, 1.0, 0.0, acc,
    )
    t = np.zeros_like(h)
    _thermal_pass(h, t, n, 0.1, 0.5, 0)
    _relax_pass(h, t, n, 0.2, 0.35, 0.05)


_WARMED = False


def _ensure_warm() -> None:
    global _WARMED
    if HAS_NUMBA and not _WARMED:
        _warmup_njit()
        _WARMED = True


def run_hydraulic_erosion(
    height: np.ndarray,
    cfg: SDFConfig,
    params: ErosionParams,
    progress_cb=None,
) -> ErosionResult:
    """Run droplet + thermal + relax erosion. Returns maps and statistics."""
    _ensure_warm()
    t_start = time.perf_counter()

    n = int(height.shape[0])
    h = np.asarray(height, dtype=np.float64).copy()
    initial = h.copy()
    flow = np.zeros_like(h)
    sed_acc = np.zeros_like(h)
    wear = np.zeros_like(h)
    depo = np.zeros_like(h)
    talus_map = np.zeros_like(h)

    brush_off, brush_w, brush_cells, brush_clamped = gaussian_brush(
        params.brush_radius_world, cfg.cell
    )
    max_step_cut = float(params.cfl_voxels) * cfg.cell

    rng = np.random.default_rng(params.seed)
    total = int(params.num_particles)
    chunks = max(1, min(20, total // 20_000))
    per_chunk = total // chunks
    clamp_acc = np.zeros(2, dtype=np.float64)

    done = 0
    for c in range(chunks):
        count = per_chunk if c < chunks - 1 else (total - done)
        sx = rng.uniform(0, n - 2.0, size=count).astype(np.float64)
        sz = rng.uniform(0, n - 2.0, size=count).astype(np.float64)
        if HAS_NUMBA:
            _droplet_chunk(
                h, flow, sed_acc, wear, depo, sx, sz,
                brush_off, brush_w, n, cfg.cell,
                int(params.max_lifetime), float(params.inertia),
                float(params.gravity), float(params.evaporation),
                float(params.capacity_factor), float(params.min_slope),
                float(params.erode_speed), float(params.deposit_speed),
                float(max_step_cut), float(params.initial_speed),
                float(params.initial_water), float(params.clamp_min_height),
                clamp_acc,
            )
        else:  # pragma: no cover - fallback path without numba
            _droplet_chunk(
                h, flow, sed_acc, wear, depo, sx, sz,
                brush_off, brush_w, n, cfg.cell,
                int(params.max_lifetime), float(params.inertia),
                float(params.gravity), float(params.evaporation),
                float(params.capacity_factor), float(params.min_slope),
                float(params.erode_speed), float(params.deposit_speed),
                float(max_step_cut), float(params.initial_speed),
                float(params.initial_water), float(params.clamp_min_height),
                clamp_acc,
            )
        done += count
        if progress_cb is not None:
            # Droplets are ~75% of the erosion stage.
            progress_cb(0.75 * done / max(total, 1), f"droplets {done:,}/{total:,}")

    # ---- thermal (talus) ----------------------------------------------------
    talus_thresh = float(np.tan(np.deg2rad(params.talus_angle_deg))) * cfg.cell
    for it in range(int(params.thermal_iterations)):
        _thermal_pass(h, talus_map, n, talus_thresh, float(params.talus_rate), it % 2)
        if progress_cb is not None:
            progress_cb(
                0.75 + 0.15 * (it + 1) / max(int(params.thermal_iterations), 1),
                f"talus {it + 1}/{params.thermal_iterations}",
            )

    # ---- SDF anti-alias relaxation ------------------------------------------
    if int(params.sdf_relax_passes) > 0:
        tmp = np.zeros_like(h)
        for it in range(int(params.sdf_relax_passes)):
            _relax_pass(
                h, tmp, n, cfg.cell,
                float(params.sdf_relax_strength), 0.25 * cfg.cell,
            )
            if progress_cb is not None:
                progress_cb(
                    0.90 + 0.10 * (it + 1) / max(int(params.sdf_relax_passes), 1),
                    f"SDF relax {it + 1}/{params.sdf_relax_passes}",
                )

    h = np.maximum(h, params.clamp_min_height)
    cut = initial - h
    cell_area = cfg.cell * cfg.cell
    eroded_vol = float(wear.sum() * cell_area)
    deposited_vol = float(depo.sum() * cell_area)
    thermal_vol = float(talus_map.sum() * cell_area)
    max_cut = float(np.maximum(cut, 0).max())
    cut_pos = cut[cut > 0]
    mean_cut = float(cut_pos.mean()) if cut_pos.size else 0.0
    subvoxel = (
        float((cut_pos < cfg.cell).sum() / max(cut_pos.size, 1) * 100.0)
        if cut_pos.size
        else 0.0
    )
    requested, applied = float(clamp_acc[0]), float(clamp_acc[1])
    clamp_rate = (1.0 - applied / requested) * 100.0 if requested > 0 else 0.0

    stats = {
        "num_particles": total,
        "brush_radius_cells": float(brush_cells),
        "brush_clamped": bool(brush_clamped),
        "eroded_volume_m3": eroded_vol,
        "deposited_volume_m3": deposited_vol,
        "thermal_volume_m3": thermal_vol,
        "net_volume_m3": deposited_vol - eroded_vol,
        "max_cut_m": max_cut,
        "max_cut_voxels": max_cut / cfg.cell,
        "mean_cut_m": mean_cut,
        "mean_cut_voxels": mean_cut / cfg.cell,
        "subvoxel_waste_pct": subvoxel,
        "cfl_clamp_rate_pct": clamp_rate,
        "cfl_max_step_cut_m": float(max_step_cut),
        "peak_before_m": float(initial.max()),
        "peak_after_m": float(h.max()),
        "runtime_s": time.perf_counter() - t_start,
        "numba": bool(HAS_NUMBA),
    }
    return ErosionResult(
        height=h.astype(np.float32),
        flow=flow.astype(np.float32),
        sediment=sed_acc.astype(np.float32),
        wear=wear.astype(np.float32),
        deposition=depo.astype(np.float32),
        talus=talus_map.astype(np.float32),
        cut=cut.astype(np.float32),
        brush_radius_cells=float(brush_cells),
        brush_clamped=bool(brush_clamped),
        stats=stats,
    )
