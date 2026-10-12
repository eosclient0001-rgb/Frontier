import { add, chainHandles, dist, v2 } from './geometry';
import { sampleBezier } from './geometry';
import type { CubicBezier, Sample } from './geometry';
import { cloneProfile } from './profile';
import type {
  LaneProfile,
  PropKind,
  Prop,
  RoadClass,
  RoadNetwork,
  RoadNode,
  RoadSegment,
  V2,
} from './types';

export const PROP_KINDS: PropKind[] = [
  'bollard',
  'speedBump',
  'railCrossing',
  'crosswalk',
  'stopLine',
  'subwayEntrance',
];

export const ROAD_CLASSES: RoadClass[] = [
  'highway',
  'arterial',
  'boulevard',
  'local',
  'path',
  'rail',
  'subway',
];

export function createEmptyNetwork(): RoadNetwork {
  return { version: 1, nodes: {}, segments: {}, props: {} };
}

/** Monotonic id source. Generators pass their own ids to stay deterministic. */
let idCounter = 1;
export function nextId(prefix: string): string {
  return `${prefix}${(idCounter++).toString(36)}`;
}
/** Keeps generated ids unique after loading a file that contains ids we already used. */
export function reserveIdsFrom(net: RoadNetwork): void {
  const all = [...Object.keys(net.nodes), ...Object.keys(net.segments), ...Object.keys(net.props)];
  for (const id of all) {
    const m = /(\d+)$/.exec(id);
    if (!m) continue;
    const value = parseInt(m[1], 36);
    if (Number.isFinite(value) && value >= idCounter) idCounter = value + 1;
  }
}

export function addNode(net: RoadNetwork, x: number, z: number, id = nextId('n')): RoadNode {
  const node: RoadNode = { id, x, z };
  net.nodes[id] = node;
  return node;
}

export function addSegment(
  net: RoadNetwork,
  from: string,
  to: string,
  cls: RoadClass,
  profile: LaneProfile,
  opts: { c1?: V2; c2?: V2; id?: string; name?: string } = {},
): RoadSegment {
  const a = net.nodes[from];
  const b = net.nodes[to];
  if (!a || !b) throw new Error(`addSegment: unknown node ${!a ? from : to}`);
  const id = opts.id ?? nextId('s');
  const seg: RoadSegment = {
    id,
    from,
    to,
    c1: opts.c1 ?? v2(a.x + (b.x - a.x) / 3, a.z + (b.z - a.z) / 3),
    c2: opts.c2 ?? v2(a.x + ((b.x - a.x) * 2) / 3, a.z + ((b.z - a.z) * 2) / 3),
    cls,
    profile: cloneProfile(profile),
    ...(opts.name ? { name: opts.name } : {}),
  };
  net.segments[id] = seg;
  return seg;
}

/**
 * Adds a smooth chain of road segments through `points`. `nodeIds[i]` may
 * reuse an existing node (snapping); null creates a new node.
 */
export function addRoadChain(
  net: RoadNetwork,
  points: V2[],
  nodeIds: (string | null)[],
  cls: RoadClass,
  profile: LaneProfile,
): RoadSegment[] {
  const ids = points.map((p, i) => nodeIds[i] ?? addNode(net, p.x, p.z).id);
  const out: RoadSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    if (ids[i] === ids[i + 1]) continue;
    const h = chainHandles(points, i);
    out.push(addSegment(net, ids[i], ids[i + 1], cls, profile, { c1: h.c1, c2: h.c2 }));
  }
  return out;
}

export function addProp(
  net: RoadNetwork,
  segmentId: string,
  u: number,
  kind: PropKind,
  lateral = 0,
  id = nextId('p'),
): Prop {
  const prop: Prop = { id, segmentId, u: Math.min(1, Math.max(0, u)), kind, lateral };
  net.props[id] = prop;
  return prop;
}

export function segmentsAtNode(net: RoadNetwork, nodeId: string): RoadSegment[] {
  return Object.values(net.segments).filter((s) => s.from === nodeId || s.to === nodeId);
}

export function removeProp(net: RoadNetwork, id: string): void {
  delete net.props[id];
}

/** Removes a segment, its props, and any node left without segments. */
export function removeSegment(net: RoadNetwork, id: string): void {
  const seg = net.segments[id];
  if (!seg) return;
  delete net.segments[id];
  for (const p of Object.values(net.props)) {
    if (p.segmentId === id) delete net.props[p.id];
  }
  for (const nodeId of [seg.from, seg.to]) {
    if (net.nodes[nodeId] && segmentsAtNode(net, nodeId).length === 0) {
      delete net.nodes[nodeId];
    }
  }
}

/** Removes a node together with every segment touching it. */
export function removeNode(net: RoadNetwork, id: string): void {
  for (const s of segmentsAtNode(net, id)) removeSegment(net, s.id);
  delete net.nodes[id];
}

/**
 * Moves a node. Bezier handles that belong to attached segments move with it so
 * the curve keeps its shape instead of snapping to a new tangent.
 */
export function moveNode(net: RoadNetwork, id: string, x: number, z: number): void {
  const node = net.nodes[id];
  if (!node) return;
  const dx = x - node.x;
  const dz = z - node.z;
  node.x = x;
  node.z = z;
  for (const s of segmentsAtNode(net, id)) {
    if (s.from === id) s.c1 = add(s.c1, v2(dx, dz));
    if (s.to === id) s.c2 = add(s.c2, v2(dx, dz));
  }
}

export function segmentBezier(net: RoadNetwork, seg: RoadSegment): CubicBezier {
  const a = net.nodes[seg.from];
  const b = net.nodes[seg.to];
  return {
    p0: v2(a.x, a.z),
    c1: seg.c1,
    c2: seg.c2,
    p3: v2(b.x, b.z),
  };
}

/** Cache keyed by segment id and validated by the numeric geometry of the curve. */
export class SampleCache {
  private map = new Map<string, { geom: Float64Array; samples: Sample[] }>();
  constructor(private readonly step = 0.5) {}

  get(net: RoadNetwork, seg: RoadSegment): Sample[] {
    const b = segmentBezier(net, seg);
    const hit = this.map.get(seg.id);
    if (hit && sameGeometry(hit.geom, b)) return hit.samples;
    const samples = sampleBezier(b, this.step);
    this.map.set(seg.id, { geom: geometryOf(b), samples });
    return samples;
  }

  prune(net: RoadNetwork): void {
    for (const id of this.map.keys()) if (!net.segments[id]) this.map.delete(id);
  }
}

function geometryOf(b: CubicBezier): Float64Array {
  return Float64Array.of(b.p0.x, b.p0.z, b.c1.x, b.c1.z, b.c2.x, b.c2.z, b.p3.x, b.p3.z);
}

function sameGeometry(g: Float64Array, b: CubicBezier): boolean {
  return (
    g[0] === b.p0.x && g[1] === b.p0.z && g[2] === b.c1.x && g[3] === b.c1.z &&
    g[4] === b.c2.x && g[5] === b.c2.z && g[6] === b.p3.x && g[7] === b.p3.z
  );
}

export interface Bounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function networkBounds(net: RoadNetwork): Bounds | null {
  const nodes = Object.values(net.nodes);
  if (!nodes.length) return null;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minZ = Math.min(minZ, n.z);
    maxX = Math.max(maxX, n.x);
    maxZ = Math.max(maxZ, n.z);
  }
  return { minX, minZ, maxX, maxZ };
}

/** Returns a list of human readable problems. Empty means the network is valid. */
export function validateNetwork(net: RoadNetwork): string[] {
  const errors: string[] = [];
  if (net.version !== 1) errors.push(`unsupported version ${String((net as { version: unknown }).version)}`);
  for (const n of Object.values(net.nodes)) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.z)) errors.push(`node ${n.id} has non-finite position`);
  }
  for (const s of Object.values(net.segments)) {
    if (!net.nodes[s.from]) errors.push(`segment ${s.id} references missing node ${s.from}`);
    if (!net.nodes[s.to]) errors.push(`segment ${s.id} references missing node ${s.to}`);
    if (s.from === s.to) errors.push(`segment ${s.id} starts and ends at the same node`);
    if (!ROAD_CLASSES.includes(s.cls)) errors.push(`segment ${s.id} has unknown class ${String(s.cls)}`);
    for (const lane of [...s.profile.left, ...s.profile.right]) {
      if (!(lane.width > 0) || !Number.isFinite(lane.width)) {
        errors.push(`segment ${s.id} has a lane with invalid width`);
      }
    }
    for (const p of [s.c1, s.c2]) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) errors.push(`segment ${s.id} has non-finite handle`);
    }
  }
  for (const p of Object.values(net.props)) {
    if (!net.segments[p.segmentId]) errors.push(`prop ${p.id} references missing segment ${p.segmentId}`);
    if (!PROP_KINDS.includes(p.kind)) errors.push(`prop ${p.id} has unknown kind ${String(p.kind)}`);
    if (!(p.u >= 0 && p.u <= 1)) errors.push(`prop ${p.id} has u outside 0..1`);
  }
  return errors;
}

export function serializeNetwork(net: RoadNetwork): string {
  return JSON.stringify(net, null, 2);
}

/** Parses and validates a network file. Throws with all problems listed. */
export function parseNetwork(text: string): RoadNetwork {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Not valid JSON: ${(e as Error).message}`);
  }
  if (!data || typeof data !== 'object') throw new Error('Network file must be a JSON object');
  const net = data as RoadNetwork;
  net.nodes ??= {};
  net.segments ??= {};
  net.props ??= {};
  const errors = validateNetwork(net);
  if (errors.length) throw new Error(`Invalid road network:\n${errors.slice(0, 20).join('\n')}`);
  reserveIdsFrom(net);
  return net;
}

export function segmentLength(samples: Sample[]): number {
  return samples.length ? samples[samples.length - 1].s : 0;
}

/** Straight-line distance between the end nodes (cheap, no sampling). */
export function chordLength(net: RoadNetwork, seg: RoadSegment): number {
  return dist(net.nodes[seg.from], net.nodes[seg.to]);
}

