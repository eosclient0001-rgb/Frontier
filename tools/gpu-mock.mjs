// A validating WebGPU mock.
//
// There is no GPU (and no browser) in this environment, so instead of ignoring
// the GPU layer we *check* it: every pipeline is parsed out of its WGSL with
// wgsl_reflect, and every bind group, buffer usage, buffer size, vertex layout
// and draw/dispatch call is validated against that shader. This catches the
// class of bug that would otherwise only show up as a blank canvas.
import { createRequire } from 'node:module';
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..', 'node_modules', 'wgsl_reflect');
if (!existsSync(join(pkg, 'wgsl_reflect.cjs'))) {
  copyFileSync(join(pkg, 'wgsl_reflect.node.js'), join(pkg, 'wgsl_reflect.cjs'));
}
const require = createRequire(import.meta.url);
const { WgslReflect } = require('wgsl_reflect/wgsl_reflect.cjs');

export const GPUBufferUsage = {
  MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32,
  UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512,
};
export const GPUTextureUsage = {
  COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16,
};
export const GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
export const GPUMapMode = { READ: 1, WRITE: 2 };

const STORAGE_RW = /@group\(0\)\s*@binding\((\d+)\)\s*var<\s*storage\s*,\s*(read_write|read)\s*>/g;

/** bindings the shader actually declares, with access mode, from source text */
function declaredBindings(code) {
  const out = new Map();
  for (const m of code.matchAll(STORAGE_RW)) out.set(Number(m[1]), { access: m[2] });
  const re = /@group\((\d+)\)\s*@binding\((\d+)\)\s*var<\s*([a-z_]+)\s*>\s*([A-Za-z0-9_]+)\s*:\s*([A-Za-z0-9_<>[\]f ]+)\s*;/g;
  for (const m of code.matchAll(re)) {
    const [, group, binding, space, name, type] = m;
    if (Number(group) !== 0) continue;
    out.set(Number(binding), {
      ...(out.get(Number(binding)) ?? {}), space, name: name.trim(), type: type.trim(),
      access: out.get(Number(binding))?.access ?? 'read',
    });
  }
  return out;
}

export function installGPU({ maxBufferSize = 1 << 30 } = {}) {
  const errors = [];
  const log = [];
  const fail = (msg) => { errors.push(msg); log.push(`ERROR ${msg}`); };
  const note = (msg) => log.push(msg);

  const stats = { buffers: 0, pipelines: 0, bindGroups: 0, dispatches: 0, draws: 0, submits: 0, writeBytes: 0 };

  let nextId = 0;
  const buffers = new Set();

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
      const bytes = size ?? (data.byteLength - dataOffset * (data.BYTES_PER_ELEMENT ?? 1));
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

  function makePipeline(desc, kind) {
    const mod = kind === 'compute' ? desc.compute.module : desc.vertex.module;
    const code = mod.code;
    const entryPoints = [];
    if (kind === 'compute') entryPoints.push(desc.compute.entryPoint);
    else {
      entryPoints.push(desc.vertex.entryPoint);
      if (desc.fragment) entryPoints.push(desc.fragment.entryPoint);
    }
    let reflect;
    try {
      reflect = new WgslReflect(code);
    } catch (e) {
      fail(`shader "${mod.label}" failed to parse: ${e.message ?? e}`);
      reflect = null;
    }
    const names = kind === 'compute'
      ? reflect?.entry.compute.map((e) => e.name) ?? []
      : [...(reflect?.entry.vertex ?? []), ...(reflect?.entry.fragment ?? [])].map((e) => e.name);
    for (const ep of entryPoints) {
      if (reflect && !names.includes(ep)) fail(`shader "${mod.label}" has no entry point "${ep}"`);
    }
    const declared = declaredBindings(code);
    const pipeline = {
      kind, label: desc.label, code, entryPoints, declared,
      reflect, vertexBuffers: desc.vertex?.buffers ?? [],
      getBindGroupLayout: (i) => ({ __pipeline: pipeline, __index: i }),
      bindGroupLayouts: [],
    };
    // every declared binding must be present in the bind group the app builds
    stats.pipelines++;
    return pipeline;
  }

  function createCommandEncoder() {
    return {
      beginComputePass() {
        let pipeline = null;
        let bg = null;
        const pass = {
          setPipeline(p) { pipeline = p; },
          setBindGroup(idx, group) { if (idx === 0) bg = group; },
          dispatchWorkgroups(x, y = 1, z = 1) {
            stats.dispatches++;
            if (!pipeline) return fail('dispatch without a pipeline');
            if (x < 0 || !Number.isFinite(x)) return fail(`dispatchWorkgroups(${x})`);
            if (bg && bg.__pipeline && bg.__pipeline !== pipeline) {
              fail(`dispatch bound a bind group made for "${bg.__pipeline.label}" to "${pipeline.label}"`);
            }
            if (!bg) fail(`dispatch on "${pipeline.label}" without a bind group`);
          },
          end() {},
        };
        return pass;
      },
      beginRenderPass(desc) {
        for (const a of desc.colorAttachments ?? []) {
          if (!a?.view) fail('render pass: colour attachment has no view');
        }
        // depth is optional (the 2D fabric swatch pass has none)
        let pipeline = null;
        let bg = null;
        const pass = {
          setPipeline(p) { pipeline = p; },
          setBindGroup(idx, group) { if (idx === 0) bg = group; },
          setVertexBuffer() {},
          setIndexBuffer(b, fmt) {
            if (!b) fail('setIndexBuffer: null buffer');
            if (!(b.usage & GPUBufferUsage.INDEX)) fail(`setIndexBuffer: "${b.label}" lacks INDEX usage`);
            if (fmt !== 'uint32' && fmt !== 'uint16') fail(`setIndexBuffer format ${fmt}`);
          },
          draw(count) { stats.draws++; validateDraw(pipeline, bg, count); },
          drawIndexed(count) { stats.draws++; validateDraw(pipeline, bg, count); },
          end() {},
        };
        return pass;
      },
      finish() { return { __commandBuffer: true }; },
    };
  }

  function validateDraw(pipeline, bg, count) {
    if (!pipeline) return fail('draw without a pipeline');
    if (!bg) return fail(`draw on "${pipeline.label}" without a bind group`);
    if (count <= 0) fail(`draw with count ${count}`);
    const needed = pipeline.vertexBuffers.map((b) => b.attributes.length).reduce((a, b) => a + b, 0);
    if (needed && !pipeline.__boundVerts) note(`draw "${pipeline.label}" uses ${needed} vertex attributes`);
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
      const buf = {
        size, usage, label, mappedAtCreation, id: nextId++, __writes: [],
        destroyed: false, destroy() { this.destroyed = true; buffers.delete(this); },
        getMappedRange() { return new ArrayBuffer(size); },
        unmap() {}, mapAsync: async () => {},
      };
      buffers.add(buf);
      return buf;
    },
    createShaderModule({ code, label = 'shader' }) {
      return { code, label };
    },
    createComputePipeline(desc) {
      if (desc.layout !== 'auto') fail('compute pipeline expects layout "auto" in this test');
      return makePipeline(desc, 'compute');
    },
    createRenderPipeline(desc) {
      const p = makePipeline(desc, 'render');
      for (const vb of p.vertexBuffers) {
        for (const attr of vb.attributes) {
          if (attr.format !== 'float32x3' && attr.format !== 'float32x2' && attr.format !== 'float32x4'
            && attr.format !== 'unorm8x4' && attr.format !== 'sint32x4') {
            fail(`vertex attribute format ${attr.format} unsupported in this mock`);
          }
        }
      }
      const verts = p.reflect?.entry.vertex?.[0];
      if (verts && p.vertexBuffers.length) {
        const declaredLocs = verts.inputs.map((i) => i.location).sort((a, b) => a - b);
        const boundLocs = p.vertexBuffers.flatMap((vb) => vb.attributes.map((a) => a.shaderLocation)).sort((a, b) => a - b);
        if (declaredLocs.join(',') !== boundLocs.join(',')) {
          fail(`"${p.label}" vertex inputs [${declaredLocs}] != buffer attributes [${boundLocs}]`);
        }
      }
      return p;
    },
    createBindGroup(desc) {
      stats.bindGroups++;
      const pipeline = desc.layout?.__pipeline;
      const entries = desc.entries ?? [];
      const seen = new Set();
      for (const e of entries) {
        if (seen.has(e.binding)) fail(`duplicate binding ${e.binding}`);
        seen.add(e.binding);
        const b = e.resource?.buffer;
        if (!b) { fail(`binding ${e.binding} is not a buffer`); continue; }
        const decl = pipeline?.declared?.get(e.binding);
        if (!decl) {
          fail(`bind group has binding ${e.binding} but "${pipeline?.label}" declares no such binding`);
          continue;
        }
        if (decl.space === 'uniform' && !(b.usage & GPUBufferUsage.UNIFORM)) {
          fail(`"${pipeline.label}" binding ${e.binding} (${decl.type}) needs UNIFORM usage, buffer "${b.label}" has ${b.usage}`);
        }
        if (decl.space === 'storage' && !(b.usage & GPUBufferUsage.STORAGE)) {
          fail(`"${pipeline.label}" binding ${e.binding} (${decl.type}) needs STORAGE usage, buffer "${b.label}" has ${b.usage}`);
        }
        if (decl.space === 'uniform') {
          const need = pipeline.reflect?.getBindGroups()?.flat()
            ?.find((x) => x.binding === e.binding)?.type?.size;
          if (need && b.size < need) {
            fail(`"${pipeline.label}" binding ${e.binding} needs >= ${need} bytes, "${b.label}" is ${b.size}`);
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
    createBindGroupLayout: (d) => d,
    createPipelineLayout: (d) => d,
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
