// ============================================================================
//  sim-test.mjs — Node harness: run the full pipeline headlessly, dump
//  diagnostic images + audit stats. Used to tune erosion realism.
//    node tools/sim-test.mjs [res] [droplets]
// ============================================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import { pngGray8, pngGray16, encodePNG } from '../src/core/png.js';
import { buildBaseTerrain } from '../src/core/terrain.js';
import { erodeSDF } from '../src/core/erosion.js';
import { computeSatMaps } from '../src/core/satmaps.js';

const res = parseInt(process.argv[2] || '96');
const droplets = parseInt(process.argv[3] || '40000');
const params = defaultParams();
params.res = res;
params.droplets = droplets;

console.log(`== Frontier sim test: ${params.size[0]}x${params.size[1]}x${params.size[2]} m @ ${res} grid ==`);

let t0 = Date.now();
const base = buildBaseTerrain(params, () => {});
console.log(`terrain:   ${Date.now() - t0} ms  (octaves ${base.octavesUsed}, voxel ${base.voxel.toFixed(3)} m)`);

t0 = Date.now();
const er = erodeSDF(base.vol, params, { colH: base.colH, onProgress: () => {} });
const dtE = Date.now() - t0;
console.log(`erosion:   ${dtE} ms  (${params.droplets} droplets, ${(params.droplets / dtE * 1000) | 0} drops/s)`);
console.log('audit:    ', JSON.stringify(er.audit, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v));

t0 = Date.now();
const sat = computeSatMaps(base.vol, er.colH, { flow: er.flow, sediment: er.sediment, wear: er.wear });
console.log(`satmaps:   ${Date.now() - t0} ms`);

// ---- sanity checks -----------------------------------------------------------
const vol = base.vol;
let neg = 0, pos = 0;
for (let i = 0; i < vol.data.length; i++) (vol.data[i] < 0 ? neg++ : pos++);
console.log(`field:     ${neg} rock / ${pos} air cells`);

let gSum = 0, gN = 0, gMin = 10, gMax = 0;
const gr = [0, 0, 0];
for (let s = 0; s < 3000; s++) {
  const x = Math.random() * vol.size[0], z = Math.random() * vol.size[2];
  let lo = 0, hi = vol.size[1];
  for (let it = 0; it < 22; it++) {
    const mid = (lo + hi) / 2;
    if (vol.sample(x, mid, z) > 0) hi = mid; else lo = mid;
  }
  vol.grad(x, lo + 0.01, z, gr);
  const gm = Math.hypot(gr[0], gr[1], gr[2]);
  gSum += gm; gN++;
  if (gm < gMin) gMin = gm;
  if (gm > gMax) gMax = gm;
}
console.log(`|grad|:    mean ${(gSum / gN).toFixed(4)}  min ${gMin.toFixed(3)}  max ${gMax.toFixed(3)}  (want ~1 near surface)`);

// ---- images ------------------------------------------------------------------
mkdirSync('out', { recursive: true });
const nx = vol.nx, nz = vol.nz;
const { colH } = er;

let hMin = Infinity, hMax = -Infinity;
for (let i = 0; i < colH.length; i++) { if (colH[i] < hMin) hMin = colH[i]; if (colH[i] > hMax) hMax = colH[i]; }

// hillshade + hypsometric tint
const img = new Uint8Array(nx * nz * 3);
for (let k = 0; k < nz; k++) {
  for (let i = 0; i < nx; i++) {
    const idx = k * nx + i;
    const at = (ii, kk) => colH[Math.min(nz - 1, Math.max(0, kk)) * nx + Math.min(nx - 1, Math.max(0, ii))];
    const dx = (at(i + 1, k) - at(i - 1, k)) / (2 * base.voxel);
    const dz = (at(i, k + 1) - at(i, k - 1)) / (2 * base.voxel);
    const nl = Math.hypot(dx, dz, 1);
    const lam = Math.max(0, (-dx * 0.55 - dz * 0.45 + 1.0) / (nl * 1.35));
    const shade = Math.min(1.15, 0.28 + lam);
    const hN = (colH[idx] - hMin) / (hMax - hMin);
    let r, g, b;
    if (hN < 0.35) { const t = hN / 0.35; r = 60 + t * 40; g = 96 + t * 30; b = 48 + t * 20; }
    else if (hN < 0.75) { const t = (hN - 0.35) / 0.4; r = 100 + t * 60; g = 126 - t * 40; b = 68 - t * 18; }
    else { const t = (hN - 0.75) / 0.25; r = 160 + t * 95; g = 86 + t * 169; b = 50 + t * 205; }
    img[idx * 3] = Math.min(255, r * shade);
    img[idx * 3 + 1] = Math.min(255, g * shade);
    img[idx * 3 + 2] = Math.min(255, b * shade);
  }
}
writeFileSync('out/heightmap_shaded.png', encodePNG(nx, nz, img, { colorType: 2 }));

const u16 = new Uint16Array(nx * nz);
for (let i = 0; i < u16.length; i++) u16[i] = Math.max(0, Math.min(65535, ((colH[i] - hMin) / (hMax - hMin)) * 65535));
writeFileSync('out/height_raw16.png', pngGray16(nx, nz, u16));

for (const key of ['flow', 'sediment', 'wear', 'peaks', 'pointiness', 'wetness'])
  writeFileSync(`out/sat_${key}.png`, pngGray8(nx, nz, sat.maps[key]));

writeFileSync('out/sdf_slice.png', slicePNG(vol, (nz / 2) | 0));
console.log('wrote out/*.png');

function slicePNG(vol, k) {
  const { ny, nx } = vol;
  const img = new Uint8Array(nx * ny * 3);
  let mn = 0, mx = 1e-3;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = vol.data[(k * ny + j) * nx + i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = vol.data[(k * ny + j) * nx + i];
    const idx = (j * nx + i) * 3;
    if (v < 0) {
      const s = 30 + (Math.abs(v) / (Math.abs(mn) + 1e-6)) * 55;
      const band = Math.abs(((Math.abs(v) * 4) % 1) - 0.5) < 0.05 ? 45 : 0;
      img[idx] = s + band; img[idx + 1] = s * 0.95 + band; img[idx + 2] = s * 1.05 + band;
    } else {
      const t = Math.min(1, v / mx);
      img[idx] = 40 + t * 200; img[idx + 1] = 90 + t * 140; img[idx + 2] = 225 - t * 150;
    }
  }
  return encodePNG(nx, ny, img, { colorType: 2 });
}

function defaultParams() {
  return {
    seed: 1337,
    size: [100, 64, 100], res: 128,
    style: 'ridged', octaves: 9, lacunarity: 2.0, gain: 0.46, baseFreq: 0.016,
    warp: 8, peakHeight: 30, peakRadius: 40, maskPower: 2.4,
    tiltStrength: 4, tiltAngleDeg: 35, baseHeight: 12, bedrock: 6,
    droplets: 120000, maxSteps: 48, inertia: 0.06, capacity: 0.09, minSlope: 0.02,
    erosionRate: 0.5, depositionRate: 0.25, evaporation: 0.02,
    erosionDepth: 1.0, stampRadiusVox: 1.15, gravityScale: 0.9,
    talusAngleDeg: 42, talusRate: 0.25, reinitBandVox: 6, incisionRounds: 4
  };
}
