"""
Stratigraphic column — hardness profile that drives differential erosion.

Geology:
 - Each stratum has lithology, thickness, hardness 0..1, cementation, porosity
 - Dips, folds, faults encoded via warp functions before evaluation
 - Hardness field H(p) is used to modulate erosion rate:  rate ∝ (1-H)^γ
   where γ ~1.8 for sandstone/shale contrast (field measured).
 - Cliff-and-bench topography emerges automatically: resistant layers form
   vertical cliffs, recessed benches form in softer layers.

Reference: differential erosion producing mesa/butte/hoodoo:
   Hard cap (basalt/limestone/silica-cemented sandstone 0.85-0.95) protects
   softer mudstone/siltstone/tuff 0.25-0.55 below.  See:
   Livescience Mesa formation model, Utah Geological Survey hoodoo study.
"""
import numpy as np
from dataclasses import dataclass
from typing import List, Tuple

@dataclass
class Stratum:
    name: str
    lithology: str   # sandstone, limestone, shale, basalt, mudstone, siltstone, tuff, conglomerate
    thickness: float # meters
    hardness: float  # 0..1  (1 = quartzite/basalt, 0 = soft shale/tuff)
    color_hint: Tuple[float,float,float] # for vertex color debug, not texture
    porosity: float = 0.18
    cementation: float = 0.5
    # optional waviness
    top_waviness: float = 0.4
    bottom_waviness: float = 0.2

class StrataColumn:
    """
    1D stack evaluated in warped stratigraphic coordinates (z_strat).
    z_strat = undeformed height + fold + tilt + warps.
    """
    def __init__(self, strata: List[Stratum], base_elevation: float = 0.0):
        self.strata = strata
        self.base = base_elevation
        # cumulative tops
        cum = base_elevation
        self.tops = []
        self.bottoms = []
        for s in strata:
            bottom = cum
            top = cum + s.thickness
            self.bottoms.append(bottom)
            self.tops.append(top)
            cum = top
        self.total_thickness = cum - base_elevation
        self.tops = np.array(self.tops)
        self.bottoms = np.array(self.bottoms)
        self.hardnesses = np.array([s.hardness for s in strata])
        self.porosities = np.array([s.porosity for s in strata])

    def eval_stratigraphic_height(self, p_world, warp_fn=None):
        """
        Transform world p to stratigraphic height (depositional y).
        If warp_fn provided, it maps p to deformed space; we invert approximately
        by evaluating noise at p.
        To keep SDF evaluation cheap, we approximate strat height as:
            z_strat = p.y - warp_displacement_y(p_xz)
        """
        if warp_fn is None:
            return p_world[:,1]
        # warp_fn returns warped position; we need effective depositional height
        # For folding warps that shift y, the inverse is: y_strat = y_world - fold_offset(x,z)
        # Our warp functions are y-offset based, so we can compute directly:
        # Use tilted/folded evaluation: sample noise at (x,z) to get offset, subtract
        # Quick approximation: evaluate warp and subtract delta
        warped = warp_fn(p_world)
        # Effective strat height = warped.y  (since warp displaced y)
        # But we also need to account warp's x/z shifts? Those shift mapping slightly, ignore
        return warped[:,1]

    def hardness_at(self, p_world, warp_fn=None, noise_fn=None, soft_transition=0.6):
        """
        Smooth hardness field H(p) in [0,1] with interbed transitions and
        lithologic noise (bed-thickness chattering, cement spots, cross-bedding).

        Steps:
         1. Map to strat height hs
         2. Find bracketing strata via smoothstep between tops
         3. Add high-frequency hardness perturbation (±0.12) via fBm
            to model differential cementation (silica concretions etc.)
         4. Case-hardening crust: near exposed surface hardness boosted (see weathering)
        """
        hs = self.eval_stratigraphic_height(p_world, warp_fn)
        # vectorized smooth strata blend
        # For each stratum, compute weight = smoothstep inside its interval
        # Use exponential smooth blend: weight ∝ exp(-((hs - center)/sigma)^4 )
        # Simpler: trapezoidal with transition zone
        H = np.zeros(p_world.shape[0], dtype=np.float64)
        # fallback: if above top, use top hardness; if below base, use bottom hardness
        # We'll blend with smoothstep at boundaries
        # First compute per-stratum weights using smoothstep
        weights = np.zeros((p_world.shape[0], len(self.strata)))
        for i, (b,t) in enumerate(zip(self.bottoms, self.tops)):
            # transition width
            tr = soft_transition
            # weight = smooth inside [b,t] tapered at edges
            # Using cubic smoothstep: w = smoothstep(b - tr/2, b+tr/2, hs) * (1 - smoothstep(t - tr/2, t+tr/2, hs))
            a0 = np.clip((hs - (b - tr*0.5)) / tr, 0, 1)
            a0 = a0*a0*(3-2*a0)
            a1 = np.clip((hs - (t - tr*0.5)) / tr, 0, 1)
            a1 = a1*a1*(3-2*a1)
            w = a0 * (1-a1)
            # for above topmost, allow tail
            weights[:,i] = w
        # Normalize where sum<1 (outside column)
        sum_w = weights.sum(axis=1, keepdims=True)
        # outside: clamp to nearest
        outside_mask = sum_w[:,0] < 1e-6
        # for outside, set hardness to nearest stratum
        # above column -> top stratum hardness, below -> bottom
        H_inside = (weights * self.hardnesses).sum(axis=1)
        # handle outside
        # hs above top
        above = hs > self.tops[-1]
        below = hs < self.bottoms[0]
        H = H_inside.copy()
        if np.any(above):
            H[above] = self.hardnesses[-1]
        if np.any(below):
            H[below] = self.hardnesses[0]
        # normalize inside blending where sum !=1 but not outside (should sum ~1 inside)
        inside = ~above & ~below
        norm = sum_w[inside,0]
        # only where norm not ~1 due to transition overlap, renormalize
        mask_renorm = np.abs(norm -1) > 1e-3
        if np.any(mask_renorm):
            idx = np.where(inside)[0][mask_renorm]
            # recalc? just divide by norm
            H[idx] = H[idx] / norm[mask_renorm]  # but H already weighted sum, so dividing yields average hardness weighted

        # lithologic noise: differential cementation
        if noise_fn is not None:
            # noise_fn returns array in [-1,1]
            n = noise_fn(p_world)  # should be fBm-like
            # scale by porosity: more porous = more variable cementation
            # interpolate porosity at p
            por = np.zeros_like(H)
            for i, por_i in enumerate(self.porosities):
                por += weights[:,i] * por_i
            # outside por already 0, set to nearest
            por[above] = self.porosities[-1]
            por[below] = self.porosities[0]
            perturb = n * (0.08 + 0.12*por)
            H = np.clip(H + perturb, 0.05, 0.99)

        # cross-bedding laminae: thin high-frequency hardness oscillation within sandstone layers
        # simulate aeolian dune cross-sets dipping ~25deg
        # add sinusoidal variation along tilted coordinates
        # Only for sandstone/mudstone
        # Approx: hardness += 0.07 * sin( (x*cos + z*sin)*0.8 + y*1.2 ) where hardness high
        # This creates decimeter-scale resistant laminae visible as ribs
        tilt_phase = (p_world[:,0]*0.68 + p_world[:,1]*1.4 + p_world[:,2]*0.25) * 8.0
        lam = np.sin(tilt_phase) * 0.055
        # modulate by hardness (only in mid-hard sandstones 0.5-0.8)
        sand_mask = (H > 0.45) & (H < 0.82)
        H[sand_mask] += lam[sand_mask] * np.clip((H[sand_mask]-0.45)/0.35, 0,1)

        return np.clip(H, 0.02, 0.99)

    def stratum_index_at(self, p_world, warp_fn=None):
        hs = self.eval_stratigraphic_height(p_world, warp_fn)
        idx = np.digitize(hs, self.tops)  # 0..n
        idx = np.clip(idx, 0, len(self.strata)-1)
        return idx

def hardness_field(p, strata_column: StrataColumn, warp_fn=None, fbm_fn=None):
    return strata_column.hardness_at(p, warp_fn=warp_fn, noise_fn=fbm_fn)

# Convenience builder for common columns

def make_claron_column(total_height=42.0):
    """
    Bryce Canyon Claron Formation analogue:
    Alternating lacustrine limestone (hard), mudstone & siltstone (soft),
    white/pink limestone cap.
    """
    strata = [
        Stratum("Basal mudstone", "mudstone", thickness=6.0, hardness=0.32, color_hint=(0.62,0.52,0.42)),
        Stratum("Lower siltstone", "siltstone", thickness=4.5, hardness=0.38, color_hint=(0.66,0.55,0.45)),
        Stratum("Pink limestone 1", "limestone", thickness=3.0, hardness=0.78, color_hint=(0.88,0.66,0.62)),
        Stratum("Mudstone interbed", "mudstone", thickness=5.0, hardness=0.30, color_hint=(0.60,0.50,0.40)),
        Stratum("Siltstone 2", "siltstone", thickness=4.0, hardness=0.42, color_hint=(0.68,0.58,0.47)),
        Stratum("White limestone", "limestone", thickness=2.8, hardness=0.82, color_hint=(0.92,0.88,0.84)),
        Stratum("Mudstone cap base", "mudstone", thickness=6.5, hardness=0.34, color_hint=(0.61,0.51,0.41)),
        Stratum("Cap limestone / dolomite", "limestone", thickness=4.2, hardness=0.90, color_hint=(0.93,0.91,0.85)),
    ]
    # scale thicknesses to total_height
    current = sum(s.thickness for s in strata)
    scale = total_height / current
    for s in strata:
        s.thickness *= scale
    return StrataColumn(strata)

def make_mesa_column(cap_thickness=4.0, mesa_height=28.0):
    strata = [
        Stratum("Shale base", "shale", thickness=8.0, hardness=0.28, color_hint=(0.55,0.50,0.48)),
        Stratum("Siltstone", "siltstone", thickness=5.0, hardness=0.40, color_hint=(0.66,0.57,0.49)),
        Stratum("Sandstone lower", "sandstone", thickness=6.0, hardness=0.65, color_hint=(0.76,0.58,0.44)),
        Stratum("Shale interbed", "shale", thickness=4.0, hardness=0.30, color_hint=(0.57,0.52,0.50)),
        Stratum("Sandstone upper", "sandstone", thickness=5.5, hardness=0.70, color_hint=(0.77,0.60,0.46)),
        Stratum("Caprock basalt/sandstone", "basalt", thickness=cap_thickness, hardness=0.92, color_hint=(0.35,0.35,0.38)),
    ]
    cur = sum(s.thickness for s in strata)
    scale = mesa_height/cur
    for s in strata:
        s.thickness *= scale
    return StrataColumn(strata)

def make_spire_sandstone_column(height=45.0):
    # Uniform eolian sandstone with subtle bedding but no strong cap (Monument Valley Wingate)
    strata = [
        Stratum("Lower Wingate", "sandstone", thickness=15.0, hardness=0.62, color_hint=(0.78,0.55,0.42)),
        Stratum("Mid Wingate cross-bedded", "sandstone", thickness=15.0, hardness=0.66, color_hint=(0.80,0.58,0.44)),
        Stratum("Upper Wingate", "sandstone", thickness=12.0, hardness=0.72, color_hint=(0.82,0.60,0.45)),
        Stratum("Cap Kayenta remnants", "sandstone", thickness=3.0, hardness=0.84, color_hint=(0.70,0.62,0.55)),
    ]
    cur = sum(s.thickness for s in strata)
    scale = height/cur
    for s in strata:
        s.thickness *= scale
    return StrataColumn(strata)

def make_basalt_column(height=18.0):
    # Single flow: massive basalt, columnar part + entablature
    strata = [
        Stratum("Colonnade lower", "basalt", thickness=height*0.7, hardness=0.93, color_hint=(0.28,0.28,0.30)),
        Stratum("Entablature hackly", "basalt", thickness=height*0.3, hardness=0.88, color_hint=(0.32,0.32,0.35)),
    ]
    return StrataColumn(strata)
