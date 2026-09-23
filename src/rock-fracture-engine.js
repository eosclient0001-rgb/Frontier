/**
 * 3D Rock Fracture & Crack Engine
 * Simulates realistic geological rock fracture networks:
 * - 3D Structural Cleavage Faults & Joint Planes
 * - Tectonic Shear Faults with Conjugate Riedel Shears
 * - Radial & Concentric Impact Cracks
 * - Thermal Spalling / Exfoliation Fissures
 * - Bedding Plane Delamination
 * - Depth-Tapering Aperture, Fractal Tortuosity, and Stress Intensity Fields
 */

import { NoiseGenerator, createPRNG } from "./math-noise.js";

export const FRACTURE_TYPES = {
  voronoi_cleavage: {
    id: "voronoi_cleavage",
    name: "3D Crystalline Cleavage Faults",
    description: "Deep structural fracture planes cutting across natural mineral weakness axes",
  },
  tectonic_fault: {
    id: "tectonic_fault",
    name: "Tectonic Shear Fault & Riedel Shears",
    description: "Primary fault shear fracture with secondary diagonal conjugate feathering fissures",
  },
  radial_impact: {
    id: "radial_impact",
    name: "Radial & Concentric Impact Cracks",
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
   * Generates realistic 3D rock fractures & clefts
   */
  generateFracture(baseRockSDF, params = {}) {
    const seed = params.seed !== undefined ? params.seed : 42;
    const rng = createPRNG(seed);
    const noise = new NoiseGenerator(seed);

    const fractureType = params.fractureType || "voronoi_cleavage";
    const crackDensity = params.crackDensity !== undefined ? params.crackDensity : 0.6;
    const aperture = params.aperture !== undefined ? params.aperture : 0.07; // Base surface opening in meters
    const depthReach = params.depthReach !== undefined ? params.depthReach : 0.7; // Depth penetration
    const branching = params.branching !== undefined ? params.branching : 0.6;
    const jaggedness = params.jaggedness !== undefined ? params.jaggedness : 0.4;
    const strataDip = params.strataDip || 15;

    // Define 3D fracture planes / spines
    const crackPlanes = [];

    if (fractureType === "voronoi_cleavage") {
      // 2 to 4 major primary cleavage clefts
      const numCracks = Math.max(2, Math.round(2 + crackDensity * 3));
      for (let i = 0; i < numCracks; i++) {
        const phi = (i / numCracks) * Math.PI + (rng() - 0.5) * 0.4;
        const theta = rng() * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(theta);
        const ny = Math.cos(phi) * 0.7 + (rng() - 0.5) * 0.3;
        const nz = Math.sin(phi) * Math.sin(theta);
        const len = Math.hypot(nx, ny, nz) || 1;

        crackPlanes.push({
          nx: nx / len,
          ny: ny / len,
          nz: nz / len,
          offset: (rng() - 0.5) * 0.4,
          aperture: aperture * (0.8 + rng() * 0.4),
          depth: depthReach * (0.7 + rng() * 0.5),
          isPrimary: true,
        });

        // Secondary branching cleft
        if (branching > 0.3 && rng() < branching * 0.7) {
          const bAngle = Math.PI / 4 + (rng() - 0.5) * 0.3;
          crackPlanes.push({
            nx: (nx * Math.cos(bAngle) - nz * Math.sin(bAngle)) / len,
            ny: ny / len,
            nz: (nx * Math.sin(bAngle) + nz * Math.cos(bAngle)) / len,
            offset: (rng() - 0.5) * 0.5,
            aperture: aperture * 0.55,
            depth: depthReach * 0.5,
            isPrimary: false,
          });
        }
      }
    } else if (fractureType === "tectonic_fault") {
      // Primary shear fault + Riedel shears
      const faultAngle = ((rng() - 0.5) * 35 * Math.PI) / 180;
      const fnx = Math.cos(faultAngle);
      const fnz = Math.sin(faultAngle);

      crackPlanes.push({
        nx: fnx,
        ny: (rng() - 0.5) * 0.2,
        nz: fnz,
        offset: (rng() - 0.5) * 0.2,
        aperture: aperture * 1.2,
        depth: depthReach * 1.1,
        isPrimary: true,
      });

      // Riedel shears at ~30 deg angle
      const numRiedel = Math.max(2, Math.round(2 + crackDensity * 3));
      for (let r = 0; r < numRiedel; r++) {
        const rAngle = faultAngle + (Math.PI / 6) * (r % 2 === 0 ? 1 : -1);
        crackPlanes.push({
          nx: Math.cos(rAngle),
          ny: (rng() - 0.5) * 0.3,
          nz: Math.sin(rAngle),
          offset: (r - (numRiedel - 1) * 0.5) * 0.4,
          aperture: aperture * 0.5,
          depth: depthReach * 0.5,
          isPrimary: false,
        });
      }
    } else if (fractureType === "radial_impact") {
      // Impact epicenter on top surface
      const numRays = Math.max(3, Math.round(4 + crackDensity * 4));
      for (let i = 0; i < numRays; i++) {
        const angle = (i * 2 * Math.PI) / numRays + (rng() - 0.5) * 0.3;
        crackPlanes.push({
          nx: Math.sin(angle),
          ny: 0.3,
          nz: -Math.cos(angle),
          offset: (rng() - 0.5) * 0.15,
          aperture: aperture * (1.0 - (i % 2) * 0.3),
          depth: depthReach * 0.8,
          isPrimary: true,
        });
      }
    } else if (fractureType === "thermal_spall") {
      // Exfoliation shell fractures
      const numShells = Math.max(2, Math.round(2 + crackDensity * 3));
      for (let s = 0; s < numShells; s++) {
        const theta = (s / numShells) * Math.PI + (rng() - 0.5) * 0.3;
        crackPlanes.push({
          nx: Math.cos(theta),
          ny: Math.sin(theta) * 0.5,
          nz: Math.sin(theta),
          offset: 0.3 + s * 0.3,
          aperture: aperture * 0.7,
          depth: depthReach * 0.6,
          isPrimary: true,
        });
      }
    } else if (fractureType === "strata_delam") {
      // Bedding plane splits
      const dipRad = ((strataDip || 15) * Math.PI) / 180;
      const snx = Math.sin(dipRad);
      const sny = Math.cos(dipRad);

      const numSplits = Math.max(2, Math.round(2 + crackDensity * 4));
      for (let b = 0; b < numSplits; b++) {
        crackPlanes.push({
          nx: snx * (rng() > 0.5 ? 0.2 : -0.2),
          ny: sny,
          nz: (rng() - 0.5) * 0.2,
          offset: (b - (numSplits - 1) * 0.5) * 0.5,
          aperture: aperture * (0.8 + rng() * 0.4),
          depth: depthReach * 0.7,
          isPrimary: true,
        });
      }
    }

    // Evaluate 3D crack cleft distance field
    for (let iz = 0; iz < this.nz; iz++) {
      for (let iy = 0; iy < this.ny; iy++) {
        for (let ix = 0; ix < this.nx; ix++) {
          const idx = this.index(ix, iy, iz);
          const [wx, wy, wz] = this.voxelToCoord(ix, iy, iz);
          const rockDist = baseRockSDF ? baseRockSDF[idx] : -0.5;

          // If far outside rock, skip
          if (rockDist > 0.3) {
            this.crackSDF[idx] = 2.0;
            this.crackMask[idx] = 0.0;
            this.stressField[idx] = 0.0;
            this.fracturedRockSDF[idx] = rockDist;
            continue;
          }

          // Depth from surface inside rock (negative rockDist is depth inside)
          const depthInside = Math.max(0.0, -rockDist);

          // Crystalline fractal noise displacing crack walls
          const jNoise = noise.noise3D(wx * 4.0, wy * 4.0, wz * 4.0);
          const tortuosityDisp = (jNoise - 0.5) * jaggedness * 0.06;

          let maxCleftCarve = 0.0;
          let maxMask = 0.0;
          let maxStress = 0.0;

          for (let p = 0; p < crackPlanes.length; p++) {
            const cp = crackPlanes[p];
            // Perpendicular distance to the fracture plane
            const planeDist = Math.abs(wx * cp.nx + wy * cp.ny + wz * cp.nz - cp.offset) + tortuosityDisp;

            // Aperture tapering with penetration depth
            const depthFrac = Math.min(1.0, depthInside / Math.max(0.05, cp.depth));
            const localWidth = cp.aperture * Math.pow(Math.max(0.0, 1.0 - depthFrac), 1.2);

            if (localWidth > 0.002 && planeDist < localWidth * 2.0) {
              // V-shaped / U-shaped crack cleft carve amount
              const cleftProfile = Math.max(0.0, 1.0 - planeDist / (localWidth * 0.5));
              const carveAmt = cleftProfile * localWidth * 0.75;
              if (carveAmt > maxCleftCarve) maxCleftCarve = carveAmt;

              // Crack influence mask
              const mask = Math.max(0.0, 1.0 - planeDist / (localWidth * 1.5));
              if (mask > maxMask) maxMask = mask;

              // Stress concentration
              const stress = Math.max(0.0, 1.0 - planeDist / (localWidth * 3.0));
              if (stress > maxStress) maxStress = stress;
            }
          }

          // In fractured rock: SDF is pushed outward (carved away) by crack cleft
          const fracturedDist = rockDist + maxCleftCarve;

          this.crackSDF[idx] = maxCleftCarve > 0 ? -maxCleftCarve : 1.0;
          this.crackMask[idx] = maxMask;
          this.stressField[idx] = maxStress;
          this.fracturedRockSDF[idx] = fracturedDist;
        }
      }
    }

    return {
      crackSDF: this.crackSDF,
      crackMask: this.crackMask,
      stressField: this.stressField,
      fracturedRockSDF: this.fracturedRockSDF,
      crackPlanesCount: crackPlanes.length,
    };
  }
}
