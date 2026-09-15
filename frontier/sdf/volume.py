"""Sparse-friendly signed-distance field used for *structure* (SDF) sculpting.

Why an SDF layer at all, when the geomorphic solvers are height-based?

* Real canyon country is not a single-valued heightfield: alcoves, arches, undercut
  cliffs, cave roofs and overhangs cannot be represented by z(x, y).
* A distance field gives free, physically meaningful masks for texturing: interior
  distance (cavity AO), gradient (surface normal), normal.z (sheltered surfaces
  that collect dust/sand), and multi-crossing detection (cave/overhang masks).
* Sculpting primitives (mesa, hoodoo, arch, alcove, rock scatter) are trivial in
  CSG, and remain valid after the height-based erosion passes because erosion is
  re-applied to the structure field as level-set advection (Osher & Sethian 1988,
  *J. Comput. Phys.* 79, 12-49) plus reinitialisation (Sussman, Smereka & Osher
  1994, *J. Comput. Phys.* 114, 146-159; fast sweeping reinitialisation:
  Zhao 2005, *Math. Comp.* 74, 603-629).

The field is a dense ``(nz, ny, nx)`` float32 array covering
``[0, W] x [0, W] x [z0, z0 + nz*cell]`` -- for the default 256x256x128 that is
33 MB, and it is only non-zero inside a narrow band around the surface, so all
the expensive operations (reinit, ray-cast, AO) are restricted to the band.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np
try:  # pragma: no cover
    from numba import njit
except Exception:  # pragma: no cover
    def njit(*a, **k):
        def deco(f):
            return f
        return deco

BIG = 1.0e9


def _njit(*a, **k):
    k.setdefault("cache", True)
    k.setdefault("fastmath", True)
    return njit(*a, **k)


# --------------------------------------------------------------------------
@dataclass
class SDFVolume:
    """Dense narrow-band signed distance field on a uniform lattice."""

    nx: int
    ny: int
    nz: int
    cell: float = 20.0
    origin: Tuple[float, float, float] = (0.0, 0.0, 0.0)
    phi: Optional[np.ndarray] = None
    meta: dict = None

    def __post_init__(self):
        if self.phi is None:
            self.phi = np.full((self.nz, self.ny, self.nx), BIG, dtype=np.float32)
        self.meta = self.meta or {}

    # ---------------------------------------------------------------- basics
    @property
    def shape(self):
        return (self.nz, self.ny, self.nx)

    def copy(self) -> "SDFVolume":
        v = SDFVolume(self.nx, self.ny, self.nz, self.cell, self.origin,
                      self.phi.copy(), dict(self.meta))
        return v

    def world_z(self, k) -> float:
        return self.origin[2] + k * self.cell

    def z_index(self, z) -> int:
        return int(round((z - self.origin[2]) / self.cell))

    def bounds(self):
        ox, oy, oz = self.origin
        return (ox, ox + self.nx * self.cell, oy, oy + self.ny * self.cell,
                oz, oz + self.nz * self.cell)

    def active_band(self, halfwidth=3):
        """Boolean mask of the narrow band |phi| <= halfwidth*cell."""
        return np.abs(self.phi) <= halfwidth * self.cell

    # --------------------------------------------------- heightfield bridge
    def from_heightfield(self, z: np.ndarray, thickness: float = 60.0,
                         soften: float = 0.0, base_below: float = BIG) -> None:
        """Rasterise a heightfield as ``phi = distance`` with solid below z(x, y).

        The exact vertical distance to a heightfield is a good approximation of
        the true distance for gently sloping ground, and reinitialisation
        restores the metric property |grad phi| = 1.
        """
        z = np.ascontiguousarray(z, dtype=np.float32)
        phi = self.phi
        nz, ny, nx = phi.shape
        ox, oy, oz = self.origin
        cell = self.cell
        for k in range(nz):
            zw = oz + k * cell
            dz = zw - z
            phi[k] = np.clip(dz, -BIG, thickness).astype(np.float32)
        if soften > 0.0:
            from ..core.grid import gaussian_blur
            sigma = soften / cell
            for k in range(nz):
                phi[k] = gaussian_blur(phi[k], sigma)
        self.reinit(iters=4)

    def to_heightfield(self, zmin: float, nx: int, ny: int, cell: float,
                       zmax: Optional[float] = None):
        """Ray-march the field from the top to recover a height surface.

        Returns ``(z_hit, hits, multi)`` where ``hits`` marks rays that found a
        surface and ``multi`` marks rays with more than one crossing (caves,
        arches, overhangs) -- exactly the cells a pure heightfield cannot store.
        """
        return _raycast_top(self.phi, self.origin, self.cell, nx, ny, cell,
                            zmin, zmax if zmax is not None else 1.0e4)

    # ----------------------------------------------------------- operations
    def reinit(self, iters: int = 4) -> None:
        """Fast-sweeping reinitialisation to |grad phi| = 1 (Zhao 2005)."""
        _fast_sweep_reinit(self.phi, self.cell, iters)

    def gradient(self):
        return _sdf_gradient(self.phi, self.cell)

    def ambient_occlusion(self, directions: int = 8, max_dist_cells: int = 24,
                          field_bias: float = 1.0) -> np.ndarray:
        """AO by cone-reduced distance sampling, returns (nz, ny, nx) in [0, 1]."""
        return _sdf_ao(self.phi, self.cell, directions, max_dist_cells, field_bias)

    def dilate_band(self, cells: int = 1) -> None:
        _band_dilate(self.phi, self.cell, cells)


# --------------------------------------------------------------------------
# primitive distance functions (exact; Inigo Quilez's standard forms, which
# are the analytic SDFs of the usual set-theoretic primitives)
# --------------------------------------------------------------------------
@_njit
def _prim_box(px, py, pz, cx, cy, cz, hx, hy, hz, rx, ry, rz):
    qx = abs(px - cx) - hx
    qy = abs(py - cy) - hy
    qz = abs(pz - cz) - hz
    ox = qx if qx > 0.0 else 0.0
    oy = qy if qy > 0.0 else 0.0
    oz = qz if qz > 0.0 else 0.0
    outside = np.sqrt(ox * ox + oy * oy + oz * oz)
    inside = min(max(qx, qy, qz), 0.0)
    return outside + inside


@_njit
def _prim_sphere(px, py, pz, cx, cy, cz, r):
    dx = px - cx
    dy = py - cy
    dz = pz - cz
    return np.sqrt(dx * dx + dy * dy + dz * dz) - r


@_njit
def _prim_ellipsoid(px, py, pz, cx, cy, cz, ax, ay, az):
    dx = (px - cx) / ax
    dy = (py - cy) / ay
    dz = (pz - cz) / az
    k0 = np.sqrt(dx * dx + dy * dy + dz * dz)
    dx2 = dx / ax
    dy2 = dy / ay
    dz2 = dz / az
    k1 = np.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2)
    if k1 < 1e-12:
        return -min(ax, min(ay, az))
    return k0 * (k0 - 1.0) / k1


@_njit
def _prim_capsule(px, py, pz, ax, ay, az, bx, by, bz, r):
    pax = px - ax
    pay = py - ay
    paz = pz - az
    bax = bx - ax
    bay = by - ay
    baz = bz - az
    dot = pax * bax + pay * bay + paz * baz
    bab = bax * bax + bay * bay + baz * baz
    h = dot / bab if bab > 1e-12 else 0.0
    if h < 0.0:
        h = 0.0
    elif h > 1.0:
        h = 1.0
    dx = pax - bax * h
    dy = pay - bay * h
    dz = paz - baz * h
    return np.sqrt(dx * dx + dy * dy + dz * dz) - r


@_njit
def _prim_cone(px, py, pz, ax, ay, az, bx, by, bz, r1, r2):
    """Tapered capsule (cone with rounded caps): hoodoos, pinnacles, buttes.

    Sign-correct everywhere and C1; the exact round-cone distance is not needed
    because every stamp is followed by fast-sweeping reinitialisation which
    restores |grad phi| = 1.
    """
    bax = bx - ax
    bay = by - ay
    baz = bz - az
    l2 = bax * bax + bay * bay + baz * baz
    if l2 < 1e-12:
        dx = px - ax
        dy = py - ay
        dz = pz - az
        return np.sqrt(dx * dx + dy * dy + dz * dz) - r1
    t = ((px - ax) * bax + (py - ay) * bay + (pz - az) * baz) / l2
    if t < 0.0:
        t = 0.0
    elif t > 1.0:
        t = 1.0
    cx = ax + bax * t
    cy = ay + bay * t
    cz = az + baz * t
    r = r1 + (r2 - r1) * t
    dx = px - cx
    dy = py - cy
    dz = pz - cz
    return np.sqrt(dx * dx + dy * dy + dz * dz) - r


@_njit
def _prim_plane(px, py, pz, nx_, ny_, nz_, d):
    nl = np.sqrt(nx_ * nx_ + ny_ * ny_ + nz_ * nz_)
    return (px * nx_ + py * ny_ + pz * nz_) / nl - d


@_njit
def _prim_torus(px, py, pz, cx, cy, cz, R, r):
    dx = px - cx
    dy = py - cy
    dz = pz - cz
    q = np.sqrt(dx * dx + dz * dz) - R
    return np.sqrt(q * q + dy * dy) - r


# --------------------------------------------------------------------------
# CSG / R-function blending (Rvachev 1963; Pasko et al. 1995 function
# representation; smooth min with a blending radius)
# --------------------------------------------------------------------------
@_njit
def _smin_poly(a, b, k):
    if k <= 1e-9:
        return a if a < b else b
    h = max(k - abs(a - b), 0.0) / k
    return min(a, b) - h * h * k * 0.25


@_njit
def _smax_poly(a, b, k):
    return -_smin_poly(-a, -b, k)


# --------------------------------------------------------------------------
# sculpt stamps operate on the raw phi array (nz, ny, nx)
# --------------------------------------------------------------------------
@_njit(parallel=False)
def stamp_box(phi, origin, cell, cx, cy, cz, hx, hy, hz, mode, blend, jitter):
    nz, ny, nx = phi.shape
    ox, oy, oz = origin
    for k in range(nz):
        pz = oz + k * cell
        for j in range(ny):
            py = oy + j * cell
            for i in range(nx):
                px = ox + i * cell
                d = _prim_box(px, py, pz, cx, cy, cz, hx, hy, hz, 0.0, 0.0, 0.0)
                if jitter > 0.0:
                    # angular, cliff-like chipping of the box silhouette
                    a = np.arctan2(py - cy, px - cx)
                    d += jitter * cell * (np.sin(3.1 * a) * 0.5 + np.sin(7.7 * a + 1.3) * 0.25)
                cur = phi[k, j, i]
                if mode == 0:
                    phi[k, j, i] = _smin_poly(cur, d, blend)
                elif mode == 1:
                    phi[k, j, i] = _smax_poly(cur, -d, blend)


@_njit(parallel=False)
def stamp_sphere(phi, origin, cell, cx, cy, cz, r, mode, blend, jitter_amp,
                 jitter_freq, seed):
    nz, ny, nx = phi.shape
    cut = 6.0 * cell
    ox, oy, oz = origin
    for k in range(nz):
        pz = oz + k * cell
        for j in range(ny):
            py = oy + j * cell
            for i in range(nx):
                px = ox + i * cell
                d = _prim_sphere(px, py, pz, cx, cy, cz, r)
                if jitter_amp > 0.0:
                    ang = np.sin(0.37 * px + 0.71 * py) * np.cos(0.53 * pz + 0.19 * px)
                    d += jitter_amp * ang
                if d > cut:
                    d = cut
                cur = phi[k, j, i]
                if mode == 0:
                    phi[k, j, i] = _smin_poly(cur, d, blend)
                else:
                    phi[k, j, i] = _smax_poly(cur, -d, blend)


@_njit(parallel=False)
def stamp_cylinder(phi, origin, cell, cx, cy, z0, z1, r, mode, blend, taper):
    """Vertical (optionally tapered) cylinder/cone: hoodoos, pinnacles, buttes."""
    nz, ny, nx = phi.shape
    cut = 6.0 * cell
    ox, oy, oz = origin
    for k in range(nz):
        pz = oz + k * cell
        if pz < z0 - cell or pz > z1 + cell:
            continue
        t = (pz - z0) / max(z1 - z0, 1e-6)
        rr = r * (1.0 + taper * (t - 1.0))
        for j in range(ny):
            py = oy + j * cell
            for i in range(nx):
                px = ox + i * cell
                dx = px - cx
                dy = py - cy
                d = np.sqrt(dx * dx + dy * dy) - rr
                # cap at the base and the top
                if pz < z0:
                    d = max(d, z0 - pz)
                if pz > z1:
                    d = max(d, pz - z1)
                if d > cut:
                    d = cut
                cur = phi[k, j, i]
                if mode == 0:
                    phi[k, j, i] = _smin_poly(cur, d, blend)
                elif mode == 1:
                    phi[k, j, i] = _smax_poly(cur, -d, blend)


@_njit(parallel=False)
def stamp_capsule(phi, origin, cell, ax, ay, az, bx, by, bz, r, mode, blend):
    nz, ny, nx = phi.shape
    cut = 6.0 * cell
    ox, oy, oz = origin
    for k in range(nz):
        pz = oz + k * cell
        for j in range(ny):
            py = oy + j * cell
            for i in range(nx):
                px = ox + i * cell
                d = _prim_capsule(px, py, pz, ax, ay, az, bx, by, bz, r)
                if d > cut:
                    d = cut
                cur = phi[k, j, i]
                if mode == 0:
                    phi[k, j, i] = _smin_poly(cur, d, blend)
                elif mode == 1:
                    phi[k, j, i] = _smax_poly(cur, -d, blend)


@_njit(parallel=False)
def stamp_cone(phi, origin, cell, ax, ay, az, bx, by, bz, r1, r2, mode, blend):
    nz, ny, nx = phi.shape
    cut = 6.0 * cell
    ox, oy, oz = origin
    for k in range(nz):
        pz = oz + k * cell
        for j in range(ny):
            py = oy + j * cell
            for i in range(nx):
                px = ox + i * cell
                d = _prim_cone(px, py, pz, ax, ay, az, bx, by, bz, r1, r2)
                if d > cut:
                    d = cut
                cur = phi[k, j, i]
                if mode == 0:
                    phi[k, j, i] = _smin_poly(cur, d, blend)
                elif mode == 1:
                    phi[k, j, i] = _smax_poly(cur, -d, blend)


# --------------------------------------------------------------------------
# level-set operations
# --------------------------------------------------------------------------
@_njit(cache=True)
def _sdf_gradient(phi, cell):
    nz, ny, nx = phi.shape
    gx = np.zeros((nz, ny, nx), dtype=np.float32)
    gy = np.zeros((nz, ny, nx), dtype=np.float32)
    gz = np.zeros((nz, ny, nx), dtype=np.float32)
    inv = 0.5 / cell
    for k in range(nz):
        for j in range(ny):
            for i in range(nx):
                if i > 0 and i < nx - 1:
                    gx[k, j, i] = (phi[k, j, i + 1] - phi[k, j, i - 1]) * inv
                if j > 0 and j < ny - 1:
                    gy[k, j, i] = (phi[k, j + 1, i] - phi[k, j - 1, i]) * inv
                if k > 0 and k < nz - 1:
                    gz[k, j, i] = (phi[k + 1, j, i] - phi[k - 1, j, i]) * inv
    return gx, gy, gz


@_njit(cache=True)
def _fs_solve(a, b, c, h):
    """Godunov upwind solution of (max(phi-a,0))^2 + ... = h^2 for a<=b<=c.

    Standard form used in fast sweeping eikonal solvers (Zhao 2005,
    *Math. Comp.* 74, 603-629; Kao, Osher & Qian 2004, *J. Comput. Phys.* 196).
    """
    if a + h <= b:
        return a + h
    d = 2.0 * h * h - (a - b) * (a - b)
    if d < 0.0:
        d = 0.0
    s = 0.5 * (a + b + np.sqrt(d))
    if s <= c:
        return s
    sm = a + b + c
    q = a * a + b * b + c * c - h * h
    disc = sm * sm - 3.0 * q
    if disc < 0.0:
        disc = 0.0
    return (sm + np.sqrt(disc)) / 3.0


@njit(cache=True)
def _sort3(a, b, c):
    if a > b:
        t = a; a = b; b = t
    if b > c:
        t = b; b = c; c = t
    if a > b:
        t = a; a = b; b = t
    return a, b, c


@njit(cache=True)
def _algebraic_reinit(phi, cell, band):
    """Algebraic (quasi-Newton) renormalisation phi <- sign(phi)*|phi|/|grad phi|.

    One step of the reinitialisation PDE (Sussman, Smereka & Osher 1994;
    Sussman & Fatemi 1999, *J. Comput. Phys.* 152, 414-434): the zero level set
    is unchanged, the metric is restored to first order.  The fast-sweeping
    pass then propagates exact distances outward from the corrected band.
    """
    nz, ny, nx = phi.shape
    inv2 = 0.5 / cell
    out = phi.copy()
    for k in range(1, nz - 1):
        for j in range(1, ny - 1):
            for i in range(1, nx - 1):
                cur = phi[k, j, i]
                if abs(cur) > band:
                    continue
                gx = (phi[k, j, i + 1] - phi[k, j, i - 1]) * inv2
                gy = (phi[k, j + 1, i] - phi[k, j - 1, i]) * inv2
                gz = (phi[k + 1, j, i] - phi[k - 1, j, i]) * inv2
                g = np.sqrt(gx * gx + gy * gy + gz * gz)
                if g < 1e-6:
                    continue
                v = abs(cur) / g
                out[k, j, i] = v if cur >= 0.0 else -v
    phi[:, :, :] = out


@njit(cache=True)
def _fast_sweep_reinit(phi, cell, iters):
    """Reinitialise to |grad phi| = 1 with 4-direction fast sweeping.

    Only voxels inside the narrow band (|phi| <= 6 cells) are touched; the zero
    level set is preserved to first order, which is what keeps the sculpted
    geometry stable across repeated stamps.
    """
    nz, ny, nx = phi.shape
    h = cell
    band = 6.0 * cell
    for _ in range(iters):
        for sweep in range(4):
            kk0, kk1, ks = (0, nz, 1) if sweep in (0, 1) else (nz - 1, -1, -1)
            jj0, jj1, js = (0, ny, 1) if sweep in (0, 3) else (ny - 1, -1, -1)
            ii0, ii1, istep = (0, nx, 1) if sweep in (0, 2) else (nx - 1, -1, -1)
            for k in range(kk0, kk1, ks):
                for j in range(jj0, jj1, js):
                    for i in range(ii0, ii1, istep):
                        cur = phi[k, j, i]
                        if abs(cur) > band:
                            continue
                        xm = phi[k, j, i - 1] if i > 0 else 1e9
                        xp = phi[k, j, i + 1] if i < nx - 1 else 1e9
                        ym = phi[k, j - 1, i] if j > 0 else 1e9
                        yp = phi[k, j + 1, i] if j < ny - 1 else 1e9
                        zm = phi[k - 1, j, i] if k > 0 else 1e9
                        zp = phi[k + 1, j, i] if k < nz - 1 else 1e9
                        if cur >= 0.0:
                            a = xm if xm < xp else xp
                            b = ym if ym < yp else yp
                            c = zm if zm < zp else zp
                            if a > 1e8 and b > 1e8 and c > 1e8:
                                continue
                            a, b, c = _sort3(a, b, c)
                            val = _fs_solve(a, b, c, h)
                        else:
                            a = xm if xm > xp else xp
                            b = ym if ym > yp else yp
                            c = zm if zm > zp else zp
                            if a < -1e8 and b < -1e8 and c < -1e8:
                                continue
                            a, b, c = _sort3(-a, -b, -c)
                            val = -_fs_solve(a, b, c, h)
                        # sign-preserving update (the interface itself is not moved)
                        if cur >= 0.0:
                            if val < 0.0:
                                val = 0.0
                            phi[k, j, i] = val
                        else:
                            if val > 0.0:
                                val = 0.0
                            phi[k, j, i] = val


@_njit(cache=True)
def _band_dilate(phi, cell, cells):
    nz, ny, nx = phi.shape
    thr = cells * cell
    for _ in range(cells):
        out = phi.copy()
        for k in range(nz):
            for j in range(ny):
                for i in range(nx):
                    if abs(phi[k, j, i]) <= thr:
                        continue
                    best = phi[k, j, i]
                    for dk in (-1, 0, 1):
                        for dj in (-1, 0, 1):
                            for di in (-1, 0, 1):
                                kk = k + dk
                                jj = j + dj
                                ii = i + di
                                if kk < 0 or kk >= nz or jj < 0 or jj >= ny or ii < 0 or ii >= nx:
                                    continue
                                v = phi[kk, jj, ii]
                                if abs(v) < abs(best):
                                    best = v
                    out[k, j, i] = best
        phi[:] = out


@_njit(cache=True)
def _raycast_top(phi, origin, vcell, nx, ny, hcell, zmin, zmax):
    """March rays downward along z through the SDF, return the top surface."""
    nz, nyv, nxv = phi.shape
    ox, oy, oz = origin
    z_out = np.full((ny, nx), np.nan, dtype=np.float32)
    hits = np.zeros((ny, nx), dtype=np.bool_)
    multi = np.zeros((ny, nx), dtype=np.bool_)
    for j in range(ny):
        for i in range(nx):
            x = (i + 0.5) * hcell
            y = (j + 0.5) * hcell
            fi = x / vcell - 0.5
            fj = y / vcell - 0.5
            i0 = int(np.floor(fi))
            j0 = int(np.floor(fj))
            if i0 < 0 or j0 < 0 or i0 >= nxv - 1 or j0 >= nyv - 1:
                continue
            tx = fi - i0
            ty = fj - j0
            # sample downwards from zmax; step = one voxel
            ktop = int((zmax - oz) / vcell)
            if ktop >= nz - 1:
                ktop = nz - 1
            if ktop < 1:
                ktop = 1
            prev = None
            ncross = 0
            zhit = np.float32(0.0)
            for k in range(ktop, 0, -1):
                zw = oz + k * vcell
                if zw < zmin - vcell:
                    break
                v = (phi[k, j0, i0] * (1.0 - tx) * (1.0 - ty)
                     + phi[k, j0, i0 + 1] * tx * (1.0 - ty)
                     + phi[k, j0 + 1, i0] * (1.0 - tx) * ty
                     + phi[k, j0 + 1, i0 + 1] * tx * ty)
                if prev is not None:
                    if (prev > 0.0 and v <= 0.0) or (prev <= 0.0 and v > 0.0):
                        ncross += 1
                        if ncross == 1:
                            t = prev / (prev - v) if abs(prev - v) > 1e-12 else 0.0
                            zhit = np.float32(oz + (k + 1 - t) * vcell)
                            hits[j, i] = True
                prev = v
            if ncross > 1:
                multi[j, i] = True
            if hits[j, i]:
                z_out[j, i] = zhit
    return z_out, hits, multi


@_njit(cache=True)
def _sdf_ao(phi, cell, ndir, max_cells, bias):
    """Ambient occlusion via quasi-uniform direction sampling on the hemisphere."""
    nz, ny, nx = phi.shape
    out = np.ones((nz, ny, nx), dtype=np.float32)
    # cosine-weighted directions on the hemisphere (deterministic spiral)
    dirs = np.zeros((ndir, 3), dtype=np.float32)
    for m in range(ndir):
        zc = 1.0 - (m + 0.5) / ndir
        r = np.sqrt(max(0.0, 1.0 - zc * zc))
        a = m * 2.39996323
        dirs[m, 0] = r * np.cos(a)
        dirs[m, 1] = r * np.sin(a)
        dirs[m, 2] = zc
    for k in range(nz):
        for j in range(ny):
            for i in range(nx):
                if abs(phi[k, j, i]) > 2.5 * cell:
                    continue
                occ = 0.0
                for m in range(ndir):
                    dx = dirs[m, 0]
                    dy = dirs[m, 1]
                    dz = dirs[m, 2]
                    ki = k + dz
                    ji = j + dy
                    ii = i + dx
                    dist = 0.0
                    for s in range(1, max_cells):
                        ai = int(ii + dx * s)
                        aj = int(ji + dy * s)
                        ak = int(ki + dz * s)
                        if ai < 0 or ai >= nx or aj < 0 or aj >= ny or ak < 0 or ak >= nz:
                            break
                        d = phi[ak, aj, ai]
                        dd = s * cell
                        if d < 0.0:
                            occ += 1.0
                            break
                        if d < bias:
                            occ += 1.0 - d / bias
                            break
                        if dd > bias:
                            break
                out[k, j, i] = 1.0 - occ / ndir
    return out


# --------------------------------------------------------------------------
# mesh extraction: constrained elastic surface nets (Gibson 1998, MICCAI)
# --------------------------------------------------------------------------
def surface_nets(phi: np.ndarray, cell: float, origin=(0.0, 0.0, 0.0),
                 level: float = 0.0):
    """Extract a triangle mesh from the SDF (Surface Nets; Gibson 1998).

    Vectorised over the narrow band.  Returns (vertices, faces).
    """
    phi = np.ascontiguousarray(phi, dtype=np.float32) - level
    nz, ny, nx = phi.shape
    ci = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0),
          (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]

    def corner(di, dj, dk):
        return phi[dk:dk + nz - 1, dj:dj + ny - 1, di:di + nx - 1]

    vals = [corner(di, dj, dk) for (di, dj, dk) in ci]
    neg = [(v < 0.0) for v in vals]
    any_neg = np.zeros_like(vals[0], dtype=bool)
    any_pos = np.zeros_like(vals[0], dtype=bool)
    for v in vals:
        any_neg |= (v < 0.0)
        any_pos |= (v >= 0.0)
    active = any_neg & any_pos
    if not active.any():
        return np.zeros((0, 3), np.float32), np.zeros((0, 3), np.int32)

    sx = np.zeros_like(vals[0])
    sy = np.zeros_like(vals[0])
    sz = np.zeros_like(vals[0])
    cnt = np.zeros_like(vals[0])
    for (ea, eb) in _EDGES:
        va, vb = vals[ea], vals[eb]
        cross = ((va < 0.0) != (vb < 0.0))
        if not cross.any():
            continue
        denom = (va - vb)
        t = np.where(cross, va / np.where(np.abs(denom) < 1e-12, 1e-12, denom), 0.0)
        pa, pb = ci[ea], ci[eb]
        sx += np.where(cross, pa[0] + (pb[0] - pa[0]) * t, 0.0)
        sy += np.where(cross, pa[1] + (pb[1] - pa[1]) * t, 0.0)
        sz += np.where(cross, pa[2] + (pb[2] - pa[2]) * t, 0.0)
        cnt += cross
    ok = active & (cnt > 0)
    idx = np.full((nz, ny, nx), -1, dtype=np.int64)
    kk, jj, ii = np.nonzero(ok)
    n = len(kk)
    verts = np.empty((n, 3), dtype=np.float32)
    denom = np.where(cnt[ok] == 0, 1, cnt[ok])
    verts[:, 0] = origin[0] + (ii + sx[ok] / denom) * cell
    verts[:, 1] = origin[1] + (jj + sy[ok] / denom) * cell
    verts[:, 2] = origin[2] + (kk + sz[ok] / denom) * cell
    idx[kk, jj, ii] = np.arange(n, dtype=np.int64)

    faces = []
    # the surface crosses the grid edge (i,j,k)->(i+1,j,k) when phi changes sign
    # between the two voxels; the quad joins the vertices of the 4 cells around
    # that edge (Gibson 1998).
    for axis in range(3):
        if axis == 0:
            e0 = phi[:, :-1, :-1]; e1 = phi[:, :-1, 1:]
            cs = [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)]
        elif axis == 1:
            e0 = phi[:, :-1, :-1]; e1 = phi[:, 1:, :-1]
            cs = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)]
        else:
            e0 = phi[:-1, :-1, :-1]; e1 = phi[1:, :-1, :-1]
            cs = [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)]
        cross = ((e0 < 0.0) != (e1 < 0.0))
        if not cross.any():
            continue
        # gather explicitly (small memory, clarity over cleverness)
        dz, dy, dx = np.nonzero(cross)
        for d in range(len(dz)):
            k, j, i = int(dz[d]), int(dy[d]), int(dx[d])
            quad = []
            bad = False
            for (bi, bj, bk) in cs:
                vi = idx[k + bk, j + bj, i + bi]
                if vi < 0:
                    bad = True
                    break
                quad.append(vi)
            if bad:
                continue
            if e1[dz[d], dy[d], dx[d]] < 0.0:
                quad = quad[::-1]
            faces.append((quad[0], quad[1], quad[2]))
            faces.append((quad[0], quad[2], quad[3]))
    f = np.asarray(faces, dtype=np.int32) if faces else np.zeros((0, 3), np.int32)
    return verts, f


_CORNERS = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0),
            (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]
_EDGES = [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4),
          (0, 4), (1, 5), (2, 6), (3, 7)]
