"""Spline paths and cross-section profiles.

Used for the authoring workflow the user asked for: draw a river / canyon / road
/ ridge on the map, give it width, depth, banks and (optionally) let erosion
follow it.  Centripetal Catmull-Rom (Yuksel, Schaefer & Keyser 2011, *Curves and
Surfaces* 76, 297-313) is used because it never self-intersects or overshoots --
important when a path doubles back through a canyon bend.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple

import numpy as np


# --------------------------------------------------------------------------
# spline evaluation
# --------------------------------------------------------------------------
def catmull_rom(points: Sequence[Tuple[float, float]], samples_per_seg: int = 24,
                alpha: float = 0.5, closed: bool = False) -> np.ndarray:
    """Centripetal Catmull-Rom (alpha = 0.5) through the control points."""
    P = np.asarray(points, dtype=np.float64)
    if len(P) < 2:
        return P.reshape(-1, 2)
    if closed:
        P = np.vstack([P[-1], P, P[0], P[1]])
    else:
        P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        t0 = 0.0
        t1 = t0 + max(np.linalg.norm(p1 - p0), 1e-6) ** alpha
        t2 = t1 + max(np.linalg.norm(p2 - p1), 1e-6) ** alpha
        t3 = t2 + max(np.linalg.norm(p3 - p2), 1e-6) ** alpha
        ts = np.linspace(t1, t2, samples_per_seg, endpoint=False)
        for t in ts:
            A1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            A2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            A3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2
            B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3
            C = (t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2
            out.append(C)
    pt = np.asarray(out)
    if closed:
        pt = np.vstack([pt, pt[0]])
    return pt


def resample_uniform(pts: np.ndarray, spacing: float) -> np.ndarray:
    """Resample a polyline at (approximately) constant arc length."""
    if len(pts) < 2:
        return pts
    d = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    if d[-1] <= 0:
        return pts
    s = np.arange(0.0, d[-1], spacing)
    x = np.interp(s, d, pts[:, 0])
    y = np.interp(s, d, pts[:, 1])
    return np.stack([x, y], axis=1)


def smooth_profile(v: np.ndarray, window: int = 5) -> np.ndarray:
    if window <= 1:
        return v
    k = np.ones(window) / window
    return np.convolve(np.r_[v[window // 2:0:-1], v, v[-2:-window // 2 - 2:-1]], k,
                       mode="valid")


@dataclass
class PathSpec:
    """One authored path: a river, canyon, road, ridge or levee."""

    name: str = "path"
    points: List[Tuple[float, float]] = field(default_factory=list)  # world XY (m)
    kind: str = "river"          # river | canyon | road | ridge | levee | fault
    width: float = 120.0         # full channel width (m)
    depth: float = 60.0          # incision depth (m)
    bank_width: float = 90.0     # width of the graded banks
    profile: str = "v"           # v | u | parabolic | trapezoid
    closed: bool = False
    width_profile: Optional[List[float]] = None     # per control point multipliers
    depth_profile: Optional[List[float]] = None
    smooth: float = 0.5          # 0 = sharp banks, 1 = fully graded
    noise: float = 0.0           # bank roughness (m)
    noise_scale: float = 60.0    # roughness feature size (m)
    seed: int = 1
    uplift: float = 0.0          # for 'ridge'/'fault': vertical offset / m
    enabled: bool = True

    def samples(self, spacing: Optional[float] = None) -> np.ndarray:
        sp = spacing if spacing else max(4.0, min(self.width, self.bank_width) * 0.25)
        pts = catmull_rom(self.points, closed=self.closed) if len(self.points) > 2 else \
            np.asarray(self.points, dtype=np.float64)
        pts = resample_uniform(pts, sp)
        return pts

    def widths(self) -> np.ndarray:
        pts = np.asarray(self.points, dtype=np.float64)
        w = np.asarray(self.width_profile, dtype=np.float64) if self.width_profile else np.ones(len(pts))
        d = np.asarray(self.depth_profile, dtype=np.float64) if self.depth_profile else np.ones(len(pts))
        return w, d


def profile_shape(s: np.ndarray, kind: str, smooth: float) -> np.ndarray:
    """Cross-section shape f(s) in [0, 1] as a function of |s| in [-1, 1]."""
    a = np.abs(s)
    a = np.clip(a, 0.0, 1.0)
    if kind == "v":
        f = 1.0 - a
    elif kind == "u":
        f = np.sqrt(np.maximum(0.0, 1.0 - a * a))
    elif kind == "parabolic":
        f = (1.0 - a) ** 2
    elif kind == "trapezoid":
        f = np.clip((0.75 - a) / 0.75, 0.0, 1.0)
    else:
        f = 1.0 - a
    if smooth > 0.0:                      # cosine blending towards a rounded bank
        f = (1.0 - smooth) * f + smooth * (0.5 * (1.0 + np.cos(np.pi * a)))
    return np.maximum(f, 0.0)


# --------------------------------------------------------------------------
# rasterisation onto a grid
# --------------------------------------------------------------------------
def distance_to_path(pts: np.ndarray, nx: int, ny: int, cell: float,
                     max_dist: float) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Distance from every grid cell to the polyline plus the local path width.

    Returns (distance, width_at_nearest, depth_at_nearest).  Only cells within
    ``max_dist`` are filled; the rest get +inf so the caller can skip them.
    """
    W = nx * cell
    dist = np.full((ny, nx), np.inf, dtype=np.float64)
    wid = np.zeros((ny, nx), dtype=np.float64)
    dep = np.zeros((ny, nx), dtype=np.float64)
    if len(pts) < 1:
        return dist, wid, dep
    # segment-wise rasterisation in a local window
    p = np.asarray(pts, dtype=np.float64)
    for i in range(len(p) - 1):
        ax, ay = p[i]
        bx, by = p[i + 1]
        seg = np.hypot(bx - ax, by - ay)
        if seg < 1e-9:
            continue
        x0 = max(0, int((min(ax, bx) - max_dist) / cell))
        x1 = min(nx, int((max(ax, bx) + max_dist) / cell) + 2)
        y0 = max(0, int((min(ay, by) - max_dist) / cell))
        y1 = min(ny, int((max(ay, by) + max_dist) / cell) + 2)
        if x1 <= x0 or y1 <= y0:
            continue
        xs = (np.arange(x0, x1) + 0.5) * cell
        ys = (np.arange(y0, y1) + 0.5) * cell
        gx, gy = np.meshgrid(xs, ys)
        ex, ey = bx - ax, by - ay
        t = ((gx - ax) * ex + (gy - ay) * ey) / (seg * seg)
        t = np.clip(t, 0.0, 1.0)
        px = ax + t * ex
        py = ay + t * ey
        d = np.hypot(gx - px, gy - py)
        sub = dist[y0:y1, x0:x1]
        upd = d < sub
        sub[upd] = d[upd]
        wid[y0:y1, x0:x1][upd] = (i + t[upd])   # parametric position (segment units)
        dep[y0:y1, x0:x1][upd] = d[upd]
    return dist, wid, dep
