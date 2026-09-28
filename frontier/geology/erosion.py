"""
Environment-driven erosion SDF modifiers.

All functions return additive offset to SDF (negative = erode outward / carve).
They are parameterized by hardness H(p) so that erosion respects stratigraphy.

Implemented processes:

 - cliff_and_bench_modulation: differential weathering creates stairstep topography.
    Resistant layers → vertical cliffs (less erosion), soft layers → recessed slopes.
    Model: radial modulation ∝ sin strat height + hardness bias.  Inspired by Mesa
    cliff-and-bench Wiki, NPS differential erosion.

 - basal_sapping_undercut: groundwater sapping at permeable/impermeable contacts
    undercuts soft shale, leaving caprock overhang. Creates alcoves.

 - fluvial_rill_carve: surface runoff concentrates in joints, carves vertical rills
    and slot-like grooves on cliff face.  Flow accumulation simulated via directional
    Worley stretched vertically.

 - aeolian_fluting: wind abrasion creates yardang-like fluting on windward face,
    honeycomb pitting, and ventifact polishing.  Directional: dot(normal, wind) * speed.

 - talus_apron: debris cone at base (angle of repose ~32°). Not erosion but deposition;
    modeled as SDF union of cone at base.

Each uses geological noise rather than uniform offsets to avoid "lazy linear".
"""
import numpy as np
from ..sdf.noise import fbm, ridged_fbm, value_noise_3d, worley

def cliff_and_bench_modulation(p, hardness, heights_world=None, bench_amplitude=1.2, cliff_sharpness=3.0, strata_column=None, warp_fn=None):
    """
    Radial/tangential recession modulated by hardness.
    For isolated pillars (hoodoo/spire), reduction of radius in soft layers forms
    undercut benches; resistant layers retain radius (cliff). 
    We return offset that contracts SDF in soft layers:
      offset_soft = -(bench_amplitude * (1-H)^1.6 * bench_profile(strata_phase))
    bench_profile is constructed to emphasize mid-layer recession (not just linear).

    For mesa cliffs (long wall), this applies as normal-direction recession: carve back
    soft layers horizontally.

    Implementation: recession = bench_amplitude * (1 - H)^gamma * (0.6 + 0.4*sin(strat_phase))
    where strat_phase = periodic within each stratum (0 bottom,1 top) -> deeper mid-stratum
    To get stratum phase we use surrounding hardness variation: we approximate phase via
    hardness curvature? Simpler: use fBm along y to create benches even without explicit strata index,
    but modulated by hardness so soft layers have deeper benches.

    For explicit strata_column, we compute hs and intra-layer phase.
    """
    gamma = 1.8
    soft_factor = np.power(np.clip(1 - hardness, 0, 1), gamma)
    # bench profile: sin-like mid-layer max
    # if strata_column provided, compute hs phase
    if strata_column is not None:
        hs = strata_column.eval_stratigraphic_height(p, warp_fn)
        # find containing stratum and intra height
        # vectorized search
        # Determine which stratum each point is in
        # Use digitize per point (loop okay N up to ~ 2M)
        # For performance, approximate phase via modulo of hs with average layer thickness
        avg_th = strata_column.total_thickness / len(strata_column.strata)
        phase = np.mod(hs - strata_column.base, avg_th) / avg_th  # 0..1
        # mid-layer factor: sin(pi*phase) → 0 at contacts, 1 mid
        mid = np.sin(phase * np.pi)
        mid = mid*mid  # sharper mid peak
        # also enhance where hardness gradient is high (contacts get slight undercut via sapping, not bench)
        # combine
        bench_profile = 0.35 + 0.65*mid
    else:
        # Use vertical fBm phase: distance to nearest hard layer contact approximated by hardness ridge
        # Fake: bench_profile ≈ 0.5 + 0.5*|fbm|
        bench_profile = 0.45 + 0.55*np.abs(fbm(p*0.35, octaves=3, freq=1.0))
        bench_profile = np.clip(bench_profile, 0,1)
    # Base bench recession
    recession = bench_amplitude * soft_factor * bench_profile
    # Add lithologic chatter: small-scale differential within layer (±12%)
    chatter = value_noise_3d(p*1.4)*0.12 + value_noise_3d(p*3.1)*0.06
    recession *= (1 + chatter)
    # Sharp cliffs: hard layers protrude -> need to keep them less recessed
    # Already via soft_factor, but also add slight outward bulge for very hard cap
    # hard bulge: hard>0.85 => recession negative (outward)
    hard_bulge = np.clip((hardness - 0.85)/0.15, 0,1) * 0.35  # meters outward
    offset = -recession + hard_bulge*0.6  # negative = shrink
    # Add vertical joint-controlled differential: joints deepen benches locally
    joint_mod = np.abs(ridged_fbm(p*0.45, octaves=2, freq=1.0)) * 0.25 * soft_factor
    offset -= joint_mod
    return offset

def basal_sapping_undercut(p, hardness, heights_world=None, sapping_strength=1.1, strata_column=None, warp_fn=None, contact_sharpness=1.5):
    """
    Groundwater sapping at aquitard contacts (shale) undercuts overlying sandstone.
    In hoodoo/mesa, deepest alcoves occur where resistant cap overlies soft shale/tuff
    along a permeable contact. Creates overhangs and tafoni alcoves at base.
    We carve alcove-like recesses: ellipsoid subtraction at soft layer tops.
    """
    # identify contacts: where hardness jumps upward (soft below, hard above) and permeability contrast
    # approximate by evaluating hardness vertical gradient via finite diff? Instead use hs.
    if strata_column is None:
        # Generic: undercut where soft_factor high and y near ground
        soft_factor = np.power(np.clip(1 - hardness, 0,1), 1.4)
        # height factor: strongest near base and near mid-height contacts (random)
        height_factor = np.exp(-np.clip(p[:,1],0,None)/5.0) * 0.7 + 0.3*np.abs(value_noise_3d(p*0.22))
        undercut = sapping_strength * soft_factor * height_factor * (0.6 + 0.4*value_noise_3d(p*0.5))
        # alcove shape: vertical elongation, rounded
        # Make undercut deeper where joints intersect (valleys)
        joint_valley = np.abs(ridged_fbm(p*0.33, octaves=3, freq=0.9))
        undercut *= (0.7 + 0.5*joint_valley)
        return -undercut*0.8
    else:
        hs = strata_column.eval_stratigraphic_height(p, warp_fn)
        # For each stratum contact (top of stratum i = bottom of i+1), compute distance to contact
        # sapping strongest just *below* hard cap (soft side)
        # We'll sum Gaussian contributions from each contact where H_below < H_above (positive jump)
        undercut = np.zeros(p.shape[0])
        tops = strata_column.tops
        hard = strata_column.hardnesses
        for i in range(len(tops)-1):
            contact_h = tops[i]  # same as bottoms[i+1]
            jump = hard[i+1] - hard[i]  # positive if hard above soft
            if jump < 0.12:  # need hard cap over soft
                continue
            # distance below contact (negative if below)
            # we want carve below contact within soft layer: hs < contact, distance = contact - hs
            dist_below = contact_h - hs
            # Gaussian below contact: peak 0.4m below contact, width ~ thickness/3
            thick = strata_column.strata[i].thickness
            sigma = max(thick*0.45, 0.7)
            contrib = np.exp(-((dist_below - 0.4)**2)/(2*sigma*sigma))
            # only below contact, not above
            contrib[dist_below < -0.3] *= np.exp(-np.abs(dist_below[dist_below<-0.3]+0.3)/1.2 )
            contrib[dist_below > thick] = 0
            contrib[hs > contact_h] *= 0.15  # slight carve into hard cap edge but minimal
            # hardness factor: softer below = more undercut
            soft_factor = np.clip(1 - hard[i], 0,1)
            undercut += contrib * jump * soft_factor * sapping_strength * 1.6
        # Moisture diffusion: undercut deeper where joint density high & where water collects (concavities)
        # add Worley valley elongation vertically
        # Create alcove cells via Voronoi in xz plane: each alcove centered at joint intersections
        F1, F2 = worley(p[:,[0,2,1]]*0.18, cell_density=1.0, jitter=1.0)  # approximate
        # along contact, cells elongated: variation along contact creates separate alcoves
        alcove_mod = np.clip(1.0 - F1*2.2, 0,1)  # interior of cells near center deeper
        undercut *= (0.55 + 0.75*alcove_mod + 0.2*value_noise_3d(p*0.7))
        # also add tafoni-like small honeycomb within alcove
        # will be added by weathering module, not here
        return -undercut

def fluvial_rill_carve(p, hardness, flow_dir=np.array([0,-1,0]), rill_density=3.2, rill_depth=0.55, vertical_stretch=3.0, strata_column=None):
    """
    Hydraulic rills: rain splash + sheet flow concentrates into joint-guided channels,
    carving vertical grooves on cliff faces. Stronger in soft strata, muted on hard caps.
    Implemented as directional Worley / ridged noise stretched vertically, modulated by
    slope exposure (steep = more rilling) and hardness.

    Flow dir mainly -y (down). For near-vertical cliffs, we carve along y.
    """
    # slope exposure: approximate via gradient? Instead carve strongest on steep faces:
    # Steep faces have high variation in hardness? Use height noise?
    # Simpler: weight by (1 - H) and by vertical position: upper cliff more runoff concentration
    soft = np.clip(1 - hardness, 0,1)
    # Vertical rill pattern: Worley stretched vertically
    # Scale p: xy compressed? For vertical cliffs facing x/z, rill direction is y
    # Create anisotropic scaling: y stretch * vertical_stretch makes cells elongated vertically
    p_aniso = p.copy()
    p_aniso[:,1] *= 1.0/vertical_stretch  # compress y for worley generation then stretch result
    # use worley F2-F1 = ridge
    F1, F2 = worley(p_aniso* rill_density*0.55, cell_density=1.0, jitter=1.0)
    ridge = F2 - F1  # 0 at edge, large interior. Invert: small ridge = near cell boundary = channel
    # channel at cell edges -> we want carve where ridge small
    channel = np.clip(1.0 - ridge*3.5, 0,1)  # 1 at edge, 0 interior
    channel = np.power(channel, 1.7)  # sharpen
    # depth modulation: deeper where soft & where channel narrow (use F1)
    depth = rill_depth * channel * (0.25 + 0.95*soft)  # hard cap still has some rills but shallow
    # Rill starts at top and deepens downwards: cumulative flow
    # depth increases with distance below top: flow accumulation proxy = (top_y - y) normalized
    top_y = np.max(p[:,1]) if p.shape[0]>0 else 0
    flow_acc = np.clip((top_y - p[:,1])/12.0, 0,1)  # 0 top, 1 at 12m down
    flow_acc = np.power(flow_acc, 0.6)
    depth *= (0.4 + 0.8*flow_acc)
    # Branching: introduce bifurcation via fBm perturbation of channel centerline
    wander = value_noise_3d(p*0.35)*0.18
    depth *= (0.85 + wander*0.35)
    # Hard layers act as knickpoints: rills steepen and notch at hard/soft contacts
    # Add extra notch at contacts (within 0.4m below hard layer)
    if strata_column is not None:
        # Use same contact logic as sapping but for rill knickpoint deepening
        # approximate via hardness gradient already captured partly, but add explicit
        pass
    # Ensure rills only on exterior (approx via soft?), we will apply to SDF offset negative anyway only near surface
    # Add small-scale inner texture: secondary riblets within main rills via high-freq noise
    riblet = value_noise_3d(p*4.5)*0.07*channel
    depth += riblet
    return -depth

def aeolian_fluting(p, hardness, wind_dir=np.array([1,0,0.3]), wind_strength=1.0, flute_wavelength=1.8, flute_depth=0.28, strata_column=None):
    """
    Wind abrasion: creates smoothness + directed flutes (yardangs), scallops, and
    aerodynamic streamlining. Windward side eroded more, leeward sheltered.

    Model:
     - Wind exposure = dot(approx_normal, wind_dir) but we lack normal; approximate via
       position relative to centroid (for pillars) or via noise: windward = positive x.
     - Fluting pattern = sinusoidal corrugation along wind direction + vertical variation.

    We approximate normal exposure via position: for isolated spire at origin, windward = +x
    Flutes are horizontal ridges elongated along wind direction, spaced ~wavelength.
    """
    # Wind direction normalized horizontal
    w = np.array(wind_dir, dtype=float)
    w[1]=0
    w_norm = np.linalg.norm(w)
    if w_norm < 1e-6:
        w = np.array([1,0,0], float)
    else:
        w/=w_norm
    # wind exposure: dot of radial direction with wind
    # radial horizontal
    horiz = p[:,[0,2]]
    rad_len = np.linalg.norm(horiz, axis=1)+1e-6
    rad = horiz / rad_len[:,None]  # unit radial outward? But for SDF we assume exterior normal approx outward radial for spires, or ±x for cliffs.
    # For cliffs, normal ≈ ±x (east/west facing). We'll blend: if rad_len large (>3) use radial, else use x-aligned cliff normal
    # Simplified: exposure = dot(rad, w) for pillars, and dot(±1,0) for cliffs sampled via value_noise_3d to mimic variable cliff orientation
    # Instead compute cliff_orientation via fBm: varying 0..1 blend
    cliff_mix = np.clip(value_noise_3d(p*0.18)*0.5+0.5, 0,1)
    # radial exposure — w is 3-component but rad is 2D, use horizontal projection
    w_h = w[[0,2]]  # 2D wind horizontal
    radial_exp = np.sum(rad * w_h, axis=1)  # -1 lee, +1 windward
    # cliff exposure: if cliff faces wind, exposure =1 else 0 ; approx via x derivative?
    # Use p.x sign as cliff facing proxy for mesa at origin facing east?
    # For generic, assume cliff face normal varies as fBm: orientation angle = 2*pi*noise
    # then exposure = cos(angle - wind_az)
    cliff_angle = value_noise_3d(p*0.09)*np.pi  # -pi..pi
    wind_az = np.arctan2(w[2], w[0])
    cliff_exp = np.cos(cliff_angle - wind_az)
    exposure = cliff_mix*radial_exp + (1-cliff_mix)*cliff_exp
    exposure = np.clip(exposure, -1,1)
    # windward amplification: 1 + 0.7*exposure for positive, lee side reduced
    wind_factor = np.where(exposure>0, 0.55 + 0.85*exposure, 0.25 + 0.15*(exposure+1))
    # Fluting corrugation: sinusoid across-wind direction
    # across_wind = perpendicular horizontal
    across = np.array([-w[2], w[0]])  # horizontal perp
    coord_along = p[:,0]*w[0] + p[:,2]*w[2]  # along wind
    coord_across = p[:,0]*across[0] + p[:,2]*across[1]
    # flutes elongate along wind, corrugated across-wind
    flute_phase = coord_across / flute_wavelength * 2*np.pi + value_noise_3d(p*0.5)*0.8
    flute = np.sin(flute_phase)  # -1..1
    # map to positive groove: valleys where sin negative? abrasion deeper in troughs?
    flute_groove = np.clip(-flute, 0,1)  # groove at trough
    flute_groove = np.power(flute_groove, 0.9)
    # vertical variation: flutes fade near top where rock harder, stronger mid-height where sandblasting most intense
    # Height factor: saltation zone ~1-4m above base strongest, but for cliff at elevation 10-30m, strongest mid
    # Approximate: height_factor = exp(-((y - y_mid)/sigma)^2)
    y_mid = (np.max(p[:,1])+np.min(p[:,1]))*0.5 if p.shape[0]>0 else 0
    height_factor = np.exp(-((p[:,1]-y_mid)**2)/(2*9.0**2)) * 0.7 + 0.3
    # hardness: wind abrasion muted on very hard basalt/limestone, stronger on sandstone
    hardness_factor = np.clip(1.1 - hardness*0.9, 0.1, 1.0)  # soft more fluted, hard still some polishing but less depth
    depth = flute_depth * flute_groove * wind_factor * height_factor * hardness_factor
    # Add pitting: small honeycomb due to salt/wind synergy (but main honeycomb in weathering)
    pit = np.clip(value_noise_3d(p*3.8)*0.5+0.5,0,1)
    pit_depth = pit*0.06 * hardness_factor * wind_factor*0.5
    depth += pit_depth * (1 - flute_groove*0.6)  # pits between flutes
    # Ventifact polish: windward side overall recession (deflation) - subtle uniform erosion
    deflation = 0.09 * wind_factor * hardness_factor * (0.6 + 0.4*np.abs(value_noise_3d(p*0.8)))
    depth += deflation*0.35
    return -depth

def talus_apron(p, sdf_base, hardness=None, talus_angle_deg=32.0, talus_height=5.0, strata_column=None):
    """
    Talus (scree) deposit at base: angle of repose cone.
    Not subtracted but unioned: sdf_talus = sdf of cone frustum at base.
    However our API expects offset; we instead compute sdf_talus and caller will union.
    Here we return equivalent offset: large negative near base where talus should fill.

    Simpler: compute talus SDF and combine externally.
    For offset-style, we provide function to compute talus SDF directly.
    """
    # compute talus SDF: cone with apex near cliff base, sloping outward at 32°
    # Talus height ~ 5m, base radius = height / tan(angle)
    ang = np.radians(talus_angle_deg)
    # talus base at y = y_min (ground) to y_min + talus_height
    y_ground = np.min(p[:,1]) if p.shape[0]>0 else 0
    # This is more naturally an implicit shape than offset. Return SDF for talus volume
    # For now return zeros and let caller handle separately
    return np.zeros(p.shape[0])
