// ─────────────────────────────────────────────────────────────────────────────
//  Layer type catalogue.
//
//  Every entry describes both how the layer is packed into the 336-byte GPU
//  record and how it is presented in the inspector, so adding a layer type is a
//  single edit.
//
//  `slot` is [vec4 index, component] into LayerParams.a  (10 vec4 = 40 floats)
//  `mslot` is [vec4 index, component] into LayerParams.m (8 vec4 = 32 floats)
// ─────────────────────────────────────────────────────────────────────────────

export const BLEND_MODES = [
  ['Set', 0], ['Add', 1], ['Subtract', 2], ['Multiply', 3], ['Minimum', 4],
  ['Maximum', 5], ['Average', 6], ['Difference', 7], ['Screen', 8], ['Overlay', 9],
];

export const F = (key, label, slot, def, min, max, step, extra = {}) =>
  ({ key, label, slot, def, min, max, step, type: 'float', ...extra });
export const I = (key, label, slot, def, min, max, step = 1, extra = {}) =>
  ({ key, label, slot, def, min, max, step, type: 'int', ...extra });
export const B = (key, label, slot, def, extra = {}) =>
  ({ key, label, slot, def, type: 'bool', ...extra });
export const E = (key, label, slot, def, options, extra = {}) =>
  ({ key, label, slot, def, type: 'enum', options, ...extra });

const OPACITY = F('opacity', 'Opacity', [8, 0], 1, 0, 1, 0.01);

// ─────────────────────────────────────────────────────────────────────────────
//  Terrain
// ─────────────────────────────────────────────────────────────────────────────
export const TERRAIN_TYPES = {
  fractal: {
    name: 'Fractal Noise', group: 'Generate', icon: 'mountain', kind: 'gen', entry: 'genFractal',
    hint: 'Layered gradient noise. The foundation of almost every terrain.',
    params: [
      E('subtype', 'Type', [9, 0], 0, [
        ['fBm', 0], ['Ridged', 1], ['Billow', 2], ['Hybrid', 3], ['Mountains', 4],
      ]),
      F('frequency', 'Scale', [0, 0], 3, 0.2, 48, 0.05, { log: true }),
      I('octaves', 'Detail', [0, 1], 8, 1, 12, 1),
      F('lacunarity', 'Lacunarity', [0, 2], 2.0, 1.2, 3.2, 0.01),
      F('gain', 'Roughness', [0, 3], 0.5, 0.2, 0.85, 0.01),
      F('amplitude', 'Height', [1, 0], 0.5, 0, 2, 0.005),
      F('offset', 'Offset', [1, 1], 0, -1, 1, 0.005),
      F('warp', 'Warp', [1, 2], 0, 0, 1.2, 0.005, { group: 'Domain' }),
      F('warpFreq', 'Warp Scale', [1, 3], 0.5, 0.05, 4, 0.01, { group: 'Domain' }),
      I('warpOctaves', 'Warp Detail', [3, 0], 3, 1, 8, 1, { group: 'Domain' }),
      F('stretch', 'Stretch', [3, 2], 1, 0.2, 5, 0.01, { group: 'Domain' }),
      F('rotate', 'Rotate', [9, 1], 0, 0, 6.2832, 0.01, { group: 'Domain' }),
      F('sharpness', 'Sharpness', [2, 1], 2.0, 0.2, 6, 0.01, { group: 'Shape' }),
      F('contrast', 'Contrast', [2, 2], 0.2, 0, 2, 0.01, { group: 'Shape' }),
      F('bias', 'Bias', [2, 3], 0, -0.5, 0.5, 0.005, { group: 'Shape' }),
      F('power', 'Power', [3, 1], 1, 0.1, 6, 0.01, { group: 'Shape' }),
      B('invert', 'Invert', [3, 3], false, { group: 'Shape' }),
      F('seed', 'Seed', [2, 0], 1, 0, 9999, 1),
    ],
  },
  cellular: {
    name: 'Cellular', group: 'Generate', icon: 'cells', kind: 'gen', entry: 'genCellular',
    hint: 'Worley cells — plateaus, cracks and pebble fields.',
    params: [
      E('subtype', 'Type', [9, 0], 1, [['Inverse F1', 0], ['Cell Edges', 1], ['F1', 2]]),
      F('frequency', 'Scale', [0, 0], 6, 0.5, 64, 0.1, { log: true }),
      F('amplitude', 'Height', [1, 0], 0.4, 0, 2, 0.005),
      F('offset', 'Offset', [1, 1], 0, -1, 1, 0.005),
      F('contrast', 'Contrast', [2, 2], 0, 0, 2, 0.01),
      F('bias', 'Bias', [2, 3], 0, -0.5, 0.5, 0.005),
      F('seed', 'Seed', [2, 0], 3, 0, 9999, 1),
    ],
  },
  crater: {
    name: 'Craters', group: 'Generate', icon: 'crater', kind: 'gen', entry: 'genCrater',
    hint: 'Impact bowls with raised rims and central peaks.',
    params: [
      F('radius', 'Radius', [0, 0], 0.12, 0.01, 0.6, 0.005),
      I('count', 'Count', [4, 0], 4, 1, 24, 1),
      F('amplitude', 'Depth', [1, 0], 0.25, 0, 1, 0.005),
      F('offset', 'Offset', [1, 1], 0, -1, 1, 0.005),
      F('stretch', 'Stretch', [3, 2], 1, 0.3, 3, 0.01),
      F('seed', 'Seed', [2, 0], 7, 0, 9999, 1),
    ],
  },
  dune: {
    name: 'Dunes', group: 'Generate', icon: 'wind', kind: 'gen', entry: 'genDune',
    hint: 'Asymmetric wind-blown crests with a slip face.',
    params: [
      F('frequency', 'Scale', [0, 0], 12, 1, 80, 0.1, { log: true }),
      F('direction', 'Direction', [3, 2], 0.15, 0, 1, 0.005),
      F('asymmetry', 'Asymmetry', [3, 1], 0.7, 0, 1, 0.01),
      F('warp', 'Meander', [1, 2], 0.6, 0, 2, 0.01),
      F('warpFreq', 'Meander Scale', [1, 3], 2, 0.1, 8, 0.01),
      F('amplitude', 'Height', [1, 0], 0.3, 0, 2, 0.005),
      F('offset', 'Offset', [1, 1], 0, -1, 1, 0.005),
      F('contrast', 'Contrast', [2, 2], 0, 0, 2, 0.01),
      F('seed', 'Seed', [2, 0], 11, 0, 9999, 1),
    ],
  },
  constant: {
    name: 'Constant', group: 'Generate', icon: 'plane', kind: 'gen', entry: 'genConst',
    hint: 'A flat value — useful as a base or a fill.',
    params: [F('value', 'Height', [1, 0], 0.2, 0, 1, 0.005)],
  },

  thermal: {
    name: 'Thermal Erosion', group: 'Erode', icon: 'talus', kind: 'filter', entry: 'erodeThermal',
    hint: 'Slumping above the angle of repose. Rounds ridges into scree.',
    params: [
      F('talus', 'Repose Angle', [0, 0], 34, 1, 89, 0.5, { unit: '°', convert: true }),
      F('rate', 'Rate', [0, 1], 0.5, 0.02, 1, 0.01),
      I('iterations', 'Iterations', [9, 2], 24, 1, 300, 1),
    ],
    iterationsKey: 'iterations',
  },
  hydraulic: {
    name: 'Hydraulic Erosion', group: 'Erode', icon: 'droplet', kind: 'filter', entry: 'erodeDroplet',
    hint: 'Particle-based water erosion: carved channels and sediment fans.',
    params: [
      I('droplets', 'Droplets', [0, 3], 260000, 1000, 6000000, 1000, { log: true }),
      I('steps', 'Path Length', [1, 0], 64, 8, 256, 1),
      F('inertia', 'Inertia', [1, 1], 0.08, 0, 0.9, 0.01),
      F('capacity', 'Capacity', [1, 2], 6, 0.2, 40, 0.1),
      F('minSlope', 'Min Slope', [1, 3], 0.006, 0.0005, 0.1, 0.0005),
      F('erodeRate', 'Erosion', [2, 1], 0.32, 0, 1, 0.005),
      F('depositRate', 'Deposition', [2, 0], 0.28, 0, 1, 0.005),
      F('evaporate', 'Evaporation', [2, 2], 0.014, 0, 0.2, 0.001),
      F('gravity', 'Gravity', [2, 3], 5, 0.5, 20, 0.1),
      I('radius', 'Brush', [3, 0], 2, 1, 4, 1),
      F('strength', 'Strength', [3, 1], 1, 0, 4, 0.01),
      F('smoothing', 'Smoothing', [0, 3], 0.35, 0, 1, 0.01),
      F('flowGamma', 'Flow Gamma', [0, 1], 0.55, 0.05, 2, 0.01),
      F('depositScale', 'Mask Scale', [4, 0], 26, 1, 200, 0.5),
    ],
  },
  carve: {
    name: 'River Carve', group: 'Erode', icon: 'river', kind: 'filter', entry: 'filterCarve',
    hint: 'Deepens channels along the accumulated flow network.',
    params: [
      F('depth', 'Depth', [0, 0], 0.05, 0, 0.4, 0.001),
      F('width', 'Width', [0, 1], 0.7, 0.05, 4, 0.01),
      F('sharpen', 'V-Cut', [0, 2], 0.4, 0, 3, 0.01),
    ],
    needsFlow: true,
  },
  slopeBlur: {
    name: 'Slope Blur', group: 'Shape', icon: 'blur', kind: 'filter', entry: 'filterSlopeBlurH',
    hint: 'Height-aware blur — the signature Gaea operator for talus and snow.',
    params: [
      I('radius', 'Radius', [0, 0], 12, 1, 48, 1),
      F('strength', 'Strength', [0, 1], 1, 0, 1, 0.01),
      F('threshold', 'Slope Threshold', [0, 2], 0.006, 0.0002, 0.1, 0.0002),
      I('iterations', 'Iterations', [9, 2], 2, 1, 16, 1),
    ],
    iterationsKey: 'iterations',
  },
  blur: {
    name: 'Smooth', group: 'Shape', icon: 'smooth', kind: 'filter', entry: 'filterBlurH',
    params: [
      I('radius', 'Radius', [0, 0], 6, 1, 48, 1),
      F('strength', 'Strength', [0, 1], 1, 0, 1, 0.01),
    ],
  },
  sharpen: {
    name: 'Sharpen', group: 'Shape', icon: 'sharpen', kind: 'filter', entry: 'filterSharpen',
    params: [F('strength', 'Strength', [0, 0], 0.5, 0, 3, 0.01)],
  },
  terrace: {
    name: 'Terrace', group: 'Shape', icon: 'terrace', kind: 'filter', entry: 'filterTerrace',
    hint: 'Stepped plateaus, with per-step thickness variation.',
    params: [
      F('steps', 'Steps', [0, 0], 12, 1, 120, 1),
      F('smoothness', 'Smoothness', [0, 1], 0.25, 0, 1, 0.01),
      F('offset', 'Offset', [0, 2], 0, -1, 1, 0.005),
      F('variation', 'Variation', [0, 3], 0.3, 0, 1, 0.01),
      F('noiseFreq', 'Noise Scale', [1, 0], 4, 0.2, 24, 0.1),
      F('seed', 'Seed', [2, 0], 5, 0, 9999, 1),
    ],
  },
  strata: {
    name: 'Strata', group: 'Shape', icon: 'strata', kind: 'filter', entry: 'filterStrata',
    hint: 'Warped sedimentary beds with eroded edges — canyon walls.',
    params: [
      F('frequency', 'Layers', [0, 0], 18, 1, 120, 0.5),
      F('amount', 'Amount', [0, 1], 0.85, 0, 1, 0.01),
      F('warp', 'Warp', [0, 2], 0.6, 0, 4, 0.01),
      F('offset', 'Offset', [0, 3], 0, -1, 1, 0.005),
      F('sharpness', 'Sharpness', [1, 1], 0.4, 0, 1, 0.01),
      F('erode', 'Edge Erosion', [1, 2], 0.5, 0, 2, 0.01),
      F('noiseFreq', 'Noise Scale', [1, 0], 3, 0.2, 24, 0.1),
      F('seed', 'Seed', [2, 0], 9, 0, 9999, 1),
    ],
  },
  curve: {
    name: 'Curve', group: 'Shape', icon: 'curve', kind: 'filter', entry: 'filterCurve',
    hint: 'Levels, gamma and contrast — regrade the height field.',
    params: [
      F('inBlack', 'Input Black', [0, 0], 0, 0, 1, 0.005),
      F('inWhite', 'Input White', [0, 1], 1, 0, 1, 0.005),
      F('outBlack', 'Output Black', [0, 2], 0, 0, 1, 0.005),
      F('outWhite', 'Output White', [0, 3], 1, 0, 1, 0.005),
      F('gamma', 'Gamma', [1, 0], 1, 0.1, 4, 0.01),
      F('contrast', 'Contrast', [1, 1], 0, -1, 2, 0.01),
      F('power', 'Power', [2, 1], 1, 0.1, 6, 0.01),
      B('invert', 'Invert', [1, 2], false),
      F('clampLo', 'Clamp Low', [1, 3], -8, -8, 8, 0.05),
      F('clampHi', 'Clamp High', [2, 0], 8, -8, 8, 0.05),
    ],
  },
  warp: {
    name: 'Warp', group: 'Shape', icon: 'warp', kind: 'filter', entry: 'filterWarp',
    hint: 'Displace the whole field for that fluid, wind-carved look.',
    params: [
      F('frequency', 'Scale', [0, 0], 2, 0.1, 24, 0.01),
      F('amount', 'Amount', [0, 1], 0.03, 0, 0.4, 0.001),
      I('octaves', 'Detail', [0, 2], 3, 1, 8, 1),
      F('seed', 'Seed', [2, 0], 13, 0, 9999, 1),
    ],
  },
  snow: {
    name: 'Snow', group: 'Shape', icon: 'snow', kind: 'filter', entry: 'filterSnow',
    hint: 'Accumulate snow above a line, on slopes below the Avalanche angle.',
    params: [
      F('amount', 'Amount', [0, 0], 0.08, 0, 0.5, 0.002),
      F('line', 'Snow Line', [0, 1], 0.55, 0, 1, 0.005),
      F('falloff', 'Falloff', [0, 2], 0.12, 0.005, 0.5, 0.005),
      F('slopeLimit', 'Max Slope', [0, 3], 50, 5, 90, 1, { unit: '°', convert: 'rad' }),
      F('variation', 'Drift', [1, 1], 0.4, 0, 1, 0.01),
      F('driftScale', 'Drift Scale', [1, 3], 4, 0.5, 24, 0.1),
      F('melt', 'Melt', [1, 2], 0.5, 0, 1, 0.01),
      F('seed', 'Seed', [2, 0], 17, 0, 9999, 1),
    ],
  },
  clamp: {
    name: 'Clamp', group: 'Shape', icon: 'clamp', kind: 'filter', entry: 'filterClamp',
    params: [
      F('min', 'Minimum', [0, 0], 0, -1, 2, 0.005),
      F('max', 'Maximum', [0, 1], 1, -1, 2, 0.005),
      F('softness', 'Softness', [0, 2], 0.02, 0.0005, 0.5, 0.005),
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  Texture / material layers
// ─────────────────────────────────────────────────────────────────────────────
export const MATERIALS = [
  { id: 0, key: 'rock', name: 'Alpine Rock', color: [0.42, 0.40, 0.38], color2: [0.26, 0.25, 0.24] },
  { id: 1, key: 'sediment', name: 'Sedimentary', color: [0.44, 0.34, 0.24], color2: [0.30, 0.27, 0.23] },
  { id: 2, key: 'basalt', name: 'Basalt', color: [0.15, 0.15, 0.16], color2: [0.09, 0.09, 0.10] },
  { id: 3, key: 'scree', name: 'Scree', color: [0.40, 0.38, 0.36], color2: [0.24, 0.23, 0.22] },
  { id: 4, key: 'gravel', name: 'Gravel', color: [0.38, 0.36, 0.34], color2: [0.22, 0.21, 0.20] },
  { id: 5, key: 'sand', name: 'Sand', color: [0.74, 0.66, 0.51], color2: [0.60, 0.52, 0.39] },
  { id: 6, key: 'dune', name: 'Dune Sand', color: [0.82, 0.73, 0.56], color2: [0.66, 0.57, 0.42] },
  { id: 7, key: 'dirt', name: 'Dirt', color: [0.33, 0.25, 0.18], color2: [0.20, 0.15, 0.11] },
  { id: 8, key: 'drygrass', name: 'Dry Grass', color: [0.46, 0.41, 0.24], color2: [0.30, 0.27, 0.17] },
  { id: 9, key: 'grass', name: 'Meadow Grass', color: [0.24, 0.33, 0.16], color2: [0.14, 0.21, 0.10] },
  { id: 10, key: 'moss', name: 'Moss', color: [0.16, 0.26, 0.12], color2: [0.09, 0.16, 0.08] },
  { id: 11, key: 'forest', name: 'Forest Floor', color: [0.20, 0.15, 0.10], color2: [0.11, 0.09, 0.07] },
  { id: 12, key: 'snow', name: 'Snow', color: [0.90, 0.93, 0.97], color2: [0.74, 0.80, 0.88] },
  { id: 13, key: 'ice', name: 'Ice', color: [0.62, 0.74, 0.82], color2: [0.42, 0.56, 0.68] },
  { id: 14, key: 'mud', name: 'Mud', color: [0.24, 0.19, 0.14], color2: [0.13, 0.11, 0.09] },
  { id: 15, key: 'riverstone', name: 'River Stone', color: [0.36, 0.35, 0.34], color2: [0.22, 0.21, 0.21] },
  { id: 16, key: 'ash', name: 'Ash', color: [0.48, 0.47, 0.46], color2: [0.31, 0.31, 0.31] },
  { id: 17, key: 'beachsand', name: 'Beach Sand', color: [0.80, 0.75, 0.63], color2: [0.64, 0.59, 0.48] },
  { id: 18, key: 'clay', name: 'Clay', color: [0.52, 0.33, 0.24], color2: [0.36, 0.22, 0.16] },
];

export const MATERIAL_BY_KEY = Object.fromEntries(MATERIALS.map((m) => [m.key, m]));

// Shared material parameter descriptors (slot layout matches materials.wgsl)
export const MATERIAL_PARAMS = [
  F('scale', 'Feature Scale', [0, 0], 0.35, 0.01, 4, 0.005, { group: 'Relief', log: true }),
  F('detail', 'Detail Scale', [0, 1], 2.4, 0.1, 24, 0.05, { group: 'Relief', log: true }),
  F('macro', 'Macro Scale', [0, 2], 0.03, 0.002, 1, 0.002, { group: 'Relief', log: true }),
  F('relief', 'Relief', [1, 0], 0.16, 0, 1.2, 0.005, { group: 'Relief', unit: ' m' }),
  F('roughness', 'Roughness', [1, 1], 0.85, 0.03, 1, 0.01, { group: 'Surface' }),
  F('roughVar', 'Roughness Var', [1, 2], 0.08, 0, 0.5, 0.005, { group: 'Surface' }),
  F('contrast', 'Contrast', [2, 0], 0.35, 0, 2, 0.01, { group: 'Colour' }),
  F('colorVar', 'Variation', [2, 1], 0.5, 0, 1, 0.01, { group: 'Colour' }),
  F('saturation', 'Saturation', [2, 2], 1, 0, 2, 0.01, { group: 'Colour' }),
  F('wetness', 'Wetness', [2, 3], 0, 0, 1, 0.01, { group: 'Surface' }),
  F('featureFreq', 'Feature Freq', [3, 0], 1.2, 0.05, 12, 0.01, { group: 'Features', log: true }),
  F('featureSharp', 'Feature Sharp', [3, 1], 0.5, 0, 1, 0.01, { group: 'Features' }),
  F('bandFreq', 'Band Freq', [3, 2], 1.0, 0.02, 12, 0.01, { group: 'Features', log: true }),
  F('bandAmp', 'Band Strength', [3, 3], 0.4, 0, 1, 0.01, { group: 'Features' }),
  F('grainFreq', 'Grain', [4, 0], 8, 0.5, 48, 0.1, { group: 'Features', log: true }),
  F('grainAmp', 'Grain Amount', [4, 1], 0.5, 0, 1, 0.01, { group: 'Features' }),
  F('sparkle', 'Sparkle', [4, 2], 0, 0, 1, 0.01, { group: 'Features' }),
  F('seed', 'Seed', [0, 3], 1, 0, 9999, 1, { group: 'Relief' }),
];

export const TEXTURE_DEFAULTS = {
  scale: 0.35, detail: 2.4, macro: 0.03, relief: 0.16, roughness: 0.85,
  roughVar: 0.08, contrast: 0.35, colorVar: 0.5, saturation: 1, wetness: 0,
  featureFreq: 1.2, featureSharp: 0.5, bandFreq: 1.0, bandAmp: 0.4,
  grainFreq: 8, grainAmp: 0.5, sparkle: 0, seed: 1,
};

/** Per-material overrides so each preset starts from a sensible place. */
export const MATERIAL_PRESETS = {
  rock: { scale: 0.32, detail: 2.6, relief: 0.22, roughness: 0.86, roughVar: 0.10, featureFreq: 1.1, featureSharp: 0.55, bandFreq: 1.4, bandAmp: 0.45, grainFreq: 9, grainAmp: 0.6 },
  sediment: { scale: 0.30, detail: 2.2, relief: 0.16, roughness: 0.90, roughVar: 0.08, featureFreq: 1.0, bandFreq: 3.2, bandAmp: 0.7, grainFreq: 12, grainAmp: 0.45 },
  basalt: { scale: 0.40, detail: 3.0, relief: 0.18, roughness: 0.72, roughVar: 0.09, featureFreq: 2.4, featureSharp: 0.35, grainFreq: 16, grainAmp: 0.5 },
  scree: { scale: 1.6, detail: 4.0, relief: 0.30, roughness: 0.90, roughVar: 0.10, featureFreq: 1.0, grainFreq: 20, grainAmp: 0.7 },
  gravel: { scale: 2.2, detail: 5.0, relief: 0.24, roughness: 0.82, roughVar: 0.09, featureFreq: 1.0, grainFreq: 24, grainAmp: 0.5 },
  sand: { scale: 0.20, detail: 3.0, relief: 0.05, roughness: 0.95, roughVar: 0.03, featureFreq: 6.0, bandAmp: 0.2, grainFreq: 30, grainAmp: 0.35 },
  dune: { scale: 0.12, detail: 3.2, relief: 0.05, roughness: 0.95, roughVar: 0.03, featureFreq: 1.1, grainFreq: 26, grainAmp: 0.3 },
  dirt: { scale: 0.9, detail: 3.4, relief: 0.14, roughness: 0.95, roughVar: 0.07, featureFreq: 1.0, grainFreq: 18, grainAmp: 0.6 },
  drygrass: { scale: 1.4, detail: 8.0, relief: 0.20, roughness: 0.90, roughVar: 0.08, grainFreq: 26, grainAmp: 0.5 },
  grass: { scale: 1.5, detail: 9.0, relief: 0.22, roughness: 0.86, roughVar: 0.08, grainFreq: 28, grainAmp: 0.5 },
  moss: { scale: 1.8, detail: 7.0, relief: 0.16, roughness: 0.96, roughVar: 0.05, grainFreq: 30, grainAmp: 0.6 },
  forest: { scale: 1.2, detail: 6.0, relief: 0.18, roughness: 0.95, roughVar: 0.07, grainFreq: 24, grainAmp: 0.6 },
  snow: { scale: 0.5, detail: 3.0, relief: 0.09, roughness: 0.38, roughVar: 0.10, grainFreq: 14, grainAmp: 0.25, sparkle: 0.22, contrast: 0.15, colorVar: 0.25 },
  ice: { scale: 0.4, detail: 2.4, relief: 0.08, roughness: 0.16, roughVar: 0.06, featureFreq: 1.6, featureSharp: 0.3, grainFreq: 12, grainAmp: 0.2 },
  mud: { scale: 0.8, detail: 2.8, relief: 0.10, roughness: 0.52, roughVar: 0.06, featureFreq: 2.2, featureSharp: 0.4, wetness: 0.6, grainFreq: 14, grainAmp: 0.4 },
  riverstone: { scale: 2.0, detail: 4.5, relief: 0.26, roughness: 0.30, roughVar: 0.08, wetness: 0.8, grainFreq: 22, grainAmp: 0.4 },
  ash: { scale: 0.6, detail: 3.0, relief: 0.12, roughness: 0.98, roughVar: 0.04, grainFreq: 20, grainAmp: 0.55 },
  beachsand: { scale: 0.25, detail: 3.0, relief: 0.05, roughness: 0.88, roughVar: 0.05, featureFreq: 4.0, grainFreq: 28, grainAmp: 0.35 },
  clay: { scale: 0.5, detail: 2.6, relief: 0.10, roughness: 0.62, roughVar: 0.07, featureFreq: 2.6, featureSharp: 0.3, grainFreq: 16, grainAmp: 0.35 },
};

// ── mask channel descriptors (slot layout matches lib.wgsl evalMask) ─────────
export const MASK_CHANNELS = [
  {
    key: 'altitude', label: 'Altitude', bit: 1,
    lo: [0, 0], hi: [0, 1], featherLo: [0, 2], featherHi: [0, 3],
    def: [0.0, 1.0, 0.06, 0.06], min: 0, max: 1, step: 0.005, feather: true,
  },
  {
    key: 'slope', label: 'Slope', bit: 2,
    lo: [1, 0], hi: [1, 1], featherLo: [1, 2], featherHi: [1, 3],
    def: [0.0, 1.0, 0.06, 0.06], min: 0, max: 1, step: 0.005, feather: true, unit: '°', scale: 90,
  },
  {
    key: 'curvature', label: 'Curvature', bit: 4,
    lo: [2, 0], hi: [2, 1], featherLo: [2, 2], featherHi: [2, 3],
    def: [0.0, 1.0, 0.08, 0.08], min: 0, max: 1, step: 0.005, feather: true,
  },
  {
    key: 'flow', label: 'Flow', bit: 8,
    lo: [3, 0], hi: [3, 1], featherLo: [3, 2], featherHi: [3, 3],
    def: [0.0, 1.0, 0.05, 0.05], min: 0, max: 1, step: 0.005, feather: true,
  },
  {
    key: 'deposit', label: 'Deposition', bit: 64,
    lo: [6, 0], hi: [6, 1], featherLo: [6, 2], featherHi: [6, 3],
    def: [0.0, 1.0, 0.08, 0.08], min: 0, max: 1, step: 0.005, feather: true,
  },
  {
    key: 'ao', label: 'Occlusion', bit: 128,
    lo: [7, 0], hi: [7, 1], featherLo: [7, 2], featherHi: [7, 3],
    def: [0.0, 1.0, 0.08, 0.08], min: 0, max: 1, step: 0.005, feather: true,
  },
  {
    key: 'noise', label: 'Noise', bit: 16,
    scale: [4, 0], octaves: [4, 1], contrast: [4, 2], bias: [4, 3], seed: [5, 3],
    def: [0.02, 4, 1.0, 0.5, 1], noise: true,
  },
  {
    key: 'aspect', label: 'Aspect', bit: 32,
    angle: [5, 0], width: [5, 1], feather: [5, 2],
    def: [0.0, 0.25, 0.12], aspect: true,
  },
];

export const MASK_GLOBAL = { gamma: [7, 3] };
export const MASK_INVERT_BIT = 256;

// ─────────────────────────────────────────────────────────────────────────────
//  UI-facing helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Ordered group list for the terrain add-menu. */
export const TERRAIN_GROUPS = ['Generate', 'Erode', 'Shape'];

/** The texture stack is a stack of material paint layers. */
export const TEXTURE_TYPES = {
  material: {
    name: 'Material', group: 'Paint', icon: 'layers', kind: 'paint',
    hint: 'Paints a physically-shaded surface material, masked by the terrain.',
  },
};
export const TEXTURE_GROUPS = ['Paint'];

export const layerInfo = (kind) => TERRAIN_TYPES[kind] || TEXTURE_TYPES[kind] || null;

/** Parameter descriptors for a layer, with the extra ui-only entries appended. */
export function paramsOf(layer) {
  if (!layer) return [];
  const def = TERRAIN_TYPES[layer.type];
  if (!def) return MATERIAL_PARAMS;
  const list = def.params.slice();
  if (layer.type !== 'constant') {
    list.push(F('opacity', 'Opacity', [8, 0], 1, 0, 1, 0.01));
  }
  return list;
}

/** Rough relative cost of a layer, used for the build estimate. */
export function layerCost(layer) {
  const def = TERRAIN_TYPES[layer.type];
  if (!def) return 0;
  if (layer.type === 'hydraulic') return 12 + (layer.params.droplets || 0) / 90000;
  if (layer.type === 'thermal') return 4 + (layer.params.iterations || 0) * 0.12;
  if (layer.type === 'slopeBlur') return 4 + (layer.params.iterations || 0) * 0.5;
  if (def.kind === 'gen') return 2;
  if (layer.type === 'carve') return 2;
  return 1;
}
