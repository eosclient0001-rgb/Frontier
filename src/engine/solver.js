// =================================================================================================
//  solver.js — evaluates the terrain layer stack on the GPU
// -------------------------------------------------------------------------------------------------
//  A build is a list of steps walked across frames inside a time budget. Non-iterative operators
//  cost a single dispatch and are effectively free; hydraulic erosion costs hundreds, so it is
//  chunked and the field is re-derived periodically. The result is that erosion is watched as it
//  happens — valleys deepen while you adjust the rainfall — instead of arriving all at once after
//  a stall.
//
//  The field ping-pongs between two storage buffers. Every operator reads one and writes the other,
//  which keeps read/write hazards out of the shader entirely.
// =================================================================================================

import { wgsl } from './wgsl.js';
import { TERRAIN_OPS, packTerrainOp, OP_FLOATS } from './terrain-schema.js';

const OP_UNIFORM_SLOT = 256; // minUniformBufferOffsetAlignment
const MAX_OP_SLOTS = 64;

const EROSION_LAYOUT_ENTRIES = [
  { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
  { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
];

export class TerrainSolver {
  constructor(device) {
    this.device = device;
    this.res = 1024;
    this.extent = 4000;
    this.heightMeters = 1200;
    this.aoDirs = 12;
    this.aoSteps = 10;
    this.aoRadius = 900;

    this.fieldA = null;
    this.fieldB = null;
    this.built = false;
    this.progress = 1;
    this.busy = false;
    this.activeLayerId = null;
    this.buildId = 0;
    this._steps = [];
    this._index = 0;
    this._parity = 0;
    this._iterDone = 0;
    this._slotCount = 0;
    this._lastPublish = 0;
    this._field = new Float32Array(OP_FLOATS); // scratch for one packed FieldOp

    this._createPipelines();
  }

  _createPipelines() {
    const d = this.device;

    // --- layer operators -------------------------------------------------------------------------
    this.opLayout = d.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 160 },
        },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this.opPipeline = d.createComputePipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.opLayout] }),
      compute: { module: d.createShaderModule({ code: wgsl('terrain-ops.wgsl') }), entryPoint: 'main' },
    });

    // --- erosion ----------------------------------------------------------------------------------
    const erodeModule = d.createShaderModule({ code: wgsl('erosion.wgsl') });
    this.erosionLayout = d.createBindGroupLayout({ entries: EROSION_LAYOUT_ENTRIES });
    const erodePipelineLayout = d.createPipelineLayout({ bindGroupLayouts: [this.erosionLayout] });
    this.erosionPipelines = {};
    for (const entry of ['initSim', 'flux', 'water', 'erode', 'transport', 'evaporate', 'finalizeSim']) {
      this.erosionPipelines[entry] = d.createComputePipeline({
        layout: erodePipelineLayout,
        compute: { module: erodeModule, entryPoint: entry },
      });
    }

    // --- derive -----------------------------------------------------------------------------------
    this.deriveLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      ],
    });
    this.derivePipeline = d.createComputePipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.deriveLayout] }),
      compute: { module: d.createShaderModule({ code: wgsl('derive.wgsl') }), entryPoint: 'main' },
    });

    this.opUniform = d.createBuffer({
      size: OP_UNIFORM_SLOT * MAX_OP_SLOTS,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.erosionUniform = d.createBuffer({
      size: 5 * 16 + 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.deriveUniform = d.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  // Largest resolution this device can hold. The erosion flux buffer is four floats per cell and
  // is bound as a single storage buffer, so it is what sets the ceiling.
  static maxResFor(device) {
    const cap = Math.min(
      device?.limits?.maxStorageBufferBindingSize ?? 134217728,
      device?.limits?.maxBufferSize ?? 268435456,
    );
    let r = 4096;
    while (r > 256 && r * r * 16 > cap) r = Math.floor(r / 2);
    return r;
  }

  configure({ res, extent, heightMeters, aoDirs, aoSteps, aoRadius }) {
    const ceiling = TerrainSolver.maxResFor(this.device);
    const clamped = Math.min(Math.max(256, res | 0), ceiling);
    if (clamped !== (res | 0)) {
      console.warn(`[frontier] resolution ${res} exceeds this device's limits; using ${clamped}.`);
    }
    res = clamped;
    const changed = res !== this.res;
    this.res = res;
    this.extent = extent;
    this.heightMeters = heightMeters;
    this.aoDirs = aoDirs ?? this.aoDirs;
    this.aoSteps = aoSteps ?? this.aoSteps;
    this.aoRadius = aoRadius ?? this.aoRadius;
    if (changed || !this.fieldA) this._allocate();
    else this._writeDeriveUniform();
  }

  _allocate() {
    const d = this.device;
    const n = this.res * this.res;
    const f4 = n * 4;

    for (const b of [this.fieldA, this.fieldB, this.wet, this.simH, this.simW0, this.simW1,
      this.simS0, this.simS1, this.simFlux, this.simVel]) {
      if (b) b.destroy();
    }

    const mk = (size, extra = 0) =>
      d.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | extra });

    this.fieldA = mk(f4);
    this.fieldB = mk(f4);
    this.wet = mk(f4);
    this.simH = mk(f4);
    this.simW0 = mk(f4);
    this.simW1 = mk(f4);
    this.simS0 = mk(f4);
    this.simS1 = mk(f4);
    this.simFlux = mk(n * 16);
    this.simVel = mk(n * 8);

    for (const t of [this.heightTex, this.normalTex, this.surfTex]) if (t) t.destroy();
    this.heightTex = d.createTexture({
      size: [this.res, this.res],
      format: 'r32float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    this.normalTex = d.createTexture({
      size: [this.res, this.res],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.surfTex = d.createTexture({
      size: [this.res, this.res],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.heightView = this.heightTex.createView();
    this.normalView = this.normalTex.createView();
    this.surfView = this.surfTex.createView();

    // Ping-pong bind groups for the operator pipeline.
    this.opBind = [
      d.createBindGroup({
        layout: this.opLayout,
        entries: [
          { binding: 0, resource: { buffer: this.opUniform, size: OP_FLOATS * 4 } },
          { binding: 1, resource: { buffer: this.fieldA } },
          { binding: 2, resource: { buffer: this.fieldB } },
        ],
      }),
      d.createBindGroup({
        layout: this.opLayout,
        entries: [
          { binding: 0, resource: { buffer: this.opUniform, size: OP_FLOATS * 4 } },
          { binding: 1, resource: { buffer: this.fieldB } },
          { binding: 2, resource: { buffer: this.fieldA } },
        ],
      }),
    ];

    // Erosion bind groups, one per read parity. Binding 2/3 swap so that "write" is always the
    // far buffer; binding 4/5 do the same for sediment.
    const W = [this.simW0, this.simW1];
    const S = [this.simS0, this.simS1];
    this.erosionBind = [0, 1].map((r) =>
      d.createBindGroup({
        layout: this.erosionLayout,
        entries: [
          { binding: 0, resource: { buffer: this.erosionUniform } },
          { binding: 1, resource: { buffer: this.simH } },
          { binding: 2, resource: { buffer: W[r] } },
          { binding: 3, resource: { buffer: W[1 - r] } },
          { binding: 4, resource: { buffer: S[r] } },
          { binding: 5, resource: { buffer: S[1 - r] } },
          { binding: 6, resource: { buffer: this.simFlux } },
          { binding: 7, resource: { buffer: this.simVel } },
          { binding: 8, resource: { buffer: this.wet } },
          { binding: 9, resource: { buffer: this.fieldA } },
        ],
      })
    );

    this.deriveBind = [this.fieldA, this.fieldB].map((buf) =>
      d.createBindGroup({
        layout: this.deriveLayout,
        entries: [
          { binding: 0, resource: { buffer: this.deriveUniform } },
          { binding: 1, resource: { buffer: buf } },
          { binding: 2, resource: { buffer: this.wet } },
          { binding: 3, resource: this.heightView },
          { binding: 4, resource: this.normalView },
          { binding: 5, resource: this.surfView },
        ],
      })
    );

    this._writeDeriveUniform();
    this.built = false;
    this.progress = 0;
  }

  _writeDeriveUniform() {
    const u = new ArrayBuffer(32);
    const p0 = new Uint32Array(u, 0, 4);
    const p1 = new Float32Array(u, 16, 4);
    p0[0] = this.res;
    p0[1] = this.aoDirs;
    p0[2] = this.aoSteps;
    p0[3] = 0;
    p1[0] = this.extent / this.res;
    p1[1] = this.heightMeters;
    p1[2] = 1.0;
    p1[3] = this.aoRadius;
    this.device.queue.writeBuffer(this.deriveUniform, 0, u);
  }

  get cellMeters() {
    return this.extent / this.res;
  }

  get currentFieldBuffer() {
    return this._parity === 0 ? this.fieldA : this.fieldB;
  }

  // --- build --------------------------------------------------------------------------------------

  startBuild(layers) {
    this.buildId++;
    this._steps = [];
    this._index = 0;
    this._parity = 0;
    this._iterDone = 0;
    this._slotCount = 0;
    this.busy = true;
    this.progress = 0;
    this.built = false;

    const d = this.device;
    const enc = d.createCommandEncoder();
    enc.clearBuffer(this.fieldA);
    enc.clearBuffer(this.fieldB);
    enc.clearBuffer(this.wet);
    d.queue.submit([enc.finish()]);

    // Pack one uniform slot per layer up front. Iterative operators reuse the same slot for every
    // pass, so the number of slots only ever equals the number of layers.
    const ctx = { res: this.res, cellMeters: this.cellMeters, heightMeters: this.heightMeters };
    let slot = 0;
    let totalWork = 1;

    // A constant fill at zero establishes the starting field.
    this._writeOp(slot, {
      kind: 'fill',
      blend: 0,
      opacity: 1,
      maskMode: 0,
      maskMin: 0, maskMax: 1, maskFeather: 0.08, maskInvert: false,
      maskNoiseScale: 1, maskContrast: 1, maskNoiseSeed: 0,
      params: { value: 0 },
    }, ctx);
    this._steps.push({ type: 'op', slot, iterations: 1, layerId: null });
    slot++;

    // The stack is stored top-first, so evaluation walks it in reverse.
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer.enabled) continue;
      const op = TERRAIN_OPS[layer.kind];
      if (!op) continue;
      if (op.special === 'erosion') {
        this._steps.push({ type: 'erosion', layer, layerId: layer.id });
        totalWork += Math.max(8, layer.params.iterations | 0);
      } else {
        if (slot >= MAX_OP_SLOTS) break;
        this._writeOp(slot, layer, ctx);
        const iterations = op.iterations ? Math.max(1, layer.params.iterations | 0) : 1;
        this._steps.push({ type: 'op', slot, iterations, layerId: layer.id });
        slot++;
        totalWork += iterations;
      }
    }
    this._slotCount = slot;
    this._totalWork = totalWork;
    this._doneWork = 0;
    return this.buildId;
  }

  _writeOp(slot, layer, ctx) {
    const v = this._field;
    packTerrainOp(v, layer, ctx);
    this.device.queue.writeBuffer(this.opUniform, slot * OP_UNIFORM_SLOT, v.buffer, v.byteOffset, OP_FLOATS * 4);
  }

  _writeErosionUniform(layer) {
    const P = layer.params;
    const cell = this.cellMeters;
    const buf = new ArrayBuffer(5 * 16 + 64);
    const p0 = new Uint32Array(buf, 0, 4);
    const p1 = new Float32Array(buf, 16, 4);
    const p2 = new Float32Array(buf, 32, 4);
    const p3 = new Float32Array(buf, 48, 4);
    const p4 = new Float32Array(buf, 64, 4);

    p0[0] = this.res;
    p0[1] = 0;
    p0[2] = 0;
    p0[3] = P.seed | 0;

    p1[0] = 0.02;                                  // dt, seconds
    p1[1] = cell;                                  // cell size, metres
    p1[2] = this.heightMeters;
    p1[3] = 0.02 + (P.flow ?? 0.85) * 0.05;        // virtual pipe cross-section, m^2

    p2[0] = (P.rain ?? 0.55) * 0.00025;            // metres of rain per pass
    p2[1] = P.evaporate ?? 0.016;
    p2[2] = (P.capacity ?? 0.5) * 0.65;
    p2[3] = P.dissolve ?? 0.42;

    p3[0] = P.deposit ?? 0.36;
    p3[1] = 0.0;
    p3[2] = 0.5;                                   // safety clamp, metres per pass
    p3[3] = (P.thermal ?? 0.35) * 0.5;

    p4[0] = Math.tan(((P.talusAngle ?? 34) * Math.PI) / 180);
    p4[1] = 9.81;
    this.device.queue.writeBuffer(this.erosionUniform, 0, buf);
  }

  // Advances the build. Returns true while there is still work to do.
  tick(budgetMs = 9) {
    if (!this.busy) return false;
    const start = performance.now();
    const groups = Math.ceil(this.res / 8);

    while (this._index < this._steps.length) {
      const step = this._steps[this._index];
      if (performance.now() - start > budgetMs) break;

      if (step.type === 'op') {
        const remaining = step.iterations - (step.done ?? 0);
        if (remaining <= 0) { this._index++; continue; }
        // Iterative operators are dispatched one pass at a time so the frame budget is honoured.
        const batch = remaining > 8 ? 1 : remaining;
        const enc = this.device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(this.opPipeline);
        for (let k = 0; k < batch; k++) {
          pass.setBindGroup(0, this.opBind[this._parity], [step.slot * OP_UNIFORM_SLOT]);
          pass.dispatchWorkgroups(groups, groups);
          this._parity = 1 - this._parity;
          step.done = (step.done ?? 0) + 1;
          this._doneWork++;
        }
        pass.end();
        this.device.queue.submit([enc.finish()]);
        this.activeLayerId = step.layerId;
        if ((step.done ?? 0) >= step.iterations) this._index++;
      } else {
        // --- erosion: chunked across frames ----------------------------------------------------
        const total = Math.max(8, step.layer.params.iterations | 0);
        if (step.started !== true) {
          this._writeErosionUniform(step.layer);
          const enc = this.device.createCommandEncoder();
          // The simulation owns its own copy of the height in metres; bind whichever field buffer
          // currently holds the terrain.
          this._bindErosionField(this._parity === 0 ? this.fieldA : this.fieldB);
          const pass = enc.beginComputePass();
          pass.setPipeline(this.erosionPipelines.initSim);
          pass.setBindGroup(0, this.erosionBind[0]);
          pass.dispatchWorkgroups(groups, groups);
          pass.end();
          this.device.queue.submit([enc.finish()]);
          step.started = true;
          step.done = 0;
          step.parity = 0;
        }
        this.activeLayerId = step.layerId;
        // One solver pass is five dispatches over the whole grid. Pick a chunk size that keeps a
        // frame's work roughly constant instead of fixed: at 2K a single pass is already most of
        // a frame, at 512 it is a rounding error.
        const perPass = (this.res / 8) * (this.res / 8) * 64 * 5;
        const chunk = Math.max(1, Math.min(16, Math.round(8e6 / Math.max(1, perPass))));
        const remaining = total - step.done;
        const n = Math.min(chunk, remaining);
        if (n > 0) {
          const enc = this.device.createCommandEncoder();
          const pass = enc.beginComputePass();
          const P = this.erosionPipelines;
          for (let k = 0; k < n; k++) {
            const r = step.parity;
            pass.setPipeline(P.flux);
            pass.setBindGroup(0, this.erosionBind[r]);
            pass.dispatchWorkgroups(groups, groups);
            pass.setPipeline(P.water);
            pass.dispatchWorkgroups(groups, groups);
            pass.setPipeline(P.erode);
            pass.dispatchWorkgroups(groups, groups);
            pass.setPipeline(P.transport);
            pass.dispatchWorkgroups(groups, groups);
            pass.setPipeline(P.evaporate);
            pass.dispatchWorkgroups(groups, groups);
            step.parity = 1 - r;
            step.done++;
            this._doneWork++;
          }
          pass.end();
          this.device.queue.submit([enc.finish()]);
        }
        if (step.done >= total) {
          const enc = this.device.createCommandEncoder();
          const pass = enc.beginComputePass();
          pass.setPipeline(this.erosionPipelines.finalizeSim);
          pass.setBindGroup(0, this.erosionBind[step.parity]);
          pass.dispatchWorkgroups(groups, groups);
          pass.end();
          this.device.queue.submit([enc.finish()]);
          this._index++;
        }
      }
    }

    this.progress = Math.min(1, this._doneWork / Math.max(1, this._totalWork));
    const now = performance.now();
    if (this._index >= this._steps.length) {
      this.busy = false;
      this.activeLayerId = null;
      this.publish();
      this._lastPublish = now;
      this.built = true;
      this.progress = 1;
      return false;
    }
    // Republish periodically so long erosion runs are visible while they solve.
    if (now - this._lastPublish > 110) {
      this.publish();
      this._lastPublish = now;
    }
    return true;
  }

  // The erosion bind group's field buffer changes as the stack ping-pongs, so it is rebuilt rather
  // than kept — it is one small object per build step, and correctness beats micro-optimisation.
  _bindErosionField(buffer) {
    const d = this.device;
    const W = [this.simW0, this.simW1];
    const S = [this.simS0, this.simS1];
    this.erosionBind = [0, 1].map((r) =>
      d.createBindGroup({
        layout: this.erosionLayout,
        entries: [
          { binding: 0, resource: { buffer: this.erosionUniform } },
          { binding: 1, resource: { buffer: this.simH } },
          { binding: 2, resource: { buffer: W[r] } },
          { binding: 3, resource: { buffer: W[1 - r] } },
          { binding: 4, resource: { buffer: S[r] } },
          { binding: 5, resource: { buffer: S[1 - r] } },
          { binding: 6, resource: { buffer: this.simFlux } },
          { binding: 7, resource: { buffer: this.simVel } },
          { binding: 8, resource: { buffer: this.wet } },
          { binding: 9, resource: { buffer } },
        ],
      })
    );
  }

  // Runs the derive pass: normals, curvature, ambient occlusion, cavity and the height texture the
  // renderer displaces from.
  publish() {
    const groups = Math.ceil(this.res / 8);
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.derivePipeline);
    pass.setBindGroup(0, this.deriveBind[this._parity]);
    pass.dispatchWorkgroups(groups, groups);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.built = true;
  }

  // --- readback -----------------------------------------------------------------------------------

  async readHeights() {
    const n = this.res * this.res;
    const size = n * 4;
    const dst = this.device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.currentFieldBuffer, 0, dst, 0, size);
    this.device.queue.submit([enc.finish()]);
    await dst.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(dst.getMappedRange().slice(0));
    dst.unmap();
    dst.destroy();
    return out;
  }
}
