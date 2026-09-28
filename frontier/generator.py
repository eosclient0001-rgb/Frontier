"""
Core SDF evaluation pipeline — per-point SDF that encodes all geological processes.

Pipeline order (geologically motivated, not arbitrary):
 1. Base shape primitive (hoodoo tapered tower / mesa slab / spire cone / cliff wall / columnar field / dome)
 2. Tectonic warps (fold, tilt, fault, domain warp) → deform stratigraphic coordinates
 3. Hardness field H(p) from StrataColumn + litho noise + cross-bedding
 4. Case-hardening crust boost near surface (preserves filigree ribs)
 5. Differential erosion offsets (cliff-and-bench, basal sapping, rills, aeolian fluting)
 6. Joint / columnar / exfoliation grooves (hardness-modulated aperture)
 7. Tafoni pitting (case-hardening breach dependent) & frost wedging

The final SDF is:  f_final = f_base + erosion_offsets + joint_offsets + weathering_offsets
   negative inside.

We also compute vertex-hardness for coloring (not texture): hardness-driven vertex color shows lithology,
so without textures you can still read stratigraphy.

This is NOT a lazy linear SDF: every offset is spatially varying via Worley/Voronoi and hardness.

Erosion magnitudes are in world meters (realistic scale: benches ~0.5-1.5m recession, tafoni 0.15-0.4m, joints 0.04-0.55m).
"""
import numpy as np
from .sdf.noise import fbm, value_noise_3d, domain_warp
from .sdf.primitives import sd_box, sd_capped_cylinder, sd_cone, sd_plane, op_smooth_union
from .sdf.strata import StrataColumn, make_claron_column, make_mesa_column, make_spire_sandstone_column, make_basalt_column
from .sdf.warp import tectonic_fold_warp, tilt_warp, fault_offset
from .geology.erosion import (
    cliff_and_bench_modulation, basal_sapping_undercut,
    fluvial_rill_carve, aeolian_fluting
)
from .geology.weathering import tafoni_pits, case_hardening_shell, frost_wedging_grooves
from .geology.joints import joint_grooves_sdf, columnar_joint_walls
from .fracture.columnar import generate_columnar_centers
from .fracture.exfoliation import exfoliation_offsets
from .presets import FormationPreset

# ------------------------------------------------------------
# Warp helpers that combine multiple warps deterministically
# ------------------------------------------------------------
def build_warp_fn(preset: FormationPreset):
    w = preset.warp
    fold_amp = w.get('fold_amp', 0.0)
    tilt_deg = w.get('tilt_deg', 0.0)
    tilt_azim = w.get('tilt_azim', 0.0)
    fault_throw = w.get('fault_throw', 0.0)
    domain_amp = w.get('domain_warp_amp', 0.5)
    def warp_fn(p):
        # p (N,3) -> warped (N,3)
        q = p.copy()
        if fold_amp > 1e-6:
            q = tectonic_fold_warp(q, amplitude=fold_amp, wavelength=18.0)
        if tilt_deg > 1e-6:
            q = tilt_warp(q, dip_deg=tilt_deg, dip_dir_deg=tilt_azim)
        if fault_throw > 1e-6:
            q = fault_offset(q, throw=fault_throw, heave=fault_throw*0.25)
        if domain_amp > 1e-6:
            # large scale domain warp last (lithological waviness)
            # we implement via domain_warp but at low freq
            q = domain_warp(q, warp_amp=domain_amp*0.35, warp_freq=0.055, fbm_octaves=3)
        return q
    return warp_fn

def build_strata(preset: FormationPreset) -> StrataColumn:
    # Choose column based on type but scale to preset height
    # Height is bounds y range
    ymin, ymax = preset.bounds[1]
    total_h = preset.bounds[1][1] - preset.bounds[1][0]
    # Use tighter height as strata thickness (exclude talus extra)
    # preset base height param gives more accurate
    h_base = preset.base_params.get('height', total_h*0.82)
    if preset.strata_type == 'claron':
        col = make_claron_column(total_height=h_base)
    elif preset.strata_type == 'mesa':
        cap_t = preset.base_params.get('cap_thickness', 3.0)
        col = make_mesa_column(cap_thickness=cap_t, mesa_height=h_base)
    elif preset.strata_type == 'spire':
        col = make_spire_sandstone_column(height=h_base)
    elif preset.strata_type == 'basalt':
        col = make_basalt_column(height=h_base)
    else:
        col = make_mesa_column(mesa_height=h_base)
    # If granite dome override high hardness single lith
    if preset.base_shape == 'dome':
        # make granite uniform but with exfoliation shells: hard overall 0.88
        from .sdf.strata import Stratum
        thick = h_base
        col = StrataColumn([
            Stratum("Granite core", "granite", thickness=thick, hardness=0.88, color_hint=(0.66,0.64,0.60), porosity=0.06, cementation=0.9)
        ])
    return col

# ------------------------------------------------------------
# Base SDF per shape (with geological irregularity built-in)
# ------------------------------------------------------------
def base_sdf(p, preset: FormationPreset, warp_fn=None):
    """
    Returns SDF for base shape, *before* warps? Actually we apply warps to hardness only,
    but base shape itself should also be warped geometrically? For geological folds the shape exterior
    should also deform (folded mesa top). We evaluate base SDF in warped coordinates inverse?
    Simpler: we evaluate base shape on warped p (so that shape follows tectonic deformation).
    For mesas, folding should show as warping of top surface.
    For spires, tilt affects spire lean.
    So we first warp p for shape evaluation.
    """
    # Warp p for shape if fold/tilt present? Use warp_fn but not domain warp for shape silhouette? We'll use first part.
    # However to keep SDF accurate, we approximate shape warp as additive displacement to SDF, not coordinate warp,
    # to preserve distance field quality. For now we use warped p for base.
    pw = warp_fn(p) if warp_fn is not None else p
    shape = preset.base_shape
    params = preset.base_params

    if shape == 'hoodoo':
        # Hoodoo: stem = tapered cylinder + cap = convex box/sphere union + bulges
        h = params['height']
        r_base = params['radius_base']
        r_neck = params['radius_neck']
        r_cap = params['radius_cap']
        cap_h = params['cap_height']
        # define hoodoo vertical axis centered at (0, y_center,0) ? Better base at y=0 ground.
        # Our bounds y 0..h ; so center y = height/2?
        # We'll build hoodoo as field relative to local center: translate pw so that base at y=0 sits on ground.
        # Primitive centered at y = h/2, height h, radii varying with height.
        # Use y_local = pw.y - h*0.5? But then ground plane at y=0 is bottom of hoodoo. For SDF we want hoodoo sitting on ground: bottom at y=0
        # So y_local = pw.y - h*0.5
        # But then at pw.y=0 (ground), y_local = -h/2, which is bottom; at top h, y_local=h/2
        y_local = pw[:,1] - h*0.5
        p_local = np.column_stack([pw[:,0], y_local, pw[:,2]])
        # radius as function of y_local: define profile
        # -h/2 to +h/2
        # Bottom pedastal: radius starts at r_base, quickly narrows to r_neck at ~ -h/3, stays narrow, then expands slightly to cap base, then cap overhangs.
        # Use piecewise analytic profile with smoothsteps
        t = (y_local + h*0.5)/ h  # 0 bottom,1 top
        # profile: we want narrowest at ~0.35-0.65 for hoodoo neck
        # define radius(t)
        # Bottom swell
        r = np.ones_like(t)*r_base
        # Transition bottom -> neck: 0 to 0.28
        mask0 = (t < 0.28)
        # taper bottom
        # use cosine interpolation
        # For t in 0..0.28: r = mix(r_base, r_neck+bulge, smoothstep)
        if np.any(mask0):
            tt = t[mask0]/0.28
            tt = tt*tt*(3-2*tt)
            # bottom bulge slightly
            bulge = 0.18*np.sin(tt*np.pi)  # subtle foot flare
            r[mask0] = r_base*(1-tt) + (r_neck + bulge)*tt
        # middle stem 0.28..0.72: keep near r_neck with undulations due to bedding benches (but base profile just narrow)
        mid_mask = (t>=0.28) & (t<0.72)
        if np.any(mid_mask):
            tt = (t[mid_mask]-0.28)/0.44  # 0..1
            # very subtle waist variation: narrowest at mid
            waist = np.sin(tt*np.pi)  # 0..1..0
            r[mid_mask] = r_neck - waist*0.08 + value_noise_3d(pw[mid_mask]*0.9)*0.07*params.get('bulge_amp',0.28)
            # add small benches even at base level via strata phase? Already will be via erosion, but add slight radial waviness here as seed
            r[mid_mask] += np.sin(t[mid_mask]* 18.0)*0.04
        # upper stem to cap base 0.72..0.84 : widen to r_cap*0.85
        upper_mask = (t>=0.72) & (t<0.84)
        if np.any(upper_mask):
            tt = (t[upper_mask]-0.72)/0.12
            tt = tt*tt*(3-2*tt)
            r[upper_mask] = r_neck*(1-tt) + (r_cap*0.88)*tt
        # cap region 0.84..1.0: cap is separate shape union, but for stem we keep radius at cap base slightly less, then cap overhang
        cap_mask = t>=0.84
        if np.any(cap_mask):
            tt = (t[cap_mask]-0.84)/0.16
            r[cap_mask] = r_cap*0.88*(1-tt) + r_cap*0.65*tt  # top narrows to blunt? Actually cap is distinct so stem top rounding

        # Compute SDF as radially varying cylinder: distance = hypot(x,z) - r(t) but also cap top/bottom capping
        radial = np.linalg.norm(p_local[:,[0,2]], axis=1) - r
        # vertical caps: y_local beyond ±h/2 => capped distance includes top/bottom plane
        # For SDF of variable radius shape, use generic approach: radial distance + vertical distanceOutside blend
        # Simpler: construct as stack of discs, but approximate SDF as max(radial, |y_local|-h/2) with correction
        # However variable radius shape has sloping sides; our radial+vertical method with blend gives correct for convex profiles with small slope?
        # We'll compute SDF as: if inside vertical slab (|y|<h/2) then SDF=radial
        # If above/below, SDF = length([radial+..., y_excess])
        y_excess = np.maximum(np.abs(y_local) - h*0.5, 0)
        # For points outside vertical extent, distance to top disc edge: sqrt(radial^2 + y_excess^2) where radial evaluated at cap top radius
        # For inside, y_excess=0 so SDF = radial
        # For outside, SDF = sqrt( radial_at_edge^2 + y_excess^2 ) but radial_at_edge uses r at clamped t.
        # Our radial already uses t clamped for extreme y beyond cap (t=1 gives r~0.65*r_cap) small, but top disc radius should be cap top ~ r_cap*0.65 anyway
        # So blend
        sdf_stem = np.where(y_excess>0, np.sqrt(np.maximum(radial,0)**2 + y_excess**2) + np.minimum(radial,0), radial)
        # Add cap rock shape: cap is slightly flattened ellipsoid / box with rounded edges, overhanging
        # Cap centered at y = h*0.5 - cap_h/2 ? Actually cap sits on top; top of stem at h - cap_h*? Let's place cap top at h.
        # cap center at y = h - cap_h/2 (world)
        cap_center_y_world = h - cap_h*0.5
        # Cap SDF: box with rounded edges (ellipsoid blended)
        # Use box half extents
        cap_half = np.array([r_cap, cap_h*0.5, r_cap])
        # p relative to cap center world
        p_cap = pw - np.array([0, cap_center_y_world, 0])
        # deform cap to look weathered: slight irregular top
        # Add boulder shape waviness to cap top
        cap_wav = value_noise_3d(p_cap*0.9)*0.12
        # For SDF box, we add wav to distance
        # Compute box SDF
        d_box = np.abs(p_cap) - cap_half
        outside = np.linalg.norm(np.maximum(d_box, 0), axis=1)
        inside = np.minimum(np.maximum(d_box[:,0], np.maximum(d_box[:,1], d_box[:,2])), 0)
        sdf_cap = outside + inside + cap_wav*0.55  # add wav directly
        # Round cap edges: shrink SDF slightly (bevel)
        sdf_cap -= 0.18
        # Hoodoo union stem + cap (cap overhang)
        sdf = np.minimum(sdf_stem, sdf_cap)
        # Add small pedestal base flair: ensure grounded
        # Pedestal socket: widen base at ground plane
        ground_factor = np.clip(1 - pw[:,1]/1.2, 0,1)  # 1 at ground, 0 at 1.2m up
        ground_flare = ground_factor * 0.45 * np.exp(-np.linalg.norm(pw[:,[0,2]], axis=1)/1.2)
        sdf -= ground_flare*0.3
        # Apply overall lithological roughness before erosion? Small base roughness 0.08
        sdf += value_noise_3d(pw*1.8)*0.065
        sdf += value_noise_3d(pw*6.2)*0.022
        return sdf

    elif shape == 'spire_cone':
        h = params['height']
        r_base = params['r_base']; r_mid = params['r_mid']; r_top = params['r_top']
        taper_exp = params.get('taper_exp', 0.62)
        # Spire: tall tapered tower with mildly concave sides (power taper)
        # Centered like hoodoo
        y_local = pw[:,1] - h*0.5
        p_local = np.column_stack([pw[:,0], y_local, pw[:,2]])
        t = (y_local + h*0.5)/h  # 0 bottom,1 top
        t = np.clip(t, 0, 1)  # clip for power stability (outside bounds gives negative base)
        # radius power law: r = r_base*(1-t)^exp + r_top*t? Actually for spire we want fast taper at base then near linear mid
        # Use: r(t) = lerp(r_base, r_top, t^p) with p<1 for concave
        # plus mid pinch
        tt = np.power(t, taper_exp)
        r = r_base*(1-tt) + r_top*tt
        # adjust mid: if r_mid specified, blend
        # Add subtle mid waist via sinusoidal?
        # cross-bed laminae effect: very low amplitude steps are in erosion, not base
        # Add buttresses at base: 3-4 vertical ribs that buttress spire (differential erosion precursor)
        n_buttresses = 4
        angle = np.arctan2(pw[:,2], pw[:,0])  # -pi..pi
        # buttress radius bump at cardinal directions
        buttress_phase = np.cos(angle*n_buttresses)
        # stronger at base
        height_fade = np.clip(1 - t*1.1, 0,1)  # 1 bottom, 0 near top
        buttress_amp = 0.55 * height_fade * np.clip(buttress_phase, 0,1)
        r += buttress_amp
        # small cross-bed undulation along height (aeolian dune foresets dipping)
        # gives slight stepping even before erosion
        cross = params.get('cross_bed_amp', 0.15)
        cross_und = np.sin(t* 22.0 + value_noise_3d(pw*0.35)*1.2) * cross * height_fade*0.5
        r += cross_und
        radial = np.linalg.norm(p_local[:,[0,2]], axis=1) - r
        y_excess = np.maximum(np.abs(y_local)-h*0.5, 0)
        sdf = np.where(y_excess>0, np.sqrt(np.maximum(radial,0)**2 + y_excess**2)+np.minimum(radial,0), radial)
        # cap slightly pointed, but top is flatish due to remnant cap
        # Add top cap remnant blobby
        cap_y = h -1.2
        # top overhang small
        top_dist = np.linalg.norm(pw - np.array([0, cap_y, 0]), axis=1) - 0.9
        sdf = np.minimum(sdf, top_dist*0.85 + value_noise_3d(pw*1.4)*0.07)
        # base roughness
        sdf += value_noise_3d(pw*1.1)*0.08
        sdf += ridgy(pw)*0.04 if False else value_noise_3d(pw*4.0)*0.035
        return sdf

    elif shape in ('mesa', 'butte'):
        w = params['width']; d = params['depth']; h = params['height']
        cap_t = params.get('cap_thickness', 3.2)
        edge_round = params.get('edge_round', 1.0)
        irregularity = params.get('irregularity', 0.8)
        # Mesa slab: box with cliff overhang and irregular planform (not perfect rectangle)
        # Centered at (0, h/2, 0) so bottom at y=0
        cen = np.array([0, h*0.5, 0])
        p_rel = pw - cen
        half = np.array([w*0.5, h*0.5, d*0.5])
        # Base box SDF
        db = np.abs(p_rel) - half
        outside = np.linalg.norm(np.maximum(db,0), axis=1)
        inside = np.minimum(np.maximum(db[:,0], np.maximum(db[:,1], db[:,2])), 0)
        sdf_box = outside + inside
        # irregular planform: warp xz footprint via domain noise to mimic indented cliff line from headward stream erosion
        # create 2D footprint waviness: modify db x/z before box evaluation? We already computed, so just add offset based on xz angle
        # Instead perturb SDF with fBm in xz (pad to 3D)
        footprint_wav = fbm(np.column_stack([pw[:,0], np.zeros(pw.shape[0]), pw[:,2]])*0.055, octaves=4, freq=1.2)* irregularity*1.8
        # cliff face waviness stronger at mid-height where sapping most
        height_w = np.clip(1 - np.abs(p_rel[:,1])/(h*0.5+1e-9),0,1)
        # more indent at middle
        indent = footprint_wav * (0.4 + 0.6*height_w)
        sdf_box += indent
        # Mesa top: keep flat top but add slight undulation due to caprock weathering (drainage)
        # This undulation is top-only: if near top (y approx h) add wav
        near_top = np.clip((pw[:,1] - (h - cap_t*0.5))/2.0, 0,1)  # 0 below cap,1 at top
        top_wav = fbm(pw*0.12, octaves=3, freq=1.0)*0.22 * near_top
        sdf_box += top_wav*0.4
        # cliff-and-bench edge rounding: reduce edge sharpness via bevel (already edge_round)
        sdf_box -= edge_round*0.35
        # For butte, add cap overhang: cap slightly wider than stem at top
        if shape == 'butte':
            over = params.get('cap_overhang', 1.2)
            # stem narrower: we already have butte narrower w/h but add cap overhang as additional union for top cap plate
            cap_half = np.array([w*0.5+over, cap_t*0.5, d*0.5+over])
            cap_cen = np.array([0, h - cap_t*0.5, 0])
            p_cap = pw - cap_cen
            db2 = np.abs(p_cap) - cap_half
            outside2 = np.linalg.norm(np.maximum(db2,0), axis=1)
            inside2 = np.minimum(np.maximum(db2[:,0], np.maximum(db2[:,1], db2[:,2])),0)
            sdf_cap = outside2 + inside2
            sdf_cap += fbm(pw*0.18, octaves=3, freq=0.8)*0.15
            sdf_box = np.minimum(sdf_box, sdf_cap - 0.12)
            # Also butte has talus slope at base -> we will handle via addition later exterior but for SDF add slight flair at base
            base_flare = np.clip(1 - pw[:,1]/3.0,0,1) * 1.8 * np.exp(-np.linalg.norm(p_rel[:,[0,2]], axis=1)/(w*0.4))
            sdf_box -= base_flare*0.25
        # Add overall surface roughness
        sdf_box += value_noise_3d(pw*0.9)*0.09
        sdf_box += value_noise_3d(pw*5.5)*0.028
        return sdf_box

    elif shape == 'cliff_wall':
        w = params['width']; th = params['thickness']; h = params['height']
        # Cliff wall facing +z (or along x), thickness in z. Center at origin x=0,z=0,y=h/2
        cen = np.array([0, h*0.5, 0])
        p_rel = pw - cen
        half = np.array([w*0.5, h*0.5, th*0.5])
        db = np.abs(p_rel) - half
        outside = np.linalg.norm(np.maximum(db,0), axis=1)
        inside = np.minimum(np.maximum(db[:,0], np.maximum(db[:,1], db[:,2])),0)
        sdf = outside + inside
        # cliff face waviness: heavy on front face (z = +th/2) — we want irregular face, not just box
        # Use directional warping: face offset varies with x and y (vertical + horizontal jointing)
        # Create face displacement = fBm(x*0.12, y*0.14) padded to 3D
        face_disp = fbm(np.column_stack([pw[:,0]*0.14, pw[:,1]*0.14, np.zeros(pw.shape[0])]), octaves=4, freq=1.0) * params.get('face_waviness',0.9)
        # Apply only to side where |z| near half (cliff face)
        near_face = np.exp(-np.abs(np.abs(p_rel[:,2])-th*0.5)/0.9)  # 1 at face, 0 interior
        sdf += face_disp * near_face * 0.65
        # Top irregular skyline
        top_disp = fbm(np.column_stack([pw[:,0], np.zeros(pw.shape[0]), pw[:,2]])*0.09, octaves=3, freq=1.0)*0.7 * np.clip((pw[:,1]-(h-1.2))/1.2,0,1)
        sdf += top_disp*0.5
        # Undercut alcoves at base (pre-carve): large-scale concavities via Worley
        # Use warping to create alcove seeds already via basal sapping later, but add initial cove indent
        # Simple alcove: ellipsoid subtraction at base front
        # Generate 2-3 alcoves along cliff length
        # We'll carve alcoves as subtracted ellipsoids via SDF min (union) actually we subtract via max(p, -alcove)
        # Instead we treat alcoves as deformation to SDF later via erosion; keep base sdf as box for now
        sdf += value_noise_3d(pw*1.0)*0.085
        sdf += value_noise_3d(pw*4.2)*0.032
        return sdf

    elif shape == 'columnar_field':
        w = params['width']; d = params['depth']; h = params['height']
        cen = np.array([0, h*0.5, 0])
        p_rel = pw - cen
        half = np.array([w*0.5, h*0.5, d*0.5])
        db = np.abs(p_rel) - half
        outside = np.linalg.norm(np.maximum(db,0), axis=1)
        inside = np.minimum(np.maximum(db[:,0], np.maximum(db[:,1], db[:,2])),0)
        sdf = outside + inside
        # Columnar field is initially solid lava flow block; joints will carve walls to reveal columns
        # Add flow top texture: pahoehoe ropy? Slight undulation
        top_wav = fbm(np.column_stack([pw[:,0], np.zeros(pw.shape[0]), pw[:,2]])*0.18, octaves=3, freq=1.0)*0.18 * np.clip((pw[:,1]-(h-0.6))/0.7,0,1)
        sdf += top_wav
        return sdf

    elif shape == 'dome':
        h = params['height']; r_base = params['base_radius']; r_top = params.get('top_radius',1.2)
        # Dome: half-ellipsoid + spherical cap
        # Center at base center (0,0,0) with dome apex at y=h
        # Use ellipsoidal SDF approx: scale y
        # For y>0, distance to dome surface
        # Construct as capped ellipsoid: For dome we can param: radius at y = r_base * sqrt(1 - ((h - y)/h)^2 *k) ??? simpler use sphere+cylinder blend
        # Approach: dome is portion of sphere radius R where R large.
        # Use sphere centered at (0, -R_offset, 0)
        # Choose sphere radius Rs = (r_base^2 + h^2)/(2h)  (spherical cap formula)
        Rs = (r_base**2 + h**2)/(2*h + 1e-9)
        sph_center_y = h - Rs
        p_sph = pw - np.array([0, sph_center_y, 0])
        sdf_sph = np.linalg.norm(p_sph, axis=1) - Rs
        # Intersect with half-space y>=0 (ground plane) and y <= h
        # Keep only above ground: max(sdf_sph, -y)  -> trim below ground
        sdf = np.maximum(sdf_sph, -pw[:,1])  # negative inside dome above ground
        # Intersect with cylinder at base? Sphere already extends beyond base radius at ground; we clamp base radius via additional box?
        # Actually sph at ground gives radius r_base exactly, so fine.
        sdf = np.maximum(sdf, pw[:,1]-h) * 0 + sdf  # ensure top cap? Not needed
        # Add exfoliation warp undulation before joint?
        sdf += value_noise_3d(pw*0.65)*0.09
        sdf += value_noise_3d(pw*2.5)*0.04
        return sdf

    else:
        # fallback sphere
        return np.linalg.norm(pw, axis=1) - 5.0

# ------------------------------------------------------------
# Main evaluator class
# ------------------------------------------------------------
class GeologicalSDF:
    """
    Stateful evaluator that holds preset, strata, warp, and precomputed columnar centers.
    Call evaluate(p) -> sdf, hardness, etc.
    """
    def __init__(self, preset: FormationPreset):
        self.preset = preset
        self.warp_fn = build_warp_fn(preset)
        self.strata = build_strata(preset)
        # Precompute columnar centers if needed
        self.column_centers = None
        if preset.base_shape == 'columnar_field' or 'columnar' in preset.name:
            col = preset.columnar
            diam = col.get('diameter', 1.05)
            irr = col.get('irregular_factor', 0.34)
            cv = col.get('target_cv', 0.36)
            # bbox in xz plane: use preset bounds xz
            xb = preset.bounds[0]; zb = preset.bounds[2]
            bbox = (xb[0], xb[1], zb[0], zb[1])
            # For dome/others not columnar, keep none
            self.column_centers = generate_columnar_centers(bbox=bbox, column_diameter=diam, irregular_factor=irr, target_cv=cv, method='jitter', seed=preset.seed)
        # Prepare fbm helper for hardness noise (value_noise wrapper)
        # hardness noise fn
        def hardness_noise_fn(p):
            return fbm(p*0.22, octaves=4, freq=1.0)*0.9 + value_noise_3d(p*1.5)*0.12
        self.hardness_noise_fn = hardness_noise_fn
        # Cache exposure fn for case hardening
        # exposure approximated via y height + normal proxy
        # We'll compute quickly per evaluation
        self._preset_name = preset.name

    def hardness_field(self, p):
        # Uses warped strata
        return self.strata.hardness_at(p, warp_fn=self.warp_fn, noise_fn=self.hardness_noise_fn)

    def evaluate(self, p):
        """
        p: (N,3) world coords
        Returns dict with sdf, hardness, etc. Handles all offsets.
        Steps sequential: base -> hardness -> case shell -> offsets
        """
        preset = self.preset
        # Base
        sdf_base = base_sdf(p, preset, warp_fn=self.warp_fn)
        # Hardness (before weathering)
        hardness = self.hardness_field(p)
        # Case hardening shell (need sdf proximity)
        # exposure proxy for shell thickness variation: windward thicker? Use aeolian exposure
        # Simple exposure fn: based on y and wind? We'll assume uniform for now
        def exposure_fn(pp):
            # higher exposure at top and outer
            # Use y normalized + radial
            ymin, ymax = preset.bounds[1]
            y_n = (pp[:,1]-ymin)/(ymax-ymin+1e-9)
            r = np.linalg.norm(pp[:,[0,2]], axis=1)
            exp = np.clip(y_n*0.7 + np.clip(r/8.0,0,1)*0.3,0,1)
            return exp
        hardness_shell = case_hardening_shell(p, sdf_base, hardness, shell_thickness=preset.weathering.get('case_shell',0.035), hardening_boost=0.20, exposure_fn=exposure_fn)

        # Now erosion offsets (hardness_shell modulates)
        erosion = preset.erosion
        joints_cfg = preset.joints
        weathering = preset.weathering

        # Cliff/bench
        off_bench = cliff_and_bench_modulation(p, hardness_shell, bench_amplitude=erosion.get('bench_amp',1.0), strata_column=self.strata, warp_fn=self.warp_fn)
        # Basal sapping
        off_sap = basal_sapping_undercut(p, hardness_shell, sapping_strength=erosion.get('basal_sapping',1.0), strata_column=self.strata, warp_fn=self.warp_fn)
        # Fluvial rills
        off_rill = fluvial_rill_carve(p, hardness_shell, rill_density=erosion.get('rill_density',2.8), rill_depth=erosion.get('rill_depth',0.45), vertical_stretch=erosion.get('rill_stretch',3.0), strata_column=self.strata)
        # Aeolian fluting
        wind_dir = np.array(erosion.get('wind_dir', [1,0,0.3]), dtype=float)
        off_aeol = aeolian_fluting(p, hardness_shell, wind_dir=wind_dir, wind_strength=erosion.get('aeolian_strength',0.8), flute_wavelength=erosion.get('flute_wave',1.6), flute_depth=erosion.get('flute_depth',0.28))

        # Joints
        if self.column_centers is not None:
            col_cfg = preset.columnar
            off_joints = columnar_joint_walls(p, self.column_centers, column_axis='y', wall_thickness=col_cfg.get('wall_thickness',0.055), wall_depth=col_cfg.get('wall_depth',0.42), hardness=hardness_shell, entablature_noise=True)
        else:
            # orthogonal joint sets
            set1_sp = joints_cfg.get('set1_spacing',3.2)
            set1_az = joints_cfg.get('set1_azim',0.0)
            set2_sp = joints_cfg.get('set2_spacing',3.8)
            set2_az = joints_cfg.get('set2_azim',90.0)
            set3_sp = joints_cfg.get('set3_spacing', None) if joints_cfg.get('have_set3', False) else None
            off_joints = joint_grooves_sdf(p, hardness_shell, base_depth=joints_cfg.get('base_depth',0.42), aperture=joints_cfg.get('aperture',0.08), set1_spacing=set1_sp, set1_azim=set1_az, set2_spacing=set2_sp, set2_azim=set2_az, set3_spacing=set3_sp, roughness=joints_cfg.get('roughness',0.32), frost_factor=joints_cfg.get('frost_factor',1.0))
            # For dome, add exfoliation on top of joints
            if preset.base_shape == 'dome':
                off_exfol = exfoliation_offsets(p, sdf_base, strata_column=self.strata, n_shells=4, shell_spacing=1.0, shell_thickness=0.07, roughness=0.4)
                off_joints = off_joints + off_exfol

        # Weathering
        off_tafoni = tafoni_pits(p, sdf_base, hardness, hardness_shell, pit_density=weathering.get('tafoni_density',4.5), pit_radius=weathering.get('tafoni_radius',0.18), pit_depth=weathering.get('tafoni_depth',0.22), case_hardening_thickness=weathering.get('case_shell',0.035))
        off_frost = frost_wedging_grooves(p, hardness_shell, frost_intensity=weathering.get('frost_intensity',1.0))

        # Combine offsets — note offsets are negative carves (mutually additive)
        # For tautology: deeper carve = more negative, so sum
        # However bench + sapping + rills + aeolian all compete; we sum them. This creates deep carving where multiple processes overlap (e.g., joint + soft bench = slot canyon)
        # That's geologically correct: fluvial exploits joints in soft layers
        # Weighted sum? Straight sum can exceed 2m unrealistic → clamp max erosion magnitude per point to ~1.8m to keep shape coherent
        total_offset = off_bench + off_sap + off_rill + off_aeol + off_joints + off_tafoni + off_frost
        # Clamp: max carve about 2.5m (for mesa bench) but for hoodoo keep delicate
        max_carve = 1.9 if 'hoodoo' in preset.name else 2.2 if 'mesa' in preset.name else 1.8
        total_offset = np.clip(total_offset, -max_carve, 0.45)  # allow slight outward bulge from hard cap (+)

        # Small-scale litho roughness final (granular disintegration) already partially in base, but add grain chatter
        grain = value_noise_3d(p*8.5)*0.012 + value_noise_3d(p*18.0)*0.006
        # grain modulated by hardness: softer = more granular
        grain *= (0.4 + 0.7*(1-hardness_shell))
        total_offset += grain

        sdf_final = sdf_base + total_offset

        # Also compute talus? Talus is deposition, not carve: it adds material at base, so we need SDF union with talus cone
        # For mesa/butte/spire, talus could be added as separate SDF union after. For now approximate talus via positive offset near base where slope collects?
        # Simple talus apron: where y near ground and distance from cliff large, add mound
        # Instead handle as separate mesh addition outside? We'll handle via secondary talus SDF union:
        if preset.base_shape in ('mesa','butte','spire_cone','cliff_wall','hoodoo') and preset.erosion.get('talus_angle',33)>10:
            # Estimate talus SDF contribution: talus is pile at base of cliff: sloping at ~32°, height ~3-6m outward
            # Compute talus field: talus_top_y = talus_height, radius = talus_height / tan(32°)
            # But variable along cliff perimeter. Approx use distance to cliff edge.
            # For now, approximate talus as SDF of frustum: Not exact, we add bulge near ground outside base shape
            # Use p.y and radial distance: talus_height ~3m
            talus_h = 3.5
            # compute distance to base shape's side wall? Approx via base sdf before carving? Use sdf_base as proxy for cliff position
            # Where sdf_base >0 outside cliff near ground, but within talus envelope, we want SDF to become negative (fill)
            # Define talus envelope: region near ground where sdf_base < talus_range
            # Talus thickness decays with distance from wall
            near_ground = (p[:,1] < talus_h) & (p[:,1] > -0.5)
            # distance from cliff wall approximated via sdf_base + offset? Actually outside, sdf_base positive = distance to wall
            # talus thickness = max(0, talus_h - y - dist_to_wall*tan(angle))
            # This is like conical pile: at wall base (dist=0,y=0) thickness=talus_h, tapering outward
            # For points inside cliff (sdf<0), talus not relevant (inside rock)
            # For points outside, if y < talus_thickness_at_dist then inside talus pile
            if np.any(near_ground):
                # For near_ground points, compute talus thickness
                # need dist_to_wall = sdf_base where outside? Inside we ignore
                # For outside points, dist = sdf_base (positive). For interior, dist negative, but talus not needed interior.
                dist = np.maximum(sdf_base, 0)  # outside distance
                # angle of repose ~32° => slope = tan(32)=0.624
                slope = np.tan(np.radians(preset.erosion.get('talus_angle',32)))
                thickness = talus_h - p[:,1] - dist * slope  # ??? This thickness field's zero is talus surface
                # talus SDF: points with thickness >0 are inside talus pile (negative SDF relative to talus surface)
                # Equivalent talus SDF_talus = -thickness (negative inside)
                # Then final SDF is union of rock and talus: min(sdf_final, SDF_talus)
                # But for points already inside rock (sdf_final<0), union already inside; for outside points near base, talus may bring inside
                SDF_talus = -thickness  # negative inside pile
                # Blend: only where SDF_talus negative (inside pile) and near_ground
                # Compute new sdf as min
                sdf_with_talus = np.minimum(sdf_final, SDF_talus)
                # fade talus influence where dist large and thickness negative
                # Keep only where talus provides fill outside rock: so sdf_with_talus < sdf_final implies talus filling
                sdf_final = sdf_with_talus
                # Smooth talus surface with small noise (scree irregular)
                talus_noise = value_noise_3d(p*0.55)*0.08 * np.clip(thickness/talus_h,0,1)
                sdf_final[near_ground] += talus_noise[near_ground]*0.35 * (SDF_talus[near_ground]<0).astype(float)

        # Optional base plane ground to prevent floating: intersect with ground semi-space y>=0 (keep above ground)
        # Actually we want mesh to sit on ground plane y=0: so we clip below ground (SDF = max(sdf_final, -y) ???Wait ground plane is y=0, rock above. SDF of half-space y>0 is -y? For point below ground y<0, half-space SDF = -y? Actually plane SDF = p.y (positive above). For half-space above ground, sdf_ground = -p.y? Let's define: ground surface at y=0, above is free, below is outside? But rock sits on ground, we want to keep only y>=0 portion and make base flat. So intersection with p.y >=0 half-space: SDF_ground = -p.y ? No: half-space y>=0 has SDF = -p.y (negative inside when y>0? confusion). Simpler: just clip geometry below ground via max(sdf_final, -p.y + epsilon?) Let's compute correctly: SDF for half-space y >=0: f(p) = -p.y ??? Check: point y=1 above ground: -1 negative => inside => true. Point y=-1 below: 1 positive => outside => true. So half-space inside is y>0. Rock above ground is inside half-space. Intersection of rock with half-space keeps only above ground. Intersection = max(sdf_rock, sdf_half) . So max(sdf_final, -p[:,1]) would clip below ground. Let's use -p.y with small offset.
        sdf_final = np.maximum(sdf_final, -p[:,1] + 0.02)  # slight above to avoid z-fighting

        return {
            'sdf': sdf_final,
            'sdf_base': sdf_base,
            'hardness': hardness,
            'hardness_shell': hardness_shell,
            'offsets': total_offset,
            'off_bench': off_bench,
            'off_sap': off_sap,
            'off_rill': off_rill,
            'off_aeol': off_aeol,
            'off_joints': off_joints,
            'off_tafoni': off_tafoni,
            'off_frost': off_frost,
        }

    def evaluate_hardness_only(self, p):
        return self.hardness_field(p)
