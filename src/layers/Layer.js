// Layer.js
// Multi-channel layer representation supporting Paint, Fill Material, SVG Decals, and Text Decals

export class Layer {
  constructor(options = {}) {
    this.id = options.id || "layer_" + Math.random().toString(36).substr(2, 9);
    this.name = options.name || "Paint Layer";
    this.type = options.type || "paint"; // "paint" | "fill" | "decal_svg" | "decal_text"
    this.visible = options.visible !== undefined ? options.visible : true;
    this.locked = options.locked !== undefined ? options.locked : false;
    this.opacity = options.opacity !== undefined ? options.opacity : 1.0;
    this.blendMode = options.blendMode || "source-over"; // "source-over", "multiply", "screen", "overlay", "lighter", "darken", "color-dodge"

    this.channels = {
      color: true,
      roughness: true,
      metallic: true,
      height: true,
      emission: false,
      ...(options.channels || {})
    };

    this.size = options.size || 2048;

    // Allocate 2D Canvases for each PBR channel
    this.colorCanvas = document.createElement("canvas");
    this.colorCanvas.width = this.size;
    this.colorCanvas.height = this.size;

    this.roughnessCanvas = document.createElement("canvas");
    this.roughnessCanvas.width = this.size;
    this.roughnessCanvas.height = this.size;

    this.metallicCanvas = document.createElement("canvas");
    this.metallicCanvas.width = this.size;
    this.metallicCanvas.height = this.size;

    this.heightCanvas = document.createElement("canvas");
    this.heightCanvas.width = this.size;
    this.heightCanvas.height = this.size;

    this.emissionCanvas = document.createElement("canvas");
    this.emissionCanvas.width = this.size;
    this.emissionCanvas.height = this.size;

    // Fill defaults for roughness (128 = 0.5), metallic (0), height (128 = neutral 0.0)
    this.initDefaultChannels(options);

    // Metadata for Fill layers or Decal layers
    this.fillSettings = options.fillSettings ? { ...options.fillSettings } : null;
    this.decalSettings = options.decalSettings ? { ...options.decalSettings } : null;

    // Thumbnail cache
    this.thumbnailUrl = "";
    this.updateThumbnail();
  }

  initDefaultChannels(options) {
    if (this.type === "fill" && options.fillSettings) {
      // Fill entire layer with chosen material
      this.applyFill(options.fillSettings);
      return;
    }

    // Default transparent color
    const cCtx = this.colorCanvas.getContext("2d");
    cCtx.clearRect(0, 0, this.size, this.size);

    // Default roughness
    const rCtx = this.roughnessCanvas.getContext("2d");
    rCtx.fillStyle = "rgb(128, 128, 128)"; // 0.5
    rCtx.fillRect(0, 0, this.size, this.size);

    // Default metallic
    const mCtx = this.metallicCanvas.getContext("2d");
    mCtx.fillStyle = "rgb(0, 0, 0)"; // 0.0
    mCtx.fillRect(0, 0, this.size, this.size);

    // Default height
    const hCtx = this.heightCanvas.getContext("2d");
    hCtx.fillStyle = "rgb(128, 128, 128)"; // neutral height
    hCtx.fillRect(0, 0, this.size, this.size);

    // Default emission
    const eCtx = this.emissionCanvas.getContext("2d");
    eCtx.fillStyle = "rgb(0, 0, 0)";
    eCtx.fillRect(0, 0, this.size, this.size);
  }

  applyFill(settings) {
    const { color = "#7a818c", roughness = 0.5, metallic = 0.0, height = 0.0, emissiveColor = "#000000" } = settings;

    // Color
    const cCtx = this.colorCanvas.getContext("2d");
    cCtx.fillStyle = color;
    cCtx.fillRect(0, 0, this.size, this.size);

    // Roughness
    const rCtx = this.roughnessCanvas.getContext("2d");
    const rVal = Math.round(roughness * 255);
    rCtx.fillStyle = `rgb(${rVal}, ${rVal}, ${rVal})`;
    rCtx.fillRect(0, 0, this.size, this.size);

    // Metallic
    const mCtx = this.metallicCanvas.getContext("2d");
    const mVal = Math.round(metallic * 255);
    mCtx.fillStyle = `rgb(${mVal}, ${mVal}, ${mVal})`;
    mCtx.fillRect(0, 0, this.size, this.size);

    // Height
    const hCtx = this.heightCanvas.getContext("2d");
    const hVal = Math.round(128 + height * 127);
    hCtx.fillStyle = `rgb(${hVal}, ${hVal}, ${hVal})`;
    hCtx.fillRect(0, 0, this.size, this.size);

    // Emission
    const eCtx = this.emissionCanvas.getContext("2d");
    eCtx.fillStyle = emissiveColor;
    eCtx.fillRect(0, 0, this.size, this.size);

    this.updateThumbnail();
  }

  clear() {
    const cCtx = this.colorCanvas.getContext("2d");
    cCtx.clearRect(0, 0, this.size, this.size);

    const rCtx = this.roughnessCanvas.getContext("2d");
    rCtx.fillStyle = "rgb(128, 128, 128)";
    rCtx.fillRect(0, 0, this.size, this.size);

    const mCtx = this.metallicCanvas.getContext("2d");
    mCtx.fillStyle = "rgb(0, 0, 0)";
    mCtx.fillRect(0, 0, this.size, this.size);

    const hCtx = this.heightCanvas.getContext("2d");
    hCtx.fillStyle = "rgb(128, 128, 128)";
    hCtx.fillRect(0, 0, this.size, this.size);

    this.updateThumbnail();
  }

  clone() {
    const cloned = new Layer({
      name: this.name + " Copy",
      type: this.type,
      visible: this.visible,
      locked: this.locked,
      opacity: this.opacity,
      blendMode: this.blendMode,
      channels: { ...this.channels },
      size: this.size,
      fillSettings: this.fillSettings ? { ...this.fillSettings } : null,
      decalSettings: this.decalSettings ? { ...this.decalSettings } : null
    });

    cloned.colorCanvas.getContext("2d").drawImage(this.colorCanvas, 0, 0);
    cloned.roughnessCanvas.getContext("2d").drawImage(this.roughnessCanvas, 0, 0);
    cloned.metallicCanvas.getContext("2d").drawImage(this.metallicCanvas, 0, 0);
    cloned.heightCanvas.getContext("2d").drawImage(this.heightCanvas, 0, 0);
    cloned.emissionCanvas.getContext("2d").drawImage(this.emissionCanvas, 0, 0);
    cloned.updateThumbnail();

    return cloned;
  }

  updateThumbnail() {
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = 32;
    thumbCanvas.height = 32;
    const ctx = thumbCanvas.getContext("2d");
    ctx.drawImage(this.colorCanvas, 0, 0, 32, 32);
    this.thumbnailUrl = thumbCanvas.toDataURL("image/png");
  }
}
