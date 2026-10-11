/**
 * Frontier Terrain Forge — material (texture) bake graph.
 *
 * The second half of the workflow: once the terrain exists, this bakes the real
 * maps a game engine would ship —
 *
 *   albedo      sRGB-encoded, rgba8
 *   orm         occlusion / roughness / metallic, glTF convention
 *   normal      tangent space, +Y up, cavity in alpha
 *   splat0/1    per-layer coverage, so an engine can re-blend the stack
 *
 * Each material layer is its own dispatch (tex_layer with a {{MATERIAL}}
 * template), composited source-over in stack order, then the finishing passes
 * add AO, dust, wetness and the micro normals. Resolution is independent of the
 * terrain field resolution: the three field inputs that are read per texel
 * (height, flow, AO) are resampled once into texture space first.
 */
import { ComputePass } from '../gpu/pass.js';
import { MATERIAL_BY_ID } from '../gen/schema.js';
import { layerTypeOf, packClearRgba, packLayer } from '../gen/pack.js';

const MAX_SPLAT_LAYERS = 8;
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

class Ping {
  constructor(a, b = a) { this.fields = [a, b]; this.i = 0; }
  get cur() { return this.fields[this.i]; }
  get next() { return this.fields[this.i ^ 1]; }
  swap() { this.i ^= 1; return this.cur; }
}

export class TextureBaker {
  constructor(gpu, options = {}) {
    this.gpu = gpu;
    this.log = options.log || (() => {});
    this.res = 0;
    this.fields = null;
    this.passes = null;
    this.lastStats = { dispatches: 0, ms: 0 };
  }

  async resize(resolution) {
    const res = Math.max(512, Math.min(4096, Math.round(resolution)));
    if (this.fields && this.res === res) return this;
    this.releaseFields();
    const gpu = this.gpu;
    const field = (spec) => gpu.field(spec);
    const byte = (label, format = 'rgba8unorm', srgb = false) =>
      field({ width: res, height: res, format, label, srgb });
    const scalar = (label) => field({ width: res, height: res, format: 'r32float', label });

    this.fields = {
      albedo: new Ping(byte('tex-albedo', 'rgba8unorm', true), byte('tex-albedo-b', 'rgba8unorm', true)),
      material: new Ping(byte('tex-material'), byte('tex-material-b')),
      weight: byte('tex-weight', 'r8unorm'),
      color: byte('tex-color', 'rgba8unorm', true),
      layerMaterial: byte('tex-layer-material'),
      albedoOut: byte('tex-albedo-out', 'rgba8unorm', true),
      orm: byte('tex-orm'),
      normal: byte('tex-normal'),
      splat0: byte('tex-splat0'),
      splat1: byte('tex-splat1'),
      slots: Array.from({ length: MAX_SPLAT_LAYERS }, (_, i) => byte(`tex-weight-slot${i}`, 'r8unorm')),
      // resampled field inputs, in texture space
      heightT: scalar('tex-height-input'),
      flowT: scalar('tex-flow-input'),
      aoT: scalar('tex-ao-input'),
    };
    this.res = res;
    this.log(`textures: ${res}×${res} bake targets`);
    return this;
  }

  releaseFields() {
    const release = (field) => {
      if (!field) return;
      if (field instanceof Ping) { field.fields.forEach(release); return; }
      if (Array.isArray(field)) { field.forEach(release); return; }
      this.gpu.release(field);
    };
    if (this.fields) Object.values(this.fields).forEach(release);
    this.fields = null;
    this.res = 0;
     this.gpu.clearCaches();
  }

  get maps() {
    const f = this.fields;
    if (!f) return null;
    return {
      albedo: f.albedoOut,
      orm: f.orm,
      normal: f.normal,
      splat0: f.splat0,
      splat1: f.splat1,
      resolution: this.res,
    };
  }

  /** Base surface the stack blends onto: dark untextured substrate, rough. */
  baseFill() {
    const substrate = [0.16, 0.15, 0.14];
    return {
      albedo: [linearToSrgb(substrate[0]), linearToSrgb(substrate[1]), linearToSrgb(substrate[2]), 1],
      material: [0.85, 0, 0.2, 0],
    };
  }

  async prepare(project) {
    const gpu = this.gpu;
    const pass = (wgsl, defines) => gpu.pass({ wgsl, defines, label: wgsl.replace(/^.*\//, '').replace('.wgsl', '') });
    this.passes = {
      clear8: pass('passes/clear_rgba8.wgsl'),
      resample: pass('passes/downsample_field.wgsl'),
      composite: pass('passes/tex_composite.wgsl'),
      normal: pass('passes/tex_normal.wgsl'),
      finish: pass('passes/tex_finish.wgsl'),
      splat: pass('passes/tex_splat.wgsl'),
    };
    for (const layer of project.materials) {
      if (layer.enabled === false) continue;
      const template = layerTypeOf(layer)?.template;
      if (!template) continue;
      this.passes[`layer:${template}`] = pass('passes/tex_layer.wgsl', { MATERIAL: template });
    }
    await gpu.ready();
    return this;
  }

  groups(w, h) { return ComputePass.groups(w, h, 8); }

  resample(encoder, src, dst, srcHeight = src.height) {
    this.passes.resample.record(encoder, {
      uniform: {
        srcDims: [src.width, srcHeight],
        dstDims: [dst.width, dst.height],
        pad0: 0,
        pad1: 0,
      },
      textures: { inField: src },
      storage: { outField: dst },
      groups: this.groups(dst.width, dst.height),
    });
  }

  /**
   * Bake the material stack.
   * @param {object} project
   * @param {object} terrainMaps  from TerrainGraph#maps
   * @param {object} hooks        { onStage(name, index, total) }
   */
  async bake(project, terrainMaps, hooks = {}) {
    const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const resolution = project.texture?.resolution ?? 2048;
    await this.resize(resolution);
    await this.prepare(project);

    const texture = project.texture || {};
    const world = project.world;
    const T = this.res;
    const cellMeters = world.worldSize / T;
    const layers = project.materials.filter((layer) => layer.enabled !== false && MATERIAL_BY_ID[layer.type]);
    const total = layers.length + 5;

    const encoder = this.gpu.device.createCommandEncoder({ label: 'material-bake' });
    const f = this.fields;

    // 1. field inputs in texture space (height/flow/AO are read per texel by the
    //    normal and finish passes, so they must match the bake resolution).
    hooks.onStage?.('inputs', 0, total);
    this.resample(encoder, terrainMaps.height, f.heightT, terrainMaps.height.height);
    this.resample(encoder, terrainMaps.flow, f.flowT, terrainMaps.flow.height);
    this.resample(encoder, terrainMaps.ao, f.aoT, terrainMaps.ao.height);

    // 2. base fill + clear the coverage slots
    const fill = this.baseFill();
    const clearTo = (field, value) => this.passes.clear8.record(encoder, {
      uniform: packClearRgba(T, T, value),
      storage: { outField: field },
      groups: this.groups(T, T),
    });
    clearTo(f.albedo.fields[0], fill.albedo);
    clearTo(f.material.fields[0], fill.material);
    f.albedo.i = 0;
    f.material.i = 0;
    for (const slot of f.slots) clearTo(slot, [0, 0, 0, 0]);

    // 3. one pass per material layer, composited in stack order
    layers.forEach((layer, index) => {
      hooks.onStage?.(layer.name, index + 1, total);
      const template = layerTypeOf(layer).template;
      this.gpu.pass({ wgsl: 'passes/tex_layer.wgsl', defines: { MATERIAL: template }, label: `mat:${layer.name}` }).record(encoder, {
        uniform: packLayer(layer, {
          world,
          materials: true,
          outputRes: T,
          simRes: world.resolution / 2,
          sketchLift: 0,
          sunAzimuth: project.display?.sunAzimuth ?? 132,
        }),
        textures: {
          inHeight: terrainMaps.height,
          inSlope: terrainMaps.slope,
          inCurvature: terrainMaps.curvature,
          inFlow: terrainMaps.flow,
          inDeposit: terrainMaps.deposit,
          inPaint: terrainMaps.paint,
          inSketch: terrainMaps.sketch,
          inAo: terrainMaps.ao,
        },
        storage: { outWeight: f.weight, outColor: f.color, outMaterial: f.layerMaterial },
        groups: this.groups(T, T),
      });

      this.passes.composite.record(encoder, {
        uniform: { dims: [T, T], blend: texture.splatBlend ?? 1, pad0: 0, pad1: 0 },
        textures: {
          inWeight: f.weight,
          inColor: f.color,
          inMaterial: f.layerMaterial,
          inAlbedo: f.albedo.cur,
          inPrevMaterial: f.material.cur,
        },
        storage: { outAlbedo: f.albedo.next, outMaterial: f.material.next },
        groups: this.groups(T, T),
      });
      f.albedo.swap();
      f.material.swap();

      if (index < MAX_SPLAT_LAYERS) this.copyTexture(encoder, f.weight, f.slots[index]);
    });

    // 4. normal map with flow-anisotropic micro detail
    hooks.onStage?.('normal', layers.length + 1, total);
    this.passes.normal.record(encoder, {
      uniform: {
        dims: [T, T],
        cellMeters,
        heightScale: world.heightScale,
        exaggeration: texture.normalExaggeration ?? 1,
        microScale: texture.microScale ?? Math.max(96, Math.round(T / 9)),
        microStrength: texture.microStrength ?? 1,
        seed: 0.42,
        pad0: 0,
      },
      textures: { inHeight: f.heightT, inMaterial: f.material.cur, inFlow: f.flowT, inAo: f.aoT },
      storage: { outNormal: f.normal },
      groups: this.groups(T, T),
    });

    // 5. AO, cavity, dust, wetness and the ORM packing
    hooks.onStage?.('finish', layers.length + 2, total);
    this.passes.finish.record(encoder, {
      uniform: {
        dims: [T, T],
        waterLevel: world.waterLevel ?? 0.16,
        wetness: texture.wetness ?? 1,
        dust: texture.dust ?? 0.6,
        aoStrength: texture.aoStrength ?? 0.9,
        cavityStrength: texture.cavityStrength ?? 0.5,
        saturateWet: texture.wetSaturation ?? 0.7,
        pad0: 0,
      },
      textures: {
        inAlbedo: f.albedo.cur,
        inMaterial: f.material.cur,
        inAo: f.aoT,
        inFlow: f.flowT,
        inHeight: f.heightT,
      },
      storage: { outAlbedo: f.albedoOut, outOrm: f.orm },
      groups: this.groups(T, T),
    });

    // 6. splat maps — the exact coverage the composite used
    hooks.onStage?.('splat', layers.length + 3, total);
    // Slots past the layer count were cleared to zero and never written, so a
    // short stack still packs the full eight-layer splat layout.
    const slots = f.slots;
    this.passes.splat.record(encoder, {
      uniform: { dims: [T, T], layers: Math.max(1, Math.min(MAX_SPLAT_LAYERS, layers.length)), pad0: 0 },
      textures: {
        w0: slots[0], w1: slots[1], w2: slots[2], w3: slots[3],
        w4: slots[4], w5: slots[5], w6: slots[6], w7: slots[7],
      },
      storage: { outSplat0: f.splat0, outSplat1: f.splat1 },
      groups: this.groups(T, T),
    });

    this.gpu.device.queue.submit([encoder.finish()]);
    this.lastStats = {
      dispatches: 3 + 2 * layers.length + 4,
      ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started,
      layers: layers.length,
      resolution: T,
    };
    hooks.onDone?.(this.lastStats);
    return this.maps;
  }

  copyTexture(encoder, src, dst) {
    encoder.copyTextureToTexture(
      { texture: src.texture, origin: { x: 0, y: 0 } },
      { texture: dst.texture, origin: { x: 0, y: 0 } },
      { width: Math.min(src.width, dst.width), height: Math.min(src.height, dst.height), depthOrArrayLayers: 1 },
    );
  }

  /** Read a baked map back to the CPU (used by the PNG exporter). */
  async readPixels(field) {
    const bytesPerRow = Math.ceil((field.width * 4) / 256) * 256;
    const size = bytesPerRow * field.height;
    const buffer = this.gpu.device.createBuffer({
      label: `readback:${field.label}`,
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.gpu.device.createCommandEncoder({ label: 'readback' });
    encoder.copyTextureToBuffer(
      { texture: field.texture, origin: { x: 0, y: 0 } },
      { buffer, bytesPerRow, rowsPerImage: field.height },
      { width: field.width, height: field.height, depthOrArrayLayers: 1 },
    );
    this.gpu.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buffer.getMappedRange().slice(0));
    buffer.unmap();
    buffer.destroy();
    const out = new Uint8Array(field.width * field.height * 4);
    for (let y = 0; y < field.height; y++) {
      out.set(src.subarray(y * bytesPerRow, y * bytesPerRow + field.width * 4), y * field.width * 4);
    }
    return out;
  }
}
