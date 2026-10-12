// Validation of a built network: parallel overlaps (two roads running on top of each other) and shallow
// crossings (roads meeting at a very small angle, which cannot be trimmed cleanly).

import { dot2, dist2, P2 } from "./math";
import { SpatialGrid } from "./spatial";
import type { NetEdge, RoadNetwork } from "./topology";

export interface ValidationIssue {
  kind: "overlap" | "shallow";
  edgeA: string;
  edgeB: string;
  roadA: string;
  roadB: string;
  x: number;
  z: number;
}

interface Sample extends P2 {
  edge: NetEdge;
  tx: number;
  tz: number;
  r: number;
}

const SAMPLE_EVERY = 4; // [m]
const SHALLOW_ANGLE = (12 * Math.PI) / 180;

export function validateNetwork(net: RoadNetwork): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const grid = new SpatialGrid<Sample>(30);
  const drivable = net.edges.filter((e) => !e.underground && !e.rail);

  for (const e of drivable) {
    const count = Math.max(1, Math.floor(e.length / SAMPLE_EVERY));
    for (let k = 0; k <= count; k++) {
      const s = (e.length * k) / count;
      const p = sampleEdge(e, s);
      const q = sampleEdge(e, Math.min(e.length, s + 0.5));
      const r = sampleEdge(e, Math.max(0, s - 0.5));
      const tl = Math.hypot(q.x - r.x, q.z - r.z) || 1;
      grid.insertBox(p.x, p.z, p.x, p.z, { x: p.x, z: p.z, edge: e, tx: (q.x - r.x) / tl, tz: (q.z - r.z) / tl, r: e.section.width * 0.5 });
    }
  }

  const seen = new Set<string>();
  for (const e of drivable) {
    const count = Math.max(1, Math.floor(e.length / SAMPLE_EVERY));
    for (let k = 0; k <= count; k++) {
      const s = (e.length * k) / count;
      const p = sampleEdge(e, s);
      const q = sampleEdge(e, Math.min(e.length, s + 0.5));
      const r0 = sampleEdge(e, Math.max(0, s - 0.5));
      const tl = Math.hypot(q.x - r0.x, q.z - r0.z) || 1;
      const t = { x: (q.x - r0.x) / tl, z: (q.z - r0.z) / tl };
      const rE = e.section.width * 0.5;
      for (const other of grid.queryBox(p.x - 24, p.z - 24, p.x + 24, p.z + 24)) {
        const f = other.edge;
        if (f === e) continue;
        const key = e.id < f.id ? `${e.id}|${f.id}` : `${f.id}|${e.id}`;
        if (seen.has(key)) continue;
        if (Math.abs(dot2(t, { x: other.tx, z: other.tz })) < 0.85) continue; // not parallel: a crossing, handled by topology
        const d = dist2(p, other);
        if (d >= 0.5 * (rE + other.r)) continue;
        // Shared node neighbourhoods are allowed to be close (forks and merges).
        const shared = [e.a, e.b].filter((id) => id === f.a || id === f.b);
        const nearShared = shared.some((id) => {
          const n = net.nodeMap.get(id)!;
          return Math.hypot(n.x - p.x, n.z - p.z) < 30;
        });
        if (nearShared) continue;
        seen.add(key);
        issues.push({ kind: "overlap", edgeA: e.id, edgeB: f.id, roadA: e.roadId, roadB: f.roadId, x: p.x, z: p.z });
      }
    }
  }

  const edgeById = new Map(net.edges.map((e) => [e.id, e] as const));
  for (const n of net.nodes) {
    const dirs = n.incident.map((inc) => {
      const e = edgeById.get(inc.edgeId)!;
      return { e, d: outward(e, inc.end) };
    });
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) {
        if (dirs[i].e.roadId === dirs[j].e.roadId) continue;
        const c = Math.acos(Math.max(-1, Math.min(1, dot2(dirs[i].d, dirs[j].d))));
        if (c < SHALLOW_ANGLE) {
          issues.push({ kind: "shallow", edgeA: dirs[i].e.id, edgeB: dirs[j].e.id, roadA: dirs[i].e.roadId, roadB: dirs[j].e.roadId, x: n.x, z: n.z });
        }
      }
    }
  }
  return issues;
}

function outward(e: NetEdge, end: "a" | "b"): P2 {
  const origin = end === "a" ? e.pts[0] : e.pts[e.pts.length - 1];
  const other = end === "a" ? e.pts[Math.min(e.pts.length - 1, 3)] : e.pts[Math.max(0, e.pts.length - 4)];
  const dx = other.x - origin.x;
  const dz = other.z - origin.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}

export function sampleEdge(e: NetEdge, s: number): P2 {
  const S = e.s;
  const last = S.length - 1;
  if (s <= 0) return e.pts[0];
  if (s >= S[last]) return e.pts[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (S[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = S[hi] - S[lo];
  const t = seg > 1e-9 ? (s - S[lo]) / seg : 0;
  return { x: e.pts[lo].x + (e.pts[hi].x - e.pts[lo].x) * t, z: e.pts[lo].z + (e.pts[hi].z - e.pts[lo].z) * t };
}
