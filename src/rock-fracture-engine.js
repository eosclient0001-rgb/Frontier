/**
 * 3D Organic Rock Cell Fracture & Sharp Planar Chipping Engine
 * 
 * Features:
 * 1. 3D Voronoi Cellular Piece Splitting (broken rock chunks of varying proportions)
 * 2. Organic Domain-Warped Crack Clefts (non-straight, wandering grain-boundary fissures)
 * 3. Sharp Planar Chipped Cuts & Conchoidal Spall Facets (sharp cutting planes slicing corners and faces)
 * 4. Depth-Tapering Aperture & Griffith Stress Intensity Tensor Fields
 */

import { NoiseGenerator, createPRNG } from "./math-noise.js";

export const FRACTURE_TYPES = {
  voronoi_cleavage: {
    id: "voronoi_cleavage",
    name: "3D Organic Cellular Fracture (Pieces)",
    description: "Breaks rock into natural organic Voronoi chunks with wandering grain-boundary clefts",
  },
  tectonic_fault: {
    id: "tectonic_fault",
    name: "Tectonic Shear Fault & Riedel Shears",
    description: "Primary fault shear fracture with secondary diagonal conjugate feathering fissures",
  },
  radial_impact: {
    id: "radial_impact",
    name: "Radial & Concentric Impact Fracture",
    description: "Impact epicenter with radiating fracture rays and concentric shock rings",
  },
  thermal_spall: {
    id: "thermal_spall",
    name: "Thermal Spalling & Exfoliation",
    description: "Curved concentric shell fractures peeling away exterior shells under thermal shock",
  },
  strata_delam: {
    id: "strata_delam",
    name: "Bedding Plane Delamination",
    description: "Splits and delamination fissures running parallel to sedimentary strata layers",
  },
};

export class RockFractureEngine {
  constructor(volumeConfig = {}) {
    this.nx = volumeConfig.nx || 80;
    this.ny = volumeConfig.ny || 80;
    this.nz = volumeConfig.nz || 80;
    this.boundsMin = volumeConfig.boundsMin || [-1.8, -1.8, -1.8];
    this.boundsMax = volumeConfig.boundsMax || [1.8, 1.8, 1.8];

    this.sx = this.boundsMax[0] - this.boundsMin[0];
    this.sy = this.boundsMax[1] - this.boundsMin[1];
    this.sz = this.boundsMax[2] - this.boundsMin[2];

    this.dx = this.sx / (this.nx - 1);
    this.dy = this.sy / (this.ny - 1);
    this.dz = this.sz / (this.nz - 1);

    this.totalVoxels = this.nx * this.ny * this.nz;
    this.crackSDF = new Float32Array(this.totalVoxels);
    this.crackMask = new Float32Array(this.totalVoxels);
    this.stressField = new Float32Array(this.totalVoxels);
    this.chipMask = new Float32Array(this.totalVoxels);
    this.pieceID = new Uint8Array(this.totalVoxels);
    this.fracturedRockSDF = new Float32Array(this.totalVoxels);
  }

  index(ix, iy, iz) {
    return (iz * this.ny + iy) * this.nx + ix;
  }

  voxelToCoord(ix, iy, iz) {
    const x = this.boundsMin[0] + (ix / (this.nx - 1)) * this.sx;
    const y = this.boundsMin[1] + (iy / (this.ny - 1)) * this.sy;
    const z = this.boundsMin[2] + (iz / (this.nz - 1)) * this.sz;
    return [x, y, z];
  }

  /**
   * Generates organic 3D fracture pieces, wandering crack clefts, and sharp planar chipped facets
   */
  generateFracture(baseRockSDF, params = {}) {
    const seed = params.seed !== undefined ? params.seed : 42;
    const rng = createPRNG(seed);
    const noise = new NoiseGenerator(seed);

    const fractureType = params.fractureType || "voronoi_cleavage";
    const crackDensity = params.crackDensity !== undefined ? params.crackDensity : 0.6;
    const aperture = params.aperture !== undefined ? params.aperture : 0.06;
    const depthReach = params.depthReach !== undefined ? params.depthReach : 0.8;
    const branching = params.branching !== undefined ? params.branching : 0.6;
    const jaggedness = params.jaggedness !== undefined ? params.jaggedness : 0.45;
    const explode = params.explode || 0.0;

    // Sharp Planar Chipped Cuts parameters
    const chipDensity = params.chipDensity !== undefined ? params.chipDensity : 0.55;
    const chipDepth = params.chipDepth !== undefined ? params.chipDepth : 0.06; // Step-down thickness in meters
    const chipScale = params.chipScale !== undefined ? params.chipScale : 0.45; // Patch radius

    // 1. Generate Organic 3D Voronoi Piece Seeds
    const numSeeds = Math.max(3, Math.round(3 + crackDensity * 4));
    const seeds = [];

    // Core main chunk
    seeds.push({
      x: (rng() - 0.5) * 0.2,
      y: (rng() - 0.5) * 0.2,
      z: (rng() - 0.5) * 0.2,
      weight: 1.35,
      dir: [0, 0, 0],
    });

    // Secondary chunks & broken wedge pieces
    for (let i = 1; i < numSeeds; i++) {
      const phi = Math.acos(1 - (2 * (i - 0.5)) / (numSeeds - 1));
      const theta = (i * 2.4) + rng() * 0.5;
      const rad = 0.7 + rng() * 0.4;

      const sx = rad * Math.sin(phi) * Math.cos(theta);
      const sy = rad * Math.cos(phi) * 0.8 + (rng() - 0.5) * 0.2;
      const sz = rad * Math.sin(phi) * Math.sin(theta);

      const dirLen = Math.hypot(sx, sy, sz) || 1;
      seeds.push({
        x: sx,
        y: sy,
        z: sz,
        weight: 0.75 + rng() * 0.45,
        dir: [sx / dirLen, sy / dirLen, sz / dirLen],
      });
    }

    // 2. Generate Sharp Planar Chipped Cut Planes (sharp planar slices along edges/corners)
    const numChips = Math.max(2, Math.round(chipDensity * 8));
    const chips = [];

    for (let c = 0; c < numChips; c++) {
      // Place planar cutting planes preferentially along outer convex facets & corners
      const phi = Math.PI * (0.15 + 0.7 * (c / numChips)) + (rng() - 0.5) * 0.3;
      const theta = rng() * Math.PI * 2;
      const rad = 0.9 + rng() * 0.25;

      const cx = rad * Math.sin(phi) * Math.cos(theta);
      const cy = rad * Math.cos(phi) * 0.9 + (rng() - 0.5) * 0.2;
      const cz = rad * Math.sin(phi) * Math.sin(theta);

      const cLen = Math.hypot(cx, cy, cz) || 1;
      const nx = cx / cLen;
      const ny = cy / cLen;
      const nz = cz / cLen;

      // Planar cutting plane normal tilted slightly relative to surface normal
      const tiltX = (rng() - 0.5) * 0.4;
      const tiltY = (rng() - 0.5) * 0.4;
      const tiltZ = (rng() - 0.5) * 0.4;
      const pLen = Math.hypot(nx + tiltX, ny + tiltY, nz + tiltZ) || 1;

      chips.push({
        cx,
        cy,
        cz,
        nx: (nx + tiltX) / pLen,
        ny: (ny + tiltY) / pLen,
        nz: (nz + tiltZ) / pLen,
        radius: chipScale * (0.8 + rng() * 0.5),
        depth: chipDepth * (0.85 + rng() * 0.4),
      });
    }

    this.crackSDF.fill(1.0);
    this.crackMask.fill(0.0);
    this.stressField.fill(0.0);
    this.chipMask.fill(0.0);
    this.pieceID.fill(0);

    // 3. Evaluate 3D Volume Field
    for (let iz = 0; iz < this.nz; iz++) {
      for (let iy = 0; iy < this.ny; iy++) {
        for (let ix = 0; ix < this.nx; ix++) {
          const idx = this.index(ix, iy, iz);
          const [wx, wy, wz] = this.voxelToCoord(ix, iy, iz);
          const rockDist = baseRockSDF ? baseRockSDF[idx] : -0.5;

          if (rockDist > 0.35) {
            this.crackSDF[idx] = 1.0;
            this.fracturedRockSDF[idx] = rockDist;
            continue;
          }

          const depthInside = Math.max(0.0, -rockDist);

          // Organic domain warping: warps crack paths along grain boundaries (non-straight, wandering)
          const warp1 = noise.noise3D(wx * 3.2, wy * 3.2, wz * 3.2);
          const warp2 = noise.noise3D(wx * 6.5 + 4.1, wy * 6.5 + 2.7, wz * 6.5 + 7.3);
          const organicWarp = (warp1 - 0.5) * jaggedness * 0.35 + (warp2 - 0.5) * jaggedness * 0.15;

          const px = wx + organicWarp;
          const py = wy + organicWarp * 0.8;
          const pz = wz + organicWarp;

          // Closest & second closest Voronoi seeds
          let d1 = Infinity;
          let d2 = Infinity;
          let bestSeedIdx = 0;

          for (let s = 0; s < seeds.length; s++) {
            const seed = seeds[s];
            const dist = Math.hypot(px - seed.x, py - seed.y, pz - seed.z) / seed.weight;
            if (dist < d1) {
              d2 = d1;
              d1 = dist;
              bestSeedIdx = s;
            } else if (dist < d2) {
              d2 = dist;
            }
          }

          this.pieceID[idx] = bestSeedIdx;

          // Perpendicular distance to the organic fracture boundary
          const fissureDist = Math.max(0.0, d2 - d1);

          // Aperture profile: wide at surface, tapering with depth
          const depthFrac = Math.min(1.0, depthInside / Math.max(0.05, depthReach));
          const localAperture = aperture * Math.pow(Math.max(0.0, 1.0 - depthFrac), 1.1) * (1.0 + warp1 * 0.3);

          let cleftCarve = 0.0;
          let maskVal = 0.0;
          let stressVal = 0.0;

          if (localAperture > 0.002 && fissureDist < localAperture * 2.2) {
            const normFissure = Math.min(1.0, fissureDist / (localAperture * 0.7));
            const smoothProfile = 1.0 - normFissure * normFissure * (3.0 - 2.0 * normFissure);

            cleftCarve = smoothProfile * localAperture * 0.85;
            maskVal = Math.max(0.0, 1.0 - fissureDist / (localAperture * 1.6));
            stressVal = Math.max(0.0, 1.0 - fissureDist / (localAperture * 2.8));
          }

          // 4. Sharp Planar Chipped Cuts:
          // Localized half-space planar cuts slicing clean flat facets out of corners and faces
          let maxChipCarve = 0.0;
          let maxChipMask = 0.0;

          if (chipDensity > 0.05 && depthInside < 0.3) {
            for (let c = 0; c < chips.length; c++) {
              const chip = chips[c];
              const dx_ = wx - chip.cx;
              const dy_ = wy - chip.cy;
              const dz_ = wz - chip.cz;
              const distFromCenter = Math.hypot(dx_, dy_, dz_);

              if (distFromCenter < chip.radius) {
                // Distance to the sharp cutting plane
                const planeDist = dx_ * chip.nx + dy_ * chip.ny + dz_ * chip.nz;

                // If voxel is behind the cutting plane within chip depth, cut cleanly
                if (planeDist < chip.depth) {
                  // Sharp planar cut with steep boundary dropoff
                  const radialFactor = Math.max(0.0, 1.0 - (distFromCenter / chip.radius) ** 4); // Flat center, steep crisp edge
                  const planeCarve = (chip.depth - planeDist) * radialFactor;

                  if (planeCarve > maxChipCarve) {
                    maxChipCarve = planeCarve;
                    maxChipMask = radialFactor;
                  }
                }
              }
            }
          }

          // Piece explode displacement
          let explodeDisp = 0.0;
          if (explode > 0.0) {
            const sDir = seeds[bestSeedIdx].dir;
            explodeDisp = -(wx * sDir[0] + wy * sDir[1] + wz * sDir[2]) * explode * 0.3;
          }

          // Total carved distance = crack cleft + sharp planar chipped facet + explode
          const totalCarve = Math.max(cleftCarve, maxChipCarve) + explodeDisp;
          const fracturedDist = rockDist + totalCarve;

          this.crackSDF[idx] = totalCarve > 0 ? -totalCarve : 1.0;
          this.crackMask[idx] = Math.max(maskVal, maxChipMask * 0.8);
          this.stressField[idx] = Math.max(stressVal, maxChipMask * 0.6);
          this.chipMask[idx] = maxChipMask;
          this.fracturedRockSDF[idx] = fracturedDist;
        }
      }
    }

    return {
      crackSDF: this.crackSDF,
      crackMask: this.crackMask,
      stressField: this.stressField,
      chipMask: this.chipMask,
      pieceID: this.pieceID,
      fracturedRockSDF: this.fracturedRockSDF,
      crackPlanesCount: seeds.length,
      pieceCount: seeds.length,
      chipCount: chips.length,
    };
  }
}
