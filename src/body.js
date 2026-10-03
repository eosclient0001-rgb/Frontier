// Procedural mannequin body.
//
// The whole figure is generated from two analytic primitives so that the visual
// mesh and the cloth collision volume are *the exact same surface*:
//
//   * "loft"    - a stack of elliptic superellipse rings with front/back bulges
//                 (crotch -> hips -> waist -> bust -> shoulders -> neck -> head)
//   * "capsule" - tapered round cones (arms segments, leg segments, hands)
//
// Collision in the compute shader replays the identical maths, so the dress can
// never penetrate the figure and never floats away from it.

import { clamp, lerp, TAU, v3, m4 } from './math.js';

const D2R = Math.PI / 180;

// Height landmarks as fractions of total body height (1.70 m reference).
const LANDMARK = {
  floor: 0.0,
  ankle: 0.048,
  knee: 0.268,
  crotch: 0.472,
  hip: 0.545,
  waist: 0.625,
  underbust: 0.686,
  bust: 0.735,
  chest: 0.792,
  shoulder: 0.840,
  neckbase: 0.870,
  chin: 0.895,
  head: 0.935,
  crown: 1.0,
};

/**
 * Lamé superellipse radius along the direction `theta`, in the same units as
 * rx/rz. `theta = 0` points along +X, `theta = pi/2` along +Z (front).
 *   |x/rx|^e + |z/rz|^e = 1
 */
export function superRadius(rx, rz, e, theta) {
  const c = Math.abs(Math.cos(theta)) / rx;
  const s = Math.abs(Math.sin(theta)) / rz;
  return Math.pow(Math.pow(c, e) + Math.pow(s, e), -1 / e);
}

/**
 * Build the analytic body description from UI parameters.
 * Returns { rings, capsules, landmarks } in metres, Y-up, feet at y = 0.
 */
export function buildBodySpec(p) {
  const H = p.height;
  const shoulderS = clamp(p.shoulders, 0.5, 1.8);
  const bustS = clamp(p.bust, 0.4, 2.2);
  const waistS = clamp(p.waist, 0.5, 1.9);
  const hipS = clamp(p.hips, 0.5, 2.0);
  const bustPos = clamp(p.bustHeight, 0.4, 1.6);
  const armAngle = p.armAngle * D2R;      // 0 = arms down, + = away from body
  const legSpread = p.legSpread * D2R;

  const Y = (k) => LANDMARK[k] * H;
  const S = H / 1.70; // overall scale

  const w = (k) => Math.max(0.004, k * S);

  // rx = half width (left-right), rz = half depth (front-back)
  const rings = [];
  const R = (y, rx, rz, o = {}) =>
    rings.push({
      y, rx, rz,
      cx: o.cx ?? 0, cz: o.cz ?? 0,
      e: o.e ?? 2.35,
      front: o.front ?? 0,
      back: o.back ?? 0,
    });

  // ---- hips / pelvis (rounded, wider than deep)
  R(Y('crotch') - 0.035 * S, 0.128 * hipS * S, 0.100 * hipS * S, { e: 2.5, back: 0.05 });
  R(Y('crotch') + 0.012 * S, 0.150 * hipS * S, 0.112 * hipS * S, { e: 2.5, back: 0.10 });
  R(Y('hip') - 0.02 * S, 0.163 * hipS * S, 0.120 * hipS * S, { e: 2.45, back: 0.13 });
  R(Y('hip'), 0.168 * hipS * S, 0.122 * hipS * S, { e: 2.4, back: 0.14 });
  R(Y('hip') + 0.035 * S, 0.150 * hipS * S, 0.112 * hipS * S, { e: 2.35, back: 0.10 });

  // ---- waist
  R(Y('waist') - 0.05 * S, 0.126 * waistS * S, 0.100 * waistS * S, { e: 2.4 });
  R(Y('waist'), 0.118 * waistS * S, 0.095 * waistS * S, { e: 2.4 });
  R(Y('waist') + 0.04 * S, 0.126 * waistS * S, 0.103 * waistS * S, { e: 2.4 });

  // ---- bust / chest
  R(Y('underbust'), 0.135 * bustS * 0.97 * S, 0.110 * bustS * 0.95 * S, { e: 2.35, front: 0.10 * bustS });
  R(Y('underbust') + 0.028 * S, 0.145 * bustS * S, 0.118 * bustS * S, { e: 2.3, front: 0.30 * bustS * bustPos });
  R(Y('bust'), 0.150 * bustS * S, 0.120 * bustS * S, { e: 2.3, front: 0.40 * bustS * bustPos });
  R(Y('bust') + 0.032 * S, 0.148 * bustS * S, 0.113 * bustS * S, { e: 2.35, front: 0.20 * bustS * bustPos });
  R(Y('chest'), 0.152 * bustS * S, 0.108 * S, { e: 2.5 });
  R(Y('chest') + 0.03 * S, 0.160 * bustS * S, 0.104 * S, { e: 2.7 });

  // ---- shoulders (shelf) -> neck
  R(Y('shoulder') - 0.012 * S, 0.175 * shoulderS * S, 0.088 * S, { e: 2.9 });
  R(Y('shoulder'), 0.180 * shoulderS * S, 0.084 * S, { e: 3.0 });
  R(Y('shoulder') + 0.022 * S, 0.128 * shoulderS * S, 0.078 * S, { e: 2.6 });
  R(Y('neckbase'), 0.056 * S, 0.052 * S, { e: 2.2 });
  R(Y('neckbase') + 0.02 * S, 0.050 * S, 0.047 * S, { e: 2.2 });

  // ---- head (chin -> crown)
  R(Y('chin') + 0.012 * S, 0.062 * S, 0.068 * S, { e: 2.3, cz: -0.006 * S });
  R(Y('chin') + 0.033 * S, 0.072 * S, 0.085 * S, { e: 2.25, cz: -0.006 * S });
  R(Y('head'), 0.078 * S, 0.092 * S, { e: 2.2, cz: -0.004 * S });
  R(Y('head') + 0.032 * S, 0.075 * S, 0.086 * S, { e: 2.15, cz: 0.0 });
  R(Y('crown') - 0.024 * S, 0.055 * S, 0.060 * S, { e: 2.1 });
  R(Y('crown') - 0.008 * S, 0.026 * S, 0.028 * S, { e: 2.0 });

  rings.sort((a, b) => a.y - b.y);

  // ---------------------------------------------------------------- limbs
  const capsules = [];
  // `collide` marks the capsule as a cloth collider. Arms and hands are visual
  // only: a garment bodice sits *under* the arm, so pushing cloth off the arm
  // capsules would tear the bodice apart.
  const CAP = (a, b, ra, rb, collide = true) => capsules.push({ a, b, ra, rb, collide });

  const shoulderY = Y('shoulder') - 0.012 * S;
  const shoulderX = 0.158 * shoulderS * S;

  for (const side of [-1, 1]) {
    // --- arm: shoulder -> elbow -> wrist -> hand
    const sx = side * shoulderX;
    const upperLen = 0.30 * S;
    const foreLen = 0.26 * S;
    const A = [sx, shoulderY, 0];
    const dir = [Math.sin(armAngle) * side, -Math.cos(armAngle), 0];
    const E = v3.add(A, v3.scale(dir, upperLen));
    // slight bend at the elbow, hands drift forward a touch
    const dir2 = [Math.sin(armAngle * 0.75) * side, -Math.cos(armAngle * 0.75), 0.16];
    const dir2n = v3.norm(dir2);
    const W = v3.add(E, v3.scale(dir2n, foreLen));
    CAP(A, E, 0.056 * S, 0.040 * S, false);
    CAP(E, W, 0.040 * S, 0.030 * S, false);
    const handDir = v3.norm([dir2n[0] * 0.6, -1, 0.25]);
    CAP(W, v3.add(W, v3.scale(handDir, 0.075 * S)), 0.030 * S, 0.024 * S, false);

    // --- leg: hip -> knee -> ankle -> foot
    const hipX = side * 0.078 * hipS * S;
    const hipY = Y('hip') - 0.02 * S;
    const K = [side * (0.070 * S + legSpread * 0.55 * S), Y('knee') + 0.02 * S, 0.006 * S];
    const A2 = [side * (0.062 * S + legSpread * 0.75 * S), Y('ankle') + 0.02 * S, -0.008 * S];
    const Hp = [hipX, hipY, 0];
    CAP(Hp, K, 0.098 * hipS * S, 0.058 * S);
    CAP(K, A2, 0.056 * S, 0.036 * S);
    CAP(A2, [A2[0], Y('ankle') * 0.55, A2[2] + 0.085 * S], 0.034 * S, 0.030 * S);
  }

  // shoulder ball (fills the gap between torso shelf and arm) - visual only
  for (const side of [-1, 1]) {
    CAP(
      [side * shoulderX * 0.86, shoulderY + 0.012 * S, 0],
      [side * shoulderX, shoulderY - 0.02 * S, 0],
      0.070 * S, 0.062 * S,
      false
    );
  }

  return { rings, capsules, landmarks: LANDMARK, H, S, Y };
}

// ---------------------------------------------------------------- surface queries

function ringParamsAt(spec, y) {
  const { rings } = spec;
  const n = rings.length;
  if (y <= rings[0].y) return rings[0];
  if (y >= rings[n - 1].y) return rings[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rings[mid].y <= y) lo = mid; else hi = mid;
  }
  const a = rings[lo], b = rings[hi];
  const t = (y - a.y) / Math.max(1e-6, b.y - a.y);
  return {
    y,
    rx: lerp(a.rx, b.rx, t),
    rz: lerp(a.rz, b.rz, t),
    cx: lerp(a.cx, b.cx, t),
    cz: lerp(a.cz, b.cz, t),
    e: lerp(a.e, b.e, t),
    front: lerp(a.front, b.front, t),
    back: lerp(a.back, b.back, t),
  };
}

/** Radial "bulge" multiplier: v > 0 is toward the front (+Z). */
function bulge(v, front, back) {
  const f = v > 0 ? v : 0;
  const b = v < 0 ? -v : 0;
  return 1 + front * f * f + back * b * b;
}

/** Point on the body surface for a given height and angle. Returns [x, z]. */
export function bodySurface(spec, y, theta) {
  const r = ringParamsAt(spec, y);
  const dirX = Math.cos(theta), dirZ = Math.sin(theta);
  const rr = superRadius(r.rx, r.rz, r.e, theta) * bulge(dirZ, r.front, r.back);
  return [r.cx + dirX * rr, r.cz + dirZ * rr];
}

/**
 * Highest y at which (x, z) is still inside the body — i.e. the "ceiling" of
 * the surface above that column. Used to lay straps over the shoulder instead
 * of letting them cut through the trapezius. Returns null outside the body.
 */
export function bodyCeiling(spec, x, z) {
  const rings = spec.rings;
  const n = rings.length;
  const sval = (r) => {
    const dx = x - r.cx, dz = z - r.cz;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return -1;
    const theta = Math.atan2(dz, dx);
    const rr = superRadius(r.rx, r.rz, r.e, theta) * bulge(Math.sin(theta), r.front, r.back);
    return len - rr;
  };
  let best = null;
  for (let i = n - 1; i > 0; i--) {
    const a = rings[i - 1], b = rings[i];
    const sa = sval(a), sb = sval(b);
    if (sb < 0) return b.y;                 // still inside at this ring
    if (sa < 0 && sb >= 0) {
      // boundary crossed between a and b: interpolate to the zero crossing
      const t = sa / (sa - sb);
      return lerp(a.y, b.y, t);
    }
  }
  if (sval(rings[0]) < 0) return rings[0].y;
  return best;
}

/** Signed proximity: >0 outside, <0 inside, in metres (approximate). */
export function bodySigned(spec, y, x, z) {
  const r = ringParamsAt(spec, y);
  const dx = x - r.cx, dz = z - r.cz;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return -Math.min(r.rx, r.rz);
  const theta = Math.atan2(dz, dx);
  const rr = superRadius(r.rx, r.rz, r.e, theta) * bulge(Math.sin(theta), r.front, r.back);
  return len - rr;
}

/** Outward unit normal of the body surface at a point (finite difference). */
export function bodyNormal(spec, y, x, z) {
  const h = 0.002;
  const gx = bodySigned(spec, y, x + h, z) - bodySigned(spec, y, x - h, z);
  const gz = bodySigned(spec, y, x, z + h) - bodySigned(spec, y, x, z - h);
  const gy = bodySigned(spec, y + h, x, z) - bodySigned(spec, y - h, x, z);
  const l = Math.hypot(gx, gy, gz);
  if (l < 1e-7) return v3.norm([x, 0.001, z]);
  return [gx / l, gy / l, gz / l];
}

// ---------------------------------------------------------------- mesh generation

function addQuad(indices, a, b, c, d) {
  indices.push(a, b, c, a, c, d);
}

/**
 * Tessellate the loft + capsules into a renderable mesh.
 * Returns { positions, normals, uvs, indices }.
 */
export function buildBodyMesh(spec, radialSegments = 48, capsuleSegments = 20) {
  const pos = [];
  const uv = [];
  const idx = [];
  const { rings } = spec;

  // --- loft: rings x radialSegments, with two extra closing rows (top cap, bottom cap)
  const rows = rings.length;
  const cols = radialSegments;
  for (let i = 0; i < rows; i++) {
    const r = rings[i];
    for (let j = 0; j < cols; j++) {
      const th = (j / cols) * TAU;
      const dirX = Math.cos(th), dirZ = Math.sin(th);
      const rr = superRadius(r.rx, r.rz, r.e, th) * bulge(dirZ, r.front, r.back);
      pos.push(r.cx + dirX * rr, r.y, r.cz + dirZ * rr);
      uv.push(j / cols * 2.0, r.y * 1.6);
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const j2 = (j + 1) % cols;
      addQuad(idx, i * cols + j, i * cols + j2, (i + 1) * cols + j2, (i + 1) * cols + j);
    }
  }
  // bottom cap (fan to a centre point under the crotch)
  {
    const r = rings[0];
    const cIdx = pos.length / 3;
    pos.push(r.cx, r.y - 0.02 * spec.S, r.cz);
    uv.push(0.5, 0);
    for (let j = 0; j < cols; j++) {
      const j2 = (j + 1) % cols;
      idx.push(cIdx, j2, j);
    }
  }
  // top cap (crown)
  {
    const r = rings[rows - 1];
    const cIdx = pos.length / 3;
    pos.push(r.cx, r.y + 0.012 * spec.S, r.cz);
    uv.push(0.5, 0.5);
    const base = (rows - 1) * cols;
    for (let j = 0; j < cols; j++) {
      const j2 = (j + 1) % cols;
      idx.push(cIdx, base + j, base + j2);
    }
  }

  // --- capsules
  for (const cap of spec.capsules) {
    const axis = v3.norm(v3.sub(cap.b, cap.a));
    let ref = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const t1 = v3.norm(v3.cross(ref, axis));
    const t2 = v3.cross(axis, t1);
    const seg = capsuleSegments;
    const base = pos.length / 3;
    // rows walk: a's pole -> a's equator -> b's equator -> b's pole
    const rowsCap = [];
    const steps = 8;
    const k = 0.5;
    const eps = 2e-4;
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      let p, rr;
      if (u <= k) {
        // hemisphere around a: pole at (a - ra*axis) up to the equator at a
        const phi = (Math.PI / 2) * (u / k);
        p = v3.add(cap.a, v3.scale(axis, -cap.ra * Math.cos(phi)));
        rr = Math.max(eps, cap.ra * Math.sin(phi));
      } else {
        // hemisphere around b: equator at b out to the pole at (b + rb*axis)
        const psi = (Math.PI / 2) * (1 - (u - k) / (1 - k));
        p = v3.add(cap.b, v3.scale(axis, cap.rb * Math.cos(psi)));
        rr = Math.max(eps, cap.rb * Math.sin(psi));
      }
      rowsCap.push({ p, rr, u });
    }
    for (let si = 0; si < rowsCap.length - 1; si++) {
      const A = rowsCap[si], B = rowsCap[si + 1];
      for (let j = 0; j < seg; j++) {
        const th = (j / seg) * TAU;
        const d1 = v3.add(v3.scale(t1, Math.cos(th)), v3.scale(t2, Math.sin(th)));
        const pA = v3.add(A.p, v3.scale(d1, A.rr));
        const pB = v3.add(B.p, v3.scale(d1, B.rr));
        pos.push(pA[0], pA[1], pA[2]);
        uv.push(j / seg * 1.5, A.u);
        pos.push(pB[0], pB[1], pB[2]);
        uv.push(j / seg * 1.5, B.u);
      }
      // vertices are interleaved per column: [A_j, B_j, A_j+1, B_j+1, ...]
      const rowA = base + si * seg * 2;
      for (let j = 0; j < seg; j++) {
        const j2 = (j + 1) % seg;
        const a0 = rowA + j * 2, b0 = rowA + j * 2 + 1;
        const a1 = rowA + j2 * 2, b1 = rowA + j2 * 2 + 1;
        addQuad(idx, a0, a1, b1, b0);
      }
    }
  }

  // --- normals by area-weighted accumulation
  const normals = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const i0 = idx[i] * 3, i1 = idx[i + 1] * 3, i2 = idx[i + 2] * 3;
    const ax = pos[i1] - pos[i0], ay = pos[i1 + 1] - pos[i0 + 1], az = pos[i1 + 2] - pos[i0 + 2];
    const bx = pos[i2] - pos[i0], by = pos[i2 + 1] - pos[i0 + 1], bz = pos[i2 + 2] - pos[i0 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    normals[i0] += nx; normals[i0 + 1] += ny; normals[i0 + 2] += nz;
    normals[i1] += nx; normals[i1 + 1] += ny; normals[i1 + 2] += nz;
    normals[i2] += nx; normals[i2 + 1] += ny; normals[i2 + 2] += nz;
  }
  const vc = pos.length / 3;
  for (let i = 0; i < vc; i++) {
    const x = normals[i * 3], y = normals[i * 3 + 1], z = normals[i * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    normals[i * 3] = x / l; normals[i * 3 + 1] = y / l; normals[i * 3 + 2] = z / l;
  }

  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(idx),
  };
}

/** Pack collision data for the GPU: flat Float32Arrays matching the WGSL structs. */
export function packCollision(spec) {
  // Ring { y, rx, rz, cx, cz, e, front, back } = 8 f32 => 32 bytes (vec4-aligned)
  const rings = new Float32Array(spec.rings.length * 8);
  spec.rings.forEach((r, i) => {
    const o = i * 8;
    rings[o + 0] = r.y; rings[o + 1] = r.rx; rings[o + 2] = r.rz; rings[o + 3] = r.cx;
    rings[o + 4] = r.cz; rings[o + 5] = r.e; rings[o + 6] = r.front; rings[o + 7] = r.back;
  });
  const colliders = spec.capsules.filter((c) => c.collide !== false);
  // Cap { a: vec3, ra: f32, b: vec3, rb: f32 } = 32 bytes
  const caps = new Float32Array(colliders.length * 8);
  colliders.forEach((c, i) => {
    const o = i * 8;
    caps[o + 0] = c.a[0]; caps[o + 1] = c.a[1]; caps[o + 2] = c.a[2]; caps[o + 3] = c.ra;
    caps[o + 4] = c.b[0]; caps[o + 5] = c.b[1]; caps[o + 6] = c.b[2]; caps[o + 7] = c.rb;
  });
  return { rings, capsules: caps, ringCount: spec.rings.length, capsuleCount: colliders.length };
}

export function bodyHeightRange(spec) {
  return { min: spec.rings[0].y, max: spec.rings[spec.rings.length - 1].y };
}
