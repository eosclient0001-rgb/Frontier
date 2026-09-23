/**
 * Automated Verification Test Suite for Standalone Rock Crack & SDF Erosion Studio
 * Tests:
 * 1. Blender-style Polyhedral 3D Base Rock SDF generation
 * 2. 3D Fracture & Crack Network simulation (Voronoi cleavage, Shear faults, Radial impact)
 * 3. Multi-pass physical 3D SDF Crack Erosion (Frost wedging, lip beveling, cavity sediment)
 * 4. Marching Cubes watertight mesh extraction across Low-Poly / High-Poly LOD levels
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RockGenerator, ROCK_PRESETS } from "../src/rock-generator.js";
import { RockFractureEngine } from "../src/rock-fracture-engine.js";
import { RockSDFErosionEngine } from "../src/rock-sdf-erosion.js";
import { extractIsosurface } from "../src/marching-cubes.js";

describe("Rock Crack & SDF Geological Erosion Engine", () => {
  const config = {
    nx: 48,
    ny: 48,
    nz: 48,
    boundsMin: [-2.0, -2.0, -2.0],
    boundsMax: [2.0, 2.0, 2.0],
  };

  test("1. Procedural 3D SDF Base Rock Generation", () => {
    const rockGen = new RockGenerator(config);
    const result = rockGen.generate({
      seed: 42,
      shapeType: "polyhedral",
      facets: 16,
      baseRoundness: 0.25,
      noiseAmp: 0.25,
      strataAmp: 0.1,
    });

    assert.ok(result.sdf, "SDF array must exist");
    assert.strictEqual(result.sdf.length, 48 * 48 * 48);

    // Verify center is deep inside rock (negative SDF)
    const centerIdx = rockGen.index(24, 24, 24);
    assert.ok(result.sdf[centerIdx] < -0.3, `Center must be solid rock, got ${result.sdf[centerIdx]}`);

    // Verify corner is in air (positive SDF)
    const cornerIdx = rockGen.index(0, 0, 0);
    assert.ok(result.sdf[cornerIdx] > 0.5, `Corner must be air, got ${result.sdf[cornerIdx]}`);

    // Verify strata hardness variation
    let minHard = Infinity, maxHard = -Infinity;
    for (let i = 0; i < result.hardness.length; i++) {
      if (result.hardness[i] < minHard) minHard = result.hardness[i];
      if (result.hardness[i] > maxHard) maxHard = result.hardness[i];
    }
    assert.ok(maxHard > minHard, "Hardness should vary across strata layers");
  });

  test("2. 3D Fracture Dynamics & Crack Cleavage Network", () => {
    const rockGen = new RockGenerator(config);
    const baseRock = rockGen.generate({ seed: 100 });

    const fractureEngine = new RockFractureEngine(config);

    // Test Voronoi Cleavage
    const voronoiFrac = fractureEngine.generateFracture(baseRock.sdf, {
      fractureType: "voronoi_cleavage",
      crackDensity: 0.7,
      aperture: 0.08,
      branching: 0.6,
      jaggedness: 0.4,
    });

    assert.ok(voronoiFrac.crackPlanesCount > 0, "Must generate fracture planes");
    assert.ok(voronoiFrac.crackSDF.length === 48 * 48 * 48);

    let hasCrackMask = false;
    let maxStress = 0.0;
    for (let i = 0; i < voronoiFrac.crackMask.length; i++) {
      if (voronoiFrac.crackMask[i] > 0.5) hasCrackMask = true;
      if (voronoiFrac.stressField[i] > maxStress) maxStress = voronoiFrac.stressField[i];
    }
    assert.ok(hasCrackMask, "Must identify crack voxels in mask");
    assert.ok(maxStress > 0.5, "Must compute crack stress field");

    // Test Tectonic Fault Shear
    const faultFrac = fractureEngine.generateFracture(baseRock.sdf, {
      fractureType: "tectonic_fault",
      crackDensity: 0.8,
    });
    assert.ok(faultFrac.crackPlanesCount > 0, "Tectonic fault must generate planes");

    // Test Impact Cratering
    const impactFrac = fractureEngine.generateFracture(baseRock.sdf, {
      fractureType: "radial_impact",
      crackDensity: 0.8,
    });
    assert.ok(impactFrac.crackPlanesCount > 0, "Impact fracture must generate radial planes");
  });

  test("3. Multi-Pass 3D SDF Geological Erosion on Cracks", () => {
    const rockGen = new RockGenerator(config);
    const baseRock = rockGen.generate({ seed: 777 });

    const fractureEngine = new RockFractureEngine(config);
    const fracData = fractureEngine.generateFracture(baseRock.sdf, {
      fractureType: "voronoi_cleavage",
      crackDensity: 0.6,
      aperture: 0.09,
    });

    const erosionEngine = new RockSDFErosionEngine(config);
    const erosionResult = erosionEngine.erode(baseRock.sdf, fracData, baseRock.hardness, {
      iterations: 10,
      frostWedging: 0.8,
      edgeBevel: 0.6,
      dissolution: 0.4,
      sedimentFill: 0.5,
      oxidation: 0.7,
    });

    assert.ok(erosionResult.diagnostics.totalCarvedVolumeM3 > 0, "Erosion must carve measurable rock volume");
    assert.ok(erosionResult.diagnostics.maxErosionDepthMeters > 0.01, "Erosion depth must widen crack crevices");

    // Check cavity sediment & oxidation halo
    let hasSediment = false;
    let hasOxidation = false;
    for (let i = 0; i < erosionResult.cavitySediment.length; i++) {
      if (erosionResult.cavitySediment[i] > 0.1) hasSediment = true;
      if (erosionResult.oxidationHalo[i] > 0.1) hasOxidation = true;
    }
    assert.ok(hasSediment, "Sediment should accumulate in cavities");
    assert.ok(hasOxidation, "Oxidation patina halo should form around fractures");
  });

  test("4. Marching Cubes Watertight 3D Mesh & LOD Decimation", () => {
    const rockGen = new RockGenerator(config);
    const baseRock = rockGen.generate({ seed: 42 });

    const fractureEngine = new RockFractureEngine(config);
    const frac = fractureEngine.generateFracture(baseRock.sdf, { aperture: 0.08 });

    const erosionEngine = new RockSDFErosionEngine(config);
    const erosion = erosionEngine.erode(baseRock.sdf, frac, baseRock.hardness, { iterations: 8 });

    // High Poly Extraction (step = 1)
    const highMesh = extractIsosurface(
      {
        sdf: erosion.erodedSDF,
        nx: config.nx,
        ny: config.ny,
        nz: config.nz,
        boundsMin: config.boundsMin,
        boundsMax: config.boundsMax,
      },
      { isovalue: 0.0, step: 1, crackMask: frac.crackMask, erosionDepth: erosion.erosionDepth }
    );

    assert.ok(highMesh.positions.length > 0, "High mesh must produce vertices");
    assert.ok(highMesh.triangleCount > 500, "High mesh must have detailed triangle count");
    assert.strictEqual(highMesh.positions.length, highMesh.normals.length);

    // Low Poly Game LOD Extraction (step = 2)
    const lowMesh = extractIsosurface(
      {
        sdf: erosion.erodedSDF,
        nx: config.nx,
        ny: config.ny,
        nz: config.nz,
        boundsMin: config.boundsMin,
        boundsMax: config.boundsMax,
      },
      { isovalue: 0.0, step: 2 }
    );

    assert.ok(lowMesh.positions.length > 0, "Low-poly mesh must produce vertices");
    assert.ok(
      lowMesh.triangleCount < highMesh.triangleCount,
      `Low LOD (${lowMesh.triangleCount}) must have fewer triangles than High LOD (${highMesh.triangleCount})`
    );
  });
});
