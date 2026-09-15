"""Export: height/normal/AO/splat maps, satellite preview, OBJ + PLY meshes."""
from __future__ import annotations

import json
import os
from typing import Dict, Optional

import numpy as np

try:
    from PIL import Image
    _HAVE_PIL = True
except Exception:  # pragma: no cover
    _HAVE_PIL = False


def _to8(a: np.ndarray) -> np.ndarray:
    return np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8)


def save_png(path: str, a: np.ndarray) -> None:
    if not _HAVE_PIL:
        raise RuntimeError("Pillow is required for PNG export")
    a = np.asarray(a)
    if a.ndim == 2:
        Image.fromarray(_to8(a), mode="L").save(path)
    elif a.ndim == 3 and a.shape[2] == 3:
        Image.fromarray(_to8(a), mode="RGB").save(path)
    elif a.ndim == 3 and a.shape[2] == 4:
        Image.fromarray(_to8(a), mode="RGBA").save(path)
    else:
        raise ValueError("unsupported array shape for PNG")


def save_png16(path: str, a: np.ndarray) -> None:
    """16-bit single channel PNG (height maps, splat precision)."""
    if not _HAVE_PIL:
        raise RuntimeError("Pillow is required for PNG export")
    v = np.clip(a, 0.0, 1.0)
    u = (v * 65535.0 + 0.5).astype(np.uint16)
    Image.fromarray(u, mode="I;16").save(path)


def encode_normal(n: np.ndarray) -> np.ndarray:
    return np.clip(n * 0.5 + 0.5, 0.0, 1.0)


def save_obj(path: str, z: np.ndarray, cell: float, xy_scale: float = 1.0,
             z_scale: float = 1.0, stride: int = 1, uv: bool = False) -> None:
    """Write a heightfield as a wavefront OBJ (optionally with UVs)."""
    ny, nx = z.shape
    zz = z[::stride, ::stride]
    nyy, nxx = zz.shape
    with open(path, "w") as f:
        f.write("# Frontier terrain export\n")
        for j in range(nyy):
            for i in range(nxx):
                f.write("v %.4f %.4f %.4f\n" % (i * cell * stride * xy_scale,
                                                j * cell * stride * xy_scale,
                                                zz[j, i] * z_scale))
        if uv:
            for j in range(nyy):
                for i in range(nxx):
                    f.write("vt %.6f %.6f\n" % (i / max(nxx - 1, 1), 1.0 - j / max(nyy - 1, 1)))
        if uv:
            for j in range(nyy - 1):
                for i in range(nxx - 1):
                    a = j * nxx + i + 1
                    b = a + 1
                    c = a + nxx + 1
                    d = a + nxx
                    f.write("f %d/%d %d/%d %d/%d\n" % (a, a, c, c, b, b))
                    f.write("f %d/%d %d/%d %d/%d\n" % (a, a, d, d, c, c))
        else:
            for j in range(nyy - 1):
                for i in range(nxx - 1):
                    a = j * nxx + i + 1
                    b = a + 1
                    c = a + nxx + 1
                    d = a + nxx
                    f.write("f %d %d %d\n" % (a, c, b))
                    f.write("f %d %d %d\n" % (a, d, c))


def save_ply(path: str, z: np.ndarray, cell: float, stride: int = 1,
             colors: Optional[np.ndarray] = None) -> None:
    """Binary-ish ASCII PLY with optional per-vertex colour (from the satmap)."""
    ny, nx = z.shape
    zz = z[::stride, ::stride]
    cc = colors[::stride, ::stride] if colors is not None else None
    nyy, nxx = zz.shape
    has_c = cc is not None
    with open(path, "w") as f:
        f.write("ply\nformat ascii 1.0\n")
        f.write("element vertex %d\n" % (nyy * nxx))
        f.write("property float x\nproperty float y\nproperty float z\n")
        if has_c:
            f.write("property uchar red\nproperty uchar green\nproperty uchar blue\n")
        f.write("element face %d\n" % ((nyy - 1) * (nxx - 1) * 2))
        f.write("property list uchar int vertex_indices\nend_header\n")
        for j in range(nyy):
            for i in range(nxx):
                line = "%.4f %.4f %.4f" % (i * cell * stride, j * cell * stride, zz[j, i])
                if has_c:
                    c = np.clip(cc[j, i] * 255.0, 0, 255).astype(int)
                    line += " %d %d %d" % (c[0], c[1], c[2])
                f.write(line + "\n")
        for j in range(nyy - 1):
            for i in range(nxx - 1):
                a = j * nxx + i
                b = a + 1
                c = a + nxx + 1
                d = a + nxx
                f.write("3 %d %d %d\n" % (a, c, b))
                f.write("3 %d %d %d\n" % (a, d, c))


def grid_mesh(t, z_scale: float = 1.0, stride: int = 1):
    """Triangulate a heightfield on its own grid (world coordinates)."""
    ii = np.arange(0, t.nx, stride)
    jj = np.arange(0, t.ny, stride)
    X, Y = np.meshgrid(ii * t.cell, jj * t.cell)
    Z = t.z[np.ix_(jj, ii)].astype(np.float64) * z_scale
    verts = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    nxx = len(ii)
    faces = np.empty(((len(jj) - 1) * (nxx - 1) * 2, 3), dtype=np.int64)
    a = 0
    for b in range(len(jj) - 1):
        base = b * nxx
        for c in range(nxx - 1):
            v00 = base + c
            v10 = v00 + 1
            v01 = v00 + nxx
            v11 = v01 + 1
            faces[a] = (v00, v10, v11)
            faces[a + 1] = (v00, v11, v01)
            a += 2
    return verts, faces


def save_mesh_obj(path: str, verts: np.ndarray, faces: np.ndarray) -> None:
    with open(path, "w") as f:
        f.write("# Frontier SDF mesh export\n")
        for v in verts:
            f.write("v %.5f %.5f %.5f\n" % (v[0], v[1], v[2]))
        for tri in faces:
            f.write("f %d %d %d\n" % (tri[0] + 1, tri[1] + 1, tri[2] + 1))


def export_all(outdir: str, t, sat: Dict[str, np.ndarray], attrs=None,
               mesh: bool = False, hillshade: bool = True,
               sdf=None, z_scale: float = 1.0) -> Dict[str, str]:
    """Write the standard deliverable set the way a DCC tool would expect it.

    Produces the texture set (satmap/albedo/normal/AO/splat/height) plus, on
    request, a mesh (``mesh.obj`` / ``mesh.ply``) and a hillshade preview.  When
    an :class:`~frontier.sdf.volume.SDFVolume` is supplied its narrow band is
    saved too, so the structure field travels with the rest of the assets.
    """
    os.makedirs(outdir, exist_ok=True)
    paths = {}
    img = sat["image"]
    save_png(os.path.join(outdir, "satmap.png"), img)
    paths["satmap"] = os.path.join(outdir, "satmap.png")
    save_png(os.path.join(outdir, "albedo.png"), sat["albedo"])
    paths["albedo"] = os.path.join(outdir, "albedo.png")
    save_png(os.path.join(outdir, "normal.png"), encode_normal(sat["normal"]))
    paths["normal"] = os.path.join(outdir, "normal.png")
    save_png(os.path.join(outdir, "ao.png"), sat["ao"])
    paths["ao"] = os.path.join(outdir, "ao.png")
    # height, normalised to 16 bit with the true range recorded on the side
    z = t.z
    lo, hi = float(z.min()), float(z.max())
    save_png16(os.path.join(outdir, "height16.png"), (z - lo) / max(hi - lo, 1e-6))
    paths["height16"] = os.path.join(outdir, "height16.png")
    with open(os.path.join(outdir, "height_range.json"), "w") as f:
        json.dump(dict(z_min=lo, z_max=hi, cell=t.cell, nx=t.nx, ny=t.ny), f, indent=1)
    # splat maps, 4 materials per RGBA texture
    names = sorted(sat["weights"].keys())
    for k in range(0, len(names), 4):
        chunk = names[k:k + 4]
        rgba = np.zeros((t.ny, t.nx, 4), dtype=np.float32)
        for c, nm in enumerate(chunk):
            rgba[..., c] = sat["weights"][nm]
        fn = os.path.join(outdir, f"splat_{k // 4}.png")
        save_png(fn, rgba)
        paths[f"splat_{k // 4}"] = fn
    with open(os.path.join(outdir, "splits.json"), "w") as f:
        json.dump(names, f)
    if attrs is not None:
        save_png(os.path.join(outdir, "flow.png"),
                 np.clip(np.log10(attrs.flow + 1.0) / np.log10(1e7), 0, 1))
        paths["flow"] = os.path.join(outdir, "flow.png")
        save_png(os.path.join(outdir, "wetness.png"),
                 np.clip(attrs.wetness / 12.0, 0, 1))
        paths["wetness"] = os.path.join(outdir, "wetness.png")
        save_png(os.path.join(outdir, "openness.png"), attrs.openness)
        paths["openness"] = os.path.join(outdir, "openness.png")
        save_png(os.path.join(outdir, "cavity.png"), attrs.cavity)
        paths["cavity"] = os.path.join(outdir, "cavity.png")
    if hillshade:
        zz = t.z.astype(np.float64)
        gy, gx = np.gradient(zz, t.cell)
        n = np.dstack([-gx, -gy, np.ones_like(zz)])
        n /= np.linalg.norm(n, axis=2, keepdims=True)
        L = np.array([0.46, -0.64, 0.62])
        L /= np.linalg.norm(L)
        save_png(os.path.join(outdir, "hillshade.png"), np.clip(n @ L, 0, 1))
        paths["hillshade"] = os.path.join(outdir, "hillshade.png")
    if mesh:
        verts, faces = grid_mesh(t, z_scale=z_scale)
        save_mesh_obj(os.path.join(outdir, "mesh.obj"), verts, faces)
        paths["mesh_obj"] = os.path.join(outdir, "mesh.obj")
        cols = (sat["image"] if "image" in sat else None)
        save_ply(os.path.join(outdir, "mesh.ply"), t.z, t.cell, colors=cols)
        paths["mesh_ply"] = os.path.join(outdir, "mesh.ply")
    if sdf is not None:
        band = np.abs(sdf.phi) <= 4.0 * sdf.cell
        np.savez_compressed(os.path.join(outdir, "sdf_band.npz"),
                            phi=sdf.phi[band].astype(np.float32),
                            kji=np.stack(np.nonzero(band), axis=1).astype(np.int32),
                            cell=np.float64(sdf.cell),
                            origin=np.asarray(sdf.origin, dtype=np.float64),
                            shape=np.asarray(sdf.shape, dtype=np.int64))
        paths["sdf_band"] = os.path.join(outdir, "sdf_band.npz")
    return paths
