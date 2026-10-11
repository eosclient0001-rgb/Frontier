// =================================================================================================
//  terrain-schema.js — the TERRAIN STACK vocabulary
// -------------------------------------------------------------------------------------------------
//  Every entry describes one layer kind: the op code the compute shader switches on, the controls
//  the inspector draws, the defaults, and which uniform slot each control writes to. The UI never
//  hard-codes a control and the shader never sees a name — the slot map is the only contract.
//
//  Slot names match terrain-ops.wgsl:
//    a frequency · lacunarity · gain · warpStrength
//    b fractType · sharpness · amplitude · offset
//    c warpFreq · slopeMin · slopeMax · feather
//    d steps · smoothness · amount · radius
//    e posX · posZ · radiusWorld · heightWorld
//    f craterRadius · craterDepth · roughness · gamma
// =================================================================================================

export const BLEND_MODES = [
  { id: 0, label: 'Replace' },
  { id: 1, label: 'Add' },
  { id: 2, label: 'Subtract' },
  { id: 3, label: 'Multiply' },
  { id: 4, label: 'Max' },
  { id: 5, label: 'Min' },
  { id: 6, label: 'Screen' },
];

export const MASK_MODES = [
  { id: 0, label: 'Everywhere' },
  { id: 1, label: 'Altitude' },
  { id: 2, label: 'Slope' },
  { id: 3, label: 'Curvature' },
  { id: 4, label: 'Fractal noise' },
  { id: 5, label: 'Flow / wetness' },
  { id: 6, label: 'Radial' },
];

export const NOISE_TYPES = [
  { id: 0, label: 'fBm' },
  { id: 1, label: 'Ridged' },
  { id: 2, label: 'Billow' },
  { id: 3, label: 'Voronoi mesas' },
];

const f = (key, label, def, min, max, step, unit = '', hint = '') => ({
  key, label, def, min, max, step, unit, hint,
});
const sel = (key, label, def, options, hint = '') => ({ key, label, def, options, type: 'select', hint });
const int = (key, label, def, min, max, hint = '') => ({ key, label, def, min, max, step: 1, type: 'int', hint });

// Every layer carries these, whatever its kind.
export const maskFields = () => [
  sel('maskMode', 'Limit to', 0, MASK_MODES, 'Where this layer is allowed to act.'),
  f('maskMin', 'Range low', 0.0, 0, 1, 0.005, '', 'Lower edge of the band.'),
  f('maskMax', 'Range high', 1.0, 0, 1, 0.005, '', 'Upper edge of the band.'),
  f('maskFeather', 'Feather', 0.08, 0.001, 0.5, 0.005, '', 'Softens both edges of the band.'),
  f('maskContrast', 'Noise contrast', 1.0, 0.2, 4, 0.05, '', 'Only used by the noise mask.'),
  f('maskNoiseScale', 'Noise scale', 4.0, 0.5, 24, 0.1, '', 'Features across the terrain.'),
  int('maskNoiseSeed', 'Noise seed', 17, 0, 9999),
  { key: 'maskInvert', label: 'Invert mask', def: false, type: 'toggle' },
];

export const TERRAIN_OPS = {
  fractal: {
    key: 'fractal',
    label: 'Fractal Terrain',
    group: 'Generate',
    icon: 'Mountain',
    accent: '#d6a078',
    blurb: 'Stacked noise octaves. The foundation nearly every terrain starts from.',
    op: 1,
    defaults: {
      type: 1, seed: 1284, octaves: 9, frequency: 2.6, lacunarity: 2.02, gain: 0.5,
      warp: 0.35, warpFreq: 0.8, sharpness: 2.0, amplitude: 0.55, offset: 0.42, invert: false,
    },
    fields: [
      sel('type', 'Noise type', 1, NOISE_TYPES),
      int('seed', 'Seed', 1284, 0, 99999, 'Same seed always yields the same mountains.'),
      int('octaves', 'Octaves', 9, 1, 14, 'Each octave adds detail at twice the frequency.'),
      f('frequency', 'Feature scale', 2.6, 0.3, 14, 0.05, '', 'Landforms across the whole tile.'),
      f('lacunarity', 'Lacunarity', 2.02, 1.4, 3.6, 0.01, '', 'Frequency multiplier per octave.'),
      f('gain', 'Roughness', 0.5, 0.25, 0.78, 0.01, '', 'Amplitude retained per octave.'),
      f('warp', 'Domain warp', 0.35, 0, 1.2, 0.01, '', 'Bends ridges into hooked, branching shapes.'),
      f('warpFreq', 'Warp scale', 0.8, 0.1, 4, 0.05),
      f('sharpness', 'Ridge sharpness', 2.0, 0.2, 5, 0.05, '', 'Ridged type only.'),
      f('amplitude', 'Height', 0.55, 0, 1.2, 0.01),
      f('offset', 'Base level', 0.42, 0, 1, 0.01),
      { key: 'invert', label: 'Invert', def: false, type: 'toggle' },
    ],
    slots: [
      ['a', 0, 'frequency'], ['a', 1, 'lacunarity'], ['a', 2, 'gain'], ['a', 3, 'warp'],
      ['b', 0, 'type'], ['b', 1, 'sharpness'], ['b', 2, 'amplitude'], ['b', 3, 'offset'],
      ['c', 0, 'warpFreq'],
    ],
    flags: { invert: 1 },
    octavesKey: 'octaves',
  },

  erosion: {
    key: 'erosion',
    label: 'Hydraulic Erosion',
    group: 'Erode',
    icon: 'Waves',
    accent: '#7fb6cf',
    blurb: 'Water gathers, accelerates, cuts and deposits. The solver that makes terrain believable.',
    special: 'erosion',
    defaults: {
      iterations: 320, rain: 0.55, evaporate: 0.016, capacity: 0.5, dissolve: 0.42,
      deposit: 0.36, thermal: 0.35, talusAngle: 34,
      flow: 0.85, seed: 91,
    },
    fields: [
      int('iterations', 'Solver passes', 320, 8, 1200, 'More passes cut deeper, connected drainage.'),
      f('rain', 'Rainfall', 0.55, 0, 2, 0.01, '', 'Water added to every cell each pass.'),
      f('flow', 'Flow rate', 0.85, 0.05, 2, 0.01, '', 'How freely water moves downhill.'),
      f('dissolve', 'Erosion rate', 0.42, 0, 1, 0.01, '', 'How fast flowing water lifts material.'),
      f('capacity', 'Sediment capacity', 0.5, 0, 2, 0.01, '', 'How much a given flow can carry.'),
      f('deposit', 'Deposition', 0.36, 0, 1, 0.01, '', 'How fast carried material settles out.'),
      f('evaporate', 'Evaporation', 0.016, 0, 0.08, 0.001, '', 'Water lost to air each pass.'),
      f('thermal', 'Talus slumping', 0.35, 0, 1, 0.01, '', 'Collapses slopes steeper than the repose angle.'),
      f('talusAngle', 'Angle of repose', 34, 5, 70, 0.5, '°', 'Material cannot rest steeper than this.'),
      int('seed', 'Seed', 91, 0, 99999),
    ],
  },

  thermal: {
    key: 'thermal',
    label: 'Thermal Erosion',
    group: 'Erode',
    icon: 'Layers',
    accent: '#c29583',
    blurb: 'Slumping. Rounds off anything steeper than the angle of repose.',
    op: 7,
    iterations: true,
    defaults: { talusAngle: 33, rate: 0.5, iterations: 40 },
    fields: [
      f('talusAngle', 'Angle of repose', 33, 3, 70, 0.5, '°'),
      f('rate', 'Rate', 0.5, 0.02, 1, 0.01),
      int('iterations', 'Passes', 40, 1, 400),
    ],
    // c.x carries the repose angle; the shader works in radians.
    slots: [
      ['c', 0, 'talusAngle', (v) => (v * Math.PI) / 180],
      ['d', 2, 'rate'],
    ],
  },

  river: {
    key: 'river',
    label: 'River Carving',
    group: 'Erode',
    icon: 'Waves',
    accent: '#6fa9c4',
    blurb: 'Deepens the lines that already read as drainage, then relaxes the banks.',
    op: 8,
    defaults: { depth: 0.035, exponent: 1.5, valley: 1.0, iterations: 3 },
    fields: [
      f('depth', 'Channel depth', 0.035, 0, 0.2, 0.001),
      f('exponent', 'Focus', 1.5, 0.2, 5, 0.05, '', 'Higher keeps the cut inside the deepest lines.'),
      f('valley', 'Valley sensitivity', 1.0, 0.05, 3, 0.05),
      int('iterations', 'Passes', 3, 1, 24),
    ],
    slots: [['d', 2, 'depth'], ['c', 1, 'exponent'], ['c', 2, 'valley']],
  },

  sediment: {
    key: 'sediment',
    label: 'Sediment Deposit',
    group: 'Erode',
    icon: 'Layers',
    accent: '#bfa77c',
    blurb: 'Fills basins and flats with what the water dropped.',
    op: 9,
    defaults: { thickness: 0.04, slopeMin: 0.04, slopeMax: 0.32, altitudeMax: 0.6, scale: 6, seed: 402 },
    fields: [
      f('thickness', 'Thickness', 0.04, 0, 0.25, 0.001),
      f('slopeMin', 'Full below slope', 0.04, 0, 1, 0.01),
      f('slopeMax', 'None above slope', 0.32, 0, 1, 0.01),
      f('altitudeMax', 'Fade out above', 0.6, 0, 1.5, 0.01),
      f('scale', 'Variation scale', 6, 1, 24, 0.1),
      int('seed', 'Seed', 402, 0, 99999),
    ],
    slots: [['d', 2, 'thickness'], ['c', 1, 'slopeMin'], ['c', 2, 'slopeMax'], ['b', 3, 'altitudeMax'], ['a', 0, 'scale']],
  },

  snow: {
    key: 'snow',
    label: 'Snow Accumulation',
    group: 'Deposit',
    icon: 'Snowflake',
    accent: '#a4c6e6',
    blurb: 'Settles on high, flat ground and drifts with the wind.',
    op: 10,
    defaults: { amount: 0.06, altitude: 0.62, feather: 0.06, slopeMin: 0.45, slopeMax: 0.85, scale: 8, wind: 0.3, seed: 55 },
    fields: [
      f('amount', 'Depth', 0.06, 0, 0.3, 0.001),
      f('altitude', 'Snow line', 0.62, 0, 1, 0.005),
      f('feather', 'Transition', 0.06, 0.001, 0.3, 0.005),
      f('slopeMin', 'Full below slope', 0.45, 0, 1, 0.01),
      f('slopeMax', 'None above slope', 0.85, 0, 1, 0.01),
      f('scale', 'Drift scale', 8, 1, 30, 0.1),
      f('wind', 'Wind drift', 0.3, 0, 1, 0.01),
      int('seed', 'Seed', 55, 0, 99999),
    ],
    slots: [
      ['d', 2, 'amount'], ['b', 3, 'altitude'], ['c', 3, 'feather'],
      ['c', 1, 'slopeMin'], ['c', 2, 'slopeMax'], ['a', 0, 'scale'], ['a', 3, 'wind'],
    ],
  },

  warp: {
    key: 'warp',
    label: 'Domain Warp',
    group: 'Shape',
    icon: 'Wind',
    accent: '#b39ddb',
    blurb: 'Displaces the field sideways. Turns straight ridges into organic ones.',
    op: 2,
    defaults: { frequency: 2.5, strength: 0.3, octaves: 4, seed: 771 },
    fields: [
      f('frequency', 'Warp scale', 2.5, 0.2, 10, 0.05),
      f('strength', 'Strength', 0.3, 0, 1, 0.01, '', 'Displacement as a fraction of the tile.'),
      int('octaves', 'Detail', 4, 1, 6),
      int('seed', 'Seed', 771, 0, 99999),
    ],
    slots: [['a', 0, 'frequency'], ['a', 3, 'strength']],
    octavesKey: 'octaves',
  },

  terrace: {
    key: 'terrace',
    label: 'Terrace',
    group: 'Shape',
    icon: 'Layers',
    accent: '#d0b070',
    blurb: 'Steps the surface, but leaves cliffs alone.',
    op: 3,
    defaults: { steps: 14, smoothness: 0.25, offset: 0, slopeMin: 0.35, slopeMax: 0.8 },
    fields: [
      f('steps', 'Steps', 14, 2, 80, 1),
      f('smoothness', 'Smoothness', 0.25, 0, 1, 0.01, '', 'Blends the edge of each step.'),
      f('offset', 'Phase', 0, 0, 1, 0.01),
      f('slopeMin', 'Full below slope', 0.35, 0, 1, 0.01),
      f('slopeMax', 'None above slope', 0.8, 0, 1, 0.01),
    ],
    slots: [['d', 0, 'steps'], ['d', 1, 'smoothness'], ['b', 3, 'offset'], ['c', 1, 'slopeMin'], ['c', 2, 'slopeMax']],
  },

  plateau: {
    key: 'plateau',
    label: 'Plateau',
    group: 'Shape',
    icon: 'Square',
    accent: '#c9a06a',
    blurb: 'Flattens everything above a height into tableland.',
    op: 12,
    defaults: { threshold: 0.6, feather: 0.05, flatten: 0.1 },
    fields: [
      f('threshold', 'Cut height', 0.6, 0, 1, 0.005),
      f('feather', 'Feather', 0.05, 0.001, 0.4, 0.005),
      f('flatten', 'Residual relief', 0.1, 0, 1, 0.01, '', 'How much of the original height survives.'),
    ],
    slots: [['b', 3, 'threshold'], ['c', 3, 'feather'], ['d', 1, 'flatten']],
  },

  island: {
    key: 'island',
    label: 'Island Shape',
    group: 'Shape',
    icon: 'Compass',
    accent: '#7fbfa8',
    blurb: 'Radial falloff. Makes an island, or a bowl when inverted.',
    op: 14,
    defaults: { cx: 0.5, cz: 0.5, radius: 0.85, falloff: 0.35, warpScale: 3, warpAmount: 0.25, seed: 313, invert: false },
    fields: [
      f('cx', 'Centre X', 0.5, 0, 1, 0.005),
      f('cz', 'Centre Z', 0.5, 0, 1, 0.005),
      f('radius', 'Radius', 0.85, 0.05, 1.4, 0.01),
      f('falloff', 'Shore width', 0.35, 0.01, 1, 0.01),
      f('warpScale', 'Coast detail', 3, 0.2, 10, 0.05),
      f('warpAmount', 'Coast roughness', 0.25, 0, 1, 0.01),
      int('seed', 'Seed', 313, 0, 99999),
      { key: 'invert', label: 'Invert', def: false, type: 'toggle' },
    ],
    slots: [
      ['e', 0, 'cx'], ['e', 1, 'cz'], ['e', 2, 'radius'],
      ['c', 3, 'falloff'], ['a', 0, 'warpScale'], ['a', 3, 'warpAmount'],
    ],
    flags: { invert: 1 },
  },

  volcano: {
    key: 'volcano',
    label: 'Volcano',
    group: 'Generate',
    icon: 'Triangle',
    accent: '#d08a6a',
    blurb: 'A cone with a caldera, roughened flanks and a warped rim.',
    op: 13,
    defaults: {
      cx: 0.5, cz: 0.5, radius: 0.22, height: 0.35, craterRadius: 0.06, craterDepth: 0.09,
      roughness: 0.3, frequency: 5, octaves: 6, seed: 808,
    },
    fields: [
      f('cx', 'Centre X', 0.5, 0, 1, 0.005),
      f('cz', 'Centre Z', 0.5, 0, 1, 0.005),
      f('radius', 'Base radius', 0.22, 0.02, 0.9, 0.005),
      f('height', 'Height', 0.35, -0.5, 1, 0.005),
      f('craterRadius', 'Caldera radius', 0.06, 0, 0.5, 0.002),
      f('craterDepth', 'Caldera depth', 0.09, 0, 0.5, 0.002),
      f('roughness', 'Flank roughness', 0.3, 0, 1, 0.01),
      f('frequency', 'Flank detail', 5, 0.5, 20, 0.1),
      int('octaves', 'Octaves', 6, 1, 10),
      int('seed', 'Seed', 808, 0, 99999),
    ],
    slots: [
      ['e', 0, 'cx'], ['e', 1, 'cz'], ['e', 2, 'radius'], ['e', 3, 'height'],
      ['f', 0, 'craterRadius'], ['f', 1, 'craterDepth'], ['f', 2, 'roughness'], ['a', 0, 'frequency'],
    ],
    octavesKey: 'octaves',
  },

  cliff: {
    key: 'cliff',
    label: 'Cliff Sharpening',
    group: 'Shape',
    icon: 'Mountain',
    accent: '#9aa7b5',
    blurb: 'Steepens faces that are already steep. Creates rock walls.',
    op: 15,
    defaults: { amount: 0.4, slopeMin: 0.25, slopeMax: 0.7 },
    fields: [
      f('amount', 'Amount', 0.4, 0, 1.5, 0.01),
      f('slopeMin', 'Start at slope', 0.25, 0, 1, 0.01),
      f('slopeMax', 'Full at slope', 0.7, 0, 1, 0.01),
    ],
    slots: [['d', 2, 'amount'], ['c', 1, 'slopeMin'], ['c', 2, 'slopeMax']],
  },

  levels: {
    key: 'levels',
    label: 'Levels',
    group: 'Shape',
    icon: 'SlidersHorizontal',
    accent: '#a8a8a8',
    blurb: 'Remap, gamma and contrast. The final grade of the height field.',
    op: 11,
    defaults: { inLow: 0, inHigh: 1, outLow: 0, outHigh: 1, gamma: 1, contrast: 1, bias: 0 },
    fields: [
      f('inLow', 'Input black', 0, 0, 1, 0.005),
      f('inHigh', 'Input white', 1, 0, 1, 0.005),
      f('outLow', 'Output black', 0, 0, 1, 0.005),
      f('outHigh', 'Output white', 1, 0, 1, 0.005),
      f('gamma', 'Gamma', 1, 0.1, 4, 0.01),
      f('contrast', 'Contrast', 1, 0, 3, 0.01),
      f('bias', 'Bias', 0, -0.5, 0.5, 0.005),
    ],
    slots: [
      ['m', 0, 'inLow'], ['m', 1, 'inHigh'], ['d', 1, 'outLow'], ['d', 2, 'outHigh'],
      ['f', 3, 'gamma'], ['c', 2, 'contrast'], ['b', 3, 'bias'],
    ],
    // levels owns the mask slots, so its own mask is forced to "everywhere"
    locksMask: true,
  },

  smooth: {
    key: 'smooth',
    label: 'Smooth',
    group: 'Filter',
    icon: 'Droplets',
    accent: '#8fb8c9',
    blurb: 'Slope-preserving blur. Removes noise without softening ridges.',
    op: 4,
    iterations: true,
    defaults: { strength: 0.6, preserve: 0, iterations: 4 },
    fields: [
      f('strength', 'Strength', 0.6, 0, 1, 0.01),
      f('preserve', 'Preserve edges', 0, 0, 1, 0.01, '', 'Stops the blur crossing sharp discontinuities.'),
      int('iterations', 'Passes', 4, 1, 128),
    ],
    slots: [['d', 2, 'strength'], ['c', 2, 'preserve']],
    flags: { preserve: 2 },
  },

  sharpen: {
    key: 'sharpen',
    label: 'Sharpen',
    group: 'Filter',
    icon: 'Sparkles',
    accent: '#c9b08f',
    blurb: 'Unsharp mask. Brings back crispness lost to smoothing.',
    op: 5,
    iterations: true,
    defaults: { amount: 0.4, iterations: 1 },
    fields: [
      f('amount', 'Amount', 0.4, 0, 1.5, 0.01),
      int('iterations', 'Passes', 1, 1, 16),
    ],
    slots: [['d', 2, 'amount']],
  },

  detail: {
    key: 'detail',
    label: 'Surface Detail',
    group: 'Filter',
    icon: 'ScanLine',
    accent: '#b0a48c',
    blurb: 'Adds high-frequency rock detail, weighted towards steep faces.',
    op: 6,
    defaults: { scale: 40, amount: 0.05, slopeMin: 0.15, slopeMax: 0.65, octaves: 5, seed: 616 },
    fields: [
      f('scale', 'Detail scale', 40, 2, 160, 1),
      f('amount', 'Amount', 0.05, 0, 0.3, 0.001),
      f('slopeMin', 'None below slope', 0.15, 0, 1, 0.01),
      f('slopeMax', 'Full at slope', 0.65, 0, 1, 0.01),
      int('octaves', 'Octaves', 5, 1, 8),
      int('seed', 'Seed', 616, 0, 99999),
    ],
    slots: [['a', 0, 'scale'], ['d', 2, 'amount'], ['c', 1, 'slopeMin'], ['c', 2, 'slopeMax']],
    octavesKey: 'octaves',
  },

  fill: {
    key: 'fill',
    label: 'Constant',
    group: 'Generate',
    icon: 'Square',
    accent: '#8c8c8c',
    blurb: 'Sets the whole field to one height. Useful as a base to build on.',
    op: 0,
    defaults: { value: 0 },
    fields: [f('value', 'Height', 0, 0, 1, 0.005)],
    slots: [['b', 3, 'value']],
  },
};

export const OP_GROUPS = ['Generate', 'Shape', 'Erode', 'Filter', 'Deposit'];

export const OP_LIST = Object.values(TERRAIN_OPS).sort(
  (a, b) => OP_GROUPS.indexOf(a.group) - OP_GROUPS.indexOf(b.group) || a.label.localeCompare(b.label)
);

let uid = 0;
export function makeLayer(kindKey, overrides = {}) {
  const op = TERRAIN_OPS[kindKey];
  const params = { ...op.defaults };
  const mask = {
    maskMode: 0, maskMin: 0, maskMax: 1, maskFeather: 0.08, maskContrast: 1,
    maskNoiseScale: 4, maskNoiseSeed: 17, maskInvert: false,
  };
  return {
    id: `tl${++uid}-${Math.random().toString(36).slice(2, 7)}`,
    kind: kindKey,
    name: op.label,
    enabled: true,
    opacity: 1,
    blend: 0,
    ...mask,
    params,
    ...overrides,
  };
}

// --- packing --------------------------------------------------------------------------------------
// Fills the FieldOp block. Slots default to zero, so an op only writes what it uses.
// OP_FLOATS must be >= the highest float index any slot map touches (currently 43).
export const OP_FLOATS = 44; // 176 bytes; the uniform is bound at a 256-byte stride

export function packTerrainOp(out, layer, ctx) {
  const op = TERRAIN_OPS[layer.kind];
  const P = layer.params;
  const v = out;
  v.fill(0);

  const p0 = new Uint32Array(v.buffer, v.byteOffset, 4);
  const p1 = new Uint32Array(v.buffer, v.byteOffset + 16, 4);

  p0[0] = op.op ?? 0;
  p0[1] = ctx.res;
  p0[2] = (P.seed ?? 0) | 0;
  p0[3] = op.octavesKey ? (P[op.octavesKey] | 0) : 0;

  p1[1] = layer.blend | 0;
  p1[2] = op.locksMask ? 0 : (layer.maskMode | 0);
  p1[3] = 1;

  v[8] = ctx.cellMeters;
  v[9] = ctx.heightMeters;
  v[10] = layer.opacity;

  const slotBase = { a: 12, b: 16, c: 20, d: 24, e: 28, f: 32, m: 36, n: 40 };
  for (const [slot, comp, key, xform] of op.slots ?? []) {
    let raw = P[key];
    if (typeof raw === 'boolean') raw = raw ? 1 : 0;
    if (raw === undefined) continue;
    v[slotBase[slot] + comp] = xform ? xform(raw) : raw;
  }
  if (op.customSlots) op.customSlots(makeSlotView(v, slotBase), P);

  // flags
  let flags = 0;
  for (const [key, bit] of Object.entries(op.flags ?? {})) {
    if (P[key]) flags |= bit;
  }
  p1[0] = flags;

  if (!op.locksMask) {
    v[36] = layer.maskMin;
    v[37] = layer.maskMax;
    v[38] = layer.maskFeather;
    v[39] = layer.maskInvert ? 1 : 0;
    v[40] = layer.maskNoiseScale;
    v[41] = layer.maskContrast;
    v[42] = layer.maskNoiseSeed;
    v[43] = 4;
  }
  return v;
}

function makeSlotView(v, base) {
  return {
    a: v.subarray(base.a, base.a + 4),
    b: v.subarray(base.b, base.b + 4),
    c: v.subarray(base.c, base.c + 4),
    d: v.subarray(base.d, base.d + 4),
    e: v.subarray(base.e, base.e + 4),
    f: v.subarray(base.f, base.f + 4),
    m: v.subarray(base.m, base.m + 4),
    n: v.subarray(base.n, base.n + 4),
  };
}
