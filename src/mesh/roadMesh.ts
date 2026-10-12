// Road surfaces: lane strips with kerbs, lane and edge markings, crosswalks, stop lines, wear patches,
// junction polygons and railway / subway tracks. Every edge gets its own per-road tint and wear pattern,
// seeded from the road, so no two roads are identical even when they share a profile.

import * as THREE from "three";
import { Band, PROFILES } from "../core/profiles";
import { clamp, P2, Rng } from "../core/math";
import { EndCap, capKey, JunctionModel } from "../core/junction";
import { surfaceHeight, terrainHeight } from "../core/terrain";
import type { NetEdge, RoadNetwork } from "../core/topology";
import { BucketSet, RGB, V3 } from "./MeshBucket";
import { frameAt, Frame, offsetPoint } from "./frames";
import { COLOUR, shade, tint } from "./palette";

const STEP = 2.0; // [m] - Core sample spacing along the road
export const MARKING_LIFT = 0.03; // [m] - Paint sits this far above the asphalt to avoid z-fighting

export interface Core {
  edge: NetEdge;
  W: number; // half width of the section
  s0: number; // trimmed start (arc length)
  s1: number; // trimmed end (arc length)
  frames: Frame[];
  startCap?: EndCap;
  endCap?: EndCap;
}

export interface SurfaceContext {
  degree: Map<string, number>;
  caps: JunctionModel["caps"];
}

export function buildCore(edge: NetEdge, caps: JunctionModel["caps"]): Core {
  const L = edge.length;
  const startCap = caps.get(capKey(edge.id, "a"));
  const endCap = caps.get(capKey(edge.id, "b"));
  const f0 = frameAt(edge, 0);
  const fL = frameAt(edge, L);
  let tA = 0;
  let tB = 0;
  if (startCap) {
    const mx = (startCap.plus.x + startCap.minus.x) * 0.5;
    const mz = (startCap.plus.z + startCap.minus.z) * 0.5;
    tA = clamp((mx - edge.pts[0].x) * f0.tx + (mz - edge.pts[0].z) * f0.tz, 0, 0.4 * L);
  }
  if (endCap) {
    const last = edge.pts[edge.pts.length - 1];
    const mx = (endCap.plus.x + endCap.minus.x) * 0.5;
    const mz = (endCap.plus.z + endCap.minus.z) * 0.5;
    tB = clamp((last.x - mx) * fL.tx + (last.z - mz) * fL.tz, 0, 0.4 * L);
  }
  const s0 = tA;
  const s1 = Math.max(s0 + 0.01, L - tB);
  const count = Math.max(2, Math.ceil((s1 - s0) / STEP) + 1);
  const frames: Frame[] = [];
  for (let k = 0; k < count; k++) frames.push(frameAt(edge, s0 + ((s1 - s0) * k) / (count - 1)));
  // Ends share the node's lift so the ribbon meets the junction polygon at identical heights.
  if (startCap) frames[0].lift = edge.lifts[0];
  if (endCap) frames[count - 1].lift = edge.lifts[edge.lifts.length - 1];
  return { edge, W: edge.section.width * 0.5, s0, s1, frames, startCap, endCap };
}

// Lateral point at core sample k, offset o (positive = left of travel). Ends map onto the junction caps.
function lateral(core: Core, k: number, o: number): P2 {
  const last = core.frames.length - 1;
  const t = clamp((o + core.W) / (2 * core.W), 0, 1);
  if (k === 0 && core.startCap) {
    return { x: core.startCap.minus.x + (core.startCap.plus.x - core.startCap.minus.x) * t, z: core.startCap.minus.z + (core.startCap.plus.z - core.startCap.minus.z) * t };
  }
  if (k === last && core.endCap) {
    return { x: core.endCap.minus.x + (core.endCap.plus.x - core.endCap.minus.x) * t, z: core.endCap.minus.z + (core.endCap.plus.z - core.endCap.minus.z) * t };
  }
  return offsetPoint(core.frames[k], o);
}

function topAt(core: Core, k: number, p: P2, elev: number): V3 {
  return [p.x, surfaceHeight(p, core.frames[k].lift) + elev, p.z];
}

function bandColour(kind: Band["kind"], motorway: boolean): RGB {
  switch (kind) {
    case "drive":
      return COLOUR.asphalt;
    case "bus":
      return COLOUR.bus;
    case "cycle":
      return COLOUR.cycle;
    case "parking":
      return COLOUR.parking;
    case "sidewalk":
      return COLOUR.sidewalk;
    case "median":
      return motorway ? COLOUR.concrete : COLOUR.grass;
    case "verge":
      return COLOUR.verge;
    case "shoulder":
      return COLOUR.gravel;
    case "dirt":
      return COLOUR.dirt;
    case "paving":
      return COLOUR.paving;
    case "ballast":
      return COLOUR.ballast;
    case "tunnel":
      return COLOUR.asphalt;
  }
}

// Strip between two lateral offsets across every core sample. Surface follows terrain plus `elev`.
function bandStrip(bucket: ReturnType<BucketSet["get"]>, core: Core, oHi: number, oLo: number, elev: number, base: RGB, shadeAmt: number): void {
  for (let k = 0; k < core.frames.length - 1; k++) {
    const a = lateral(core, k, oHi);
    const b = lateral(core, k, oLo);
    const c = lateral(core, k + 1, oLo);
    const d = lateral(core, k + 1, oHi);
    const pa = topAt(core, k, a, elev);
    const pb = topAt(core, k, b, elev);
    const pc = topAt(core, k + 1, c, elev);
    const pd = topAt(core, k + 1, d, elev);
    bucket.quad(
      pa,
      pb,
      pc,
      pd,
      [0, 1, 0],
      shade(base, a.x, a.z, shadeAmt),
      shade(base, b.x, b.z, shadeAmt),
      shade(base, c.x, c.z, shadeAmt),
      shade(base, d.x, d.z, shadeAmt)
    );
  }
}

// Vertical kerb face between two lateral positions at different heights. `towardRight` says which side is lower.
function kerbFace(bucket: ReturnType<BucketSet["get"]>, core: Core, o: number, elevLow: number, elevHigh: number, normalSign: number, colour: RGB): void {
  for (let k = 0; k < core.frames.length - 1; k++) {
    const p0 = lateral(core, k, o);
    const p1 = lateral(core, k + 1, o);
    const f = core.frames[k];
    const n: V3 = [f.nx * normalSign, 0, f.nz * normalSign];
    const lo0: V3 = [p0.x, surfaceHeight(p0, core.frames[k].lift) + elevLow, p0.z];
    const hi0: V3 = [p0.x, surfaceHeight(p0, core.frames[k].lift) + elevHigh, p0.z];
    const lo1: V3 = [p1.x, surfaceHeight(p1, core.frames[k + 1].lift) + elevLow, p1.z];
    const hi1: V3 = [p1.x, surfaceHeight(p1, core.frames[k + 1].lift) + elevHigh, p1.z];
    bucket.quad(lo0, hi0, hi1, lo1, n, colour);
  }
}

// Paint strip between two lateral offsets over an arc-length range (used for lines, dashes and bars).
function paintStrip(bucket: ReturnType<BucketSet["get"]>, edge: NetEdge, s0: number, s1: number, oLo: number, oHi: number, elev: number, colour: RGB, step = STEP): void {
  const count = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let k = 0; k < count; k++) {
    const fa = frameAt(edge, s0 + ((s1 - s0) * k) / count);
    const fb = frameAt(edge, s0 + ((s1 - s0) * (k + 1)) / count);
    const a1 = offsetPoint(fa, oHi);
    const a2 = offsetPoint(fa, oLo);
    const b2 = offsetPoint(fb, oLo);
    const b1 = offsetPoint(fb, oHi);
    const y = (p: P2, f: Frame): V3 => [p.x, surfaceHeight(p, f.lift) + elev + MARKING_LIFT, p.z];
    bucket.quad(y(a1, fa), y(a2, fa), y(b2, fb), y(b1, fb), [0, 1, 0], colour);
  }
}

function dashedLine(bucket: ReturnType<BucketSet["get"]>, edge: NetEdge, s0: number, s1: number, o: number, width: number, dash: number, gap: number, elev: number, colour: RGB, phase = 0): void {
  for (let s = s0 + phase; s < s1; s += dash + gap) {
    const e = Math.min(s + dash, s1);
    if (e - s < 0.3) continue;
    paintStrip(bucket, edge, s, e, o - width / 2, o + width / 2, elev, colour, dash);
  }
}

// Procedural colour and paint bands for one edge. Returns nothing; writes into the bucket set.
export function buildSurface(edge: NetEdge, ctx: SurfaceContext, buckets: BucketSet): void {
  if (edge.underground) return; // Subways are rendered as ghost tubes, not as surfaces
  const def = PROFILES[edge.profile];
  const rng = new Rng(edge.seed);
  const core = buildCore(edge, ctx.caps);
  const asphalt = buckets.get("asphalt");
  const paint = buckets.get("marking");
  const motorway = edge.profile === "motorway";

  // Per-road tint: every road gets its own asphalt age and colour cast.
  const roadTint = tint(COLOUR.asphalt, 1 + rng.range(-0.05, 0.05), 1 + rng.range(-0.04, 0.04), 1 + rng.range(-0.04, 0.04));
  const wearAmount = rng.range(0.08, 0.2);

  // ---- Lateral bands --------------------------------------------------------------------------
  const bands = edge.section.bands;
  const bandGeometry: { hi: number; lo: number; band: Band }[] = [];
  let o = core.W;
  for (const band of bands) {
    bandGeometry.push({ hi: o, lo: o - band.w, band });
    o -= band.w;
  }

  for (const bg of bandGeometry) {
    const { band } = bg;
    if (band.kind === "tunnel") continue;
    let colour = bandColour(band.kind, motorway);
    if (band.kind === "drive") colour = roadTint;
    else if (band.kind === "bus" || band.kind === "parking" || band.kind === "cycle") colour = tint(colour, 1 + rng.range(-0.05, 0.05), 1, 1);
    const target = band.kind === "ballast" || band.kind === "dirt" || band.kind === "verge" || band.kind === "shoulder" || band.kind === "median" ? buckets.get("ground") : band.kind === "paving" || band.kind === "sidewalk" ? buckets.get("paving") : asphalt;
    bandStrip(target, core, bg.hi, bg.lo, band.elev, colour, wearAmount);
  }

  // Kerbs where neighbouring bands sit at different heights, and the outer lip of raised outer bands.
  for (let i = 0; i < bandGeometry.length - 1; i++) {
    const left = bandGeometry[i];
    const right = bandGeometry[i + 1];
    if (left.band.elev === right.band.elev) continue;
    const high = left.band.elev > right.band.elev;
    const elevLow = Math.min(left.band.elev, right.band.elev);
    const elevHigh = Math.max(left.band.elev, right.band.elev);
    kerbFace(buckets.get("concrete"), core, left.lo, elevLow, elevHigh, high ? -1 : 1, COLOUR.curb);
  }
  const outerLeft = bandGeometry[0];
  const outerRight = bandGeometry[bandGeometry.length - 1];
  if (outerLeft && outerLeft.band.elev > 0) kerbFace(buckets.get("concrete"), core, outerLeft.hi, -0.3, outerLeft.band.elev, 1, COLOUR.concreteDark);
  if (outerRight && outerRight.band.elev > 0) kerbFace(buckets.get("concrete"), core, outerRight.lo, -0.3, outerRight.band.elev, -1, COLOUR.concreteDark);

  // ---- Markings ---------------------------------------------------------------------------------
  const sA = core.s0;
  const sB = core.s1;
  for (let i = 0; i < bandGeometry.length - 1; i++) {
    const left = bandGeometry[i];
    const right = bandGeometry[i + 1];
    const oB = left.lo;
    const kindL = left.band.kind;
    const kindR = right.band.kind;
    const w = 0.13;
    if (kindL === "drive" && kindR === "drive") {
      if (Math.abs(oB) < 0.05) {
        if (edge.profile === "residential" || edge.profile === "street") continue;
        if (edge.profile === "country" && rng.chance(0.3)) paintStrip(paint, edge, sA, sB, oB - 0.12, oB + 0.12, 0, COLOUR.yellow);
        else dashedLine(paint, edge, sA, sB, oB, w, 4.5, 7.5, 0, COLOUR.marking, rng.range(0, 6));
      } else {
        dashedLine(paint, edge, sA, sB, oB, w, 4.5, 7.5, 0, COLOUR.marking, rng.range(0, 6));
      }
    } else if (kindL === "median" || kindR === "median" || kindL === "sidewalk" || kindR === "sidewalk") {
      continue; // kerb geometry already separates these
    } else if (kindL === "parking" || kindR === "parking") {
      dashedLine(paint, edge, sA, sB, oB, w, 3.0, 2.5, 0, COLOUR.marking, 0);
    } else if (kindL === "cycle" || kindR === "cycle") {
      dashedLine(paint, edge, sA, sB, oB, w, 2.0, 2.0, 0, COLOUR.marking, 0);
    } else if (kindL === "drive" || kindR === "drive" || kindL === "bus" || kindR === "bus") {
      paintStrip(paint, edge, sA, sB, oB - w / 2, oB + w / 2, 0, COLOUR.marking);
    }
  }

  // Parking bay ticks (transverse lines every few metres inside each parking band).
  for (const bg of bandGeometry) {
    if (bg.band.kind !== "parking") continue;
    const spacing = rng.range(5.0, 6.2);
    for (let s = sA + rng.range(0, spacing); s < sB - 1; s += spacing) {
      paintStrip(paint, edge, s, s + 0.14, bg.lo + 0.15, bg.hi - 0.15, 0, COLOUR.marking);
    }
  }

  // Carriageway extent (outermost drive or bus band) used for stop lines and crosswalks.
  let carOuter = 0;
  for (const bg of bandGeometry) {
    if (bg.band.kind === "drive" || bg.band.kind === "bus") carOuter = Math.max(carOuter, Math.abs(bg.hi), Math.abs(bg.lo));
  }

  // ---- Junction approach markings ----------------------------------------------------------------
  const urban = def.category === "urban";
  const junctionAtStart = (ctx.degree.get(edge.a) ?? 0) >= 3;
  const junctionAtEnd = (ctx.degree.get(edge.b) ?? 0) >= 3;
  if (urban && carOuter > 0) {
    if (junctionAtStart && sB - sA > 24) addApproach(paint, edge, sA + 6, 1, carOuter, edge.section.bands.some((b) => b.kind === "sidewalk"));
    if (junctionAtEnd && sB - sA > 24) addApproach(paint, edge, sB - 6, -1, carOuter, edge.section.bands.some((b) => b.kind === "sidewalk"));
  }

  // ---- Wear patches ----------------------------------------------------------------------------
  const driveBands = bandGeometry.filter((b) => b.band.kind === "drive");
  if (driveBands.length > 0 && core.s1 - core.s0 > 30) {
    const patchCount = Math.round(((core.s1 - core.s0) / 90) * rng.range(0.4, 1.6));
    for (let q = 0; q < patchCount; q++) {
      const band = driveBands[rng.int(0, driveBands.length - 1)];
      const s = rng.range(core.s0 + 4, core.s1 - 4);
      const len = rng.range(1.5, 5);
      const wid = rng.range(0.8, Math.min(2.6, Math.abs(band.hi - band.lo)));
      const oc = rng.range(band.lo + wid / 2, band.hi - wid / 2);
      const patchColour = rng.chance(0.5) ? COLOUR.asphaltPatch : COLOUR.asphaltWorn;
      const f1 = frameAt(edge, s);
      const f2 = frameAt(edge, Math.min(core.s1, s + len));
      const pts = [offsetPoint(f1, oc - wid / 2), offsetPoint(f1, oc + wid / 2), offsetPoint(f2, oc + wid / 2), offsetPoint(f2, oc - wid / 2)];
      const y = (p: P2, f: Frame): V3 => [p.x, surfaceHeight(p, f.lift) + 0.012, p.z];
      asphalt.quad(y(pts[0], f1), y(pts[1], f1), y(pts[2], f2), y(pts[3], f2), [0, 1, 0], patchColour);
    }
  }
}

function addApproach(paint: ReturnType<BucketSet["get"]>, edge: NetEdge, sC: number, dir: number, carOuter: number, hasSidewalk: boolean): void {
  // Stop line 3 m beyond the crosswalk (further from the junction), across the carriageway.
  const sStop = sC + dir * 3.0;
  paintStrip(paint, edge, sStop - 0.25, sStop + 0.25, -carOuter, carOuter, 0, COLOUR.marking);
  if (!hasSidewalk) return;
  // Zebra: bars parallel to traffic, repeated across the carriageway.
  for (let o = -carOuter + 0.5; o <= carOuter - 0.5; o += 1.0) {
    paintStrip(paint, edge, sC - 1.4, sC + 1.4, o - 0.25, o + 0.25, 0, COLOUR.marking);
  }
}

// Junction polygons: asphalt or paving at node height, triangulated with the same corner points the roads use.
export function buildJunctionSurfaces(model: JunctionModel, buckets: BucketSet): void {
  for (const patch of model.patches) {
    const contour = patch.ring.map((p) => new THREE.Vector2(p.x, p.z));
    const faces = THREE.ShapeUtils.triangulateShape(contour, []);
    const target = patch.material === "asphalt" ? buckets.get("asphalt") : patch.material === "dirt" ? buckets.get("ground") : buckets.get("paving");
    const base = patch.material === "asphalt" ? COLOUR.asphalt : patch.material === "dirt" ? COLOUR.dirt : COLOUR.paving;
    const verts = patch.ring.map((p) => ({ x: p.x, z: p.z, y: surfaceHeight(p, patch.lift), c: shade(base, p.x, p.z, 0.1, 37) }));
    const flat: number[] = [];
    for (const f of faces) {
      // Enforce upward winding so lighting is correct on every triangle.
      const [a, b, c] = f;
      const A = verts[a];
      const B = verts[b];
      const C = verts[c];
      const ny = (B.z - A.z) * (C.x - A.x) - (B.x - A.x) * (C.z - A.z);
      if (ny >= 0) flat.push(a, b, c);
      else flat.push(a, c, b);
    }
    target.triangles(verts, flat);
  }
}

// Railway track: ballast bed, two rails and timber sleepers. Level crossings are placed by the prop builder.
export function buildRailTrack(edge: NetEdge, buckets: BucketSet): void {
  if (edge.underground) return;
  const core = buildCore(edge, new Map());
  const ballast = buckets.get("ground");
  const steel = buckets.get("steel");
  const timber = buckets.get("concrete");
  bandStrip(ballast, core, core.W, -core.W, 0, COLOUR.ballast, 0.08);
  for (const side of [-0.72, 0.72]) {
    for (let k = 0; k < core.frames.length - 1; k++) {
      const a = offsetPoint(core.frames[k], side - 0.07);
      const b = offsetPoint(core.frames[k], side + 0.07);
      const c = offsetPoint(core.frames[k + 1], side + 0.07);
      const d = offsetPoint(core.frames[k + 1], side - 0.07);
      const h = 0.16;
      const yTop = (p: P2, f: Frame): V3 => [p.x, surfaceHeight(p, f.lift) + h, p.z];
      const yBot = (p: P2, f: Frame): V3 => [p.x, surfaceHeight(p, f.lift) + 0.02, p.z];
      steel.quad(yTop(a, core.frames[k]), yTop(b, core.frames[k]), yTop(c, core.frames[k + 1]), yTop(d, core.frames[k + 1]), [0, 1, 0], COLOUR.steel);
      steel.quad(yBot(a, core.frames[k]), yBot(d, core.frames[k + 1]), yTop(d, core.frames[k + 1]), yTop(a, core.frames[k]), faceUp(core.frames[k], side), COLOUR.steel);
      steel.quad(yBot(b, core.frames[k]), yTop(b, core.frames[k]), yTop(c, core.frames[k + 1]), yBot(c, core.frames[k + 1]), faceUp(core.frames[k], -side), COLOUR.steelDark);
    }
  }
  const sleeperGap = 0.65;
  for (let s = 0.4; s < edge.length - 0.4; s += sleeperGap) {
    const f = frameAt(edge, s);
    const sA = offsetPoint(f, -1.6);
    const sB = offsetPoint(f, 1.6);
    const h0 = surfaceHeight(sA, f.lift) + 0.02;
    const h1 = surfaceHeight(sB, f.lift) + 0.1;
    const ax = f.tx * 0.12;
    const az = f.tz * 0.12;
    const pts: V3[] = [
      [sA.x - ax, h0, sA.z - az],
      [sB.x - ax, h1, sB.z - az],
      [sB.x + ax, h1, sB.z + az],
      [sA.x + ax, h0, sA.z + az]
    ];
    timber.quad(pts[0], pts[1], pts[2], pts[3], [0, 1, 0], COLOUR.concreteDark);
  }
}

function faceUp(f: Frame, side: number): V3 {
  return [f.nx * Math.sign(side), 0, f.nz * Math.sign(side)];
}

// Subway: a ghost tube along the line, drawn underground, plus a surface marker at each end.
export function buildSubwayTube(edge: NetEdge, buckets: BucketSet): void {
  if (!edge.underground) return;
  const bucket = buckets.get("tunnel");
  const r = 3.0;
  const sides = 10;
  const frames: Frame[] = [];
  const count = Math.max(2, Math.ceil(edge.length / 4) + 1);
  for (let k = 0; k < count; k++) frames.push(frameAt(edge, (edge.length * k) / (count - 1)));
  for (let k = 0; k < frames.length - 1; k++) {
    const a = frames[k];
    const b = frames[k + 1];
    for (let j = 0; j < sides; j++) {
      const a0 = (j / sides) * Math.PI * 2;
      const a1 = ((j + 1) / sides) * Math.PI * 2;
      const ring = (f: Frame, ang: number): V3 => {
        const up = Math.sin(ang) * r;
        const side = Math.cos(ang) * r;
        const x = f.x + f.nx * side;
        const z = f.z + f.nz * side;
        return [x, terrainHeight(x, z) + f.lift + up, z];
      };
      const p0 = ring(a, a0);
      const p1 = ring(a, a1);
      const p2 = ring(b, a1);
      const p3 = ring(b, a0);
      // Outward normal of the tube ring at the middle of this facet.
      const mid = (a0 + a1) / 2;
      const outward: V3 = [a.nx * Math.cos(mid), Math.sin(mid), a.nz * Math.cos(mid)];
      bucket.quad(p0, p1, p2, p3, outward, COLOUR.tunnel, COLOUR.tunnel, COLOUR.tunnel, COLOUR.tunnel);
    }
  }
}

export function nodeDegreeMap(net: RoadNetwork): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of net.nodes) m.set(n.id, n.incident.length);
  return m;
}

