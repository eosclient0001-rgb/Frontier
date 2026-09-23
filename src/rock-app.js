/**
 * Standalone Rock Crack & SDF Erosion Studio — Application Controller
 * Features the authoritative 4-Phase Geological Pipeline:
 * Phase 1: Base Rock Generator (Polyhedral SDF with Strata Bedding & Micro-Facets)
 * Phase 2: 3D Fracture Dynamics & Sharp Planar Chipped Cuts (Cleavage Faults & Stress Tensors)
 * Phase 3: Volumetric 3D SDF Crack Erosion (Frost Wedging & Lip Beveling)
 * Phase 4: Final Mesh LOD Extraction & PBR Material Shading
 */

import { RockGenerator, ROCK_PRESETS } from "./rock-generator.js";
import { RockFractureEngine, FRACTURE_TYPES } from "./rock-fracture-engine.js";
import { RockSDFErosionEngine } from "./rock-sdf-erosion.js";
import { extractIsosurface } from "./marching-cubes.js";
import { RockPreviewViewport, MINERAL_PALETTES } from "./rock-preview.js";

export class RockStudioApp {
  constructor() {
    this.gridResolution = 80; // 80x80x80 SDF grid with Adaptive Sub-Voxel Crack Refinement
    this.lodStep = 1; // 1 = High poly, 2 = Mid poly, 3 = Low poly game mesh
    this.currentPhase = 1; // 1: Base Rock, 2: Fractured & Chipped, 3: Eroded SDF, 4: Final Mesh/LOD

    // State parameters
    this.state = {
      preset: "granite_boulder",
      seed: 1337,
      // Base Rock params
      facets: 14,
      baseRoundness: 0.25,
      noiseAmp: 0.12,
      noiseFreq: 0.85,
      strataAmp: 0.04,
      strataFreq: 2.2,
      strataDip: 15,
      rockHardness: 1.4,
      // Fracture & Pieces params
      fractureType: "voronoi_cleavage",
      crackDensity: 0.6,
      aperture: 0.06,
      depthReach: 0.8,
      branching: 0.6,
      jaggedness: 0.45,
      explode: 0.0, // Broken piece separation
      // Sharp Planar Chipped Cuts & Spall Facets
      chipDensity: 0.55,
      chipDepth: 0.06,
      chipScale: 0.45,
      // SDF Erosion params
      iterations: 12,
      frostWedging: 0.65,
      edgeBevel: 0.55,
      dissolution: 0.4,
      sedimentFill: 0.45,
      oxidation: 0.7,
      // Shading & Mineral params
      mineral: "granite",
      baseColor: "#827e7a",
      crackColor: "#322b27",
      oxidationColor: "#9c603a",
    };

    this.initEngines();
    this.initViewport();
    this.bindUI();
    this.applyPreset(this.state.preset);
  }

  initEngines() {
    const config = {
      nx: this.gridResolution,
      ny: this.gridResolution,
      nz: this.gridResolution,
      boundsMin: [-1.8, -1.8, -1.8],
      boundsMax: [1.8, 1.8, 1.8],
    };

    this.rockGen = new RockGenerator(config);
    this.fractureEngine = new RockFractureEngine(config);
    this.erosionEngine = new RockSDFErosionEngine(config);
  }

  initViewport() {
    const container = document.getElementById("viewport-container");
    this.viewport = new RockPreviewViewport(container);
  }

  bindUI() {
    // Phase Stepper buttons
    const phaseBtns = document.querySelectorAll(".phase-step-btn");
    phaseBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = parseInt(btn.dataset.phase || "1");
        this.setPhase(p);
      });
    });

    // Step cards in left panel (also clickable)
    for (let i = 1; i <= 4; i++) {
      const card = document.getElementById(`card-step-${i}`);
      if (card) {
        card.style.cursor = "pointer";
        card.addEventListener("click", () => this.setPhase(i));
      }
    }

    // Prev / Next buttons
    const prevBtn = document.getElementById("btn-prev-phase");
    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        if (this.currentPhase > 1) this.setPhase(this.currentPhase - 1);
      });
    }

    const nextBtn = document.getElementById("btn-next-phase");
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        if (this.currentPhase < 4) this.setPhase(this.currentPhase + 1);
      });
    }

    // Populate dropdowns
    const presetSelect = document.getElementById("rock-preset-select");
    if (presetSelect && presetSelect.options.length === 0) {
      Object.entries(ROCK_PRESETS).forEach(([key, p]) => {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = p.name;
        if (key === this.state.preset) opt.selected = true;
        presetSelect.appendChild(opt);
      });
    }

    const fracSelect = document.getElementById("fracture-type-select");
    if (fracSelect && fracSelect.options.length === 0) {
      Object.entries(FRACTURE_TYPES).forEach(([key, f]) => {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = f.name;
        if (key === this.state.fractureType) opt.selected = true;
        fracSelect.appendChild(opt);
      });
    }

    const mineralSelect = document.getElementById("mineral-preset-select");
    if (mineralSelect && mineralSelect.options.length === 0) {
      Object.entries(MINERAL_PALETTES).forEach(([key, m]) => {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = m.name;
        if (key === this.state.mineral) opt.selected = true;
        mineralSelect.appendChild(opt);
      });
    }

    // Dropdown change listeners
    if (presetSelect) {
      presetSelect.addEventListener("change", (e) => {
        this.applyPreset(e.target.value);
      });
    }

    if (fracSelect) {
      fracSelect.addEventListener("change", (e) => {
        this.state.fractureType = e.target.value;
        this.runPipeline();
      });
    }

    if (mineralSelect) {
      mineralSelect.addEventListener("change", (e) => {
        this.state.mineral = e.target.value;
        const pal = MINERAL_PALETTES[e.target.value];
        if (pal) {
          this.state.baseColor = pal.baseColor;
          this.state.crackColor = pal.crackColor;
          this.state.oxidationColor = pal.oxidationColor;
          this.updateColorPickers();
          this.viewport.setMineral(e.target.value);
        }
      });
    }

    // Color pickers
    const baseColorPicker = document.getElementById("picker-base-color");
    if (baseColorPicker) {
      baseColorPicker.addEventListener("input", (e) => {
        this.state.baseColor = e.target.value;
        this.viewport.setCustomColors({ baseColor: e.target.value });
      });
    }

    const crackColorPicker = document.getElementById("picker-crack-color");
    if (crackColorPicker) {
      crackColorPicker.addEventListener("input", (e) => {
        this.state.crackColor = e.target.value;
        this.viewport.setCustomColors({ crackColor: e.target.value });
      });
    }

    const oxColorPicker = document.getElementById("picker-ox-color");
    if (oxColorPicker) {
      oxColorPicker.addEventListener("input", (e) => {
        this.state.oxidationColor = e.target.value;
        this.viewport.setCustomColors({ oxidationColor: e.target.value });
      });
    }

    // Sliders
    this.bindSlider("slider-facets", "facets", (v) => parseInt(v), "val-facets");
    this.bindSlider("slider-roundness", "baseRoundness", (v) => parseFloat(v), "val-roundness");
    this.bindSlider("slider-noise-amp", "noiseAmp", (v) => parseFloat(v), "val-noise-amp");
    this.bindSlider("slider-strata-amp", "strataAmp", (v) => parseFloat(v), "val-strata-amp");
    this.bindSlider("slider-strata-dip", "strataDip", (v) => parseFloat(v), "val-strata-dip", "°");

    this.bindSlider("slider-crack-density", "crackDensity", (v) => parseFloat(v), "val-crack-density");
    this.bindSlider("slider-aperture", "aperture", (v) => parseFloat(v), "val-aperture", "m");
    this.bindSlider("slider-branching", "branching", (v) => parseFloat(v), "val-branching");
    this.bindSlider("slider-jaggedness", "jaggedness", (v) => parseFloat(v), "val-jaggedness");
    this.bindSlider("slider-explode", "explode", (v) => parseFloat(v), "val-explode", "x");

    // Sharp Planar Chipped Cuts sliders
    this.bindSlider("slider-chip-density", "chipDensity", (v) => parseFloat(v), "val-chip-density");
    this.bindSlider("slider-chip-depth", "chipDepth", (v) => parseFloat(v), "val-chip-depth", "m");
    this.bindSlider("slider-chip-scale", "chipScale", (v) => parseFloat(v), "val-chip-scale", "m");

    this.bindSlider("slider-frost-wedging", "frostWedging", (v) => parseFloat(v), "val-frost-wedging");
    this.bindSlider("slider-edge-bevel", "edgeBevel", (v) => parseFloat(v), "val-edge-bevel");
    this.bindSlider("slider-dissolution", "dissolution", (v) => parseFloat(v), "val-dissolution");
    this.bindSlider("slider-sediment", "sedimentFill", (v) => parseFloat(v), "val-sediment");
    this.bindSlider("slider-erosion-iter", "iterations", (v) => parseInt(v), "val-erosion-iter");

    // Mesh LOD selection
    const lodButtons = document.querySelectorAll(".lod-btn");
    lodButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        lodButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.lodStep = parseInt(btn.dataset.step || "1");
        this.displayCurrentPhase();
      });
    });

    // Viewport Mode buttons
    const modeButtons = document.querySelectorAll(".mode-btn");
    modeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        modeButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const mode = parseInt(btn.dataset.mode || "0");
        this.viewport.setViewMode(mode);
      });
    });

    // Wireframe toggle
    const wireBtn = document.getElementById("btn-wireframe");
    if (wireBtn) {
      wireBtn.addEventListener("click", () => {
        const active = wireBtn.classList.toggle("active");
        this.viewport.setWireframe(active);
      });
    }

    // Slicer controls
    const slicerToggle = document.getElementById("toggle-slicer");
    const slicerSlider = document.getElementById("slider-slicer-dist");
    const slicerAxis = document.getElementById("select-slicer-axis");

    const updateSlicer = () => {
      const enabled = slicerToggle ? slicerToggle.checked : false;
      const dist = slicerSlider ? parseFloat(slicerSlider.value) : 0.0;
      const axis = slicerAxis ? slicerAxis.value : "y";
      this.viewport.setSlicer(enabled, axis, dist);
    };

    if (slicerToggle) slicerToggle.addEventListener("change", updateSlicer);
    if (slicerSlider) slicerSlider.addEventListener("input", updateSlicer);
    if (slicerAxis) slicerAxis.addEventListener("change", updateSlicer);

    // Auto rotate
    const rotateBtn = document.getElementById("btn-autorotate");
    if (rotateBtn) {
      rotateBtn.addEventListener("click", () => {
        const active = rotateBtn.classList.toggle("active");
        this.viewport.autoRotate = active;
      });
    }

    // Reset camera
    const resetCamBtn = document.getElementById("btn-reset-cam");
    if (resetCamBtn) {
      resetCamBtn.addEventListener("click", () => this.viewport.resetCamera());
    }

    // Action buttons
    const reseedBtn = document.getElementById("btn-randomize-seed");
    if (reseedBtn) {
      reseedBtn.addEventListener("click", () => {
        this.state.seed = Math.floor(Math.random() * 999999);
        this.runPipeline();
      });
    }

    const recomputeBtn = document.getElementById("btn-recompute");
    if (recomputeBtn) {
      recomputeBtn.addEventListener("click", () => this.runPipeline());
    }

    // Exporters
    const exportObjBtn = document.getElementById("btn-export-obj");
    if (exportObjBtn) {
      exportObjBtn.addEventListener("click", () => this.exportOBJ());
    }
  }

  bindSlider(sliderId, stateKey, parser, labelId, unit = "") {
    const slider = document.getElementById(sliderId);
    const label = document.getElementById(labelId);
    if (!slider) return;

    slider.addEventListener("input", (e) => {
      const val = parser(e.target.value);
      this.state[stateKey] = val;
      if (label) label.textContent = `${e.target.value}${unit}`;
      this.runPipeline();
    });
  }

  applyPreset(presetKey) {
    const p = ROCK_PRESETS[presetKey];
    if (!p) return;

    this.state.preset = presetKey;
    this.state.facets = p.facets || 14;
    this.state.baseRoundness = p.baseRoundness !== undefined ? p.baseRoundness : 0.25;
    this.state.noiseAmp = p.noiseAmp !== undefined ? p.noiseAmp : 0.12;
    this.state.noiseFreq = p.noiseFreq !== undefined ? p.noiseFreq : 0.85;
    this.state.strataAmp = p.strataAmp !== undefined ? p.strataAmp : 0.04;
    this.state.strataFreq = p.strataFreq || 2.2;
    this.state.strataDip = p.strataDip || 15;
    this.state.rockHardness = p.hardness || 1.4;
    this.state.mineral = p.mineral || "granite";

    const pal = MINERAL_PALETTES[this.state.mineral] || MINERAL_PALETTES.granite;
    this.state.baseColor = pal.baseColor;
    this.state.crackColor = pal.crackColor;
    this.state.oxidationColor = pal.oxidationColor;

    this.syncUIControls();
    this.runPipeline();
  }

  syncUIControls() {
    const setVal = (id, val, lblId, unit = "") => {
      const el = document.getElementById(id);
      if (el) el.value = val;
      const lbl = document.getElementById(lblId);
      if (lbl) lbl.textContent = `${val}${unit}`;
    };

    setVal("slider-facets", this.state.facets, "val-facets");
    setVal("slider-roundness", this.state.baseRoundness, "val-roundness");
    setVal("slider-noise-amp", this.state.noiseAmp, "val-noise-amp");
    setVal("slider-strata-amp", this.state.strataAmp, "val-strata-amp");
    setVal("slider-strata-dip", this.state.strataDip, "val-strata-dip", "°");

    setVal("slider-crack-density", this.state.crackDensity, "val-crack-density");
    setVal("slider-aperture", this.state.aperture, "val-aperture", "m");
    setVal("slider-branching", this.state.branching, "val-branching");
    setVal("slider-jaggedness", this.state.jaggedness, "val-jaggedness");
    setVal("slider-explode", this.state.explode || 0.0, "val-explode", "x");

    setVal("slider-chip-density", this.state.chipDensity, "val-chip-density");
    setVal("slider-chip-depth", this.state.chipDepth, "val-chip-depth", "m");
    setVal("slider-chip-scale", this.state.chipScale, "val-chip-scale", "m");

    setVal("slider-frost-wedging", this.state.frostWedging, "val-frost-wedging");
    setVal("slider-edge-bevel", this.state.edgeBevel, "val-edge-bevel");
    setVal("slider-dissolution", this.state.dissolution, "val-dissolution");
    setVal("slider-sediment", this.state.sedimentFill, "val-sediment");
    setVal("slider-erosion-iter", this.state.iterations, "val-erosion-iter");

    const presetSel = document.getElementById("rock-preset-select");
    if (presetSel) presetSel.value = this.state.preset;

    const minSel = document.getElementById("mineral-preset-select");
    if (minSel) minSel.value = this.state.mineral;

    this.updateColorPickers();
  }

  updateColorPickers() {
    const bPick = document.getElementById("picker-base-color");
    if (bPick) bPick.value = this.state.baseColor;
    const cPick = document.getElementById("picker-crack-color");
    if (cPick) cPick.value = this.state.crackColor;
    const oPick = document.getElementById("picker-ox-color");
    if (oPick) oPick.value = this.state.oxidationColor;
  }

  /**
   * Set active geological phase (1 to 4)
   */
  setPhase(phaseIndex) {
    this.currentPhase = Math.max(1, Math.min(4, phaseIndex));

    // Update Phase buttons
    const phaseBtns = document.querySelectorAll(".phase-step-btn");
    phaseBtns.forEach((btn) => {
      const p = parseInt(btn.dataset.phase || "1");
      btn.classList.toggle("active", p === this.currentPhase);
    });

    // Update Step cards in left sidebar
    for (let i = 1; i <= 4; i++) {
      const card = document.getElementById(`card-step-${i}`);
      if (card) {
        card.classList.toggle("active", i === this.currentPhase);
      }
    }

    // Update Prev / Next button states
    const prevBtn = document.getElementById("btn-prev-phase");
    if (prevBtn) prevBtn.disabled = this.currentPhase === 1;
    const nextBtn = document.getElementById("btn-next-phase");
    if (nextBtn) nextBtn.disabled = this.currentPhase === 4;

    // Display the corresponding stage in 3D viewport
    this.displayCurrentPhase();
  }

  /**
   * Run full physical simulation pipeline
   */
  runPipeline() {
    const t0 = performance.now();

    // Step 1: Base Rock SDF
    const baseRockResult = this.rockGen.generate({
      seed: this.state.seed,
      shapeType: ROCK_PRESETS[this.state.preset]?.shapeType || "polyhedral",
      facets: this.state.facets,
      baseRoundness: this.state.baseRoundness,
      noiseAmp: this.state.noiseAmp,
      noiseFreq: this.state.noiseFreq,
      strataAmp: this.state.strataAmp,
      strataFreq: this.state.strataFreq,
      strataDip: this.state.strataDip,
      hardness: this.state.rockHardness,
    });

    // Step 2: 3D Fracture Dynamics & Sharp Planar Chipped Cuts
    const fractureResult = this.fractureEngine.generateFracture(baseRockResult.sdf, {
      seed: this.state.seed + 101,
      fractureType: this.state.fractureType,
      crackDensity: this.state.crackDensity,
      aperture: this.state.aperture,
      depthReach: this.state.depthReach,
      branching: this.state.branching,
      jaggedness: this.state.jaggedness,
      strataDip: this.state.strataDip,
      explode: this.state.explode,
      chipDensity: this.state.chipDensity,
      chipDepth: this.state.chipDepth,
      chipScale: this.state.chipScale,
    });

    // Step 3: 3D SDF Crack Erosion
    const erosionResult = this.erosionEngine.erode(
      baseRockResult.sdf,
      fractureResult,
      baseRockResult.hardness,
      {
        iterations: this.state.iterations,
        frostWedging: this.state.frostWedging,
        edgeBevel: this.state.edgeBevel,
        dissolution: this.state.dissolution,
        sedimentFill: this.state.sedimentFill,
        oxidation: this.state.oxidation,
      }
    );

    this.pipelineData = {
      baseRock: baseRockResult,
      fracture: fractureResult,
      erosion: erosionResult,
    };

    const t1 = performance.now();
    this.updateDiagnostics(erosionResult.diagnostics, (t1 - t0).toFixed(1));

    // Render current active phase
    this.displayCurrentPhase();
  }

  /**
   * Renders the 3D model corresponding to the active phase
   */
  displayCurrentPhase() {
    if (!this.pipelineData) return;

    const { baseRock, fracture, erosion } = this.pipelineData;
    const statusText = document.getElementById("sim-step-status");

    let sdfToExtract = baseRock.sdf;
    let crackMaskAttr = null;
    let erosionDepthAttr = null;
    let sedimentAttr = null;
    let oxidationAttr = null;
    let defaultViewMode = 0;

    switch (this.currentPhase) {
      case 1: // Phase 1: Base Rock Only
        sdfToExtract = baseRock.sdf;
        defaultViewMode = 0; // PBR Shaded
        if (statusText) statusText.textContent = "Phase 1/4: Base Rock Geometry (Clean polyhedral form & strata)";
        break;

      case 2: // Phase 2: Fracture Cracks & Sharp Chipped Cuts
        sdfToExtract = fracture.fracturedRockSDF;
        crackMaskAttr = fracture.crackMask;
        defaultViewMode = 1; // Glowing crack & stress lines
        if (statusText) statusText.textContent = `Phase 2/4: 3D Fracture Dynamics (${fracture.pieceCount} pieces, ${fracture.chipCount} sharp chips)`;
        break;

      case 3: // Phase 3: SDF Crack Erosion
        sdfToExtract = erosion.erodedSDF;
        crackMaskAttr = fracture.crackMask;
        erosionDepthAttr = erosion.erosionDepth;
        sedimentAttr = erosion.cavitySediment;
        oxidationAttr = erosion.oxidationHalo;
        defaultViewMode = 2; // SDF Erosion heatmap
        if (statusText) statusText.textContent = "Phase 3/4: SDF Crack Erosion (Frost wedging & acute beveling)";
        break;

      case 4: // Phase 4: Final Mesh LOD & PBR Shading
      default:
        sdfToExtract = erosion.erodedSDF;
        crackMaskAttr = fracture.crackMask;
        erosionDepthAttr = erosion.erosionDepth;
        sedimentAttr = erosion.cavitySediment;
        oxidationAttr = erosion.oxidationHalo;
        defaultViewMode = 0; // Realistic PBR
        if (statusText) statusText.textContent = "Phase 4/4: Final Weathered Rock & Mesh LOD (Ready for export)";
        break;
    }

    // Update View Mode Toolbar UI
    const modeButtons = document.querySelectorAll(".mode-btn");
    modeButtons.forEach((b) => {
      b.classList.toggle("active", parseInt(b.dataset.mode || "0") === defaultViewMode);
    });
    this.viewport.setViewMode(defaultViewMode);

    // Extract isosurface mesh using Adaptive Marching Cubes
    const meshData = extractIsosurface(
      {
        sdf: sdfToExtract,
        nx: this.gridResolution,
        ny: this.gridResolution,
        nz: this.gridResolution,
        boundsMin: [-1.8, -1.8, -1.8],
        boundsMax: [1.8, 1.8, 1.8],
      },
      {
        isovalue: 0.0,
        step: this.lodStep,
        crackMask: crackMaskAttr,
        erosionDepth: erosionDepthAttr,
        sediment: sedimentAttr,
        oxidation: oxidationAttr,
      }
    );

    this.currentMesh = meshData;
    this.viewport.updateMesh(meshData);
    this.viewport.setMineral(this.state.mineral);
    this.viewport.setCustomColors({
      baseColor: this.state.baseColor,
      crackColor: this.state.crackColor,
      oxidationColor: this.state.oxidationColor,
    });

    // Update poly stats in HUD
    const polyStat = document.getElementById("stat-poly-count");
    if (polyStat) {
      polyStat.textContent = `${meshData.triangleCount.toLocaleString()} tris (${meshData.vertexCount.toLocaleString()} verts)`;
    }
  }

  updateDiagnostics(diag, timeMs) {
    const setTxt = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };

    setTxt("stat-carved-vol", `${(diag.totalCarvedVolumeM3 * 1000).toFixed(2)} dm³`);
    setTxt("stat-max-depth", `${(diag.maxErosionDepthMeters * 100).toFixed(1)} cm`);
    setTxt("stat-compute-time", `${timeMs} ms`);
    setTxt("stat-grid-res", `${this.gridResolution}³ (${(this.gridResolution ** 3).toLocaleString()})`);
  }

  /**
   * Export 3D polygonal mesh as Wavefront OBJ
   */
  exportOBJ() {
    if (!this.currentMesh || !this.currentMesh.positions) return;

    const { positions, normals, uvs, indices } = this.currentMesh;
    let objText = "# Frontier Standalone Rock Crack & SDF Erosion Studio\n";
    objText += `# Phase: ${this.currentPhase}/4, Preset: ${this.state.preset}, Mineral: ${this.state.mineral}\n`;
    objText += `# LOD Step: ${this.lodStep}, Triangles: ${this.currentMesh.triangleCount}\n\n`;

    for (let i = 0; i < positions.length; i += 3) {
      objText += `v ${positions[i].toFixed(4)} ${positions[i + 1].toFixed(4)} ${positions[i + 2].toFixed(4)}\n`;
    }

    for (let i = 0; i < normals.length; i += 3) {
      objText += `vn ${normals[i].toFixed(4)} ${normals[i + 1].toFixed(4)} ${normals[i + 2].toFixed(4)}\n`;
    }

    for (let i = 0; i < uvs.length; i += 2) {
      objText += `vt ${uvs[i].toFixed(4)} ${uvs[i + 1].toFixed(4)}\n`;
    }

    for (let i = 0; i < indices.length; i += 3) {
      const v0 = indices[i] + 1;
      const v1 = indices[i + 1] + 1;
      const v2 = indices[i + 2] + 1;
      objText += `f ${v0}/${v0}/${v0} ${v1}/${v1}/${v1} ${v2}/${v2}/${v2}\n`;
    }

    const blob = new Blob([objText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `eroded_cracked_rock_${this.state.preset}_phase${this.currentPhase}_lod${this.lodStep}.obj`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// Initialize on DOM load
window.addEventListener("DOMContentLoaded", () => {
  window.rockApp = new RockStudioApp();
});
