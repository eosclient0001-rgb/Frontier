/* Parent: drives the emulated browser worker through the full protocol. */
'use strict';
const { Worker } = require('worker_threads');
const path = require('path');

const w = new Worker(path.join(__dirname, 'real-worker.js'));

function send(msg, transfer = []) {
  w.postMessage(msg, transfer);
}

const n = 256;
let step = 0;

w.on('message', (m) => {
  if (m.type === 'worker-exception') {
    console.log('REPRODUCED →', m.message);
    process.exit(1);
  }
  if (m.type === 'erode-progress') return;

  if (step === 0 && m.type === 'height') {
    console.log(`1 generate → ${m.type}: h is ${Object.prototype.toString.call(m.h)}, len ${m.h && m.h.length}, detached-on-arrival OK`);
    step = 1;
    send({ type: 'erode', h: m.h, n, params: {
      sizeM: 100, particles: 40000, iterations: 6, stepsPerIter: 2,
      rain: 1, capacityK: 0.9, cutVoxels: 0.25, depVoxels: 0.35, stepVoxels: 1,
      evap: 0.995, respawnFrac: 0.25, slideLimit: 1.1, massWaste: 1, massWasteLimit: 0.5, seed: 7
    } });
  } else if (step === 1 && m.type === 'eroded') {
    console.log(`2 erode → ${m.type}: eroded ${m.stats.erodedVol.toFixed(0)} m³`);
    step = 2;
    send({
      type: 'splat', h: m.h, flow: m.flow, dep: m.dep, n, Hmax: m.stats.max, sizeM: 100,
      params: { flow: 1.4, sediment: 1.2, peak: 1, pines: 1, base: 1, seed: 7 }
    });
  } else if (step === 2 && m.type === 'splat') {
    console.log(`3 splat → ${m.type}: albedo ${m.albedo.length} B`);
    console.log('\nREAL transfer-semantics test: ALL OK');
    process.exit(0);
  }
});
w.on('error', (e) => { console.log('worker error event:', e.message); process.exit(1); });

send({ type: 'generate', params: {
  sizeM: 100, seed: 7, n, heightM: 38, octaves: 6, persistence: 0.5,
  ridgedMix: 0.55, ridgeExp: 2.2, warp: 0.55, sharpness: 1.9, baseFreq: 2.6
} });
