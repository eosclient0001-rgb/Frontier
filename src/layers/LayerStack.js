// LayerStack.js
// High-level Layer Stack coordinator managing order, selection, and operations

import { Layer } from "./Layer.js";

export class LayerStack {
  constructor(size = 2048) {
    this.size = size;
    this.layers = [];
    this.activeLayerId = null;
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach((fn) => fn(this));
  }

  getActiveLayer() {
    return this.layers.find((l) => l.id === this.activeLayerId) || this.layers[this.layers.length - 1] || null;
  }

  setActiveLayer(id) {
    this.activeLayerId = id;
    this.notify();
  }

  addLayer(options = {}) {
    const layer = new Layer({
      size: this.size,
      ...options
    });

    // Insert above active layer, or at top
    const activeIdx = this.layers.findIndex((l) => l.id === this.activeLayerId);
    if (activeIdx !== -1) {
      this.layers.splice(activeIdx + 1, 0, layer);
    } else {
      this.layers.push(layer);
    }

    this.activeLayerId = layer.id;
    this.notify();
    return layer;
  }

  removeLayer(id) {
    if (this.layers.length <= 1) return; // Keep at least one layer
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx === -1) return;

    this.layers.splice(idx, 1);
    if (this.activeLayerId === id) {
      const nextIdx = Math.max(0, idx - 1);
      this.activeLayerId = this.layers[nextIdx] ? this.layers[nextIdx].id : null;
    }
    this.notify();
  }

  duplicateLayer(id) {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return;

    const cloned = layer.clone();
    const idx = this.layers.indexOf(layer);
    this.layers.splice(idx + 1, 0, cloned);
    this.activeLayerId = cloned.id;
    this.notify();
    return cloned;
  }

  moveLayer(id, delta) {
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx === -1) return;
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= this.layers.length) return;

    const [moved] = this.layers.splice(idx, 1);
    this.layers.splice(newIdx, 0, moved);
    this.notify();
  }

  mergeDown(id) {
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx <= 0) return; // Cannot merge down bottom-most layer

    const top = this.layers[idx];
    const bottom = this.layers[idx - 1];

    if (bottom.locked) return;

    // Composite top onto bottom
    const bColorCtx = bottom.colorCanvas.getContext("2d");
    bColorCtx.save();
    bColorCtx.globalAlpha = top.opacity;
    bColorCtx.globalCompositeOperation = top.blendMode;
    bColorCtx.drawImage(top.colorCanvas, 0, 0);
    bColorCtx.restore();

    // Roughness, Metallic, Height
    bottom.roughnessCanvas.getContext("2d").drawImage(top.roughnessCanvas, 0, 0);
    bottom.metallicCanvas.getContext("2d").drawImage(top.metallicCanvas, 0, 0);
    bottom.heightCanvas.getContext("2d").drawImage(top.heightCanvas, 0, 0);

    bottom.updateThumbnail();
    this.removeLayer(id);
    this.activeLayerId = bottom.id;
    this.notify();
  }
}
