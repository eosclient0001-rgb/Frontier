/* ═══════════════════════════════════════════════════════════════
   Terrain Forge — state model
   Layer stacks are plain data. The engine consumes this module's
   registries; the UI renders from the same param definitions.
   ═══════════════════════════════════════════════════════════════ */
import { uid } from './util.js';

export const BLEND_MODES = [
  { id: 'mix', label: 'Mix' }, { id: 'add', label: 'Add' }, { id: 'sub', label: 'Subtract' },
  { id: 'mul', label: 'Multiply' }, { id: 'max', label: 'Max' }, { id: 'min', label: 'Min' },
  { id: 'screen', label: 'Screen' },
];

/* ── Terrain layer catalogue ────────────────────────────────────
   wgslId matches the switch in layer-eval.wgsl (engine side).     */
export const TERRAIN_TYPES = [
  // ── Shapes ──
  { id: 'mountain', name: 'Mountain Range', cat: 'shape', icon: 'mountain', color: '#d6a078',
    blurb: 'Ridged multifractal peaks with optional domain warp — alpine massifs and sharp crests.',
    defaults: { scale: 2600, octaves: 7, sharpness: 2.0, warp: 0.4, height: 0.62, seed: 1337 },
    switches: [{ key: 'ridged', label: 'Ridged fractal', icon: 'mountain', on: true }, { key: 'warpOn', label: 'Domain warp', icon: 'warp', on: true }],
    params: [
      { key: 'height', label: 'Height', min: 0, max: 1, step: 0.01, digits: 2, lo: 'Flat', hi: 'Towering' },
      { key: 'scale', label: 'Feature scale', min: 400, max: 6000, step: 50, unit: ' m', lo: 'Fine', hi: 'Massive' },
      { key: 'octaves', label: 'Octaves', min: 1, max: 10, step: 1, lo: 'Smooth', hi: 'Detailed' },
      { key: 'sharpness', label: 'Ridge sharpness', min: 1, max: 3.2, step: 0.05, lo: 'Rolling', hi: 'Knife edge' },
      { key: 'warp', label: 'Warp strength', min: 0, max: 1, step: 0.01, lo: 'Straight', hi: 'Twisted' },
    ] },
  { id: 'hills', name: 'Rolling Hills', cat: 'shape', icon: 'hills', color: '#a9c48b',
    blurb: 'Billowy fractal terrain — soft, vegetated relief for valleys and piedmont.',
    defaults: { scale: 1400, octaves: 6, height: 0.4, billow: 0.75, seed: 8821 },
    switches: [{ key: 'billowOn', label: 'Billow shaping', icon: 'wave', on: true }],
    params: [
      { key: 'height', label: 'Height', min: 0, max: 1, step: 0.01, digits: 2, lo: 'Flat', hi: 'Tall' },
      { key: 'scale', label: 'Feature scale', min: 300, max: 5000, step: 50, unit: ' m', lo: 'Fine', hi: 'Broad' },
      { key: 'octaves', label: 'Octaves', min: 1, max: 10, step: 1, lo: 'Smooth', hi: 'Detailed' },
      { key: 'billow', label: 'Billow mix', min: 0, max: 1, step: 0.01, lo: 'Fbm', hi: 'Pillowy' },
    ] },
  { id: 'dunes', name: 'Dune Sea', cat: 'shape', icon: 'dunes', color: '#d8c08a',
    blurb: 'Warped asymmetric crests — barchan and transverse dune fields.',
    defaults: { scale: 900, height: 0.3, asymmetry: 0.65, warp: 0.35, orientation: 12, seed: 4471 },
    switches: [{ key: 'warpOn', label: 'Crest warp', icon: 'warp', on: true }],
    params: [
      { key: 'height', label: 'Height', min: 0, max: 1, step: 0.01, digits: 2, lo: 'Flat', hi: 'Towering' },
      { key: 'scale', label: 'Dune spacing', min: 150, max: 4000, step: 25, unit: ' m', lo: 'Ripples', hi: 'Mega-dunes' },
      { key: 'asymmetry', label: 'Asymmetry', min: 0, max: 1, step: 0.01, lo: 'Symmetric', hi: 'Steep lee' },
      { key: 'orientation', label: 'Orientation', min: 0, max: 360, step: 1, unit: '°', lo: 'Rotates the crest axis' },
      { key: 'warp', label: 'Crest warp', min: 0, max: 1, step: 0.01, lo: 'Even', hi: 'Broken' },
    ] },
  { id: 'canyon', name: 'Canyon', cat: 'shape', icon: 'canyon', color: '#c98f6a',
    blurb: 'Inverted ridged channels — deep slot canyons and dendritic drainage basins.',
    defaults: { scale: 1800, depth: 0.55, steepness: 1.8, meander: 0.5, seed: 991 },
    switches: [{ key: 'meanderOn', label: 'Meander', icon: 'wave', on: true }],
    params: [
      { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, digits: 2, lo: 'Gullies', hi: 'Abyss' },
      { key: 'scale', label: 'Channel scale', min: 300, max: 5000, step: 50, unit: ' m', lo: 'Fine', hi: 'Vast' },
      { key: 'steepness', label: 'Wall steepness', min: 1, max: 4, step: 0.05, lo: 'Gentle', hi: 'Vertical' },
      { key: 'meander', label: 'Meander', min: 0, max: 1, step: 0.01, lo: 'Straight', hi: 'Wandering' },
    ] },
  { id: 'volcano', name: 'Volcano', cat: 'shape', icon: 'volcano', color: '#b5816f',
    blurb: 'Radial cone with crater bowl, breached rim and noise-weathered flanks.',
    defaults: { radius: 0.34, height: 0.7, crater: 0.45, rim: 2.2, roughness: 0.25, seed: 551 },
    switches: [{ key: 'roughOn', label: 'Flank weathering', icon: 'erosion', on: true }],
    params: [
      { key: 'height', label: 'Cone height', min: 0, max: 1, step: 0.01, digits: 2, lo: 'Shield', hi: 'Stratovolcano' },
      { key: 'radius', label: 'Cone radius', min: 0.08, max: 0.7, step: 0.01, digits: 2, lo: 'Narrow', hi: 'Broad' },
      { key: 'crater', label: 'Crater depth', min: 0, max: 1, step: 0.01, digits: 2, lo: 'Intact', hi: 'Caldera' },
      { key: 'rim', label: 'Rim sharpness', min: 1, max: 4, step: 0.05, lo: 'Soft', hi: 'Blown out' },
      { key: 'roughness', label: 'Flank roughness', min: 0, max: 1, step: 0.01, lo: 'Smooth', hi: 'Rugged' },
    ] },
  { id: 'plateau', name: 'Plateau & Mesa', cat: 'shape', icon: 'plateau', color: '#c49a7a',
    blurb: 'Stepped fractal platforms with cliffed escarpments — tablelands and mesas.',
    defaults: { scale: 1600, height: 0.5, steps: 7, edge: 1.6, seed: 332 },
    switches: [],
    params: [
      { key: 'height', label: 'Height', min: 0, max: 1, step: 0.01, digits: 2, lo: 'Low', hi: 'High' },
      { key: 'scale', label: 'Feature scale', min: 300, max: 5000, step: 50, unit: ' m', lo: 'Fine', hi: 'Broad' },
      { key: 'steps', label: 'Terrace steps', min: 1, max: 24, step: 1, lo: 'Smooth', hi: 'Layered' },
      { key: 'edge', label: 'Cliff sharpness', min: 1, max: 4, step: 0.05, lo: 'Rounded', hi: 'Sheer' },
    ] },
  { id: 'craters', name: 'Crater Field', cat: 'shape', icon: 'craters', color: '#b59a86',
    blurb: 'Worley-cell impacts with raised rims and ejecta blankets — lunar or bombed terrain.',
    defaults: { scale: 1100, depth: 0.5, rim: 0.6, seed: 7742 },
    switches: [],
    params: [
      { key: 'depth', label: 'Bowl depth', min: 0, max: 1, step: 0.01, digits: 2, lo: 'Shallow', hi: 'Deep' },
      { key: 'scale', label: 'Cell scale', min: 200, max: 4000, step: 50, unit: ' m', lo: 'Small', hi: 'Huge' },
      { key: 'rim', label: 'Rim height', min: 0, max: 1, step: 0.01, lo: 'Flat', hi: 'Raised' },
    ] },
  { id: 'archipelago', name: 'Archipelago', cat: 'shape', icon: 'archipelago', color: '#8fb8a8',
    blurb: 'Cellular islands with radial falloff — coasts, atolls and mountain isles.',
    defaults: { scale: 1500, height: 0.66, falloff: 1.7, warp: 0.3, seed: 2088 },
    switches: [{ key: 'warpOn', label: 'Coast warp', icon: 'warp', on: true }],
    params: [
      { key: 'height', label: 'Peak height', min: 0, max: 1, step: 0.01, digits: 2, lo: 'Shoals', hi: 'Mountains' },
      { key: 'scale', label: 'Island scale', min: 300, max: 5000, step: 50, unit: ' m', lo: 'Islets', hi: 'Continents' },
      { key: 'falloff', label: 'Coast falloff', min: 0.5, max: 4, step: 0.05, lo: 'Shelves', hi: 'Cliffs' },
      { key: 'warp', label: 'Coast warp', min: 0, max: 1, step: 0.01, lo: 'Even', hi: 'Fractured' },
    ] },
  { id: 'perlin', name: 'Perlin FBM', cat: 'shape', icon: 'perlin', color: '#a3b39a',
    blurb: 'Classic fractal Brownian motion — neutral base relief for any biome.',
    defaults: { scale: 2000, octaves: 7, lacunarity: 2.0, gain: 0.5, height: 0.5, seed: 606 },
    switches: [],
    params: [
      { key: 'height', label: 'Height', min: 0, max: 1, step: 0.01, digits: 2, lo: 'Flat', hi: 'Tall' },
      { key: 'scale', label: 'Feature scale', min: 200, max: 6000, step: 50, unit: ' m', lo: 'Fine', hi: 'Broad' },
      { key: 'octaves', label: 'Octaves', min: 1, max: 10, step: 1, lo: 'Smooth', hi: 'Detailed' },
      { key: 'lacunarity', label: 'Lacunarity', min: 1.5, max: 3.2, step: 0.05, lo: 'Tight', hi: 'Spread' },
      { key: 'gain', label: 'Gain', min: 0.3, max: 0.7, step: 0.01, lo: 'Soft', hi: 'Crisp' },
    ] },
  { id: 'worley', name: 'Worley Cells', cat: 'shape', icon: 'worley', color: '#a8a3b8',
    blurb: 'Cellular noise — cracked mud, basalt columns and organic plates.',
    defaults: { scale: 900, height: 0.4, jitter: 1.0, mode: 1, seed: 1904 },
    switches: [],
    params: [
      { key: 'height', label: 'Height', min: 0, max: 1, step: 0.01, digits: 2, lo: 'Flat', hi: 'Tall' },
      { key: 'scale', label: 'Cell scale', min: 200, max: 4000, step: 50, unit: ' m', lo: 'Fine', hi: 'Broad' },
      { key: 'jitter', label: 'Point jitter', min: 0, max: 1, step: 0.01, lo: 'Gridded', hi: 'Chaotic' },
    ] },
  { id: 'gradient', name: 'Gradient Ramp', cat: 'shape', icon: 'gradient', color: '#9aa8c0',
    blurb: 'Linear, radial or dome ramp — plateaus, bowls and inclined planes.',
    defaults: { height: 0.5, angle: 25, shape: 0, seed: 0 },
    switches: [],
    params: [
      { key: 'height', label: 'Height', min: 0, max: 1, step: 0.01, digits: 2, lo: 'Flat', hi: 'Tall' },
      { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, unit: '°', lo: 'Direction of rise' },
    ] },
  { id: 'constant', name: 'Constant', cat: 'shape', icon: 'constant', color: '#989898',
    blurb: 'Flat base plane — the foundation for subtractive workflows.',
    defaults: { height: 0.0, seed: 0 },
    switches: [],
    params: [
      { key: 'height', label: 'Height', min: 0, max: 1, step: 0.01, digits: 2, lo: 'Zero', hi: 'Full' },
    ] },

  // ── Modifiers ──
  { id: 'warp', name: 'Domain Warp', cat: 'modify', icon: 'warp', color: '#b39ddb',
    blurb: 'Distorts the existing heightfield with fractal noise — breaks straight lines.',
    defaults: { strength: 0.35, scale: 700, iterations: 2 },
    switches: [],
    params: [
      { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, lo: 'Subtle', hi: 'Violent' },
      { key: 'scale', label: 'Noise scale', min: 100, max: 4000, step: 50, unit: ' m', lo: 'Broad', hi: 'Tight' },
    ] },
  { id: 'erosion', name: 'Hydraulic Erosion', cat: 'erode', icon: 'erosion', color: '#7fb8c8',
    blurb: 'Virtual-pipe hydraulic simulation — rain, runoff, sediment capacity and deposition. Carves realistic dendritic drainage and leaves flow data for texturing.',
    defaults: { rain: 0.9, evaporation: 0.9, erosion: 0.35, deposition: 0.12, capacity: 0.9, iterations: 96, talus: 4.0, hardnessScale: 900, hardnessContrast: 0.6, seed: 24601, thermal: 2 },
    switches: [{ key: 'thermalOn', label: 'Thermal slumping', icon: 'thermal', on: true }, { key: 'hardnessOn', label: 'Rock hardness', icon: 'rock', on: true }],
    params: [
      { key: 'iterations', label: 'Iterations', min: 16, max: 220, step: 4, lo: 'Light', hi: 'Deep' },
      { key: 'rain', label: 'Rainfall', min: 0.1, max: 2.5, step: 0.05, lo: 'Drizzle', hi: 'Downpour' },
      { key: 'erosion', label: 'Erosion rate', min: 0.05, max: 1, step: 0.01, lo: 'Gentle', hi: 'Aggressive' },
      { key: 'deposition', label: 'Deposition', min: 0.02, max: 0.6, step: 0.01, lo: 'Carries', hi: 'Drops' },
      { key: 'capacity', label: 'Sediment capacity', min: 0.2, max: 2, step: 0.05, lo: 'Thin', hi: 'Heavy' },
      { key: 'evaporation', label: 'Evaporation', min: 0.1, max: 2, step: 0.05, lo: 'Wet', hi: 'Dry' },
      { key: 'talus', label: 'Thermal talus', min: 0, max: 12, step: 0.5, unit: '°', lo: 'Vertical', hi: 'Slumped' },
      { key: 'hardnessScale', label: 'Hardness scale', min: 200, max: 3000, step: 50, unit: ' m', lo: 'Broad strata', hi: 'Fine strata' },
      { key: 'hardnessContrast', label: 'Hardness contrast', min: 0, max: 1, step: 0.01, lo: 'Uniform', hi: 'Layered' },
    ] },
  { id: 'thermal', name: 'Thermal Erosion', cat: 'erode', icon: 'thermal', color: '#c98f7a',
    blurb: 'Talus-angle slumping — scree slopes and weathered crests.',
    defaults: { talus: 5.5, rate: 0.6, iterations: 12 },
    switches: [],
    params: [
      { key: 'talus', label: 'Talus angle', min: 1, max: 15, step: 0.5, unit: '°', lo: 'Steep', hi: 'Slumped' },
      { key: 'rate', label: 'Rate', min: 0.1, max: 1, step: 0.05, lo: 'Slow', hi: 'Fast' },
      { key: 'iterations', label: 'Iterations', min: 1, max: 40, step: 1, lo: 'Light', hi: 'Deep' },
    ] },
  { id: 'smooth', name: 'Smooth', cat: 'modify', icon: 'smooth', color: '#9fb6c9',
    blurb: 'Separable-style blur passes — softens noise and heals terraces.',
    defaults: { radius: 1, iterations: 3 },
    switches: [],
    params: [
      { key: 'radius', label: 'Radius', min: 1, max: 3, step: 1, unit: ' px', lo: 'Tight', hi: 'Wide' },
      { key: 'iterations', label: 'Iterations', min: 1, max: 8, step: 1, lo: 'Light', hi: 'Deep' },
    ] },
  { id: 'terrace', name: 'Terrace', cat: 'modify', icon: 'terrace', color: '#c4a68f',
    blurb: 'Quantizes elevation into steps — cultivated rice terraces or sedimentary strata.',
    defaults: { steps: 9, blend: 0.35, offset: 0.0 },
    switches: [],
    params: [
      { key: 'steps', label: 'Steps', min: 2, max: 40, step: 1, lo: 'Few', hi: 'Many' },
      { key: 'blend', label: 'Step softness', min: 0, max: 1, step: 0.01, lo: 'Crisp', hi: 'Soft' },
      { key: 'offset', label: 'Offset', min: 0, max: 1, step: 0.01, lo: 'Shifts the tread pattern' },
    ] },
  { id: 'levels', name: 'Levels', cat: 'modify', icon: 'levels', color: '#b0aec6',
    blurb: 'Remaps the elevation range with gamma — shapes valleys and peaks after erosion.',
    defaults: { inLow: 0, inHigh: 1, outLow: 0, outHigh: 1, gamma: 1.0 },
    switches: [],
    params: [
      { key: 'inLow', label: 'Input low', min: 0, max: 0.95, step: 0.01, lo: 'Clips the sea floor' },
      { key: 'inHigh', label: 'Input high', min: 0.05, max: 1, step: 0.01, lo: 'Clips the summits' },
      { key: 'outLow', label: 'Output low', min: 0, max: 1, step: 0.01, lo: 'Lifts the datum' },
      { key: 'outHigh', label: 'Output high', min: 0, max: 1.5, step: 0.01, lo: 'Stretches peaks' },
      { key: 'gamma', label: 'Gamma', min: 0.4, max: 2.5, step: 0.02, lo: 'Valleys', hi: 'Peaks' },
    ] },
  { id: 'clamp', name: 'Clamp', cat: 'modify', icon: 'clamp', color: '#a8a8a8',
    blurb: 'Hard-limits elevation — creates flat seas, shelves or plateaus.',
    defaults: { min: 0, max: 1 },
    switches: [],
    params: [
      { key: 'min', label: 'Minimum', min: 0, max: 1, step: 0.01, lo: 'Floor' },
      { key: 'max', label: 'Maximum', min: 0, max: 1, step: 0.01, lo: 'Ceiling' },
    ] },
  { id: 'detail', name: 'Detail Noise', cat: 'modify', icon: 'detail', color: '#c9b98f',
    blurb: 'High-frequency ridged detail — grit for close-up rock and ridgelines.',
    defaults: { amount: 0.06, scale: 220, octaves: 4, ridgedMix: 0.8 },
    switches: [{ key: 'ridgedOn', label: 'Ridged detail', icon: 'mountain', on: true }],
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 0.3, step: 0.005, digits: 3, lo: 'None', hi: 'Violent' },
      { key: 'scale', label: 'Detail scale', min: 40, max: 900, step: 10, unit: ' m', lo: 'Fine', hi: 'Broad' },
      { key: 'octaves', label: 'Octaves', min: 1, max: 8, step: 1, lo: 'Smooth', hi: 'Detailed' },
      { key: 'ridgedMix', label: 'Ridged mix', min: 0, max: 1, step: 0.01, lo: 'Fbm', hi: 'Ridged' },
    ] },
  { id: 'slant', name: 'Slant', cat: 'modify', icon: 'slant', color: '#a9b8c4',
    blurb: 'Tilts the entire domain — regional dip and strike.',
    defaults: { tiltX: 0, tiltZ: 0 },
    switches: [],
    params: [
      { key: 'tiltX', label: 'Tilt X', min: -0.5, max: 0.5, step: 0.01, lo: 'East ↔ west' },
      { key: 'tiltZ', label: 'Tilt Z', min: -0.5, max: 0.5, step: 0.01, lo: 'North ↔ south' },
    ] },
  { id: 'curvature', name: 'Curvature Flow', cat: 'modify', icon: 'curvature', color: '#8fc2c6',
    blurb: 'Diffuses by Laplacian curvature — smooths valleys, sharpens ridges.',
    defaults: { amount: 0.25, mode: 0 },
    switches: [],
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, lo: 'None', hi: 'Strong' },
    ] },
];

/* ── Texture layer catalogue ─────────────────────────────────── */
export const TEXTURE_TYPES = [
  { id: 'rock', name: 'Rock', icon: 'rock', color: '#8d8175', defaults: { albedo: '#7d7468', roughness: 0.85, patternScale: 90, patternContrast: 0.55, normalStrength: 1.0, heightMin: 0.0, heightMax: 1.0, slopeMin: 25, slopeMax: 90, noiseAmount: 0.45, noiseScale: 60, noiseContrast: 0.5, flowAmount: 0.0, aoMin: 0.0 } },
  { id: 'grass', name: 'Grass', icon: 'grass', color: '#7d9455', defaults: { albedo: '#6f7d4a', roughness: 0.92, patternScale: 120, patternContrast: 0.4, normalStrength: 0.8, heightMin: 0.04, heightMax: 0.72, slopeMin: 0, slopeMax: 38, noiseAmount: 0.55, noiseScale: 80, noiseContrast: 0.45, flowAmount: 0.0, aoMin: 0.25 } },
  { id: 'sand', name: 'Sand', icon: 'sand', color: '#c2ab82', defaults: { albedo: '#b5a078', roughness: 0.95, patternScale: 70, patternContrast: 0.3, normalStrength: 0.6, heightMin: 0.0, heightMax: 0.14, slopeMin: 0, slopeMax: 28, noiseAmount: 0.4, noiseScale: 50, noiseContrast: 0.35, flowAmount: 0.2, aoMin: 0.0 } },
  { id: 'snow', name: 'Snow', icon: 'snow', color: '#dfe6ec', defaults: { albedo: '#e8ecf0', roughness: 0.45, patternScale: 150, patternContrast: 0.3, normalStrength: 0.5, heightMin: 0.55, heightMax: 1.0, slopeMin: 0, slopeMax: 52, noiseAmount: 0.35, noiseScale: 110, noiseContrast: 0.4, flowAmount: 0.0, aoMin: 0.0 } },
  { id: 'dirt', name: 'Dirt', icon: 'dirt', color: '#7a6752', defaults: { albedo: '#6b5a48', roughness: 0.9, patternScale: 100, patternContrast: 0.45, normalStrength: 0.9, heightMin: 0.02, heightMax: 0.6, slopeMin: 8, slopeMax: 60, noiseAmount: 0.5, noiseScale: 70, noiseContrast: 0.4, flowAmount: 0.0, aoMin: 0.0 } },
  { id: 'scree', name: 'Scree', icon: 'scree', color: '#96908a', defaults: { albedo: '#8a8378', roughness: 0.82, patternScale: 55, patternContrast: 0.6, normalStrength: 1.2, heightMin: 0.1, heightMax: 1.0, slopeMin: 34, slopeMax: 90, noiseAmount: 0.6, noiseScale: 40, noiseContrast: 0.55, flowAmount: 0.0, aoMin: 0.0 } },
  { id: 'riverbed', name: 'Riverbed', icon: 'riverbed', color: '#6f6a5c', defaults: { albedo: '#5e5a4e', roughness: 0.55, patternScale: 60, patternContrast: 0.35, normalStrength: 0.5, heightMin: 0.0, heightMax: 0.35, slopeMin: 0, slopeMax: 30, noiseAmount: 0.3, noiseScale: 45, noiseContrast: 0.3, flowAmount: 0.85, aoMin: 0.0 } },
  { id: 'custom', name: 'Custom', icon: 'custom', color: '#a8a8a8', defaults: { albedo: '#999591', roughness: 0.8, patternScale: 100, patternContrast: 0.4, normalStrength: 0.9, heightMin: 0.0, heightMax: 1.0, slopeMin: 0, slopeMax: 90, noiseAmount: 0.4, noiseScale: 70, noiseContrast: 0.4, flowAmount: 0.0, aoMin: 0.0 } },
];

export const terrainType = id => TERRAIN_TYPES.find(t => t.id === id);
export const textureType = id => TEXTURE_TYPES.find(t => t.id === id);

/* ── Layer factories ─────────────────────────────────────────── */
export function createTerrainLayer(typeId, overrides = {}) {
  const t = terrainType(typeId);
  if (!t) throw new Error('unknown layer type ' + typeId);
  return {
    id: uid('layer'), kind: 'terrain', type: typeId,
    name: t.name, enabled: true, weight: 1, blend: 'mix', seed: t.defaults.seed ?? 1234,
    params: { ...t.defaults }, switches: Object.fromEntries(t.switches.map(s => [s.key, s.on])),
    ...overrides,
  };
}
export function createTextureLayer(typeId, overrides = {}) {
  const t = textureType(typeId);
  if (!t) throw new Error('unknown texture type ' + typeId);
  return {
    id: uid('tex'), kind: 'texture', type: typeId,
    name: t.name, enabled: true, weight: 1, blend: 'mix', seed: 1234,
    params: { ...t.defaults }, ...overrides,
  };
}

/* ── Environment & scene defaults ────────────────────────────── */
export const defaultEnv = () => ({
  sun: { azimuth: 138, elevation: 34, intensity: 108, temperature: 5450 },
  atmosphere: { rayleigh: 2.4, mie: 0.018, exposure: 0.9, fog: 0.55 },
  water: { enabled: true, level: 6.5, ripple: 0.55, clarity: 0.72, foam: 0.5 },
  terrain: { worldSize: 6000, heightScale: 1500, resolution: 2048, seed: 4242 },
  camera: { fov: 42 },
});

/* ── Presets ─────────────────────────────────────────────────── */
export function presetStack(id) {
  switch (id) {
    case 'alpine':
      return [createTerrainLayer('mountain', { name: 'Alpine massif', params: { ...terrainType('mountain').defaults, scale: 3200, sharpness: 2.15, warp: 0.45, height: 0.66 } }),
      createTerrainLayer('detail', { params: { ...terrainType('detail').defaults, amount: 0.05, scale: 260 } }),
      createTerrainLayer('erosion', { params: { ...terrainType('erosion').defaults, iterations: 110, rain: 1.0, erosion: 0.4, talus: 3.5 } }),
      createTerrainLayer('thermal', { params: { ...terrainType('thermal').defaults, talus: 6, iterations: 8 } })];
    case 'canyon':
      return [createTerrainLayer('perlin', { name: 'Mesa base', params: { ...terrainType('perlin').defaults, scale: 2600, octaves: 5, height: 0.42 } }),
      createTerrainLayer('canyon', { name: 'Carved canyon', blend: 'sub', params: { ...terrainType('canyon').defaults, scale: 2100, depth: 0.5, steepness: 2.2, meander: 0.65 } }),
      createTerrainLayer('terrace', { params: { ...terrainType('terrace').defaults, steps: 6, blend: 0.22 } }),
      createTerrainLayer('erosion', { params: { ...terrainType('erosion').defaults, iterations: 80, rain: 0.7, erosion: 0.3, talus: 4.5 } }),
      createTerrainLayer('detail', { params: { ...terrainType('detail').defaults, amount: 0.045, scale: 200 } })];
    case 'volcanic':
      return [createTerrainLayer('archipelago', { name: 'Isle field', params: { ...terrainType('archipelago').defaults, scale: 1900, height: 0.5, falloff: 1.5 } }),
      createTerrainLayer('volcano', { name: 'Stratovolcano', params: { ...terrainType('volcano').defaults, radius: 0.3, height: 0.72, crater: 0.5, rim: 2.4 } }),
      createTerrainLayer('erosion', { params: { ...terrainType('erosion').defaults, iterations: 90, rain: 0.9, erosion: 0.42, talus: 4.0 } }),
      createTerrainLayer('detail', { params: { ...terrainType('detail').defaults, amount: 0.06, scale: 240, ridgedMix: 0.9 } })];
    case 'dunes':
      return [createTerrainLayer('hills', { name: 'Desert floor', params: { ...terrainType('hills').defaults, scale: 2200, height: 0.28, octaves: 4 } }),
      createTerrainLayer('dunes', { name: 'Dune sea', params: { ...terrainType('dunes').defaults, scale: 850, height: 0.34, asymmetry: 0.7, orientation: 24 } }),
      createTerrainLayer('warp', { params: { ...terrainType('warp').defaults, strength: 0.22, scale: 900 } }),
      createTerrainLayer('detail', { params: { ...terrainType('detail').defaults, amount: 0.03, scale: 160, ridgedMix: 0.35 } })];
    case 'glacial':
      return [createTerrainLayer('mountain', { name: 'Glacial spires', params: { ...terrainType('mountain').defaults, scale: 2800, sharpness: 2.7, octaves: 8, height: 0.7 } }),
      createTerrainLayer('terrace', { params: { ...terrainType('terrace').defaults, steps: 12, blend: 0.3 } }),
      createTerrainLayer('smooth', { params: { ...terrainType('smooth').defaults, radius: 1, iterations: 2 } }),
      createTerrainLayer('erosion', { params: { ...terrainType('erosion').defaults, iterations: 140, rain: 0.8, erosion: 0.5, deposition: 0.1, talus: 2.5 } })];
    case 'plains':
      return [createTerrainLayer('hills', { name: 'Rolling plains', params: { ...terrainType('hills').defaults, scale: 2600, height: 0.3, octaves: 5 } }),
      createTerrainLayer('perlin', { name: 'Fbm variation', params: { ...terrainType('perlin').defaults, scale: 1200, octaves: 6, height: 0.16 }, blend: 'add' }),
      createTerrainLayer('smooth', { params: { ...terrainType('smooth').defaults, radius: 1, iterations: 2 } }),
      createTerrainLayer('detail', { params: { ...terrainType('detail').defaults, amount: 0.02, scale: 300, ridgedMix: 0.2 } })];
    default:
      return presetStack('alpine');
  }
}

export function presetTextureStack(id) {
  switch (id) {
    case 'alpine':
      return [createTextureLayer('rock', { name: 'Bedrock', params: { ...textureType('rock').defaults, slopeMin: 30 } }),
      createTextureLayer('grass', { name: 'Alpine meadow', params: { ...textureType('grass').defaults, heightMax: 0.6, slopeMax: 34 } }),
      createTextureLayer('scree', { name: 'Scree slopes', params: { ...textureType('scree').defaults, heightMin: 0.3, slopeMin: 36 } }),
      createTextureLayer('snow', { name: 'Snowpack', params: { ...textureType('snow').defaults, heightMin: 0.6, slopeMax: 48 } })];
    case 'canyon':
      return [createTextureLayer('sand', { name: 'Canyon floor', params: { ...textureType('sand').defaults, heightMax: 0.3 } }),
      createTextureLayer('rock', { name: 'Red strata', params: { ...textureType('rock').defaults, albedo: '#8a5f48', slopeMin: 20, patternScale: 120, patternContrast: 0.7 } }),
      createTextureLayer('scree', { name: 'Talus', params: { ...textureType('scree').defaults, heightMin: 0.25, slopeMin: 40 } })];
    case 'volcanic':
      return [createTextureLayer('sand', { name: 'Black beach', params: { ...textureType('sand').defaults, albedo: '#4a4642', heightMax: 0.16 } }),
      createTextureLayer('rock', { name: 'Basalt', params: { ...textureType('rock').defaults, albedo: '#4c4a4a', roughness: 0.8, slopeMin: 22 } }),
      createTextureLayer('grass', { name: 'Cloud forest', params: { ...textureType('grass').defaults, albedo: '#5d7042', heightMin: 0.15, heightMax: 0.62, slopeMax: 32 } }),
      createTextureLayer('snow', { name: 'Summit snow', params: { ...textureType('snow').defaults, heightMin: 0.66 } })];
    case 'dunes':
      return [createTextureLayer('sand', { name: 'Dune sand', params: { ...textureType('sand').defaults, albedo: '#c9ad7d' } }),
      createTextureLayer('scree', { name: 'Desert pavement', params: { ...textureType('scree').defaults, albedo: '#8f7f66', slopeMin: 30 } })];
    case 'glacial':
      return [createTextureLayer('rock', { name: 'Greywacke', params: { ...textureType('rock').defaults, albedo: '#6e6a63', slopeMin: 26 } }),
      createTextureLayer('scree', { name: 'Moraine', params: { ...textureType('scree').defaults, heightMin: 0.2, slopeMin: 38 } }),
      createTextureLayer('snow', { name: 'Glacier', params: { ...textureType('snow').defaults, heightMin: 0.45, slopeMax: 40, albedo: '#eef3f7' } })];
    case 'plains':
      return [createTextureLayer('grass', { name: 'Prairie grass', params: { ...textureType('grass').defaults, albedo: '#7a8a4e', heightMax: 0.8 } }),
      createTextureLayer('dirt', { name: 'Loam', params: { ...textureType('dirt').defaults, heightMin: 0.05, heightMax: 0.5, slopeMin: 10 } }),
      createTextureLayer('rock', { name: 'Outcrops', params: { ...textureType('rock').defaults, slopeMin: 32 } })];
    default:
      return presetTextureStack('alpine');
  }
}

/* ── Project (de)serialization ───────────────────────────────── */
export function serializeProject(state) {
  return {
    format: 'frontier-terrain-1',
    name: state.name,
    env: state.env,
    terrain: { layers: state.terrain.layers },
    texture: { layers: state.texture.layers },
    view: state.view,
  };
}
export function deserializeProject(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || data.format !== 'frontier-terrain-1') throw new Error('Not a Terrain Forge project');
  return {
    name: data.name || 'Untitled world',
    env: { ...defaultEnv(), ...data.env, sun: { ...defaultEnv().sun, ...data.env?.sun }, atmosphere: { ...defaultEnv().atmosphere, ...data.env?.atmosphere }, water: { ...defaultEnv().water, ...data.env?.water }, terrain: { ...defaultEnv().terrain, ...data.env?.terrain }, camera: { ...defaultEnv().camera, ...data.env?.camera } },
    terrain: { layers: (data.terrain?.layers || []).filter(l => terrainType(l.type)) },
    texture: { layers: (data.texture?.layers || []).filter(l => textureType(l.type)) },
    view: { mode: data.view?.mode ?? 0, shadows: data.view?.shadows ?? true },
  };
}
