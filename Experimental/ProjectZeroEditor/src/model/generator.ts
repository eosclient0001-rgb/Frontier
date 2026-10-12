import { intersectSamples, sampleBezier, sampleLength } from './geometry';
import { createEmptyNetwork, segmentBezier } from './network';
import type { Lane, LaneProfile, PropKind, RoadClass, RoadNetwork, RoadSegment } from './types';
import { LANE_INFO, templateById } from './profile';

/**
 * Deterministic procedural city generator for large NFS-style maps.
 *
 * Roads: an orthogonal grid with a jittered node layout. Every 4th row/column
 * is an arterial (bus lanes optional), every 4th+2 is a boulevard (bike lanes,
 * parking), the perimeter is a divided highway. Diagonal pedestrian paths cut
 * some blocks, a railway runs along one row of blocks, and a subway line runs
 * along another (rendered as a surface ghost, since it is underground).
 *
 * Output is plain data, so the same seed always produces the same network.
 */

export interface CityOptions {
  seed: number;
  /** East-west extent in metres. */
  width: number;
  /** North-south extent in metres. */
  depth: number;
  /** Block size in metres. */
  block: number;
  /** Node jitter as a fraction of the block size (0..0.3). */
  jitter: number;
  busLanes: boolean;
  bikeLanes: boolean;
  parking: boolean;
  pedestrianPaths: boolean;
  railway: boolean;
  subway: boolean;
  speedBumps: boolean;
}

export const DEFAULT_CITY: CityOptions = {
  seed: 1337,
  width: 4000,
  depth: 4000,
  block: 120,
  jitter: 0.06,
  busLanes: true,
  bikeLanes: true,
  parking: true,
  pedestrianPaths: true,
  railway: true,
  subway: true,
  speedBumps: true,
};

/** mulberry32: small, fast, seedable PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a cross-section for a road class using the enabled options. */
export function profileForClass(cls: RoadClass, o: Pick<CityOptions, 'busLanes' | 'bikeLanes' | 'parking'>): LaneProfile {
  const L = (type: Lane['type'], width?: number): Lane => ({
    type,
    width: width ?? LANE_INFO[type].defaultWidth,
  });
  const build = (lanes: Lane[]): LaneProfile => ({
    centre: { kind: 'none', width: 0 },
    left: lanes.map((l) => ({ ...l })),
    right: lanes.map((l) => ({ ...l })),
  });
  switch (cls) {
    case 'highway':
      return templateById('highway-divided')!.profile();
    case 'arterial': {
      const lanes: Lane[] = [L('driving', 3.3)];
      if (o.busLanes) lanes.push(L('bus', 3.5));
      if (o.bikeLanes) lanes.push(L('bike'));
      lanes.push(L('sidewalk', 3.5));
      return { ...build(lanes), centre: { kind: 'doubleYellow', width: 0.4 } };
    }
    case 'boulevard': {
      const lanes: Lane[] = [L('driving', 3.3)];
      if (o.bikeLanes) lanes.push(L('bike'));
      if (o.parking) lanes.push(L('parking'));
      lanes.push(L('sidewalk', 3));
      return { ...build(lanes), centre: { kind: 'dashedWhite', width: 0.2 } };
    }
    case 'local': {
      const lanes: Lane[] = [L('driving', 3.0)];
      if (o.parking) lanes.push(L('parking'));
      lanes.push(L('sidewalk', 2.5));
      return build(lanes);
    }
    case 'path':
      return templateById('pedestrian-path')!.profile();
    case 'rail':
      return templateById('rail-line')!.profile();
    case 'subway':
      return templateById('subway-line')!.profile();
  }
}

export function generateCity(input: Partial<CityOptions> = {}): RoadNetwork {
  const o: CityOptions = { ...DEFAULT_CITY, ...input };
  const rng = mulberry32(o.seed);
  const net = createEmptyNetwork();
  const nx = Math.max(2, Math.round(o.width / o.block));
  const nz = Math.max(2, Math.round(o.depth / o.block));
  const B = o.block;

  let segCounter = 0;
  let propCounter = 0;
  const sid = () => `gs${(segCounter++).toString(36)}`;
  const pid = () => `gp${(propCounter++).toString(36)}`;

  // --- grid nodes ---------------------------------------------------------
  const gid = (i: number, j: number) => `g${i}_${j}`;
  const gridPos = new Map<string, { x: number; z: number }>();
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const edgeX = i === 0 || i === nx;
      const edgeZ = j === 0 || j === nz;
      const jx = edgeX ? 0 : (rng() * 2 - 1) * o.jitter * B;
      const jz = edgeZ ? 0 : (rng() * 2 - 1) * o.jitter * B;
      const x = i * B + jx;
      const z = j * B + jz;
      gridPos.set(gid(i, j), { x, z });
      net.nodes[gid(i, j)] = { id: gid(i, j), x, z };
    }
  }

  // Road classes per grid row/column (the perimeter is always highway).
  const rowClass = (j: number): RoadClass => (j === 0 || j === nz ? 'highway' : j % 4 === 0 ? 'arterial' : j % 4 === 2 ? 'boulevard' : 'local');
  const colClass = (i: number): RoadClass => (i === 0 || i === nx ? 'highway' : i % 4 === 0 ? 'arterial' : i % 4 === 2 ? 'boulevard' : 'local');
  const profiles = new Map<RoadClass, LaneProfile>();
  const profileOf = (cls: RoadClass) => {
    let p = profiles.get(cls);
    if (!p) {
      p = profileForClass(cls, o);
      profiles.set(cls, p);
    }
    return p;
  };

  const roadSegs: RoadSegment[] = [];
  const addStraight = (a: string, b: string, cls: RoadClass, profile: LaneProfile, id: string): RoadSegment => {
    const pa = net.nodes[a];
    const pb = net.nodes[b];
    const seg: RoadSegment = {
      id,
      from: a,
      to: b,
      c1: { x: pa.x + (pb.x - pa.x) / 3, z: pa.z + (pb.z - pa.z) / 3 },
      c2: { x: pa.x + ((pb.x - pa.x) * 2) / 3, z: pa.z + ((pb.z - pa.z) * 2) / 3 },
      cls,
      profile: JSON.parse(JSON.stringify(profile)),
    };
    net.segments[id] = seg;
    return seg;
  };

  // Horizontal (east-west) roads.
  for (let j = 0; j <= nz; j++) {
    const cls = rowClass(j);
    for (let i = 0; i < nx; i++) {
      roadSegs.push(addStraight(gid(i, j), gid(i + 1, j), cls, profileOf(cls), sid()));
    }
  }
  // Vertical (north-south) roads.
  for (let i = 0; i <= nx; i++) {
    const cls = colClass(i);
    for (let j = 0; j < nz; j++) {
      roadSegs.push(addStraight(gid(i, j), gid(i, j + 1), cls, profileOf(cls), sid()));
    }
  }

  // --- pedestrian paths (diagonals through some blocks) ----------------------
  if (o.pedestrianPaths) {
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        if (rng() > 0.22) continue;
        const flip = rng() < 0.5;
        const a = flip ? gid(i + 1, j) : gid(i, j);
        const b = flip ? gid(i, j + 1) : gid(i + 1, j + 1);
        const seg = addStraight(a, b, 'path', profileOf('path'), sid());
        // Bollards at the path mouths so vehicles can't cut through.
        const samples = sampleBezier(segmentBezier(net, seg), 0.5);
        const total = sampleLength(samples);
        const u0 = Math.min(0.5, 2.5 / total);
        addProp(net, seg.id, u0, 'bollard', 1.6, pid());
        addProp(net, seg.id, u0, 'bollard', -1.6, pid());
        addProp(net, seg.id, 1 - u0, 'bollard', 1.6, pid());
        addProp(net, seg.id, 1 - u0, 'bollard', -1.6, pid());
      }
    }
  }

  // --- railway and subway lines along a row of block centres ----------------
  const railRow = Math.max(1, Math.floor(nz * 0.3));
  const subwayRow = Math.max(1, Math.floor(nz * 0.7));
  const railZ = (railRow + 0.5) * B;
  const subwayZ = (subwayRow + 0.5) * B;
  const railNodes: string[] = [];
  if (o.railway) {
    // Rail spans the whole map width, one node per block centre plus both ends.
    for (let i = 0; i <= nx + 1; i++) {
      const id = `r${i}`;
      net.nodes[id] = { id, x: i * B - B / 2, z: railZ };
      railNodes.push(id);
    }
    for (let i = 0; i < railNodes.length - 1; i++) {
      addStraight(railNodes[i], railNodes[i + 1], 'rail', profileOf('rail'), sid());
    }
  }
  const subwayNodes: string[] = [];
  if (o.subway) {
    for (let i = 0; i <= nx; i++) {
      const id = `b${i}`;
      net.nodes[id] = { id, x: i * B + B / 2, z: subwayZ };
      subwayNodes.push(id);
    }
    for (let i = 0; i < subwayNodes.length - 1; i++) {
      const seg = addStraight(subwayNodes[i], subwayNodes[i + 1], 'subway', profileOf('subway'), sid());
      if (i % 3 === 1) addProp(net, seg.id, 0.5, 'subwayEntrance', 5, pid());
    }
  }

  // --- rail crossings on every road the railway passes over --------------------
  if (o.railway) {
    const railSegs = Object.values(net.segments).filter((s) => s.cls === 'rail');
    const roadPool = roadSegs.filter((s) => net.segments[s.id]);
    for (const rs of railSegs) {
      const rSamples = sampleBezier(segmentBezier(net, rs), 0.5);
      for (const road of roadPool) {
        const a = net.nodes[road.from];
        const b = net.nodes[road.to];
        // Cheap reject: segment must straddle the rail's Z line.
        if (Math.min(a.z, b.z) > railZ + B || Math.max(a.z, b.z) < railZ - B) continue;
        const sSamples = sampleBezier(segmentBezier(net, road), 0.5);
        for (const hit of intersectSamples(rSamples, sSamples)) {
          addProp(net, road.id, hit.uB, 'railCrossing', 0, pid());
        }
      }
    }
  }

  // --- junction props: crosswalks, stop lines and speed bumps ---------------------
  const roadLike = (s: RoadSegment) => s.cls === 'highway' || s.cls === 'arterial' || s.cls === 'boulevard' || s.cls === 'local';
  const incident = new Map<string, RoadSegment[]>();
  for (const s of Object.values(net.segments)) {
    if (!roadLike(s)) continue;
    for (const n of [s.from, s.to]) {
      const list = incident.get(n) ?? [];
      list.push(s);
      incident.set(n, list);
    }
  }
  for (const [nodeId, segs] of incident) {
    if (segs.length < 2) continue;
    for (const s of segs) {
      const a = net.nodes[s.from];
      const b = net.nodes[s.to];
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const fromStart = s.from === nodeId;
      const uAt = (d: number) => (fromStart ? d / L : 1 - d / L);
      if (rng() < 0.85) addProp(net, s.id, uAt(5), 'crosswalk', 0, pid());
      addProp(net, s.id, uAt(8.5), 'stopLine', 0, pid());
    }
  }
  if (o.speedBumps) {
    for (const s of Object.values(net.segments)) {
      if (s.cls === 'local' && rng() < 0.25) addProp(net, s.id, 0.5, 'speedBump', 0, pid());
    }
  }

  return net;
}

/** Local helper so the generator does not need a network-level id counter. */
function addProp(net: RoadNetwork, segmentId: string, u: number, kind: PropKind, lateral: number, id: string): void {
  net.props[id] = { id, segmentId, u: Math.min(1, Math.max(0, u)), kind, lateral };
}
