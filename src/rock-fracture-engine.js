/**
 * 3D Structural Rock Fracture & Geological Fault Simulation Engine
 * 
 * Features specialized geometric & physical fracture mechanics:
 * 1. 3D Voronoi Cellular Cleavage (multi-piece chunk splitting)
 * 2. Tectonic Shear Fault & Riedel Shears (primary fault plane + conjugate feathering cracks)
 * 3. Radial & Concentric Impact Fracture (epicenter shock starburst + concentric spall rings)
 * 4. Thermal Spall & Concentric Exfoliation (curved onion-skin shell peeling)
 * 5. Sedimentary Bedding Delamination (parallel horizontal sheet fissures)
 * 6. Vertical Columnar Joints (hexagonal prismatic joint fissures)
 * 7. Shatter Network (high-density brittle cleavage micro-fissure spiderweb)
 */

import { NoiseGenerator, createPRNG } from "./math-noise.js";

export const FRACTURE_TYPES = {
  voronoi_cleavage: {
    id: "voronoi_cleavage",
    name: "3D Voronoi Cellular Cleavage",
    description: "Breaks rock into natural organic Voronoi chunks with wandering grain-boundary clefts",
  },
  tectonic_fault: {
    id: "tectonic_fault",
    name: "Tectonic Shear Fault & Riedel Shears",
    description: "Deep planar fault shear with conjugate diagonal Riedel feathering fissures",
  },
  radial_impact: {
    id: "radial_impact",
    name: "Radial & Concentric Impact Shock",
    description: "Impact epicenter with radiating fracture rays and concentric shock rings",
  },
  thermal_spall: {
    id: "thermal_spall",
    name: "Thermal Exfoliation & Spall Shells",
    description: "Curved concentric shell fractures peeling away exterior layers",
  },
  strata_delam: {
    id: "strata_delam",
    name: "Sedimentary Bedding Delamination",
    description: "Parallel delamination fissures running along horizontal sedimentary strata",
  },
  columnar_joints: {
    id: "columnar_joints",
    name: "Volcanic Columnar Joint Cleavage",
    description: "Vertical polygonal cooling joint fissures splitting the rock vertically",
  },
  shatter_network: {
    id: "shatter_network",
    name: "Brittle Micro-Fissure Shatter Web",
    description: "High-density interconnected spiderweb of fine cleavage cracks",
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
   * Generates distinct physical 3D fracture networks
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

    // Sharp Planar Chipped Cuts
    const chipDensity = params.chipDensity !== undefined ? params.chipDensity : 0.55;
    const chipDepth = params.chipDepth !== undefined ? params.chipDepth : 0.06;
    const chipScale = params.chipScale !== undefined ? params.chipScale : 0.45;

    // Reset arrays
    this.crackSDF.fill(1.0);
    this.crackMask.fill(0.0);
    this.stressField.fill(0.0);
    this.chipMask.fill(0.0);
    this.pieceID.fill(0);

    // Generate Sharp Planar Chipped Cut Planes
    const numChips = Math.max(2, Math.round(chipDensity * 8));
    const chips = [];
    for (let c = 0; c < numChips; c++) {
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

    // Prepare specialized structural seeds based on fractureType
    const voronoiSeeds = [];
    const faultPlanes = [];
    let epicenter = { x: 0, y: 0.8, z: 0 };
    const delamPlanes = [];
    const columnCenters = [];

    if (fractureType === "tectonic_fault") {
      // Primary shear fault plane
      const fAngle = rng() * Math.PI * 2;
      const fDip = Math.PI * 0.35 + (rng() - 0.5) * 0.2;
      const mainNx = Math.cos(fAngle) * Math.sin(fDip);
      const mainNy = Math.cos(fDip);
      const mainNz = Math.sin(fAngle) * Math.sin(fDip);

      faultPlanes.push({ nx: mainNx, ny: mainNy, nz: mainNz, d: (rng() - 0.5) * 0.2, weight: 1.0, isMain: true });

      // Secondary conjugate Riedel shears (feathering at 30° - 45° off the main fault)
      const numRiedel = Math.max(3, Math.round(crackDensity * 6));
      for (let r = 0; r < numRiedel; r++) {
        const tiltAngle = (r % 2 === 0 ? 1 : -1) * (0.55 + (rng() - 0.5) * 0.2);
        const cosT = Math.cos(tiltAngle);
        const sinT = Math.sin(tiltAngle);
        const rNx = mainNx * cosT - mainNz * sinT;
        const rNz = mainNx * sinT + mainNz * cosT;
        faultPlanes.push({
          nx: rNx,
          ny: mainNy + (rng() - 0.5) * 0.2,
          nz: rNz,
          d: (r / numRiedel - 0.5) * 1.2 + (rng() - 0.5) * 0.2,
          weight: 0.65,
          isMain: false,
        });
      }
    } else if (fractureType === "radial_impact") {
      // Impact epicenter on top surface
      epicenter = {
        x: (rng() - 0.5) * 0.4,
        y: 0.75 + (rng() - 0.5) * 0.2,
        z: (rng() - 0.5) * 0.4,
      };
    } else if (fractureType === "strata_delam") {
      // Horizontal / tilted bedding delamination sheets
      const numLayers = Math.max(3, Math.round(3 + crackDensity * 5));
      const dipAngle = ((params.strataDip || 0) * Math.PI) / 180;
      for (let l = 0; l < numLayers; l++) {
        const yPos = -0.8 + (1.6 * (l + 0.5)) / numLayers + (rng() - 0.5) * 0.1;
        delamPlanes.push({
          nx: Math.sin(dipAngle),
          ny: Math.cos(dipAngle),
          nz: 0,
          d: yPos,
        });
      }
    } else if (fractureType === "columnar_joints") {
      // Vertical prismatic columns
      const numCols = Math.max(4, Math.round(4 + crackDensity * 6));
      for (let c = 0; c < numCols; c++) {
        const rad = 0.5 + (rng() - 0.5) * 0.3;
        const ang = (c * 2 * Math.PI) / numCols + (rng() - 0.5) * 0.3;
        columnCenters.push({
          x: rad * Math.cos(ang),
          z: rad * Math.sin(ang),
        });
      }
      columnCenters.push({ x: 0, z: 0 }); // Center column
    } else if (fractureType === "shatter_network") {
      // High-density brittle micro-fissure web
      const numSeeds = Math.max(12, Math.round(10 + crackDensity * 16));
      for (let i = 0; i < numSeeds; i++) {
        const phi = Math.acos(1 - (2 * (i + 0.5)) / numSeeds);
        const theta = (i * 2.4) + rng() * 0.4;
        const rad = 0.85 * (0.5 + rng() * 0.5);
        voronoiSeeds.push({
          x: rad * Math.sin(phi) * Math.cos(theta),
          y: rad * Math.cos(phi) * 0.9,
          z: rad * Math.sin(phi) * Math.sin(theta),
          weight: 0.8 + rng() * 0.4,
          dir: [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)],
        });
      }
    } else {
      // Standard 3D Voronoi Cellular Cleavage
      const numSeeds = Math.max(4, Math.round(3 + crackDensity * 5));
      voronoiSeeds.push({
        x: (rng() - 0.5) * 0.2,
        y: (rng() - 0.5) * 0.2,
        z: (rng() - 0.5) * 0.2,
        weight: 1.35,
        dir: [0, 0, 0],
      });
      for (let i = 1; i < numSeeds; i++) {
        const phi = Math.acos(1 - (2 * (i - 0.5)) / (numSeeds - 1));
        const theta = (i * 2.4) + rng() * 0.5;
        const rad = 0.75 + rng() * 0.35;
        const sx = rad * Math.sin(phi) * Math.cos(theta);
        const sy = rad * Math.cos(phi) * 0.85 + (rng() - 0.5) * 0.2;
        const sz = rad * Math.sin(phi) * Math.sin(theta);
        const dirLen = Math.hypot(sx, sy, sz) || 1;
        voronoiSeeds.push({
          x: sx,
          y: sy,
          z: sz,
          weight: 0.75 + rng() * 0.45,
          dir: [sx / dirLen, sy / dirLen, sz / dirLen],
        });
      }
    }

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

          // Organic domain warping
          const warp1 = noise.noise3D(wx * 3.5, wy * 3.5, wz * 3.5);
          const warp2 = noise.noise3D(wx * 7.0 + 4.1, wy * 7.0 + 2.7, wz * 7.0 + 7.3);
          const organicWarp = (warp1 - 0.5) * jaggedness * 0.3 + (warp2 - 0.5) * jaggedness * 0.12;

          const px = wx + organicWarp;
          const py = wy + organicWarp * 0.8;
          const pz = wz + organicWarp;

          let fissureDist = 10.0;
          let bestPiece = 0;
          let explodeDir = [0, 0, 0];

          // Compute crack distance based on specific fracture physics
          if (fractureType === "tectonic_fault") {
            for (let f = 0; f < faultPlanes.length; f++) {
              const fp = faultPlanes[f];
              const pDist = Math.abs(px * fp.nx + py * fp.ny + pz * fp.nz - fp.d);
              if (pDist < fissureDist) {
                fissureDist = pDist;
                bestPiece = f;
                explodeDir = [fp.nx, fp.ny, fp.nz];
              }
            }
          } else if (fractureType === "radial_impact") {
            const dx_ = px - epicenter.x;
            const dy_ = py - epicenter.y;
            const dz_ = pz - epicenter.z;
            const radDist = Math.hypot(dx_, dy_, dz_);
            const angle = Math.atan2(dz_, dx_);

            // Radiating spoke rays
            const numRays = Math.max(4, Math.round(4 + crackDensity * 6));
            const rayAngle = (angle + Math.PI) / (Math.PI * 2) * numRays;
            const rayFrac = Math.abs(rayAngle - Math.round(rayAngle));
            const rayDist = rayFrac * radDist * 0.8;

            // Concentric shock rings
            const ringSpacing = 0.35;
            const ringFrac = Math.abs((radDist / ringSpacing) - Math.round(radDist / ringSpacing));
            const ringDist = ringFrac * ringSpacing;

            fissureDist = Math.min(rayDist, ringDist);
            bestPiece = Math.floor(rayAngle) % 8;
            explodeDir = [dx_ / (radDist || 1), dy_ / (radDist || 1), dz_ / (radDist || 1)];
          } else if (fractureType === "thermal_spall") {
            // Concentric shell peeling from rock surface
            const shellDepth = 0.18;
            const shellLayer = depthInside / shellDepth;
            const shellFrac = Math.abs(shellLayer - Math.round(shellLayer));
            fissureDist = shellFrac * shellDepth;
            bestPiece = Math.floor(shellLayer);
            explodeDir = [wx, wy, wz];
          } else if (fractureType === "strata_delam") {
            for (let l = 0; l < delamPlanes.length; l++) {
              const dp = delamPlanes[l];
              const pDist = Math.abs(px * dp.nx + py * dp.ny + pz * dp.nz - dp.d);
              if (pDist < fissureDist) {
                fissureDist = pDist;
                bestPiece = l;
                explodeDir = [0, 1, 0];
              }
            }
          } else if (fractureType === "columnar_joints") {
            let d1 = Infinity, d2 = Infinity;
            for (let c = 0; c < columnCenters.length; c++) {
              const col = columnCenters[c];
              const dist = Math.hypot(px - col.x, pz - col.z);
              if (dist < d1) {
                d2 = d1;
                d1 = dist;
                bestPiece = c;
              } else if (dist < d2) {
                d2 = dist;
              }
            }
            fissureDist = Math.max(0.0, d2 - d1);
            explodeDir = [px - columnCenters[bestPiece].x, 0, pz - columnCenters[bestPiece].z];
          } else {
            // Voronoi Cellular / Shatter Network
            let d1 = Infinity, d2 = Infinity;
            for (let s = 0; s < voronoiSeeds.length; s++) {
              const seedObj = voronoiSeeds[s];
              const dist = Math.hypot(px - seedObj.x, py - seedObj.y, pz - seedObj.z) / seedObj.weight;
              if (dist < d1) {
                d2 = d1;
                d1 = dist;
                bestPiece = s;
                explodeDir = seedObj.dir;
              } else if (dist < d2) {
                d2 = dist;
              }
            }
            fissureDist = Math.max(0.0, d2 - d1);
          }

          this.pieceID[idx] = bestPiece;

          // Aperture profile: wide at surface, tapering with depth
          const depthFrac = Math.min(1.0, depthInside / Math.max(0.05, depthReach));
          const localAperture = aperture * Math.pow(Math.max(0.0, 1.0 - depthFrac), 1.1) * (1.0 + warp1 * 0.25);

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

          // Sharp Planar Chipped Cuts
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
                const planeDist = dx_ * chip.nx + dy_ * chip.ny + dz_ * chip.nz;
                if (planeDist < chip.depth) {
                  const radialFactor = Math.max(0.0, 1.0 - (distFromCenter / chip.radius) ** 4);
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
            const expLen = Math.hypot(explodeDir[0], explodeDir[1], explodeDir[2]) || 1;
            explodeDisp = -(wx * (explodeDir[0]/expLen) + wy * (explodeDir[1]/expLen) + wz * (explodeDir[2]/expLen)) * explode * 0.3;
          }

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
      crackPlanesCount: Math.max(voronoiSeeds.length, faultPlanes.length, delamPlanes.length, columnCenters.length, 4),
      pieceCount: Math.max(voronoiSeeds.length, faultPlanes.length, delamPlanes.length, columnCenters.length, 4),
      chipCount: chips.length,
    };
  }
}
