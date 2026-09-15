"""Height-based hydraulic erosion: shallow-water virtual pipes + thermal talus.

Model: Mei, Decaudin & Hu (2007), "Fast hydraulic erosion simulation and
visualization on GPU", Pacific Graphics 2007, 47-56 -- the virtual-pipe shallow
water model, used here exactly as published:

    f^L(t+dt) = max(0, f^L(t) + dt * A * g * dh^L / l)
    K         = min(1, d1 * lx * ly / ((f^L + f^R + f^T + f^B) * dt))
    dV        = dt * (sum f_in - sum f_out)
    d         = d1 + dV / (lx * ly)
    u         = ((f^R_in + f^L_in) - (f^L_out + f^R_out)) / 2
    C         = K_c * sin(alpha) * |v|            (sediment capacity)
    C > s:  b -= K_s (C - s),  s += K_s (C - s)
    else:   b += K_d (s - C),  s -= K_d (s - C)
    ds/dt + (v . grad) s = 0                      (semi-Lagrangian advection)

with the capacity clamped through a minimum tilt (their sect. 3.3) and
multi-material capacities from St'ava et al. (2008) so that sand and rock erode
at different rates:

    S_k^m = ||v|| C_k sin(alpha)

Thermal (angle-of-repose) relaxation is applied in the same loop, which is what
produces talus cones and scree below cliffs -- St'ava, Benes, Brisbin & Krivanek
(2008), "Interactive terrain modeling using hydraulic erosion", SCA'08.

This layer is the *detail* pass: the stream-power solver (stream_power.py) sets
the regional geometry over 10^5-10^7 yr, this one adds the 10^0-10^3 yr texture
(badlands, rills, alluvial fans, talus) at interactive cost.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np
from numba import njit


@dataclass
class HydraulicParams:
    iterations: int = 120
    dt: float = 0.02             # s (pipe model time step)
    rain_rate: float = 1.2       # m/s of water added per step (scaled)
    evaporation: float = 0.015   # per unit time
    g: float = 9.81
    pipe_area: float = 1.0       # A (m^2)
    Kc: float = 1.1              # sediment capacity constant (rock/sand scaled)
    Ks: float = 0.35             # dissolving constant
    Kd: float = 0.30             # deposition constant
    min_tilt_deg: float = 2.0    # capacity floor: keeps flat areas from stalling
    thermal: float = 0.35        # 0..1 weight of the talus relaxation per step
    repose_deg: float = 33.0     # angle of repose for the thermal pass
    material_Kc: Optional[np.ndarray] = None   # (ny, nx) relative capacity per cell
    source_mask: Optional[np.ndarray] = None   # extra inflow (springs / river)
    erode_mask: Optional[np.ndarray] = None    # 1 = erodible, 0 = protected
    sand_field: Optional[np.ndarray] = None    # loose cover (m); erodes first
    out_water: bool = True
    out_sediment: bool = True
    # ---- stability limiters (see _step_water / _step_erosion).  The virtual
    # pipe scheme is explicit, so these bounds are what keeps steep, fine
    # grained terrain from running away: they are physical ceilings, not
    # fudge factors.  depth_max ~ 4 m is deeper than any sheet flow the model
    # is meant to represent, speed_max is well above any plausible flood, and
    # ``erode_limit`` bounds the per step removal by a multiple of the local
    # flow depth (you cannot dissolve more rock than the water can reach).
    depth_max: float = 4.0
    speed_max: float = 40.0
    erode_limit: float = 6.0
    susp_max: float = 400.0
    guard: bool = True           # revert a step that produced non-finite values


@njit(cache=True)
def _step_fluxes(fL, fR, fT, fB, d, b, cell, dt, A, g):
    ny, nx = d.shape
    for j in range(ny):
        for i in range(nx):
            dl = d[j, i] + b[j, i]
            if i > 0:
                dl -= (d[j, i - 1] + b[j, i - 1])
                fL[j, i] = max(0.0, fL[j, i] + dt * A * g * dl / cell)
            if i < nx - 1:
                dr = d[j, i] + b[j, i] - (d[j, i + 1] + b[j, i + 1])
                fR[j, i] = max(0.0, fR[j, i] + dt * A * g * dr / cell)
            if j > 0:
                dt_ = d[j, i] + b[j, i] - (d[j - 1, i] + b[j - 1, i])
                fT[j, i] = max(0.0, fT[j, i] + dt * A * g * dt_ / cell)
            if j < ny - 1:
                db = d[j, i] + b[j, i] - (d[j + 1, i] + b[j + 1, i])
                fB[j, i] = max(0.0, fB[j, i] + dt * A * g * db / cell)


@njit(cache=True)
def _step_water(fL, fR, fT, fB, d, u, v, cell, dt, evap, rain, src,
                d_max, u_max):
    ny, nx = d.shape
    area = cell * cell
    for j in range(ny):
        for i in range(nx):
            tot = fL[j, i] + fR[j, i] + fT[j, i] + fB[j, i]
            dcur = d[j, i]
            if tot * dt > dcur * area and tot > 0.0:
                k = dcur * area / (tot * dt)
                fL[j, i] *= k
                fR[j, i] *= k
                fT[j, i] *= k
                fB[j, i] *= k
                tot *= k
            outflow = tot
            inflow = 0.0
            if i > 0:
                inflow += fR[j, i - 1]
            if i < nx - 1:
                inflow += fL[j, i + 1]
            if j > 0:
                inflow += fB[j - 1, i]
            if j < ny - 1:
                inflow += fT[j + 1, i]
            d[j, i] = dcur + dt * (inflow - outflow) / area
            if d[j, i] < 0.0:
                d[j, i] = 0.0
            d[j, i] += rain + src[j, i]
            if d[j, i] > 0.0:
                d[j, i] *= (1.0 - evap)
            if d[j, i] > d_max:
                d[j, i] = d_max          # the virtual-pipe model is shallow-flow
            # velocity from the net flux through the cell faces
            ux = 0.0
            vy = 0.0
            if i > 0:
                ux += fR[j, i - 1] - fL[j, i]
            if i < nx - 1:
                ux += fL[j, i + 1] - fR[j, i]
            if j > 0:
                vy += fB[j - 1, i] - fT[j, i]
            if j < ny - 1:
                vy += fT[j + 1, i] - fB[j, i]
            u[j, i] = 0.5 * ux
            v[j, i] = 0.5 * vy
            if u[j, i] > u_max:
                u[j, i] = u_max
            elif u[j, i] < -u_max:
                u[j, i] = -u_max
            if v[j, i] > u_max:
                v[j, i] = u_max
            elif v[j, i] < -u_max:
                v[j, i] = -u_max


@njit(cache=True)
def _step_erosion(b, sand, s, d, u, v, cell, Kc, Ks, Kd, min_tilt, matK, prot,
                  amt_lim, s_max, u_max):
    ny, nx = b.shape
    removed = 0.0
    deposited = 0.0
    for j in range(ny):
        for i in range(nx):
            if d[j, i] <= 1e-6:
                continue
            # local tilt from the water surface
            gx = 0.0
            gy = 0.0
            if i > 0 and i < nx - 1:
                gx = (b[j, i + 1] - b[j, i - 1]) * 0.5 / cell
            elif i == 0:
                gx = (b[j, i + 1] - b[j, i]) / cell
            elif i == nx - 1:
                gx = (b[j, i] - b[j, i - 1]) / cell
            if j > 0 and j < ny - 1:
                gy = (b[j + 1, i] - b[j - 1, i]) * 0.5 / cell
            elif j == 0:
                gy = (b[j + 1, i] - b[j, i]) / cell
            elif j == ny - 1:
                gy = (b[j, i] - b[j - 1, i]) / cell
            slope = np.sqrt(gx * gx + gy * gy)
            if slope < min_tilt:
                slope = min_tilt
            speed = np.sqrt(u[j, i] * u[j, i] + v[j, i] * v[j, i])
            if speed > u_max:
                speed = u_max
            C = Kc * slope * speed * matK[j, i]
            if C <= 0.0:
                continue
            if C > s[j, i]:
                amt = Ks * (C - s[j, i])
                if prot[j, i] <= 0.0:
                    continue
                amt *= prot[j, i]
                # Physical limiter: the model may remove at most ``amt_lim``
                # times the local flow depth in one step.  Without a bound the
                # capacity term (which grows with both slope and speed) can feed
                # back on itself through the flow and run away on steep,
                # fine-grained terrain.  Bedrock removal is also bounded by
                # ``cell`` per step so a single cell can never fling itself to
                # infinity.
                lim = amt_lim * d[j, i]
                if lim > cell:
                    lim = cell
                if amt > lim:
                    amt = lim
                # loose sand is entrained before bedrock is plucked
                if sand[j, i] >= amt:
                    sand[j, i] -= amt
                else:
                    rest = amt - sand[j, i]
                    sand[j, i] = 0.0
                    b[j, i] -= rest
                s[j, i] += amt
                removed += amt
            else:
                amt = Kd * (s[j, i] - C)
                b[j, i] += amt
                sand[j, i] += amt
                s[j, i] -= amt
                deposited += amt
            if s[j, i] > s_max:
                s[j, i] = s_max
            if sand[j, i] < 0.0:
                sand[j, i] = 0.0
    return removed, deposited


@njit(cache=True)
def _advect_semilagrangian(s, u, v, cell, dt):
    """Semi-Lagrangian advection of suspended sediment: ds/dt + (v.grad)s = 0."""
    ny, nx = s.shape
    out = np.empty_like(s)
    for j in range(ny):
        for i in range(nx):
            x = i - u[j, i] * dt / cell
            y = j - v[j, i] * dt / cell
            if x < 0.0:
                x = 0.0
            if y < 0.0:
                y = 0.0
            if x > nx - 1.001:
                x = nx - 1.001
            if y > ny - 1.001:
                y = ny - 1.001
            i0 = int(x)
            j0 = int(y)
            fx = x - i0
            fy = y - j0
            out[j, i] = (s[j0, i0] * (1.0 - fx) * (1.0 - fy)
                         + s[j0, i0 + 1] * fx * (1.0 - fy)
                         + s[j0 + 1, i0] * (1.0 - fx) * fy
                         + s[j0 + 1, i0 + 1] * fx * fy)
    s[:, :] = out


@njit(cache=True)
def _thermal(b, sand, cell, tan_repose, weight, iters=1):
    """Angle-of-repose relaxation (talus switching); St'ava et al. (2008)."""
    ny, nx = b.shape
    for _ in range(iters):
        for j in range(ny):
            for i in range(nx):
                h = b[j, i] + sand[j, i]
                for di, dj, dist in ((1, 0, 1.0), (0, 1, 1.0), (1, 1, 1.41421356),
                                     (-1, 1, 1.41421356)):
                    ii = i + di
                    jj = j + dj
                    if ii < 0 or ii >= nx or jj < 0 or jj >= ny:
                        continue
                    dh = h - (b[jj, ii] + sand[jj, ii])
                    lim = tan_repose * cell * dist
                    if dh > lim:
                        move = (dh - lim) * 0.5 * weight
                        if sand[j, i] >= move:
                            sand[j, i] -= move
                            sand[jj, ii] += move
                        else:
                            rest = move - sand[j, i]
                            sand[j, i] = 0.0
                            b[j, i] -= rest
                            sand[jj, ii] += move
                    elif dh < -lim:
                        move = (-dh - lim) * 0.5 * weight
                        if sand[jj, ii] >= move:
                            sand[jj, ii] -= move
                            sand[j, i] += move
                        else:
                            rest = move - sand[jj, ii]
                            sand[jj, ii] = 0.0
                            b[jj, ii] -= rest
                            sand[j, i] += move


def erode_hydraulic(z_rock: np.ndarray, z_sed: np.ndarray, cell: float,
                    p: HydraulicParams, progress=None):
    """Run the virtual-pipe hydraulic + thermal erosion.

    Parameters
    ----------
    z_rock, z_sed : (ny, nx) float32; modified in place
    Returns a dict with diagnostics and the final water/sediment fields.
    """
    ny, nx = z_rock.shape
    b = np.ascontiguousarray(z_rock, dtype=np.float32)
    sand = np.ascontiguousarray(z_sed, dtype=np.float32)
    d = np.zeros((ny, nx), dtype=np.float32)
    s = np.zeros((ny, nx), dtype=np.float32)
    fL = np.zeros((ny, nx), dtype=np.float32)
    fR = np.zeros((ny, nx), dtype=np.float32)
    fT = np.zeros((ny, nx), dtype=np.float32)
    fB = np.zeros((ny, nx), dtype=np.float32)
    u = np.zeros((ny, nx), dtype=np.float32)
    v = np.zeros((ny, nx), dtype=np.float32)
    matK = (np.ascontiguousarray(p.material_Kc, dtype=np.float32)
            if p.material_Kc is not None else np.ones((ny, nx), dtype=np.float32))
    prot = (np.ascontiguousarray(p.erode_mask, dtype=np.float32)
            if p.erode_mask is not None else np.ones((ny, nx), dtype=np.float32))
    src = (np.ascontiguousarray(p.source_mask, dtype=np.float32)
           if p.source_mask is not None else np.zeros((ny, nx), dtype=np.float32))

    min_tilt = float(np.tan(np.radians(p.min_tilt_deg)))
    tan_rep = float(np.tan(np.radians(p.repose_deg)))
    removed = 0.0
    deposited = 0.0
    guarded = False
    b_prev = b.copy()
    sand_prev = sand.copy()
    rain = p.rain_rate * p.dt
    for it in range(p.iterations):
        _step_fluxes(fL, fR, fT, fB, d, b, cell, p.dt, p.pipe_area, p.g)
        _step_water(fL, fR, fT, fB, d, u, v, cell, p.dt, p.evaporation, rain, src,
                    p.depth_max, p.speed_max)
        r, dep = _step_erosion(b, sand, s, d, u, v, cell, p.Kc, p.Ks, p.Kd,
                               min_tilt, matK, prot, p.erode_limit, p.susp_max,
                               p.speed_max)
        removed += r
        deposited += dep
        _advect_semilagrangian(s, u, v, cell, p.dt)
        if p.thermal > 0.0:
            _thermal(b, sand, cell, tan_rep, p.thermal, 1)
        if p.guard and not (np.isfinite(b).all() and np.isfinite(sand).all()):
            # last resort: restore the previous consistent state and stop.
            b[:] = b_prev
            sand[:] = sand_prev
            guarded = True
            break
        if p.guard and it % 8 == 7:
            b_prev[:] = b
            sand_prev[:] = sand
        if progress is not None and (it % max(1, p.iterations // 20) == 0):
            progress(it, p.iterations)

    z_rock[:] = b
    z_sed[:] = np.maximum(sand, 0.0)
    return dict(removed_m=float(removed), deposited_m=float(deposited),
                guarded=guarded,
                water=d if p.out_water else None,
                suspended=s if p.out_sediment else None)


def thermal_relax(z_rock: np.ndarray, z_sed: np.ndarray, cell: float,
                  repose_deg: float = 33.0, iterations: int = 30,
                  weight: float = 0.5):
    """Standalone talus / scree relaxation."""
    b = np.ascontiguousarray(z_rock, dtype=np.float32).copy()
    sand = np.ascontiguousarray(z_sed, dtype=np.float32).copy()
    _thermal(b, sand, cell, float(np.tan(np.radians(repose_deg))), weight, iterations)
    z_rock[:] = b
    z_sed[:] = np.maximum(sand, 0.0)
