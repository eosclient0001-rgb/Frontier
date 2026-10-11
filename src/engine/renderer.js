// =================================================================================================
//  renderer.js — frame graph
// -------------------------------------------------------------------------------------------------
//   1  shadow cascades   terrain depth from the sun, three fitted cascades
//   2  scene             sky, then terrain, then an optional wireframe overlay
//   3  water             deferred, reads the scene colour and depth
//   4  bloom             threshold, quarter-res separable blur
//   5  composite         exposure, ACES filmic curve, vignette, grain, dither
//
//  Everything up to the composite is rgba16float in linear light. Nothing is clamped until the
//  tone curve, which is what keeps highlights on snow and water recoverable.
// =================================================================================================

import { wgsl } from './wgsl.js';
import { mat4, ortho, lookAt, multiply, invert, clamp } from './mat4.js';
import { packAtmoParams, ATMO_FLOATS, sunDirection, ATMO_DEFAULTS } from './atmosphere.js';
import { packTexLayer, TEX_LAYER_STRIDE } from './texture-schema.js';

const HDR_FORMAT = 'rgba16float';
const DEPTH_FORMAT = 'depth32float';
export const MAX_TEX_LAYERS = 16;

const SCENE_ENTRIES = [
  { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
  { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
  { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
  { binding: 3, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
  { binding: 4, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
  { binding: 5, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: {} },
  { binding: 6, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: {} },
  { binding: 7, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
  { binding: 8, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
  { binding: 9, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
  { binding: 10, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
  { binding: 11, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
  { binding: 12, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: {} },
  { binding: 13, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
];

const CASCADES = 3;

export class Renderer {
  constructor(device, canvas, solver) {
    this.device = device;
    this.canvas = canvas;
    this.solver = solver;
    this.context = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device, format: this.format, alphaMode: 'opaque' });

    this.shadowDim = 2048;
    this.renderScale = 1;
    this.wireframe = false;
    this.debugView = 0;
    this.atmoQuality = 10;
    this.width = 1;
    this.height = 1;
    this.meshRes = 1024;
    this.stats = { fps: 0, tris: 0, ms: 0 };

    this._scratch = mat4();
    this._camera = new Float32Array(56);
    this._terrain = new Float32Array(20);
    this._atmo = new Float32Array(ATMO_FLOATS);
    this._shadow = new Float32Array(64);
    this._water = new Float32Array(24);
    this._post = new Float32Array(16);
    this._layers = new Float32Array(MAX_TEX_LAYERS * TEX_LAYER_STRIDE);
    this._lightBuf = new Float32Array(64);

    this._createBuffers();
    this._createTargets();
    this._createPipelines();
    this._createBindGroups();
    // Valid from the first frame: the LUT pass reads this, so it must never be undefined.
    this._atmoLutState = ATMO_DEFAULTS;
    this._atmoDirty = true;
  }

  // --- resources -----------------------------------------------------------------------------------

  _createBuffers() {
    const d = this.device;
    const U = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    this.cameraBuf = d.createBuffer({ size: 224, usage: U });
    this.terrainBuf = d.createBuffer({ size: 80, usage: U });
    this.atmoBuf = d.createBuffer({ size: ATMO_FLOATS * 4, usage: U });
    this.shadowBuf = d.createBuffer({ size: 256, usage: U });
    this.waterBuf = d.createBuffer({ size: 96, usage: U });
    this.postBuf = d.createBuffer({ size: 64, usage: U });
    this.lightBuf = d.createBuffer({ size: 256 * CASCADES, usage: U });

    this.layersBuf = d.createBuffer({
      size: MAX_TEX_LAYERS * TEX_LAYER_STRIDE * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.shBuf = d.createBuffer({
      size: 144,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.linearSampler = d.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });
    this.shadowSampler = d.createSampler({
      compare: 'less-equal', magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });

    // --- atmosphere tables -----------------------------------------------------------------------
    this.transLut = d.createTexture({
      size: [256, 64],
      format: HDR_FORMAT,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.transLutView = this.transLut.createView();
    this.atmoUniform = d.createBuffer({ size: ATMO_FLOATS * 4, usage: U });
    this.atmoUniform2 = d.createBuffer({ size: ATMO_FLOATS * 4, usage: U });
  }

  _createTargets() {
    const d = this.device;
    this.sceneColor = null;
    this.sceneDepth = null;
    this.finalColor = null;

    this.shadowMap = d.createTexture({
      size: [this.shadowDim, this.shadowDim, CASCADES],
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.shadowView = this.shadowMap.createView({ dimension: '2d-array' });
    this.shadowLayerViews = [0, 1, 2].map((i) =>
      this.shadowMap.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 })
    );
  }

  _createPipelines() {
    const d = this.device;
    this.sceneLayout = d.createBindGroupLayout({ entries: SCENE_ENTRIES });
    const scenePipelineLayout = d.createPipelineLayout({ bindGroupLayouts: [this.sceneLayout] });

    const renderModule = d.createShaderModule({ code: wgsl('terrain-render.wgsl') });

    this.terrainPipeline = d.createRenderPipeline({
      layout: scenePipelineLayout,
      vertex: { module: renderModule, entryPoint: 'vsTerrain' },
      fragment: { module: renderModule, entryPoint: 'fsTerrain', targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    });

    this.wirePipeline = d.createRenderPipeline({
      layout: scenePipelineLayout,
      vertex: { module: renderModule, entryPoint: 'vsTerrain' },
      fragment: { module: renderModule, entryPoint: 'fsWire', targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: 'line-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less-equal' },
    });

    this.skyPipeline = d.createRenderPipeline({
      layout: scenePipelineLayout,
      vertex: { module: renderModule, entryPoint: 'vsSky' },
      fragment: { module: renderModule, entryPoint: 'fsSky', targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'always' },
    });

    // --- shadow ------------------------------------------------------------------------------------
    this.lightLayout = d.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {} }],
    });
    this.shadowPipeline = d.createRenderPipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.sceneLayout, this.lightLayout] }),
      vertex: { module: renderModule, entryPoint: 'vsShadow' },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    });

    // --- water -------------------------------------------------------------------------------------
    const waterModule = d.createShaderModule({ code: wgsl('water.wgsl') });
    this.waterLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
      ],
    });
    this.waterPipeline = d.createRenderPipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.sceneLayout, this.waterLayout] }),
      vertex: { module: waterModule, entryPoint: 'vsFullscreen' },
      fragment: { module: waterModule, entryPoint: 'fsWater', targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: 'triangle-list' },
    });

    // --- atmosphere -------------------------------------------------------------------------------
    const transModule = d.createShaderModule({ code: wgsl('sky-transmittance.wgsl') });
    this.transLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {} },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: HDR_FORMAT } },
      ],
    });
    this.transPipeline = d.createComputePipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.transLayout] }),
      compute: { module: transModule, entryPoint: 'transmittance' },
    });

    const shModule = d.createShaderModule({ code: wgsl('sky-sh.wgsl') });
    this.shLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {} },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this.shPipeline = d.createComputePipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.shLayout] }),
      compute: { module: shModule, entryPoint: 'irradianceSH' },
    });

    // --- post --------------------------------------------------------------------------------------
    const postModule = d.createShaderModule({ code: wgsl('post.wgsl') });
    this.postLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
      ],
    });
    const postPipelineLayout = d.createPipelineLayout({ bindGroupLayouts: [this.postLayout] });
    this.postPipelines = {
      prefilter: d.createRenderPipeline({
        layout: postPipelineLayout,
        vertex: { module: postModule, entryPoint: 'vsPost' },
        fragment: { module: postModule, entryPoint: 'prefilter', targets: [{ format: HDR_FORMAT }] },
        primitive: { topology: 'triangle-list' },
      }),
      blurH: d.createRenderPipeline({
        layout: postPipelineLayout,
        vertex: { module: postModule, entryPoint: 'vsPost' },
        fragment: { module: postModule, entryPoint: 'blurH', targets: [{ format: HDR_FORMAT }] },
        primitive: { topology: 'triangle-list' },
      }),
      blurV: d.createRenderPipeline({
        layout: postPipelineLayout,
        vertex: { module: postModule, entryPoint: 'vsPost' },
        fragment: { module: postModule, entryPoint: 'blurV', targets: [{ format: HDR_FORMAT }] },
        primitive: { topology: 'triangle-list' },
      }),
      composite: d.createRenderPipeline({
        layout: postPipelineLayout,
        vertex: { module: postModule, entryPoint: 'vsPost' },
        fragment: { module: postModule, entryPoint: 'composite', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list' },
      }),
    };
  }

  _createBindGroups() {
    const d = this.device;
    const s = this.solver;
    this.sceneBind = d.createBindGroup({
      layout: this.sceneLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuf } },
        { binding: 1, resource: { buffer: this.terrainBuf } },
        { binding: 2, resource: { buffer: this.atmoBuf } },
        { binding: 3, resource: { buffer: this.shadowBuf } },
        { binding: 4, resource: s.heightView },
        { binding: 5, resource: s.normalView },
        { binding: 6, resource: s.surfView },
        { binding: 7, resource: this.linearSampler },
        { binding: 8, resource: this.shadowSampler },
        { binding: 9, resource: this.shadowView },
        { binding: 10, resource: { buffer: this.layersBuf } },
        { binding: 11, resource: { buffer: this.shBuf } },
        { binding: 12, resource: this.transLutView },
        { binding: 13, resource: this.linearSampler },
      ],
    });

    this.lightBind = [0, 1, 2].map((i) =>
      d.createBindGroup({
        layout: this.lightLayout,
        entries: [{ binding: 0, resource: { buffer: this.lightBuf, offset: i * 256, size: 64 } }],
      })
    );

    this.transBind = d.createBindGroup({
      layout: this.transLayout,
      entries: [
        { binding: 0, resource: { buffer: this.atmoUniform } },
        { binding: 1, resource: this.transLutView },
      ],
    });
    this.shBind = d.createBindGroup({
      layout: this.shLayout,
      entries: [
        { binding: 0, resource: { buffer: this.atmoUniform2 } },
        { binding: 1, resource: this.transLutView },
        { binding: 2, resource: this.linearSampler },
        { binding: 3, resource: { buffer: this.shBuf } },
      ],
    });
  }

  // The scene bind group references solver textures, so it is rebuilt whenever the field is
  // reallocated at a new resolution.
  rebuildSceneBind() {
    this._createBindGroups();
  }

  resize(width, height) {
    const w = Math.max(2, Math.floor(width * this.renderScale));
    const h = Math.max(2, Math.floor(height * this.renderScale));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    const d = this.device;
    for (const t of [this.sceneColor, this.sceneDepth, this.finalColor, this.bloomA, this.bloomB]) {
      if (t) t.destroy();
    }
    const mk = (format, usage) => d.createTexture({ size: [w, h], format, usage });
    const colour = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    this.sceneColor = mk(HDR_FORMAT, colour);
    this.finalColor = mk(HDR_FORMAT, colour);
    this.sceneDepth = mk(DEPTH_FORMAT, GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
    const bw = Math.max(2, w >> 2);
    const bh = Math.max(2, h >> 2);
    this.bloomA = d.createTexture({ size: [bw, bh], format: HDR_FORMAT, usage: colour });
    this.bloomB = d.createTexture({ size: [bw, bh], format: HDR_FORMAT, usage: colour });

    this.sceneColorView = this.sceneColor.createView();
    this.finalColorView = this.finalColor.createView();
    this.sceneDepthView = this.sceneDepth.createView();
    this.bloomAView = this.bloomA.createView();
    this.bloomBView = this.bloomB.createView();

    const post = (src, other) =>
      d.createBindGroup({
        layout: this.postLayout,
        entries: [
          { binding: 0, resource: src },
          { binding: 1, resource: other },
          { binding: 2, resource: this.linearSampler },
          { binding: 3, resource: { buffer: this.postBuf } },
        ],
      });
    this.postBind = {
      prefilter: post(this.finalColorView, this.finalColorView),
      blurH: post(this.bloomAView, this.bloomAView),
      blurV: post(this.bloomBView, this.bloomBView),
      composite: post(this.finalColorView, this.bloomAView),
    };

    this.waterBind = d.createBindGroup({
      layout: this.waterLayout,
      entries: [
        { binding: 0, resource: this.sceneColorView },
        { binding: 1, resource: this.sceneDepthView },
        { binding: 2, resource: this.linearSampler },
        { binding: 3, resource: { buffer: this.waterBuf } },
      ],
    });

    const u = this._post;
    u[12] = 1 / w;
    u[13] = 1 / h;
    u[14] = 1 / bw;
    u[15] = 1 / bh;
  }

  setMeshRes(res) {
    // A 4096² grid needs 400 MB of indices, which is over the default maxBufferSize on most
    // adapters. Clamp rather than throwing, and say so once.
    const limit = this.device.limits?.maxBufferSize ?? 268435456;
    let r = Math.max(64, Math.min(res, 4096));
    while (r > 64 && (r - 1) * (r - 1) * 6 * 4 > limit) r = Math.floor(r / 2);
    this.maxMeshRes = r;
    if (r === this.meshRes && this.indexBuffer) return;
    this.meshRes = r;
    this._buildIndexBuffers();
  }

  _buildIndexBuffers() {
    const d = this.device;
    const R = this.meshRes;
    if (this.indexBuffer) this.indexBuffer.destroy();
    if (this.wireBuffer) this.wireBuffer.destroy();

    const quads = (R - 1) * (R - 1);
    const idx = new Uint32Array(quads * 6);
    let o = 0;
    for (let y = 0; y < R - 1; y++) {
      for (let x = 0; x < R - 1; x++) {
        const a = y * R + x;
        const b = a + 1;
        const c = a + R;
        const dd = c + 1;
        idx[o++] = a; idx[o++] = c; idx[o++] = b;
        idx[o++] = b; idx[o++] = c; idx[o++] = dd;
      }
    }
    this.indexBuffer = d.createBuffer({
      size: idx.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(this.indexBuffer, 0, idx);
    this.indexCount = idx.length;

    // Wireframe: a coarse lattice drawn over the same vertex space, so no extra geometry is
    // uploaded and the lines always follow the displaced surface exactly.
    const step = Math.max(1, Math.round((R - 1) / 64));
    const lines = [];
    for (let y = 0; y < R; y += step) {
      for (let x = 0; x + step < R; x += step) {
        lines.push(y * R + x, y * R + x + step);
      }
    }
    for (let x = 0; x < R; x += step) {
      for (let y = 0; y + step < R; y += step) {
        lines.push(y * R + x, (y + step) * R + x);
      }
    }
    const wire = new Uint32Array(lines);
    this.wireBuffer = d.createBuffer({
      size: Math.max(4, wire.byteLength),
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    if (wire.length) d.queue.writeBuffer(this.wireBuffer, 0, wire);
    this.wireCount = wire.length;
  }

  // --- per-frame state -----------------------------------------------------------------------------

  updateAtmosphere(state) {
    packAtmoParams(this._atmo, state, this.atmoQuality, 1);
    // The table passes and the frame draw read different uniform copies, so rebuilding the LUT
    // can never race with a draw that is still using the previous one.
    this._atmoLutState = state;
    this._atmoDirty = true;
  }

  _rebuildAtmosphereTables() {
    const d = this.device;
    const lut = new Float32Array(ATMO_FLOATS);
    packAtmoParams(lut, this._atmoLutState, 12, 1);
    d.queue.writeBuffer(this.atmoUniform, 0, lut);
    d.queue.writeBuffer(this.atmoUniform2, 0, lut);
    d.queue.writeBuffer(this.atmoBuf, 0, this._atmo);

    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.transPipeline);
    pass.setBindGroup(0, this.transBind);
    pass.dispatchWorkgroups(Math.ceil(256 / 16), Math.ceil(64 / 16));
    pass.setPipeline(this.shPipeline);
    pass.setBindGroup(0, this.shBind);
    pass.dispatchWorkgroups(9);
    pass.end();
    d.queue.submit([enc.finish()]);
    this._atmoDirty = false;
  }

  // The editor keeps its stack top-first, the same way the terrain stack does, so the layer the
  // user sees at the top of the list is the one that paints last. The shader walks its array from
  // index 0, so the upload reverses the order — index 0 on the GPU is the base layer.
  updateTextureLayers(layers) {
    const v = this._layers;
    v.fill(0);
    const n = Math.min(MAX_TEX_LAYERS, layers.length);
    for (let i = 0; i < n; i++) packTexLayer(v, layers[n - 1 - i], i);
    this.device.queue.writeBuffer(this.layersBuf, 0, v);
    this.layerCount = n;
  }

  _updateCamera(camera) {
    const u = this._camera;
    u.set(camera.viewProj, 0);
    u.set(camera.invViewProj, 16);
    u.set(camera.view, 32);
    u[48] = camera.position[0];
    u[49] = camera.position[1];
    u[50] = camera.position[2];
    u[51] = 1;
    u[52] = camera.near;
    u[53] = camera.far;
    u[54] = Math.tan(camera.fov / 2);
    u[55] = camera.aspect || 1.6;
    this.device.queue.writeBuffer(this.cameraBuf, 0, u);
  }

  _updateTerrain(state, time) {
    const u = this._terrain;
    u[0] = state.extent;
    u[1] = state.heightMeters;
    u[2] = this.solver.res;
    u[3] = this.meshRes;
    u[4] = state.waterLevel;
    u[5] = this.debugView;
    u[6] = time;
    u[7] = state.extent / this.solver.res;
    u[8] = state.aoStrength ?? 0.85;
    u[9] = state.cavityStrength ?? 0.55;
    u[10] = state.wetnessStrength ?? 0.9;
    u[11] = this.layerCount ?? 0;
    u[12] = state.normalStrength ?? 1.0;
    u[13] = state.lodBias ?? 0;
    u[14] = state.shadowStrength ?? 1;
    u[15] = state.subsurface ?? 0.12;
    u[16] = 16;                       // wireframe lattice spacing
    u[17] = CASCADES;
    u[18] = this.atmoQuality;
    u[19] = this.renderScale;
    this.device.queue.writeBuffer(this.terrainBuf, 0, u);
  }

  _updateWater(state, time) {
    const u = this._water;
    const w = state.water ?? {};
    u[0] = w.enabled ? 1 : 0;
    u[1] = state.waterLevel;
    u[2] = w.roughness ?? 0.06;
    u[3] = w.waveAmplitude ?? 0.035;
    const abs = hexToVec(w.absorption ?? '#1d4f52');
    u[4] = abs[0]; u[5] = abs[1]; u[6] = abs[2];
    u[7] = w.refractionIndex ?? 1.333;
    const sc = hexToVec(w.scatter ?? '#2f6b6b');
    u[8] = sc[0]; u[9] = sc[1]; u[10] = sc[2];
    u[11] = w.foam ?? 0.5;
    u[12] = w.waveScale ?? 6;
    u[13] = w.waveSpeed ?? 0.6;
    u[14] = w.choppiness ?? 0.5;
    u[15] = w.shoreWidth ?? 2.5;
    u[16] = w.reflectivity ?? 0.85;
    u[17] = w.absorptionStrength ?? 0.12;
    u[18] = w.sparkle ?? 1;
    u[19] = w.sunGlitter ?? 1;
    u[20] = Math.cos(((w.flowDirection ?? 40) * Math.PI) / 180);
    u[21] = Math.sin(((w.flowDirection ?? 40) * Math.PI) / 180);
    u[22] = 6000;
    u[23] = 0;
    this.device.queue.writeBuffer(this.waterBuf, 0, u);
  }

  _updatePost(state, time) {
    const u = this._post;
    u[0] = state.exposure ?? 0.62;
    u[1] = state.contrast ?? 1.04;
    u[2] = state.saturation ?? 1.06;
    u[3] = state.vignette ?? 0.28;
    u[4] = state.grain ?? 0.12;
    u[5] = state.bloom ?? 0.35;
    u[6] = state.bloomThreshold ?? 1.1;
    u[7] = time;
    u[8] = state.temperature ?? 0;
    u[9] = state.tint ?? 0;
    u[10] = 2.2;
    u[11] = 0;
    this.device.queue.writeBuffer(this.postBuf, 0, u);
  }

  // --- cascaded shadow maps ------------------------------------------------------------------------

  _computeCascades(camera, state) {
    const sun = sunDirection(state.sunElevation, state.sunAzimuth);
    const dist = Math.max(camera.distance, 1);
    const extent = state.extent;
    const heightRange = state.heightMeters;

    const splits = [
      clamp(dist * 0.55, 30, 40000),
      clamp(dist * 2.2, 60, 90000),
    ];

    // Terrain bounds: the shadow caster is the heightfield and nothing else, so the cascades can
    // be fitted to it instead of to the whole frustum.
    const half = extent * 0.5 + 1;
    const box = {
      min: [-half, -50, -half],
      max: [half, heightRange * 2 + 200, half],
    };

    const corners = new Float32Array(8 * 4);
    const mats = [];
    // frustumCorners takes NDC z, not world distance. The projection maps view-space depth to
    // [0, 1], so each split distance has to be pushed through that mapping first.
    const toNdcZ = (d) => {
      const dd = clamp(d, camera.near, camera.far);
      return clamp((camera.far * (dd - camera.near)) / (dd * (camera.far - camera.near)), 0, 1);
    };
    let prev = camera.near;
    for (let c = 0; c < CASCADES; c++) {
      const zFar = c === CASCADES - 1 ? camera.far : Math.min(splits[c], camera.far);
      frustumCorners(corners, camera.invViewProj, toNdcZ(prev), toNdcZ(zFar));
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < 8; i++) {
        const x = corners[i * 4];
        const y = corners[i * 4 + 1];
        const z = corners[i * 4 + 2];
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      // Clamp the slice to the terrain bounds: parts of the frustum that contain nothing do not
      // need shadow resolution.
      minX = Math.max(minX, box.min[0]); maxX = Math.min(maxX, box.max[0]);
      minY = Math.max(minY, box.min[1]); maxY = Math.min(maxY, box.max[1]);
      minZ = Math.max(minZ, box.min[2]); maxZ = Math.min(maxZ, box.max[2]);
      if (maxX < minX || maxY < minY || maxZ < minZ) {
        minX = box.min[0]; maxX = box.max[0];
        minY = box.min[1]; maxY = box.max[1];
        minZ = box.min[2]; maxZ = box.max[2];
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const cz = (minZ + maxZ) / 2;
      const radius = Math.max(
        Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 0.5,
        extent * 0.02
      );

      const lightDist = radius + heightRange + 500;
      const eye = [cx + sun[0] * lightDist, cy + sun[1] * lightDist, cz + sun[2] * lightDist];
      const view = mat4();
      lookAt(view, eye, [cx, cy, cz], [0, 1, 0]);
      const proj = mat4();
      ortho(proj, -radius, radius, -radius, radius, 1, lightDist * 2 + radius);
      const vp = mat4();
      multiply(vp, proj, view);

      // Snap the centre to whole shadow texels: without this the cascades shimmer as the camera
      // moves, which is far more visible than the resolution loss it costs.
      const texel = (2 * radius) / this.shadowDim;
      const snap = (v) => Math.round(v / texel) * texel;
      const inv = mat4();
      invert(inv, vp);
      const origin = transformPoint(inv, [0, 0, 0]);
      const dx = snap(origin[0]) - origin[0];
      const dy = snap(origin[1]) - origin[1];
      const dz = snap(origin[2]) - origin[2];
      if (dx || dy || dz) {
        const shifted = mat4();
        lookAt(shifted, [eye[0] + dx, eye[1] + dy, eye[2] + dz], [cx + dx, cy + dy, cz + dz], [0, 1, 0]);
        multiply(vp, proj, shifted);
      }

      mats.push(vp);
      prev = Math.min(zFar, camera.far);
    }

    const u = this._shadow;
    for (let c = 0; c < CASCADES; c++) u.set(mats[c], c * 16);
    u[48] = splits[0];
    u[49] = splits[1];
    u[50] = camera.far;
    u[51] = 0;
    u[52] = 1 / this.shadowDim;
    u[53] = state.shadowStrength ?? 1;
    u[54] = clamp(extent / this.solver.res * 2.2, 0.4, 40);
    u[55] = CASCADES;
    this.device.queue.writeBuffer(this.shadowBuf, 0, u);

    for (let c = 0; c < CASCADES; c++) {
      this._lightBuf.set(mats[c], 0);
      this.device.queue.writeBuffer(this.lightBuf, c * 256, this._lightBuf, 0, 64);
    }
  }

  // --- frame ----------------------------------------------------------------------------------------

  render(camera, state, time) {
    const d = this.device;
    if (this._atmoDirty) this._rebuildAtmosphereTables();
    this._updateCamera(camera);
    this._updateTerrain(state, time);
    this._updateWater(state, time);
    this._updatePost(state, time);
    this._computeCascades(camera, state);

    const enc = d.createCommandEncoder();

    // 1 — shadow cascades
    if ((state.shadowStrength ?? 1) > 0) {
      for (let c = 0; c < CASCADES; c++) {
        const pass = enc.beginRenderPass({
          colorAttachments: [],
          depthStencilAttachment: {
            view: this.shadowLayerViews[c],
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
          },
        });
        pass.setPipeline(this.shadowPipeline);
        pass.setBindGroup(0, this.sceneBind);
        pass.setBindGroup(1, this.lightBind[c]);
        pass.setIndexBuffer(this.indexBuffer, 'uint32');
        pass.drawIndexed(this.indexCount);
        pass.end();
      }
    }

    // 2 — sky, terrain, wireframe
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: this.sceneColorView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
        depthStencilAttachment: {
          view: this.sceneDepthView,
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      pass.setPipeline(this.skyPipeline);
      pass.setBindGroup(0, this.sceneBind);
      pass.draw(3);

      pass.setPipeline(this.terrainPipeline);
      pass.setBindGroup(0, this.sceneBind);
      pass.setIndexBuffer(this.indexBuffer, 'uint32');
      pass.drawIndexed(this.indexCount);

      if (this.wireframe) {
        pass.setPipeline(this.wirePipeline);
        pass.setBindGroup(0, this.sceneBind);
        pass.setIndexBuffer(this.wireBuffer, 'uint32');
        pass.drawIndexed(this.wireCount);
      }
      pass.end();
    }

    // 3 — water
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: this.finalColorView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(this.waterPipeline);
      pass.setBindGroup(0, this.sceneBind);
      pass.setBindGroup(1, this.waterBind);
      pass.draw(3);
      pass.end();
    }

    // 4 — bloom
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.bloomAView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      pass.setPipeline(this.postPipelines.prefilter);
      pass.setBindGroup(0, this.postBind.prefilter);
      pass.draw(3);
      pass.end();
    }
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.bloomBView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      pass.setPipeline(this.postPipelines.blurH);
      pass.setBindGroup(0, this.postBind.blurH);
      pass.draw(3);
      pass.end();
    }
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.bloomAView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      pass.setPipeline(this.postPipelines.blurV);
      pass.setBindGroup(0, this.postBind.blurV);
      pass.draw(3);
      pass.end();
    }

    // 5 — composite to the swap chain
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(this.postPipelines.composite);
      pass.setBindGroup(0, this.postBind.composite);
      pass.draw(3);
      pass.end();
    }

    d.queue.submit([enc.finish()]);
    this.stats.tris = this.indexCount / 3;
  }

  async capture() {
    // Re-render at the current size into a readable buffer by copying the composite target.
    const w = this.width;
    const h = this.height;
    const bytes = w * h * 4;
    const padded = Math.ceil(w * 4 / 256) * 256;
    const out = this.device.createBuffer({ size: padded * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const src = this.device.createTexture({
      size: [w, h],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: src.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setPipeline(this.postPipelines.composite);
    pass.setBindGroup(0, this.postBind.composite);
    pass.draw(3);
    pass.end();
    enc.copyTextureToBuffer({ texture: src }, { buffer: out, bytesPerRow: padded }, [w, h]);
    this.device.queue.submit([enc.finish()]);
    await out.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(out.getMappedRange().slice(0));
    out.unmap();
    out.destroy();
    src.destroy();
    return { data, width: w, height: h, padded, bytes };
  }
}

// --- helpers ----------------------------------------------------------------------------------------

function frustumCorners(out, invViewProj, near, far) {
  const ndc = [
    [-1, -1, near], [1, -1, near], [1, 1, near], [-1, 1, near],
    [-1, -1, far], [1, -1, far], [1, 1, far], [-1, 1, far],
  ];
  for (let i = 0; i < 8; i++) {
    const [x, y, z] = ndc[i];
    const m = invViewProj;
    const px = m[0] * x + m[4] * y + m[8] * z + m[12];
    const py = m[1] * x + m[5] * y + m[9] * z + m[13];
    const pz = m[2] * x + m[6] * y + m[10] * z + m[14];
    const pw = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
    out[i * 4] = px / pw;
    out[i * 4 + 1] = py / pw;
    out[i * 4 + 2] = pz / pw;
    out[i * 4 + 3] = 1;
  }
}

function transformPoint(m, p) {
  const [x, y, z] = p;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

function hexToVec(hex) {
  const h = (hex ?? '#000000').replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}
