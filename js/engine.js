/* ═══════════════════════════════════════════════════════════════
   Terrain Forge — WebGPU engine
   • heightfield layer-stack evaluation (compute, ping-pong r32float)
   • virtual-pipe hydraulic erosion + thermal slumping
   • horizon AO bake, texture splat bake
   • render: analytic sky, PBR terrain w/ shadows, water, composite
   ═══════════════════════════════════════════════════════════════ */
import {
  LAYER_EVAL, EROSION_FLUX, EROSION_UPDATE, EROSION_HARDNESS, EROSION_THERMAL,
  EROSION_FLOW, COPY_TEX, CLEAR_TEX, CLEAR_RGBA_TEX, CLEAR_R8_TEX, AO_BAKE, SPLAT_BAKE,
} from './wgsl.js';
import {
  ATMO_LIB, SKY_SHADER, TERRAIN_VERT, TERRAIN_FRAG, WATER_VERT, WATER_FRAG, COMPOSITE_SHADER,
} from './render-wgsl.js';
import { terrainType } from './state.js';
import { clamp, lerp, hexToLinear } from './util.js';

/* ── tiny matrix library (column-major, WebGPU layout) ── */
const M4 = {
  identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far * nf, -1, 0, 0, far * near * nf, 0]);
  },
  ortho(l, r, b, t, n, f) {
    // WebGPU depth range [0,1]
    const lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
    return new Float32Array([-2 * lr, 0, 0, 0, 0, -2 * bt, 0, 0, 0, 0, nf, 0, (l + r) * lr, (t + b) * bt, n * nf, 1]);
  },
  lookAt(eye, center, up) {
    let z = [eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]];
    let zl = Math.hypot(...z) || 1; z = z.map(v => v / zl);
    let x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
    let xl = Math.hypot(...x);
    if (xl < 1e-6) { x = [1, 0, 0]; } else { x = x.map(v => v / xl); }
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return new Float32Array([
      x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
      -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
      -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1,
    ]);
  },
  multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  invert(m) {
    const inv = new Float32Array(16);
    inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
    inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
    inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
    inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
    inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
    inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
    inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
    inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
    inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
    inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
    inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
    inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
    inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
    inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
    inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
    inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
    let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
    if (!det) return M4.identity();
    det = 1.0 / det;
    for (let i = 0; i < 16; i++) inv[i] *= det;
    return inv;
  },
};

/* ── CPU atmosphere evaluation (mirrors the WGSL model) ── */
const ATMO_Rg = 6360e3, ATMO_Ra = 6420e3, ATMO_Hr = 7994.0, ATMO_Hm = 1200.0;
const BETA_R = [5.802e-6, 13.558e-6, 33.1e-6], BETA_M0 = 21e-6;
function raySphereJS(o, d, r) {
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
  const c = (o[0] ** 2 + o[1] ** 2 + o[2] ** 2) - r * r;
  const disc = b * b - c;
  if (disc < 0) return [-1, -1];
  const s = Math.sqrt(disc);
  return [-b - s, -b + s];
}
function evalAtmosphere(o, d, sunDir, sunIntensity, mieAmount, pSteps = 8, lSteps = 3) {
  const tAtm = raySphereJS(o, d, ATMO_Ra);
  if (tAtm[1] < 0) return [0, 0, 0];
  let tMax = tAtm[1];
  const tGnd = raySphereJS(o, d, ATMO_Rg);
  if (tGnd[0] > 0) tMax = tGnd[0];
  let t = Math.max(tAtm[0], 0);
  if (t >= tMax) return [0, 0, 0];
  const stepSize = (tMax - t) / pSteps;
  const mu = d[0] * sunDir[0] + d[1] * sunDir[1] + d[2] * sunDir[2];
  const pr = 3 / (16 * Math.PI) * (1 + mu * mu);
  const g = 0.76, g2 = g * g;
  const pm = 3 / (8 * Math.PI) * ((1 - g2) * (1 + mu * mu)) / Math.pow(Math.max(1 + g2 - 2 * g * mu, 1e-4), 1.5);
  let sumR = [0, 0, 0], sumM = [0, 0, 0];
  for (let i = 0; i < pSteps; i++) {
    const p = [o[0] + d[0] * (t + (i + 0.5) * stepSize), o[1] + d[1] * (t + (i + 0.5) * stepSize), o[2] + d[2] * (t + (i + 0.5) * stepSize)];
    const h = Math.max(Math.hypot(...p) - ATMO_Rg, 0);
    const odRs = Math.exp(-h / ATMO_Hr) * stepSize, odMs = Math.exp(-h / ATMO_Hm) * stepSize;
    const tL = raySphereJS(p, sunDir, ATMO_Ra);
    let lMax = tL[1];
    const tLg = raySphereJS(p, sunDir, ATMO_Rg);
    if (tLg[0] > 0 && tLg[0] < lMax) lMax = tLg[0];
    const lStart = Math.max(tL[0], 0);
    const lStep = Math.max(lMax - lStart, 0) / lSteps;
    let lodR = 0, lodM = 0;
    for (let j = 0; j < lSteps; j++) {
      const lp = [p[0] + sunDir[0] * (lStart + (j + 0.5) * lStep), p[1] + sunDir[1] * (lStart + (j + 0.5) * lStep), p[2] + sunDir[2] * (lStart + (j + 0.5) * lStep)];
      const lh = Math.max(Math.hypot(...lp) - ATMO_Rg, 0);
      lodR += Math.exp(-lh / ATMO_Hr) * lStep;
      lodM += Math.exp(-lh / ATMO_Hm) * lStep;
    }
    const atten = [Math.exp(-(BETA_R[0] * lodR + BETA_M0 * mieAmount * lodM)), Math.exp(-(BETA_R[1] * lodR + BETA_M0 * mieAmount * lodM)), Math.exp(-(BETA_R[2] * lodR + BETA_M0 * mieAmount * lodM))];
    for (let c = 0; c < 3; c++) { sumR[c] += odRs * atten[c]; sumM[c] += odMs * atten[c]; }
  }
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) out[c] = sunIntensity * (sumR[c] * BETA_R[c] * pr + sumM[c] * BETA_M0 * mieAmount * pm);
  return out;
}
function kelvinTint(k) {
  const t = clamp((k - 1800) / 8200, 0, 1);
  return [lerp(1.35, 0.82, t), lerp(0.72, 0.94, t), lerp(0.36, 1.18, t)];
}

/* ═══════════════ Engine ═══════════════ */
export async function createEngine(canvas, state) {
  if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter available on this device.');
  const device = await adapter.requestDevice({ label: 'terrain-forge' });
  device.lost.then(info => console.error('WebGPU device lost:', info.message));
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  const engine = {
    device, canvas, context, format, state,
    res: 0, meshN: 0,
    ready: false,
    onStats: null,
    busy: false,
  };

  /* ── samplers ── */
  const linearSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const comparisonSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', compare: 'less' });

  /* ── shader modules ── */
  const module = (code, label) => device.createShaderModule({ code, label });
  const modLayerEval = module(LAYER_EVAL, 'layer-eval');
  const modFlux = module(EROSION_FLUX, 'flux');
  const modErosion = module(EROSION_UPDATE, 'erosion-update');
  const modHard = module(EROSION_HARDNESS, 'hardness');
  const modThermal = module(EROSION_THERMAL, 'thermal');
  const modFlow = module(EROSION_FLOW, 'flow');
  const modCopy = module(COPY_TEX, 'copy');
  const modClear = module(CLEAR_TEX, 'clear');
  const modClearRGBA = module(CLEAR_RGBA_TEX, 'clear-rgba');
  const modClearR8 = module(CLEAR_R8_TEX, 'clear-r8');
  const modAO = module(AO_BAKE, 'ao');
  const modSplat = module(SPLAT_BAKE, 'splat');
  const modSky = module(SKY_SHADER, 'sky');
  const modTerrainVert = module(TERRAIN_VERT, 'terrain-vert');
  const modTerrainFrag = module(TERRAIN_FRAG, 'terrain-frag');
  const modWaterVert = module(WATER_VERT, 'water-vert');
  const modWaterFrag = module(WATER_FRAG, 'water-frag');
  const modComposite = module(COMPOSITE_SHADER, 'composite');

  /* ── bind group layouts ── */
  const V = 1, F = 2, VF = 3, C = 4; // GPUShaderStage
  const TEX_U = { visibility: C, texture: { sampleType: 'unfilterable-float' } };
  const TEX_F = { visibility: C, texture: { sampleType: 'float' } };
  const STO_R32 = { visibility: C, storageTexture: { access: 'write-only', format: 'r32float' } };
  const STO_RGBA32 = { visibility: C, storageTexture: { access: 'write-only', format: 'rgba32float' } };
  const STO_RGBA8 = { visibility: C, storageTexture: { access: 'write-only', format: 'rgba8unorm' } };
  const STO_R8 = { visibility: C, storageTexture: { access: 'write-only', format: 'r8unorm' } };
  const UNI_C = { visibility: C, buffer: { type: 'uniform' } };

  const bglStep = device.createBindGroupLayout({ entries: [
    { binding: 0, ...TEX_U }, { binding: 1, ...STO_R32 }, { binding: 2, ...UNI_C }] });
  const bglCopy = bglStep;
  const bglClear = device.createBindGroupLayout({ entries: [
    { binding: 0, ...STO_R32 }, { binding: 1, ...UNI_C }] });
  const bglClearRGBA = device.createBindGroupLayout({ entries: [
    { binding: 0, ...STO_RGBA32 }, { binding: 1, ...UNI_C }] });
  const bglClearR8 = device.createBindGroupLayout({ entries: [
    { binding: 0, ...STO_R8 }, { binding: 1, ...UNI_C }] });
  const bglFlux = device.createBindGroupLayout({ entries: [
    { binding: 0, ...TEX_U }, { binding: 1, ...TEX_U }, { binding: 2, ...TEX_U },
    { binding: 3, ...STO_RGBA32 }, { binding: 4, ...UNI_C }] });
  const bglErosion = device.createBindGroupLayout({ entries: [
    { binding: 0, ...TEX_U }, { binding: 1, ...TEX_U }, { binding: 2, ...TEX_U }, { binding: 3, ...TEX_U }, { binding: 4, ...TEX_U },
    { binding: 5, ...STO_R32 }, { binding: 6, ...STO_R32 }, { binding: 7, ...STO_R32 }, { binding: 8, ...UNI_C }] });
  const bglHard = device.createBindGroupLayout({ entries: [
    { binding: 0, ...TEX_U }, { binding: 1, ...STO_R32 }, { binding: 2, ...UNI_C }] });
  const bglThermal = bglStep;
  const bglFlow = device.createBindGroupLayout({ entries: [
    { binding: 0, ...TEX_U }, { binding: 1, ...STO_R8 }, { binding: 2, ...UNI_C }] });
  const bglAO = device.createBindGroupLayout({ entries: [
    { binding: 0, ...TEX_U }, { binding: 1, ...STO_R8 }, { binding: 2, ...UNI_C }] });
  const bglSplat = device.createBindGroupLayout({ entries: [
    { binding: 0, ...TEX_U }, { binding: 1, ...TEX_F }, { binding: 2, ...TEX_F },
    { binding: 3, ...STO_RGBA8 }, { binding: 4, ...STO_RGBA8 }, { binding: 5, ...UNI_C }] });

  const bglShadow = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: V, texture: { sampleType: 'unfilterable-float' } },
    { binding: 9, visibility: V, buffer: { type: 'uniform' } }] });
  const bglSky = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: F, buffer: { type: 'uniform' } }] });
  const bglTerrain = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: VF, texture: { sampleType: 'unfilterable-float' } },
    { binding: 1, visibility: F, texture: { sampleType: 'float' } },
    { binding: 2, visibility: F, texture: { sampleType: 'float' } },
    { binding: 3, visibility: F, texture: { sampleType: 'float' } },
    { binding: 4, visibility: F, texture: { sampleType: 'float' } },
    { binding: 5, visibility: F, texture: { sampleType: 'depth' } },
    { binding: 6, visibility: F, sampler: { type: 'comparison' } },
    { binding: 7, visibility: F, buffer: { type: 'uniform' } },
    { binding: 8, visibility: F, buffer: { type: 'uniform' } },
    { binding: 9, visibility: V, buffer: { type: 'uniform' } }] });
  const bglWater = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: V, buffer: { type: 'uniform' } },
    { binding: 1, visibility: F, texture: { sampleType: 'float' } },
    { binding: 2, visibility: F, texture: { sampleType: 'depth' } },
    { binding: 3, visibility: F, sampler: { type: 'filtering' } },
    { binding: 4, visibility: F, buffer: { type: 'uniform' } }] });
  const bglBlit = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: F, texture: { sampleType: 'float' } },
    { binding: 1, visibility: F, sampler: { type: 'filtering' } }] });
  const bglComposite = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: F, texture: { sampleType: 'float' } },
    { binding: 1, visibility: F, sampler: { type: 'filtering' } },
    { binding: 2, visibility: F, buffer: { type: 'uniform' } }] });

  /* ── compute pipelines ── */
  const pipeStep = {}; // per layer type id
  const stepLayout = device.createPipelineLayout({ bindGroupLayouts: [bglStep] });
  for (const t of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20]) {
    pipeStep[t] = device.createComputePipeline({ layout: stepLayout, compute: { module: modLayerEval, entryPoint: 'main' } });
  }
  const pipeCopy = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bglCopy] }), compute: { module: modCopy, entryPoint: 'main' } });
  const pipeClear = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bglClear] }), compute: { module: modClear, entryPoint: 'main' } });
  const pipeClearRGBA = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bglClearRGBA] }), compute: { module: modClearRGBA, entryPoint: 'main' } });
  const pipeClearR8 = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bglClearR8] }), compute: { module: modClearR8, entryPoint: 'main' } });
  const pipeFlux = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bglFlux] }), compute: { module: modFlux, entryPoint: 'main' } });
  const pipeErosion = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bglErosion] }), compute: { module: modErosion, entryPoint: 'main' } });
  const pipeHard = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bglHard] }), compute: { module: modHard, entryPoint: 'main' } });
  const pipeThermal = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bglThermal] }), compute: { module: modThermal, entryPoint: 'main' } });
  const pipeFlow = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bglFlow] }), compute: { module: modFlow, entryPoint: 'main' } });
  const pipeAO = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bglAO] }), compute: { module: modAO, entryPoint: 'main' } });
  const pipeSplat = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bglSplat] }), compute: { module: modSplat, entryPoint: 'main' } });

  /* ── render pipelines ── */
  const depthFormat = 'depth32float';
  const pipeShadow = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglShadow] }),
    vertex: { module: modTerrainVert, entryPoint: 'vs', buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'less' },
  });
  const pipeSky = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglSky] }),
    vertex: { module: modSky, entryPoint: 'vs' },
    fragment: { module: modSky, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'always' },
  });
  const pipeTerrain = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglTerrain] }),
    vertex: { module: modTerrainVert, entryPoint: 'vs', buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] },
    fragment: { module: modTerrainFrag, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'less' },
  });
  const pipeWater = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglWater] }),
    vertex: { module: modWaterVert, entryPoint: 'vs', buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] },
    fragment: { module: modWaterFrag, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'less' },
  });
  const BLIT_FRAG = `${ATMO_LIB}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var xy = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  var out: VOut;
  out.pos = vec4f(xy[vi], 0.0, 1.0);
  out.uv = vec2f(xy[vi].x * 0.5 + 0.5, 1.0 - (xy[vi].y * 0.5 + 0.5));
  return out;
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  return vec4f(textureSampleLevel(src, srcSampler, in.uv, 0.0).rgb, 1.0);
}`;
  const modBlit = module(BLIT_FRAG, 'blit');
  const pipeBlit = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglBlit] }),
    vertex: { module: modBlit, entryPoint: 'vs' },
    fragment: { module: modBlit, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'always' },
  });
  const pipeComposite = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglComposite] }),
    vertex: { module: modComposite, entryPoint: 'vs' },
    fragment: { module: modComposite, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'always' },
  });

  /* ── uniform buffers ── */
  const uni = (size, label) => device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label });
  const bufStep = uni(176, 'step');
  const bufClear = uni(16, 'clear');
  const bufClearRGBA = uni(16, 'clear-rgba');
  const bufClearR8 = uni(16, 'clear-r8');
  const bufErosion = uni(64, 'erosion');
  const bufThermal = uni(32, 'thermal');   // TherU is 20 bytes
  const bufFlow = uni(32, 'flow');         // FlowU is 24 bytes
  const bufHard = uni(48, 'hard');         // HardU is 40 bytes
  const bufAO = uni(32, 'ao');
  const bufSplat = uni(416, 'splat');
  const bufVert = uni(80, 'vert');
  const bufFrag = uni(288, 'frag');
  const bufMats = uni(256, 'mats');
  const bufSky = uni(128, 'sky');
  const bufWaterVert = uni(80, 'water-vert');
  const bufWaterFrag = uni(256, 'water-frag');
  const bufComposite = uni(32, 'composite');

  /* ── geometry ── */
  let gridVB = null, gridIB = null, gridIndexCount = 0, gridVertexCount = 0;
  function buildGrid(n) {
    const verts = new Float32Array(n * n * 2);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 2;
      verts[i] = x / (n - 1);
      verts[i + 1] = y / (n - 1);
    }
    const quads = (n - 1) * (n - 1);
    const indices = new Uint32Array(quads * 6);
    let p = 0;
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
      const a = y * n + x, b = a + 1, c = a + n, d = c + 1;
      indices[p++] = a; indices[p++] = c; indices[p++] = b;
      indices[p++] = b; indices[p++] = c; indices[p++] = d;
    }
    gridVB?.destroy(); gridIB?.destroy();
    gridVB = device.createBuffer({ size: verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(gridVB, 0, verts);
    gridIB = device.createBuffer({ size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(gridIB, 0, indices);
    gridIndexCount = indices.length;
    gridVertexCount = n * n;
  }
  // water quad
  const waterVB = device.createBuffer({ size: 4 * 8, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(waterVB, 0, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
  const waterIB = device.createBuffer({ size: 6 * 2, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(waterIB, 0, new Uint16Array([0, 1, 2, 2, 1, 3]));

  /* ── textures ── */
  const T = {}; // texture registry
  const SHADOW_SIZE = 2048;
  function tex2d(w, h, format, usage, label) {
    return device.createTexture({ size: [w, h], format, usage, label });
  }
  const SAMPLED = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
  const STORAGE = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
  const RENDER = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;

  function allocateTextures(res) {
    engine.res = res;
    const w = res, h = res;
    for (const k of Object.keys(T)) T[k]?.texture?.destroy?.();
    bgStepCache.clear(); bgErosionCache.clear(); bgFluxCache.clear();
    T.hA = { texture: tex2d(w, h, 'r32float', STORAGE, 'hA') };
    T.hB = { texture: tex2d(w, h, 'r32float', STORAGE, 'hB') };
    T.wA = { texture: tex2d(w, h, 'r32float', STORAGE, 'wA') };
    T.wB = { texture: tex2d(w, h, 'r32float', STORAGE, 'wB') };
    T.sA = { texture: tex2d(w, h, 'r32float', STORAGE, 'sA') };
    T.sB = { texture: tex2d(w, h, 'r32float', STORAGE, 'sB') };
    T.fA = { texture: tex2d(w, h, 'rgba32float', STORAGE, 'fA') };
    T.fB = { texture: tex2d(w, h, 'rgba32float', STORAGE, 'fB') };
    T.hard = { texture: tex2d(w, h, 'r32float', STORAGE, 'hard') };
    T.tA = { texture: tex2d(w, h, 'r32float', STORAGE, 'tA') };
    T.tB = { texture: tex2d(w, h, 'r32float', STORAGE, 'tB') };
    T.ao = { texture: tex2d(w, h, 'r8unorm', STORAGE, 'ao') };
    T.flow = { texture: tex2d(w, h, 'r8unorm', STORAGE, 'flow') };
    T.splatA = { texture: tex2d(w, h, 'rgba8unorm', STORAGE, 'splatA') };
    T.splatB = { texture: tex2d(w, h, 'rgba8unorm', STORAGE, 'splatB') };
    T.shadow = { texture: tex2d(SHADOW_SIZE, SHADOW_SIZE, 'depth32float', GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, 'shadow') };
    engine.meshN = res >= 2048 ? 1025 : 513;
    buildGrid(engine.meshN);
    rebuildBindGroups();
    // zero the simulation buffers so the first render is deterministic
    const zero = new Float32Array(4);
    device.queue.writeBuffer(bufClear, 0, zero);
    for (const k of ['hA', 'hB', 'wA', 'wB', 'sA', 'sB', 'tA', 'tB', 'hard']) dispatch(pipeClear, bgClear(T[k].texture));
    const zero4 = new Float32Array(4);
    device.queue.writeBuffer(bufClearRGBA, 0, zero4);
    for (const k of ['fA', 'fB']) dispatch(pipeClearRGBA, bgClearRGBA(T[k].texture));
    const zero8 = new Float32Array(4); zero8[0] = 0;
    device.queue.writeBuffer(bufClearR8, 0, zero8);
    for (const k of ['ao', 'flow']) dispatch(pipeClearR8, bgClearR8(T[k].texture));
    const zeroA = new Float32Array(4);
    device.queue.writeBuffer(bufClearRGBA, 0, zeroA);
    for (const k of ['splatA', 'splatB']) dispatch(pipeClearRGBA, bgClearRGBA(T[k].texture));
  }

  let bgStepCache = new Map(); // key: src|dst
  function bgForStep(srcTex, dstTex) {
    const key = srcTex.label + '>' + dstTex.label;
    let bg = bgStepCache.get(key);
    if (!bg) {
      bg = device.createBindGroup({ layout: bglStep, entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: dstTex.createView() },
        { binding: 2, resource: { buffer: bufStep } }] });
      bgStepCache.set(key, bg);
    }
    return bg;
  }
  function bgCopy(srcTex, dstTex) { return bgForStep(srcTex, dstTex); }
  function bgClear(dstTex) {
    return device.createBindGroup({ layout: bglClear, entries: [
      { binding: 0, resource: dstTex.createView() }, { binding: 1, resource: { buffer: bufClear } }] });
  }
  function bgClearRGBA(dstTex) {
    return device.createBindGroup({ layout: bglClearRGBA, entries: [
      { binding: 0, resource: dstTex.createView() }, { binding: 1, resource: { buffer: bufClearRGBA } }] });
  }
  function bgClearR8(dstTex) {
    return device.createBindGroup({ layout: bglClearR8, entries: [
      { binding: 0, resource: dstTex.createView() }, { binding: 1, resource: { buffer: bufClearR8 } }] });
  }

  let bgErosionCache = new Map();
  function bgErosion(h, w, s, f, hard, hd, wd, sd) {
    const key = [h, w, s, f, hd, wd, sd].map(t => t.label).join('|');
    let bg = bgErosionCache.get(key);
    if (!bg) {
      bg = device.createBindGroup({ layout: bglErosion, entries: [
        { binding: 0, resource: h.createView() }, { binding: 1, resource: w.createView() },
        { binding: 2, resource: s.createView() }, { binding: 3, resource: f.createView() },
        { binding: 4, resource: hard.createView() },
        { binding: 5, resource: hd.createView() }, { binding: 6, resource: wd.createView() },
        { binding: 7, resource: sd.createView() }, { binding: 8, resource: { buffer: bufErosion } }] });
      bgErosionCache.set(key, bg);
    }
    return bg;
  }
  let bgFluxCache = new Map();
  function bgFlux(h, w, f, fd) {
    const key = [h, w, f, fd].map(t => t.label).join('|');
    let bg = bgFluxCache.get(key);
    if (!bg) {
      bg = device.createBindGroup({ layout: bglFlux, entries: [
        { binding: 0, resource: h.createView() }, { binding: 1, resource: w.createView() },
        { binding: 2, resource: f.createView() }, { binding: 3, resource: fd.createView() },
        { binding: 4, resource: { buffer: bufErosion } }] });
      bgFluxCache.set(key, bg);
    }
    return bg;
  }
  function bgThermal(srcTex, dstTex) { return bgForStep(srcTex, dstTex); }
  function bgHard(srcTex, dstTex) {
    return device.createBindGroup({ layout: bglHard, entries: [
      { binding: 0, resource: srcTex.createView() }, { binding: 1, resource: dstTex.createView() },
      { binding: 2, resource: { buffer: bufHard } }] });
  }
  function bgFlow(fTex, dstTex) {
    return device.createBindGroup({ layout: bglFlow, entries: [
      { binding: 0, resource: fTex.createView() }, { binding: 1, resource: dstTex.createView() },
      { binding: 2, resource: { buffer: bufFlow } }] });
  }
  function bgAO(srcTex, dstTex) {
    return device.createBindGroup({ layout: bglAO, entries: [
      { binding: 0, resource: srcTex.createView() }, { binding: 1, resource: dstTex.createView() },
      { binding: 2, resource: { buffer: bufAO } }] });
  }
  let bgSplatRef = null;
  function bgSplat() {
    if (bgSplatRef) return bgSplatRef;
    bgSplatRef = device.createBindGroup({ layout: bglSplat, entries: [
      { binding: 0, resource: T.hA.texture.createView() },
      { binding: 1, resource: T.ao.texture.createView() },
      { binding: 2, resource: T.flow.texture.createView() },
      { binding: 3, resource: T.splatA.texture.createView() },
      { binding: 4, resource: T.splatB.texture.createView() },
      { binding: 5, resource: { buffer: bufSplat } }] });
    return bgSplatRef;
  }

  /* ── render targets (canvas-sized) ── */
  let rtColorA = null, rtColorB = null, rtDepthA = null, rtDepthB = null, rtCapture = null, canvasW = 0, canvasH = 0;
  let bgTerrainRef = null, bgSkyRef = null, bgShadowRef = null, bgWaterRef = null, bgBlitAB = null, bgCompositeB = null, bgCompositeCapture = null;
  function allocateRenderTargets() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.floor((canvas.clientWidth || 800) * dpr));
    const h = Math.max(2, Math.floor((canvas.clientHeight || 600) * dpr));
    if (w === canvasW && h === canvasH && rtColorA) return;
    canvasW = w; canvasH = h;
    canvas.width = w; canvas.height = h;
    rtColorA?.texture.destroy(); rtColorB?.texture.destroy(); rtDepthA?.destroy(); rtDepthB?.destroy(); rtCapture?.destroy();
    rtColorA = { texture: tex2d(w, h, 'rgba16float', RENDER, 'colorA') };
    rtColorB = { texture: tex2d(w, h, 'rgba16float', RENDER, 'colorB') };
    rtDepthA = tex2d(w, h, depthFormat, GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC, 'depthA');
    rtDepthB = tex2d(w, h, depthFormat, GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST, 'depthB');
    rtCapture = { texture: tex2d(w, h, format, RENDER | GPUTextureUsage.COPY_SRC, 'capture') };
    rebuildBindGroups();
  }
  function rebuildBindGroups() {
    if (!rtColorA || !T.hA) return;
    bgSkyRef = device.createBindGroup({ layout: bglSky, entries: [{ binding: 0, resource: { buffer: bufSky } }] });
    bgShadowRef = device.createBindGroup({ layout: bglShadow, entries: [
      { binding: 0, resource: T.hA.texture.createView() }, { binding: 9, resource: { buffer: bufVert } }] });
    bgTerrainRef = device.createBindGroup({ layout: bglTerrain, entries: [
      { binding: 0, resource: T.hA.texture.createView() },
      { binding: 1, resource: T.ao.texture.createView() }, { binding: 2, resource: T.flow.texture.createView() },
      { binding: 3, resource: T.splatA.texture.createView() }, { binding: 4, resource: T.splatB.texture.createView() },
      { binding: 5, resource: T.shadow.texture.createView() }, { binding: 6, resource: comparisonSampler },
      { binding: 7, resource: { buffer: bufFrag } }, { binding: 8, resource: { buffer: bufMats } },
      { binding: 9, resource: { buffer: bufVert } }] });
    bgWaterRef = device.createBindGroup({ layout: bglWater, entries: [
      { binding: 0, resource: { buffer: bufWaterVert } },
      { binding: 1, resource: rtColorA.texture.createView() }, { binding: 2, resource: rtDepthA.createView() },
      { binding: 3, resource: linearSampler }, { binding: 4, resource: { buffer: bufWaterFrag } }] });
    bgBlitAB = device.createBindGroup({ layout: bglBlit, entries: [
      { binding: 0, resource: rtColorA.texture.createView() }, { binding: 1, resource: linearSampler }] });
    bgCompositeB = device.createBindGroup({ layout: bglComposite, entries: [
      { binding: 0, resource: rtColorB.texture.createView() }, { binding: 1, resource: linearSampler },
      { binding: 2, resource: { buffer: bufComposite } }] });
    bgCompositeCapture = device.createBindGroup({ layout: bglComposite, entries: [
      { binding: 0, resource: rtColorB.texture.createView() }, { binding: 1, resource: linearSampler },
      { binding: 2, resource: { buffer: bufComposite } }] });
    bgSplatRef = null;
  }

  /* ── layer evaluation ── */
  const WGSL_TYPE = {
    mountain: 0, hills: 1, dunes: 2, canyon: 3, volcano: 4, plateau: 5, craters: 6,
    archipelago: 7, perlin: 8, worley: 9, gradient: 10, constant: 11, warp: 12,
    smooth: 14, terrace: 15, levels: 16, clamp: 17, detail: 18, slant: 19, curvature: 20,
  };
  const WGSL_BLEND = { mix: 0, add: 1, sub: 2, mul: 3, max: 4, min: 5, screen: 6 };

  function fillStepUniform(layer, env) {
    const t = terrainType(layer.type);
    const f = new Float32Array(44); // 176 bytes
    const u = new Uint32Array(f.buffer);
    f[0] = engine.res; f[1] = engine.res;
    f[2] = env.terrain.worldSize; f[3] = env.terrain.heightScale;
    f[4] = layer.seed; f[5] = layer.weight;
    u[6] = WGSL_BLEND[layer.blend] ?? 0;
    u[7] = WGSL_TYPE[layer.type] ?? 0;
    const sw = [0, 0, 0, 0];
    (t?.switches || []).forEach((s, i) => { sw[i] = layer.switches?.[s.key] ? 1 : 0; });
    f[8] = sw[0]; f[9] = sw[1]; f[10] = sw[2]; f[11] = sw[3];
    const p = layer.params || {};
    const setP = (idx, a, b, c, d) => { f[12 + idx * 4] = a ?? 0; f[13 + idx * 4] = b ?? 0; f[14 + idx * 4] = c ?? 0; f[15 + idx * 4] = d ?? 0; };
    const deg = Math.PI / 180;
    switch (layer.type) {
      case 'mountain': setP(0, p.scale, p.octaves, p.sharpness, p.warp); setP(1, p.height); break;
      case 'hills': setP(0, p.scale, p.octaves, p.height, p.billow); break;
      case 'dunes': setP(0, p.scale, p.height, p.asymmetry, p.warp); setP(1, (p.orientation ?? 0) * deg); break;
      case 'canyon': setP(0, p.scale, p.depth, p.steepness, p.meander); break;
      case 'volcano': setP(0, p.radius, p.height, p.crater, p.rim); setP(1, p.roughness); break;
      case 'plateau': setP(0, p.scale, p.height, p.steps, p.edge); break;
      case 'craters': setP(0, p.scale, p.depth, p.rim); break;
      case 'archipelago': setP(0, p.scale, p.height, p.falloff, p.warp); break;
      case 'perlin': setP(0, p.scale, p.octaves, p.lacunarity, p.gain); setP(1, p.height); break;
      case 'worley': setP(0, p.scale, p.height, p.jitter, p.mode); break;
      case 'gradient': setP(0, p.height, (p.angle ?? 0) * deg, p.shape); break;
      case 'constant': setP(0, p.height); break;
      case 'warp': setP(0, p.strength, p.scale, p.iterations); break;
      case 'smooth': setP(0, p.radius); setP(1, p.iterations); break;
      case 'terrace': setP(0, p.steps, p.blend, p.offset); break;
      case 'levels': setP(0, p.inLow, p.inHigh, p.outLow, p.outHigh); setP(1, p.gamma); break;
      case 'clamp': setP(0, p.min, p.max); break;
      case 'detail': setP(0, p.amount, p.scale, p.octaves, p.ridgedMix); break;
      case 'slant': setP(0, p.tiltX, p.tiltZ); break;
      case 'curvature': setP(0, p.amount, p.mode); break;
      default: break;
    }
    device.queue.writeBuffer(bufStep, 0, f);
  }

  function dispatch(pipe, bg) {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(engine.res / 16), Math.ceil(engine.res / 16));
    pass.end();
    device.queue.submit([enc.finish()]);
  }
  function dispatchMany(jobs) {
    const enc = device.createCommandEncoder();
    for (const { pipe, bg } of jobs) {
      const pass = enc.beginComputePass();
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(Math.ceil(engine.res / 16), Math.ceil(engine.res / 16));
      pass.end();
    }
    device.queue.submit([enc.finish()]);
  }

  async function runErosion(layer, env, onProgress, progressBase, progressSpan) {
    const res = engine.res;
    const cell = env.terrain.worldSize / res;
    const p = layer.params;
    const hardnessOn = layer.switches?.hardnessOn !== false ? 1 : 0;
    const thermalOn = layer.switches?.thermalOn !== false ? 1 : 0;
    const thermalPasses = thermalOn ? Math.round(clamp(p.thermal ?? 2, 0, 8)) : 0;
    const iterations = Math.round(clamp(p.iterations ?? 96, 4, 220));

    // erosion uniform
    const fe = new Float32Array(16);
    fe[0] = res; fe[1] = res;
    fe[2] = cell; fe[3] = env.terrain.heightScale; fe[4] = 0.02;
    fe[5] = p.rain; fe[6] = p.evaporation; fe[7] = p.erosion; fe[8] = p.deposition; fe[9] = p.capacity;
    fe[10] = layer.seed; fe[11] = hardnessOn; fe[12] = p.hardnessScale; fe[13] = p.hardnessContrast;
    device.queue.writeBuffer(bufErosion, 0, fe);

    // hardness from current terrain
    const fh = new Float32Array(8);
    fh[0] = res; fh[1] = res; fh[2] = env.terrain.worldSize; fh[3] = p.hardnessScale; fh[4] = p.hardnessContrast; fh[5] = layer.seed;
    device.queue.writeBuffer(bufHard, 0, fh);
    dispatch(pipeHard, bgHard(T.hA.texture, T.hard.texture));

    // init erosion state from current height (canonical hA)
    dispatch(pipeCopy, bgCopy(T.hA.texture, T.hB.texture)); // hB ← current
    const fz = new Float32Array(4); fz[0] = 0;
    device.queue.writeBuffer(bufClear, 0, fz);
    dispatch(pipeClear, bgClear(T.wB.texture));
    dispatch(pipeClear, bgClear(T.sB.texture));
    const fz4 = new Float32Array(4);
    device.queue.writeBuffer(bufClearRGBA, 0, fz4);
    dispatch(pipeClearRGBA, bgClearRGBA(T.fB.texture));

    // ping-pong state: height/water/sediment in B, flux in B
    let hCur = T.hB, wCur = T.wB, sCur = T.sB, fCur = T.fB;
    let hNxt = T.hA, wNxt = T.wA, sNxt = T.sA, fNxt = T.fA;
    const chunk = 8;
    for (let i0 = 0; i0 < iterations; i0 += chunk) {
      const jobs = [];
      for (let i = i0; i < Math.min(i0 + chunk, iterations); i++) {
        jobs.push({ pipe: pipeFlux, bg: bgFlux(hCur.texture, wCur.texture, fCur.texture, fNxt.texture) });
        jobs.push({ pipe: pipeErosion, bg: bgErosion(hCur.texture, wCur.texture, sCur.texture, fNxt.texture, T.hard.texture, hNxt.texture, wNxt.texture, sNxt.texture) });
        [hCur, hNxt] = [hNxt, hCur]; [wCur, wNxt] = [wNxt, wCur]; [sCur, sNxt] = [sNxt, sCur]; [fCur, fNxt] = [fNxt, fCur];
      }
      dispatchMany(jobs);
      onProgress?.(progressBase + progressSpan * Math.min(i0 + chunk, iterations) / iterations);
      await device.queue.onSubmittedWorkDone();
    }
    // flow accumulation from final flux
    const ff = new Float32Array(4); ff[0] = res; ff[1] = res; ff[2] = 42;
    device.queue.writeBuffer(bufFlow, 0, ff);
    dispatch(pipeFlow, bgFlow(fCur.texture, T.flow.texture));

    // thermal slumping block
    if (thermalPasses > 0) {
      const talusNorm = Math.tan((p.talus ?? 4) * Math.PI / 180) * (cell / Math.max(env.terrain.heightScale, 1));
      const ft = new Float32Array(4); ft[0] = res; ft[1] = res; ft[2] = talusNorm; ft[3] = 0.55;
      device.queue.writeBuffer(bufThermal, 0, ft);
      dispatch(pipeCopy, bgCopy(hCur.texture, T.tA.texture));
      let src = T.tA, dst = T.tB;
      for (let i = 0; i < thermalPasses; i++) {
        dispatch(pipeThermal, bgThermal(src.texture, dst.texture));
        [src, dst] = [dst, src];
      }
      dispatch(pipeCopy, bgCopy(src.texture, T.hA.texture));
    } else {
      dispatch(pipeCopy, bgCopy(hCur.texture, T.hA.texture));
    }
    await device.queue.onSubmittedWorkDone();
  }

  /* full stack regeneration */
  async function regenerate(onProgress) {
    if (engine.busy) return;
    engine.busy = true;
    try {
      const env = state.env;
      const layers = state.terrain.layers.filter(l => l.enabled);
      const total = layers.length || 1;
      let done = 0;
      const report = (label) => onProgress?.(done / total, label);
      // clear base
      const fz = new Float32Array(4); fz[0] = 0;
      device.queue.writeBuffer(bufClear, 0, fz);
      dispatch(pipeClear, bgClear(T.hA.texture));
      let cur = T.hA, nxt = T.hB;
      let first = true;
      for (const layer of layers) {
        report(layer.name);
        if (layer.type === 'erosion') {
          if (cur !== T.hA) dispatch(pipeCopy, bgCopy(cur.texture, T.hA.texture));
          await runErosion(layer, env, onProgress, done / total, 1 / total);
          cur = T.hA; nxt = T.hB; // erosion leaves its result in hA
          done++;
          continue;
        }
        if (layer.type === 'thermal') {
          const p = layer.params;
          const cell = env.terrain.worldSize / engine.res;
          const talusNorm = Math.tan((p.talus ?? 5) * Math.PI / 180) * (cell / Math.max(env.terrain.heightScale, 1));
          const ft = new Float32Array(4); ft[0] = engine.res; ft[1] = engine.res; ft[2] = talusNorm; ft[3] = p.rate;
          device.queue.writeBuffer(bufThermal, 0, ft);
          let src = cur, dst = nxt;
          for (let i = 0; i < Math.round(p.iterations); i++) {
            dispatch(pipeThermal, bgThermal(src.texture, dst.texture));
            [src, dst] = [dst, src];
          }
          cur = src;
          done++;
          continue;
        }
        if (layer.type === 'smooth') {
          const p = layer.params;
          const iters = Math.round(p.iterations);
          let src = cur, dst = nxt;
          for (let i = 0; i < iters; i++) {
            fillStepUniform({ ...layer, weight: i === 0 ? layer.weight : 1 }, env);
            dispatch(pipeStep[14], bgForStep(src.texture, dst.texture));
            [src, dst] = [dst, src];
          }
          cur = src;
          done++;
          continue;
        }
        fillStepUniform(layer, env);
        const typeId = WGSL_TYPE[layer.type];
        dispatch(pipeStep[typeId], bgForStep(cur.texture, nxt.texture));
        [cur, nxt] = [nxt, cur];
        done++;
        if (!first && done % 4 === 0) await device.queue.onSubmittedWorkDone();
        first = false;
      }
      // canonical height in hA
      if (cur !== T.hA) dispatch(pipeCopy, bgCopy(cur.texture, T.hA.texture));
      await device.queue.onSubmittedWorkDone();
      bakeAux();
      onProgress?.(1, 'Ready');
    } finally {
      engine.busy = false;
    }
  }

  /* AO + splat bakes (texture stack changes only need splat) */
  function bakeAO() {
    const env = state.env;
    const fa = new Float32Array(8);
    fa[0] = engine.res; fa[1] = engine.res;
    fa[2] = env.terrain.worldSize / engine.res; fa[3] = env.terrain.heightScale; fa[4] = 2.2;
    device.queue.writeBuffer(bufAO, 0, fa);
    dispatch(pipeAO, bgAO(T.hA.texture, T.ao.texture));
  }
  function bakeSplat() {
    const env = state.env;
    const layers = state.texture.layers.slice(0, 8);
    const buf = new ArrayBuffer(416);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    f[0] = engine.res; f[1] = engine.res;
    f[2] = env.terrain.worldSize; f[3] = env.terrain.heightScale;
    f[4] = env.terrain.worldSize / engine.res;
    u[5] = layers.length;
    layers.forEach((layer, i) => {
      const p = layer.params;
      const o = 8 + i * 12;
      f[o] = layer.enabled ? layer.weight : 0;
      u[o + 1] = WGSL_BLEND[layer.blend] ?? 0;
      f[o + 2] = p.heightMin; f[o + 3] = p.heightMax;
      f[o + 4] = p.slopeMin; f[o + 5] = p.slopeMax;
      f[o + 6] = p.noiseAmount; f[o + 7] = p.noiseScale; f[o + 8] = p.noiseContrast;
      f[o + 9] = p.flowAmount; f[o + 10] = p.aoMin; f[o + 11] = layer.seed;
    });
    device.queue.writeBuffer(bufSplat, 0, buf);
    dispatch(pipeSplat, bgSplat());
    // material uniforms for the fragment stage
    const mb = new ArrayBuffer(256);
    const mf = new Float32Array(mb);
    layers.forEach((layer, i) => {
      const p = layer.params;
      const rgb = hexToLinear(p.albedo);
      mf[i * 8] = rgb[0]; mf[i * 8 + 1] = rgb[1]; mf[i * 8 + 2] = rgb[2]; mf[i * 8 + 3] = p.roughness;
      mf[i * 8 + 4] = p.patternScale; mf[i * 8 + 5] = p.patternContrast; mf[i * 8 + 6] = p.normalStrength;
      mf[i * 8 + 7] = (layer.seed % 997) * 0.37;
    });
    device.queue.writeBuffer(bufMats, 0, mb);
  }
  function bakeAux() { bakeAO(); bakeSplat(); }

  /* ── camera ── */
  const camera = {
    target: [0, 0, 0], azimuth: 0.8, elevation: 0.42, distance: 1,
    targetAz: 0.8, targetEl: 0.42, targetDist: 1, targetFocus: [0, 0, 0],
    fov: 42, dragging: false, panning: false, lastX: 0, lastY: 0,
  };
  function resetCamera() {
    const env = state.env;
    camera.target = [0, env.terrain.heightScale * 0.18, 0];
    camera.targetFocus = [...camera.target];
    camera.targetAz = 0.85; camera.targetEl = 0.46;
    camera.targetDist = env.terrain.worldSize * 0.62;
  }
  function attachControls() {
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 2 || e.shiftKey) camera.panning = true; else camera.dragging = true;
      camera.lastX = e.clientX; camera.lastY = e.clientY;
    });
    canvas.addEventListener('pointermove', e => {
      const dx = e.clientX - camera.lastX, dy = e.clientY - camera.lastY;
      camera.lastX = e.clientX; camera.lastY = e.clientY;
      if (camera.dragging) {
        camera.targetAz -= dx * 0.005;
        camera.targetEl = clamp(camera.targetEl + dy * 0.004, 0.04, 1.45);
      } else if (camera.panning) {
        const env = state.env;
        const speed = camera.distance * 0.0016;
        const ca = Math.cos(camera.azimuth), sa = Math.sin(camera.azimuth);
        camera.targetFocus[0] += (-dx * ca - dy * sa) * speed;
        camera.targetFocus[2] += (dx * sa - dy * ca) * speed;
        const lim = env.terrain.worldSize * 0.6;
        camera.targetFocus[0] = clamp(camera.targetFocus[0], -lim, lim);
        camera.targetFocus[2] = clamp(camera.targetFocus[2], -lim, lim);
      }
    });
    const end = e => { camera.dragging = false; camera.panning = false; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      camera.targetDist = clamp(camera.targetDist * Math.exp(e.deltaY * 0.0012), state.env.terrain.worldSize * 0.04, state.env.terrain.worldSize * 2.4);
    }, { passive: false });
  }

  /* ── sky / lighting evaluation (CPU) ── */
  function sunDirection(env) {
    const az = env.sun.azimuth * Math.PI / 180, el = env.sun.elevation * Math.PI / 180;
    return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
  }
  function skyLighting(env) {
    const sunDir = sunDirection(env);
    const mieAmount = env.atmosphere.mie;
    const airMass = Math.pow(Math.max(Math.sin(env.sun.elevation * Math.PI / 180), 0.0), 0.55);
    const elevFactor = clamp(airMass * 1.15, 0.05, 1.0);
    const night = clamp((env.sun.elevation + 5.5) / 6.0, 0, 1);
    const skyIntensity = 22 * elevFactor * (env.sun.intensity / 108);
    const origin = [0, ATMO_Rg, 0];
    const zenith = evalAtmosphere(origin, [0, 1, 0], sunDir, skyIntensity, mieAmount, 6, 2);
    const az = env.sun.azimuth * Math.PI / 180;
    const horizonDir = [Math.sin(az) * 0.35, 0.12, Math.cos(az) * 0.35];
    const hl = Math.hypot(...horizonDir);
    const horizon = evalAtmosphere(origin, horizonDir.map(v => v / hl), sunDir, skyIntensity, mieAmount, 6, 2);
    // sun transmittance toward the sun from a ground point
    const trans = evalAtmosphere(origin, sunDir, sunDir, 1, mieAmount, 6, 3);
    const tint = kelvinTint(env.sun.temperature);
    const sunStrength = 3.4 * (env.sun.intensity / 108) * (0.25 + 0.75 * airMass);
    let sunColor = [tint[0] * trans[0] * sunStrength, tint[1] * trans[1] * sunStrength, tint[2] * trans[2] * sunStrength];
    if (night < 1) {
      const moon = [0.10, 0.13, 0.22];
      sunColor = sunColor.map((c, i) => c * night + moon[i] * (1 - night) * 0.5);
    }
    return {
      sunDir, sunColor, night,
      ambZenith: zenith.map(c => c * 0.5),
      ambHorizon: horizon.map(c => c * 0.5),
      skyIntensity,
    };
  }

  /* ── frame uniforms ── */
  function writeTerrainUniforms(viewProj, sunViewProj, sky, env, viewMode, shadows) {
    const f = new Float32Array(72); // 288 bytes
    const u = new Uint32Array(f.buffer);
    f.set(viewProj, 0);
    f[16] = camera.position[0]; f[17] = camera.position[1]; f[18] = camera.position[2]; f[19] = 1;
    f[20] = sky.sunDir[0]; f[21] = sky.sunDir[1]; f[22] = sky.sunDir[2]; f[23] = 0;
    f[24] = sky.sunColor[0]; f[25] = sky.sunColor[1]; f[26] = sky.sunColor[2]; f[27] = 0;
    f[28] = sky.ambZenith[0]; f[29] = sky.ambZenith[1]; f[30] = sky.ambZenith[2]; f[31] = 0;
    f[32] = sky.ambHorizon[0]; f[33] = sky.ambHorizon[1]; f[34] = sky.ambHorizon[2]; f[35] = 0;
    f[36] = env.atmosphere.fog * 2.4e-4;
    f[37] = env.terrain.heightScale; f[38] = env.terrain.worldSize; f[39] = env.atmosphere.exposure;
    u[40] = viewMode;
    f[41] = env.water.enabled ? env.water.level : -9999;
    f[42] = performance.now() / 1000;
    f[43] = 1.0; // aoStrength
    f[44] = 1 / SHADOW_SIZE;
    f[45] = env.atmosphere.mie;
    f[46] = sky.skyIntensity;
    f[47] = engine.res; f[48] = engine.res;
    f[49] = env.terrain.worldSize / engine.res;
    u[50] = env.water.enabled ? 1 : 0;
    f.set(sunViewProj, 52);
    device.queue.writeBuffer(bufFrag, 0, f);
  }
  function writeVertUniform(viewProj) {
    const f = new Float32Array(20);
    f.set(viewProj, 0);
    f[16] = state.env.terrain.worldSize; f[17] = state.env.terrain.heightScale;
    f[18] = engine.res; f[19] = engine.res;
    device.queue.writeBuffer(bufVert, 0, f);
  }
  function writeSkyUniform(invViewProj, sky, env) {
    const f = new Float32Array(32);
    f.set(invViewProj, 0);
    f[16] = camera.position[0]; f[17] = camera.position[1]; f[18] = camera.position[2]; f[19] = 1;
    f[20] = sky.sunDir[0]; f[21] = sky.sunDir[1]; f[22] = sky.sunDir[2]; f[23] = 0;
    f[24] = sky.sunColor[0]; f[25] = sky.sunColor[1]; f[26] = sky.sunColor[2]; f[27] = 1;
    f[28] = sky.skyIntensity; f[29] = env.atmosphere.mie; f[30] = sky.night; f[31] = performance.now() / 1000;
    device.queue.writeBuffer(bufSky, 0, f);
  }
  function writeWaterUniforms(viewProj, invViewProj, sky, env) {
    const fv = new Float32Array(20);
    fv.set(viewProj, 0);
    fv[16] = env.water.level; fv[17] = env.terrain.worldSize; fv[18] = performance.now() / 1000; fv[19] = 0;
    device.queue.writeBuffer(bufWaterVert, 0, fv);
    const f = new Float32Array(64); // 256 bytes
    f.set(viewProj, 0); f.set(invViewProj, 16);
    f[32] = camera.position[0]; f[33] = camera.position[1]; f[34] = camera.position[2]; f[35] = 1;
    f[36] = sky.sunDir[0]; f[37] = sky.sunDir[1]; f[38] = sky.sunDir[2]; f[39] = 0;
    f[40] = sky.sunColor[0]; f[41] = sky.sunColor[1]; f[42] = sky.sunColor[2]; f[43] = 1;
    f[44] = sky.ambZenith[0]; f[45] = sky.ambZenith[1]; f[46] = sky.ambZenith[2]; f[47] = 0;
    f[48] = sky.ambHorizon[0]; f[49] = sky.ambHorizon[1]; f[50] = sky.ambHorizon[2]; f[51] = 0;
    f[52] = env.water.level; f[53] = env.terrain.heightScale; f[54] = env.terrain.worldSize;
    f[55] = performance.now() / 1000; f[56] = env.water.ripple; f[57] = env.water.clarity; f[58] = env.water.foam;
    f[59] = env.atmosphere.fog * 2.4e-4; f[60] = env.atmosphere.mie; f[61] = sky.skyIntensity;
    f[62] = canvasW; f[63] = canvasH;
    device.queue.writeBuffer(bufWaterFrag, 0, f);
  }
  function writeCompositeUniform() {
    const f = new Float32Array(8);
    f[0] = state.env.atmosphere.exposure;
    f[1] = performance.now() / 1000;
    f[2] = 0.32;
    f[4] = canvasW; f[5] = canvasH;
    device.queue.writeBuffer(bufComposite, 0, f);
  }

  /* ── shadow pass ── */
  function sunViewProj(env) {
    const sky = skyLighting(env);
    const sunDir = sky.sunDir;
    const extent = env.terrain.worldSize * 0.62;
    const center = [0, env.terrain.heightScale * 0.25, 0];
    const dist = env.terrain.worldSize * 1.2;
    const eye = [center[0] - sunDir[0] * dist, center[1] - sunDir[1] * dist, center[2] - sunDir[2] * dist];
    const view = M4.lookAt(eye, center, [0, 1, 0]);
    const proj = M4.ortho(-extent, extent, -extent, extent, 0.1, dist * 2.4);
    return M4.multiply(proj, view);
  }

  /* ── render frame ── */
  let frames = 0, fpsTime = performance.now(), fps = 0;
  function renderFrame(viewMode) {
    allocateRenderTargets();
    const env = state.env;
    const sky = skyLighting(env);
    // camera damping
    const k = 1 - Math.exp(-0.12);
    camera.azimuth += (camera.targetAz - camera.azimuth) * k;
    camera.elevation += (camera.targetEl - camera.elevation) * k;
    camera.distance += (camera.targetDist - camera.distance) * k;
    for (let i = 0; i < 3; i++) camera.target[i] += (camera.targetFocus[i] - camera.target[i]) * k;
    const ce = Math.cos(camera.elevation), se = Math.sin(camera.elevation);
    const ca = Math.cos(camera.azimuth), sa = Math.sin(camera.azimuth);
    camera.position = [
      camera.target[0] + camera.distance * ce * sa,
      camera.target[1] + camera.distance * se,
      camera.target[2] + camera.distance * ce * ca,
    ];
    const near = Math.max(1, camera.distance * 0.002);
    const proj = M4.perspective(env.camera.fov * Math.PI / 180, canvasW / canvasH, near, env.terrain.worldSize * 4);
    const view = M4.lookAt(camera.position, camera.target, [0, 1, 0]);
    const viewProj = M4.multiply(proj, view);
    const invViewProj = M4.invert(viewProj);
    const sunVP = sunViewProj(env);

    writeVertUniform(viewProj);
    writeTerrainUniforms(viewProj, sunVP, sky, env, viewMode);
    writeSkyUniform(invViewProj, sky, env);
    writeCompositeUniform();

    const enc = device.createCommandEncoder();

    // shadow pass
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: {
          view: T.shadow.texture.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store',
        },
      });
      pass.setPipeline(pipeShadow);
      pass.setBindGroup(0, bgShadowRef);
      pass.setVertexBuffer(0, gridVB);
      pass.setIndexBuffer(gridIB, 'uint32');
      pass.drawIndexed(gridIndexCount);
      pass.end();
    }
    // scene pass: sky + terrain → colorA
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: rtColorA.texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        depthStencilAttachment: { view: rtDepthA, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setPipeline(pipeSky);
      pass.setBindGroup(0, bgSkyRef);
      pass.draw(3);
      pass.setPipeline(pipeTerrain);
      pass.setBindGroup(0, bgTerrainRef);
      pass.setVertexBuffer(0, gridVB);
      pass.setIndexBuffer(gridIB, 'uint32');
      pass.drawIndexed(gridIndexCount);
      pass.end();
    }
    // copy depth so the water pass can sample the scene depth while writing its own
    enc.copyTextureToTexture({ texture: rtDepthA }, { texture: rtDepthB }, [canvasW, canvasH, 1]);
    // water pass → colorB (or blit when disabled)
    if (env.water.enabled) {
      writeWaterUniforms(viewProj, invViewProj, sky, env);
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: rtColorB.texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        depthStencilAttachment: { view: rtDepthB, depthClearValue: 1, depthLoadOp: 'load', depthStoreOp: 'store' },
      });
      pass.setPipeline(pipeWater);
      pass.setBindGroup(0, bgWaterRef);
      pass.setVertexBuffer(0, waterVB);
      pass.setIndexBuffer(waterIB, 'uint16');
      pass.drawIndexed(6);
      pass.end();
    } else {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: rtColorB.texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        depthStencilAttachment: { view: rtDepthB, depthClearValue: 1, depthLoadOp: 'load', depthStoreOp: 'store' },
      });
      pass.setPipeline(pipeBlit);
      pass.setBindGroup(0, bgBlitAB);
      pass.draw(3);
      pass.end();
    }
    // composite → swapchain
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      pass.setPipeline(pipeComposite);
      pass.setBindGroup(0, bgCompositeB);
      pass.draw(3);
      pass.end();
    }
    device.queue.submit([enc.finish()]);

    frames++;
    const now = performance.now();
    if (now - fpsTime > 500) {
      fps = Math.round(frames * 1000 / (now - fpsTime));
      frames = 0; fpsTime = now;
      engine.onStats?.({ fps, tris: gridIndexCount / 3, res: engine.res });
    }
  }

  /* ── exports ── */
  async function readTextureFloat(texture, res) {
    const rowBytes = res * 4;
    const bytesPerRow = Math.ceil(rowBytes / 256) * 256; // WebGPU row alignment
    const buffer = device.createBuffer({ size: bytesPerRow * res, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [res, res]);
    device.queue.submit([enc.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(buffer.getMappedRange().slice(0));
    buffer.unmap(); buffer.destroy();
    // strip row padding
    const out = new Float32Array(res * res * 4);
    const view = new Uint8Array(out.buffer);
    for (let y = 0; y < res; y++) view.set(raw.subarray(y * bytesPerRow, y * bytesPerRow + rowBytes), y * rowBytes);
    return out;
  }
  async function readTextureRGBA8(texture, res) {
    const rowBytes = res * 4;
    const bytesPerRow = Math.ceil(rowBytes / 256) * 256; // WebGPU row alignment
    const buffer = device.createBuffer({ size: bytesPerRow * res, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [res, res]);
    device.queue.submit([enc.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(buffer.getMappedRange().slice(0));
    buffer.unmap(); buffer.destroy();
    // strip row padding
    const out = new Uint8Array(res * res * 4);
    const view = new Uint8Array(out.buffer);
    for (let y = 0; y < res; y++) view.set(raw.subarray(y * bytesPerRow, y * bytesPerRow + rowBytes), y * rowBytes);
    return out;
  }
  async function exportHeight16() {
    const res = engine.res;
    const data = await readTextureFloat(T.hA.texture, res);
    // 16-bit big-endian grayscale
    const bytes = new Uint8Array(res * res * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < res * res; i++) {
      const v = clamp(data[i], 0, 1) * 65535;
      view.setUint16(i * 2, Math.round(v), false);
    }
    const { encodePNG, downloadBlob } = await import('./util.js');
    const blob = await encodePNG(res, res, bytes, 1, 16);
    downloadBlob(blob, `${state.name || 'terrain'}-height16.png`);
  }
  async function exportSplat() {
    const res = engine.res;
    const a = await readTextureRGBA8(T.splatA.texture, res);
    const b = await readTextureRGBA8(T.splatB.texture, res);
    const { encodePNG, downloadBlob } = await import('./util.js');
    const base = state.name || 'terrain';
    // layers 0-3 in RGBA, layers 4-7 in a second map when they are in use
    downloadBlob(await encodePNG(res, res, a, 4, 8), `${base}-splat.png`);
    let used = false;
    for (let i = 0; i < b.length; i++) if (b[i]) { used = true; break; }
    if (used) downloadBlob(await encodePNG(res, res, b, 4, 8), `${base}-splat-layers-4-7.png`);
  }
  async function screenshot() {
    // re-composite into the capture texture
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: rtCapture.texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setPipeline(pipeComposite);
    pass.setBindGroup(0, bgCompositeCapture);
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);
    // WebGPU requires bytesPerRow to be a multiple of 256
    const rowBytes = canvasW * 4;
    const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * canvasH, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc2 = device.createCommandEncoder();
    enc2.copyTextureToBuffer({ texture: rtCapture.texture }, { buffer, bytesPerRow }, [canvasW, canvasH]);
    device.queue.submit([enc2.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(buffer.getMappedRange().slice(0));
    buffer.unmap(); buffer.destroy();
    // unpack rows (dropping padding) and flip Y
    const flipped = new Uint8Array(rowBytes * canvasH);
    for (let y = 0; y < canvasH; y++) {
      const src = (canvasH - 1 - y) * bytesPerRow;
      flipped.set(raw.subarray(src, src + rowBytes), y * rowBytes);
    }
    const { encodePNG, downloadBlob } = await import('./util.js');
    downloadBlob(await encodePNG(canvasW, canvasH, flipped, 4, 8), `${state.name || 'terrain'}-render.png`);
  }
  async function readSplatWeights() {
    // downsampled coverage readback for UI previews
    const res = engine.res;
    const a = await readTextureRGBA8(T.splatA.texture, res);
    const b = await readTextureRGBA8(T.splatB.texture, res);
    return { a, b, res };
  }

  /* ── boot ── */
  allocateTextures(state.env.terrain.resolution);
  resetCamera();
  attachControls();
  device.addEventListener?.('uncapturederror', e => console.error('WebGPU error:', e.error?.message || e));

  Object.assign(engine, {
    allocateTextures, regenerate, bakeAux, bakeSplat, bakeAO, renderFrame, resetCamera,
    exportHeight16, exportSplat, screenshot, readSplatWeights,
    get camera() { return camera; },
    get meshInfo() { return { verts: gridVertexCount, tris: gridIndexCount / 3, res: engine.res }; },
  });
  engine.ready = true;
  return engine;
}
