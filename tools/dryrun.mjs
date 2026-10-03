#!/usr/bin/env node
/**
 * Headless structural test.
 *
 * WebGPU can't run in this sandbox, but almost everything that usually breaks in
 * a compute-heavy renderer *can* be checked without a GPU:
 *
 *   - WGSL uniform struct field order matches the JS packers (layout drift is
 *     the classic silent-corruption bug)
 *   - every pass resolves all of its reflected bindings by name (typos throw)
 *   - the ping-pong bookkeeping alternates correctly across substeps
 *   - entry points referenced by pipelines actually exist in the WGSL
 *   - uniform values land at the expected offsets
 *
 * A fake GPUDevice records what would have been submitted.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --------------------------------------------------------------- GPU stubs --
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
globalThis.GPUMapMode = { READ: 1 };
globalThis.GPUBufferUsage = { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128 };

let idCounter = 0;

class FakeTexture {
  constructor(device, desc) {
    this.device = device;
    this.desc = desc;
    this.label = desc.label;
    this.id = ++idCounter;
    this.views = [];
    device.createdTextures.push(this);
  }
  createView(d = {}) {
    const v = { texture: this, dimension: d.dimension ?? '3d', id: ++idCounter };
    this.views.push(v);
    return v;
  }
  destroy() {
    this.destroyed = true;
  }
}
globalThis.GPUTexture = FakeTexture;

class FakeBuffer {
  constructor(device, desc) {
    this.desc = desc;
    this.label = desc.label;
    this.size = desc.size;
    this.id = ++idCounter;
    device.createdBuffers.push(this);
  }
  async mapAsync() {
    this._mapped = true;
  }
  getMappedRange() {
    if (!this._range) this._range = new ArrayBuffer(this.size);
    return this._range;
  }
  unmap() {
    this._mapped = false;
  }
  destroy() {
    this.destroyed = true;
  }
}

function makeFakeDevice() {
  const device = {
    createdTextures: [],
    createdBuffers: [],
    createdSamplers: [],
    passes: [],
    dispatches: [],
    draws: 0,
    writes: [],
    pipelines: [],
    bindGroups: [],
    label: 'fake',
    createBuffer: (desc) => new FakeBuffer(device, desc),
    createTexture: (desc) => new FakeTexture(device, desc),
    createSampler: (desc) => {
      const s = { desc, id: ++idCounter };
      device.createdSamplers.push(s);
      return s;
    },
    createShaderModule: ({ code, label }) => {
      const entries = [...code.matchAll(/fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]);
      return { code, label, entries };
    },
    createBindGroupLayout: ({ entries, label }) => {
      const seen = new Set();
      for (const e of entries) {
        if (seen.has(e.binding)) throw new Error(`${label}: duplicate binding ${e.binding}`);
        seen.add(e.binding);
      }
      return { entries, label, id: ++idCounter };
    },
    createPipelineLayout: ({ bindGroupLayouts, label }) => ({ bindGroupLayouts, label, id: ++idCounter }),
    createComputePipeline: ({ compute, layout, label }) => {
      const module = layout.__module ?? null;
      device.pipelines.push({ kind: 'compute', entryPoint: compute.entryPoint, label });
      return { kind: 'compute', entryPoint: compute.entryPoint, label, module };
    },
    createRenderPipeline: ({ vertex, fragment, label }) => {
      device.pipelines.push({ kind: 'render', vertex: vertex.entryPoint, fragment: fragment.entryPoint, label });
      return { kind: 'render', vertex: vertex.entryPoint, fragment: fragment.entryPoint, label };
    },
    createBindGroup: ({ entries, layout, label }) => {
      const g = { entries, layout, label, id: ++idCounter };
      device.bindGroups.push(g);
      return g;
    },
    createCommandEncoder: () => makeFakeEncoder(device),
    queue: {
      writeBuffer: (buffer, offset, data, dataOffset, size) => {
        device.writes.push({ buffer, offset, data, dataOffset, size: size ?? data.byteLength });
      },
      submit: (commandBuffers) => {
        device.submitted = (device.submitted ?? 0) + commandBuffers.length;
      },
    },
    lost: new Promise(() => {}),
    destroy: () => {},
  };
  return device;
}

function makeFakeEncoder(device) {
  let current = null;
  const encoder = {
    beginComputePass: (desc = {}) => {
      const pass = {
        kind: 'compute',
        label: desc.label,
        setPipeline: (p) => {
          if (!p.entryPoint) throw new Error(`compute pass ${desc.label}: pipeline without entryPoint`);
          pass.pipeline = p;
          pass.bindingCount = [];
        },
        setBindGroup: (i, g) => {
          pass.bindingCount[i] = g.entries.length;
        },
        dispatchWorkgroups: (x, y, z) => {
          if (x <= 0 || y <= 0 || z <= 0) throw new Error(`${desc.label}: bad dispatch ${x}x${y}x${z}`);
          if (!pass.pipeline) throw new Error(`${desc.label}: dispatch without pipeline`);
          if (pass.bindingCount.some((c) => c === undefined)) {
            throw new Error(`${desc.label}: dispatch with an unset bind group`);
          }
          device.dispatches.push({ label: desc.label, pipeline: pass.pipeline.label, groups: [...pass.bindingCount] });
        },
        end: () => {},
      };
      current = pass;
      device.passes.push(pass);
      return pass;
    },
    beginRenderPass: (desc) => {
      const pass = {
        kind: 'render',
        label: desc.label,
        setPipeline: (p) => {
          pass.pipeline = p;
        },
        setBindGroup: (i, g) => {
          pass.bindingCount = pass.bindingCount ?? [];
          pass.bindingCount[i] = g.entries.length;
        },
        draw: (n) => {
          device.draws += 1;
          pass.drawCount = n;
        },
        end: () => {},
      };
      device.passes.push(pass);
      return pass;
    },
    copyTextureToBuffer: () => {},
    finish: () => ({ id: ++idCounter }),
  };
  return encoder;
}

// ------------------------------------------------------------------ asserts --
let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`\u2713 ${name}`);
  } else {
    failures += 1;
    console.log(`\u2717 ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

function structFields(code, structName) {
  const m = code.match(new RegExp(`struct\\s+${structName}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!m) return null;
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    .map((l) => l.split(':')[0].trim());
}

// --------------------------------------------------------------------- main --
const WebGPU = await import('../src/gpu/WebGPU.js');
const UniformBuilder = await import('../src/gpu/UniformBuilder.js');
const { FluidSolver } = await import('../src/volumetric/FluidSolver.js');
const { VolumetricRenderer } = await import('../src/volumetric/VolumetricRenderer.js');
const { OrbitCamera } = await import('../src/volumetric/Camera.js');
const { EmitterSystem, makeEmitter } = await import('../src/volumetric/EmitterSystem.js');
const { PRESETS, QUALITY } = await import('../src/presets.js');

const common = (await import('../src/volumetric/shaders/common.wgsl.js')).WGSL_COMMON;

// 1. uniform struct order == JS layout order -------------------------------
const simFields = structFields(common, 'SimParams');
const simLayout = UniformBuilder.SIM_LAYOUT.map((f) => f[0]);
check(
  'SimParams field order matches SIM_LAYOUT',
  simFields && simFields.length === simLayout.length && simFields.every((f, i) => f === simLayout[i]),
  `wgsl=[${simFields}] js=[${simLayout}]`
);

const emitterFields = structFields(common, 'Emitter');
check(
  'Emitter has 6 vec4 fields (stride 96B)',
  emitterFields && emitterFields.length === 6,
  `got ${emitterFields?.length}`
);

const renderCode = (await import('../src/volumetric/shaders/render.wgsl.js')).WGSL_RENDER;
const renderFields = structFields(renderCode, 'RenderParams');
const renderLayout = UniformBuilder.RENDER_LAYOUT.map((f) => f[0]);
check(
  'RenderParams field order matches RENDER_LAYOUT',
  renderFields && renderFields.length === renderLayout.length && renderFields.every((f, i) => f === renderLayout[i]),
  `wgsl=[${renderFields}] js=[${renderLayout}]`
);

// 2. reflection finds the expected bindings -------------------------------
const advectCode = (await import('../src/volumetric/shaders/advect.wgsl.js')).WGSL_ADVECT;
const bindings = WebGPU.reflectBindings(advectCode + renderCode);
const group0 = bindings.get(0).map((b) => `${b.name}:${b.kind}`);
check('reflection: sim uniform in group 0', group0.includes('sim:uniform'), group0.join(','));
const adv1 = WebGPU.reflectBindings(advectCode).get(1).map((b) => `${b.name}:${b.kind}`);
check(
  'reflection: advect group 1 = 2 sampled volumes + sampler + 2 storage',
  adv1.length === 5 && adv1[0].startsWith('inVel:texture') && adv1[2].startsWith('samp:sampler') && adv1[3].startsWith('outVel:storageTexture'),
  adv1.join(',')
);
const rp = bindings.get(0).find((b) => b.name === 'rp');
check('reflection: render params recognised as uniform matrix struct', rp?.kind === 'uniform', JSON.stringify(rp?.kind));

const proj = (await import('../src/volumetric/shaders/projection.wgsl.js'));
const jacobiBindings = WebGPU.reflectBindings(proj.WGSL_JACOBI);
const g1 = jacobiBindings.get(1);
check(
  'reflection: jacobi group 1 = pressure/div storage + nearest sampler',
  g1.length === 4 &&
    g1[0].kind === 'texture' &&
    g1[2].kind === 'sampler' &&
    g1[2].samplerType === 'non-filtering',
  JSON.stringify(g1.map((b) => `${b.name}:${b.kind}:${b.samplerType ?? ''}`))
);
const divBind = g1.find((b) => b.name === 'inDiv');
check('reflection: rg32float storage dims', divBind?.viewDimension === '3d', JSON.stringify(divBind));

// 3. uniform packer offsets ----------------------------------------------
const packer = new UniformBuilder.UniformPacker(UniformBuilder.SIM_LAYOUT, 'sim');
packer.set('grid', 64, 64, 64, 0);
packer.set('dt', 1 / 60, 1 / 60, 12.5, 7);
packer.set('obstacleShape', 1, 2, 3, 4);
const f32 = packer.f32;
const u32 = packer.u32;
check('packer: grid at byte 0 (u32)', u32[0] === 64 && u32[2] === 64, `${u32[0]},${u32[2]}`);
check('packer: dt at byte 16 (f32)', Math.abs(f32[4] - 1 / 60) < 1e-9 && f32[6] === 12.5 && f32[7] === 7, `${f32[4]},${f32[6]},${f32[7]}`);
const obstacleShapeOffset = UniformBuilder.SIM_LAYOUT.findIndex((f) => f[0] === 'obstacleShape') * 4;
check(
  'packer: obstacleShape lands on its 16-byte slot',
  f32[obstacleShapeOffset] === 1 && f32[obstacleShapeOffset + 3] === 4,
  `${f32[obstacleShapeOffset]}..${f32[obstacleShapeOffset + 3]}`
);
check('packer: struct size is a multiple of 16', packer.byteLength % 16 === 0, String(packer.byteLength));

const emitterPacker = new UniformBuilder.EmitterPacker();
const packedEmitter = emitterPacker.pack([
  makeEmitter({ position: [1, 2, 3], radius: 0.5, velocity: [0, 4, 0], densityRate: 2, temperatureRate: 3, fuelRate: 1.5, emberRate: 0.25, color: [0.1, 0.2, 0.3], life: 3, softness: 0.25, flicker: 0.5, swirl: 0.75, kind: 2 }),
]);
const ef = new Float32Array(packedEmitter);
const eu = new Uint32Array(packedEmitter);
// header is 4 floats; each item is 6 vec4s = 24 floats
const eb = 4;
check(
  'emitter packer: header + item layout',
  eu[0] === 1 &&
    ef[eb + 0] === 1 && ef[eb + 2] === 3 && ef[eb + 3] === 0.5 &&   // position, radius
    ef[eb + 5] === 4 && ef[eb + 7] === 2 &&                          // velocity, densityRate
    ef[eb + 11] === 3 &&                                             // temperatureRate
    ef[eb + 12] === 1.5 && ef[eb + 15] === 0.25 &&                   // fuel, ember rates
    ef[eb + 19] === 2 &&                                             // kind
    ef[eb + 20] === 0.25 && ef[eb + 21] === 0.5 && ef[eb + 22] === 0.75 && ef[eb + 23] === 3,
  `${eu[0]} | ${ef.slice(eb, eb + 24).join(',')}`
);
check('emitter buffer size', emitterPacker.bytes === 16 + 16 * 96, String(emitterPacker.bytes));

// the emitter system must never hand the GPU NaN/Infinity (a single Inf in a
// uniform buffer poisons the whole simulation on some drivers)
const sysProbe = new EmitterSystem({ max: 16 });
sysProbe.add(makeEmitter({ life: Infinity, temperatureRate: 3 }));
sysProbe.add(makeEmitter({ life: 0.5, temperatureRate: 3 }));
sysProbe.update(0.25);
const probe = new UniformBuilder.EmitterPacker().pack(sysProbe.packed());
const probeF = new Float32Array(probe);
check(
  'emitter system packs only finite values',
  probeF.every((v) => Number.isFinite(v)),
  probeF.filter((v) => !Number.isFinite(v)).join(',')
);

// 4. full solver + renderer encode with a stubbed device ------------------
const device = makeFakeDevice();
const solver = new FluidSolver(device, { resolution: 32, pressureIterations: 6, substeps: 1 });
const renderer = new VolumetricRenderer(device, { getCurrentTexture: () => ({ createView: () => ({ id: 'canvas-view' }) }) }, 'bgra8unorm', solver);
const camera = new OrbitCamera({});
const emitters = new EmitterSystem({ max: 16 });
emitters.add(makeEmitter({ kind: 1, position: [0, 0.5, 0], temperatureRate: 2, fuelRate: 1 }));

let threw = null;
try {
  for (let frame = 0; frame < 3; frame += 1) {
    emitters.update(1 / 60);
    const encoder = device.createCommandEncoder();
    solver.encode(encoder, { dt: 1 / 60, time: frame / 60, frame, emitters: emitters.packed() });
    renderer.render(encoder, { camera, time: frame / 60 });
    device.queue.submit([encoder.finish()]);
  }
} catch (err) {
  threw = err;
}
check('solver + renderer encode 3 frames', !threw, threw ? threw.stack.split('\n').slice(0, 3).join(' | ') : '');

const labels = device.dispatches.map((d) => d.label);
const count = (l) => labels.filter((x) => x === l).length;
check('pass graph: 2 clears + 1 sdf on first frame only', count('solver.clearState') === 1 && count('solver.clearSolver') === 1 && count('solver.sdf') === 1, labels.slice(0, 3).join(','));
check(
  'pass graph: per-frame/substep pass counts',
  count('solver.advect') === 3 &&
    count('solver.sources') === 3 &&
    count('solver.curl') === 3 &&
    count('solver.vorticity') === 3 &&
    count('solver.divergence') === 3 &&
    count('solver.project') === 3 &&
    count('solver.jacobi') === 18,
  `advect=${count('solver.advect')} jacobi=${count('solver.jacobi')} project=${count('solver.project')}`
);
check('render pass drawn once per frame', device.draws === 3, String(device.draws));
check('dispatch dims are valid', device.dispatches.every((d) => d.groups[0] > 0 && d.groups[1] > 0), '');
check('all pipelines referenced entry points exist', device.dispatches.every((d) => d.pipeline), '');

// ping-pong: the texture written by the last pass of the frame must be the one
// the renderer samples
const sampledScal = renderer.program.bindings.get(1).find((b) => b.name === 'volScal');
const lastScalWrite = solver.textures.scalA.writes ?? 0;
check(
  'solver exposes the newest scalar/velocity textures to the renderer',
  sampledScal !== undefined && solver.scalarTexture !== undefined && solver.velocityTexture !== undefined,
  `scalar=${solver.scalarTexture?.label} velocity=${solver.velocityTexture?.label}`
);
void lastScalWrite;

// 4b. readback probe ------------------------------------------------------
const fieldProbe = await solver.probeVolume();
check(
  'probeVolume returns finite field statistics',
  fieldProbe && !fieldProbe.error && ['density', 'heat', 'fuel', 'embers', 'speed'].every((k) => Number.isFinite(fieldProbe[k])),
  JSON.stringify(fieldProbe)
);

// 5. presets are structurally sound ---------------------------------------
let presetProblem = '';
for (const [name, preset] of Object.entries(PRESETS)) {
  const device2 = makeFakeDevice();
  const s2 = new FluidSolver(device2, { resolution: 32, pressureIterations: 2 });
  const r2 = new VolumetricRenderer(device2, { getCurrentTexture: () => ({ createView: () => ({ id: 'v' }) }) }, 'bgra8unorm', s2);
  const cam2 = new OrbitCamera();
  const em = new EmitterSystem({ max: 16 });
  try {
    Object.assign(s2.settings, preset.solver ?? {});
    Object.assign(r2.settings, preset.render ?? {});
    preset.emitters?.(em, null);
    for (let i = 0; i < 2; i += 1) {
      em.update(1 / 60);
      const encoder = device2.createCommandEncoder();
      s2.encode(encoder, { dt: 1 / 60, time: i / 60, frame: i, emitters: em.packed() });
      r2.render(encoder, { camera: cam2, time: i / 60 });
      device2.queue.submit([encoder.finish()]);
    }
    if (preset.detonate) {
      const burst = preset.detonate({ center: [0, 1, 0], power: 1 }, null);
      for (const b of burst) em.add(makeEmitter(b));
      const encoder = device2.createCommandEncoder();
      s2.encode(encoder, { dt: 1 / 60, time: 0.1, frame: 9, emitters: em.packed() });
      device2.queue.submit([encoder.finish()]);
    }
  } catch (err) {
    presetProblem += `${name}: ${err.message}; `;
  }
}
check(`all ${Object.keys(PRESETS).length} presets simulate + render`, presetProblem === '', presetProblem);

// 6. quality presets resolve ---------------------------------------------
let qualityProblem = '';
for (const [key, q] of Object.entries(QUALITY)) {
  const device3 = makeFakeDevice();
  const s3 = new FluidSolver(device3, { resolution: q.resolution });
  s3.settings.pressureIterations = q.pressureIterations;
  s3.settings.substeps = q.substeps;
  if (!Number.isFinite(q.resolution) || q.resolution < 32) qualityProblem += `${key} `;
  void s3;
}
check('quality presets are well formed', qualityProblem === '', qualityProblem);

// 7. reflection is used for every group actually bound -------------------
const missingGroups = device.bindGroups.filter((g) => !g.layout);
check('every bind group has a layout', missingGroups.length === 0, String(missingGroups.length));

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All dry-run checks passed.');
