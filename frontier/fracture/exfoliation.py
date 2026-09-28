"""
Exfoliation onion-skin joints for granite domes / inselbergs.
"""
import numpy as np
from ..sdf.noise import value_noise_3d, fbm

def exfoliation_offsets(p, sdf_base, strata_column=None, n_shells=4, shell_spacing=1.1, shell_thickness=0.08, roughness=0.35):
    """
    Returns SDF offsets for concentric exfoliation sheets parallel to topography.
    Sheets are offset inward from surface by shell_spacing increments, with waviness.

    Method: sheet i at distance d_i = sdf_base + i*shell_spacing + warp(i) ; groove where |d_i| < thickness/2
    But sdf_base is already SDF of dome: points inside have negative distance. Sheet near surface corresponds to sdf ~ -i*spacing

    We approximate offset as sum over shells of groove depth where |sdf_base + i*spacing + warp| < thickness/2

    warp = fBm(p) * roughness to simulate sheet undulation (curved, not perfect onion).

    Thickness increases with depth due to less weathering? Actually outer shells more open due to pressure release.
    """
    offsets = np.zeros(p.shape[0])
    for i in range(1, n_shells+1):
        # target distance inward
        target = -i*shell_spacing
        # undulation
        warp = fbm(p*0.55, octaves=3, freq=0.9)*roughness*0.4
        # also radial stretch warps with height
        warp += value_noise_3d(p*0.18)*roughness*0.25
        dist_to_sheet = np.abs(sdf_base - target + warp*0.35)
        # thickness varies: outer shells slightly thicker/open
        thick = shell_thickness * (1.0 - i*0.08)  # outer thicker
        inside = dist_to_sheet < thick*0.5
        prof = np.clip(1 - dist_to_sheet/(thick*0.5+1e-9),0,1)
        prof = prof*prof*(3-2*prof)
        # depth: sheets are parting planes, carve slight groove (exfoliation joints are thin)
        # deeper near surface where unloading more
        depth = prof * 0.28 * (1.15 - i*0.14) * inside
        # sheet continuity: not through-going everywhere, create bridges where rock intact
        bridge = value_noise_3d(p*0.7) # -1..1
        bridge_factor = np.clip(0.55 + 0.45*bridge, 0.15,1.0)
        depth *= bridge_factor
        offsets -= depth
        # add lenticular scaling: sheets curve more near top of dome (higher)
        # already via warp
    return offsets
