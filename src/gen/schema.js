/**
 * Frontier Terrain Forge — parameter schema.
 *
 * Every slider in the inspector, every uniform slot in a shader and every value
 * in a saved project come from this file. A layer type is described once:
 * which generator template it uses, which lp[] slot each control writes to, how
 * it should be labelled, and what a sensible default is. The UI, the uniform
 * packer and the presets all read from here, so adding a generator means adding
 * a WGSL template plus one entry below — never touching the inspector.
 *
 * Slot notation: 'lp2.y' → LayerUniforms.lp[2].y.
 *   lp0 = (scale, octaves, lacunarity, gain)
 *   lp1..lp3 and lp5..lp7 are free-form per type; lp3.w is reserved for the
 *   shared slope-fade control, lp4 is reserved for radial centre/radius.
 */

export const BLEND_OPS = [
  { id: 0, label: 'Add', glyph: '+' },
  { id: 1, label: 'Subtract', glyph: '−' },
  { id: 2, label: 'Multiply', glyph: '×' },
  { id: 3, label: 'Max', glyph: '⌃' },
  { id: 4, label: 'Min', glyph: '⌄' },
  { id: 5, label: 'Replace', glyph: '=' },
  { id: 6, label: 'Mix', glyph: '≈' },
  { id: 7, label: 'Overlay', glyph: '◑' },
  { id: 8, label: 'Screen', glyph: '☀' },
];

export const MASK_KINDS = [
  { id: 1, label: 'Slope', desc: 'Steepness band, 0 = flat ground, 1 = vertical wall', slots: ['lo', 'hi', 'soft'] },
  { id: 2, label: 'Height', desc: 'Elevation band in normalised height', slots: ['lo', 'hi', 'soft'] },
  { id: 3, label: 'Noise', desc: 'Fractal breakup, the classic way to break a hard edge', slots: ['freq', 'amp', 'seed', 'extra'] },
  { id: 4, label: 'Flow', desc: 'Wetness and river energy from the erosion simulation', slots: ['amp'] },
  { id: 5, label: 'Deposit', desc: 'Sediment dumped by the simulation, perfect for floodplains', slots: ['amp'] },
  { id: 6, label: 'Curvature', desc: 'Concave bowls vs convex ridges', slots: ['amp'] },
  { id: 7, label: 'Paint', desc: 'Hand-painted mask for this layer', slots: ['amp'] },
  { id: 8, label: 'Radial', desc: 'Distance band from a point — islands, calderas, basins', slots: ['cx', 'cy', 'lo', 'hi', 'soft'] },
  { id: 9, label: 'Ridge', desc: 'Fissure lines and fracture networks', slots: ['freq', 'amp', 'seed', 'soft'] },
  { id: 10, label: 'Sketch', desc: 'Hand-drawn height sketch used as a mask', slots: ['amp'] },
];

export const MASK_BLENDS = [
  { id: 0, label: 'Multiply' },
  { id: 1, label: 'Add' },
  { id: 2, label: 'Max' },
  { id: 3, label: 'Min' },
  { id: 4, label: 'Replace' },
];

export const SLOPE = (def, over = {}) => ({
  key: 'slopeFade', label: 'Slope fade', slot: 'lp3.w',
  min: 0, max: 3, step: 0.01, default: def, unit: '', group: 'Response',
  hint: 'Fade the generator out on steep ground so cliffs stay bare', ...over,
});

/** Shared opening controls every generator has. */
const baseParams = (scaleDefault, scaleMax = 8192, octaveDefault = 8) => [
  { key: 'scale', label: 'Feature scale', slot: 'lp0.x', min: 32, max: scaleMax, step: 1, default: scaleDefault, unit: 'm', group: 'Shape',
    hint: 'Wavelength of the largest feature this generator creates' },
  { key: 'octaves', label: 'Octaves', slot: 'lp0.y', min: 1, max: 10, step: 1, default: octaveDefault, unit: '', group: 'Shape',
    hint: 'Levels of detail; more octaves cost more time' },
  { key: 'lacunarity', label: 'Lacunarity', slot: 'lp0.z', min: 1.4, max: 3.4, step: 0.01, default: 2.02, unit: '', group: 'Shape',
    hint: 'Frequency step between octaves' },
  { key: 'gain', label: 'Roughness gain', slot: 'lp0.w', min: 0.2, max: 0.72, step: 0.01, default: 0.5, unit: '', group: 'Shape',
    hint: 'Amplitude step between octaves' },
];

const warpParams = (warp = 0.45, freq = 0.6, detail = 0.12, detailScale = 120) => [
  { key: 'warp', label: 'Domain warp', slot: 'lp1.x', min: 0, max: 2, step: 0.01, default: warp, unit: '', group: 'Flow',
    hint: 'Bends the whole field along a noise vector — the difference between blobs and landforms' },
  { key: 'warpFreq', label: 'Warp frequency', slot: 'lp1.y', min: 0.03, max: 4, step: 0.01, default: freq, unit: '', group: 'Flow' },
  { key: 'detail', label: 'Detail amount', slot: 'lp1.z', min: 0, max: 0.6, step: 0.005, default: detail, unit: '', group: 'Detail' },
  { key: 'detailScale', label: 'Detail scale', slot: 'lp1.w', min: 4, max: 600, step: 1, default: detailScale, unit: 'm', group: 'Detail',
    hint: 'Wavelength of the finest detail this generator adds' },
];

/* ------------------------------------------------------------------ *
 * Terrain generators
 * ------------------------------------------------------------------ */
export const TERRAIN_TYPES = [
  {
    id: 'mountain', label: 'Mountains', template: 'mountain', accent: '#d6a078', icon: 'mountain',
    desc: 'Ridged multifractal ranges with concave flanks and rock detail on the upper slopes.',
    params: [
      ...baseParams(1600, 12288, 9),
      ...warpParams(0.55, 0.5, 0.16, 140),
      { key: 'heightBias', label: 'Elevation offset', slot: 'lp2.x', min: -0.4, max: 0.4, step: 0.005, default: 0, group: 'Response' },
      { key: 'sharpness', label: 'Ridge sharpness', slot: 'lp2.y', min: 0.4, max: 6, step: 0.01, default: 1.6, group: 'Shape',
        hint: 'Higher values cut knife-edge crests, lower values give eroded shoulders' },
      { key: 'terrace', label: 'Terracing', slot: 'lp2.z', min: 0, max: 1, step: 0.01, default: 0, group: 'Shape',
        hint: 'Pull contours toward discrete levels — sedimentary benches' },
      { key: 'terraceSteps', label: 'Terrace steps', slot: 'lp2.w', min: 2, max: 40, step: 1, default: 12, group: 'Shape' },
      { key: 'ridgeMix', label: 'Ridge mix', slot: 'lp3.x', min: 0, max: 1, step: 0.01, default: 0.72, group: 'Shape',
        hint: 'Blend between rounded massifs (0) and ridged ranges (1)' },
      { key: 'bearing', label: 'Bearing', slot: 'lp3.y', min: 0, max: 6.2832, step: 0.01, default: 0, unit: 'rad', group: 'Shape', hidden: true },
      { key: 'stretch', label: 'Stretch', slot: 'lp3.z', min: 0.1, max: 1, step: 0.01, default: 1, group: 'Shape', hidden: true },
      { key: 'crestRound', label: 'Crest rounding', slot: 'lp5.y', min: 0, max: 1, step: 0.01, default: 0.25, group: 'Shape' },
      SLOPE(0),
    ],
  },
  {
    id: 'hills', label: 'Hills', template: 'hills', accent: '#93c779', icon: 'waves',
    desc: 'Rolling pasture and foothills: rounded crests, wide shallow valleys.',
    params: [
      ...baseParams(900, 8192, 7),
      ...warpParams(0.35, 0.4, 0.06, 90),
      { key: 'heightBias', label: 'Elevation offset', slot: 'lp2.x', min: -0.4, max: 0.4, step: 0.005, default: 0 },
      { key: 'roundness', label: 'Rounding', slot: 'lp2.y', min: 0, max: 1, step: 0.01, default: 0.55, group: 'Shape' },
      { key: 'billowMix', label: 'Billow mix', slot: 'lp3.x', min: 0, max: 1, step: 0.01, default: 0.4, group: 'Shape' },
      { key: 'bearing', label: 'Bearing', slot: 'lp3.y', min: 0, max: 6.2832, step: 0.01, default: 0.6, unit: 'rad', group: 'Shape', hidden: true },
      { key: 'stretch', label: 'Stretch', slot: 'lp3.z', min: 0.1, max: 1, step: 0.01, default: 0.75, group: 'Shape' },
      SLOPE(0.4),
    ],
  },
  {
    id: 'plateau', label: 'Plateau', template: 'plateau', accent: '#d8b46a', icon: 'layers',
    desc: 'Layered mesas with flat tops, talus breaks and stepped sedimentary walls.',
    params: [
      ...baseParams(2000, 12288, 8),
      ...warpParams(0.4, 0.45, 0.1, 110),
      { key: 'flatTopLevel', label: 'Plateau cut', slot: 'lp2.x', min: 0.05, max: 0.95, step: 0.01, default: 0.45, group: 'Shape',
        hint: 'Where the terrain breaks from flat top to cliff' },
      { key: 'edgeSharpness', label: 'Edge sharpness', slot: 'lp2.y', min: 0.02, max: 0.6, step: 0.005, default: 0.12, group: 'Shape' },
      { key: 'shelfSteps', label: 'Shelf steps', slot: 'lp2.z', min: 1, max: 18, step: 1, default: 5, group: 'Shape' },
      { key: 'shelfBlend', label: 'Shelf blend', slot: 'lp2.w', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Shape' },
      { key: 'wallRoughness', label: 'Wall roughness', slot: 'lp1.z', min: 0, max: 0.5, step: 0.005, default: 0.12, group: 'Detail' },
      SLOPE(0),
    ],
  },
  {
    id: 'canyon', label: 'Canyon', template: 'canyon', accent: '#c98a5c', icon: 'canyon',
    desc: 'Canyon and badlands networks cut into a high plateau, with graded floors.',
    params: [
      ...baseParams(1200, 12288, 8),
      ...warpParams(0.5, 0.5, 0.2, 120),
      { key: 'depth', label: 'Cut depth', slot: 'lp1.z', min: 0.02, max: 0.8, step: 0.005, default: 0.32, group: 'Shape' },
      { key: 'plateauLevel', label: 'Plateau level', slot: 'lp2.x', min: 0, max: 1, step: 0.01, default: 0.62, group: 'Shape' },
      { key: 'carveSharpness', label: 'Channel sharpness', slot: 'lp2.y', min: 0.5, max: 8, step: 0.01, default: 2.2, group: 'Shape' },
      { key: 'floorFlatness', label: 'Floor flatness', slot: 'lp2.z', min: 0, max: 1, step: 0.01, default: 0.7, group: 'Shape' },
      { key: 'tributary', label: 'Tributaries', slot: 'lp2.w', min: 0, max: 1, step: 0.01, default: 0.45, group: 'Shape' },
      { key: 'rimDetail', label: 'Rim bedding', slot: 'lp1.w', min: 0, max: 0.3, step: 0.002, default: 0.06, group: 'Detail' },
      SLOPE(0),
    ],
  },
  {
    id: 'dunes', label: 'Dunes', template: 'dunes', accent: '#e0c07a', icon: 'dunes',
    desc: 'Aeolian dune fields: asymmetric crests, warped crest lines, saltation ripples.',
    params: [
      { key: 'scale', label: 'Dune spacing', slot: 'lp0.x', min: 40, max: 2000, step: 1, default: 260, unit: 'm', group: 'Shape' },
      { key: 'height', label: 'Dune height', slot: 'lp0.y', min: 0, max: 1, step: 0.01, default: 0.4, group: 'Shape' },
      { key: 'crestSharp', label: 'Crest sharpness', slot: 'lp0.z', min: 0.4, max: 6, step: 0.01, default: 2.4, group: 'Shape' },
      { key: 'symmetry', label: 'Slip face', slot: 'lp0.w', min: 0.15, max: 0.95, step: 0.01, default: 0.62, group: 'Shape',
        hint: '0 = symmetric waves, 1 = steep lee face and long windward ramp' },
      ...warpParams(0.6, 0.4, 0.05, 30),
      { key: 'rippleAmount', label: 'Ripples', slot: 'lp1.z', min: 0, max: 1, step: 0.01, default: 0.45, group: 'Detail' },
      { key: 'rippleScale', label: 'Ripple scale', slot: 'lp1.w', min: 0.5, max: 40, step: 0.5, default: 6, unit: 'm', group: 'Detail' },
      { key: 'level', label: 'Level', slot: 'lp2.x', min: 0, max: 1, step: 0.01, default: 0.12, group: 'Response' },
      { key: 'crestNoise', label: 'Crest noise', slot: 'lp2.y', min: 0, max: 1, step: 0.01, default: 0.35, group: 'Detail' },
      { key: 'bearing', label: 'Wind bearing', slot: 'lp3.y', min: 0, max: 6.2832, step: 0.01, default: 0.9, unit: 'rad', group: 'Shape' },
      { key: 'stretch', label: 'Along-wind stretch', slot: 'lp3.z', min: 0.02, max: 1, step: 0.01, default: 0.25, group: 'Shape' },
      SLOPE(0.7),
    ],
  },
  {
    id: 'volcano', label: 'Volcano', template: 'volcano', accent: '#c97a6a', icon: 'volcano',
    desc: 'Stratovolcano cone with a breached crater, radial gully network and lava levees.',
    params: [
      { key: 'radius', label: 'Radius', slot: 'lp0.x', min: 100, max: 6000, step: 5, default: 1400, unit: 'm', group: 'Shape' },
      { key: 'conePower', label: 'Flank profile', slot: 'lp0.y', min: 0.4, max: 4, step: 0.01, default: 1.35, group: 'Shape',
        hint: 'Low = shield volcano, high = steep stratovolcano' },
      { key: 'flankGain', label: 'Flank roughness', slot: 'lp0.w', min: 0.2, max: 0.72, step: 0.01, default: 0.45, group: 'Detail' },
      { key: 'gullies', label: 'Gully depth', slot: 'lp1.x', min: 0, max: 0.5, step: 0.005, default: 0.12, group: 'Shape' },
      { key: 'gullyFreq', label: 'Gully frequency', slot: 'lp1.y', min: 0.5, max: 8, step: 0.05, default: 3, group: 'Shape' },
      { key: 'levees', label: 'Lava levees', slot: 'lp1.z', min: 0, max: 0.3, step: 0.002, default: 0.05, group: 'Shape' },
      { key: 'flankDetail', label: 'Flank detail', slot: 'lp1.w', min: 0, max: 0.3, step: 0.002, default: 0.07, group: 'Detail' },
      { key: 'baseLevel', label: 'Base level', slot: 'lp2.x', min: 0, max: 1, step: 0.005, default: 0.18, group: 'Response' },
      { key: 'craterRadius', label: 'Crater radius', slot: 'lp2.y', min: 0.01, max: 0.5, step: 0.005, default: 0.12, group: 'Shape' },
      { key: 'craterDepth', label: 'Crater depth', slot: 'lp2.z', min: 0, max: 0.5, step: 0.005, default: 0.12, group: 'Shape' },
      { key: 'rimHeight', label: 'Rim height', slot: 'lp2.w', min: 0, max: 0.3, step: 0.002, default: 0.07, group: 'Shape' },
      { key: 'centerX', label: 'Centre X', slot: 'lp4.x', min: 0, max: 1, step: 0.001, default: 0.5, group: 'Placement' },
      { key: 'centerY', label: 'Centre Y', slot: 'lp4.y', min: 0, max: 1, step: 0.001, default: 0.5, group: 'Placement' },
      { key: 'bearing', label: 'Breach bearing', slot: 'lp3.y', min: 0, max: 6.2832, step: 0.01, default: 1.2, unit: 'rad', group: 'Placement' },
      SLOPE(0),
    ],
  },
  {
    id: 'island', label: 'Island', template: 'island', accent: '#74bdd4', icon: 'island',
    desc: 'Islands and archipelagos with ragged coasts, beach shelves and inland relief.',
    params: [
      { key: 'radius', label: 'Island radius', slot: 'lp0.x', min: 100, max: 8000, step: 10, default: 1600, unit: 'm', group: 'Shape' },
      ...baseParams(700, 8192, 7),
      { key: 'coastRaggedness', label: 'Coast raggedness', slot: 'lp1.x', min: 0, max: 1, step: 0.01, default: 0.4, group: 'Shape' },
      { key: 'coastFreq', label: 'Coast frequency', slot: 'lp1.y', min: 0.2, max: 6, step: 0.05, default: 1.3, group: 'Shape' },
      { key: 'inlandRelief', label: 'Inland relief', slot: 'lp1.z', min: 0, max: 1.2, step: 0.01, default: 0.55, group: 'Shape' },
      { key: 'shelfWidth', label: 'Beach shelf', slot: 'lp1.w', min: 0, max: 0.5, step: 0.005, default: 0.12, group: 'Shape' },
      { key: 'seaLevel', label: 'Sea level', slot: 'lp2.x', min: 0, max: 1, step: 0.005, default: 0.16, group: 'Response' },
      { key: 'shoreFlatness', label: 'Shore flatness', slot: 'lp2.y', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Shape' },
      { key: 'peakHeight', label: 'Interior lift', slot: 'lp2.z', min: 0, max: 1.5, step: 0.01, default: 0.35, group: 'Shape' },
      { key: 'centerX', label: 'Centre X', slot: 'lp4.x', min: 0, max: 1, step: 0.001, default: 0.5, group: 'Placement' },
      { key: 'centerY', label: 'Centre Y', slot: 'lp4.y', min: 0, max: 1, step: 0.001, default: 0.5, group: 'Placement' },
      SLOPE(0.5),
    ],
  },
  {
    id: 'noise', label: 'Noise', template: 'noise', accent: '#a8a8c8', icon: 'noise',
    desc: 'Plain controllable noise in ten flavours — the workhorse for masks, detail and styling.',
    params: [
      ...baseParams(600, 8192, 7),
      ...warpParams(0.3, 0.5, 1, 1),
      { key: 'level', label: 'Level', slot: 'lp2.x', min: 0, max: 1, step: 0.005, default: 0.5, group: 'Response' },
      { key: 'sharpness', label: 'Sharpness / width', slot: 'lp2.y', min: 0.4, max: 6, step: 0.01, default: 1, group: 'Shape' },
      { key: 'terrace', label: 'Terracing', slot: 'lp2.z', min: 0, max: 1, step: 0.01, default: 0, group: 'Shape' },
      { key: 'terraceSteps', label: 'Terrace steps', slot: 'lp2.w', min: 2, max: 40, step: 1, default: 10, group: 'Shape' },
      { key: 'variant', label: 'Flavour', slot: 'lp3.x', min: 0, max: 9, step: 1, default: 0,
        options: ['fBm', 'Billow', 'Ridged', 'Cellular', 'Ping-pong', 'Swiss', 'Hybrid', 'Warped', 'Cracks', 'Value'], group: 'Style' },
      SLOPE(0),
    ],
  },
  {
    id: 'strata', label: 'Strata', template: 'strata', accent: '#b9a06a', icon: 'strata',
    desc: 'Sedimentary bedding planes. Transforms the field already on the stack into ledges.',
    transform: true,
    params: [
      { key: 'thickness', label: 'Bed thickness', slot: 'lp0.x', min: 2, max: 400, step: 0.5, default: 42, unit: 'm', group: 'Shape' },
      { key: 'sharpness', label: 'Ledge sharpness', slot: 'lp0.y', min: 0.5, max: 12, step: 0.01, default: 4.5, group: 'Shape' },
      { key: 'tilt', label: 'Tilt', slot: 'lp0.z', min: 0, max: 0.6, step: 0.005, default: 0.12, group: 'Shape' },
      ...warpParams(0.25, 0.5, 0.07, 1),
      { key: 'ledgeDepth', label: 'Ledge depth', slot: 'lp1.z', min: 0, max: 0.5, step: 0.005, default: 0.12, group: 'Shape' },
      { key: 'bearing', label: 'Dip direction', slot: 'lp3.y', min: 0, max: 6.2832, step: 0.01, default: 0.8, unit: 'rad', group: 'Shape' },
    ],
  },
  {
    id: 'cracks', label: 'Cracks', template: 'cracks', accent: '#a89a86', icon: 'cracks',
    desc: 'Contraction polygons and fissures — cracked basalt flats, dried lakebeds, salt pans.',
    params: [
      ...baseParams(300, 4096, 6),
      { key: 'crackWidth', label: 'Fissure width', slot: 'lp1.x', min: 0.01, max: 0.6, step: 0.005, default: 0.12, group: 'Shape' },
      { key: 'crackDepth', label: 'Fissure depth', slot: 'lp1.y', min: 0, max: 0.5, step: 0.005, default: 0.18, group: 'Shape' },
      { key: 'plateJitter', label: 'Plate doming', slot: 'lp1.z', min: 0, max: 1, step: 0.01, default: 0.35, group: 'Shape' },
      { key: 'level', label: 'Level', slot: 'lp2.x', min: 0, max: 1, step: 0.005, default: 0.4, group: 'Response' },
      { key: 'bearing', label: 'Bearing', slot: 'lp3.y', min: 0, max: 6.2832, step: 0.01, default: 0, unit: 'rad', group: 'Shape', hidden: true },
      SLOPE(0),
    ],
  },
  {
    id: 'warpLayer', label: 'Domain Warp', template: 'warp', accent: '#8fa9d6', icon: 'warp',
    desc: 'Flows the field already on the stack along a vector field. Pure transformation, no new mass.',
    transform: true,
    params: [
      { key: 'distance', label: 'Warp distance', slot: 'lp0.x', min: 1, max: 2000, step: 1, default: 220, unit: 'm', group: 'Shape' },
      ...baseParams(800, 8192, 4),
      { key: 'warp', label: 'Noise amount', slot: 'lp1.x', min: 0, max: 2, step: 0.01, default: 0.7, group: 'Shape' },
      { key: 'warpFreq', label: 'Noise frequency', slot: 'lp1.y', min: 0.03, max: 4, step: 0.01, default: 0.5, group: 'Shape' },
      { key: 'direction', label: 'Directional shear', slot: 'lp2.z', min: 0, max: 2, step: 0.01, default: 0.35, group: 'Shape',
        hint: 'Shear along the bearing — glacial and aeolian flows read this way' },
      { key: 'bearing', label: 'Bearing', slot: 'lp3.y', min: 0, max: 6.2832, step: 0.01, default: 1.1, unit: 'rad', group: 'Shape' },
      { key: 'stretch', label: 'Stretch', slot: 'lp3.z', min: 0.05, max: 1, step: 0.01, default: 0.6, group: 'Shape' },
    ],
  },
  {
    id: 'smooth', label: 'Smooth', template: 'smooth', accent: '#9aa7b5', icon: 'smooth',
    desc: 'Relaxes the current field. Use it to tame over-energetic noise or to round glacial valleys.',
    transform: true,
    params: [
      { key: 'radius', label: 'Radius', slot: 'lp0.x', min: 1, max: 400, step: 1, default: 40, unit: 'm', group: 'Shape' },
      { key: 'strength', label: 'Strength', slot: 'lp0.y', min: 0, max: 1, step: 0.01, default: 1, group: 'Shape' },
    ],
  },
  {
    id: 'detail', label: 'Detail', template: 'detail', accent: '#c2b783', icon: 'detail',
    desc: 'Re-introduces the fine field the erosion solver replaced, keeping 4K tiles crisp.',
    params: [
      { key: 'amplitude', label: 'Amplitude', slot: 'lp1.x', min: 0, max: 0.4, step: 0.002, default: 0.08, group: 'Detail' },
      { key: 'contrast', label: 'Contrast', slot: 'lp1.y', min: 0.2, max: 6, step: 0.01, default: 1.4, group: 'Detail' },
      { key: 'valleyBias', label: 'Valley bias', slot: 'lp1.z', min: 0, max: 1, step: 0.01, default: 0.4, group: 'Response',
        hint: 'Push detail into valleys (1) or onto peaks (0)' },
      { key: 'peakBias', label: 'Peak bias', slot: 'lp1.w', min: 0, max: 1, step: 0.01, default: 0.3, group: 'Response' },
      { key: 'level', label: 'Level', slot: 'lp2.x', min: -0.2, max: 0.2, step: 0.002, default: 0, group: 'Response' },
    ],
  },
  {
    id: 'flat', label: 'Flat Base', template: 'flat', accent: '#8d8d8d', icon: 'flat',
    desc: 'A level base plane with optional grain — the bottom of a stack, or a basin reset.',
    params: [
      ...baseParams(1200, 8192, 3),
      { key: 'amplitude', label: 'Grain', slot: 'lp1.z', min: 0, max: 0.2, step: 0.001, default: 0.02, group: 'Detail' },
      { key: 'level', label: 'Level', slot: 'lp2.x', min: 0, max: 1, step: 0.005, default: 0.25, group: 'Response' },
    ],
  },
];

export const TERRAIN_BY_ID = Object.fromEntries(TERRAIN_TYPES.map((t) => [t.id, t]));

/* ------------------------------------------------------------------ *
 * Erosion / simulation layers
 * ------------------------------------------------------------------ */
export const EROSION_TYPES = [
  {
    id: 'hydraulic', label: 'Hydraulic Erosion', accent: '#74bdd4', icon: 'water',
    desc: 'Pipe-model water flow with capacity-driven erosion and donor-cell sediment transport. This is what builds dendritic river networks, V-shaped valleys and alluvial fans.',
    params: [
      { key: 'iterations', label: 'Iterations', min: 10, max: 400, step: 5, default: 120, group: 'Simulation',
        hint: 'Each iteration is one time step of the solver' },
      { key: 'dt', label: 'Time step', min: 0.05, max: 2, step: 0.05, default: 0.6, unit: 's', group: 'Simulation' },
      { key: 'rain', label: 'Rainfall', min: 0, max: 0.004, step: 0.00002, default: 0.0009, unit: 'm/step', group: 'Water',
        hint: 'Water added per step — this sets river density more than anything else' },
      { key: 'flowRate', label: 'Flow rate', min: 2, max: 120, step: 0.5, default: 32, group: 'Water',
        hint: 'How fast water moves downslope' },
      { key: 'pipePower', label: 'Depth response', min: 0.2, max: 2, step: 0.01, default: 0.45, group: 'Water',
        hint: 'Higher values concentrate flow into fewer, deeper channels' },
      { key: 'evaporation', label: 'Evaporation', min: 0, max: 0.3, step: 0.001, default: 0.012, group: 'Water' },
      { key: 'capacity', label: 'Sediment capacity', min: 0.05, max: 40, step: 0.05, default: 7, group: 'Erosion',
        hint: 'How much rock fast water can carry. Higher = more incision' },
      { key: 'dissolve', label: 'Erosion rate', min: 0.02, max: 4, step: 0.01, default: 0.5, group: 'Erosion' },
      { key: 'depositRate', label: 'Deposition rate', min: 0.02, max: 4, step: 0.01, default: 0.55, group: 'Erosion' },
      { key: 'maxRate', label: 'Max rate', min: 0.005, max: 0.4, step: 0.005, default: 0.06, unit: 'm/step', group: 'Erosion',
        hint: 'Hard clamp on height change per step — the stability guard' },
      { key: 'minSlope', label: 'Min slope', min: 0.001, max: 0.3, step: 0.001, default: 0.02, group: 'Erosion' },
      { key: 'flowGain', label: 'Wetness gain', min: 0.05, max: 4, step: 0.01, default: 1, group: 'Maps',
        hint: 'Scales the wetness map that masks and materials key off' },
    ],
  },
  {
    id: 'thermal', label: 'Thermal Erosion', accent: '#c98a5c', icon: 'talus',
    desc: 'Angle-of-repose relaxation over eight neighbours. Builds scree aprons, softens ridge lines and grades benches between cliff bands.',
    params: [
      { key: 'iterations', label: 'Iterations', min: 5, max: 300, step: 5, default: 60, group: 'Simulation' },
      { key: 'dt', label: 'Time step', min: 0.05, max: 2, step: 0.05, default: 0.7, unit: 's', group: 'Simulation' },
      { key: 'talus', label: 'Talus angle', min: 0.05, max: 1.6, step: 0.01, default: 0.62, group: 'Shape',
        hint: 'Slope at which material starts to slide (tan of the repose angle)' },
      { key: 'rate', label: 'Slide rate', min: 0.02, max: 1, step: 0.01, default: 0.42, group: 'Shape' },
    ],
  },
];

export const EROSION_BY_ID = Object.fromEntries(EROSION_TYPES.map((t) => [t.id, t]));

/* ------------------------------------------------------------------ *
 * Material (texture) layers
 * ------------------------------------------------------------------ */
export const MATERIAL_TYPES = [
  {
    id: 'rock', label: 'Bedrock', template: 'mat_rock', accent: '#a8a29a', icon: 'rock',
    desc: 'Stratified stone with mineral blotching, crevice darkening and clean faces on steep ground.',
    palettes: {
      granite: [[0.0, [0.05, 0.052, 0.055]], [0.3, [0.14, 0.14, 0.145]], [0.6, [0.32, 0.3, 0.29]], [0.85, [0.52, 0.5, 0.48]], [1.0, [0.68, 0.66, 0.63]]],
      sandstone: [[0.0, [0.14, 0.09, 0.06]], [0.35, [0.36, 0.22, 0.13]], [0.7, [0.6, 0.42, 0.26]], [1.0, [0.78, 0.63, 0.44]]],
      basalt: [[0.0, [0.02, 0.022, 0.026]], [0.45, [0.075, 0.078, 0.085]], [0.8, [0.16, 0.16, 0.17]], [1.0, [0.26, 0.25, 0.25]]],
      limestone: [[0.0, [0.1, 0.1, 0.09]], [0.4, [0.36, 0.35, 0.32]], [0.75, [0.62, 0.61, 0.56]], [1.0, [0.82, 0.81, 0.76]]],
      slate: [[0.0, [0.03, 0.04, 0.05]], [0.4, [0.11, 0.13, 0.15]], [0.75, [0.24, 0.26, 0.29]], [1.0, [0.4, 0.42, 0.45]]],
    },
    params: [
      ...baseParams(220, 4096, 7),
      { key: 'beddingScale', label: 'Bedding scale', slot: 'lp1.x', min: 2, max: 300, step: 0.5, default: 34, unit: 'm', group: 'Bands' },
      { key: 'beddingStrength', label: 'Bedding strength', slot: 'lp1.y', min: 0, max: 1, step: 0.01, default: 0.55, group: 'Bands' },
      { key: 'mineralScale', label: 'Mineral scale', slot: 'lp1.z', min: 2, max: 200, step: 0.5, default: 26, unit: 'm', group: 'Mineral' },
      { key: 'mineralStrength', label: 'Mineral strength', slot: 'lp1.w', min: 0, max: 1, step: 0.01, default: 0.45, group: 'Mineral' },
      { key: 'hueShift', label: 'Hue shift', slot: 'lp2.x', min: -0.5, max: 0.5, step: 0.002, default: 0, group: 'Colour' },
      { key: 'contrast', label: 'Contrast', slot: 'lp2.y', min: 0.3, max: 4, step: 0.01, default: 1.15, group: 'Colour' },
      { key: 'crevice', label: 'Crevice darkening', slot: 'lp2.z', min: 0, max: 1, step: 0.01, default: 0.55, group: 'Colour' },
      { key: 'bearing', label: 'Bedding bearing', slot: 'lp3.y', min: 0, max: 6.2832, step: 0.01, default: 0.4, unit: 'rad', group: 'Bands' },
      { key: 'stretch', label: 'Bedding stretch', slot: 'lp3.z', min: 0.05, max: 1, step: 0.01, default: 0.3, group: 'Bands' },
    ],
  },
  {
    id: 'soil', label: 'Soil', template: 'mat_soil', accent: '#8a6a4a', icon: 'soil',
    desc: 'Dark organic topsoil with tonal patches, pebble speckle and moisture variation.',
    palettes: {
      loam: [[0.0, [0.04, 0.025, 0.016]], [0.35, [0.13, 0.08, 0.05]], [0.7, [0.26, 0.17, 0.1]], [1.0, [0.42, 0.3, 0.19]]],
      clay: [[0.0, [0.09, 0.04, 0.03]], [0.4, [0.28, 0.13, 0.08]], [0.75, [0.48, 0.26, 0.16]], [1.0, [0.62, 0.4, 0.26]]],
      peat: [[0.0, [0.015, 0.012, 0.008]], [0.5, [0.06, 0.045, 0.03]], [1.0, [0.16, 0.12, 0.08]]],
      desert: [[0.0, [0.2, 0.14, 0.08]], [0.45, [0.4, 0.3, 0.18]], [0.8, [0.58, 0.46, 0.3]], [1.0, [0.72, 0.62, 0.46]]],
    },
    params: [
      ...baseParams(160, 4096, 6),
      { key: 'pebbleScale', label: 'Pebble scale', slot: 'lp1.x', min: 1, max: 80, step: 0.5, default: 9, unit: 'm', group: 'Grain' },
      { key: 'pebbleAmount', label: 'Pebbles', slot: 'lp1.y', min: 0, max: 1, step: 0.01, default: 0.4, group: 'Grain' },
      { key: 'patchScale', label: 'Patch scale', slot: 'lp1.z', min: 8, max: 400, step: 1, default: 70, unit: 'm', group: 'Patches' },
      { key: 'patchAmount', label: 'Patch amount', slot: 'lp1.w', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Patches' },
      { key: 'moisture', label: 'Moisture darkening', slot: 'lp2.x', min: 0, max: 1, step: 0.01, default: 0.45, group: 'Colour' },
      { key: 'contrast', label: 'Contrast', slot: 'lp2.y', min: 0.3, max: 4, step: 0.01, default: 1.2, group: 'Colour' },
    ],
  },
  {
    id: 'grass', label: 'Grass', template: 'mat_grass', accent: '#7fae5a', icon: 'grass',
    desc: 'Patchy greens with dry patches driven by exposure, and fine blade grain.',
    palettes: {
      meadow: [[0.0, [0.03, 0.06, 0.02]], [0.3, [0.09, 0.16, 0.04]], [0.6, [0.18, 0.28, 0.07]], [0.85, [0.36, 0.4, 0.14]], [1.0, [0.52, 0.48, 0.24]]],
      alpine: [[0.0, [0.04, 0.07, 0.035]], [0.35, [0.11, 0.18, 0.07]], [0.7, [0.2, 0.3, 0.11]], [1.0, [0.42, 0.45, 0.22]]],
      dry: [[0.0, [0.12, 0.11, 0.04]], [0.4, [0.28, 0.25, 0.1]], [0.75, [0.48, 0.42, 0.2]], [1.0, [0.66, 0.6, 0.36]]],
      savanna: [[0.0, [0.1, 0.1, 0.03]], [0.4, [0.26, 0.24, 0.08]], [0.75, [0.44, 0.38, 0.16]], [1.0, [0.6, 0.5, 0.3]]],
    },
    params: [
      ...baseParams(280, 4096, 7),
      { key: 'dryScale', label: 'Dry patch scale', slot: 'lp1.x', min: 8, max: 600, step: 1, default: 90, unit: 'm', group: 'Patches' },
      { key: 'dryness', label: 'Dryness', slot: 'lp1.y', min: 0, max: 1, step: 0.01, default: 0.45, group: 'Patches',
        hint: 'Dry patches follow elevation, deposit and flow — dry highs, damp hollows' },
      { key: 'bladeScale', label: 'Blade scale', slot: 'lp1.z', min: 0.2, max: 20, step: 0.1, default: 1.6, unit: 'm', group: 'Grain' },
      { key: 'bladeStrength', label: 'Blade contrast', slot: 'lp1.w', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Grain' },
      { key: 'damp', label: 'Damp darkening', slot: 'lp2.x', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Colour' },
      { key: 'contrast', label: 'Contrast', slot: 'lp2.y', min: 0.3, max: 4, step: 0.01, default: 1.25, group: 'Colour' },
    ],
  },
  {
    id: 'forest', label: 'Forest Floor', template: 'mat_forest', accent: '#5f8a4a', icon: 'forest',
    desc: 'Deep humus, needle litter, moss patches and damp hollows under a canopy.',
    palettes: {
      conifer: [[0.0, [0.015, 0.012, 0.01]], [0.35, [0.05, 0.04, 0.03]], [0.65, [0.11, 0.1, 0.06]], [0.9, [0.16, 0.2, 0.08]], [1.0, [0.26, 0.3, 0.14]]],
      broadleaf: [[0.0, [0.03, 0.02, 0.012]], [0.4, [0.1, 0.07, 0.04]], [0.75, [0.22, 0.16, 0.08]], [1.0, [0.36, 0.3, 0.14]]],
      tropical: [[0.0, [0.02, 0.02, 0.01]], [0.45, [0.08, 0.09, 0.04]], [0.8, [0.18, 0.22, 0.08]], [1.0, [0.3, 0.34, 0.12]]],
    },
    params: [
      ...baseParams(200, 4096, 7),
      { key: 'litterScale', label: 'Litter scale', slot: 'lp1.x', min: 0.5, max: 40, step: 0.1, default: 4, unit: 'm', group: 'Grain' },
      { key: 'litterAmount', label: 'Litter', slot: 'lp1.y', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Grain' },
      { key: 'mossScale', label: 'Moss scale', slot: 'lp1.z', min: 4, max: 300, step: 1, default: 45, unit: 'm', group: 'Patches' },
      { key: 'mossAmount', label: 'Moss', slot: 'lp1.w', min: 0, max: 1, step: 0.01, default: 0.4, group: 'Patches' },
      { key: 'damp', label: 'Damp darkening', slot: 'lp2.x', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Colour' },
      { key: 'contrast', label: 'Contrast', slot: 'lp2.y', min: 0.3, max: 4, step: 0.01, default: 1.3, group: 'Colour' },
      { key: 'bearing', label: 'Litter bearing', slot: 'lp3.y', min: 0, max: 6.2832, step: 0.01, default: 0.9, unit: 'rad', group: 'Grain' },
    ],
  },
  {
    id: 'sand', label: 'Sand', template: 'mat_sand', accent: '#e0c88a', icon: 'sand',
    desc: 'Fine warm sand with wind ripples, grain speckle and damp darkening at the water line.',
    palettes: {
      beach: [[0.0, [0.24, 0.18, 0.1]], [0.4, [0.5, 0.4, 0.24]], [0.75, [0.72, 0.62, 0.4]], [1.0, [0.86, 0.79, 0.6]]],
      desert: [[0.0, [0.3, 0.2, 0.1]], [0.45, [0.56, 0.42, 0.24]], [0.8, [0.76, 0.63, 0.4]], [1.0, [0.9, 0.8, 0.58]]],
      volcanic: [[0.0, [0.05, 0.045, 0.04]], [0.5, [0.14, 0.12, 0.1]], [1.0, [0.3, 0.26, 0.22]]],
      gypsum: [[0.0, [0.5, 0.48, 0.44]], [0.5, [0.74, 0.72, 0.68]], [1.0, [0.94, 0.93, 0.9]]],
    },
    params: [
      ...baseParams(120, 4096, 6),
      { key: 'rippleScale', label: 'Ripple scale', slot: 'lp1.x', min: 0.5, max: 30, step: 0.1, default: 3.2, unit: 'm', group: 'Ripples' },
      { key: 'rippleAmount', label: 'Ripples', slot: 'lp1.y', min: 0, max: 1, step: 0.01, default: 0.45, group: 'Ripples' },
      { key: 'speckleScale', label: 'Speckle scale', slot: 'lp1.z', min: 0.2, max: 8, step: 0.1, default: 1.2, unit: 'm', group: 'Grain' },
      { key: 'speckleAmount', label: 'Speckle', slot: 'lp1.w', min: 0, max: 1, step: 0.01, default: 0.3, group: 'Grain' },
      { key: 'damp', label: 'Damp darkening', slot: 'lp2.x', min: 0, max: 1, step: 0.01, default: 0.65, group: 'Colour' },
      { key: 'contrast', label: 'Contrast', slot: 'lp2.y', min: 0.3, max: 4, step: 0.01, default: 1.1, group: 'Colour' },
      { key: 'bearing', label: 'Ripple bearing', slot: 'lp3.y', min: 0, max: 6.2832, step: 0.01, default: 1.4, unit: 'rad', group: 'Ripples' },
      { key: 'stretch', label: 'Ripple stretch', slot: 'lp3.z', min: 0.05, max: 1, step: 0.01, default: 0.3, group: 'Ripples' },
    ],
  },
  {
    id: 'snow', label: 'Snow', template: 'mat_snow', accent: '#cfe0f2', icon: 'snow',
    desc: 'Wind-crusted snow: blue crevices, sastrugi striations, subtle sparkle.',
    palettes: {
      fresh: [[0.0, [0.42, 0.5, 0.66]], [0.45, [0.68, 0.76, 0.9]], [1.0, [0.95, 0.97, 1.0]]],
      windcrust: [[0.0, [0.36, 0.43, 0.56]], [0.4, [0.6, 0.66, 0.78]], [0.8, [0.84, 0.87, 0.94]], [1.0, [0.98, 0.98, 1.0]]],
      glacier: [[0.0, [0.16, 0.34, 0.46]], [0.35, [0.36, 0.58, 0.72]], [0.7, [0.68, 0.82, 0.9]], [1.0, [0.94, 0.98, 1.0]]],
      dirty: [[0.0, [0.2, 0.21, 0.24]], [0.4, [0.42, 0.44, 0.48]], [1.0, [0.8, 0.82, 0.85]]],
    },
    params: [
      ...baseParams(400, 4096, 5),
      { key: 'sastrugiScale', label: 'Sastrugi scale', slot: 'lp1.x', min: 1, max: 200, step: 0.5, default: 22, unit: 'm', group: 'Wind' },
      { key: 'sastrugiAmount', label: 'Sastrugi', slot: 'lp1.y', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Wind' },
      { key: 'crustScale', label: 'Crust scale', slot: 'lp1.z', min: 1, max: 100, step: 0.5, default: 14, unit: 'm', group: 'Wind' },
      { key: 'crustAmount', label: 'Crust', slot: 'lp1.w', min: 0, max: 1, step: 0.01, default: 0.35, group: 'Wind' },
      { key: 'creviceBlue', label: 'Crevice blue', slot: 'lp2.x', min: 0, max: 1, step: 0.01, default: 0.55, group: 'Colour' },
      { key: 'contrast', label: 'Contrast', slot: 'lp2.y', min: 0.3, max: 4, step: 0.01, default: 1.0, group: 'Colour' },
      { key: 'bearing', label: 'Wind bearing', slot: 'lp3.y', min: 0, max: 6.2832, step: 0.01, default: 0.9, unit: 'rad', group: 'Wind' },
      { key: 'stretch', label: 'Striation stretch', slot: 'lp3.z', min: 0.02, max: 1, step: 0.01, default: 0.12, group: 'Wind' },
    ],
  },
  {
    id: 'gravel', label: 'Gravel', template: 'mat_gravel', accent: '#9c9188', icon: 'gravel',
    desc: 'Loose scree and pebbles with per-stone tone, exposed on steep ground.',
    palettes: {
      scree: [[0.0, [0.06, 0.06, 0.06]], [0.35, [0.18, 0.175, 0.17]], [0.7, [0.36, 0.34, 0.32]], [1.0, [0.56, 0.53, 0.5]]],
      riverbed: [[0.0, [0.1, 0.09, 0.08]], [0.4, [0.3, 0.27, 0.23]], [0.75, [0.5, 0.46, 0.4]], [1.0, [0.68, 0.64, 0.58]]],
      redrock: [[0.0, [0.12, 0.05, 0.03]], [0.45, [0.34, 0.16, 0.09]], [0.8, [0.56, 0.32, 0.2]], [1.0, [0.72, 0.5, 0.34]]],
    },
    params: [
      ...baseParams(140, 4096, 5),
      { key: 'stoneScale', label: 'Stone scale', slot: 'lp1.x', min: 0.2, max: 40, step: 0.1, default: 3.4, unit: 'm', group: 'Grain' },
      { key: 'stoneAmount', label: 'Stone amount', slot: 'lp1.y', min: 0, max: 1, step: 0.01, default: 0.6, group: 'Grain' },
      { key: 'sizeVariation', label: 'Tone variation', slot: 'lp1.z', min: 0, max: 1, step: 0.01, default: 0.6, group: 'Grain' },
      { key: 'contrast', label: 'Contrast', slot: 'lp2.x', min: 0.3, max: 4, step: 0.01, default: 1.25, group: 'Colour' },
      { key: 'wetDarkening', label: 'Wet darkening', slot: 'lp2.y', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Colour' },
    ],
  },
  {
    id: 'custom', label: 'Custom', template: 'mat_custom', accent: '#c5a6d7', icon: 'custom',
    desc: 'A clean artistic surface driven entirely by your own gradient — alien worlds, stylised palettes, regolith.',
    palettes: {
      regolith: [[0.0, [0.04, 0.04, 0.045]], [0.4, [0.14, 0.135, 0.13]], [0.75, [0.3, 0.29, 0.28]], [1.0, [0.5, 0.48, 0.46]]],
      redplanet: [[0.0, [0.1, 0.03, 0.02]], [0.35, [0.34, 0.12, 0.06]], [0.7, [0.6, 0.3, 0.16]], [1.0, [0.8, 0.55, 0.38]]],
      ice: [[0.0, [0.06, 0.12, 0.2]], [0.4, [0.24, 0.42, 0.56]], [0.75, [0.6, 0.8, 0.9]], [1.0, [0.92, 0.98, 1.0]]],
      ash: [[0.0, [0.02, 0.02, 0.022]], [0.5, [0.09, 0.088, 0.09]], [1.0, [0.22, 0.215, 0.215]]],
    },
    params: [
      ...baseParams(200, 8192, 7),
      { key: 'detailScale', label: 'Detail scale', slot: 'lp1.x', min: 0.5, max: 200, step: 0.5, default: 6, unit: 'm', group: 'Grain' },
      { key: 'detailAmount', label: 'Grain', slot: 'lp1.y', min: 0, max: 1, step: 0.01, default: 0.4, group: 'Grain' },
      { key: 'patchScale', label: 'Patch scale', slot: 'lp1.z', min: 8, max: 600, step: 1, default: 80, unit: 'm', group: 'Patches' },
      { key: 'patchAmount', label: 'Patch amount', slot: 'lp1.w', min: 0, max: 1, step: 0.01, default: 0.45, group: 'Patches' },
      { key: 'hueShift', label: 'Hue shift', slot: 'lp2.x', min: -0.5, max: 0.5, step: 0.002, default: 0, group: 'Colour' },
      { key: 'contrast', label: 'Contrast', slot: 'lp2.y', min: 0.3, max: 4, step: 0.01, default: 1.2, group: 'Colour' },
      { key: 'shear', label: 'Shear', slot: 'lp2.z', min: 0, max: 2, step: 0.01, default: 0.5, group: 'Shape' },
    ],
  },
];

export const MATERIAL_BY_ID = Object.fromEntries(MATERIAL_TYPES.map((t) => [t.id, t]));

/* ------------------------------------------------------------------ *
 * Layer-level controls shared by terrain and material layers
 * ------------------------------------------------------------------ */
export const LAYER_CONTROLS = {
  amount: { label: 'Amount', min: 0, max: 1, step: 0.005 },
  bias: { label: 'Bias', min: -0.4, max: 0.4, step: 0.005 },
  contrast: { label: 'Contrast', min: 0.05, max: 4, step: 0.01 },
  seed: { label: 'Seed', min: 0, max: 1, step: 0.0001 },
};

export const MATERIAL_CONTROLS = {
  roughMin: { label: 'Roughness min', min: 0.03, max: 1, step: 0.01 },
  roughMax: { label: 'Roughness max', min: 0.03, max: 1, step: 0.01 },
  metallic: { label: 'Metallic', min: 0, max: 1, step: 0.01 },
  normalStrength: { label: 'Detail normals', min: 0, max: 2, step: 0.01 },
  hueShift: { label: 'Hue shift', min: -0.5, max: 0.5, step: 0.002 },
  saturation: { label: 'Saturation', min: 0, max: 2, step: 0.01 },
  value: { label: 'Value', min: 0, max: 2, step: 0.01 },
  variation: { label: 'Variation', min: 0, max: 1, step: 0.01 },
  macroContrast: { label: 'Macro contrast', min: 0.2, max: 3, step: 0.01 },
  wear: { label: 'Wear', min: 0, max: 1, step: 0.01 },
  flowInfluence: { label: 'Flow influence', min: 0, max: 1, step: 0.01 },
};

export const VIEW_MODES = [
  { id: 0, label: 'Shaded', short: 'Shaded' },
  { id: 1, label: 'Height', short: 'Height' },
  { id: 2, label: 'Slope', short: 'Slope' },
  { id: 3, label: 'Normals', short: 'Normals' },
  { id: 4, label: 'Albedo', short: 'Albedo' },
  { id: 5, label: 'Flow / Wetness', short: 'Flow' },
  { id: 6, label: 'Ambient Occlusion', short: 'AO' },
  { id: 7, label: 'Roughness', short: 'Rough.' },
];

/** Default parameter object for a type (layers store values, not defaults). */
export function defaultParams(type) {
  const out = {};
  for (const param of type.params) {
    if (param.default !== undefined) out[param.key] = param.default;
  }
  return out;
}

/** Write a layer's params into the lp[] array using the slot notation. */
export function packLp(type, values, lp) {
  for (let i = 0; i < lp.length; i++) lp[i] = [0, 0, 0, 0];
  for (const param of type.params) {
    if (!param.slot) continue;
    const match = /^lp(\d)\.(x|y|z|w)$/.exec(param.slot);
    if (!match) continue;
    const slot = Number(match[1]);
    const component = 'xyzw'.indexOf(match[2]);
    const value = values[param.key];
    if (slot < 0 || slot >= lp.length || value === undefined) continue;
    lp[slot][component] = value;
  }
  return lp;
}

export const DEFAULT_MASK = (kind = 1) => ({
  kind,
  enabled: 1,
  blend: 0,
  invert: 0,
  weight: 1,
  lo: kind === 1 ? 0 : 0,
  hi: kind === 1 ? 0.35 : kind === 2 ? 0.8 : 0.5,
  soft: kind === 1 ? 0.06 : 0.08,
  freq: kind === 3 || kind === 9 ? 10 : 4,
  amp: 1,
  seed: 0.37,
  cx: 0.5,
  cy: 0.5,
  radius: 0.4,
  extra: 0,
});
