"""
Grid sampling + marching cubes.

We support non-uniform bounding boxes per formation: tall spire narrow, mesa wide.

Sampling is chunked to avoid O(N) memory blow. For 256^3 ~ 16M points → ~400MB if naïve.
We chunk in y-slices to keep memory ~ (256*256*chunk_y) ~ 32MB per chunk and stitch.

Hardness field is computed on the fly per chunk to allow erosion modulation without storing huge field.

Skimage marching_cubes requires regular grid with spacing.
We also compute vertex hardness color for debug (vertex color not texture).
"""
import numpy as np

def sample_sdf_grid(sdf_fn, bounds, resolution, chunk_y=32, verbose=False):
    """
    sdf_fn: callable p (N,3) -> (N,) distances
    bounds: ((xmin,xmax),(ymin,ymax),(zmin,zmax))
    resolution: int or (nx,ny,nz)
    Returns: volume (nx,ny,nz) as np.float32 with SDF values, and spacing, origin.
    """
    if isinstance(resolution, int):
        nx = ny = nz = resolution
    else:
        nx,ny,nz = resolution
    (xmin,xmax),(ymin,ymax),(zmin,zmax) = bounds
    xs = np.linspace(xmin, xmax, nx)
    ys = np.linspace(ymin, ymax, ny)
    zs = np.linspace(zmin, zmax, nz)
    spacing = ((xmax - xmin)/(nx-1), (ymax - ymin)/(ny-1), (zmax - zmin)/(nz-1))
    volume = np.empty((nx, ny, nz), dtype=np.float32)  # note ordering: we fill as (x,y,z) but marching expects (z,y,x)??? We'll permute.
    # Actually skimage expects volume shape (M,N,P) where indices correspond to z,y,x? We need to be careful.
    # We'll construct as (nx,ny,nz) then transpose to (nz,ny,nx) or just pass and handle spacing order.
    # Simpler: store as (nx,ny,nz) and later transpose.
    # But easier: create grid with indexing='ij' giving X,Y,Z
    # We'll fill volume[x,y,z] indexing.
    # Implementation: iterate over y-chunks to generate slices at fixed y.
    # For each chunk_y range of y indices
    # Build meshgrid for full x*z per y slice (vectorized).
    # This is more memory efficient than building full N = nx*ny*nz points at once.

    # Precompute X, Z grids for chunk
    # Use chunks along y dimension (vertical axis where strata varies most)
    # Progress
    total_chunks = int(np.ceil(ny / chunk_y))
    for ci in range(total_chunks):
        y0 = ci*chunk_y
        y1 = min((ci+1)*chunk_y, ny)
        chunk_ny = y1 - y0
        # Build coordinate arrays for this chunk: (nx * chunk_ny * nz) points
        # Could be large: nx=256,nz=256, chunk_y=16 => ~1M points → okay
        # Create meshgrid
        # Use broadcasting to generate point cloud
        # We'll create via np.meshgrid with sparse? Instead iterate vec.

        # Generate Y slice values
        ys_chunk = ys[y0:y1]
        # Create points: need to generate all combinations of xs, ys_chunk, zs
        # Efficient: use repeat/tile
        # But simplest: loop over y in chunk and process x-z plane (~65k points per y) and fill volume[:, y_idx, :]
        for yi_local, yv in enumerate(ys_chunk):
            yi_global = y0 + yi_local
            # x-z plane at y = yv: generate (nx*nz, 3)
            # Use meshgrid for this plane
            X, Z = np.meshgrid(xs, zs, indexing='ij')  # shapes (nx,nz)
            Nplane = nx*nz
            p_plane = np.empty((Nplane, 3), dtype=np.float64)
            p_plane[:,0] = X.ravel()
            p_plane[:,1] = yv
            p_plane[:,2] = Z.ravel()
            # Evaluate SDF in chunks of plane if too large (split)
            # 65k * few operations is fine, but we split into sub-chunks 16k to keep cache
            sub = 16384
            d_plane = np.empty(Nplane, dtype=np.float32)
            for s0 in range(0, Nplane, sub):
                s1 = min(s0+sub, Nplane)
                d_plane[s0:s1] = sdf_fn(p_plane[s0:s1])
            # Store into volume: volume[:, yi_global, :] ?
            # Our volume currently indexed as [x,y,z] -> volume[x,y,z] = d at (xs[x], ys[y], zs[z])
            # Since X,Z meshgrid with indexing ij gives X[x,z],Z[x,z]
            # So plane_d[x,z] = d_plane reshaped (nx,nz)
            plane_2d = d_plane.reshape(nx, nz)
            volume[:, yi_global, :] = plane_2d
        if verbose:
            print(f"Chunk {ci+1}/{total_chunks} y={y0}-{y1} done")
    # Transpose to (nz, ny, nx) maybe? But for skimage we can pass volume transposed with correct spacing.
    # Skimage's marching_cubes expects volume shape (M,N,P) where spacing = (sx,sy,sz) corresponds to axis order.
    # If we pass volume as (nx,ny,nz) directly, spacing order will be (dx, dy, dz) but axes are (x,y,z) not (z,y,x) - but geometry remains correct up to permutation of axes if viewer handles orientation.
    # To ensure y is up, we want y axis corresponds to second dimension (so that exported mesh y is up). Our volume currently (x,y,z). We'll transpose to (z,y,x)?? That would swap x & z.
    # Simpler: keep (nx,ny,nz) and pass spacing (dx,dy,dz) and later after marching we'll interpret verts as (x,y,z) correctly by reordering columns.
    # Actually marching_cubes will return verts as coordinates in index space scaled by spacing: verts[:,0] = x_index*spacing0, etc.
    # So if we feed volume[x,y,z], then verts[:,0] maps to x, verts[:,1] to y, verts[:,2] to z — perfect, no transpose needed; skimage doesn't assume any particular world up, it just scales indices.
    # However skimage's implementation expects C-contiguous array with shape (M,N,P) and will internally treat axis 0 as first spacing. That's okay.
    # We just need to ensure origin offset added after.
    # But our volume has shape (nx,ny,nz) with y middle; that's still M=nx,N=ny,P=nz but our xmin etc. spacing matches. So verts will be in (x,y,z) order as we desire.

    return volume, (xs, ys, zs), spacing, (xmin, ymin, zmin)

def marching_cubes_mesh(volume, spacing, origin, level=0.0, step_size=1, allow_degenerate=False):
    """
    Wrapper around skimage.measure.marching_cubes
    Returns verts (V,3) in world coords, faces (F,3), normals (V,3), values (V,)
    """
    from skimage import measure
    # skimage expects spacing order corresponding to volume axes: spacing[0] for axis 0, etc.
    # Our volume axes are (x,y,z) with spacing (dx,dy,dz)
    verts, faces, normals, values = measure.marching_cubes(volume, level=level, spacing=spacing, step_size=step_size, allow_degenerate=allow_degenerate)
    # Add origin offset
    verts[:,0] += origin[0]
    verts[:,1] += origin[1]
    verts[:,2] += origin[2]
    # Skimage normals maybe inverted? For SDF negative inside, normals should point outward (toward +SDF). Check.
    return verts, faces, normals, values

def decimate_mesh(verts, faces, target_reduction=0.5):
    """
    Naïve decimation via trimesh or quadric if available. Fallback returns original.
    """
    try:
        import trimesh
        mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
        # Use trimesh simplification if available (needs fast_simplification or open3d)
        # Try via mesh.simplify_quadratic_decimation if exists
        if hasattr(mesh, 'simplify_quadratic_decimation'):
            mesh2 = mesh.simplify_quadratic_decimation(int(len(faces)*(1-target_reduction)))
            return np.array(mesh2.vertices), np.array(mesh2.faces)
    except Exception as e:
        pass
    return verts, faces

def compute_vertex_normals(verts, faces):
    """
    Recompute smooth normals via area-weighted average if needed.
    """
    N = verts.shape[0]
    normals = np.zeros((N,3), dtype=np.float64)
    # face normals
    v0 = verts[faces[:,0]]
    v1 = verts[faces[:,1]]
    v2 = verts[faces[:,2]]
    fn = np.cross(v1 - v0, v2 - v0)
    # area weighting via magnitude already
    for i, f in enumerate(faces):
        for j in range(3):
            normals[f[j]] += fn[i]
    # normalize
    nlen = np.linalg.norm(normals, axis=1, keepdims=True)+1e-9
    normals /= nlen
    return normals

def export_obj(path, verts, faces, normals=None, vertex_colors=None):
    """
    Export OBJ. If vertex_colors provided (N,3) 0..1, we add extension v x y z r g b.
    Many viewers ignore vertex color in OBJ; we also export PLY alternative externally.
    But we support it for completeness.
    """
    with open(path, 'w') as f:
        f.write(f"# Frontier generated {len(verts)} verts {len(faces)} faces\n")
        for i, v in enumerate(verts):
            if vertex_colors is not None:
                c = vertex_colors[i]
                f.write(f"v {v[0]:.6f} {v[1]:.6f} {v[2]:.6f} {c[0]:.4f} {c[1]:.4f} {c[2]:.4f}\n")
            else:
                f.write(f"v {v[0]:.6f} {v[1]:.6f} {v[2]:.6f}\n")
        if normals is not None:
            for n in normals:
                f.write(f"vn {n[0]:.6f} {n[1]:.6f} {n[2]:.6f}\n")
            for face in faces:
                # OBJ indices 1-based, with normals
                f.write(f"f {face[0]+1}//{face[0]+1} {face[1]+1}//{face[1]+1} {face[2]+1}//{face[2]+1}\n")
        else:
            for face in faces:
                f.write(f"f {face[0]+1} {face[1]+1} {face[2]+1}\n")

def export_ply(path, verts, faces, normals=None, vertex_colors=None):
    """
    PLY with vertex colors (Ascii). More reliably preserves vertex color than OBJ.
    """
    n_verts = verts.shape[0]
    n_faces = faces.shape[0]
    has_norm = normals is not None
    has_color = vertex_colors is not None
    with open(path, 'w') as f:
        f.write("ply\n")
        f.write("format ascii 1.0\n")
        f.write(f"element vertex {n_verts}\n")
        f.write("property float x\nproperty float y\nproperty float z\n")
        if has_norm:
            f.write("property float nx\nproperty float ny\nproperty float nz\n")
        if has_color:
            f.write("property uchar red\nproperty uchar green\nproperty uchar blue\n")
        f.write(f"element face {n_faces}\n")
        f.write("property list uchar int vertex_indices\n")
        f.write("end_header\n")
        for i, v in enumerate(verts):
            line = f"{v[0]:.6f} {v[1]:.6f} {v[2]:.6f}"
            if has_norm:
                n = normals[i]
                line += f" {n[0]:.6f} {n[1]:.6f} {n[2]:.6f}"
            if has_color:
                c = (np.clip(vertex_colors[i],0,1)*255).astype(int)
                line += f" {c[0]} {c[1]} {c[2]}"
            f.write(line+"\n")
        for face in faces:
            f.write(f"3 {face[0]} {face[1]} {face[2]}\n")
