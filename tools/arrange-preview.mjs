// renders a 2x2 arrangement contact sheet -> docs/preview_arrangements.png
import { writeFileSync } from 'node:fs';
import { encodePNG } from '../src/core/png.js';
import { buildBaseTerrain } from '../src/core/terrain.js';
import { erodeSDF } from '../src/core/erosion.js';

const P = { seed:1337, size:[100,64,100], res:128, style:'ridged', octaves:9, lacunarity:2.0,
  gain:0.46, baseFreq:0.016, warp:8, peakHeight:30, peakRadius:40, maskPower:2.4, tiltStrength:4,
  tiltAngleDeg:35, baseHeight:12, bedrock:6, droplets:45000, maxSteps:48, inertia:0.06, capacity:0.09,
  minSlope:0.02, erosionRate:0.5, depositionRate:0.25, evaporation:0.02, erosionDepth:1.0,
  stampRadiusVox:1.15, gravityScale:0.9, talusAngleDeg:42, talusRate:0.25, reinitBandVox:6, incisionRounds:4 };

const tiles = ['single', 'twin', 'ridge', 'range'];
const n = P.res;
const sheet = new Uint8Array(n * 2 * n * 2 * 3);

for (let t = 0; t < 4; t++) {
  const p = { ...P, arrangement: tiles[t] };
  const base = buildBaseTerrain(p, () => {});
  const er = erodeSDF(base.vol, p, { colH: base.colH, onProgress: () => {} });
  const ox = (t % 2) * n, oy = ((t / 2) | 0) * n;
  shadeInto(sheet, ox, oy, n * 2, n * 2, er.colH, base.voxel, n);
  console.log('rendered', tiles[t]);
}
writeFileSync('docs/preview_arrangements.png', encodePNG(n * 2, n * 2, sheet, { colorType: 2 }));
console.log('docs/preview_arrangements.png written');

function shadeInto(dst, ox, oy, W, H, colH, vox, n) {
  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < colH.length; i++) { if (colH[i] < hMin) hMin = colH[i]; if (colH[i] > hMax) hMax = colH[i]; }
  const at = (i, k) => colH[Math.min(n - 1, Math.max(0, k)) * n + Math.min(n - 1, Math.max(0, i))];
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      const dx = (at(i + 1, k) - at(i - 1, k)) / (2 * vox);
      const dz = (at(i, k + 1) - at(i, k - 1)) / (2 * vox);
      const nl = Math.hypot(dx, dz, 1);
      const lam = Math.max(0, (-dx * 0.55 - dz * 0.45 + 1.0) / (nl * 1.3));
      const sh = Math.min(1.15, 0.3 + lam);
      const hN = (colH[k * n + i] - hMin) / (hMax - hMin);
      let r, g, b;
      if (hN < 0.35) { const t = hN / 0.35; r = 62 + t * 42; g = 92 + t * 30; b = 52 + t * 20; }
      else if (hN < 0.72) { const t = (hN - 0.35) / 0.37; r = 104 + t * 58; g = 122 - t * 36; b = 72 - t * 18; }
      else { const t = (hN - 0.72) / 0.28; r = 162 + t * 90; g = 86 + t * 165; b = 54 + t * 198; }
      const di = ((oy + k) * W + ox + i) * 3;
      dst[di] = Math.min(255, r * sh); dst[di + 1] = Math.min(255, g * sh); dst[di + 2] = Math.min(255, b * sh);
    }
  }
}
