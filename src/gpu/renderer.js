/**
 * Frontier Terrain Forge — viewport renderer.
 *
 * Frame graph, in order:
 *   1. sun depth pass      shadow map from the height field (same grid mesh)
 *   2. scene pass          sky → terrain → water into a linear HDR target
 *   3. post pass           exposure → ACES → grade → vignette/grain → sRGB
 *
 * The mesh is a flat UV grid synthesised from the vertex index with a shared
 * index buffer, so a 512² grid is one draw call with no vertex buffer traffic,
 * and the height field never has to be read back to the CPU.
 */
import { ComputePass } from './pass.js';
import { RenderPass } from './render-pass.js';
import { Camera } from '../core/camera.js';
import { invert, multiply } from '../core/mat4.js';

const SHADOW_MAP = 2048;
const SCENE_FORMAT = 'rgba16float';
const DEPTH_FORMAT = 'depth32float';
const MAX_MESH = 1024;

function makeTarget(device, { label, width, height, format, srgb = false, depth = false }) {
  const texture = device.createTexture({
    label,
    size: { width, height, depthOrArrayLayers: 1 },
    format,
    mipLevelCount: 1,
    sampleCount: 1,
    dimension: '2d',
    viewFormats: srgb && !depth ? [`${format}-srgb`] : undefined,
    usage: depth
      ? GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
      : GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
  });
  const views = new Map();
  return {
    label,
    texture,
    width,
    height,
    format,
    srgb,
    view(kind = 'default') {
      if (!views.has(kind)) {
        views.set(kind, texture.createView({ format: kind === 'srgb' ? `${format}-srgb` : format }));
      }
      return views.get(kind);
    },
    binding(entry) {
      if (String(entry.format || '').startsWith('depth')) return this.view('default');
      return entry.kind === 'texture' && entry.name?.startsWith('tex') && this.srgb ? this.view('srgb') : this.view('default');
    },
    destroy() { texture.destroy(); },
  };
}

/** 1×1 stand-ins so the viewport renders before the first bake completes. */
function tinyField(device, label, format, data) {
  const texture = device.createTexture({
    label,
    size: { width: 1, height: 1, depthOrArrayLayers: 1 },
    format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING,
    viewFormats: format === 'rgba8unorm' ? ['rgba8unorm-srgb'] : undefined,
  });
  device.queue.writeTexture({ texture }, data, { bytesPerRow: data.byteLength }, { width: 1, height: 1, depthOrArrayLayers: 1 });
  const views = new Map();
  return {
    label,
    texture,
    width: 1,
    height: 1,
    format,
    view(kind = 'default') {
      if (!views.has(kind)) views.set(kind, texture.createView({ format: kind === 'srgb' ? 'rgba8unorm-srgb' : format }));
      return views.get(kind);
    },
    binding(entry) {
      if (String(entry.format || '').startsWith('depth')) return this.view('default');
      return this.view('srgb');
    },
    destroy() { texture.destroy(); },
  };
}

export class Renderer {
  constructor(gpu, options = {}) {
    this.gpu = gpu;
    this.log = options.log || (() => {});
    this.canvas = null;
    this.context = null;
    this.format = 'bgra8unorm';
    this.width = 1;
    this.height = 1;
    this.meshResolution = 512;
    this.indexCount = 0;
    this.indexBuffer = null;
    this.ready = false;
    this.maps = null;
    this.water = { enabled: true };
  }

  async init(canvas) {
    const { device } = this.gpu;
    this.canvas = canvas;
    this.format = navigator.gpu?.getPreferredCanvasFormat?.() || 'bgra8unorm';
    this.context = canvas.getContext('webgpu');
    if (!this.context) throw new Error('canvas.getContext("webgpu") returned null');
    this.context.configure({ device, format: this.format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT });

    this.targets = {
      scene: makeTarget(device, { label: 'scene-color', width: 1, height: 1, format: SCENE_FORMAT }),
      depth: makeTarget(device, { label: 'scene-depth', width: 1, height: 1, format: DEPTH_FORMAT, depth: true }),
      shadow: makeTarget(device, { label: 'shadow-depth', width: SHADOW_MAP, height: SHADOW_MAP, format: DEPTH_FORMAT, depth: true }),
      shadowColor: makeTarget(device, { label: 'shadow-color', width: SHADOW_MAP, height: SHADOW_MAP, format: 'r8unorm' }),
    };

    this.placeholder = {
      albedo: tinyField(device, 'ph-albedo', 'rgba8unorm', new Uint8Array([132, 128, 124, 255])),
      orm: tinyField(device, 'ph-orm', 'rgba8unorm', new Uint8Array([255, 200, 0, 255])),
      normal: tinyField(device, 'ph-normal', 'rgba8unorm', new Uint8Array([128, 128, 255, 255])),
      ao: tinyField(device, 'ph-ao', 'rgba8unorm', new Uint8Array([255, 255, 255, 255])),
      height: tinyField(device, 'ph-height', 'r32float', new Float32Array([0.25])),
      flow: tinyField(device, 'ph-flow', 'r32float', new Float32Array([0])),
    };

    this.passes = {
      shadow: new RenderPass(this.gpu, {
        wgsl: 'shaders/shadow.wgsl', label: 'shadow', targets: [{ format: 'r8unorm' }], depth: DEPTH_FORMAT,
      }),
      sky: new RenderPass(this.gpu, {
        wgsl: 'shaders/sky.wgsl', label: 'sky', targets: [{ format: SCENE_FORMAT }], depth: DEPTH_FORMAT,
        depthWrite: false, depthCompare: 'less-equal',
      }),
      terrain: new RenderPass(this.gpu, {
        wgsl: 'shaders/terrain.wgsl', label: 'terrain', targets: [{ format: SCENE_FORMAT }], depth: DEPTH_FORMAT,
      }),
      water: new RenderPass(this.gpu, {
        wgsl: 'shaders/water.wgsl', label: 'water', targets: [{
          format: SCENE_FORMAT,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
        depth: DEPTH_FORMAT, depthWrite: false,
      }),
      post: new RenderPass(this.gpu, {
        wgsl: 'shaders/post.wgsl', label: 'post', targets: [{ format: this.format }], depth: null,
      }),
    };

    this.buildGrid(this.meshResolution);
    await Promise.all(Object.values(this.passes).map((pass) => pass.whenReady()));

    // Every pass owns its uniform buffers; the shared blocks are written once per
    // frame into all of them, which keeps a pass's bind group layout independent
    // of what the other passes need.
    this.viewUniform = this.passes.terrain.uniforms.V;
    this.lightUniform = this.passes.terrain.uniforms.L;
    this.uniformWriters = Object.values(this.passes)
      .flatMap((pass) => Object.values(pass.uniforms))
      .filter((writer, index, list) => list.indexOf(writer) === index);
    this.ready = true;
    this.log(`renderer ready · ${this.format} · shadow map ${SHADOW_MAP}²`);
    return this;
  }

  /** Quad grid indices for a (res+1)² vertex grid, reused by all three draws. */
  buildGrid(resolution) {
    const res = Math.max(16, Math.min(MAX_MESH, Math.round(resolution)));
    if (this.indexBuffer && this.meshResolution === res) return this.indexBuffer;
    const side = res + 1;
    const count = res * res * 6;
    const indices = new Uint32Array(count);
    let i = 0;
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const a = y * side + x;
        const b = a + 1;
        const c = a + side;
        const d = c + 1;
        indices[i++] = a; indices[i++] = c; indices[i++] = b;
        indices[i++] = b; indices[i++] = c; indices[i++] = d;
      }
    }
    const buffer = this.gpu.device.createBuffer({
      label: `grid-indices:${res}`,
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(buffer, 0, indices);
    if (this.indexBuffer) this.indexBuffer.destroy();
    this.indexBuffer = buffer;
    this.meshResolution = res;
    this.indexCount = count;
    this.gpu.clearCaches();
    return buffer;
  }

  setMaps(terrainMaps, textureMaps) {
    this.maps = { terrain: terrainMaps, texture: textureMaps || null };
  }

  resize(cssWidth, cssHeight, pixelRatio = 1) {
    const maxSize = this.gpu.info?.maxTexture ?? 8192;
    const width = Math.max(1, Math.min(maxSize, Math.round(cssWidth * pixelRatio)));
    const height = Math.max(1, Math.min(maxSize, Math.round(cssHeight * pixelRatio)));
    if (width === this.width && height === this.height) return false;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    for (const key of ['scene', 'depth']) this.targets[key].destroy();
    const { device } = this.gpu;
    this.targets.scene = makeTarget(device, { label: 'scene-color', width, height, format: SCENE_FORMAT });
    this.targets.depth = makeTarget(device, { label: 'scene-depth', width, height, format: DEPTH_FORMAT, depth: true });
    this.gpu.clearCaches();
    return true;
  }

  get aspect() { return this.width / Math.max(this.height, 1); }

  /** Terrain + material maps, falling back to placeholders before the first bake. */
  resources() {
    const terrain = this.maps?.terrain || {};
    const texture = this.maps?.texture || {};
    return {
      albedo: texture.albedo || this.placeholder.albedo,
      orm: texture.orm || this.placeholder.orm,
      normal: texture.normal || this.placeholder.normal,
      ao: terrain.ao || this.placeholder.ao,
      height: terrain.height || this.placeholder.height,
      flow: terrain.flow || this.placeholder.flow,
    };
  }

  viewValues(project, camera, time) {
    const display = project.display || {};
    const world = project.world;
    const sunDir = Camera.sunDirection(display.sunAzimuth ?? 132, display.sunElevation ?? 34);
    const { viewProj, eye } = camera.matrices(this.aspect, world);
    const invViewProj = invert(viewProj);
    const fieldRes = this.maps?.terrain?.resolution ?? world.resolution;
    // The water plane is a world-space elevation, so the normalised sea level
    // has to be lifted into metres before the shader compares it to terrain.
    const waterLevel = (world.waterLevel ?? 0.16) * (world.heightScale ?? 900);

    return {
      values: {
        viewProj,
        invViewProj,
        cameraPos: [eye[0], eye[1], eye[2], display.exposure ?? 1],
        sunDir: [sunDir[0], sunDir[1], sunDir[2], display.sunIntensity ?? 3.4],
        sunColor: [1.0, 0.965, 0.9, display.ambient ?? 0.32],
        params: [world.worldSize, world.heightScale, time, fieldRes],
        fog: [display.fogDensity ?? 1.4, (world.heightScale ?? 900) * 0.42, display.fogHeightFalloff ?? 1.2, display.aerial ?? 0.85],
        grade: [display.contrast ?? 1.06, display.saturation ?? 1.06, display.vignette ?? 0.35, display.grain ?? 0.25],
        flags: [display.wireframe ? 1 : 0, display.contourLines ? 1 : 0, display.slopeOverlay ? 1 : 0, display.viewMode ?? 0],
        flags2: [
          (display.sunAzimuth ?? 132) * Math.PI / 180,
          (display.sunElevation ?? 34) * Math.PI / 180,
          waterLevel,
          display.contourInterval ?? 50,
        ],
        grid: [this.meshResolution, this.maps?.terrain?.simRes ?? fieldRes / 2, world.worldSize / Math.max(fieldRes, 1), 0],
      },
      sunDir,
    };
  }

  lightValues(project, sunDir) {
    const world = project.world;
    const { viewProj, halfExtent } = Camera.lightMatrices(sunDir, world);
    const display = project.display || {};
    return {
      lightViewProj: viewProj,
      lightDir: [sunDir[0], sunDir[1], sunDir[2], 1 / SHADOW_MAP],
      shadow: [
        (display.shadowBias ?? 0.0016) * (world.heightScale ?? 900) * 0.0012,
        (world.worldSize / Math.max(this.meshResolution, 1)) * 1.5,
        display.shadowRadius ?? 1.35,
        display.shadows === false ? 0 : 0.92,
      ],
      lightExtent: [halfExtent, world.worldSize, world.heightScale, this.meshResolution],
      grid: [this.meshResolution, this.maps?.terrain?.resolution ?? world.resolution, world.worldSize / Math.max(this.maps?.terrain?.resolution ?? world.resolution, 1), 0],
    };
  }

  render({ project, camera, time = 0 }) {
    if (!this.ready) return false;
    const { device } = this.gpu;
    const context = this.context;
    const display = project.display || {};
    const { values: viewValues, sunDir } = this.viewValues(project, camera, time);
    const maps = this.resources();

    const lightValues = this.lightValues(project, sunDir);
    for (const writer of this.uniformWriters) {
      if (writer.structName === 'ViewUniforms') writer.write(viewValues);
      else if (writer.structName === 'LightParams') writer.write(lightValues);
    }

    const encoder = this.gpu.device.createCommandEncoder({ label: 'frame' });

    if (display.shadows !== false) {
      const pass = encoder.beginRenderPass({
        label: 'shadow',
        colorAttachments: [{
          view: this.targets.shadowColor.view(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 1, g: 1, b: 1, a: 1 },
        }],
        depthStencilAttachment: {
          view: this.targets.shadow.view(),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      pass.setPipeline(this.passes.shadow.pipeline);
      this.passes.shadow.bind(pass, {
        uniforms: { L: this.lightUniform },
        textures: { texHeight: maps.height },
      });
      pass.setIndexBuffer(this.indexBuffer, 'uint32');
      this.passes.shadow.draw(pass, { indexCount: this.indexCount });
      pass.end();
    }

    const scene = encoder.beginRenderPass({
      label: 'scene',
      colorAttachments: [{
        view: this.targets.scene.view(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0.02, g: 0.03, b: 0.05, a: 1 },
      }],
      depthStencilAttachment: {
        view: this.targets.depth.view(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    scene.setPipeline(this.passes.sky.pipeline);
    this.passes.sky.bind(scene, { uniforms: { V: this.viewUniform } });
    this.passes.sky.drawFullscreen(scene);

    scene.setPipeline(this.passes.terrain.pipeline);
    this.passes.terrain.bind(scene, {
      uniforms: { V: this.viewUniform, L: this.lightUniform },
      samplers: { samp: this.gpu.samplers.linear, sampShadow: this.gpu.samplers.nearest },
      textures: {
        texAlbedo: maps.albedo,
        texOrm: maps.orm,
        texNormal: maps.normal,
        texAo: maps.ao,
        texHeight: maps.height,
        texFlow: maps.flow,
        texShadow: this.targets.shadow,
      },
    });
    scene.setIndexBuffer(this.indexBuffer, 'uint32');
    this.passes.terrain.draw(scene, { indexCount: this.indexCount });

    if (display.water !== false) {
      scene.setPipeline(this.passes.water.pipeline);
      this.passes.water.bind(scene, {
        uniforms: { V: this.viewUniform },
        samplers: { samp: this.gpu.samplers.linear },
        textures: { texHeight: maps.height, texAlbedo: maps.albedo, texFlow: maps.flow },
      });
      this.passes.water.draw(scene, { indexCount: this.indexCount });
    }
    scene.end();

    const post = encoder.beginRenderPass({
      label: 'post',
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    post.setPipeline(this.passes.post.pipeline);
    this.passes.post.bind(post, {
      uniforms: { V: this.viewUniform },
      samplers: { samp: this.gpu.samplers.linear },
      textures: { texScene: this.targets.scene },
    });
    this.passes.post.drawFullscreen(post);
    post.end();

    device.queue.submit([encoder.finish()]);
    this.gpu.counters.frames = (this.gpu.counters.frames || 0) + 1;
    return true;
  }

  destroy() {
    for (const target of Object.values(this.targets || {})) target.destroy();
    for (const pass of Object.values(this.passes || {})) pass.destroy();
  }
}
