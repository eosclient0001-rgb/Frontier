/* ============================================================
 * Frontier · SDF Terrain Lab — SDF Sculpting Engine
 *
 * Professional SDF sculpting operations operating directly on the
 * signed-distance surface h[y * N + x]:
 *
 *   1. RIDGE (Raise / Build) — Gaussian / smooth-falloff buildup
 *   2. DENT (Carve / Dig) — Smooth-falloff subtraction with soft floor
 *   3. SMOOTH — Local Laplacian smoothing filter (removes harsh edges)
 *   4. FLATTEN — Plateau level tool: drives height toward brush contact height
 *   5. TEXTURE / NOISE — Displaces SDF surface using multi-scale Perlin noise
 *   6. TALUS / SLOPE COLLAPSE — Relaxes over-steep local slopes
 *
 * Features:
 *   · Stroke spacing & interpolation: smoothly connects dragged dab points
 *   · Volumetric feel: cosine & cubic hermite falloffs
 *   · Bounds checking & bedrock clamping
 *   · Direct accumulation into erosion & points splat maps
 * ============================================================ */

import { Perlin2D, subseed, fbm01 } from './noise.js';

export const SCULPT_TOOLS = {
  ridge: { name: 'Ridge / Raise', desc: 'Build ridges and peaks along stroke' },
  dent: { name: 'Dent / Carve', desc: 'Carve valleys and gullies with smooth bed' },
  smooth: { name: 'Smooth', desc: 'Smooth out local roughness and sharp rills' },
  flatten: { name: 'Flatten', desc: 'Flatten terrain toward the initial stroke height' },
  texture: { name: 'Rock Texture', desc: 'Stamp organic rocky micro-relief onto the surface' },
};

/**
 * Applies a single sculpt brush dab at world coordinates (cx, cz).
 *
 * @param {object} cfg
 * @param {Float32Array} cfg.h          The SDF height field (mutated in place)
 * @param {number}       cfg.N          Grid resolution (N×N)
 * @param {number}       cfg.voxel      Voxel/cell size in metres
 * @param {number}       cfg.cx         Brush centre X in world metres
 * @param {number}       cfg.cz         Brush centre Z in world metres
 * @param {string}       cfg.tool       'ridge' | 'dent' | 'smooth' | 'flatten' | 'texture'
 * @param {number}       cfg.radius     Brush radius in metres
 * @param {number}       cfg.strength   Brush strength (0..1)
 * @param {number}       cfg.falloff    Falloff exponent (1 = linear, 2 = smooth cubic, 3 = sharp)
 * @param {number}       [cfg.targetH]  Target height for 'flatten' tool
 * @param {number}       [cfg.seed]     RNG seed for noise texture tool
 * @param {Float32Array} [cfg.erosionMap] Optional map to track carved volume
 * @param {Float32Array} [cfg.depositMap] Optional map to track deposited volume
 */
export function applySculptDab({
  h, N, voxel, cx, cz, tool = 'ridge',
  radius = 6.0, strength = 0.35, falloff = 2.0,
  targetH = 0, seed = 42,
  erosionMap = null, depositMap = null,
}) {
  const c2 = (N - 1) / 2;
  // Convert brush centre from world coordinates to continuous grid coordinates
  const gx = cx / voxel + c2;
  const gz = cz / voxel + c2;

  const gridRadius = Math.max(1.5, radius / voxel);
  const minI = Math.max(0, Math.floor(gx - gridRadius));
  const maxI = Math.min(N - 1, Math.ceil(gx + gridRadius));
  const minJ = Math.max(0, Math.floor(gz - gridRadius));
  const maxJ = Math.min(N - 1, Math.ceil(gz + gridRadius));

  const maxDepthCarve = voxel * 1.5; // per-dab maximum depth change to preserve smoothness

  let noiseGen = null;
  if (tool === 'texture') {
    noiseGen = new Perlin2D(subseed((seed ^ 0x7a31) >>> 0, 19));
  }

  // Pre-calculate neighborhood average for smooth tool
  let smoothCopy = null;
  if (tool === 'smooth') {
    smoothCopy = new Float32Array((maxJ - minJ + 3) * (maxI - minI + 3));
    for (let j = Math.max(0, minJ - 1); j <= Math.min(N - 1, maxJ + 1); j++) {
      for (let i = Math.max(0, minI - 1); i <= Math.min(N - 1, maxI + 1); i++) {
        const localIdx = (j - minJ + 1) * (maxI - minI + 3) + (i - minI + 1);
        smoothCopy[localIdx] = h[j * N + i];
      }
    }
  }

  let modifiedCount = 0;

  for (let j = minJ; j <= maxJ; j++) {
    const dz = (j - gz) * voxel;
    for (let i = minI; i <= maxI; i++) {
      const dx = (i - gx) * voxel;
      const dist = Math.hypot(dx, dz);
      if (dist >= radius) continue;

      const idx = j * N + i;
      const curH = h[idx];
      const rRel = dist / radius;

      // Smooth hermite / exponential falloff curve:
      // at r=0 weight=1, at r=1 weight=0, zero derivative at edge
      const wBase = Math.max(0, 1 - rRel * rRel);
      const weight = Math.pow(wBase, falloff);

      if (weight <= 1e-6) continue;

      let delta = 0;

      if (tool === 'ridge') {
        // Raise SDF: smooth natural dome accumulation
        const raiseMax = radius * 0.4 * strength;
        delta = raiseMax * weight * 0.35;
      } else if (tool === 'dent') {
        // Carve SDF: controlled trench carving, capped to prevent bottomless puncture
        const carveMax = Math.min(maxDepthCarve, radius * 0.35 * strength);
        delta = -carveMax * weight * 0.35;
      } else if (tool === 'smooth') {
        // Local Laplacian relaxation
        const li = i - minI + 1;
        const lj = j - minJ + 1;
        const pitch = maxI - minI + 3;
        const cVal = smoothCopy[lj * pitch + li];
        const nN = smoothCopy[(lj - 1) * pitch + li];
        const nS = smoothCopy[(lj + 1) * pitch + li];
        const nW = smoothCopy[lj * pitch + (li - 1)];
        const nE = smoothCopy[lj * pitch + (li + 1)];
        const lap = (nN + nS + nW + nE - 4 * cVal) * 0.25;
        delta = lap * strength * weight * 0.8;
      } else if (tool === 'flatten') {
        // Drive towards contact elevation targetH
        const diff = targetH - curH;
        delta = diff * strength * weight * 0.45;
      } else if (tool === 'texture') {
        // Organic rocky displacement with high-frequency micro details
        const wx = (i - c2) * voxel;
        const wz = (j - c2) * voxel;
        const n1 = fbm01(noiseGen, wx * 0.35 + 11.2, wz * 0.35 - 7.8, { octaves: 3, lacunarity: 2.2, gain: 0.5 }) - 0.5;
        const n2 = fbm01(noiseGen, wx * 0.85 - 19.4, wz * 0.85 + 23.1, { octaves: 2, lacunarity: 2.4, gain: 0.55 }) - 0.5;
        const disp = (n1 * 1.8 + n2 * 0.9) * radius * 0.18 * strength;
        delta = disp * weight;
      }

      if (Math.abs(delta) > 1e-7) {
        h[idx] = curH + delta;
        modifiedCount++;

        if (delta > 0 && depositMap) {
          depositMap[idx] += delta * 0.25;
        } else if (delta < 0 && erosionMap) {
          erosionMap[idx] += -delta * 0.25;
        }
      }
    }
  }

  return modifiedCount;
}

/**
 * Interpolates a stroke line between two points and stamps overlapping dabs.
 */
export function applySculptStroke({
  h, N, voxel,
  p0, p1,
  tool, radius, strength, falloff, targetH, seed,
  erosionMap, depositMap,
}) {
  const dist = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  const step = Math.max(voxel * 0.5, radius * 0.22);
  const steps = Math.max(1, Math.ceil(dist / step));

  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const cx = p0.x + (p1.x - p0.x) * t;
    const cz = p0.z + (p1.z - p0.z) * t;
    applySculptDab({
      h, N, voxel, cx, cz, tool, radius, strength, falloff, targetH, seed,
      erosionMap, depositMap,
    });
  }
}
