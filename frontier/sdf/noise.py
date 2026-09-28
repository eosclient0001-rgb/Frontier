"""
Procedural noise without external deps. Hash-based value noise + gradient-friendly fBm.
Designed for domain warping and lithological variation — not a lazy value lookup.
Implements:
 - hash33 / hash21 (pcg-style)
 - value noise with quintic smoothing
 - fBm with lacunarity/gain + ridged variant
 - Worley / Voronoi F1,F2 for fracture seeds & tafoni pits
 - domain_warp(): two-stage warp (tectonic + lithological) per "No Man's Sky uber noise"
"""
import numpy as np

def _hash33(p):
    # p: (...,3) float -> hash
    # large primes + sin trick for determinism without needing table
    p = np.asarray(p)
    # use integer hashing after scaling
    # Frankel et al. cheap hash:  (x*374761 + y*668265261 + z) variant
    # We use sin-based fallback for floats
    s = np.sin(p[...,0]*12.9898 + p[...,1]*78.233 + p[...,2]*37.719) * 43758.5453
    return s - np.floor(s)

def _hash21(p):
    p = np.asarray(p)
    s = np.sin(p[...,0]*12.9898 + p[...,1]*78.233) * 43758.5453123
    return s - np.floor(s)

def _fade(t):
    # quintic 6t^5 -15t^4 +10t^3
    return t*t*t*(t*(t*6-15)+10)

def value_noise_3d(p):
    """
    3D value noise in [-1,1]. p: (N,3) array.
    C^1 continuous via quintic fade, trilinear interpolation of hashed corners.
    """
    p = np.asarray(p, dtype=np.float64)
    pi = np.floor(p).astype(np.int64)
    pf = p - pi
    # 8 corners
    # hash each corner
    # To avoid per-point python loop, we vectorize using hashing on pi+offset
    corners = np.array([[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]], dtype=np.int64)
    h = []
    for c in corners:
        q = pi + c
        # hash using integer-friendly formula
        # Xorshift style: large primes
        hx = q[:,0]*374761393 + q[:,1]*668265263 + q[:,2]*15485863
        # then splitmix
        hx = (hx ^ (hx >> 13)) * 1274126177
        hx = hx ^ (hx >> 16)
        # map to [-1,1]
        hf = (hx & 0xFFFFFFFF).astype(np.float64) / 4294967295.0 * 2.0 - 1.0
        # also mix sin for extra variation
        h.append(hf)
    h = np.stack(h, axis=1) # N,8
    u = _fade(pf[:,0])
    v = _fade(pf[:,1])
    w = _fade(pf[:,2])
    # trilinear
    # ordering corners as per above list
    c000, c100, c010, c110, c001, c101, c011, c111 = [h[:,i] for i in range(8)]
    x00 = c000*(1-u) + c100*u
    x10 = c010*(1-u) + c110*u
    x01 = c001*(1-u) + c101*u
    x11 = c011*(1-u) + c111*u
    y0 = x00*(1-v) + x10*v
    y1 = x01*(1-v) + x11*v
    z = y0*(1-w) + y1*w
    return z

def fbm(p, octaves=5, lacunarity=2.0, gain=0.5, freq=1.0):
    p = np.asarray(p, dtype=np.float64) * freq
    amp = 1.0
    total = np.zeros(p.shape[0], dtype=np.float64)
    norm = 0.0
    for i in range(octaves):
        total += value_noise_3d(p) * amp
        norm += amp
        p *= lacunarity
        amp *= gain
    return total / norm if norm !=0 else total

def ridged_fbm(p, octaves=5, lacunarity=2.0, gain=0.5, freq=1.0, ridge_offset=1.0):
    """
    Ridged multifractal — creates sharp mountain ridges & fracture creases.
    |noise| inverted, squared. Used for joint traces and hard cap overhangs.
    """
    p = np.asarray(p, dtype=np.float64) * freq
    amp = 0.5
    total = np.zeros(p.shape[0])
    norm = 0
    for i in range(octaves):
        n = value_noise_3d(p)
        n = ridge_offset - np.abs(n)
        n = n*n
        total += n * amp
        norm += amp
        p *= lacunarity
        amp *= gain
    return total / norm if norm else total

def worley(p, cell_density=1.0, jitter=1.0):
    """
    3D Worley F1,F2 distance. Returns (N,) F1 distance and F2.
    Used for cell fracture spacing & tafoni pit distribution.
    Brute force over 27 cells — feasible for N~ few million with chunking.
    jitter 0..1 = randomness of cell point inside cell.
    """
    p = np.asarray(p, dtype=np.float64) * cell_density
    pi = np.floor(p).astype(np.int64)
    # For each point, search 3x3x3 neighbourhood
    # Chunk to avoid O(N*27) overhead naive; we loops over offsets but vectorized.
    # Compute F1,F2 per point
    N = p.shape[0]
    F1 = np.full(N, 1e9, dtype=np.float64)
    F2 = np.full(N, 1e9, dtype=np.float64)
    # also output nearest cell id for Voronoi coloring?
    for dz in (-1,0,1):
        for dy in (-1,0,1):
            for dx in (-1,0,1):
                q = pi + np.array([dx,dy,dz], dtype=np.int64)
                # random offset inside cell
                # hash cell coordinate to get point offset
                hx = q[:,0]*374761393 ^ q[:,1]*668265263 ^ q[:,2]*15485863
                hx = (hx ^ (hx>>13))*1274126177
                hx = hx & 0xFFFFFFFF
                # convert to three sub-hashes for xyz jitter
                # cheap: use different bit slices
                rx = ((hx >> 0) & 255)/255.0
                ry = ((hx >> 8) & 255)/255.0
                rz = ((hx >> 16) & 255)/255.0
                # map to [0,1) then jitter around center
                # point position = cell corner + 0.5 + (rand-0.5)*jitter
                cx = q[:,0].astype(np.float64) + 0.5 + (rx-0.5)*jitter
                cy = q[:,1].astype(np.float64) + 0.5 + (ry-0.5)*jitter
                cz = q[:,2].astype(np.float64) + 0.5 + (rz-0.5)*jitter
                d2 = (p[:,0]-cx)**2 + (p[:,1]-cy)**2 + (p[:,2]-cz)**2
                d = np.sqrt(d2) / cell_density
                # update F1,F2
                mask = d < F1
                F2[mask] = F1[mask]
                F1[mask] = d[mask]
                mask2 = (d < F2) & (d >= F1) & (~mask)
                F2[mask2] = d[mask2]
    return F1, F2

def worley_f1(p, cell_density=1.0, jitter=1.0):
    f1,_ = worley(p, cell_density, jitter)
    return f1

def domain_warp(p, warp_amp=0.6, warp_freq=0.5, fbm_octaves=4):
    """
    Two-stage domain warp. Returns warped positions (N,3).
    Stage A: low-freq fBm offset, Stage B: high-freq detail warp.
    This is what makes strata not flat and cliffs not linear — simulates tectonic folding.
    """
    # offset field
    q = p.copy()
    # build 3 offset fields from differently shifted noise
    ox = fbm(p + np.array([13.5, 37.2, 19.1]), octaves=fbm_octaves, freq=warp_freq) * warp_amp
    oy = fbm(p + np.array([71.3, -19.3, 7.7]), octaves=fbm_octaves, freq=warp_freq) * warp_amp
    oz = fbm(p + np.array([-23.1, 11.1, -31.7]), octaves=fbm_octaves, freq=warp_freq * 0.7) * warp_amp * 0.5
    q[:,0] += ox
    q[:,1] += oy
    q[:,2] += oz
    # second warp iteration for swirling (optional)
    ox2 = fbm(q + np.array([3.1, 5.2, 1.7]), octaves=3, freq=warp_freq*1.8) * warp_amp*0.4
    oy2 = fbm(q + np.array([9.4, -2.1, 4.3]), octaves=3, freq=warp_freq*1.8) * warp_amp*0.4
    oz2 = fbm(q + np.array([-4.2, 8.9, -2.5]), octaves=3, freq=warp_freq*1.8) * warp_amp*0.2
    q[:,0] += ox2
    q[:,1] += oy2
    q[:,2] += oz2
    return q

def billowed_noise(p, freq=1.0, octaves=4):
    n = np.abs(fbm(p, octaves=octaves, freq=freq))
    return n
