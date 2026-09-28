"""
CLI for batch generation / viewer export.
"""
import argparse, os, json, sys
import numpy as np
from .presets import ALL_PRESETS, get_preset
from .generator import GeologicalSDF
from .mesher.marching import sample_sdf_grid, marching_cubes_mesh, export_obj, export_ply

def generate_mesh(preset_name, resolution=None, seed=None, out_dir="output", do_decimate=False, make_ply=True, make_obj=True, verbose=True):
    preset = get_preset(preset_name, seed=seed)
    if resolution is not None:
        preset.resolution = resolution
    # If resolution int, interpret as nx=ny=nz? But bounds are non-cubic, need anisotropic steps?
    # We'll use adaptive resolution: longest axis gets full res, others scaled proportionally to keep voxel cubic.
    bounds = preset.bounds
    # bounds: ((xmin,xmax),(ymin,ymax),(zmin,zmax))
    extents = [bounds[0][1]-bounds[0][0], bounds[1][1]-bounds[1][0], bounds[2][1]-bounds[2][0]]
    max_ext = max(extents)
    # scale so longest = resolution, others = round(res * extent/max)
    res = preset.resolution
    nx = int(round(res * extents[0]/max_ext))
    ny = int(round(res * extents[1]/max_ext))
    nz = int(round(res * extents[2]/max_ext))
    # ensure at least 32
    nx,ny,nz = max(64,nx), max(64,ny), max(64,nz)
    if verbose:
        print(f"[{preset_name}] bounds extents {extents} -> grid {nx}x{ny}x{nz} (max {res})")
        print(f"  Strata: {preset.strata_type}  base {preset.base_shape}")
    sdf_evaluator = GeologicalSDF(preset)
    # SDF function closure
    def sdf_fn(p):
        out = sdf_evaluator.evaluate(p)
        return out['sdf'].astype(np.float32)
    # Sample
    volume, (xs,ys,zs), spacing, origin = sample_sdf_grid(sdf_fn, bounds, (nx,ny,nz), chunk_y=24, verbose=verbose)
    if verbose:
        print(f"  Volume sampled: min {volume.min():.3f} max {volume.max():.3f} mean {volume.mean():.3f}")
        # Check for sign crossing
        inside = np.sum(volume<0); total = volume.size
        print(f"  Inside ratio {inside/total*100:.2f}%  inside voxels {inside}")
        if inside==0 or inside==total:
            print("  WARNING: no surface crossing — bounds or SDF may be off. Adjusting level?")
    verts, faces, normals, values = marching_cubes_mesh(volume, spacing, origin, level=0.0, step_size=1)
    if verbose:
        print(f"  Marching cubes: {len(verts)} verts {len(faces)} faces")
    # Compute hardness vertex colors (sample hardness at vert positions)
    # Sample hardness at vertices for vertex coloring
    # Also compute curvature-like? Use hardness for color mapping via lithology
    hardness_at_verts = sdf_evaluator.hardness_field(verts)
    # Map hardness to color via strata? Use preset's strata colors blended
    # Build color ramp: soft shale brown -> hard sandstone tan -> limestone pale -> basalt dark
    # Use strata column to lookup nearest stratum color? For generic we map hardness 0..1 to gradient
    # Gradient: hard 0.9 limestone pale (0.93,0.91,0.85), mid 0.6 sandstone (0.77,0.58,0.44), soft 0.3 shale (0.55,0.48,0.45), very soft tuff (0.62,0.56,0.50)
    # Interpolate piecewise
    vertex_colors = np.empty((verts.shape[0],3), dtype=np.float32)
    for i, h in enumerate(hardness_at_verts):
        if h > 0.82:
            # limestone/basalt pale
            # basalt dark vs limestone pale? For basalt hardness 0.93 we want dark; but limestone also 0.9 pale. Distinguish via preset?
            if preset.strata_type == 'basalt':
                # basalt dark gray
                base = np.array([0.28,0.28,0.30]); top = np.array([0.35,0.35,0.38])
                t = (h-0.82)/0.18
                c = base*(1-t) + top*t
            else:
                c0 = np.array([0.77,0.58,0.44]); c1 = np.array([0.93,0.91,0.85])
                t = (h-0.82)/0.18
                c = c0*(1-t) + c1*t
                # add iron staining variation
                c += (np.sin(verts[i,1]*1.2)*0.02)
        elif h > 0.55:
            c0 = np.array([0.66,0.54,0.46]); c1 = np.array([0.80,0.60,0.45])
            t = (h-0.55)/0.27
            c = c0*(1-t)+c1*t
        elif h > 0.35:
            c0 = np.array([0.55,0.48,0.45]); c1 = np.array([0.66,0.54,0.46])
            t = (h-0.35)/0.20
            c = c0*(1-t)+c1*t
        else:
            c0 = np.array([0.58,0.50,0.43]); c1 = np.array([0.55,0.48,0.45])
            t = np.clip((h-0.20)/0.15,0,1)
            c = c0*(1-t)+c1*t
        # Add subtle cavity darkening where tafoni pits deep: use offset? approximate via hardness_shell vs base?
        # Darken where bench recessed? Use y height?
        # We'll also add ambient-occlusion-like darkening in pits via value_noise_3d
        from .sdf.noise import value_noise_3d
        cav = value_noise_3d(verts[i:i+1]*2.1)[0]
        c = c * (0.92 + 0.08*cav)
        c = np.clip(c,0,1)
        vertex_colors[i]=c
    # Slight post-process: smooth normals already from marching, but we have normals
    # Ensure directories
    os.makedirs(out_dir, exist_ok=True)
    base_path = os.path.join(out_dir, preset_name)
    meta = {
        "preset": preset_name,
        "description": preset.description,
        "bounds": preset.bounds,
        "grid": [nx,ny,nz],
        "verts": int(len(verts)),
        "faces": int(len(faces)),
        "strata_type": preset.strata_type,
        "base_shape": preset.base_shape,
        "seed": preset.seed
    }
    with open(base_path+"_meta.json","w") as f:
        json.dump(meta, f, indent=2)
    if make_obj:
        obj_path = base_path+".obj"
        export_obj(obj_path, verts, faces, normals=normals, vertex_colors=vertex_colors if False else None)
        # also write mtl for completeness? skip
        if verbose:
            print(f"  Wrote {obj_path}")
    if make_ply:
        ply_path = base_path+".ply"
        export_ply(ply_path, verts, faces, normals=normals, vertex_colors=vertex_colors)
        if verbose:
            print(f"  Wrote {ply_path}")
    # Also export glb via trimesh if available? We'll try trimesh export to glb with vertex colors
    try:
        import trimesh
        mesh = trimesh.Trimesh(vertices=verts, faces=faces, vertex_colors=(vertex_colors*255).astype(np.uint8), process=False)
        # Fix normals? trimesh will compute
        glb_path = base_path+".glb"
        # trimesh export
        mesh.export(glb_path)
        if verbose:
            print(f"  Wrote {glb_path}")
    except Exception as e:
        if verbose:
            print(f"  GLB export failed: {e}")
    return verts, faces, normals, vertex_colors, preset, (xs,ys,zs)

def main():
    parser = argparse.ArgumentParser(description="Frontier geological SDF → mesh generator")
    parser.add_argument("--preset", type=str, default="hoodoo_bryce", help=f"Preset name {list(ALL_PRESETS.keys())}")
    parser.add_argument("--all", action="store_true", help="Generate all presets")
    parser.add_argument("--resolution", type=int, default=None, help="Max axis resolution (voxel count along longest dimension)")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--out", type=str, default="output")
    parser.add_argument("--list", action="store_true", help="List presets")
    args = parser.parse_args()
    if args.list:
        for k, fn in ALL_PRESETS.items():
            p = fn()
            print(f"{k:20s} {p.description[:110]}")
        sys.exit(0)
    if args.all:
        for k in ALL_PRESETS.keys():
            try:
                generate_mesh(k, resolution=args.resolution, seed=args.seed, out_dir=args.out, verbose=True)
            except Exception as e:
                print(f"[error] {k}: {e}")
                import traceback; traceback.print_exc()
    else:
        generate_mesh(args.preset, resolution=args.resolution, seed=args.seed, out_dir=args.out, verbose=True)

if __name__ == "__main__":
    main()
