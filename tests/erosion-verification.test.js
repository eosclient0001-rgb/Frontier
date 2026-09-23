/**
 * Geomorphological Verification Tests
 * Tests 3D SDF mountain generation, physical erosion solver, V-shaped canyon incision,
 * angle of repose talus stabilization, differential strata etching, and rasterization.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { SDFVolume } from "../src/sdf-volume.js";
import { generateMountainMassif } from "../src/mountain-synthesis.js";
import { ErosionEngine } from "../src/erosion-engine.js";
import {
  rasterizeShadedRelief,
  rasterizeCrossSection,
  verifyGeomorphology,
} from "../src/rasterizer.js";

describe("Geomorphological SDF Terrain & Erosion Verification", () => {
  test("1. 3D SDF Volume generation with tectonic knife-edge ridge spines", () => {
    const volume = new SDFVolume({ nx: 128, ny: 64, nz: 128 });
    generateMountainMassif(volume, {
      seed: 42,
      peakHeight: 45.0,
      spineSharpness: 2.2,
      strataDip: 25.0,
    });

    const surf = volume.extractSurfaceGrid();
    assert.strictEqual(surf.height.length, 128 * 128);

    let maxElev = -Infinity;
    let minElev = Infinity;
    for (let i = 0; i < surf.height.length; i++) {
      if (surf.height[i] > maxElev) maxElev = surf.height[i];
      if (surf.height[i] < minElev) minElev = surf.height[i];
    }

    assert.ok(maxElev > 35.0, `Peak height should exceed 35m, got ${maxElev}`);
    assert.ok(minElev < 10.0, `Base height should be low, got ${minElev}`);
  });

  test("2. Full GAEA-grade physical erosion pipeline on SDF", async () => {
    const volume = new SDFVolume({ nx: 128, ny: 64, nz: 128 });
    generateMountainMassif(volume, { seed: 1337, peakHeight: 46.0 });

    const engine = new ErosionEngine(volume);
    const results = await engine.runPipeline({
      iterations: 24,
      fluvialK: 0.045,
      gorgeVNotch: 1.8,
      talusRate: 0.35,
      strataEtch: 0.8,
    });

    assert.ok(results.carvedVolumeM3 > 500, `Carved volume must be substantial, got ${results.carvedVolumeM3}`);
    assert.ok(results.depositedVolumeM3 > 0, `Deposited volume must be positive, got ${results.depositedVolumeM3}`);

    const surf = volume.extractSurfaceGrid();
    const verification = verifyGeomorphology(surf, results);

    assert.ok(verification.checks.vShapedGorgeIncised, "V-shaped gorges must be incised");
    assert.ok(verification.checks.talusAngleOfReposeStabilized, "Talus aprons at angle of repose must exist");
    assert.ok(verification.checks.knifeEdgeArêtesPreserved, "Knife-edge arêtes must be preserved");
    assert.ok(verification.checks.massConservationVerified, "Mass conservation must be verified");
    assert.ok(verification.valid, "Overall geomorphological validation must pass");

    // Output raster proof images to diagnostics/
    mkdirSync("diagnostics", { recursive: true });
    const shadedPNG = rasterizeShadedRelief(surf, results, 2048, 2048);
    const profilePNG = rasterizeCrossSection(surf, 1200, 400);

    writeFileSync("diagnostics/terrain_shaded_relief.png", shadedPNG);
    writeFileSync("diagnostics/valley_cross_section.png", profilePNG);
    writeFileSync("diagnostics/geomorphology_report.json", JSON.stringify(verification, null, 2));
  });

  test("3. 3D Volumetric CSG Sculpting Brush", () => {
    const volume = new SDFVolume({ nx: 64, ny: 32, nz: 64 });
    generateMountainMassif(volume, { seed: 100 });

    const beforeSurf = volume.extractSurfaceGrid();
    const centerIdx = 32 * 64 + 32;
    const initialH = beforeSurf.height[centerIdx];

    // Carve a gorge at center
    volume.sculptBrush("gorge", [0, initialH, 0], 12.0, 1.5);

    const afterSurf = volume.extractSurfaceGrid();
    const newH = afterSurf.height[centerIdx];

    assert.ok(newH < initialH - 0.5, `Gorge cut should lower elevation: before=${initialH}, after=${newH}`);
  });
});
