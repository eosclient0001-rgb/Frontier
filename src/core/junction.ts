// Junction geometry without booleans.
//
// For every node the incident road ends are sorted by angle. Neighbouring road sides are intersected to
// produce a shared corner point, and every road end is trimmed to the corners on its two sides. The
// trimmed road ribbons and the junction polygon then tile the plane exactly: no overlap and no gap.
// Where two sides cannot meet (near-parallel or exterior wedge), a straight chord is used instead.

import { cross2, dist2, leftNormal2, norm2, P2 } from "./math";
import type { NetEdge, RoadNetwork } from "./topology";

export interface EndCap {
  plus: P2; // Point on the edge's forward-left side at this end (+W side, measured along the edge direction a to b)
  minus: P2; // Point on the forward-right side at this end (-W side)
}

export type JunctionMaterial = "asphalt" | "paving" | "dirt";

export interface JunctionPatch {
  nodeId: string;
  ring: P2[]; // Ordered boundary (counter-clockwise by construction)
  x: number;
  z: number;
  lift: number;
  material: JunctionMaterial;
}

export interface JunctionModel {
  caps: Map<string, EndCap>; // key: `${edgeId}|a` or `${edgeId}|b`
  patches: JunctionPatch[];
}

export function capKey(edgeId: string, end: "a" | "b"): string {
  return `${edgeId}|${end}`;
}

interface Incident {
  edge: NetEdge;
  end: "a" | "b";
  d: P2; // unit direction pointing away from the node along the edge
  n: P2; // left normal of d
  W: number; // half width of the section
  capPlus: P2; // working corner on the +n side
  capMinus: P2; // working corner on the -n side
}

// Direction away from the node along the first stretch of the edge that leaves the node by at least 4 m.
function outwardDirection(edge: NetEdge, end: "a" | "b"): P2 {
  const n = edge.pts.length;
  const origin = end === "a" ? edge.pts[0] : edge.pts[n - 1];
  for (let k = 1; k < n; k++) {
    const idx = end === "a" ? k : n - 1 - k;
    const q = edge.pts[idx];
    if (dist2(q, origin) >= 4) return norm2({ x: q.x - origin.x, z: q.z - origin.z });
  }
  const far = end === "a" ? edge.pts[n - 1] : edge.pts[0];
  return norm2({ x: far.x - origin.x, z: far.z - origin.z });
}

const ASPHALT_PROFILES = new Set(["motorway", "boulevard", "avenue", "street", "residential", "country"]);

export function buildJunctions(net: RoadNetwork): JunctionModel {
  const caps = new Map<string, EndCap>();
  const patches: JunctionPatch[] = [];
  const edgeById = new Map(net.edges.map((e) => [e.id, e] as const));

  for (const node of net.nodes) {
    const items: Incident[] = node.incident.map((inc) => {
      const edge = edgeById.get(inc.edgeId)!;
      const d = outwardDirection(edge, inc.end);
      const W = edge.section.width * 0.5;
      const n = leftNormal2(d);
      return {
        edge,
        end: inc.end,
        d,
        n,
        W,
        capPlus: { x: node.x + n.x * W, z: node.z + n.z * W },
        capMinus: { x: node.x - n.x * W, z: node.z - n.z * W }
      };
    });
    if (items.length === 0) continue;
    items.sort((p, q) => Math.atan2(p.d.z, p.d.x) - Math.atan2(q.d.z, q.d.x));

    const ring: P2[] = [];
    const center: P2 = { x: node.x, z: node.z };
    const hasRoad = items.some((it) => !it.edge.rail);

    if (items.length === 1) {
      // Dead end: a half disc in front of the end so the road ribbon stops cleanly at the node.
      const it = items[0];
      ring.push(it.capPlus);
      const steps = 10;
      for (let k = 1; k < steps; k++) {
        const th = (Math.PI * k) / steps;
        const c = Math.cos(th);
        const sn = Math.sin(th);
        ring.push({
          x: node.x + it.W * (c * it.n.x + sn * it.d.x),
          z: node.z + it.W * (c * it.n.z + sn * it.d.z)
        });
      }
      ring.push(it.capMinus);
    } else {
      const k = items.length;
      for (let i = 0; i < k; i++) {
        const j = (i + 1) % k;
        const A = items[i];
        const B = items[j];
        const Lp = A.capPlus;
        const Rp = B.capMinus;
        const sinGap = cross2(A.d, B.d);
        const R: P2 = { x: Rp.x - Lp.x, z: Rp.z - Lp.z };
        let valid = false;
        let X: P2 = Lp;
        if (sinGap > 0.02) {
          const det = -sinGap;
          const t = cross2(B.d, R) / det;
          const sB = cross2(A.d, R) / det;
          const limitA = Math.min(0.45 * A.edge.length, 10 * Math.max(A.W, B.W) + 6);
          const limitB = Math.min(0.45 * B.edge.length, 10 * Math.max(A.W, B.W) + 6);
          if (t > 0.05 && sB > 0.05 && t <= limitA && sB <= limitB) {
            valid = true;
            X = { x: Lp.x + A.d.x * t, z: Lp.z + A.d.z * t };
          }
        }
        if (valid) {
          A.capPlus = X;
          B.capMinus = X;
          ring.push(X);
        } else {
          ring.push(Lp, Rp);
        }
      }
    }

    const cleaned = ring.filter((p, idx) => idx === 0 || dist2(p, ring[idx - 1]) > 0.02);
    if (cleaned.length > 3 && hasRoad) {
      const anyAsphalt = items.some((it) => ASPHALT_PROFILES.has(it.edge.profile));
      const anyDirt = items.some((it) => it.edge.profile === "track");
      const material: JunctionMaterial = anyAsphalt ? "asphalt" : anyDirt ? "dirt" : "paving";
      patches.push({ nodeId: node.id, ring: cleaned, x: center.x, z: center.z, lift: node.lift, material });
    }

    for (const it of items) {
      // The corner shared with the next road sits on this edge's +n side; the previous corner sits on -n.
      const plus = it.capPlus;
      const minus = it.capMinus;
      // Convert to the edge's own forward-left frame (a to b). At the b end forward is -d, so sides swap.
      caps.set(capKey(it.edge.id, it.end), it.end === "a" ? { plus, minus } : { plus: minus, minus: plus });
    }
  }

  // Edges whose ends never reached a node (should not happen) still need a cap entry for the mesher.
  for (const e of net.edges) {
    for (const end of ["a", "b"] as const) {
      const key = capKey(e.id, end);
      if (caps.has(key)) continue;
      const origin = end === "a" ? e.pts[0] : e.pts[e.pts.length - 1];
      const W = e.section.width * 0.5;
      const d = outwardDirection(e, end);
      const n = leftNormal2(d);
      const plus = { x: origin.x + n.x * W, z: origin.z + n.z * W };
      const minus = { x: origin.x - n.x * W, z: origin.z - n.z * W };
      caps.set(key, end === "a" ? { plus, minus } : { plus: minus, minus: plus });
    }
  }

  return { caps, patches };
}
