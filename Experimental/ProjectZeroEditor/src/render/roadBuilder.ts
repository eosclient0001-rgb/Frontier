import { convexHull, sampleAtU, sampleLength, sliceSamples } from '../model/geometry';
import type { Sample } from '../model/geometry';
import type { V2 } from '../model/types';
import {
  boundaryMarking,
  centreMarkings,
  CURB_COLOR,
  flatExtent,
  layoutBands,
  LANE_INFO,
  totalExtent,
} from '../model/profile';
import type { Marking } from '../model/profile';
import type { Prop, RoadNetwork, RoadNode, RoadSegment } from '../model/types';
import { MeshBatch } from './batch';
import type { Vec3 } from './batch';

/**
 * Turns road data into triangles. Each function appends to a MeshBatch, so a
 * whole world chunk ends up as one draw call.
 *
 * Layering (heights in metres): ground 0, surfaces 0..0.15, pavement joints and
 * markings 0.03..0.05, rails and props above that.
 */

export const COL = {
  asphalt: LANE_INFO.driving.color,
  white: 0xf2f2ee,
  yellow: 0xf0c020,
  rail: 0xc3c7cc,
  sleeper: 0x5a3d2b,
  joint: 0x9c8660,
  subway: 0x8e44ad,
  bollard: 0xf0c020,
  stationBox: 0x7a3c9a,
  post: 0xf4f4f4,
  barrier: 0xd02020,
  railPad: 0x6e6457,
  speedBumpA: 0xf0c020,
  speedBumpB: 0x2a2a2a,
  curb: CURB_COLOR,
};

const Y_MARK = 0.03;
const Y_CROSS = 0.035;
const LINE_W = 0.15;
const DASH_ON = 3;
const DASH_PERIOD = 12;

/** Road classes that take part in junction fills and kerbs. */
export function isRoadClass(cls: RoadSegment['cls']): boolean {
  return cls === 'highway' || cls === 'arterial' || cls === 'boulevard' || cls === 'local' || cls === 'path';
}

const P = (s: Sample, off: number, along: number, y: number): Vec3 => [
  s.x + s.nx * off + s.tx * along,
  y,
  s.z + s.nz * off + s.tz * along,
];

/** Flat strip between two lateral offsets along the samples. */
function ribbon(b: MeshBatch, samples: Sample[], lo: number, hi: number, y: number, colour: number): void {
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const c = samples[i + 1];
    b.quad(P(a, lo, 0, y), P(a, hi, 0, y), P(c, hi, 0, y), P(c, lo, 0, y), colour);
  }
}

/** Vertical wall along the samples at offset `off`, from y0 to y1. */
function wall(b: MeshBatch, samples: Sample[], off: number, y0: number, y1: number, colour: number): void {
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const c = samples[i + 1];
    b.quad(P(a, off, 0, y0), P(a, off, 0, y1), P(c, off, 0, y1), P(c, off, 0, y0), colour);
  }
}

/** Paint line along the samples, centred on `off`. Dashed when requested. */
function paintLine(b: MeshBatch, samples: Sample[], m: Marking, style: 'solid' | 'dashed', width = LINE_W): void {
  const lo = m.offset - width / 2;
  const hi = m.offset + width / 2;
  if (style === 'solid') {
    ribbon(b, samples, lo, hi, Y_MARK, m.colour);
    return;
  }
  const total = sampleLength(samples);
  for (let s = 0; s < total; s += DASH_PERIOD) {
    const piece = sliceSamples(samples, s, Math.min(total, s + DASH_ON));
    if (piece.length >= 2) ribbon(b, piece, lo, hi, Y_MARK, m.colour);
  }
}

/** Thin paving joints across the pedestrian band every 2.5 m. */
function pavingJoints(b: MeshBatch, samples: Sample[], lo: number, hi: number, y: number): void {
  const total = sampleLength(samples);
  const spacing = 2.5;
  const w = 0.03;
  for (let s = spacing; s < total - 0.01; s += spacing) {
    const a = sampleAtU(samples, s / total);
    b.quad(P(a, lo, -w, y + 0.005), P(a, hi, -w, y + 0.005), P(a, hi, w, y + 0.005), P(a, lo, w, y + 0.005), COL.joint);
  }
}

/** Draws one road segment: surfaces, kerbs, paint, and rails/subway if needed. */
export function buildSegment(b: MeshBatch, seg: RoadSegment, samples: Sample[]): void {
  if (samples.length < 2) return;

  if (seg.cls === 'subway') {
    // Underground line: shown as a violet ghost ribbon on the surface.
    ribbon(b, samples, -0.8, 0.8, 0.05, COL.subway);
    return;
  }
  if (seg.cls === 'rail') {
    buildRail(b, seg, samples);
    return;
  }

  const bands = layoutBands(seg.profile);

  // 1. Surfaces.
  for (const band of bands) {
    ribbon(b, samples, band.lo, band.hi, band.y, band.color);
    if (band.type === 'pathway') pavingJoints(b, samples, band.lo, band.hi, band.y);
  }

  // 2. Kerbs wherever the surface height changes between neighbours.
  for (let i = 0; i < bands.length - 1; i++) {
    const a = bands[i];
    const c = bands[i + 1];
    if (Math.abs(a.y - c.y) < 1e-6) continue;
    const off = a.hi;
    const low = Math.min(a.y, c.y);
    const high = Math.max(a.y, c.y);
    wall(b, samples, off, low, high, COL.curb);
  }

  // 3. Paint between flat neighbours and along the centre.
  for (let i = 0; i < bands.length - 1; i++) {
    const m = boundaryMarking(bands[i], bands[i + 1]);
    if (!m) continue;
    const dashed = m.style === 'dashed';
    paintLine(b, samples, m, dashed ? 'dashed' : 'solid');
  }
  for (const m of centreMarkings(seg.profile)) {
    paintLine(b, samples, m, m.style === 'dashed' ? 'dashed' : 'solid', m.style === 'doubleYellow' ? 0.12 : LINE_W);
  }
}

function buildRail(b: MeshBatch, seg: RoadSegment, samples: Sample[]): void {
  const ext = totalExtent(seg.profile);
  // Ballast bed.
  ribbon(b, samples, ext.lo, ext.hi, LANE_INFO.railway.y, LANE_INFO.railway.color);
  // Two rails at standard gauge (1435 mm).
  for (const off of [-0.7175, 0.7175]) {
    ribbon(b, samples, off - 0.06, off + 0.06, 0.16, COL.rail);
  }
  // Sleepers every 0.6 m.
  const total = sampleLength(samples);
  for (let s = 0.3; s < total; s += 0.6) {
    const smp = sampleAtU(samples, s / total);
    const c: Vec3 = [smp.x, 0.07, smp.z];
    b.orientedBox(c, [smp.tx, smp.tz], { r: ext.hi - ext.lo - 0.4, up: 0.12, f: 0.25 }, COL.sleeper);
  }
}

/**
 * Junction fill at a node: convex hull of the flat road edges of every segment
 * that meets the node. Kerbed sidewalk corners are not covered (documented limitation).
 */
export function buildJunction(
  b: MeshBatch,
  node: RoadNode,
  arms: Array<{ seg: RoadSegment; samples: Sample[]; atStart: boolean }>,
): void {
  const pts: V2[] = [];
  for (const arm of arms) {
    const s = arm.atStart ? arm.samples[0] : arm.samples[arm.samples.length - 1];
    const ext = flatExtent(arm.seg.profile);
    pts.push({ x: s.x + s.nx * ext.lo, z: s.z + s.nz * ext.lo }, { x: s.x + s.nx * ext.hi, z: s.z + s.nz * ext.hi });
  }
  // Anchor the fill on the node itself so degenerate 1-arm input still makes sense.
  pts.push({ x: node.x, z: node.z });
  const hull = convexHull(pts);
  if (hull.length < 3) return;
  const cx = hull.reduce((acc, p) => acc + p.x, 0) / hull.length;
  const cz = hull.reduce((acc, p) => acc + p.z, 0) / hull.length;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i];
    const q = hull[(i + 1) % hull.length];
    b.tri([cx, 0, cz], [p.x, 0, p.z], [q.x, 0, q.z], COL.asphalt);
  }
}

/** Props: everything placed on a segment at fraction u. */
export function buildProp(b: MeshBatch, prop: Prop, seg: RoadSegment, samples: Sample[]): void {
  const s = sampleAtU(samples, prop.u);
  const flat = flatExtent(seg.profile);
  const centre = { x: s.x + s.nx * prop.lateral, z: s.z + s.nz * prop.lateral };
  const baseF: [number, number] = [s.tx, s.tz];

  switch (prop.kind) {
    case 'bollard': {
      b.cylinder([centre.x, 0, centre.z], 0.14, 0.9, 10, COL.bollard);
      b.cylinder([centre.x, 0.9, centre.z], 0.16, 0.05, 10, COL.white);
      break;
    }
    case 'speedBump': {
      const stations = [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9];
      const heights = [0, 0.03, 0.06, 0.09, 0.06, 0.03, 0];
      for (let k = 0; k < stations.length - 1; k++) {
        const colour = k % 2 === 0 ? COL.speedBumpA : COL.speedBumpB;
        const f0 = stations[k];
        const f1 = stations[k + 1];
        const h0 = heights[k];
        const h1 = heights[k + 1];
        b.quad(
          P(s, flat.lo, f0, h0),
          P(s, flat.hi, f0, h0),
          P(s, flat.hi, f1, h1),
          P(s, flat.lo, f1, h1),
          colour,
        );
      }
      break;
    }
    case 'crosswalk': {
      // Zebra bars run along the traffic direction, stacked across the road.
      for (let off = flat.lo; off + 0.6 <= flat.hi + 1e-6; off += 1.2) {
        b.quad(
          P(s, off, -1.5, Y_CROSS),
          P(s, off + 0.6, -1.5, Y_CROSS),
          P(s, off + 0.6, 1.5, Y_CROSS),
          P(s, off, 1.5, Y_CROSS),
          COL.white,
        );
      }
      break;
    }
    case 'stopLine': {
      b.quad(
        P(s, flat.lo, -0.25, Y_MARK),
        P(s, flat.hi, -0.25, Y_MARK),
        P(s, flat.hi, 0.25, Y_MARK),
        P(s, flat.lo, 0.25, Y_MARK),
        COL.white,
      );
      break;
    }
    case 'railCrossing': {
      // Planked crossing pad across the road.
      b.quad(
        P(s, flat.lo, -1.3, 0.02),
        P(s, flat.hi, -1.3, 0.02),
        P(s, flat.hi, 1.3, 0.02),
        P(s, flat.lo, 1.3, 0.02),
        COL.railPad,
      );
      // Two rails running across the road.
      for (const along of [-0.72, 0.72]) {
        beam(b, P(s, flat.lo, along, 0.14), P(s, flat.hi, along, 0.14), 0.14, COL.rail);
      }
      // Crossbuck posts on both road edges with an X sign on top.
      for (const off of [flat.lo - 0.8, flat.hi + 0.8]) {
        const base = P(s, off, 0, 0);
        b.orientedBox([base[0], 1.7, base[2]], baseF, { r: 0.12, up: 3.4, f: 0.12 }, COL.post);
        const top = [base[0], 3.2, base[2]] as Vec3;
        const r = [s.nx, 0, s.nz] as Vec3;
        beam(b, [top[0] - r[0] * 0.5, 3.4, top[2] - r[2] * 0.5], [top[0] + r[0] * 0.5, 2.6, top[2] + r[2] * 0.5], 0.1, COL.barrier);
        beam(b, [top[0] - r[0] * 0.5, 2.6, top[2] - r[2] * 0.5], [top[0] + r[0] * 0.5, 3.4, top[2] + r[2] * 0.5], 0.1, COL.barrier);
      }
      // Barrier arm across the road at 1.1 m.
      beam(b, P(s, flat.lo - 0.8, 0, 1.1), P(s, flat.hi + 0.8, 0, 1.1), 0.12, COL.barrier);
      break;
    }
    case 'subwayEntrance': {
      b.orientedBox([centre.x, 0.6, centre.z], baseF, { r: 2.4, up: 1.2, f: 2.4 }, COL.stationBox);
      b.cylinder([centre.x, 0, centre.z], 0.12, 3.2, 8, COL.post);
      break;
    }
  }
}

/** Generic box between two arbitrary points with square section `t`. */
export function beam(b: MeshBatch, a: Vec3, c: Vec3, t: number, colour: number): void {
  const d: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const L = Math.hypot(d[0], d[1], d[2]) || 1;
  const dn: Vec3 = [d[0] / L, d[1] / L, d[2] / L];
  const helper: Vec3 = Math.abs(dn[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cross = (p: Vec3, q: Vec3): Vec3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const norm = (p: Vec3): Vec3 => {
    const l = Math.hypot(p[0], p[1], p[2]) || 1;
    return [p[0] / l, p[1] / l, p[2] / l];
  };
  const u = norm(cross(dn, helper));
  const v = norm(cross(dn, u));
  const h = t / 2;
  const at = (base: Vec3, su: number, sv: number): Vec3 => [
    base[0] + (u[0] * su + v[0] * sv) * h,
    base[1] + (u[1] * su + v[1] * sv) * h,
    base[2] + (u[2] * su + v[2] * sv) * h,
  ];
  const cornersA = { pp: at(a, 1, 1), pn: at(a, 1, -1), np: at(a, -1, 1), nn: at(a, -1, -1) };
  const cornersB = { pp: at(c, 1, 1), pn: at(c, 1, -1), np: at(c, -1, 1), nn: at(c, -1, -1) };
  // Four side faces plus two caps.
  b.quad(cornersA.pp, cornersB.pp, cornersB.pn, cornersA.pn, colour);
  b.quad(cornersA.np, cornersA.nn, cornersB.nn, cornersB.np, colour);
  b.quad(cornersA.pp, cornersA.np, cornersB.np, cornersB.pp, colour);
  b.quad(cornersA.pn, cornersB.pn, cornersB.nn, cornersA.nn, colour);
  b.quad(cornersA.pp, cornersA.pn, cornersA.nn, cornersA.np, colour);
  b.quad(cornersB.pp, cornersB.np, cornersB.nn, cornersB.pn, colour);
}

/** Road-like segments that meet a node, with the end sample used for junction fills. */
export function armsAtNode(
  net: RoadNetwork,
  nodeId: string,
  sampleOf: (seg: RoadSegment) => Sample[],
): Array<{ seg: RoadSegment; samples: Sample[]; atStart: boolean }> {
  const out: Array<{ seg: RoadSegment; samples: Sample[]; atStart: boolean }> = [];
  for (const seg of Object.values(net.segments)) {
    if (!isRoadClass(seg.cls)) continue;
    if (seg.from !== nodeId && seg.to !== nodeId) continue;
    out.push({ seg, samples: sampleOf(seg), atStart: seg.from === nodeId });
  }
  return out;
}

