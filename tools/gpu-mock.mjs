// A validating WebGPU mock.
//
// There is no GPU (and no browser) in this environment, so instead of ignoring
// the GPU layer we *check* it: every pipeline is scanned out of its WGSL, and
// every bind group, buffer usage, buffer size, vertex layout and draw/dispatch
// call is validated against that shader. This catches the class of bug that
// would otherwise only show up as a blank canvas.
import { parseShader } from './wgsl-parse.mjs';

export const GPUBufferUsage = {
  MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32,
  UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512,
};
export const GPUTextureUsage = {
  COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16,
};
export const GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
export const GPUMapMode = { READ: 1, WRITE: 2 };

export function installGPU({ maxBufferSize = 1 << 30 } = {}) {
  const errors = [];
  const log = [];
  const fail = (msg) => { errors.push(msg); log.push(`ERROR ${msg}`); };

  const stats = { buffers: 0, pipelines: 0, bindGroups: 0, dispatches: 0, draws: 0, submits: 0, writeBytes: 0 };
  let nextId = 0;

  const limits = {
    maxTextureDimension2D: 8192, maxStorageBufferBindingSize: 1 << 28, maxBufferSize,
    maxComputeWorkgroupSizeX: 256, maxComputeInvocationsPerWorkgroup: 256,
    maxComputeWorkgroupsPerDimension: 65535, maxBindGroups: 4,
    maxStorageBuffersPerShaderStage: 8, maxUniformBufferBindingSize: 65536,
    maxVertexBuffers: 8, maxVertexAttributes: 16, maxBindingsPerBindGroup: 640,
  };

  const queue = {
    writeBuffer(buffer, offset, data, dataOffset = 0, size) {
      if (!buffer) return fail('writeBuffer: null buffer');
      if (buffer.destroyed) return fail(`writeBuffer: buffer "${buffer.label}" was destroyed`);
      if (!(buffer.usage & GPUBufferUsage.COPY_DST)) {
        return fail(`writeBuffer: buffer "${buffer.label}" lacks COPY_DST`);
      }
      if (!data || data.byteLength === undefined) return fail('writeBuffer: data is not a typed array');
      const per = data.BYTES_PER_ELEMENT ?? 1;
      const bytes = size ?? (data.byteLength - dataOffset * per);
      if (offset + bytes > buffer.size) {
        return fail(`writeBuffer: "${buffer.label}" overflow (${offset}+${bytes} > ${buffer.size})`);
      }
      stats.writeBytes += bytes;
      buffer.__writes.push({ offset, bytes });
    },
    submit(list) {
      if (!Array.isArray(list)) return fail('queue.submit expects an array');
      stats.submits += list.length;
    },
    writeTexture() {},
  };

  /** Pipeline handle: the shader has been scanned for its contract up front. */
  function makePipeline(desc, kind) {
    const module = kind === 'compute' ? desc.compute.module : desc.vertex.module;
    const shader = parseShader(module.code);
    const entryPoints = kind === 'compute'
      ? [desc.compute.entryPoint]
      : [desc.vertex.entryPoint, ...(desc.fragment ? [desc.fragment.entryPoint] : [])];
    const declaredNames = [
      ...shader.entries.compute.map((e) => e.name),
      ...shader.entries.vertex.map((e) => e.name),
      ...shader.entries.fragment.map((e) => e.name),
    ];
    for (const ep of entryPoints) {
      if (!declaredNames.includes(ep)) fail(`shader "${module.label}" has no entry point "${ep}"`);
    }
    const keys = [...shader.bindings.keys()].sort((a, b) => a - b);
    for (const [i, b] of keys.entries()) {
      if (b !== i) fail(`"${module.label}" @bindings are not contiguous: ${keys.join(',')}`);
    }
    const handle = {
      kind, label: desc.label, code: module.code, entryPoints, shader,
      declared: shader.bindings,
      vertexBuffers: desc.vertex?.buffers ?? [],
    };
    // app.js passes pipeline.getBindGroupLayout(0) into createBindGroup, so the
    // layout handle has to point back at the pipeline whose shader we scanned
    handle.getBindGroupLayout = () => ({ __pipeline: handle });
    return handle;
  }

  function createCommandEncoder() {
    return {
      beginComputePass() {
        let pipeline = null;
        let bg = null;
        return {
          setPipeline(p) { pipeline = p; },
          setBindGroup(idx, group) { if (idx === 0) bg = group; },
          dispatchWorkgroups(x, y = 1, z = 1) {
            stats.dispatches++;
            if (!pipeline) return fail('dispatch without a pipeline');
            if (!Number.isFinite(x) || x <= 0) return fail(`dispatchWorkgroups(${x}, ${y}, ${z})`);
            if (!bg) fail(`dispatch on "${pipeline.label}" without a bind group`);
            else if (bg.__pipeline && bg.__pipeline !== pipeline) {
              fail(`bind group made for "${bg.__pipeline.label}" bound to "${pipeline.label}"`);
            }
          },
          end() {},
        };
      },
      beginRenderPass(desc) {
        for (const a of desc.colorAttachments ?? []) {
          if (!a?.view) fail('render pass: colour attachment has no view');
        }
        let pipeline = null;
        let bg = null;
        return {
          setPipeline(p) { pipeline = p; },
          setBindGroup(idx, group) { if (idx === 0) bg = group; },
          setVertexBuffer() {},
          setIndexBuffer(buffer, fmt) {
            if (!buffer) return fail('setIndexBuffer: null buffer');
            if (!(buffer.usage & GPUBufferUsage.INDEX)) fail(`setIndexBuffer: "${buffer.label}" lacks INDEX usage`);
            if (fmt !== 'uint32' && fmt !== 'uint16') fail(`setIndexBuffer format ${fmt}`);
          },
          draw(count) {
            stats.draws++;
            if (!pipeline) return fail('draw without a pipeline');
            if (!bg) return fail(`draw on "${pipeline.label}" without a bind group`);
            if (!(count > 0)) fail(`draw with count ${count}`);
          },
          drawIndexed(count) { this.draw(count); },
          end() {},
        };
      },
      finish() { return { __commandBuffer: true }; },
    };
  }

  const device = {
    limits,
    features: new Set(),
    lost: new Promise(() => {}),
    addEventListener() {},
    onuncapturederror: null,
    queue,
    createBuffer({ size, usage, label = 'buffer', mappedAtCreation = false } = {}) {
      if (!(size > 0)) fail(`createBuffer "${label}" size ${size}`);
      if (size > limits.maxBufferSize) fail(`createBuffer "${label}" exceeds maxBufferSize`);
      stats.buffers++;
      return {
        size, usage, label, mappedAtCreation, id: nextId++, __writes: [], destroyed: false,
        destroy() { this.destroyed = true; },
        getMappedRange() { return new ArrayBuffer(size); },
        unmap() {}, mapAsync: async () => {},
      };
    },
    createShaderModule({ code, label = 'shader' }) {
      return { code, label };
    },
    createComputePipeline(desc) {
      if (desc.layout !== 'auto') fail('compute pipeline expects layout "auto" in this test');
      stats.pipelines++;
      return makePipeline(desc, 'compute');
    },
    createRenderPipeline(desc) {
      stats.pipelines++;
      const p = makePipeline(desc, 'render');
      const verts = p.shader.vertexInputs.get(desc.vertex.entryPoint);
      if (verts && p.vertexBuffers.length) {
        const declaredLocs = verts.map((i) => i.location).sort((a, b) => a - b);
        const boundLocs = p.vertexBuffers
          .flatMap((vb) => vb.attributes.map((a) => a.shaderLocation))
          .sort((a, b) => a - b);
        if (declaredLocs.join(',') !== boundLocs.join(',')) {
          fail(`"${p.label}" vertex inputs [${declaredLocs}] != buffer attributes [${boundLocs}]`);
        }
      }
      return p;
    },
    createBindGroup(desc) {
      stats.bindGroups++;
      const pipeline = desc.layout?.__pipeline ?? null;
      const entries = desc.entries ?? [];
      const seen = new Set();
      for (const e of entries) {
        if (seen.has(e.binding)) fail(`duplicate binding ${e.binding}`);
        seen.add(e.binding);
        const buffer = e.resource?.buffer;
        if (!buffer) { fail(`binding ${e.binding} is not a buffer`); continue; }
        const decl = pipeline?.declared?.get(e.binding);
        if (!decl) {
          fail(`bind group has binding ${e.binding} but "${pipeline?.label ?? '?'}" declares no such binding`);
          continue;
        }
        if (decl.space === 'uniform' && !(buffer.usage & GPUBufferUsage.UNIFORM)) {
          fail(`"${pipeline.label}" binding ${e.binding} (${decl.type}) needs UNIFORM, "${buffer.label}" is ${buffer.usage}`);
        }
        if (decl.space === 'storage' && !(buffer.usage & GPUBufferUsage.STORAGE)) {
          fail(`"${pipeline.label}" binding ${e.binding} (${decl.type}) needs STORAGE, "${buffer.label}" is ${buffer.usage}`);
        }
        if (decl.space === 'uniform') {
          const st = pipeline.shader.structs.get(String(decl.type).trim());
          if (st && buffer.size < st.size) {
            fail(`"${pipeline.label}" binding ${e.binding} needs >= ${st.size} B for ${decl.type}, "${buffer.label}" is ${buffer.size}`);
          }
        }
      }
      for (const [binding, decl] of pipeline?.declared ?? new Map()) {
        if (!seen.has(binding)) fail(`"${pipeline.label}" binding ${binding} (${decl.name}) was never bound`);
      }
      return { __pipeline: pipeline, entries, label: desc.label };
    },
    createTexture({ size, format, usage, label = 'texture' }) {
      if (!(usage & GPUTextureUsage.RENDER_ATTACHMENT)) fail(`createTexture "${label}" needs RENDER_ATTACHMENT`);
      return {
        width: size[0], height: size[1], format, label, destroyed: false,
        createView: () => ({ __texture: label }),
        destroy() { this.destroyed = true; },
      };
    },
    createSampler: () => ({}),
    createCommandEncoder,
    createRenderBundleEncoder: createCommandEncoder,
    pushErrorScope() {}, popErrorScope: async () => null,
    destroy() {},
  };

  const adapter = {
    limits, features: new Set(),
    info: { vendor: 'mock', architecture: 'mock', device: 'mock-gpu', description: 'validating WebGPU mock' },
    requestDevice: async () => device,
  };

  const gpu = {
    requestAdapter: async () => adapter,
    getPreferredCanvasFormat: () => 'bgra8unorm',
    wgslLanguageFeatures: new Set(),
  };

  Object.defineProperty(globalThis, 'navigator', {
    value: { gpu, userAgent: 'node-mock', platform: 'node' },
    configurable: true, writable: true,
  });
  globalThis.GPUBufferUsage = GPUBufferUsage;
  globalThis.GPUTextureUsage = GPUTextureUsage;
  globalThis.GPUShaderStage = GPUShaderStage;
  globalThis.GPUColorWrite = { ALL: 15 };
  globalThis.GPUMapMode = GPUMapMode;

  return { device, gpu, adapter, errors, log, stats };
}
