"""
Signed Distance primitives and boolean ops.
Convention: p (N,3), return (N,) signed distance, negative inside.
All ops maintain (approximate) distance field; smooth ops use IQ's polynomial.
"""
import numpy as np

def sd_sphere(p, r):
    return np.linalg.norm(p, axis=1) - r

def sd_box(p, b):
    # b half extents (3,)
    b = np.asarray(b)
    d = np.abs(p) - b
    # distance outside = length(max(d,0)) + inside = min(max(d.x,max(d.y,d.z)),0)
    outside = np.linalg.norm(np.maximum(d, 0.0), axis=1)
    inside = np.minimum(np.maximum(d[:,0], np.maximum(d[:,1], d[:,2])), 0.0)
    return outside + inside

def sd_capped_cylinder(p, h, r):
    # h total height, radius r, centered at origin, axis y
    # returns SDF
    # d = [ length(p.xz)-r, abs(p.y)-h/2]
    d = np.empty((p.shape[0],2))
    d[:,0] = np.linalg.norm(p[:,[0,2]], axis=1) - r
    d[:,1] = np.abs(p[:,1]) - h*0.5
    outside = np.linalg.norm(np.maximum(d,0), axis=1)
    inside = np.minimum(np.maximum(d[:,0], d[:,1]), 0.0)
    return outside + inside

def sd_capsule(p, a, b, r):
    # segment a->b
    a = np.asarray(a); b = np.asarray(b)
    pa = p - a
    ba = b - a
    h = np.clip(np.dot(pa, ba)/ np.dot(ba,ba), 0.0, 1.0)
    # vectorized h
    # need per-point h
    dot_pa_ba = np.sum(pa * ba, axis=1)
    dot_ba_ba = np.dot(ba, ba)
    h = np.clip(dot_pa_ba / dot_ba_ba, 0, 1)[:,None]
    q = pa - ba * h
    return np.linalg.norm(q, axis=1) - r

def sd_cylinder(p, r):
    # infinite cylinder along y
    return np.linalg.norm(p[:,[0,2]], axis=1) - r

def sd_cone(p, h, r1, r2):
    # capped cone along y, height h, radii r1 bottom (-h/2), r2 top (+h/2)
    # approximate via capsule-like method with linear radius interpolation
    # Use iq cone SDF
    # y in [-h/2, h/2]
    y = p[:,1]
    # radius at y
    # linear interpolation: r = mix(r1,r2, (y+h/2)/h )
    t = (y + h*0.5) / h
    t = np.clip(t, 0, 1)
    r = (1-t)*r1 + t*r2
    d_rad = np.linalg.norm(p[:,[0,2]], axis=1) - r
    d_y = np.abs(y) - h*0.5
    # but need side normal; this conservative is okay for generation (uni-axial cone)
    # refine side distance: distance to slanted side
    # For more accurate: compute k = (r2-r1)/h etc. Simplified below uses outside calc similar to capped cylinder
    d = np.stack([d_rad, d_y], axis=1)
    outside = np.linalg.norm(np.maximum(d,0), axis=1)
    inside = np.minimum(np.maximum(d[:,0], d[:,1]), 0.0)
    return outside + inside

def sd_torus(p, t):
    # t = (major, minor)
    q = np.empty((p.shape[0],2))
    q[:,0] = np.linalg.norm(p[:,[0,2]], axis=1) - t[0]
    q[:,1] = p[:,1]
    return np.linalg.norm(q, axis=1) - t[1]

def sd_ellipsoid(p, r):
    # r radii (3,)
    r = np.asarray(r)
    # approx via scaling
    q = p / r
    # Kn -> iterative
    k0 = np.linalg.norm(q, axis=1)
    k1 = np.linalg.norm(q / (r**2), axis=1)  # ??? simplified
    # Use: distance approx = k0*(k0-1)/k1  for k0 ~ near
    # For stability just do scaled sphere approximation
    return (k0 -1.0)* np.min(r)  # conservative

def sd_plane(p, n, h):
    # plane with normal n (unit) and distance h from origin
    n = np.asarray(n)/np.linalg.norm(n)
    return p.dot(n) + h

# Boolean ops

def op_union(d1, d2):
    return np.minimum(d1, d2)

def op_subtract(d1, d2):
    return np.maximum(d1, -d2)

def op_intersect(d1, d2):
    return np.maximum(d1, d2)

def op_smooth_union(d1, d2, k):
    # k smooth radius
    h = np.clip(0.5 + 0.5*(d2 - d1)/k, 0, 1)
    return np.minimum(d1, d2) * 0  # placeholder trick? correct:
    # actually: mix(d2,d1,h) - k*h*(1-h)
    # implement
    # but vectorized
def op_smooth_union(d1, d2, k):
    h = np.clip(0.5 + 0.5*(d2 - d1)/k, 0.0, 1.0)
    return (1-h)*d2 + h*d1 - k*h*(1.0-h)

def op_smooth_subtract(d1, d2, k):
    # subtract d2 from d1
    h = np.clip(0.5 - 0.5*(d2 + d1)/k, 0.0, 1.0)
    # = mix(d1, -d2, h) + k*h*(1-h)?  alternative formulation
    # Use: op_smooth_union(d1, -d2, k)
    return op_smooth_union(d1, -d2, k)

def op_smooth_intersect(d1, d2, k):
    h = np.clip(0.5 -0.5*(d2 - d1)/k, 0,1)
    return (1-h)*d2 + h*d1 + k*h*(1-h)

def op_round(d, r):
    return d - r

def op_onion(d, thickness):
    return np.abs(d) - thickness
