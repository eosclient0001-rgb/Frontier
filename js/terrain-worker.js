/* ============================================================================
 * Frontier — Terrain Worker
 * Runs the heavy pipeline (generate → hydraulic erosion → splat bake) off the
 * main thread so the UI stays responsive. Buffers are transferred (zero copy).
 * ==========================================================================*/
'use strict';

/* global TerrainCore */
importScripts('./terrain-core.js');

const state = {
  h: null,
  n: 0,
  Hmax: 1,
  sizeM: 100
};

/* Only ArrayBuffers/MessagePorts are guaranteed-valid entries of a
 * postMessage transfer list (typed arrays are NOT accepted by every
 * engine), so normalise every transferable to its underlying buffer. */
function toTransferable(x) {
  if (x instanceof ArrayBuffer) return x;
  if (ArrayBuffer.isView(x)) return x.buffer;
  return x;
}

function post(msg, transfer) {
  self.postMessage(msg, (transfer || []).map(toTransferable));
}

self.onmessage = function (e) {
  const m = e.data;

  if (m.type === 'generate') {
    const t0 = performance.now();
    const res = TerrainCore.generateMountain(m.params);
    state.h = res.h;
    state.n = res.n;
    state.Hmax = res.stats.max > 0 ? res.stats.max : 1;
    state.sizeM = m.params.sizeM || 100;
    post({
      type: 'height', h: res.h, n: res.n, stats: res.stats,
      ms: performance.now() - t0
    }, [res.h]);

  } else if (m.type === 'erode') {
    const t0 = performance.now();
    state.h = m.h;
    state.n = m.n;
    state.sizeM = m.params.sizeM || 100;

    const res = TerrainCore.runHydraulic(state.h, state.n, m.params, (p) => {
      post({ type: 'erode-progress', ...p });
    });

    if (m.params.massWaste > 0) {
      const cell = state.sizeM / (state.n - 1);
      TerrainCore.massWaste(state.h, state.n, m.params.massWaste,
        m.params.massWasteLimit * cell);
    }

    // recompute field bounds
    let max = 0, min = Infinity;
    const h = state.h;
    for (let i = 0; i < h.length; i++) {
      if (h[i] > max) max = h[i];
      if (h[i] < min) min = h[i];
    }
    state.Hmax = max > 0 ? max : 1;

    post({
      type: 'eroded', h: state.h, flow: res.flow, dep: res.dep,
      stats: { ...res.stats, min, max },
      ms: performance.now() - t0
    }, [state.h, res.flow, res.dep]);

  } else if (m.type === 'splat') {
    const t0 = performance.now();
    const h = m.h;
    const res = TerrainCore.computeSplatMaps(
      h, m.flow, m.dep, m.n,
      { ...m.params, intensities: m.params, Hmax: m.Hmax }, m.sizeM || 100);
    // return the field buffers along with the baked textures
    post({
      type: 'splat', h, flow: m.flow, dep: m.dep,
      albedo: res.albedo, vis: res.vis,
      stats: res.stats, n: m.n,
      ms: performance.now() - t0
    }, [h.buffer, m.flow.buffer, m.dep.buffer, res.albedo.buffer, res.vis.buffer]);

  } else if (m.type === 'ping') {
    post({ type: 'pong' });
  }
};
