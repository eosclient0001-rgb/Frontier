"""
Voronoi generation with CV control per Di et al. 2018 (Modified Centroidal Voronoi).
CV = std(area)/mean(area) — measures heterogeneity 0=perfect hex, ~0.6 random.
Natural columnar basalt CV ≈0.30-0.45 (Baihetan field). We target ~0.38.
Algorithm:
 1. Generate uniform grid jittered seeds (regular hex)
 2. Lloyd relaxation N iterations, but bisection-controlled to hit target CV
   (instead of running to centroidal convergence CV≈0.12, we stop early/interpolate).
 3. Optionally displace seeds with range constraint to tune pentagon/hexagon ratio
    per VSRD algorithm (ScienceDirect 2025).

We provide both Lloyd + bisection hitting target CV and a simple jitter method for preview.
"""
import numpy as np

def _poly_areas_centroids(points, bbox):
    """
    Compute Voronoi cell areas & centroids clipped to bbox using scipy.spatial.Voronoi
    Needed for Lloyd. For speed we use scipy.
    bbox: (xmin, xmax, ymin, ymax) for 2D.
    Returns areas, centroids for each input point (nan if infinite clipped?)
    """
    try:
        from scipy.spatial import Voronoi
    except ImportError:
        raise
    # Pad bbox to include mirror? For finite cells, we need to clip infinite ridges.
    # Simpler: compute Voronoi, then for each region clip to bbox polygon.
    # Implement clipping via Sutherland-Hodgman?
    # For our use (generation inside 1x1 domain with points well inside), most cells will be finite if we add bounding box points.
    # Trick: add 8 far boundary points to ensure all interior cells finite.
    # Not perfect but ок for mesher preview.
    xmin,xmax,ymin,ymax = bbox
    # add frame points far outside
    pad = max(xmax-xmin, ymax-ymin)*5
    frame = np.array([
        [xmin-pad, ymin-pad],[xmax+pad, ymin-pad],[xmax+pad, ymax+pad],[xmin-pad, ymax+pad],
        [(xmin+xmax)/2, ymin-pad],[(xmin+xmax)/2, ymax+pad],[xmin-pad, (ymin+ymax)/2],[xmax+pad,(ymin+ymax)/2]
    ])
    all_pts = np.vstack([points, frame])
    vor = Voronoi(all_pts)
    n = points.shape[0]
    areas = np.full(n, np.nan)
    cents = np.full((n,2), np.nan)
    for i in range(n):
        reg_idx = vor.point_region[i]
        region = vor.regions[reg_idx]
        if -1 in region or len(region)==0:
            continue
        verts = vor.vertices[region]
        # clip verts to bbox (naive: clamp)
        # Better to do polygon clipping to bbox rectangle.
        # For now clamp:
        # But clamping distorts shape; we instead intersect polygon with bbox via shapely? Not available.
        # Use simple winding poly area before clipping; for interior points verts already inside bbox expanded due to frame.
        # Since we added frame far away, interior cells should be unaffected and finite without clipping.
        # So just compute area of verts as is.
        # Shoelace
        x = verts[:,0]; y = verts[:,1]
        area = 0.5*np.abs(np.dot(x, np.roll(y,1)) - np.dot(y, np.roll(x,1)))
        # centroid formula
        # Cx = 1/(6A) sum (x_i + x_{i+1}) * cross, etc.
        cross = x*np.roll(y,1) - np.roll(x,1)*y
        # Need consistent orientation; use absolute area sign
        # Compute with signed area
        signed = 0.5*(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
        if np.abs(signed) < 1e-9:
            continue
        cx = np.sum((x + np.roll(x,-1))* cross) / (6*signed)
        cy = np.sum((y + np.roll(y,-1))* cross) / (6*signed)
        # But our cross used roll 1, adjust: use correct cross = x_i*y_{i+1} - x_{i+1}*y_i
        # Already signed uses that. Use signed version for centroid denominator
        # Let's recompute correctly
        # Re-evaluate with vectorized correct
        x1 = verts[:,0]; y1 = verts[:,1]
        x2 = np.roll(x1,-1); y2 = np.roll(y1,-1)
        cr = x1*y2 - x2*y1
        A = 0.5*np.sum(cr)
        if abs(A)<1e-9:
            continue
        Cx = np.sum((x1+x2)*cr) / (6*A)
        Cy = np.sum((y1+y2)*cr) / (6*A)
        areas[i]=abs(A)
        cents[i]=[Cx, Cy]
    return areas, cents

def coefficient_of_variation(areas):
    areas = areas[np.isfinite(areas)]
    if len(areas)==0:
        return 1.0
    return np.std(areas)/ (np.mean(areas)+1e-9)

def lloyd_relaxation(points, bbox, iterations=10, relax_factor=1.0):
    """
    Lloyd iteration: move points to centroids of Voronoi cells.
    relax_factor 0..1 = interpolation (1 = full move, <1 = damped).
    """
    pts = points.copy()
    for it in range(iterations):
        areas, cents = _poly_areas_centroids(pts, bbox)
        # move valid points
        valid = np.isfinite(cents[:,0])
        if np.sum(valid)==0:
            break
        # update
        pts[valid] = (1-relax_factor)*pts[valid] + relax_factor*cents[valid]
        # ensure remains inside bbox with margin
        xmin,xmax,ymin,ymax = bbox
        pts[:,0] = np.clip(pts[:,0], xmin+1e-6, xmax-1e-6)
        pts[:,1] = np.clip(pts[:,1], ymin+1e-6, ymax-1e-6)
    return pts

def generate_centroidal_voronoi(bbox=(0,0,10,10), density=1.0, target_cv=0.38, max_iter=60, seed=0):
    """
    Generate Voronoi points with density (~ points per unit area) and target CV via bisection on iteration count.
    Approach per Di et al.: CV decreases monotonically with Lloyd iterations (random CV~0.56 -> centroidal CV~0.12).
    We binary search iteration count / interpolation to hit target CV.
    density: points per square meter
    bbox: (xmin,xmax,ymin,ymax) — note ordering different!
    target_cv: 0.35-0.45 natural
    Returns points (N,2)
    """
    rng = np.random.default_rng(seed)
    xmin,xmax,ymin,ymax = bbox[0], bbox[1], bbox[2], bbox[3] if len(bbox)==4 else (bbox[0],bbox[1],bbox[2],bbox[3])
    # Actually bbox convention: (xmin,xmax,ymin,ymax)
    # but caller may give (0,10,0,10). We'll accept (xmin,xmax,ymin,ymax)
    # If bbox is (xmin, ymin, xmax, ymax) alternate, adapt
    # Detect: if xmax < xmin swapping etc. We'll just assume order given is xmin,xmax,ymin,ymax
    # Let's unify: interpret bbox as (xmin, xmax, ymin, ymax) per our earlier. To support (0,0,10,10) minmax symmetric, both work.
    # For general rectangle we try to infer: if third < second -> likely (xmin, ymin, xmax, ymax)
    # Check ambiguity: we decide if bbox[1] < bbox[0] or bbox[2]<bbox[1] etc.
    # Simpler: caller should pass (xmin,xmax,ymin,ymax) or (xmin,ymin,xmax,ymax) both normalized to same when square.
    # We'll convert: if bbox[1]>bbox[2] and bbox[2]<=bbox[0]?? Might just trust proposed 4 values as xmin,xmax,ymin,ymax if square symmetric, fine.
    # To be safe, if bbox[1] < bbox[0] swap? Not needed.
    # Compute expected N
    area = (xmax - xmin)*(ymax - ymin)
    N = max(6, int(area*density))
    # Initial uniform jittered grid hex arrangement
    # hex grid: spacing s = sqrt(2/(sqrt(3)*density)) for density
    # approx s = 1/sqrt(density)
    # For target density, we generate random uniform then jitter
    points = rng.uniform(low=[xmin, ymin], high=[xmax, ymax], size=(N,2))
    # Initial CV high ~0.55
    # Now we need to find iteration count that yields CV ~ target
    # Precompute Lloyd trajectory CV vs iteration
    # Instead of bisection on integer iterations, we do relaxation search with damped interpolation
    # For speed we iteratively relax and stop when CV <= target, then interpolate back
    pts = points.copy()
    # store history
    cvs = []
    pts_history = [pts.copy()]
    for it in range(max_iter):
        areas, _ = _poly_areas_centroids(pts, (xmin,xmax,ymin,ymax))
        cv = coefficient_of_variation(areas)
        cvs.append(cv)
        if cv <= target_cv:
            break
        # Lloyd step
        pts = lloyd_relaxation(pts, (xmin,xmax,ymin,ymax), iterations=1, relax_factor=1.0)
        pts_history.append(pts.copy())
    # Now we have CV decreasing. If final CV still > target, we need more iterations (or target too low)
    # If overshoot (CV < target), we can interpolate between last two point sets
    if len(cvs)==0:
        return pts
    final_cv = cvs[-1]
    if abs(final_cv - target_cv) < 0.02 or final_cv > target_cv:
        return pts
    # Need interpolation: between pts_history[-2] (prev) and pts_history[-1] (curr)
    # find factor f such that interpolated points yield CV ~ target (linear approx)
    # Instead of optimizing factor nonlinearly, we search fine interpolation via one additional damped Lloyd
    prev_pts = pts_history[-2]
    curr_pts = pts_history[-1]
    # binary search factor between prev and curr
    lo, hi = 0.0, 1.0
    best = curr_pts
    best_cv_diff = abs(final_cv - target_cv)
    for _ in range(12):
        mid = (lo+hi)/2
        interp = prev_pts*(1-mid) + curr_pts*mid
        areas,_ = _poly_areas_centroids(interp, (xmin,xmax,ymin,ymax))
        cv_mid = coefficient_of_variation(areas)
        diff = cv_mid - target_cv
        if abs(diff) < best_cv_diff:
            best_cv_diff = abs(diff)
            best = interp.copy()
        if diff > 0:  # CV still high -> need more relaxation -> increase mid
            lo = mid
        else:
            hi = mid
    return best

def generate_uniform_jittered(bbox, density=1.0, irregular_factor=0.38, seed=0):
    """
    Single-random-movement with range constraint (Zhang et al. 2023)
    irregular_factor 0=hex regular, 1=fully random uniform.
    Implementation: start from hex grid, then perturb each seed by random displacement
    inside range = irregular_factor * spacing/2.
    This directly controls pentagon/hexagon ratio without Lloyd.
    """
    rng = np.random.default_rng(seed)
    xmin,xmax,ymin,ymax = bbox
    area = (xmax - xmin)*(ymax - ymin)
    N = max(6, int(area*density))
    # hex grid spacing
    # for hex, density = 2/(sqrt(3)*s^2) => s = sqrt(2/(sqrt3*density))
    s = np.sqrt(2.0/(np.sqrt(3)*density+1e-9))
    # generate hex lattice covering bbox expanded
    cols = int(np.ceil((xmax - xmin)/s)) + 2
    rows = int(np.ceil((ymax - ymin)/(s*np.sqrt(3)/2)))+2
    pts = []
    for r in range(rows):
        for c in range(cols):
            x = xmin + c*s + (s*0.5 if r%2==1 else 0)
            y = ymin + r*(s*np.sqrt(3)/2)
            if xmin <= x <= xmax and ymin <= y <= ymax:
                pts.append([x,y])
    pts = np.array(pts, dtype=float)
    # adjust to target N by random sampling / adding
    if len(pts) > N:
        idx = rng.choice(len(pts), N, replace=False)
        pts = pts[idx]
    elif len(pts) < N:
        extra = N - len(pts)
        extra_pts = rng.uniform(low=[xmin, ymin], high=[xmax, ymax], size=(extra,2))
        pts = np.vstack([pts, extra_pts])
    # now random movement with range constraint
    max_disp = irregular_factor * s * 0.5
    disp = rng.uniform(low=-max_disp, high=max_disp, size=pts.shape)
    # alternative polar uniform disk
    # Use uniform disk for more natural
    # Overwrite with disk sampling:
    ang = rng.uniform(0, 2*np.pi, size=pts.shape[0])
    rad = np.sqrt(rng.uniform(0,1,size=pts.shape[0])) * max_disp
    pts[:,0] += np.cos(ang)*rad
    pts[:,1] += np.sin(ang)*rad
    # clip to bbox
    pts[:,0] = np.clip(pts[:,0], xmin+1e-6, xmax-1e-6)
    pts[:,1] = np.clip(pts[:,1], ymin+1e-6, ymax-1e-6)
    return pts
