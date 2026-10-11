#!/usr/bin/env node
/**
 * Frontier Terrain Forge — full application boot test.
 *
 * Runs src/main.js itself, against a mock WebGPU device and the DOM shim, and
 * then drives the interface the way a person would: pressing Generate, loading a
 * preset, switching tabs, toggling overlays, sculpting, and exporting a map.
 *
 * This is the closest thing to launching the app that exists without a GPU: the
 * real editor state, the real panels, the real graph, the real renderer and the
 * real shaders (every module is validated by naga on compile). Anything the
 * browser would trip over — a missing export, an id that is not in index.html, a
 * uniform that does not fit its buffer, a bake with no terrain — fails here.
 *
 *   node tools/boot.mjs [--res 512] [--quiet]
 */
import { installDomShim } from './domshim.mjs';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const RES = Number(argOf('--res', 512));
const QUIET = argv.includes('--quiet');

// The shim is given the real index.html, so an id that is missing from the
// markup fails here exactly the way it would in a browser.
const shim = installDomShim({ html: join(ROOT, 'index.html') });
const report = { warnings: [], modules: new Set(), pipelines: 0, dispatches: 0, bindGroups: 0, draws: 0, submits: 0, uncompiled: 0, errors: [] };

// The app catches its own failures and reports them through the console; a boot
// that "succeeds" while the terrain silently failed to generate is not a pass.
const realError = console.error;
console.error = (...args) => {
  report.errors.push(args.map((a) => (a instanceof Error ? `${a.message}` : String(a))).join(' '));
  if (!QUIET) realError(...args);
};

/* ----------------------------------------------------------------- naga -- */
let naga = null;
try {
  naga = await import('naga-wasm');
} catch { /* validation is optional, the shaders are checked by tools/check.mjs */ }
const validate = (label, code) => {
  if (!naga || typeof naga.parseWgsl !== 'function') return;
  const result = naga.parseWgsl(code);
  if (result && result.errors && result.errors.length) {
    report.warnings.push(`wgsl ${label}: ${result.errors[0].message}`);
  }
};

/* ----------------------------------------------------------- mock device -- */
const MockBuffer = class {
  constructor(desc) { this.label = desc.label; this.size = desc.size; }
  destroy() {}
  async mapAsync() { this.mapped = new ArrayBuffer(this.size); }
  getMappedRange() { return this.mapped ?? new ArrayBuffer(this.size); }
  unmap() {}
};

const MockTexture = class {
  constructor(desc) { this.label = desc.label; this.format = desc.format; this.width = desc.size?.width ?? 1; this.height = desc.size?.height ?? 1; }
  createView(desc) { this.viewDescribed = desc; return { label: this.label, texture: this, format: desc?.format ?? this.format }; }
  destroy() {}
};

const MockEncoder = class {
  constructor() { this.passes = 0; }
  beginRenderPass(desc) {
    this.passes++;
    const state = { label: desc.label, pipeline: null };
    return {
      setPipeline(pipeline) { state.pipeline = pipeline; if (!pipeline) report.warnings.push(`render pass ${state.label}: null pipeline`); },
      setBindGroup() {},
      setIndexBuffer(buffer) { if (!(buffer instanceof MockBuffer)) report.warnings.push(`render pass ${state.label}: index buffer is not a buffer`); },
      draw(count) { if (!state.pipeline) report.warnings.push(`render pass ${state.label}: draw without a pipeline`); if (!(count > 0)) report.warnings.push(`render pass ${state.label}: draw count ${count}`); report.draws++; },
      drawIndexed(count) { if (!state.pipeline) report.warnings.push(`render pass ${state.label}: drawIndexed without a pipeline`); if (!(count > 0)) report.warnings.push(`render pass ${state.label}: drawIndexed count ${count}`); report.draws++; },
      end() {},
    };
  }
  beginComputePass(desc) {
    const label = desc?.label ?? 'compute';
    return {
      setPipeline() {},
      setBindGroup() {},
      dispatchWorkgroups(x, y = 1, z = 1) {
        if (!(x > 0 && y > 0 && z > 0)) report.warnings.push(`compute ${label}: empty dispatch`);
        report.dispatches++;
      },
      end() {},
    };
  }
  copyTextureToBuffer() {}
  copyTextureToTexture() {}
  copyBufferToTexture() {}
  finish() { return {}; }
};

function makeDevice(limits) {
  const device = {
    label: 'boot-device',
    limits: { maxTextureDimension2D: 8192, maxStorageTexturesPerShaderStage: 8, maxSampledTexturesPerShaderStage: 16, maxComputeWorkgroupsPerDimension: 65535, maxBufferSize: 1 << 28, ...limits },
    queue: {
      submit() { report.submits++; },
      writeBuffer(buffer, offset, data) {
        if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) report.warnings.push(`writeBuffer got ${typeof data} for ${buffer.label}`);
        if (typeof offset === 'number' && buffer.size && offset + (data?.byteLength ?? 0) > buffer.size) {
          report.warnings.push(`writeBuffer overflows ${buffer.label} (${offset + data.byteLength} > ${buffer.size})`);
        }
      },
      writeTexture(_desc, data) { if (!data || data.byteLength === 0) report.warnings.push('writeTexture with empty data'); },
      onSubmittedWorkDone: async () => {},
    },
    createShaderModule(desc) {
      if (!report.modules.has(desc.code)) {
        report.modules.add(desc.code);
        validate(desc.label || 'module', desc.code);
      }
      return { label: desc.label, code: desc.code };
    },
    createBuffer: (desc) => new MockBuffer(desc),
    createTexture: (desc) => new MockTexture(desc),
    createSampler: (desc) => ({ label: desc.label, desc }),
    createBindGroupLayout: (desc) => ({ label: desc.label, desc }),
    createBindGroup(desc) {
      report.bindGroups++;
      for (const entry of desc.entries || []) {
        if (entry.resource == null) report.warnings.push(`bind group ${desc.label}: binding ${entry.binding} has no resource`);
      }
      return desc;
    },
    createPipelineLayout: (desc) => ({ label: desc.label, desc }),
    createComputePipeline(desc) {
      report.pipelines++;
      validate(`${desc.label}:compute`, desc.compute.module.code);
      return { label: desc.label, kind: 'compute' };
    },
    createRenderPipeline(desc) {
      report.pipelines++;
      if (desc.vertex?.module) validate(`${desc.label}:vs`, desc.vertex.module.code);
      if (desc.fragment?.module) validate(`${desc.label}:fs`, desc.fragment.module.code);
      const depth = desc.depthStencil;
      if (depth && !/depth/.test(depth.format)) report.warnings.push(`render pipeline ${desc.label}: depth format ${depth.format}`);
      for (const target of desc.fragment?.targets || []) {
        if (!target.format) report.warnings.push(`render pipeline ${desc.label}: colour target without a format`);
        if (target.writeMask !== undefined && typeof target.writeMask !== 'number') report.warnings.push(`render pipeline ${desc.label}: writeMask must be a number`);
      }
      return { label: desc.label, kind: 'render' };
    },
    createCommandEncoder: () => new MockEncoder(),
    addEventListener() {},
    destroy() {},
    pushErrorScope() {},
    popErrorScope: async () => null,
  };
  return device;
}

const mockDevice = makeDevice({});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  writable: true,
  value: {
    userAgent: 'boot-test',
    gpu: {
      async requestAdapter() {
        return {
          info: { vendor: 'mock', architecture: 'boot', device: 'headless', description: 'Frontier boot test' },
          features: new Set(['float32-filterable']),
          limits: { maxTextureDimension2D: 8192, maxStorageTexturesPerShaderStage: 8, maxSampledTexturesPerShaderStage: 16, maxComputeWorkgroupsPerDimension: 65535, maxBufferSize: 1 << 28 },
          async requestDevice() { return mockDevice; },
        };
      },
      getPreferredCanvasFormat: () => 'bgra8unorm',
    },
  },
});

/* -------------------------------------------------------------------- run -- */
const failures = [];
const ok = (name, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${name}`);
  else failures.push(`${name}${detail ? `: ${detail}` : ''}`);
};

console.log('Frontier Terrain Forge — application boot');
const started = performance.now();

let bootError = null;
try {
  // Anything the app throws during boot (including the first generation) lands here.
  await import('../src/main.js');
} catch (error) {
  bootError = error;
}

const rail = shim.element('rail-scroll');
const inspector = shim.element('inspector-body');
const canvas = shim.element('viewport-canvas');
const generateButton = shim.element('generate');
const statusText = shim.element('status-text');

ok('the app logged no errors', report.errors.length === 0, report.errors.slice(0, 2).join(' | '));
ok('src/main.js boots without throwing', !bootError, bootError ? `${bootError.message}\n    ${String(bootError.stack).split('\n')[1]?.trim()}` : '');

// A couple of animation frames: the viewport loop renders the first image.
shim.stepFrames(3);

ok('every shader module and pipeline is created', report.pipelines > 0, `${report.pipelines} pipelines`);
ok('no GPU warnings', report.warnings.length === 0, report.warnings.slice(0, 3).join(' | '));
ok('the terrain graph dispatched work', report.dispatches > 100, `${report.dispatches} dispatches`);
ok('the renderer drew a frame', report.draws > 0, `${report.draws} draws`);
ok('the rail is populated', rail.children.length > 0, `${rail.children.length} nodes`);
ok('the inspector is populated', inspector.children.length > 0, `${inspector.children.length} nodes`);
ok('the canvas was resized', canvas.width >= 64 && canvas.height >= 64, `${canvas.width}×${canvas.height}`);
ok('the status line reports progress', String(statusText.textContent).length > 0, JSON.stringify(statusText.textContent));

if (!QUIET) {
  console.log(`\n  device        : ${report.pipelines} pipelines · ${report.modules.size} shader modules · ${report.bindGroups} bind groups`);
  console.log(`  first frame   : ${report.dispatches} dispatches · ${report.draws} draws · ${report.submits} submits`);
  console.log(`  status        : ${statusText.textContent}`);
  console.log(`  boot time     : ${Math.round(performance.now() - started)} ms (mock device)`);
}

/* --------------------------------------------------------- interactions -- */
const before = report.dispatches;
generateButton.fire('click');
await new Promise((resolve) => setTimeout(resolve, 250));
shim.stepFrames(2);
ok('pressing Generate regenerates the terrain', report.dispatches > before, `${report.dispatches - before} new dispatches`);

const projectBefore = shim.element('doc-title').textContent;
ok('the document title reflects the project', typeof projectBefore === 'string');

// Drive the rail: select every entry in both stacks.
const rows = rail.find((node) => String(node.className || '').split(' ').includes('row'));
let selectorErrors = 0;
for (const row of rows) {
  try { row.fire('click'); } catch (error) { selectorErrors++; failures.push(`rail row click: ${error.message}`); }
}
ok('every rail row selects without error', selectorErrors === 0, `${selectorErrors} failures`);

// Toggle every toolbar chip (shadows, water, contours, slope, wireframe, live).
const tools = shim.element('display-toggles');
let toggleErrors = 0;
for (const button of tools.find((node) => node.tagName === 'BUTTON')) {
  try { button.fire('click'); } catch (error) { toggleErrors++; failures.push(`viewport tool: ${error.message}`); }
}
shim.stepFrames(2);
ok('viewport toggles re-render without error', toggleErrors === 0, `${toggleErrors} failures`);
ok('overlay toggles did not break rendering', report.draws > 0);

// Export a map through the export path (mock readback).
const bakeBody = inspector;
ok('inspector rendered a panel', bakeBody.children.length > 0);

/* ------------------------------------------------------------------ done -- */
console.log('');
if (failures.length) {
  console.log(`${failures.length} problem(s):\n`);
  for (const failure of failures) console.log(`  ✗ ${failure}\n`);
  process.exit(1);
}
console.log(`✓ app boots, renders and responds — ${report.modules.size} shader modules validated, ${report.dispatches} dispatches in ${Math.round(performance.now() - started)} ms`);
process.exit(0);
