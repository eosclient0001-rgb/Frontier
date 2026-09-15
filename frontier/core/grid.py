"""Terrain container: a height-based field set carried through the whole pipeline.

The design deliberately keeps *bedrock* (`z_rock`) and *alluvium* (`sed`) apart.
That separation is what makes the "rocky + sandy canyon" look physically
consistent: erosion carves rock, sand is routed and trapped in the valleys, and
the satmap generator can key material off "depth of loose cover" rather than
off an arbitrary noise mask.

Conventions
-----------
* Arrays are ``(ny, nx)``, C-order, ``float32``, z up, meters.
* ``cell`` is the horizontal cell size (m). Square cells only.
* Row 0 is the ``y = 0`` ("south") edge, matching image coordinates so that
  raster export maps 1:1 onto the array.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

import numpy as np

try:  # scipy is only needed for a couple of helpers
    from scipy import ndimage as _ndi
except Exception:  # pragma: no cover
    _ndi = None


@dataclass
class Terrain:
    """A 2.5D terrain with bedrock + sediment + optional structure field."""

    nx: int
    ny: int
    cell: float = 1.0
    z_rock: np.ndarray = None  # type: ignore[assignment]
    z_sed: np.ndarray = None  # type: ignore[assignment]
    water: np.ndarray = None  # type: ignore[assignment]
    meta: Dict[str, Any] = field(default_factory=dict)

    # ---------------------------------------------------------------- ctor
    def __post_init__(self) -> None:
        if self.z_rock is None:
            self.z_rock = np.zeros((self.ny, self.nx), dtype=np.float32)
        else:
            self.z_rock = np.ascontiguousarray(self.z_rock, dtype=np.float32)
        if self.z_sed is None:
            self.z_sed = np.zeros_like(self.z_rock)
        else:
            self.z_sed = np.ascontiguousarray(self.z_sed, dtype=np.float32)
        if self.water is None:
            self.water = np.zeros_like(self.z_rock)
        if (self.z_rock.shape != (self.ny, self.nx)
                or self.z_sed.shape != (self.ny, self.nx)):
            raise ValueError("array shape does not match (ny, nx)")

    # ------------------------------------------------------------- helpers
    @property
    def shape(self):
        return (self.ny, self.nx)

    @property
    def extent(self) -> float:
        """Physical size of the square domain (m)."""
        return float(self.nx * self.cell)

    @property
    def z(self) -> np.ndarray:
        """Visible surface = bedrock + loose cover."""
        return self.z_rock + self.z_sed

    def set_surface(self, z: np.ndarray) -> None:
        """Set the visible surface keeping the rock/sediment split.

        Surface lowering eats loose cover first (that is what a river or the
        wind does), then rock; aggradation/fresh rock uplift adds *rock*.

        Note the clamp on ``cut``: without it a positive ``dz`` (uplift or
        deposition) would make ``cut`` negative and silently book the new
        material as loose sediment, which would fill the model with fictitious
        sand after a few hundred uplift steps.
        """
        z = np.asarray(z, dtype=np.float32)
        top = self.z_rock + self.z_sed
        dz = z - top
        cut = np.minimum(self.z_sed, np.maximum(-dz, 0.0))
        self.z_sed = self.z_sed - cut
        self.z_rock = self.z_rock + (dz + cut)

    def copy(self) -> "Terrain":
        return Terrain(self.nx, self.ny, self.cell,
                       self.z_rock.copy(), self.z_sed.copy(), self.water.copy(),
                       dict(self.meta))

    def resample(self, nx: int, ny: int) -> "Terrain":
        out = Terrain(nx, ny, self.cell * self.nx / nx)
        for name in ("z_rock", "z_sed", "water"):
            a = getattr(self, name)
            out_arr = _bilinear(a, ny, nx)
            setattr(out, name, out_arr.astype(np.float32))
        out.meta = dict(self.meta)
        return out

    def changed_grid(self, nx: int, ny: int, world_size: Optional[float] = None) -> "Terrain":
        """Resample to a new resolution, preserving world size by default."""
        out = Terrain(nx, ny, 1.0)
        world = world_size if world_size is not None else self.extent
        out.cell = world / nx
        for name in ("z_rock", "z_sed", "water"):
            a = getattr(self, name)
            setattr(out, name, _bilinear(a, ny, nx).astype(np.float32))
        out.meta = dict(self.meta)
        return out

    # ------------------------------------------------------------ geometry
    def coords(self, idx_x: np.ndarray, idx_y: np.ndarray):
        return idx_x * self.cell, idx_y * self.cell

    def cell_area(self) -> float:
        return self.cell * self.cell

    def minmax(self):
        z = self.z
        return float(z.min()), float(z.max())

    def normalize_to(self, zmin: float = 0.0, zmax: float = 1.0) -> None:
        """Affine map so min(z)==zmin and max(z)==zmax (sediment thickness scales)."""
        z = self.z
        lo, hi = float(z.min()), float(z.max())
        if hi - lo < 1e-9:
            self.z_rock[:] = zmin
            self.z_sed[:] = 0.0
            return
        s = (zmax - zmin) / (hi - lo)
        o = zmin - lo * s
        self.z_rock = (self.z_rock * s + o).astype(np.float32)
        self.z_sed = (self.z_sed * s).astype(np.float32)

    # ------------------------------------------------------------------ io
    def save_npz(self, path: str) -> None:
        np.savez_compressed(path, z_rock=self.z_rock, z_sed=self.z_sed,
                            water=self.water, cell=self.cell,
                            meta=json.dumps(self.meta))

    @staticmethod
    def load_npz(path: str) -> "Terrain":
        d = np.load(path, allow_pickle=False)
        t = Terrain(d["z_rock"].shape[1], d["z_rock"].shape[0], float(d["cell"]),
                    d["z_rock"], d["z_sed"], d["water"])
        try:
            t.meta = json.loads(str(d["meta"]))
        except Exception:
            t.meta = {}
        return t


def _bilinear(a: np.ndarray, ny: int, nx: int) -> np.ndarray:
    """Bilinear resample (no scipy dependency)."""
    sy, sx = a.shape
    if sy == ny and sx == nx:
        return a.astype(np.float32)
    y = np.linspace(0, sy - 1, ny)
    x = np.linspace(0, sx - 1, nx)
    y0 = np.floor(y).astype(np.int64)
    x0 = np.floor(x).astype(np.int64)
    y1 = np.minimum(y0 + 1, sy - 1)
    x1 = np.minimum(x0 + 1, sx - 1)
    wy = (y - y0).astype(np.float32)[:, None]
    wx = (x - x0).astype(np.float32)[None, :]
    a = a.astype(np.float32)
    out = (a[np.ix_(y0, x0)] * (1 - wy) * (1 - wx)
           + a[np.ix_(y1, x0)] * wy * (1 - wx)
           + a[np.ix_(y0, x1)] * (1 - wy) * wx
           + a[np.ix_(y1, x1)] * wy * wx)
    return out.astype(np.float32)


# --------------------------------------------------------------------------
# differential geometry of a heightfield
# --------------------------------------------------------------------------
def gradient(z: np.ndarray, cell: float):
    """Central-difference gradient (edge one-sided). Returns (dz/dx, dz/dy)."""
    gx = np.empty_like(z)
    gy = np.empty_like(z)
    gx[:, 1:-1] = (z[:, 2:] - z[:, :-2]) * (0.5 / cell)
    gx[:, 0] = (z[:, 1] - z[:, 0]) / cell
    gx[:, -1] = (z[:, -1] - z[:, -2]) / cell
    gy[1:-1, :] = (z[2:, :] - z[:-2, :]) * (0.5 / cell)
    gy[0, :] = (z[1, :] - z[0, :]) / cell
    gy[-1, :] = (z[-1, :] - z[-2, :]) / cell
    return gx, gy


def slope_aspect(z: np.ndarray, cell: float):
    """Slope (radians) and aspect (radians, CW from +y, i.e. downhill azimuth)."""
    gx, gy = gradient(z, cell)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gy, -gx)
    return slope, aspect


def laplacian(z: np.ndarray, cell: float) -> np.ndarray:
    out = np.empty_like(z)
    out[1:-1, 1:-1] = (z[1:-1, 2:] + z[1:-1, :-2] + z[2:, 1:-1] + z[:-2, 1:-1]
                       - 4.0 * z[1:-1, 1:-1]) / (cell * cell)
    out[0, :] = out[1, :]
    out[-1, :] = out[-2, :]
    out[:, 0] = out[:, 1]
    out[:, -1] = out[:, -2]
    return out


def gaussian_blur(z: np.ndarray, sigma_cells: float) -> np.ndarray:
    if sigma_cells <= 0:
        return z.astype(np.float32)
    if _ndi is not None:
        return _ndi.gaussian_filter(z.astype(np.float32), sigma_cells,
                                    mode="nearest").astype(np.float32)
    # separable box approximation fallback
    r = max(1, int(round(sigma_cells)))
    k = np.ones(2 * r + 1, dtype=np.float32) / (2 * r + 1)
    a = np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 0, z)
    return np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 1, a).astype(np.float32)
