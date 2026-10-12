import type { V2 } from './types';

/** Pure 2D (XZ-plane) geometry helpers. No DOM, no three.js. */

export const v2 = (x: number, z: number): V2 => ({ x, z });
export const add = (a: V2, b: V2): V2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: V2, b: V2): V2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: V2, k: number): V2 => ({ x: a.x * k, z: a.z * k });
export const dot = (a: V2, b: V2): number => a.x * b.x + a.z * b.z;
export const len = (a: V2): number => Math.hypot(a.x, a.z);
export const dist = (a: V2, b: V2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const lerp2 = (a: V2, b: V2, t: number): V2 => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});

export function normalize(a: V2): V2 {
  const l = len(a);
  return l < 1e-9 ? { x: 1, z: 0 } : { x: a.x / l, z: a.z / l };
}

/** Left normal of a unit tangent (left of travel when Y is up). */
export const leftNormal = (t: V2): V2 => ({ x: -t.z, z: t.x });

export interface CubicBezier {
  p0: V2;
  c1: V2;
  c2: V2;
  p3: V2;
}

export function bezierPoint(b: CubicBezier, t: number): V2 {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const bb = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * b.p0.x + bb * b.c1.x + c * b.c2.x + d * b.p3.x,
    z: a * b.p0.z + bb * b.c1.z + c * b.c2.z + d * b.p3.z,
  };
}

export function bezierTangent(b: CubicBezier, t: number): V2 {
  const mt = 1 - t;
  const k0 = 3 * mt * mt;
  const k1 = 6 * mt * t;
  const k2 = 3 * t * t;
  const x =
    k0 * (b.c1.x - b.p0.x) + k1 * (b.c2.x - b.c1.x) + k2 * (b.p3.x - b.c2.x);
  const z =
    k0 * (b.c1.z - b.p0.z) + k1 * (b.c2.z - b.c1.z) + k2 * (b.p3.z - b.c2.z);
  return normalize({ x, z });
}

/**
 * A sample along a curve. `s` is metres from the start, `u` the normalised arc
 * length (0..1). `nx,nz` is the LEFT normal.
 */
export interface Sample {
  x: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  s: number;
  u: number;
  t: number;
}

/**
 * Samples a cubic bezier at arc-length spacing of `step` metres, then drops
 * samples that deviate from the polyline by less than `tolerance` metres.
 * Always returns at least two samples (start and end).
 */
export function sampleBezier(b: CubicBezier, step = 0.5, tolerance = 0.03): Sample[] {
  // Dense parametric pass to build an arc-length table.
  const chord = dist(b.p0, b.p3) + dist(b.p0, b.c1) + dist(b.c2, b.p3);
  const denseN = Math.max(16, Math.min(4096, Math.ceil((chord / step) * 4)));
  const ts: number[] = new Array(denseN + 1);
  const pts: V2[] = new Array(denseN + 1);
  const cum: number[] = new Array(denseN + 1);
  cum[0] = 0;
  for (let i = 0; i <= denseN; i++) {
    const t = i / denseN;
    ts[i] = t;
    pts[i] = bezierPoint(b, t);
    if (i > 0) cum[i] = cum[i - 1] + dist(pts[i], pts[i - 1]);
  }
  const total = cum[denseN];
  const count = Math.max(2, Math.ceil(total / step) + 1);
  const out: Sample[] = [];
  let k = 0;
  for (let i = 0; i < count; i++) {
    const target = count === 1 ? 0 : (i / (count - 1)) * total;
    while (k < denseN - 1 && cum[k + 1] < target) k++;
    const seg = cum[k + 1] - cum[k];
    const f = seg > 1e-12 ? (target - cum[k]) / seg : 0;
    const t = ts[k] + (ts[k + 1] - ts[k]) * f;
    const p = lerp2(pts[k], pts[k + 1], f);
    const tg = bezierTangent(b, t);
    const n = leftNormal(tg);
    out.push({
      x: p.x,
      z: p.z,
      tx: tg.x,
      tz: tg.z,
      nx: n.x,
      nz: n.z,
      s: target,
      u: total > 0 ? target / total : 0,
      t,
    });
  }
  // Pin exact end points to avoid float drift at the joints.
  out[0] = { ...out[0], x: b.p0.x, z: b.p0.z };
  out[out.length - 1] = { ...out[out.length - 1], x: b.p3.x, z: b.p3.z };
  return simplifySamples(out, tolerance);
}

/**
 * Douglas-Peucker simplification on the XZ plane. Straight stretches collapse
 * to their end points, so mesh size scales with curvature rather than length.
 * Kept samples retain their true arc-length `s`, so `u` lookups stay exact.
 */
export function simplifySamples(samples: Sample[], tolerance: number): Sample[] {
  const n = samples.length;
  if (n <= 2) return samples;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = samples[a];
    const pb = samples[b];
    const ex = pb.x - pa.x;
    const ez = pb.z - pa.z;
    const l2 = ex * ex + ez * ez;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const p = samples[i];
      const f = l2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - pa.x) * ex + (p.z - pa.z) * ez) / l2)) : 0;
      const d = Math.hypot(p.x - (pa.x + ex * f), p.z - (pa.z + ez * f));
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: Sample[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(samples[i]);
  return out;
}

/** Total length of a sampled curve in metres. */
export function sampleLength(samples: Sample[]): number {
  return samples.length ? samples[samples.length - 1].s : 0;
}

/** Interpolated sample at normalised arc-length fraction `u` (clamped 0..1). */
export function sampleAtU(samples: Sample[], u: number): Sample {
  const uu = Math.min(1, Math.max(0, u));
  if (samples.length === 1) return samples[0];
  const total = sampleLength(samples);
  const target = uu * total;
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].s <= target) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const span = b.s - a.s;
  const f = span > 1e-12 ? (target - a.s) / span : 0;
  const x = a.x + (b.x - a.x) * f;
  const z = a.z + (b.z - a.z) * f;
  const tx = a.tx + (b.tx - a.tx) * f;
  const tz = a.tz + (b.tz - a.tz) * f;
  const tl = Math.hypot(tx, tz) || 1;
  const txn = tx / tl;
  const tzn = tz / tl;
  return {
    x,
    z,
    tx: txn,
    tz: tzn,
    nx: -tzn,
    nz: txn,
    s: target,
    u: uu,
    t: a.t + (b.t - a.t) * f,
  };
}

/** Sub-polyline of samples between arc lengths [s0, s1] (interpolated ends). */
export function sliceSamples(samples: Sample[], s0: number, s1: number): Sample[] {
  const total = sampleLength(samples);
  const a = Math.max(0, Math.min(s0, total));
  const b = Math.max(0, Math.min(s1, total));
  if (b - a < 1e-6) return [];
  const out: Sample[] = [sampleAtU(samples, a / (total || 1))];
  for (const smp of samples) {
    if (smp.s > a + 1e-6 && smp.s < b - 1e-6) out.push(smp);
  }
  out.push(sampleAtU(samples, b / (total || 1)));
  return out;
}

export interface ClosestResult {
  /** Normalised arc-length fraction of the closest point. */
  u: number;
  /** Signed lateral offset (+ left) from the centreline. */
  lateral: number;
  /** Unsigned distance to the centreline. */
  distance: number;
  point: V2;
}

/** Closest point on a sampled polyline to `p`. */
export function closestOnSamples(samples: Sample[], p: V2): ClosestResult {
  let best: ClosestResult = {
    u: 0,
    lateral: 0,
    distance: Infinity,
    point: { x: samples[0].x, z: samples[0].z },
  };
  const total = sampleLength(samples) || 1;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const l2 = ex * ex + ez * ez;
    const f = l2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / l2)) : 0;
    const qx = a.x + ex * f;
    const qz = a.z + ez * f;
    const d = Math.hypot(p.x - qx, p.z - qz);
    if (d < best.distance) {
      const s = a.s + (b.s - a.s) * f;
      const tx = a.tx + (b.tx - a.tx) * f;
      const tz = a.tz + (b.tz - a.tz) * f;
      const tl = Math.hypot(tx, tz) || 1;
      const nx = -tz / tl;
      const nz = tx / tl;
      best = {
        u: s / total,
        lateral: (p.x - qx) * nx + (p.z - qz) * nz,
        distance: d,
        point: { x: qx, z: qz },
      };
    }
  }
  return best;
}

/** Monotone-chain convex hull (counter-clockwise). Degenerate input is handled. */
export function convexHull(points: V2[]): V2[] {
  const pts = points
    .slice()
    .sort((a, b) => (a.x === b.x ? a.z - b.z : a.x - b.x))
    .filter((p, i, arr) => i === 0 || p.x !== arr[i - 1].x || p.z !== arr[i - 1].z);
  if (pts.length <= 2) return pts;
  const cross = (o: V2, a: V2, b: V2) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: V2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: V2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Standard Catmull-Rom style tangent for chain node i (used by the draw tool). */
export function chainTangent(points: V2[], i: number): V2 {
  const n = points.length;
  if (n === 1) return { x: 1, z: 0 };
  if (i === 0) return sub(points[1], points[0]);
  if (i === n - 1) return sub(points[n - 1], points[n - 2]);
  return scale(sub(points[i + 1], points[i - 1]), 0.5);
}

/** Bezier handles for a chain of points so that the path is smooth at the joints. */
export function chainHandles(points: V2[], i: number): { c1: V2; c2: V2 } {
  // Handles for segment i -> i+1.
  const p0 = points[i];
  const p1 = points[i + 1];
  const t0 = chainTangent(points, i);
  const t1 = chainTangent(points, i + 1);
  const L = dist(p0, p1);
  // Tangent magnitudes scaled to the segment length, like a Hermite spline.
  const k0 = len(t0) > 1e-9 ? L / 3 / len(t0) : 0;
  const k1 = len(t1) > 1e-9 ? L / 3 / len(t1) : 0;
  return {
    c1: add(p0, scale(t0, k0)),
    c2: sub(p1, scale(t1, k1)),
  };
}

/**
 * Intersection points between two sampled polylines. Returns normalised
 * arc-length fractions along each polyline.
 */
export function intersectSamples(
  a: Sample[],
  b: Sample[],
): Array<{ uA: number; uB: number }> {
  const out: Array<{ uA: number; uB: number }> = [];
  const totalA = sampleLength(a) || 1;
  const totalB = sampleLength(b) || 1;
  for (let i = 0; i < a.length - 1; i++) {
    const p = a[i];
    const r = { x: a[i + 1].x - p.x, z: a[i + 1].z - p.z };
    for (let j = 0; j < b.length - 1; j++) {
      const q = b[j];
      const s = { x: b[j + 1].x - q.x, z: b[j + 1].z - q.z };
      const denom = r.x * s.z - r.z * s.x;
      if (Math.abs(denom) < 1e-12) continue;
      const qp = { x: q.x - p.x, z: q.z - p.z };
      const t = (qp.x * s.z - qp.z * s.x) / denom;
      const w = (qp.x * r.z - qp.z * r.x) / denom;
      if (t < 0 || t > 1 || w < 0 || w > 1) continue;
      const sA = p.s + (a[i + 1].s - p.s) * t;
      const sB = q.s + (b[j + 1].s - q.s) * w;
      const hit = { uA: sA / totalA, uB: sB / totalB };
      // A crossing exactly on a sample joint is reported by both neighbours; keep one.
      const last = out[out.length - 1];
      if (last && Math.abs(last.uA - hit.uA) < 1e-7 && Math.abs(last.uB - hit.uB) < 1e-7) continue;
      out.push(hit);
    }
  }
  return out;
}
