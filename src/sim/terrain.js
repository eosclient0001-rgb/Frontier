/**
 * Frontier Terrain Forge — terrain graph.
 *
 * The generator side of the app. It turns the terrain stack into a command
 * stream: every generator layer is one dispatch of `passes/terrain_layer.wgsl`
 * with its template injected, every erosion entry runs the simulation at a
 * coarser resolution and folds its delta back onto the full-resolution field,
 * and everything a layer or a material mask may want to read (slope, curvature,
 * wetness, deposit, detail, normals, AO) is derived on demand and cached until
 * the height field changes again.
 *
 * Fields are ping-ponged the way the shaders expect: a pass reads one texture
 * and writes the other, never both. The pool hands back the same textures for
 * the same description, so a regenerate at 4K does not reallocate.
 */
import { ComputePass } from '../gpu/pass.js';
import { EROSION_BY_ID } from '../gen/schema.js';
import { layerTypeOf, packClear, packClearRgba, packLayer } from '../gen/pack.js';

const TEMPLATE_OF = (layer) => layerTypeOf(layer)?.template;

/** Maps a layer may read from the stack, on top of the field it blends onto. */
const READ_SLOPE = new Set([1, 6]);   // mask kinds: slope, curvature
const AO_DIVISOR = 2;

class Ping {
  constructor(a, b = a) {
    this.fields = [a, b];
    this.other = b;
    this.i = 0;
  }
  get cur() { return this.fields[this.i]; }
  get next() { return this.fields[this.i ^ 1]; }
  swap() { this.i ^= 1; return this.cur; }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class TerrainGraph {
  constructor(gpu, options = {}) {
    this.gpu = gpu;
    this.log = options.log || (() => {});
    this.project = options.project || null;
    this.res = 0;
    this.simRes = 0;
    this.fields = null;
    this.sim = null;
    this.templateCache = new Map();
    this.statsBusy = false;
    this.maskNeeds = { slope: false, detail: false };
  }

  /* ------------------------------------------------------------------ *
   * resources
   * ------------------------------------------------------------------ */
  async resize(world) {
    const res = Math.max(256, Math.round(world.resolution));
    const simRes = Math.max(128, Math.round(res / 2 / 2) * 2);
    if (this.fields && this.res === res && this.simRes === simRes) return;
    this.releaseFields();
    const gpu = this.gpu;
    const field = (spec) => gpu.field(spec);
    const f32 = (label, width, height) => field({ width, height, format: 'r32float', label });
    const R = res;
    const S = simRes;

    this.fields = {
      stack: new Ping(f32('height', R, R), f32('height-b', R, R)),
      base: f32('height-base', R, R),
      height: f32('height-final', R, R),
      slope: f32('slope', R, R),
      curvature: f32('curvature', R, R),
      flow: f32('flow', R, R),
      deposit: f32('deposit', R, R),
      detail: f32('detail', R, R),
      paint: new Ping(f32('paint', R, R), f32('paint-b', R, R)),
      sketch: new Ping(f32('sketch', R, R), f32('sketch-b', R, R)),
      sculpt: new Ping(
        field({ width: R, height: R, format: 'rgba32float', label: 'sculpt' }),
        field({ width: R, height: R, format: 'rgba32float', label: 'sculpt-b' }),
      ),
      normal: field({ width: R, height: R, format: 'rgba8unorm', label: 'normal' }),
      ao: field({ width: Math.max(64, R / AO_DIVISOR), height: Math.max(64, R / AO_DIVISOR), format: 'rgba16float', label: 'ao' }),
      stats: f32('stats', 256, 256),
    };

    this.sim = {
      base: f32('sim-base', S, S),
      height: new Ping(f32('sim-height', S, S), f32('sim-height-b', S, S)),
      water: new Ping(f32('sim-water', S, S), f32('sim-water-b', S, S)),
      sediment: new Ping(f32('sim-sediment', S, S), f32('sim-sediment-b', S, S)),
      flow: new Ping(
        field({ width: S, height: S, format: 'rgba32float', label: 'sim-flow' }),
        field({ width: S, height: S, format: 'rgba32float', label: 'sim-flow-b' }),
      ),
      flux: field({ width: S, height: S, format: 'rgba32float', label: 'sim-flux' }),
    };

    this.res = res;
    this.simRes = simRes;
    this.sculpted = false;
    this.log(`terrain: ${R}×${R} fields, simulation at ${S}×${S}`);
    return this;
  }

  releaseFields() {
    const release = (field) => {
      if (!field) return;
      if (field instanceof Ping) { field.fields.forEach(release); return; }
      this.gpu.release(field);
    };
    if (this.fields) Object.values(this.fields).forEach(release);
    if (this.sim) Object.values(this.sim).forEach(release);
    this.fields = null;
    this.sim = null;
    this.res = 0;
    this.simRes = 0;
     this.gpu.clearCaches();
  }

  /** Everything a material layer or the viewport needs, once generation is done. */
  get maps() {
    const f = this.fields;
    if (!f) return null;
    return {
      height: f.height,
      slope: f.slope,
      curvature: f.curvature,
      flow: f.flow,
      deposit: f.deposit,
      detail: f.detail,
      normal: f.normal,
      ao: f.ao,
      paint: f.paint.cur,
      sketch: f.sketch.cur,
      resolution: this.res,
      simRes: this.simRes,
      sculpted: this.sculpted === true,
    };
  }

  /* ------------------------------------------------------------------ *
   * planning
   * ------------------------------------------------------------------ */
  /** Does this layer's template or mask stack read derived maps? */
  async templateReads(layer) {
    const template = TEMPLATE_OF(layer);
    if (!template) return { template, slope: false, detail: false };
    let reads = this.templateCache.get(template);
    if (!reads) {
      try {
        const res = await fetch(new URL(`src/vendor/wgsl/templates/${template}.wgsl`, document.baseURI));
        const source = res.ok ? await res.text() : '';
        reads = {
          detail: /prevDetail|inDetail/.test(source),
          height: /prevHeight|inHeight/.test(source),
        };
      } catch {
        reads = { detail: false, height: true };
      }
      this.templateCache.set(template, reads);
    }
    const maskSlope = (layer.masks || []).some((m) => m.enabled !== 0 && READ_SLOPE.has(m.kind));
    return { template, slope: maskSlope, detail: reads.detail };
  }

  plan(project) {
    const stages = [{ op: 'clearHeight' }];
    const fresh = { slope: false, detail: false };
    for (const layer of project.terrain) {
      if (layer.enabled === false) continue;
      if (EROSION_BY_ID[layer.type]) {
        stages.push({ op: 'sim', layer });
        fresh.slope = false;
        fresh.detail = false;
        continue;
      }
      const reads = this.templateCache.get(TEMPLATE_OF(layer)) || { slope: true, detail: true };
      if (reads.slope && !fresh.slope) { stages.push({ op: 'deriveSlope', src: 'stack' }); fresh.slope = true; }
      if (reads.detail && !fresh.detail) { stages.push({ op: 'deriveDetail', src: 'stack' }); fresh.detail = true; }
      stages.push({ op: 'layer', layer });
      fresh.slope = false;
      fresh.detail = false;
    }
    stages.push({ op: 'copyBase' });
    if (this.sculpted) stages.push({ op: 'sculpt' });
    stages.push({ op: 'deriveSlope', src: 'height' });
    stages.push({ op: 'deriveDetail', src: 'height' });
    stages.push({ op: 'deriveAo' });
    stages.push({ op: 'deriveNormal' });
    return stages;
  }

  async prepare(stages, project) {
    const gpu = this.gpu;
    const pass = (wgsl, defines) => gpu.pass({ wgsl, defines, label: wgsl.replace(/^.*\//, '').replace('.wgsl', '') });
    this.passes = {
      clear: pass('passes/clear_field.wgsl'),
      clearRgba: pass('passes/clear_rgba.wgsl'),
      downsample: pass('passes/downsample_field.wgsl'),
      slope: pass('passes/derive_slope.wgsl'),
      detail: pass('passes/derive_detail.wgsl'),
      ao: pass('passes/derive_ao.wgsl'),
      normal: pass('passes/derive_normal.wgsl'),
      sculptApply: pass('passes/sculpt_apply.wgsl'),
      flow: pass('passes/erosion_flow.wgsl'),
      transport: pass('passes/erosion_transport.wgsl'),
      thermal: pass('passes/erosion_thermal.wgsl'),
      apply: pass('passes/erosion_apply.wgsl'),
      brushSculpt: pass('passes/brush_sculpt.wgsl'),
      brushPaint: pass('passes/brush_paint.wgsl'),
    };
    for (const stage of stages) {
      if (stage.op === 'layer') {
        const template = TEMPLATE_OF(stage.layer);
        this.passes[`layer:${template}`] = pass('passes/terrain_layer.wgsl', { LAYER: template });
      }
    }
    await gpu.ready();
    return this;
  }

  /* ------------------------------------------------------------------ *
   * recording helpers
   * ------------------------------------------------------------------ */
  get res2d() { return [this.res, this.res]; }

  groups(width, height) { return ComputePass.groups(width, height, 8); }

  uniformContext(project) {
    return {
      world: project.world,
      simRes: this.simRes,
      sketchLift: project.display?.sketchLift ?? 0,
      sunAzimuth: project.display?.sunAzimuth ?? 132,
    };
  }

  runLayer(encoder, layer, project) {
    const f = this.fields;
    const pass = this.passes[`layer:${TEMPLATE_OF(layer)}`];
    const out = f.stack.next;
    pass.record(encoder, {
      uniform: packLayer(layer, this.uniformContext(project)),
      textures: {
        inHeight: f.stack.cur,
        inSlope: f.slope,
        inCurvature: f.curvature,
        inFlow: f.flow,
        inDeposit: f.deposit,
        inPaint: f.paint.cur,
        inSketch: f.sketch.cur,
        inDetail: f.detail,
      },
      storage: { outHeight: out },
      groups: this.groups(this.res, this.res),
    });
    f.stack.swap();
    return f.stack.cur;
  }

  runClear(encoder, field, value) {
    this.passes.clear.record(encoder, {
      uniform: packClear(field.width, field.height, value),
      storage: { outField: field },
      groups: this.groups(this.res, this.res),
    });
  }

  runClearRgba(encoder, field, value) {
    this.passes.clearRgba.record(encoder, {
      uniform: packClearRgba(field.width, field.height, value),
      storage: { outField: field },
      groups: this.groups(field.width, field.height),
    });
  }

  runDownsample(encoder, src, dst) {
    this.passes.downsample.record(encoder, {
      uniform: { srcDims: [src.width, src.height], dstDims: [dst.width, dst.height], pad0: 0, pad1: 0 },
      textures: { inField: src },
      storage: { outField: dst },
      groups: this.groups(dst.width, dst.height),
    });
  }

  copyTexture(encoder, src, dst) {
    encoder.copyTextureToTexture(
      { texture: src.texture, origin: { x: 0, y: 0 } },
      { texture: dst.texture, origin: { x: 0, y: 0 } },
      { width: Math.min(src.width, dst.width), height: Math.min(src.height, dst.height), depthOrArrayLayers: 1 },
    );
  }

  /* ------------------------------------------------------------------ *
   * generation
   * ------------------------------------------------------------------ */
  async generate(project, hooks = {}) {
    this.project = project;
    const started = now();
    this.gpu.counters.dispatches = 0;
    await this.resize(project.world);
    // Templates decide what they need to read, so the plan is built from the
    // template sources themselves — a new generator can never forget to
    // declare its dependencies.
    for (const layer of project.terrain) {
      if (layer.enabled === false || EROSION_BY_ID[layer.type]) continue;
      await this.templateReads(layer);
    }

    const stages = this.plan(project);
    await this.prepare(stages, project);
    hooks.onPlan?.(stages);

    const encoder = this.gpu.device.createCommandEncoder({ label: 'terrain-generate' });
    const f = this.fields;
    let stageIndex = 0;
    for (const stage of stages) {
      hooks.onStage?.(stage, stageIndex++, stages.length);
      switch (stage.op) {
        case 'clearHeight':
          this.runClear(encoder, f.stack.cur, 0);
          break;
        case 'layer':
          this.runLayer(encoder, stage.layer, project);
          break;
        case 'sim':
          this.runSim(encoder, stage.layer, project);
          break;
        case 'copyBase':
          this.copyTexture(encoder, f.stack.cur, f.base);
          break;
        case 'sculpt':
          this.runSculptApply(encoder);
          break;
        case 'deriveSlope': {
          const src = stage.src === 'height' ? f.height : f.stack.cur;
          this.runSlope(encoder, src);
          break;
        }
        case 'deriveDetail': {
          const src = stage.src === 'height' ? f.height : f.stack.cur;
          this.runDetail(encoder, src);
          break;
        }
        case 'deriveAo':
          this.runAo(encoder);
          break;
        case 'deriveNormal':
          this.runNormal(encoder);
          break;
        default:
          break;
      }
    }
    this.gpu.device.queue.submit([encoder.finish()]);
    this.gpu.counters.generates++;
    this.gpu.counters.lastGenerateMs = now() - started;
    hooks.onDone?.(this.gpu.counters.lastGenerateMs);
    return this.maps;
  }

  runSlope(encoder, src) {
    const f = this.fields;
    this.passes.slope.record(encoder, {
      uniform: {
        dims: this.res2d,
        cellMeters: this.cellMeters(),
        heightScale: this.project.world.heightScale,
        curvatureScale: 1,
        pad0: 0,
      },
      textures: { inHeight: src },
      storage: { outSlope: f.slope, outCurvature: f.curvature },
      groups: this.groups(this.res, this.res),
    });
  }

  runDetail(encoder, src) {
    this.passes.detail.record(encoder, {
      uniform: { dims: this.res2d, radiusTexels: Math.max(2, this.res / 512), gain: 1, pad0: 0, pad1: 0 },
      textures: { inHeight: src },
      storage: { outDetail: this.fields.detail },
      groups: this.groups(this.res, this.res),
    });
  }

  runAo(encoder) {
    const f = this.fields;
    this.passes.ao.record(encoder, {
      uniform: {
        dims: [f.ao.width, f.ao.height],
        srcDims: this.res2d,
        cellMeters: this.cellMeters() * AO_DIVISOR,
        heightScale: this.project.world.heightScale,
        radius: 220,
        strength: 1,
        cavity: 0.6,
        pad0: 0,
      },
      textures: { inHeight: f.height },
      storage: { outAo: f.ao },
      groups: this.groups(f.ao.width, f.ao.height),
    });
  }

  runNormal(encoder) {
    const f = this.fields;
    this.passes.normal.record(encoder, {
      uniform: {
        dims: this.res2d,
        cellMeters: this.cellMeters(),
        heightScale: this.project.world.heightScale,
        exaggeration: 1,
        pad0: 0,
      },
      textures: { inHeight: f.height },
      storage: { outNormal: f.normal },
      groups: this.groups(this.res, this.res),
    });
  }

  runSculptApply(encoder) {
    const f = this.fields;
    this.passes.sculptApply.record(encoder, {
      uniform: { dims: this.res2d, strength: 1, pad0: 0 },
      textures: { inHeight: f.base, inSculpt: f.sculpt.cur },
      storage: { outHeight: f.height },
      groups: this.groups(this.res, this.res),
    });
  }

  cellMeters() {
    return (this.project?.world.worldSize ?? 4096) / this.res;
  }

  /* ------------------------------------------------------------------ *
   * erosion
   * ------------------------------------------------------------------ */
  runSim(encoder, layer) {
    const sim = this.sim;
    const world = this.project.world;
    const params = layer.params || {};
    const cellMeters = world.worldSize / this.simRes;
    const dims = [this.simRes, this.simRes];

    // Seed the coarse grid from the current full-resolution stack result, then
    // snapshot it: the fold-back below is the difference between this snapshot
    // and whatever the solver produces.
    this.runDownsample(encoder, this.fields.stack.cur, sim.base);
    this.copyTexture(encoder, sim.base, sim.height.fields[0]);
    sim.height.i = 0;

    if (layer.type === 'hydraulic') {
      this.runClear(encoder, sim.water.fields[0], 0);
      this.runClear(encoder, sim.sediment.fields[0], 0);
      this.runClearRgba(encoder, sim.flow.fields[0], [0, 0, 0, 0]);
      sim.water.i = 0;
      sim.sediment.i = 0;
      sim.flow.i = 0;
    } else if (layer.type === 'thermal') {
      // Thermal erosion does not need water, but it must not erase the wetness
      // an earlier hydraulic entry produced.
      sim.water.i = 0;
      sim.sediment.i = 0;
      sim.flow.i = 0;
    }

    const iterations = Math.max(1, Math.round(params.iterations ?? 100));
    const dt = params.dt ?? 0.6;
    for (let i = 0; i < iterations; i++) {
      if (layer.type === 'hydraulic') {
        this.passes.flow.record(encoder, {
          uniform: {
            dims,
            dt,
            cellMeters,
            heightScale: world.heightScale,
            flowRate: params.flowRate ?? 32,
            pipePower: params.pipePower ?? 0.45,
            pad0: 0,
            pad1: 0,
          },
          textures: { inHeight: sim.height.cur, inWater: sim.water.cur },
          storage: { outFlux: sim.flux },
          groups: this.groups(this.simRes, this.simRes),
        });
        this.passes.transport.record(encoder, {
          uniform: {
            dims,
            dt,
            cellMeters,
            heightScale: world.heightScale,
            rain: params.rain ?? 0.0009,
            evaporation: params.evaporation ?? 0.012,
            capacity: params.capacity ?? 7,
            dissolve: params.dissolve ?? 0.5,
            depositRate: params.depositRate ?? 0.55,
            maxRate: params.maxRate ?? 0.06,
            minSlope: params.minSlope ?? 0.02,
            flowGain: params.flowGain ?? 1,
            iteration: i,
            thermalBias: 0,
            pad0: 0,
            pad1: 0,
          },
          textures: {
            inHeight: sim.height.cur,
            inWater: sim.water.cur,
            inSediment: sim.sediment.cur,
            inFlux: sim.flux,
            inFlow: sim.flow.cur,
          },
          storage: {
            outHeight: sim.height.next,
            outWater: sim.water.next,
            outSediment: sim.sediment.next,
            outFlow: sim.flow.next,
          },
          groups: this.groups(this.simRes, this.simRes),
        });
        sim.height.swap();
        sim.water.swap();
        sim.sediment.swap();
        sim.flow.swap();
      } else {
        this.passes.thermal.record(encoder, {
          uniform: {
            dims,
            dt,
            cellMeters,
            heightScale: world.heightScale,
            talus: params.talus ?? 0.62,
            rate: params.rate ?? 0.42,
            iterations,
            pad0: 0,
          },
          textures: { inHeight: sim.height.cur },
          storage: { outHeight: sim.height.next },
          groups: this.groups(this.simRes, this.simRes),
        });
        sim.height.swap();
      }
    }

    // Fold the eroded delta back onto the full-resolution field and merge the
    // wetness / deposit maps with whatever earlier erosion entries produced.
    const f = this.fields;
    const out = f.stack.next;
    this.passes.apply.record(encoder, {
      uniform: {
        dims: this.res2d,
        simDims: dims,
        flowGain: layer.flowGain ?? params.flowGain ?? 1,
        depositGain: layer.depositGain ?? 1,
        blend: layer.amount ?? 1,
        detailScale: 1,
        pad0: 0,
        pad1: 0,
      },
      textures: {
        inHeight: f.stack.cur,
        inCoarseBase: sim.base,
        inCoarseEroded: sim.height.cur,
        inCoarseFlow: sim.flow.cur,
        inPrevFlow: f.flow,
        inPrevDeposit: f.deposit,
      },
      storage: { outHeight: out, outFlow: f.flow, outDeposit: f.deposit },
      groups: this.groups(this.res, this.res),
    });
    f.stack.swap();
    this.log(`erosion ${layer.type}: ${iterations} steps at ${this.simRes}²`);
  }

  /* ------------------------------------------------------------------ *
   * brushes
   * ------------------------------------------------------------------ */
  /** Workgroup range covering a circular brush, so a stroke costs its own area. */
  brushRange(center, radius, res = this.res) {
    const r = Math.max(radius * res, 1);
    const x0 = Math.max(0, Math.floor(center[0] * res - r));
    const y0 = Math.max(0, Math.floor(center[1] * res - r));
    const x1 = Math.min(res, Math.ceil(center[0] * res + r) + 1);
    const y1 = Math.min(res, Math.ceil(center[1] * res + r) + 1);
    return {
      origin: [x0, y0],
      groups: { x: Math.max(1, Math.ceil((x1 - x0) / 8)), y: Math.max(1, Math.ceil((y1 - y0) / 8)), z: 1 },
    };
  }

  /**
   * One sculpt brush dab. Accumulates into the persistent sculpt buffer, then
   * re-folds it onto the pristine stack result, so strokes stay editable and
   * re-running the terrain stack never bakes them away.
   */
  sculptDab(brush) {
    const pass = this.passes?.brushSculpt;
    if (!pass?.ready || !this.fields) return;
    const f = this.fields;
    const range = this.brushRange(brush.center, brush.radius);
    const encoder = this.gpu.device.createCommandEncoder({ label: 'sculpt' });
    pass.record(encoder, {
      uniform: {
        dims: this.res2d,
        center: [brush.center[0], brush.center[1]],
        radius: brush.radius,
        strength: brush.strength,
        falloff: brush.falloff ?? 1.4,
        mode: brush.mode ?? 0,
        seed: brush.seed ?? Math.random(),
        spacing: brush.spacing ?? 0.4,
        noiseScale: brush.noiseScale ?? 3,
        inverted: brush.inverted ? 1 : 0,
        origin: range.origin,
      },
      textures: { inHeight: f.height, inSculpt: f.sculpt.cur },
      storage: { outSculpt: f.sculpt.next },
      groups: range.groups,
    });
    f.sculpt.swap();
    this.sculpted = true;
    // Normals are refreshed once the stroke ends: the baked normal map adds
    // micro detail, while the macro surface follows the height field live.
    this.runSculptApply(encoder);
    this.gpu.device.queue.submit([encoder.finish()]);
    this.gpu.counters.dispatches += 2;
  }

  /** One paint dab into the layer-paint, sketch or protection channel. */
  paintDab(brush) {
    const pass = this.passes?.brushPaint;
    if (!pass?.ready || !this.fields) return;
    const f = this.fields;
    const target = brush.target === 'sketch' ? f.sketch : f.paint;
    const range = this.brushRange(brush.center, brush.radius);
    const encoder = this.gpu.device.createCommandEncoder({ label: 'paint' });
    pass.record(encoder, {
      uniform: {
        dims: this.res2d,
        center: [brush.center[0], brush.center[1]],
        radius: brush.radius,
        strength: brush.strength,
        falloff: brush.falloff ?? 1.4,
        mode: brush.mode ?? 0,
        value: brush.value ?? 1,
        pad0: 0,
        origin: range.origin,
      },
      textures: { inField: target.cur },
      storage: { outField: target.next },
      groups: range.groups,
    });
    target.swap();
    this.gpu.device.queue.submit([encoder.finish()]);
    this.gpu.counters.dispatches++;
  }

  clearPaint(target = 'paint') {
    const f = this.fields;
    const field = target === 'sketch' ? f.sketch : f.paint;
    const encoder = this.gpu.device.createCommandEncoder({ label: 'clear-paint' });
    this.runClear(encoder, field.cur, 0);
    this.gpu.device.queue.submit([encoder.finish()]);
  }

  clearSculpt() {
    const f = this.fields;
    const encoder = this.gpu.device.createCommandEncoder({ label: 'clear-sculpt' });
    this.runClearRgba(encoder, f.sculpt.cur, [0, 0, 0, 0]);
    this.sculpted = false;
    this.copyTexture(encoder, f.stack.cur, f.base);
    this.runSculptApply(encoder);
    this.runNormal(encoder);
    this.gpu.device.queue.submit([encoder.finish()]);
  }

  /** Re-derive the downstream maps after a brush stroke ends. */
  commitStroke() {
    const encoder = this.gpu.device.createCommandEncoder({ label: 'stroke-commit' });
    this.runSlope(encoder, this.fields.height);
    this.runDetail(encoder, this.fields.height);
    this.runAo(encoder);
    this.runNormal(encoder);
    this.gpu.device.queue.submit([encoder.finish()]);
  }

  /* ------------------------------------------------------------------ *
   * readback
   * ------------------------------------------------------------------ */
  /** Elevation statistics for the status bar (never blocks generation). */
  async stats() {
    if (this.statsBusy || !this.fields) return null;
    this.statsBusy = true;
    try {
      const f = this.fields;
      const size = 256 * 256 * 4;
      const buffer = this.gpu.device.createBuffer({
        label: 'stats-readback',
        size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = this.gpu.device.createCommandEncoder({ label: 'stats' });
      this.runDownsample(encoder, f.height, f.stats);
      encoder.copyTextureToBuffer(
        { texture: f.stats.texture, origin: { x: 0, y: 0 } },
        { buffer, bytesPerRow: 256 * 4, rowsPerImage: 256 },
        { width: 256, height: 256, depthOrArrayLayers: 1 },
      );
      this.gpu.device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(buffer.getMappedRange().slice(0));
      buffer.unmap();
      buffer.destroy();
      let min = Infinity; let max = -Infinity; let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
      }
      const scale = this.project.world.heightScale;
      return {
        min: min * scale,
        max: max * scale,
        mean: (sum / data.length) * scale,
        relief: (max - min) * scale,
        heightScale: scale,
      };
    } catch (error) {
      this.log(`stats failed: ${error.message}`);
      return null;
    } finally {
      this.statsBusy = false;
    }
  }
}
