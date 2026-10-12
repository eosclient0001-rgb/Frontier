// Props: bollards, speed bumps, street lamps, level-crossing barriers, zebra crossings and placed props.
// Generated props are seeded per road, so spacing, heights and bump counts differ from road to road.

import { P2, Rng, leftNormal2 } from "../core/math";
import { Prop } from "../core/model";
import { NetEdge } from "../core/topology";
import { surfaceHeight } from "../core/terrain";
import { SpatialGrid } from "../core/spatial";
import { BucketSet, MeshBucket, RGB, V3 } from "./MeshBucket";
import { frameAt, offsetPoint } from "./frames";
import { buildCore } from "./roadMesh";
import { COLOUR } from "./palette";

// One sample of the road network, used to find the lift and half width under any point.
export interface RoadSample {
  x: number;
  z: number;
  r: number; // [m] - Half width of the road at this sample
  lift: number; // [m] - Lift at this sample
}

export interface PropContext {
  samples: SpatialGrid<RoadSample>;
}

// Octagonal prism standing on the ground at (x, y, z).
function post(bucket: MeshBucket, x: number, yBase: number, z: number, radius: number, height: number, colour: RGB, sides = 8): void {
  for (let j = 0; j < sides; j++) {
    const a0 = (j / sides) * Math.PI * 2;
    const a1 = ((j + 1) / sides) * Math.PI * 2;
    const p = (ang: number, y: number): V3 => [x + Math.cos(ang) * radius, y, z + Math.sin(ang) * radius];
    const n0: V3 = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
    bucket.quad(p(a0, yBase), p(a1, yBase), p(a1, yBase + height), p(a0, yBase + height), n0, colour);
  }
  bucket.quad(
    [x, yBase + height, z],
    [x + radius, yBase + height, z],
    [x, yBase + height, z + radius],
    [x - radius, yBase + height, z],
    [0, 1, 0],
    colour
  );
}

// Axis box along a horizontal direction t (unit), centred at c.
function obox(bucket: MeshBucket, c: P2, t: P2, halfAlong: number, halfAcross: number, yBottom: number, yTop: number, colour: RGB): void {
  const n = leftNormal2(t);
  const corners: V3[] = [];
  for (const y of [yBottom, yTop]) {
    for (const [a, l] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1]
    ] as const) {
      corners.push([c.x + t.x * a * halfAlong + n.x * l * halfAcross, y, c.z + t.z * a * halfAlong + n.z * l * halfAcross]);
    }
  }
  bucket.box(corners, colour);
}

// Extrude a (along, height) profile across the road at a fixed lateral range. Used by speed bumps.
function extrude(bucket: MeshBucket, centre: P2, t: P2, oLo: number, oHi: number, profile: [number, number][], colour: RGB, lift: number): void {
  const n = leftNormal2(t);
  const at = (along: number, o: number, h: number): V3 => [
    centre.x + t.x * along + n.x * o,
    surfaceHeight({ x: centre.x, z: centre.z }, lift) + h + 0,
    centre.z + t.z * along + n.z * o
  ];
  for (let i = 0; i < profile.length - 1; i++) {
    const [s0, h0] = profile[i];
    const [s1, h1] = profile[i + 1];
    const normal: V3 = [-(h1 - h0) * t.x, Math.max(1e-3, s1 - s0), -(h1 - h0) * t.z];
    bucket.quad(at(s0, oLo, h0), at(s0, oHi, h0), at(s1, oHi, h1), at(s1, oLo, h1), normal, colour);
  }
}

export function buildEdgeProps(edge: NetEdge, buckets: BucketSet, rngRoot: Rng): void {
  if (edge.underground) return;
  const rng = rngRoot.fork(0x51ed);
  const core = buildCore(edge, new Map());
  const W = core.W;
  const span = core.s1 - core.s0;
  const opt = edge.options;
  const bollard = buckets.get("prop");
  const lamp = buckets.get("prop");
  const lampHead = buckets.get("lamp");
  const bump = buckets.get("concrete");

  if (opt.bollards) {
    const spacing = rng.range(2.2, 2.8);
    for (let s = core.s0 + 1; s < core.s1 - 1; s += spacing) {
      const f = frameAt(edge, s);
      for (const side of [-1, 1]) {
        const p = offsetPoint(f, side * (W - 0.25));
        post(bollard, p.x, surfaceHeight(p, f.lift), p.z, 0.11, 0.85, COLOUR.bollard, 8);
      }
    }
  }

  if (opt.lamps && span > 20) {
    const spacing = rng.range(24, 34);
    const hasSidewalk = edge.section.bands.some((b) => b.kind === "sidewalk");
    const inset = hasSidewalk ? 0.9 : 1.0;
    const height = rng.range(5.8, 7.4);
    for (let s = core.s0 + rng.range(4, 12); s < core.s1 - 4; s += spacing) {
      const f = frameAt(edge, s);
      for (const side of [-1, 1]) {
        if (rng.chance(0.12)) continue; // gaps make every street look unique
        const base = offsetPoint(f, side * (W - inset));
        const yb = surfaceHeight(base, f.lift);
        post(lamp, base.x, yb, base.z, 0.09, height, COLOUR.lampPost, 6);
        const armEnd = offsetPoint(f, side * (W - inset - 1.6));
        obox(lamp, { x: (base.x + armEnd.x) / 2, z: (base.z + armEnd.z) / 2 }, { x: f.nx * side, z: f.nz * side }, 0.8, 0.07, yb + height - 0.2, yb + height, COLOUR.lampPost);
        obox(lampHead, { x: armEnd.x, z: armEnd.z }, { x: f.tx, z: f.tz }, 0.35, 0.18, yb + height - 0.45, yb + height - 0.2, COLOUR.lampLight);
      }
    }
  }

  if (opt.speedBumps && span > 80) {
    const count = Math.max(1, Math.floor(span / rng.range(110, 170)));
    for (let k = 0; k < count; k++) {
      const s = rng.range(core.s0 + 30, core.s1 - 30);
      const f = frameAt(edge, s);
      const h = rng.range(0.07, 0.11);
      const profile: [number, number][] = [
        [-0.9, 0],
        [-0.45, h],
        [0.45, h],
        [0.9, 0]
      ];
      extrude(bump, { x: f.x, z: f.z }, { x: f.tx, z: f.tz }, -W + 0.2, W - 0.2, profile, COLOUR.concreteDark, f.lift);
    }
  }
}

// Level crossing: a rubber pad across the carriageway, two barrier gates (one per traffic direction) and warning lights.
// Gate arms run across the road, perpendicular to traffic, and alternate red and white segments.
export function buildLevelCrossing(c: { x: number; z: number; yaw: number }, halfWidth: number, lift: number, buckets: BucketSet): void {
  const t: P2 = { x: Math.sin(c.yaw), z: Math.cos(c.yaw) };
  const n = leftNormal2(t);
  const centre: P2 = { x: c.x, z: c.z };
  const steel = buckets.get("steel");
  const pad = buckets.get("prop");
  const lights = buckets.get("lamp");
  const y0 = surfaceHeight(centre, lift);
  obox(pad, centre, t, 1.4, halfWidth, y0 + 0.03, y0 + 0.06, COLOUR.asphaltWorn);

  const armLen = halfWidth * 2 - 0.5;
  const segs = 6;
  const segHalf = (armLen / segs) * 0.5 * 0.96;
  for (const along of [-3.2, 3.2]) {
    const gate: P2 = { x: centre.x + t.x * along, z: centre.z + t.z * along };
    for (const side of [-1, 1]) {
      const pole: P2 = { x: gate.x + n.x * side * (halfWidth + 0.6), z: gate.z + n.z * side * (halfWidth + 0.6) };
      const yb = surfaceHeight(pole, lift);
      post(steel, pole.x, yb, pole.z, 0.12, 1.25, COLOUR.barrierWhite, 6);
      for (let q = 0; q < segs; q++) {
        const d = (armLen * (q + 0.5)) / segs; // distance from the pole towards the far kerb
        const c2: P2 = { x: pole.x - n.x * side * d, z: pole.z - n.z * side * d };
        obox(steel, c2, n, segHalf, 0.09, yb + 1.05, yb + 1.2, q % 2 === 0 ? COLOUR.barrierRed : COLOUR.barrierWhite);
      }
    }
    // Warning light posts beside the kerb, red lamp on top.
    for (const side of [-1, 1]) {
      const pole: P2 = { x: gate.x + n.x * side * (halfWidth + 1.4), z: gate.z + n.z * side * (halfWidth + 1.4) };
      const yb = surfaceHeight(pole, lift);
      post(steel, pole.x, yb, pole.z, 0.07, 3.6, COLOUR.steelDark, 6);
      obox(lights, pole, t, 0.18, 0.18, yb + 3.6, yb + 3.85, COLOUR.signalRed);
    }
  }
}

// Zebra crossing or stop line at an arbitrary point with a heading.
export function buildPlacedProp(p: Prop, halfWidth: number, lift: number, buckets: BucketSet): void {
  const t: P2 = { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
  const n = leftNormal2(t);
  const centre: P2 = { x: p.x, z: p.z };
  const y = surfaceHeight(centre, lift);
  const paint = buckets.get("marking");
  const prop = buckets.get("prop");
  switch (p.kind) {
    case "bollard":
      post(prop, p.x, y, p.z, 0.11, 0.85, COLOUR.bollard, 8);
      break;
    case "lamp":
      post(prop, p.x, y, p.z, 0.09, 6.5, COLOUR.lampPost, 6);
      obox(buckets.get("lamp"), { x: p.x + n.x * 1.2, z: p.z + n.z * 1.2 }, t, 0.35, 0.18, y + 6.2, y + 6.45, COLOUR.lampLight);
      break;
    case "speedBump": {
      const profile: [number, number][] = [
        [-0.9, 0],
        [-0.45, 0.09],
        [0.45, 0.09],
        [0.9, 0]
      ];
      extrude(buckets.get("concrete"), centre, t, -halfWidth, halfWidth, profile, COLOUR.concreteDark, lift);
      break;
    }
    case "crosswalk":
      for (let o = -halfWidth + 0.5; o <= halfWidth - 0.5; o += 1.0) {
        const c = { x: p.x + n.x * o, z: p.z + n.z * o };
        obox(paint, c, t, 1.4, 0.25, y + 0.03, y + 0.05, COLOUR.marking);
      }
      break;
    case "stopLine":
      obox(paint, centre, n, halfWidth, 0.2, y + 0.03, y + 0.05, COLOUR.marking);
      break;
    case "railCrossing":
      buildLevelCrossing({ x: p.x, z: p.z, yaw: p.yaw }, halfWidth, lift, buckets);
      break;
  }
}

