// Software renderer: draws the mannequin + dress to a PNG using a JavaScript
// port of the WGSL fabric + lighting shaders, so the look of the garment can be
// inspected without a browser. The port is line-for-line from src/shaders.js.
//
// Run: node tools/software-render.mjs [out.png] [view]
//   views: front | side | three | close | drop
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildBodySpec, buildBodyMesh } from '../src/body.js';
import { buildDress } from '../src/dress.js';
import { DEFAULT_FABRIC, packFabric, FABRIC_PRESETS } from '../src/fabric.js';
import { m4, v3, clamp } from '../src/math.js';

// ---------------------------------------------------------------- PNG writer
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}
function writePNG(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

// ------------------------------------------------- WGSL fabric library in JS
const fract = (x) => x - Math.floor(x);
const mix = (a, b, t) => a + (b - a) * t;
const step = (e, x) => (x < e ? 0 : 1);
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const rot2 = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; };
function hash21(x, y) {
  let p = [fract(x * 0.1031), fract(y * 0.1031), fract(x * 0.1031)];
  const d = p[0] * (p[1] + 33.33) + p[1] * (p[2] + 33.33) + p[2] * (p[0] + 33.33);
  p = p.map((v) => fract(v + d));
  return fract((p[0] + p[1]) * p[2]);
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = [fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)];
  const a = hash21(ix, iy), b = hash21(ix + 1, iy), c = hash21(ix, iy + 1), d = hash21(ix + 1, iy + 1);
  return mix(mix(a, b, u[0]), mix(c, d, u[0]), u[1]);
}
function fbm(x, y, oct) {
  let s = 0, a = 0.5, px = x, py = y;
  for (let i = 0; i < oct; i++) { s += a * vnoise(px, py); px = px * 2.03 + 11.3; py = py * 2.03 + 7.7; a *= 0.5; }
  return s;
}
const stripesFn = (p, w) => smoothstep(-w, w, Math.sin(p[0] * 6.28318)) * 0.5 + 0.5;
function plaidFn(p, w) {
  const a = step(w, fract(p[0])), b = step(w, fract(p[1]));
  const c = step(0.5 + w * 0.5, fract(p[0] + p[1] * 0.5));
  return a * b * 0.7 + c * 0.3;
}
function dotsFn(p, r) {
  const q = [fract(p[0]) - 0.5, fract(p[1]) - 0.5];
  return 1 - smoothstep(r - 0.03, r + 0.03, Math.hypot(q[0], q[1]));
}
function houndFn(p) {
  const q = [p[0] * 2, p[1] * 2];
  const i = [Math.floor(q[0]), Math.floor(q[1])];
  const f = [fract(q[0]) - 0.5, fract(q[1]) - 0.5];
  const sgn = ((i[0] + i[1]) % 2) * 2 - 1;
  const d = f[0] * sgn + f[1];
  const shear = 1 - smoothstep(0.18, 0.30, Math.abs(d));
  const chk = (i[0] + i[1]) % 2;
  return clamp(shear * (2 * chk - 1) * 0.5 + 0.5, 0, 1);
}
function damaskFn(p, n) {
  let q = [Math.abs(fract(p[0]) - 0.5), Math.abs(fract(p[1]) - 0.5)];
  const a = Math.atan2(q[1], q[0]);
  const r = Math.hypot(q[0], q[1]);
  const petals = Math.pow(Math.abs(Math.cos(a * n)), 0.55);
  const ring1 = smoothstep(0.30, 0.24, r);
  const ring2 = smoothstep(0.20, 0.14, Math.abs(r - 0.26));
  const ring3 = smoothstep(0.10, 0.07, Math.abs(r - 0.38));
  return clamp(Math.max(Math.max(petals * ring1, ring2 * 0.85), ring3 * 0.55), 0, 1);
}
function floralFn(p, n) {
  let m = 0;
  for (let i = 0; i < 3; i++) {
    const off = [hash21(i, 1.7), hash21(i, 5.3)];
    const qx = fract(p[0] + off[0]) - 0.5, qy = fract(p[1] + off[1]) - 0.5;
    const r = Math.hypot(qx, qy);
    const a = Math.atan2(qy, qx);
    m = Math.max(m, smoothstep(0.16, 0.02, r) * Math.pow(Math.abs(Math.cos(a * n)), 0.5));
  }
  return clamp(m, 0, 1);
}
function laceFn(p, n) {
  const net = Math.min(Math.min(fract(p[0]), 1 - fract(p[0])), Math.min(fract(p[1]), 1 - fract(p[1])));
  return clamp(Math.max((1 - smoothstep(0.04, 0.13, net)) * 0.55, floralFn(p, n)), 0, 1);
}
function weaveFn(p) {
  const q = [p[0] * 2, p[1] * 2];
  const cell = [Math.floor(q[0]), Math.floor(q[1])];
  const f = [fract(q[0]), fract(q[1])];
  const up = step(1.5, ((cell[0] + 2 * cell[1]) % 4));
  const yh = Math.sin(f[0] * 3.14159), yv = Math.sin(f[1] * 3.14159);
  return [mix(yv, yh, up), mix(-yv, -yh, up)];
}

function evalFabric(uvIn, F) {
  const uv = rot2(uvIn, F.p3[3]);   // F.p3.w in WGSL
  const sc = Math.max(F.p0[0], 0.05);
  const p = [uv[0] * sc, uv[1] * sc];
  let col = [F.colA[0], F.colA[1], F.colA[2]];
  let h = 0.5;
  let rough = F.p4[1];
  const alpha = F.p4[3];

  const sp = rot2(p, F.p3[0]);
  const st = stripesFn([sp[0], sp[1] * 0.06], F.p0[1]);
  const pl = plaidFn([p[0] * 0.5, p[1] * 0.5], F.p0[1] * 1.2);
  const dt = dotsFn([p[0] * 0.5, p[1] * 0.5], F.p0[2]);
  let mt = damaskFn([p[0] * 0.5, p[1] * 0.5], F.p3[1]);
  if (F.p3[2] >= 0.5 && F.p3[2] < 1.5) mt = floralFn([p[0] * 0.5, p[1] * 0.5], F.p3[1]);
  else if (F.p3[2] >= 1.5) mt = laceFn([p[0] * 0.5, p[1] * 0.5], F.p3[1]);

  const kind = Math.round(F.p4[0]);
  const accent = F.colB;
  let base = 0;
  if (kind === 1) base = st;
  else if (kind === 2) base = pl;
  else if (kind === 3) base = dt;
  else if (kind === 4) base = mt;
  else if (kind === 5) base = houndFn([p[0] * 0.5, p[1] * 0.5]);
  else if (kind === 6) base = floralFn([p[0] * 0.5, p[1] * 0.5], F.p3[1]);
  else if (kind === 7) base = laceFn([p[0] * 0.5, p[1] * 0.5], F.p3[1]);
  else if (kind === 8) {
    const g = fbm(p[0] * 0.35, p[1] * 0.35, 4);
    col = [mix(F.colA[0], F.colB[0], smoothstep(0.25, 0.75, g)), mix(F.colA[1], F.colB[1], smoothstep(0.25, 0.75, g)), mix(F.colA[2], F.colB[2], smoothstep(0.25, 0.75, g))];
    const n2 = smoothstep(0.45, 0.95, fbm(p[0] * 0.22 + 3, p[1] * 0.22, 3));
    col = [mix(col[0], F.colC[0], n2), mix(col[1], F.colC[1], n2), mix(col[2], F.colC[2], n2)];
  }
  if (kind >= 1 && kind <= 7) {
    col = [mix(col[0], accent[0], base), mix(col[1], accent[1], base), mix(col[2], accent[2], base)];
    h = mix(h, 0.35 + 0.3 * base, 0.7);
  }
  const [os, op, od, om] = F.p1;
  if (os > 0.001) { col = [mix(col[0], F.colB[0], st * os), mix(col[1], F.colB[1], st * os), mix(col[2], F.colB[2], st * os)]; h = mix(h, 0.3 + 0.4 * st, os * 0.6); }
  if (op > 0.001) { col = [mix(col[0], F.colC[0], pl * op * 0.8), mix(col[1], F.colC[1], pl * op * 0.8), mix(col[2], F.colC[2], pl * op * 0.8)]; h = mix(h, 0.35 + 0.3 * pl, op * 0.5); }
  if (od > 0.001) { col = [mix(col[0], F.colC[0], dt * od), mix(col[1], F.colC[1], dt * od), mix(col[2], F.colC[2], dt * od)]; h = mix(h, 0.7 - 0.3 * dt, od * 0.4); }
  if (om > 0.001) { col = [mix(col[0], F.colB[0], mt * om), mix(col[1], F.colB[1], mt * om), mix(col[2], F.colB[2], mt * om)]; h = mix(h, 0.35 + 0.35 * mt, om * 0.5); }

  const wa = F.p2[0];
  if (wa > 0.001) {
    const w = weaveFn([uv[0] * Math.max(F.p2[1], 1) * 900, uv[1] * Math.max(F.p2[1], 1) * 900]);
    col = col.map((c) => c * (0.86 + 0.14 * w[0]));
    h += (w[0] - 0.5) * 0.10 * wa;
    rough += (0.5 - w[0]) * 0.06;
  }
  const na = F.p2[2];
  if (na > 0.001) {
    const ns = Math.max(F.p2[3], 0.1);
    const n1 = fbm(uv[0] * ns * 22, uv[1] * ns * 22, 4) - 0.5;
    const n2 = fbm(uv[0] * ns * 140, uv[1] * ns * 140, 2) - 0.5;
    col = col.map((c) => c * (1 + n1 * 0.35 * na + n2 * 0.16 * na));
    rough = clamp(rough + n2 * 0.10 * na, 0.05, 1);
  }
  return { albedo: col, height: h, rough: clamp(rough, 0.03, 1), alpha };
}

// ------------------------------------------------------------ scene assembly
const P = {
  height: 1.70, shoulders: 1.0, bust: 1.0, waist: 0.92, hips: 1.06, bustHeight: 1.0,
  armAngle: 16, legSpread: 0, bodySegments: 44,
  style: process.env.STYLE ?? 'aline', length: 0.60, fit: 1.030, ease: 1.0, flare: 1.0,
  pleats: 14, pleatDepth: 0.020, neckline: process.env.NECKLINE ?? 'sweetheart',
  straps: 1, strapWidth: 0.030, strapInset: 0, strapPinRange: 0.16, neckDrop: 1.0,
  hemSweep: 1.0, tierAmp: 1.0, resolution: Number(process.env.RES ?? 110), pinTopRows: 2,
  arealDensity: 0.20,
  constraintParams: { stretchComp: 1.5e-6, shearComp: 3e-5, bendComp: 8e-4, stitchComp: 1e-7 },
};

const presetName = process.env.PRESET;
const preset = presetName ? FABRIC_PRESETS.find((p) => p.name.toLowerCase().includes(presetName.toLowerCase())) : null;
const FABRIC = preset ? { ...DEFAULT_FABRIC, ...preset } : { ...DEFAULT_FABRIC };
const packed = packFabric(FABRIC);
const F = {
  colA: packed.slice(0, 3), colB: packed.slice(4, 7), colC: packed.slice(8, 11),
  p0: packed.slice(12, 16), p1: packed.slice(16, 20), p2: packed.slice(20, 24),
  p3: packed.slice(24, 28), p4: packed.slice(28, 32),
};

const spec = buildBodySpec(P);
const body = buildBodyMesh(spec, P.bodySegments, 18);
const dress = buildDress(spec, P, P.resolution);

const VIEWS = {
  front: [0.0, 0.04, 3.0, 0.92, 36], side: [Math.PI / 2, 0.04, 3.0, 0.92, 36],
  three: [0.55, 0.12, 3.0, 0.95, 36], close: [0.35, 0.18, 1.55, 1.30, 32],
  full: [0.42, 0.10, 3.6, 0.90, 36],
};
const [yaw, pitch, dist, ty, fovDeg] = VIEWS[process.argv[3] ?? 'three'] ?? VIEWS.three;
const W = Number(process.env.W ?? 720), H = Number(process.env.H ?? 1000);

const target = [0, ty, 0];
const eye = [
  target[0] + dist * Math.sin(yaw) * Math.cos(pitch),
  target[1] + dist * Math.sin(pitch),
  target[2] + dist * Math.cos(yaw) * Math.cos(pitch),
];
const proj = m4.perspective(fovDeg * Math.PI / 180, W / H, 0.05, 60);
const view = m4.lookAt(eye, target, [0, 1, 0]);
const vp = m4.mul(proj, view);
const LIGHT = v3.norm([0.45, 0.72, 0.62]);
const LIGHT_COL = [1.05, 1.02, 0.98];
const AMBIENT = [0.16, 0.175, 0.21];
const FLOOR = 0.0;

const zbuf = new Float32Array(W * H).fill(Infinity);
const cbuf = new Float32Array(W * H * 3);

// ------------------------------------------------------------ ground (sphere-free)
function shadeGround(px, py) {
  // ray through the pixel
  const ndc = [(px + 0.5) / W * 2 - 1, 1 - (py + 0.5) / H * 2];
  const inv = m4.invert(vp);
  const un = (z) => {
    const x = inv[0] * ndc[0] + inv[4] * ndc[1] + inv[8] * z + inv[12];
    const y = inv[1] * ndc[0] + inv[5] * ndc[1] + inv[9] * z + inv[13];
    const zz = inv[2] * ndc[0] + inv[6] * ndc[1] + inv[10] * z + inv[14];
    const w = inv[3] * ndc[0] + inv[7] * ndc[1] + inv[11] * z + inv[15];
    return [x / w, y / w, zz / w];
  };
  const p0 = un(0), p1 = un(1);
  const dir = v3.sub(p1, p0);
  if (Math.abs(dir[1]) < 1e-6) return null;
  const t = -p0[1] / dir[1];
  if (t <= 0) return null;
  const hit = v3.add(p0, v3.scale(dir, t));
  const dd = v3.len(v3.sub(hit, eye));
  const r = Math.hypot(hit[0], hit[2]);
  const shadow = 1 - 0.58 * Math.exp(-r * r * 2.4);
  const gx = Math.abs(fract(hit[0] * 2) - 0.5), gz = Math.abs(fract(hit[2] * 2) - 0.5);
  const grid = 1 - smoothstep(0.45, 0.5, Math.max(gx, gz));
  const fade = Math.exp(-dd * 0.22);
  let col = [0.085 * shadow, 0.089 * shadow, 0.103 * shadow];
  col = col.map((c, i) => c + [0.11, 0.12, 0.145][i] * grid * fade * shadow);
  const fog = 1 - Math.exp(-dd * 0.10);
  col = col.map((c, i) => mix(c, [0.10, 0.105, 0.12][i], fog));
  // depth
  const clip = m4.mul(vp, [hit[0], hit[1], hit[2], 1]);
  const depth = clamp(clip[2] / clip[3], 0, 1);
  return { col, depth, world: hit };
}

// ------------------------------------------------------------ cloth fragment
function shadeCloth(world, normal0, uv, front) {
  const V = v3.norm(v3.sub(eye, world));
  let N = v3.norm(normal0);
  if (!front) N = v3.scale(N, -1);
  const S = evalFabric(uv, F);
  const w = weaveFn([uv[0] * Math.max(F.p2[1], 1) * 900, uv[1] * Math.max(F.p2[1], 1) * 900]);
  let T = v3.norm(v3.add(v3.cross(N, [0, 1, 0]), [1e-5, 0, 0]));
  const B = v3.cross(N, T);
  const bump = F.p2[0] * 0.35;
  N = v3.norm(v3.add(N, v3.add(v3.scale(T, (w[0] - 0.5) * bump), v3.scale(B, (w[1] - 0.5) * bump * 0.4))));
  const L = LIGHT;
  const Hh = v3.norm(v3.add(L, V));
  const ndl = Math.max(v3.dot(N, L), 0), ndv = Math.max(v3.dot(N, V), 0), ndh = Math.max(v3.dot(N, Hh), 0);
  const rough = clamp(S.rough, 0.04, 1), a = rough * rough, a2 = a * a;
  const denom = ndh * ndh * (a2 - 1) + 1;
  const D = a2 / (3.14159 * denom * denom);
  const k = a * 0.5;
  const G = (ndl / (ndl * (1 - k) + k)) * (ndv / (ndv * (1 - k) + k));
  const F0 = 0.04 + 0.06 * F.p4[2];
  const Fres = F0 + (1 - F0) * Math.pow(1 - Math.max(v3.dot(Hh, V), 0), 5);
  const spec = D * G * Fres * 0.55;
  let col = S.albedo.map((c, i) => c * (LIGHT_COL[i] * ndl * 1.15 + AMBIENT[i]));
  col = col.map((c, i) => c + LIGHT_COL[i] * spec * ndl);
  const sheen = Math.pow(1 - ndv, 4) * F.p4[2] * 0.8;
  col = col.map((c, i) => c + LIGHT_COL[i] * sheen);
  const fold = clamp(0.55 + 0.45 * ndl, 0, 1);
  col = col.map((c) => c * mix(1, fold, 0.55));
  col = col.map((c) => c / (c + 0.85));
  return col.map((c) => Math.pow(c, 0.4545));
}

function shadeBody(world, normal0, front) {
  let N = v3.norm(normal0);
  if (!front) N = v3.scale(N, -1);
  const V = v3.norm(v3.sub(eye, world));
  const L = LIGHT;
  const ndl = Math.max(v3.dot(N, L), 0), ndv = Math.max(v3.dot(N, V), 0);
  const Hh = v3.norm(v3.add(L, V));
  const spec = Math.pow(Math.max(v3.dot(N, Hh), 0), 42) * 0.16;
  const base = [0.62, 0.60, 0.585];
  let col = base.map((c, i) => c * (LIGHT_COL[i] * ndl * 0.95 + AMBIENT[i] * 1.1));
  col = col.map((c, i) => c + LIGHT_COL[i] * spec);
  const rim = Math.pow(1 - ndv, 3) * 0.35;
  col = col.map((c, i) => c + [rim * 0.9, rim * 0.95, rim][i]);
  col = col.map((c) => c / (c + 0.85));
  return col.map((c) => Math.pow(c, 0.4545));
}

// ------------------------------------------------------------ rasteriser
function project(p) {
  const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
  const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
  const z = vp[2] * p[0] + vp[6] * p[1] + vp[10] * p[2] + vp[14];
  const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
  if (w <= 1e-5) return null;
  return [(x / w * 0.5 + 0.5) * W, (1 - (y / w * 0.5 + 0.5)) * H, z / w, 1 / w];
}

function raster(pos, nrm, uv, idx, kind) {
  for (let i = 0; i < idx.length; i += 3) {
    const ia = idx[i], ib = idx[i + 1], ic = idx[i + 2];
    const A = project([pos[ia * 3], pos[ia * 3 + 1], pos[ia * 3 + 2]]);
    const B = project([pos[ib * 3], pos[ib * 3 + 1], pos[ib * 3 + 2]]);
    const C = project([pos[ic * 3], pos[ic * 3 + 1], pos[ic * 3 + 2]]);
    if (!A || !B || !C) continue;
    const minX = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const minY = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
    if (maxX < minX || maxY < minY) continue;
    const area = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
    if (Math.abs(area) < 1e-9) continue;
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const cx = px + 0.5, cy = py + 0.5;
        let w1 = ((B[0] - A[0]) * (cy - A[1]) - (cx - A[0]) * (B[1] - A[1])) / area;   // C
        let w2 = ((cx - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (cy - A[1])) / area;   // B
        const w0 = 1 - w1 - w2;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * A[2] + w1 * C[2] + w2 * B[2];
        const o = py * W + px;
        if (z >= zbuf[o]) continue;
        // perspective-correct attributes
        const iw = w0 * A[3] + w1 * C[3] + w2 * B[3];
        const b0 = w0 * A[3] / iw, b1 = w1 * C[3] / iw, b2 = w2 * B[3] / iw;
        const world = [
          b0 * pos[ia * 3] + b1 * pos[ic * 3] + b2 * pos[ib * 3],
          b0 * pos[ia * 3 + 1] + b1 * pos[ic * 3 + 1] + b2 * pos[ib * 3 + 1],
          b0 * pos[ia * 3 + 2] + b1 * pos[ic * 3 + 2] + b2 * pos[ib * 3 + 2],
        ];
        const N = v3.norm([
          b0 * nrm[ia * 3] + b1 * nrm[ic * 3] + b2 * nrm[ib * 3],
          b0 * nrm[ia * 3 + 1] + b1 * nrm[ic * 3 + 1] + b2 * nrm[ib * 3 + 1],
          b0 * nrm[ia * 3 + 2] + b1 * nrm[ic * 3 + 2] + b2 * nrm[ib * 3 + 2],
        ]);
        const toEye = v3.sub(eye, world);
        const back = v3.dot(N, toEye) < 0;
        let col;
        if (kind === 'cloth') {
          const U = [
            b0 * uv[ia * 2] + b1 * uv[ic * 2] + b2 * uv[ib * 2],
            b0 * uv[ia * 2 + 1] + b1 * uv[ic * 2 + 1] + b2 * uv[ib * 2 + 1],
          ];
          col = shadeCloth(world, N, U, !back);
        } else {
          col = shadeBody(world, N, !back);
        }
        zbuf[o] = z;
        cbuf[o * 3] = col[0]; cbuf[o * 3 + 1] = col[1]; cbuf[o * 3 + 2] = col[2];
      }
    }
  }
}

// ground first
for (let py = 0; py < H; py++) {
  for (let px = 0; px < W; px++) {
    const g = shadeGround(px, py);
    const o = py * W + px;
    if (!g || g.depth >= 1) { zbuf[o] = Infinity; continue; }
    zbuf[o] = g.depth;
    cbuf[o * 3] = g.col[0]; cbuf[o * 3 + 1] = g.col[1]; cbuf[o * 3 + 2] = g.col[2];
  }
}
raster(body.positions, body.normals, null, body.indices, 'body');
const dressNormals = dress.normals;
raster(Array.from(dress.positions), dressNormals, Array.from(dress.uvs), Array.from(dress.indices), 'cloth');

const rgb = new Uint8Array(W * H * 3);
for (let i = 0; i < W * H; i++) {
  if (zbuf[i] === Infinity) {  // background
    rgb[i * 3] = 26; rgb[i * 3 + 1] = 27; rgb[i * 3 + 2] = 31;
    continue;
  }
  for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.max(0, Math.min(255, Math.round(cbuf[i * 3 + c] * 255)));
}
const out = process.argv[2] ?? 'renders/dress.png';
writePNG(out, W, H, rgb);
console.log(`wrote ${out} (${W}x${H}) — ${FABRIC.name}, ${P.style}/${P.neckline}, ${dress.positions.length / 3} cloth points`);
