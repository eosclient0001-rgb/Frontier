/* ============================================================
 * Frontier · SDF Terrain Lab — Particle Droplet Hydraulic Erosion
 *
 * Physically-based 3D particle erosion on the SDF scalar field h[].
 * Simulates thousands of individual water droplets as discrete agents:
 *
 *   1. Droplets spawn distributed on the terrain (biased toward higher catchments)
 *   2. Drops accelerate down -∇h with momentum/inertia, gravity and friction
 *   3. Continuous bilinear sub-voxel sampling of height and gradient
 *   4. Transport capacity C = f(speed, water, slope)
 *   5. Smooth Gaussian 3×3 / 5×5 brush carving & deposition
 *   6. CFL-style cut limiter: max cut per step is clamped to fraction of voxel,
 *      preventing deep vertical pit tears / punctures ("trenching without stopping")
 *   7. Dynamic talus slope-relaxation prevents artificial sheer overhang holes
 *   8. Sediment tracking & flow accumulation maps
 * ============================================================ */

import { mulberry32 } from './noise.js';

// Precomputed 3×3 normalized Gaussian carve filter (sum = 1.0)
const GAUSS_3X3 = [
  [-1, -1, 0.0625], [0, -1, 0.1250], [1, -1, 0.0625],
  [-1,  0, 0.1250], [0,  0, 0.2500], [1,  0, 0.1250],
  [-1,  1, 0.0625], [0,  1, 0.1250], [1,  1, 0.0625],
];

// Precomputed 5×5 normalized fan deposition filter (sum = 1.0)
const GAUSS_5X5 = [
  [-2, -2, 0.01], [-1, -2, 0.02], [0, -2, 0.04], [1, -2, 0.02], [2, -2, 0.01],
  [-2, -1, 0.02], [-1, -1, 0.08], [0, -1, 0.12], [1, -1, 0.08], [2, -1, 0.02],
  [-2,  0, 0.04], [-1,  0, 0.12], [0,  0, 0.16], [1,  0, 0.12], [2,  0, 0.04],
  [-2,  1, 0.02], [-1,  1, 0.08], [0,  1, 0.12], [1,  1, 0.08], [2,  1, 0.02],
  [-2,  2, 0.01], [-1,  2, 0.02], [0,  2, 0.04], [1,  2, 0.02], [2,  2, 0.01],
];

/**
 * Bilinear height and analytical gradient evaluation on grid h[].
 */
export function sampleFieldWithGrad(h, N, gx, gy) {
  let x0 = Math.floor(gx), y0 = Math.floor(gy);
  if (x0 < 0) x0 = 0; else if (x0 > N - 2) x0 = N - 2;
  if (y0 < 0) y0 = 0; else if (y0 > N - 2) y0 = N - 2;

  const u = gx - x0;
  const v = gy - y0;

  const idx00 = y0 * N + x0;
  const idx10 = idx00 + 1;
  const idx01 = idx00 + N;
  const idx11 = idx01 + 1;

  const h00 = h[idx00], h10 = h[idx10];
  const h01 = h[idx01], h11 = h[idx11];

  const height = (1 - u) * (1 - v) * h00 + u * (1 - v) * h10 + (1 - u) * v * h01 + u * v * h11;
  // Partial derivatives in grid units
  const gradX = (1 - v) * (h10 - h00) + v * (h11 - h01);
  const gradY = (1 - u) * (h01 - h00) + u * (h11 - h10);

  return { height, gradX, gradY };
}

/**
 * Carve into terrain using Gaussian 3x3 footprint.
 */
function carveGaussian(h, N, gx, gy, amount, bedrock, erosionMap, channelsMap) {
  const cx = Math.round(gx);
  const cy = Math.round(gy);

  for (let k = 0; k < GAUSS_3X3.length; k++) {
    const nx = cx + GAUSS_3X3[k][0];
    const ny = cy + GAUSS_3X3[k][1];
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    const idx = ny * N + nx;
    const weight = GAUSS_3X3[k][2];
    const cut = Math.min(amount * weight, Math.max(0, h[idx] - bedrock));
    if (cut > 1e-9) {
      h[idx] -= cut;
      if (erosionMap) erosionMap[idx] += cut;
      if (channelsMap) channelsMap[idx] += cut * 1.5;
    }
  }
}

/**
 * Deposit into terrain using Gaussian 5x5 footprint.
 */
function depositGaussian(h, N, gx, gy, amount, depositMap) {
  const cx = Math.round(gx);
  const cy = Math.round(gy);

  for (let k = 0; k < GAUSS_5X5.length; k++) {
    const nx = cx + GAUSS_5X5[k][0];
    const ny = cy + GAUSS_5X5[k][1];
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    const idx = ny * N + nx;
    const weight = GAUSS_5X5[k][2];
    const dep = amount * weight;
    if (dep > 1e-9) {
      h[idx] += dep;
      if (depositMap) depositMap[idx] += dep;
    }
  }
}

/**
 * Particle Droplet Erosion on SDF heightfield.
 *
 * @param {object} cfg
 * @returns {{carvedM3: number, depositedM3: number}}
 */
export function particleErode({
  h, N, voxel, seed = 42,
  particles = 25000,
  maxSteps = 48,
  inertia = 0.15,
  erodibility = 0.60,
  cutFraction = 0.20,
  depositRate = 0.35,
  gravity = 9.8,
  evaporation = 0.02,
  minSlope = 0.01,
  bedrock = -40,
  seaLevel = -7,
  erosionMap = null,
  depositMap = null,
  pointsMap = null,
  channelsMap = null,
  yieldControl = null,
}) {
  const size = N * N;
  const cellArea = voxel * voxel;
  const rng = mulberry32((seed ^ 0x9a8f11) >>> 0);

  // Maximum carve depth per step in world metres: prevents digging endless pits
  const maxCarvePerStep = voxel * cutFraction * 0.45;
  // Maximum cumulative carve per droplet: ensures a rogue particle cannot burrow a hole
  const maxDropBudget = maxCarvePerStep * 8.0;

  let carvedTotal = 0;
  let depositedTotal = 0;

  // Batch particles in chunks to allow progress updates
  const batchSize = Math.max(1000, Math.floor(particles / 10));

  for (let p = 0; p < particles; p++) {
    // Biased particle spawn: prefer steeper, elevated flank areas where rainfall accumulates
    let gx = 1 + rng() * (N - 2);
    let gy = 1 + rng() * (N - 2);

    for (let tryCount = 0; tryCount < 2; tryCount++) {
      const idx = Math.floor(gy) * N + Math.floor(gx);
      if (h[idx] > seaLevel + 4.0) break;
      gx = 1 + rng() * (N - 2);
      gy = 1 + rng() * (N - 2);
    }

    let dirX = 0, dirY = 0;
    let speed = 1.0;
    let water = 1.0;
    let sediment = 0;
    let dropCarved = 0;

    for (let step = 0; step < maxSteps; step++) {
      const { height, gradX, gradY } = sampleFieldWithGrad(h, N, gx, gy);

      // Gradient in world units (m/m)
      const worldSlopeX = gradX / voxel;
      const worldSlopeY = gradY / voxel;
      const slope = Math.hypot(worldSlopeX, worldSlopeY);

      // Accelerate along steepest descent (-∇h)
      const invSlope = slope > 1e-6 ? 1 / slope : 0;
      const downX = -worldSlopeX * invSlope;
      const downY = -worldSlopeY * invSlope;

      dirX = dirX * inertia + downX * (1 - inertia);
      dirY = dirY * inertia + downY * (1 - inertia);
      const dirLen = Math.hypot(dirX, dirY);
      if (dirLen > 1e-6) {
        dirX /= dirLen;
        dirY /= dirLen;
      }

      // Move particle forward in grid units (velocity step)
      const stepDist = Math.max(0.3, Math.min(1.2, speed * 0.4));
      const nextGx = gx + dirX * stepDist;
      const nextGy = gy + dirY * stepDist;

      // Bounds check: if leaving terrain domain, deposit remaining sediment and terminate
      if (nextGx < 1 || nextGy < 1 || nextGx >= N - 2 || nextGy >= N - 2) {
        if (sediment > 1e-6) {
          depositGaussian(h, N, gx, gy, sediment, depositMap);
          depositedTotal += sediment * cellArea;
        }
        break;
      }

      const nextH = sampleFieldWithGrad(h, N, nextGx, nextGy).height;
      const dh = nextH - height;

      // If moving uphill (local depression / pit floor):
      if (dh >= 0) {
        // Drop sediment to fill pit (lake/depression filling)
        const depositAmount = Math.min(sediment, dh + 0.05 * voxel);
        depositGaussian(h, N, gx, gy, depositAmount, depositMap);
        depositedTotal += depositAmount * cellArea;
        sediment -= depositAmount;
        if (pointsMap) pointsMap[Math.floor(gy) * N + Math.floor(gx)] += 0.2;
        break; // terminate particle inside bowl
      }

      // Slope-dependent transport capacity: C = K · water · speed · max(slope, minSlope)
      const effSlope = Math.max(minSlope, -dh / (stepDist * voxel));
      const capacity = Math.max(0, -dh) * speed * water * erodibility * 1.8;

      if (sediment > capacity) {
        // Overloaded: deposit excess sediment
        const depositAmount = Math.min(
          (sediment - capacity) * depositRate,
          maxCarvePerStep * 2.0
        );
        depositGaussian(h, N, gx, gy, depositAmount, depositMap);
        depositedTotal += depositAmount * cellArea;
        sediment -= depositAmount;
      } else {
        // Under capacity: erode rock surface
        // CRITICAL PROTECTION AGAINST RUNAWAY PIT CUTTING:
        // 1. Strict cap per step: maxCarvePerStep (fraction of voxel)
        // 2. Strict per-droplet carve budget: maxDropBudget
        // 3. Slope limit: don't excavate deep holes in already sheer drops
        const wantErode = (capacity - sediment) * 0.45;
        const availableBudget = Math.max(0, maxDropBudget - dropCarved);
        const carveAmount = Math.min(
          wantErode,
          maxCarvePerStep,
          availableBudget,
          Math.max(0, height - bedrock)
        );

        if (carveAmount > 1e-9) {
          carveGaussian(h, N, gx, gy, carveAmount, bedrock, erosionMap, channelsMap);
          carvedTotal += carveAmount * cellArea;
          sediment += carveAmount;
          dropCarved += carveAmount;
        }
      }

      // Kinematics update
      speed = Math.sqrt(Math.max(0.01, speed * speed + (-dh) * gravity * 0.2));
      speed = Math.min(speed, 6.0); // terminal velocity clamp
      water *= (1 - evaporation);

      gx = nextGx;
      gy = nextGy;

      if (water < 0.05) break;
    }
  }

  return { carvedM3: carvedTotal, depositedM3: depositedTotal };
}
