/* ============================================================
 * Frontier · SDF Terrain Lab — Splatmap library
 *
 * Named material presets: each combines
 *   · palette  — the 5 baked layer albedos (grass/dirt/rock/sand/snow)
 *   · rules    — splat weighting rules (where each layer lives)
 *   · shader   — tint parameters (wet darkening, alluvium, tonal)
 * Selecting a preset re-bakes the textures and re-blends the
 * splatmap — no terrain re-erosion needed.
 * ============================================================ */

export const MATERIALS = [
  {
    id: 'alpine',
    name: 'Alpine Meadow',
    desc: 'Lush grass foothills · loam mid-slopes · warm rock · snow cap',
    palette: {
      grass: [[72, 106, 50], [128, 146, 76]],
      dirt: [[116, 90, 64], [158, 128, 96]],
      rock: [[128, 121, 112], [170, 164, 154]],
      sand: [[174, 152, 110], [202, 184, 144]],
      snow: [[236, 240, 247], [249, 251, 253]],
    },
    rules: {
      grassSlope: [0.15, 0.52], grassFlow: [0.55, 0.95], grassAlt: [34, 58],
      rockSlope: [0.84, 0.96], rockPeak: 0.85, dirtBelt: [0.40, 0.60],
      soilErode: [0.75, 0.95, 0.10], snowCap: 1.0,
    },
    shader: {
      wetStart: 0.30, wetEnd: 0.85, wetStrength: 0.45, wetTint: [0.66, 0.64, 0.62],
      sedStrength: 0.5, sedTint: [1.12, 1.09, 1.03], sedAdd: [0.045, 0.034, 0.018],
      tonal: 0.03,
    },
  },
  {
    id: 'highalpine',
    name: 'High Alpine',
    desc: 'Bare scree and ice · cold blue-gray rock · thin soil',
    palette: {
      grass: [[60, 84, 58], [104, 124, 88]],
      dirt: [[120, 110, 98], [150, 142, 130]],
      rock: [[138, 142, 150], [178, 182, 190]],
      sand: [[170, 164, 148], [200, 196, 180]],
      snow: [[238, 242, 250], [250, 252, 254]],
    },
    rules: {
      grassSlope: [0.12, 0.34], grassFlow: [0.40, 0.80], grassAlt: [18, 40],
      rockSlope: [0.62, 0.85], rockPeak: 0.90, dirtBelt: [0.30, 0.50],
      soilErode: [0.50, 0.60, 0.08], snowCap: 1.15,
    },
    shader: {
      wetStart: 0.30, wetEnd: 0.85, wetStrength: 0.40, wetTint: [0.62, 0.64, 0.68],
      sedStrength: 0.45, sedTint: [1.10, 1.10, 1.08], sedAdd: [0.04, 0.04, 0.045],
      tonal: 0.03,
    },
  },
  {
    id: 'arid',
    name: 'Arid Canyon',
    desc: 'Desert · rust rock · red loam · sparse dry grass · no snow',
    palette: {
      grass: [[116, 104, 58], [150, 138, 84]],
      dirt: [[150, 92, 60], [182, 124, 84]],
      rock: [[140, 104, 80], [178, 142, 116]],
      sand: [[198, 170, 120], [222, 198, 152]],
      snow: [[236, 240, 247], [249, 251, 253]],
    },
    rules: {
      grassSlope: [0.10, 0.30], grassFlow: [0.35, 0.70], grassAlt: [14, 30],
      rockSlope: [0.55, 0.80], rockPeak: 0.80, dirtBelt: [0.25, 0.55],
      soilErode: [0.90, 1.00, 0.15], snowCap: 0.0,
    },
    shader: {
      wetStart: 0.35, wetEnd: 0.90, wetStrength: 0.50, wetTint: [0.70, 0.55, 0.45],
      sedStrength: 0.55, sedTint: [1.15, 1.05, 0.95], sedAdd: [0.05, 0.03, 0.01],
      tonal: 0.035,
    },
  },
  {
    id: 'tundra',
    name: 'Tundra',
    desc: 'Muted gray-green · wind-scoured scree · thin patchy snow',
    palette: {
      grass: [[88, 98, 78], [128, 138, 110]],
      dirt: [[122, 116, 96], [152, 148, 124]],
      rock: [[126, 126, 122], [162, 162, 156]],
      sand: [[168, 162, 140], [196, 190, 166]],
      snow: [[234, 238, 244], [248, 250, 252]],
    },
    rules: {
      grassSlope: [0.12, 0.40], grassFlow: [0.45, 0.85], grassAlt: [18, 42],
      rockSlope: [0.70, 0.90], rockPeak: 0.80, dirtBelt: [0.30, 0.55],
      soilErode: [0.60, 0.70, 0.08], snowCap: 0.70,
    },
    shader: {
      wetStart: 0.30, wetEnd: 0.85, wetStrength: 0.40, wetTint: [0.60, 0.62, 0.62],
      sedStrength: 0.45, sedTint: [1.08, 1.08, 1.04], sedAdd: [0.035, 0.035, 0.03],
      tonal: 0.035,
    },
  },
  {
    id: 'volcanic',
    name: 'Volcanic',
    desc: 'Basalt and ash · near-black rock · no vegetation · glacial ice',
    palette: {
      grass: [[52, 54, 50], [72, 74, 68]],
      dirt: [[66, 62, 58], [92, 88, 82]],
      rock: [[58, 56, 54], [88, 86, 84]],
      sand: [[96, 94, 90], [124, 122, 116]],
      snow: [[226, 230, 238], [242, 245, 250]],
    },
    rules: {
      grassSlope: [0.08, 0.18], grassFlow: [0.30, 0.60], grassAlt: [6, 14],
      rockSlope: [0.40, 0.62], rockPeak: 0.90, dirtBelt: [0.20, 0.50],
      soilErode: [0.80, 0.90, 0.10], snowCap: 0.35,
    },
    shader: {
      wetStart: 0.30, wetEnd: 0.85, wetStrength: 0.50, wetTint: [0.50, 0.50, 0.52],
      sedStrength: 0.40, sedTint: [1.15, 1.15, 1.12], sedAdd: [0.03, 0.03, 0.03],
      tonal: 0.04,
    },
  },
  {
    id: 'badlands',
    name: 'Badlands',
    desc: 'Rill-etched arid loam · rust & tan · sparse dry grass · no snow',
    palette: {
      grass: [[104, 96, 58], [142, 130, 82]],
      dirt: [[150, 88, 54], [188, 124, 82]],
      rock: [[126, 92, 70], [158, 122, 96]],
      sand: [[196, 168, 122], [222, 198, 156]],
      snow: [[240, 244, 248], [251, 252, 254]],
    },
    rules: {
      grassSlope: [0.10, 0.34], grassFlow: [0.40, 0.70], grassAlt: [6, 20],
      rockSlope: [0.62, 0.88], rockPeak: 0.70, dirtBelt: [0.18, 0.58],
      soilErode: [1.00, 1.00, 0.20], snowCap: 0.0,
    },
    shader: {
      wetStart: 0.35, wetEnd: 0.90, wetStrength: 0.50, wetTint: [0.72, 0.56, 0.46],
      sedStrength: 0.60, sedTint: [1.14, 1.06, 0.96], sedAdd: [0.05, 0.03, 0.01],
      tonal: 0.038,
    },
  },
  {
    id: 'glacial',
    name: 'Glacial Till',
    desc: 'Cold stony outwash · boulder slopes · braided rivers · long snow',
    palette: {
      grass: [[96, 104, 82], [134, 142, 110]],
      dirt: [[126, 122, 108], [160, 156, 140]],
      rock: [[138, 142, 150], [178, 182, 190]],
      sand: [[198, 194, 172], [226, 222, 200]],
      snow: [[238, 243, 249], [251, 253, 255]],
    },
    rules: {
      grassSlope: [0.10, 0.35], grassFlow: [0.45, 0.80], grassAlt: [12, 32],
      rockSlope: [0.64, 0.90], rockPeak: 0.80, dirtBelt: [0.26, 0.55],
      soilErode: [0.70, 0.80, 0.12], snowCap: 0.85,
    },
    shader: {
      wetStart: 0.25, wetEnd: 0.50, wetStrength: 0.38, wetTint: [0.62, 0.65, 0.70],
      sedStrength: 0.55, sedTint: [1.10, 1.10, 1.08], sedAdd: [0.04, 0.04, 0.045],
      tonal: 0.030,
    },
  },
  {
    id: 'lichen',
    name: 'Lichen Rock',
    desc: 'Lichen-mottled bare rock · orange/green crusts over grey stone',
    palette: {
      grass: [[124, 112, 66], [164, 146, 88]],
      dirt: [[112, 102, 84], [146, 134, 110]],
      rock: [[128, 124, 116], [168, 162, 152]],
      sand: [[178, 170, 146], [206, 198, 172]],
      snow: [[234, 238, 244], [248, 250, 253]],
    },
    rules: {
      grassSlope: [0.06, 0.45], grassFlow: [0.35, 0.70], grassAlt: [6, 26],
      rockSlope: [0.50, 0.78], rockPeak: 0.60, dirtBelt: [0.24, 0.50],
      soilErode: [0.55, 0.65, 0.10], snowCap: 0.30,
    },
    shader: {
      wetStart: 0.30, wetEnd: 0.55, wetStrength: 0.35, wetTint: [0.64, 0.65, 0.62],
      sedStrength: 0.45, sedTint: [1.08, 1.07, 1.02], sedAdd: [0.03, 0.03, 0.02],
      tonal: 0.035,
    },
  },
  {
    id: 'forest',
    name: 'Temperate Forest',
    desc: 'Deep green canopy · soft humus · hidden rock · light snow',
    palette: {
      grass: [[42, 78, 40], [86, 120, 60]],
      dirt: [[104, 84, 58], [140, 116, 84]],
      rock: [[124, 122, 116], [160, 158, 150]],
      sand: [[178, 160, 120], [204, 188, 148]],
      snow: [[238, 242, 248], [250, 252, 254]],
    },
    rules: {
      grassSlope: [0.15, 0.60], grassFlow: [0.60, 0.95], grassAlt: [30, 55],
      rockSlope: [0.88, 0.98], rockPeak: 0.75, dirtBelt: [0.42, 0.62],
      soilErode: [0.60, 0.70, 0.08], snowCap: 0.60,
    },
    shader: {
      wetStart: 0.30, wetEnd: 0.85, wetStrength: 0.42, wetTint: [0.60, 0.63, 0.60],
      sedStrength: 0.50, sedTint: [1.10, 1.08, 1.02], sedAdd: [0.04, 0.032, 0.016],
      tonal: 0.028,
    },
  },
];

export const getMaterial = (id) => MATERIALS.find((m) => m.id === id) || MATERIALS[0];
