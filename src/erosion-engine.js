/**
 * GAEA-Grade Realistic Geomorphological SDF Terrain Erosion Engine
 * 
 * Implements physically coupled landscape evolution on 3D Signed Distance Fields:
 * 1. Priority-Flood continuous downhill drainage routing (zero pothole sinks)
 * 2. Multidirectional Flow Accumulation with meander turbulence
 * 3. Stream Power Law Fluvial Incision with Transverse V-Shaped Gorge & Lateral Cutbanks
 * 4. Multi-Scale Debris Chute Fluting (Avalanche Couloir scour & scree cones)
 * 5. Mechanical Joint Frost-Toppling & Angle of Repose Thermal Talus Aprons
 * 6. Dual-Phase Sediment Sorting & Braided Alluvial Fan Aggradation at slope breaks
 * 7. Multi-scale Cascaded Headwater Micro-Rills & Couloir Incision
 * 8. Sub-Voxel Knife-Edge Arête Ridge Divide Sharpening
 * 9. Volumetric 3D SDF update & Continuous Distance Normalization
 */

import { createPRNG } from "./math-noise.js";

const NEIGHBOURS_8 = [
  { dx: 1, dz: 0, dist: 1.0 },
  { dx: -1, dz: 0, dist: 1.0 },
  { dx: 0, dz: 1, dist: 1.0 },
  { dx: 0, dz: -1, dist: 1.0 },
  { dx: 1, dz: 1, dist: Math.SQRT2 },
  { dx: -1, dz: -1, dist: Math.SQRT2 },
  { dx: 1, dz: -1, dist: Math.SQRT2 },
  { dx: -1, dz: 1, dist: Math.SQRT2 },
];

/**
 * Priority-Flood (Radix/Bucket Dijkstra) depression filling
 * Guarantees continuous drainage from all peaks to boundaries.
 */
export function priorityFloodFill(heights, nx, nz) {
  const size = nx * nz;
  const fill = new Float64Array(size).fill(Infinity);
  let hMin = Infinity, hMax = -Infinity;

  for (let i = 0; i < size; i++) {
    const v = heights[i];
    if (v < hMin) hMin = v;
    if (v > hMax) hMax = v;
  }

  const BUCKETS = 2048;
  const span = Math.max(hMax - hMin, 1e-6);
  const getBucket = (v) => {
    const b = Math.floor(((v - hMin) / span) * BUCKETS);
    return Math.max(0, Math.min(BUCKETS - 1, b));
  };

  const buckets = Array.from({ length: BUCKETS }, () => []);
  const visited = new Uint8Array(size);

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      if (ix === 0 || iz === 0 || ix === nx - 1 || iz === nz - 1) {
        const idx = iz * nx + ix;
        fill[idx] = heights[idx];
        buckets[getBucket(heights[idx])].push(idx);
      }
    }
  }

  let curBucket = 0;
  while (curBucket < BUCKETS) {
    while (curBucket < BUCKETS && buckets[curBucket].length === 0) {
      curBucket++;
    }
    if (curBucket >= BUCKETS) break;

    const idx = buckets[curBucket].pop();
    if (visited[idx]) continue;
    visited[idx] = 1;

    const fillVal = fill[idx];
    const ix = idx % nx;
    const iz = Math.floor(idx / nx);

    for (let k = 0; k < 4; k++) {
      const nxPos = ix + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const nzPos = iz + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nxPos < 0 || nxPos >= nx || nzPos < 0 || nzPos >= nz) continue;

      const nIdx = nzPos * nx + nxPos;
      if (visited[nIdx]) continue;

      const nFill = Math.max(heights[nIdx], fillVal);
      if (nFill < fill[nIdx]) {
        fill[nIdx] = nFill;
        buckets[getBucket(nFill)].push(nIdx);
      }
    }
  }

  return fill;
}

/**
 * Multidirectional (MFD / D-Infinity) Flow Accumulation on the depression-filled surface
 */
export function computeDrainageFlow(heights, filled, nx, nz, voxelSize, rng, meanderAmp = 0.35) {
  const size = nx * nz;
  const flow = new Float64Array(size).fill(1.0);
  const flowDown = new Array(size);
  const flowDir = new Float32Array(size * 2); // 2D unit vector of flow
  for (let i = 0; i < size; i++) flowDown[i] = [];

  const order = new Uint32Array(size);
  for (let i = 0; i < size; i++) order[i] = i;
  order.sort((a, b) => (filled[b] - filled[a]) || (heights[b] - heights[a]));

  const meanderField = new Float32Array(size);
  for (let i = 0; i < size; i++) meanderField[i] = (rng() - 0.5) * 2.0;

  for (let oi = 0; oi < size; oi++) {
    const idx = order[oi];
    const ix = idx % nx;
    const iz = Math.floor(idx / nx);
    const curH = filled[idx];

    let totalWeight = 0;
    const targets = [];

    const meanderPhase = meanderField[idx] * Math.PI * meanderAmp;
    let netDirX = 0, netDirZ = 0;

    for (let k = 0; k < 8; k++) {
      const nb = NEIGHBOURS_8[k];
      const nix = ix + nb.dx;
      const niz = iz + nb.dz;
      if (nix < 0 || nix >= nx || niz < 0 || niz >= nz) continue;

      const nIdx = niz * nx + nix;
      const nH = filled[nIdx];
      const drop = curH - nH;

      if (drop > 1e-6) {
        const angle = Math.atan2(nb.dz, nb.dx);
        const meanderFactor = 1.0 + 0.35 * Math.cos(angle - meanderPhase);
        const slope = (drop / (nb.dist * voxelSize)) * meanderFactor;
        const weight = Math.pow(slope, 1.3);
        totalWeight += weight;
        targets.push({ nIdx, weight, dist: nb.dist * voxelSize, drop, dx: nb.dx, dz: nb.dz });

        netDirX += nb.dx * weight;
        netDirZ += nb.dz * weight;
      }
    }

    const dirLen = Math.hypot(netDirX, netDirZ);
    if (dirLen > 1e-5) {
      flowDir[idx * 2] = netDirX / dirLen;
      flowDir[idx * 2 + 1] = netDirZ / dirLen;
    }

    if (totalWeight > 0) {
      for (const t of targets) {
        const fraction = t.weight / totalWeight;
        const passedFlow = flow[idx] * fraction;
        flow[t.nIdx] += passedFlow;
        flowDown[idx].push({ nIdx: t.nIdx, fraction, slope: t.drop / t.dist, dx: t.dx, dz: t.dz });
      }
    }
  }

  return { flow, flowDown, flowDir, order };
}

/**
 * Full Geomorphological Erosion Solver
 */
export class ErosionEngine {
  constructor(volume) {
    this.volume = volume;
  }

  async runPipeline(params = {}, onProgress = null) {
    const defaultParams = {
      seed: 1337,
      iterations: 32,
      fluvialK: 0.050,          // Stream power incision rate
      mExp: 0.52,               // Area exponent
      nExp: 1.15,               // Slope exponent
      gorgeVNotch: 1.8,         // V-profile canyon incision strength
      valleyRadiusCoeff: 2.6,   // Transverse valley gorge width
      meanderCutbank: 0.65,     // Lateral stream meander undercutting
      reposeAngleDeg: 34.0,     // Rock angle of repose
      talusAngleDeg: 30.0,      // Scree talus angle of repose
      talusRate: 0.35,          // Thermal mass wasting rate
      jointTopple: 0.45,        // Mechanical joint block toppling
      debrisFluting: 0.70,      // Couloir chute fluting & talus cones
      strataEtch: 0.0,          // Disabled by default
      alluvialCap: 0.05,        // Sediment transport capacity coeff
      alluvialSpread: 0.65,     // Braided alluvial fan lateral deposition
      microRills: 0.65,         // Fine headwater rill & couloir intensity
      areteSharpen: 0.75,       // Knife-edge arête divide sharpening
      passes: {
        fluvial: true,
        thermalTalus: true,
        debrisFluting: true,
        strataEtch: false,
        alluvialFans: true,
        microRills: true,
        areteSharpen: true,
      },
    };

    const config = { ...defaultParams, ...params };
    const rng = createPRNG(config.seed);

    const nx = this.volume.nx;
    const nz = this.volume.nz;
    const size = nx * nz;
    const voxel = this.volume.dx;
    const cellArea = voxel * this.volume.dz;

    let surf = this.volume.extractSurfaceGrid();
    const h = surf.height;
    const hard = surf.hardness;
    const currentH = Float64Array.from(h);

    const erosionMap = new Float32Array(size);
    const depositMap = new Float32Array(size);
    const talusMap = new Float32Array(size);
    const rillMap = new Float32Array(size);
    const flowMap = new Float32Array(size);

    let totalCarvedM3 = 0;
    let totalDepositedM3 = 0;

    const reposeSlope = Math.tan((config.reposeAngleDeg * Math.PI) / 180);
    const talusSlope = Math.tan((config.talusAngleDeg * Math.PI) / 180);

    const totalIters = config.iterations;

    for (let it = 0; it < totalIters; it++) {
      const filled = priorityFloodFill(currentH, nx, nz);
      const { flow, flowDown, flowDir, order } = computeDrainageFlow(currentH, filled, nx, nz, voxel, rng);

      if (it === totalIters - 1) {
        for (let i = 0; i < size; i++) flowMap[i] = flow[i];
      }

      // Dual-phase sediment: coarse gravel vs fine silt
      const sedimentLoadCoarse = new Float64Array(size);
      const sedimentLoadFine = new Float64Array(size);

      // ----------------------------------------------------------------------
      // PASS 1: Fluvial Stream Power Incision, V-Gorge & Lateral Cutbanks
      // ----------------------------------------------------------------------
      if (config.passes.fluvial) {
        for (let oi = 0; oi < size; oi++) {
          const idx = order[oi];
          const ix = idx % nx;
          const iz = Math.floor(idx / nx);
          const curH = currentH[idx];

          if (curH <= this.volume.boundsMin[1] + 0.5) continue;

          const targets = flowDown[idx];
          if (!targets || targets.length === 0) continue;

          let meanSlope = 0;
          for (const t of targets) meanSlope += t.slope * t.fraction;
          if (meanSlope <= 0) continue;

          const A = flow[idx] * cellArea;
          const rockH = hard[idx] || 1.0;

          const hardnessFactor = config.passes.strataEtch && config.strataEtch > 0
            ? 1.0 / Math.pow(Math.max(0.4, rockH), config.strataEtch)
            : 1.0;

          // Stream power incision
          let incision =
            config.fluvialK *
            Math.pow(A, config.mExp) *
            Math.pow(meanSlope, config.nExp) *
            hardnessFactor *
            voxel *
            0.20;

          const cutCap = voxel * 0.45;
          incision = Math.min(cutCap, incision);

          if (incision > 1e-6) {
            currentH[idx] -= incision;
            erosionMap[idx] += incision;
            totalCarvedM3 += incision * cellArea;

            // Transverse V-Gorge Carving & Lateral Meander Cutbank Undercutting
            if (config.gorgeVNotch > 0 && A > 4.0 * cellArea) {
              const valleyRadius = Math.min(
                voxel * 6.5,
                config.valleyRadiusCoeff * Math.pow(A / cellArea, 0.35) * voxel
              );
              const gridRadius = Math.ceil(valleyRadius / voxel);

              // Direction of flow for outer-bank cutbank calculation
              const dirX = flowDir[idx * 2];
              const dirZ = flowDir[idx * 2 + 1];

              for (let dz = -gridRadius; dz <= gridRadius; dz++) {
                for (let dx = -gridRadius; dx <= gridRadius; dx++) {
                  if (dx === 0 && dz === 0) continue;
                  const bx = ix + dx;
                  const bz = iz + dz;
                  if (bx < 0 || bx >= nx || bz < 0 || bz >= nz) continue;

                  const dist = Math.hypot(dx * voxel, dz * voxel);
                  if (dist > valleyRadius) continue;

                  const bIdx = bz * nx + bx;
                  const bankProfile = Math.pow(1.0 - dist / valleyRadius, config.gorgeVNotch);

                  // Lateral cutbank asymmetry (centrifugal force along channel bends)
                  const crossProd = dx * dirZ - dz * dirX;
                  const meanderMod = 1.0 + config.meanderCutbank * Math.tanh(crossProd * 0.25);

                  const bankCut = incision * bankProfile * 0.45 * Math.max(0.2, meanderMod);

                  if (bankCut > 1e-6 && currentH[bIdx] > currentH[idx] + 0.1) {
                    currentH[bIdx] -= bankCut;
                    erosionMap[bIdx] += bankCut;
                    totalCarvedM3 += bankCut * cellArea;
                    sedimentLoadCoarse[idx] += bankCut * 0.30;
                    sedimentLoadFine[idx] += bankCut * 0.15;
                  }
                }
              }
            }

            // ------------------------------------------------------------------
            // PASS 2: Dual-Phase Sediment Sorting & Braided Alluvial Fans
            // ------------------------------------------------------------------
            if (config.passes.alluvialFans) {
              const incomingCoarse = sedimentLoadCoarse[idx] + incision * 0.45;
              const incomingFine = sedimentLoadFine[idx] + incision * 0.25;

              // Coarse gravel capacity: drops rapidly when slope falls below threshold
              const coarseCap = config.alluvialCap * Math.pow(A, 0.5) * Math.max(0.0, meanSlope - 0.08) * 2.5;
              // Fine silt capacity: travels further downstream
              const fineCap = config.alluvialCap * 2.0 * Math.pow(A, 0.65) * (meanSlope + 0.02);

              let depositTotal = 0;

              // 1. Gravel Aggradation (Braided Fans at slope breaks)
              if (incomingCoarse > coarseCap) {
                const excessCoarse = incomingCoarse - coarseCap;
                const depositGravel = Math.min(excessCoarse, cutCap * 0.90);
                currentH[idx] += depositGravel;
                depositMap[idx] += depositGravel;
                depositTotal += depositGravel;
                totalDepositedM3 += depositGravel * cellArea;

                // Braided lateral spreading
                if (config.alluvialSpread > 0 && excessCoarse > depositGravel) {
                  const spill = (excessCoarse - depositGravel) * config.alluvialSpread * 0.35;
                  for (let k = 0; k < 4; k++) {
                    const sx = ix + (k === 0 ? 1 : k === 1 ? -1 : 0);
                    const sz = iz + (k === 2 ? 1 : k === 3 ? -1 : 0);
                    if (sx >= 0 && sx < nx && sz >= 0 && sz < nz) {
                      const sIdx = sz * nx + sx;
                      currentH[sIdx] += spill;
                      depositMap[sIdx] += spill;
                      totalDepositedM3 += spill * cellArea;
                    }
                  }
                }

                const remCoarse = incomingCoarse - depositGravel;
                for (const t of targets) sedimentLoadCoarse[t.nIdx] += remCoarse * t.fraction;
              } else {
                for (const t of targets) sedimentLoadCoarse[t.nIdx] += incomingCoarse * t.fraction;
              }

              // 2. Fine Silt Aggradation (Lake deltas & floodplains)
              if (incomingFine > fineCap) {
                const excessFine = incomingFine - fineCap;
                const depositSilt = Math.min(excessFine, cutCap * 0.50);
                currentH[idx] += depositSilt;
                depositMap[idx] += depositSilt;
                totalDepositedM3 += depositSilt * cellArea;

                const remFine = incomingFine - depositSilt;
                for (const t of targets) sedimentLoadFine[t.nIdx] += remFine * t.fraction;
              } else {
                for (const t of targets) sedimentLoadFine[t.nIdx] += incomingFine * t.fraction;
              }
            }
          }
        }
      }

      // ----------------------------------------------------------------------
      // PASS 3: Debris Chute Fluting & Avalanche Couloir Scouring
      // ----------------------------------------------------------------------
      if (config.passes.debrisFluting && config.debrisFluting > 0) {
        for (let iz = 1; iz < nz - 1; iz++) {
          for (let ix = 1; ix < nx - 1; ix++) {
            const idx = iz * nx + ix;
            const xL = ix - 1, xR = ix + 1;
            const zU = iz - 1, zD = iz + 1;
            const dhdx = (currentH[iz * nx + xR] - currentH[iz * nx + xL]) / (2 * voxel);
            const dhdz = (currentH[zD * nx + ix] - currentH[zU * nx + ix]) / (2 * voxel);
            const slope = Math.hypot(dhdx, dhdz);

            // Steep couloir headwalls (> 38° slope, S > 0.78)
            if (slope > 0.78 && currentH[idx] > this.volume.boundsMin[1] + 12.0) {
              const chuteScour = config.debrisFluting * 0.045 * (slope - 0.78) * voxel;
              currentH[idx] -= chuteScour;
              erosionMap[idx] += chuteScour;
              totalCarvedM3 += chuteScour * cellArea;

              // Deposit at base of steep couloir (Scree Cone)
              const downX = Math.round(ix - (dhdx / slope) * 2.0);
              const downZ = Math.round(iz - (dhdz / slope) * 2.0);
              if (downX >= 0 && downX < nx && downZ >= 0 && downZ < nz) {
                const baseIdx = downZ * nx + downX;
                currentH[baseIdx] += chuteScour * 0.95;
                talusMap[baseIdx] += chuteScour * 0.95;
                totalDepositedM3 += chuteScour * 0.95 * cellArea;
              }
            }
          }
        }
      }

      // ----------------------------------------------------------------------
      // PASS 4: Mechanical Joint Frost-Toppling & Angle of Repose Talus Aprons
      // ----------------------------------------------------------------------
      if (config.passes.thermalTalus && config.talusRate > 0) {
        const tempH = Float64Array.from(currentH);

        for (let iz = 1; iz < nz - 1; iz++) {
          for (let ix = 1; ix < nx - 1; ix++) {
            const idx = iz * nx + ix;
            const curElev = tempH[idx];

            let steepestSlope = 0;
            let steepestTarget = -1;
            let steepestDist = voxel;

            for (let k = 0; k < 8; k++) {
              const nb = NEIGHBOURS_8[k];
              const nIdx = (iz + nb.dz) * nx + (ix + nb.dx);
              const dist = nb.dist * voxel;
              const drop = curElev - tempH[nIdx];
              const slope = drop / dist;

              if (slope > steepestSlope) {
                steepestSlope = slope;
                steepestTarget = nIdx;
                steepestDist = dist;
              }
            }

            if (steepestSlope > reposeSlope && steepestTarget >= 0) {
              const excessSlope = steepestSlope - reposeSlope;
              // Joint toppling accelerates breakdown on high shattered cliffs
              const jointBoost = 1.0 + config.jointTopple * (curElev > this.volume.boundsMin[1] + 18.0 ? 0.6 : 0.0);
              const transfer =
                excessSlope *
                steepestDist *
                0.22 *
                config.talusRate *
                jointBoost;

              currentH[idx] -= transfer;
              currentH[steepestTarget] += transfer;

              talusMap[steepestTarget] += transfer;
              totalCarvedM3 += transfer * cellArea;
              totalDepositedM3 += transfer * cellArea;
            }
          }
        }
      }

      // ----------------------------------------------------------------------
      // PASS 5: Multi-Scale Cascaded Micro-Rills & Headwater Couloirs
      // ----------------------------------------------------------------------
      if (config.passes.microRills && config.microRills > 0) {
        for (let iz = 1; iz < nz - 1; iz++) {
          for (let ix = 1; ix < nx - 1; ix++) {
            const idx = iz * nx + ix;
            const A = flow[idx] * cellArea;

            // Headwater couloirs & fine tributary grooves
            if (A > 1.0 * cellArea && A < 18.0 * cellArea) {
              const xL = Math.max(0, ix - 1), xR = Math.min(nx - 1, ix + 1);
              const zU = Math.max(0, iz - 1), zD = Math.min(nz - 1, iz + 1);
              const dhdx = (currentH[iz * nx + xR] - currentH[iz * nx + xL]) / (2 * voxel);
              const dhdz = (currentH[zD * nx + ix] - currentH[zU * nx + ix]) / (2 * voxel);
              const slope = Math.hypot(dhdx, dhdz);

              if (slope > 0.30) {
                const rillCut =
                  config.microRills * 0.035 * Math.pow(A / cellArea, 0.45) * Math.pow(slope, 1.2) * voxel;
                currentH[idx] -= rillCut;
                rillMap[idx] += rillCut;
                totalCarvedM3 += rillCut * cellArea;
              }
            }
          }
        }
      }

      // ----------------------------------------------------------------------
      // PASS 6: Sub-Voxel Knife-Edge Arête Divide Sharpening
      // ----------------------------------------------------------------------
      if (config.passes.areteSharpen && config.areteSharpen > 0 && it >= totalIters - 10) {
        for (let iz = 1; iz < nz - 1; iz++) {
          for (let ix = 1; ix < nx - 1; ix++) {
            const idx = iz * nx + ix;
            const xL = ix - 1, xR = ix + 1;
            const zU = iz - 1, zD = iz + 1;

            const lap =
              currentH[iz * nx + xL] +
              currentH[iz * nx + xR] +
              currentH[zU * nx + ix] +
              currentH[zD * nx + ix] -
              4.0 * currentH[idx];

            const curElev = currentH[idx];
            // Convex ridge divide
            if (lap < -0.04 * voxel && curElev > this.volume.boundsMin[1] + 8.0) {
              const dhdx = (currentH[iz * nx + xR] - currentH[iz * nx + xL]) / (2 * voxel);
              const dhdz = (currentH[zD * nx + ix] - currentH[zU * nx + ix]) / (2 * voxel);
              const slope = Math.hypot(dhdx, dhdz);

              if (slope > 0.38) {
                const sharpLift = Math.min(0.10 * voxel, -lap * 0.08 * config.areteSharpen);
                currentH[idx] += sharpLift;
              }
            }
          }
        }
      }

      if (onProgress) {
        onProgress((it + 1) / totalIters);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    const netDeltaH = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      netDeltaH[i] = currentH[i] - h[i];
    }

    this.volume.applySurfaceDelta(netDeltaH, depositMap);

    return {
      erosionMap,
      depositMap,
      talusMap,
      rillMap,
      flowMap,
      netDeltaH,
      carvedVolumeM3: totalCarvedM3,
      depositedVolumeM3: totalDepositedM3,
      netMassBalanceM3: totalCarvedM3 - totalDepositedM3,
    };
  }

  async runSinglePass(passName, params = {}) {
    const singlePassFlags = {
      fluvial: passName === "fluvial",
      thermalTalus: passName === "thermalTalus",
      debrisFluting: passName === "debrisFluting",
      strataEtch: passName === "strataEtch",
      alluvialFans: passName === "alluvialFans",
      microRills: passName === "microRills",
      areteSharpen: passName === "areteSharpen",
    };
    return this.runPipeline({ ...params, iterations: 8, passes: singlePassFlags });
  }
}
