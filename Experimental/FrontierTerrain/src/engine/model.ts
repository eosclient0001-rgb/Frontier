// ---------------------------------------------------------------------------
// Project model: generation layer stack, texture layer stack, global settings,
// operator specs (sliders, cards, ranges) and presets. Shared by the GPU engine
// and the UI so the two cannot drift apart.
// ---------------------------------------------------------------------------

export type GenKind =
  | 'fractal' | 'cells' | 'continent' | 'terrace' | 'curve'
  | 'smooth' | 'thermal' | 'hydraulic' | 'rivers';
export type Blend = 'replace' | 'add' | 'subtract' | 'multiply' | 'min' | 'max';
export type MaskKind = 'none' | 'height' | 'slope' | 'noise';

export interface Param {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  unit?: string;
  options?: string[];
  help?: string;
}

export interface KindSpec {
  kind: GenKind;
  name: string;
  group: 'Base' | 'Shape' | 'Erosion' | 'Refine';
  blurb: string;
  defaultBlend: Blend;
  params: Param[];
  /** Cards shown in the inspector, each with the param keys it contains. */
  cards: { title: string; keys: string[] }[];
}

export const BLENDS: { id: Blend; label: string; code: number }[] = [
  { id: 'replace', label: 'Replace', code: 0 },
  { id: 'add', label: 'Add', code: 1 },
  { id: 'subtract', label: 'Subtract', code: 2 },
  { id: 'multiply', label: 'Multiply', code: 3 },
  { id: 'min', label: 'Min', code: 4 },
  { id: 'max', label: 'Max', code: 5 },
];

export const KINDS: Record<GenKind, KindSpec> = {
  fractal: {
    kind: 'fractal', name: 'Fractal Base', group: 'Base', defaultBlend: 'replace',
    blurb: 'Multi-octave noise: fBm, ridged, billow or hybrid multifractal, with domain warping.',
    params: [
      { key: 'type', label: 'Noise type', min: 0, max: 3, step: 1, def: 3, options: ['fBm', 'Ridged', 'Billow', 'Hybrid'] },
      { key: 'freq', label: 'Frequency', min: 0.5, max: 12, step: 0.1, def: 2.2, unit: '×', help: 'Features across the world' },
      { key: 'octaves', label: 'Octaves', min: 1, max: 12, step: 1, def: 10 },
      { key: 'lacunarity', label: 'Lacunarity', min: 1.5, max: 3.5, step: 0.05, def: 2.1 },
      { key: 'gain', label: 'Gain', min: 0.2, max: 0.8, step: 0.01, def: 0.5, help: 'Amplitude decay per octave' },
      { key: 'warp', label: 'Domain warp', min: 0, max: 1, step: 0.01, def: 0.35 },
      { key: 'warpFreq', label: 'Warp frequency', min: 0.2, max: 4, step: 0.05, def: 0.9 },
      { key: 'amp', label: 'Amplitude', min: 0, max: 2, step: 0.01, def: 1 },
      { key: 'offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.01, def: 0 },
    ],
    cards: [
      { title: 'Pattern', keys: ['type', 'freq', 'octaves'] },
      { title: 'Fractal', keys: ['lacunarity', 'gain'] },
      { title: 'Domain warp', keys: ['warp', 'warpFreq'] },
      { title: 'Output', keys: ['amp', 'offset'] },
    ],
  },
  cells: {
    kind: 'cells', name: 'Cells & Ridges', group: 'Base', defaultBlend: 'add',
    blurb: 'Worley cells as domes, crease ridges or stepped plateaus.',
    params: [
      { key: 'cells', label: 'Cells across', min: 2, max: 40, step: 1, def: 9 },
      { key: 'jitter', label: 'Jitter', min: 0, max: 1, step: 0.01, def: 0.9 },
      { key: 'mode', label: 'Mode', min: 0, max: 2, step: 1, def: 1, options: ['Domes', 'Ridges', 'Plateaus'] },
      { key: 'amp', label: 'Amplitude', min: 0, max: 2, step: 0.01, def: 1 },
      { key: 'offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.01, def: 0 },
    ],
    cards: [
      { title: 'Cell structure', keys: ['cells', 'jitter', 'mode'] },
      { title: 'Output', keys: ['amp', 'offset'] },
    ],
  },
  continent: {
    kind: 'continent', name: 'Continent Shaper', group: 'Shape', defaultBlend: 'multiply',
    blurb: 'Warped radial land mass with a sea shelf. Multiply it over the base to carve coastlines.',
    params: [
      { key: 'radius', label: 'Land radius', min: 0.2, max: 1.1, step: 0.01, def: 0.78 },
      { key: 'falloff', label: 'Coast softness', min: 0.02, max: 0.8, step: 0.01, def: 0.35 },
      { key: 'warp', label: 'Coast warp', min: 0, max: 1, step: 0.01, def: 0.45 },
      { key: 'shelf', label: 'Sea shelf', min: 0, max: 0.6, step: 0.01, def: 0.12 },
      { key: 'freq', label: 'Coast frequency', min: 0.5, max: 4, step: 0.05, def: 1.6 },
    ],
    cards: [
      { title: 'Land mass', keys: ['radius', 'falloff'] },
      { title: 'Coastline', keys: ['warp', 'freq', 'shelf'] },
    ],
  },
  terrace: {
    kind: 'terrace', name: 'Terrace', group: 'Shape', defaultBlend: 'replace',
    blurb: 'Quantises height into benches with adjustable riser sharpness.',
    params: [
      { key: 'steps', label: 'Steps', min: 2, max: 32, step: 1, def: 9 },
      { key: 'sharp', label: 'Riser sharpness', min: 0, max: 1, step: 0.01, def: 0.35 },
      { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, def: 0.8 },
    ],
    cards: [{ title: 'Benches', keys: ['steps', 'sharp', 'strength'] }],
  },
  curve: {
    kind: 'curve', name: 'Levels & Curve', group: 'Refine', defaultBlend: 'replace',
    blurb: 'Remap levels, gamma and an S-curve contrast. Set the floor to flatten sea beds.',
    params: [
      { key: 'low', label: 'Input low', min: 0, max: 0.9, step: 0.01, def: 0.02 },
      { key: 'high', label: 'Input high', min: 0.1, max: 1, step: 0.01, def: 0.95 },
      { key: 'gamma', label: 'Gamma', min: 0.3, max: 3, step: 0.01, def: 1.15 },
      { key: 'sCurve', label: 'S-curve', min: -1, max: 1, step: 0.01, def: 0.35, help: 'Positive adds contrast' },
      { key: 'floor', label: 'Floor', min: 0, max: 0.5, step: 0.01, def: 0 },
    ],
    cards: [
      { title: 'Levels', keys: ['low', 'high', 'floor'] },
      { title: 'Response', keys: ['gamma', 'sCurve'] },
    ],
  },
  smooth: {
    kind: 'smooth', name: 'Smooth & Deposit', group: 'Refine', defaultBlend: 'replace',
    blurb: 'Gaussian-like relaxation. Mask by slope to deposit sediment on flats only.',
    params: [
      { key: 'radius', label: 'Radius', min: 1, max: 12, step: 1, def: 3, unit: 'cells' },
      { key: 'passes', label: 'Passes', min: 1, max: 6, step: 1, def: 2 },
    ],
    cards: [{ title: 'Relaxation', keys: ['radius', 'passes'] }],
  },
  thermal: {
    kind: 'thermal', name: 'Thermal Erosion', group: 'Erosion', defaultBlend: 'replace',
    blurb: 'Talus collapse: material slides off slopes steeper than the angle of repose.',
    params: [
      { key: 'talus', label: 'Talus angle', min: 10, max: 70, step: 0.5, def: 38, unit: '°' },
      { key: 'iterations', label: 'Iterations', min: 1, max: 300, step: 1, def: 60 },
      { key: 'rate', label: 'Rate', min: 0.02, max: 0.12, step: 0.005, def: 0.1 },
    ],
    cards: [
      { title: 'Talus', keys: ['talus', 'rate'] },
      { title: 'Run', keys: ['iterations'] },
    ],
  },
  hydraulic: {
    kind: 'hydraulic', name: 'Hydraulic Erosion', group: 'Erosion', defaultBlend: 'replace',
    blurb: 'Particle rainfall carving channels, transporting sediment and depositing it in basins. Also builds the drainage map.',
    params: [
      { key: 'droplets', label: 'Droplets / cell', min: 0.02, max: 1.5, step: 0.01, def: 0.35 },
      { key: 'lifetime', label: 'Lifetime', min: 10, max: 150, step: 1, def: 70, unit: 'steps' },
      { key: 'inertia', label: 'Inertia', min: 0, max: 0.6, step: 0.01, def: 0.08 },
      { key: 'capacity', label: 'Sediment capacity', min: 0.5, max: 12, step: 0.1, def: 4 },
      { key: 'erosion', label: 'Erosion', min: 0, max: 1, step: 0.01, def: 0.45 },
      { key: 'deposition', label: 'Deposition', min: 0, max: 1, step: 0.01, def: 0.35 },
      { key: 'evaporation', label: 'Evaporation', min: 0, max: 0.08, step: 0.001, def: 0.012 },
      { key: 'gravity', label: 'Gravity', min: 1, max: 12, step: 0.1, def: 4 },
      { key: 'radius', label: 'Brush radius', min: 1, max: 6, step: 1, def: 3, unit: 'cells' },
    ],
    cards: [
      { title: 'Rainfall', keys: ['droplets', 'lifetime'] },
      { title: 'Transport', keys: ['inertia', 'capacity', 'gravity'] },
      { title: 'Erosion & deposition', keys: ['erosion', 'deposition', 'evaporation', 'radius'] },
    ],
  },
  rivers: {
    kind: 'rivers', name: 'Rivers & Drainage', group: 'Erosion', defaultBlend: 'replace',
    blurb: 'Carves valleys along the flow network recorded by the hydraulic pass.',
    params: [
      { key: 'depth', label: 'Channel depth', min: 0, max: 0.08, step: 0.001, def: 0.02, help: 'Fraction of max height' },
      { key: 'threshold', label: 'Flow threshold', min: 0.2, max: 0.95, step: 0.01, def: 0.6 },
      { key: 'width', label: 'Width', min: 0, max: 3, step: 1, def: 1, unit: 'cells' },
    ],
    cards: [{ title: 'Channels', keys: ['depth', 'threshold', 'width'] }],
  },
};

export const GEN_KINDS_ORDER: GenKind[] = [
  'fractal', 'cells', 'continent', 'terrace', 'curve', 'smooth', 'thermal', 'hydraulic', 'rivers',
];

export const GROUP_ORDER = ['Base', 'Shape', 'Erosion', 'Refine'] as const;

export interface Mask {
  kind: MaskKind;
  lo: number;
  hi: number;
  feather: number;
  invert: boolean;
  scale: number;
}

export interface GenLayer {
  id: string;
  kind: GenKind;
  name: string;
  enabled: boolean;
  opacity: number;
  blend: Blend;
  params: Record<string, number>;
  mask: Mask;
}

export const MASK_RANGE: Record<MaskKind, { lo: number; hi: number; feather: number; unit: string; min: number; max: number; def: [number, number, number] }> = {
  none: { lo: 0, hi: 1, feather: 0, unit: '', min: 0, max: 1, def: [0, 1, 0] },
  height: { lo: 0, hi: 1200, feather: 40, unit: 'm', min: 0, max: 4000, def: [0, 1200, 40] },
  slope: { lo: 0, hi: 35, feather: 4, unit: '°', min: 0, max: 90, def: [0, 35, 4] },
  noise: { lo: 0.4, hi: 1, feather: 0.05, unit: '', min: 0, max: 1, def: [0.4, 1, 0.05] },
};

export function defaultParams(kind: GenKind): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of KINDS[kind].params) out[p.key] = p.def;
  return out;
}

let uid = 0;
export function newId(prefix: string): string {
  uid += 1;
  return `${prefix}-${Date.now().toString(36)}-${uid}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function makeGen(kind: GenKind, overrides: Record<string, number> = {}, extra: Partial<GenLayer> = {}): GenLayer {
  const spec = KINDS[kind];
  return {
    id: newId('g'),
    kind,
    name: spec.name,
    enabled: true,
    opacity: 1,
    blend: spec.defaultBlend,
    params: { ...defaultParams(kind), ...overrides },
    mask: { kind: 'none', lo: 0, hi: 1, feather: 0, invert: false, scale: 3 },
    ...extra,
  };
}

// ---------------- texture layers ----------------------------------------
export interface MatSpec { id: number; name: string; color: string; blurb: string }
export const MATERIALS: MatSpec[] = [
  { id: 0, name: 'Meadow grass', color: '#5f7d2c', blurb: 'Lush blades with dry patches' },
  { id: 1, name: 'Forest floor', color: '#6b4f2f', blurb: 'Leaf litter and loam' },
  { id: 2, name: 'Granite rock', color: '#8a8580', blurb: 'Speckled crystalline rock, triplanar' },
  { id: 3, name: 'Strata stone', color: '#9c7e62', blurb: 'Layered sedimentary cliffs' },
  { id: 4, name: 'Dune sand', color: '#c8ad72', blurb: 'Wind ripples' },
  { id: 5, name: 'Fresh snow', color: '#e4eaf2', blurb: 'Soft snowpack' },
  { id: 6, name: 'Scree & gravel', color: '#7d7669', blurb: 'Loose rubble' },
  { id: 7, name: 'Wet mud', color: '#4a3a28', blurb: 'Saturated soil and riverbeds' },
];

export interface TexLayer {
  id: string;
  name: string;
  mat: number;
  enabled: boolean;
  tint: string;
  p: Record<string, number>;
}

export const TEX_DEFAULTS: Record<string, number> = {
  opacity: 1, sharp: 0.6, heightBlend: 0.25, scale: 6, detail: 0.6, roughness: 0.8,
  altOn: 0, altMin: 0, altMax: 1200, altFeather: 40,
  slopeOn: 0, slopeMin: 0, slopeMax: 90, slopeFeather: 5,
  curvOn: 0, curvMode: 0, curvThr: 0.25, curvFeather: 0.15,
  flowOn: 0, flowMin: 0.5,
  cavOn: 0, cavMin: 0.45,
  noiseAmt: 0.35, noiseScale: 140,
};

export function makeTex(mat: number, name: string, tint: string, over: Record<string, number>): TexLayer {
  return { id: newId('t'), name, mat, enabled: true, tint, p: { ...TEX_DEFAULTS, ...over } };
}

// ---------------- settings & project -------------------------------------
export interface Settings {
  res: number;
  seed: number;
  worldSize: number;
  maxH: number;
  sea: number;
  sunAz: number;
  sunEl: number;
  haze: number;
  exposure: number;
  viewMode: number;
  showWater: boolean;
  showRivers: boolean;
  autoGen: boolean;
  /** Baked material texture resolution as a multiple of the cell grid. */
  texScale: number;
}

export const VIEW_MODES = ['Textured', 'Clay', 'Slope', 'Flow', 'Cavity', 'Shadow', 'Contours'];

export const DEFAULT_SETTINGS: Settings = {
  res: 512,
  seed: 428,
  worldSize: 4096,
  maxH: 1200,
  sea: 120,
  sunAz: 135,
  sunEl: 38,
  haze: 1,
  exposure: 1,
  viewMode: 0,
  showWater: true,
  showRivers: true,
  autoGen: true,
  texScale: 2,
};

export interface Project {
  name: string;
  settings: Settings;
  gen: GenLayer[];
  tex: TexLayer[];
}

// ---------------- presets -------------------------------------------------
type G = [GenKind, Record<string, number>, Partial<GenLayer>?];

function build(list: G[]): GenLayer[] {
  return list.map(([kind, ov, extra]) => makeGen(kind, ov, extra));
}

const maskOf = (kind: MaskKind, lo: number, hi: number, feather: number, invert = false, scale = 3) =>
  ({ mask: { kind, lo, hi, feather, invert, scale } } as Partial<GenLayer>);

function texStack(maxH: number, sea: number): TexLayer[] {
  const s = (f: number) => Math.round(maxH * f);
  return [
    makeTex(0, 'Meadow grass', '#ffffff', { scale: 7 }),
    makeTex(1, 'Forest floor', '#ffffff', { cavOn: 1, cavMin: 0.42, slopeOn: 1, slopeMin: 0, slopeMax: 32, slopeFeather: 6, noiseAmt: 0.5, scale: 4 }),
    makeTex(2, 'Rock outcrops', '#ffffff', { slopeOn: 1, slopeMin: 36, slopeMax: 90, slopeFeather: 5, sharp: 0.85, heightBlend: 0.45, scale: 18, detail: 0.9, roughness: 0.6 }),
    makeTex(3, 'Strata cliffs', '#ffffff', { slopeOn: 1, slopeMin: 55, slopeMax: 90, slopeFeather: 4, curvOn: 1, curvMode: 1, curvThr: 0.1, curvFeather: 0.1, sharp: 0.9, scale: 30, detail: 0.8, roughness: 0.7 }),
    makeTex(4, 'Beach sand', '#ffffff', { altOn: 1, altMin: 0, altMax: sea + 10, altFeather: 6, slopeOn: 1, slopeMin: 0, slopeMax: 20, slopeFeather: 4, sharp: 0.7, scale: 9 }),
    makeTex(5, 'Snowpack', '#ffffff', { altOn: 1, altMin: s(0.72), altMax: maxH, altFeather: Math.round(maxH * 0.07), slopeOn: 1, slopeMin: 0, slopeMax: 48, slopeFeather: 6, noiseAmt: 0.25, sharp: 0.55, heightBlend: 0.1, roughness: 0.5, scale: 12 }),
    makeTex(6, 'Scree', '#ffffff', { slopeOn: 1, slopeMin: 28, slopeMax: 46, slopeFeather: 5, curvOn: 1, curvMode: 1, curvThr: 0.05, curvFeather: 0.2, scale: 5, sharp: 0.5, heightBlend: 0.4 }),
    makeTex(7, 'Wet riverbed', '#ffffff', { flowOn: 1, flowMin: 0.6, altOn: 1, altMin: 0, altMax: sea + 40, altFeather: 15, sharp: 0.6, scale: 5, roughness: 0.4 }),
  ];
}

export const PRESETS: { id: string; name: string; blurb: string; build: (s: Settings) => Project }[] = [
  {
    id: 'alpine',
    name: 'Alpine Peaks',
    blurb: 'Hybrid massifs, ridged spines, hydraulic carving and snowline',
    build: (s) => ({
      name: 'Alpine Peaks', settings: { ...s, sea: 150 }, tex: texStack(s.maxH, 150),
      gen: build([
        ['fractal', { type: 3, freq: 2.2, octaves: 10, amp: 1.12, offset: -0.06, warp: 0.4 }],
        ['fractal', { type: 1, freq: 4.6, octaves: 7, amp: 0.4, gain: 0.55, warp: 0.25 }, { blend: 'add', ...maskOf('height', 0.35, 1, 0.12) }],
        ['continent', { radius: 0.9, falloff: 0.42, shelf: 0.12, warp: 0.35 }],
        ['thermal', { talus: 42, iterations: 40, rate: 0.1 }],
        ['hydraulic', { droplets: 0.4, lifetime: 80, erosion: 0.5, deposition: 0.3 }],
        ['rivers', { depth: 0.02, threshold: 0.6, width: 1 }],
        ['smooth', { radius: 2, passes: 1 }, { opacity: 0.45, ...maskOf('slope', 0, 30, 4) }],
        ['curve', { low: 0.08, high: 1, gamma: 1.12, sCurve: 0.3, floor: 0.02 }],
      ]),
    }),
  },
  {
    id: 'highlands',
    name: 'Eroded Highlands',
    blurb: 'Rolling fBm, deep drainage networks and talus-smoothed slopes',
    build: (s) => ({
      name: 'Eroded Highlands', settings: { ...s, sea: 90 }, tex: texStack(s.maxH, 90),
      gen: build([
        ['fractal', { type: 0, freq: 1.5, octaves: 9, amp: 1.0, warp: 0.5, offset: 0.02 }],
        ['cells', { cells: 6, mode: 2, amp: 0.35, jitter: 0.8 }, { blend: 'add', opacity: 0.6 }],
        ['thermal', { talus: 34, iterations: 60, rate: 0.09 }],
        ['hydraulic', { droplets: 0.6, lifetime: 90, erosion: 0.55, deposition: 0.35, capacity: 5 }],
        ['rivers', { depth: 0.03, threshold: 0.55, width: 2 }],
        ['curve', { low: 0.02, high: 0.96, gamma: 1.05, sCurve: 0.2 }],
      ]),
    }),
  },
  {
    id: 'island',
    name: 'Coastal Island',
    blurb: 'Warped continent, sea shelf and coastal erosion',
    build: (s) => ({
      name: 'Coastal Island', settings: { ...s, sea: 110 }, tex: texStack(s.maxH, 110),
      gen: build([
        ['fractal', { type: 3, freq: 2.0, octaves: 9, amp: 1.0, warp: 0.4 }],
        ['continent', { radius: 0.74, falloff: 0.32, warp: 0.6, shelf: 0.05, freq: 1.8 }],
        ['thermal', { talus: 36, iterations: 40 }],
        ['hydraulic', { droplets: 0.35, lifetime: 70 }],
        ['rivers', { depth: 0.018, threshold: 0.62, width: 1 }],
        ['smooth', { radius: 2, passes: 1 }, maskOf('slope', 0, 18, 3)],
        ['curve', { low: 0.1, high: 0.92, gamma: 1.2, sCurve: 0.25, floor: 0 }],
      ]),
    }),
  },
  {
    id: 'mesa',
    name: 'Desert Mesas',
    blurb: 'Plateau cells, stepped terraces and wind-smoothed sand',
    build: (s) => ({
      name: 'Desert Mesas', settings: { ...s, sea: 40 }, tex: texStack(s.maxH, 40),
      gen: build([
        ['cells', { cells: 5, mode: 2, amp: 0.95, jitter: 0.9 }],
        ['fractal', { type: 0, freq: 3.2, octaves: 7, amp: 0.22, warp: 0.5 }, { blend: 'add' }],
        ['terrace', { steps: 7, sharp: 0.85, strength: 0.9 }],
        ['thermal', { talus: 30, iterations: 80 }],
        ['smooth', { radius: 1, passes: 1 }, { opacity: 0.5 }],
        ['curve', { low: 0.02, high: 0.98, gamma: 0.95, sCurve: -0.1 }],
      ]),
    }),
  },
  {
    id: 'blank',
    name: 'Blank Canvas',
    blurb: 'A single base layer to build from',
    build: (s) => ({
      name: 'Untitled terrain', settings: { ...s }, tex: texStack(s.maxH, s.sea),
      gen: build([['fractal', { type: 3, freq: 2.0 }]]),
    }),
  },
];

export function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
