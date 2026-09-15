"""Sculpting: brushes on the surface, structure stamps in the SDF, spline carving.

The brush set follows the way geomorphologists think about terrain rather than
the way mesh sculptors do: everything is either (a) a slope-limited process,
(b) a lithology-controlled form, or (c) a fluvial/aeolian form.  Brushes that are
just "smooth blob" are deliberately kept to a minimum because they are the
fastest way to make terrain look synthetic.

Structure stamps operate on the SDF (frontier.sdf.volume), surface stamps on the
heightfield; both write into the same document so the two representations stay
consistent (see frontier.pipeline.stack for the sync rules).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from numba import njit

from .volume import SDFVolume, stamp_box, stamp_sphere, stamp_cylinder, stamp_capsule, stamp_cone
from ..spline.path import PathSpec, distance_to_path, profile_shape


# --------------------------------------------------------------------------
# brush falloff
# --------------------------------------------------------------------------
def falloff(dist: np.ndarray, radius: float, hardness: float = 0.5,
            shape: str = "smooth") -> np.ndarray:
    """Brush weight in [0, 1]; hardness = 0 -> very soft, 1 -> casi-plateau."""
    r = max(radius, 1e-6)
    t = np.clip(dist / r, 0.0, 1.0)
    inner = np.clip(hardness, 0.0, 0.99)
    if inner > 0.0:
        t = np.clip((t - inner) / (1.0 - inner), 0.0, 1.0)
    if shape == "smooth":
        w = 1.0 - (3 * t * t - 2 * t * t * t)        # smoothstep
    elif shape == "gauss":
        w = np.exp(-4.5 * t * t)
    elif shape == "linear":
        w = 1.0 - t
    else:
        w = 1.0 - (3 * t * t - 2 * t * t * t)
    return w.astype(np.float32)


def brush_kernel(nx: int, ny: int, cell: float, cx: float, cy: float,
                 radius: float):
    """Return (slice_y, slice_x, distance array) for a brush at world (cx, cy)."""
    r = radius
    x0 = max(0, int((cx - r) / cell))
    x1 = min(nx, int((cx + r) / cell) + 1)
    y0 = max(0, int((cy - r) / cell))
    y1 = min(ny, int((cy + r) / cell) + 1)
    if x1 <= x0 or y1 <= y0:
        return None
    xs = (np.arange(x0, x1) + 0.5) * cell
    ys = (np.arange(y0, y1) + 0.5) * cell
    gx, gy = np.meshgrid(xs, ys)
    d = np.hypot(gx - cx, gy - cy)
    return (slice(y0, y1), slice(x0, x1), d)


# --------------------------------------------------------------------------
# surface brushes
# --------------------------------------------------------------------------
def brush_raise(t, cx, cy, radius, amount, hardness=0.5, shape="smooth",
                mask: Optional[np.ndarray] = None, direction=1.0):
    """Raise (amount > 0) or lower (amount < 0), optionally masked."""
    k = brush_kernel(t.nx, t.ny, t.cell, cx, cy, radius)
    if k is None:
        return
    sy, sx, d = k
    w = falloff(d, radius, hardness, shape) * amount * direction
    if mask is not None:
        w = w * mask[sy, sx]
    t.z_rock[sy, sx] += w.astype(np.float32)


def brush_smooth(t, cx, cy, radius, strength=0.6, hardness=0.5,
                 mask: Optional[np.ndarray] = None, sigma_cells=2.0):
    from ..core.grid import gaussian_blur
    k = brush_kernel(t.nx, t.ny, t.cell, cx, cy, radius + 3 * sigma_cells * t.cell)
    if k is None:
        return
    sy, sx, d = k
    blur = gaussian_blur(t.z, sigma_cells)
    w = falloff(d, radius, hardness) * strength
    if mask is not None:
        w = w * mask[sy, sx]
    t.z_rock[sy, sx] = (t.z_rock[sy, sx] * (1 - w) + blur[sy, sx] * w).astype(np.float32)


def brush_flatten(t, cx, cy, radius, target=None, strength=0.7, hardness=0.4,
                  mask: Optional[np.ndarray] = None):
    """Flatten towards the brush-centre elevation (mesa/terrace shaping)."""
    k = brush_kernel(t.nx, t.ny, t.cell, cx, cy, radius)
    if k is None:
        return
    sy, sx, d = k
    if target is None:
        target = float(np.median(t.z[sy, sx]))
    w = falloff(d, radius, hardness) * strength
    if mask is not None:
        w = w * mask[sy, sx]
    t.z_rock[sy, sx] = (t.z_rock[sy, sx] * (1 - w) + target * w).astype(np.float32)


def brush_terrace(t, cx, cy, radius, step=30.0, sharpness=0.7, hardness=0.3,
                  mask: Optional[np.ndarray] = None):
    """Lithology-terrace brush: snaps heights to bedding-parallel steps.

    This is the quickest way to author the staircase profile of a sedimentary
    canyon by hand (the same steps also emerge on their own once the layered
    erodibility field is fed to the erosion solvers).
    """
    k = brush_kernel(t.nx, t.ny, t.cell, cx, cy, radius)
    if k is None:
        return
    sy, sx, d = k
    z = t.z_rock[sy, sx]
    tgt = np.round(z / step) * step
    w = falloff(d, radius, hardness) * sharpness
    if mask is not None:
        w = w * mask[sy, sx]
    t.z_rock[sy, sx] = (z * (1 - w) + tgt * w).astype(np.float32)


def brush_slope_limit(t, cx, cy, radius, repose_deg=33.0, iterations=12,
                      mask: Optional[np.ndarray] = None):
    """Talus/scree brush: relaxes the local surface to the angle of repose."""
    k = brush_kernel(t.nx, t.ny, t.cell, cx, cy, radius * 1.5)
    if k is None:
        return
    sy, sx, d = k
    sub = np.ascontiguousarray(t.z_rock[sy, sx], dtype=np.float64)
    w = falloff(d, radius * 1.5, 0.2)
    _relax(sub, t.cell, np.tan(np.radians(repose_deg)), iterations)
    if mask is not None:
        w = w * mask[sy, sx]
    t.z_rock[sy, sx] = (t.z_rock[sy, sx] * (1 - w) + sub * w).astype(np.float32)


@njit(cache=True)
def _relax(z, cell, tan_repose, iters):
    """Angle-of-repose relaxation (talus) - push material down-stope."""
    ny, nx = z.shape
    maxdiff = tan_repose * cell
    for _ in range(iters):
        for j in range(1, ny - 1):
            for i in range(1, nx - 1):
                for (di, dj) in ((1, 0), (0, 1), (1, 1), (-1, 1)):
                    ii = i + di
                    jj = j + dj
                    if ii < 0 or ii >= nx or jj < 0 or jj >= ny:
                        continue
                    dz = z[j, i] - z[jj, ii]
                    d = cell * (1.41421356 if (di != 0 and dj != 0) else 1.0)
                    lim = tan_repose * d
                    if dz > lim:
                        move = (dz - lim) * 0.5
                        z[j, i] -= move
                        z[jj, ii] += move
                    elif dz < -lim:
                        move = (-dz - lim) * 0.5
                        z[j, i] += move
                        z[jj, ii] -= move


def brush_sand(t, cx, cy, radius, depth, hardness=0.3, mask=None):
    """Deposit loose sediment (goes to z_sed, so the satmap shows sand)."""
    k = brush_kernel(t.nx, t.ny, t.cell, cx, cy, radius)
    if k is None:
        return
    sy, sx, d = k
    w = falloff(d, radius, hardness) * depth
    if mask is not None:
        w = w * mask[sy, sx]
    t.z_sed[sy, sx] = np.maximum(t.z_sed[sy, sx] + w, 0.0).astype(np.float32)


def brush_gully(t, cx, cy, radius, depth, count=5, seed=1, hardness=0.4):
    """Cut a set of small gullies - a cheap way to break a smooth slope."""
    rng = np.random.default_rng(seed)
    for _ in range(count):
        a = rng.uniform(0, 2 * np.pi)
        r0 = rng.uniform(0.2, 1.0) * radius
        x0 = cx + np.cos(a) * r0
        y0 = cy + np.sin(a) * r0
        x1 = cx + np.cos(a) * radius * 1.6
        y1 = cy + np.sin(a) * radius * 1.6
        carve_line(t, x0, y0, x1, y1, width=radius * 0.12, depth=depth,
                   hardness=hardness)


def carve_line(t, x0, y0, x1, y1, width=20.0, depth=10.0, hardness=0.5,
               profile="v", mask=None):
    """Carve a straight segment (used by the gully brush and path carving)."""
    k = brush_kernel(t.nx, t.ny, t.cell, (x0 + x1) * 0.5, (y0 + y1) * 0.5,
                     (np.hypot(x1 - x0, y1 - y0) * 0.5 + width * 3))
    if k is None:
        return
    sy, sx, d = k
    xs = (np.arange(t.nx)[sx] + 0.5) * t.cell
    ys = (np.arange(t.ny)[sy] + 0.5) * t.cell
    gx, gy = np.meshgrid(xs, ys)
    ex, ey = x1 - x0, y1 - y0
    L2 = max(ex * ex + ey * ey, 1e-9)
    tt = np.clip(((gx - x0) * ex + (gy - y0) * ey) / L2, 0.0, 1.0)
    dd = np.hypot(gx - (x0 + tt * ex), gy - (y0 + tt * ey))
    s = np.clip(dd / max(width, 1e-6), 0.0, 1.0)
    prof = profile_shape(s, profile, 0.0)
    dz = -depth * prof
    if mask is not None:
        dz = dz * mask[sy, sx]
    t.z_rock[sy, sx] += dz.astype(np.float32)


# --------------------------------------------------------------------------
# spline / path operations
# --------------------------------------------------------------------------
def carve_path(t, path: PathSpec, floor_from_dem: bool = False,
               mask: Optional[np.ndarray] = None, profile_override=None):
    """Carve a river/canyon/road along a spline with a proper cross-section.

    The cross-section is a shape function applied along the path normal, with
    the depth following the path's longitudinal profile.  For ``kind='river'``
    the result is a flat floodplain plus graded valley walls -- the geometry that
    later guides the fluvial solver into cutting a real channel.
    """
    pts = path.samples()
    if len(pts) < 2:
        return
    w2 = max(path.width * 0.5, t.cell)
    maxd = w2 + path.bank_width * 2.0 + 4 * t.cell
    dist, param, _ = distance_to_path(pts, t.nx, t.ny, t.cell, maxd)
    sel = np.isfinite(dist)
    if not sel.any():
        return
    n = len(pts)
    # per-cell path properties by nearest parametric position
    ipos = np.clip((param * (n - 1)).astype(np.int32), 0, n - 1)
    if path.width_profile:
        wmul = np.interp(np.linspace(0, 1, n), np.linspace(0, 1, len(path.width_profile)),
                         np.asarray(path.width_profile, dtype=np.float64))
    else:
        wmul = np.ones(n)
    if path.depth_profile:
        dmul = np.interp(np.linspace(0, 1, n), np.linspace(0, 1, len(path.depth_profile)),
                         np.asarray(path.depth_profile, dtype=np.float64))
    else:
        dmul = np.ones(n)

    W = (path.width * 0.5) * wmul[ipos]
    B = path.bank_width * wmul[ipos]
    D = path.depth * dmul[ipos]
    s = np.clip((dist - W) / np.maximum(B, 1e-6), 0.0, 1.0)
    prof = profile_shape(s, path.profile, path.smooth)
    # depth of incision: full depth inside the channel, tapering across the banks
    dz = -D * prof
    if path.noise > 0.0:
        from ..core.noise import fbm2d
        nz = fbm2d(t.nx, t.ny, t.cell, 3, 1.0 / max(path.noise_scale, 1.0), 2.0, 0.5,
                   path.seed + 3)
        dz = dz + nz * path.noise * prof
    if mask is not None:
        dz = dz * mask
    z = t.z_rock.copy()
    if floor_from_dem:
        # keep the channel floor as the local minimum so the river does not
        # climb uphill where the spline crosses a ridge
        from ..core.grid import gaussian_blur
        floor = gaussian_blur(z, max(2.0, path.bank_width / t.cell))
        inside = dist <= (W + B)
        z = np.where(inside, np.minimum(z, floor - 0.0), z)
    z = z + np.where(sel, dz, 0.0)
    t.z_rock = z.astype(np.float32)


def uplift_path(t, path: PathSpec, mask=None):
    """Tectonic/structural ridge along a spline: offset the rock surface.

    Feed this into the erosion solvers with enough time and it becomes a
    mountain range with its own drainage network -- the honest way to make
    topography that has structure.
    """
    pts = path.samples()
    if len(pts) < 2:
        return
    maxd = path.width * 0.5 + path.bank_width * 2.0 + 4 * t.cell
    dist, _, _ = distance_to_path(pts, t.nx, t.ny, t.cell, maxd)
    sel = np.isfinite(dist)
    if not sel.any():
        return
    s = np.clip((dist - path.width * 0.5) / max(path.bank_width, 1e-6), 0.0, 1.0)
    prof = profile_shape(s, path.profile if path.profile != "traps" else "u", path.smooth)
    dz = path.uplift * prof
    if mask is not None:
        dz = dz * mask
    t.z_rock += np.where(sel, dz, 0.0).astype(np.float32)


def deposit_levee(t, path: PathSpec, height=8.0, mask=None):
    """Raise sandy levees along both banks (natural or engineered)."""
    pts = path.samples()
    if len(pts) < 2:
        return
    w2 = path.width * 0.5
    maxd = w2 + path.bank_width + 4 * t.cell
    dist, _, _ = distance_to_path(pts, t.nx, t.ny, t.cell, maxd)
    sel = np.isfinite(dist)
    band = np.clip(1.0 - np.abs(dist - (w2 + path.bank_width * 0.35)) / (path.bank_width * 0.6), 0.0, 1.0)
    dz = height * (band ** 1.5)
    if mask is not None:
        dz = dz * mask
    t.z_sed += np.where(sel, dz, 0.0).astype(np.float32)


# --------------------------------------------------------------------------
# SDF structure stamps
# --------------------------------------------------------------------------
def sdf_stamp_along_path(volume: SDFVolume, path: PathSpec, radius_scale=1.0,
                         mode="subtract", taper=0.0, use_box=False):
    """Subtract (or add) a swept volume along a spline.

    Subtract = cut a slot canyon whose walls have the geometry of the path, so a
    meander bend produces an undercut wall and an alcove automatically.  This is
    the SDF equivalent of the heightfield carve and it produces overhangs that
    the height-based solver cannot express on its own.
    """
    pts = path.samples(spacing=max(volume.cell, min(path.width, path.bank_width) * 0.35))
    if len(pts) < 2:
        return
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        f0 = i / max(len(pts) - 1, 1)
        f1 = (i + 1) / max(len(pts) - 1, 1)
        r0 = max(path.width * 0.5 * radius_scale * (1.0 + taper * (f0 - 0.5)), volume.cell * 0.6)
        r1 = max(path.width * 0.5 * radius_scale * (1.0 + taper * (f1 - 0.5)), volume.cell * 0.6)
        # find the current surface height at the two ends
        z0 = _surface_z(volume, x0, y0)
        z1 = _surface_z(volume, x1, y1)
        if z0 is None or z1 is None:
            continue
        depth = path.depth
        ax, ay, az = x0, y0, z0 - depth * 0.5
        bx, by, bz = x1, y1, z1 - depth * 0.5
        stamp_capsule(volume.phi, volume.origin, volume.cell, ax, ay, az, bx, by, bz,
                      (r0 + r1) * 0.5, 1 if mode == "subtract" else 0, 0.0)


def _surface_z(volume: SDFVolume, x: float, y: float) -> Optional[float]:
    i = int(x / volume.cell)
    j = int(y / volume.cell)
    if i < 0 or j < 0 or i >= volume.nx or j >= volume.ny:
        return None
    col = volume.phi[:, j, i]
    for k in range(len(col) - 1, 0, -1):
        if col[k] > 0.0 >= col[k - 1]:
            t = col[k] / (col[k] - col[k - 1]) if abs(col[k] - col[k - 1]) > 1e-9 else 0.0
            return volume.origin[2] + (k - t) * volume.cell
    return None


def sdf_scatter_rocks(volume: SDFVolume, t, count=40, size_range=(20.0, 90.0),
                      density_mask=None, seed=5, max_slope_deg=45.0,
                      style="boulder", base_z=None):
    """Scatter boulders/pinnacles where they would plausibly sit.

    Placement respects the slope (rocks do not balance on 45 degree slopes) and
    an optional density mask (e.g. paint "rock field" with the mask brush).
    Each rock is a union of 1-4 rotated ellipsoids/cones, so the silhouettes are
    irregular instead of spherical.
    """
    rng = np.random.default_rng(seed)
    from ..core.grid import slope_aspect
    z = base_z if base_z is not None else t.z
    slope, _ = slope_aspect(z, t.cell)
    ok = slope < np.radians(max_slope_deg)
    if density_mask is not None:
        ok &= density_mask > 0.05
    ys, xs = np.nonzero(ok)
    if len(ys) == 0:
        return 0
    placed = 0
    tries = 0
    while placed < count and tries < count * 40:
        tries += 1
        n = rng.integers(0, len(ys))
        j, i = ys[n], xs[n]
        if density_mask is not None and rng.random() > density_mask[j, i]:
            continue
        x = (i + rng.random()) * t.cell
        y = (j + rng.random()) * t.cell
        s = rng.uniform(*size_range)
        zt = float(z[j, i])
        n_parts = int(rng.integers(1, 4))
        for _ in range(n_parts):
            ox = x + rng.normal(0, s * 0.35)
            oy = y + rng.normal(0, s * 0.35)
            oz = zt - s * 0.25 + rng.normal(0, s * 0.15)
            rr = s * rng.uniform(0.5, 1.0)
            if style == "boulder":
                stamp_sphere(volume.phi, volume.origin, volume.cell, ox, oy, oz, rr,
                             0, 0.0, s * 0.18, 1.0, seed)
            elif style == "pinnacle":
                stamp_cone(volume.phi, volume.origin, volume.cell,
                           ox, oy, zt - s * 0.5, ox + rng.normal(0, s * 0.1),
                           oy + rng.normal(0, s * 0.1), zt + s * 1.5,
                           rr * 1.2, rr * 0.25, 0, 0.0)
            else:  # 'slab' - tilted box, like a fallen sandstone block
                stamp_box(volume.phi, volume.origin, volume.cell, ox, oy, oz,
                          rr, rr * 0.8, rr * 0.35, 0, 0.0, s * 0.12)
        placed += 1
    return placed


# --------------------------------------------------------------------------
# coupling: height change -> SDF (level-set advection)
# --------------------------------------------------------------------------
@njit(cache=True)
def advect_height_delta(phi, origin, cell, dz):
    """Move the SDF surface by a vertical displacement field dz(x, y).

    This is exact level-set advection with velocity (0, 0, -dz):
    phi_new(x) = phi_old(x - v dt)  -- Osher & Sethian (1988).  Erosion,
    deposition, uplift and the aeolian sand pass all talk to the SDF this way,
    which is how the structure field survives the height-based simulation.
    """
    nz, ny, nx = phi.shape
    ox, oy, oz = origin
    out = phi.copy()
    for k in range(nz):
        zw = oz + k * cell
        for j in range(ny):
            for i in range(nx):
                zsrc = zw - dz[j, i]
                fk = (zsrc - oz) / cell
                if fk < 0.0:
                    out[k, j, i] = phi[0, j, i] - (oz + 0.0 - zsrc)
                    continue
                if fk > nz - 1.001:
                    out[k, j, i] = phi[nz - 1, j, i] + (zsrc - (oz + (nz - 1) * cell))
                    continue
                k0 = int(fk)
                fr = fk - k0
                if k0 < 0:
                    k0 = 0
                    fr = 0.0
                if k0 > nz - 2:
                    k0 = nz - 2
                    fr = 1.0
                out[k, j, i] = phi[k0, j, i] * (1.0 - fr) + phi[k0 + 1, j, i] * fr
    phi[:, :, :] = out


def sync_sdf_from_height(t, volume: SDFVolume, previous_z: Optional[np.ndarray] = None):
    """Bring the structure field in line with the current heightfield."""
    z = t.z
    if previous_z is not None:
        advect_height_delta(volume.phi, volume.origin, volume.cell,
                            (z - previous_z).astype(np.float32))
    else:
        volume.from_heightfield(z, thickness=6.0 * volume.cell)
    volume.reinit(iters=2)
