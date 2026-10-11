/**
 * Frontier Terrain Forge — project model.
 *
 * A project is plain JSON: world settings, an ordered terrain stack, an ordered
 * material stack and the viewport settings.
 *
 * The terrain stack holds both generators and erosion simulators, in order. That
 * ordering is the whole point: putting Hydraulic Erosion in the middle of the
 * stack means every layer above it can mask itself with the rivers, wetness and
 * sediment it just produced. Presets are authored as "mass, simulation,
 * dressing" and merged into the single stack the editor and the graph work on. Layers
 * store only the values the user changed away from the schema defaults, which
 * keeps .tforge files small and readable and lets new parameters appear with
 * sensible defaults in old projects.
 */
import {
  DEFAULT_MASK,
  EROSION_BY_ID,
  MATERIAL_BY_ID,
  MATERIAL_TYPES,
  TERRAIN_BY_ID,
  TERRAIN_TYPES,
  defaultParams,
} from './schema.js';

let counter = 0;
export const uid = (prefix = 'id') => `${prefix}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Build a layer object from a type id + partial params + optional masks. */
export function makeLayer(typeId, params = {}, options = {}) {
  const type = TERRAIN_BY_ID[typeId] || MATERIAL_BY_ID[typeId];
  if (!type) throw new Error(`unknown layer type ${typeId}`);
  const layer = {
    id: uid(typeId),
    type: typeId,
    name: options.name || type.label,
    enabled: options.enabled !== false,
    expanded: options.expanded !== false,
    seed: options.seed ?? Math.round(Math.random() * 10000) / 10000,
    amount: options.amount ?? 0.8,
    bias: options.bias ?? 0,
    contrast: options.contrast ?? 1,
    blend: options.blend ?? 0,
    params: { ...defaultParams(type), ...params },
    masks: options.masks ? options.masks.map((m) => ({ ...DEFAULT_MASK(m.kind ?? 1), ...m })) : [],
  };
  if (type.transform && options.blend === undefined) layer.blend = 0; // add: transforms emit deltas
  if (options.material) {
    layer.roughMin = options.roughMin ?? 0.55;
    layer.roughMax = options.roughMax ?? 0.95;
    layer.metallic = options.metallic ?? 0;
    layer.normalStrength = options.normalStrength ?? 1;
    layer.palette = options.palette || Object.keys(type.palettes || {})[0];
    layer.ramp = options.ramp || null;
    layer.tint = { hue: options.hue ?? 0, saturation: options.saturation ?? 1, value: options.value ?? 1, variation: options.variation ?? 0.5 };
    layer.detailSettings = { macroContrast: options.macroContrast ?? 1, wear: options.wear ?? 0.7, flowInfluence: options.flowInfluence ?? 0.5 };
    layer.paintEnabled = false;
  }
  return layer;
}

export function makeErosionLayer(typeId, params = {}) {
  const type = EROSION_BY_ID[typeId];
  const out = {
    id: uid(typeId),
    kind: 'sim',
    type: typeId,
    name: type.label,
    enabled: true,
    expanded: true,
    amount: params.amount ?? 1,
    flowGain: params.flowGain ?? 1,
    depositGain: params.depositGain ?? 1,
    params: { ...defaultParams(type), ...params },
  };
  delete out.params.amount;
  return out;
}

/** Dressing layers sit above the simulation in the stack. */
const DRESSING = new Set(['strata', 'cracks', 'warpLayer', 'smooth', 'detail', 'flat']);

/** Merge the authored "mass / simulation" pair into one ordered stack. */
export function mergeStack(terrain = [], erosion = []) {
  const stack = [...terrain];
  if (!erosion.length) return stack;
  let insertAt = stack.findIndex((layer) => DRESSING.has(layer.type));
  if (insertAt < 0) insertAt = stack.length;
  stack.splice(insertAt, 0, ...erosion.map((layer) => ({ kind: 'sim', ...layer })));
  return stack;
}

function finalize(project) {
  if (Array.isArray(project.erosion) && project.erosion.length) {
    project.terrain = mergeStack(project.terrain, project.erosion);
  }
  delete project.erosion;
  project.terrain = (project.terrain || []).map((layer) => (
    EROSION_BY_ID[layer.type] ? { kind: 'sim', ...layer } : layer
  ));
  return project;
}

const mask = (kind, over = {}) => ({ ...DEFAULT_MASK(kind), ...over });

export function createProject(overrides = {}) {
  const project = {
    format: 'frontier.terrainforge',
    version: 1,
    name: 'Untitled terrain',
    seed: 48271,
    world: { resolution: 2048, worldSize: 4096, heightScale: 900, waterLevel: 0.16, meshResolution: 512 },
    terrain: [
      makeLayer('noise', { scale: 5200, octaves: 6, level: 0.42, variant: 0, warp: 0.5, warpFreq: 0.35 }, { name: 'Continents', amount: 0.55, blend: 5, seed: 0.11 }),
      makeLayer('mountain', { scale: 1750, octaves: 9, ridgeMix: 0.78, sharpness: 1.7, warp: 0.6, detail: 0.16, crestRound: 0.28 },
        { name: 'Ranges', amount: 0.92, seed: 0.23, masks: [mask(3, { freq: 3.2, amp: 0.85, seed: 0.61 })] }),
      makeLayer('hills', { scale: 620, octaves: 7, roundness: 0.6, billowMix: 0.45 }, { name: 'Foothills', amount: 0.3, seed: 0.37 }),
      makeLayer('strata', { thickness: 68, sharpness: 5, ledgeDepth: 0.14, tilt: 0.1, warp: 0.2 }, { name: 'Bedding', amount: 0.3, seed: 0.5 }),
      makeLayer('detail', { amplitude: 0.07, contrast: 1.5, valleyBias: 0.45 }, { name: 'Rock detail', amount: 1, seed: 0.66 }),
    ],
    erosion: [
      makeErosionLayer('hydraulic', { iterations: 150, capacity: 7.5, rain: 0.0009, dissolve: 0.5, depositRate: 0.55, maxRate: 0.06 }),
      makeErosionLayer('thermal', { iterations: 55, talus: 0.62, rate: 0.42 }),
    ],
    materials: [
      makeLayer('rock', { beddingScale: 30, mineralScale: 22, crevice: 0.6 },
        { name: 'Bedrock', material: true, amount: 1, palette: 'granite', roughMin: 0.6, roughMax: 0.95, seed: 0.1,
          masks: [mask(1, { lo: 0.26, hi: 0.95, soft: 0.08 })] }),
      makeLayer('gravel', { stoneScale: 3.2, stoneAmount: 0.65 },
        { name: 'Scree', material: true, amount: 0.85, palette: 'scree', roughMin: 0.7, roughMax: 1, seed: 0.18,
          masks: [mask(1, { lo: 0.3, hi: 1, soft: 0.1 }), mask(3, { freq: 14, amp: 0.7, seed: 0.44, blend: 1 })] }),
      makeLayer('grass', { dryScale: 95, dryness: 0.45, bladeScale: 1.6 },
        { name: 'Alpine grass', material: true, amount: 0.95, palette: 'alpine', roughMin: 0.72, roughMax: 0.98, seed: 0.27,
          masks: [mask(1, { lo: 0, hi: 0.42, soft: 0.09 }), mask(2, { lo: 0, hi: 0.63, soft: 0.1 })] }),
      makeLayer('forest', { litterScale: 4, mossScale: 42, mossAmount: 0.42 },
        { name: 'Forest floor', material: true, amount: 0.9, palette: 'conifer', roughMin: 0.8, roughMax: 1, seed: 0.33,
          masks: [mask(3, { freq: 6.5, amp: 0.95, seed: 0.72 }), mask(1, { lo: 0, hi: 0.35, soft: 0.1 }), mask(2, { lo: 0.05, hi: 0.55, soft: 0.12 })] }),
      makeLayer('sand', { rippleScale: 3.2, damp: 0.7 },
        { name: 'Shoreline', material: true, amount: 0.9, palette: 'beach', roughMin: 0.5, roughMax: 0.8, seed: 0.4,
          masks: [mask(2, { lo: 0, hi: 0.2, soft: 0.06 }), mask(4, { amp: 0.9, blend: 1 })] }),
      makeLayer('snow', { sastrugiScale: 24, creviceBlue: 0.55 },
        { name: 'Snowfields', material: true, amount: 0.95, palette: 'windcrust', roughMin: 0.4, roughMax: 0.75, seed: 0.47,
          masks: [mask(2, { lo: 0.62, hi: 1.2, soft: 0.1 }), mask(1, { lo: 0, hi: 0.55, soft: 0.12 }), mask(3, { freq: 9, amp: 0.6, seed: 0.2 })] }),
    ],
    texture: {
      resolution: 2048,
      wetness: 1,
      dust: 0.6,
      aoStrength: 0.9,
      cavityStrength: 0.5,
      wetSaturation: 0.7,
      splatBlend: 1,
    },
    display: {
      viewMode: 0,
      sunAzimuth: 132,
      sunElevation: 34,
      sunIntensity: 3.4,
      ambient: 0.32,
      exposure: 1,
      contrast: 1.06,
      saturation: 1.06,
      vignette: 0.35,
      grain: 0.25,
      fogDensity: 1.4,
      fogStart: 60,
      fogHeightFalloff: 1.2,
      aerial: 0.85,
      shadows: true,
      contourLines: false,
      contourInterval: 50,
      slopeOverlay: false,
      wireframe: false,
      water: true,
      cameraMode: 'perspective',
    },
    brush: {
      tool: 'raise',
      radius: 0.06,
      strength: 0.35,
      falloff: 1.4,
      spacing: 0.4,
      target: 'sculpt',
    },
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && project[key] && typeof project[key] === 'object' && !Array.isArray(project[key])) {
      project[key] = { ...project[key], ...value };
    } else {
      project[key] = value;
    }
  }
  return finalize(project);
}

/** Fill in anything a loaded project is missing (forward compatibility). */
export function normalizeProject(input) {
  const base = createProject();
  if (!input || typeof input !== 'object') return base;
  const project = { ...base, ...input };
  project.world = { ...base.world, ...(input.world || {}) };
  project.texture = { ...base.texture, ...(input.texture || {}) };
  project.display = { ...base.display, ...(input.display || {}) };
  project.brush = { ...base.brush, ...(input.brush || {}) };
  const seedTerrain = input.terrain || base.terrain;
  const seedErosion = input.erosion || [];
  project.terrain = mergeStack(seedTerrain, seedErosion).map(rehydrateEntry);
  project.materials = (input.materials || base.materials).map((layer) => rehydrateLayer(layer, MATERIAL_BY_ID));
  return finalize(project);
}

function rehydrateEntry(layer) {
  const sim = EROSION_BY_ID[layer.type];
  if (!sim) return rehydrateLayer(layer, TERRAIN_BY_ID);
  return {
    ...layer,
    kind: 'sim',
    params: { ...defaultParams(sim), ...(layer.params || {}) },
    enabled: layer.enabled !== false,
    expanded: layer.expanded !== false,
    amount: layer.amount ?? 1,
    flowGain: layer.flowGain ?? 1,
    depositGain: layer.depositGain ?? 1,
  };
}

function rehydrateLayer(layer, table) {
  const type = table[layer.type];
  if (!type) return layer;
  const out = {
    ...layer,
    params: { ...defaultParams(type), ...(layer.params || {}) },
    masks: (layer.masks || []).map((m) => ({ ...DEFAULT_MASK(m.kind ?? 1), ...m })),
    enabled: layer.enabled !== false,
    expanded: layer.expanded !== false,
  };
  if (type.palettes) {
    out.palette = layer.palette && type.palettes[layer.palette] ? layer.palette : Object.keys(type.palettes)[0];
    out.ramp = layer.ramp || null;
    out.tint = { hue: 0, saturation: 1, value: 1, variation: 0.5, ...(layer.tint || {}) };
    out.detailSettings = { macroContrast: 1, wear: 0.7, flowInfluence: 0.5, ...(layer.detailSettings || {}) };
    out.roughMin = layer.roughMin ?? 0.6;
    out.roughMax = layer.roughMax ?? 0.95;
    out.metallic = layer.metallic ?? 0;
    out.normalStrength = layer.normalStrength ?? 1;
  }
  return out;
}

export function serializeProject(project) {
  const clone = JSON.parse(JSON.stringify(project));
  for (const layer of [...clone.terrain, ...clone.materials]) {
    // Store only what differs from the schema defaults.
    const type = TERRAIN_BY_ID[layer.type] || MATERIAL_BY_ID[layer.type];
    if (!type) continue;
    const defaults = defaultParams(type);
    const sparse = {};
    for (const [key, value] of Object.entries(layer.params || {})) {
      if (defaults[key] !== value) sparse[key] = value;
    }
    layer.params = sparse;
  }
  return JSON.stringify(clone, null, 2);
}

/* ------------------------------------------------------------------ *
 * Presets — each one is a complete, tuned project.
 * ------------------------------------------------------------------ */
const P = (name, description, build) => ({ name, description, build });

export const PRESETS = [
  P('Alpine Massif', 'Ridged ranges, dendritic erosion, scree aprons and a snow line.', () => createProject()),

  P('Desert Canyon', 'Layered mesas cut by a canyon network, with aeolian sand in the hollows.', () => {
    const project = createProject({ name: 'Desert canyon' });
    project.world.heightScale = 780;
    project.world.waterLevel = 0.04;
    project.terrain = [
      makeLayer('plateau', { scale: 2600, flatTopLevel: 0.42, edgeSharpness: 0.1, shelfSteps: 6, shelfBlend: 0.6, wallRoughness: 0.16 },
        { name: 'Mesas', amount: 0.95, blend: 5, seed: 0.12 }),
      makeLayer('canyon', { scale: 1400, depth: 0.42, carveSharpness: 2.4, floorFlatness: 0.85, tributary: 0.55 },
        { name: 'Canyon network', amount: 0.9, blend: 1, seed: 0.28 }),
      makeLayer('strata', { thickness: 46, sharpness: 5.5, ledgeDepth: 0.18 }, { name: 'Bedding', amount: 0.45, seed: 0.4 }),
      makeLayer('dunes', { scale: 240, height: 0.32, symmetry: 0.7, bearing: 0.9 },
        { name: 'Sand seas', amount: 0.75, blend: 3, seed: 0.55, masks: [mask(1, { lo: 0, hi: 0.22, soft: 0.1 })] }),
      makeLayer('detail', { amplitude: 0.05, contrast: 1.6 }, { name: 'Sand detail', amount: 1, seed: 0.7 }),
    ];
    project.erosion = [
      makeErosionLayer('hydraulic', { iterations: 90, capacity: 5, rain: 0.00035, pipePower: 0.6, evaporation: 0.02, maxRate: 0.05 }),
      makeErosionLayer('thermal', { iterations: 70, talus: 0.5, rate: 0.5 }),
    ];
    project.materials = [
      makeLayer('rock', { beddingScale: 26, beddingStrength: 0.7, crevice: 0.5 }, { name: 'Sandstone', material: true, amount: 1, palette: 'sandstone', roughMin: 0.65, roughMax: 0.95, masks: [mask(1, { lo: 0.2, hi: 1, soft: 0.08 })] }),
      makeLayer('sand', { rippleScale: 2.6, rippleAmount: 0.6 }, { name: 'Dune sand', material: true, amount: 0.95, palette: 'desert', roughMin: 0.5, roughMax: 0.8, seed: 0.2, masks: [mask(1, { lo: 0, hi: 0.3, soft: 0.1 }), mask(3, { freq: 8, amp: 0.7, seed: 0.5 })] }),
      makeLayer('gravel', { stoneScale: 2.4 }, { name: 'Desert pavement', material: true, amount: 0.7, palette: 'redrock', roughMin: 0.7, roughMax: 1, masks: [mask(5, { amp: 1.2 }), mask(1, { lo: 0, hi: 0.22, soft: 0.1 })] }),
      makeLayer('custom', { detailScale: 3, detailAmount: 0.5 }, { name: 'Dust', material: true, amount: 0.6, palette: 'redplanet', roughMin: 0.7, roughMax: 1, seed: 0.6 }),
    ];
    project.display.sunElevation = 26;
    project.display.sunAzimuth = 96;
    project.display.fogDensity = 0.9;
    return project;
  }),

  P('Volcanic Archipelago', 'A stratovolcano island chain with basalt coastlines and ash plains.', () => {
    const project = createProject({ name: 'Volcanic archipelago' });
    project.world.heightScale = 1150;
    project.world.waterLevel = 0.2;
    project.terrain = [
      makeLayer('island', { radius: 2200, coastRaggedness: 0.45, inlandRelief: 0.5, shelfWidth: 0.1 },
        { name: 'Island mass', amount: 1, blend: 5, seed: 0.1 }),
      makeLayer('volcano', { radius: 1150, conePower: 1.45, gullies: 0.16, craterRadius: 0.13, craterDepth: 0.14, rimHeight: 0.09, centerX: 0.46, centerY: 0.52 },
        { name: 'Principal volcano', amount: 0.95, seed: 0.24 }),
      makeLayer('volcano', { radius: 520, conePower: 1.2, craterRadius: 0.18, craterDepth: 0.2, centerX: 0.72, centerY: 0.34, baseLevel: 0.36 },
        { name: 'Cinder cone', amount: 0.8, seed: 0.36 }),
      makeLayer('cracks', { crackWidth: 0.1, crackDepth: 0.16 }, { name: 'Lava fissures', amount: 0.35, seed: 0.44 }),
      makeLayer('detail', { amplitude: 0.09, contrast: 1.5 }, { name: 'Basalt detail', amount: 1, seed: 0.55 }),
    ];
    project.erosion = [
      makeErosionLayer('hydraulic', { iterations: 170, capacity: 10, rain: 0.0016, dissolve: 0.6, pipePower: 0.42, maxRate: 0.08 }),
      makeErosionLayer('thermal', { iterations: 45, talus: 0.75, rate: 0.45 }),
    ];
    project.materials = [
      makeLayer('rock', { beddingScale: 18, mineralScale: 14, crevice: 0.65 }, { name: 'Basalt', material: true, amount: 1, palette: 'basalt', roughMin: 0.55, roughMax: 0.9, masks: [mask(1, { lo: 0.22, hi: 1, soft: 0.08 })] }),
      makeLayer('gravel', { stoneScale: 2, stoneAmount: 0.7 }, { name: 'Lava rubble', material: true, amount: 0.85, palette: 'scree', roughMin: 0.75, roughMax: 1, seed: 0.2 }),
      makeLayer('custom', { palette: 'ash' }, { name: 'Ash plains', material: true, amount: 0.9, palette: 'ash', roughMin: 0.8, roughMax: 1, seed: 0.3, masks: [mask(1, { lo: 0, hi: 0.28, soft: 0.1 }), mask(2, { lo: 0.2, hi: 0.6, soft: 0.12 })] }),
      makeLayer('grass', { dryness: 0.6, dryScale: 70 }, { name: 'Windward grass', material: true, amount: 0.7, palette: 'savanna', roughMin: 0.75, roughMax: 1, seed: 0.4, masks: [mask(2, { lo: 0.2, hi: 0.42, soft: 0.08 }), mask(1, { lo: 0, hi: 0.3, soft: 0.1 }), mask(3, { freq: 7, amp: 0.8, seed: 0.8 })] }),
      makeLayer('sand', { palette: 'volcanic', rippleScale: 2.2 }, { name: 'Black sand', material: true, amount: 0.9, palette: 'volcanic', roughMin: 0.45, roughMax: 0.75, masks: [mask(2, { lo: 0.16, hi: 0.24, soft: 0.05 }), mask(4, { amp: 1.1 })] }),
    ];
    project.display.sunElevation = 22;
    project.display.sunAzimuth = 158;
    project.display.fogDensity = 1.6;
    return project;
  }),

  P('Fjord Coast', 'Glacially scoured valleys flooded by the sea, with a strong wetness response.', () => {
    const project = createProject({ name: 'Fjord coast' });
    project.world.heightScale = 1250;
    project.world.waterLevel = 0.24;
    project.terrain = [
      makeLayer('noise', { scale: 4200, octaves: 5, variant: 6, level: 0.46 }, { name: 'Massif', amount: 0.6, blend: 5, seed: 0.08 }),
      makeLayer('mountain', { scale: 2100, octaves: 9, ridgeMix: 0.6, sharpness: 2.1, crestRound: 0.5, warp: 0.7 },
        { name: 'Scoured ranges', amount: 0.95, seed: 0.2 }),
      makeLayer('warpLayer', { distance: 320, warp: 0.85, warpFreq: 0.35, direction: 0.7, bearing: 1.2, stretch: 0.4 },
        { name: 'Glacial flow', amount: 0.55, seed: 0.33 }),
      makeLayer('detail', { amplitude: 0.06, contrast: 1.4 }, { name: 'Rock detail', amount: 1, seed: 0.44 }),
    ];
    project.erosion = [
      makeErosionLayer('hydraulic', { iterations: 130, capacity: 9, rain: 0.0014, pipePower: 0.5, maxRate: 0.07 }),
      makeErosionLayer('thermal', { iterations: 80, talus: 0.55, rate: 0.5 }),
    ];
    project.materials = [
      makeLayer('rock', { beddingScale: 22, crevice: 0.55 }, { name: 'Wet rock', material: true, amount: 1, palette: 'slate', roughMin: 0.35, roughMax: 0.8, masks: [mask(1, { lo: 0.18, hi: 1, soft: 0.08 })] }),
      makeLayer('gravel', { stoneScale: 2.6 }, { name: 'Talus', material: true, amount: 0.8, palette: 'scree', roughMin: 0.7, roughMax: 1 }),
      makeLayer('forest', { palette: 'conifer' }, { name: 'Cloud forest', material: true, amount: 0.9, palette: 'conifer', roughMin: 0.8, roughMax: 1, seed: 0.3, masks: [mask(2, { lo: 0.28, hi: 0.6, soft: 0.1 }), mask(1, { lo: 0, hi: 0.5, soft: 0.12 })] }),
      makeLayer('snow', { sastrugiScale: 30 }, { name: 'Snow', material: true, amount: 0.95, palette: 'fresh', roughMin: 0.35, roughMax: 0.7, masks: [mask(2, { lo: 0.66, hi: 1.2, soft: 0.12 })] }),
      makeLayer('grass', {}, { name: 'Seaward grass', material: true, amount: 0.75, palette: 'meadow', roughMin: 0.72, roughMax: 0.98, masks: [mask(2, { lo: 0.24, hi: 0.36, soft: 0.08 }), mask(1, { lo: 0, hi: 0.34, soft: 0.1 })] }),
    ];
    project.display.sunElevation = 30;
    project.display.sunAzimuth = 210;
    project.display.fogDensity = 2.1;
    return project;
  }),

  P('Rolling Farmland', 'Gentle hills, shallow erosion and a meadow/soil/forest patchwork.', () => {
    const project = createProject({ name: 'Rolling farmland' });
    project.world = { ...project.world, heightScale: 340, waterLevel: 0.1 };
    project.terrain = [
      makeLayer('hills', { scale: 900, roundness: 0.7, billowMix: 0.5 }, { name: 'Downs', amount: 1, blend: 5, seed: 0.09 }),
      makeLayer('hills', { scale: 320, roundness: 0.55 }, { name: 'Fields', amount: 0.35, seed: 0.21 }),
      makeLayer('detail', { amplitude: 0.035 }, { name: 'Clods', amount: 1, seed: 0.3 }),
    ];
    project.erosion = [
      makeErosionLayer('hydraulic', { iterations: 60, capacity: 4, rain: 0.0011, pipePower: 0.5, maxRate: 0.03 }),
      makeErosionLayer('thermal', { iterations: 30, talus: 0.8, rate: 0.35 }),
    ];
    project.materials = [
      makeLayer('grass', { dryness: 0.35, dryScale: 60, bladeStrength: 0.45 }, { name: 'Pasture', material: true, amount: 0.95, palette: 'meadow', roughMin: 0.75, roughMax: 1, masks: [mask(1, { lo: 0, hi: 0.5, soft: 0.12 }), mask(2, { lo: 0, hi: 0.8, soft: 0.15 })] }),
      makeLayer('soil', { pebbleScale: 7, moisture: 0.5 }, { name: 'Ploughed soil', material: true, amount: 0.8, palette: 'loam', roughMin: 0.8, roughMax: 1, seed: 0.2, masks: [mask(3, { freq: 5, amp: 0.95, seed: 0.66 }), mask(1, { lo: 0, hi: 0.4, soft: 0.1 })] }),
      makeLayer('forest', { mossAmount: 0.3, litterAmount: 0.45 }, { name: 'Woodland', material: true, amount: 0.85, palette: 'broadleaf', roughMin: 0.8, roughMax: 1, seed: 0.34, masks: [mask(3, { freq: 3.6, amp: 0.95, seed: 0.19 }), mask(2, { lo: 0, hi: 0.7, soft: 0.15 })] }),
      makeLayer('sand', { rippleAmount: 0.25 }, { name: 'River gravel', material: true, amount: 0.8, palette: 'beach', roughMin: 0.6, roughMax: 0.9, masks: [mask(4, { amp: 1.3 }), mask(1, { lo: 0, hi: 0.18, soft: 0.08 })] }),
    ];
    project.display.sunElevation = 42;
    project.display.sunAzimuth = 118;
    project.display.fogDensity = 2.6;
    return project;
  }),

  P('Badlands', 'Eroded dry badlands: strata, cracks, gullies and iron-rich soil.', () => {
    const project = createProject({ name: 'Badlands' });
    project.world.heightScale = 520;
    project.world.waterLevel = 0.03;
    project.terrain = [
      makeLayer('noise', { scale: 2600, octaves: 6, variant: 2, level: 0.5, sharpness: 1.4 }, { name: 'Base relief', amount: 0.7, blend: 5, seed: 0.1 }),
      makeLayer('strata', { thickness: 22, sharpness: 6.5, ledgeDepth: 0.26, tilt: 0.18 }, { name: 'Sedimentary bedding', amount: 0.65, seed: 0.22 }),
      makeLayer('canyon', { scale: 700, depth: 0.34, carveSharpness: 3, floorFlatness: 0.6, tributary: 0.7 }, { name: 'Gully network', amount: 0.85, blend: 1, seed: 0.35 }),
      makeLayer('cracks', { scale: 160, crackWidth: 0.09, crackDepth: 0.14 }, { name: 'Mud cracks', amount: 0.4, seed: 0.46 }),
      makeLayer('detail', { amplitude: 0.07, contrast: 1.7 }, { name: 'Grit', amount: 1, seed: 0.6 }),
    ];
    project.erosion = [
      makeErosionLayer('hydraulic', { iterations: 200, capacity: 12, rain: 0.0022, dissolve: 0.7, pipePower: 0.38, evaporation: 0.02, maxRate: 0.09 }),
      makeErosionLayer('thermal', { iterations: 90, talus: 0.42, rate: 0.55 }),
    ];
    project.materials = [
      makeLayer('soil', { pebbleScale: 5, patchScale: 40, moisture: 0.25 }, { name: 'Iron soil', material: true, amount: 1, palette: 'clay', roughMin: 0.75, roughMax: 1, masks: [mask(1, { lo: 0, hi: 0.5, soft: 0.1 })] }),
      makeLayer('rock', { beddingScale: 12, beddingStrength: 0.75, crevice: 0.6 }, { name: 'Layered rock', material: true, amount: 0.9, palette: 'sandstone', roughMin: 0.6, roughMax: 0.95, seed: 0.18, masks: [mask(1, { lo: 0.3, hi: 1, soft: 0.09 })] }),
      makeLayer('gravel', { stoneScale: 1.6, stoneAmount: 0.75 }, { name: 'Rubble', material: true, amount: 0.8, palette: 'redrock', roughMin: 0.75, roughMax: 1, masks: [mask(5, { amp: 1.4 })] }),
      makeLayer('custom', { detailAmount: 0.55 }, { name: 'Salt pan', material: true, amount: 0.7, palette: 'gypsum', roughMin: 0.5, roughMax: 0.85, masks: [mask(4, { amp: 1.4 }), mask(1, { lo: 0, hi: 0.12, soft: 0.06 })] }),
    ];
    project.display.sunElevation = 20;
    project.display.sunAzimuth = 74;
    project.display.fogDensity = 0.8;
    return project;
  }),

  P('Dune Sea', 'An erg of stacked dune trains, rippled sand grain and hard rock outcrops.', () => {
    const project = createProject({ name: 'Dune sea' });
    project.world.heightScale = 260;
    project.world.waterLevel = 0;
    project.terrain = [
      makeLayer('dunes', { scale: 380, height: 0.55, symmetry: 0.68, bearing: 0.85, stretch: 0.18, rippleAmount: 0.5 }, { name: 'Main erg', amount: 1, blend: 5, seed: 0.1 }),
      makeLayer('dunes', { scale: 110, height: 0.3, symmetry: 0.75, bearing: 1.6, stretch: 0.25 }, { name: 'Secondary trains', amount: 0.6, seed: 0.25 }),
      makeLayer('cracks', { scale: 60, crackDepth: 0.1, crackWidth: 0.07 }, { name: 'Deflation cracks', amount: 0.25, seed: 0.4 }),
      makeLayer('detail', { amplitude: 0.045, contrast: 1.4 }, { name: 'Grain', amount: 1, seed: 0.55 }),
    ];
    project.erosion = [makeErosionLayer('thermal', { iterations: 40, talus: 1.05, rate: 0.35 })];
    project.materials = [
      makeLayer('sand', { rippleScale: 2.2, rippleAmount: 0.75, speckleAmount: 0.35 }, { name: 'Dune sand', material: true, amount: 1, palette: 'desert', roughMin: 0.45, roughMax: 0.78 }),
      makeLayer('sand', { rippleScale: 6, rippleBearing: 2.2, palette: 'beach' }, { name: 'Coarse sand', material: true, amount: 0.6, palette: 'beach', roughMin: 0.55, roughMax: 0.85, seed: 0.3, masks: [mask(3, { freq: 6, amp: 0.9, seed: 0.44 })] }),
      makeLayer('rock', { beddingScale: 14, crevice: 0.5 }, { name: 'Outcrops', material: true, amount: 0.85, palette: 'sandstone', roughMin: 0.65, roughMax: 0.95, masks: [mask(5, { amp: 1.6 }), mask(1, { lo: 0.05, hi: 1, soft: 0.05 })] }),
    ];
    project.display.sunElevation = 16;
    project.display.sunAzimuth = 108;
    project.display.fogDensity = 1.2;
    return project;
  }),

  P('Snowbound Plateau', 'A high, wind-scoured plateau with cornices, ice and exposed rock ribs.', () => {
    const project = createProject({ name: 'Snowbound plateau' });
    project.world = { ...project.world, heightScale: 700, waterLevel: 0.02 };
    project.terrain = [
      makeLayer('plateau', { scale: 3400, flatTopLevel: 0.5, edgeSharpness: 0.18, shelfSteps: 3, shelfBlend: 0.35 }, { name: 'Ice cap', amount: 1, blend: 5, seed: 0.09 }),
      makeLayer('mountain', { scale: 1300, octaves: 8, ridgeMix: 0.55, sharpness: 2.2, crestRound: 0.55 }, { name: 'Nunataks', amount: 0.55, seed: 0.2, masks: [mask(3, { freq: 4, amp: 0.95, seed: 0.5 })] }),
      makeLayer('warpLayer', { distance: 260, warp: 0.9, bearing: 0.6, stretch: 0.25, direction: 0.5 }, { name: 'Katabatic wind', amount: 0.4, seed: 0.35 }),
      makeLayer('detail', { amplitude: 0.05, contrast: 1.3 }, { name: 'Crust detail', amount: 1, seed: 0.5 }),
    ];
    project.erosion = [
      makeErosionLayer('hydraulic', { iterations: 70, capacity: 6, rain: 0.0006, pipePower: 0.55, maxRate: 0.04 }),
      makeErosionLayer('thermal', { iterations: 70, talus: 0.5, rate: 0.5 }),
    ];
    project.materials = [
      makeLayer('snow', { sastrugiScale: 26, sastrugiAmount: 0.6, creviceBlue: 0.6 }, { name: 'Wind crust', material: true, amount: 1, palette: 'windcrust', roughMin: 0.35, roughMax: 0.72, masks: [mask(1, { lo: 0, hi: 0.6, soft: 0.15 })] }),
      makeLayer('snow', { sastrugiAmount: 0.35 }, { name: 'Deep drift', material: true, amount: 0.9, palette: 'fresh', roughMin: 0.3, roughMax: 0.6, seed: 0.2, masks: [mask(6, { amp: 1.4 })] }),
      makeLayer('custom', { detailAmount: 0.35 }, { name: 'Blue ice', material: true, amount: 0.85, palette: 'glacier', roughMin: 0.2, roughMax: 0.5, masks: [mask(1, { lo: 0.45, hi: 1, soft: 0.1 }), mask(4, { amp: 1.2 })] }),
      makeLayer('rock', { beddingScale: 16, crevice: 0.6 }, { name: 'Rock ribs', material: true, amount: 0.9, palette: 'slate', roughMin: 0.55, roughMax: 0.9, masks: [mask(1, { lo: 0.62, hi: 1, soft: 0.1 })] }),
    ];
    project.display.sunElevation = 14;
    project.display.sunAzimuth = 168;
    project.display.fogDensity = 1.9;
    return project;
  }),
];

export function applyPreset(preset) {
  return normalizeProject(preset.build());
}

/** Sanity check for the data model — run by tools/check.mjs. */
export function validateProject(project) {
  const problems = [];
  for (const layer of project.terrain) {
    if (!EROSION_BY_ID[layer.type] && !TERRAIN_BY_ID[layer.type]) problems.push(`unknown terrain type ${layer.type}`);
    if (layer.masks && layer.masks.length > 4) problems.push(`${layer.name}: the uniform block holds 4 masks`);
  }
  for (const layer of project.materials) {
    if (!MATERIAL_BY_ID[layer.type]) problems.push(`unknown material type ${layer.type}`);
    if (layer.masks && layer.masks.length > 4) problems.push(`${layer.name}: the uniform block holds 4 masks`);
  }
  return problems;
}
