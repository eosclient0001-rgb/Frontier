import { localPoint } from "./shapes.js";
import { fractalNoise, terraceY } from "./volume-noise.js";
import { canyonDefaults, canyonCenter, canyonBaseHalfWidth } from "./canyon.js";
import { waterDefaults } from "./water.js";
// A bounded 3D signed-distance volume. Negative values are solid rock.
// Every operation works in XYZ, including undercuts, caves and additive sculpting.
export const SIZE = [112, 72, 112];
export const MIN = [-22, -4, -20];
export const MAX = [22, 22, 20];
export const CELL = SIZE.map((n, i) => (MAX[i] - MIN[i]) / n);
export const defaults = {
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
  plotWidth: 38,
  plotLength: 34,
  plotHeight: 2.5,
  heightStrength: 0.25,
  showTerrain: true,
  sceneObjects: [],
  ...canyonDefaults,
  ...waterDefaults,
  fractureDetails: [],
  cellFractureDetail: null,
  relief: 12,
  strata: 0.65,
  roughness: 0.48,
  seed: 4821,
  preset: 0,
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
  footprint: 0.85,
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
      Math.abs(x) - 21,
      Math.abs(y - 8.8) - 12.1,
      Math.abs(z) - 19,
    );
  }
  const s = p.seed | 0;
  const n = noise(x * 0.19, y * 0.095, z * 0.19, s);
  const n2 = noise(x * 0.51, y * 0.31, z * 0.51, s + 31);
  const relief = p.relief;
  const layers =
    p.strata *
    (0.16 * Math.sin(y * 3.5 + 0.35 * n) +
      0.28 * Math.sin(y * 1.7) +
      0.12 * Math.sin(y * 8));
  const fluting = noise(x * 0.85, y * 0.065, z * 0.85, s + 45);
  const rough =
    p.roughness * ((n - 0.5) * 3.5 + (n2 - 0.5) * 1.1 + (fluting - 0.5) * 1.4);
  let d;
  if (p.preset === 2) {
    d = 100;
    const towers = [
      [-10, -5, 4.0, 3.8, 1],
      [7, 1, 4.1, 4.0, 0.93],
      [-4, 9, 3.1, 3.7, 0.72],
      [11, -10, 2.4, 2.5, 0.75],
      [-13, 9, 1.8, 2.1, 0.55],
    ];
    for (const [cx, cz, bx, bz, h] of towers) {
      const top = relief * h;
      const taper = 0.1 * y;
      const m =
        box(
          x - cx,
          y - top * 0.5,
          z - cz,
          bx - taper,
          top * 0.5 - 1,
          bz - taper,
          0.8,
        ) +
        rough +
        layers;
      d = Math.min(d, m);
    }
  } else if (p.preset === 1) {
    const ridges =
      2.0 * Math.abs(Math.sin(x * 0.24 + z * 0.17)) +
      1.8 * Math.abs(Math.sin(z * 0.28 - x * 0.12));
    const top =
      2.0 + relief * (0.25 + 0.55 * noise(x * 0.15, 1, z * 0.15, s)) - ridges;
    d =
      Math.max(box(x, y - 2, z, 17.5, 7, 14.5, 1.3), y - top) +
      rough +
      layers * 0.4;
    // Horizontal weathering pockets remain volumetric, not displaced height samples.
    const hollow =
      Math.hypot((x + 6) * 0.7, (y - 2.1) * 1.6, (z - 1) * 0.9) - 2.2;
    d = Math.max(d, -hollow);
  } else {
    const edge = noise(x * 0.14, 0, z * 0.14, s + 4);
    const top =
      relief +
      3.2 * noise(x * 0.23, 0, z * 0.23, s + 10) +
      0.9 * noise(x * 0.7, 0, z * 0.7, s);
    const outer =
      box(
        x,
        y - 5,
        z,
        15.5 - Math.max(y, 0) * 0.1,
        10,
        12.9 - Math.max(y, 0) * 0.055,
        2.0,
      ) +
      (edge - 0.5) * 5;
    d = Math.max(outer, y - top);
    const center = canyonCenter(z, p);
    const width =
      canyonBaseHalfWidth(y, p) +
      0.85 * Math.sin(z * 0.57) +
      0.85 * noise(0, y * 0.4, z * 0.5, s);
    const channel = Math.max(Math.abs(x - center) - width, 0.12 - y);
    d = Math.max(d, -channel);
    d += rough + layers;
    // An undercut and side cave: the representation is genuinely 3D.
    const cave =
      Math.hypot((x + 5.9) * 0.72, (y - 3.2) * 1.25, (z - 7) * 0.6) - 2.9;
    d = Math.max(d, -cave);
    const alcove =
      Math.hypot((x - 5) * 0.85, (y - 5) * 1.5, (z + 5) * 0.66) - 2.1;
    d = Math.max(d, -alcove);
  }
  // Thin, bounded sandstone bed; rounded edges, no infinite world generation.
  const bed =
    box(x, y + 0.9, z, 18.7, 0.45, 16.7, 1.05) +
    0.14 * noise(x * 0.8, 0, z * 0.8, s);
  return Math.min(d, bed);
}
export function generateVolume(p) {
  const [nx, ny, nz] = SIZE;
  const a = new Float32Array(nx * ny * nz * 4);
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i = ((z * ny + y) * nx + x) * 4;
        a[i] = baseSDF(
          MIN[0] + (x + 0.5) * CELL[0],
          MIN[1] + (y + 0.5) * CELL[1],
          MIN[2] + (z + 0.5) * CELL[2],
          p,
        );
        a[i + 3] = clamp(0.5 - a[i] / 0.64, 0, 1);
      }
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
    far = 150;
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
    if (d < 0.075) return pos;
    t += Math.max(0.04, d * 0.6);
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
        out[i + 3] = clamp(0.5 - out[i] / 0.64, 0, 1);
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
export function encodeScene(volume, settings, camera, iterations) {
  const header = {
    format: "frontier-sdf",
    version: 2,
    dimensions: SIZE,
    bounds: { min: MIN, max: MAX },
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
    materialLayersIncluded: false,
    fractureDetailsIncluded: true,
    liveModifierBaseIncluded: false,
    particleTimeStep: 0.04,
    materialAccounting: "voxel solid fraction; not exact isosurface volume",
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const prefix = new Uint32Array([0x46534446, json.length]);
  return new Blob([prefix, json, volume], { type: "application/octet-stream" });
}
