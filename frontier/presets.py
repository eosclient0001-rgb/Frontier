"""
Formation presets — geologically correct parameter sets.

Each preset defines:
 - bounds (width, height, depth)
 - strata column (via geology/sdf)
 - base SDF primitive (cylinder/cone/box/spire shape)
 - warp functions (fold, tilt, fault)
 - hardness-driven erosion parameters (bench, sapping, rills, aeolian, tafoni, frost, joints, columns)
 - meshing resolution

No lazy linear shape: even the "simple" spire uses tapered cone + sinusoidal radius modulation + cross-bedding steps + joint-guided erosion.
"""
from dataclasses import dataclass, field
import numpy as np

@dataclass
class FormationPreset:
    name: str
    description: str
    bounds: tuple # ((xmin,xmax),(ymin,ymax),(zmin,zmax))
    strata_type: str # 'claron','mesa','spire','basalt','tafoni_cliff'
    base_shape: str # 'spire_cone','hoodoo','mesa','butte','columnar_field','cliff_wall','dome'
    base_params: dict = field(default_factory=dict)
    warp: dict = field(default_factory=dict)
    erosion: dict = field(default_factory=dict)
    joints: dict = field(default_factory=dict)
    weathering: dict = field(default_factory=dict)
    columnar: dict = field(default_factory=dict)
    resolution: int = 220
    seed: int = 0

def _bounds_spire(height=42.0, radius_base=4.2, radius_top=0.6):
    r = radius_base*1.25
    return ((-r, r), (0, height+2), (-r, r))

def _bounds_mesa(width=36.0, height=28.0, depth=28.0):
    # mesa centered at origin? But we place ground at y=0, mesa extends up
    # For mesa we need wide plateau with cliffs: x in [-width/2, width/2], z similar, y 0..height
    # Add talus apron extra margin ~0.2*width
    hx = width*0.5 + 4
    hz = depth*0.5 + 4
    return ((-hx, hx), (0, height+4), (-hz, hz))

def _bounds_cliff(width=28.0, height=22.0, depth=8.0):
    # cliff wall along x, thickness in z
    # Cliff occupies central slab but we sample larger volume to include talus
    hx = width*0.5 + 2
    hz = depth*0.5 + 6
    return ((-hx, hx), (0, height+4), (-hz, hz))

def preset_hoodoo_bryce(seed=0):
    # Hoodoo: ~18m tall fairy chimney, cap 2m thick limestone protects narrow stem
    h = 18.0
    return FormationPreset(
        name="hoodoo_bryce",
        description="Bryce Canyon hoodoo — Claron limestone cap over mudstone/siltstone stem, frost-wedged joints, tafoni honeycomb, basal sapping alcoves, column-like frost shattering. ~18m tall.",
        bounds=_bounds_spire(height=h, radius_base=3.0, radius_top=0.7),
        strata_type='claron',
        base_shape='hoodoo',
        base_params=dict(height=h, radius_base=2.6, radius_neck=0.65, radius_cap=1.55, cap_height=1.6, stem_taper=0.9, bulge_amp=0.28),
        warp=dict(fold_amp=0.35, tilt_deg=3.5, tilt_azim=28.0, fault_throw=0.0, domain_warp_amp=0.32),
        erosion=dict(
            bench_amp=0.42, basal_sapping=0.85, rill_depth=0.22, rill_density=2.4, aeolian_strength=0.32,
            flute_wave=1.2, talus_angle=33
        ),
        joints=dict(
            set1_spacing=2.6, set1_azim=12.0, set2_spacing=3.0, set2_azim=102.0, have_set3=False,
            base_depth=0.22, aperture=0.055, roughness=0.28, frost_factor=1.15
        ),
        weathering=dict(
            tafoni_density=3.8, tafoni_radius=0.14, tafoni_depth=0.18, case_shell=0.035, frost_intensity=0.95
        ),
        resolution=240,
        seed=seed
    )

def preset_spire_monument(seed=1):
    # Monument Valley spire ~45m tall Wingate sandstone, cross-bedded, vertical joints
    h = 46.0
    return FormationPreset(
        name="spire_monument",
        description="Monument Valley Wingate spire — 45m uniform eolian sandstone, cross-bed laminae, subvertical orthogonal joints, wind fluting yardang, minimal cap, massive frost rilling.",
        bounds=_bounds_spire(height=h, radius_base=5.0, radius_top=0.9),
        strata_type='spire',
        base_shape='spire_cone',
        base_params=dict(height=h, r_base=4.4, r_mid=1.8, r_top=0.55, taper_exp=0.62, cross_bed_amp=0.18),
        warp=dict(fold_amp=0.55, tilt_deg=4.5, tilt_azim=210.0, fault_throw=0.35, domain_warp_amp=0.38),
        erosion=dict(
            bench_amp=0.28, basal_sapping=0.42, rill_depth=0.32, rill_density=2.6, rill_stretch=3.2,
            aeolian_strength=0.62, flute_wave=1.5, flute_depth=0.20
        ),
        joints=dict(
            set1_spacing=4.2, set1_azim=22.0, set2_spacing=4.0, set2_azim=112.0, have_set3=True, set3_spacing=5.0, set3_azim=65.0,
            base_depth=0.28, aperture=0.065, roughness=0.24, frost_factor=0.65
        ),
        weathering=dict(
            tafoni_density=2.0, tafoni_radius=0.18, tafoni_depth=0.12, case_shell=0.028, frost_intensity=0.4
        ),
        resolution=260,
        seed=seed
    )

def preset_mesa_vermeillion(seed=2):
    # Mesa: broad Vermillion Cliffs type, 28m height, basalt/sandstone cap, cliff-and-bench staircase, talus
    h = 28.0
    w = 38.0
    return FormationPreset(
        name="mesa_vermeillion",
        description="Vermillion Cliffs mesa — flat-topped, basalt/sandstone caprock over interbedded shale/siltstone, stairstep cliff-and-bench topography, basal sapping overhangs, talus apron, wind-scalloped benches.",
        bounds=_bounds_mesa(width=w, height=h, depth=30.0),
        strata_type='mesa',
        base_shape='mesa',
        base_params=dict(width=w, depth=26.0, height=h, cap_thickness=3.2, bench_steps=5, edge_round=1.2, irregularity=0.9),
        warp=dict(fold_amp=0.75, tilt_deg=4.0, tilt_azim=118.0, fault_throw=0.65, domain_warp_amp=0.42),
        erosion=dict(
            bench_amp=0.58, basal_sapping=0.95, rill_depth=0.20, rill_density=2.0, aeolian_strength=0.42,
            flute_wave=1.6, flute_depth=0.14
        ),
        joints=dict(
            set1_spacing=5.0, set1_azim=8.0, set2_spacing=5.4, set2_azim=98.0, have_set3=False,
            base_depth=0.24, aperture=0.065, roughness=0.22, frost_factor=0.65
        ),
        weathering=dict(
            tafoni_density=2.6, tafoni_radius=0.16, tafoni_depth=0.14, case_shell=0.038, frost_intensity=0.5
        ),
        resolution=240,
        seed=seed
    )

def preset_butte(seed=3):
    # Butte: mesa eroded until width < height, isolated fin
    h = 32.0
    w = 16.0
    return FormationPreset(
        name="butte_monument",
        description="Butte — eroded mesa remnant taller than wide, isolated, same stratigraphy as mesa but narrower, edge retreat via basal sapping & frost, overhanging cap, surrounding pedestal slopes.",
        bounds=_bounds_mesa(width=w+8, height=h, depth=w+6),
        strata_type='mesa',
        base_shape='butte',
        base_params=dict(width=w, depth=w*0.9, height=h, cap_thickness=2.6, cap_overhang=1.4, edge_round=0.9, talus_spread=5.5),
        warp=dict(fold_amp=0.42, tilt_deg=3.2, tilt_azim=45.0, fault_throw=0.25, domain_warp_amp=0.34),
        erosion=dict(
            bench_amp=0.52, basal_sapping=0.88, rill_depth=0.24, rill_density=2.2, aeolian_strength=0.48,
            flute_wave=1.35, flute_depth=0.16
        ),
        joints=dict(
            set1_spacing=4.4, set1_azim=18.0, set2_spacing=4.7, set2_azim=108.0, have_set3=False,
            base_depth=0.22, aperture=0.06, roughness=0.22, frost_factor=0.7
        ),
        weathering=dict(
            tafoni_density=2.4, tafoni_radius=0.15, tafoni_depth=0.13, case_shell=0.034, frost_intensity=0.55
        ),
        resolution=250,
        seed=seed
    )

def preset_columnar_giants(seed=4):
    # Columnar basalt field 16m high, 1.1m cols
    h = 18.0
    return FormationPreset(
        name="columnar_giants",
        description="Giant's Causeway / Baihetan columnar basalt — colonnade + hackly entablature, hexagonal CV 0.36, transverse striae, ponded lava flow jointing, pseudo-hexagonal Voronoi extrusion with striae.",
        bounds=_bounds_mesa(width=16.0, height=h, depth=16.0),
        strata_type='basalt',
        base_shape='columnar_field',
        base_params=dict(width=14.0, depth=14.0, height=h, entablature_ratio=0.32, base_irregularity=0.45),
        warp=dict(fold_amp=0.0, tilt_deg=1.0, tilt_azim=0, fault_throw=0.0, domain_warp_amp=0.14),
        erosion=dict(
            bench_amp=0.08, basal_sapping=0.12, rill_depth=0.05, aeolian_strength=0.18
        ),
        joints=dict(
            base_depth=0.0, aperture=0.0  # not used; columnar walls handle joints
        ),
        weathering=dict(
            tafoni_density=1.2, tafoni_radius=0.14, tafoni_depth=0.08, frost_intensity=0.4
        ),
        columnar=dict(
            diameter=1.0, irregular_factor=0.28, target_cv=0.34, wall_thickness=0.038, wall_depth=0.55, entablature_bend=0.35
        ),
        resolution=260,
        seed=seed
    )

def preset_tafoni_cliff(seed=5):
    # Entrada sandstone cliff with dense honeycomb weathering, tafoni caves up to meter scale
    h = 22.0
    return FormationPreset(
        name="cliff_tafoni",
        description="Entrada sandstone tafoni cliff — vertical 22m wall, dense honeycomb alveoli, case-hardened filigree ribs, meter-scale caverna, differential cementation bands, wind-scoured flutes, alcove overhangs, slot-like joint corridors.",
        bounds=_bounds_cliff(width=28.0, height=h, depth=10.0),
        strata_type='mesa', # sandstone-shale but sandstone-dominated for tafoni
        base_shape='cliff_wall',
        base_params=dict(width=28.0, thickness=4.5, height=h, face_waviness=0.9, top_irregularity=0.6, alcove_depth=1.8),
        warp=dict(fold_amp=0.38, tilt_deg=2.8, tilt_azim=92.0, fault_throw=0.28, domain_warp_amp=0.32),
        erosion=dict(
            bench_amp=0.32, basal_sapping=0.72, rill_depth=0.26, rill_density=2.4, aeolian_strength=0.52,
            flute_wave=1.1, flute_depth=0.18
        ),
        joints=dict(
            set1_spacing=3.6, set1_azim=15.0, set2_spacing=4.0, set2_azim=105.0, have_set3=False,
            base_depth=0.20, aperture=0.055, roughness=0.26, frost_factor=0.55
        ),
        weathering=dict(
            tafoni_density=3.4, tafoni_radius=0.20, tafoni_depth=0.22, case_shell=0.042, frost_intensity=0.45
        ),
        resolution=270,
        seed=seed
    )

def preset_dome_granite(seed=6):
    h=24.0
    return FormationPreset(
        name="dome_granite",
        description="Granite dome (Half Dome / Enchanted Rock analogue) — exfoliation onion-skin sheets, orthogonal joint traces, grus weathering, broad convex form.",
        bounds=_bounds_spire(height=h, radius_base=12.0, radius_top=2.0),
        strata_type='basalt', # for granite we reuse high hardness but override
        base_shape='dome',
        base_params=dict(height=h, base_radius=11.5, top_radius=1.2, dome_exp=0.58),
        warp=dict(fold_amp=0.22, tilt_deg=1.5, domain_warp_amp=0.22),
        erosion=dict(bench_amp=0.12, basal_sapping=0.18, rill_depth=0.10, aeolian_strength=0.22),
        joints=dict(set1_spacing=6.2, set1_azim=30.0, set2_spacing=6.5, set2_azim=120.0, base_depth=0.18, aperture=0.065, roughness=0.18, frost_factor=0.32),
        weathering=dict(tafoni_density=1.2, tafoni_radius=0.22, tafoni_depth=0.09, frost_intensity=0.22),
        resolution=240,
        seed=seed
    )

ALL_PRESETS = {
    "hoodoo_bryce": preset_hoodoo_bryce,
    "spire_monument": preset_spire_monument,
    "mesa_vermeillion": preset_mesa_vermeillion,
    "butte_monument": preset_butte,
    "columnar_giants": preset_columnar_giants,
    "cliff_tafoni": preset_tafoni_cliff,
    "dome_granite": preset_dome_granite,
}

def get_preset(name, seed=None):
    if name not in ALL_PRESETS:
        raise ValueError(f"Unknown preset {name}. Available: {list(ALL_PRESETS.keys())}")
    preset_fn = ALL_PRESETS[name]
    if seed is not None:
        return preset_fn(seed=seed)
    return preset_fn()
