// ─────────────────────────────────────────────────────────────────────────────
//  Project state, GPU packing and presets.
// ─────────────────────────────────────────────────────────────────────────────

import { TERRAIN_TYPES, MATERIALS, MATERIAL_BY_KEY, MATERIAL_PARAMS, TEXTURE_DEFAULTS,
         MATERIAL_PRESETS, MASK_CHANNELS, MASK_GLOBAL, MASK_INVERT_BIT } from '../schema/layers.js';
import { DEG } from './math.js';

export const LAYER_STRIDE = 84;          // floats per GPU layer record
export const MAX_TERRAIN_LAYERS = 48;
export const MAX_TEXTURE_LAYERS = 24;

let uid = 1;
export const nextId = () => `L${uid++}`;

// ── layer factories ──────────────────────────────────────────────────────────
export function makeTerrainLayer(type, params = {}, opts = {}) {
  const def = TERRAIN_TYPES[type];
  const p = {};
  for (const d of def.params) p[d.key] = d.def;
  Object.assign(p, params);
  return {
    id: nextId(),
    type,
    name: opts.name || def.name,
    enabled: opts.enabled !== false,
    blend: opts.blend ?? (def.kind === 'gen' && type !== 'constant' ? 1 : 0),
    opacity: opts.opacity ?? 1,
    params: p,
    mask: opts.mask || emptyMask(),
  };
}

export function makeTextureLayer(matKey, params = {}, opts = {}) {
  const mat = MATERIAL_BY_KEY[matKey];
  const p = { ...TEXTURE_DEFAULTS, ...(MATERIAL_PRESETS[matKey] || {}) };
  Object.assign(p, params);
  return {
    id: nextId(),
    material: matKey,
    matId: mat.id,
    name: opts.name || mat.name,
    enabled: opts.enabled !== false,
    blend: opts.blend ?? 1,          // 1 = height blend
    opacity: opts.opacity ?? 1,
    params: p,
    colors: opts.colors ? opts.colors.map((c) => c.slice()) : [mat.color.slice(), mat.color2.slice()],
    mask: opts.mask || emptyMask(),
  };
}

export function emptyMask() {
  const channels = {};
  for (const ch of MASK_CHANNELS) {
    if (ch.noise) {
      channels[ch.key] = { on: false, scale: ch.def[0], octaves: ch.def[1], contrast: ch.def[2], bias: ch.def[3], seed: ch.def[4] };
    } else if (ch.aspect) {
      channels[ch.key] = { on: false, angle: ch.def[0], width: ch.def[1], feather: ch.def[2] };
    } else {
      channels[ch.key] = { on: false, lo: ch.def[0], hi: ch.def[1], featherLo: ch.def[2], featherHi: ch.def[3] };
    }
  }
  return { enabled: false, channels, gamma: 1, invert: false };
}

export function maskHasAny(mask) {
  if (!mask || !mask.enabled) return false;
  return Object.values(mask.channels).some((c) => c.on) || mask.invert;
}

// ── packing ──────────────────────────────────────────────────────────────────
function writeMask(out, base, mask) {
  let flags = 0;
  if (!mask || !mask.enabled) return 0;
  for (const ch of MASK_CHANNELS) {
    const c = mask.channels[ch.key];
    if (!c || !c.on) continue;
    flags |= ch.bit;
    if (ch.noise) {
      out[base + 40 + ch.scale[0] * 4 + ch.scale[1]] = c.scale;
      out[base + 40 + ch.octaves[0] * 4 + ch.octaves[1]] = c.octaves;
      out[base + 40 + ch.contrast[0] * 4 + ch.contrast[1]] = c.contrast;
      out[base + 40 + ch.bias[0] * 4 + ch.bias[1]] = c.bias;
      out[base + 40 + ch.seed[0] * 4 + ch.seed[1]] = c.seed;
    } else if (ch.aspect) {
      out[base + 40 + ch.angle[0] * 4 + ch.angle[1]] = c.angle;
      out[base + 40 + ch.width[0] * 4 + ch.width[1]] = c.width;
      out[base + 40 + ch.feather[0] * 4 + ch.feather[1]] = c.feather;
    } else {
      out[base + 40 + ch.lo[0] * 4 + ch.lo[1]] = c.lo;
      out[base + 40 + ch.hi[0] * 4 + ch.hi[1]] = c.hi;
      out[base + 40 + ch.featherLo[0] * 4 + ch.featherLo[1]] = c.featherLo;
      out[base + 40 + ch.featherHi[0] * 4 + ch.featherHi[1]] = c.featherHi;
    }
  }
  out[base + 40 + MASK_GLOBAL.gamma[0] * 4 + MASK_GLOBAL.gamma[1]] = mask.gamma;
  if (mask.invert) flags |= MASK_INVERT_BIT;
  return flags;
}

/** Unit conversion for angle-valued parameters (degrees → field units). */
function convertParam(def, value, ctx) {
  if (!def.convert) return value;
  const rad = value * DEG;
  if (def.convert === 'rad') return rad;
  // angle of repose -> normalised height units per cell
  return Math.tan(rad) * (ctx.worldSize / ctx.res) / ctx.heightScale;
}

export function packTerrainLayer(layer, out, index, ctx) {
  const base = index * LAYER_STRIDE;
  out.fill(0, base, base + LAYER_STRIDE);
  const def = TERRAIN_TYPES[layer.type];
  if (!def) return base;              // unknown type: never panics the build
  for (const d of def.params) {
    const v = layer.params[d.key];
    if (v === undefined) continue;
    if (d.type === 'bool') {
      out[base + d.slot[0] * 4 + d.slot[1]] = v ? 1 : 0;
    } else {
      out[base + d.slot[0] * 4 + d.slot[1]] = convertParam(d, v, ctx);
    }
  }
  // droplet count is a u32
  if (layer.type === 'hydraulic') {
    out[base + 0 * 4 + 3] = layer.params.droplets | 0;
  }
  out[base + 8 * 4 + 0] = layer.opacity;
  const spare = def.entry === 'filterSlopeBlurH' ? 1 : 0;
  out[base + 72] = 0;                         // f.x
  out[base + 73] = layer.blend;               // f.y
  out[base + 74] = writeMask(out, base, layer.mask);
  out[base + 75] = spare;                     // f.w
  return base;
}

/** The surface (AO) pass reuses a layer record for its own settings. */
export function packSurfaceParams(ao, out, index) {
  const base = index * LAYER_STRIDE;
  out.fill(0, base, base + LAYER_STRIDE);
  out[base + 0] = ao.dirs;
  out[base + 1] = ao.steps;
  out[base + 2] = ao.radius;
  out[base + 3] = ao.strength;
  out[base + 8 * 4] = 1;
  out[base + 72] = 0;
  out[base + 73] = 0;
  out[base + 74] = 0;
  out[base + 75] = 0;
}

export function packTextureLayer(layer, out, index) {
  const base = index * LAYER_STRIDE;
  out.fill(0, base, base + LAYER_STRIDE);
  for (const d of MATERIAL_PARAMS) {
    const v = layer.params[d.key];
    if (v === undefined) continue;
    out[base + d.slot[0] * 4 + d.slot[1]] = v;
  }
  out[base + 8 * 4 + 0] = layer.opacity;
  out[base + 8 * 4 + 1] = 1;                  // height-blend amount
  const c0 = layer.colors[0] || [0.5, 0.5, 0.5];
  const c1 = layer.colors[1] || [0.3, 0.3, 0.3];
  out[base + 76] = c0[0]; out[base + 77] = c0[1]; out[base + 78] = c0[2]; out[base + 79] = 1;
  out[base + 80] = c1[0]; out[base + 81] = c1[1]; out[base + 82] = c1[2]; out[base + 83] = 1;
  out[base + 72] = layer.matId;
  out[base + 73] = layer.blend;
  out[base + 74] = writeMask(out, base, layer.mask);
  out[base + 75] = layer.enabled ? 1 : 0;
}

// ── presets ──────────────────────────────────────────────────────────────────
const mk = (key, o = {}) => {
  const ch = { ...emptyMask().channels };
  for (const [k, v] of Object.entries(o)) {
    ch[k] = { ...ch[k], ...v, on: true };
  }
  return { enabled: true, channels: ch, gamma: o.__gamma ?? 1, invert: false };
};

export const PRESETS = {
  alpine: {
    label: 'Alpine Range',
    globals: { heightScale: 1500, worldSize: 4200, sunElevation: 34, sunAzimuth: 128, waterLevel: 0.08 },
    terrain: () => [
      makeTerrainLayer('constant', { value: 0.02 }, { blend: 0, name: 'Base' }),
      makeTerrainLayer('fractal', {
        subtype: 4, frequency: 2.6, octaves: 10, gain: 0.5, amplitude: 0.72,
        warp: 0.28, warpFreq: 0.45, sharpness: 2.2, contrast: 0.45, seed: 12,
      }, { name: 'Mountains' }),
      makeTerrainLayer('fractal', {
        subtype: 1, frequency: 9, octaves: 7, gain: 0.52, amplitude: 0.12,
        warp: 0.35, sharpness: 2.6, seed: 41,
      }, { name: 'Ridges', blend: 1 }),
      makeTerrainLayer('thermal', { talus: 36, rate: 0.5, iterations: 30 }),
      makeTerrainLayer('hydraulic', { droplets: 320000, steps: 72, capacity: 7, erodeRate: 0.34, strength: 1.1, smoothing: 0.4 }),
      makeTerrainLayer('slopeBlur', { radius: 14, strength: 0.85, threshold: 0.006, iterations: 2 }),
      makeTerrainLayer('snow', { amount: 0.07, line: 0.58, falloff: 0.14, slopeLimit: 48, variation: 0.5, melt: 0.6 }),
    ],
    textures: () => [
      makeTextureLayer('rock', { relief: 0.24 }, { name: 'Bedrock', blend: 0, mask: { enabled: false, channels: emptyMask().channels, gamma: 1, invert: false } }),
      makeTextureLayer('scree', {}, { mask: mk('slope', { slope: { lo: 0.34, hi: 1.0, featherLo: 0.10, featherHi: 0.0 } }) }),
      makeTextureLayer('gravel', {}, { mask: mk('slope', { slope: { lo: 0.12, hi: 0.46, featherLo: 0.09, featherHi: 0.12 } }) }),
      makeTextureLayer('grass', {}, { mask: mk('slope', { altitude: { lo: 0, hi: 0.40, featherLo: 0, featherHi: 0.10 }, slope: { lo: 0, hi: 0.29, featherLo: 0, featherHi: 0.10 } }) }),
      makeTextureLayer('drygrass', {}, { mask: mk('slope', { altitude: { lo: 0.34, hi: 0.66, featherLo: 0.08, featherHi: 0.10 }, slope: { lo: 0, hi: 0.34, featherLo: 0, featherHi: 0.12 } }) }),
      makeTextureLayer('riverstone', {}, { mask: mk('flow', { flow: { lo: 0.42, hi: 1.0, featherLo: 0.10, featherHi: 0 } }) }),
      makeTextureLayer('snow', {}, { mask: mk('slope', { altitude: { lo: 0.60, hi: 1.0, featherLo: 0.06, featherHi: 0 }, slope: { lo: 0, hi: 0.62, featherLo: 0, featherHi: 0.14 } }) }),
    ],
  },
  canyon: {
    label: 'Canyon Lands',
    globals: { heightScale: 900, worldSize: 4600, sunElevation: 22, sunAzimuth: 205, waterLevel: 0.05, turbidity: 4.2 },
    terrain: () => [
      makeTerrainLayer('constant', { value: 0.05 }, { blend: 0, name: 'Base' }),
      makeTerrainLayer('fractal', { subtype: 0, frequency: 2.2, octaves: 8, gain: 0.48, amplitude: 0.62, warp: 0.2, seed: 77 }, { name: 'Plateau' }),
      makeTerrainLayer('strata', { frequency: 26, amount: 0.9, warp: 1.1, sharpness: 0.35, erode: 0.7, noiseFreq: 2.2, seed: 5 }),
      makeTerrainLayer('hydraulic', { droplets: 460000, steps: 88, capacity: 9, erodeRate: 0.42, strength: 1.3, flowGamma: 0.5 }),
      makeTerrainLayer('carve', { depth: 0.07, width: 0.6, sharpen: 0.7 }),
      makeTerrainLayer('thermal', { talus: 42, rate: 0.55, iterations: 26 }),
      makeTerrainLayer('curve', { gamma: 1.05, contrast: 0.25, power: 1.1 }),
    ],
    textures: () => [
      makeTextureLayer('sediment', { bandFreq: 4.5, bandAmp: 0.8 }, { name: 'Bedrock', blend: 0, mask: { enabled: false, channels: emptyMask().channels, gamma: 1, invert: false } }),
      makeTextureLayer('rock', {}, { mask: mk('slope', { slope: { lo: 0.42, hi: 1.0, featherLo: 0.12, featherHi: 0 } }) }),
      makeTextureLayer('scree', {}, { mask: mk('slope', { slope: { lo: 0.20, hi: 0.55, featherLo: 0.10, featherHi: 0.14 } }) }),
      makeTextureLayer('sand', {}, { mask: mk('deposit', { deposit: { lo: 0.52, hi: 1.0, featherLo: 0.10, featherHi: 0 }, slope: { lo: 0, hi: 0.4, featherLo: 0, featherHi: 0.14 } }) }),
      makeTextureLayer('clay', {}, { mask: mk('curvature', { curvature: { lo: 0.0, hi: 0.42, featherLo: 0, featherHi: 0.10 }, slope: { lo: 0, hi: 0.5, featherLo: 0, featherHi: 0.1 } }) }),
      makeTextureLayer('riverstone', {}, { mask: mk('flow', { flow: { lo: 0.34, hi: 1.0, featherLo: 0.12, featherHi: 0 } }) }),
      makeTextureLayer('drygrass', { opacity: 0.7 }, { mask: mk('slope', { altitude: { lo: 0.05, hi: 0.30, featherLo: 0.04, featherHi: 0.08 }, slope: { lo: 0, hi: 0.3, featherLo: 0, featherHi: 0.1 }, noise: { scale: 0.012, octaves: 4, contrast: 1.4, bias: 0.42 } }) }),
    ],
  },
  dunes: {
    label: 'Desert Dunes',
    globals: { heightScale: 420, worldSize: 5200, sunElevation: 16, sunAzimuth: 105, turbidity: 5.5, waterLevel: -1 },
    terrain: () => [
      makeTerrainLayer('constant', { value: 0.18 }, { blend: 0, name: 'Base' }),
      makeTerrainLayer('fractal', { subtype: 2, frequency: 1.6, octaves: 6, gain: 0.5, amplitude: 0.42, warp: 0.4, seed: 3 }, { name: 'Undulation' }),
      makeTerrainLayer('dune', { frequency: 22, direction: 0.18, asymmetry: 0.8, warp: 1.1, warpFreq: 1.6, amplitude: 0.3, seed: 21 }),
      makeTerrainLayer('fractal', { subtype: 0, frequency: 14, octaves: 5, gain: 0.5, amplitude: 0.05, seed: 8 }, { name: 'Ripples', blend: 1 }),
      makeTerrainLayer('thermal', { talus: 33, rate: 0.6, iterations: 18 }),
    ],
    textures: () => [
      makeTextureLayer('dune', { relief: 0.06, bandFreq: 2.0 }, { name: 'Sand', blend: 0, mask: { enabled: false, channels: emptyMask().channels, gamma: 1, invert: false } }),
      makeTextureLayer('beachsand', { opacity: 0.7 }, { mask: mk('slope', { slope: { lo: 0.22, hi: 1.0, featherLo: 0.12, featherHi: 0 } }) }),
      makeTextureLayer('gravel', { opacity: 0.55 }, { mask: mk('curvature', { curvature: { lo: 0.58, hi: 1.0, featherLo: 0.08, featherHi: 0 } }) }),
      makeTextureLayer('clay', { opacity: 0.6 }, { mask: mk('altitude', { altitude: { lo: 0, hi: 0.18, featherLo: 0, featherHi: 0.08 } }) }),
    ],
  },
  volcanic: {
    label: 'Volcanic',
    globals: { heightScale: 1300, worldSize: 4000, sunElevation: 28, sunAzimuth: 250, turbidity: 6, waterLevel: -1 },
    terrain: () => [
      makeTerrainLayer('constant', { value: 0.05 }, { blend: 0, name: 'Base' }),
      makeTerrainLayer('fractal', { subtype: 0, frequency: 2.4, octaves: 8, gain: 0.52, amplitude: 0.55, seed: 55 }, { name: 'Shield' }),
      makeTerrainLayer('crater', { radius: 0.19, count: 2, amplitude: 0.3, seed: 9 }, { blend: 2, opacity: 0.9 }),
      makeTerrainLayer('fractal', { subtype: 1, frequency: 12, octaves: 6, gain: 0.5, amplitude: 0.09, sharpness: 3, seed: 31 }, { name: 'Rough', blend: 1 }),
      makeTerrainLayer('hydraulic', { droplets: 220000, steps: 60, capacity: 5, erodeRate: 0.3, strength: 0.9 }),
      makeTerrainLayer('thermal', { talus: 38, rate: 0.5, iterations: 20 }),
      makeTerrainLayer('slopeBlur', { radius: 10, strength: 0.7, threshold: 0.008, iterations: 2 }),
    ],
    textures: () => [
      makeTextureLayer('basalt', {}, { name: 'Basalt', blend: 0, mask: { enabled: false, channels: emptyMask().channels, gamma: 1, invert: false } }),
      makeTextureLayer('ash', {}, { mask: mk('slope', { slope: { lo: 0, hi: 0.36, featherLo: 0, featherHi: 0.12 }, noise: { scale: 0.01, octaves: 4, contrast: 1.3, bias: 0.45 } }) }),
      makeTextureLayer('scree', {}, { mask: mk('slope', { slope: { lo: 0.36, hi: 1.0, featherLo: 0.12, featherHi: 0 } }) }),
      makeTextureLayer('gravel', { opacity: 0.8 }, { mask: mk('deposit', { deposit: { lo: 0.55, hi: 1.0, featherLo: 0.08, featherHi: 0 } }) }),
    ],
  },
  glacier: {
    label: 'Glacier Coast',
    globals: { heightScale: 1400, worldSize: 4400, sunElevation: 26, sunAzimuth: 300, turbidity: 2.6, waterLevel: 0.14 },
    terrain: () => [
      makeTerrainLayer('constant', { value: 0.0 }, { blend: 0, name: 'Base' }),
      makeTerrainLayer('fractal', { subtype: 4, frequency: 3.0, octaves: 10, gain: 0.5, amplitude: 0.78, warp: 0.3, sharpness: 2.4, seed: 88 }, { name: 'Peaks' }),
      makeTerrainLayer('hydraulic', { droplets: 300000, steps: 70, capacity: 6.5, erodeRate: 0.32, strength: 1.05 }),
      makeTerrainLayer('thermal', { talus: 40, rate: 0.5, iterations: 24 }),
      makeTerrainLayer('slopeBlur', { radius: 12, strength: 0.8, threshold: 0.007, iterations: 2 }),
      makeTerrainLayer('snow', { amount: 0.1, line: 0.5, falloff: 0.16, slopeLimit: 52, variation: 0.6, melt: 0.35 }),
    ],
    textures: () => [
      makeTextureLayer('rock', {}, { name: 'Bedrock', blend: 0, mask: { enabled: false, channels: emptyMask().channels, gamma: 1, invert: false } }),
      makeTextureLayer('ice', {}, { mask: mk('flow', { flow: { lo: 0.30, hi: 1.0, featherLo: 0.12, featherHi: 0 }, slope: { lo: 0, hi: 0.4, featherLo: 0, featherHi: 0.14 } }) }),
      makeTextureLayer('scree', {}, { mask: mk('slope', { slope: { lo: 0.36, hi: 1.0, featherLo: 0.10, featherHi: 0 } }) }),
      makeTextureLayer('moss', { opacity: 0.8 }, { mask: mk('slope', { altitude: { lo: 0.02, hi: 0.30, featherLo: 0.02, featherHi: 0.08 }, slope: { lo: 0, hi: 0.28, featherLo: 0, featherHi: 0.1 } }) }),
      makeTextureLayer('riverstone', {}, { mask: mk('altitude', { altitude: { lo: 0, hi: 0.16, featherLo: 0, featherHi: 0.05 } }) }),
      makeTextureLayer('snow', {}, { mask: mk('slope', { altitude: { lo: 0.50, hi: 1.0, featherLo: 0.05, featherHi: 0 }, slope: { lo: 0, hi: 0.66, featherLo: 0, featherHi: 0.14 } }) }),
    ],
  },
  highlands: {
    label: 'Rolling Highlands',
    globals: { heightScale: 700, worldSize: 5000, sunElevation: 30, sunAzimuth: 160, turbidity: 3.0, waterLevel: 0.1 },
    terrain: () => [
      makeTerrainLayer('constant', { value: 0.1 }, { blend: 0, name: 'Base' }),
      makeTerrainLayer('fractal', { subtype: 0, frequency: 2.0, octaves: 9, gain: 0.5, amplitude: 0.6, warp: 0.35, seed: 17 }, { name: 'Hills' }),
      makeTerrainLayer('fractal', { subtype: 0, frequency: 11, octaves: 6, gain: 0.5, amplitude: 0.09, seed: 62 }, { name: 'Detail', blend: 1 }),
      makeTerrainLayer('hydraulic', { droplets: 240000, steps: 64, capacity: 6, erodeRate: 0.28, strength: 0.9 }),
      makeTerrainLayer('thermal', { talus: 30, rate: 0.5, iterations: 18 }),
    ],
    textures: () => [
      makeTextureLayer('dirt', {}, { name: 'Soil', blend: 0, mask: { enabled: false, channels: emptyMask().channels, gamma: 1, invert: false } }),
      makeTextureLayer('grass', {}, { mask: mk('slope', { slope: { lo: 0, hi: 0.34, featherLo: 0, featherHi: 0.12 }, noise: { scale: 0.008, octaves: 4, contrast: 1.2, bias: 0.45 } }) }),
      makeTextureLayer('forest', { opacity: 0.75 }, { mask: mk('ao', { ao: { lo: 0.45, hi: 1.0, featherLo: 0.10, featherHi: 0 }, slope: { lo: 0, hi: 0.42, featherLo: 0, featherHi: 0.14 } }) }),
      makeTextureLayer('rock', {}, { mask: mk('slope', { slope: { lo: 0.40, hi: 1.0, featherLo: 0.12, featherHi: 0 } }) }),
      makeTextureLayer('mud', {}, { mask: mk('flow', { flow: { lo: 0.38, hi: 1.0, featherLo: 0.12, featherHi: 0 } }) }),
    ],
  },
};

export function defaultGlobals() {
  return {
    res: 1024,
    renderRes: 1024,
    worldSize: 4200,
    heightScale: 1500,
    seed: 1,
    edgeFalloff: 0,
    normalize: true,
    baseDepth: 0.22,
    // lighting
    sunAzimuth: 128,
    sunElevation: 34,
    sunIntensity: 1,
    turbidity: 3.2,
    mieG: 0.76,
    msStrength: 0.85,
    skyIntensity: 1,
    ozone: 1,
    // shading
    exposure: 0,
    bloom: 0.3,
    taa: true,
    taaBlend: 0.12,
    tonemap: 0,
    vignette: 0.16,
    grain: 0.006,
    saturation: 1.04,
    shadowSoftness: 0.02,
    aoStrength: 1,
    aoRadius: 55,
    aoDirs: 8,
    aoSteps: 14,
    detailFade: 1,
    snowSSS: 0.35,
    // water
    waterOn: true,
    waterLevel: 0.08,
    waterTint: [0.055, 0.20, 0.26],
    waterAbsorb: [0.42, 0.10, 0.07],
    waveAmp: 0.02,
    waveScale: 0.55,
    // camera / post
    dof: 0,
    dofFocus: 900,
    dofMax: 1,
    debugMode: 0,
    autoBuild: true,
    resolutionScale: 1,
  };
}

export function createProject(presetKey = 'alpine') {
  const preset = PRESETS[presetKey] || PRESETS.alpine;
  return {
    version: 1,
    name: 'Untitled Terrain',
    preset: presetKey,
    globals: { ...defaultGlobals(), ...(preset.globals || {}) },
    terrain: preset.terrain(),
    textures: preset.textures(),
  };
}

export function applyPreset(project, presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) return project;
  project.preset = presetKey;
  Object.assign(project.globals, preset.globals || {});
  project.terrain = preset.terrain();
  project.textures = preset.textures();
  return project;
}

/** Clone for undo snapshots. */
export function snapshot(project) {
  return JSON.stringify({ globals: project.globals, terrain: project.terrain, textures: project.textures });
}

export function restore(project, json) {
  const data = JSON.parse(json);
  project.globals = data.globals;
  project.terrain = data.terrain;
  project.textures = data.textures;
  return project;
}
