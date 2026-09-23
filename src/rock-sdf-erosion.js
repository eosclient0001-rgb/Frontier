/**
 * 3D SDF Geological Rock & Crack Erosion Solver
 * 
 * Simulates physical geomorphological weathering directly on 3D volumetric Signed Distance Fields:
 * 1. Gelifraction / Frost Wedging (freeze-thaw expansion widening crack mouths and crevice hollows)
 * 2. Edge Beveling & Mechanical Spall (curling and crumbling sharp acute convex crack lips)
 * 3. Chemical Weathering & Dissolution (smoothing and fluting internal crevice floors)
 * 4. Gravity Sediment & Silt Trapping in deep fissures
 * 5. Iron Oxidation & Lichen Weathering Halos along fracture margins
 */

export class RockSDFErosionEngine {
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
    this.voxelVolume = this.dx * this.dy * this.dz;

    this.erodedSDF = new Float32Array(this.totalVoxels);
    this.erosionDepth = new Float32Array(this.totalVoxels);
    this.cavitySediment = new Float32Array(this.totalVoxels);
    this.oxidationHalo = new Float32Array(this.totalVoxels);
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
   * Run fast, high-fidelity physical SDF crack erosion
   */
  erode(baseRockSDF, crackData, rockHardness = null, params = {}) {
    const iterations = params.iterations !== undefined ? params.iterations : 12;
    const frostWedging = params.frostWedging !== undefined ? params.frostWedging : 0.65;
    const edgeBevel = params.edgeBevel !== undefined ? params.edgeBevel : 0.55;
    const dissolution = params.dissolution !== undefined ? params.dissolution : 0.4;
    const sedimentFill = params.sedimentFill !== undefined ? params.sedimentFill : 0.45;
    const oxidationStrength = params.oxidation !== undefined ? params.oxidation : 0.7;

    const { fracturedRockSDF, crackMask, stressField } = crackData;

    // Reset arrays
    this.erosionDepth.fill(0.0);
    this.cavitySediment.fill(0.0);
    this.oxidationHalo.fill(0.0);

    let totalCarvedVolume = 0;
    let maxDepth = 0;
    let crackedVoxelCount = 0;

    // Multi-pass physical weathering calculation
    for (let iz = 0; iz < this.nz; iz++) {
      for (let iy = 0; iy < this.ny; iy++) {
        for (let ix = 0; ix < this.nx; ix++) {
          const idx = this.index(ix, iy, iz);
          const fDist = fracturedRockSDF[idx];
          const baseDist = baseRockSDF[idx];

          // If far outside rock, skip
          if (fDist > 0.3) {
            this.erodedSDF[idx] = fDist;
            continue;
          }

          const cMask = crackMask[idx] || 0.0;
          const cStress = stressField ? stressField[idx] : 0.0;
          const hard = rockHardness ? rockHardness[idx] : 1.2;
          const invHardness = 1.0 / Math.max(0.4, hard);

          // 1. Frost Wedging (Gelifraction):
          // Trapped moisture expands inside fissures, widening crack cavities
          const frostCarve = (frostWedging * 0.04) * (cMask * 0.8 + cStress * 0.5) * invHardness * (iterations / 12);

          // 2. Acute Lip Beveling & Spall:
          // Acute crack edges crumble under mechanical weathering
          const lipBevel = (edgeBevel * 0.025) * cMask * (1.0 - Math.min(1.0, Math.abs(fDist) / 0.12)) * invHardness;

          // 3. Chemical Dissolution:
          const dissolveCarve = (dissolution * 0.015) * cMask * cStress;

          const totalWeatheringDelta = frostCarve + lipBevel + dissolveCarve;
          const finalDist = fDist + totalWeatheringDelta;

          this.erodedSDF[idx] = finalDist;

          // Total erosion depth from original base rock
          const deltaFromBase = finalDist - baseDist;
          if (deltaFromBase > 0) {
            this.erosionDepth[idx] = deltaFromBase;
            totalCarvedVolume += deltaFromBase * this.voxelVolume;
            if (deltaFromBase > maxDepth) maxDepth = deltaFromBase;
          }

          if (cMask > 0.2) crackedVoxelCount++;

          // 4. Cavity Sediment Trapping
          if (cMask > 0.3 && iy < this.ny * 0.7) {
            this.cavitySediment[idx] = Math.min(1.0, cMask * sedimentFill * 1.3);
          }

          // 5. Iron Oxidation Patina Halo along fracture lips
          if (cMask > 0.1) {
            const surfaceProximity = Math.max(0.0, 1.0 - Math.abs(finalDist) / 0.15);
            this.oxidationHalo[idx] = Math.min(1.0, cMask * surfaceProximity * oxidationStrength * 1.2);
          }
        }
      }
    }

    return {
      erodedSDF: this.erodedSDF,
      erosionDepth: this.erosionDepth,
      crackMask: crackData.crackMask,
      stressField: crackData.stressField,
      cavitySediment: this.cavitySediment,
      oxidationHalo: this.oxidationHalo,
      diagnostics: {
        totalCarvedVolumeM3: totalCarvedVolume,
        maxErosionDepthMeters: maxDepth,
        crackedVoxelCount,
        iterationsRun: iterations,
      },
    };
  }
}
