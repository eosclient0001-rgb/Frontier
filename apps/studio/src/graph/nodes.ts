/**
 * Node pipeline state (v0.1: linear pipeline with per-node enable + params).
 *
 * The evaluator is deliberately shaped for a future DAG: each node owns params,
 * enabled/bypass, and versioned state; v0.2 swaps the linear chain for a graph
 * without touching the simulators.
 */
import { TerrainParams, DEFAULT_TERRAIN, LANDFORM_PRESETS, Landform } from '../core/sdf';
import { RainParams, DEFAULT_RAIN } from '../erosion/rain';
import { WindParams, DEFAULT_WIND } from '../erosion/wind';
import { ThermalParams, DEFAULT_THERMAL } from '../erosion/thermal';
import { ChemicalParams, DEFAULT_CHEMICAL } from '../erosion/chemical';
import { ShadeParams, DEFAULT_SHADE } from '../render/materials';
import { PaintMode } from '../ui/paint';

export const WORLD_SIZE = 72; // world units per tile side (v0.1 single tile)

export interface ViewOptions {
  showRainParticles: boolean;
  showWindParticles: boolean;
  showWater: boolean;
  wireframe: boolean;
  shadows: boolean;
  autoRemesh: boolean;
  remeshMs: number;
  simBudgetMs: number;
  fullBakeEvery: number; // every Nth remesh does full AO+curvature bake
  paintArmed: boolean;
  flySpeed: number;
}

export interface BrushState {
  mode: PaintMode;
  radius: number;
  strength: number;
}

export interface AppState {
  terrain: TerrainParams;
  rain: RainParams;
  wind: WindParams;
  thermal: ThermalParams;
  chemical: ChemicalParams;
  shade: ShadeParams;
  view: ViewOptions;
  brush: BrushState;
  playing: boolean;
  volumeRes: number;
}

export function defaultState(): AppState {
  return {
    terrain: { ...DEFAULT_TERRAIN, landform: 'alpine', ...LANDFORM_PRESETS.alpine },
    rain: { ...DEFAULT_RAIN },
    wind: { ...DEFAULT_WIND },
    thermal: { ...DEFAULT_THERMAL },
    chemical: { ...DEFAULT_CHEMICAL },
    shade: { ...DEFAULT_SHADE, waterLevel: 20, snowline: 47, strataFreq: 9 / WORLD_SIZE },
    view: {
      showRainParticles: true,
      showWindParticles: true,
      showWater: true,
      wireframe: false,
      shadows: true,
      autoRemesh: true,
      remeshMs: 450,
      simBudgetMs: 7,
      fullBakeEvery: 4,
      paintArmed: true,
      flySpeed: 20,
    },
    brush: { mode: 'rain', radius: 6, strength: 0.9 },
    playing: false,
    volumeRes: 96,
  };
}

// ---------------------------------------------------------------- scenarios
export interface Scenario {
  name: string;
  hint: string;
  apply: (s: AppState) => void;
}

function setLandform(s: AppState, lf: Landform): void {
  s.terrain.landform = lf;
  Object.assign(s.terrain, LANDFORM_PRESETS[lf]);
}

export const SCENARIOS: Scenario[] = [
  {
    name: 'Alpine Storm',
    hint: 'Ridged peaks + heavy rain. Watch gullies carve live.',
    apply: (s) => {
      setLandform(s, 'alpine');
      Object.assign(s.rain, { enabled: true, rate: 14000, globalRain: 0.55, energyK: 0.11, streamK: 3.0 });
      Object.assign(s.wind, { enabled: false });
      Object.assign(s.thermal, { enabled: true, iterations: 4 });
      Object.assign(s.chemical, { enabled: false });
      Object.assign(s.shade, { waterLevel: 19, snowline: 44, arid: 0.2 });
    },
  },
  {
    name: 'Canyon Monsoon',
    hint: 'Terraced canyon. Paint rain over the rim and breach it.',
    apply: (s) => {
      setLandform(s, 'canyon');
      Object.assign(s.rain, { enabled: true, rate: 9000, globalRain: 0.2, energyK: 0.09, streamK: 3.5, detachK: 5 });
      Object.assign(s.wind, { enabled: false });
      Object.assign(s.thermal, { enabled: true, iterations: 6, talusDeg: 36 });
      Object.assign(s.chemical, { enabled: false });
      Object.assign(s.shade, { waterLevel: 26, snowline: 90, arid: 0.85 });
      s.brush.mode = 'rain';
    },
  },
  {
    name: 'Coastal Bluffs',
    hint: 'Sea cliffs + wind. Abrasion undercuts, rain gullies.',
    apply: (s) => {
      setLandform(s, 'coastal');
      Object.assign(s.rain, { enabled: true, rate: 6000, globalRain: 0.35 });
      Object.assign(s.wind, { enabled: true, rate: 6000, speed: 11, abrasionK: 1.2 });
      Object.assign(s.thermal, { enabled: true, iterations: 4 });
      Object.assign(s.chemical, { enabled: false });
      Object.assign(s.shade, { waterLevel: 23, snowline: 90, arid: 0.45 });
    },
  },
  {
    name: 'Karst Labyrinth',
    hint: 'Dissolving limestone. Rain + chemistry etch pinnacles.',
    apply: (s) => {
      setLandform(s, 'karst');
      Object.assign(s.rain, { enabled: true, rate: 7000, globalRain: 0.4 });
      Object.assign(s.wind, { enabled: false });
      Object.assign(s.thermal, { enabled: false });
      Object.assign(s.chemical, { enabled: true, rate: 0.55, poreFreq: 30, precipRate: 0.08 });
      Object.assign(s.shade, { waterLevel: 24, snowline: 90, arid: 0.3 });
    },
  },
  {
    name: 'Dune Sea',
    hint: 'Pure wind. Saltation builds dunes on the lee slopes.',
    apply: (s) => {
      setLandform(s, 'dunes');
      Object.assign(s.rain, { enabled: false });
      Object.assign(s.wind, { enabled: true, rate: 9000, speed: 13, abrasionK: 0.8, depositK: 4.5, settleSpeed: 2.2 });
      Object.assign(s.thermal, { enabled: true, iterations: 8, talusDeg: 30 });
      Object.assign(s.chemical, { enabled: false });
      Object.assign(s.shade, { waterLevel: 16, snowline: 95, arid: 1.0 });
    },
  },
];

export function applyScenario(s: AppState, i: number): void {
  SCENARIOS[i]?.apply(s);
}
