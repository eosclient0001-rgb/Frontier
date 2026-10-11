/**
 * Frontier Terrain Forge — uniform packing for layers, masks and palettes.
 *
 * All of this lands in LayerUniforms (736 bytes), which is the shared parameter
 * block for terrain layers and material layers alike. Field names must match
 * lib/params.wgsl exactly; the writer looks offsets up in the generated layout,
 * so a mismatch is a silent no-op rather than a crash — which is why the
 * packLayer tests assert the resulting numbers instead of trusting the names.
 */
import { MATERIAL_BY_ID, TERRAIN_BY_ID, packLp } from './schema.js';

export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const srgbTriple = (rgb) => [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];

/** Palette entries are authored as display (sRGB) values; the shader wants linear. */
export function rampStops(palette, maxStops = 8) {
  const list = (palette || []).slice(0, maxStops);
  const stops = [];
  for (let i = 0; i < maxStops; i++) {
    const entry = list[Math.min(i, Math.max(list.length - 1, 0))] || [i / (maxStops - 1), [0.5, 0.5, 0.5]];
    const [pos, rgb] = entry;
    const lin = srgbTriple(rgb);
    stops.push([lin[0], lin[1], lin[2], pos]);
  }
  return { stops, count: Math.min(list.length, maxStops) };
}

const EMPTY_MASK = {
  kind: 0, blend: 0, invert: 0, enabled: 0, weight: 0,
  lo: 0, hi: 1, soft: 0, freq: 4, amp: 1, seed: 0, cx: 0.5, cy: 0.5,
  radius: 0.4, extra: 0, extra2: 0, extra3: 0, extra4: 0, extra5: 0, extra6: 0,
};

/**
 * A layer's mask stack, padded to the four slots the uniform block reserves.
 * Masks are applied in order, so the first enabled mask sets the value and the
 * rest combine with it through their blend op.
 */
export function maskEntries(layer) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    const m = layer.masks?.[i];
    if (!m) { out.push({ ...EMPTY_MASK }); continue; }
    out.push({
      kind: Math.max(0, Math.min(10, Math.round(m.kind ?? 1))),
      blend: Math.round(m.blend ?? 0),
      invert: m.invert ? 1 : 0,
      enabled: m.enabled === 0 ? 0 : 1,
      weight: m.weight ?? 1,
      lo: m.lo ?? 0,
      hi: m.hi ?? 1,
      soft: m.soft ?? 0,
      freq: m.freq ?? 4,
      amp: m.amp ?? 1,
      seed: m.seed ?? 0,
      cx: m.cx ?? 0.5,
      cy: m.cy ?? 0.5,
      radius: m.radius ?? 0.4,
      extra: m.extra ?? 0,
      extra2: m.extra2 ?? 0,
      extra3: m.extra3 ?? 0,
      extra4: m.extra4 ?? 0,
      extra5: m.extra5 ?? 0,
      extra6: m.extra6 ?? 0,
    });
  }
  return out;
}

export function layerTypeOf(layer) {
  return TERRAIN_BY_ID[layer.type] || MATERIAL_BY_ID[layer.type] || null;
}

/**
 * Build the LayerUniforms payload for one layer.
 *
 * @param {object} context
 *   context.world     project.world (resolution, worldSize, heightScale, waterLevel)
 *   context.simRes    resolution of the simulation grid, in texels
 *   context.sketchLift how hard the painted sketch lifts the terrain
 *   context.materials true when packing a node from the material stack
 *   context.rampMode  palette evaluation hint (0 auto, 1 height, 2 slope)
 */
export function packLayer(layer, context = {}) {
  const type = layerTypeOf(layer);
  const world = context.world || { resolution: 2048, worldSize: 4096, heightScale: 900, waterLevel: 0.16 };
  const res = world.resolution;          // resolution of the fields this layer reads
  const out = context.outputRes || res;  // resolution of the texture this layer writes
  const cellMeters = world.worldSize / res;
  const lp = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  if (type) packLp(type, layer.params || {}, lp);

  const ramp = type?.palettes ? rampStops(type.palettes[layer.palette] || Object.values(type.palettes)[0]) : { stops: [], count: 0 };
  const material = !!context.materials;
  const tint = layer.tint || { hue: 0, saturation: 1, value: 1, variation: 0.5 };
  const detailSettings = layer.detailSettings || { macroContrast: 1, wear: 0.7, flowInfluence: 0.5 };

  return {
    dims: [out, out],
    worldSize: world.worldSize,
    heightScale: world.heightScale,
    cellMeters,
    seed: layer.seed ?? 0.31,
    amount: layer.amount ?? 1,
    bias: layer.bias ?? 0,
    contrast: layer.contrast ?? 1,
    blend: Math.round(layer.blend ?? 0),
    layerType: type ? type.id.charCodeAt(0) : 0,
    maskCount: Math.max(0, Math.min(4, layer.masks?.length ?? 0)),
    materialType: material ? (MATERIAL_BY_ID[layer.type] ? Object.keys(MATERIAL_BY_ID).indexOf(layer.type) + 1 : 0) : 0,
    simRes: context.simRes ?? res / 2,
    textureRes: res,
    waterLevel: world.waterLevel ?? 0.16,
    sunAzimuth: ((context.sunAzimuth ?? 132) * Math.PI) / 180,
    padF0: 0, padF1: 0, padF2: 0,
    lp,
    masks: maskEntries(layer),
    ramp: ramp.stops,
    rampCount: ramp.count,
    rampMode: Math.round(context.rampMode ?? 0),
    padU0: 0, padU1: 0,
    roughRange: material
      ? [layer.roughMin ?? 0.55, Math.max(layer.roughMin ?? 0.55, layer.roughMax ?? 0.95), layer.metallic ?? 0, layer.normalStrength ?? 1]
      : [1, 1, 0, 0],
    tint: material ? [tint.hue ?? 0, tint.saturation ?? 1, tint.value ?? 1, tint.variation ?? 0.5] : [0, 1, 1, 0],
    detail: material
      ? [
        Math.max((layer.params?.scale ?? 200) / 8, 1),
        layer.params?.detailScale ?? layer.params?.pebbleScale ?? 4,
        layer.params?.stoneAmount ?? layer.params?.pebbleAmount ?? 0.5,
        layer.contrast ?? 1,
      ]
      : [1, (layer.params?.detailScale ?? 120) / 8, 0.5, 1],
    extras: material
      ? [detailSettings.macroContrast ?? 1, detailSettings.wear ?? 0.7, detailSettings.flowInfluence ?? 0.5, 0]
      : [1, 0, layer.params?.heightBias ?? 0, context.sketchLift ?? 0],
  };
}

/** Values for ClearParams (dims, value). */
export function packClear(width, height, value) {
  return { dims: [width, height], value };
}

/** Values for ClearRgbaParams. */
export function packClearRgba(width, height, value) {
  return { dims: [width, height], pad0: 0, pad1: 0, value };
}
