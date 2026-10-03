// Realtime WebGPU cloth studio: GPU XPBD solver + PBR fabric renderer.
import { m4 } from './math.js';
import { buildBodySpec, buildBodyMesh, packCollision } from './body.js';
import { buildDress } from './dress.js';
import { buildConstraints, buildState, CON_STRIDE } from './physics.js';
import {
  CLEAR_LAMBDA, PREDICT, SOLVE_CONS, SOLVE_PINS, COLLIDE, FINALIZE, RESET_VERTEX,
  CLOTH_RENDER, BODY_RENDER, PATTERN_QUAD, GROUND_PLANE,
} from './shaders.js';
import {
  CAMERA, FABRIC as FABRIC_LAYOUT, SIM as SIM_LAYOUT, COL, PIN, PREVIEW, uniform, writeUniform,
} from './layout.js';

const WORKGROUP = 256;

export class ClothStudio {
  constructor(canvas, fabricCanvas, params, fabric) {
    this.canvas = canvas;
    this.fabricCanvas = fabricCanvas;
    this.params = params;
    this.fabric = fabric;
    this.time = 0;
    this.frame = 0;
    this.paused = false;
    this.ready = false;
    this.stats = {};
    this.worldTime = 0;
  }

  static async create(canvas, fabricCanvas, params, fabric) {
    const studio = new ClothStudio(canvas, fabricCanvas, params, fabric);
    await studio.init();
    return studio;
  }

  async init() {
    if (!navigator.gpu) {
      throw new Error(
        'WebGPU is not available in this browser. Use Chrome/Edge 113+, or Safari 26+/Firefox 141+ with WebGPU enabled.'
      );
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No suitable GPU adapter found.');
    this.adapter = adapter;
    const limits = adapter.limits;
    const requiredLimits = {};
    if (typeof limits.maxStorageBufferBindingSize === 'number') {
      requiredLimits.maxStorageBufferBindingSize = Math.min(limits.maxStorageBufferBindingSize, 512 * 1024 * 1024);
    }
    if (typeof limits.maxBufferSize === 'number') {
      requiredLimits.maxBufferSize = Math.min(limits.maxBufferSize, 512 * 1024 * 1024);
    }
    this.device = await adapter.requestDevice({ requiredLimits });
    this.device.lost.then((info) => {
      console.error('Device lost:', info.message);
      this.onError?.(`GPU device lost: ${info.message}`);
    });
    // Surface validation errors instead of failing silently to a blank canvas.
    this.device.addEventListener?.('uncapturederror', (ev) => {
      console.error('WebGPU error:', ev.error);
      this.onError?.(`WebGPU error: ${ev.error?.message ?? ev.error}`);
    });
    this.info = adapter.info ?? {};

    const dev = this.device;
    this.ctx = this.canvas.getContext('webgpu');
    this.fmt = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: dev, format: this.fmt, alphaMode: 'opaque' });
    this.fctx = this.fabricCanvas.getContext('webgpu');
    this.fctx.configure({ device: dev, format: this.fmt, alphaMode: 'opaque' });

    this.uniforms = {};
    this.createUniforms();
    this.createPipelines();
    this.ready = true;
  }

  // ------------------------------------------------------------------ uniforms
  createUniforms() {
    const dev = this.device;
    const UB = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    // staging arrays are laid out by src/layout.js; wgsl-check asserts those
    // offsets against the WGSL structs so packing can never drift
    this.u = {
      cam: uniform(CAMERA), fab: uniform(FABRIC_LAYOUT), sim: uniform(SIM_LAYOUT),
      col: uniform(COL), pin: uniform(PIN), preview: uniform(PREVIEW),
    };
    const mk = (label, layout) => dev.createBuffer({ size: layout.size, usage: UB, label });
    this.uniforms = {
      cam: mk('camera', CAMERA), fab: mk('fabric', FABRIC_LAYOUT), sim: mk('sim', SIM_LAYOUT),
      col: mk('collision', COL), pin: mk('pinparams', PIN), preview: mk('preview', PREVIEW),
    };
  }

  createPipelines() {
    const dev = this.device;
    const compute = (code, label) =>
      dev.createComputePipeline({
        layout: 'auto',
        compute: { module: dev.createShaderModule({ code, label }), entryPoint: 'main' },
        label,
      });

    this.pipe = {
      clear: compute(CLEAR_LAMBDA, 'clear-lambda'),
      predict: compute(PREDICT, 'predict'),
      solve: compute(SOLVE_CONS, 'solve'),
      pins: compute(SOLVE_PINS, 'pins'),
      collide: compute(COLLIDE, 'collide'),
      finalize: compute(FINALIZE, 'finalize'),
      reset: compute(RESET_VERTEX, 'reset'),
    };

    const clothModule = dev.createShaderModule({ code: CLOTH_RENDER, label: 'cloth' });
    this.pipe.cloth = dev.createRenderPipeline({
      layout: 'auto',
      vertex: { module: clothModule, entryPoint: 'vs' },
      fragment: {
        module: clothModule, entryPoint: 'fs',
        targets: [{ format: this.fmt }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      label: 'cloth-render',
    });

    const bodyModule = dev.createShaderModule({ code: BODY_RENDER, label: 'body' });
    const vb = {
      arrayStride: 32,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x2' },
      ],
    };
    this.pipe.body = dev.createRenderPipeline({
      layout: 'auto',
      vertex: { module: bodyModule, entryPoint: 'vs', buffers: [vb] },
      fragment: { module: bodyModule, entryPoint: 'fs', targets: [{ format: this.fmt }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      label: 'body-render',
    });

    const fabModule = dev.createShaderModule({ code: PATTERN_QUAD, label: 'fabric-preview' });
    this.pipe.fabric = dev.createRenderPipeline({
      layout: 'auto',
      vertex: { module: fabModule, entryPoint: 'vs' },
      fragment: { module: fabModule, entryPoint: 'fs', targets: [{ format: this.fmt }] },
      primitive: { topology: 'triangle-list' },
      label: 'fabric-preview',
    });

    const groundModule = dev.createShaderModule({ code: GROUND_PLANE, label: 'ground' });
    this.pipe.ground = dev.createRenderPipeline({
      layout: 'auto',
      vertex: { module: groundModule, entryPoint: 'vs' },
      fragment: { module: groundModule, entryPoint: 'fs', targets: [{ format: this.fmt }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      label: 'ground',
    });

    // depth texture is (re)created on resize
    this.depth = null;
  }

  ensureDepth(w, h) {
    if (this.depth && this.depthW === w && this.depthH === h) return;
    this.depth?.destroy();
    this.depth = this.device.createTexture({
      size: [w, h, 1], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthW = w; this.depthH = h;
  }

  // ------------------------------------------------------------------ rebuild
  /** Rebuild mannequin + dress + constraints. Structural (not per-frame). */
  rebuild() {
    const p = this.params;
    this.bodySpec = buildBodySpec(p);
    this.bodyMesh = buildBodyMesh(this.bodySpec, p.bodySegments ?? 44, 18);
    this.collisionData = packCollision(this.bodySpec);

    this.dress = buildDress(this.bodySpec, p, p.resolution);
    this.state = buildState(this.dress, p, this.dress.pins);
    this.constraints = buildConstraints(this.dress, p.constraintParams);
    this.constraintList = this.constraints.list;
    // pristine pin targets in body space, used by the dance rig
    this._pinLocal = this.state.pinPos.slice();
    this.bodyMatrix = null;
    this.bodyMatrixInverse = null;

    this.uploadStatic();
    this.uploadSim();
    this.uploadBodyMesh();
    this.buildBindGroups();
  }

  uploadStatic() {
    const dev = this.device;
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    for (const key of ['pos', 'vel', 'prev', 'rest', 'vinfo', 'cons', 'pins', 'pinPos', 'rings', 'caps', 'uv', 'nrm']) {
      if (this.buf?.[key]) this.buf[key].destroy();
    }
    const st = this.state;
    const n = st.count;
    this.buf = this.buf ?? {};
    const create = (byteLength, label) =>
      dev.createBuffer({ size: Math.max(16, align16(byteLength)), usage: S, label });

    this.buf.pos = create(n * 16, 'pos');
    this.buf.vel = create(n * 16, 'vel');
    this.buf.prev = create(n * 16, 'prev');
    this.buf.rest = create(n * 16, 'rest');
    this.buf.vinfo = create(n * 16, 'vinfo');
    this.buf.cons = create(this.constraints.buffer.byteLength, 'cons');
    this.buf.pins = create(Math.max(4, st.pinIndices.byteLength), 'pins');
    this.buf.pinPos = create(Math.max(16, st.pinPos.byteLength), 'pinPos');
    this.buf.rings = create(this.collisionData.rings.byteLength, 'rings');
    this.buf.caps = create(Math.max(32, this.collisionData.capsules.byteLength), 'caps');
    this.buf.uv = create(n * 16, 'uv');
    this.buf.nrm = create(n * 16, 'nrm');

    // UVs are packed as vec4 for a clean 16 byte stride
    const uv4 = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      uv4[i * 4 + 0] = this.dress.uvs[i * 2 + 0];
      uv4[i * 4 + 1] = this.dress.uvs[i * 2 + 1];
    }
    this.uvData = uv4;

    // rest-pose normals as vec4f: deforming islands (the straps) read these
    // directly instead of walking a grid they do not lie on
    const nrm4 = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      nrm4[i * 4 + 0] = this.dress.normals[i * 3 + 0];
      nrm4[i * 4 + 1] = this.dress.normals[i * 3 + 1];
      nrm4[i * 4 + 2] = this.dress.normals[i * 3 + 2];
    }
    const q = dev.queue;
    q.writeBuffer(this.buf.nrm, 0, nrm4);
    q.writeBuffer(this.buf.pos, 0, st.pos);
    q.writeBuffer(this.buf.vel, 0, st.vel);
    q.writeBuffer(this.buf.prev, 0, st.prev);
    q.writeBuffer(this.buf.rest, 0, st.rest);
    q.writeBuffer(this.buf.vinfo, 0, st.vinfo);
    q.writeBuffer(this.buf.cons, 0, this.constraints.buffer);
    q.writeBuffer(this.buf.pins, 0, st.pinIndices);
    q.writeBuffer(this.buf.pinPos, 0, st.pinPos);
    q.writeBuffer(this.buf.uv, 0, uv4);
    this.uploadCollision();

    this.indexCount = this.dress.indices.length;
    if (this.indexBuf) this.indexBuf.destroy();
    this.indexBuf = dev.createBuffer({
      size: align4(this.dress.indices.byteLength),
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      label: 'dress-index',
    });
    q.writeBuffer(this.indexBuf, 0, this.dress.indices);
    this.vertexCount = n;
  }

  uploadCollision() {
    const c = this.collisionData;
    this.device.queue.writeBuffer(this.buf.rings, 0, c.rings);
    this.device.queue.writeBuffer(this.buf.caps, 0, c.capsules);
    this.colCounts = c;
  }

  uploadSim() {
    const st = this.state;
    this.simPos = st.pos;
    this.simPrev = st.prev;
  }

  uploadBodyMesh() {
    const dev = this.device;
    const m = this.bodyMesh;
    const count = m.positions.length / 3;
    const inter = new Float32Array(count * 8);
    for (let i = 0; i < count; i++) {
      inter[i * 8 + 0] = m.positions[i * 3 + 0];
      inter[i * 8 + 1] = m.positions[i * 3 + 1];
      inter[i * 8 + 2] = m.positions[i * 3 + 2];
      inter[i * 8 + 3] = m.normals[i * 3 + 0];
      inter[i * 8 + 4] = m.normals[i * 3 + 1];
      inter[i * 8 + 5] = m.normals[i * 3 + 2];
      inter[i * 8 + 6] = m.uvs[i * 2 + 0];
      inter[i * 8 + 7] = m.uvs[i * 2 + 1];
    }
    this.bodyVerts?.destroy();
    this.bodyIdx?.destroy();
    this.bodyVerts = dev.createBuffer({
      size: inter.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: 'body-verts',
    });
    this.bodyIdx = dev.createBuffer({
      size: align4(m.indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, label: 'body-idx',
    });
    dev.queue.writeBuffer(this.bodyVerts, 0, inter);
    dev.queue.writeBuffer(this.bodyIdx, 0, m.indices);
    this.bodyIndexCount = m.indices.length;
  }

  buildBindGroups() {
    const dev = this.device;
    const b = this.buf;
    const bg = (pipeline, entries) =>
      dev.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
    const S = (buffer) => ({ buffer });
    const U = (buffer) => ({ buffer });

    this.bg = {};
    this.bg.clear = bg(this.pipe.clear, [{ binding: 0, resource: S(b.cons) }]);
    this.bg.predict = bg(this.pipe.predict, [
      { binding: 0, resource: S(b.pos) },
      { binding: 1, resource: S(b.vel) },
      { binding: 2, resource: S(b.prev) },
      { binding: 3, resource: S(b.vinfo) },
      { binding: 4, resource: U(this.uniforms.sim) },
      { binding: 5, resource: S(b.nrm) },
    ]);
    this.bg.solve = bg(this.pipe.solve, [
      { binding: 0, resource: S(b.pos) },
      { binding: 1, resource: S(b.cons) },
      { binding: 2, resource: U(this.uniforms.sim) },
    ]);
    this.bg.pins = bg(this.pipe.pins, [
      { binding: 0, resource: S(b.pos) },
      { binding: 1, resource: S(b.pins) },
      { binding: 2, resource: S(b.pinPos) },
      { binding: 3, resource: U(this.uniforms.pin) },
    ]);
    this.bg.collide = bg(this.pipe.collide, [
      { binding: 0, resource: S(b.pos) },
      { binding: 1, resource: S(b.prev) },
      { binding: 2, resource: S(b.rings) },
      { binding: 3, resource: S(b.caps) },
      { binding: 4, resource: U(this.uniforms.col) },
    ]);
    this.bg.finalize = bg(this.pipe.finalize, [
      { binding: 0, resource: S(b.pos) },
      { binding: 1, resource: S(b.vel) },
      { binding: 2, resource: S(b.prev) },
      { binding: 3, resource: U(this.uniforms.sim) },
    ]);
    this.bg.reset = bg(this.pipe.reset, [
      { binding: 0, resource: S(b.pos) },
      { binding: 1, resource: S(b.vel) },
      { binding: 2, resource: S(b.prev) },
      { binding: 3, resource: S(b.rest) },
    ]);
    this.bg.cloth = bg(this.pipe.cloth, [
      { binding: 0, resource: U(this.uniforms.cam) },
      { binding: 1, resource: U(this.uniforms.fab) },
      { binding: 2, resource: S(b.pos) },
      { binding: 3, resource: S(b.vinfo) },
      { binding: 4, resource: S(b.uv) },
      { binding: 5, resource: S(b.nrm) },
    ]);
    this.bg.body = bg(this.pipe.body, [{ binding: 0, resource: U(this.uniforms.cam) }]);
    this.bg.ground = bg(this.pipe.ground, [{ binding: 0, resource: U(this.uniforms.cam) }]);
    this.bg.fabric = bg(this.pipe.fabric, [
      { binding: 0, resource: U(this.uniforms.fab) },
      { binding: 1, resource: U(this.uniforms.preview) },
    ]);
  }

  /** Stiffness sliders change compliance in place — cheap, no rebuild. */
  updateCompliance(cp) {
    if (!this.constraints) return;
    const list = this.constraints;
    // constraints were packed in order; type is stored per entry
    const f = this.constraints.f32;
    const cons = this.constraintList;
    if (!cons) return;
    for (let k = 0; k < cons.length; k++) {
      const t = cons[k].type;
      const comp = t === 0 ? cp.stretchComp : t === 1 ? cp.shearComp : t === 2 ? cp.bendComp : cp.stitchComp;
      f[k * CON_STRIDE + 3] = comp;
    }
    this.device.queue.writeBuffer(this.buf.cons, 0, this.constraints.buffer);
    void list;
  }

  /** Pins follow the animated body (dancing mode). */
  updatePins(bodyMatrix) {
    if (!this.state || !this._pinLocal) return;
    const st = this.state;
    const arr = st.pinPos;
    const local = this._pinLocal;
    for (let k = 0; k < local.length / 4; k++) {
      const x = local[k * 4], y = local[k * 4 + 1], z = local[k * 4 + 2];
      const wx = bodyMatrix[0] * x + bodyMatrix[4] * y + bodyMatrix[8] * z + bodyMatrix[12];
      const wy = bodyMatrix[1] * x + bodyMatrix[5] * y + bodyMatrix[9] * z + bodyMatrix[13];
      const wz = bodyMatrix[2] * x + bodyMatrix[6] * y + bodyMatrix[10] * z + bodyMatrix[14];
      arr[k * 4] = wx; arr[k * 4 + 1] = wy; arr[k * 4 + 2] = wz; arr[k * 4 + 3] = 1;
    }
    this.device.queue.writeBuffer(this.buf.pinPos, 0, arr);
  }

  resetSim() {
    if (!this.bg) return;
    this.updatePins(this.bodyMatrix ?? m4.identity());
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipe.reset);
    pass.setBindGroup(0, this.bg.reset);
    pass.dispatchWorkgroups(Math.ceil(this.vertexCount / WORKGROUP));
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  // ------------------------------------------------------------------ stepping
  step(dt, simCfg) {
    const dev = this.device;
    if (!this.bg) return;
    const substeps = Math.max(1, Math.round(simCfg.substeps));
    const h = dt / substeps;
    const iterations = Math.max(1, Math.round(simCfg.iterations));

    // uniform writes (byte offsets come from src/layout.js)
    const c = simCfg;
    writeUniform(this.u.sim, SIM_LAYOUT, {
      gravity: [c.gravity[0], c.gravity[1], c.gravity[2], h],
      wind: [c.wind[0], c.wind[1], c.wind[2], this.worldTime],
      params: [c.airDrag, c.damping, c.thickness, c.friction],
      params2: [substeps, 0, 0, c.floorY],
    });
    dev.queue.writeBuffer(this.uniforms.sim, 0, this.u.sim);

    writeUniform(this.u.pin, PIN, { params: [c.pinBlend, 0, 0, 0] });
    dev.queue.writeBuffer(this.uniforms.pin, 0, this.u.pin);

    writeUniform(this.u.col, COL, {
      modelInv: this.bodyMatrixInverse ?? m4.identity(),
      model: this.bodyMatrix ?? m4.identity(),
      params: [c.thickness, c.friction, c.restitution, h],
      extra: [c.floorY, this.worldTime, 0, 0],
      counts: Uint32Array.from([this.colCounts.ringCount, this.colCounts.capsuleCount, c.bodyCollision ? 1 : 0, 0]),
    });
    dev.queue.writeBuffer(this.uniforms.col, 0, this.u.col);

    const groups = Math.ceil(this.vertexCount / WORKGROUP);
    const cgroups = Math.ceil(this.constraints.count / WORKGROUP);
    const pgroups = Math.ceil(this.state.pinIndices.length / WORKGROUP);
    const hasPins = this.state.pinIndices.length > 0;
    const pinEvery = simCfg.pinEvery ?? 2;

    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    for (let s = 0; s < substeps; s++) {
      pass.setPipeline(this.pipe.predict);
      pass.setBindGroup(0, this.bg.predict);
      pass.dispatchWorkgroups(groups);

      pass.setPipeline(this.pipe.clear);
      pass.setBindGroup(0, this.bg.clear);
      pass.dispatchWorkgroups(cgroups);

      pass.setPipeline(this.pipe.solve);
      pass.setBindGroup(0, this.bg.solve);
      for (let it = 0; it < iterations; it++) {
        pass.dispatchWorkgroups(cgroups);
        if (hasPins && it % pinEvery === pinEvery - 1) {
          pass.setPipeline(this.pipe.pins);
          pass.setBindGroup(0, this.bg.pins);
          pass.dispatchWorkgroups(pgroups);
          pass.setPipeline(this.pipe.solve);
          pass.setBindGroup(0, this.bg.solve);
        }
      }
      pass.setPipeline(this.pipe.collide);
      pass.setBindGroup(0, this.bg.collide);
      pass.dispatchWorkgroups(groups);
    }

    pass.setPipeline(this.pipe.finalize);
    pass.setBindGroup(0, this.bg.finalize);
    pass.dispatchWorkgroups(groups);
    pass.end();
    dev.queue.submit([enc.finish()]);
  }

  // ------------------------------------------------------------------ rendering
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    const fw = Math.max(1, Math.floor(this.fabricCanvas.clientWidth * dpr));
    const fh = Math.max(1, Math.floor(this.fabricCanvas.clientHeight * dpr));
    if (this.fabricCanvas.width !== fw || this.fabricCanvas.height !== fh) {
      this.fabricCanvas.width = fw; this.fabricCanvas.height = fh;
    }
    this.dpr = dpr;
    this.ensureDepth(w, h);
  }

  render(camera, fabricUniform) {
    if (!this.ready || !this.bg) return;
    this.resize();
    const dev = this.device;

    // camera uniform
    writeUniform(this.u.cam, CAMERA, {
      viewProj: camera.viewProj,
      model: this.bodyMatrix ?? m4.identity(),
      invViewProj: camera.invViewProj,
      eye: [camera.eye[0], camera.eye[1], camera.eye[2], 1],
      lightDir: [camera.lightDir[0], camera.lightDir[1], camera.lightDir[2], 0],
      lightCol: [camera.lightCol[0], camera.lightCol[1], camera.lightCol[2], 1],
      ambient: [camera.ambient[0], camera.ambient[1], camera.ambient[2], 1],
    });
    dev.queue.writeBuffer(this.uniforms.cam, 0, this.u.cam);
    dev.queue.writeBuffer(this.uniforms.fab, 0, fabricUniform);

    const enc = dev.createCommandEncoder();

    // ---- 2D fabric swatch (drawn into the panel canvas)
    {
      const cw = this.fabricCanvas.width, ch = this.fabricCanvas.height;
      writeUniform(this.u.preview, PREVIEW, {
        rect: [0, 0, cw, ch],
        res: [cw, ch, 0, 0],
        flags: [this.previewZoom ?? 3.0, 0, 0, 0],
      });
      dev.queue.writeBuffer(this.uniforms.preview, 0, this.u.preview);
      const view = this.fctx.getCurrentTexture().createView();
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view, clearValue: { r: 0.05, g: 0.052, b: 0.06, a: 1 },
          loadOp: 'clear', storeOp: 'store',
        }],
      });
      pass.setPipeline(this.pipe.fabric);
      pass.setBindGroup(0, this.bg.fabric);
      pass.draw(6);
      pass.end();
    }

    // ---- 3D viewport
    {
      const view = this.ctx.getCurrentTexture().createView();
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view, clearValue: { r: 0.10, g: 0.105, b: 0.12, a: 1 },
          loadOp: 'clear', storeOp: 'store',
        }],
        depthStencilAttachment: {
          view: this.depth.createView(),
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });

      pass.setPipeline(this.pipe.ground);
      pass.setBindGroup(0, this.bg.ground);
      pass.draw(3);

      pass.setPipeline(this.pipe.body);
      pass.setBindGroup(0, this.bg.body);
      pass.setVertexBuffer(0, this.bodyVerts);
      pass.setIndexBuffer(this.bodyIdx, 'uint32');
      pass.drawIndexed(this.bodyIndexCount);

      if (this.indexCount) {
        pass.setPipeline(this.pipe.cloth);
        pass.setBindGroup(0, this.bg.cloth);
        pass.setIndexBuffer(this.indexBuf, 'uint32');
        pass.drawIndexed(this.indexCount);
      }
      pass.end();
    }

    dev.queue.submit([enc.finish()]);
  }
}

function align16(n) { return Math.ceil(n / 16) * 16; }
function align4(n) { return Math.ceil(n / 4) * 4; }
