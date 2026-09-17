/* Frontier — engine smoke test (Node) */
'use strict';
const T = require('../js/terrain-core.js');

function check(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) process.exitCode = 1;
}

const sizeM = 100;
const n = 256;
const cell = sizeM / (n - 1);

// 1 · generation
const g = T.generateMountain({
  n, seed: 1337, heightM: 38, octaves: 6, persistence: 0.5,
  ridgedMix: 0.55, ridgeExp: 2.2, warp: 0.55, sharpness: 1.9, baseFreq: 2.6, sizeM
});
const finite = g.h.every(Number.isFinite);
check(`generate: all finite (${g.h.length} cells)`, finite);
check(`generate: peak ≈ heightM (max=${g.stats.max.toFixed(2)} m, H=38)`,
  g.stats.max > 30 && g.stats.max <= 40);
check(`generate: base ~0 (min=${g.stats.min.toFixed(3)})`, g.stats.min >= -1e-6 && g.stats.min < 0.5);
check(`generate: mean in sane band (${g.stats.mean.toFixed(2)} m)`, g.stats.mean > 3 && g.stats.mean < 15);

// roughness
let rough = 0;
for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
  const k = j * n + i;
  rough += Math.abs(g.h[k] - g.h[k + 1]) + Math.abs(g.h[k] - g.h[k + n]);
}
rough /= ((n - 2) * (n - 2) * 2);
check(`generate: cell roughness sane (${rough.toFixed(3)} m/cell)`, rough > 0.002 && rough < 0.5);

// 2 · hydraulic erosion
const erodeParams = {
  seed: 42, sizeM, particles: 60000, iterations: 12, stepsPerIter: 2,
  rain: 1.0, capacityK: 0.9, cutVoxels: 0.25, depVoxels: 0.35, stepVoxels: 1.0,
  evap: 0.995, respawnFrac: 0.25, slideLimit: 1.1
};
const t0 = Date.now();
const e = T.runHydraulic(g.h, n, erodeParams);
const erodeMs = Date.now() - t0;
check(`erode: eroded volume positive (${e.stats.erodedVol.toFixed(1)} m³)`, e.stats.erodedVol > 0);
check(`erode: deposited volume positive (${e.stats.depositedVol.toFixed(1)} m³)`, e.stats.depositedVol > 0);
check('erode: no NaN after erosion', g.h.every(Number.isFinite));
let hMax = 0; for (let i = 0; i < g.h.length; i++) if (g.h[i] > hMax) hMax = g.h[i];
check(`erode: peak lowered (38 → ${hMax.toFixed(2)} m)`, hMax < 38 && hMax > 25);
console.log(`      erode 60k particles × 12 iters on ${n}² in ${erodeMs} ms`);

// 3 · splat maps
const s = T.computeSplatMaps(g.h, e.flow, e.dep, n, {
  seed: 1337, Hmax: hMax, sizeM,
  intensities: { flow: 1.4, sediment: 1.2, peak: 1.0, pines: 1.0, base: 1.0 }
}, sizeM);
check('splat: albedo filled', s.albedo.length === n * n * 3 && s.albedo.some(v => v > 0));
check('splat: vis filled', s.vis.length === n * n * 4);
let wsum = 0;
for (let i = 0; i < n * n; i++) {
  const o = i * 5;
  const t = s.weights[o] + s.weights[o + 1] + s.weights[o + 2] + s.weights[o + 3] + s.weights[o + 4];
  wsum += Math.abs(t - 1);
}
check(`splat: weights normalise to 1 (avg err ${(wsum / (n * n) * 1000).toFixed(3)}‰)`, wsum < 0.01 * n * n);

// channel sanity: peak channel concentrated at the summit
let peakPix = 0;
for (let i = 0; i < n * n; i++) if (s.weights[i * 5 + 2] > 0.5) peakPix++;
check(`splat: peak channel exists (${((peakPix / (n * n)) * 100).toFixed(1)}% of cells)`, peakPix > 50 && peakPix < 40000);

console.log('\nEngine smoke test complete.');
