/**
 * Frontier · Standalone PBR Sand & Texture Studio Controller
 * 
 * Orchestrates 3D SDF rock synthesis, Voronoi quartz crystal sand grains,
 * interactive color pickers, 3D WebGL PBR viewport, 2D map viewer, and 2K map export.
 */

import { SandTextureGenerator } from "./sand-generator.js";
import { TexturePreviewViewport } from "./texture-preview.js";

function rgbToHex([r, g, b]) {
  const to255 = (c) => Math.floor(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, "0");
  return `#${to255(r)}${to255(g)}${to255(b)}`;
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  return [
    ((num >> 16) & 255) / 255,
    ((num >> 8) & 255) / 255,
    (num & 255) / 255,
  ];
}

const COLOR_SWATCHES = [
  {
    name: "🏜️ Sahara Golden Quartz",
    colors: {
      sandColorBase: [0.88, 0.76, 0.54],
      sandColorMineral: [0.94, 0.68, 0.44],
      sandColorDark: [0.65, 0.50, 0.35],
      fleckColor: [0.14, 0.13, 0.13],
      stoneColor1: [0.52, 0.48, 0.44],
      stoneColor2: [0.88, 0.84, 0.78],
    },
  },
  {
    name: "🦩 Bermuda Pink Coral",
    colors: {
      sandColorBase: [0.96, 0.82, 0.76],
      sandColorMineral: [0.92, 0.62, 0.55],
      sandColorDark: [0.72, 0.46, 0.40],
      fleckColor: [0.24, 0.14, 0.14],
      stoneColor1: [0.70, 0.52, 0.48],
      stoneColor2: [0.98, 0.90, 0.86],
    },
  },
  {
    name: "🌋 Icelandic Black Basalt",
    colors: {
      sandColorBase: [0.18, 0.18, 0.20],
      sandColorMineral: [0.28, 0.28, 0.32],
      sandColorDark: [0.08, 0.08, 0.10],
      fleckColor: [0.38, 0.35, 0.28],
      stoneColor1: [0.14, 0.14, 0.16],
      stoneColor2: [0.42, 0.40, 0.36],
    },
  },
  {
    name: "🌴 Hawaiian Green Olivine",
    colors: {
      sandColorBase: [0.70, 0.72, 0.40],
      sandColorMineral: [0.78, 0.84, 0.46],
      sandColorDark: [0.44, 0.46, 0.22],
      fleckColor: [0.12, 0.14, 0.08],
      stoneColor1: [0.36, 0.38, 0.28],
      stoneColor2: [0.82, 0.86, 0.60],
    },
  },
  {
    name: "🚀 Atacama Martian Red",
    colors: {
      sandColorBase: [0.78, 0.38, 0.22],
      sandColorMineral: [0.88, 0.48, 0.28],
      sandColorDark: [0.52, 0.20, 0.10],
      fleckColor: [0.16, 0.10, 0.08],
      stoneColor1: [0.32, 0.18, 0.14],
      stoneColor2: [0.85, 0.55, 0.35],
    },
  },
  {
    name: "🐚 Maldives White Calcite",
    colors: {
      sandColorBase: [0.96, 0.95, 0.92],
      sandColorMineral: [0.92, 0.86, 0.78],
      sandColorDark: [0.78, 0.74, 0.70],
      fleckColor: [0.35, 0.32, 0.30],
      stoneColor1: [0.65, 0.62, 0.58],
      stoneColor2: [0.98, 0.96, 0.94],
    },
  },
  {
    name: "🏞️ Mountain Riverbed Cobbles",
    colors: {
      sandColorBase: [0.62, 0.60, 0.56],
      sandColorMineral: [0.74, 0.62, 0.48],
      sandColorDark: [0.38, 0.35, 0.32],
      fleckColor: [0.16, 0.15, 0.14],
      stoneColor1: [0.45, 0.44, 0.45],
      stoneColor2: [0.78, 0.74, 0.68],
    },
  },
];

const PRESETS = {
  quartzBeach: {
    name: "Golden Quartz Sand (Multi-Spectral Minerals & Mixed Stones)",
    desc: "Sub-millimeter crystalline quartz, feldspar, carnelian, and olivine grains with angular & discoid river stones",
    params: {
      grainScale: 110.0,
      crystalSparkle: 1.0,
      mineralVariety: 0.85,
      magnetiteFlecks: 0.35,
      pebbleEnable: true,
      pebbleDensity: 22,
      pebbleMinSize: 14,
      pebbleMaxSize: 54,
      pebbleHeight: 0.85,
      rockVariety: "mixed",
      wetness: 0.0,
      sandColorBase: [0.88, 0.76, 0.54],
      sandColorMineral: [0.94, 0.68, 0.44],
      sandColorDark: [0.65, 0.50, 0.35],
      fleckColor: [0.12, 0.12, 0.14],
      stoneColor1: [0.48, 0.46, 0.48],
      stoneColor2: [0.85, 0.82, 0.78],
    },
  },
  angularGravel: {
    name: "Alpine Angular Scree & Crystal Shards",
    desc: "Sharp, fractured rock fragments, chipped boulders, and hexagonal quartz crystals in crushed stone sand",
    params: {
      grainScale: 90.0,
      crystalSparkle: 1.2,
      mineralVariety: 0.75,
      magnetiteFlecks: 0.40,
      pebbleEnable: true,
      pebbleDensity: 36,
      pebbleMinSize: 16,
      pebbleMaxSize: 60,
      pebbleHeight: 1.10,
      rockVariety: "angular",
      wetness: 0.0,
      sandColorBase: [0.74, 0.70, 0.64],
      sandColorMineral: [0.82, 0.76, 0.68],
      sandColorDark: [0.48, 0.45, 0.42],
      fleckColor: [0.18, 0.16, 0.16],
      stoneColor1: [0.42, 0.40, 0.42],
      stoneColor2: [0.88, 0.85, 0.80],
    },
  },
  wetTidal: {
    name: "Wet Tidal Shoreline (Flat Skipping Stones)",
    desc: "Moisture-darkened sand with mirror-like water sheen and flat weathered discoid stones",
    params: {
      grainScale: 120.0,
      crystalSparkle: 0.60,
      mineralVariety: 0.80,
      magnetiteFlecks: 0.35,
      pebbleEnable: true,
      pebbleDensity: 16,
      pebbleMinSize: 18,
      pebbleMaxSize: 64,
      pebbleHeight: 0.65,
      rockVariety: "discoid",
      wetness: 0.85,
      sandColorBase: [0.76, 0.66, 0.52],
      sandColorMineral: [0.84, 0.60, 0.45],
      sandColorDark: [0.55, 0.46, 0.34],
      fleckColor: [0.12, 0.11, 0.10],
      stoneColor1: [0.38, 0.36, 0.38],
      stoneColor2: [0.75, 0.72, 0.68],
    },
  },
  martianRed: {
    name: "Red Martian Hematite Sand & Basalt Shards",
    desc: "Deep ferric iron-oxide sand grains mixed with dark angular basaltic stone fragments",
    params: {
      grainScale: 95.0,
      crystalSparkle: 0.85,
      mineralVariety: 0.80,
      magnetiteFlecks: 0.45,
      pebbleEnable: true,
      pebbleDensity: 24,
      pebbleMinSize: 14,
      pebbleMaxSize: 48,
      pebbleHeight: 0.90,
      rockVariety: "angular",
      wetness: 0.0,
      sandColorBase: [0.78, 0.38, 0.22],
      sandColorMineral: [0.88, 0.48, 0.28],
      sandColorDark: [0.52, 0.22, 0.12],
      fleckColor: [0.16, 0.10, 0.08],
      stoneColor1: [0.28, 0.16, 0.12],
      stoneColor2: [0.82, 0.52, 0.32],
    },
  },
  volcanicBlack: {
    name: "Black Volcanic Basalt Sand & Obsidian",
    desc: "Jet-black volcanic cinders, crushed obsidian glass, and dark angular basalt rocks",
    params: {
      grainScale: 90.0,
      crystalSparkle: 0.95,
      mineralVariety: 0.65,
      magnetiteFlecks: 0.70,
      pebbleEnable: true,
      pebbleDensity: 26,
      pebbleMinSize: 12,
      pebbleMaxSize: 50,
      pebbleHeight: 0.95,
      rockVariety: "mixed",
      wetness: 0.30,
      sandColorBase: [0.18, 0.18, 0.20],
      sandColorMineral: [0.28, 0.28, 0.32],
      sandColorDark: [0.10, 0.10, 0.12],
      fleckColor: [0.38, 0.35, 0.28],
      stoneColor1: [0.14, 0.14, 0.16],
      stoneColor2: [0.42, 0.40, 0.36],
    },
  },
  pureCrystal: {
    name: "White Calcite & Quartz Crystal Field",
    desc: "Sparkling translucent calcite shards and quartz crystals embedded in fine white sand",
    params: {
      grainScale: 130.0,
      crystalSparkle: 1.4,
      mineralVariety: 0.60,
      magnetiteFlecks: 0.05,
      pebbleEnable: true,
      pebbleDensity: 28,
      pebbleMinSize: 12,
      pebbleMaxSize: 44,
      pebbleHeight: 0.80,
      rockVariety: "crystals",
      wetness: 0.10,
      sandColorBase: [0.95, 0.94, 0.90],
      sandColorMineral: [0.90, 0.86, 0.80],
      sandColorDark: [0.82, 0.80, 0.76],
      fleckColor: [0.45, 0.42, 0.40],
      stoneColor1: [0.65, 0.62, 0.58],
      stoneColor2: [0.98, 0.96, 0.94],
    },
  },
};

class TextureApp {
  constructor() {
    this.generator = new SandTextureGenerator();
    this.currentPresetKey = "quartzBeach";
    this.currentResolution = 1024;
    this.params = {
      seed: 42,
      ...PRESETS.quartzBeach.params,
    };

    this.activeMapTab = "3d";
    this.lastResult = null;

    this.init();
  }

  async init() {
    const container = document.getElementById("texture-viewport-container");
    this.viewport = new TexturePreviewViewport(container);

    this.initUI();
    this.generate();
  }

  initUI() {
    const genBtn = document.getElementById("btn-generate");
    const exportBtn = document.getElementById("btn-export-pbr");
    const wireBtn = document.getElementById("btn-wireframe");
    const presetSelect = document.getElementById("select-preset");
    const modelSelect = document.getElementById("select-model");
    const resSelect = document.getElementById("select-res");

    if (genBtn) genBtn.onclick = () => this.generate();
    if (exportBtn) exportBtn.onclick = () => this.exportPBRMaps();

    if (wireBtn) {
      wireBtn.onclick = () => {
        const isWire = !this.viewport.material.wireframe;
        this.viewport.setWireframe(isWire);
        wireBtn.classList.toggle("active", isWire);
      };
    }

    if (presetSelect) {
      presetSelect.innerHTML = Object.keys(PRESETS).map((k) => `
        <option value="${k}" ${k === this.currentPresetKey ? "selected" : ""}>${PRESETS[k].name}</option>
      `).join("");

      presetSelect.onchange = (e) => {
        this.applyPreset(e.target.value);
      };
    }

    if (modelSelect) {
      modelSelect.onchange = (e) => {
        this.viewport.setModelType(e.target.value);
      };
    }

    if (resSelect) {
      resSelect.onchange = (e) => {
        this.currentResolution = parseInt(e.target.value, 10);
        this.generate();
      };
    }

    this.renderInspector();
    this.initMapTabs();
    this.initKeyboardShortcuts();
  }

  applyPreset(presetKey) {
    if (!PRESETS[presetKey]) return;
    this.currentPresetKey = presetKey;
    this.params = {
      ...this.params,
      ...PRESETS[presetKey].params,
    };
    this.renderInspector();
    this.generate();
  }

  initMapTabs() {
    const tabs = document.querySelectorAll(".map-tab-btn");
    const mapPreviewImg = document.getElementById("map-2d-canvas");
    const viewport3D = document.getElementById("texture-viewport-container");

    tabs.forEach((tab) => {
      tab.onclick = () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const mapType = tab.dataset.map;
        this.activeMapTab = mapType;

        if (mapType === "3d") {
          viewport3D.style.display = "block";
          mapPreviewImg.style.display = "none";
        } else {
          viewport3D.style.display = "none";
          mapPreviewImg.style.display = "block";
          this.render2DMap(mapType);
        }
      };
    });
  }

  render2DMap(mapType) {
    if (!this.lastResult) return;
    const canvas = document.getElementById("map-2d-canvas");
    if (!canvas) return;

    canvas.width = this.lastResult.width;
    canvas.height = this.lastResult.height;
    const ctx = canvas.getContext("2d");

    let imgData;
    if (mapType === "albedo") imgData = this.lastResult.albedoImageData;
    else if (mapType === "normal") imgData = this.lastResult.normalImageData;
    else if (mapType === "height") imgData = this.lastResult.heightImageData;
    else if (mapType === "roughness") imgData = this.lastResult.roughnessImageData;
    else if (mapType === "ao") imgData = this.lastResult.aoImageData;

    if (imgData) {
      ctx.putImageData(imgData, 0, 0);
    }
  }

  createSliderRow(container, { label, min, max, step, value, unit, onChange }) {
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

  createColorRow(container, { label, valueHex, onChange }) {
    const row = document.createElement("div");
    row.className = "crow";
    row.innerHTML = `
      <div class="clabel">${label}</div>
      <div class="vpill-row" style="align-items: center; gap: 8px;">
        <input type="color" class="color-picker" value="${valueHex}" style="border: 1px solid var(--stroke); background: transparent; width: 34px; height: 26px; border-radius: 4px; cursor: pointer; padding: 0;">
        <span class="color-hex" style="font-family: monospace; font-size: 11px; color: var(--text-faint);">${valueHex.toUpperCase()}</span>
      </div>
    `;
    const input = row.querySelector("input[type=color]");
    const hexSpan = row.querySelector(".color-hex");
    input.oninput = () => {
      hexSpan.textContent = input.value.toUpperCase();
      if (onChange) onChange(input.value);
    };
    container.appendChild(row);
  }

  renderInspector() {
    const container = document.getElementById("texture-inspector-body");
    if (!container) return;
    container.innerHTML = "";

    const p = this.params;

    // --- Card 1: Custom Mineral & Sand Color Palette ---
    const colorCard = document.createElement("div");
    colorCard.className = "pass-card";
    colorCard.innerHTML = `
      <div class="pass-card-header">
        <div class="pass-title">
          <span>🎨 Mineral & Sand Color Palette</span>
        </div>
      </div>
      <div style="font-size: 11px; color: var(--text-faint); margin-bottom: 8px;">
        Quick Mineral Swatches:
      </div>
      <div class="swatch-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 12px;">
        ${COLOR_SWATCHES.map((sw, i) => `
          <button class="btn ghost small swatch-btn" data-swatch="${i}" style="font-size: 10px; padding: 4px 6px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${sw.name}
          </button>
        `).join("")}
      </div>
    `;

    colorCard.querySelectorAll(".swatch-btn").forEach((btn) => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.swatch, 10);
        const sw = COLOR_SWATCHES[idx];
        if (sw) {
          Object.assign(this.params, sw.colors);
          this.renderInspector();
          this.generate();
        }
      };
    });

    this.createColorRow(colorCard, {
      label: "Primary Sand (Quartz)",
      valueHex: rgbToHex(p.sandColorBase),
      onChange: (hex) => { p.sandColorBase = hexToRgb(hex); this.generate(); },
    });

    this.createColorRow(colorCard, {
      label: "Secondary Mineral (Feldspar/Coral)",
      valueHex: rgbToHex(p.sandColorMineral),
      onChange: (hex) => { p.sandColorMineral = hexToRgb(hex); this.generate(); },
    });

    this.createColorRow(colorCard, {
      label: "Crevice & Shadow Sand",
      valueHex: rgbToHex(p.sandColorDark),
      onChange: (hex) => { p.sandColorDark = hexToRgb(hex); this.generate(); },
    });

    this.createColorRow(colorCard, {
      label: "Magnetite / Dark Flecks",
      valueHex: rgbToHex(p.fleckColor),
      onChange: (hex) => { p.fleckColor = hexToRgb(hex); this.generate(); },
    });

    this.createColorRow(colorCard, {
      label: "Primary Rock Color",
      valueHex: rgbToHex(p.stoneColor1),
      onChange: (hex) => { p.stoneColor1 = hexToRgb(hex); this.generate(); },
    });

    this.createColorRow(colorCard, {
      label: "Accent Stone (Quartzite/Calcite)",
      valueHex: rgbToHex(p.stoneColor2),
      onChange: (hex) => { p.stoneColor2 = hexToRgb(hex); this.generate(); },
    });

    container.appendChild(colorCard);

    // --- Card 2: Micro Crystalline Quartz Sand Grains & Sparkle ---
    const grainCard = document.createElement("div");
    grainCard.className = "pass-card";
    grainCard.innerHTML = `
      <div class="pass-card-header">
        <div class="pass-title">
          <span>Quartz Crystals & Sand Micro-Grains</span>
        </div>
      </div>
    `;
    this.createSliderRow(grainCard, {
      label: "Crystal Grain Density", min: 40, max: 200, step: 5, value: p.grainScale, unit: "g",
      onChange: (v) => { p.grainScale = v; this.generate(); },
    });
    this.createSliderRow(grainCard, {
      label: "Crystal Facet Sparkle", min: 0.0, max: 2.0, step: 0.05, value: p.crystalSparkle, unit: "s",
      onChange: (v) => {
        p.crystalSparkle = v;
        this.viewport.setSparkleIntensity(v * 1.2);
        this.generate();
      },
    });
    this.createSliderRow(grainCard, {
      label: "Mineral Color Diversity", min: 0.0, max: 1.0, step: 0.05, value: p.mineralVariety, unit: "v",
      onChange: (v) => { p.mineralVariety = v; this.generate(); },
    });
    this.createSliderRow(grainCard, {
      label: "Magnetite Fleck Density", min: 0.0, max: 1.0, step: 0.05, value: p.magnetiteFlecks, unit: "f",
      onChange: (v) => { p.magnetiteFlecks = v; this.generate(); },
    });
    container.appendChild(grainCard);

    // --- Card 3: 3D SDF Rocks & Stones ---
    const pebbleCard = document.createElement("div");
    pebbleCard.className = "pass-card";
    pebbleCard.innerHTML = `
      <div class="pass-card-header">
        <div class="pass-title">
          <input type="checkbox" id="chk-pebbles" ${p.pebbleEnable ? "checked" : ""}>
          <span>3D SDF Rocks & Stones</span>
        </div>
      </div>
    `;
    pebbleCard.querySelector("#chk-pebbles").onchange = (e) => {
      p.pebbleEnable = e.target.checked;
      this.generate();
    };

    const shapeRow = document.createElement("div");
    shapeRow.className = "crow";
    shapeRow.innerHTML = `
      <div class="clabel">Stone Shape Variety</div>
      <select class="select-field" id="select-stone-type">
        <option value="mixed" ${p.rockVariety === "mixed" ? "selected" : ""}>Mixed (Angular, Flat, Crystals, Cobbles)</option>
        <option value="angular" ${p.rockVariety === "angular" ? "selected" : ""}>Angular Fractured Chipped Boulders</option>
        <option value="discoid" ${p.rockVariety === "discoid" ? "selected" : ""}>Flat River Skipping Stones</option>
        <option value="crystals" ${p.rockVariety === "crystals" ? "selected" : ""}>Hexagonal Quartz Crystal Shards</option>
      </select>
    `;
    shapeRow.querySelector("select").onchange = (e) => {
      p.rockVariety = e.target.value;
      this.generate();
    };
    pebbleCard.appendChild(shapeRow);

    this.createSliderRow(pebbleCard, {
      label: "Rock Count", min: 0, max: 80, step: 2, value: p.pebbleDensity, unit: "cnt",
      onChange: (v) => { p.pebbleDensity = v; this.generate(); },
    });
    this.createSliderRow(pebbleCard, {
      label: "Max Rock Size", min: 20, max: 90, step: 2, value: p.pebbleMaxSize, unit: "px",
      onChange: (v) => { p.pebbleMaxSize = v; this.generate(); },
    });
    this.createSliderRow(pebbleCard, {
      label: "Protrusion Height", min: 0.3, max: 1.8, step: 0.05, value: p.pebbleHeight, unit: "h",
      onChange: (v) => { p.pebbleHeight = v; this.generate(); },
    });
    container.appendChild(pebbleCard);

    // --- Card 4: Moisture & Water Film ---
    const wetCard = document.createElement("div");
    wetCard.className = "pass-card";
    wetCard.innerHTML = `
      <div class="pass-card-header">
        <div class="pass-title">
          <span>Moisture & Water Film</span>
        </div>
      </div>
    `;
    this.createSliderRow(wetCard, {
      label: "Wetness / Moisture Saturation", min: 0.0, max: 1.0, step: 0.02, value: p.wetness, unit: "w",
      onChange: (v) => { p.wetness = v; this.generate(); },
    });
    container.appendChild(wetCard);

    // --- Card 5: PBR Lighting, Specular & Subsurface ---
    const viewCard = document.createElement("div");
    viewCard.className = "pass-card";
    viewCard.innerHTML = `
      <div class="pass-card-header">
        <div class="pass-title">
          <span>PBR Microfacet Specular & Subsurface</span>
        </div>
      </div>
    `;
    this.createSliderRow(viewCard, {
      label: "Cook-Torrance Specular", min: 0.5, max: 3.5, step: 0.1, value: this.viewport.specularStrength, unit: "x",
      onChange: (v) => { this.viewport.setSpecularStrength(v); },
    });
    this.createSliderRow(viewCard, {
      label: "Quartz Translucent Glow (SSS)", min: 0.0, max: 1.0, step: 0.05, value: this.viewport.subsurfaceGlow, unit: "s",
      onChange: (v) => { this.viewport.setSubsurfaceGlow(v); },
    });
    this.createSliderRow(viewCard, {
      label: "Displacement Scale", min: 0.0, max: 0.35, step: 0.01, value: this.viewport.displacementScale, unit: "d",
      onChange: (v) => { this.viewport.setDisplacementScale(v); },
    });
    this.createSliderRow(viewCard, {
      label: "Sun Elevation", min: 10, max: 85, step: 1, value: this.viewport.sunElevation, unit: "°",
      onChange: (v) => { this.viewport.setSunPosition(v, this.viewport.sunAzimuth); },
    });
    this.createSliderRow(viewCard, {
      label: "Sun Azimuth", min: 0, max: 360, step: 5, value: this.viewport.sunAzimuth, unit: "°",
      onChange: (v) => { this.viewport.setSunPosition(this.viewport.sunElevation, v); },
    });
    container.appendChild(viewCard);
  }

  generate() {
    this.setStatus("Synthesizing 3D SDF Crystalline Sand Maps...", true);

    setTimeout(() => {
      const result = this.generator.generate({
        width: this.currentResolution,
        height: this.currentResolution,
        ...this.params,
      });

      this.lastResult = result;
      this.viewport.updateTextures(result);

      if (this.activeMapTab !== "3d") {
        this.render2DMap(this.activeMapTab);
      }

      this.setStatus(`Ready (${this.currentResolution}² PBR Tile)`, false);
    }, 10);
  }

  exportPBRMaps() {
    if (!this.lastResult) return;
    this.setStatus("Exporting PBR Maps...", true);

    const downloadCanvas = (canvas, filename) => {
      const link = document.createElement("a");
      link.download = filename;
      link.href = canvas.toDataURL("image/png");
      link.click();
    };

    const canvas = document.createElement("canvas");
    canvas.width = this.lastResult.width;
    canvas.height = this.lastResult.height;
    const ctx = canvas.getContext("2d");

    ctx.putImageData(this.lastResult.albedoImageData, 0, 0);
    downloadCanvas(canvas, `sand_${this.currentPresetKey}_albedo_${this.currentResolution}.png`);

    ctx.putImageData(this.lastResult.normalImageData, 0, 0);
    downloadCanvas(canvas, `sand_${this.currentPresetKey}_normal_${this.currentResolution}.png`);

    ctx.putImageData(this.lastResult.heightImageData, 0, 0);
    downloadCanvas(canvas, `sand_${this.currentPresetKey}_height_${this.currentResolution}.png`);

    ctx.putImageData(this.lastResult.roughnessImageData, 0, 0);
    downloadCanvas(canvas, `sand_${this.currentPresetKey}_roughness_${this.currentResolution}.png`);

    ctx.putImageData(this.lastResult.aoImageData, 0, 0);
    downloadCanvas(canvas, `sand_${this.currentPresetKey}_ao_${this.currentResolution}.png`);

    this.setStatus("PBR Maps Downloaded!", false);
  }

  setStatus(text, busy = false) {
    const dot = document.getElementById("status-dot");
    const textEl = document.getElementById("status-text");
    if (dot) dot.className = `status-dot ${busy ? "busy" : ""}`;
    if (textEl) textEl.textContent = text;
  }

  initKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;

      if (e.code === "Space" || e.key.toLowerCase() === "g") {
        e.preventDefault();
        this.params.seed = (this.params.seed + 137) % 99999;
        this.generate();
      } else if (e.key.toLowerCase() === "w") {
        e.preventDefault();
        const wireBtn = document.getElementById("btn-wireframe");
        if (wireBtn) wireBtn.click();
      }
    });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  window.textureApp = new TextureApp();
});
