"""
Columnar basalt generation helpers.
"""
import numpy as np
from .voronoi import generate_uniform_jittered, generate_centroidal_voronoi

def generate_columnar_centers(bbox=(0,10,0,10), column_diameter=1.1, irregular_factor=0.38, target_cv=0.38, method='jitter', seed=0, dip_dir_deg=0, dip_deg=90):
    """
    bbox in world xz plane (xmin,xmax, zmin,zmax) or (xmin,xmax,ymin,ymax) mapped to xz.
    column_diameter ~ 0.8-1.5m (Giant's Causeway 0.4-0.5, Baihetan 0.5-2)
    density = 1 / (area per column)  ~ 1/(pi*(d/2)^2) but hex packing: density = 2/(sqrt3 * s^2) where s ~ diameter
    """
    # convert bbox ordering: if user passes (xmin,xmax, zmin,zmax) we use as (xmin,xmax,ymin,ymax) for voronoi
    xmin, xmax, zmin, zmax = bbox
    # density: approximate s = diameter * 0.95 (hex spacing)
    s = column_diameter * 1.05
    density = 2.0/(np.sqrt(3)*s*s + 1e-9)
    # ensure at least 20 columns for visual
    if method == 'centroidal':
        pts = generate_centroidal_voronoi((xmin, xmax, zmin, zmax), density=density, target_cv=target_cv, seed=seed)
    else:
        pts = generate_uniform_jittered((xmin, xmax, zmin, zmax), density=density, irregular_factor=irregular_factor, seed=seed)
    # Optionally tilt: if dip !=90, project centers along dip direction? For simplicity we keep horizontal and handle extrusion direction later.
    # Return as (N,3) with y=0 for now
    pts3 = np.column_stack([pts[:,0], np.zeros(pts.shape[0]), pts[:,1]])  # x,y,z
    return pts3

def columnar_fracture_mesh():
    # volumetric fracture via mesh splitting is handled at mesh level, not here; this module only centers
    pass
