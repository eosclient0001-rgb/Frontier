import { sparseLayout } from "./sparse-sdf-layout.js";
import { rainDefaults } from "./rain-physics.js";
import { RAIN_PARTICLES } from "./particle-pool.js";
import { performanceDefaults, erosionTiming } from "./erosion-performance.js";
import { satmapDefaults } from "./satmaps.js";
import { hydraulicDefaults } from "./hydraulic-transport.js";
import { lifecycleDefaults, PARTICLE_DT } from "./particle-lifecycle.js";
import { terrainDefaults, createNoiseTerrain } from "./noise-terrain.js";
import { localPoint } from "./shapes.js";
import { fractalNoise, terraceY } from "./volume-noise.js";
import {
  SIZE,
  MIN,
  MAX,
  CELL,
  BAND,
  configureDomain,
  SCENE_SCALE,
} from "./domain.js";
export { SIZE, MIN, MAX, CELL } from "./domain.js";
import { waterDefaults } from "./water.js";
// A bounded 3D signed-distance volume. Negative values are solid rock.
// Every operation works in XYZ, including undercuts, caves and additive sculpting.
export const defaults = {
  ...rainDefaults,
  ...satmapDefaults,
  waterOffset: 0,
  ...hydraulicDefaults,
  ...performanceDefaults,
  ...lifecycleDefaults,
  ...terrainDefaults,
  plotRotation: [0, 0, 0],
  plotX: 0,
  plotY: 0,
  plotZ: 0,
  plotBase: -2,
  plotBevel: 0.3,
  plotNoiseType: 1,
  plotNoiseAmount: 0,
  plotNoiseScale: 4,
  plotNoiseOctaves: 4,
  plotNoiseGain: 0.5,
  plotNoiseLacunarity: 2,
  plotNoiseWarp: 0,
  plotNoiseSeed: 4821,
  plotTerraceHeight: 1,
  plotTerraceStrength: 0,
  brushStrength: 0.35,
  brushFalloff: 2,
  brushAspect: 1.8,
  brushDepth: 1,
  brushSpacing: 0.25,
  brushTexture: 0,
  brushNoiseType: 1,
  brushNoiseScale: 1.5,
  brushOctaves: 3,
  plotWidth: 28,
  plotLength: 28,
  plotHeight: 2.5,
  heightStrength: 0.25,
  showTerrain: true,
  sceneObjects: [],
  ...waterDefaults,
  fractureDetails: [],
  cellFractureDetail: null,
  relief: 12,
  strata: 0.65,
  roughness: 0.48,
  seed: 4821,
  preset: 4,
  rainfall: 0.55,
  erosion: 0.45,
  hardness: 0.6,
  thermal: 0.3,
  wind: 0.2,
  deposition: 0.35,
  speed: 1,
  waterLevel: 0.7,
  ripple: 0.25,
  clarity: 0.65,
  sun: 135,
  haze: 0.25,
  waterEnabled: true,
  radius: 1.8,
  particleCount: 1024,
  footprint: 0.45,
  grainSize: 0.15,
  capacity: 0.6,
  restitution: 0.08,
  sourceMode: 0,
  showParticles: true,
  showSediment: true,
  cameraSpeed: 8,
  agentDiameter: 3,
  riverEnabled: true,
  riverSpeed: 3.2,
  riverWidth: 3,
  riverDepth: 0.6,
  riverOffset: 0,
  windSpeed: 5.5,
  windHeight: 6,
  windSpread: 2,
  windDirection: 0,
  chemicalRate: 0.45,
  solubility: 0.6,
};
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (v) => {
  v = clamp(v, 0, 1);
  return v * v * (3 - 2 * v);
};
function hash(x, y, z, seed) {
  let n =
    Math.imul(x, 374761393) ^
    Math.imul(y, 668265263) ^
    Math.imul(z, 2147483647) ^
    Math.imul(seed, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
export function noise(x, y, z, seed = 0) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const u = smooth(x - ix),
    v = smooth(y - iy),
    w = smooth(z - iz);
  return mix(
    mix(
      mix(hash(ix, iy, iz, seed), hash(ix + 1, iy, iz, seed), u),
      mix(hash(ix, iy + 1, iz, seed), hash(ix + 1, iy + 1, iz, seed), u),
      v,
    ),
    mix(
      mix(hash(ix, iy, iz + 1, seed), hash(ix + 1, iy, iz + 1, seed), u),
      mix(
        hash(ix, iy + 1, iz + 1, seed),
        hash(ix + 1, iy + 1, iz + 1, seed),
        u,
      ),
      v,
    ),
    w,
  );
}
function box(x, y, z, bx, by, bz, r = 0) {
  const qx = Math.abs(x) - bx,
    qy = Math.abs(y) - by,
    qz = Math.abs(z) - bz;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) +
    Math.min(Math.max(qx, qy, qz), 0) -
    r
  );
}
export function baseSDF(x, y, z, p = defaults) {
  if (p.preset === 4) return createNoiseTerrain(p)(x, y, z);
  if (p.preset === 3) {
    const top = p.plotHeight ?? 2.5,
      bottom = Math.min(p.plotBase ?? -2, top - 0.8),
      [lx, ly, lz] = localPoint([x, y, z], {
        position: [p.plotX ?? 0, p.plotY ?? 0, p.plotZ ?? 0],
        rotation: p.plotRotation ?? [0, 0, 0],
      }),
      bevel = Math.min(p.plotBevel ?? 0.3, (top - bottom) * 0.45);
    const qy = terraceY(
      ly,
      p.plotTerraceHeight ?? 1,
      p.plotTerraceStrength ?? 0,
    );
    let d = box(
      lx,
      qy - (top + bottom) * 0.5,
      lz,
      (p.plotWidth ?? 38) * 0.5 - bevel,
      (top - bottom) * 0.5 - bevel,
      (p.plotLength ?? 34) * 0.5 - bevel,
      bevel,
    );
    if (p.plotNoiseAmount > 0)
      d -=
        p.plotNoiseAmount *
        fractalNoise([lx, ly, lz], {
          noiseType: p.plotNoiseType,
          noiseScale: p.plotNoiseScale,
          noiseOctaves: p.plotNoiseOctaves,
          noiseGain: p.plotNoiseGain,
          noiseLacunarity: p.plotNoiseLacunarity,
          noiseWarp: p.plotNoiseWarp,
          noiseSeed: p.plotNoiseSeed,
        });
    return Math.max(
      d,
      ...MIN.map((v, i) => v + 1 - [x, y, z][i]),
      ...MAX.map((v, i) => [x, y, z][i] - v + 1),
    );
  }
  // Removed fixed scenes: old numeric preset IDs resolve to the noise generator.
  return createNoiseTerrain(p)(x, y, z);
}
export function generateVolume(p, onProgress) {
  configureDomain(p);
  const sample =
    p.preset === 4 ? createNoiseTerrain(p) : (x, y, z) => baseSDF(x, y, z, p);
  const origin = [0, 0, 0];
  const [nx, ny, nz] = SIZE;
  const a = new Float32Array(nx * ny * nz * 4);
  for (let z = 0; z < nz; z++) {
    onProgress?.(z / nz);
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i = ((z * ny + y) * nx + x) * 4;
        a[i] = sample(
          MIN[0] + (x + 0.5) * CELL[0] + origin[0],
          MIN[1] + (y + 0.5) * CELL[1] + origin[1],
          MIN[2] + (z + 0.5) * CELL[2] + origin[2],
        );
        a[i + 3] = clamp(0.5 - a[i] / (2 * BAND), 0, 1);
      }
  }
  onProgress?.(1);
  return a;
}
export function sampleVolume(a, p) {
  const q = p.map((v, k) =>
    clamp((v - MIN[k]) / CELL[k] - 0.5, 0, SIZE[k] - 1.001),
  );
  const lo = q.map(Math.floor),
    f = q.map((v, k) => v - lo[k]);
  let value = 0;
  for (let z = 0; z < 2; z++)
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++)
        value +=
          a[(((lo[2] + z) * SIZE[1] + lo[1] + y) * SIZE[0] + lo[0] + x) * 4] *
          (x ? f[0] : 1 - f[0]) *
          (y ? f[1] : 1 - f[1]) *
          (z ? f[2] : 1 - f[2]);
  const outside = Math.hypot(
    ...p.map((v, k) => Math.max(MIN[k] - v, v - MAX[k], 0)),
  );
  return value + outside;
}
export function raycastVolume(a, origin, direction) {
  let near = 0,
    far = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(direction[k]) < 1e-7) {
      if (origin[k] < MIN[k] || origin[k] > MAX[k]) return null;
      continue;
    }
    let t1 = (MIN[k] - origin[k]) / direction[k],
      t2 = (MAX[k] - origin[k]) / direction[k];
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
  }
  if (near > far) return null;
  let t = near;
  for (let j = 0; j < 240 && t < far; j++) {
    const pos = origin.map((v, k) => v + direction[k] * t);
    const d = sampleVolume(a, pos);
    if (d < 0.075 * SCENE_SCALE) return pos;
    t += Math.max(0.04 * SCENE_SCALE, d * 0.6);
  }
  return null;
}
export function sculptVolume(a, point, radius, tool) {
  const [nx, ny, nz] = SIZE;
  const out = new Float32Array(a);
  const low = point.map((v, k) =>
    clamp(Math.floor((v - radius * 1.6 - MIN[k]) / CELL[k]), 1, SIZE[k] - 2),
  );
  const high = point.map((v, k) =>
    clamp(Math.ceil((v + radius * 1.6 - MIN[k]) / CELL[k]), 1, SIZE[k] - 2),
  );
  for (let z = low[2]; z <= high[2]; z++)
    for (let y = low[1]; y <= high[1]; y++)
      for (let x = low[0]; x <= high[0]; x++) {
        const i = ((z * ny + y) * nx + x) * 4;
        const r = Math.hypot(
          MIN[0] + (x + 0.5) * CELL[0] - point[0],
          MIN[1] + (y + 0.5) * CELL[1] - point[1],
          MIN[2] + (z + 0.5) * CELL[2] - point[2],
        );
        const sphere = r - radius;
        if (tool === "carve") out[i] = Math.max(a[i], -sphere);
        else if (tool === "add") out[i] = Math.min(a[i], sphere);
        else if (r < radius) {
          const avg =
            (a[i - 4] +
              a[i + 4] +
              a[i - nx * 4] +
              a[i + nx * 4] +
              a[i - nx * ny * 4] +
              a[i + nx * ny * 4]) /
            6;
          out[i] = mix(a[i], avg, 0.7 * (1 - r / radius));
        }
        out[i + 3] = clamp(0.5 - out[i] / (2 * BAND), 0, 1);
      }
  return out;
}
// Local surface transport: rainfall wets exposed strata, neighboring wet surface
// voxels carry moisture/sediment down gravity. Dissolution and wind remove rock;
// slow flow on low, upward-facing surfaces deposits a fraction of the sediment.
// This is intentionally a weathering approximation, not mass-conserving CFD.
export function simulateVolume(a, p) {
  const out = new Float32Array(a);
  const [nx, ny, nz] = SIZE;
  const sx = 4,
    sy = nx * 4,
    sz = nx * ny * 4;
  for (let z = 1; z < nz - 1; z++)
    for (let y = 1; y < ny - 1; y++)
      for (let x = 1; x < nx - 1; x++) {
        const i = ((z * ny + y) * nx + x) * 4,
          d = a[i];
        if (Math.abs(d) > 1.15) continue;
        const dx = (a[i + sx] - a[i - sx]) / (2 * CELL[0]),
          dy = (a[i + sy] - a[i - sy]) / (2 * CELL[1]),
          dz = (a[i + sz] - a[i - sz]) / (2 * CELL[2]);
        const len = Math.hypot(dx, dy, dz) || 1;
        const up = clamp(dy / len, 0, 1);
        const slope = Math.sqrt(Math.max(0, 1 - up * up));
        const py = MIN[1] + (y + 0.5) * CELL[1];
        const layer = 0.5 + 0.5 * Math.sin(py * 3.5);
        const hard = clamp(
          p.hardness * 0.75 + layer * p.strata * 0.38,
          0.05,
          0.97,
        );
        const above = a[i + sy + 1];
        const side =
          (a[i - sx + 1] + a[i + sx + 1] + a[i - sz + 1] + a[i + sz + 1]) *
          0.25;
        const moisture = clamp(
          a[i + 1] * 0.56 +
            above * 0.24 +
            side * 0.14 +
            p.rainfall * 0.12 * (0.12 + up),
          0,
          2,
        );
        const flow = moisture * (0.15 + slope * 0.85);
        const erode = p.erosion * flow * (1 - hard) * 0.065;
        const avg =
          (a[i - sx] +
            a[i + sx] +
            a[i - sy] +
            a[i + sy] +
            a[i - sz] +
            a[i + sz]) /
          6;
        const thermal =
          p.thermal * Math.max(0, avg - d) * (0.25 + slope) * 0.09;
        const wind =
          p.wind * (1 - hard) * (0.35 + 0.65 * Math.max(dx / len, 0)) * 0.005;
        const sediment = a[i + 2] * 0.65 + a[i + sy + 2] * 0.2 + erode;
        const deposit =
          p.deposition * sediment * up * 0.14 * (1 - smooth((py - 1) / 4));
        const band = 1 - smooth(Math.abs(d) / 1.15);
        out[i] = d + (erode + thermal + wind - deposit) * band;
        out[i + 1] = moisture * 0.98;
        out[i + 2] = Math.max(0, sediment - deposit);
      }
  return out;
}
export function encodeScene(
  volume,
  settings,
  camera,
  iterations,
  refinement = null,
) {
  const header = {
    format: "frontier-sdf",
    version: refinement ? 3 : 2,
    dimensions: SIZE,
    bounds: { min: MIN, max: MAX },
    world: settings.worldEnabled
      ? {
          model: "whole-terrain-sdf-v1",
          origin: [0, 0, 0],
          extent: [settings.terrainWidth, settings.terrainLength],
          activeAreaOnly: false,
          cachedAreasIncluded: false,
          cellMetres: CELL,
        }
      : null,
    channels: [
      "signedDistance",
      "moisture",
      "depositedSediment",
      "solidFraction",
    ],
    componentType: "float32",
    byteOrder: "little-endian",
    settings,
    camera,
    iterations,
    erosionModel: "webgl2-multi-agent-transport-v2",
    particleStateIncluded: false,
    precipitationModel: "volume-budgeted-rain-v3",
    auxiliaryRainCapacity: RAIN_PARTICLES,
    rainFilmIncluded: false,
    rainWaterUnits: "m³",
    rainHydraulicModel: "volume-driven-shear-substrate-v1",
    rainWaterLedgerIncluded: false,
    occupancyResidualIncluded: false,
    materialLayersIncluded: false,
    fractureDetailsIncluded: true,
    liveModifierBaseIncluded: false,
    particleTimeStep: PARTICLE_DT,
    particleTimeStepMeaning:
      "lifecycle clock unit; accelerated GPU pass duration is separate",
    particleGpuPassSeconds: erosionTiming(settings).dt,
    accelerationModel: "bounded-multirate-preview-v1",
    motionSubstepMaxSeconds: 0.01,
    particleLifecycleModel: "rain-runoff-captured-v2",
    hydraulicExchangeModel: "si-suspension-relaxation-v2",
    satmapModel: "volumetric-surface-material-v1",
    flowHistoryIncluded: false,
    materialAccounting: "voxel solid fraction; not exact isosurface volume",
    refinement: refinement
      ? {
          model: "sparse-xyz-hydraulic-v1",
          layout: sparseLayout(refinement.layout),
          domain: refinement.domain,
          limit: refinement.limit,
          brickSide: 8,
          channels: [
            "signedDistance",
            "removedVolume",
            "depositedVolume",
            "solidFraction",
          ],
          sections: [
            {
              name: "keys",
              offset: volume.byteLength,
              length: refinement.keys.byteLength,
            },
            {
              name: "values",
              offset: volume.byteLength + refinement.keys.byteLength,
              length: refinement.values.byteLength,
            },
            {
              name: "materials",
              offset:
                volume.byteLength +
                refinement.keys.byteLength +
                refinement.values.byteLength,
              length: refinement.materials.byteLength,
            },
            ...(refinement.mask
              ? [
                  {
                    name: "mask",
                    offset:
                      volume.byteLength +
                      refinement.keys.byteLength +
                      refinement.values.byteLength +
                      refinement.materials.byteLength,
                    length: refinement.mask.byteLength,
                  },
                ]
              : []),
          ],
          offsetOrigin: "start of binary payload after JSON",
        }
      : null,
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const prefix = new Uint32Array([0x46534446, json.length]);
  return new Blob(
    [
      prefix,
      json,
      volume,
      ...(refinement
        ? [
            refinement.keys,
            refinement.values,
            refinement.materials,
            ...(refinement.mask ? [refinement.mask] : []),
          ]
        : []),
    ],
    { type: "application/octet-stream" },
  );
}
