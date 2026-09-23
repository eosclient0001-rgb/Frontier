import { terrainDomain } from "./domain.js";
import { valueNoise, terraceY } from "./volume-noise.js";

// Preset 4 is a parameterized XYZ solid, not a sampled height map.
export const terrainDefaults = {
  terrainForm: 0,
  terrainNoise: 3,
  terrainWidth: 36,
  terrainLength: 32,
  terrainHeight: 14,
  terrainAmplitude: 3.2,
  terrainScale: 8,
  terrainOctaves: 4,
  terrainGain: 0.5,
  terrainLacunarity: 2,
  terrainWarp: 0.35,
  terrainHeading: 20,
  terrainTerraceHeight: 1.2,
  terrainTerraces: 0,
  terrainSeed: 4821,
};
export const terrainLimits = {
  terrainForm: [0, 2, 1],
  terrainNoise: [0, 4, 1],
  terrainWidth: [12, 2000, 1],
  terrainLength: [12, 2000, 1],
  terrainHeight: [4, 500, 0.5],
  terrainAmplitude: [0, 120, 0.1],
  terrainScale: [2, 400, 0.5],
  terrainOctaves: [1, 5, 1],
  terrainGain: [0.2, 0.8, 0.05],
  terrainLacunarity: [1.4, 3, 0.1],
  terrainWarp: [0, 1.5, 0.05],
  terrainHeading: [0, 180, 5],
  terrainTerraceHeight: [0.4, 30, 0.1],
  terrainTerraces: [0, 1, 0.05],
  terrainSeed: [1, 99999, 1],
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function normalizeTerrain(p = {}) {
  return Object.fromEntries(
    Object.entries(terrainDefaults).map(([key, fallback]) => {
      const [lo, hi, step] = terrainLimits[key];
      const value = Number(p[key] ?? fallback);
      const safe = clamp(Number.isFinite(value) ? value : fallback, lo, hi);
      return [
        key,
        Number((lo + Math.round((safe - lo) / step) * step).toFixed(5)),
      ];
    }),
  );
}
export const terrainNames = ["Mountain massif", "Ridge range", "Rounded hills"];
// Musgrave-style ridges: square the inverted absolute signal; the previous
// octave modulates the next. Independent implementation using our seeded XYZ
// lattice, with octave wavelengths bounded by this editor's voxel resolution.
export function createTerrainNoise(settings = {}) {
  const p = normalizeTerrain(settings),
    type = p.terrainNoise,
    seed = p.terrainSeed,
    minWavelength = settings.worldEnabled
      ? 2 * Math.max(...terrainDomain(settings).cell)
      : 0.7;
  return (x, y, z) => {
    if (type === 0) return 0;
    let q = [x / p.terrainScale, y / p.terrainScale, z / p.terrainScale];
    if (p.terrainWarp) {
      const a = valueNoise(q, seed + 101),
        b = valueNoise(
          q.map((v) => v + 17.3),
          seed + 103,
        ),
        c = valueNoise(
          q.map((v) => v - 23.7),
          seed + 107,
        );
      q = [
        q[0] + a * p.terrainWarp,
        q[1] + b * p.terrainWarp,
        q[2] + c * p.terrainWarp,
      ];
    }
    let amplitude = 1,
      frequency = 1,
      sum = 0,
      norm = 0,
      weight = 1;
    for (let i = 0; i < p.terrainOctaves; i++) {
      if (p.terrainScale / frequency < minWavelength) break;
      let signal = valueNoise(q, seed + i * 19);
      if (type === 2 || type === 3) {
        signal = (1 - Math.abs(signal)) ** 2;
        if (type === 3) {
          signal *= weight;
          weight = clamp(signal * 2, 0, 1);
        }
        signal = 2 * signal - 1;
      } else if (type === 4) signal = 2 * Math.abs(signal) - 1;
      sum += amplitude * signal;
      norm += amplitude;
      amplitude *= p.terrainGain;
      frequency *= p.terrainLacunarity;
      q = q.map((v) => v * p.terrainLacunarity);
    }
    return sum / Math.max(norm, 1e-8);
  };
}
function box(x, y, z, rx, ry, rz) {
  const a = Math.abs(x) - rx,
    b = Math.abs(y) - ry,
    c = Math.abs(z) - rz;
  return (
    Math.hypot(Math.max(a, 0), Math.max(b, 0), Math.max(c, 0)) +
    Math.min(Math.max(a, b, c), 0)
  );
}
// Distance to a capped cone in its radial/Y plane, with a small rounded summit.
function cone(x, y, z, radius, height, zScale) {
  const qx = Math.hypot(x, z * zScale),
    qy = y - height * 0.5,
    h = height * 0.5,
    tip = 0.25;
  const ax = qx - Math.min(qx, qy < 0 ? radius : tip),
    ay = Math.abs(qy) - h;
  const kx = tip - radius,
    ky = height,
    t = clamp(((tip - qx) * kx + (h - qy) * ky) / (kx * kx + ky * ky), 0, 1);
  const bx = qx - tip + kx * t,
    by = qy - h + ky * t;
  return (
    (bx < 0 && ay < 0 ? -1 : 1) *
    Math.sqrt(Math.min(ax * ax + ay * ay, bx * bx + by * by))
  );
}
function union(a, b, k) {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
}
export function createNoiseTerrain(settings = {}) {
  const p = normalizeTerrain(settings),
    noise = createTerrainNoise({ ...settings, ...p });
  const angle = (p.terrainHeading * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const span = Math.min(p.terrainWidth, p.terrainLength),
    radius = span * 0.43;
  const peaks =
    p.terrainForm === 1
      ? [-1, 0, 1].map((v, i) => ({
          x: v * span * 0.22,
          z: valueNoise([i + 3.7, 0, 1.4], p.terrainSeed) * span * 0.14,
          height:
            p.terrainHeight *
            (i === 1
              ? 1
              : 0.65 + 0.15 * valueNoise([i, 8.2, 0], p.terrainSeed)),
        }))
      : [{ x: 0, z: 0, height: p.terrainHeight }];
  return (x, y, z) => {
    const bounds = Math.max(
      Math.abs(x) - p.terrainWidth * 0.5,
      Math.abs(z) - p.terrainLength * 0.5,
      -Math.max(3.2, p.terrainHeight * 0.08) - y,
      y - Math.max(20.5, p.terrainHeight + p.terrainAmplitude),
    );
    // Noise cannot change a point already outside this hard CSG bound.
    if (bounds > p.terrainAmplitude + 2) return bounds;
    const lx = x * c - z * s,
      lz = x * s + z * c;
    const ty = terraceY(y, p.terrainTerraceHeight, p.terrainTerraces);
    let body = 1e3;
    for (const peak of peaks) {
      const r = radius * (p.terrainForm === 1 ? 0.63 : 1);
      let d;
      if (p.terrainForm === 2) {
        // Ellipsoidal mound; XYZ density still deforms its walls and underside.
        const a = lx / r,
          b = (ty + 1) / peak.height,
          e = lz / (r * 0.83);
        d = (Math.hypot(a, b, e) - 1) * Math.min(r, peak.height);
      } else
        d = cone(
          lx - peak.x,
          ty,
          lz - peak.z,
          r,
          peak.height,
          p.terrainForm === 1 ? 1.25 : p.terrainWidth / p.terrainLength,
        );
      body = union(body, d, 1.1);
    }
    // Preserve the summit envelope while allowing true XYZ cuts on the flanks.
    const envelope = Math.max(0, 1 - (Math.max(y, 0) / p.terrainHeight) ** 3);
    body -= p.terrainAmplitude * envelope * noise(lx, y * 0.55, lz);
    // A bounded bed keeps the formation rooted, even when noise cuts undercuts.
    const bed =
      box(
        x,
        y + Math.max(1, p.terrainHeight * 0.035),
        z,
        p.terrainWidth * 0.5 - 0.45,
        Math.max(0.7, p.terrainHeight * 0.03),
        p.terrainLength * 0.5 - 0.45,
      ) - 0.3;
    const solid = union(body, bed, 0.45);
    return Math.max(
      solid / (1 + Math.min(1.5, p.terrainAmplitude / p.terrainScale)),
      bounds,
    );
  };
}
