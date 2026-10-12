// Straddle-beam monorail ("people mover on a bridge beam") — piers, beam, guideway rails,
// and a static straddle-beam train car. Built on a dense centerline like the existing rail.
import { Centerline } from '../centerline.js';
import { Out, ribbon, wall, sweep, box, yawFor } from './out.js';
import { getProfile, layout, LEVEL } from '../profiles.js';
import { findCrossings } from './rail.js';

// Straddle-beam monorails share their gauge with the existing 1.435 m rail but ride ABOVE
// the guideway beam (≈1.2 m wide, 1.5 m tall) instead of inside it. The train is a
// rectangular car body that straddles the beam (the wheels ride along the rails cast into
// each side of the top of the beam). The straddle clearance is wide enough to clear a
// two-lane road underneath.
export const MONO_BEAM_W = 1.2;        // beam width (cross direction)
export const MONO_BEAM_H = 1.5;        // beam height (top of guideway to underside of train)
export const MONO_BEAM_UNDERY = 0.6;   // depth of beam below the top (visual thickness)
export const MONO_PIER_HALF = 1.4;     // pier cap half-extent along travel
export const MONO_PIER_W = 1.6;        // pier column width
export const MONO_TRACK_SPACING = 4.2; // center-to-center of two parallel monorail beams
export const MONO_CAR_LEN = 16;        // car body length
export const MONO_CAR_W = 3.0;         // car body width (slightly wider than beam)
export const MONO_CAR_H = 3.0;         // car body height
export const MONO_CAR_CLEAR = 0.4;     // gap from beam top to underside of car

export function monoCenterline(rail) {
  return new Centerline(rail.pts.map(p => ({ x: p.x, z: p.z })));
}

// Find places where the elevated rail crosses an edge that's a normal road, so we can
// paint a "shadow" / underpass band on the road below.
export function findUnderpasses(net, rail, rc, index) {
  const res = [];
  const X = rc.X, Z = rc.Z, S = rc.S;
  const step = 8;
  const seen = new Set();
  for (let i = 0; i < X.length - 1; i += step) {
    const j = Math.min(X.length - 1, i + step);
    const cand = index.query((X[i] + X[j]) / 2, (Z[i] + Z[j]) / 2, 20);
    for (const e of cand) {
      const c = net.centerline(e);
      for (let k = 0; k < c.X.length - 1; k += 4) {
        const k2 = Math.min(c.X.length - 1, k + 4);
        const hit = segIntersect(X[i], Z[i], X[j], Z[j], c.X[k], c.Z[k], c.X[k2], c.Z[k2]);
        if (!hit) continue;
        const sR = S[i] + (S[j] - S[i]) * hit[0], sE = c.S[k] + (c.S[k2] - c.S[k]) * hit[1];
        const key = e.id + ':' + Math.round(sE / 4);
        if (seen.has(key)) continue; seen.add(key);
        const fe = c.frameAt(sE);
        const fr = rc.frameAt(sR);
        const cos = Math.abs(fe.tx * fr.tx + fe.tz * fr.tz);
        res.push({ edgeId: e.id, sRail: sR, sEdge: sE, sin: Math.sqrt(Math.max(0.05, 1 - cos * cos)), half: layout(getProfile(e)).total / 2 });
      }
    }
  }
  return res.sort((a, b) => a.sRail - b.sRail);
}

function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-10) return null;
  const qx = cx - ax, qz = cz - az;
  const t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return [t, u];
}

export function buildElevatedRail(net, rail, rc, ctx) {
  const out = new Out(rail.id);
  const tracks = rail.tracks || 1;
  const offs = tracks === 1 ? [0] : Array.from({ length: tracks }, (_, k) => (k - (tracks - 1) / 2) * MONO_TRACK_SPACING);
  const W = (tracks - 1) * MONO_TRACK_SPACING + MONO_BEAM_W + 1.6;
  const zones = (ctx.underpasses || []).map(x => { const h = x.half / x.sin + 1.5; return [x.sRail - h, x.sRail + h]; });
  // Beam top is at +MONO_BEAM_UNDERY; car floor is MONO_BEAM_H above the beam top
  const BEAM_TOP = MONO_BEAM_UNDERY;
  const CAR_FLOOR = BEAM_TOP + MONO_BEAM_H;
  const CAR_TOP = CAR_FLOOR + MONO_CAR_H;
  const yAt = s => {
    let y = BEAM_TOP;
    for (const [a, b] of zones) {
      if (s > a && s < b) y = BEAM_TOP - 0.1;     // a flat section through the underpass
    }
    return y;
  };
  const extra = zones.flatMap(([a, b]) => [a - 12, a, b, b + 12]);
  const st = rc.stations(0, rc.length, extra, 10, 0.03);
  const frames = st.map(s => { const f = rc.frameAt(s); f.y = yAt(s); return f; });

  // --- guideway beam per track
  for (const o of offs) {
    // beam slab: rectangular box from -half (sideways) to +half, MONO_BEAM_UNDERY deep
    const hw = MONO_BEAM_W / 2;
    ribbon(out, 'concrete', frames, o - hw, o + hw, 0);          // beam top surface
    ribbon(out, 'concrete', frames, o + hw, o - hw, -MONO_BEAM_UNDERY); // bottom (downward)
    wall(out, 'concrete', frames, o - hw, -MONO_BEAM_UNDERY, 0, -1);
    wall(out, 'concrete', frames, o + hw, -MONO_BEAM_UNDERY, 0, +1);
    // guideway rails on the top edges of the beam (steel strips) — visualizes the contact rails
    sweep(out, 'steel', frames, [[-hw + 0.05, 0.02], [-hw + 0.05, 0.08], [-hw + 0.10, 0.08], [-hw + 0.10, 0.02], [-hw + 0.05, 0.02]], o);
    sweep(out, 'steel', frames, [[hw - 0.10, 0.02], [hw - 0.10, 0.08], [hw - 0.05, 0.08], [hw - 0.05, 0.02], [hw - 0.10, 0.02]], o);
  }

  // --- piers: spaced at ~28 m, single pier if 1 track, twin piers if 2 tracks.
  const spacing = 28;
  const s0 = frames[0].s, s1 = frames[frames.length - 1].s;
  for (let s = s0 + spacing * 0.5; s < s1 - 4; s += spacing) {
    let placed = false;
    for (const shift of [0, 6, -6, 11, -11, 17, -17]) {
      const ss = s + shift; if (ss < s0 + 3 || ss > s1 - 3) continue;
      const f = rc.frameAt(ss);
      const w = ctx.waterAt && ctx.waterAt(f.x, f.z);
      const gy = w ? -6 : -0.06;
      const capTop = f.y;
      const colTop = capTop - MONO_BEAM_UNDERY;
      if (colTop - gy < 1.2) continue;
      // block where there's a road or junction polygon below
      let blocked = false;
      for (const e of ctx._roadQuery ? ctx._roadQuery(f.x, f.z, MONO_PIER_W + 1.5) : []) { const c = net.centerline(e); const q = c.nearest(f.x, f.z); if (q.d < layout(getProfile(e)).total / 2 + MONO_PIER_W) blocked = true; }
      if (blocked) continue;
      // pier cap (slab on top of piers)
      for (const o of offs) {
        box(out, 'concrete', f.x + f.nx * o, capTop - 0.1, f.z + f.nz * o, f.tx, f.tz, MONO_PIER_HALF, MONO_BEAM_W / 2 + 0.2, 0.1);
        box(out, 'concrete', f.x + f.nx * o, capTop - 1.4, f.z + f.nz * o, f.tx, f.tz, MONO_PIER_W / 2, MONO_PIER_W / 2, colTop - gy - 0.1);
      }
      placed = true; break;
    }
    if (!placed) continue;
  }

  // --- underpass shadow on the road: a single dark ribbon at the underpass zone, in the
  // edge's "out" instead of the rail's, so it's painted at the road's frame. We pre-compute
  // and emit a prop record on the rail out for the editor to apply; but for now we just
  // place a thin "ceiling" panel above the underpass section so the road appears shadowed.
  for (const [a, b] of zones) {
    const sM = (a + b) / 2, half = (b - a) / 2;
    const f = rc.frameAt(sM);
    if (!f) continue;
    const yCeil = f.y + MONO_BEAM_UNDERY;
    // a flat box ceiling over the underpass
    const n = 8;
    for (let k = 0; k <= n; k++) {
      const t = a + (b - a) * k / n;
      const fr = rc.frameAt(t);
      // no-op geometry: register a 'ceiling' shadow quad via sweep
    }
    // the visual cue is mainly done in the road edge build (it sees the rail). here we just
    // emit a steel underside strip to "close" the beam so the road looks shaded.
    const segFrames = [];
    for (let t = a - 1; t <= b + 1; t += 0.8) {
      const fr = rc.frameAt(t);
      fr.y = yCeil - MONO_BEAM_UNDERY - 0.05;
      segFrames.push(fr);
    }
    if (segFrames.length > 1) {
      for (const o of offs) {
        const hw = MONO_BEAM_W / 2;
        ribbon(out, 'concrete', segFrames, o - hw, o + hw, -0.05);
      }
    }
  }

  // --- straddle-beam train car. Place one car per track, evenly spaced along the line.
  // We only render cars in the visible area; the editor can choose to place N cars.
  const numCars = Math.max(1, Math.min(8, Math.round(rc.length / 90)));
  const stride = rc.length / (numCars + 0.5);  // half-stride at the start so cars don't pile
  for (let ti = 0; ti < tracks; ti++) {
    const o = offs[ti];
    for (let k = 0; k < numCars; k++) {
      const sCar = stride * (0.5 + k);
      if (sCar < 6 || sCar > rc.length - 6) continue;
      const f = rc.frameAt(sCar);
      const yaw = yawFor(f.tx, f.tz);
      const px = f.x + f.nx * o;
      const pz = f.z + f.nz * o;
      const py = f.y + MONO_BEAM_UNDERY + MONO_BEAM_H + MONO_CAR_CLEAR;
      out.prop('monoCar', px, py, pz, yaw, MONO_CAR_LEN, MONO_CAR_H, MONO_CAR_W);
    }
  }

  out.color = rail.color || '#e44d2f';
  return out;
}
