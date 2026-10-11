// Starting points. Each preset is a complete stack — terrain and texture — chosen to show a
// different part of the system rather than to be a final artwork.

import { makeLayer } from './terrain-schema.js';
import { makeTexLayer } from './texture-schema.js';

const L = (kind, over = {}, params = {}) => {
  const layer = makeLayer(kind, over);
  layer.params = { ...layer.params, ...params };
  return layer;
};

const T = (mat, over = {}) => makeTexLayer(mat, over);

export const PRESETS = [
  {
    id: 'alpine',
    name: 'Alpine Ridge',
    blurb: 'Ridged spines, heavy erosion, snow above the tree line.',
    terrain: { extent: 4200, heightMeters: 1600, waterLevel: 0.12, res: 1024 },
    water: { enabled: true, waveAmplitude: 0.02, waveScale: 3.5 },
    atmo: { sunElevation: 28, sunAzimuth: 118, sunIntensity: 13 },
    // Stack is written top-first, evaluated bottom-first.
    stack: [
      L('snow', { name: 'Snow cap', opacity: 0.9 }, { amount: 0.05, altitude: 0.58, slopeMin: 0.4, slopeMax: 0.82, scale: 7 }),
      L('detail', { name: 'Rock detail', opacity: 0.7 }, { scale: 46, amount: 0.035, slopeMin: 0.2, slopeMax: 0.7 }),
      L('erosion', { name: 'Erosion' }, { iterations: 340, rain: 0.6, dissolve: 0.5, capacity: 0.55, thermal: 0.4, talusAngle: 36 }),
      L('cliff', { name: 'Cliff faces', opacity: 0.55 }, { amount: 0.45, slopeMin: 0.3, slopeMax: 0.75 }),
      L('warp', { name: 'Domain warp' }, { frequency: 2.2, strength: 0.28, octaves: 4 }),
      L('fractal', { name: 'Ridged base' }, {
        type: 1, seed: 1284, octaves: 10, frequency: 2.4, lacunarity: 2.05, gain: 0.5,
        warp: 0.4, sharpness: 2.2, amplitude: 0.62, offset: 0.34,
      }),
    ],
    textures: [
      T(10, { name: 'Snow', maskMode: 1, maskMin: 0.6, maskMax: 1, maskFeather: 0.09, roughness: 0.42 }),
      T(3, { name: 'Scree', maskMode: 2, maskMin: 0.42, maskMax: 1, maskFeather: 0.16 }),
      T(14, { name: 'Cliff rock', maskMode: 2, maskMin: 0.62, maskMax: 1, maskFeather: 0.1, heightContrast: 1.1 }),
      T(8, { name: 'Alpine grass', maskMode: 1, maskMin: 0, maskMax: 0.42, maskFeather: 0.1, slopeInfluence: 0.9 }),
      T(0, { name: 'Granite', maskMode: 0 }),
    ],
  },
  {
    id: 'canyon',
    name: 'Canyon Lands',
    blurb: 'Sedimentary terraces cut by a river. Warm, dry, stratified.',
    terrain: { extent: 4600, heightMeters: 900, waterLevel: 0.06, res: 1024 },
    water: { enabled: true, absorption: '#7a3a22', scatter: '#3d5f52', foam: 0.35 },
    atmo: { sunElevation: 46, sunAzimuth: 205, sunIntensity: 14, rayleighScale: 0.9 },
    stack: [
      L('detail', { name: 'Grit', opacity: 0.6 }, { scale: 38, amount: 0.02, slopeMin: 0.1, slopeMax: 0.9 }),
      L('river', { name: 'Channel carving' }, { depth: 0.05, exponent: 1.8, valley: 1.2, iterations: 4 }),
      L('erosion', { name: 'Erosion' }, { iterations: 420, rain: 0.75, dissolve: 0.62, capacity: 0.7, thermal: 0.5, talusAngle: 42 }),
      L('terrace', { name: 'Bedding terraces', opacity: 0.85 }, { steps: 22, smoothness: 0.32, slopeMin: 0.4, slopeMax: 0.95 }),
      L('levels', { name: 'Grade' }, { inLow: 0.05, inHigh: 0.95, gamma: 1.15, contrast: 1.15 }),
      L('fractal', { name: 'Plateau base' }, {
        type: 0, seed: 9021, octaves: 8, frequency: 2.1, lacunarity: 2.0, gain: 0.52,
        warp: 0.3, amplitude: 0.5, offset: 0.5,
      }),
    ],
    textures: [
      T(5, { name: 'Sand drifts', maskMode: 5, maskMin: 0.5, maskMax: 1, maskFeather: 0.12, heightContrast: 1.2 }),
      T(6, { name: 'Cracked flats', maskMode: 2, maskMin: 0, maskMax: 0.22, maskFeather: 0.08 }),
      T(14, { name: 'Cliff banding', maskMode: 2, maskMin: 0.5, maskMax: 1, maskFeather: 0.12, heightContrast: 1.2 }),
      T(1, { name: 'Sandstone', maskMode: 0 }),
    ],
  },
  {
    id: 'volcanic',
    name: 'Volcanic Isles',
    blurb: 'Caldera cones rising out of the sea, ash slopes, black sand.',
    terrain: { extent: 5200, heightMeters: 1500, waterLevel: 0.24, res: 1024 },
    water: { enabled: true, waveAmplitude: 0.05, waveScale: 9, absorption: '#6b2418', scatter: '#1f5560' },
    atmo: { sunElevation: 18, sunAzimuth: 265, sunIntensity: 11, rayleighScale: 1.15 },
    stack: [
      L('detail', { name: 'Ash texture', opacity: 0.5 }, { scale: 70, amount: 0.014, slopeMin: 0.05, slopeMax: 0.9 }),
      L('erosion', { name: 'Erosion' }, { iterations: 260, rain: 0.7, dissolve: 0.55, capacity: 0.6, thermal: 0.45 }),
      L('volcano', { name: 'Main cone', blend: 4 }, {
        cx: 0.42, cz: 0.44, radius: 0.3, height: 0.62, craterRadius: 0.075, craterDepth: 0.13, roughness: 0.32,
      }),
      L('volcano', { name: 'Secondary cone', blend: 4 }, {
        cx: 0.72, cz: 0.66, radius: 0.14, height: 0.3, craterRadius: 0.04, craterDepth: 0.06, roughness: 0.4,
      }),
      L('island', { name: 'Island' }, { cx: 0.5, cz: 0.5, radius: 0.82, falloff: 0.42, warpScale: 3.2, warpAmount: 0.3 }),
      L('fractal', { name: 'Sea floor' }, {
        type: 0, seed: 4477, octaves: 9, frequency: 3.0, lacunarity: 2.05, gain: 0.5,
        warp: 0.35, amplitude: 0.4, offset: 0.28,
      }),
    ],
    textures: [
      T(10, { name: 'Ash snow', maskMode: 1, maskMin: 0.82, maskMax: 1, maskFeather: 0.06, albedoA: '#e8e4e0' }),
      T(13, { name: 'Ash', maskMode: 1, maskMin: 0.5, maskMax: 1, maskFeather: 0.14 }),
      T(3, { name: 'Scree', maskMode: 2, maskMin: 0.4, maskMax: 1, maskFeather: 0.14 }),
      T(2, { name: 'Basalt', maskMode: 2, maskMin: 0.55, maskMax: 1, maskFeather: 0.1, heightContrast: 1.2 }),
      T(5, { name: 'Black sand', maskMode: 7, maskMin: 0.15, maskMax: 1, maskFeather: 0.1, albedoA: '#4a4640', albedoB: '#24221f' }),
      T(2, { name: 'Basalt base', maskMode: 0 }),
    ],
  },
  {
    id: 'highlands',
    name: 'Rolling Highlands',
    blurb: 'Soft glacial hills. Grass, moss and exposed soil.',
    terrain: { extent: 3800, heightMeters: 620, waterLevel: 0.1, res: 1024 },
    water: { enabled: true, waveAmplitude: 0.015, waveScale: 2.5 },
    atmo: { sunElevation: 38, sunAzimuth: 62, sunIntensity: 12.5, rayleighScale: 1.05 },
    stack: [
      L('detail', { name: 'Ground detail', opacity: 0.5 }, { scale: 55, amount: 0.012, slopeMin: 0, slopeMax: 0.8 }),
      L('sediment', { name: 'Valley fill', opacity: 0.7 }, { thickness: 0.03, slopeMin: 0.02, slopeMax: 0.28, altitudeMax: 0.55 }),
      L('erosion', { name: 'Erosion' }, { iterations: 200, rain: 0.5, dissolve: 0.3, capacity: 0.4, thermal: 0.3, talusAngle: 28 }),
      L('smooth', { name: 'Glacial smoothing' }, { strength: 0.5, preserve: 0.4, iterations: 6 }),
      L('fractal', { name: 'Hills' }, {
        type: 0, seed: 3311, octaves: 8, frequency: 3.4, lacunarity: 2.0, gain: 0.46,
        warp: 0.5, amplitude: 0.42, offset: 0.45,
      }),
    ],
    textures: [
      T(9, { name: 'Moss', maskMode: 4, maskMin: 0.52, maskMax: 1, maskFeather: 0.14, noiseScale: 14, slopeInfluence: 0.6 }),
      T(3, { name: 'Exposed rock', maskMode: 2, maskMin: 0.45, maskMax: 1, maskFeather: 0.12 }),
      T(8, { name: 'Grass', maskMode: 2, maskMin: 0, maskMax: 0.55, maskFeather: 0.16 }),
      T(7, { name: 'Soil', maskMode: 0 }),
    ],
  },
  {
    id: 'dunes',
    name: 'Sand Sea',
    blurb: 'Billowing dunes. Pure wind, no water.',
    terrain: { extent: 4000, heightMeters: 420, waterLevel: 0.0, res: 1024 },
    water: { enabled: false },
    atmo: { sunElevation: 62, sunAzimuth: 150, sunIntensity: 15, rayleighScale: 0.85 },
    stack: [
      L('detail', { name: 'Grain', opacity: 0.4 }, { scale: 120, amount: 0.006, slopeMin: 0, slopeMax: 1 }),
      L('smooth', { name: 'Wind polish' }, { strength: 0.35, preserve: 0.2, iterations: 3 }),
      L('warp', { name: 'Dune drift' }, { frequency: 1.6, strength: 0.45, octaves: 3 }),
      L('fractal', { name: 'Dune field' }, {
        type: 2, seed: 7717, octaves: 7, frequency: 2.2, lacunarity: 2.1, gain: 0.55,
        warp: 0.5, amplitude: 0.5, offset: 0.5,
      }),
    ],
    textures: [
      T(6, { name: 'Crusted hollows', maskMode: 2, maskMin: 0, maskMax: 0.2, maskFeather: 0.07 }),
      T(5, { name: 'Rippled sand', maskMode: 0, albedoA: '#e0cba1', albedoB: '#b09260', roughness: 0.92 }),
    ],
  },
  {
    id: 'fjord',
    name: 'Glacial Fjord',
    blurb: 'Steep walls, deep water, ice at the head of the inlet.',
    terrain: { extent: 5000, heightMeters: 1400, waterLevel: 0.3, res: 1024 },
    water: {
      enabled: true, waveAmplitude: 0.012, waveScale: 4, absorption: '#5f2a1c',
      scatter: '#1d5b66', foam: 0.2, reflectivity: 0.95,
    },
    atmo: { sunElevation: 22, sunAzimuth: 310, sunIntensity: 11.5, rayleighScale: 1.1 },
    stack: [
      L('snow', { name: 'Snow', opacity: 0.9 }, { amount: 0.045, altitude: 0.55, slopeMin: 0.42, slopeMax: 0.85, scale: 6 }),
      L('detail', { name: 'Rock detail', opacity: 0.65 }, { scale: 42, amount: 0.03, slopeMin: 0.25, slopeMax: 0.8 }),
      L('erosion', { name: 'Glacial erosion' }, { iterations: 380, rain: 0.85, dissolve: 0.6, capacity: 0.65, thermal: 0.55, talusAngle: 40 }),
      L('cliff', { name: 'Fjord walls', opacity: 0.6 }, { amount: 0.55, slopeMin: 0.25, slopeMax: 0.7 }),
      L('island', { name: 'Inlet', opacity: 0.9, blend: 2 }, { cx: 0.5, cz: 0.62, radius: 0.42, falloff: 0.3, warpScale: 2.4, warpAmount: 0.35 }),
      L('fractal', { name: 'Mountain base' }, {
        type: 1, seed: 6060, octaves: 10, frequency: 2.6, lacunarity: 2.05, gain: 0.5,
        warp: 0.45, sharpness: 2.1, amplitude: 0.6, offset: 0.3,
      }),
    ],
    textures: [
      T(10, { name: 'Snow', maskMode: 1, maskMin: 0.58, maskMax: 1, maskFeather: 0.08 }),
      T(11, { name: 'Ice', maskMode: 7, maskMin: 0.05, maskMax: 1, maskFeather: 0.12, roughness: 0.12 }),
      T(3, { name: 'Scree', maskMode: 2, maskMin: 0.45, maskMax: 1, maskFeather: 0.14 }),
      T(0, { name: 'Granite walls', maskMode: 2, maskMin: 0.55, maskMax: 1, maskFeather: 0.1, heightContrast: 1.2 }),
      T(9, { name: 'Moss', maskMode: 1, maskMin: 0.3, maskMax: 0.5, maskFeather: 0.08, slopeInfluence: 0.9 }),
      T(0, { name: 'Granite', maskMode: 0 }),
    ],
  },
];

export function defaultPreset() {
  return PRESETS[0];
}
