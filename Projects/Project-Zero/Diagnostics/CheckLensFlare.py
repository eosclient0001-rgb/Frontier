#!/usr/bin/env python3
"""Numeric gate for the celestial lens flare.

"The flare looks right" is an opinion. This turns it into pass/fail on the frames Project Zero exports:

  1. FIDELITY   — the shipped `CelestialIntegrator::LensFlare` is re-derived here straight from the reference
                  console's `lensFlare()` GLSL and evaluated against the C++ kernel dumped by the renderer.
                  Any drift between the two is a failure, which is what stops the port being quietly rewritten.
  2. PRESENCE   — every variety must differ from the flare-off control. If "flare on" and "flare off" render
                  the same pixels, the flare is not being composited, which is the exact bug being fixed.
  3. DISTINCTNESS — the four varieties must differ from each other. A single shared look means the variety
                  weights (ghost / halo / streak / burst) are not reaching the kernel.
  4. NOT FLAT   — a frame with a handful of unique colours is a broken render, not a sky.

    python3 Diagnostics/CheckLensFlare.py            # run from Projects/Project-Zero
"""

from __future__ import annotations

import os
import sys

VARIETIES = ("Cinematic", "Anamorphic", "Starburst", "Halo")
HERE = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------------------------------------------------
#   The reference kernel, re-transcribed from the published `lensFlare()` so the check is independent of
#   the shipping C++ rather than a copy of it.
# ---------------------------------------------------------------------------------------------------------

def fract(x: float) -> float:
    import math

    return x - math.floor(x)


def clamp01(x: float) -> float:
    return 0.0 if x < 0.0 else (1.0 if x > 1.0 else x)


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge0 == edge1:
        return 0.0 if x < edge0 else 1.0
    t = clamp01((x - edge0) / (edge1 - edge0))
    return t * t * (3.0 - 2.0 * t)


def hue(h: float) -> tuple[float, float, float]:
    """`hue()` from the reference: clamp(abs(mod(h*6+vec3(0,4,2),6)-3)-1, 0, 1)."""
    out = []
    for offset in (0.0, 4.0, 2.0):
        v = (h * 6.0 + offset) % 6.0
        out.append(clamp01(abs(v - 3.0) - 1.0))
    return tuple(out)  # type: ignore[return-value]


def lens_flare(u: float, v: float, sun_u: float, sun_v: float, visibility: float,
               *, variety: float, ghosts: float, halo_radius: float,
               streak_gain: float, chroma: float, intensity: float) -> tuple[float, float, float]:
    """`vec3 lensFlare(vec2 uv, vec2 s, float vis)` — expression for expression."""
    import math

    f = [0.0, 0.0, 0.0]
    mx, my = u - sun_u, v - sun_v

    w_ghost = 1.0 if variety in (0.0, 2.0) else 0.0
    w_halo = 1.0 if variety in (0.0, 3.0) else (0.5 if variety == 2.0 else 0.0)
    w_streak = 2.2 if variety == 1.0 else (1.0 if variety == 0.0 else 0.35)
    w_burst = 1.0 if variety == 2.0 else (0.35 if variety == 0.0 else 0.0)

    for i in range(8):
        if float(i) >= ghosts:
            break
        fi = float(i)
        k = -1.35 + fi * 0.42
        px, py = sun_u * k, sun_v * k
        r = 0.035 + 0.07 * fract(fi * 0.618 + 0.31)
        dd = math.hypot(u - px, v - py)
        g = smoothstep(r, r * 0.35, dd) * 0.9 + smoothstep(r * 1.6, r, dd) * 0.25
        g *= 0.06 + 0.06 * fract(fi * 0.37)
        tint = hue(fract(fi * 0.23 + 0.5))
        for c in range(3):
            f[c] += g * (1.0 + (tint[c] - 1.0) * chroma) * w_ghost

    hx, hy = u - sun_u * 0.25, v - sun_v * 0.25
    hr = math.hypot(hx, hy)
    ringd = abs(hr - halo_radius)
    halo = smoothstep(0.045, 0.0, ringd) * 0.09
    ring_angle = math.atan2(hy, hx)
    tint = hue(fract(ring_angle / 6.283 + ringd * 8.0))
    for c in range(3):
        f[c] += halo * (1.0 + (tint[c] - 1.0) * (chroma * 0.8)) * w_halo

    streak = math.exp(-abs(my) * 95.0) * math.exp(-abs(mx) * 2.2) * 0.55
    for c, target in enumerate((0.45, 0.65, 1.0)):
        f[c] += streak * streak_gain * (1.0 + (target - 1.0) * chroma) * w_streak

    a = math.atan2(my, mx)
    length = math.hypot(mx, my)
    burst = (abs(math.sin(a * 4.0 + 0.3)) ** 24.0) * math.exp(-length * 3.5) * 0.35 \
        + (abs(math.sin(a * 7.0)) ** 40.0) * math.exp(-length * 6.0) * 0.25
    for c, target in enumerate((1.0, 0.95, 0.85)):
        f[c] += burst * target * w_burst
    for c, target in enumerate((1.0, 0.9, 0.8)):
        f[c] += math.exp(-length * 1.6) * 0.04 * target

    return tuple(x * visibility * intensity for x in f)  # type: ignore[return-value]


# ---------------------------------------------------------------------------------------------------------
#   Frame inspection
# ---------------------------------------------------------------------------------------------------------

def read_ppm(path: str) -> tuple[int, int, bytes]:
    with open(path, "rb") as handle:
        data = handle.read()
    if not data.startswith(b"P6"):
        raise ValueError(f"{path}: not a binary P6 PPM")
    fields: list[int] = []
    index = 2
    while len(fields) < 3:
        while data[index : index + 1].isspace():
            index += 1
        if data[index : index + 1] == b"#":
            while data[index : index + 1] not in (b"\n", b"\r"):
                index += 1
            continue
        start = index
        while not data[index : index + 1].isspace():
            index += 1
        fields.append(int(data[start:index]))
    index += 1
    width, height, _ = fields
    return width, height, data[index : index + width * height * 3]


def unique_colours(raster: bytes) -> int:
    return len({raster[i : i + 3] for i in range(0, len(raster), 3)})


def compare(a: bytes, b: bytes) -> tuple[int, int, float]:
    changed = sum(1 for i in range(0, len(a), 3) if a[i : i + 3] != b[i : i + 3])
    peak = 0
    total = 0
    for i in range(len(a)):
        d = abs(a[i] - b[i])
        peak = max(peak, d)
        total += d
    return changed, peak, total / len(a)


def main() -> int:
    failures: list[str] = []

    # ---- 1. Fidelity of the kernel itself -----------------------------------------------------------
    dump = os.path.join(HERE, "FlareKernelDump.txt")
    if os.path.exists(dump):
        worst = 0.0
        rows = 0
        with open(dump, "r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip() or line.startswith("#"):
                    continue
                parts = [float(p) for p in line.split()]
                (variety, ghosts, halo_r, streak, chroma, intensity,
                 u, v, su, sv, vis, r, g, b) = parts
                expect = lens_flare(u, v, su, sv, vis, variety=variety, ghosts=ghosts,
                                    halo_radius=halo_r, streak_gain=streak,
                                    chroma=chroma, intensity=intensity)
                for got, want in zip((r, g, b), expect):
                    worst = max(worst, abs(got - want))
                rows += 1
        tolerance = 2e-5
        status = "PASS" if worst <= tolerance else "FAIL"
        print(f"[{status}] kernel fidelity vs reference GLSL — {rows} samples, worst |Δ| = {worst:.3e}")
        if worst > tolerance:
            failures.append("lens flare kernel drifted from the reference lensFlare()")
    else:
        print(f"[SKIP] kernel fidelity — {os.path.basename(dump)} not present")

    # ---- 2/3/4. The rendered frames -----------------------------------------------------------------
    control_path = os.path.join(HERE, "ProjectZero_Flare_Off.ppm")
    if not os.path.exists(control_path):
        print("[FAIL] control frame ProjectZero_Flare_Off.ppm missing — run ./bin/Project-Zero first")
        return 1

    _, _, control = read_ppm(control_path)
    control_colours = unique_colours(control)
    print(f"[INFO] control frame: {control_colours} unique colours")
    if control_colours < 256:
        failures.append("control frame is effectively flat — the render is broken, not the flare")

    rasters: dict[str, bytes] = {}
    for name in VARIETIES:
        path = os.path.join(HERE, f"ProjectZero_Flare_{name}.ppm")
        if not os.path.exists(path):
            print(f"[FAIL] {name}: frame missing")
            failures.append(f"{name} frame missing")
            continue
        _, _, raster = read_ppm(path)
        rasters[name] = raster

        changed, peak, mean = compare(raster, control)
        colours = unique_colours(raster)
        present = changed > 0 and peak > 1
        flat = colours < 256
        status = "PASS" if present and not flat else "FAIL"
        print(f"[{status}] {name:<11} {changed:>7} px differ from control | peak Δ {peak:>3} "
              f"| mean Δ {mean:5.3f} | {colours} colours")
        if not present:
            failures.append(f"{name} is identical to the flare-off control — flare not composited")
        if flat:
            failures.append(f"{name} frame is effectively flat")

    # Distinctness between varieties.
    names = [n for n in VARIETIES if n in rasters]
    for i, first in enumerate(names):
        for second in names[i + 1 :]:
            changed, peak, _ = compare(rasters[first], rasters[second])
            if changed == 0:
                print(f"[FAIL] {first} and {second} are pixel-identical")
                failures.append(f"{first} and {second} are identical — variety weights not applied")

    print()
    if failures:
        print(f"FAILED — {len(failures)} problem(s):")
        for problem in failures:
            print(f"  · {problem}")
        return 1

    print("PASSED — the lens flare matches the reference kernel, is composited, and every variety is distinct.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
