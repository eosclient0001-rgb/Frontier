"""Hillslope (slope-dependent) transport laws.

Linear diffusion
    dz/dt = D grad^2 z                                   (Culling 1960; Nash 1980)
Non-linear critical-slope transport
    q = -D grad z / (1 - (|grad z| / Sc)^2)              (Roering et al. 1999,
                                                          JGR 104, 17659-17678)
Soil production / bedrock lowering
    P = P0 exp(-h / h*)                                   (Heimsath et al. 1997,
                                                          Nature 388, 358-361)

Numerics
-------
The explicit scheme is limited by dt <= cell^2 / (4 D), which for realistic
D = 1e-3 m^2/yr on a 30 m grid is ~1.7e5 yr -- workable, but the non-linear law
blows the effective diffusivity up by 1/(1-(S/Sc)^2) and an adaptive explicit
scheme degrades to thousands of tiny sub-steps on steep terrain.

We therefore integrate the hillslope term with **backward Euler solved by
matrix-free preconditioned conjugate gradients**, which is unconditionally
stable, so the time step is chosen by accuracy alone.  The non-linearity is
handled by Picard iteration: the effective face diffusivity
D_eff = D / (1 - (S/Sc)^2) is frozen from the previous iterate and the linear
system re-solved (2 outer iterations by default).  This is the same
strategy used for the non-linear stream-power term in FastScape (Braun &
Willett 2013), applied to the hillslope operator.

The singularity at S = Sc is a genuine feature of the law (transport goes to
infinity).  In nature slopes stop at Sc because mass wasting takes over, so we
regularise the singularity by capping the effective diffusivity at
``D_cap`` (default 25 D) and rely on the thermal/talus pass
(``thermal_relax``) to enforce the repose angle.  ``Sc = 1.0`` corresponds to
45 degrees; field-calibrated values are 0.8-1.2.
"""
from __future__ import annotations

import numpy as np
from numba import njit


# --------------------------------------------------------------------------
# explicit kernels (kept for validation and for flux diagnostics)
# --------------------------------------------------------------------------
@njit(cache=True)
def _fluxes(z, cell, D, Sc, nonlinear, out_qx, out_qy):
    """Cell-face sediment fluxes (m^2/yr) for a slope-dependent law."""
    ny, nx = z.shape
    linv = 1.0 / cell
    for j in range(ny):
        for i in range(nx - 1):
            g = (z[j, i + 1] - z[j, i]) * linv
            if nonlinear:
                gx = g
                if j > 0 and j < ny - 1:
                    gy = 0.25 * (z[j + 1, i + 1] - z[j - 1, i + 1]
                                 + z[j + 1, i] - z[j - 1, i]) * linv
                elif j == 0:
                    gy = 0.5 * (z[j + 1, i + 1] - z[j, i + 1]
                                + z[j + 1, i] - z[j, i]) * linv
                else:
                    gy = 0.5 * (z[j, i + 1] - z[j - 1, i + 1]
                                + z[j, i] - z[j - 1, i]) * linv
                smag = np.sqrt(gx * gx + gy * gy)
                r = smag / Sc
                den = 1.0 - r * r
                if den < 1e-3:
                    den = 1e-3
                out_qx[j, i] = -D * g / den
            else:
                out_qx[j, i] = -D * g
    for j in range(ny - 1):
        for i in range(nx):
            g = (z[j + 1, i] - z[j, i]) * linv
            if nonlinear:
                gy = g
                if i > 0 and i < nx - 1:
                    gx = 0.25 * (z[j + 1, i + 1] - z[j + 1, i - 1]
                                 + z[j, i + 1] - z[j, i - 1]) * linv
                elif i == 0:
                    gx = 0.5 * (z[j + 1, i + 1] - z[j + 1, i]
                                + z[j, i + 1] - z[j, i]) * linv
                else:
                    gx = 0.5 * (z[j + 1, i] - z[j + 1, i - 1]
                                + z[j, i] - z[j, i - 1]) * linv
                smag = np.sqrt(gx * gx + gy * gy)
                r = smag / Sc
                den = 1.0 - r * r
                if den < 1e-3:
                    den = 1e-3
                out_qy[j, i] = -D * g / den
            else:
                out_qy[j, i] = -D * g


@njit(cache=True)
def _divergence(qx, qy, cell, out):
    ny, nx = qx.shape
    inv = 1.0 / cell
    for j in range(ny):
        for i in range(nx):
            qxr = qx[j, i] if i < nx - 1 else 0.0
            qxl = qx[j, i - 1] if i > 0 else 0.0
            qyt = qy[j, i] if j < ny - 1 else 0.0
            qyb = qy[j - 1, i] if j > 0 else 0.0
            out[j, i] = (qxr - qxl + qyt - qyb) * inv


# --------------------------------------------------------------------------
# implicit solver
# --------------------------------------------------------------------------
@njit(cache=True)
def _fill_faces(z, cell, D, Sc, nonlinear, Dcap, Dfield, de, dn):
    """Fill the east-face (``de``) and north-face (``dn``) effective
    diffusivities from the current surface.

    The Roering non-linearity is applied face-wise,
        D_eff = D / max(1 - (d z / d n / Sc)^2, 1/D_cap),
    which is the finite-volume form of q = -D grad z / (1 - (|grad z|/Sc)^2)
    sampled on the face normal.  ``D_cap`` bounds the S -> Sc singularity.
    Outer faces keep a zero coefficient => natural no-flux boundaries.
    """
    ny, nx = z.shape
    linv = 1.0 / cell
    for j in range(ny):
        for i in range(nx):
            Dc = D if Dfield is None else Dfield[j, i]
            if i < nx - 1:
                Dn = Dc if Dfield is None else 0.5 * (Dc + Dfield[j, i + 1])
                if nonlinear:
                    g = (z[j, i + 1] - z[j, i]) * linv
                    Dn = Dn / max(1.0 - (g / Sc) ** 2, 1.0 / Dcap)
                de[j, i] = Dn
            else:
                de[j, i] = 0.0
            if j < ny - 1:
                Dn2 = Dc if Dfield is None else 0.5 * (Dc + Dfield[j + 1, i])
                if nonlinear:
                    g = (z[j + 1, i] - z[j, i]) * linv
                    Dn2 = Dn2 / max(1.0 - (g / Sc) ** 2, 1.0 / Dcap)
                dn[j, i] = Dn2
            else:
                dn[j, i] = 0.0


@njit(cache=True)
def _thomas(lo, di, up, rhs, out, n, cw):
    """Solve a tridiagonal system (Thomas algorithm).  ``cw`` is scratch."""
    # forward elimination
    cw[0] = up[0] / di[0]
    out[0] = rhs[0] / di[0]
    for i in range(1, n):
        m = di[i] - lo[i] * cw[i - 1]
        cw[i] = up[i] / m
        out[i] = (rhs[i] - lo[i] * out[i - 1]) / m
    for i in range(n - 2, -1, -1):
        out[i] -= cw[i] * out[i + 1]


@njit(cache=True)
def _adi_step(z, de, dn, dt_c2, lo, di, up, rhs, tmp, col, cw):
    """One Peaceman-Rachford ADI step for (I - dt L) z_new = z_old.

    ``dt_c2`` = dt / cell^2.  ``de``/``dn`` are the frozen east/north face
    diffusivities (zero on the outer boundary faces => natural Neumann BC).
    Lx and Ly are applied with the tridiagonal (Thomas) direct solve, so the
    step is unconditionally stable and costs O(N).
    """
    ny, nx = z.shape
    h = 0.5 * dt_c2
    # ---- implicit in x: (I - h Lx) tmp = (I + h Ly) z
    for j in range(ny):
        for i in range(nx):
            s = 0.0
            if j < ny - 1:
                s += dn[j, i] * (z[j + 1, i] - z[j, i])
            if j > 0:
                s += dn[j - 1, i] * (z[j - 1, i] - z[j, i])
            rhs[i] = z[j, i] + h * s
        for i in range(nx):
            e = de[j, i]
            w = de[j, i - 1] if i > 0 else 0.0
            lo[i] = -h * w
            up[i] = -h * e
            di[i] = 1.0 + h * (w + e)
        _thomas(lo, di, up, rhs, tmp[j], nx, cw)
    # ---- implicit in y: (I - h Ly) z = (I + h Lx) tmp
    for i in range(nx):
        for j in range(ny):
            s = 0.0
            if i < nx - 1:
                s += de[j, i] * (tmp[j, i + 1] - tmp[j, i])
            if i > 0:
                s += de[j, i - 1] * (tmp[j, i - 1] - tmp[j, i])
            rhs[j] = tmp[j, i] + h * s
        for j in range(ny):
            nflux = dn[j, i]
            sflux = dn[j - 1, i] if j > 0 else 0.0
            lo[j] = -h * sflux
            up[j] = -h * nflux
            di[j] = 1.0 + h * (sflux + nflux)
        _thomas(lo, di, up, rhs, col, ny, cw)
        for j in range(ny):
            z[j, i] = col[j]


def diffuse(z: np.ndarray, cell: float, D: float, years: float,
            Sc: float = 1.0, nonlinear: bool = False,
            max_change: float = 0.25, D_field: np.ndarray | None = None,
            scheme: str = "adi", picard: int = 2,
            substeps: int = 0, D_cap: float = 25.0,
            tol: float = 1e-6, maxit: int = 400) -> np.ndarray:
    """Integrate slope-dependent hillslope transport for ``years``.

    Parameters
    ----------
    D : float
        diffusivity (m^2/yr).  Soil-mantled hillslopes: 1e-4 .. 1e-2;
        bare/rocky scree slopes and arid settings: 1e-4 .. 1e-3.
    Sc : float
        critical slope (gradient) for the Roering non-linearity; field values
        cluster around 0.8-1.2 (39-50 degrees).
    nonlinear : bool
        Roering et al. (1999) flux law instead of linear diffusion.
    scheme : 'adi' | 'explicit'
        'explicit' is kept for validation against analytic solutions.
    picard : int
        outer iterations for the non-linear coefficient.
    substeps : int
        override the automatic sub-step count (0 = automatic, based on the
        diffusion number so the time integration stays accurate).
    D_cap : float
        ceiling on the effective diffusivity as a multiple of D; regularises
        the S -> Sc singularity (mass wasting is handled by thermal_relax).
    """
    # NOTE: always work on a fresh copy -- the ADI half-steps write in place,
    # so the caller's array must never be aliased here.
    z = np.array(z, dtype=np.float64, copy=True, order="C")
    ny, nx = z.shape
    Sc = max(Sc, 1e-3)
    years = float(years)
    if years <= 0.0 or D <= 0.0:
        return z.astype(np.float32)
    inv_c2 = 1.0 / (cell * cell)
    Dfield = None if D_field is None else np.ascontiguousarray(D_field, dtype=np.float64)

    if scheme == "explicit":
        return _explicit(z, cell, D, years, Sc, nonlinear, max_change, Dfield)

    # ---- ADI (backward Euler, factorised) with frozen coefficients --------
    de = np.empty((ny, nx), dtype=np.float64)
    dn = np.empty((ny, nx), dtype=np.float64)
    row = np.empty(max(nx, ny), dtype=np.float64)
    lo = np.empty(max(nx, ny), dtype=np.float64)
    di = np.empty(max(nx, ny), dtype=np.float64)
    up = np.empty(max(nx, ny), dtype=np.float64)
    tmp = np.empty((ny, nx), dtype=np.float64)
    col = np.empty(ny, dtype=np.float64)
    cw = np.empty(max(nx, ny), dtype=np.float64)

    if substeps <= 0:
        # accuracy only: keep the diffusive change of the finest resolvable
        # structure (wavelength 2 cell) below ~1/4 of the grid scale
        Dmax = D if Dfield is None else float(max(D, Dfield.max()))
        eff = Dmax * (D_cap if nonlinear else 1.0)
        frac = 0.25
        substeps = int(np.ceil(years * eff / (frac * cell * cell)))
        substeps = int(max(1, min(substeps, 512)))
    dt = years / substeps
    dt_c2 = dt * inv_c2

    for _s in range(substeps):
        _fill_faces(z, cell, D, Sc, nonlinear, D_cap, Dfield, de, dn)
        if nonlinear:
            # Picard: refresh the effective diffusivity from the trial solution
            zn = z.copy()
            for _k in range(max(1, picard)):
                _adi_step(zn, de, dn, dt_c2, lo, di, up, row, tmp, col, cw)
                if _k < picard - 1:
                    _fill_faces(zn, cell, D, Sc, nonlinear, D_cap, Dfield, de, dn)
            z = zn
        else:
            _adi_step(z, de, dn, dt_c2, lo, di, up, row, tmp, col, cw)
    return z.astype(np.float32)


def _explicit(z, cell, D, years, Sc, nonlinear, max_change, Dfield):
    """Explicit reference integrator (validation only)."""
    zz = np.array(z, dtype=np.float64, copy=True, order="C")
    ny, nx = zz.shape
    qx = np.empty((ny, nx - 1), dtype=np.float64)
    qy = np.empty((ny - 1, nx), dtype=np.float64)
    div = np.empty((ny, nx), dtype=np.float64)
    Deff = D * (1.0 / 1e-3 if nonlinear else 1.0)
    dt_cfl = 0.2 * cell * cell / max(4.0 * Deff, 1e-12)
    if Dfield is not None:
        dt_cfl = 0.2 * cell * cell / max(4.0 * float(np.max(Dfield)), 1e-12)
    n_sub = int(max(1, min(int(np.ceil(years / dt_cfl)), 4000)))
    dt = years / n_sub
    remaining = years
    it = 0
    while remaining > 1e-12 and it < 40000:
        step = min(dt, remaining)
        _fluxes(zz, cell, D, Sc, nonlinear, qx, qy)
        _divergence(qx, qy, cell, div)
        worst = 0.0
        for j in range(ny):
            for i in range(nx):
                d = div[j, i] * step
                zz[j, i] -= d
                ad = abs(d)
                if ad > worst:
                    worst = ad
        remaining -= step
        it += 1
        if worst > max_change and remaining > 1e-12:
            dt *= 0.5
            remaining += step
        elif max_change > 0 and worst < 0.15 * max_change and dt < years / 8.0:
            dt *= 1.5
    return zz.astype(np.float32)


# --------------------------------------------------------------------------
# soil production
# --------------------------------------------------------------------------
@njit(cache=True)
def _soil_production_kernel(z_rock, z_sed, P0, h_star, dt):
    """Heimsath et al. (1997) exponential soil production function.

    Bedrock is converted to mobile soil at a rate P(h) = P0 exp(-h/h*).
    Returns the volume of rock converted (m^3) for mass-budget bookkeeping.
    """
    ny, nx = z_rock.shape
    vol = 0.0
    for j in range(ny):
        for i in range(nx):
            h = z_sed[j, i]
            p = P0 * np.exp(-h / max(h_star, 1e-6)) * dt
            z_rock[j, i] -= p
            z_sed[j, i] += p
            vol += p
    return vol


def soil_production(t_rock, t_sed, P0: float, h_star: float, years: float) -> float:
    """Add soil at the bedrock interface; returns rock volume converted (m^3)."""
    dt_cfl = max(1.0, min(years, 1.0 / max(P0, 1e-12) * 0.1 if P0 > 0 else years))
    n = int(np.ceil(years / dt_cfl))
    vol = 0.0
    dt = years / n
    for _ in range(n):
        vol += _soil_production_kernel(t_rock.z_rock, t_sed.z_sed, P0, h_star, dt)
    return vol
