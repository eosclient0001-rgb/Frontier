/* Child: emulates the browser DedicatedWorkerGlobalScope with REAL transfer
 * semantics (worker_threads postMessage detaches buffers, like a browser).
 * In a browser worker `self` IS the global object, so we bind to globalThis. */
'use strict';
const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');

const workerDir = path.join(__dirname, '..', 'js');

globalThis.self = globalThis; // in a worker, self === globalThis
globalThis.postMessage = (msg, transfer) => {
  parentPort.postMessage(msg, transfer || []);
};
globalThis.importScripts = (p) => {
  const src = fs.readFileSync(path.join(workerDir, p.replace(/^\.\//, '')), 'utf8');
  (0, eval)(src); // indirect eval → executes in this thread's global realm
};

(0, eval)(fs.readFileSync(path.join(workerDir, 'terrain-worker.js'), 'utf8'));

parentPort.on('message', (data) => {
  try {
    globalThis.onmessage({ data });
  } catch (err) {
    parentPort.postMessage({
      type: 'worker-exception',
      message: err.constructor.name + ': ' + err.message
    });
  }
});
