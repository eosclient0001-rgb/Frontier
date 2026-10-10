// ─────────────────────────────────────────────────────────────────────────────
//  Renderer — HDR scene, temporal resolve, bloom, auto exposure, tone map.
// ─────────────────────────────────────────────────────────────────────────────

import { loadShader, makePipelines } from './shaders.js';
import { mat4, perspective, ortho, lookAt, invert, multiply, halton, clamp } from './math.js';
import { encodePNG, halfToFloat } from './png.js';
import { LAYER_STRIDE, MAX_TEXTURE_LAYERS, packTextureLayer } from './state.js';

const HDR = 'rgba16float';
const DEPTH = 'depth32float';
const FRAME_FLOATS = 100;
const BLOOM_LEVELS = 5;
const LUM_LEVELS = 4;

export class Renderer {
  constructor(device, canvas, terrain) {
    this.device = device;
    this.canvas = canvas;
    this.terrain = terrain;
    this.frameIndex = 0;
    this.jitterIndex = 0;
    this.skyDirty = true;
    this.lastSkyKey = '';
    this.viewProj = mat4();
    this.invViewProj = mat4();
    this.prevViewProj = mat4();
    this.proj = mat4();
    this.view = mat4();
    this.jitterX = 0;
    this.jitterY = 0;
    this.prevJitterX = 0;
    this.prevJitterY = 0;
    this.taaReset = 2;
    this._texSlot = 0;
  }

  async init() {
    const device = this.device;
    const F = GPUShaderStage.FRAGMENT;
    const V = GPUShaderStage.VERTEX;
    const C = GPUShaderStage.COMPUTE;
    const VF = V | F;

    // ── scene bind group ─────────────────────────────────────────────────────
    this.sceneBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
        { binding: 1, visibility: VF, texture: { sampleType: 'float' } },
        { binding: 2, visibility: F, texture: { sampleType: 'float' } },
        { binding: 3, visibility: VF, sampler: { type: 'filtering' } },
        { binding: 4, visibility: F, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: F, texture: { sampleType: 'float' } },
        { binding: 6, visibility: F, buffer: { type: 'read-only-storage' } },
      ],
      label: 'scene',
    });
    this.sceneLayout = device.createPipelineLayout({ bindGroupLayouts: [this.sceneBGL] });

    this.frameBuf = device.createBuffer({
      size: FRAME_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'frame',
    });
    this.matBuf = device.createBuffer({
      size: LAYER_STRIDE * 4 * MAX_TEXTURE_LAYERS,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'material-params',
    });
    this.shBuf = device.createBuffer({
      size: 12 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'sky-sh',
    });
    this.sampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });

    this.skyTex = device.createTexture({
      size: [256, 256, 1], format: HDR,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      label: 'sky-lut',
    });

    // ── pipelines ────────────────────────────────────────────────────────────
    const [renderCode, waterCode, skyCode, postCode] = await Promise.all([
      loadShader('src/shaders/render.wgsl'),
      loadShader('src/shaders/water.wgsl'),
      loadShader('src/shaders/sky_lut.wgsl'),
      loadShader('src/shaders/post.wgsl'),
    ]);

    const SL = { layout: this.sceneLayout };
    const ds = (write) => ({
      format: DEPTH, depthWriteEnabled: write, depthCompare: write ? 'less' : 'always',
    });

    this.terrainPipe = makePipelines(device, renderCode, 'terrain', {
      solid: {
        ...SL,
        vertex: 'vsTerrain', fragment: 'fsTerrain',
        targets: [{ format: HDR }],
        depthStencil: ds(true),
      },
      sky: {
        ...SL,
        vertex: 'vsSky', fragment: 'fsSky',
        targets: [{ format: HDR }],
        // the full-screen triangle sits at z = 1, so it must not depth-test and
        // must not write depth, or it would occlude the terrain behind it
        depthStencil: ds(false),
      },
    });

    this.waterPipe = makePipelines(device, waterCode, 'water', {
      water: {
        ...SL,
        vertex: 'vsWater', fragment: 'fsWater',
        targets: [{ format: HDR }],
        depthStencil: ds(true),
        primitive: { topology: 'triangle-strip', cullMode: 'none' },
      },
    }).water;

    // ── sky LUT ──────────────────────────────────────────────────────────────
    this.skyBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        { binding: 1, visibility: C, storageTexture: { access: 'write-only', format: HDR, viewDimension: '2d' } },
        { binding: 2, visibility: C, buffer: { type: 'storage' } },
        { binding: 3, visibility: C, texture: { sampleType: 'float' } },
        { binding: 4, visibility: C, sampler: { type: 'filtering' } },
      ],
    });
    this.skyPipes = makePipelines(device, skyCode, 'sky', {
      skyMain: { layout: device.createPipelineLayout({ bindGroupLayouts: [this.skyBGL] }) },
      skySH: { layout: device.createPipelineLayout({ bindGroupLayouts: [this.skyBGL] }) },
    });
    this.dummyTex = device.createTexture({
      size: [1, 1, 1], format: HDR,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      label: 'dummy',
    });
    const dummyView = this.dummyTex.createView();
    const skyView = this.skyTex.createView();
    // write pass: storage target only. read pass: sampled only. Never both.
    this.skyBindWrite = device.createBindGroup({
      layout: this.skyBGL,
      entries: [
        { binding: 0, resource: { buffer: this.frameBuf } },
        { binding: 1, resource: skyView },
        { binding: 2, resource: { buffer: this.shBuf } },
        { binding: 3, resource: dummyView },
        { binding: 4, resource: this.sampler },
      ],
    });
    this.skyBindRead = device.createBindGroup({
      layout: this.skyBGL,
      entries: [
        { binding: 0, resource: { buffer: this.frameBuf } },
        { binding: 1, resource: dummyView },
        { binding: 2, resource: { buffer: this.shBuf } },
        { binding: 3, resource: skyView },
        { binding: 4, resource: this.sampler },
      ],
    });

    // ── post ─────────────────────────────────────────────────────────────────
    this.expoBuf = device.createBuffer({
      size: 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      label: 'exposure',
    });
    device.queue.writeBuffer(this.expoBuf, 0, new Float32Array([0, 0.18, 0, 0]));

    this.postBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: F, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 96 } },
        { binding: 1, visibility: F, texture: { sampleType: 'float' } },
        { binding: 2, visibility: F, texture: { sampleType: 'float' } },
        { binding: 3, visibility: F, texture: { sampleType: 'float' } },
        { binding: 4, visibility: F, sampler: { type: 'filtering' } },
        { binding: 5, visibility: F, buffer: { type: 'read-only-storage' } },
        { binding: 6, visibility: F, buffer: { type: 'uniform' } },
        { binding: 7, visibility: F, texture: { sampleType: 'depth' } },
      ],
    });
    this.postLayout = device.createPipelineLayout({ bindGroupLayouts: [this.postBGL] });

    this.lumBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 96 } },
        { binding: 1, visibility: C, texture: { sampleType: 'float' } },
        { binding: 2, visibility: C, buffer: { type: 'storage' } },
      ],
    });
    this.emptyBGL = device.createBindGroupLayout({ entries: [] });
    this.emptyBind = device.createBindGroup({ layout: this.emptyBGL, entries: [] });

    const postPipes = makePipelines(device, postCode, 'post', {
      taa: { layout: this.postLayout, vertex: 'vsFull', fragment: 'fsTAA', targets: [{ format: HDR }] },
      bloomPre: { layout: this.postLayout, vertex: 'vsFull', fragment: 'fsBloomPrefilter', targets: [{ format: HDR }] },
      bloomDown: { layout: this.postLayout, vertex: 'vsFull', fragment: 'fsBloomDown', targets: [{ format: HDR }] },
      bloomUp: {
        layout: this.postLayout, vertex: 'vsFull', fragment: 'fsBloomUp',
        targets: [{ format: HDR, blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } }],
      },
      lumDown: { layout: this.postLayout, vertex: 'vsFull', fragment: 'fsLumDown', targets: [{ format: HDR }] },
      tonemap: { layout: this.postLayout, vertex: 'vsFull', fragment: 'fsTonemap', targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }] },
    });
    this.postPipes = postPipes;
    this.lumPipe = makePipelines(device, postCode, 'post-lum', {
      lumReduce: { layout: device.createPipelineLayout({ bindGroupLayouts: [this.emptyBGL, this.lumBGL] }) },
    }).lumReduce;

    this.postBuf = device.createBuffer({
      size: 256 * 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'post-uniform',
    });
    this.postData = new Float32Array(128 * 64);
    this.sceneBind = null;
    this.size = [0, 0];
  }

  // ── sizing ─────────────────────────────────────────────────────────────────
  resize(w, h) {
    if (this.size[0] === w && this.size[1] === h) return;
    this.size = [w, h];
    const device = this.device;
    for (const t of Object.values(this.rt || {})) {
      if (Array.isArray(t)) t.forEach((x) => x.destroy());
      else t.destroy();
    }
    const tex = (label, sw, sh, format = HDR, extra = 0) =>
      device.createTexture({
        size: [Math.max(1, sw), Math.max(1, sh), 1], format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | extra,
        label,
      });

    this.rt = {
      scene: tex('scene', w, h),
      depth: tex('depth', w, h, DEPTH),
      hist: [tex('histA', w, h), tex('histB', w, h)],
      bloom: [],
      lum: [],
    };
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.rt.bloom.push(tex(`bloom${i}`, w >> (i + 1), h >> (i + 1)));
    }
    for (let i = 0; i < LUM_LEVELS; i++) {
      this.rt.lum.push(tex(`lum${i}`, w >> (i + 1), h >> (i + 1)));
    }
    this.taaReset = 2;
  }

  // ── per-frame state ────────────────────────────────────────────────────────
  updateSceneBind() {
    if (this.sceneBind && this._boundRes === this.terrain.res) return;
    this._boundRes = this.terrain.res;
    this.sceneBind = this.device.createBindGroup({
      layout: this.sceneBGL,
      entries: [
        { binding: 0, resource: { buffer: this.frameBuf } },
        { binding: 1, resource: this.terrain.heightTex.createView() },
        { binding: 2, resource: this.terrain.surfTex.createView() },
        { binding: 3, resource: this.sampler },
        { binding: 4, resource: { buffer: this.matBuf } },
        { binding: 5, resource: this.skyTex.createView() },
        { binding: 6, resource: { buffer: this.shBuf } },
      ],
    });
    this.taaReset = 2;
  }

  uploadMaterials(project) {
    const data = new Float32Array(MAX_TEXTURE_LAYERS * LAYER_STRIDE);
    const list = project.textures;
    const n = Math.min(list.length, MAX_TEXTURE_LAYERS);
    for (let i = 0; i < n; i++) packTextureLayer(list[i], data, i);
    this.device.queue.writeBuffer(this.matBuf, 0, data);
    this.matCount = n;
  }

  writeFrame(project, camera, time, dt) {
    const g = project.globals;
    const f = new Float32Array(FRAME_FLOATS);
    const w = this.size[0], h = this.size[1];

    // jittered projection
    let jx = 0, jy = 0;
    if (g.taa) {
      this.jitterIndex = (this.jitterIndex + 1) % 16;
      jx = (halton(this.jitterIndex + 1, 2) - 0.5) * 2 / w;
      jy = (halton(this.jitterIndex + 1, 3) - 0.5) * 2 / h;
    }
    const aspect = w / Math.max(h, 1);
    const proj = mat4();
    if (camera.ortho) {
      const hw = camera.halfW ?? camera.halfExtent ?? 1;
      const hh = camera.halfH ?? hw;
      ortho(proj, -hw, hw, -hh, hh, camera.near, camera.far);
    } else {
      perspective(proj, camera.fov, aspect, camera.near, camera.far);
      proj[8] += jx; proj[9] += jy;
    }
    const view = lookAt(mat4(), camera.eye, camera.target, [0, 1, 0]);
    multiply(this.viewProj, proj, view);
    invert(this.invViewProj, this.viewProj);
    this.prevJitterX = this.jitterX;
    this.prevJitterY = this.jitterY;
    this.jitterX = jx; this.jitterY = jy;

    const el = g.sunElevation * Math.PI / 180;
    const az = g.sunAzimuth * Math.PI / 180;
    const sun = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];

    f.set(this.viewProj, 0);
    f.set(this.invViewProj, 16);
    f.set(this.prevViewProj, 32);
    f[48] = camera.eye[0]; f[49] = camera.eye[1]; f[50] = camera.eye[2]; f[51] = time;
    f[52] = sun[0]; f[53] = sun[1]; f[54] = sun[2]; f[55] = g.sunIntensity;
    f[56] = g.turbidity; f[57] = g.mieG; f[58] = g.msStrength; f[59] = g.skyIntensity;
    // solar radiance: ~1.0 with the intensity knob; exposure normalises the rest
    const sr = 1.0;
    f[60] = sr; f[61] = sr; f[62] = sr; f[63] = g.ozone;
    f[64] = this.terrain.res;
    f[65] = g.heightScale;
    f[66] = g.worldSize;
    f[67] = g.baseDepth * g.heightScale;
    f[68] = g.waterLevel;
    f[69] = g.waterOn ? 1 : 0;
    f[70] = g.shadowSoftness;
    f[71] = g.aoStrength;
    f[72] = g.debugMode;
    f[73] = this.matCount || 0;
    f[74] = 0.45;                       // height-blend strength
    f[75] = 1;
    f[76] = Math.tan(camera.fov / 2);
    f[77] = aspect;
    f[78] = camera.near;
    f[79] = camera.far;
    f[80] = jx; f[81] = jy; f[82] = this.frameIndex; f[83] = g.taa ? g.taaBlend : 1;
    f[84] = this.terrain.renderRes;
    f[85] = g.baseDepth * g.heightScale;
    f[86] = 0; f[87] = 0;
    f[88] = g.waterTint[0]; f[89] = g.waterTint[1]; f[90] = g.waterTint[2]; f[91] = g.waveAmp;
    f[92] = g.waterAbsorb[0]; f[93] = g.waterAbsorb[1]; f[94] = g.waterAbsorb[2]; f[95] = g.waveScale;
    f[96] = g.detailFade; f[97] = g.snowSSS; f[98] = 0; f[99] = 0;

    this.device.queue.writeBuffer(this.frameBuf, 0, f);
    this.frameData = f;

    const key = [g.sunAzimuth, g.sunElevation, g.turbidity, g.mieG, g.msStrength,
      g.skyIntensity, g.ozone, g.sunIntensity, Math.round(camera.eye[1] / 120)].join(',');
    if (key !== this.lastSkyKey) {
      this.lastSkyKey = key;
      this.skyDirty = true;
    }
  }

  writePost(project, src, dst) {
    const g = project.globals;
    this._postSlot = (this._postSlot ?? -1) + 1;
    const slot = this._postSlot % 128;
    const p = this.postData.subarray(slot * 64, slot * 64 + 64);
    p[0] = 1 / src[0]; p[1] = 1 / src[1];
    p[2] = 1 / dst[0]; p[3] = 1 / dst[1];
    p[4] = g.exposure; p[5] = g.bloom; p[6] = g.taa ? g.taaBlend : 1; p[7] = this.taaReset > 0 ? 1 : 0;
    p[8] = g.tonemap; p[9] = g.vignette; p[10] = g.grain; p[11] = g.saturation;
    p[12] = src[0]; p[13] = src[1]; p[14] = dst[0]; p[15] = dst[1];
    p[16] = g.dof; p[17] = g.dofFocus; p[18] = g.dofMax; p[19] = 0.25;
    p[20] = 1.1; p[21] = 0.6; p[22] = this.frameIndex; p[23] = 0;
    if (slot === 0) this._postDirty = true;
    return slot;
  }

  flushPost() {
    if (this._postDirty) {
      this.device.queue.writeBuffer(this.postBuf, 0, this.postData);
      this._postDirty = false;
    }
  }

  bg(texA, texB, texC, slot) {
    return this.device.createBindGroup({
      layout: this.postBGL,
      entries: [
        { binding: 0, resource: { buffer: this.postBuf, size: 96 } },
        { binding: 1, resource: texA },
        { binding: 2, resource: texB },
        { binding: 3, resource: texC },
        { binding: 4, resource: this.sampler },
        { binding: 5, resource: { buffer: this.expoBuf } },
        { binding: 6, resource: { buffer: this.frameBuf } },
        { binding: 7, resource: this.rt.depth.createView() },
      ],
      label: 'post-bg',
    });
  }

  // ── frame ──────────────────────────────────────────────────────────────────
  render(project, camera, time, dt) {
    const device = this.device;
    const g = project.globals;
    if (!this.rt) this.resize(this.canvas.width || 64, this.canvas.height || 64);
    const [w, h] = this.size;
    this.updateSceneBind();
    this.uploadMaterials(project);

    this.prevViewProj.set(this.viewProj);
    this.writeFrame(project, camera, time, dt);

    const enc = device.createCommandEncoder();
    this._postSlot = -1;

    // ── sky LUT
    if (this.skyDirty) {
      const cp = enc.beginComputePass();
      cp.setPipeline(this.skyPipes.skyMain);
      cp.setBindGroup(0, this.skyBindWrite);
      cp.dispatchWorkgroups(32, 32, 1);
      cp.end();
      // the SH pass reads the LUT that was just written
      const cp2 = enc.beginComputePass();
      cp2.setPipeline(this.skyPipes.skySH);
      cp2.setBindGroup(0, this.skyBindRead);
      cp2.dispatchWorkgroups(1, 1, 1);
      cp2.end();
      this.skyDirty = false;
    }

    // ── scene
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.rt.scene.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.rt.depth.createView(),
        depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    });
    pass.setBindGroup(0, this.sceneBind);
    pass.setPipeline(this.terrainPipe.sky);
    pass.draw(3, 1, 0, 0);
    pass.setPipeline(this.terrainPipe.solid);
    pass.setIndexBuffer(this.terrain.indexBuf, 'uint32');
    pass.drawIndexed(this.terrain.indexCount, 1, 0, 0, 0);
    if (g.waterOn && g.waterLevel > 0.001) {
      pass.setPipeline(this.waterPipe);
      pass.draw(4, 1, 0, 0);
    }
    pass.end();

    // ── temporal resolve
    const src = this.rt.hist[0];
    const dst = this.rt.hist[1];
    const filler = this.rt.scene.createView();
    const draw = (pipe, target, texA, texB, texC, sx, sy) => {
      if (!target || target.createView) {
        throw new Error(`post pass target must be a GPUTextureView (got ${target?.label || target})`);
      }
      const slot = this.writePost(project, [sx, sy], [sx, sy]);
      const p = enc.beginRenderPass({
        colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      p.setPipeline(pipe);
      p.setBindGroup(0, this.bg(texA, texB || filler, texC || filler, slot), [slot * 256]);
      p.draw(3, 1, 0, 0);
      p.end();
      return slot;
    };

    const sceneView = this.rt.scene.createView();
    const srcView = src.createView();
    const dstView = dst.createView();

    if (g.taa) {
      draw(this.postPipes.taa, dstView, sceneView, sceneView, srcView, w, h);
    } else {
      draw(this.postPipes.taa, dstView, sceneView, sceneView, sceneView, w, h);
    }
    this.rt.hist = [dst, src];
    const resolved = dstView;

    // ── bloom
    if (g.bloom > 0.0001) {
      draw(this.postPipes.bloomPre, this.rt.bloom[0].createView(), resolved, null, null, w, h);
      for (let i = 1; i < BLOOM_LEVELS; i++) {
        const s = this.rt.bloom[i - 1], d = this.rt.bloom[i];
        draw(this.postPipes.bloomDown, d.createView(), s.createView(), null, null, s.width, s.height);
      }
      for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
        const s = this.rt.bloom[i + 1], d = this.rt.bloom[i];
        draw(this.postPipes.bloomUp, d.createView(), s.createView(), null, null, s.width, s.height);
      }
    } else {
      const p = enc.beginRenderPass({
        colorAttachments: [{ view: this.rt.bloom[0].createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      p.end();
    }

    // ── auto exposure
    if (g.exposure <= 0) {
      for (let i = 0; i < LUM_LEVELS; i++) {
        const d = this.rt.lum[i];
        const srcTex = i === 0 ? this.rt.scene : this.rt.lum[i - 1];
        draw(this.postPipes.lumDown, d.createView(), srcTex.createView(), null, null,
          srcTex.width, srcTex.height);
      }
      const last = this.rt.lum[LUM_LEVELS - 1];
      const lumSlot = this.writePost(project, [last.width, last.height], [1, 1]);
      const cp = enc.beginComputePass();
      cp.setPipeline(this.lumPipe);
      cp.setBindGroup(0, this.emptyBind);
      cp.setBindGroup(1, this.device.createBindGroup({
        layout: this.lumBGL,
        entries: [
          { binding: 0, resource: { buffer: this.postBuf, size: 96 } },
          { binding: 1, resource: last.createView() },
          { binding: 2, resource: { buffer: this.expoBuf } },
        ],
      }), [lumSlot * 256]);
      cp.dispatchWorkgroups(1, 1, 1);
      cp.end();
    }

    // ── tone map to the swap chain
    draw(this.postPipes.tonemap, this.context.getCurrentTexture().createView(),
      resolved, this.rt.bloom[0].createView(), resolved, w, h);

    this.flushPost();
    device.queue.submit([enc.finish()]);
    this.frameIndex++;
    if (this.taaReset > 0) this.taaReset--;
  }

  configureContext() {
    this.context = this.canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format, alphaMode: 'opaque' });
    return format;
  }

  // ── offscreen top-down map rendering (export) ──────────────────────────────
  /** Force the sky LUT to be re-lit on the next frame. */
  paintSky() { this.skyDirty = true; }

  /**
   * Render one data channel of the terrain from straight above into `view`.
   * `debug` is the debugView() mode index (see shading.wgsl).
   */
  renderMap(project, camera, colorView, depthView, w, h, debug) {
    const g = project.globals;
    const savedSize = this.size;
    const savedDebug = g.debugMode;
    this.size = [w, h];
    g.debugMode = debug;
    this.updateSceneBind();
    this.uploadMaterials(project);
    this.writeFrame(project, camera, 0, 0);

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: colorView, loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
      depthStencilAttachment: {
        view: depthView, depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    });
    pass.setBindGroup(0, this.sceneBind);
    pass.setPipeline(this.terrainPipe.solid);
    pass.setIndexBuffer(this.terrain.indexBuf, 'uint32');
    pass.drawIndexed(this.terrain.indexCount, 1, 0, 0, 0);
    pass.end();
    this.device.queue.submit([enc.finish()]);

    g.debugMode = savedDebug;
    this.size = savedSize;
  }

  /**
   * Bake the requested channels to 16-bit PNGs and hand each blob to `onDone`.
   * Channels: height, normal, ao, flow, deposit, curvature, albedo, roughness.
   */
  async exportMaps(project, names, res, onDone) {
    const device = this.device;
    const g = project.globals;
    const CHANNEL = {
      height: { debug: 4, ch: 1 },
      normal: { debug: 2, ch: 3 },
      albedo: { debug: 1, ch: 3 },
      ao: { debug: 5, ch: 1 },
      flow: { debug: 6, ch: 1 },
      deposit: { debug: 7, ch: 1 },
      curvature: { debug: 8, ch: 1 },
      roughness: { debug: 3, ch: 1 },
    };

    const limit = device.limits.maxTextureDimension2D;
    const size = Math.min(res, limit);
    const half = g.worldSize * 0.5;

    const color = device.createTexture({
      size: [size, size, 1], format: HDR,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      label: 'export-color',
    });
    const depth = device.createTexture({
      size: [size, size, 1], format: DEPTH,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      label: 'export-depth',
    });
    const bytesPerRow = size * 8;                       // rgba16float
    const buf = device.createBuffer({
      size: bytesPerRow * size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: 'export-readback',
    });

    const camera = {
      eye: [0, g.heightScale * 4 + 100, 0.0001],
      target: [0, 0, 0],
      fov: 0.6, near: 1, far: g.heightScale * 8 + 1000,
      ortho: true, halfW: half, halfH: half,
    };

    for (const name of names) {
      const spec = CHANNEL[name];
      if (!spec) continue;
      this.renderMap(project, camera, color.createView(), depth.createView(), size, size, spec.debug);

      const enc = device.createCommandEncoder();
      enc.copyTextureToBuffer(
        { texture: color },
        { buffer: buf, bytesPerRow, rowsPerImage: size },
        [size, size, 1],
      );
      device.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ);

      const src = new Uint16Array(buf.getMappedRange().slice(0));
      buf.unmap();

      const px = size * size * spec.ch;
      const out = new Uint16Array(px);
      for (let i = 0; i < px; i++) {
        const v = halfToFloat(src[i]);
        out[i] = Math.max(0, Math.min(65535, Math.round(v * 65535)));
      }
      const blob = await encodePNG(size, size, spec.ch, out, 16);
      onDone?.(name, blob);
    }

    buf.destroy();
    color.destroy();
    depth.destroy();
  }
}
