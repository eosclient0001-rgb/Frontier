/**
 * Renders the CPU reference simulation to a PNG so the RESULTING LANDFORM can
 * be inspected without a GPU.
 *
 * Numeric tests prove the solver is stable and that hard rock erodes slower.
 * They cannot show whether the output actually looks like a canyon. This
 * renders three panels:
 *
 *   left   hillshaded plan view (is there a branching drainage network?)
 *   middle cross-section through the canyon (is the profile stair-stepped,
 *          with cliffs on hard beds and benches on soft ones?)
 *   right  the same section coloured by bed hardness
 *
 *   node tools/render-profile.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
//  Minimal PNG writer (no dependencies)
// ---------------------------------------------------------------------------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(path, w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ---------------------------------------------------------------------------
//  Simulation (same arithmetic as the WGSL passes)
// ---------------------------------------------------------------------------
const N = 128;
const CELL = 4.0;
const GRAV = 9.81;
const idx = (x, z) => z * N + x;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function bedHardness(y, bedThickness = 14, capFrac = 0.30, contrast = 3.0) {
  const t = y / bedThickness;
  const bi = Math.floor(t);
  let r = Math.abs(Math.sin(bi * 12.9898) * 43758.5453); r -= Math.floor(r);
  const thr = 1 - capFrac;
  const h = r > thr ? 0.62 + 0.38 * (r - thr) / (1 - thr) : r * thr * 0.55;
  return clamp(0.5 + (h - 0.5) * contrast, 0.02, 1);
}

const S = {
  h: new Float64Array(N * N), water: new Float64Array(N * N),
  sed: new Float64Array(N * N), reg: new Float64Array(N * N),
  fL: new Float64Array(N * N), fR: new Float64Array(N * N),
  fD: new Float64Array(N * N), fU: new Float64Array(N * N),
  vx: new Float64Array(N * N), vz: new Float64Array(N * N),
};

for (let z = 0; z < N; z++) {
  for (let x = 0; x < N; x++) {
    let h = 240 - (z / N) * 60;
    h += 10 * Math.sin(x * 0.11) * Math.cos(z * 0.09);
    h += 5 * Math.sin(x * 0.29 + z * 0.21);
    const cx = N * 0.5 + Math.sin((z / N) * Math.PI * 1.6) * 9;
    const d = Math.abs(x - cx) / 7;
    h -= 55 * Math.max(0, 1 - d * d);
    S.h[idx(x, z)] = h;
  }
}
const h0 = Float64Array.from(S.h);

const P = { dt: 0.03, rain: 0.014, inflow: 1.1, evap: 0.014, pipeA: 1.0,
            kC: 1.8, kE: 0.75, kD: 0.5, minSlope: 0.03, repose: 33, talusRate: 0.7 };

function step() {
  const { dt } = P; const area = CELL * CELL;
  for (let i = 0; i < N * N; i++) S.water[i] += P.rain * dt;
  for (let x = 0; x < N; x++) {
    const d = Math.abs(x - N * 0.5) / 7;
    S.water[idx(x, 0)] += P.inflow * Math.exp(-d * d * 2.5) * dt;
  }
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = idx(x, z); const surf = S.h[i] + S.water[i];
    const sAt = (xx, zz) => (xx < 0 || zz < 0 || xx >= N || zz >= N) ? surf : S.h[idx(xx, zz)] + S.water[idx(xx, zz)];
    let a = Math.max(0, S.fL[i] + dt * P.pipeA * GRAV * (surf - sAt(x - 1, z)) / CELL);
    let b = Math.max(0, S.fR[i] + dt * P.pipeA * GRAV * (surf - sAt(x + 1, z)) / CELL);
    let c = Math.max(0, S.fD[i] + dt * P.pipeA * GRAV * (surf - sAt(x, z - 1)) / CELL);
    let e = Math.max(0, S.fU[i] + dt * P.pipeA * GRAV * (surf - sAt(x, z + 1)) / CELL);
    if (x === 0) a = 0; if (x === N - 1) b = 0; if (z === 0) c = 0;
    const tot = (a + b + c + e) * dt, av = S.water[i] * area;
    if (tot > 1e-12) { const k = Math.min(1, av / tot); a *= k; b *= k; c *= k; e *= k; }
    S.fL[i] = a; S.fR[i] = b; S.fD[i] = c; S.fU[i] = e;
  }
  const nw = new Float64Array(N * N);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = idx(x, z);
    const G = (xx, zz, w) => (xx < 0 || zz < 0 || xx >= N || zz >= N) ? 0 :
      (w === 'R' ? S.fR : w === 'L' ? S.fL : w === 'U' ? S.fU : S.fD)[idx(xx, zz)];
    const inf = G(x - 1, z, 'R') + G(x + 1, z, 'L') + G(x, z - 1, 'U') + G(x, z + 1, 'D');
    const out = S.fL[i] + S.fR[i] + S.fD[i] + S.fU[i];
    const w0 = S.water[i]; let w1 = Math.max(0, w0 + (inf - out) * dt / area);
    const wa = Math.max(0.5 * (w0 + w1), 0.004);
    let vx = 0.5 * (G(x - 1, z, 'R') - S.fL[i] + S.fR[i] - G(x + 1, z, 'L')) / (CELL * wa);
    let vz = 0.5 * (G(x, z - 1, 'U') - S.fD[i] + S.fU[i] - G(x, z + 1, 'D')) / (CELL * wa);
    const vl = Math.hypot(vx, vz); if (vl > 24) { vx *= 24 / vl; vz *= 24 / vl; }
    S.vx[i] = vx; S.vz[i] = vz;
    // depth-independent loss (infiltration) + weak proportional evaporation
    w1 = Math.max(0, w1 - P.evap * dt * 0.35);
    nw[i] = w1 * Math.max(0, 1 - P.evap * dt * 0.15);
  }
  S.water.set(nw);
  for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
    const i = idx(x, z);
    const gx = (S.h[idx(x - 1, z)] - S.h[idx(x + 1, z)]) / (2 * CELL);
    const gz = (S.h[idx(x, z - 1)] - S.h[idx(x, z + 1)]) / (2 * CELL);
    const sm = Math.hypot(gx, gz);
    const sinA = Math.max(sm / Math.sqrt(1 + sm * sm), P.minSlope);
    const sp = Math.hypot(S.vx[i], S.vz[i]), dp = S.water[i];
    let C = P.kC * sinA * sp * (1 - Math.exp(-dp * 6)) * (1 / (1 + dp * 0.35));
    if (dp < 1e-4) C = 0;
    const hard = bedHardness(S.h[i]);
    const resist = 1 / (0.12 + hard * hard * 2.6);
    let dh;
    if (C > S.sed[i]) {
      const am = P.kE * (C - S.sed[i]) * dt;
      const fr = Math.min(S.reg[i], am); S.reg[i] -= fr;
      const ir = (am - fr) * resist; dh = -(fr + ir); S.sed[i] += fr + ir;
    } else {
      const am = P.kD * (S.sed[i] - C) * dt; dh = am; S.sed[i] -= am; S.reg[i] += am;
    }
    S.h[i] += clamp(dh, -0.45 * dt * 30, 0.45 * dt * 30);
  }
  const ns = new Float64Array(N * N);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = idx(x, z);
    const fx = clamp(x - S.vx[i] * dt / CELL, 0, N - 1.001);
    const fz = clamp(z - S.vz[i] * dt / CELL, 0, N - 1.001);
    const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
    const g = (xx, zz) => S.sed[idx(Math.min(xx, N - 1), Math.min(zz, N - 1))];
    ns[i] = Math.max(0, (g(x0, z0) * (1 - tx) + g(x0 + 1, z0) * tx) * (1 - tz)
                      + (g(x0, z0 + 1) * (1 - tx) + g(x0 + 1, z0 + 1) * tx) * tz);
  }
  S.sed.set(ns);
  // Angle of repose depends on the MATERIAL, exactly as in thermal.wgsl:
  // loose debris rests at ~33 deg, but bedrock stands far steeper (up to ~87
  // deg for the hardest beds). Using one flat angle for everything is what
  // turns a canyon into a smooth V-valley.
  const reposeT = Math.tan(P.repose * Math.PI / 180) * CELL;
  for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
    const i = idx(x, z);
    const hard = bedHardness(S.h[i]);
    const rockT = Math.tan((52 + 35 * hard) * Math.PI / 180) * CELL;
    const loose = clamp(S.reg[i] / 0.6, 0, 1);
    const md = rockT * (1 - loose) + reposeT * loose;
    const nb = [idx(x - 1, z), idx(x + 1, z), idx(x, z - 1), idx(x, z + 1)];
    let tot = 0; const ex = nb.map((j) => { const d = S.h[i] - S.h[j]; const e = d > md ? d - md : 0; tot += e; return e; });
    if (tot > 1e-9) {
      const bud = Math.min(tot * 0.5, tot) * clamp(P.talusRate * dt * 4, 0, 1); let mv = 0;
      nb.forEach((j, k) => { if (ex[k] > 0) { const a = bud * (ex[k] / tot); S.h[j] += a; S.reg[j] += a; mv += a; } });
      S.h[i] -= mv; S.reg[i] = Math.max(0, S.reg[i] - mv);
    }
  }
}

const STEPS = 2500;
for (let i = 0; i < STEPS; i++) step();

// ---------------------------------------------------------------------------
//  Render
// ---------------------------------------------------------------------------
const PW = 300, PH = 300, GAP = 10;
const W = PW * 3 + GAP * 4, H = PH + GAP * 2 + 22;
const img = Buffer.alloc(W * H * 3, 18);
const px = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3; img[o] = clamp(r, 0, 255); img[o + 1] = clamp(g, 0, 255); img[o + 2] = clamp(b, 0, 255);
};

// --- Panel 1: hillshaded plan view ---
{
  const ox = GAP, oy = GAP + 22;
  const sun = [-0.6, 0.55, -0.58];
  const sl = Math.hypot(...sun); const S3 = sun.map((v) => v / sl);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const gx = Math.floor(x / PW * N), gz = Math.floor(y / PH * N);
    const i = idx(clamp(gx, 1, N - 2), clamp(gz, 1, N - 2));
    const dhx = (S.h[idx(gx - 1, gz)] - S.h[idx(gx + 1, gz)]) / (2 * CELL);
    const dhz = (S.h[idx(gx, gz - 1)] - S.h[idx(gx, gz + 1)]) / (2 * CELL);
    let nx = dhx, ny = 1, nz = dhz; const nl = Math.hypot(nx, ny, nz);
    nx /= nl; ny /= nl; nz /= nl;
    const lam = Math.max(0, nx * S3[0] + ny * S3[1] + nz * S3[2]);
    const hard = bedHardness(S.h[i]);
    let r = 150 + hard * 70, g = 92 + hard * 62, b = 62 + hard * 55;
    const sh = 0.25 + 0.85 * lam;
    r *= sh; g *= sh; b *= sh;
    const w = S.water[i];
    if (w > 0.05) { const t = Math.min(1, w * 2.2); r = r * (1 - t) + 70 * t; g = g * (1 - t) + 105 * t; b = b * (1 - t) + 120 * t; }
    px(ox + x, oy + y, r, g, b);
  }
}

// --- Panel 2: cross-section, coloured as rock ---
const secZ = Math.floor(N * 0.62);
{
  const ox = GAP * 2 + PW, oy = GAP + 22;
  const hs = []; for (let x = 0; x < N; x++) hs.push(S.h[idx(x, secZ)]);
  const hi = Math.max(...hs) + 12, lo = Math.min(...hs) - 12;
  for (let x = 0; x < PW; x++) {
    const gx = clamp(Math.floor(x / PW * N), 0, N - 1);
    const surf = S.h[idx(gx, secZ)];
    const wtop = surf + S.water[idx(gx, secZ)];
    for (let y = 0; y < PH; y++) {
      const wy = hi - (y / PH) * (hi - lo);
      if (wy <= surf) {
        const hard = bedHardness(wy);
        const r = 118 + hard * 96, g = 62 + hard * 84, b = 44 + hard * 76;
        const sh = 0.72 + 0.28 * Math.sin(wy * 0.4);
        px(ox + x, oy + y, r * sh, g * sh, b * sh);
      } else if (wy <= wtop) {
        px(ox + x, oy + y, 62, 96, 112);
      } else {
        const t = y / PH;
        px(ox + x, oy + y, 40 + t * 26, 44 + t * 24, 54 + t * 22);
      }
    }
  }
  // original profile as a dashed line
  for (let x = 0; x < PW; x += 1) {
    const gx = clamp(Math.floor(x / PW * N), 0, N - 1);
    const y = Math.round((hi - h0[idx(gx, secZ)]) / (hi - lo) * PH);
    if (x % 6 < 3) px(ox + x, oy + y, 240, 200, 120);
  }
}

// --- Panel 3: same section, hardness only ---
{
  const ox = GAP * 3 + PW * 2, oy = GAP + 22;
  const hs = []; for (let x = 0; x < N; x++) hs.push(S.h[idx(x, secZ)]);
  const hi = Math.max(...hs) + 12, lo = Math.min(...hs) - 12;
  for (let x = 0; x < PW; x++) {
    const gx = clamp(Math.floor(x / PW * N), 0, N - 1);
    const surf = S.h[idx(gx, secZ)];
    for (let y = 0; y < PH; y++) {
      const wy = hi - (y / PH) * (hi - lo);
      const hard = bedHardness(wy);
      if (wy <= surf) {
        const v = 40 + hard * 200;
        px(ox + x, oy + y, v, v * 0.92, v * 0.80);
      } else {
        const v = 12 + hard * 40;
        px(ox + x, oy + y, v * 0.5, v * 0.5, v * 0.6);
      }
    }
  }
}

writePNG('tools/out-profile.png', W, H, img);

// ---------------------------------------------------------------------------
//  Numeric summary of the section
// ---------------------------------------------------------------------------
let cliffs = 0, benches = 0;
const prof = []; for (let x = 0; x < N; x++) prof.push(S.h[idx(x, secZ)]);
for (let x = 1; x < N - 1; x++) {
  const g = Math.abs(prof[x + 1] - prof[x]) / CELL;
  const ang = Math.atan(g) * 180 / Math.PI;
  if (ang > 45) cliffs++;
  if (ang < 12) benches++;
}
const eroded = h0.reduce((a, v, i) => a + (v - S.h[i]), 0) / (N * N);
console.log(`steps            ${STEPS}`);
console.log(`mean erosion     ${eroded.toFixed(2)} m`);
console.log(`section relief   ${(Math.max(...prof) - Math.min(...prof)).toFixed(1)} m`);
console.log(`steep (>45°)     ${cliffs} cells   flat (<12°) ${benches} cells`);
console.log(`stepped profile  ${cliffs > 4 && benches > 12 ? 'YES — cliffs and benches both present' : 'weak'}`);
// Drainage statistics: a desert must have DRY ground and WET channels, not a
// uniform sheet of standing water.
const ws = Array.from(S.water).sort((a, b) => a - b);
const q = (f) => ws[Math.floor(f * (ws.length - 1))];
const dry = ws.filter((w) => w < 0.02).length / ws.length;
console.log(`water median     ${q(0.5).toFixed(4)} m   p95 ${q(0.95).toFixed(3)} m   max ${q(1).toFixed(2)} m`);
console.log(`dry ground       ${(dry * 100).toFixed(0)}% of cells below 2 cm`);
console.log(`channel contrast ${(q(1) / Math.max(q(0.5), 1e-6)).toFixed(0)}x  (max vs median depth)`);
console.log('wrote tools/out-profile.png');
