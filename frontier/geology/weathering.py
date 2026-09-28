"""
Weathering (sub-aerial) — chemical & physical breakdown without transport.

 - case_hardening_shell: thin hard crust (rock varnish, silica/iron cement) that
    forms on exposed surfaces, creating protective shell over softer interior.
    thickness 1-4cm, hardness +0.22 inside crust. Controls tafoni initiation.

 - tafoni_pits: honeycomb / alveolar weathering & salt crystallization.
    Initiates where case-hardening breached; salt expands in pores, spalling
    granular fragments. Self-reinforcing: pits enlarge inward, coalesce.
    Model: subtract ellipsoidal cavities clustered via Worley, protected by shell
    except where shell breached.

 - frost_wedging_grooves: ice expansion widens joints vertically; creates
    frost-shattered breccia. Strongest in freeze-thaw zones (mid-latitude, Bryce).

 - exfoliation_shells: concentric onion-skin sheets (Granite domes).

Findings from Mol & Viles ERT + Equotip: larger tafoni have hardened rims;
younger pits lack case hardening and are moisture-rich. Hardness rebound correlates
with cavity size & exposure.  Case-hardening ∝ exposure, while interior moisture
proportional to porosity.
"""
import numpy as np
from ..sdf.noise import value_noise_3d, fbm, worley

def case_hardening_shell(p, sdf_value, hardness, shell_thickness=0.04, hardening_boost=0.22, exposure_fn=None):
    """
    Returns modified hardness increased within shell_thickness of surface (where sdf_value ≈0 negative inside, positive outside).
    sdf_value: signed distance (negative inside). Shell is region -shell_thickness < sdf < 0.05
    exposure_fn optional: per-point exposure 0..1 to modulate shell thickness (windward thicker?)

    Instead of geometry offset, this boosts hardness there, which then protects against subsequent erosion.
    Return hardness_new.
    """
    # distance to surface = abs(sdf)
    dist_to_surface = np.abs(sdf_value)
    # also need inside vs outside: shell only just inside rock
    inside = sdf_value < 0
    # shell mask
    effective_thick = shell_thickness * (0.7 + 0.6*(exposure_fn(p) if exposure_fn is not None else np.ones_like(dist_to_surface)*0.5))
    in_shell = inside & (dist_to_surface < effective_thick)
    # boost hardness with smooth falloff from surface inward
    # boost = hardening_boost * (1 - (dist/effective_thick))^2
    boost = np.zeros_like(hardness)
    idx = np.where(in_shell)[0]
    if len(idx)>0:
        t = dist_to_surface[idx] / (effective_thick[idx]+1e-9)
        fall = np.clip(1 - t, 0,1)
        fall = fall*fall
        boost[idx] = hardening_boost * fall * (0.8 + 0.4*value_noise_3d(p[idx]*6.0)*0.5+0.5)  # slight variation
    # also leeward vs windward: not major
    return np.clip(hardness + boost, 0, 0.99)

def tafoni_pits(p, sdf_value, hardness_original, hardness_with_shell, breach_threshold=0.015, pit_density=4.5, pit_radius=0.18, pit_depth=0.22, case_hardening_thickness=0.04):
    """
    SDF offset for honeycomb tafoni: subtract pits where case hardening breached.
    Breach occurs where local hardness_with_shell is still low despite shell boost,
    or where exposure + salt concentration high. We approximate breach mask as:
       breached = (hardness_with_shell < 0.65) & (moisture_salt > threshold) & near surface

    Moisture/salt proxy = porosity-derived + Worley salt accumulation in concavities.
    Pits are clustered: use Worley centres as pit nuclei; pit grows inside soft interior.

    Returns SDF offset (negative = carve pit).
    """
    # moisture proxy: higher in porous soft rock, lower in hard cap
    # por ≈ 1 - hardness (first order) but also strata porosity
    # We'll approximate moisture_salt = (1 - hardness_original)*0.7 + worley_valley*0.4
    # For now use hardness_original
    N = p.shape[0]
    # Only near surface can have tafoni: |sdf| < 0.8m and inside rock (sdf<0) and within 0.5m of surface
    dist = np.abs(sdf_value)
    near_surface = (sdf_value < 0.08) & (sdf_value > -0.9)  # just inside to just outside
    # candidate mask for breaching
    # salt concentration highest in sheltered concavities & where evaporation high (arid)
    # approximate salt = worley valley + curvature (we lack curvature, use F1)
    F1, F2 = worley(p* pit_density*0.35, cell_density=1.0, jitter=1.0)
    # F1 small = near cell centre = pit nucleus center; F1 large = cell wall
    # For tafoni, pits are cells themselves, not walls: nucleus region is cavity
    # So pit = where F1 < radius scaled
    # breach modulation: pit only where hardness low / salt high
    # compute breach probability
    # moisture
    moisture = np.clip(1 - hardness_original, 0,1) * (0.6 + 0.4*F1) # actually F1 small => lower moisture? invert
    # salt accumulates in pits (feedback): salt = moisture * evaporation (exposure)
    # Use wind exposure or simple vertical: salt higher in mid-height sheltered alcoves
    # For now, salt = moisture * (0.5 + 0.5* (1 - F1*2))  # pits concentrate salt
    salt = moisture * (0.5 + 0.45*np.clip(1 - F1*2.5, 0,1))
    # breach where shell thin/broken: we compare hardness_with_shell vs original boost
    # If shell effective but still porous soft below, breach can occur via micro-cracks
    # breach likelihood = salt * (1 - hardness_with_shell) * near_surface
    breach_prob = salt * np.clip(1 - hardness_with_shell, 0,1) * (0.7 + 0.6*value_noise_3d(p*0.9))
    # also add irregular breach initiation: small holes where hard crust is punctured
    # punctures via ridged noise
    # threshold for pit activation
    breached = near_surface & (breach_prob > 0.18) & (np.random.rand(N) < 0.0 if False else True)  # we need deterministic
    # Use deterministic noise to decide puncture: value_noise_3d > threshold creates sporadic pits, not everywhere
    puncture_noise = value_noise_3d(p*2.2)  # -1..1
    # vary threshold by lithology: harder cap needs larger salt*noise to breach
    thresh = 0.18 + 0.12*hardness_with_shell
    # combine
    # For deterministic without random, pits appear where puncture_noise > -0.1 and breach_prob > thresh*0.5
    pit_mask_potential = near_surface & (puncture_noise > -0.22) & (breach_prob > thresh*0.45)

    # Now compute pit depth field: distance to nearest pit centre
    # Pit centre positions are Worley cell centres. Instead of extracting centres, use F1 as distance to nearest centre
    # Pit = F1 < pit_radius proportional to local hardness_softness
    # pit radius varies with salt & softness: larger in softer, saltier
    # also case-hardened rim protects: pit radius shrinks where hardness high
    # Effective radius
    hard_factor = np.clip(1.25 - hardness_with_shell, 0.1, 1.0)  # soft => larger
    salt_factor = np.clip(salt*2.2, 0,1) # saltier => larger
    eff_radius = pit_radius * (0.6 + 0.85*hard_factor) * (0.7 + 0.6*salt_factor)
    # F1 is distance scaled ~ world units via cell_density; convert to same units
    # Since we called worley with p*0.35* pit_density ~, F1 already in scaled space / density
    # Need to map to world: worley returns distance / cell_density? We divided by density. So physical radius comparable.
    # Use F1_world = F1 (already world)
    # So pit interior = F1 < eff_radius
    # But to get cavity depth, we compute pit depth as spherical cap distance: sqrt(r^2 - F1^2) like pit depth inward
    # However we need SDF offset that carves pit inward from surface: depth = pit_depth * (1 - F1/r) shaped
    # Apply only where pit_mask_potential or overall near breached zone
    # To simulate coalescence, we also allow pit growth where neighboring pits merge: use F2?
    # Use smooth pit shape
    inside_pit = (F1 < eff_radius) & pit_mask_potential
    # For honeycomb walls, we want walls between pits preserved as thin ribs: so not all pits merge heavily
    # That's natural with Worley: ribs are cell walls where F1 ~ distance to centre, preserved
    # Depth shape: spherical (or ellipsoidal)  depth * (1 - (F1/r)^2)
    t = np.zeros(N)
    idx = np.where(inside_pit)[0]
    if len(idx)>0:
        r = eff_radius[idx]
        d = F1[idx]
        # spherical cap
        cap = np.sqrt(np.maximum(r*r - d*d, 0))  # radius profile
        # normalize to 0..1 then scale to pit_depth
        # also modulate by hardness (harder = shallower pit)
        depth_scale = pit_depth * (0.4 + 0.8*hard_factor[idx]) * (0.6 + 0.5*salt_factor[idx])
        # ellipsoidal vertical stretch: pits slightly elongated horizontally where bedding controls
        # For strata, pits elongated along bedding (horizontal). We stretch via normal weighting (approx)
        # Simple: vertical compression 0.7
        # Not needed now
        t[idx] = cap / (r+1e-9) * depth_scale
        # add inner rough spalling texture
        spall = value_noise_3d(p[idx]*7.5)*0.018
        t[idx] += spall * (1 - d/r)
        # case-hardening rim: pit rim hardness high -> pit lip sharp, preserve rim via reducing depth near wall
        # Already via F1 near wall, depth small.
    # Additional: secondary micro-pits inside larger tafoni (nested)
    # Use second Worley at higher frequency modulated by primary pit interior
    # This creates alveoli hierarchy
    # Secondary pits only inside primary pits
    if np.any(inside_pit):
        # secondary worley higher density
        F1s, _ = worley(p[inside_pit]*pit_density*1.9*0.6, cell_density=1.0, jitter=1.0)
        secondary_r = pit_radius*0.38
        secondary_inside = F1s < secondary_r
        # secondary depth small, adds honeycomb texture on pit interior
        if np.any(secondary_inside):
            # map back indices
            sec_idx_global = idx[secondary_inside]
            sec_r_eff = secondary_r * (0.8 + 0.4*value_noise_3d(p[sec_idx_global]*3.0)*0.5+0.5)
            cap2 = np.sqrt(np.maximum(sec_r_eff**2 - F1s[secondary_inside]**2,0))
            t[sec_idx_global] += cap2/sec_r_eff * pit_depth*0.35
    # Final SDF offset: carve pit (negative)
    # Modulate by proximity to surface: pits deeper where sdf near zero, fade interior/exterior
    surface_weight = np.clip(1 - dist/0.9, 0,1)  # 1 at surface, 0 at 0.9m depth / exterior
    # Only carve where near_surface and breached region
    offset = np.zeros(N)
    # Apply only where near_surface; otherwise offset 0
    offset = -t * surface_weight
    # Ensure we don't carve hard cap excessively: attenuate where hardness_with_shell >0.82 and salt low
    hard_cap_mask = hardness_with_shell > 0.84
    offset[hard_cap_mask] *= 0.28
    return offset

def frost_wedging_grooves(p, hardness, frost_intensity=1.0, joint_spacing=3.0):
    """
    Freeze-thaw wedging: water infiltrates joints, expands 9% on freezing,
    progressively widens joints and plucks blocks. Creates vertical wedge-shaped
    grooves with frost-shattered angular debris textures.

    Depth ∝ joint proximity * (porosity * saturation) * frost cycles
    For simplicity, we reuse joint_grooves logic but with frost amplification
    and added block plucking (random block removal).
    """
    N = p.shape[0]
    # Use ridged noise to create joint-like vertical fissures
    # Already represented by joints; here add wedging expansion at top where freeze-thaw most active (elevation dependent)
    # Frost zone: high elevation or shaded? At Bryce, intense frost at 2400-2700m, upper hoodoo.
    # Approx: frost stronger at higher y (top 60% of formation)
    y_norm = (p[:,1] - np.min(p[:,1])) / (np.ptp(p[:,1])+1e-6) if np.ptp(p[:,1])>1e-6 else np.zeros(N)
    frost_zone = np.clip((y_norm -0.32)/0.68, 0,1)  # 0 bottom, 1 top
    frost_zone = np.power(frost_zone, 0.7)
    frost_zone *= frost_intensity
    # joint widening amount
    # Use underlying joint pattern: vertical Worley edges
    F1, F2 = worley(p* (0.32 + 0.1*frost_intensity), cell_density=1.0, jitter=1.0)
    ridge = F2 - F1
    wedge = np.clip(1 - ridge*2.8, 0,1)
    wedge = np.power(wedge, 1.8)
    soft = np.clip(1 - hardness, 0,1)
    depth = wedge * frost_zone * (0.18 + 0.42*soft) * 1.4
    # angular plucking: small block removal where frost most intense (top)
    pluck_noise = value_noise_3d(p*1.7)
    pluck = (pluck_noise > 0.62) & (frost_zone > 0.55) & (wedge > 0.25)
    if np.any(pluck):
        pluck_depth = 0.12 + soft[pluck]*0.14
        depth[pluck] += pluck_depth
    # chatter
    depth += value_noise_3d(p*5.2)*0.02 * wedge
    return -depth
