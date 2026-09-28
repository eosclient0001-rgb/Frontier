"""
Joint & fracture SDF modifiers.

Geological joints form systematic sets:
 - Mode I extensional joints: near-vertical, orthogonal sets (90°) or conjugate (60°)
 - Columnar joints: hexagonal cells from thermal contraction (basalt, also tuff)
 - Exfoliation sheets: onion-skin joints parallel to topography (granite domes)
 - bedding-plane joints: horizontal

We encode joints as *negative displacement* to SDF (grooves) rather than mesh split
for surface detail; volumetric split is handled in fracture/ modules.

Implementation uses Worley-derived joint planes with hardness-modulated aperture:
   aperture ∝ (1 - H) * frost_cycles * salt_concentration
   depth    ∝ aperture * weathering_time
Thus softer strata have wider, deeper joints (field observation).

Columnar joints: centroidal Voronoi extrusion, hexagonal CV 0.30-0.45.
We generate seamless joint walls as SDF subtraction of thin expanded cell walls.
"""
import numpy as np
from ..sdf.noise import worley, value_noise_3d, fbm

def _periodic_joint_phase(p, spacing, azimuth_deg, dip_deg=90.0, origin_offset=0.0):
    """
    Map points to periodic joint coordinate: phase in [0, spacing) along normal direction.
    azimuth: strike azimuth (0 = N, 90=E) for vertical joints; we compute normal = strike+90
    dip: 90 = vertical, 60 = inclined
    """
    az = np.radians(azimuth_deg)
    dip = np.radians(dip_deg)
    # joint normal vector (horizontal projection)
    nx = np.cos(az + np.pi/2)  # normal to strike
    nz = np.sin(az + np.pi/2)
    # inclined joints: normal tilted from vertical
    # distance to joint plane = n·p + tan(90-dip)*y
    # for vertical dip=90, tan=0
    # for dip 70, tilt 20deg from vertical
    tilt = 1.0/np.tan(dip) if dip>1e-3 else 0.0  # actually cot(dip)
    # distance
    d = p[:,0]*nx + p[:,2]*nz + p[:,1]*tilt*np.cos(az)  # simplified tilt along dip dir
    d += origin_offset
    # periodic wrap with perturbation
    phase = np.mod(d, spacing)
    # disturbance: waviness along strike
    wav = value_noise_3d(p*0.15) * spacing*0.08
    phase = np.mod(d + wav, spacing)
    return phase, d

def joint_grooves_sdf(p, hardness, base_depth=0.4, aperture=0.08,
                      set1_spacing=3.2, set1_azim=0.0, set1_dip=90,
                      set2_spacing=3.8, set2_azim=90.0, set2_dip=90,
                      set3_spacing=None, set3_azim=45.0,
                      roughness=0.35, frost_factor=1.0):
    """
    Returns SDF offset (negative = carve groove).
    Two orthogonal joint sets by default, optional third (diagonal conjugate).
    Hardness modulates depth/aperture: softer → deeper/wider.
    Returns array shape (N,) additive offset to SDF (negative carves).
    """
    N = p.shape[0]
    offset = np.zeros(N)

    # Per-set groove: distance to nearest plane -> inverted triangular groove
    # groove profile = max(0, aperture/2 - |phase - spacing/2|) -> mapped to depth
    # perturb aperture by lithology noise

    def apply_set(spacing, azim, dip):
        phase,_ = _periodic_joint_phase(p, spacing, azim, dip)
        dist_to_plane = np.minimum(phase, spacing - phase)  # 0 at plane, spacing/2 mid-block
        # aperture varies with hardness and pre-existing waviness
        # aperture_eff = aperture * (0.5 + 1.5*(1-H)) * (1+ frost)
        # but we need per-point hardness
        local_aperture = aperture * (0.55 + 1.3*(1-hardness)) * (0.7 + 0.6*frost_factor)
        # groove depth shaped: depth = base_depth * (1 - hard) * profile
        # profile triangular smoothed with quintic
        # width = local_aperture
        # depth factor: linear inside aperture
        inside = dist_to_plane < (local_aperture*0.5)
        # triangular: 1 at plane, 0 at aperture/2
        prof = np.clip(1.0 - (dist_to_plane / (local_aperture*0.5 + 1e-6)), 0, 1)
        prof = prof*prof*(3-2*prof)  # smooth
        # depth also varies along joint trace due to rock bridges (intact rock between joints)
        # add gap where joint is not through-going
        # bridge noise: pits and bridges along strike
        bridge = value_noise_3d(p*0.35)  # -1..1
        bridge_factor = np.clip(0.6 + 0.4*bridge + roughness*value_noise_3d(p*1.2)*0.3, 0.15, 1.0)
        # also exploit bedding: horizontal joints reduce vertical penetration
        depth = base_depth * (0.3 + 0.9*(1-hardness)) * prof * bridge_factor
        # rough walls: high-freq chatter inside groove
        if roughness>0:
            chatter = value_noise_3d(p*3.5)*0.07*roughness
            depth += chatter*inside
        return -depth  # negative offset carves

    offset += apply_set(set1_spacing, set1_azim, set1_dip)
    offset += apply_set(set2_spacing, set2_azim, set2_dip)
    if set3_spacing is not None:
        offset += apply_set(set3_spacing, set3_azim, 90)

    # bedding joints (horizontal) — differential opening at layer boundaries
    # Evaluate stratigraphic boundaries near: we already have hardness gradient
    # Horizontal joints are more open in shale/mudstone caps
    # Add subtle horizontal groove where hardness changes abruptly
    # hardness gradient approximated via vertical derivative? Use sin via layer periodicity
    # Instead, add low-amplitude horizontal etching every ~1.2m modulated
    # create layered parting: depth in soft layers enhanced
    # horizontal phase
    horiz_phase = np.mod(p[:,1], 1.1)
    horiz_dist = np.minimum(horiz_phase, 1.1 - horiz_phase)
    horiz_aperture = 0.06 * (0.4 + 0.8*(1-hardness))
    horiz_inside = horiz_dist < horiz_aperture*0.5
    horiz_prof = np.clip(1 - horiz_dist/(horiz_aperture*0.5+1e-6),0,1)
    horiz_depth = 0.18 * (0.2 + 0.9*(1-hardness)) * horiz_prof * horiz_inside
    offset -= horiz_depth*0.5

    return offset  # negative

def columnar_joint_walls(p, cell_centers, column_axis='y', wall_thickness=0.06, wall_depth=0.5, hardness=None, entablature_noise=True):
    """
    SDF carve for columnar basalt walls.
    p: (N,3) sample points
    cell_centers: (M,2 or 3) Voronoi seed positions in horizontal plane (x,z) or (x,y,z) if hackly entablature
    Approach: for each p, compute distance to nearest Voronoi edge.
    We approximate by computing F1,F2 from Worley-like. But with custom centers, we brute-force nearest 2 centers.
    For N up to 2M, brute O(N*M) too heavy. So we use chunked KDTree if scipy available, else grid hashing.
    Simplified: we compute horizontal distance only (projection onto plane perpendicular to column_axis).
    Wall = distance_to_edge < thickness/2  => carve groove depth.
    """
    try:
        from scipy.spatial import cKDTree
        has_kdtree=True
    except Exception:
        has_kdtree=False

    if column_axis == 'y':
        proj = p[:,[0,2]]
        centers_proj = cell_centers[:,[0,2]] if cell_centers.shape[1]>=2 else cell_centers
    elif column_axis == 'x':
        proj = p[:,[1,2]]
        centers_proj = cell_centers[:,[1,2]]
    else:
        proj = p[:,[0,1]]
        centers_proj = cell_centers[:,[0,1]]

    N = proj.shape[0]
    if has_kdtree:
        tree = cKDTree(centers_proj)
        # k=2 nearest
        dists, inds = tree.query(proj, k=2, workers=-1)
        # dists shape N,2
        d1 = dists[:,0]
        d2 = dists[:,1]
        # distance to Voronoi edge ~= (d2 - d1)/2  for points inside cell? Actually for point near edge, diff small.
        # More accurate: for point p, distance to edge = (||p - c2|| - ||p - c1||)/2 projected onto line between centers?
        # Approx use (d2 - d1)/2 as wall distance indicator (0 at edge).
        # Need true distance: |(d2^2 - d1^2)/(2*center_dist) ??? but diff/2 works for nearby edge.
        edge_dist = (d2 - d1)*0.5
        # But for interior points, this is roughly distance to edge along direction to 2nd nearest; underestimate.
        # Refine: actual edge is bisector plane. Distance to bisector = | (p - mid)·unit | where mid = (c1+c2)/2
        # Compute vectorized:
        c1 = centers_proj[inds[:,0]]
        c2 = centers_proj[inds[:,1]]
        mid = (c1 + c2)*0.5
        n = c2 - c1
        n_norm = np.linalg.norm(n, axis=1) + 1e-9
        n_unit = n / n_norm[:,None]
        # signed distance to bisector line: (proj - mid)·n_unit
        signed = np.sum((proj - mid)*n_unit, axis=1)
        # edge distance is absolute signed distance if the 2nd nearest is indeed the neighboring cell across that edge.
        # For points not near that edge, signed may be large positive inside own cell.
        # We use min of computed signed abs and (d2-d1)/2
        edge_dist2 = np.abs(signed)
        # take smaller (more conservative)
        edge_dist = np.minimum(edge_dist2, (d2 - d1)*0.5)
        # also clamp: if point is farther than center_dist/2, it's deep inside, edge dist ~ d_to_cell wall approx? but ok
    else:
        # fallback brute chunked 4k at a time using numpy broadcasting
        edge_dist = np.full(N, 1e9)
        chunk = 4000
        for i in range(0, N, chunk):
            sl = slice(i, min(i+chunk, N))
            pp = proj[sl, None, :]  # chunk,1,2
            cc = centers_proj[None, :, :]  # 1,M,2
            d = np.linalg.norm(pp - cc, axis=2)  # chunk,M
            # partition to get 2 smallest per row
            # argsort per row small M ~ 100-300 so okay
            part = np.argpartition(d, 1, axis=1)[:,:2]
            # need actual values sorted
            d_sel = np.take_along_axis(d, part, axis=1)
            # sort within 2
            d_sorted = np.sort(d_sel, axis=1)
            ed = (d_sorted[:,1] - d_sorted[:,0])*0.5
            edge_dist[sl] = ed

    # wall thickness modulated by depth along column (entablature hackly near top)
    # basalt columns: lower colonnade straight, upper entablature curvy/bent
    if entablature_noise and hardness is not None:
        # column height: assume entablature is top 30% where hardness slightly lower and waviness high
        # waviness = fbm along column axis
        y_norm = (p[:,1] - p[:,1].min()) / (np.ptp(p[:,1])+1e-6) if np.ptp(p[:,1])>1e-6 else np.zeros(N)
        # bend factor
        bend_wav = fbm(p*0.6, octaves=3, freq=0.7)*0.12
        # effective wall thickness wobbles in entablature
        wall_thickness_eff = wall_thickness * (1.0 + 0.6*bend_wav + 0.9*np.clip((y_norm-0.68)/0.32,0,1)*0.6)
    else:
        wall_thickness_eff = wall_thickness

    # groove depth: walls are open joints, carve inward
    # profile: triangular smoothed, depth tapers from 0.5 at surface to 0 near interior?
    # For visualization, carved depth ~ wall_depth * (1 - hardness_factor)
    # basalt hardness 0.9 -> shallower, but joints still open due to cooling
    inside_wall = edge_dist < wall_thickness_eff*0.5
    prof = np.clip(1 - edge_dist/(wall_thickness_eff*0.5+1e-6), 0,1)
    prof = prof*prof*(3-2*prof)
    # depth: basalt column joints are deep ( meters) but for mesh we scale to decimeters of carving
    # hardness mod: less hard in entablature => more open
    hard_factor = hardness if hardness is not None else 0.9
    depth_scale = wall_depth * (0.5 + 0.7*(1-hard_factor))  # 0.5..1.2 multiplier
    # add striae (horizontal chisel marks) perpendicular to column axis
    # striae spacing ~ 0.2-0.4m vertical, small amplitude 0.01
    if column_axis=='y':
        stria_phase = np.mod(p[:,1]*4.2 + value_noise_3d(p*0.8)*0.5, 1.0)
        stria = np.sin(stria_phase*2*np.pi)*0.012
        # stria only inside wall groove
        stria *= inside_wall
    else:
        stria=0
    carve = -prof * depth_scale * inside_wall.astype(float) + stria*prof*0.3
    # Add transverse joints (horizontal cooling cracks) every 0.6-1.8m
    # these are secondary walls perpendicular to column axis
    trans_spacing = 1.2 + value_noise_3d(p*0.2)*0.5
    # use same hardness mod
    # Horizontal groove: distance to nearest transverse plane
    # Create pseudo-regular spacing with perturbation
    # Approximate: trans_phase = mod( y + noise, spacing)
    # For y-axis columns, horizontal planes at y = k*spacing + offset per column
    # offset per column = hash of nearest center
    # Need per-point offset: get cell id (nearest center index)
    if has_kdtree:
        # inds already nearest
        col_id = inds[:,0]
        # hash col_id to offset 0..spacing
        # simple: pseudo random offset via sin
        col_hash = np.sin(col_id*127.13 + col_id*  311.7)*0.5+0.5
        trans_offset = col_hash * trans_spacing
        y_adj = p[:,1] + trans_offset  # vary plane position per column
        trans_phase = np.mod(y_adj, trans_spacing)
        trans_dist = np.minimum(trans_phase, trans_spacing - trans_phase)
        trans_thick = wall_thickness_eff*0.9
        trans_inside = trans_dist < trans_thick*0.5
        trans_prof = np.clip(1 - trans_dist/(trans_thick*0.5+1e-6),0,1)
        trans_prof = trans_prof*trans_prof*(3-2*trans_prof)
        trans_depth = trans_prof * depth_scale*0.65
        carve -= trans_depth * trans_inside
    return carve
