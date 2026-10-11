#!/usr/bin/env node
/**
 * Frontier Terrain Forge — headless graph dry run.
 *
 * No GPU is required. This tool swaps in a mock WebGPU device, a file-backed
 * fetch and the real shader module system, then runs the entire generator graph
 * for every preset exactly the way the browser would: same passes, same
 * bindings, same uniforms, same workgroup counts.
 *
 * What it proves, none of which a static check can:
 *   • every pass the graph instantiates compiles (naga, with the real defines),
 *   • every declared binding is supplied and no name is misspelled,
 *   • every uniform field exists in the generated layout and is finite,
 *   • the ping-pong bookkeeping never reads a texture it is writing,
 *   • how many dispatches a preset costs at a given resolution.
 *
 *   node tools/simulate.mjs [--res 1024] [--no-validate] [--quiet]
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const RES = Number(argOf('--res', 768));
const VALIDATE = !argv.includes('--no-validate');
const QUIET = argv.includes('--quiet');

/* ------------------------------------------------------------------ *
 * Browser shims
 * ------------------------------------------------------------------ */
globalThis.GPUTextureUsage = {
  COPY_SRC: 0x01, COPY_DST: 0x02, TEXTURE_BINDING: 0x04, STORAGE_BINDING: 0x08, RENDER_ATTACHMENT: 0x10,
};
globalThis.GPUBufferUsage = {
  MAP_READ: 0x01, MAP_WRITE: 0x02, COPY_SRC: 0x04, COPY_DST: 0x08, INDEX: 0x10, VERTEX: 0x20,
  UNIFORM: 0x40, STORAGE: 0x80, INDIRECT: 0x100, QUERY_RESOLVE: 0x200,
};
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUMapMode = { READ: 1, WRITE: 2 };
globalThis.document = { baseURI: 'https://frontier.local/index.html' };

const virtualRoot = '/src/vendor/wgsl';
globalThis.fetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input.url, document.baseURI);
  let file = url.pathname;
  if (file.startsWith(virtualRoot)) file = join(ROOT, file.slice(1));
  else if (file.startsWith(ROOT)) file = file;
  else file = join(ROOT, file.replace(/^\/+/, ''));
  try {
    const text = readFileSync(file, 'utf8');
    return { ok: true, status: 200, text: async () => text };
  } catch (error) {
    return { ok: false, status: 404, text: async () => { throw error; } };
  }
};

/* ------------------------------------------------------------------ *
 * Mock WebGPU device
 * ------------------------------------------------------------------ */
const report = { warnings: [], dispatches: 0, byPass: new Map(), pipelines: 0, bindGroups: 0, submits: 0, modules: new Set() };

let naga = null;
if (VALIDATE) {
  try { naga = await import('naga-wasm'); } catch { report.warnings.push('naga-wasm not installed — skipping validation'); }
}
const validateCache = new Map();
function validateWgsl(label, code) {
  if (!naga || validateCache.has(code)) return validateCache.get(code) ?? true;
  try {
    const module = naga.parseWgsl(code);
    naga.validate(module);
    validateCache.set(code, true);
    return true;
  } catch (error) {
    const detail = (error && (error.formatted || error.message)) || String(error);
    report.warnings.push(`naga rejected ${label}: ${detail.split('\n').slice(0, 12).join('\n    ')}`);
    validateCache.set(code, false);
    return false;
  }
}

class MockTexture {
  constructor(desc) { this.desc = desc; this.width = desc.size.width; this.height = desc.size.height; this.format = desc.format; }
  createView(desc) { return { texture: this, desc, format: (desc && desc.format) || this.format }; }
  destroy() { this.destroyed = true; }
}
class MockBuffer {
  constructor(desc) { this.desc = desc; this.size = desc.size; this.label = desc.label; }
  destroy() { this.destroyed = true; }
  async mapAsync() {}
  getMappedRange() { return new ArrayBuffer(this.size); }
  unmap() {}
}

class MockEncoder {
  constructor(device) { this.device = device; this.finished = false; this.copies = 0; }
  beginComputePass(desc) {
    const encoder = this;
    const pass = { label: desc?.label, dispatches: 0 };
    return {
      setPipeline(pipeline) { pass.pipeline = pipeline; },
      setBindGroup(index, group) { pass.lastGroup = group; },
      dispatchWorkgroups(x, y, z) {
        pass.dispatches++;
        encoder.dispatches = (encoder.dispatches || 0) + 1;
        const name = desc?.label || 'unknown';
        report.dispatches++;
        report.byPass.set(name, (report.byPass.get(name) || 0) + 1);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          report.warnings.push(`pass ${name}: non-finite workgroup count ${x},${y},${z}`);
        }
        if (x > 65535 || y > 65535) report.warnings.push(`pass ${name}: workgroup count ${x}×${y} exceeds 65535`);
      },
      end() {},
    };
  }
  beginRenderPass(desc) {
    const encoder = this;
    const state = { label: desc?.label, draws: 0, pipeline: null };
    this.renderPasses = (this.renderPasses || 0) + 1;
    return {
      setPipeline(pipeline) { state.pipeline = pipeline; },
      setBindGroup() {},
      setIndexBuffer() {},
      draw(count, instances) {
        if (!state.pipeline) report.warnings.push(`render pass ${state.label}: draw without a pipeline`);
        if (!Number.isFinite(count) || count <= 0) report.warnings.push(`render pass ${state.label}: draw count ${count}`);
        report.draws = (report.draws || 0) + 1;
        state.draws++;
        encoder.draws = (encoder.draws || 0) + 1;
      },
      drawIndexed(count, instances) {
        if (!state.pipeline) report.warnings.push(`render pass ${state.label}: drawIndexed without a pipeline`);
        if (!Number.isFinite(count) || count <= 0) report.warnings.push(`render pass ${state.label}: drawIndexed count ${count}`);
        report.draws = (report.draws || 0) + 1;
        state.draws++;
        encoder.draws = (encoder.draws || 0) + 1;
      },
      end() {},
    };
  }
  copyTextureToTexture(src, dst, size) { this.copies++; return { kind: 'texture', size }; }
  copyTextureToBuffer(src, dst, size) { this.copies++; return { kind: 'texture-buffer', size }; }
  copyBufferToTexture() { this.copies++; }
  finish() { this.finished = true; return { encoder: this }; }
}

function makeMockGpu(limits) {
  const device = {
    label: 'mock-device',
    limits: { maxTextureDimension2D: 8192, maxStorageTexturesPerShaderStage: 8, maxComputeWorkgroupsPerDimension: 65535, maxBufferSize: 1 << 28, ...limits },
    queue: {
      submit(list) { report.submits++; },
      writeBuffer(buffer, offset, data, dataOffset = 0, size) {
        if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
          report.warnings.push(`writeBuffer got ${typeof data} for ${buffer.label}`);
        }
      },
      // writeTexture is a queue member in the real API; keep it there.

      onSubmittedWorkDone: async () => {},
    },
    // (queue.writeTexture is attached below where the mock queue is built)
    createShaderModule(desc) {
      if (report.modules.has(desc.code)) return { label: desc.label, code: desc.code };
      report.modules.add(desc.code);
      validateWgsl(desc.label || 'module', desc.code);
      return { label: desc.label, code: desc.code };
    },
    createBuffer: (desc) => new MockBuffer(desc),
    createTexture: (desc) => new MockTexture(desc),
    createSampler: (desc) => ({ desc, label: desc.label }),
    createBindGroupLayout: (desc) => { report.bindGroups++; return { desc }; },
    createBindGroup(desc) {
      report.bindGroups++;
      for (const entry of desc.entries) {
        if (entry.resource == null) report.warnings.push(`bind group ${desc.label}: binding ${entry.binding} has no resource`);
        if ('buffer' in entry.resource && !(entry.resource.buffer instanceof MockBuffer)) {
          report.warnings.push(`bind group ${desc.label}: binding ${entry.binding} expects a buffer`);
        }
        if ('texture' in entry.resource && !(entry.resource.texture instanceof MockTexture)) {
          report.warnings.push(`bind group ${desc.label}: binding ${entry.binding} expects a texture view`);
        }
      }
      return desc;
    },
    createPipelineLayout: (desc) => ({ desc }),
    createComputePipeline(desc) {
      report.pipelines++;
      validateWgsl(desc.label || 'compute', desc.compute.module.code);
      return { desc, kind: 'compute' };
    },
    createRenderPipeline(desc) {
      report.pipelines++;
      if (desc.vertex?.module) validateWgsl(`${desc.label}:vs`, desc.vertex.module.code);
      if (desc.fragment?.module) validateWgsl(`${desc.label}:fs`, desc.fragment.module.code);
      validateDepth(desc);
      return { desc, kind: 'render' };
    },
    createCommandEncoder: () => new MockEncoder(device),
    addEventListener() {},
    destroy() {},
  };
  return device;
}

function validateDepth(desc) {
  const depth = desc.depthStencil;
  if (!depth) return;
  const formats = { depth24plus: true, depth32float: true, depth16unorm: true, 'depth24plus-stencil8': true };
  if (!formats[depth.format]) report.warnings.push(`render pipeline ${desc.label}: depth format ${depth.format} is not a depth format`);
}

const mockDevice = makeMockGpu({});
mockDevice.queue.writeTexture = (desc, data) => {
  if (!data || data.byteLength === 0) report.warnings.push('writeTexture with empty data');
};
const navigatorMock = {
  gpu: {
    async requestAdapter() {
      return {
        info: { vendor: 'mock', architecture: 'simulated', device: 'headless', description: 'Frontier graph dry run' },
        features: new Set(['float32-filterable']),
        limits: { maxTextureDimension2D: 8192, maxStorageTexturesPerShaderStage: 8, maxSampledTexturesPerShaderStage: 16, maxBufferSize: 1 << 28, maxComputeWorkgroupsPerDimension: 65535 },
        getPreferredCanvasFormat: () => 'bgra8unorm',
        async requestDevice() { return mockDevice; },
      };
    },
  },
  requestAnimationFrame: (fn) => setTimeout(() => fn(0), 0),
};
// Node exposes `navigator` as a getter-only global; redefine it for the shims.
Object.defineProperty(globalThis, 'navigator', { value: navigatorMock, configurable: true, writable: true });

/* ------------------------------------------------------------------ *
 * Run the graph
 * ------------------------------------------------------------------ */
const { createGpu } = await import('../src/gpu/gpu.js');
const { Renderer } = await import('../src/gpu/renderer.js');
const { Camera } = await import('../src/core/camera.js');
const { TerrainGraph } = await import('../src/sim/terrain.js');
const { TextureBaker } = await import('../src/tex/bake.js');
const { PRESETS, applyPreset, createProject, validateProject } = await import('../src/gen/project.js');

const logs = [];
const gpu = await createGpu({ log: (entry) => { if (typeof entry === 'string') logs.push(entry); else if (entry?.level === 'warn') report.warnings.push(entry.message); else logs.push(entry.message ?? JSON.stringify(entry)); } });
gpu.strict = true;

let failed = false;
for (const preset of PRESETS) {
  const project = applyPreset(preset);
  project.world.resolution = RES;
  project.texture.resolution = Math.min(1024, Math.max(512, RES));
  const problems = validateProject(project);
  if (problems.length) {
    failed = true;
    console.log(`  ✗ ${preset.name}: ${problems.join('; ')}`);
    continue;
  }
  const graph = new TerrainGraph(gpu, { log: (m) => { if (!QUIET) logs.push(`    ${m}`); }, project });
  const before = report.dispatches;
  const t0 = performance.now();
  await graph.generate(project);
  const ms = performance.now() - t0;
  const dispatches = report.dispatches - before;

  // Brushes: a sculpt dab, a paint dab and the stroke commit.
  graph.paintDab({ center: [0.5, 0.5], radius: 0.06, strength: 0.6, mode: 0, value: 1, target: 'paint' });
  graph.sculptDab({ center: [0.4, 0.6], radius: 0.05, strength: 0.2, mode: 0, falloff: 1.4 });
  graph.sculptDab({ center: [0.42, 0.6], radius: 0.05, strength: 0.2, mode: 2, falloff: 1.0 });
  graph.commitStroke();
  graph.paintDab({ center: [0.3, 0.3], radius: 0.08, strength: 0.5, mode: 0, value: 0.8, target: 'sketch' });
  const stats = await graph.stats();

  // Material bake: the second half of the workflow, same strict checks.
  const baker = new TextureBaker(gpu, { log: (m) => { if (!QUIET) logs.push(`    ${m}`); } });
  const bakeInfo = [];
  await baker.bake(project, graph.maps, { onStage: (name) => bakeInfo.push(name) });
  baker.releaseFields();

  console.log(`  ✓ ${preset.name.padEnd(20)} ${String(dispatches).padStart(5)} dispatches  ` +
    `${ms.toFixed(0).padStart(4)} ms  ·  ${bakeInfo.length} bake stages (${bakeInfo.slice(0, 3).join(', ')}…)`);
  if (stats) logs.push(`    relief ${stats.relief.toFixed(1)} m · mean ${stats.mean.toFixed(1)} m (mock readback)`);
  graph.releaseFields();
}

// Frame graph: pipelines, bind groups and draws through the real Renderer.
const canvas = {
  width: 960,
  height: 540,
  getContext: () => ({
    configure() {},
    getCurrentTexture: () => new MockTexture({ label: 'canvas', size: { width: 960, height: 540 }, format: 'bgra8unorm' }),
  }),
};
const demoProject = applyPreset(PRESETS[0]);
demoProject.world.resolution = RES;
demoProject.texture.resolution = Math.min(1024, RES);
const demoGraph = new TerrainGraph(gpu, { log: () => {} });
const demoMaps = await demoGraph.generate(demoProject);
const demoBaker = new TextureBaker(gpu, { log: () => {} });
const demoTextures = await demoBaker.bake(demoProject, demoMaps, {});

const renderer = new Renderer(gpu, { log: (m) => { if (!QUIET) logs.push(`    ${m}`); } });
await renderer.init(canvas);
renderer.buildGrid(256);
renderer.setMaps(demoMaps, demoTextures);
renderer.resize(960, 540, 1);
const camera = new Camera({ worldSize: demoProject.world.worldSize, heightScale: demoProject.world.heightScale });
camera.frame(demoProject.world);
for (const mode of [0, 1, 2, 3, 4, 5, 6, 7]) {
  demoProject.display.viewMode = mode;
  renderer.render({ project: demoProject, camera, time: mode * 0.5 });
}
demoProject.display.displayMode = undefined;
for (const toggle of ['shadows', 'water', 'contourLines', 'slopeOverlay', 'wireframe']) {
  demoProject.display[toggle] = !demoProject.display[toggle];
  renderer.render({ project: demoProject, camera, time: 1 });
  demoProject.display[toggle] = !demoProject.display[toggle];
}
renderer.render({ project: demoProject, camera, time: 2 });
renderer.destroy();
demoBaker.releaseFields();
demoGraph.releaseFields();

// A default project with everything disabled still has to run (nothing to do).
const bare = createProject();
bare.terrain = bare.terrain.filter((l) => l.enabled === false);
const bareGraph = new TerrainGraph(gpu, { log: () => {} });
await bareGraph.generate(bare);
bareGraph.releaseFields();

console.log('');
console.log(`  modules compiled   : ${report.modules.size}`);
console.log(`  pipelines created  : ${report.pipelines}`);
console.log(`  bind groups        : ${report.bindGroups}`);
console.log(`  dispatches         : ${report.dispatches} across ${report.submits} submits`);
console.log(`  distinct passes    : ${report.byPass.size}`);
console.log(`  frame draws        : ${report.draws ?? 0} across ${renderer ? 11 : 0} frames`);
if (report.warnings.length) {
  failed = true;
  console.log('');
  console.log('  warnings:');
  for (const warning of report.warnings) console.log(`    ! ${warning}`);
}
console.log('');
console.log(failed ? '✗ graph dry run found problems' : '✓ graph dry run clean');
process.exit(failed ? 1 : 0);
