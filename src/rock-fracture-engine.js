/**
 * 3D Organic Rock Cell Fracture Engine
 * Splits low-poly rocks into natural interlocking 3D pieces and chunks
 * using domain-warped Voronoi cell cleavage and depth-tapered organic fissure clefts.
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
    this.nx = volumeConfig.nx || 64;
    this.ny = volumeConfig.ny || 64;
    this.nz = volumeConfig.nz || 64;
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
   * Generates organic 3D fracture pieces and non-straight wandering crack clefts
   */
  generateFracture(baseRockSDF, params = {}) {
    const seed = params.seed !== undefined ? params.seed : 42;
    const rng = createPRNG(seed);
    const noise = new NoiseGenerator(seed);

    const fractureType = params.fractureType || "voronoi_cleavage";
    const crackDensity = params.crackDensity !== undefined ? params.crackDensity : 0.6;
    const aperture = params.aperture !== undefined ? params.aperture : 0.06; // Surface opening width in meters
    const depthReach = params.depthReach !== undefined ? params.depthReach : 0.8;
    const branching = params.branching !== undefined ? params.branching : 0.6;
    const jaggedness = params.jaggedness !== undefined ? params.jaggedness : 0.45; // Organic tortuosity
    const explode = params.explode || 0.0; // Piece displacement offset

    // Generate organic 3D Voronoi fracture seed centers
    const numSeeds = Math.max(3, Math.round(3 + crackDensity * 4));
    const seeds = [];

    // Seed 0: dominant main boulder core (center)
    seeds.push({
      x: (rng() - 0.5) * 0.2,
      y: (rng() - 0.5) * 0.2,
      z: (rng() - 0.5) * 0.2,
      weight: 1.3, // Larger chunk
      dir: [0, 0, 0],
    });

    // Secondary seeds: broken slab chunks & wedge pieces around the perimeter
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
        weight: 0.8 + rng() * 0.4,
        dir: [sx / dirLen, sy / dirLen, sz / dirLen],
      });
    }

    this.crackSDF.fill(1.0);
    this.crackMask.fill(0.0);
    this.stressField.fill(0.0);
    this.pieceID.fill(0);

    // Evaluate 3D Voronoi piece cleavage & organic warped crack clefts
    for (let iz = 0; iz < this.nz; iz++) {
      for (let iy = 0; iy < this.ny; iy++) {
        for (let ix = 0; ix < this.nx; ix++) {
          const idx = this.index(ix, iy, iz);
          const [wx, wy, wz] = this.voxelToCoord(ix, iy, iz);
          const rockDist = baseRockSDF ? baseRockSDF[idx] : -0.5;

          if (rockDist > 0.3) {
            this.crackSDF[idx] = 1.0;
            this.fracturedRockSDF[idx] = rockDist;
            continue;
          }

          // Depth from surface inside rock (negative rockDist is depth)
          const depthInside = Math.max(0.0, -rockDist);

          // Organic domain warping: warps crack paths along grain boundaries (non-straight, wandering)
          const warp1 = noise.noise3D(wx * 3.2, wy * 3.2, wz * 3.2);
          const warp2 = noise.noise3D(wx * 6.5 + 4.1, wy * 6.5 + 2.7, wz * 6.5 + 7.3);
          const organicWarp = (warp1 - 0.5) * jaggedness * 0.35 + (warp2 - 0.5) * jaggedness * 0.15;

          const px = wx + organicWarp;
          const py = wy + organicWarp * 0.8;
          const pz = wz + organicWarp;

          // Find closest and second closest fracture seed
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

          // Perpendicular distance to the organic fracture bisector boundary between pieces
          const fissureDist = Math.max(0.0, d2 - d1);

          // Aperture profile: wide at surface, tapering naturally with penetration depth
          const depthFrac = Math.min(1.0, depthInside / Math.max(0.05, depthReach));
          const localAperture = aperture * Math.pow(Math.max(0.0, 1.0 - depthFrac), 1.1) * (1.0 + warp1 * 0.3);

          let cleftCarve = 0.0;
          let maskVal = 0.0;
          let stressVal = 0.0;

          if (localAperture > 0.002 && fissureDist < localAperture * 2.2) {
            // Smoothstep V/U-cleft profile
            const normFissure = Math.min(1.0, fissureDist / (localAperture * 0.7));
            const smoothProfile = 1.0 - normFissure * normFissure * (3.0 - 2.0 * normFissure);

            cleftCarve = smoothProfile * localAperture * 0.85;
            maskVal = Math.max(0.0, 1.0 - fissureDist / (localAperture * 1.6));
            stressVal = Math.max(0.0, 1.0 - fissureDist / (localAperture * 2.8));
          }

          // Piece explode displacement (pulling broken chunks apart in 3D)
          let explodeDisp = 0.0;
          if (explode > 0.0) {
            const sDir = seeds[bestSeedIdx].dir;
            explodeDisp = -(wx * sDir[0] + wy * sDir[1] + wz * sDir[2]) * explode * 0.3;
          }

          const fracturedDist = rockDist + cleftCarve + explodeDisp;

          this.crackSDF[idx] = cleftCarve > 0 ? -cleftCarve : 1.0;
          this.crackMask[idx] = maskVal;
          this.stressField[idx] = stressVal;
          this.fracturedRockSDF[idx] = fracturedDist;
        }
      }
    }

    return {
      crackSDF: this.crackSDF,
      crackMask: this.crackMask,
      stressField: this.stressField,
      pieceID: this.pieceID,
      fracturedRockSDF: this.fracturedRockSDF,
      crackPlanesCount: seeds.length,
      pieceCount: seeds.length,
    };
  }
}
