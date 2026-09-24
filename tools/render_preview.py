#!/usr/bin/env python3
"""Render wave shape previews from dump_profile.mjs output (z-buffered).

Panels:
  (a) side-view profiles at several break stages
  (b) shaded 3/4 view of the sheet mesh (segment-colored)
  (c) chase-cam-ish view from the flats

Usage: node tools/dump_profile.mjs > /tmp/profile.json \
       && python3 tools/render_preview.py /tmp/profile.json docs/wave_preview.png
"""
import json, sys, math
import numpy as np
from PIL import Image, ImageDraw

W, H = 1500, 1050

SEG_COLORS = {
    'FLATF': (40, 110, 150),
    'FACE': (60, 175, 175),
    'ROLLO': (255, 200, 80),
    'ROLLI': (255, 140, 70),
    'BACK': (70, 140, 95),
    'FLATB': (35, 85, 120),
}


def rasterize(mesh_rows, cam, light, pw, ph, fov=1.15, fog_col=None):
    """Z-buffered flat-shaded triangle rasterizer. mesh_rows: list of (name, rows)."""
    img = np.zeros((ph, pw, 3), np.float32)
    zb = np.full((ph, pw), 1e9, np.float32)
    eye, target, up = (np.array(v, float) for v in cam)
    f = target - eye; f /= np.linalg.norm(f)
    r = np.cross(f, up); r /= (np.linalg.norm(r) + 1e-9)
    u = np.cross(r, f)
    s = (pw * 0.5) / math.tan(fov / 2)
    L = np.array(light, float); L /= np.linalg.norm(L)

    def proj(p):
        d = np.asarray(p, float) - eye
        x, y, z = float(np.dot(d, r)), float(np.dot(d, u)), float(np.dot(d, f))
        return (pw * 0.5 + x * s / z, ph * 0.55 - y * s / z, z) if z > 0.15 else None

    def tri(pa, pb, pc, col, p3a, p3b, p3c):
        pp = [proj(p3a), proj(p3b), proj(p3c)]
        if any(p is None for p in pp):
            return
        n = np.cross(np.array(p3b) - p3a, np.array(p3c) - p3a)
        ln = np.linalg.norm(n)
        if ln < 1e-10:
            return
        n /= ln
        lam = abs(float(np.dot(n, L)))
        amb = 0.34 + 0.28 * abs(n[1] * 0.5 + 0.5)
        c = np.array(col, float) * (amb + 0.85 * lam)
        xs = [p[0] for p in pp]; ys = [p[1] for p in pp]
        x0 = max(0, int(math.floor(min(xs)))); x1 = min(pw - 1, int(math.ceil(max(xs))))
        y0 = max(0, int(math.floor(min(ys)))); y1 = min(ph - 1, int(math.ceil(max(ys))))
        if x1 < x0 or y1 < y0:
            return
        (xa, ya, za), (xb, yb, zb_), (xc, yc, zc) = pp
        denom = (yb - yc) * (xa - xc) + (xc - xb) * (ya - yc)
        if abs(denom) < 1e-12:
            return
        ys_r, xs_r = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        px = xs_r + 0.5; py = ys_r + 0.5
        w0 = ((yb - yc) * (px - xc) + (xc - xb) * (py - yc)) / denom
        w1 = ((yc - ya) * (px - xc) + (xa - xc) * (py - yc)) / denom
        w2 = 1.0 - w0 - w1
        m = (w0 >= -0.002) & (w1 >= -0.002) & (w2 >= -0.002)
        if not m.any():
            return
        z = w0 * za + w1 * zb_ + w2 * zc
        sub = zb[y0:y1 + 1, x0:x1 + 1]
        upd = m & (z < sub)
        sub[upd] = z[upd]
        img[y0:y1 + 1, x0:x1 + 1][upd] = np.minimum(255, c)

    for name, rows in mesh_rows:
        col = SEG_COLORS.get(name, (120, 120, 120))
        nR, nC = len(rows), len(rows[0])
        for j in range(nR - 1):
            for i in range(nC - 1):
                a = rows[j][i]; b = rows[j][i + 1]
                c = rows[j + 1][i]; d = rows[j + 1][i + 1]
                tri(None, None, None, col, a, b, c)
                tri(None, None, None, col, b, d, c)
    if fog_col is not None:
        pass
    return img.astype(np.uint8)


def main():
    data = json.load(open(sys.argv[1]))
    out_path = sys.argv[2] if len(sys.argv) > 2 else '/home/user/Frontier/docs/wave_preview.png'
    img = Image.new('RGB', (W, H), (18, 24, 34))
    dr = ImageDraw.Draw(img)

    # ---------- panel (a): side profiles ----------
    ax0, ay0, ax1, ay1 = 10, 10, 740, 520
    sub = Image.new('RGB', (ax1 - ax0, ay1 - ay0), (12, 22, 34))
    sd = ImageDraw.Draw(sub)
    sw, sh = sub.size
    XMIN, XMAX, YMIN, YMAX = -9.0, 11.0, -0.6, 4.4

    def A(X, y):
        px = 24 + (X - XMIN) / (XMAX - XMIN) * (sw - 48)
        py = sh - 24 - (y - YMIN) / (YMAX - YMIN) * (sh - 48)
        return (px, py)

    sd.line([A(XMIN, 0), A(XMAX, 0)], fill=(55, 75, 95), width=1)
    for gx in range(-8, 11, 2):
        sd.line([A(gx, YMIN), A(gx, YMAX)], fill=(28, 40, 54), width=1)
        sd.text((A(gx, YMIN)[0] - 6, A(XMIN, YMIN)[1] - 14), f'{gx}m', fill=(70, 90, 110))
    colors = [(100, 130, 150), (90, 180, 200), (70, 200, 175), (255, 205, 95),
              (255, 150, 85), (245, 115, 95), (175, 185, 200), (130, 150, 170)]
    for idx, prof in enumerate(data['profiles']):
        pts = [A(x, y) for x, y in prof['pts']]
        sd.line(pts, fill=colors[idx % len(colors)], width=3, joint='curve')
        tip = max(prof['pts'][:60], key=lambda q: q[0] * 0.3 + q[1])
        sd.text((A(tip[0], tip[1])[0] + 2, A(tip[0], tip[1])[1] - 10),
                f"b={prof['b']}", fill=colors[idx % len(colors)])
    sd.text((10, 6), "SIDE VIEW — wave cross-section vs break stage b  (X: shore->right)", fill=(225, 235, 245))
    img.paste(sub, (ax0, ay0))

    # ---------- organize mesh rows with names ----------
    rows_spec = [('FLATF', 14), ('FACE', 18), ('ROLLO', 10), ('ROLLI', 8), ('BACK', 10), ('FLATB', 6)]
    flat = data['mesh']
    mesh_rows, off = [], 0
    for name, n in rows_spec:
        mesh_rows.append((name, flat[off:off + n]))
        off += n

    # ---------- panel (b): 3/4 view (aimed at the peel, z ~ 55) ----------
    bx0, by0, bx1, by1 = 760, 10, 1490, 520
    cam = ((26, 7.5, 34), (4, 1.5, 54), (0, 1, 0))
    arr = rasterize(mesh_rows, cam, light=(0.55, 0.65, -0.5), pw=bx1 - bx0, ph=by1 - by0)
    img.paste(Image.fromarray(arr), (bx0, by0))
    dr.rectangle([bx0, by0, bx1, by1], outline=(70, 90, 110))
    dr.text((bx0 + 10, by0 + 6), "3/4 VIEW — sheet: yellow=lip, orange=ceiling, teal=face, blue=flats", fill=(235, 240, 245))

    # ---------- panel (c): chase view from the flats, looking up-face at pocket ----------
    cx0, cy0, cx1, cy1 = 10, 540, 1490, 1040
    cam2 = ((11.5, 1.7, 44), (3.0, 2.3, 54), (0, 1, 0))
    arr2 = rasterize(mesh_rows, cam2, light=(0.55, 0.65, -0.5), pw=cx1 - cx0, ph=cy1 - cy0, fov=1.3)
    img.paste(Image.fromarray(arr2), (cx0, cy0))
    dr.rectangle([cx0, cy0, cx1, cy1], outline=(70, 90, 110))
    dr.text((cx0 + 10, cy0 + 6), "RIDER VIEW — looking up-face at the wall & pocket", fill=(235, 240, 245))

    img.save(out_path)
    print('wrote', out_path)


if __name__ == '__main__':
    main()
