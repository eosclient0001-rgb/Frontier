// ============================================================================
//  worker-e2e.mjs — run the BROWSER worker pipeline headlessly in Node.
//  Shims the Worker environment, then posts a 'run' message exactly like app.js
//  would. Validates progress, contract, done payload + ZIP integrity.
//    node tools/worker-e2e.mjs [res] [droplets]
// ============================================================================

import { readFileSync, writeFileSync } from 'node:fs';

const res = parseInt(process.argv[2] || '192');
const droplets = parseInt(process.argv[3] || '0');

// ---- shim WorkerGlobalScope --------------------------------------------------
const listeners = {};
globalThis.self = globalThis;
globalThis.postMessage = (msg) => {
  if (msg.type === 'error') { console.error('WORKER ERROR:', msg.message); process.exit(1); }
  if (msg.type === 'log') { console.log('[log]', msg.message); return; }
  if (msg.type === 'progress') { return; }
  if (msg.type === 'contract') { console.log('[contract]', JSON.stringify(msg.contract, (k,v)=>typeof v==='number'?+v.toFixed(2):v)); return; }
  if (msg.type === 'done') {
    const { sdf, satA, satB, colH, trail, audit, contract, zip, elapsed } = msg;
    console.log('== WORKER DONE ==');
    console.log('dims:', sdf.dims, 'voxel mm:', (sdf.voxel[0] * 1000).toFixed(1), 'clamp:', sdf.clamp.toFixed(2));
    console.log('satA bytes:', satA.byteLength, 'satB:', satB.byteLength, 'colH:', colH.byteLength, 'trail:', trail.byteLength);
    console.log('audit:', JSON.stringify(audit, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
    console.log('contract:', JSON.stringify(contract, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v));
    console.log('elapsed:', elapsed, 's');
    // validate zip
    const zb = Buffer.from(zip);
    console.log('zip:', (zb.length / 1e6).toFixed(1), 'MB, sig:', zb.subarray(0, 4).toString('hex'));
    if (zb.readUInt32LE(0) !== 0x04034b50) throw new Error('bad zip signature');
    // dump for inspection
    writeFileSync('out/e2e_volume.raw', Buffer.from(sdf.data));
    writeFileSync('out/e2e_bundle.zip', zb);
    console.log('e2e OK');
    process.exit(0);
  }
};

process.on('unhandledRejection', (e) => { console.error('UNHANDLED', e); process.exit(1); });

// ---- import the worker (uses `self.onmessage`) -------------------------------
await import('../src/worker.js');

const params = {
  seed: 1337,
  size: [100, 64, 100],
  res,
  style: 'ridged', octaves: 9, lacunarity: 2.0, gain: 0.46, baseFreq: 0.016,
  warp: 8, peakHeight: 30, peakRadius: 40, maskPower: 2.4,
  tiltStrength: 4, tiltAngleDeg: 35, baseHeight: 12, bedrock: 6,
  droplets: droplets || Math.round(res * res * 3.5), maxSteps: 48,
  inertia: 0.06, capacity: 0.09, minSlope: 0.02,
  erosionRate: 0.5, depositionRate: 0.25, evaporation: 0.02,
  erosionDepth: 1.0, stampRadiusVox: 1.15, gravityScale: 0.9,
  talusAngleDeg: 42, talusRate: 0.25, reinitBandVox: 6, incisionRounds: 4,
  arrangement: (process.argv[4] || 'single')
};

let stage = '';
globalThis.dispatchEvent = () => {};
// worker.js registered onmessage via self.onmessage =
const t0 = Date.now();
globalThis.self.onmessage({ data: { type: 'run', params, id: 1 } });
