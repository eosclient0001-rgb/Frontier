// Spline sampling: centripetal Catmull-Rom through road control points with per-point lift interpolation.
// Centripetal parametrisation avoids cusps and loops at tight control spacing.

import { dist2, P2, smoothstep } from "./math";
import type { ControlPoint } from "./model";

export interface SamplePoint extends P2 {
  lift: number; // [m] - Lift above ground at this sample
}

// Barry-Goldman evaluation of a centripetal Catmull-Rom segment between p1 and p2.
function crPoint(p0: P2, p1: P2, p2: P2, p3: P2, u: number): P2 {
  const t0 = 0;
  const t1 = t0 + Math.pow(Math.max(dist2(p0, p1), 1e-6), 0.5);
  const t2 = t1 + Math.pow(Math.max(dist2(p1, p2), 1e-6), 0.5);
  const t3 = t2 + Math.pow(Math.max(dist2(p2, p3), 1e-6), 0.5);
  const t = t1 + (t2 - t1) * u;
  const lerpP = (a: P2, b: P2, ta: number, tb: number): P2 => {
    const k = tb - ta < 1e-9 ? 0 : (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
  };
  const a1 = lerpP(p0, p1, t0, t1);
  const a2 = lerpP(p1, p2, t1, t2);
  const a3 = lerpP(p2, p3, t2, t3);
  const b1 = lerpP(a1, a2, t0, t2);
  const b2 = lerpP(a2, a3, t1, t3);
  return lerpP(b1, b2, t1, t2);
}

// Sample a road's centreline at roughly `step` metre spacing. Endpoints are included exactly.
export function sampleCurve(points: readonly ControlPoint[], step: number): SamplePoint[] {
  const out: SamplePoint[] = [];
  const n = points.length;
  if (n < 2) return out;
  const c = points.map((p) => ({ x: p.x, z: p.z }));
  // Reflect the ends so the first and last segments have well-defined tangents.
  const first: P2 = { x: 2 * c[0].x - c[1].x, z: 2 * c[0].z - c[1].z };
  const last: P2 = { x: 2 * c[n - 1].x - c[n - 2].x, z: 2 * c[n - 1].z - c[n - 2].z };
  for (let k = 0; k < n - 1; k++) {
    const p0 = k === 0 ? first : c[k - 1];
    const p1 = c[k];
    const p2 = c[k + 1];
    const p3 = k + 2 < n ? c[k + 2] : last;
    const chord = dist2(p1, p2);
    const segs = Math.max(2, Math.ceil(chord / step));
    const l1 = points[k].lift;
    const l2 = points[k + 1].lift;
    const startIdx = k === 0 ? 0 : 1; // avoid duplicating the shared control point
    for (let j = startIdx; j <= segs; j++) {
      const u = j / segs;
      const p = j === 0 ? p1 : j === segs ? p2 : crPoint(p0, p1, p2, p3, u);
      const lift = l1 + (l2 - l1) * smoothstep(0, 1, u);
      out.push({ x: p.x, z: p.z, lift });
    }
  }
  return out;
}

// Remove consecutive near-duplicate samples (under 1 cm), keeping the first of each run.
export function dedupeSamples(pts: SamplePoint[]): SamplePoint[] {
  const out: SamplePoint[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || dist2(last, p) > 0.01) out.push(p);
  }
  return out;
}

// Cumulative arc length of a point list (length = points.length, first entry 0).
export function arcLengths(pts: readonly P2[]): number[] {
  const s = new Array<number>(pts.length);
  s[0] = 0;
  for (let i = 1; i < pts.length; i++) s[i] = s[i - 1] + dist2(pts[i - 1], pts[i]);
  return s;
}

// Interpolate a point and lift at arc position `at` along a sampled polyline.
export function sampleAt(
  pts: readonly SamplePoint[],
  s: readonly number[],
  at: number
): SamplePoint {
  if (at <= 0) return pts[0];
  const last = s.length - 1;
  if (at >= s[last]) return pts[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid] <= at) lo = mid;
    else hi = mid;
  }
  const seg = s[hi] - s[lo];
  const t = seg > 1e-9 ? (at - s[lo]) / seg : 0;
  const a = pts[lo];
  const b = pts[hi];
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, lift: a.lift + (b.lift - a.lift) * t };
}

export function polylineLength(pts: readonly P2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist2(pts[i - 1], pts[i]);
  return l;
}
