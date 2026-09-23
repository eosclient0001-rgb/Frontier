/**
 * GAEA-Style Splatmap Channel Engine & Texture Blending
 * 
 * Computes multi-layer splat maps derived directly from the physical SDF volume:
 * 1. Bedrock / Strata (vertical cliffs, high arêtes, hard bedding planes)
 * 2. Scree / Talus Aprons (angular debris on slopes at angle of repose)
 * 3. Alluvial Sediment (flat valley floors, gravel beds, river washes)
 * 4. Weathered Dirt / Soil (mid-slope stabilized ground cover)
 * 5. Alpine Grass / Flora (gentle lowlands, moist basins)
 * 6. Snowpack / Ice (high altitude snowfields, crevasse retention)
 * 7. Wet Drainage Channels (dark glossed riverbeds and rills)
 */

export class SplatmapEngine {
  constructor(volume) {
    this.volume = volume;
  }

  /**
   * Compute full splatmap channel suite from volume and erosion results
   */
  computeChannels(erosionResults = null, options = {}) {
    const {
      snowAltitude = 32.0,
      snowMeltSlope = 45.0,  // degrees: snow slides off steep cliffs
      seaLevel = 0.0,
    } = options;

    const surf = this.volume.extractSurfaceGrid();
    const nx = surf.nx;
    const nz = surf.nz;
    const size = nx * nz;

    const h = surf.height;
    const slopeDeg = surf.slopeDeg;
    const slope = surf.slope;
    const hardness = surf.hardness;
    const curvature = surf.curvature;

    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < size; i++) {
      if (h[i] < minH) minH = h[i];
      if (h[i] > maxH) maxH = h[i];
    }
    const hRange = Math.max(1.0, maxH - minH);

    // Channel buffers
    const heightN = new Float32Array(size);
    const slopeN = new Float32Array(size);
    const flowN = new Float32Array(size);
    const sedimentN = new Float32Array(size);
    const talusN = new Float32Array(size);
    const rillN = new Float32Array(size);
    const strataN = new Float32Array(size);
    const cavityAO = new Float32Array(size);
    const snowN = new Float32Array(size);

    // PBR Layer weight buffers
    const weightRock = new Float32Array(size);
    const weightTalus = new Float32Array(size);
    const weightSediment = new Float32Array(size);
    const weightDirt = new Float32Array(size);
    const weightGrass = new Float32Array(size);
    const weightSnow = new Float32Array(size);

    const rawFlow = erosionResults?.flowMap;
    const rawDeposit = erosionResults?.depositMap;
    const rawTalus = erosionResults?.talusMap;
    const rawRills = erosionResults?.rillMap;

    // Normalize flow
    let maxFlow = 1.0;
    if (rawFlow) {
      for (let i = 0; i < size; i++) {
        if (rawFlow[i] > maxFlow) maxFlow = rawFlow[i];
      }
    }

    for (let i = 0; i < size; i++) {
      const curH = h[i];
      const curSlope = slopeDeg[i];
      const curHard = hardness[i];

      // Normalized height [0, 1]
      heightN[i] = (curH - minH) / hRange;

      // Normalized slope (0 deg = 0.0, 60+ deg = 1.0)
      slopeN[i] = Math.min(1.0, curSlope / 60.0);

      // Flow accumulation log-scale
      if (rawFlow) {
        flowN[i] = Math.min(1.0, Math.log1p(rawFlow[i]) / Math.log1p(maxFlow * 0.2));
      }

      // Deposited sediment
      if (rawDeposit) {
        sedimentN[i] = Math.min(1.0, rawDeposit[i] / 1.5);
      }

      // Talus scree
      if (rawTalus) {
        talusN[i] = Math.min(1.0, rawTalus[i] / 1.2);
      }

      // Micro rills
      if (rawRills) {
        rillN[i] = Math.min(1.0, rawRills[i] / 0.8);
      }

      // Strata banding pattern
      strataN[i] = Math.min(1.0, Math.max(0.0, (curHard - 0.3) / 1.8));

      // Cavity Ambient Occlusion: valley hollows vs sharp ridge crests
      const curv = curvature[i];
      cavityAO[i] = Math.max(0.0, Math.min(1.0, 0.5 - curv * 1.8));

      // Snow mask
      if (curH > snowAltitude) {
        const altFactor = Math.min(1.0, (curH - snowAltitude) / 10.0);
        const slopeFactor = Math.max(0.0, 1.0 - curSlope / snowMeltSlope);
        snowN[i] = altFactor * slopeFactor;
      }

      // ----------------------------------------------------------------------
      // Physical PBR Layer Blending Logic
      // ----------------------------------------------------------------------

      // 1. Rock / Bedrock: steep cliffs, hard strata bands, high peaks
      const rockBySlope = Math.pow(Math.max(0.0, (curSlope - 26.0) / 32.0), 1.5);
      const rockByPeak = heightN[i] > 0.75 ? (heightN[i] - 0.75) * 2.0 : 0.0;
      let wRock = Math.min(1.0, rockBySlope + rockByPeak * 0.6 + strataN[i] * 0.25);

      // 2. Talus / Scree: moderate slopes (28 - 36 deg) at the base of rock walls
      let wTalus = 0.0;
      if (curSlope >= 25.0 && curSlope <= 38.0) {
        const talusSlopeBand = Math.sin(((curSlope - 25.0) / 13.0) * Math.PI);
        wTalus = talusSlopeBand * (0.4 + 0.6 * talusN[i]);
      }

      // 3. Alluvial Sediment / Sand: flat areas with sediment deposit or near waterline
      let wSediment = sedimentN[i] * 0.85;
      if (curH < seaLevel + 1.5) {
        wSediment = Math.max(wSediment, Math.max(0.0, 1.0 - (curH - seaLevel) / 1.5));
      }

      // 4. Alpine Grass: gentle low slopes (< 22 deg) below high rocky summits
      let wGrass = 0.0;
      if (curSlope < 24.0 && curH < snowAltitude + 4.0) {
        const slopeFade = 1.0 - curSlope / 24.0;
        const altFade = Math.max(0.0, 1.0 - curH / (snowAltitude + 4.0));
        wGrass = slopeFade * altFade * (1.0 - wSediment * 0.7);
      }

      // 5. Weathered Dirt / Soil: mid-slopes, transitions, riverbank flats
      let wDirt = (1.0 - wRock) * (1.0 - wGrass) * (1.0 - wSediment * 0.8);
      wDirt = Math.max(0.0, Math.min(1.0, wDirt + flowN[i] * 0.35));

      // 6. Snowpack
      const wSnow = snowN[i];

      // Normalize layer weights (sum = 1.0)
      const sum = wRock + wTalus + wSediment + wDirt + wGrass + 1e-6;
      weightRock[i] = (wRock / sum) * (1.0 - wSnow);
      weightTalus[i] = (wTalus / sum) * (1.0 - wSnow);
      weightSediment[i] = (wSediment / sum) * (1.0 - wSnow);
      weightDirt[i] = (wDirt / sum) * (1.0 - wSnow);
      weightGrass[i] = (wGrass / sum) * (1.0 - wSnow);
      weightSnow[i] = wSnow;
    }

    return {
      nx,
      nz,
      heightN,
      slopeN,
      flowN,
      sedimentN,
      talusN,
      rillN,
      strataN,
      cavityAO,
      snowN,
      weights: {
        rock: weightRock,
        talus: weightTalus,
        sediment: weightSediment,
        dirt: weightDirt,
        grass: weightGrass,
        snow: weightSnow,
      },
    };
  }
}
