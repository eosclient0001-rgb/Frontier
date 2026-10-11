// =================================================================================================
//  texture-schema.js — the TEXTURE STACK vocabulary
// -------------------------------------------------------------------------------------------------
//  A texture layer binds a procedural material to a mask. Materials are not textures: they are
//  evaluated in world space at shading time, so they never tile, never repeat, and stay sharp at
//  any distance.
//
//  LayerData layout (matches materials.wgsl):
//    p0   kind · enabled · maskMode · flags
//    colA albedo A (rgb) · roughness
//    colB albedo B (rgb) · metalness
//    prm  normalStrength · detailScale(m) · macroScale(m) · heightContrast
//    prm2 opacity · colorVariation · roughnessVariation · heightOffset
//    msk  maskMin · maskMax · maskFeather · maskContrast
//    msk2 noiseScale(m) · noiseContrast · seed · aspectDir(rad)
//    msk3 aspectSpread · aspectFeather · slopeInfluence · macroVariation
// =================================================================================================

export const MATERIALS = [
  { key: 0, label: 'Granite', group: 'Rock', a: '#6b6660', bb: '#3b3833', rough: 0.72, metal: 0.0, detail: 0.55, macro: 7.5, normal: 1.0, colorVar: 0.35 },
  { key: 1, label: 'Sandstone', group: 'Rock', a: '#b08a5e', bb: '#7a5f3f', rough: 0.78, metal: 0.0, detail: 1.4, macro: 22, normal: 1.1, colorVar: 0.3 },
  { key: 2, label: 'Basalt', group: 'Rock', a: '#3a3a3c', bb: '#1c1c1e', rough: 0.6, metal: 0.0, detail: 0.38, macro: 11, normal: 1.15, colorVar: 0.3 },
  { key: 3, label: 'Scree', group: 'Rock', a: '#8a8378', bb: '#4a453e', rough: 0.86, metal: 0.0, detail: 0.33, macro: 6, normal: 1.35, colorVar: 0.4 },
  { key: 4, label: 'Cobble', group: 'Rock', a: '#8f8b82', bb: '#55524c', rough: 0.8, metal: 0.0, detail: 0.5, macro: 5, normal: 1.3, colorVar: 0.4 },
  { key: 14, label: 'Cliff Rock', group: 'Rock', a: '#7d7268', bb: '#403a34', rough: 0.8, metal: 0.0, detail: 0.5, macro: 13, normal: 1.25, colorVar: 0.4 },
  { key: 7, label: 'Soil', group: 'Ground', a: '#6b543c', bb: '#3b2c1e', rough: 0.9, metal: 0.0, detail: 0.11, macro: 8, normal: 0.9, colorVar: 0.45 },
  { key: 6, label: 'Cracked Earth', group: 'Ground', a: '#9a7d5f', bb: '#5e4a36', rough: 0.85, metal: 0.0, detail: 0.5, macro: 14, normal: 1.2, colorVar: 0.4 },
  { key: 5, label: 'Sand', group: 'Ground', a: '#d8c49a', bb: '#ab9367', rough: 0.9, metal: 0.0, detail: 0.13, macro: 26, normal: 0.6, colorVar: 0.25 },
  { key: 12, label: 'Mud', group: 'Ground', a: '#4e3f30', bb: '#2a2018', rough: 0.55, metal: 0.0, detail: 0.2, macro: 9, normal: 0.85, colorVar: 0.35 },
  { key: 13, label: 'Ash', group: 'Ground', a: '#6e6a66', bb: '#3a3735', rough: 0.92, metal: 0.0, detail: 0.1, macro: 20, normal: 0.7, colorVar: 0.3 },
  { key: 8, label: 'Grass', group: 'Vegetation', a: '#6f7a3a', bb: '#3d4a22', rough: 0.85, metal: 0.0, detail: 0.055, macro: 5, normal: 1.1, colorVar: 0.5 },
  { key: 9, label: 'Moss', group: 'Vegetation', a: '#5c7038', bb: '#2f3d22', rough: 0.8, metal: 0.0, detail: 0.045, macro: 4, normal: 1.1, colorVar: 0.5 },
  { key: 10, label: 'Snow', group: 'Frozen', a: '#f2f5f8', bb: '#c3cede', rough: 0.45, metal: 0.0, detail: 0.07, macro: 18, normal: 0.75, colorVar: 0.2 },
  { key: 11, label: 'Ice', group: 'Frozen', a: '#cfe3ee', bb: '#7fa8c4', rough: 0.15, metal: 0.0, detail: 0.6, macro: 16, normal: 0.9, colorVar: 0.3 },
];

export const MATERIAL_GROUPS = ['Rock', 'Ground', 'Vegetation', 'Frozen'];

export const TEX_MASK_MODES = [
  { id: 0, label: 'Everywhere' },
  { id: 1, label: 'Altitude' },
  { id: 2, label: 'Slope' },
  { id: 3, label: 'Curvature' },
  { id: 4, label: 'Fractal noise' },
  { id: 5, label: 'Flow / wetness' },
  { id: 6, label: 'Aspect' },
  { id: 7, label: 'Below water' },
];

export function materialByKey(key) {
  return MATERIALS.find((m) => m.key === key) ?? MATERIALS[0];
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

export function rgbToHex(rgb) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
  return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`;
}

let uid = 0;

export function makeTexLayer(materialKey = 0, overrides = {}) {
  const m = materialByKey(materialKey);
  return {
    id: `xl${++uid}-${Math.random().toString(36).slice(2, 7)}`,
    kind: m.key,
    name: m.label,
    enabled: true,
    opacity: 1,
    // material
    albedoA: m.a,
    albedoB: m.bb,
    roughness: m.rough,
    metalness: m.metal,
    normalStrength: m.normal,
    detailScale: m.detail,
    macroScale: m.macro,
    colorVariation: m.colorVar,
    roughVariation: 0.25,
    macroVariation: 0.5,
    heightContrast: 0.6,
    heightOffset: 0.0,
    // mask
    maskMode: 0,
    maskMin: 0,
    maskMax: 1,
    maskFeather: 0.08,
    maskContrast: 1,
    noiseScale: 30,
    noiseContrast: 1,
    seed: (Math.random() * 9999) | 0,
    aspectDir: 0,
    aspectSpread: 2,
    aspectFeather: 0.1,
    slopeInfluence: 0,
    invert: false,
    ...overrides,
  };
}

export const TEX_LAYER_STRIDE = 32; // floats

export function packTexLayer(out, layer, index) {
  const base = index * TEX_LAYER_STRIDE;
  const v = out;
  const u = new Uint32Array(v.buffer, v.byteOffset + base * 4, 4);

  u[0] = layer.kind | 0;
  u[1] = layer.enabled ? 1 : 0;
  u[2] = layer.maskMode | 0;
  u[3] = (layer.invert ? 1 : 0) | 0;

  const a = hexToRgb(layer.albedoA);
  const b = hexToRgb(layer.albedoB);
  v[base + 4] = a[0]; v[base + 5] = a[1]; v[base + 6] = a[2]; v[base + 7] = layer.roughness;
  v[base + 8] = b[0]; v[base + 9] = b[1]; v[base + 10] = b[2]; v[base + 11] = layer.metalness;
  v[base + 12] = layer.normalStrength;
  v[base + 13] = layer.detailScale;
  v[base + 14] = layer.macroScale;
  v[base + 15] = layer.heightContrast;
  v[base + 16] = layer.opacity;
  v[base + 17] = layer.colorVariation;
  v[base + 18] = layer.roughVariation;
  v[base + 19] = layer.heightOffset;
  v[base + 20] = layer.maskMin;
  v[base + 21] = layer.maskMax;
  v[base + 22] = layer.maskFeather;
  v[base + 23] = layer.maskContrast;
  v[base + 24] = layer.noiseScale;
  v[base + 25] = layer.noiseContrast;
  v[base + 26] = layer.seed;
  v[base + 27] = (layer.aspectDir * Math.PI) / 180;
  v[base + 28] = layer.aspectSpread;
  v[base + 29] = layer.aspectFeather;
  v[base + 30] = layer.slopeInfluence;
  v[base + 31] = layer.macroVariation;
}
