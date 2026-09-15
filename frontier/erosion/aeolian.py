"""Aeolian (wind) sand transport for the "sandy" half of the terrain.

This is the Kroy-Sauermann-Herrmann dune model, implemented from the primary
papers:

* Sauermann, Kroy & Herrmann (2001), "A continuum saltation model for sand
  dunes", *Phys. Rev. E* 64, 031305.
* Kroy, Sauermann & Herrmann (2002), "Minimal model for aeolian sand dunes",
  *Phys. Rev. E* 66, 031302 (and the PRL 88, 054301 summary).
* Parteli, Duran, ... / Durán & Herrmann for the barchan/transverse scaling.

Ingredient 1 - the wind shear stress perturbation over topography is computed in
Fourier space with the KSH first-order solution (Jackson-Hunt / Weng et al. type
transfer function, as used by the Coastal Dune Model, Duna and AeoLiS):

    sigma = sqrt(i * (L/4) * kx * z0 / l)
    tau_x = h~ * kx^2/k * [ -1 + (2 ln(l/z0) + k^2/kx^2) * sigma * K1(2 sigma)/K0(2 sigma) ]
    tau_y = h~ * kx*ky/k * 2 sqrt(2) sigma * K1(2 sqrt(2) sigma)

applied as tau_total = |tau0| (tau_hat0 + delta_tau_hat).  Flow separation in the
lee of a brink is added heuristically (Kroy et al. 2002, sect. III.3): inside the
separation bubble tau = 0 and it recovers linearly over 4 bubble lengths.

Ingredient 2 - the sand flux obeys the saturation-length relaxation

    l_s * dq/dx = q (1 - q/q_s),     q_s ~ tau^{3/2},   l_s ~ l_sat ~ 50 cm

solved implicitly along the wind direction (the integrated form is used, so the
scheme is unconditionally stable and the flux never overshoots saturation).

Ingredient 3 - mass conservation with limiter: dh/dt = -(1/rho_s) dq/dx, the
result is relaxed to the angle of repose (slip faces form at 32-35 degrees) and
the sand is carried as a separate layer so that bedrock is not deflated and the
satmap can tell sand from rock.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np
from numba import njit

try:
    from scipy.special import kv as _bessel_kv
    _HAVE_SCIPY = True
except Exception:  # pragma: no cover
    _HAVE_SCIPY = False


RHO_AIR = 1.225          # kg/m^3
RHO_SAND = 2650.0        # kg/m^3 (quartz)
G = 9.81


@dataclass
class AeolianParams:
    wind_speed: float = 12.0        # m/s at the reference height
    wind_dir_deg: float = 270.0     # direction the wind blows TOWARDS
    z_ref: float = 10.0             # reference height for wind_speed (m)
    z0: float = 0.001               # aerodynamic roughness (m) (AeoLiS default)
    inner_layer: float = 10.0       # l: inner-layer height (m) (AeoLiS default)
    hill_length: float = 100.0      # L: typical hill length scale (m)
    grain_size: float = 0.00025     # d (m) ~ fine-medium sand
    iterations: int = 60
    dt: float = 3600.0 * 6.0        # seconds per iteration
    saturation_length: float = 0.5  # m, l_sat (Andreotti/Parteli ~ 50 cm)
    alpha_khs: float = 0.43         # KSH empirical parameter
    gamma_khs: float = 0.2
    Cb: float = 1.5                 # Bagnold constant for the saturated flux
    creep_factor: float = 0.15      # extra flux from surface creep
    moisture: float = 0.0           # 0..1 raises the threshold (wet sand)
    vegetation: Optional[np.ndarray] = None    # 0..1 reduces availability
    sand_source: Optional[np.ndarray] = None   # m of sand supplied per step
    bedrock_only: bool = True       # never deflate below the sand layer
    separation_bubble: bool = True
    repose_deg: float = 33.0
    avalanche_iters: int = 8
    avalanche_weight: float = 0.5
    filter_highfreq: bool = True
    progress_cb = None


# --------------------------------------------------------------------------
# KSH shear stress perturbation
# --------------------------------------------------------------------------
def ksh_shear_perturbation(z: np.ndarray, cell: float, p: AeolianParams):
    """Return (dtau_x, dtau_y): *relative* shear stress perturbations.

    Zhou/Jackson-Hunt style first-order solution in Fourier space.  The spectrum
    is tapered at the grid scale (features that a linear theory cannot represent
    are removed, as in AeoLiS), and the kx = 0 column is handled separately.
    """
    ny, nx = z.shape
    zf = np.asarray(z, dtype=np.float64)
    zf = zf - zf.mean()
    if not _HAVE_SCIPY:
        return np.zeros_like(zf, dtype=np.float32), np.zeros_like(zf, dtype=np.float32)
    kx = 2.0 * np.pi * np.fft.fftfreq(nx, cell)
    ky = 2.0 * np.pi * np.fft.fftfreq(ny, cell)
    KX, KY = np.meshgrid(kx, ky)
    k = np.hypot(KX, KY)
    hs = np.fft.fft2(zf)
    if p.filter_highfreq:
        # logistic taper between 2 and 4 cells wavelength (no aliasing of
        # sub-grid topography into the shear field)
        lam = 2.0 * np.pi / np.maximum(k, 1e-12)
        f = 1.0 / (1.0 + np.exp(-(lam / cell - 3.0) / 0.5))
        hs = hs * f
    sigma = np.sqrt(1j * (p.hill_length / 4.0) * KX * p.z0 / p.inner_layer)
    safe_k = np.where(k < 1e-12, 1e-12, k)
    safe_kx = np.where(np.abs(KX) < 1e-12, 1e-12, KX)
    with np.errstate(all="ignore"):
        ratio = _bessel_kv(1, 2 * sigma) / _bessel_kv(0, 2 * sigma)
        dtaux = hs * (KX ** 2) / safe_k * (
            -1.0 + (2.0 * np.log(p.inner_layer / p.z0) + k ** 2 / safe_kx ** 2)
            * sigma * ratio)
        dtauy = hs * KX * KY / safe_k * 2.0 * np.sqrt(2.0) * sigma * _bessel_kv(
            1, 2 * np.sqrt(2.0) * sigma)
    dtaux = np.real(np.fft.ifft2(np.nan_to_num(dtaux)))
    dtauy = np.real(np.fft.ifft2(np.nan_to_num(dtauy)))
    # drop the k=0 (uniform) component: it is the undisturbed wind, not a perturbation
    dtaux = dtaux - dtaux.mean()
    dtauy = dtauy - dtauy.mean()
    return dtaux.astype(np.float32), dtauy.astype(np.float32)


def rotate_grid(a: np.ndarray, angle_deg: float, order: int = 1,
                fill_value: float = 0.0) -> np.ndarray:
    """Rotate a grid (bilinear or nearest) so the wind blows along +x."""
    if abs(angle_deg % 360.0) < 1e-6:
        return a.astype(np.float32)
    try:
        from scipy import ndimage as ndi
        return ndi.rotate(a.astype(np.float32), -angle_deg, reshape=False,
                          order=order, mode="nearest").astype(np.float32)
    except Exception:
        return a.astype(np.float32)


def wind_shear_field(z: np.ndarray, cell: float, p: AeolianParams):
    """Total shear velocity u* (m/s) with the KSH perturbation and separation."""
    dtaux, dtauy = ksh_shear_perturbation(z, cell, p)
    udir = np.radians(p.wind_dir_deg)
    # undisturbed shear velocity from the law of the wall (AeoLiS wind.py)
    ustar0 = 0.41 / np.log(p.z_ref / p.z0) * p.wind_speed
    tau0 = RHO_AIR * ustar0 * ustar0
    # KSH perturbations are given in the wind-aligned frame
    dt_along = dtaux * np.cos(udir) + dtauy * np.sin(udir)
    tau = tau0 * (1.0 + dt_along)
    if p.separation_bubble:
        tau = _apply_separation(z, cell, tau, udir)
    tau = np.maximum(tau, 0.0)
    return np.sqrt(tau / RHO_AIR).astype(np.float32), tau.astype(np.float32)


@njit(cache=True)
def _apply_separation(z, cell, tau, udir):
    """Kroy et al. (2002) heuristic separation bubble.

    Downwind of a brink (a point where the lee slope exceeds ~14 degrees) the
    shear stress is zero until the flow reattaches; recovery is linear over four
    bubble lengths.
    """
    ny, nx = z.shape
    tan14 = np.tan(np.radians(14.0))
    out = tau.copy()
    # walk along the wind direction with a DDA ray
    dx = np.cos(udir)
    dy = -np.sin(udir)      # image y grows southwards
    steps = int((nx + ny) * 1.5)
    for j0 in range(0, ny, max(1, ny // 48)):
        for i0 in range(0, nx, max(1, nx // 48)):
            x = i0 + 0.0
            y = j0 + 0.0
            in_bubble = False
            bubble_len = 0.0
            travelled = 0.0
            for s in range(steps):
                i = int(x)
                j = int(y)
                if i < 0 or i >= nx or j < 0 or j >= ny:
                    break
                x += dx
                y += dy
                travelled += cell
                if not in_bubble:
                    # brink test: downwind slope steeper than 14 degrees
                    ip = int(i + dx * 1.5)
                    jp = int(j + dy * 1.5)
                    if ip < 0 or ip >= nx or jp < 0 or jp >= ny:
                        continue
                    drop = z[j, i] - z[jp, ip]
                    hdist = cell * 1.5
                    if drop > tan14 * hdist:
                        in_bubble = True
                        bubble_len = 0.0
                        out[j, i] = 0.0
                else:
                    bubble_len += cell
                    out[j, i] = 0.0
                    # reattachment: the separation streamline is 14 degrees down
                    # from the brink; when the ground rises above it, flow
                    # reattaches and tau recovers over 4 bubble lengths
                    zsep = z[j0, i0] - tan14 * bubble_len
                    if z[j, i] > zsep and bubble_len > 2.0 * cell:
                        in_bubble = False
                        recover = 4.0 * bubble_len
                        # linear recovery handled by the loop below
                        for k2 in range(1, 40):
                            xx = x + dx * k2 * 3.0
                            yy = y + dy * k2 * 3.0
                            ii = int(xx)
                            jj = int(yy)
                            if ii < 0 or ii >= nx or jj < 0 or jj >= ny:
                                break
                            f = min(1.0, (k2 * 3.0 * cell) / max(recover, 1e-6))
                            out[jj, ii] = out[jj, ii] * f
    return out


# --------------------------------------------------------------------------
# saturated flux + saturation length (KSH / Sauermann et al. 2001)
# --------------------------------------------------------------------------
@njit(cache=True)
def _saturated_flux(ustar, ustar_t, p_Cb, creep):
    """Saturated sand flux q_s (kg/m/s): Bagnold/Lettau form with the threshold.

    q_s = Cb * rho_a/g * (u*^2 - u*t^2) * u*^2 / u*  ->  the standard Bagnold
    cubic law is recovered for u* >> u*t.
    """
    q = np.zeros_like(ustar)
    for j in range(ustar.shape[0]):
        for i in range(ustar.shape[1]):
            u = ustar[j, i]
            ut = ustar_t[j, i]
            if u <= ut:
                q[j, i] = 0.0
            else:
                q[j, i] = (p_Cb * RHO_AIR / G) * (u * u - ut * ut) * u * (1.0 + creep)
    return q


def threshold_shear_velocity(p: AeolianParams) -> float:
    """Bagnold-style fluid threshold: u*t = A sqrt((rho_s - rho_a)/rho_a * g * d)."""
    A = 0.1
    u_t = A * np.sqrt((RHO_SAND - RHO_AIR) / RHO_AIR * G * p.grain_size)
    return float(u_t * (1.0 + 2.0 * p.moisture))


@njit(cache=True)
def _flux_saturation_1d(qs, q_prev, dx, ls, ls_min):
    """Solve ls dq/dx = q(1 - q/qs) along one row (implicit, monotone).

    Integrated form: q_new = qs / (1 + (qs/q_prev - 1) exp(-dx/ls)); this is the
    standard saturation-length update of the KSH model and it cannot overshoot
    qs, which is what keeps the dunes' flux bounded.
    """
    n = qs.shape[0]
    q = np.zeros(n)
    for i in range(n):
        s = qs[i]
        if s <= 0.0:
            q[i] = 0.0
            continue
        if i == 0:
            q[i] = s
            continue
        qp = q[i - 1]
        l = ls if ls > ls_min else ls_min
        if qp <= 1e-12:
            q[i] = s * (1.0 - np.exp(-dx / l))
        else:
            e = np.exp(-dx / l)
            q[i] = s / (1.0 + (s / qp - 1.0) * e)
    return q


@njit(cache=True)
def _avalanche(sand, b, cell, tan_repose, iters, weight):
    """Slip-face formation: relax the sand surface to the angle of repose."""
    ny, nx = sand.shape
    for _ in range(iters):
        for j in range(ny):
            for i in range(nx):
                h = b[j, i] + sand[j, i]
                for di, dj, dist in ((1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0),
                                     (0, -1, 1.0), (1, 1, 1.41421356), (-1, -1, 1.41421356),
                                     (1, -1, 1.41421356), (-1, 1, 1.41421356)):
                    ii = i + di
                    jj = j + dj
                    if ii < 0 or ii >= nx or jj < 0 or jj >= ny:
                        continue
                    h2 = b[jj, ii] + sand[jj, ii]
                    dh = h - h2
                    lim = tan_repose * cell * dist
                    if dh > lim:
                        move = (dh - lim) * 0.5 * weight
                        if move > sand[j, i]:
                            move = sand[j, i]
                        sand[j, i] -= move
                        sand[jj, ii] += move


def erode_aeolian(z_rock: np.ndarray, z_sed: np.ndarray, cell: float,
                  p: AeolianParams):
    """Run the KSH dune model; modifies z_sed (and slightly z_rock at deflation)."""
    ny, nx = z_rock.shape
    b = np.ascontiguousarray(z_rock, dtype=np.float32).copy()
    sand = np.ascontiguousarray(z_sed, dtype=np.float32).copy()
    if p.sand_source is not None:
        sand += np.ascontiguousarray(p.sand_source, dtype=np.float32)
    ustar_t = threshold_shear_velocity(p)
    total_flux = 0.0
    for it in range(p.iterations):
        h = b + sand
        # wind-aligned computation: rotate so the wind blows along +x
        ang = (p.wind_dir_deg + 90.0) % 360.0
        hr = rotate_grid(h, ang)
        ustar = wind_shear_field(hr, cell, p)[0]
        # threshold modulation by moisture and vegetation (availability)
        ut = np.full_like(ustar, ustar_t)
        if p.vegetation is not None:
            veg = rotate_grid(p.vegetation.astype(np.float32), ang)
            ut = ut + ustar_t * 1.5 * np.clip(veg, 0.0, 1.0)
        qs = _saturated_flux(ustar.astype(np.float64), ut.astype(np.float64),
                             p.Cb, p.creep_factor)
        # saturation transients along the wind direction
        q = np.zeros_like(qs)
        for j in range(ny):
            q[j, :] = _flux_saturation_1d(qs[j, :], qs[j, :], cell,
                                          p.saturation_length, cell * 0.25)
        # mass conservation: dh/dt = -(1/rho_s) dq/dx   (q in kg/m/s -> m/s)
        div = np.zeros_like(q)
        div[:, 1:-1] = (q[:, 2:] - q[:, :-2]) / (2.0 * cell)
        div[:, 0] = (q[:, 1] - q[:, 0]) / cell
        div[:, -1] = (q[:, -1] - q[:, -2]) / cell
        dh = -div / RHO_SAND * p.dt
        # rotate the height change back to the world frame
        dhr = rotate_grid(dh.astype(np.float32), -ang)
        if p.bedrock_only:
            deflate = np.minimum(dhr, 0.0)     # erosion
            deposit = np.maximum(dhr, 0.0)
            take = np.minimum(sand, -deflate)
            sand += deflate + take             # can't deflate below bedrock
            sand = np.maximum(sand, 0.0)
            sand += deposit
        else:
            sand = np.maximum(sand + dhr, 0.0)
        _avalanche(sand, b, cell, float(np.tan(np.radians(p.repose_deg))),
                   p.avalanche_iters, p.avalanche_weight)
        total_flux += float(np.abs(q).mean())
        if p.progress_cb is not None and (it % max(1, p.iterations // 10) == 0):
            p.progress_cb(it, p.iterations)
    z_sed[:] = sand
    return dict(mean_flux=total_flux / max(p.iterations, 1),
                ustar_t=ustar_t,
                sand_volume=float(sand.sum()) * cell * cell,
                sand_depth_max=float(sand.max()))
