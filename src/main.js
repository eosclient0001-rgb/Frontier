// main.js
// Frontier Texture Paint Workstation Controller

import { FillIcons } from "./ui/Icons.js";
import { LayerStack } from "./layers/LayerStack.js";
import { TextureCompositor } from "./engine/TextureCompositor.js";
import { PaintEngine3D } from "./engine/PaintEngine3D.js";
import { UVEditor } from "./ui/UVEditor.js";
import { BrushEngine } from "./engine/BrushEngine.js";
import { HistoryManager } from "./ui/HistoryManager.js";
import { MATERIAL_PRESETS, ProceduralPatternGenerator } from "./materials/MaterialPresets.js";
import { SVG_DECALS } from "./decals/DecalLibrary.js";
import { SvgDecalRenderer } from "./decals/SvgDecalRenderer.js";
import { TextDecalRenderer } from "./decals/TextDecalRenderer.js";
import { ExportManager } from "./ui/ExportManager.js";
import { ModelLibrary } from "./engine/ModelLibrary.js";

class FrontierTexturePainter {
  constructor() {
    this.docName = "Combat Helmet PBR";
    this.currentTool = "brush"; // "orbit", "brush", "eraser", "bucket", "stamp", "eyedropper"
    this.viewportMode = "3d"; // "3d", "2d", "split"
    this.activeInspectorTab = "brush";

    // Setup core systems
    this.layerStack = new LayerStack(2048);
    this.compositor = new TextureCompositor(2048);
    this.brushEngine = new BrushEngine();
    this.historyManager = new HistoryManager(30);

    // Canvases
    this.canvas3D = document.getElementById("paint-canvas-3d");
    this.canvas2D = document.getElementById("paint-canvas-2d");

    // 3D & 2D Engines
    this.engine3D = new PaintEngine3D(this.canvas3D, this.compositor);
    this.uvEditor = new UVEditor(this.canvas2D, this.compositor);
    this.uvEditor.setGeometry(this.engine3D.currentMesh.geometry);

    // Decal state
    this.selectedSvgDecal = SVG_DECALS[0];
    this.textDecalSettings = {
      text: "DANGER // KEEP CLEAR",
      fontFamily: "DM Sans",
      fontSize: 48,
      badgeStyle: "hazard_box",
      textColor: "#ffffff",
      badgeColor: "#ffcc00",
      scale: 0.3,
      rotation: 0,
      roughness: 0.25,
      metallic: 0.05,
      height: 0.3
    };

    this.svgDecalSettings = {
      scale: 0.25,
      rotation: 0,
      u: 0.5,
      v: 0.5,
      useTint: false,
      tintColor: "#ffd24d",
      roughness: 0.25,
      metallic: 0.8,
      height: 0.3
    };

    // Painting interaction state
    this.isMouseDown = false;
    this.lastUV = null;

    // Initialize UI and layers
    FillIcons();
    this.initDefaultLayers();
    this.setupEventListeners();
    this.renderLayerTree();
    this.renderMaterialLibrary();
    this.renderDecalLibrary();
    this.updateDecalPreview();
    this.updateInspectorForActiveLayer();

    // Re-render composite textures
    this.updateCompositor();

    // Push initial history snapshot
    const activeLayer = this.layerStack.getActiveLayer();
    if (activeLayer) {
      this.historyManager.pushState("Initial Project", activeLayer);
    }
  }

  showToast(message, duration = 2400) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, duration);
  }

  initDefaultLayers() {
    // 1. Base Metal Fill Layer
    const baseLayer = this.layerStack.addLayer({
      name: "Chassis Base Metal",
      type: "fill",
      fillSettings: {
        color: "#4a4f56",
        roughness: 0.35,
        metallic: 0.92,
        height: 0.0
      }
    });

    // 2. Armor Red Coating Paint Layer
    const paintLayer = this.layerStack.addLayer({
      name: "Armor Red Panels",
      type: "paint"
    });
    // Add some initial stylistic paint strokes to show off the layer stack
    const cCtx = paintLayer.colorCanvas.getContext("2d");
    cCtx.fillStyle = "#a82424";
    cCtx.fillRect(100, 200, 600, 700);

    const rCtx = paintLayer.roughnessCanvas.getContext("2d");
    rCtx.fillStyle = "rgb(120, 120, 120)";
    rCtx.fillRect(100, 200, 600, 700);

    const mCtx = paintLayer.metallicCanvas.getContext("2d");
    mCtx.fillStyle = "rgb(40, 40, 40)";
    mCtx.fillRect(100, 200, 600, 700);
    paintLayer.updateThumbnail();

    // 3. Hazard Stripes Decal Layer
    const decalLayer = this.layerStack.addLayer({
      name: "Hazard Stripes Decal",
      type: "decal_svg"
    });
    SvgDecalRenderer.renderToLayer(decalLayer, {
      svgString: SVG_DECALS[0].svg,
      u: 0.28,
      v: 0.42,
      scale: 0.22,
      rotation: -15,
      roughness: 0.25,
      metallic: 0.05,
      height: 0.3
    });
    decalLayer.updateThumbnail();

    // 4. Tactical Unit Text Decal Layer
    const textLayer = this.layerStack.addLayer({
      name: "Unit 09 Stencil",
      type: "decal_text"
    });
    TextDecalRenderer.renderToLayer(textLayer, {
      text: "UNIT 09 // FRONTIER",
      fontFamily: "DM Sans",
      badgeStyle: "hazard_box",
      textColor: "#ffffff",
      badgeColor: "#ffd60a",
      u: 0.65,
      v: 0.35,
      scale: 0.28,
      rotation: 5,
      roughness: 0.2,
      metallic: 0.1,
      height: 0.35
    });
    textLayer.updateThumbnail();

    this.layerStack.setActiveLayer(paintLayer.id);
  }

  updateCompositor() {
    this.compositor.composite(this.layerStack);
    if (this.uvEditor) this.uvEditor.render();

    // Update census tiles
    const visibleCount = this.layerStack.layers.filter((l) => l.visible).length;
    const decalCount = this.layerStack.layers.filter((l) => l.type === "decal_svg" || l.type === "decal_text").length;

    const visibleBadge = document.getElementById("visible-count");
    if (visibleBadge) visibleBadge.textContent = visibleCount;

    const decalBadge = document.getElementById("decal-count");
    if (decalBadge) decalBadge.textContent = decalCount;

    const layerBadge = document.getElementById("layer-count-badge");
    if (layerBadge) layerBadge.textContent = this.layerStack.layers.length;
  }

  setupEventListeners() {
    // Window Resize
    window.addEventListener("resize", () => {
      this.engine3D.resize();
      this.uvEditor.resize();
    });

    // 3D Canvas Painting & Mouse Interaction
    this.canvas3D.addEventListener("pointerdown", (e) => this.on3DPointerDown(e));
    window.addEventListener("pointermove", (e) => this.on3DPointerMove(e));
    window.addEventListener("pointerup", (e) => this.on3DPointerUp(e));

    // 2D Canvas Painting
    this.canvas2D.addEventListener("pointerdown", (e) => this.on2DPointerDown(e));
    window.addEventListener("pointermove", (e) => this.on2DPointerMove(e));
    window.addEventListener("pointerup", (e) => this.on2DPointerUp(e));

    // Viewport Mode Switcher (3D / 2D / Split)
    const modeSelect = document.getElementById("viewport-mode-select");
    modeSelect.addEventListener("change", (e) => {
      this.setViewportMode(e.target.value);
    });

    // Camera View Switcher
    const camSelect = document.getElementById("camera-view-select");
    camSelect.addEventListener("change", (e) => {
      this.engine3D.setCameraView(e.target.value);
    });

    // Model Selector
    const modelSelect = document.getElementById("model-select");
    modelSelect.addEventListener("change", (e) => {
      this.engine3D.loadModel(e.target.value);
      this.uvEditor.setGeometry(this.engine3D.currentMesh.geometry);
      const activeObjName = document.getElementById("active-model-name");
      if (activeObjName) {
        activeObjName.textContent = modelSelect.options[modelSelect.selectedIndex].text;
      }
      this.showToast(`Loaded ${modelSelect.options[modelSelect.selectedIndex].text}`);
    });

    // Render Channel Switcher
    const channelSelect = document.getElementById("render-channel-select");
    channelSelect.addEventListener("change", (e) => {
      this.engine3D.setRenderChannel(e.target.value);
      const chLabel = document.getElementById("active-channel-name");
      if (chLabel) chLabel.textContent = channelSelect.options[channelSelect.selectedIndex].text;
    });

    // Lighting Preset Switcher
    const lightSelect = document.getElementById("lighting-select");
    lightSelect.addEventListener("change", (e) => {
      this.engine3D.setupLighting(e.target.value);
      this.showToast(`Lighting: ${lightSelect.options[lightSelect.selectedIndex].text}`);
    });

    // Wireframe Overlay
    const wireframeBtn = document.getElementById("wireframe-toggle-btn");
    wireframeBtn.addEventListener("click", () => {
      this.engine3D.toggleWireframe();
      wireframeBtn.classList.toggle("active", this.engine3D.showWireframe);
    });

    // Focus & Maximize
    document.getElementById("focus-btn").addEventListener("click", () => {
      this.engine3D.resetCamera();
    });

    document.getElementById("maximize-btn").addEventListener("click", () => {
      document.body.classList.toggle("maximized");
      this.engine3D.resize();
      this.uvEditor.resize();
    });

    // Viewport Floating Tools Dock
    const toolButtons = document.querySelectorAll(".viewport-tools button[data-tool]");
    toolButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.setTool(btn.dataset.tool);
      });
    });

    // Turntable buttons
    const turntableBtn = document.getElementById("turntable-btn");
    const playTurntableBtn = document.getElementById("play-turntable-btn");

    const toggleTurntable = () => {
      const active = this.engine3D.toggleTurntable();
      turntableBtn.classList.toggle("active", active);
      playTurntableBtn.innerHTML = active ? `<span data-icon="pause"></span>` : `<span data-icon="play"></span>`;
      FillIcons(playTurntableBtn);
      this.showToast(active ? "Turntable active" : "Turntable paused");
    };

    turntableBtn.addEventListener("click", toggleTurntable);
    playTurntableBtn.addEventListener("click", toggleTurntable);

    // Transport Undo / Redo
    document.getElementById("undo-btn").addEventListener("click", () => this.handleUndo());
    document.getElementById("redo-btn").addEventListener("click", () => this.handleRedo());
    document.getElementById("reset-cam-btn").addEventListener("click", () => this.engine3D.resetCamera());

    // Fill Active Layer
    document.getElementById("fill-active-layer-btn").addEventListener("click", () => {
      const active = this.layerStack.getActiveLayer();
      if (!active || active.locked) return;
      this.historyManager.pushState("Fill Layer", active);
      this.brushEngine.bucketFill(active);
      this.updateCompositor();
      this.renderLayerTree();
      this.showToast(`Filled layer: ${active.name}`);
    });

    // Quick ORM export
    document.getElementById("quick-export-orm-btn").addEventListener("click", () => {
      ExportManager.exportPackedORM(this.compositor, `${this.docName}_ORM.png`);
      this.showToast("Exported Packed ORM Texture (AO/Rough/Metal)");
    });

    // Quick Brush Size & Opacity Inputs in Transport Bar
    const qSize = document.getElementById("quick-brush-size");
    qSize.addEventListener("input", (e) => {
      const val = parseInt(e.target.value) || 45;
      this.brushEngine.brushSettings.size = val;
      this.syncBrushSize(val);
    });

    const qOpacity = document.getElementById("quick-brush-opacity");
    qOpacity.addEventListener("input", (e) => {
      const val = (parseInt(e.target.value) || 100) / 100;
      this.brushEngine.brushSettings.opacity = val;
      this.syncBrushOpacity(val);
    });

    const qColor = document.getElementById("quick-color-input");
    qColor.addEventListener("input", (e) => {
      this.setBrushColor(e.target.value);
    });

    // Inspector Tab Switching
    const inspTabs = document.querySelectorAll(".inspector-tabs button");
    inspTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        inspTabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        this.activeInspectorTab = tab.dataset.tab;

        document.querySelectorAll(".tab-pane").forEach((pane) => (pane.hidden = true));
        const activePane = document.getElementById(`pane-${this.activeInspectorTab}`);
        if (activePane) activePane.hidden = false;
      });
    });

    // Inspector Brush Properties Sync
    const brushSizeRange = document.getElementById("brush-size-range");
    const brushSizeNumber = document.getElementById("brush-size-number");
    brushSizeRange.addEventListener("input", (e) => this.syncBrushSize(parseInt(e.target.value)));
    brushSizeNumber.addEventListener("input", (e) => this.syncBrushSize(parseInt(e.target.value)));

    const brushHardRange = document.getElementById("brush-hardness-range");
    const brushHardNumber = document.getElementById("brush-hardness-number");
    brushHardRange.addEventListener("input", (e) => {
      const val = parseInt(e.target.value);
      brushHardNumber.value = val;
      this.brushEngine.brushSettings.hardness = val / 100;
    });
    brushHardNumber.addEventListener("input", (e) => {
      const val = parseInt(e.target.value);
      brushHardRange.value = val;
      this.brushEngine.brushSettings.hardness = val / 100;
    });

    const brushOpRange = document.getElementById("brush-opacity-range");
    const brushOpNumber = document.getElementById("brush-opacity-number");
    brushOpRange.addEventListener("input", (e) => this.syncBrushOpacity(parseInt(e.target.value) / 100));
    brushOpNumber.addEventListener("input", (e) => this.syncBrushOpacity(parseInt(e.target.value) / 100));

    const brushSpacingRange = document.getElementById("brush-spacing-range");
    const brushSpacingNumber = document.getElementById("brush-spacing-number");
    brushSpacingRange.addEventListener("input", (e) => {
      const val = parseInt(e.target.value);
      brushSpacingNumber.value = val;
      this.brushEngine.brushSettings.spacing = val / 100;
    });

    // Brush Shapes
    document.querySelectorAll(".shape-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".shape-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.brushEngine.brushSettings.shape = btn.dataset.shape;
      });
    });

    // Symmetry Checkboxes
    document.getElementById("symmetry-x-chk").addEventListener("change", (e) => {
      this.brushEngine.brushSettings.symmetryX = e.target.checked;
      this.showToast(`Symmetry X: ${e.target.checked ? "ON" : "OFF"}`);
    });
    document.getElementById("symmetry-y-chk").addEventListener("change", (e) => {
      this.brushEngine.brushSettings.symmetryY = e.target.checked;
      this.showToast(`Symmetry Y: ${e.target.checked ? "ON" : "OFF"}`);
    });

    // Material Channel Active Toggles
    document.querySelectorAll(".channel-check-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        btn.classList.toggle("active");
        const ch = btn.dataset.channel;
        this.brushEngine.brushSettings.paintChannels[ch] = btn.classList.contains("active");
      });
    });

    // Base Color Pickers
    const matColorInput = document.getElementById("material-color-input");
    const matColorHex = document.getElementById("material-color-hex");
    matColorInput.addEventListener("input", (e) => this.setBrushColor(e.target.value));
    matColorHex.addEventListener("change", (e) => {
      let hex = e.target.value;
      if (!hex.startsWith("#")) hex = "#" + hex;
      this.setBrushColor(hex);
    });

    // Palette Swatches
    document.querySelectorAll(".palette-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.setBrushColor(btn.dataset.color));
    });

    // Roughness Controls
    const roughRange = document.getElementById("roughness-range");
    const roughNumber = document.getElementById("roughness-number");
    roughRange.addEventListener("input", (e) => {
      const val = parseInt(e.target.value) / 100;
      roughNumber.value = val.toFixed(2);
      this.brushEngine.brushSettings.roughness = val;
    });
    roughNumber.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value) || 0;
      roughRange.value = Math.round(val * 100);
      this.brushEngine.brushSettings.roughness = val;
    });

    document.querySelectorAll(".finish-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rVal = parseFloat(btn.dataset.roughness);
        if (!isNaN(rVal)) {
          roughNumber.value = rVal.toFixed(2);
          roughRange.value = Math.round(rVal * 100);
          this.brushEngine.brushSettings.roughness = rVal;
          document.querySelectorAll(".finish-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
        }
        const mVal = parseFloat(btn.dataset.metallic);
        if (!isNaN(mVal)) {
          const metalNum = document.getElementById("metallic-number");
          const metalRange = document.getElementById("metallic-range");
          metalNum.value = mVal.toFixed(2);
          metalRange.value = Math.round(mVal * 100);
          this.brushEngine.brushSettings.metallic = mVal;
        }
      });
    });

    // Metallic Controls
    const metalRange = document.getElementById("metallic-range");
    const metalNumber = document.getElementById("metallic-number");
    metalRange.addEventListener("input", (e) => {
      const val = parseInt(e.target.value) / 100;
      metalNumber.value = val.toFixed(2);
      this.brushEngine.brushSettings.metallic = val;
    });
    metalNumber.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value) || 0;
      metalRange.value = Math.round(val * 100);
      this.brushEngine.brushSettings.metallic = val;
    });

    // Height Controls
    const heightRange = document.getElementById("height-range");
    const heightNumber = document.getElementById("height-number");
    heightRange.addEventListener("input", (e) => {
      const val = parseInt(e.target.value) / 100;
      heightNumber.value = val.toFixed(2);
      this.brushEngine.brushSettings.height = val;
    });
    heightNumber.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value) || 0;
      heightRange.value = Math.round(val * 100);
      this.brushEngine.brushSettings.height = val;
    });

    // Layer Stack Operations
    document.getElementById("add-layer-btn").addEventListener("click", () => {
      const newLayer = this.layerStack.addLayer({
        name: `Paint Layer ${this.layerStack.layers.length + 1}`,
        type: "paint"
      });
      this.renderLayerTree();
      this.updateInspectorForActiveLayer();
      this.showToast(`Added ${newLayer.name}`);
    });

    document.getElementById("duplicate-layer-btn").addEventListener("click", () => {
      const active = this.layerStack.getActiveLayer();
      if (!active) return;
      this.layerStack.duplicateLayer(active.id);
      this.renderLayerTree();
      this.updateCompositor();
      this.showToast(`Duplicated ${active.name}`);
    });

    document.getElementById("merge-down-btn").addEventListener("click", () => {
      const active = this.layerStack.getActiveLayer();
      if (!active) return;
      this.layerStack.mergeDown(active.id);
      this.renderLayerTree();
      this.updateCompositor();
      this.showToast(`Merged down layer`);
    });

    document.getElementById("delete-layer-btn").addEventListener("click", () => {
      const active = this.layerStack.getActiveLayer();
      if (!active) return;
      this.layerStack.removeLayer(active.id);
      this.renderLayerTree();
      this.updateCompositor();
      this.updateInspectorForActiveLayer();
      this.showToast("Layer deleted");
    });

    // Decal UI Events
    const svgTypeBtn = document.getElementById("decal-type-svg");
    const textTypeBtn = document.getElementById("decal-type-text");
    const svgSection = document.getElementById("section-svg-decal");
    const textSection = document.getElementById("section-text-decal");

    svgTypeBtn.addEventListener("click", () => {
      svgTypeBtn.classList.add("active");
      textTypeBtn.classList.remove("active");
      svgSection.hidden = false;
      textSection.hidden = true;
      this.updateDecalPreview();
    });

    textTypeBtn.addEventListener("click", () => {
      textTypeBtn.classList.add("active");
      svgTypeBtn.classList.remove("active");
      svgSection.hidden = true;
      textSection.hidden = false;
      this.updateDecalPreview();
    });

    // Decal Transform Controls
    const uRange = document.getElementById("decal-u-range");
    const uNum = document.getElementById("decal-u-number");
    uRange.addEventListener("input", (e) => {
      const val = parseInt(e.target.value) / 100;
      uNum.value = val.toFixed(2);
      this.svgDecalSettings.u = val;
    });

    const vRange = document.getElementById("decal-v-range");
    const vNum = document.getElementById("decal-v-number");
    vRange.addEventListener("input", (e) => {
      const val = parseInt(e.target.value) / 100;
      vNum.value = val.toFixed(2);
      this.svgDecalSettings.v = val;
    });

    const sRange = document.getElementById("decal-scale-range");
    const sNum = document.getElementById("decal-scale-number");
    sRange.addEventListener("input", (e) => {
      const val = parseInt(e.target.value) / 100;
      sNum.value = val.toFixed(2);
      this.svgDecalSettings.scale = val;
      this.updateDecalPreview();
    });

    const rotRange = document.getElementById("decal-rot-range");
    const rotNum = document.getElementById("decal-rot-number");
    rotRange.addEventListener("input", (e) => {
      const val = parseInt(e.target.value);
      rotNum.value = val;
      this.svgDecalSettings.rotation = val;
      this.updateDecalPreview();
    });

    document.getElementById("decal-use-tint").addEventListener("change", (e) => {
      this.svgDecalSettings.useTint = e.target.checked;
      this.updateDecalPreview();
    });

    document.getElementById("decal-tint-color").addEventListener("input", (e) => {
      this.svgDecalSettings.tintColor = e.target.value;
      this.updateDecalPreview();
    });

    // Stamp SVG Decal onto Active Layer
    document.getElementById("stamp-decal-btn").addEventListener("click", async () => {
      const active = this.layerStack.getActiveLayer();
      if (!active || active.locked) return;
      this.historyManager.pushState("Stamp SVG Decal", active);
      await SvgDecalRenderer.renderToLayer(active, {
        svgString: this.selectedSvgDecal.svg,
        ...this.svgDecalSettings
      });
      active.updateThumbnail();
      this.updateCompositor();
      this.renderLayerTree();
      this.showToast(`Stamped ${this.selectedSvgDecal.name} onto ${active.name}`);
    });

    // Create New Decal Layer
    document.getElementById("create-decal-layer-btn").addEventListener("click", async () => {
      const layer = this.layerStack.addLayer({
        name: `${this.selectedSvgDecal.name} Decal`,
        type: "decal_svg"
      });
      await SvgDecalRenderer.renderToLayer(layer, {
        svgString: this.selectedSvgDecal.svg,
        ...this.svgDecalSettings
      });
      layer.updateThumbnail();
      this.updateCompositor();
      this.renderLayerTree();
      this.showToast(`Created ${layer.name}`);
    });

    // Text Decal Inputs
    document.getElementById("text-decal-string").addEventListener("input", (e) => {
      this.textDecalSettings.text = e.target.value;
      this.updateDecalPreview();
    });

    document.getElementById("text-decal-font").addEventListener("change", (e) => {
      this.textDecalSettings.fontFamily = e.target.value;
      this.updateDecalPreview();
    });

    document.querySelectorAll(".badge-style-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".badge-style-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.textDecalSettings.badgeStyle = btn.dataset.badge;
        this.updateDecalPreview();
      });
    });

    document.getElementById("text-decal-color").addEventListener("input", (e) => {
      this.textDecalSettings.textColor = e.target.value;
      this.updateDecalPreview();
    });

    document.getElementById("text-decal-badge-color").addEventListener("input", (e) => {
      this.textDecalSettings.badgeColor = e.target.value;
      this.updateDecalPreview();
    });

    document.getElementById("text-decal-scale-range").addEventListener("input", (e) => {
      this.textDecalSettings.scale = parseInt(e.target.value) / 100;
      this.updateDecalPreview();
    });

    document.getElementById("text-decal-rot-range").addEventListener("input", (e) => {
      this.textDecalSettings.rotation = parseInt(e.target.value);
      this.updateDecalPreview();
    });

    // Stamp Text onto Active Layer
    document.getElementById("stamp-text-btn").addEventListener("click", () => {
      const active = this.layerStack.getActiveLayer();
      if (!active || active.locked) return;
      this.historyManager.pushState("Stamp Text Decal", active);
      TextDecalRenderer.renderToLayer(active, {
        ...this.textDecalSettings,
        u: this.svgDecalSettings.u,
        v: this.svgDecalSettings.v
      });
      active.updateThumbnail();
      this.updateCompositor();
      this.renderLayerTree();
      this.showToast(`Stamped text onto ${active.name}`);
    });

    // Create New Text Decal Layer
    document.getElementById("create-text-layer-btn").addEventListener("click", () => {
      const layer = this.layerStack.addLayer({
        name: `Text: ${this.textDecalSettings.text.substring(0, 16)}`,
        type: "decal_text"
      });
      TextDecalRenderer.renderToLayer(layer, {
        ...this.textDecalSettings,
        u: this.svgDecalSettings.u,
        v: this.svgDecalSettings.v
      });
      layer.updateThumbnail();
      this.updateCompositor();
      this.renderLayerTree();
      this.showToast(`Created ${layer.name}`);
    });

    // Upload Custom SVG
    const uploadSvgBtn = document.getElementById("upload-svg-btn");
    const svgFileInput = document.getElementById("svg-file-input");
    uploadSvgBtn.addEventListener("click", () => svgFileInput.click());
    svgFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (re) => {
        const svgContent = re.target.result;
        const customDecal = {
          id: "custom_" + Date.now(),
          name: file.name.replace(".svg", ""),
          category: "custom",
          svg: svgContent
        };
        SVG_DECALS.unshift(customDecal);
        this.selectedSvgDecal = customDecal;
        this.renderDecalLibrary();
        this.updateDecalPreview();
        this.showToast(`Imported ${file.name}`);
      };
      reader.readAsText(file);
    });

    // Selected Layer Name & Visibility Bindings
    const selectedLayerName = document.getElementById("selected-layer-name");
    selectedLayerName.addEventListener("change", (e) => {
      const active = this.layerStack.getActiveLayer();
      if (active) {
        active.name = e.target.value;
        this.renderLayerTree();
      }
    });

    const selectedLayerVis = document.getElementById("selected-layer-visible");
    selectedLayerVis.addEventListener("change", (e) => {
      const active = this.layerStack.getActiveLayer();
      if (active) {
        active.visible = e.target.checked;
        this.updateCompositor();
        this.renderLayerTree();
      }
    });

    // Layer Blend Mode & Opacity in Inspector
    const layerBlend = document.getElementById("layer-blend-select");
    layerBlend.addEventListener("change", (e) => {
      const active = this.layerStack.getActiveLayer();
      if (active) {
        active.blendMode = e.target.value;
        this.updateCompositor();
        this.renderLayerTree();
      }
    });

    const layerOpRange = document.getElementById("layer-opacity-range");
    const layerOpNum = document.getElementById("layer-opacity-number");
    layerOpRange.addEventListener("input", (e) => {
      const val = parseInt(e.target.value);
      layerOpNum.value = val;
      const active = this.layerStack.getActiveLayer();
      if (active) {
        active.opacity = val / 100;
        this.updateCompositor();
      }
    });

    // Clear Active Layer
    document.getElementById("clear-layer-canvas-btn").addEventListener("click", () => {
      const active = this.layerStack.getActiveLayer();
      if (active && !active.locked) {
        this.historyManager.pushState("Clear Layer", active);
        active.clear();
        this.updateCompositor();
        this.renderLayerTree();
        this.showToast(`Cleared ${active.name}`);
      }
    });

    // Layer Category Search & Filter Pills
    const layerSearch = document.getElementById("layer-search");
    layerSearch.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll(".scene-row").forEach((row) => {
        const name = row.querySelector(".layer-name").textContent.toLowerCase();
        row.style.display = name.includes(q) ? "flex" : "none";
      });
    });

    document.querySelectorAll("#layer-filters button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#layer-filters button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const filter = btn.dataset.filter;
        document.querySelectorAll(".scene-row").forEach((row) => {
          const type = row.dataset.layerType;
          if (filter === "all") {
            row.style.display = "flex";
          } else if (filter === "paint" && type === "paint") {
            row.style.display = "flex";
          } else if (filter === "fill" && type === "fill") {
            row.style.display = "flex";
          } else if (filter === "decal" && type.includes("decal")) {
            row.style.display = "flex";
          } else if (filter === "text" && type === "decal_text") {
            row.style.display = "flex";
          } else {
            row.style.display = "none";
          }
        });
      });
    });

    // Preset Library Search & Filters
    const presetSearch = document.getElementById("preset-search");
    presetSearch.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll(".preset-card").forEach((card) => {
        const name = card.querySelector("strong").textContent.toLowerCase();
        card.style.display = name.includes(q) ? "flex" : "none";
      });
    });

    document.querySelectorAll("#preset-filters button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#preset-filters button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const cat = btn.dataset.cat;
        document.querySelectorAll(".preset-card").forEach((card) => {
          if (cat === "all" || card.dataset.category === cat) {
            card.style.display = "flex";
          } else {
            card.style.display = "none";
          }
        });
      });
    });

    // Project Save & Load
    const docNameInput = document.getElementById("document-name");
    docNameInput.addEventListener("change", (e) => {
      this.docName = e.target.value;
    });

    document.getElementById("save-project-btn").addEventListener("click", () => {
      ExportManager.saveProject(this.docName, this.engine3D.currentModelId, this.layerStack);
      this.showToast(`Saved ${this.docName}.paint`);
    });

    const importBtn = document.getElementById("import-btn");
    const projFileInput = document.getElementById("project-file-input");
    importBtn.addEventListener("click", () => projFileInput.click());
    projFileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const proj = await ExportManager.loadProject(file, this.layerStack);
        this.docName = proj.docName || file.name.replace(".paint", "");
        docNameInput.value = this.docName;
        if (proj.modelId) {
          modelSelect.value = proj.modelId;
          this.engine3D.loadModel(proj.modelId);
          this.uvEditor.setGeometry(this.engine3D.currentMesh.geometry);
        }
        this.updateCompositor();
        this.renderLayerTree();
        this.updateInspectorForActiveLayer();
        this.showToast(`Loaded ${file.name}`);
      } catch (err) {
        console.error(err);
        this.showToast("Failed to load project file");
      }
    });

    // Custom OBJ Mesh Import
    const importObjBtn = document.getElementById("import-obj-btn");
    const objFileInput = document.getElementById("obj-file-input");
    importObjBtn.addEventListener("click", () => objFileInput.click());
    objFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (re) => {
        const text = re.target.result;
        const geo = ModelLibrary.loadOBJ(text);
        if (geo) {
          this.engine3D.loadModel("custom", geo);
          this.uvEditor.setGeometry(geo);
          document.getElementById("active-model-name").textContent = file.name;
          this.showToast(`Imported OBJ: ${file.name}`);
        } else {
          this.showToast("No valid mesh found in OBJ file");
        }
      };
      reader.readAsText(file);
    });

    // Export Dialog
    const exportDialog = document.getElementById("export-dialog");
    document.getElementById("export-dialog-btn").addEventListener("click", () => exportDialog.showModal());
    document.getElementById("close-export-dialog").addEventListener("click", () => exportDialog.close());

    document.getElementById("btn-export-textures").addEventListener("click", () => {
      exportDialog.close();
      const exportAlbedo = document.getElementById("exp-albedo").checked;
      const exportRough = document.getElementById("exp-roughness").checked;
      const exportMetal = document.getElementById("exp-metallic").checked;
      const exportNormal = document.getElementById("exp-normal").checked;
      const exportHeight = document.getElementById("exp-height").checked;
      const exportOrm = document.getElementById("exp-orm").checked;

      if (exportAlbedo) ExportManager.downloadCanvasAsPNG(this.compositor.baseColorCanvas, `${this.docName}_Albedo.png`);
      if (exportRough) ExportManager.downloadCanvasAsPNG(this.compositor.roughnessCanvas, `${this.docName}_Roughness.png`);
      if (exportMetal) ExportManager.downloadCanvasAsPNG(this.compositor.metalnessCanvas, `${this.docName}_Metallic.png`);
      if (exportNormal) ExportManager.downloadCanvasAsPNG(this.compositor.normalCanvas, `${this.docName}_Normal.png`);
      if (exportHeight) ExportManager.downloadCanvasAsPNG(this.compositor.heightCanvas, `${this.docName}_Height.png`);
      if (exportOrm) ExportManager.exportPackedORM(this.compositor, `${this.docName}_ORM.png`);

      this.showToast("Exported selected texture maps");
    });

    document.getElementById("btn-export-mesh").addEventListener("click", () => {
      exportDialog.close();
      const format = document.getElementById("export-mesh-format").value;
      if (format === "gltf") {
        ExportManager.exportGLTF(this.engine3D.currentMesh, this.docName);
        this.showToast("Exported glTF model with textures");
      } else {
        ExportManager.exportOBJ(this.engine3D.currentMesh, this.docName);
        this.showToast("Exported Wavefront OBJ model");
      }
    });

    // Help Dialog
    const helpDialog = document.getElementById("help-dialog");
    document.getElementById("help-button").addEventListener("click", () => helpDialog.showModal());
    document.getElementById("close-help-dialog").addEventListener("click", () => helpDialog.close());
    document.getElementById("btn-close-help").addEventListener("click", () => helpDialog.close());

    // Navigation Buttons
    document.getElementById("workspace-nav").addEventListener("click", () => {
      this.switchInspectorTab("brush");
    });
    document.getElementById("materials-nav").addEventListener("click", () => {
      this.switchInspectorTab("material");
    });
    document.getElementById("decals-nav").addEventListener("click", () => {
      this.switchInspectorTab("decals");
    });

    // Keyboard Shortcuts
    window.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) this.handleRedo();
        else this.handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        this.handleRedo();
      } else if (e.key === "1") {
        this.setTool("orbit");
      } else if (e.key === "2") {
        this.setTool("brush");
      } else if (e.key === "3") {
        this.setTool("eraser");
      } else if (e.key === "4") {
        this.setTool("bucket");
      } else if (e.key === "5") {
        this.setTool("stamp");
      } else if (e.key === "6") {
        this.setTool("eyedropper");
      } else if (e.key.toLowerCase() === "t") {
        toggleTurntable();
      } else if (e.key.toLowerCase() === "r") {
        this.engine3D.resetCamera();
      } else if (e.key.toLowerCase() === "f") {
        this.engine3D.resetCamera();
      } else if (e.key === " ") {
        e.preventDefault();
        toggleTurntable();
      }
    });
  }

  setViewportMode(mode) {
    this.viewportMode = mode;
    const container = document.getElementById("canvas-container");
    const pane3D = document.getElementById("pane-3d");
    const pane2D = document.getElementById("pane-2d");

    if (mode === "3d") {
      container.classList.remove("split-mode");
      pane3D.hidden = false;
      pane2D.hidden = true;
    } else if (mode === "2d") {
      container.classList.remove("split-mode");
      pane3D.hidden = true;
      pane2D.hidden = false;
    } else if (mode === "split") {
      container.classList.add("split-mode");
      pane3D.hidden = false;
      pane2D.hidden = false;
    }

    this.engine3D.resize();
    this.uvEditor.resize();
  }

  setTool(tool) {
    this.currentTool = tool;
    document.querySelectorAll(".viewport-tools button[data-tool]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });

    const hud = document.getElementById("tool-hud");
    if (hud) hud.textContent = `${tool.toUpperCase()} · ${this.brushEngine.brushSettings.size}px`;

    // Disable OrbitControls damping when actively painting
    this.engine3D.controls.enabled = tool === "orbit";

    if (tool === "stamp") {
      this.switchInspectorTab("decals");
      this.showToast("Click on 3D Model to place Decal!");
    } else if (tool === "brush" || tool === "eraser") {
      this.switchInspectorTab("brush");
    }
  }

  switchInspectorTab(tabName) {
    this.activeInspectorTab = tabName;
    document.querySelectorAll(".inspector-tabs button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
    document.querySelectorAll(".tab-pane").forEach((pane) => (pane.hidden = true));
    const active = document.getElementById(`pane-${tabName}`);
    if (active) active.hidden = false;
  }

  syncBrushSize(val) {
    this.brushEngine.brushSettings.size = val;
    document.getElementById("brush-size-range").value = val;
    document.getElementById("brush-size-number").value = val;
    document.getElementById("quick-brush-size").value = val;
    document.getElementById("tool-hud").textContent = `${this.currentTool.toUpperCase()} · ${val}px`;
  }

  syncBrushOpacity(val) {
    this.brushEngine.brushSettings.opacity = val;
    const pct = Math.round(val * 100);
    document.getElementById("brush-opacity-range").value = pct;
    document.getElementById("brush-opacity-number").value = pct;
    document.getElementById("quick-brush-opacity").value = pct;
  }

  setBrushColor(hex) {
    this.brushEngine.brushSettings.color = hex;
    document.getElementById("quick-color-swatch").style.background = hex;
    document.getElementById("color-swatch-display").style.background = hex;
    document.getElementById("material-color-input").value = hex;
    document.getElementById("material-color-hex").value = hex.toUpperCase();
  }

  on3DPointerDown(e) {
    if (e.button === 2 || e.altKey) {
      // Right click or Alt drag navigates camera
      this.engine3D.controls.enabled = true;
      return;
    }

    if (this.currentTool === "orbit") {
      this.engine3D.controls.enabled = true;
      return;
    }

    this.engine3D.controls.enabled = false;
    const hit = this.engine3D.raycast(e.clientX, e.clientY);
    if (!hit) return;

    this.isMouseDown = true;
    const activeLayer = this.layerStack.getActiveLayer();
    if (!activeLayer || activeLayer.locked) return;

    // Snapshot history before stroke
    this.historyManager.pushState(`Paint ${this.currentTool}`, activeLayer);

    const texX = hit.uv.x * activeLayer.size;
    const texY = (1 - hit.uv.y) * activeLayer.size;
    this.lastUV = { x: texX, y: texY };

    if (this.currentTool === "stamp") {
      // Stamp Decal centered at 3D hit point!
      this.svgDecalSettings.u = hit.uv.x;
      this.svgDecalSettings.v = 1 - hit.uv.y;
      document.getElementById("decal-u-number").value = hit.uv.x.toFixed(2);
      document.getElementById("decal-v-number").value = (1 - hit.uv.y).toFixed(2);

      const isTextMode = document.getElementById("decal-type-text").classList.contains("active");
      if (isTextMode) {
        TextDecalRenderer.renderToLayer(activeLayer, {
          ...this.textDecalSettings,
          u: hit.uv.x,
          v: 1 - hit.uv.y
        });
      } else {
        SvgDecalRenderer.renderToLayer(activeLayer, {
          svgString: this.selectedSvgDecal.svg,
          ...this.svgDecalSettings,
          u: hit.uv.x,
          v: 1 - hit.uv.y
        });
      }
      activeLayer.updateThumbnail();
      this.updateCompositor();
      this.renderLayerTree();
      this.showToast("Stamped decal at 3D position");
      return;
    }

    if (this.currentTool === "bucket") {
      this.brushEngine.bucketFill(activeLayer);
      this.updateCompositor();
      this.renderLayerTree();
      return;
    }

    if (this.currentTool === "eyedropper") {
      this.pickColorAt(texX, texY);
      return;
    }

    // Single click stamp
    this.brushEngine.paintStamp(activeLayer, texX, texY, this.currentTool === "eraser");
    this.updateCompositor();
  }

  on3DPointerMove(e) {
    const hit = this.engine3D.raycast(e.clientX, e.clientY);
    this.engine3D.updateBrushCursor(hit, this.brushEngine.brushSettings.size, this.compositor.size);

    if (!this.isMouseDown || !this.lastUV || !hit) return;
    if (this.currentTool !== "brush" && this.currentTool !== "eraser") return;

    const activeLayer = this.layerStack.getActiveLayer();
    if (!activeLayer || activeLayer.locked) return;

    const texX = hit.uv.x * activeLayer.size;
    const texY = (1 - hit.uv.y) * activeLayer.size;

    this.brushEngine.paintStroke(activeLayer, this.lastUV.x, this.lastUV.y, texX, texY, this.currentTool === "eraser");
    this.lastUV = { x: texX, y: texY };

    this.updateCompositor();
  }

  on3DPointerUp(e) {
    if (this.isMouseDown) {
      this.isMouseDown = false;
      this.lastUV = null;
      const activeLayer = this.layerStack.getActiveLayer();
      if (activeLayer) {
        activeLayer.updateThumbnail();
        this.renderLayerTree();
      }
    }
    if (this.currentTool !== "orbit") {
      this.engine3D.controls.enabled = false;
    }
  }

  // 2D UV Canvas Handlers
  on2DPointerDown(e) {
    if (this.viewportMode === "3d") return;
    const uvHit = this.uvEditor.screenToUV(e.clientX, e.clientY);
    if (!uvHit) return;

    this.isMouseDown = true;
    const activeLayer = this.layerStack.getActiveLayer();
    if (!activeLayer || activeLayer.locked) return;

    this.historyManager.pushState(`2D Paint ${this.currentTool}`, activeLayer);

    const texX = uvHit.u * activeLayer.size;
    const texY = (1 - uvHit.v) * activeLayer.size;
    this.lastUV = { x: texX, y: texY };

    if (this.currentTool === "brush" || this.currentTool === "eraser") {
      this.brushEngine.paintStamp(activeLayer, texX, texY, this.currentTool === "eraser");
      this.updateCompositor();
    }
  }

  on2DPointerMove(e) {
    if (!this.isMouseDown || !this.lastUV) return;
    const uvHit = this.uvEditor.screenToUV(e.clientX, e.clientY);
    if (!uvHit) return;

    const activeLayer = this.layerStack.getActiveLayer();
    if (!activeLayer || activeLayer.locked) return;

    const texX = uvHit.u * activeLayer.size;
    const texY = (1 - uvHit.v) * activeLayer.size;

    this.brushEngine.paintStroke(activeLayer, this.lastUV.x, this.lastUV.y, texX, texY, this.currentTool === "eraser");
    this.lastUV = { x: texX, y: texY };

    this.updateCompositor();
  }

  on2DPointerUp(e) {
    if (this.isMouseDown) {
      this.isMouseDown = false;
      this.lastUV = null;
      const activeLayer = this.layerStack.getActiveLayer();
      if (activeLayer) {
        activeLayer.updateThumbnail();
        this.renderLayerTree();
      }
    }
  }

  pickColorAt(x, y) {
    const ctx = this.compositor.baseColorCanvas.getContext("2d");
    const pixel = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    const hex = "#" + ((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1);
    this.setBrushColor(hex);
    this.setTool("brush");
    this.showToast(`Eyedropper picked: ${hex}`);
  }

  handleUndo() {
    const state = this.historyManager.undo(this.layerStack);
    if (state) {
      this.updateCompositor();
      this.renderLayerTree();
      this.showToast(`Undo: ${state.actionName}`);
    } else {
      this.showToast("Nothing to undo");
    }
  }

  handleRedo() {
    const state = this.historyManager.redo(this.layerStack);
    if (state) {
      this.updateCompositor();
      this.renderLayerTree();
      this.showToast(`Redo: ${state.actionName}`);
    } else {
      this.showToast("Nothing to redo");
    }
  }

  renderLayerTree() {
    const tree = document.getElementById("scene-tree");
    if (!tree) return;
    tree.innerHTML = "";

    // Render layers in reverse order (top layer at top of tree)
    const reversed = [...this.layerStack.layers].reverse();

    reversed.forEach((layer) => {
      const isSelected = layer.id === this.layerStack.activeLayerId;
      const row = document.createElement("div");
      row.className = `scene-row ${isSelected ? "selected" : ""} ${layer.visible ? "" : "muted"}`;
      row.dataset.layerId = layer.id;
      row.dataset.layerType = layer.type;

      row.innerHTML = `
        <button class="icon-button row-toggle ${layer.visible ? "active" : ""}" title="Toggle visibility" data-action="toggle-vis">
          <span data-icon="${layer.visible ? "eye" : "hidden"}"></span>
        </button>
        <div class="layer-thumb-container">
          <img class="layer-thumb" src="${layer.thumbnailUrl || ""}" alt="" />
        </div>
        <div class="layer-info">
          <div class="layer-title-row">
            <span class="layer-name">${layer.name}</span>
            <span class="layer-badge">${layer.type.replace("decal_", "")}</span>
          </div>
          <div class="layer-meta-row">
            <span>${Math.round(layer.opacity * 100)}%</span>
            <span>·</span>
            <span style="text-transform: capitalize;">${layer.blendMode.replace("-", " ")}</span>
          </div>
        </div>
        <div class="layer-row-actions">
          <button class="icon-button row-toggle" title="${layer.locked ? "Unlock" : "Lock"}" data-action="toggle-lock">
            <span data-icon="${layer.locked ? "lock" : "unlock"}"></span>
          </button>
        </div>
      `;

      // Select row
      row.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        this.layerStack.setActiveLayer(layer.id);
        this.renderLayerTree();
        this.updateInspectorForActiveLayer();
      });

      // Visibility button
      const visBtn = row.querySelector('[data-action="toggle-vis"]');
      visBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        layer.visible = !layer.visible;
        this.updateCompositor();
        this.renderLayerTree();
      });

      // Lock button
      const lockBtn = row.querySelector('[data-action="toggle-lock"]');
      lockBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        layer.locked = !layer.locked;
        this.renderLayerTree();
      });

      tree.appendChild(row);
    });

    FillIcons(tree);
  }

  updateInspectorForActiveLayer() {
    const active = this.layerStack.getActiveLayer();
    if (!active) return;

    document.getElementById("selected-layer-name").value = active.name;
    document.getElementById("selected-layer-type").textContent = active.type.toUpperCase() + " LAYER";
    document.getElementById("selected-layer-visible").checked = active.visible;

    document.getElementById("layer-blend-select").value = active.blendMode;
    document.getElementById("layer-opacity-range").value = Math.round(active.opacity * 100);
    document.getElementById("layer-opacity-number").value = Math.round(active.opacity * 100);

    const symbol = document.getElementById("selected-layer-symbol");
    if (active.type === "fill") {
      symbol.innerHTML = `<span data-icon="paint-bucket"></span>`;
    } else if (active.type === "decal_svg") {
      symbol.innerHTML = `<span data-icon="stamp"></span>`;
    } else if (active.type === "decal_text") {
      symbol.innerHTML = `<span data-icon="type"></span>`;
    } else {
      symbol.innerHTML = `<span data-icon="brush"></span>`;
    }
    FillIcons(symbol);
  }

  renderMaterialLibrary() {
    const list = document.getElementById("presets-list");
    if (!list) return;
    list.innerHTML = "";

    MATERIAL_PRESETS.forEach((preset) => {
      const card = document.createElement("div");
      card.className = "preset-card";
      card.dataset.category = preset.category;
      card.dataset.presetId = preset.id;

      card.innerHTML = `
        <div class="preset-swatch" style="background: radial-gradient(circle at 35% 35%, #fff 2%, ${preset.color} 50%, #111 100%);"></div>
        <div class="preset-copy">
          <strong>${preset.name}</strong>
          <small>Rough: ${preset.roughness} · Metal: ${preset.metallic}</small>
        </div>
        <div class="preset-actions">
          <button class="preset-action-btn" data-action="fill" title="Add as Fill Layer">Fill</button>
          <button class="preset-action-btn" data-action="brush" title="Use as Brush">Brush</button>
        </div>
      `;

      card.addEventListener("click", (e) => {
        const action = e.target.dataset.action;
        if (action === "fill") {
          const fillLayer = this.layerStack.addLayer({
            name: `${preset.name} Fill`,
            type: "fill",
            fillSettings: preset
          });
          this.updateCompositor();
          this.renderLayerTree();
          this.showToast(`Applied ${preset.name} as Fill Layer`);
        } else {
          // Load into active brush
          this.setBrushColor(preset.color);
          this.brushEngine.brushSettings.roughness = preset.roughness;
          this.brushEngine.brushSettings.metallic = preset.metallic;
          this.brushEngine.brushSettings.height = preset.height || 0.0;
          this.syncBrushSize(this.brushEngine.brushSettings.size);

          document.getElementById("roughness-number").value = preset.roughness.toFixed(2);
          document.getElementById("roughness-range").value = Math.round(preset.roughness * 100);
          document.getElementById("metallic-number").value = preset.metallic.toFixed(2);
          document.getElementById("metallic-range").value = Math.round(preset.metallic * 100);

          this.switchInspectorTab("material");
          this.showToast(`Loaded ${preset.name} onto active brush`);
        }
      });

      list.appendChild(card);
    });
  }

  renderDecalLibrary() {
    const grid = document.getElementById("decal-library-grid");
    if (!grid) return;
    grid.innerHTML = "";

    SVG_DECALS.forEach((decal) => {
      const item = document.createElement("div");
      item.className = `decal-item-card ${decal.id === this.selectedSvgDecal.id ? "active" : ""}`;
      item.innerHTML = decal.svg;
      item.title = decal.name;

      item.addEventListener("click", () => {
        document.querySelectorAll(".decal-item-card").forEach((c) => c.classList.remove("active"));
        item.classList.add("active");
        this.selectedSvgDecal = decal;
        this.updateDecalPreview();
      });

      grid.appendChild(item);
    });
  }

  updateDecalPreview() {
    const previewBox = document.getElementById("decal-preview-box");
    if (!previewBox) return;

    const isText = document.getElementById("decal-type-text").classList.contains("active");

    if (isText) {
      previewBox.innerHTML = `
        <div style="
          padding: 6px 12px;
          border-radius: 6px;
          background: #111;
          border: 2px solid ${this.textDecalSettings.badgeColor};
          color: ${this.textDecalSettings.textColor};
          font-family: '${this.textDecalSettings.fontFamily}', sans-serif;
          font-size: 13px;
          font-weight: bold;
          letter-spacing: 2px;
          transform: rotate(${this.textDecalSettings.rotation}deg);
        ">
          ${this.textDecalSettings.text.toUpperCase()}
        </div>
      `;
    } else {
      if (this.selectedSvgDecal) {
        previewBox.innerHTML = `
          <div style="
            transform: rotate(${this.svgDecalSettings.rotation}deg);
            max-width: 80%;
            max-height: 80%;
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            ${this.selectedSvgDecal.svg}
          </div>
        `;
      }
    }
  }
}

// Start application when DOM is ready
window.addEventListener("DOMContentLoaded", () => {
  window.FrontierApp = new FrontierTexturePainter();
});
