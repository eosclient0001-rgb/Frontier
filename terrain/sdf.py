"""SDF (signed-distance-field) terrain representation and voxel matching.

The terrain is stored as a heightfield ``h(x, z)`` in meters, which *defines*
an SDF volume implicitly:

    sdf(x, y, z) = (y - h(x, z)) / sqrt(1 + |grad h|^2)

The denominator is the first-order correction from raw vertical distance to
true closest-point distance on a sloped surface. Everything downstream —
droplet advection, brush splats, carve limits — works in world-space meters
and is then quantized against the voxel size, which is what makes the erosion
"SDF erosion" rather than "mesh erosion":

* mesh erosion moves vertices directly and has no notion of cell size, so it
  happily creates sub-voxel spikes, pits and terracing;
* SDF erosion treats the heightfield as samples of a continuous field: every
  carve is a world-space Gaussian splat whose radius is clamped to a multiple
  of the voxel size, and every height delta is limited (CFL-style) to a
  fraction of a voxel per pass so the field can never tear.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class SDFConfig:
    extent: float = 100.0  # world size of the square terrain, meters (X and Z)
    res: int = 512  # grid samples per side
    h_min: float = 0.0  # SDF volume floor, meters
    h_max: float = 40.0  # SDF volume ceiling, meters
    res_y: int = 128  # vertical voxel count of the implicit volume

    @property
    def cell(self) -> float:
        """Horizontal sample spacing in meters (= horizontal voxel size)."""
        return float(self.extent) / max(int(self.res) - 1, 1)

    @property
    def voxel_xz(self) -> float:
        return self.cell

    @property
    def voxel_y(self) -> float:
        return (float(self.h_max) - float(self.h_min)) / max(int(self.res_y), 1)

    @property
    def min_voxel(self) -> float:
        return min(self.voxel_xz, self.voxel_y)

    @property
    def nyquist_m(self) -> float:
        """Smallest representable wavelength (~2 voxels)."""
        return 2.0 * self.voxel_xz


def make_grid(cfg: SDFConfig) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return (X, Z world-coord grids, xs, zs axes). Shape (res, res).

    Row ``i`` maps to ``z``, column ``j`` maps to ``x``; the center of the
    terrain is at world (0, 0).
    """
    ax = (np.arange(cfg.res, dtype=np.float64) / (cfg.res - 1) - 0.5) * cfg.extent
    X, Z = np.meshgrid(ax, ax)
    return X, Z, ax, ax


def height_gradient(height: np.ndarray, cell: float) -> tuple[np.ndarray, np.ndarray]:
    """World-space gradient (gz, gx) in meters of height per meter."""
    gz, gx = np.gradient(np.asarray(height, dtype=np.float64), cell)
    return gz, gx


def surface_normals(height: np.ndarray, cell: float) -> np.ndarray:
    """Up-facing surface normals, shape (N, N, 3)."""
    gz, gx = height_gradient(height, cell)
    n = np.stack([-gx, np.ones_like(gx), -gz], axis=-1)
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-12)
    return n.astype(np.float32)


def sdf_correction(height: np.ndarray, cell: float) -> np.ndarray:
    """1 / sqrt(1 + |grad h|^2): vertical-distance -> true-distance factor."""
    gz, gx = height_gradient(height, cell)
    return (1.0 / np.sqrt(1.0 + gx * gx + gz * gz)).astype(np.float32)


def sample_height_bilinear(height: np.ndarray, x: float, z: float) -> float:
    """Sample heightfield at float grid coords (x=col, z=row)."""
    n = height.shape[0]
    x = min(max(x, 0.0), n - 1.001)
    z = min(max(z, 0.0), n - 1.001)
    xi, zi = int(x), int(z)
    fx, fz = x - xi, z - zi
    h = height
    return float(
        h[zi, xi] * (1 - fx) * (1 - fz)
        + h[zi, xi + 1] * fx * (1 - fz)
        + h[zi + 1, xi] * (1 - fx) * fz
        + h[zi + 1, xi + 1] * fx * fz
    )


def sdf_slice_vertical(
    height: np.ndarray,
    cfg: SDFConfig,
    row: int | None = None,
    slice_res_y: int = 160,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Evaluate the SDF on a vertical cross-section (for visualization).

    Returns (sdf[H, N] in meters, xs[N], ys[H]). Negative = underground.
    """
    n = height.shape[0]
    if row is None:
        row = n // 2
    row = int(np.clip(row, 0, n - 1))
    corr = sdf_correction(height, cfg.cell)[row, :]
    # Lightly smooth the correction factor along the slice so the banding
    # reads as clean iso-distance contours over rough ground.
    ker = np.ones(7, dtype=np.float64) / 7.0
    corr = np.convolve(np.pad(corr, 3, mode="edge"), ker, mode="valid")
    hrow = np.asarray(height[row, :], dtype=np.float64)
    ys = np.linspace(cfg.h_min, cfg.h_max, slice_res_y, dtype=np.float64)
    xs = (np.arange(n, dtype=np.float64) / (n - 1) - 0.5) * cfg.extent
    sdf = (ys[:, None] - hrow[None, :]) * corr[None, :]
    return sdf.astype(np.float32), xs.astype(np.float32), ys.astype(np.float32)


def sample_sdf_volume(
    height: np.ndarray, cfg: SDFConfig, n: int = 128
) -> np.ndarray:
    """Sample the full SDF volume at n^3 (z, y, x order), float32 meters."""
    from scipy import ndimage  # lazy; only needed for export

    hh = np.asarray(height, dtype=np.float64)
    src = hh.shape[0]
    # Resample heightfield to n x n (bilinear).
    zoom = n / src
    h_small = ndimage.zoom(hh, zoom, order=1).astype(np.float64)
    if h_small.shape[0] != n:  # zoom rounding guard
        h_small = h_small[:n, :n]
    cell_small = cfg.extent / max(n - 1, 1)
    gz, gx = np.gradient(h_small, cell_small)
    corr = 1.0 / np.sqrt(1.0 + gx * gx + gz * gz)
    ys = np.linspace(cfg.h_min, cfg.h_max, n, dtype=np.float64)
    vol = (ys[None, :, None] - h_small[:, None, :]) * corr[:, None, :]
    return vol.transpose(0, 1, 2).astype(np.float32)  # (z, y, x)


def gaussian_brush(
    radius_world: float, cell: float, min_radius_cells: float = 1.5
) -> tuple[np.ndarray, np.ndarray, float, bool]:
    """World-space Gaussian splat kernel quantized to the voxel grid.

    Returns (offsets[K, 2] int (dz, dx), weights[K] normalized, radius_cells,
    was_clamped). The radius is never allowed below ``min_radius_cells`` so a
    carve always covers real voxels — sub-voxel brushes are the #1 source of
    invisible erosion / wasted particles.
    """
    radius_cells = max(float(radius_world) / max(cell, 1e-9), 1e-6)
    clamped = False
    if radius_cells < min_radius_cells:
        radius_cells = min_radius_cells
        clamped = True
    r = int(np.ceil(radius_cells))
    offs: list[tuple[int, int]] = []
    w: list[float] = []
    sigma = max(radius_cells / 2.0, 0.5)
    for dz in range(-r, r + 1):
        for dx in range(-r, r + 1):
            d = float(np.hypot(dx, dz))
            if d <= radius_cells:
                offs.append((dz, dx))
                w.append(float(np.exp(-(d * d) / (2.0 * sigma * sigma))))
    weights = np.asarray(w, dtype=np.float64)
    weights /= max(weights.sum(), 1e-12)
    return (
        np.asarray(offs, dtype=np.int64),
        weights.astype(np.float64),
        float(radius_cells),
        clamped,
    )


def voxel_match_report(
    cfg: SDFConfig,
    brush_radius_world: float,
    cfl_voxels: float = 0.5,
    measured_cut_m: float | None = None,
    mean_cut_m: float | None = None,
    subvoxel_waste_pct: float | None = None,
    clamp_rate_pct: float | None = None,
) -> dict:
    """Pre- and post-erosion voxel/detail matching diagnostics.

    Status levels: ``ok`` (matched), ``warn`` (usable but off), ``bad``.
    """
    cell = cfg.voxel_xz
    brush_cells = float(brush_radius_world) / cell
    issues: list[str] = []
    status = "ok"

    if brush_cells < 1.5:
        status = "bad"
        issues.append(
            f"Brush radius {brush_radius_world:.3f} m is only {brush_cells:.2f} voxels "
            f"(voxel={cell:.4f} m) — carves would be sub-voxel and invisible. "
            "It will be auto-clamped to 1.5 voxels."
        )
    elif brush_cells < 2.0:
        status = "warn"
        issues.append(
            f"Brush is {brush_cells:.2f} voxels — very fine. Use 2–4 voxels "
            f"({2*cell:.3f}–{4*cell:.3f} m) for clean channels at this resolution."
        )
    elif brush_cells > 8.0:
        status = "warn"
        issues.append(
            f"Brush is {brush_cells:.1f} voxels — very broad. Channels will look "
            "soft; detail smaller than the brush cannot survive."
        )

    max_step_cut_m = float(cfl_voxels) * cell

    if measured_cut_m is not None:
        cut_vox = float(measured_cut_m) / cell
        if cut_vox < 1.0:
            status = "bad" if status != "bad" else status
            issues.append(
                f"Deepest cut is {measured_cut_m:.3f} m = {cut_vox:.2f} voxels: "
                "erosion is below the grid Nyquist and mostly invisible. Raise "
                "particle count / erode strength or coarsen the grid."
            )
        elif cut_vox > 60.0:
            if status == "ok":
                status = "warn"
            issues.append(
                f"Deepest cut is {measured_cut_m:.2f} m = {cut_vox:.0f} voxels: "
                "very deep relative to the grid — check for terracing/pitting."
            )
    if subvoxel_waste_pct is not None and subvoxel_waste_pct > 70.0:
        if status == "ok":
            status = "warn"
        issues.append(
            f"{subvoxel_waste_pct:.0f}% of carved cells moved less than one voxel — "
            "most erosion detail is being lost between samples. Increase strength "
            "or reduce resolution."
        )
    if clamp_rate_pct is not None and clamp_rate_pct > 45.0:
        if status == "ok":
            status = "warn"
        issues.append(
            f"CFL limiter clamped {clamp_rate_pct:.0f}% of requested carve depth — "
            "erosion wants to cut faster than the grid can represent per pass. "
            "Raise particle count instead of erode speed."
        )

    return {
        "status": status,
        "voxel_xz_m": cell,
        "voxel_y_m": cfg.voxel_y,
        "nyquist_m": cfg.nyquist_m,
        "brush_radius_m": float(brush_radius_world),
        "brush_radius_voxels": brush_cells,
        "max_step_cut_m": max_step_cut_m,
        "cfl_voxels": float(cfl_voxels),
        "measured_max_cut_m": measured_cut_m,
        "measured_max_cut_voxels": (
            float(measured_cut_m) / cell if measured_cut_m is not None else None
        ),
        "measured_mean_cut_m": mean_cut_m,
        "subvoxel_waste_pct": subvoxel_waste_pct,
        "clamp_rate_pct": clamp_rate_pct,
        "issues": issues,
    }
