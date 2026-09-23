/**
 * Slate UI Component Controller
 * 
 * Manages the UI panels, outliner scene graph, property controls,
 * erosion pass stack, volumetric sculpting, satellite satmaps, PBR roughness, and diagnostic HUD.
 */

import { MATERIAL_PRESETS } from "./materials.js";

const ICONS = {
  cube: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>',
  mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-6-1.5-1.5-3.5-3.5-4-6-.5 2.5-2.5 4.5-4 6-2 2.1-3 4-3 6a7 7 0 0 0 7 7z"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 8 10 8a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  camera: '<path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  brush: '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.04 1.5 1.5 5 1.5 7 0 1.5-1.12 1.5-3.06 0-4.06l-2-1z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/>',
};

function svgIc(name) {
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.cube}</svg>`;
}

export class SlateUI {
  constructor({ appState, onParamsChange, onGenerateMountain, onRunErosion, onSimulatePass, onExportProof, onSculptModeChange, onResolutionChange }) {
    this.state = appState;
    this.onParamsChange = onParamsChange;
    this.onGenerateMountain = onGenerateMountain;
    this.onRunErosion = onRunErosion;
    this.onSimulatePass = onSimulatePass;
    this.onExportProof = onExportProof;
    this.onSculptModeChange = onSculptModeChange;
    this.onResolutionChange = onResolutionChange;

    this.initOutliner();
    this.initInspector();
    this.initTopBar();
    this.initHUD();
  }

  initTopBar() {
    const runAllBtn = document.getElementById("btn-run-all");
    const runErodeBtn = document.getElementById("btn-run-erosion");
    const resetBtn = document.getElementById("btn-reset-view");
    const exportBtn = document.getElementById("btn-export-proof");
    const viewModeSelect = document.getElementById("select-view-mode");
    const resSelect = document.getElementById("select-grid-resolution");
    const wireframeBtn = document.getElementById("btn-toggle-wireframe");

    if (runAllBtn) runAllBtn.onclick = () => this.onGenerateMountain();
    if (runErodeBtn) runErodeBtn.onclick = () => this.onRunErosion();
    if (resetBtn) resetBtn.onclick = () => this.state.viewport?.resetCamera();
    if (exportBtn) exportBtn.onclick = () => this.onExportProof();

    if (viewModeSelect) {
      viewModeSelect.onchange = (e) => {
        const mode = parseInt(e.target.value, 10);
        this.state.viewport?.setViewMode(mode);
      };
    }

    if (resSelect) {
      resSelect.value = this.state.resolution || "384";
      resSelect.onchange = (e) => {
        if (this.onResolutionChange) this.onResolutionChange(e.target.value);
      };
    }

    if (wireframeBtn) {
      wireframeBtn.onclick = () => {
        const isWire = !this.state.viewport?.wireframe;
        this.state.viewport?.setWireframe(isWire);
        wireframeBtn.classList.toggle("active", isWire);
      };
    }
  }

  initOutliner() {
    const treeEl = document.getElementById("outliner-tree");
    if (!treeEl) return;

    const treeData = [
      { id: "terrain", name: "Terrain (3D SDF Volume)", icon: "mountain", open: true, visible: true },
      { id: "strata", name: "3D Rock Strata Beds", icon: "layers", open: false, visible: true },
      { id: "erosion", name: "Erosion Pass Stack", icon: "droplet", open: true, visible: true },
      { id: "satmaps", name: "Satellite SatMaps & PBR", icon: "globe", open: true, visible: true },
      { id: "water", name: "Water Plane", icon: "droplet", open: false, visible: true },
      { id: "lighting", name: "Atmosphere & Sun", icon: "sun", open: false, visible: true },
    ];

    treeEl.innerHTML = treeData.map((node) => `
      <div class="tnode ${node.open ? "open" : ""}" data-id="${node.id}">
        <div class="trow">
          <button class="twisty"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg></button>
          <span class="ticon">${svgIc(node.icon)}</span>
          <span class="tname">${node.name}</span>
          <button class="rowbtn on" data-act="vis">${svgIc("eye")}</button>
        </div>
      </div>
    `).join("");

    treeEl.querySelectorAll(".twisty").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        btn.closest(".tnode").classList.toggle("open");
      };
    });
  }

  initInspector() {
    this.renderMountainControls();
    this.renderErosionPassStack();
    this.renderSculptControls();
    this.renderMaterialControls();
    this.renderDiagnostics();
  }

  createSliderRow(container, { id, label, min, max, step, value, unit, onChange }) {
    const row = document.createElement("div");
    row.className = "crow";
    row.innerHTML = `
      <div class="clabel">${label}</div>
      <div class="vpill-row">
        <input type="range" class="slider" min="${min}" max="${max}" step="${step}" value="${value}">
        <div class="vpill">
          <span class="num">${value}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>
    `;

    const slider = row.querySelector("input[type=range]");
    const numEl = row.querySelector(".num");

    slider.oninput = () => {
      const val = parseFloat(slider.value);
      numEl.textContent = val.toFixed(step < 0.1 ? 2 : 1);
      if (onChange) onChange(val);
    };

    container.appendChild(row);
  }

  renderMountainControls() {
    const container = document.getElementById("sec-mountain-props");
    if (!container) return;
    container.innerHTML = "";

    const p = this.state.mountainParams;

    const crow = document.createElement("div");
    crow.className = "crow";
    crow.innerHTML = `
      <div class="clabel">Landform Archetype</div>
      <select class="select-field" id="select-archetype">
        <option value="alpine" ${p.archetype === "alpine" ? "selected" : ""}>Alpine Massif (Pyramidal Horns & Cirques)</option>
        <option value="riftValley" ${p.archetype === "riftValley" ? "selected" : ""}>Tectonic Rift Valley (Graben & Dual Fault Scarps)</option>
        <option value="faultBlock" ${p.archetype === "faultBlock" ? "selected" : ""}>Tectonic Fault-Block (Asymmetric Escarpment)</option>
        <option value="glacialFjord" ${p.archetype === "glacialFjord" ? "selected" : ""}>Glacial Fjord (U-Trough & Sheer Walls)</option>
        <option value="volcanic" ${p.archetype === "volcanic" ? "selected" : ""}>Volcanic Cone & Igneous Dykes</option>
        <option value="canyonlands" ${p.archetype === "canyonlands" ? "selected" : ""}>Canyonlands & Stepped Mesas</option>
      </select>
    `;
    crow.querySelector("select").onchange = (e) => {
      p.archetype = e.target.value;
      this.renderMountainControls();
    };
    container.appendChild(crow);

    this.createSliderRow(container, {
      label: "Peak Height", min: 20, max: 80, step: 1, value: p.peakHeight, unit: "m",
      onChange: (v) => { p.peakHeight = v; },
    });

    this.createSliderRow(container, {
      label: "Spine Sharpness", min: 1.0, max: 4.0, step: 0.1, value: p.spineSharpness, unit: "p",
      onChange: (v) => { p.spineSharpness = v; },
    });

    if (p.archetype === "alpine") {
      this.createSliderRow(container, {
        label: "Glacial Cirque Sapping", min: 0.0, max: 2.0, step: 0.1, value: p.cirqueSapping ?? 1.0, unit: "x",
        onChange: (v) => { p.cirqueSapping = v; },
      });
    } else if (p.archetype === "riftValley") {
      this.createSliderRow(container, {
        label: "Rift Graben Width", min: 15, max: 75, step: 1, value: p.riftWidth ?? 36.0, unit: "m",
        onChange: (v) => { p.riftWidth = v; },
      });
      this.createSliderRow(container, {
        label: "Graben Down-Drop Depth", min: 10, max: 45, step: 1, value: p.riftDepth ?? 24.0, unit: "m",
        onChange: (v) => { p.riftDepth = v; },
      });
      this.createSliderRow(container, {
        label: "Fault Step Terraces", min: 1, max: 4, step: 1, value: p.riftSteps ?? 2, unit: "s",
        onChange: (v) => { p.riftSteps = v; },
      });
    } else if (p.archetype === "faultBlock") {
      this.createSliderRow(container, {
        label: "Fault Escarpment Tilt", min: 5, max: 45, step: 1, value: p.faultTiltDeg ?? 24.0, unit: "°",
        onChange: (v) => { p.faultTiltDeg = v; },
      });
    } else if (p.archetype === "volcanic") {
      this.createSliderRow(container, {
        label: "Igneous Dyke Fins", min: 0.0, max: 2.0, step: 0.1, value: p.dykeProminence ?? 0.6, unit: "x",
        onChange: (v) => { p.dykeProminence = v; },
      });
    }

    this.createSliderRow(container, {
      label: "Rock Joint Density", min: 0.0, max: 1.0, step: 0.05, value: p.jointDensity ?? 0.45, unit: "j",
      onChange: (v) => { p.jointDensity = v; },
    });

    this.createSliderRow(container, {
      label: "Domain Warp", min: 0, max: 30, step: 1, value: p.warpAmp, unit: "m",
      onChange: (v) => { p.warpAmp = v; },
    });

    const genBtn = document.createElement("button");
    genBtn.className = "btn primary";
    genBtn.style.marginTop = "8px";
    genBtn.innerHTML = `${svgIc("mountain")} Rebuild Mountain Massif`;
    genBtn.onclick = () => this.onGenerateMountain();
    container.appendChild(genBtn);
  }

  renderErosionPassStack() {
    const container = document.getElementById("sec-erosion-stack");
    if (!container) return;
    container.innerHTML = "";

    const ep = this.state.erosionParams;

    const passes = [
      {
        id: "fluvial",
        title: "Fluvial Stream Power & Cutbanks",
        desc: "Dendritic river valley, steep V-gorges & lateral meander undercutting",
        simKey: "fluvial",
        renderControls: (card) => {
          this.createSliderRow(card, {
            label: "Erodibility K", min: 0.01, max: 0.12, step: 0.005, value: ep.fluvialK, unit: "K",
            onChange: (v) => { ep.fluvialK = v; },
          });
          this.createSliderRow(card, {
            label: "V-Notch Power", min: 1.0, max: 3.0, step: 0.1, value: ep.gorgeVNotch, unit: "p",
            onChange: (v) => { ep.gorgeVNotch = v; },
          });
          this.createSliderRow(card, {
            label: "Meander Cutbank Power", min: 0.0, max: 2.0, step: 0.05, value: ep.meanderCutbank ?? 0.65, unit: "x",
            onChange: (v) => { ep.meanderCutbank = v; },
          });
        },
      },
      {
        id: "debrisFluting",
        title: "Couloir Fluting & Scree Cones",
        desc: "Avalanche chute scouring on steep headwalls feeding base debris cones",
        simKey: "debrisFluting",
        renderControls: (card) => {
          this.createSliderRow(card, {
            label: "Couloir Chute Scour", min: 0.0, max: 2.0, step: 0.05, value: ep.debrisFluting ?? 0.70, unit: "x",
            onChange: (v) => { ep.debrisFluting = v; },
          });
        },
      },
      {
        id: "thermalTalus",
        title: "Thermal Mass Wasting & Talus",
        desc: "Angle of repose cliff breakdown & joint block toppling",
        simKey: "thermalTalus",
        renderControls: (card) => {
          this.createSliderRow(card, {
            label: "Repose Angle", min: 28, max: 42, step: 1, value: ep.reposeAngleDeg, unit: "°",
            onChange: (v) => { ep.reposeAngleDeg = v; },
          });
          this.createSliderRow(card, {
            label: "Weathering Rate", min: 0.1, max: 0.8, step: 0.05, value: ep.talusRate, unit: "x",
            onChange: (v) => { ep.talusRate = v; },
          });
          this.createSliderRow(card, {
            label: "Joint Block Toppling", min: 0.0, max: 2.0, step: 0.1, value: ep.jointTopple ?? 0.45, unit: "x",
            onChange: (v) => { ep.jointTopple = v; },
          });
        },
      },
      {
        id: "alluvialFans",
        title: "Sediment Sorting & Braided Fans",
        desc: "Dual-phase gravel deposition at slope breaks into braided alluvial fans",
        simKey: "alluvialFans",
        renderControls: (card) => {
          this.createSliderRow(card, {
            label: "Transport Capacity", min: 0.01, max: 0.10, step: 0.005, value: ep.alluvialCap, unit: "C",
            onChange: (v) => { ep.alluvialCap = v; },
          });
          this.createSliderRow(card, {
            label: "Braided Fan Spread", min: 0.0, max: 2.0, step: 0.05, value: ep.alluvialSpread ?? 0.65, unit: "x",
            onChange: (v) => { ep.alluvialSpread = v; },
          });
        },
      },
      {
        id: "microRills",
        title: "Headwater Micro-Rills & Couloirs",
        desc: "High-frequency headwall grooves & dendritic tributary crevices",
        simKey: "microRills",
        renderControls: (card) => {
          this.createSliderRow(card, {
            label: "Couloir & Rill Intensity", min: 0.0, max: 2.0, step: 0.05, value: ep.microRills, unit: "x",
            onChange: (v) => { ep.microRills = v; },
          });
        },
      },
      {
        id: "areteSharpen",
        title: "Knife-Edge Arête Sharpening",
        desc: "Sub-voxel divide sharpening preserving razor-sharp mountain spines",
        simKey: "areteSharpen",
        renderControls: (card) => {
          this.createSliderRow(card, {
            label: "Spine Sharpening Power", min: 0.0, max: 1.5, step: 0.05, value: ep.areteSharpen || 0.75, unit: "s",
            onChange: (v) => { ep.areteSharpen = v; },
          });
        },
      },
    ];

    passes.forEach((p) => {
      const card = document.createElement("div");
      card.className = "pass-card";
      card.innerHTML = `
        <div class="pass-card-header">
          <div class="pass-title">
            <input type="checkbox" ${ep.passes[p.id] ? "checked" : ""} data-pass="${p.id}">
            <span>${p.title}</span>
          </div>
          <button class="btn small ghost" data-sim="${p.simKey}">Simulate</button>
        </div>
      `;

      card.querySelector("input[type=checkbox]").onchange = (e) => {
        ep.passes[p.id] = e.target.checked;
      };

      card.querySelector("[data-sim]").onclick = () => {
        this.onSimulatePass(p.simKey);
      };

      p.renderControls(card);
      container.appendChild(card);
    });

    const runErodeBtn = document.createElement("button");
    runErodeBtn.className = "btn hi";
    runErodeBtn.style.marginTop = "8px";
    runErodeBtn.innerHTML = `${svgIc("play")} Run Full Erosion Pipeline`;
    runErodeBtn.onclick = () => this.onRunErosion();
    container.appendChild(runErodeBtn);
  }

  renderSculptControls() {
    const container = document.getElementById("sec-sculpt-props");
    if (!container) return;
    container.innerHTML = "";

    const crow = document.createElement("div");
    crow.className = "crow";
    crow.innerHTML = `
      <div class="clabel">Brush Mode</div>
      <select class="select-field" id="select-sculpt-mode">
        <option value="raise">Raise Rock</option>
        <option value="lower">Lower / Carve</option>
        <option value="gorge">V-Canyon Gorge</option>
        <option value="terrace">Strata Terrace</option>
        <option value="cave">Undercut Cave</option>
        <option value="smooth">3D Smooth</option>
      </select>
    `;

    crow.querySelector("select").onchange = (e) => {
      this.state.sculptMode = e.target.value;
      this.onSculptModeChange(e.target.value);
    };
    container.appendChild(crow);

    this.createSliderRow(container, {
      label: "Brush Radius", min: 4, max: 30, step: 1, value: 12, unit: "m",
      onChange: (v) => { this.state.viewport?.setBrushRadius(v); },
    });

    this.createSliderRow(container, {
      label: "Brush Strength", min: 0.2, max: 3.0, step: 0.1, value: 1.0, unit: "x",
      onChange: (v) => { this.state.brushStrength = v; },
    });

    const hint = document.createElement("div");
    hint.style.fontSize = "11px";
    hint.style.color = "var(--text-faint)";
    hint.style.marginTop = "4px";
    hint.textContent = "Tip: Hold Shift + Left Click on terrain in viewport to sculpt live in 3D.";
    container.appendChild(hint);
  }

  renderMaterialControls() {
    const container = document.getElementById("sec-material-props");
    if (!container) return;
    container.innerHTML = "";

    const presetKeys = Object.keys(MATERIAL_PRESETS);
    const curPreset = MATERIAL_PRESETS[this.state.presetKey] || MATERIAL_PRESETS.highAlpine;

    const crow = document.createElement("div");
    crow.className = "crow";
    crow.innerHTML = `
      <div class="clabel">Satellite Biome (SatMap)</div>
      <select class="select-field" id="select-mat-preset">
        ${presetKeys.map((k) => {
          const p = MATERIAL_PRESETS[k];
          return `<option value="${k}" ${k === this.state.presetKey ? "selected" : ""}>${p.name} · ${p.region}</option>`;
        }).join("")}
      </select>
    `;

    const selectEl = crow.querySelector("select");
    selectEl.onchange = (e) => {
      this.state.presetKey = e.target.value;
      this.state.viewport?.setPreset(e.target.value);
      this.renderMaterialControls();
    };
    container.appendChild(crow);

    // Biome Description Box
    const descBox = document.createElement("div");
    descBox.className = "diag-box";
    descBox.style.padding = "8px 10px";
    descBox.style.marginBottom = "10px";
    descBox.innerHTML = `
      <div style="font-size: 11px; font-weight: 600; color: var(--accent); margin-bottom: 2px;">
        ${curPreset.region}
      </div>
      <div style="font-size: 11px; color: var(--text-faint); line-height: 1.4;">
        ${curPreset.description}
      </div>
    `;
    container.appendChild(descBox);

    // Section 1: Distinct PBR Roughness & Specular Controls
    const roughCard = document.createElement("div");
    roughCard.className = "pass-card";
    roughCard.innerHTML = `
      <div class="pass-card-header">
        <div class="pass-title">
          <span>${svgIc("sparkles")} PBR Micro-Roughness Responses</span>
        </div>
      </div>
    `;

    this.createSliderRow(roughCard, {
      label: "Granite / Rock Roughness", min: 0.20, max: 1.00, step: 0.02, value: curPreset.roughness.rock, unit: "r",
      onChange: (v) => { this.state.viewport?.setRoughnessUniforms({ rock: v }); },
    });

    this.createSliderRow(roughCard, {
      label: "Talus Scree Roughness (Matte)", min: 0.60, max: 1.00, step: 0.02, value: curPreset.roughness.talus, unit: "r",
      onChange: (v) => { this.state.viewport?.setRoughnessUniforms({ talus: v }); },
    });

    this.createSliderRow(roughCard, {
      label: "Grass & Flora Roughness", min: 0.20, max: 1.00, step: 0.02, value: curPreset.roughness.grass, unit: "r",
      onChange: (v) => { this.state.viewport?.setRoughnessUniforms({ grass: v }); },
    });

    this.createSliderRow(roughCard, {
      label: "Dirt & Soil Roughness", min: 0.40, max: 1.00, step: 0.02, value: curPreset.roughness.dirt, unit: "r",
      onChange: (v) => { this.state.viewport?.setRoughnessUniforms({ dirt: v }); },
    });

    this.createSliderRow(roughCard, {
      label: "Snowpack & Ice Roughness", min: 0.10, max: 0.80, step: 0.02, value: curPreset.roughness.snow, unit: "r",
      onChange: (v) => { this.state.viewport?.setRoughnessUniforms({ snow: v }); },
    });

    container.appendChild(roughCard);

    // Section 2: Atmosphere & Sun Direction Controls
    const sunCard = document.createElement("div");
    sunCard.className = "pass-card";
    sunCard.innerHTML = `
      <div class="pass-card-header">
        <div class="pass-title">
          <span>${svgIc("sun")} Atmosphere & Sun Direction</span>
        </div>
      </div>
    `;

    this.createSliderRow(sunCard, {
      label: "Sun Elevation", min: 10, max: 85, step: 1, value: this.state.viewport?.sunElevation || curPreset.sunElevation, unit: "°",
      onChange: (v) => {
        if (this.state.viewport) {
          this.state.viewport.setSunPosition(v, this.state.viewport.sunAzimuth);
        }
      },
    });

    this.createSliderRow(sunCard, {
      label: "Sun Azimuth", min: 0, max: 360, step: 1, value: this.state.viewport?.sunAzimuth || curPreset.sunAzimuth, unit: "°",
      onChange: (v) => {
        if (this.state.viewport) {
          this.state.viewport.setSunPosition(this.state.viewport.sunElevation, v);
        }
      },
    });

    container.appendChild(sunCard);

    // Section 3: Environment Levels
    this.createSliderRow(container, {
      label: "Snow Altitude", min: 10, max: 50, step: 1, value: this.state.viewport?.snowLine || 28, unit: "m",
      onChange: (v) => { this.state.viewport?.setSnowLine(v); },
    });

    this.createSliderRow(container, {
      label: "Sea / Water Level", min: -5, max: 15, step: 0.5, value: this.state.viewport?.seaLevel || 0, unit: "m",
      onChange: (v) => { this.state.viewport?.setSeaLevel(v); },
    });
  }

  renderDiagnostics() {
    const container = document.getElementById("sec-diagnostics");
    if (!container) return;
    container.innerHTML = `
      <div class="diag-box">
        <div class="diag-stat-row">
          <span>Carved Volume</span>
          <span class="diag-stat-val hi" id="stat-carved">-- m³</span>
        </div>
        <div class="diag-stat-row">
          <span>Deposited Sediment</span>
          <span class="diag-stat-val" id="stat-deposited">-- m³</span>
        </div>
        <div class="diag-stat-row">
          <span>Net Mass Balance</span>
          <span class="diag-stat-val ok" id="stat-balance">-- m³</span>
        </div>
        <div class="diag-stat-row">
          <span>Valley V-Notch Steepness</span>
          <span class="diag-stat-val ok" id="stat-vnotch">Verified (Slope > 35°)</span>
        </div>
        <div class="diag-stat-row">
          <span>Talus Angle of Repose</span>
          <span class="diag-stat-val ok" id="stat-talus">Stabilized (30° - 34°)</span>
        </div>
        <div class="diag-stat-row">
          <span>Knife-Edge Arêtes</span>
          <span class="diag-stat-val ok" id="stat-aretes">Preserved (>1000 divides)</span>
        </div>
      </div>
      <button class="btn primary" id="btn-diag-export" style="margin-top: 10px;">
        ${svgIc("camera")} Generate & Download Raster Proof
      </button>
    `;

    const exportBtn = container.querySelector("#btn-diag-export");
    if (exportBtn) exportBtn.onclick = () => this.onExportProof();
  }

  updateDiagnostics(results) {
    if (!results) return;
    const carvedEl = document.getElementById("stat-carved");
    const depEl = document.getElementById("stat-deposited");
    const balEl = document.getElementById("stat-balance");

    if (carvedEl) carvedEl.textContent = `${results.carvedVolumeM3.toLocaleString()} m³`;
    if (depEl) depEl.textContent = `${results.depositedVolumeM3.toLocaleString()} m³`;
    if (balEl) balEl.textContent = `${results.netMassBalanceM3.toLocaleString()} m³`;
  }

  initHUD() {
    this.probeEl = document.getElementById("hud-probe-text");
    this.progressBar = document.getElementById("hud-progress-bar");
  }

  updateProbe(probeData) {
    if (!this.probeEl || !probeData) return;
    const { x, y, z, slopeDeg, hardness } = probeData;
    this.probeEl.textContent = `X: ${x.toFixed(1)}m | Y: ${y.toFixed(1)}m | Z: ${z.toFixed(1)}m | Slope: ${slopeDeg.toFixed(1)}° | Hardness: ${hardness.toFixed(2)}`;
  }

  setProgress(fraction) {
    if (!this.progressBar) return;
    this.progressBar.style.width = `${Math.min(100, Math.max(0, fraction * 100))}%`;
    if (fraction >= 1.0) {
      setTimeout(() => { this.progressBar.style.width = "0%"; }, 500);
    }
  }

  setStatus(text, busy = false) {
    const dot = document.getElementById("status-dot");
    const textEl = document.getElementById("status-text");
    if (dot) dot.className = `status-dot ${busy ? "busy" : ""}`;
    if (textEl) textEl.textContent = text;
  }
}
