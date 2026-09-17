"""Previews (PNG bytes) and file exporters (OBJ, heightmap, SDF volume)."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from .sdf import SDFConfig, sdf_slice_vertical


def _to_png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _turbo_approx(t: np.ndarray) -> np.ndarray:
    """Cheap turbo-like colormap (blue->cyan->green->yellow->red)."""
    t = np.clip(np.asarray(t, dtype=np.float64), 0.0, 1.0)
    r = np.clip(1.9 * t - 0.55 + 0.35 * np.sin(t * 9.0), 0.0, 1.0)
    g = np.clip(1.65 - np.abs(t - 0.45) * 3.4, 0.0, 1.0)
    b = np.clip(1.75 - t * 2.6 + 0.25 * np.sin(t * 7.0 + 1.0), 0.0, 1.0)
    # Deepen the low end toward navy for contrast.
    deep = np.clip(1 - t * 3.0, 0, 1)[..., None]
    rgb = np.stack([r, g, b], axis=-1)
    navy = np.array([0.05, 0.08, 0.25])
    rgb = rgb * (1 - deep * 0.55) + navy * (deep * 0.55)
    return (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)


def render_map_preview(
    data: np.ndarray, mode: str = "turbo", size: int = 512
) -> bytes:
    """Render a float map (or uint8 RGB) to PNG bytes."""
    if data.ndim == 3 and data.shape[2] in (3, 4):
        img = Image.fromarray(data.astype(np.uint8), "RGB" if data.shape[2] == 3 else "RGBA")
    else:
        a = np.asarray(data, dtype=np.float64)
        lo, hi = float(np.min(a)), float(np.max(a))
        t = (a - lo) / max(hi - lo, 1e-12)
        if mode == "gray":
            rgb = (t * 255 + 0.5).astype(np.uint8)
            img = Image.fromarray(rgb, "L").convert("RGB")
        elif mode == "height":
            # Hypsometric tint.
            shaded = _turbo_approx(np.power(t, 0.8))
            img = Image.fromarray(shaded, "RGB")
        else:
            img = Image.fromarray(_turbo_approx(t), "RGB")
    if size and max(img.size) != size:
        img = img.resize((size, size), Image.LANCZOS)
    return _to_png(img)


def render_shaded_preview(
    albedo: np.ndarray, shade: np.ndarray, size: int = 768
) -> bytes:
    """Albedo x hillshade composite for the 2D overview."""
    a = np.asarray(albedo, dtype=np.float64)
    s = np.asarray(shade, dtype=np.float64)
    s = 0.35 + 0.65 * (s - s.min()) / max(float(np.ptp(s)), 1e-9)
    comp = np.clip(a * s[..., None], 0, 255).astype(np.uint8)
    img = Image.fromarray(comp, "RGB")
    if size and max(img.size) != size:
        img = img.resize((size, size), Image.LANCZOS)
    return _to_png(img)


def render_normals(normals: np.ndarray, size: int = 512) -> bytes:
    n = np.asarray(normals, dtype=np.float64)
    rgb = ((n * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)
    img = Image.fromarray(rgb, "RGB")
    if size and max(img.size) != size:
        img = img.resize((size, size), Image.NEAREST)
    return _to_png(img)


def render_sdf_slice(
    height: np.ndarray, cfg: SDFConfig, row: int | None = None, size: int = 768
) -> bytes:
    """Vertical SDF cross-section: filled earth + distance contour bands.

    Uses an exact 2D Euclidean distance transform on the slice so the bands
    are true iso-distance contours of the field.
    """
    sdf, xs, ys = sdf_slice_vertical(height, cfg, row=row)
    try:
        from scipy.ndimage import distance_transform_edt

        dy = float(ys[1] - ys[0]) if len(ys) > 1 else 1.0
        dx = float(xs[1] - xs[0]) if len(xs) > 1 else 1.0
        inside = sdf < 0
        d_out = distance_transform_edt(~inside, sampling=(dy, dx))
        d_in = distance_transform_edt(inside, sampling=(dy, dx))
        sdf = (d_out - d_in).astype(np.float32)
    except Exception:
        pass  # fall back to the analytic approximation
    n = sdf.shape[1]
    m = sdf.shape[0]
    rgb = np.zeros((m, n, 3), dtype=np.uint8)
    inside = sdf < 0
    # Earth fill: dark brown gradient with depth.
    depth = np.clip(-sdf / 8.0, 0, 1)
    rgb[inside] = (
        np.stack(
            [
                92 - 40 * depth[inside],
                70 - 30 * depth[inside],
                52 - 22 * depth[inside],
            ],
            axis=-1
        )
    ).astype(np.uint8)
    # Air: distance bands every 1 m.
    air = ~inside
    band = np.abs((sdf % 2.0) - 1.0)  # 0..1 sawtooth per 2 m
    glow = np.clip(1.0 - sdf / 25.0, 0.05, 1.0)
    rgb[air] = (
        np.stack(
            [
                20 + 60 * band[air] * glow[air],
                40 + 80 * band[air] * glow[air],
                70 + 120 * band[air] * glow[air],
            ],
            axis=-1
        )
    ).astype(np.uint8)
    # Zero contour (the surface): bright line.
    zero = np.abs(sdf) < (cfg.voxel_y * 0.75)
    rgb[zero] = (255, 220, 130)
    img = Image.fromarray(rgb, "RGB").transpose(Image.FLIP_TOP_BOTTOM)
    # Letterbox to a wide aspect.
    w, h = img.size
    target_w = size
    target_h = max(size * h // max(w, 1), 8)
    img = img.resize((target_w, target_h), Image.LANCZOS)
    return _to_png(img)


def export_obj(
    height: np.ndarray,
    cfg: SDFConfig,
    path: str,
    max_res: int = 256,
    albedo: np.ndarray | None = None,
) -> dict:
    """Export a textured OBJ mesh (grid resampled to <= max_res)."""
    n = height.shape[0]
    step = max(1, int(np.ceil(n / max_res)))
    hs = np.asarray(height)[::step, ::step]
    rn, cn = hs.shape
    xs = (np.arange(cn) * step / (n - 1) - 0.5) * cfg.extent
    zs = (np.arange(rn) * step / (n - 1) - 0.5) * cfg.extent
    # Vertex normals from the resampled grid.
    cell_s = cfg.cell * step
    gz, gx = np.gradient(hs.astype(np.float64), cell_s)
    inv = 1.0 / np.sqrt(gx * gx + 1.0 + gz * gz)

    with open(path, "w") as f:
        f.write(f"# Frontier SDF terrain {cfg.extent}x{cfg.extent} m\n")
        has_uv = albedo is not None
        if has_uv:
            mtl_path = path.rsplit(".", 1)[0] + ".mtl"
            f.write(f"mtllib {mtl_path.split('/')[-1]}\n")
        for i in range(rn):
            for j in range(cn):
                f.write(f"v {xs[j]:.4f} {hs[i, j]:.4f} {zs[i]:.4f}\n")
        if has_uv:
            for i in range(rn):
                for j in range(cn):
                    f.write(f"vT {j / max(cn - 1, 1):.5f} {1.0 - i / max(rn - 1, 1):.5f}\n")
        for i in range(rn):
            for j in range(cn):
                f.write(f"vn {-gx[i, j]*inv[i, j]:.5f} {inv[i, j]:.5f} {-gz[i, j]*inv[i, j]:.5f}\n")
        if has_uv:
            f.write("usemtl terrain\n")
        for i in range(rn - 1):
            for j in range(cn - 1):
                a = i * cn + j + 1
                b = a + 1
                c = a + cn
                d = c + 1
                if has_uv:
                    f.write(f"f {a}/{a}/{a} {c}/{c}/{c} {b}/{b}/{b}\n")
                    f.write(f"f {b}/{b}/{b} {c}/{c}/{c} {d}/{d}/{d}\n")
                else:
                    f.write(f"f {a}//{a} {c}//{c} {b}//{b}\n")
                    f.write(f"f {b}//{b} {c}//{c} {d}//{d}\n")
    out = {"path": path, "vertices": rn * cn, "triangles": (rn - 1) * (cn - 1) * 2}
    if albedo is not None:
        tex_path = path.rsplit(".", 1)[0] + "_albedo.png"
        Image.fromarray(np.asarray(albedo, dtype=np.uint8)).save(tex_path)
        with open(mtl_path, "w") as f:
            f.write("newmtl terrain\nKa 1 1 1\nKd 1 1 1\nKs 0 0 0\n")
            f.write(f"map_Kd {tex_path.split('/')[-1]}\n")
        out["texture"] = tex_path
        out["material"] = mtl_path
    return out


def export_height_png16(height: np.ndarray, path: str) -> dict:
    h = np.asarray(height, dtype=np.float64)
    lo, hi = float(h.min()), float(h.max())
    q = ((h - lo) / max(hi - lo, 1e-12) * 65535.0 + 0.5).astype(np.uint16)
    Image.fromarray(q).save(path)
    return {"path": path, "min_m": lo, "max_m": hi}
