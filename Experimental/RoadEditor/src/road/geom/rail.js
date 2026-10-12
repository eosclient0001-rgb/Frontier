// Railway geometry on graph edges.
//   mainline  - ballasted track, sleepers, rails, catenary, fences, bridges, level crossings
//               (rubber panels, gates, crossbuck signals, RXR markings, stop lines)
//   monorail  - suspended monorail: a box-girder beam on pillars, running above the streets
// Trains are animated elsewhere (render/trains.js); this file only builds the static track.
import { Out, ribbon, sweep, wall, box, yawFor } from './out.js';
import { getProfile, layout, LEVEL } from '../profiles.js';
import { decal, bar } from './markings.js';
import { segIntersect } from '../math.js';
import { quad } from './tri.js';

const GAUGE = 1.435;
export const TRACK_SPACING = 4.2;
const GROUNDY = -0.06;
const MONO_BEAM_TOP = 0;          // beam top is the edge's deck height
const MONO_BEAM_BOTTOM = -1.6;    // beam underside, relative to the deck
const MONO_PILLAR_SPACING = 24;

// Entry point used by the builder for any railway edge.
export function buildRailEdge(net, edge, JA, JB, ctx, index) {
  const prof = getProfile(edge);
  const c = net.centerline(edge);
  if (prof.railKind === 'monorail') return buildMonorail(net, edge, c, JA, JB, ctx);
  const crossings = findCrossings(net, edge, c, index);
  return buildMainline(net, edge, c, crossings, ctx, prof, JA, JB);
}

// Find at-grade crossings between a railway edge and road edges (other railways are ignored).
export function findCrossings(net, rail, rc, index) {
  const res = [];
  const X = rc.X, Z = rc.Z, S = rc.S;
  const step = 6;
  const seen = new Set();
  for (let i = 0; i < X.length - 1; i += step) {
    const j = Math.min(X.length - 1, i + step);
    const cand = index.query((X[i] + X[j]) / 2, (Z[i] + Z[j]) / 2, 20);
    for (const e of cand) {
      if (e.id === rail.id || net.isRail(e)) continue;
      const c = net.centerline(e);
      for (let k = 0; k < c.X.length - 1; k += 3) {
        const k2 = Math.min(c.X.length - 1, k + 3);
        const hit = segIntersect(X[i], Z[i], X[j], Z[j], c.X[k], c.Z[k], c.X[k2], c.Z[k2]);
        if (!hit) continue;
        const sR = S[i] + (S[j] - S[i]) * hit[0], sE = c.S[k] + (c.S[k2] - c.S[k]) * hit[1];
        const key = e.id + ':' + Math.round(sE / 5);
        if (seen.has(key)) continue; seen.add(key);
        const fe = c.frameAt(sE);
        if (fe.y > 2.5) continue;                       // road bridges over the rail
        const fr = rc.frameAt(sR);
        const cos = Math.abs(fe.tx * fr.tx + fe.tz * fr.tz);
        res.push({ edgeId: e.id, sRail: sR, sEdge: sE, sin: Math.sqrt(Math.max(0.05, 1 - cos * cos)), half: layout(getProfile(e)).total / 2 });
      }
    }
  }
  return res.sort((a, b) => a.sRail - b.sRail);
}

export function buildMainline(net, rail, rc, crossings, ctx, prof, JA, JB) {
  const out = new Out(rail.id);
  const tracks = prof.tracks || 2;
  const offs = tracks === 1 ? [0] : Array.from({ length: tracks }, (_, k) => (k - (tracks - 1) / 2) * TRACK_SPACING);
  const W = (tracks - 1) * TRACK_SPACING + 3.2;           // ballast top width
  const zones = crossings.map(x => { const h = x.half / x.sin + 2.5; return [x.sRail - h, x.sRail + h]; });
  const inCross = s => zones.some(([a, b]) => s > a && s < b);
  const RAIL_TOP = 0.42;
  // rail-top height profile: flush with road at crossings, ramps of 16 m.
  const yAt = s => {
    let y = RAIL_TOP;
    for (const [a, b] of zones) {
      if (s > a && s < b) return 0.025;
      const d = s < a ? a - s : s - b;
      if (d < 16) y = Math.min(y, 0.025 + (RAIL_TOP - 0.025) * (d / 16));
    }
    const w = ctx.waterAt && ctx.waterAt(rc.frameAt(s).x, rc.frameAt(s).z);
    return w ? Math.max(y, 0.9) : y;
  };
  const extra = zones.flatMap(([a, b]) => [a - 16, a, b, b + 16]);
  const st = rc.stations(0, rc.length, extra, 10, 0.03);
  const frames = st.map(s => { const f = rc.frameAt(s); f.y = yAt(s); return f; });
  // ballast prism
  const half = W / 2;
  ribbon(out, 'ballast', frames, -half, half, -0.2);
  for (const side of [-1, 1]) {
    const pc = out.piece('ballast'), base = pc.p.length / 3;
    for (const f of frames) {
      const yt = f.y - 0.2, run = 0.6 + Math.max(0, yt - GROUNDY) * 1.6;
      const a = side * half, b = side * (half + run);
      out.vert(pc, f.x + f.nx * a, yt, f.z + f.nz * a, a, f.s);
      out.vert(pc, f.x + f.nx * b, GROUNDY - 0.02, f.z + f.nz * b, b, f.s);
    }
    for (let k = 0; k < frames.length - 1; k++) {
      const t0 = base + k * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
      if (side > 0) pc.i.push(t0, b0, t1, b0, b1, t1); else pc.i.push(t0, t1, b0, b0, t1, b1);
    }
  }
  for (const o of offs) {
    for (const g of [-GAUGE / 2, GAUGE / 2]) {
      const oc = o + g;
      sweep(out, 'steel', frames, [[0.035, -0.16], [0.035, -0.01], [0.02, 0], [-0.02, 0], [-0.035, -0.01], [-0.035, -0.16]], oc);
    }
  }
  // sleepers + catenary + fence
  let lastMast = -999;
  for (let s = 0.4; s < rc.length; s += 0.65) {
    if (inCross(s)) continue;
    const f = rc.frameAt(s), y = yAt(s);
    for (const o of offs) out.prop('sleeper', f.x + f.nx * o, f.y + y - 0.29, f.z + f.nz * o, yawFor(f.nx, f.nz));
    if (s - lastMast > 55 && !(ctx.waterAt && ctx.waterAt(f.x, f.z))) {
      lastMast = s;
      const o = -half - 1.0;
      const yaw = yawFor(f.nx, f.nz);
      out.prop('catenaryMast', f.x + f.nx * o, f.y + y - 0.4, f.z + f.nz * o, yaw);
      out.prop('catenaryArm', f.x + f.nx * o, f.y + y + 6.2, f.z + f.nz * o, yaw, W + 1.6, 1, 1);
    }
  }
  // fences (not at crossings or on bridges)
  const fenceRuns = [];
  let cur = [];
  for (const f of frames) {
    const ok = !zones.some(([a, b]) => f.s > a - 10 && f.s < b + 10) && !(ctx.waterAt && ctx.waterAt(f.x, f.z));
    if (ok) cur.push(f); else { if (cur.length > 1) fenceRuns.push(cur); cur = []; }
  }
  if (cur.length > 1) fenceRuns.push(cur);
  for (const run of fenceRuns) for (const side of [-1, 1]) {
    const o = side * (half + 3.2);
    const flat = run.map(f => ({ ...f, y: 0 }));
    wall(out, 'fence', flat, o, GROUNDY, 1.9, side);
    wall(out, 'fence', flat, o, GROUNDY, 1.9, -side);
    for (let s = run[0].s; s < run[run.length - 1].s; s += 3) { const f = rc.frameAt(s); out.prop('fencePost', f.x + f.nx * o, GROUNDY, f.z + f.nz * o, 0); }
  }
  // bridge over water: girders + piers
  const wet = frames.filter(f => ctx.waterAt && ctx.waterAt(f.x, f.z));
  if (wet.length > 1) {
    const s0 = wet[0].s - 8, s1 = wet[wet.length - 1].s + 8;
    const bf = rc.stations(s0, s1, [], 6).map(s => { const f = rc.frameAt(s); f.y = yAt(s); return f; });
    ribbon(out, 'concrete', bf, half + 1.4, -half - 1.4, -1.3);
    for (const side of [-1, 1]) {
      const o = side * (half + 1.4);
      wall(out, 'girder', bf, o, -1.3, 1.6, side);
      wall(out, 'girder', bf, o - side * 0.4, -1.3, 1.6, -side);
      sweep(out, 'girder', bf, side > 0 ? [[0, 1.6], [-0.4, 1.6]] : [[0.4, 1.6], [0, 1.6]], o);
    }
    for (let s = s0 + 20; s < s1 - 10; s += 30) {
      const f = rc.frameAt(s);
      out.prop('pierColWide', f.x, -6, f.z, yawFor(f.tx, f.tz), 1.3, yAt(s) - 1.3 + 6 - 1.0, 1.3);
      out.prop('pierCap', f.x, yAt(s) - 1.3 - 1.0, f.z, yawFor(f.nx, f.nz), W + 3, 1.0, 1.6);
    }
  }
  // level crossings
  for (const x of crossings) crossing(out, net, rail, rc, x, offs, half);
  // buffer stops at dead ends
  for (const [J, s, dir] of [[JA, 0, 1], [JB, rc.length, -1]]) {
    if (!J || J.kind !== 'railEnd') continue;
    const f = rc.frameAt(s);
    box(out, 'concrete', f.x + f.tx * dir * 1.2, GROUNDY + 0.4, f.z + f.tz * dir * 1.2, f.tx, f.tz, 0.6, half + 0.4, 0.4);
  }
  return out;
}

// ------------------------------------------------------------------ monorail
// Suspended monorail: a box-girder beam carried on pillars. Track sits inside the beam and the
// cars hang beneath it, so nothing runs on top apart from the decorative rail heads.
function buildMonorail(net, edge, c, JA, JB, ctx) {
  const out = new Out(edge.id);
  const L = c.length;
  const stations = c.stations(0, L, [], 10, 0.03);
  const fr = stations.map(s => c.frameAt(s));
  const deck = fr.map(f => f.y);
  // beam cross-section as a closed outline in (o, h) relative to the deck, counter-clockwise
  const outline = [[-0.7, MONO_BEAM_TOP], [-0.7, -1.2], [-0.22, MONO_BEAM_BOTTOM], [0.22, MONO_BEAM_BOTTOM], [0.7, -1.2], [0.7, MONO_BEAM_TOP]];
  const at = (f, o, h, yd) => [f.x + f.nx * o, yd + h, f.z + f.nz * o];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const mo = (a[0] + b[0]) / 2, mh = (a[1] + b[1]) / 2;
    const cen = [0, -0.8];
    const dO = mo - cen[0], dH = mh - cen[1], dl = Math.hypot(dO, dH) || 1;
    for (let k = 0; k < fr.length - 1; k++) {
      const f0 = fr[k], f1 = fr[k + 1];
      const want0 = [f0.nx * dO / dl, dH / dl, f0.nz * dO / dl], want1 = [f1.nx * dO / dl, dH / dl, f1.nz * dO / dl];
      const want = [(want0[0] + want1[0]) / 2, (want0[1] + want1[1]) / 2, (want0[2] + want1[2]) / 2];
      quad(out, 'girder', at(f0, a[0], a[1], deck[k]), at(f0, b[0], b[1], deck[k]),
        at(f1, b[0], b[1], deck[k + 1]), at(f1, a[0], a[1], deck[k + 1]), want);
    }
  }
  // decorative rail heads along the beam's top
  for (const o of [-0.3, 0.3]) ribbon(out, 'steel', fr.map((f, k) => ({ ...f, y: deck[k] })), o - 0.04, o + 0.04, MONO_BEAM_TOP + 0.01);
  // beam end caps at dead ends
  for (const [J, i, dir] of [[JA, 0, 1], [JB, fr.length - 1, -1]]) {
    if (!J || J.kind !== 'railEnd') continue;
    const f = fr[i];
    box(out, 'girder', f.x + f.tx * dir * 0.4, deck[i] - 0.8, f.z + f.tz * dir * 0.4, f.tx, f.tz, 0.4, 0.7, 0.8);
  }
  // pillars at regular spacing and at both ends; a spot blocked by a road or another line is
  // nudged along the beam, and skipped if no nearby position is clear
  const spots = [1.5, L - 1.5];
  for (let s = MONO_PILLAR_SPACING / 2; s < L - 4; s += MONO_PILLAR_SPACING) spots.push(s);
  for (const s of spots) {
    const f = c.frameAt(s), y = f.y + MONO_BEAM_BOTTOM;
    const g = ctx.groundAt(f.x, f.z);
    for (const shift of [0, 3, -3, 6, -6]) {
      const fs = c.frameAt(Math.max(0.5, Math.min(L - 0.5, s + shift)));
      if (ctx.pierBlocked && ctx.pierBlocked(fs.x, fs.z, 0.9, f.y, edge.id)) continue;
      out.prop('pierCol', fs.x, g, fs.z, yawFor(fs.tx, fs.tz), 0.75, Math.max(1, y - g), 0.75);
      out.prop('pierCap', fs.x, y - 0.9, fs.z, yawFor(fs.tx, fs.tz), 1.8, 0.9, 1.3);
      break;
    }
  }
  return out;
}

function crossing(out, net, rail, rc, x, offs, half) {
  const e = net.edges.get(x.edgeId); if (!e) return;
  const c = net.centerline(e), lay = layout(getProfile(e));
  // rubber panels across the full road width around each track
  const roadHalf = x.half / x.sin + 1.5;
  const fs = [-roadHalf, roadHalf].map(d => { const f = rc.frameAt(x.sRail + d); f.y = c.frameAt(x.sEdge).y; return f; });
  for (const o of offs) ribbon(out, 'crossPanel', fs, o - GAUGE / 2 - 0.55, o + GAUGE / 2 + 0.55, 0.006);
  // gates, signals and markings on each approach
  const railHalf = half + 0.5;
  for (const dir of [-1, 1]) {
    // dir = +1 → approach from smaller s (traffic moving +s, lanes dir +1 on right side)
    const dS = (railHalf / x.sin) + 3.0;
    const sGate = x.sEdge - dir * dS;
    if (sGate < 2 || sGate > c.length - 2) continue;
    const f = c.frameAt(sGate);
    const side = dir;                                    // right side of travel for +s is +n
    const curb = side > 0 ? lay.curbR : lay.curbL;
    const has = side > 0 ? lay.hasCurbR : lay.hasCurbL;
    const o = curb + side * (has ? 0.8 : 1.6);
    const y = f.y + (has ? LEVEL.raised : 0);
    const px = f.x + f.nx * o, pz = f.z + f.nz * o;
    const toward = -side;
    out.prop('crossbuck', px, y, pz, yawFor(-f.tx * dir, -f.tz * dir));
    // Half-barriers: the span from the post to the centreline is broken into <= 7 m arms, each on its
    // own cabinet, so a wide carriageway still gets a barrier that closes it. Arm record is
    // [x,y,z,yaw,pitch,sx,sy,sz] with sx = length along local +x (inward), so pitch stays 0 = level.
    const ga = c.frameAt(sGate + dir * -0.9);
    const yawGate = yawFor(ga.nx * toward, ga.nz * toward);   // +x points from the curb toward the centre
    const span = Math.max(3.2, Math.abs(o) - 0.4);             // post → just short of the centreline
    const nSeg = Math.max(1, Math.ceil(span / 7));             // a real half-barrier is 4-7 m long
    const seg = span / nSeg;
    for (let k = 0; k < nSeg; k++) {
      const oo = o + toward * k * seg;                         // step inward along the normal
      out.prop('gatePost', ga.x + ga.nx * oo, y, ga.z + ga.nz * oo, yawGate);
      out.prop('gateArm', ga.x + ga.nx * oo, y + 1.05, ga.z + ga.nz * oo, yawGate, seg, 1, 1.35);
      out.prop('gateArm', ga.x + ga.nx * (oo - toward * 1.1), y + 1.05, ga.z + ga.nz * (oo - toward * 1.1), yawGate, 1.1, 0.8, 1.1);
    }
    // stop line + RXR markings on incoming lanes
    const inc = lay.lanes.filter(l => l.meta.traffic && ((l.dir || 0) === dir || (l.dir || 0) === 0));
    if (!inc.length) continue;
    const oMin = Math.min(...inc.map(l => l.o0)), oMax = Math.max(...inc.map(l => l.o1));
    const sStop = x.sEdge - dir * (dS + 1.8);
    if (sStop > 1 && sStop < c.length - 1) bar(out, 'markWhite', c, sStop, (oMin + oMax) / 2, 0.25, (oMax - oMin) / 2 - 0.05);
    const sR = x.sEdge - dir * (dS + 30);
    if (sR > 4 && sR < c.length - 4) for (const l of inc) if (l.type === 'drive') decal(out, 'rxr', c, sR, (l.o0 + l.o1) / 2, dir, 0);
    const sSign = x.sEdge - dir * (dS + 70);
    if (sSign > 2 && sSign < c.length - 2) { const g = c.frameAt(sSign); out.prop('signRail', g.x + g.nx * o, y, g.z + g.nz * o, yawFor(-g.tx * dir, -g.tz * dir)); }
  }
}
