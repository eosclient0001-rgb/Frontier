"""Layered stratigraphy: the reason canyon walls look like canyon walls.

A flat-lying stack of beds with alternating hardness is the first-order control
on Colorado-Plateau style geomorphology: hard caprock beds make mesas and
ledges, soft beds make slopes and alcoves, and the whole stack produces the
staircase profile that reads instantly as "sedimentary canyon".  Beds are
planes with a dip and strike, laterally varying thickness (a low-order fBm), and
per-bed material properties (hardness, colour, grain, vegetation support).

References for the geomorphology:
* Gilbert (1877) *Report on the Geology of the Henry Mountains* -- cliff retreat.
* Schmidt (1994) "Formation of hoodoos", and Young (1985) on rock-mass strength
  controls on cliff profiles.
* Hack (1960) / Hack & Goodlett (1960) on lithologic control of valley form.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Sequence

import numpy as np


@dataclass
class Bed:
    name: str = "bed"
    thickness: float = 100.0        # m
    hardness: float = 1.0           # relative resistance to fluvial/hillslope erosion
    color: Sequence[float] = (0.62, 0.45, 0.33)   # sRGB base albedo
    color2: Sequence[float] = (0.72, 0.58, 0.45)  # streak/variation colour
    grain: float = 1.0              # texture scaling
    roughness: float = 0.8          # texture roughness for the satmap
    sand: float = 0.0                # tendency to break down into sand (0..1)
    veg: float = 0.0                 # vegetation support (0..1)


@dataclass
class Stratigraphy:
    """Stack of beds from the top of the section downwards."""

    top: float = 1400.0             # elevation of the top of the stack (m)
    beds: List[Bed] = field(default_factory=list)
    dip_deg: float = 0.0            # bedding dip
    strike_deg: float = 0.0         # dip azimuth (direction of steepest descent)
    thickness_var: float = 0.25     # lateral thickness variability (fraction, fBm)
    var_scale: float = 2000.0       # m
    seed: int = 7

    # -------------------------------------------------------------- geometry
    def section_height(self) -> float:
        return float(sum(b.thickness for b in self.beds))

    def bed_field(self, nx: int, ny: int, cell: float):
        """Return (bed_index, hardness, depth_in_bed_fraction, plane_elevation).

        ``plane_elevation`` is the elevation of the dipping bedding plane datum;
        bed boundaries are iso-surfaces of it.
        """
        X = (np.arange(nx) + 0.5) * cell
        Y = (np.arange(ny) + 0.5) * cell
        gx, gy = np.meshgrid(X, Y)
        a = np.radians(self.strike_deg)
        # shift of the bedding datum due to dip along the dip azimuth
        shift = np.tan(np.radians(self.dip_deg)) * (gx * np.cos(a) + gy * np.sin(a))
        datum = self.top - shift

        if self.thickness_var > 0.0 and len(self.beds) > 1:
            from ..core.noise import fbm2d
            f = fbm2d(nx, ny, cell, 4, 1.0 / max(self.var_scale, 1.0), 2.0, 0.5,
                      self.seed + 91)
            # low-frequency, zero-mean perturbation of the bed boundaries
            var = (f - f.mean()) * self.thickness_var * self.section_height() * 0.5
        else:
            var = np.zeros((ny, nx), dtype=np.float32)

        # cumulative boundaries
        bounds = np.cumsum([0.0] + [b.thickness for b in self.beds])
        total = bounds[-1]
        # position inside the section: 0 at the top, total at the base
        rel = (datum - var) - 0.0
        # we need "depth below the top of the section" for each cell:
        # depth = top_of_section_elevation - z  ... but here we want it independent
        # of z: the caller supplies z; so return the cumulative boundaries instead.
        depths = np.broadcast_to(bounds.reshape(-1, 1, 1), (len(self.beds) + 1, ny, nx)).copy()
        depths = depths + (var.reshape(1, ny, nx) * np.linspace(0, 1, len(self.beds) + 1).reshape(-1, 1, 1))
        # datum gives the elevation of the top of the section at each cell
        return depths, datum

    def sample(self, z: np.ndarray, datum: np.ndarray, depths: np.ndarray):
        """Bed index / hardness / in-bed fraction for every surface cell."""
        depth_below_datum = datum - z
        idx = np.zeros(z.shape, dtype=np.int32)
        n = len(self.beds)
        for i in range(n):
            top_i = depths[i]
            bot_i = depths[i + 1]
            inside = (depth_below_datum >= top_i) & (depth_below_datum < bot_i)
            idx[inside] = i
        # above the top of the section -> first bed; below the base -> last bed
        idx[depth_below_datum < depths[0]] = 0
        idx[depth_below_datum >= depths[n]] = n - 1
        frac = np.zeros(z.shape, dtype=np.float32)
        hard = np.ones(z.shape, dtype=np.float32)
        for i in range(n):
            sel = idx == i
            t0 = depths[i][sel]
            t1 = depths[i + 1][sel]
            dt = np.maximum(t1 - t0, 1e-6)
            frac[sel] = np.clip((depth_below_datum[sel] - t0) / dt, 0.0, 1.0)
            hard[sel] = self.beds[i].hardness
        return idx, hard, frac

    def hardness_map(self, z: np.ndarray, nx: int, ny: int, cell: float,
                     depths=None, datum=None):
        if depths is None or datum is None:
            depths, datum = self.bed_field(nx, ny, cell)
        return self.sample(z, datum, depths)

    def fit_to_elevation(self, z_max: float, relief: float, cover: float = 1.30,
                         top_margin: float = 0.12) -> "Stratigraphy":
        """Return a copy of the column scaled so it actually spans the terrain.

        A stratigraphic column has to *intersect* the landscape, otherwise every
        cell maps to the same bed and hard/soft contrasts do nothing.  We place
        the top of the stack a little above the highest ground and stretch the
        beds so the whole stack covers ``cover`` times the relief -- which puts
        a handful of major cliff/slope couplets inside the landscape, the
        amount that reads as "layered canyon" rather than "striped ramp".
        """
        total = self.section_height()
        if total <= 0.0 or relief <= 0.0:
            return self
        target = cover * relief
        k = target / total
        out = Stratigraphy(top=z_max + top_margin * relief, dip_deg=self.dip_deg,
                           strike_deg=self.strike_deg,
                           thickness_var=self.thickness_var,
                           var_scale=self.var_scale, seed=self.seed,
                           beds=list(self.beds))
        out.beds = [Bed(b.name, b.thickness * k, b.hardness, b.color, b.color2,
                        b.grain, b.roughness, b.sand, b.veg) for b in self.beds]
        return out

    # ------------------------------------------------------------- shorthands
    @staticmethod
    def colorado_plateau(top: float = 1200.0) -> "Stratigraphy":
        """A plausible sandstone/mudstone/limestone stack (Navajo-like)."""
        return Stratigraphy(top=top, dip_deg=1.2, strike_deg=35.0, beds=[
            Bed("caprock sandstone", 90, 2.6, (0.72, 0.58, 0.42), (0.80, 0.68, 0.52), 1.0, 0.9, 0.35, 0.05),
            Bed("silty slope", 60, 0.8, (0.55, 0.42, 0.33), (0.62, 0.50, 0.40), 1.4, 0.95, 0.25, 0.25),
            Bed("cliff sandstone", 120, 2.9, (0.78, 0.55, 0.34), (0.86, 0.66, 0.44), 0.8, 0.7, 0.55, 0.02),
            Bed("shale", 45, 0.55, (0.42, 0.35, 0.31), (0.48, 0.42, 0.37), 1.6, 0.98, 0.15, 0.45),
            Bed("bench sandstone", 70, 2.2, (0.74, 0.52, 0.32), (0.82, 0.62, 0.42), 0.9, 0.75, 0.45, 0.05),
            Bed("mudstone", 55, 0.6, (0.45, 0.32, 0.28), (0.52, 0.39, 0.33), 1.5, 0.97, 0.2, 0.4),
            Bed("lower sandstone", 110, 2.0, (0.70, 0.47, 0.30), (0.78, 0.56, 0.38), 1.0, 0.8, 0.5, 0.03),
            Bed("limestone", 60, 1.8, (0.66, 0.63, 0.56), (0.73, 0.70, 0.64), 0.7, 0.6, 0.1, 0.02),
            Bed("basement", 300, 1.4, (0.38, 0.33, 0.31), (0.43, 0.38, 0.36), 1.2, 0.9, 0.15, 0.1),
        ])

    @staticmethod
    def soft_sand(top: float = 900.0) -> "Stratigraphy":
        """Weak sandstone / sabkha stack for the sandy canyon preset."""
        return Stratigraphy(top=top, dip_deg=0.6, strike_deg=20.0, thickness_var=0.35, beds=[
            Bed("loose dune sand", 40, 0.25, (0.86, 0.71, 0.47), (0.90, 0.78, 0.55), 0.6, 0.4, 0.9, 0.02),
            Bed("weak sandstone", 80, 1.1, (0.80, 0.62, 0.40), (0.87, 0.71, 0.50), 0.9, 0.7, 0.7, 0.05),
            Bed("siltstone", 50, 0.5, (0.62, 0.49, 0.35), (0.70, 0.57, 0.42), 1.3, 0.95, 0.4, 0.3),
            Bed("crossbed sandstone", 110, 1.6, (0.83, 0.63, 0.38), (0.90, 0.72, 0.48), 0.8, 0.6, 0.75, 0.03),
            Bed("sabkha mudstone", 45, 0.4, (0.55, 0.45, 0.36), (0.62, 0.52, 0.42), 1.5, 0.98, 0.3, 0.35),
            Bed("massive sandstone", 130, 1.9, (0.79, 0.58, 0.36), (0.86, 0.67, 0.45), 0.7, 0.55, 0.8, 0.02),
            Bed("mudrock", 200, 0.7, (0.48, 0.40, 0.34), (0.55, 0.47, 0.40), 1.4, 0.96, 0.25, 0.3),
        ])
