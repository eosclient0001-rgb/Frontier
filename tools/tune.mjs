// ============================================================================
//  tune.mjs — render base vs eroded shaded relief for parameter iteration
//    node tools/tune.mjs
// ============================================================================

import { writeFileSync } from 'node:fs';
import { encodePNG } from '../src/core/png.js';
import { buildBaseTerrain } from '../src/core/terrain.js';
import { erodeSDF } from '../src/core/erosion.js';

const params = {
  seed: 1337,
  size: [100, 64, 100], res: 160,
  style: 'ridged', octaves: 8, lacunarity: 2.0, gain: 0.46, baseFreq: 0.016,
  warp: 8, peakHeight: 30, peakRadius: 40, maskPower: 2.4,
  tiltStrength: 4, tiltAngleDeg: 35, baseHeight: 12, bedrock: 6,
  droplets: 60000, maxSteps: 48, inertia: 0.06, capacity: 0.09, minSlope: 0.02,
  erosionRate: 0.5, depositionRate: 0.25, evaporation: 0.02,
  erosionDepth: 1.0, stampRadiusVox: 1.15, gravityScale: 0.9,
  talusAngleDeg: 42, talusRate: 0.25, reinitBandVox: 6, incisionRounds: 4
};

const base = buildBaseTerrain(params, () => {});
const er = erodeSDF(base.vol, params, { colH: base.colH, onProgress: () => {} });
const a = er.audit;
console.log(`voxel ${a.voxel[0].toFixed(3)}m  meanCut ${a.meanCut.toFixed(3)}  maxCut ${a.maxCut.toFixed(2)}  chanCut ${a.channelMeanCut.toFixed(3)} (${(a.channelMeanCut / a.voxMax).toFixed(2)} vox)  dep ${a.depositVolume.toFixed(0)}  carve ${a.carveVolume.toFixed(0)}`);

const nx = base.vol.nx, nz = base.vol.nz;
writeFileSync('out/tune_base.png', shade(nx, nz, base.heights0, base.voxel));
writeFileSync('out/tune_eroded.png', shade(nx, nz, er.colH, base.voxel));
// flow map quick view
const flow8 = new Uint8Array(nx * nz);
let fmax = 0;
for (let i = 0; i < er.flow.length; i++) if (er.flow[i] > fmax) fmax = er.flow[i];
for (let i = 0; i < er.flow.length; i++) flow8[i] = Math.min(255, 255 * Math.pow(Math.log1p(er.flow[i]) / Math.log1p(fmax), 0.6));
writeFileSync('out/tune_flow.png', encodePNG(nx, nz, flow8, { colorType: 0 }));

function shade(nx, nz, colH, vox) {
  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < colH.length; i++) { if (colH[i] < hMin) hMin = colH[i]; if (colH[i] > hMax) hMax = colH[i]; }
  const img = new Uint8Array(nx * nz * 3);
  const at = (i, k) => colH[Math.min(nz - 1, Math.max(0, k)) * nx + Math.min(nx - 1, Math.max(0, i))];
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const idx = k * nx + i;
      const dx = (at(i + 1, k) - at(i - 1, k)) / (2 * vox);
      const dz = (at(i, k + 1) - at(i, k - 1)) / (2 * vox);
      const nl = Math.hypot(dx, dz, 1);
      const lam = Math.max(0, (-dx * 0.55 - dz * 0.45 + 1.0) / (nl * 1.3));
      const shade = Math.min(1.15, 0.3 + lam);
      const hN = (colH[idx] - hMin) / (hMax - hMin);
      let r, g, b;
      if (hN < 0.35) { const t = hN / 0.35; r = 62 + t * 42; g = 92 + t * 30; b = 52 + t * 20; }
      else if (hN < 0.72) { const t = (hN - 0.35) / 0.37; r = 104 + t * 58; g = 122 - t * 36; b = 72 - t * 18; }
      else { const t = (hN - 0.72) / 0.28; r = 162 + t * 90; g = 86 + t * 165; b = 54 + t * 198; }
      img[idx * 3] = Math.min(255, r * shade);
      img[idx * 3 + 1] = Math.min(255, g * shade);
      img[idx * 3 + 2] = Math.min(255, b * shade);
    }
  }
  return encodePNG(nx, nz, img, { colorType: 2 });
}
