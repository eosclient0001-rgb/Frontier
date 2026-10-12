// Topology builder: turns authored splines into a planar road graph.
//
// Pipeline (no boolean operations, every decision is an explicit graph operation):
//   1. Sample every road centreline densely and keep its lift (height above ground).
//   2. Snap road endpoints onto nearby endpoints or road bodies (T-junctions) when the heights agree.
//   3. Find every segment crossing. Crossings whose surfaces differ by more than GRADE_SEPARATION are
//      grade separated (overpass / underpass, no node). Everything else becomes a shared node.
//   4. Cluster node candidates within NODE_MERGE_DISTANCE so "+", "Y" and "T" meet in one point.
//   5. Split every road at its nodes into edges. Rails and subways never share nodes with roads.

import { Band, buildSection, ProfileId, PROFILES, resolveOptions, RoadOptions } from "./profiles";
import { closestOnSegment, dist2, P2, Rng, segmentIntersection } from "./math";
import { arcLengths, dedupeSamples, polylineLength, sampleCurve, SamplePoint } from "./sampling";
import { BridgeType, Road } from "./model";
import { DisjointSet, SpatialGrid } from "./spatial";

export const SAMPLE_STEP = 2.0; // [m] - Centreline sample spacing
export const SNAP_END_DISTANCE = 4.0; // [m] - Endpoint to endpoint snap radius
export const SNAP_T_DISTANCE = 6.0; // [m] - Endpoint to road body snap radius (creates a T)
export const NODE_MERGE_DISTANCE = 2.5; // [m] - Candidates closer than this share one node
export const GRADE_SEPARATION = 4.0; // [m] - Surface height difference that makes a crossing grade separated
export const BRIDGE_LIFT = 1.0; // [m] - Lift above ground that counts as a bridge deck

export interface BridgeSpan {
  s0: number; // [m] - Arc position of the span start along the edge
  s1: number; // [m] - Arc position of the span end along the edge
  length: number; // [m]
}

export interface NetNode {
  id: string;
  x: number; // [m] - World X
  z: number; // [m] - World Z
  lift: number; // [m] - Shared surface lift at this node
  incident: { edgeId: string; end: "a" | "b" }[];
}

export interface NetEdge {
  id: string;
  roadId: string;
  a: string; // node id at the start of the edge
  b: string; // node id at the end of the edge
  profile: ProfileId;
  options: Required<RoadOptions>;
  seed: number;
  bridge: BridgeType;
  section: { bands: Band[]; width: number };
  rail: boolean;
  underground: boolean;
  pts: P2[];
  lifts: number[];
  s: number[];
  length: number;
  bridges: BridgeSpan[];
}

export interface CrossingRecord {
  kind: "level" | "grade";
  x: number;
  z: number;
  roadA: string;
  roadB: string;
  yaw: number; // [rad] - Direction of the road that is not a rail (level crossings) at the crossing
}

export interface RoadNetwork {
  nodes: NetNode[];
  nodeMap: Map<string, NetNode>;
  edges: NetEdge[];
  crossings: CrossingRecord[];
  warnings: string[];
}

interface Path {
  roadId: string;
  seed: number;
  profile: ProfileId;
  options: Required<RoadOptions>;
  bridge: BridgeType;
  rail: boolean;
  under: boolean;
  pts: SamplePoint[];
  s: number[];
  len: number;
}

// A reference to a location on a path: segment i, fraction t along it.
interface PathRef {
  path: number;
  i: number;
  t: number;
}

interface Candidate {
  x: number;
  z: number;
  lift: number;
  refs: PathRef[];
}

function refS(p: Path, r: PathRef): number {
  const i = Math.min(r.i, p.pts.length - 2);
  return p.s[i] + r.t * (p.s[i + 1] - p.s[i]);
}

export function buildNetwork(roads: readonly Road[]): RoadNetwork {
  const warnings: string[] = [];
  const paths: Path[] = [];
  for (const road of roads) {
    const def = PROFILES[road.profile];
    if (!def) continue;
    const pts = dedupeSamples(sampleCurve(road.points, SAMPLE_STEP));
    if (pts.length < 2) {
      warnings.push(`Road "${road.name}" collapsed to a single point and was skipped.`);
      continue;
    }
    paths.push({
      roadId: road.id,
      seed: road.seed,
      profile: road.profile,
      options: resolveOptions(road.profile, road.options),
      bridge: road.bridge,
      rail: def.rail,
      under: def.underground,
      pts,
      s: arcLengths(pts),
      len: polylineLength(pts)
    });
  }

  // ---- 2. Endpoint snapping ------------------------------------------------------------------
  const surface = paths.map((p, i) => ({ p, i })).filter((e) => !e.p.rail && !e.p.under);
  const segGrid = new SpatialGrid<PathRef>(40);
  for (const { p, i } of surface) {
    for (let k = 0; k < p.pts.length - 1; k++) {
      const a = p.pts[k];
      const b = p.pts[k + 1];
      segGrid.insertBox(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), {
        path: i,
        i: k,
        t: 0
      });
    }
  }
  const endpoints: { path: number; atEnd: boolean }[] = [];
  for (const { i } of surface) {
    endpoints.push({ path: i, atEnd: false }, { path: i, atEnd: true });
  }
  const snapCandidates: Candidate[] = [];
  for (const ep of endpoints) {
    const P = paths[ep.path];
    const idx = ep.atEnd ? P.pts.length - 1 : 0;
    const E = P.pts[idx];
    let best: { score: number; kind: "end" | "T"; pos: P2; lift: number; ref?: PathRef } | null = null;

    for (const other of endpoints) {
      if (other.path === ep.path) continue;
      const Q = paths[other.path];
      const Qpt = Q.pts[other.atEnd ? Q.pts.length - 1 : 0];
      const d = dist2(E, Qpt);
      if (d > SNAP_END_DISTANCE) continue;
      if (Math.abs(E.lift - Qpt.lift) >= GRADE_SEPARATION) continue;
      const score = d * 0.5; // endpoint matches win over body matches at equal distance
      if (!best || score < best.score) best = { score, kind: "end", pos: Qpt, lift: Qpt.lift };
    }

    const near = segGrid.queryBox(E.x - SNAP_T_DISTANCE, E.z - SNAP_T_DISTANCE, E.x + SNAP_T_DISTANCE, E.z + SNAP_T_DISTANCE);
    for (const ref of near) {
      if (ref.path === ep.path) continue;
      const Q = paths[ref.path];
      const a = Q.pts[ref.i];
      const b = Q.pts[ref.i + 1];
      const c = closestOnSegment(E, a, b);
      if (c.d > SNAP_T_DISTANCE) continue;
      const lift = a.lift + (b.lift - a.lift) * c.t;
      if (Math.abs(E.lift - lift) >= GRADE_SEPARATION) continue;
      const score = c.d;
      if (!best || score < best.score) {
        best = { score, kind: "T", pos: c.q, lift, ref: { path: ref.path, i: ref.i, t: c.t } };
      }
    }

    if (best) {
      P.pts[idx] = { x: best.pos.x, z: best.pos.z, lift: E.lift };
      if (best.kind === "T" && best.ref) {
        snapCandidates.push({ x: best.pos.x, z: best.pos.z, lift: best.lift, refs: [best.ref] });
      }
    }
  }
  for (const { p } of surface) {
    p.s = arcLengths(p.pts);
    p.len = p.s[p.s.length - 1];
  }

  // ---- 3. Crossings ------------------------------------------------------------------------
  const crossGrid = new SpatialGrid<PathRef>(50);
  // Global segment ids, so each segment pair is evaluated once even when both share several grid cells.
  const segOffset: number[] = [];
  let segTotal = 0;
  for (const p of paths) {
    segOffset.push(segTotal);
    segTotal += Math.max(0, p.pts.length - 1);
  }
  const evaluated = new Set<number>();
  for (let pi = 0; pi < paths.length; pi++) {
    const p = paths[pi];
    if (p.under) continue;
    for (let k = 0; k < p.pts.length - 1; k++) {
      const a = p.pts[k];
      const b = p.pts[k + 1];
      crossGrid.insertBox(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), {
        path: pi,
        i: k,
        t: 0
      });
    }
  }

  const candidates: Candidate[] = [...snapCandidates];
  const crossings: CrossingRecord[] = [];

  crossGrid.forEachCell((_cx, _cz, items) => {
    for (let x = 0; x < items.length; x++) {
      for (let y = x + 1; y < items.length; y++) {
        const A = items[x];
        const B = items[y];
        if (A.path === B.path && Math.abs(A.i - B.i) <= 1) continue;
        const gA = segOffset[A.path] + A.i;
        const gB = segOffset[B.path] + B.i;
        const key = Math.min(gA, gB) * segTotal + Math.max(gA, gB);
        if (evaluated.has(key)) continue;
        evaluated.add(key);
        const pa = paths[A.path];
        const pb = paths[B.path];
        const hit = segmentIntersection(pa.pts[A.i], pa.pts[A.i + 1], pb.pts[B.i], pb.pts[B.i + 1]);
        if (!hit) continue;

        const liftA = pa.pts[A.i].lift + (pa.pts[A.i + 1].lift - pa.pts[A.i].lift) * hit.u;
        const liftB = pb.pts[B.i].lift + (pb.pts[B.i + 1].lift - pb.pts[B.i].lift) * hit.v;
        const diff = Math.abs(liftA - liftB); // Terrain is shared at the crossing point, so only lift matters
        const refA: PathRef = { path: A.path, i: A.i, t: hit.u };
        const refB: PathRef = { path: B.path, i: B.i, t: hit.v };

        if (pa.rail && pb.rail) continue;
        if (pa.rail || pb.rail) {
          if (diff < GRADE_SEPARATION) {
            const road = pa.rail ? pb : pa;
            const roadRef = pa.rail ? refB : refA;
            const seg = road.pts[roadRef.i + 1];
            const from = road.pts[roadRef.i];
            pushCrossing(crossings, {
              kind: "level",
              x: hit.p.x,
              z: hit.p.z,
              roadA: pa.roadId,
              roadB: pb.roadId,
              yaw: Math.atan2(seg.x - from.x, seg.z - from.z)
            });
          } else {
            pushCrossing(crossings, { kind: "grade", x: hit.p.x, z: hit.p.z, roadA: pa.roadId, roadB: pb.roadId, yaw: 0 });
          }
          continue;
        }
        if (diff >= GRADE_SEPARATION) {
          pushCrossing(crossings, { kind: "grade", x: hit.p.x, z: hit.p.z, roadA: pa.roadId, roadB: pb.roadId, yaw: 0 });
          continue;
        }
        candidates.push({ x: hit.p.x, z: hit.p.z, lift: (liftA + liftB) * 0.5, refs: [refA, refB] });
      }
    }
  });

  // Endpoints of surface roads are candidates too, so every road end lands on a node.
  for (const { i } of surface) {
    const p = paths[i];
    const last = p.pts.length - 2;
    const startPt = p.pts[0];
    const endPt = p.pts[p.pts.length - 1];
    candidates.push({ x: startPt.x, z: startPt.z, lift: startPt.lift, refs: [{ path: i, i: 0, t: 0 }] });
    candidates.push({ x: endPt.x, z: endPt.z, lift: endPt.lift, refs: [{ path: i, i: last, t: 1 }] });
  }

  // ---- 4. Node clustering --------------------------------------------------------------------
  const cg = new SpatialGrid<number>(NODE_MERGE_DISTANCE);
  candidates.forEach((c, idx) => cg.insertBox(c.x, c.z, c.x, c.z, idx));
  const ds = new DisjointSet(candidates.length);
  const neigh: number[] = [];
  candidates.forEach((c, idx) => {
    neigh.length = 0;
    cg.queryBox(c.x - NODE_MERGE_DISTANCE, c.z - NODE_MERGE_DISTANCE, c.x + NODE_MERGE_DISTANCE, c.z + NODE_MERGE_DISTANCE, neigh);
    for (const other of neigh) {
      const o = candidates[other];
      if (Math.hypot(o.x - c.x, o.z - c.z) <= NODE_MERGE_DISTANCE) ds.union(idx, other);
    }
  });

  const groups = new Map<number, number[]>();
  candidates.forEach((_, idx) => {
    const root = ds.find(idx);
    const g = groups.get(root);
    if (g) g.push(idx);
    else groups.set(root, [idx]);
  });

  const nodes: NetNode[] = [];
  const nodeMap = new Map<string, NetNode>();
  const candNode = new Array<number>(candidates.length);
  const roots = [...groups.keys()].sort((a, b) => a - b);
  roots.forEach((root, n) => {
    const members = groups.get(root)!;
    let sx = 0;
    let sz = 0;
    let sl = 0;
    for (const m of members) {
      sx += candidates[m].x;
      sz += candidates[m].z;
      sl += candidates[m].lift;
      candNode[m] = n;
    }
    const node: NetNode = {
      id: `n${n}`,
      x: sx / members.length,
      z: sz / members.length,
      lift: sl / members.length,
      incident: []
    };
    nodes.push(node);
    nodeMap.set(node.id, node);
  });

  // ---- 5. Split roads into edges ----------------------------------------------------------------
  const perPath: { s: number; node: number }[][] = paths.map(() => []);
  candidates.forEach((c, idx) => {
    for (const r of c.refs) {
      const p = paths[r.path];
      if (p.rail || p.under) continue;
      perPath[r.path].push({ s: refS(p, r), node: candNode[idx] });
    }
  });

  const edges: NetEdge[] = [];

  paths.forEach((p, pi) => {
    if (p.rail || p.under) {
      // Rails and subways keep their own unshared end nodes so they never fuse into road junctions.
      const first = makeNode(nodes, nodeMap, `${p.roadId}:start`, p.pts[0]);
      const last = makeNode(nodes, nodeMap, `${p.roadId}:end`, p.pts[p.pts.length - 1]);
      const edge = makeEdge(p, 0, p.len, first, last, `${p.roadId}#0`);
      if (edge) edges.push(edge);
      return;
    }
    const list = perPath[pi].sort((u, v) => u.s - v.s);
    // Drop duplicate hits at the same place (a crossing exactly on a vertex is reported by two segments).
    const seq: { s: number; node: number }[] = [];
    for (const item of list) {
      const prev = seq[seq.length - 1];
      if (prev && prev.node === item.node && item.s - prev.s < 0.5) continue;
      seq.push(item);
    }
    let k = 0;
    for (let q = 0; q < seq.length - 1; q++) {
      const A = seq[q];
      const B = seq[q + 1];
      // A road that crosses itself passes the same node twice; the loop between the passes is a real edge.
      if (B.s - A.s < 0.5) continue;
      if (A.node === B.node && B.s - A.s < 2) continue;
      const nodeA = nodes[A.node];
      const nodeB = nodes[B.node];
      const edge = makeEdge(p, A.s, B.s, nodeA, nodeB, `${p.roadId}#${k++}`);
      if (edge) edges.push(edge);
    }
  });

  for (const e of edges) {
    nodeMap.get(e.a)!.incident.push({ edgeId: e.id, end: "a" });
    nodeMap.get(e.b)!.incident.push({ edgeId: e.id, end: "b" });
    if (e.length < 1.5) warnings.push(`Edge ${e.id} is only ${e.length.toFixed(1)} m long.`);
  }

  // Nodes that lost all their edges (for example after a zero-length split) are dropped.
  const liveNodes = nodes.filter((n) => n.incident.length > 0);
  return { nodes: liveNodes, nodeMap: new Map(liveNodes.map((n) => [n.id, n] as const)), edges, crossings, warnings };
}

function makeNode(nodes: NetNode[], nodeMap: Map<string, NetNode>, id: string, at: P2 & { lift: number }): NetNode {
  const node: NetNode = { id, x: at.x, z: at.z, lift: at.lift, incident: [] };
  nodes.push(node);
  nodeMap.set(id, node);
  return node;
}

function makeEdge(p: Path, sA: number, sB: number, nodeA: NetNode, nodeB: NetNode, id: string): NetEdge | null {
  const pts: P2[] = [{ x: nodeA.x, z: nodeA.z }];
  const lifts: number[] = [nodeA.lift];
  for (let j = 0; j < p.pts.length; j++) {
    const sj = p.s[j];
    if (sj > sA + 1e-6 && sj < sB - 1e-6) {
      const q = p.pts[j];
      const last = pts[pts.length - 1];
      if (dist2(last, q) < 0.01) continue;
      pts.push({ x: q.x, z: q.z });
      lifts.push(q.lift);
    }
  }
  const endP = { x: nodeB.x, z: nodeB.z };
  if (dist2(pts[pts.length - 1], endP) >= 0.01 || pts.length === 1) {
    pts.push(endP);
    lifts.push(nodeB.lift);
  } else {
    pts[pts.length - 1] = endP;
    lifts[lifts.length - 1] = nodeB.lift;
  }
  if (pts.length < 2) return null;
  const s = arcLengths(pts);
  const length = s[s.length - 1];
  if (length < 0.05) return null;

  const section = buildSection(p.profile, p.options, new Rng(p.seed));
  return {
    id,
    roadId: p.roadId,
    a: nodeA.id,
    b: nodeB.id,
    profile: p.profile,
    options: p.options,
    seed: p.seed,
    bridge: p.bridge,
    section,
    rail: PROFILES[p.profile].rail,
    underground: PROFILES[p.profile].underground,
    pts,
    lifts,
    s,
    length,
    bridges: findBridgeSpans(pts, lifts, s)
  };
}

// Contiguous runs of raised deck (lift above BRIDGE_LIFT) along an edge.
function findBridgeSpans(pts: P2[], lifts: number[], s: number[]): BridgeSpan[] {
  const spans: BridgeSpan[] = [];
  let start = -1;
  for (let i = 0; i < pts.length; i++) {
    const raised = lifts[i] > BRIDGE_LIFT;
    if (raised && start < 0) start = i;
    if ((!raised || i === pts.length - 1) && start >= 0) {
      const end = raised ? i : i - 1;
      const length = s[end] - s[start];
      if (length >= 6) spans.push({ s0: s[start], s1: s[end], length });
      start = -1;
    }
  }
  return spans;
}

// Adjacent segments report a crossing that sits exactly on a vertex twice. Keep one record per point and road pair.
function pushCrossing(list: CrossingRecord[], rec: CrossingRecord): void {
  const dup = list.some((c) => c.kind === rec.kind && Math.hypot(c.x - rec.x, c.z - rec.z) < 0.75 && c.roadA === rec.roadA && c.roadB === rec.roadB);
  if (!dup) list.push(rec);
}

export function networkStats(net: RoadNetwork): {
  nodes: number;
  edges: number;
  junctions: number;
  deadEnds: number;
  bridgeSpans: number;
  levelCrossings: number;
  gradeCrossings: number;
  lengthKm: number;
} {
  let junctions = 0;
  let deadEnds = 0;
  for (const n of net.nodes) {
    if (n.incident.length >= 3) junctions++;
    if (n.incident.length === 1) deadEnds++;
  }
  let bridgeSpans = 0;
  let lengthM = 0;
  for (const e of net.edges) {
    bridgeSpans += e.bridges.length;
    lengthM += e.length;
  }
  return {
    nodes: net.nodes.length,
    edges: net.edges.length,
    junctions,
    deadEnds,
    bridgeSpans,
    levelCrossings: net.crossings.filter((c) => c.kind === "level").length,
    gradeCrossings: net.crossings.filter((c) => c.kind === "grade").length,
    lengthKm: lengthM / 1000
  };
}

