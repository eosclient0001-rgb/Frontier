/* Simulates the browser Web Worker (vm sandbox) and drives the exact
 * main.js message protocol end-to-end: generate → erode → splat. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const posts = [];
const sandbox = {
  console,
  performance: { now: () => Date.now() }
};
const vmCtx = vm.createContext(sandbox);
/* in a dedicated worker `self` IS the global scope */
sandbox.self = sandbox;
sandbox.importScripts = (p) => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', p.replace(/^\.\//, '')), 'utf8');
  vm.runInContext(src, vmCtx);
};
sandbox.postMessage = (msg) => { posts.push(msg); };
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'terrain-worker.js'), 'utf8'), vmCtx);

function send(msg) {
  posts.length = 0;
  vmCtx.self.onmessage({ data: msg });
  return posts;
}

const n = 256;
const genParams = { sizeM: 100, seed: 777, n, heightM: 38, octaves: 6, persistence: 0.5, ridgedMix: 0.55, ridgeExp: 2.2, warp: 0.55, sharpness: 1.9, baseFreq: 2.6 };

// 1 · generate
let out = send({ type: 'generate', params: genParams });
let m = out[0];
console.log('generate →', m.type, m.h.length, 'cells,', m.stats.max.toFixed(1) + ' m peak,', m.ms.toFixed(0) + ' ms');
if (m.type !== 'height') throw new Error('bad generate response');

// 2 · erode
const eroParams = { sizeM: 100, particles: 80000, iterations: 10, stepsPerIter: 2, rain: 1.0, capacityK: 0.9, cutVoxels: 0.25, depVoxels: 0.35, stepVoxels: 1.0, evap: 0.995, respawnFrac: 0.25, slideLimit: 1.1, massWaste: 2, massWasteLimit: 0.5, seed: 777 };
out = send({ type: 'erode', h: m.h, n, params: eroParams });
const progress = out.filter(x => x.type === 'erode-progress');
m = out[out.length - 1];
console.log('erode →', m.type, 'eroded', m.stats.erodedVol.toFixed(0) + ' m³,', 'deposited', m.stats.depositedVol.toFixed(0) + ' m³,', m.ms.toFixed(0) + ' ms,', progress.length, 'progress ticks');
if (m.type !== 'eroded') throw new Error('bad erode response');
if (!m.flow || !m.dep) throw new Error('missing flow/dep');

// 3 · splat
out = send({
  type: 'splat', h: m.h, flow: m.flow, dep: m.dep, n, Hmax: m.stats.max, sizeM: 100,
  params: { flow: 1.4, sediment: 1.2, peak: 1.0, pines: 1.0, base: 1.0, seed: 777 }
});
m = out[0];
console.log('splat →', m.type, 'albedo', m.albedo.length, 'B, vis', m.vis.length, 'B,', m.ms.toFixed(0) + ' ms');
if (m.type !== 'splat') throw new Error('bad splat response');
if (m.albedo.length !== n * n * 3 || m.vis.length !== n * n * 4) throw new Error('bad texture sizes');
if (m.albedo.some(v => Number.isNaN(v))) throw new Error('NaN in albedo');

console.log('\nWorker protocol simulation: ALL OK');
