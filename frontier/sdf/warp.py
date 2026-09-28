"""
Domain warps that emulate geological deformation — not just perlin wiggle.
"""
import numpy as np
from .noise import fbm, domain_warp

def tectonic_fold_warp(p, fold_axis='x', amplitude=2.5, wavelength=18.0, phase_shift=0.0):
    """
    Simulate compressional folding (anticline/syncline) by displacing y
    as function of x/z with sinusoid + fBm perturbation.
    amplitude: meters of vertical folding
    wavelength: spacing of folds
    """
    p2 = p.copy()
    if fold_axis == 'x':
        coord = p[:,0]
    elif fold_axis == 'z':
        coord = p[:,2]
    else:
        coord = (p[:,0] + p[:,2])*0.707
    # primary sine fold + secondary choppy noise for non-uniformity
    fold = np.sin(coord / wavelength * 2*np.pi + phase_shift) * amplitude
    # add non-linear warping to fold shape: chevron vs sinusoidal
    # Use 3D fbm with y=0 for xz dependence
    tmp = np.column_stack([p[:,0], np.zeros(p.shape[0]), p[:,2]]) * 0.07
    fold += fbm(tmp, octaves=3, freq=0.5) * amplitude*0.35
    # fold attenuates with height? folds tighter at depth
    depth_factor = np.clip(1.0 - (p[:,1]+15)/40.0, 0,1) # assume terrain around y~0..30
    fold *= (0.4 + 0.6*depth_factor)
    p2[:,1] += fold
    # also lateral shear due to folding
    tmp2 = np.column_stack([p[:,1], p[:,2], np.zeros(p.shape[0])]) * 0.05
    tmp3 = np.column_stack([p[:,0], p[:,1], np.zeros(p.shape[0])]) * 0.05
    p2[:,0] += fbm(tmp2, octaves=2, freq=0.8)*0.7
    p2[:,2] += fbm(tmp3, octaves=2, freq=0.8)*0.7
    return p2

def tilt_warp(p, dip_deg=12.0, dip_dir_deg=30.0):
    """
    Stratigraphic tilt: beds dipping at dip_deg toward dip_dir_deg azimuth.
    Implemented as shear: z' = z + x*tan(dip) * cos/sin etc.
    """
    dip = np.radians(dip_deg)
    azi = np.radians(dip_dir_deg)
    # tilt axis perpendicular to dip direction
    # displacement in y proportional to projection onto dip direction
    proj = p[:,0]*np.cos(azi) + p[:,2]*np.sin(azi)
    shear = proj * np.tan(dip)
    p2 = p.copy()
    p2[:,1] -= shear  # dipping downwards in dip direction
    return p2

def fault_offset(p, fault_plane_x=0.0, throw=3.0, heave=0.8, noise_amp=0.6):
    """
    Normal fault with throw (vertical) and heave (horizontal).
    Fault plane assumed vertical strike N-S at x = fault_plane_x.
    Adds drag folding near fault.
    """
    from .noise import value_noise_3d
    p2 = p.copy()
    # distance to fault plane
    dx = p[:,0] - fault_plane_x
    # hanging wall (positive side) displaced down
    hang = dx > 0
    # drag zone 6m wide
    drag = np.exp(-np.abs(dx)/3.0) * 1.2
    # gouge waviness
    wav = value_noise_3d(p*0.18)*noise_amp
    p2[hang,1] -= throw + wav[hang]
    p2[hang,0] += heave
    # footwall slight uplift + drag folding
    p2[:,1] -= drag * 0.7
    p2[:,1] += wav*0.3
    return p2

def large_scale_warp(p, amp=1.8, freq=0.03):
    """General tectonic + litho domain warp wrapper"""
    return domain_warp(p, warp_amp=amp, warp_freq=freq)
