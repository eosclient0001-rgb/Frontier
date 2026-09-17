"""One-click pipeline presets + orchestration with progress reporting."""

from __future__ import annotations

from dataclasses import asdict

from .erosion import ErosionParams, run_hydraulic_erosion
from .mountain import MountainParams, generate_mountain
from .satmaps import SatmapParams, compute_satmaps
from .sdf import SDFConfig, voxel_match_report
from .texture import TextureParams, render_albedo


PRESETS: dict[str, dict] = {
    "alpine_peak": {
        "label": "Alpine Peak — 100 m hero mountain",
        "mountain": MountainParams(
            seed=1337, res=512, peak_height=30.0, base_height=2.0,
            mountain_radius=38.0, peak_sharpness=1.45, octaves=8,
            lacunarity=2.15, gain=0.55, warp_strength=0.55, crevice=0.30,
        ),
        "erosion": ErosionParams(
            seed=777, num_particles=350_000, max_lifetime=48,
            brush_radius_world=0.6, thermal_iterations=14,
        ),
        "texture": TextureParams(palette="alpine", snowline=0.60),
    },
    "sharp_ridge": {
        "label": "Sharp Ridgeline — aggressive carving",
        "mountain": MountainParams(
            seed=9241, res=512, peak_height=34.0, base_height=1.5,
            mountain_radius=34.0, peak_sharpness=1.8, octaves=8,
            lacunarity=2.25, gain=0.62, warp_strength=0.7, crevice=0.45,
            ridge_weight=0.85, valley_carve=0.28,
        ),
        "erosion": ErosionParams(
            seed=5150, num_particles=500_000, max_lifetime=56,
            brush_radius_world=0.5, erode_speed=0.65, thermal_iterations=18,
        ),
        "texture": TextureParams(palette="alpine", snowline=0.55),
    },
    "soft_highlands": {
        "label": "Soft Highlands — gentle erosion",
        "mountain": MountainParams(
            seed=4451, res=512, peak_height=20.0, base_height=2.5,
            mountain_radius=44.0, peak_sharpness=1.15, octaves=7,
            lacunarity=2.05, gain=0.5, warp_strength=0.4, crevice=0.15,
            ridge_weight=0.55, hills_amp=2.0,
        ),
        "erosion": ErosionParams(
            seed=31337, num_particles=220_000, max_lifetime=40,
            brush_radius_world=0.8, erode_speed=0.45, thermal_iterations=20,
        ),
        "texture": TextureParams(palette="alpine", snowline=0.72, grassline=0.55),
    },
    "volcanic_cone": {
        "label": "Volcanic Cone — dark rock + snow cap",
        "mountain": MountainParams(
            seed=7007, res=512, peak_height=32.0, base_height=2.0,
            mountain_radius=36.0, peak_sharpness=1.3, octaves=7,
            lacunarity=2.1, gain=0.5, warp_strength=0.35, crevice=0.35,
            valley_carve=0.35,
        ),
        "erosion": ErosionParams(
            seed=9001, num_particles=400_000, max_lifetime=52,
            brush_radius_world=0.55, thermal_iterations=16,
        ),
        "texture": TextureParams(palette="volcanic", snowline=0.66),
    },
}


def preset_to_dict(name: str) -> dict:
    p = PRESETS[name]
    return {
        "name": name,
        "label": p["label"],
        "mountain": asdict(p["mountain"]),
        "erosion": asdict(p["erosion"]),
        "texture": asdict(p["texture"]),
    }


def run_pipeline(
    mountain: MountainParams,
    erosion: ErosionParams,
    texture: TextureParams,
    satmaps: SatmapParams | None = None,
    skip_erosion: bool = False,
    progress_cb=None,
) -> dict:
    """Full pipeline: mountain -> SDF erosion -> SATMAPs -> texture."""
    if satmaps is None:
        satmaps = SatmapParams()

    def tick(frac, msg):
        if progress_cb is not None:
            progress_cb(frac, msg)

    cfg = SDFConfig(extent=mountain.extent, res=mountain.res)

    tick(0.02, "synthesizing mountain multifractal")
    mtn = generate_mountain(mountain)

    precheck = voxel_match_report(cfg, erosion.brush_radius_world, erosion.cfl_voxels)

    ero = None
    if not skip_erosion:
        tick(0.10, "SDF hydraulic erosion starting")

        def ero_cb(f, m):
            tick(0.10 + 0.62 * f, f"erosion: {m}")

        ero = run_hydraulic_erosion(mtn.height, cfg, erosion, progress_cb=ero_cb)
        height = ero.height
    else:
        height = mtn.height

    tick(0.74, "computing SATMAPs")

    def sat_cb(f, m):
        tick(0.74 + 0.16 * f, f"satmaps: {m}")

    maps, meta = compute_satmaps(
        height, cfg,
        flow=ero.flow if ero else None,
        sediment=ero.sediment if ero else None,
        wear=ero.wear if ero else None,
        deposition=ero.deposition if ero else None,
        params=satmaps, progress_cb=sat_cb,
    )

    tick(0.92, "rendering albedo")
    albedo = render_albedo(height, maps, texture)
    tick(1.0, "done")

    postcheck = None
    if ero is not None:
        postcheck = voxel_match_report(
            cfg, erosion.brush_radius_world, erosion.cfl_voxels,
            measured_cut_m=ero.stats["max_cut_m"],
            mean_cut_m=ero.stats["mean_cut_m"],
            subvoxel_waste_pct=ero.stats["subvoxel_waste_pct"],
            clamp_rate_pct=ero.stats["cfl_clamp_rate_pct"],
        )

    return {
        "config": {"extent": cfg.extent, "res": cfg.res, "cell": cfg.cell,
                   "voxel_y": cfg.voxel_y},
        "mountain": mountain, "erosion": erosion, "texture": texture,
        "mountain_stats": mtn.stats,
        "erosion_stats": ero.stats if ero else None,
        "satmap_meta": meta,
        "voxel_precheck": precheck,
        "voxel_postcheck": postcheck,
        "height": height,
        "height_initial": mtn.height,
        "maps": maps,
        "albedo": albedo,
        "erosion_maps": (
            {"flow": ero.flow, "sediment": ero.sediment, "wear": ero.wear,
             "deposition": ero.deposition, "talus": ero.talus, "cut": ero.cut}
            if ero else None
        ),
    }
