// Frames along a network edge: world position, left normal, tangent and lift at any arc length.

import { P2 } from "../core/math";
import type { NetEdge } from "../core/topology";

export interface Frame {
  x: number;
  z: number;
  nx: number; // unit left normal
  nz: number;
  tx: number; // unit tangent (direction of travel a to b)
  tz: number;
  lift: number;
  s: number;
}

export function pointOnEdge(edge: NetEdge, s: number): { x: number; z: number; lift: number } {
  const S = edge.s;
  const last = S.length - 1;
  if (s <= 0) return { x: edge.pts[0].x, z: edge.pts[0].z, lift: edge.lifts[0] };
  if (s >= S[last]) return { x: edge.pts[last].x, z: edge.pts[last].z, lift: edge.lifts[last] };
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (S[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = S[hi] - S[lo];
  const t = seg > 1e-9 ? (s - S[lo]) / seg : 0;
  const a = edge.pts[lo];
  const b = edge.pts[hi];
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    lift: edge.lifts[lo] + (edge.lifts[hi] - edge.lifts[lo]) * t
  };
}

export function frameAt(edge: NetEdge, s: number): Frame {
  const L = edge.length;
  const sc = Math.min(Math.max(s, 0), L);
  const h = 0.25;
  const p0 = pointOnEdge(edge, Math.max(0, sc - h));
  const p1 = pointOnEdge(edge, Math.min(L, sc + h));
  const p = pointOnEdge(edge, sc);
  let tx = p1.x - p0.x;
  let tz = p1.z - p0.z;
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl;
  tz /= tl;
  return { x: p.x, z: p.z, nx: -tz, nz: tx, tx, tz, lift: p.lift, s: sc };
}

export function offsetPoint(f: Frame, o: number): P2 {
  return { x: f.x + f.nx * o, z: f.z + f.nz * o };
}
