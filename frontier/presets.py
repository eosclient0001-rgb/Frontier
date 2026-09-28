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
        warp=dict(fold_amp=0.7, tilt_deg=6.0, tilt_azim=28.0, fault_throw=0.0, domain_warp_amp=0.65),
        erosion=dict(
            bench_amp=1.35, basal_sapping=1.4, rill_depth=0.42, rill_density=2.8, aeolian_strength=0.55,
            flute_wave=1.1, talus_angle=33
        ),
        joints=dict(
            set1_spacing=2.2, set1_azim=12.0, set2_spacing=2.6, set2_azim=102.0, have_set3=False,
            base_depth=0.38, aperture=0.07, roughness=0.42, frost_factor=1.6
        ),
        weathering=dict(
            tafoni_density=5.8, tafoni_radius=0.16, tafoni_depth=0.24, case_shell=0.035, frost_intensity=1.5
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
        warp=dict(fold_amp=1.2, tilt_deg=9.0, tilt_azim=210.0, fault_throw=1.2, domain_warp_amp=0.85),
        erosion=dict(
            bench_amp=0.65, basal_sapping=0.75, rill_depth=0.68, rill_density=3.0, rill_stretch=3.4,
            aeolian_strength=1.15, flute_wave=1.6, flute_depth=0.32
        ),
        joints=dict(
            set1_spacing=3.4, set1_azim=22.0, set2_spacing=3.1, set2_azim=112.0, have_set3=True, set3_spacing=4.2, set3_azim=65.0,
            base_depth=0.55, aperture=0.09, roughness=0.38, frost_factor=0.9
        ),
        weathering=dict(
            tafoni_density=3.2, tafoni_radius=0.22, tafoni_depth=0.18, case_shell=0.028, frost_intensity=0.7
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
        warp=dict(fold_amp=1.8, tilt_deg=7.5, tilt_azim=118.0, fault_throw=2.2, domain_warp_amp=1.1),
        erosion=dict(
            bench_amp=1.55, basal_sapping=1.65, rill_depth=0.38, rill_density=2.2, aeolian_strength=0.85,
            flute_wave=1.9, flute_depth=0.24
        ),
        joints=dict(
            set1_spacing=4.2, set1_azim=8.0, set2_spacing=4.5, set2_azim=98.0, have_set3=False,
            base_depth=0.42, aperture=0.11, roughness=0.32, frost_factor=1.0
        ),
        weathering=dict(
            tafoni_density=3.9, tafoni_radius=0.20, tafoni_depth=0.21, case_shell=0.038, frost_intensity=0.9
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
        warp=dict(fold_amp=0.9, tilt_deg=5.5, tilt_azim=45.0, fault_throw=0.8, domain_warp_amp=0.75),
        erosion=dict(
            bench_amp=1.45, basal_sapping=1.55, rill_depth=0.48, rill_density=2.6, aeolian_strength=0.95,
            flute_wave=1.4, flute_depth=0.29
        ),
        joints=dict(
            set1_spacing=3.6, set1_azim=18.0, set2_spacing=3.9, set2_azim=108.0, have_set3=False,
            base_depth=0.48, aperture=0.09, roughness=0.36, frost_factor=1.1
        ),
        weathering=dict(
            tafoni_density=4.4, tafoni_radius=0.18, tafoni_depth=0.22, case_shell=0.034, frost_intensity=1.0
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
        warp=dict(fold_amp=0.0, tilt_deg=2.0, tilt_azim=0, fault_throw=0.0, domain_warp_amp=0.22),
        erosion=dict(
            bench_amp=0.15, basal_sapping=0.2, rill_depth=0.12, aeolian_strength=0.35
        ),
        joints=dict(
            base_depth=0.0, aperture=0.0  # not used; columnar walls handle joints
        ),
        weathering=dict(
            tafoni_density=1.2, tafoni_radius=0.14, tafoni_depth=0.08, frost_intensity=0.4
        ),
        columnar=dict(
            diameter=1.05, irregular_factor=0.34, target_cv=0.36, wall_thickness=0.055, wall_depth=0.42, entablature_bend=0.6
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
        warp=dict(fold_amp=1.0, tilt_deg=4.0, tilt_azim=92.0, fault_throw=0.9, domain_warp_amp=0.78),
        erosion=dict(
            bench_amp=0.85, basal_sapping=1.25, rill_depth=0.52, rill_density=3.4, aeolian_strength=1.05,
            flute_wave=0.9, flute_depth=0.36
        ),
        joints=dict(
            set1_spacing=2.8, set1_azim=15.0, set2_spacing=3.2, set2_azim=105.0, have_set3=False,
            base_depth=0.45, aperture=0.08, roughness=0.48, frost_factor=0.85
        ),
        weathering=dict(
            tafoni_density=6.8, tafoni_radius=0.24, tafoni_depth=0.38, case_shell=0.045, frost_intensity=0.75
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
        warp=dict(fold_amp=0.5, tilt_deg=3.0, domain_warp_amp=0.45),
        erosion=dict(bench_amp=0.3, basal_sapping=0.4, rill_depth=0.25, aeolian_strength=0.45),
        joints=dict(set1_spacing=5.5, set1_azim=30.0, set2_spacing=5.8, set2_azim=120.0, base_depth=0.35, aperture=0.12, roughness=0.3, frost_factor=0.6),
        weathering=dict(tafoni_density=1.8, tafoni_radius=0.28, tafoni_depth=0.14, frost_intensity=0.5),
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
