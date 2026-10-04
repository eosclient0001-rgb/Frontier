// TextureCompositor.js
// Composites multi-channel layer stacks into unified PBR textures for Three.js

import * as THREE from "three";
import { NormalMapGenerator } from "./NormalMapGenerator.js";

export class TextureCompositor {
  constructor(size = 2048) {
    this.size = size;

    // Composite canvases
    this.baseColorCanvas = document.createElement("canvas");
    this.baseColorCanvas.width = this.size;
    this.baseColorCanvas.height = this.size;

    this.roughnessCanvas = document.createElement("canvas");
    this.roughnessCanvas.width = this.size;
    this.roughnessCanvas.height = this.size;

    this.metalnessCanvas = document.createElement("canvas");
    this.metalnessCanvas.width = this.size;
    this.metalnessCanvas.height = this.size;

    this.heightCanvas = document.createElement("canvas");
    this.heightCanvas.width = this.size;
    this.heightCanvas.height = this.size;

    this.normalCanvas = document.createElement("canvas");
    this.normalCanvas.width = this.size;
    this.normalCanvas.height = this.size;

    this.emissiveCanvas = document.createElement("canvas");
    this.emissiveCanvas.width = this.size;
    this.emissiveCanvas.height = this.size;

    // Three.js CanvasTextures
    this.baseColorTexture = new THREE.CanvasTexture(this.baseColorCanvas);
    this.baseColorTexture.colorSpace = THREE.SRGBColorSpace;
    this.baseColorTexture.generateMipmaps = true;
    this.baseColorTexture.minFilter = THREE.LinearMipmapLinearFilter;

    this.roughnessTexture = new THREE.CanvasTexture(this.roughnessCanvas);
    this.roughnessTexture.generateMipmaps = true;

    this.metalnessTexture = new THREE.CanvasTexture(this.metalnessCanvas);
    this.metalnessTexture.generateMipmaps = true;

    this.normalTexture = new THREE.CanvasTexture(this.normalCanvas);
    this.normalTexture.generateMipmaps = true;

    this.emissiveTexture = new THREE.CanvasTexture(this.emissiveCanvas);
    this.emissiveTexture.colorSpace = THREE.SRGBColorSpace;
    this.emissiveTexture.generateMipmaps = true;

    this.bumpStrength = 2.5;
  }

  composite(layerStack) {
    const visibleLayers = layerStack.layers.filter((l) => l.visible);

    const cCtx = this.baseColorCanvas.getContext("2d");
    const rCtx = this.roughnessCanvas.getContext("2d");
    const mCtx = this.metalnessCanvas.getContext("2d");
    const hCtx = this.heightCanvas.getContext("2d");
    const eCtx = this.emissiveCanvas.getContext("2d");

    // Clear composite buffers
    cCtx.clearRect(0, 0, this.size, this.size);
    cCtx.fillStyle = "#222225"; // Neutral base if completely empty
    cCtx.fillRect(0, 0, this.size, this.size);

    rCtx.fillStyle = "#808080"; // Roughness 0.5 default
    rCtx.fillRect(0, 0, this.size, this.size);

    mCtx.fillStyle = "#000000"; // Metalness 0.0 default
    mCtx.fillRect(0, 0, this.size, this.size);

    hCtx.fillStyle = "#808080"; // Neutral height
    hCtx.fillRect(0, 0, this.size, this.size);

    eCtx.fillStyle = "#000000";
    eCtx.fillRect(0, 0, this.size, this.size);

    // Composite each visible layer from bottom to top
    for (const layer of visibleLayers) {
      const op = layer.opacity;

      // Base Color
      if (layer.channels.color) {
        cCtx.save();
        cCtx.globalAlpha = op;
        cCtx.globalCompositeOperation = layer.blendMode || "source-over";
        cCtx.drawImage(layer.colorCanvas, 0, 0);
        cCtx.restore();
      }

      // Roughness
      if (layer.channels.roughness) {
        rCtx.save();
        rCtx.globalAlpha = op;
        rCtx.drawImage(layer.roughnessCanvas, 0, 0);
        rCtx.restore();
      }

      // Metallic
      if (layer.channels.metallic) {
        mCtx.save();
        mCtx.globalAlpha = op;
        mCtx.drawImage(layer.metallicCanvas, 0, 0);
        mCtx.restore();
      }

      // Height
      if (layer.channels.height) {
        hCtx.save();
        hCtx.globalAlpha = op;
        hCtx.drawImage(layer.heightCanvas, 0, 0);
        hCtx.restore();
      }

      // Emission
      if (layer.channels.emission) {
        eCtx.save();
        eCtx.globalAlpha = op;
        eCtx.globalCompositeOperation = "lighter";
        eCtx.drawImage(layer.emissionCanvas, 0, 0);
        eCtx.restore();
      }
    }

    // Generate Normal Map from combined Height
    NormalMapGenerator.generateFromHeightCanvas(this.heightCanvas, this.normalCanvas, this.bumpStrength);

    // Notify Three.js to re-upload textures to GPU
    this.baseColorTexture.needsUpdate = true;
    this.roughnessTexture.needsUpdate = true;
    this.metalnessTexture.needsUpdate = true;
    this.normalTexture.needsUpdate = true;
    this.emissiveTexture.needsUpdate = true;
  }
}
