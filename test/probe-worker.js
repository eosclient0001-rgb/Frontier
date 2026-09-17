'use strict';
const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const workerDir = path.join(__dirname, '..', 'js');

globalThis.self = globalThis;
globalThis.importScripts = (p) => {
  (0, eval)(fs.readFileSync(path.join(workerDir, p.replace(/^\.\//, '')), 'utf8'));
};
globalThis.importScripts('./terrain-core.js');

const res = TerrainCore.generateMountain({
  n: 16, seed: 7, heightM: 38, octaves: 6, persistence: 0.5,
  ridgedMix: 0.55, ridgeExp: 2.2, warp: 0.55, sharpness: 1.9, baseFreq: 2.6, sizeM: 100
});

parentPort.postMessage({
  proto: Object.prototype.toString.call(res.h),
  isArrayBufferView: ArrayBuffer.isView(res.h),
  ctor: res.h && res.h.constructor && res.h.constructor.name,
  byteLength: res.h && res.h.byteLength,
  isFloat32: res.h instanceof Float32Array,
  hasBuffer: !!(res.h && res.h.buffer),
  bufferIsArrayBuffer: res.h && res.h.buffer instanceof ArrayBuffer,
  bufCtor: res.h && res.h.buffer && res.h.buffer.constructor.name,
  detachOK: (() => {
    try {
      const t = new Float32Array(4);
      parentPort.postMessage({ ping: true }, [t]);
      return 'plain transfer works';
    } catch (e) {
      return 'plain transfer FAILED: ' + e.message;
    }
  })()
});
