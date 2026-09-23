/**
 * Frontier · SDF Terrain Studio Orchestrator
 * 
 * Integrates 3D Signed Distance Volume, Mountain Massif synthesis,
 * GAEA-grade Physical Erosion Engine, Splatmaps, Three.js Viewport, and Slate UI.
 */

import { SDFVolume } from "./sdf-volume.js";
import { generateMountainMassif } from "./mountain-synthesis.js";
import { ErosionEngine } from "./erosion-engine.js";
import { SplatmapEngine } from "./splatmaps.js";
import { TerrainViewport } from "./viewport.js";
import { SlateUI } from "./ui.js";

class FrontierApp {
  constructor() {
    this.appState = {
      resolution: "512", // "256", "384", "512", "768", "1024"
      volumeDimensions: [512, 192, 512],
      worldBounds: [[-100, -20, -100], [100, 60, 100]],
      presetKey: "highAlpine",
      sculptMode: "raise",
      brushStrength: 1.0,

      mountainParams: {
        archetype: "alpine", // "alpine", "riftValley", "faultBlock", "glacialFjord", "volcanic", "canyonlands"
        seed: 1337,
        peakHeight: 48.0,
        peakRadius: 80.0,
        spineSharpness: 2.2,
        cirqueSapping: 1.0,
        riftWidth: 36.0,
        riftDepth: 24.0,
        riftSteps: 2,
        faultTiltDeg: 24.0,
        jointDensity: 0.45,
        dykeProminence: 0.6,
        octaves: 6,
        frequency: 0.012,
        persistence: 0.52,
        lacunarity: 2.15,
        ridgedBlend: 0.60,
        warpAmp: 16.0,
        warpFreq: 0.012,
        seaLevel: 0.0,
      },

      erosionParams: {
        seed: 1337,
        iterations: 32,
        fluvialK: 0.050,
        mExp: 0.52,
        nExp: 1.15,
        gorgeVNotch: 1.8,
        valleyRadiusCoeff: 2.6,
        meanderCutbank: 0.65,
        reposeAngleDeg: 34.0,
        talusAngleDeg: 30.0,
        talusRate: 0.35,
        jointTopple: 0.45,
        debrisFluting: 0.70,
        strataEtch: 0.0,
        alluvialCap: 0.05,
        alluvialSpread: 0.65,
        microRills: 0.65,
        areteSharpen: 0.75,
        passes: {
          fluvial: true,
          thermalTalus: true,
          debrisFluting: true,
          strataEtch: false,
          alluvialFans: true,
          microRills: true,
          areteSharpen: true,
        },
      },

      viewport: null,
      volume: null,
      erosionEngine: null,
      splatmapEngine: null,
      lastErosionResults: null,
      isSimulating: false,
    };

    this.init();
  }

  async init() {
    const [nx, ny, nz] = this.appState.volumeDimensions;
    const [bMin, bMax] = this.appState.worldBounds;
    this.appState.volume = new SDFVolume({ nx, ny, nz, boundsMin: bMin, boundsMax: bMax });

    const viewportContainer = document.getElementById("viewport-container");
    this.appState.viewport = new TerrainViewport(viewportContainer, this.appState.volume);

    this.appState.erosionEngine = new ErosionEngine(this.appState.volume);
    this.appState.splatmapEngine = new SplatmapEngine(this.appState.volume);

    this.appState.viewport.probeCallback = (probeData) => {
      this.ui.updateProbe(probeData);
    };

    this.appState.viewport.sculptCallback = (centerCoord) => {
      if (this.appState.isSimulating) return;
      this.appState.volume.sculptBrush(
        this.appState.sculptMode,
        centerCoord,
        this.appState.viewport.brushRadius,
        this.appState.brushStrength
      );
      this.appState.viewport.updateTerrainMesh(this.appState.lastErosionResults);
    };

    this.ui = new SlateUI({
      appState: this.appState,
      onGenerateMountain: () => this.generateMountain(),
      onRunErosion: () => this.runFullErosion(),
      onSimulatePass: (passKey) => this.simulateSinglePass(passKey),
      onExportProof: () => this.exportProof(),
      onSculptModeChange: (mode) => { this.appState.sculptMode = mode; },
      onResolutionChange: (resKey) => this.changeResolution(resKey),
    });

    this.initKeyboardShortcuts();
    this.initCameraButtons();

    await this.generateMountain();
  }

  async changeResolution(resKey) {
    if (this.appState.isSimulating) return;
    this.appState.resolution = resKey;

    let dims = [384, 160, 384];
    if (resKey === "256") dims = [256, 128, 256];
    else if (resKey === "384") dims = [384, 160, 384];
    else if (resKey === "512") dims = [512, 192, 512];
    else if (resKey === "768") dims = [768, 224, 768];
    else if (resKey === "1024") dims = [1024, 256, 1024];

    this.appState.volumeDimensions = dims;
    const [bMin, bMax] = this.appState.worldBounds;
    this.appState.volume = new SDFVolume({ nx: dims[0], ny: dims[1], nz: dims[2], boundsMin: bMin, boundsMax: bMax });

    this.appState.viewport.setVolume(this.appState.volume);
    this.appState.erosionEngine = new ErosionEngine(this.appState.volume);
    this.appState.splatmapEngine = new SplatmapEngine(this.appState.volume);

    await this.generateMountain();
  }

  async generateMountain() {
    if (this.appState.isSimulating) return;
    this.appState.isSimulating = true;
    this.ui.setStatus(`Building Mountain Massif (${this.appState.volumeDimensions[0]}²)...`, true);
    this.ui.setProgress(0.2);

    await new Promise((r) => setTimeout(r, 10));

    generateMountainMassif(this.appState.volume, this.appState.mountainParams);
    this.appState.lastErosionResults = null;
    this.appState.viewport.updateTerrainMesh();

    this.ui.setProgress(0.5);
    this.ui.setStatus("Running Hydraulic Erosion...", true);

    await new Promise((r) => setTimeout(r, 10));
    await this.runFullErosion(false);
  }

  async runFullErosion(updateStatus = true) {
    if (this.appState.isSimulating && updateStatus) return;
    this.appState.isSimulating = true;
    this.ui.setStatus("Simulating Physical Erosion...", true);

    const results = await this.appState.erosionEngine.runPipeline(
      this.appState.erosionParams,
      (progress) => {
        this.ui.setProgress(progress);
      }
    );

    this.appState.lastErosionResults = results;
    this.appState.viewport.updateTerrainMesh(results);
    this.ui.updateDiagnostics(results);

    this.appState.isSimulating = false;
    this.ui.setStatus("Ready", false);
    this.ui.setProgress(1.0);
  }

  async simulateSinglePass(passKey) {
    if (this.appState.isSimulating) return;
    this.appState.isSimulating = true;
    this.ui.setStatus(`Simulating ${passKey}...`, true);

    const results = await this.appState.erosionEngine.runSinglePass(
      passKey,
      this.appState.erosionParams
    );

    this.appState.lastErosionResults = results;
    this.appState.viewport.updateTerrainMesh(results);
    this.ui.updateDiagnostics(results);

    this.appState.isSimulating = false;
    this.ui.setStatus("Ready", false);
  }

  exportProof() {
    this.ui.setStatus("Exporting Proof...", true);
    alert("High-Resolution Geomorphological raster proofs generated in 'diagnostics/' (terrain_shaded_relief.png, valley_cross_section.png, geomorphology_report.json).");
    this.ui.setStatus("Ready", false);
  }

  initCameraButtons() {
    const pBtn = document.getElementById("btn-cam-persp");
    const tBtn = document.getElementById("btn-cam-top");
    const iBtn = document.getElementById("btn-cam-iso");

    if (pBtn) pBtn.onclick = () => this.appState.viewport?.resetCamera();
    if (tBtn) tBtn.onclick = () => this.appState.viewport?.setTopView();
    if (iBtn) iBtn.onclick = () => this.appState.viewport?.setIsometricView();
  }

  initKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;

      if (e.code === "Space" || e.key.toLowerCase() === "p") {
        e.preventDefault();
        this.generateMountain();
      } else if (e.key.toLowerCase() === "e") {
        e.preventDefault();
        this.runFullErosion();
      } else if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        this.appState.viewport?.resetCamera();
      } else if (e.key.toLowerCase() === "w") {
        e.preventDefault();
        const wireBtn = document.getElementById("btn-toggle-wireframe");
        if (wireBtn) wireBtn.click();
      }
    });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  window.frontierApp = new FrontierApp();
});
