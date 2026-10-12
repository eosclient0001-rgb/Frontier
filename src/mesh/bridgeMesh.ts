// Bridge structures for every raised deck span. Six structural families, each with its own support logic:
// girder, viaduct, arch, truss, cable-stayed and suspension. The deck itself is the road surface ribbon.

import { Rng } from "../core/math";
import { SpatialGrid } from "../core/spatial";
import { BridgeSpan, NetEdge } from "../core/topology";
import { BridgeType } from "../core/model";
import { surfaceHeight, terrainHeight, isOverRiver } from "../core/terrain";
import { BucketSet, MeshBucket, V3, normalise } from "./MeshBucket";
import { frameAt, Frame, offsetPoint } from "./frames";
import { COLOUR, shade } from "./palette";

export const DECK_THICKNESS = 1.3; // [m] - Structural depth below the road surface
export const PARAPET_HEIGHT = 0.9; // [m] - Parapet height above the deck

export interface Obstacle {
  x: number;
  z: number;
  r: number; // [m] - Half width of the road that occupies this point
}

export interface BridgeContext {
  ground: SpatialGrid<Obstacle>; // Ground-level road samples, used to keep piers out of other roads
}

// Chooses a structural family from span length and whether the deck crosses water.
// Cable-stayed and suspension decks only make sense as a single span over water. Long dry stretches of
// elevated road are continuous piered structures instead.
export function resolveBridgeType(requested: BridgeType, span: BridgeSpan, wet: boolean, rng: Rng): Exclude<BridgeType, "auto"> {
  if (requested !== "auto") return requested;
  if (span.length < 35) return rng.chance(0.6) ? "girder" : "viaduct";
  if (span.length < 80) return wet ? (rng.chance(0.5) ? "arch" : "truss") : rng.pick(["arch", "truss", "girder"] as const);
  if (!wet) return rng.pick(["viaduct", "girder", "truss"] as const);
  if (span.length < 200) return rng.pick(["truss", "cable-stayed"] as const);
  return rng.chance(0.6) ? "suspension" : "cable-stayed";
}

function pierSpacing(type: Exclude<BridgeType, "auto">): number {
  switch (type) {
    case "girder":
      return 28;
    case "viaduct":
      return 30;
    case "arch":
      return 40;
    case "truss":
      return 45;
    case "cable-stayed":
      return 60;
    case "suspension":
      return 0; // towers only
  }
}

function framesOver(edge: NetEdge, s0: number, s1: number, step: number): Frame[] {
  const count = Math.max(2, Math.ceil((s1 - s0) / step) + 1);
  const out: Frame[] = [];
  for (let k = 0; k < count; k++) out.push(frameAt(edge, s0 + ((s1 - s0) * k) / (count - 1)));
  return out;
}

function deckTop(f: Frame): number {
  return surfaceHeight({ x: f.x, z: f.z }, f.lift);
}

// Vertical wall along the deck at lateral offset o, between heights given by yLo / yHi per frame.
function wall(bucket: MeshBucket, frames: Frame[], o: number, yLo: (f: Frame) => number, yHi: (f: Frame) => number, sign: number, colour: [number, number, number]): void {
  for (let k = 0; k < frames.length - 1; k++) {
    const a = frames[k];
    const b = frames[k + 1];
    const pa = offsetPoint(a, o);
    const pb = offsetPoint(b, o);
    const n: V3 = [a.nx * sign, 0, a.nz * sign];
    bucket.quad(
      [pa.x, yLo(a), pa.z],
      [pa.x, yHi(a), pa.z],
      [pb.x, yHi(b), pb.z],
      [pb.x, yLo(b), pb.z],
      n,
      shade(colour, pa.x, pa.z, 0.04, 11),
      shade(colour, pa.x, pa.z, 0.04, 11),
      shade(colour, pb.x, pb.z, 0.04, 11),
      shade(colour, pb.x, pb.z, 0.04, 11)
    );
  }
}

// Box pier centred on a frame, from `yBottom` to `yTop`, with footprint along the road and across it.
function pierBox(bucket: MeshBucket, f: Frame, halfAlong: number, halfLat: number, yBottom: number, yTop: number, colour: [number, number, number], lateral = 0): void {
  const cx = f.x + f.nx * lateral;
  const cz = f.z + f.nz * lateral;
  const corners: V3[] = [];
  for (const yy of [yBottom, yTop]) {
    for (const [a, l] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1]
    ] as const) {
      corners.push([cx + f.tx * a * halfAlong + f.nx * l * halfLat, yy, cz + f.tz * a * halfAlong + f.nz * l * halfLat]);
    }
  }
  bucket.box(corners, colour);
}

// Round tube along a polyline. Used for cables, hangers, truss members and arch ribs.
export function tube(bucket: MeshBucket, pts: V3[], radius: number, colour: [number, number, number], sides = 6): void {
  if (pts.length < 2) return;
  const rings: { c: V3; side: V3; up: V3 }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const t = normalise([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const ref: V3 = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const side = normalise([t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]]);
    const up = normalise([side[1] * t[2] - side[2] * t[1], side[2] * t[0] - side[0] * t[2], side[0] * t[1] - side[1] * t[0]]);
    rings.push({ c: pts[i], side, up });
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a0 = (j / sides) * Math.PI * 2;
      const a1 = ((j + 1) / sides) * Math.PI * 2;
      const pt = (r: (typeof rings)[number], ang: number): V3 => [
        r.c[0] + radius * (Math.cos(ang) * r.side[0] + Math.sin(ang) * r.up[0]),
        r.c[1] + radius * (Math.cos(ang) * r.side[1] + Math.sin(ang) * r.up[1]),
        r.c[2] + radius * (Math.cos(ang) * r.side[2] + Math.sin(ang) * r.up[2])
      ];
      const mid = (a0 + a1) / 2;
      const nrm = normalise([
        Math.cos(mid) * rings[i].side[0] + Math.sin(mid) * rings[i].up[0],
        Math.cos(mid) * rings[i].side[1] + Math.sin(mid) * rings[i].up[1],
        Math.cos(mid) * rings[i].side[2] + Math.sin(mid) * rings[i].up[2]
      ]);
      bucket.quad(pt(rings[i], a0), pt(rings[i], a1), pt(rings[i + 1], a1), pt(rings[i + 1], a0), nrm, colour);
    }
  }
}

function pierClear(ctx: BridgeContext, x: number, z: number, halfWidth: number): boolean {
  const near = ctx.ground.queryBox(x - 12, z - 12, x + 12, z + 12);
  for (const o of near) {
    if (Math.hypot(o.x - x, o.z - z) < o.r + halfWidth + 1.2) return false;
  }
  return true;
}

export function buildBridge(edge: NetEdge, span: BridgeSpan, ctx: BridgeContext, buckets: BucketSet, rng: Rng): void {
  const concrete = buckets.get("concrete");
  const steel = buckets.get("steel");
  const W = edge.section.width * 0.5;
  const frames = framesOver(edge, span.s0, span.s1, 2);
  const wet = frames.some((f) => isOverRiver({ x: f.x, z: f.z }));
  const type = resolveBridgeType(edge.bridge, span, wet, rng);
  const L = span.s1 - span.s0;

  // Deck underside and side walls, parapets on both outer edges.
  const bottom = (f: Frame): number => deckTop(f) - DECK_THICKNESS;
  wall(concrete, frames, W, bottom, deckTop, 1, COLOUR.concrete);
  wall(concrete, frames, -W, bottom, deckTop, -1, COLOUR.concrete);
  wall(concrete, frames, W - 0.35, deckTop, (f) => deckTop(f) + PARAPET_HEIGHT, -1, COLOUR.curb);
  wall(concrete, frames, W, deckTop, (f) => deckTop(f) + PARAPET_HEIGHT, 1, COLOUR.curb);
  wall(concrete, frames, -W + 0.35, deckTop, (f) => deckTop(f) + PARAPET_HEIGHT, 1, COLOUR.curb);
  wall(concrete, frames, -W, deckTop, (f) => deckTop(f) + PARAPET_HEIGHT, -1, COLOUR.curb);
  for (let k = 0; k < frames.length - 1; k++) {
    const a = frames[k];
    const b = frames[k + 1];
    // Parapet caps (top surface of each parapet strip).
    for (const side of [1, -1]) {
      const yA = deckTop(a) + PARAPET_HEIGHT;
      const yB = deckTop(b) + PARAPET_HEIGHT;
      const outerA = offsetPoint(a, side * W);
      const innerA = offsetPoint(a, side * (W - 0.35));
      const innerB = offsetPoint(b, side * (W - 0.35));
      const outerB = offsetPoint(b, side * W);
      concrete.quad([outerA.x, yA, outerA.z], [innerA.x, yA, innerA.z], [innerB.x, yB, innerB.z], [outerB.x, yB, outerB.z], [0, 1, 0], COLOUR.curb);
    }
    // Underside
    const ua = offsetPoint(a, -W);
    const ub = offsetPoint(b, -W);
    const va = offsetPoint(a, W);
    const vb = offsetPoint(b, W);
    concrete.quad([ua.x, bottom(a), ua.z], [va.x, bottom(a), va.z], [vb.x, bottom(b), vb.z], [ub.x, bottom(b), ub.z], [0, -1, 0], COLOUR.concreteDark);
  }

  // Station list for supports.
  const spacing = pierSpacing(type);
  const stations: number[] = [];
  if (spacing > 0) {
    for (let s = span.s0 + spacing / 2; s <= span.s1 - spacing / 2 + 0.01; s += spacing) stations.push(s);
  }

  if (type === "girder" || type === "viaduct") {
    for (const s of stations) {
      const f = frameAt(edge, s);
      const base = terrainHeight(f.x, f.z) - 0.5;
      const top = deckTop(f) - DECK_THICKNESS;
      if (top - base < 1.2) continue;
      if (!pierClear(ctx, f.x, f.z, 1.4)) continue;
      for (const side of [-1, 1]) pierBox(concrete, f, 1.0, 0.9, base, top, COLOUR.concreteDark, side * (W - 1.6));
      if (type === "viaduct") pierBox(concrete, f, 1.2, W - 0.2, top - 1.6, top, COLOUR.concrete);
    }
  } else if (type === "arch") {
    const spring = (f: Frame): number => deckTop(f) - DECK_THICKNESS - 2.8;
    for (let i = 0; i < stations.length; i++) {
      const f = frameAt(edge, stations[i]);
      const base = terrainHeight(f.x, f.z) - 0.5;
      if (!pierClear(ctx, f.x, f.z, 2.4)) continue;
      pierBox(concrete, f, 1.6, W - 0.4, base, spring(f), COLOUR.concreteDark);
    }
    const bays = [span.s0, ...stations, span.s1];
    for (let i = 0; i < bays.length - 1; i++) {
      const sa = bays[i];
      const sb = bays[i + 1];
      if (sb - sa < 8) continue;
      const pts: V3[] = [];
      const pts2: V3[] = [];
      const N = 12;
      for (let k = 0; k <= N; k++) {
        const u = k / N;
        const s = sa + (sb - sa) * u;
        const f = frameAt(edge, s);
        const springY = spring(f);
        const crown = deckTop(f) - DECK_THICKNESS - 0.8;
        const y = springY + (crown - springY) * 4 * u * (1 - u);
        const p1 = offsetPoint(f, W - 0.9);
        const p2 = offsetPoint(f, -(W - 0.9));
        pts.push([p1.x, y, p1.z]);
        pts2.push([p2.x, y, p2.z]);
        if (k % 2 === 0 && k > 0 && k < N) {
          // Spandrel columns carry the deck from the rib.
          const dk = deckTop(f) - DECK_THICKNESS;
          tube(steel, [[p1.x, y, p1.z], [p1.x, dk, p1.z]], 0.25, COLOUR.concreteDark, 5);
          tube(steel, [[p2.x, y, p2.z], [p2.x, dk, p2.z]], 0.25, COLOUR.concreteDark, 5);
        }
      }
      tube(concrete, pts, 0.6, COLOUR.concrete, 8);
      tube(concrete, pts2, 0.6, COLOUR.concrete, 8);
    }
  } else if (type === "truss") {
    const chordY = (f: Frame): number => deckTop(f) + 4.2;
    for (const s of stations) {
      const f = frameAt(edge, s);
      const base = terrainHeight(f.x, f.z) - 0.5;
      if (!pierClear(ctx, f.x, f.z, 1.4)) continue;
      const top = deckTop(f) - DECK_THICKNESS;
      for (const side of [-1, 1]) pierBox(concrete, f, 1.4, 1.1, base, top, COLOUR.concreteDark, side * (W - 0.9));
    }
    const panel = 6;
    for (const side of [-1, 1]) {
      const lat = side * (W - 0.5);
      const topPts: V3[] = [];
      const botPts: V3[] = [];
      for (let s = span.s0; s <= span.s1 + 0.01; s += 1.5) {
        const f = frameAt(edge, Math.min(s, span.s1));
        const p = offsetPoint(f, lat);
        topPts.push([p.x, chordY(f), p.z]);
        botPts.push([p.x, deckTop(f) - 0.2, p.z]);
      }
      tube(steel, topPts, 0.2, COLOUR.steel, 6);
      tube(steel, botPts, 0.2, COLOUR.steel, 6);
      for (let s = span.s0; s <= span.s1 + 0.01; s += panel) {
        const f = frameAt(edge, Math.min(s, span.s1));
        const p = offsetPoint(f, lat);
        tube(steel, [[p.x, deckTop(f) - 0.2, p.z], [p.x, chordY(f), p.z]], 0.16, COLOUR.steelDark, 5);
        const s2 = Math.min(s + panel, span.s1);
        const f2 = frameAt(edge, s2);
        const q = offsetPoint(f2, lat);
        tube(steel, [[p.x, deckTop(f) - 0.2, p.z], [q.x, chordY(f2), q.z]], 0.14, COLOUR.steelDark, 5);
      }
    }
    for (let s = span.s0; s <= span.s1 + 0.01; s += panel) {
      const f = frameAt(edge, Math.min(s, span.s1));
      const a = offsetPoint(f, W - 0.5);
      const b = offsetPoint(f, -(W - 0.5));
      tube(steel, [[a.x, chordY(f), a.z], [b.x, chordY(f), b.z]], 0.16, COLOUR.steelDark, 5);
    }
  } else if (type === "cable-stayed") {
    const pylonS = L > 240 ? [span.s0 + L / 3, span.s0 + (2 * L) / 3] : [span.s0 + L / 2];
    for (const ps of pylonS) {
      const f = frameAt(edge, ps);
      const base = terrainHeight(f.x, f.z) - 0.5;
      const top = deckTop(f) + 34 + rng.range(-2, 3);
      const apex = { x: f.x, z: f.z };
      for (const side of [-1, 1]) {
        const leg = offsetPoint(f, side * (W + 0.8));
        tube(concrete, [[leg.x, base, leg.z], [apex.x, top, apex.z]], 1.0, COLOUR.concrete, 8);
      }
      for (let s = ps - 12; s <= ps + 12; s += 12) {
        const g = frameAt(edge, s);
        const legA = offsetPoint(g, W + 0.6);
        const legB = offsetPoint(g, -(W + 0.6));
        tube(concrete, [[legA.x, deckTop(g) + 0.2, legA.z], [legB.x, deckTop(g) + 0.2, legB.z]], 0.5, COLOUR.concrete, 6);
      }
      // Fan of stays from the apex to the deck on both sides.
      for (let s = span.s0 + 6; s <= span.s1 - 6; s += 8) {
        if (Math.abs(s - ps) < 10) continue;
        const g = frameAt(edge, s);
        for (const side of [-1, 1]) {
          const anchor = offsetPoint(g, side * (W - 0.6));
          tube(steel, [[apex.x, top - 0.6, apex.z], [anchor.x, deckTop(g) + 0.25, anchor.z]], 0.1, COLOUR.steel, 5);
        }
      }
    }
    for (const s of stations) {
      if (pylonS.some((ps) => Math.abs(ps - s) < 14)) continue;
      const f = frameAt(edge, s);
      const base = terrainHeight(f.x, f.z) - 0.5;
      if (!pierClear(ctx, f.x, f.z, 1.4)) continue;
      pierBox(concrete, f, 1.2, W - 0.4, base, deckTop(f) - DECK_THICKNESS, COLOUR.concreteDark);
    }
  } else if (type === "suspension") {
    const towerS = [span.s0 + L * 0.25, span.s0 + L * 0.75];
    const towerTop = (f: Frame): number => deckTop(f) + 36;
    const towerFrames = towerS.map((s) => frameAt(edge, s));
    towerFrames.forEach((f) => {
      const base = terrainHeight(f.x, f.z) - 0.5;
      for (const side of [-1, 1]) pierBox(concrete, f, 1.8, 1.8, base, towerTop(f), COLOUR.concrete, side * (W - 0.9));
      const bar1 = offsetPoint(f, W - 0.9);
      const bar2 = offsetPoint(f, -(W - 0.9));
      tube(concrete, [[bar1.x, towerTop(f) - 6, bar1.z], [bar2.x, towerTop(f) - 6, bar2.z]], 0.5, COLOUR.concrete, 6);
      tube(concrete, [[bar1.x, towerTop(f) - 16, bar1.z], [bar2.x, towerTop(f) - 16, bar2.z]], 0.5, COLOUR.concrete, 6);
    });
    for (const side of [-1, 1]) {
      const lat = side * (W - 0.8);
      const anchorA = offsetPoint(frameAt(edge, span.s0), lat);
      const anchorB = offsetPoint(frameAt(edge, span.s1), lat);
      const t1 = offsetPoint(towerFrames[0], lat);
      const t2 = offsetPoint(towerFrames[1], lat);
      const yTop1 = towerTop(towerFrames[0]);
      const yTop2 = towerTop(towerFrames[1]);
      const cable: V3[] = [];
      cable.push([anchorA.x, deckTop(frameAt(edge, span.s0)) + 1.0, anchorA.z]);
      cable.push([t1.x, yTop1, t1.z]);
      const mainSpan = 24;
      for (let k = 1; k < mainSpan; k++) {
        const u = k / mainSpan;
        const x = t1.x + (t2.x - t1.x) * u;
        const z = t1.z + (t2.z - t1.z) * u;
        const sag = 0.06 * Math.hypot(t2.x - t1.x, t2.z - t1.z);
        const y = yTop1 + (yTop2 - yTop1) * u - sag * 4 * u * (1 - u);
        cable.push([x, y, z]);
      }
      cable.push([t2.x, yTop2, t2.z]);
      cable.push([anchorB.x, deckTop(frameAt(edge, span.s1)) + 1.0, anchorB.z]);
      tube(steel, cable, 0.24, COLOUR.steelDark, 6);
      // Hangers between the towers.
      for (let s = towerS[0] + 8; s < towerS[1] - 6; s += 9) {
        const f = frameAt(edge, s);
        const p = offsetPoint(f, lat);
        const u = (s - towerS[0]) / (towerS[1] - towerS[0]);
        const cy = yTop1 + (yTop2 - yTop1) * u - 0.06 * Math.hypot(t2.x - t1.x, t2.z - t1.z) * 4 * u * (1 - u);
        tube(steel, [[p.x, deckTop(f), p.z], [p.x, cy, p.z]], 0.07, COLOUR.steel, 4);
      }
    }
  }
}
