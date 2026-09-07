/**
 * Single source of truth for every simulation parameter.
 *
 * This schema generates, from one declaration:
 *   1. the WGSL `Params` uniform struct  (see shaders/_generated_params.wgsl)
 *   2. the CPU-side packing into the uniform buffer
 *   3. the UI sliders
 *
 * Adding a knob is one line. It can never drift out of sync with the shader.
 */

export type ParamKind = 'f32' | 'u32';

export interface ParamDef {
  name: string;
  kind: ParamKind;
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  group: string;
  tip?: string;
  /** Log-scale slider (for rates spanning orders of magnitude). */
  log?: boolean;
  /** Hide from the UI (driven internally). */
  hidden?: boolean;
  /** Changing this requires rebuilding the terrain from scratch. */
  rebuild?: boolean;
}

const P = (d: ParamDef) => d;

// ---------------------------------------------------------------------------
//  GEOLOGY  — the stratigraphic column. This drives erosion resistance AND
//  albedo, which is what makes the result read as rock rather than as texture.
// ---------------------------------------------------------------------------
const GEO: ParamDef[] = [
  P({ name: 'seed', kind: 'f32', value: 17.0, min: 0, max: 999, step: 1, label: 'Seed', group: 'Geology', rebuild: true }),
  P({ name: 'bedThickness', kind: 'f32', value: 17.0, min: 3, max: 80, label: 'Bed thickness (m)', group: 'Geology',
      tip: 'Vertical thickness of one sedimentary bed. Thin beds → finely banded badlands; thick beds → big Grand-Canyon ledges.' }),
  P({ name: 'strataDip', kind: 'f32', value: 0.9, min: -14, max: 14, label: 'Strata dip (°)', group: 'Geology',
      tip: 'Tilt of the beds. A few degrees gives the classic tilted-mesa look.' }),
  P({ name: 'strataAzim', kind: 'f32', value: 35.0, min: 0, max: 360, label: 'Dip azimuth (°)', group: 'Geology' }),
  P({ name: 'foldAmp', kind: 'f32', value: 14.0, min: 0, max: 120, label: 'Fold amplitude (m)', group: 'Geology',
      tip: 'Broad warping of the beds — monoclines and gentle folds.' }),
  P({ name: 'foldFreq', kind: 'f32', value: 0.0016, min: 0.0002, max: 0.01, label: 'Fold frequency', group: 'Geology' }),
  P({ name: 'strataWarp', kind: 'f32', value: 5.0, min: 0, max: 40, label: 'Bed roughness (m)', group: 'Geology',
      tip: 'Non-planarity of individual beds. Keeps layers from looking machined.' }),
  P({ name: 'strataWarpFreq', kind: 'f32', value: 0.004, min: 0.0005, max: 0.02, label: 'Bed roughness freq', group: 'Geology' }),
  P({ name: 'hardContrast', kind: 'f32', value: 2.6, min: 0.4, max: 7, label: 'Hardness contrast', group: 'Geology',
      tip: 'How different hard and soft beds are. THE control for stair-stepped cliffs — high contrast = strong ledges + overhangs.' }),
  P({ name: 'capFrac', kind: 'f32', value: 0.26, min: 0.0, max: 0.8, label: 'Resistant bed fraction', group: 'Geology',
      tip: 'Fraction of beds that are caprock-grade. Low values give isolated mesas and hoodoos.' }),
  P({ name: 'jointDensity', kind: 'f32', value: 0.0045, min: 0.0008, max: 0.02, label: 'Joint density', group: 'Geology',
      tip: 'Vertical fracture spacing. Joints are why desert cliffs are fluted into columns and fins.' }),
  P({ name: 'jointDepth', kind: 'f32', value: 0.45, min: 0, max: 1, label: 'Joint weakness', group: 'Geology',
      tip: 'How much a joint weakens the rock. Drives fins, slot canyons and free-standing towers.' }),
  P({ name: 'jointJitter', kind: 'f32', value: 0.55, min: 0, max: 1, label: 'Joint irregularity', group: 'Geology' }),
  P({ name: 'basementY', kind: 'f32', value: 0.06, min: 0.0, max: 0.5, label: 'Basement level', group: 'Geology',
      tip: 'Below this the rock becomes very hard crystalline basement — it stops the river cutting forever.' }),
  P({ name: 'basementHard', kind: 'f32', value: 0.9, min: 0.2, max: 1.0, label: 'Basement hardness', group: 'Geology' }),
];

// ---------------------------------------------------------------------------
//  INITIAL LANDFORM — the pre-erosion block that the sim then attacks.
// ---------------------------------------------------------------------------
const SHAPE: ParamDef[] = [
  P({ name: 'baseHeight', kind: 'f32', value: 0.74, min: 0.2, max: 0.95, label: 'Plateau height', group: 'Landform', rebuild: true }),
  P({ name: 'upliftAmp', kind: 'f32', value: 0.10, min: 0, max: 0.4, label: 'Uplift relief', group: 'Landform', rebuild: true }),
  P({ name: 'upliftFreq', kind: 'f32', value: 1.5, min: 0.2, max: 6, label: 'Uplift scale', group: 'Landform', rebuild: true }),
  P({ name: 'initRough', kind: 'f32', value: 0.030, min: 0, max: 0.12, label: 'Initial roughness', group: 'Landform', rebuild: true }),
  P({ name: 'incisionDepth', kind: 'f32', value: 0.34, min: 0, max: 0.8, label: 'Seed channel depth', group: 'Landform', rebuild: true,
      tip: 'A starter meander cut into the plateau. Erosion widens it into the main canyon.' }),
  P({ name: 'incisionWidth', kind: 'f32', value: 0.070, min: 0.01, max: 0.3, label: 'Seed channel width', group: 'Landform', rebuild: true }),
  P({ name: 'meander', kind: 'f32', value: 0.16, min: 0, max: 0.45, label: 'Meander', group: 'Landform', rebuild: true }),
  P({ name: 'meanderFreq', kind: 'f32', value: 2.1, min: 0.4, max: 6, label: 'Meander frequency', group: 'Landform', rebuild: true }),
];

// ---------------------------------------------------------------------------
//  HYDRAULICS — shallow-water pipe model (Mei et al. 2007) on the wetted surface.
// ---------------------------------------------------------------------------
const HYDRO: ParamDef[] = [
  P({ name: 'dt', kind: 'f32', value: 0.028, min: 0.002, max: 0.08, label: 'Time step', group: 'Hydraulics',
      tip: 'Larger = faster erosion but the shallow-water solver can go unstable.' }),
  P({ name: 'rain', kind: 'f32', value: 0.010, min: 0, max: 0.08, label: 'Rainfall', group: 'Hydraulics',
      tip: 'Uniform precipitation. Desert canyons form from rare heavy events — try low rain + high erodibility.' }),
  P({ name: 'riverInflow', kind: 'f32', value: 0.55, min: 0, max: 3.0, label: 'River inflow', group: 'Hydraulics',
      tip: 'Water injected at the upstream edge — this is what carves the main trunk canyon.' }),
  P({ name: 'evaporation', kind: 'f32', value: 0.016, min: 0, max: 0.12, label: 'Evaporation', group: 'Hydraulics' }),
  P({ name: 'pipeArea', kind: 'f32', value: 1.0, min: 0.1, max: 4, label: 'Flow conductance', group: 'Hydraulics' }),
  P({ name: 'gravity', kind: 'f32', value: 9.81, min: 1, max: 30, label: 'Gravity', group: 'Hydraulics', hidden: true }),
  P({ name: 'kCapacity', kind: 'f32', value: 1.5, min: 0.05, max: 8, label: 'Carrying capacity', group: 'Hydraulics',
      tip: 'How much sediment the flow can hold. High = deep incision, low = choked, depositional valleys.' }),
  P({ name: 'kErode', kind: 'f32', value: 0.55, min: 0, max: 3, label: 'Erodibility', group: 'Hydraulics' }),
  P({ name: 'kDeposit', kind: 'f32', value: 0.55, min: 0, max: 3, label: 'Deposition rate', group: 'Hydraulics' }),
  P({ name: 'minSlope', kind: 'f32', value: 0.030, min: 0.001, max: 0.3, label: 'Min slope', group: 'Hydraulics',
      tip: 'Floor on the slope term so flat riverbeds keep transporting instead of freezing.' }),
  P({ name: 'sedDiffuse', kind: 'f32', value: 0.28, min: 0, max: 1, label: 'Sediment diffusion', group: 'Hydraulics' }),
  P({ name: 'maxErode', kind: 'f32', value: 0.45, min: 0.01, max: 2.5, label: 'Max erosion / step (m)', group: 'Hydraulics', hidden: true }),
];

// ---------------------------------------------------------------------------
//  3D EROSION — level-set surface evolution.  This is the part that a
//  heightmap physically cannot do: lateral undercutting and overhangs.
// ---------------------------------------------------------------------------
const ERODE3: ParamDef[] = [
  P({ name: 'undercut', kind: 'f32', value: 0.85, min: 0, max: 3, label: 'Lateral undercutting', group: '3D Erosion',
      tip: 'Water attacks the banks sideways, not just the bed. Soft beds retreat under hard caps → true overhangs.' }),
  P({ name: 'undercutReach', kind: 'f32', value: 11.0, min: 1, max: 40, label: 'Undercut reach (m)', group: '3D Erosion',
      tip: 'How far above the water line spray, freeze-thaw and sapping can reach.' }),
  P({ name: 'weathering', kind: 'f32', value: 0.30, min: 0, max: 2.0, label: 'Weathering rate', group: '3D Erosion',
      tip: 'Slow surface-normal retreat inversely proportional to hardness. Alone, this is what sculpts hoodoos and stair-steps.' }),
  P({ name: 'exposureBias', kind: 'f32', value: 0.75, min: 0, max: 2, label: 'Exposure weighting', group: '3D Erosion',
      tip: 'Convex, exposed rock weathers faster than sheltered alcoves. Rounds edges and deepens hollows.' }),
  P({ name: 'saltWeather', kind: 'f32', value: 0.35, min: 0, max: 2, label: 'Cavernous weathering', group: '3D Erosion',
      tip: 'Salt/moisture attack that eats concave pockets — this is what hollows out desert alcoves and tafoni.' }),
  P({ name: 'collapseThresh', kind: 'f32', value: 0.42, min: 0.05, max: 1.0, label: 'Roof strength', group: '3D Erosion',
      tip: 'Unsupported spans wider than the rock can bear fail. Lower = arches collapse sooner and cliffs retreat by block fall.' }),
  P({ name: 'collapseRate', kind: 'f32', value: 1.4, min: 0, max: 6, label: 'Collapse rate', group: '3D Erosion' }),
  P({ name: 'reposeAngle', kind: 'f32', value: 33.0, min: 20, max: 45, label: 'Angle of repose (°)', group: '3D Erosion',
      tip: 'Talus/scree slope angle. ~33° for dry rock debris.' }),
  P({ name: 'talusRate', kind: 'f32', value: 0.55, min: 0, max: 2, label: 'Mass wasting rate', group: '3D Erosion',
      tip: 'How fast debris slides downhill to build talus aprons at the cliff base.' }),
  P({ name: 'regolithProd', kind: 'f32', value: 0.45, min: 0, max: 2, label: 'Debris production', group: '3D Erosion' }),
  P({ name: 'aeolian', kind: 'f32', value: 0.20, min: 0, max: 1.5, label: 'Aeolian (wind) transport', group: '3D Erosion',
      tip: 'Wind strips fines from windward faces and drifts sand into lee pockets.' }),
];

// ---------------------------------------------------------------------------
//  WATER & WIND
// ---------------------------------------------------------------------------
const WATER: ParamDef[] = [
  P({ name: 'showWater', kind: 'u32', value: 1, min: 0, max: 1, step: 1, label: 'Render water', group: 'Water & Wind' }),
  P({ name: 'waterMinDepth', kind: 'f32', value: 0.06, min: 0.005, max: 0.6, label: 'Visible depth threshold (m)', group: 'Water & Wind' }),
  P({ name: 'waterMurk', kind: 'f32', value: 0.62, min: 0, max: 1, label: 'Silt load', group: 'Water & Wind',
      tip: 'Suspended sediment. Southwest rivers run opaque tan — that colour is real, it is the canyon in suspension.' }),
  P({ name: 'waterIOR', kind: 'f32', value: 1.333, min: 1.0, max: 1.6, label: 'Index of refraction', group: 'Water & Wind', hidden: true }),
  P({ name: 'waterRough', kind: 'f32', value: 0.055, min: 0, max: 0.4, label: 'Surface roughness', group: 'Water & Wind' }),
  P({ name: 'windSpeed', kind: 'f32', value: 0.45, min: 0, max: 2.5, label: 'Wind speed', group: 'Water & Wind',
      tip: 'Drives ripple advection on the water and the drifting dust haze.' }),
  P({ name: 'windDir', kind: 'f32', value: 214.0, min: 0, max: 360, label: 'Wind direction (°)', group: 'Water & Wind' }),
  P({ name: 'rippleScale', kind: 'f32', value: 1.5, min: 0.1, max: 6, label: 'Ripple scale', group: 'Water & Wind' }),
  P({ name: 'rippleAmp', kind: 'f32', value: 0.55, min: 0, max: 2.5, label: 'Ripple strength', group: 'Water & Wind' }),
  P({ name: 'gustiness', kind: 'f32', value: 0.5, min: 0, max: 1.5, label: 'Gustiness', group: 'Water & Wind',
      tip: 'Low-frequency variation in wind — cat\'s-paws crossing the water surface.' }),
  P({ name: 'foamAmount', kind: 'f32', value: 0.6, min: 0, max: 2, label: 'Whitewater', group: 'Water & Wind' }),
];

// ---------------------------------------------------------------------------
//  LIGHTING / LOOK
// ---------------------------------------------------------------------------
const LOOK: ParamDef[] = [
  P({ name: 'sunAzim', kind: 'f32', value: 118.0, min: 0, max: 360, label: 'Sun azimuth (°)', group: 'Lighting' }),
  P({ name: 'sunElev', kind: 'f32', value: 22.0, min: 1.0, max: 89, label: 'Sun elevation (°)', group: 'Lighting',
      tip: 'Low sun rakes across the strata and makes the relief read. 15–25° is the classic canyon photograph.' }),
  P({ name: 'sunIntensity', kind: 'f32', value: 1.0, min: 0, max: 3, label: 'Sun intensity', group: 'Lighting' }),
  P({ name: 'skyIntensity', kind: 'f32', value: 1.0, min: 0, max: 3, label: 'Sky intensity', group: 'Lighting' }),
  P({ name: 'turbidity', kind: 'f32', value: 3.2, min: 1.6, max: 10, label: 'Haze / turbidity', group: 'Lighting' }),
  P({ name: 'bounceStrength', kind: 'f32', value: 0.85, min: 0, max: 2.5, label: 'Ground bounce', group: 'Lighting',
      tip: 'Red rock bouncing warm light into shadow. Without this, canyon shadows look dead.' }),
  P({ name: 'aoStrength', kind: 'f32', value: 0.9, min: 0, max: 2, label: 'Ambient occlusion', group: 'Lighting' }),
  P({ name: 'shadowSoft', kind: 'f32', value: 10.0, min: 1, max: 64, label: 'Shadow softness', group: 'Lighting' }),
  P({ name: 'fogDensity', kind: 'f32', value: 0.35, min: 0, max: 2.5, label: 'Aerial perspective', group: 'Lighting',
      tip: 'Distance haze. This is most of what sells the sense of scale.' }),
  P({ name: 'dustAmount', kind: 'f32', value: 0.4, min: 0, max: 2, label: 'Wind-blown dust', group: 'Lighting' }),
  P({ name: 'exposure', kind: 'f32', value: 1.0, min: 0.1, max: 4, label: 'Exposure', group: 'Lighting' }),
  P({ name: 'satBoost', kind: 'f32', value: 1.0, min: 0, max: 2, label: 'Saturation', group: 'Lighting' }),
];

// ---------------------------------------------------------------------------
//  SURFACE / MATERIAL
// ---------------------------------------------------------------------------
const MAT: ParamDef[] = [
  P({ name: 'detailAmp', kind: 'f32', value: 1.0, min: 0, max: 3, label: 'Rock micro-relief', group: 'Material',
      tip: 'High-frequency detail added analytically at ray-march time, so the rock stays crisp without a huge voxel grid.' }),
  P({ name: 'detailFreq', kind: 'f32', value: 1.0, min: 0.2, max: 4, label: 'Micro-relief scale', group: 'Material' }),
  P({ name: 'stratColor', kind: 'f32', value: 0.85, min: 0, max: 1.6, label: 'Strata colour variation', group: 'Material',
      tip: 'Bed-to-bed colour change. Because it comes from the same field that drives erosion, colour and form always agree.' }),
  P({ name: 'ironStain', kind: 'f32', value: 0.6, min: 0, max: 2, label: 'Iron oxide staining', group: 'Material',
      tip: 'The red in red rock. Concentrated in permeable beds.' }),
  P({ name: 'desertVarnish', kind: 'f32', value: 0.55, min: 0, max: 2, label: 'Desert varnish', group: 'Material',
      tip: 'Dark manganese streaks running down cliff faces below drainage points. Extremely characteristic of the Southwest.' }),
  P({ name: 'dustCover', kind: 'f32', value: 0.45, min: 0, max: 1.5, label: 'Dust / sand cover', group: 'Material',
      tip: 'Pale fines settling on flat surfaces and in lee pockets.' }),
  P({ name: 'sedimentTint', kind: 'f32', value: 0.7, min: 0, max: 2, label: 'Fresh sediment tint', group: 'Material',
      tip: 'Newly deposited material renders lighter and looser than the bedrock it came from.' }),
  P({ name: 'rockRough', kind: 'f32', value: 0.82, min: 0.2, max: 1, label: 'Rock roughness', group: 'Material' }),
  P({ name: 'vegetation', kind: 'f32', value: 0.22, min: 0, max: 1.2, label: 'Sparse vegetation', group: 'Material',
      tip: 'Desert scrub clinging to benches, seeps and north-facing slopes.' }),
];

// ---------------------------------------------------------------------------
//  QUALITY
// ---------------------------------------------------------------------------
const QUAL: ParamDef[] = [
  P({ name: 'maxSteps', kind: 'u32', value: 172, min: 32, max: 400, step: 1, label: 'Ray-march steps', group: 'Quality' }),
  P({ name: 'marchRelax', kind: 'f32', value: 0.85, min: 0.4, max: 1.0, label: 'March relaxation', group: 'Quality',
      tip: 'Step-size safety factor. Lower is slower but removes surface artefacts.' }),
  P({ name: 'shadowSteps', kind: 'u32', value: 48, min: 0, max: 160, step: 1, label: 'Shadow steps', group: 'Quality' }),
  P({ name: 'aoSteps', kind: 'u32', value: 6, min: 0, max: 16, step: 1, label: 'AO samples', group: 'Quality' }),
  P({ name: 'detailDist', kind: 'f32', value: 320.0, min: 30, max: 1500, label: 'Detail fade distance (m)', group: 'Quality' }),
];

// Internal / driven by code, not by sliders.
const INTERNAL: ParamDef[] = [
  P({ name: 'simTime', kind: 'f32', value: 0, min: 0, max: 1, label: 'simTime', group: 'internal', hidden: true }),
  P({ name: 'stepIndex', kind: 'u32', value: 0, min: 0, max: 1, label: 'stepIndex', group: 'internal', hidden: true }),
  P({ name: 'simRunning', kind: 'u32', value: 0, min: 0, max: 1, label: 'simRunning', group: 'internal', hidden: true }),
  P({ name: 'debugView', kind: 'u32', value: 0, min: 0, max: 8, step: 1, label: 'debugView', group: 'internal', hidden: true }),
];

export const PARAM_DEFS: ParamDef[] = [
  ...GEO, ...SHAPE, ...HYDRO, ...ERODE3, ...WATER, ...LOOK, ...MAT, ...QUAL, ...INTERNAL,
];

export const PARAM_GROUPS = [
  'Landform', 'Geology', 'Hydraulics', '3D Erosion', 'Water & Wind', 'Material', 'Lighting', 'Quality',
];

// ---------------------------------------------------------------------------
//  Packing
// ---------------------------------------------------------------------------

/** Scalar count padded so the uniform struct size is a multiple of 16 bytes. */
export const PARAM_COUNT = PARAM_DEFS.length;
export const PARAM_PADDED = Math.ceil(PARAM_COUNT / 4) * 4;
export const PARAM_BYTES = PARAM_PADDED * 4;

/** Generate the WGSL struct declaration matching the packing exactly. */
export function generateParamsWGSL(): string {
  const lines: string[] = [];
  lines.push('// ===========================================================================');
  lines.push('//  GENERATED FROM src/params.ts — DO NOT EDIT BY HAND.');
  lines.push('//  Every member is a 4-byte scalar, so natural WGSL layout packs them');
  lines.push('//  sequentially with no padding. Total size is rounded up to 16 bytes,');
  lines.push('//  as required for the uniform address space.');
  lines.push('// ===========================================================================');
  lines.push('struct Params {');
  let off = 0;
  for (const d of PARAM_DEFS) {
    const pad = ' '.repeat(Math.max(1, 22 - d.name.length));
    lines.push(`  ${d.name}:${pad}${d.kind},${' '.repeat(Math.max(1, 6 - d.kind.length))}// byte ${off * 4}`);
    off++;
  }
  for (let i = off; i < PARAM_PADDED; i++) {
    lines.push(`  _pad${i - off}:                 f32,`);
  }
  lines.push('}');
  return lines.join('\n');
}

export class ParamStore {
  readonly defs = PARAM_DEFS;
  readonly index = new Map<string, number>();
  readonly values: number[] = [];
  readonly buffer = new ArrayBuffer(PARAM_BYTES);
  private readonly f32 = new Float32Array(this.buffer);
  private readonly u32 = new Uint32Array(this.buffer);

  /** Bumped whenever a value changes, so systems can react. */
  revision = 0;
  /** Set when a `rebuild: true` parameter changed. */
  needsRebuild = false;

  constructor() {
    PARAM_DEFS.forEach((d, i) => {
      this.index.set(d.name, i);
      this.values[i] = d.value;
    });
    this.sync();
  }

  get(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`unknown param "${name}"`);
    return this.values[i];
  }

  set(name: string, v: number) {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`unknown param "${name}"`);
    if (this.values[i] === v) return;
    this.values[i] = v;
    if (this.defs[i].rebuild) this.needsRebuild = true;
    this.revision++;
  }

  /** Write the JS values into the packed ArrayBuffer. */
  sync(): ArrayBuffer {
    for (let i = 0; i < PARAM_DEFS.length; i++) {
      if (PARAM_DEFS[i].kind === 'u32') this.u32[i] = this.values[i] >>> 0;
      else this.f32[i] = this.values[i];
    }
    return this.buffer;
  }

  applyPreset(preset: Record<string, number>) {
    for (const [k, v] of Object.entries(preset)) {
      if (this.index.has(k)) this.set(k, v);
    }
  }

  snapshot(): Record<string, number> {
    const o: Record<string, number> = {};
    PARAM_DEFS.forEach((d, i) => { o[d.name] = this.values[i]; });
    return o;
  }
}

// ---------------------------------------------------------------------------
//  PRESETS
// ---------------------------------------------------------------------------
export const PRESETS: Record<string, Record<string, number>> = {
  'Canyon (Colorado Plateau)': {
    bedThickness: 17, strataDip: 0.9, hardContrast: 2.6, capFrac: 0.26,
    jointDensity: 0.0045, jointDepth: 0.45, foldAmp: 14,
    baseHeight: 0.74, upliftAmp: 0.10, incisionDepth: 0.34, incisionWidth: 0.07, meander: 0.16,
    rain: 0.010, riverInflow: 0.55, kCapacity: 1.5, kErode: 0.55,
    undercut: 0.85, weathering: 0.30, saltWeather: 0.35, talusRate: 0.55,
    ironStain: 0.6, desertVarnish: 0.55, sunElev: 22,
  },
  'Badlands (rilled, soft rock)': {
    bedThickness: 6, strataDip: 1.6, hardContrast: 1.5, capFrac: 0.12,
    jointDensity: 0.012, jointDepth: 0.2, foldAmp: 6,
    baseHeight: 0.62, upliftAmp: 0.16, upliftFreq: 2.6, initRough: 0.05,
    incisionDepth: 0.14, incisionWidth: 0.05, meander: 0.24,
    rain: 0.034, riverInflow: 0.22, kCapacity: 2.4, kErode: 1.1, kDeposit: 0.8,
    undercut: 0.45, weathering: 0.75, saltWeather: 0.2, talusRate: 0.9, reposeAngle: 30,
    ironStain: 0.45, desertVarnish: 0.25, dustCover: 0.7, sunElev: 18,
  },
  'Hoodoos & fins (Bryce / Arches)': {
    bedThickness: 11, strataDip: 0.3, hardContrast: 4.6, capFrac: 0.16,
    jointDensity: 0.010, jointDepth: 0.9, jointJitter: 0.35, foldAmp: 5,
    baseHeight: 0.78, upliftAmp: 0.07, incisionDepth: 0.22, incisionWidth: 0.10, meander: 0.10,
    rain: 0.020, riverInflow: 0.25, kCapacity: 1.1, kErode: 0.5,
    undercut: 1.5, undercutReach: 20, weathering: 0.85, exposureBias: 1.2,
    saltWeather: 0.9, collapseThresh: 0.62, talusRate: 0.4,
    ironStain: 1.0, desertVarnish: 0.35, sunElev: 16,
  },
};
