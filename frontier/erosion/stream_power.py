"""Fluvial incision / landscape-evolution core.

Two peer-reviewed solvers, both O(N) and implicit in time:

1. FastScape stream-power solver -- Braun & Willett (2013), *Geomorphology*
   180-181, 170-179:
       dh/dt = U - K A^m S^n
   solved implicitly over the D8 (or MFD) drainage network built from the
   current surface, with a Newton-Raphson iteration for n != 1 (their eqs.
   22-26; convergence is unconditional for n >= 1).

2. Davy-Lague erosion-deposition, made implicit by Yuan, Braun, Guerit, Rouby &
   Cordonnier (2019), *JGR Earth Surface* 124, 1346-1365:
       dh/dt = U - K A^m S^n + (G/A) Q_s,   Q_s = integral_over_upstream (U - dh/dt) dA
   which recovers detachment-limited behaviour for G -> 0 and transport-limited
   behaviour for large G, and lets sediment pile up in basins and valley floors
   (that is how the sandy floors of the canyon preset get their alluvium).

Both are integrated on a regular grid with the "stack" ordering of Braun &
Willett (2013): nodes are visited from the base level upstream so the receiver
elevation is always already updated when a node is solved.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from numba import njit

from .flow import route, priority_flood, d8_receivers, stack_order, accumulate


# --------------------------------------------------------------------------
@dataclass
class FluvialParams:
    m: float = 0.5              # drainage-area exponent
    n: float = 1.0              # slope exponent
    K: float = 1.0e-5           # bedrock erodibility, m^(1-2m) / yr
    U: float = 1.0e-4           # uplift, m/yr (0.1 mm/yr)
    years: float = 2.0e6        # total model time
    dt: float = 1.0e4           # time step (implicit -> no CFL restriction)
    G: float = 0.0              # Davy-Lague deposition coefficient (0..1)
    Kd: float = 1.0e-3          # hillslope diffusivity, m^2/yr
    nonlinear_hillslope: bool = False
    Sc: float = 1.0             # critical slope for non-linear hillslope law
    precipitation: float = 1.0  # P / P_ref scaling of discharge
    precip_field: Optional[np.ndarray] = None
    erodibility_field: Optional[np.ndarray] = None   # relative K multiplier
    uplift_field: Optional[np.ndarray] = None        # m/yr
    boundary: str = "fixed"     # 'fixed' | 'open' | 'open_edges'
    base_level_fall: float = 0.0     # m/yr, applied to base-level nodes
    base_level_fall_mode: str = "rate"
    reroute_every: int = 1
    route_smooth: float = 1.5   # Gaussian sigma (cells) for the routing surface
    route_mode: str = "mfd"     # "mfd" (multi-directional) | "d8"
    mfd_p: float = 1.1          # MFD flow-partitioning exponent (Freeman 1991)
    diffuse_every: int = 4      # apply the hillslope operator every N steps
                                # (operator splitting; the ADI solve is
                                # unconditionally stable so this only trades a
                                # little splitting error for speed)
    drain_area_min: float = 1.0  # m^2; cells below this are treated as unchannelled
    dl_iterations: int = 4
    newton_iters: int = 4
    mfd: bool = False           # use D-infinity weights for area (Braun&Willett 2013 report MFD support)
    track_sediment: bool = True


@dataclass
class FluvialDiag:
    steps: int = 0
    years: float = 0.0
    volume_removed: float = 0.0   # m^3 of rock removed
    sediment_export: float = 0.0  # m^3 leaving the domain
    relief_start: float = 0.0
    relief_end: float = 0.0
    mean_slope_deg: float = 0.0
    extra: dict = field(default_factory=dict)


# --------------------------------------------------------------------------
# kernels
# --------------------------------------------------------------------------
@njit(cache=True)
def _solve_node(h0, hr, d, dt, K_k, A_m, m, n, U, nl_iters):
    """Solve h - h0 = dt*(U - K A^m ((h-hr)/d)^n) for one node (implicit).

    n == 1 has the exact closed form (Braun & Willett 2013, eq. 18-19);
    otherwise Newton-Raphson (their eqs. 22-26), unconditionally convergent
    for n >= 1.
    """
    c = U * dt + h0
    Ka = K_k * A_m
    if Ka <= 0.0:
        return c
    f = dt * Ka / d
    if abs(n - 1.0) < 1e-12:
        return (c + f * hr) / (1.0 + f)
    h = h0 + dt * U
    for _ in range(nl_iters):
        s = (h - hr) / d
        if s < 0.0:
            s = 0.0
        F = h - c + dt * Ka * s ** n
        dF = 1.0 + dt * Ka * n * (s ** (n - 1.0)) / d
        if dF <= 0.0:
            break
        hnew = h - F / dF
        if hnew < hr and n > 0.0:
            # slope must not invert; keep the node at or above its receiver
            hnew = hr
        if abs(hnew - h) < 1e-9:
            h = hnew
            break
        h = hnew
    return h


@njit(cache=True)
def fastscape_sweep(z, z0, rec, rd, order, area, dt, m, n, U, Krel, precip,
                    fixed, nl_iters, ptr=None, ridx=None, rw=None):
    """One implicit FastScape sweep, base level first (direct-driver order).

    ``order`` lists the nodes so that every node is solved after all of the
    cells it drains into: the D8/FastScape reverse stack order, or (for
    multi-directional routing) simply ascending elevation.

    When the multi-receiver CSR (``ptr``/``ridx``/``rw``) is supplied, the
    downslope elevation used in the incision term is the flow-weighted mean of
    all receiving cells rather than the single steepest one.  Every receiver has
    been updated already (they are all strictly lower), so the sweep stays
    explicit in the receiver and implicit only at the node itself -- the same
    O(n) structure, without the eight-direction quantisation of D8.
    """
    n_nodes = z.shape[0]
    removed = 0.0
    multi = ptr is not None
    for kk in range(n_nodes - 1, -1, -1):
        i = order[kk]
        if fixed[i]:
            continue
        r = rec[i]
        if r == i:
            continue
        Am = area[i] * precip[i]
        h0 = z0[i]
        hr = z[r]
        d = rd[i]
        if multi:
            s = 0.0
            ws = 0.0
            for t in range(ptr[i], ptr[i + 1]):
                zt = z[ridx[t]]
                s += rw[t] * zt
                ws += rw[t]
            if ws > 0.0:
                hr = s / ws
        dz = _solve_node(h0, hr, d, dt, Krel[i], Am ** m if Am > 0.0 else 0.0,
                         m, n, U[i], nl_iters)
        if dz < hr:
            dz = hr
        z[i] = dz
        removed += (h0 - dz)
    return removed


@njit(cache=True)
def dl_sweep(z, z0, rec, rd, order, area, dt, m, n, U, Krel, precip, fixed,
             G, nl_iters, passes, cell_area, Qflux,
             ptr=None, ridx=None, rw=None):
    """Implicit Davy-Lague / Yuan et al. (2019) sweep with Gauss-Seidel passes.

    Qflux[i] carries the sediment volume flux (m^3/yr) delivered from upstream.
    Each Gauss-Seidel pass alternates a downstream-to-upstream solve (heights,
    receiver already updated) with an upstream-to-downstream accumulation of
    the sediment flux built from the updated heights.
    """
    n_nodes = z.shape[0]
    removed = 0.0
    for i in range(n_nodes):
        Qflux[i] = 0.0
    for it in range(passes):
        for i in range(n_nodes):
            Qflux[i] = 0.0
        # 1) accumulate sediment fluxes upstream -> downstream
        for kk in range(n_nodes):
            i = order[kk]
            if fixed[i]:
                continue
            dvi = (U[i] * dt - (z[i] - z0[i])) * cell_area   # volume change (m^3)
            Qflux[i] += dvi
            r = rec[i]
            if r != i:
                Qflux[r] += Qflux[i]
        # 2) solve heights downstream -> upstream using the updated fluxes
        for kk in range(n_nodes - 1, -1, -1):
            i = order[kk]
            if fixed[i]:
                continue
            r = rec[i]
            if r == i:
                continue
            A_i = area[i]
            if A_i <= 0.0:
                continue
            dep = G * Qflux[i] / A_i          # m of deposition this step
            Am = A_i * precip[i]
            h0 = z0[i]
            hr = z[r]
            if ptr is not None:
                s_ = 0.0
                ws_ = 0.0
                for t in range(ptr[i], ptr[i + 1]):
                    s_ += rw[t] * z[ridx[t]]
                    ws_ += rw[t]
                if ws_ > 0.0:
                    hr = s_ / ws_
            # deposition acts as an effective uplift of the local budget
            solve_u = U[i] + dep / dt
            dz = _solve_node(h0, hr, rd[i], dt, Krel[i],
                             Am ** m if Am > 0.0 else 0.0, m, n, solve_u, nl_iters)
            if dz < hr:
                dz = hr
            if it == passes - 1:
                removed += (h0 - dz)
            z[i] = dz
    return removed


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------
def run_fluvial(z: np.ndarray, cell: float, p: FluvialParams,
                progress=None) -> tuple[np.ndarray, FluvialDiag]:
    """Integrate the stream-power / Davy-Lague system in time.

    Parameters
    ----------
    z : (ny, nx) float32 surface elevation (m)
    cell : float, cell size (m)
    p : FluvialParams

    Returns
    -------
    (z_new, diagnostics)
    """
    from .hillslope import diffuse

    ny, nx = z.shape
    z2d = np.ascontiguousarray(z, dtype=np.float64)
    z = z2d.reshape(-1)                      # flat view used by the kernels
    n = ny * nx
    z00 = z.copy()                           # initial surface (mass reference)

    fixed = np.zeros((ny, nx), dtype=np.bool_)
    if p.boundary == "fixed":
        fixed[0, :] = True
        fixed[-1, :] = True
        fixed[:, 0] = True
        fixed[:, -1] = True
    fixed_flat = fixed.reshape(-1)
    base_level = z2d.copy()

    U = np.full(n, float(p.U), dtype=np.float64)
    if p.uplift_field is not None:
        U = np.ascontiguousarray(p.uplift_field, dtype=np.float64).reshape(-1)
    # absolute erodibility field (m^(1-2m)/yr): base K scaled by the material map
    Krel = np.full(n, float(p.K), dtype=np.float64)
    if p.erodibility_field is not None:
        Krel = (np.ascontiguousarray(p.erodibility_field, dtype=np.float64).reshape(-1)
                * float(p.K))
    Precip = np.full(n, float(p.precipitation), dtype=np.float64)
    if p.precip_field is not None:
        Precip = np.ascontiguousarray(p.precip_field, dtype=np.float64).reshape(-1)

    diag = FluvialDiag()
    diag.relief_start = float(z.max() - z.min())
    t = 0.0
    step = 0
    dt = float(p.dt)
    qflux = np.zeros(n, dtype=np.float64)
    dt_since_diffuse = 0.0
    every = max(1, int(p.diffuse_every))
    while t < p.years - 1e-9:
        dt = min(dt, p.years - t)
        if step % max(1, int(p.reroute_every)) == 0:
            # Route on a lightly smoothed copy of the surface.  D8 picks one of
            # eight directions per cell, so on the raw surface a network locks
            # onto the grid axes and carves 45-degree zigzag trenches -- the
            # classic D8 grid-orientation bias.  Routing on a low-pass filtered
            # surface (a standard practical remedy; the *erosion* still uses the
            # true surface) removes the bias while keeping sharp divides.
            if p.route_smooth > 0.0:
                from ..core.grid import gaussian_blur
                zr = gaussian_blur(z2d, p.route_smooth)
            else:
                zr = z2d
            if p.route_mode == "mfd":
                from .flow import route_multi
                r = route_multi(zr, cell, p=p.mfd_p, fill=True, eps_m=1e-5)
                rec = np.ascontiguousarray(r["receiver"], dtype=np.int64).reshape(-1)
                rd = np.ascontiguousarray(r["receiver_dist"], dtype=np.float64).reshape(-1)
                order = np.ascontiguousarray(r["order"], dtype=np.int64)
                area = np.ascontiguousarray(r["area"], dtype=np.float64).reshape(-1)
                ptr = np.ascontiguousarray(r["ptr"], dtype=np.int64)
                ridx = np.ascontiguousarray(r["idx"], dtype=np.int64)
                rw = np.ascontiguousarray(r["wts"], dtype=np.float64)
            else:
                r = route(zr, cell, fill=True, eps_m=1e-5)
                rec = np.ascontiguousarray(r["receiver"], dtype=np.int64).reshape(-1)
                rd = np.ascontiguousarray(r["receiver_dist"], dtype=np.float64).reshape(-1)
                order = np.ascontiguousarray(r["order"], dtype=np.int64)
                area = np.ascontiguousarray(r["area"], dtype=np.float64).reshape(-1)
                ptr = None
                ridx = None
                rw = None
        z0f = z.copy()
        if p.G > 0.0:
            vol = dl_sweep(z, z0f, rec, rd, order, area, dt, p.m, p.n, U, Krel,
                           Precip, fixed_flat, p.G, p.newton_iters, p.dl_iterations,
                           cell * cell, qflux, ptr, ridx, rw)
        else:
            vol = fastscape_sweep(z, z0f, rec, rd, order, area, dt, p.m, p.n, U,
                                  Krel, Precip, fixed_flat, p.newton_iters,
                                  ptr, ridx, rw)
        if p.Kd > 0.0:
            dt_since_diffuse += dt
            if step % every == every - 1 or t + 1e-9 >= p.years:
                zz = diffuse(z2d, cell, p.Kd, dt_since_diffuse, Sc=p.Sc,
                             nonlinear=p.nonlinear_hillslope)
                z[:] = np.ascontiguousarray(zz, dtype=np.float64).reshape(-1)
                dt_since_diffuse = 0.0
        if p.boundary == "fixed":
            if p.base_level_fall > 0.0 and p.base_level_fall_mode == "rate":
                drop = t * p.base_level_fall
                z2d[:, 0] = base_level[:, 0] - drop
                z2d[:, -1] = base_level[:, -1] - drop
                z2d[0, :] = base_level[0, :] - drop
                z2d[-1, :] = base_level[-1, :] - drop
            else:
                z2d[:, 0] = base_level[:, 0]
                z2d[:, -1] = base_level[:, -1]
                z2d[0, :] = base_level[0, :]
                z2d[-1, :] = base_level[-1, :]
        t += dt
        step += 1
        diag.volume_removed += max(0.0, float(vol)) * cell * cell
        if progress is not None:
            progress(step, t / max(p.years, 1e-9))
        if step > 200000:
            break

    zf = z2d.astype(np.float32)
    # net mass balance (uplift input vs export through the open boundaries)
    diag.extra["net_volume_change_m3"] = float(np.sum(z2d.reshape(-1) - z00)) * cell * cell
    diag.extra["uplift_input_m3"] = float(np.sum(U) * t) * cell * cell
    diag.steps = step
    diag.years = t
    diag.relief_end = float(zf.max() - zf.min())
    from ..core.grid import slope_aspect
    sl, _ = slope_aspect(zf, cell)
    diag.mean_slope_deg = float(np.degrees(sl.mean()))
    return zf, diag


# --------------------------------------------------------------------------
# geomorphic diagnostics (used by the UI and by the validation tests)
# --------------------------------------------------------------------------
def slope_area_analysis(z: np.ndarray, cell: float, n_bins: int = 12,
                        min_area_cells: int = 32, m_over_n: float = 0.45):
    """Slope-area regression (Flint 1974; Willgoose et al. 1991).

    In topographic steady state the stream-power law predicts
        S = (U/K)^(1/n) A^(-m/n)
    so the log-log slope-area exponent should equal -m/n.  Returns the fitted
    concavity index theta = m/n and the channel steepness index ksn
    (Wobus et al. 2006, *GSA Today*).
    """
    r = route(z, cell)
    area = r["area"].ravel()
    A = np.maximum(area, cell * cell)
    gx = np.gradient(z.astype(np.float64), cell, axis=1).ravel()
    gy = np.gradient(z.astype(np.float64), cell, axis=0).ravel()
    S = np.hypot(gx, gy)
    m = (A >= min_area_cells * cell * cell) & (S > 1e-6)
    if m.sum() < n_bins * 4:
        return dict(theta=np.nan, ksn=np.nan, n=int(m.sum()), r2=np.nan)
    la = np.log10(A[m])
    ls = np.log10(S[m])
    # robust-ish binned fit
    edges = np.linspace(la.min(), la.max(), n_bins + 1)
    idx = np.digitize(la, edges)
    bx, by = [], []
    for b in range(1, n_bins + 1):
        sel = idx == b
        if sel.sum() > 3:
            bx.append(la[sel].mean())
            by.append(ls[sel].mean())
    bx = np.array(bx)
    by = np.array(by)
    if len(bx) < 3:
        return dict(theta=np.nan, ksn=np.nan, n=int(m.sum()), r2=np.nan)
    slope, intercept = np.polyfit(bx, by, 1)
    pred = slope * bx + intercept
    ss_res = ((by - pred) ** 2).sum()
    ss_tot = ((by - by.mean()) ** 2).sum()
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else np.nan
    ksn = 10.0 ** (by.mean() + m_over_n * bx.mean()) if len(by) else np.nan
    return dict(theta=float(-slope), ksn=float(ksn), n=int(m.sum()), r2=float(r2),
                area=float(np.exp(bx.mean())), a_bins=bx, s_bins=by)
