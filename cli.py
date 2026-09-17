"""Headless CLI for the Frontier SDF terrain engine.

Examples:
    python3 cli.py --preset alpine_peak --out exports/
    python3 cli.py --preset sharp_ridge --res 768 --particles 600000 --out exports/
    python3 cli.py --preset soft_highlands --skip-erosion --out exports/
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image

from terrain.exporters import export_height_png16, export_obj
from terrain.pipeline import PRESETS, run_pipeline
from terrain.satmaps import SatmapParams
from terrain.sdf import SDFConfig
from terrain.texture import hillshade


def main() -> None:
    ap = argparse.ArgumentParser(description="Frontier SDF terrain CLI")
    ap.add_argument("--preset", default="alpine_peak", choices=list(PRESETS))
    ap.add_argument("--out", default="exports", help="output directory")
    ap.add_argument("--res", type=int, default=None, help="override grid resolution")
    ap.add_argument("--particles", type=int, default=None, help="override droplet count")
    ap.add_argument("--seed", type=int, default=None, help="override mountain seed")
    ap.add_argument("--skip-erosion", action="store_true")
    ap.add_argument("--obj-res", type=int, default=256)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")

    p = PRESETS[args.preset]
    mountain, erosion, texture = p["mountain"], p["erosion"], p["texture"]
    import copy

    mountain, erosion, texture = copy.deepcopy(mountain), copy.deepcopy(erosion), copy.deepcopy(texture)
    if args.res:
        mountain.res = args.res
    if args.particles:
        erosion.num_particles = args.particles
    if args.seed is not None:
        mountain.seed = args.seed

    print(f"[frontier] preset={args.preset} res={mountain.res} "
          f"particles={erosion.num_particles} skip_erosion={args.skip_erosion}")

    def cb(frac, msg):
        print(f"\r  [{frac*100:5.1f}%] {msg}      ", end="", flush=True)

    result = run_pipeline(mountain, erosion, texture, SatmapParams(),
                          skip_erosion=args.skip_erosion, progress_cb=cb)
    print()

    cfg = SDFConfig(extent=mountain.extent, res=mountain.res)
    h, albedo, maps = result["height"], result["albedo"], result["maps"]

    Image.fromarray(albedo).save(out / f"frontier_albedo_{stamp}.png")
    shade = hillshade(h, cfg.cell)
    comp = np.clip(albedo.astype(float) * (0.35 + 0.65 * shade)[..., None], 0, 255).astype(np.uint8)
    Image.fromarray(comp).save(out / f"frontier_shaded_{stamp}.png")
    export_height_png16(h, str(out / f"frontier_height_{stamp}.png"))
    export_obj(h, cfg, str(out / f"frontier_{stamp}.obj"), max_res=args.obj_res, albedo=albedo)
    for k, v in maps.items():
        Image.fromarray((np.clip(v, 0, 1) * 255 + 0.5).astype(np.uint8)).save(
            out / f"frontier_satmap_{k}_{stamp}.png")

    meta = {
        "preset": args.preset,
        "mountain_stats": result["mountain_stats"],
        "erosion_stats": result["erosion_stats"],
        "voxel_precheck": result["voxel_precheck"],
        "voxel_postcheck": result["voxel_postcheck"],
    }
    with open(out / f"frontier_meta_{stamp}.json", "w") as f:
        json.dump(meta, f, indent=2, default=str)

    post = result["voxel_postcheck"]
    if post:
        print(f"[frontier] voxel match: {post['status']} | "
              f"voxel={post['voxel_xz_m']:.4f} m brush={post['brush_radius_voxels']:.2f} vox | "
              f"max cut={post['measured_max_cut_m']:.2f} m "
              f"({post['measured_max_cut_voxels']:.1f} vox)")
        for issue in post["issues"]:
            print(f"           ! {issue}")
    print(f"[frontier] wrote {out}/frontier_*_{stamp}.*")


if __name__ == "__main__":
    main()
