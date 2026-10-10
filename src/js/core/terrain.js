// ─────────────────────────────────────────────────────────────────────────────
//  Terrain engine — owns the height-field buffers and executes the layer stack.
//
//  Every dispatch gets its own 256-byte slice of one uniform buffer, addressed
//  with a dynamic offset, so an entire build can be recorded into a single
//  command buffer without stalling on per-dispatch uniform uploads.
// ─────────────────────────────────────────────────────────────────────────────

import { loadShader, makePipelines } from './shaders.js';
import { TERRAIN_TYPES } from '../schema/layers.js';
import { LAYER_STRIDE, packTerrainLayer, packSurfaceParams } from './state.js';

const SLOT_SIZE = 256;                 // bytes, must match minUniformBufferOffsetAlignment
const MAX_SLOTS = 32768;               // 8 MB of uniform slots
const DROPLET_CHUNK = 131072;


export class TerrainEngine {
  constructor(device, format = 'rgba16float') {
    this.device = device;
    this.res = 0;
    this.renderRes = 0;
    this.uniformData = new ArrayBuffer(SLOT_SIZE * MAX_SLOTS);
    this.uniformF = new Float32Array(this.uniformData);
    this.uniformU = new Uint32Array(this.uniformData);
    this.heightTex = null;
    this.surfTex = null;
  }

  async init() {
    const device = this.device;
    const stage = GPUShaderStage.COMPUTE;

    const entries = [
      { binding: 0, visibility: stage, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 64 } },
      { binding: 1, visibility: stage, buffer: { type: 'read-only-storage' } },
    ];
    for (let b = 2; b <= 8; b++) entries.push({ binding: b, visibility: stage, buffer: { type: 'storage' } });
    entries.push({
      binding: 9, visibility: stage,
      storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' },
    });
    for (let b = 10; b <= 12; b++) entries.push({ binding: b, visibility: stage, buffer: { type: 'storage' } });

    this.bgl = device.createBindGroupLayout({ entries, label: 'terrain-compute' });
    this.layout = device.createPipelineLayout({ bindGroupLayouts: [this.bgl] });

    this.uniformBuf = device.createBuffer({
      size: SLOT_SIZE * MAX_SLOTS,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'terrain-uniform',
    });

    this.layerBuf = device.createBuffer({
      size: LAYER_STRIDE * 4 * 64,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'terrain-layer-params',
    });

    // ── pipelines ────────────────────────────────────────────────────────────
    const [gen, filt, ero, surf, pack, idx] = await Promise.all([
      loadShader('src/shaders/terrain_gen.wgsl'),
      loadShader('src/shaders/terrain_filter.wgsl'),
      loadShader('src/shaders/erosion.wgsl'),
      loadShader('src/shaders/surface.wgsl'),
      loadShader('src/shaders/pack.wgsl'),
      loadShader('src/shaders/index_gen.wgsl'),
    ]);

    const L = { layout: this.layout };
    this.pipe = {
      ...makePipelines(device, gen, 'gen', {
        clearField: L, genFractal: L, genCellular: L, genConst: L, genCrater: L, genDune: L,
        composite: L, copyH2S: L, copyS2H: L, applyEdge: L, normalizeField: L,
      }),
      ...makePipelines(device, filt, 'filter', {
        filterBlurH: L, filterBlurV: L, filterSlopeBlurH: L, filterSharpen: L,
        filterTerrace: L, filterCurve: L, filterSnow: L, filterStrata: L,
        filterWarp: L, filterCarve: L, filterClamp: L,
      }),
      ...makePipelines(device, ero, 'erode', {
        erodePrep: L, erodeFinish: L, erodeSmooth: L, erodeThermal: L, erodeDroplet: L,
        flowInit: L, flowStep: L, flowCommit: L, flowFinalize: L,
        reduceMinMax: L, reduceFinal: L,
      }),
      ...makePipelines(device, surf, 'surface', { surfaceMain: L }),
    };

    // pack + index generation use their own small layouts
    this.packBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: stage, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 64 } },
        { binding: 1, visibility: stage, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: stage, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' } },
      ],
    });
    this.packPipe = makePipelines(device, pack, 'pack', {
      packHeight: { layout: device.createPipelineLayout({ bindGroupLayouts: [this.packBGL] }) },
    }).packHeight;

    this.idxBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: stage, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 64 } },
        { binding: 1, visibility: stage, buffer: { type: 'storage' } },
      ],
    });
    this.idxPipe = makePipelines(device, idx, 'index', {
      main: { layout: device.createPipelineLayout({ bindGroupLayouts: [this.idxBGL] }) },
    }).main;
  }

  // ── resource allocation ────────────────────────────────────────────────────
  ensure(res, renderRes) {
    if (this.res === res && this.renderRes === renderRes) return false;
    const device = this.device;
    for (const b of Object.values(this.buffers || {})) b.destroy?.();
    this.heightTex?.destroy();
    this.surfTex?.destroy();

    this.res = res;
    this.renderRes = renderRes;
    const n = res * res;
    const ST = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const mk = (label, size, usage = ST) =>
      device.createBuffer({ size: Math.max(256, size), usage, label });

    this.buffers = {
      H: mk('H', n * 4),
      S: mk('S', n * 4),
      AUX: mk('AUX', n * 16),
      FX: mk('FX', n * 4),
      FL: mk('FL', n * 4),
      TMP: mk('TMP', n * 4),
      TMP2: mk('TMP2', n * 4),
      IDX: mk('IDX', n * 4),
      IDX2: mk('IDX2', n * 4),
      RED: mk('RED', 256),
    };

    const texDesc = {
      size: [res, res, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    };
    this.heightTex = device.createTexture({ ...texDesc, label: 'height-tex' });
    this.surfTex = device.createTexture({ ...texDesc, label: 'surf-tex' });

    // index buffer for the render mesh
    const R = renderRes;
    const idxCount = (R * R + R * 4) * 6;
    this.indexCount = idxCount;
    this.vertexCount = (R + 1) * (R + 1) + 8 * (R + 1);
    this.indexBuf?.destroy?.();
    this.indexBuf = device.createBuffer({
      size: idxCount * 4,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'terrain-index',
    });

    this.bindGroup = device.createBindGroup({
      layout: this.bgl,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf, size: 64 } },
        { binding: 1, resource: { buffer: this.layerBuf } },
        { binding: 2, resource: { buffer: this.buffers.H } },
        { binding: 3, resource: { buffer: this.buffers.S } },
        { binding: 4, resource: { buffer: this.buffers.AUX } },
        { binding: 5, resource: { buffer: this.buffers.FX } },
        { binding: 6, resource: { buffer: this.buffers.FL } },
        { binding: 7, resource: { buffer: this.buffers.TMP } },
        { binding: 8, resource: { buffer: this.buffers.TMP2 } },
        { binding: 9, resource: this.surfTex.createView() },
        { binding: 10, resource: { buffer: this.buffers.IDX } },
        { binding: 11, resource: { buffer: this.buffers.IDX2 } },
        { binding: 12, resource: { buffer: this.buffers.RED } },
      ],
      label: 'terrain-compute-bg',
    });

    this.packBindGroup = device.createBindGroup({
      layout: this.packBGL,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf, size: 64 } },
        { binding: 1, resource: { buffer: this.buffers.H } },
        { binding: 2, resource: this.heightTex.createView() },
      ],
    });

    this.idxBindGroup = device.createBindGroup({
      layout: this.idxBGL,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf, size: 64 } },
        { binding: 1, resource: { buffer: this.indexBuf } },
      ],
    });

    // build the mesh index buffer once
    const enc = device.createCommandEncoder();
    const slot = this.writeUniform({ res: R, index: 0, seed: 0, count: 0 }, {});
    this.flushUniform(device, slot + 1);
    const pass = enc.beginComputePass();
    pass.setPipeline(this.idxPipe);
    pass.setBindGroup(0, this.idxBindGroup, [slot * SLOT_SIZE]);
    pass.dispatchWorkgroups(Math.ceil(((R * R + R * 4) / 64)), 1, 1);
    pass.end();
    device.queue.submit([enc.finish()]);
    return true;
  }

  /** Upload only the slots actually in use. */
  flushUniform(device, slots) {
    if (!this._dirty) return;
    const n = Math.max(1, Math.min(slots, MAX_SLOTS));
    device.queue.writeBuffer(this.uniformBuf, 0, this.uniformData, 0, n * SLOT_SIZE);
    this._dirty = false;
  }

  /** Write one uniform slot. Returns the slot index. */
  writeUniform(v, w) {
    const slot = this._slot = (this._slot ?? -1) + 1;
    const f = this.uniformF, u = this.uniformU;
    const o = slot * (SLOT_SIZE / 4);
    u[o + 0] = v.res | 0;
    u[o + 1] = v.index | 0;
    u[o + 2] = v.seed | 0;
    u[o + 3] = v.count | 0;
    f[o + 4] = w.invRes ?? 1 / v.res;
    f[o + 5] = w.invRes ?? 1 / v.res;
    f[o + 6] = w.heightScale ?? 1;
    f[o + 7] = w.worldSize ?? 1;
    f[o + 8] = v.time ?? 0;
    f[o + 9] = v.pass ?? 0;
    f[o + 10] = v.dropletBase ?? 0;
    f[o + 11] = v.spare ?? 0;
    f[o + 12] = 0; f[o + 13] = 0; f[o + 14] = 0; f[o + 15] = 0;
    this._dirty = true;
    return slot;
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Build
  // ───────────────────────────────────────────────────────────────────────────
  /**
   * @param {object} project
   * @param {(frac:number,label:string)=>void} onProgress
   */
  async build(project, onProgress = () => {}) {
    const g = project.globals;
    const res = g.res;
    const renderRes = Math.min(g.renderRes ?? res, 1536);
    this.ensure(res, renderRes);

    const ctx = { res, heightScale: g.heightScale, worldSize: g.worldSize };
    const n = res * res;
    const gw = Math.ceil(res / 8);

    // ── pack layer parameters
    const layers = project.terrain.filter((l) => l.enabled && TERRAIN_TYPES[l.type]);
    const paramData = new Float32Array(64 * LAYER_STRIDE);
    const slotOf = new Map();
    layers.forEach((l, i) => {
      slotOf.set(l.id, i);
      packTerrainLayer(l, paramData, i, ctx);
    });
    // the surface pass borrows the record after the last layer
    const surfSlot = Math.min(layers.length, 60);
    const flowSlot = surfSlot + 1;
    const shapeSlot = surfSlot + 2;
    packSurfaceParams(
      { dirs: g.aoDirs, steps: g.aoSteps, radius: g.aoRadius, strength: 0.85 },
      paramData, surfSlot);
    // flow finalisation reads only a[0].y as the river-network gamma
    const hydro = layers.find((l) => l.type === 'hydraulic');
    const flowOff = flowSlot * LAYER_STRIDE;
    paramData.fill(0, flowOff, flowOff + LAYER_STRIDE);
    paramData[flowOff + 1] = hydro ? hydro.params.flowGamma : 0.55;
    paramData[flowOff + 8 * 4] = 1;

    // ── plan the operation list
    const ops = [];
    const push = (pipeline, x, y, z, v, w, cost = 1, pack = false) =>
      ops.push({ pipeline, x, y, z, v, w, cost, pack });

    const base = { res, seed: g.seed | 0, count: 0 };
    const W = { invRes: 1 / res, heightScale: g.heightScale, worldSize: g.worldSize };

    push(this.pipe.clearField, gw, gw, 1, { ...base }, W, 1);

    const flowRounds = 14;
    const runFlow = () => {
      const fv = { ...base, index: flowSlot };
      push(this.pipe.flowInit, gw, gw, 1, fv, W, 1);
      for (let i = 0; i < flowRounds; i++) {
        push(this.pipe.flowStep, gw, gw, 1, fv, W, 1);
        push(this.pipe.flowCommit, gw, gw, 1, fv, W, 1);
      }
      const partials = gw * gw;
      push(this.pipe.reduceMinMax, gw, gw, 1, { ...fv, spare: 1 }, W, 1);
      push(this.pipe.reduceFinal, 1, 1, 1, { ...fv, count: partials, spare: 1 }, W, 1);
      push(this.pipe.flowFinalize, gw, gw, 1, fv, W, 1);
    };

    for (const layer of layers) {
      const def = TERRAIN_TYPES[layer.type];
      if (!def) continue;
      const idx = slotOf.get(layer.id);
      const v = { ...base, index: idx };

      if (def.kind === 'gen') {
        push(this.pipe[def.entry], gw, gw, 1, { ...v }, W, 2);
        push(this.pipe.composite, gw, gw, 1, { ...v }, W, 1);
      } else if (layer.type === 'thermal') {
        const iters = Math.max(1, Math.round(layer.params.iterations));
        for (let i = 0; i < iters; i++) {
          push(this.pipe.erodeThermal, gw, gw, 1, { ...v }, W, 1);
          push(this.pipe.copyS2H, gw, gw, 1, { ...v }, W, 1);
        }
      } else if (layer.type === 'hydraulic') {
        const p = layer.params;
        const total = Math.max(DROPLET_CHUNK, Math.round(p.droplets));
        push(this.pipe.erodePrep, gw, gw, 1, { ...v }, W, 1);
        const chunks = Math.ceil(total / DROPLET_CHUNK);
        for (let c = 0; c < chunks; c++) {
          const count = Math.min(DROPLET_CHUNK, total - c * DROPLET_CHUNK);
          push(this.pipe.erodeDroplet, Math.ceil(count / 64), 1, 1,
            { ...v, count, dropletBase: c * DROPLET_CHUNK }, W, 26);
        }
        push(this.pipe.erodeFinish, gw, gw, 1, { ...v }, W, 1);
        if (p.smoothing > 0.001) {
          push(this.pipe.erodeSmooth, gw, gw, 1, { ...v }, W, 1);
          push(this.pipe.copyS2H, gw, gw, 1, { ...v }, W, 1);
        }
        runFlow();
      } else if (layer.type === 'carve') {
        runFlow();
        push(this.pipe.filterCarve, gw, gw, 1, { ...v }, W, 1);
        push(this.pipe.copyS2H, gw, gw, 1, { ...v }, W, 1);
      } else if (layer.type === 'slopeBlur' || layer.type === 'blur') {
        const iters = layer.type === 'slopeBlur'
          ? Math.max(1, Math.round(layer.params.iterations)) : 1;
        for (let i = 0; i < iters; i++) {
          push(this.pipe[layer.type === 'slopeBlur' ? 'filterSlopeBlurH' : 'filterBlurH'], gw, gw, 1, { ...v }, W, 2);
          push(this.pipe.filterBlurV, gw, gw, 1, { ...v }, W, 2);
          push(this.pipe.copyS2H, gw, gw, 1, { ...v }, W, 1);
        }
      } else {
        push(this.pipe[def.entry], gw, gw, 1, { ...v }, W, 2);
        push(this.pipe.copyS2H, gw, gw, 1, { ...v }, W, 1);
      }
    }

    // ── global shaping
    if (g.edgeFalloff > 0.0001) {
      const idx = shapeSlot;
      const off = idx * LAYER_STRIDE;
      paramData[off + 8 * 4 + 0] = g.edgeFalloff;
      paramData[off + 8 * 4 + 1] = 0;
      paramData[off + 8 * 4 + 2] = 0;
      paramData[off + 8 * 4 + 3] = 1;
      push(this.pipe.applyEdge, gw, gw, 1, { ...base, index: idx }, W, 1);
    }

    if (g.normalize) {
      const idx = shapeSlot;
      const off = idx * LAYER_STRIDE;
      paramData[off + 8 * 4 + 0] = 1;
      paramData[off + 8 * 4 + 1] = 0;   // lo
      paramData[off + 8 * 4 + 2] = 1;   // hi
      const partials = gw * gw;
      push(this.pipe.reduceMinMax, gw, gw, 1, { ...base, index: idx, spare: 0 }, W, 1);
      push(this.pipe.reduceFinal, 1, 1, 1, { ...base, index: idx, count: partials, spare: 0 }, W, 1);
      push(this.pipe.normalizeField, gw, gw, 1, { ...base, index: idx }, W, 1);
    }

    // ── surface maps + render packing
    push(this.pipe.surfaceMain, gw, gw, 1, { ...base, index: surfSlot }, W, 6);
    push(this.packPipe, gw, gw, 1, { ...base, index: 0 }, W, 1, true);

    // ── re-upload params (the shaping step may have edited them)
    this.device.queue.writeBuffer(this.layerBuf, 0, paramData);

    // ── assign uniform slots and upload
    this._slot = -1;
    for (const op of ops) {
      if (this._slot + 1 >= MAX_SLOTS) break;
      op.slot = this.writeUniform(op.v, op.w);
    }
    ops.length = Math.min(ops.length, this._slot + 1);
    this.flushUniform(this.device, this._slot + 1);

    // ── record + submit in chunks so long builds keep the page alive
    const totalCost = ops.reduce((a, o) => a + o.cost, 0);
    let done = 0;
    let enc = this.device.createCommandEncoder();
    let pass = enc.beginComputePass();
    let currentPack = false;
    let budget = 0;
    const flush = async () => {
      pass.end();
      this.device.queue.submit([enc.finish()]);
      await new Promise((r) => setTimeout(r, 0));
      enc = this.device.createCommandEncoder();
      pass = enc.beginComputePass();
      budget = 0;
    };

    for (const op of ops) {
      if (op.pack !== currentPack) {
        pass.end();
        currentPack = op.pack;
        pass = enc.beginComputePass();
      }
      pass.setPipeline(op.pipeline);
      if (op.pack) {
        pass.setBindGroup(0, this.packBindGroup, [op.slot * SLOT_SIZE]);
      } else {
        pass.setBindGroup(0, this.bindGroup, [op.slot * SLOT_SIZE]);
      }
      pass.dispatchWorkgroups(op.x, op.y, op.z);
      done += op.cost;
      budget += op.cost;
      onProgress(done / totalCost, op.label || '');
      if (budget > 60) await flush();
    }
    pass.end();
    this.device.queue.submit([enc.finish()]);
    onProgress(1, 'done');
    return true;
  }
}
