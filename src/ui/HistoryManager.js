// HistoryManager.js
// Undo / Redo history state tracker with timeline integration

export class HistoryManager {
  constructor(maxSteps = 25) {
    this.maxSteps = maxSteps;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach((fn) => fn(this));
  }

  pushState(actionName, layer) {
    if (!layer) return;

    // Snapshot layer canvas states
    const snapshot = {
      actionName,
      layerId: layer.id,
      color: this.cloneCanvas(layer.colorCanvas),
      roughness: this.cloneCanvas(layer.roughnessCanvas),
      metallic: this.cloneCanvas(layer.metallicCanvas),
      height: this.cloneCanvas(layer.heightCanvas)
    };

    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxSteps) {
      this.undoStack.shift();
    }
    this.redoStack = []; // Clear redo stack on new action

    this.notify();
  }

  undo(layerStack) {
    if (this.undoStack.length <= 1) return null; // Keep initial state

    const currentState = this.undoStack.pop();
    this.redoStack.push(currentState);

    const prevState = this.undoStack[this.undoStack.length - 1];
    this.applyState(prevState, layerStack);

    this.notify();
    return prevState;
  }

  redo(layerStack) {
    if (this.redoStack.length === 0) return null;

    const nextState = this.redoStack.pop();
    this.undoStack.push(nextState);
    this.applyState(nextState, layerStack);

    this.notify();
    return nextState;
  }

  applyState(state, layerStack) {
    if (!state) return;
    const layer = layerStack.layers.find((l) => l.id === state.layerId);
    if (!layer) return;

    this.copyCanvas(state.color, layer.colorCanvas);
    this.copyCanvas(state.roughness, layer.roughnessCanvas);
    this.copyCanvas(state.metallic, layer.metallicCanvas);
    this.copyCanvas(state.height, layer.heightCanvas);
    layer.updateThumbnail();
  }

  cloneCanvas(sourceCanvas) {
    const copy = document.createElement("canvas");
    copy.width = sourceCanvas.width;
    copy.height = sourceCanvas.height;
    copy.getContext("2d").drawImage(sourceCanvas, 0, 0);
    return copy;
  }

  copyCanvas(src, dst) {
    const ctx = dst.getContext("2d");
    ctx.clearRect(0, 0, dst.width, dst.height);
    ctx.drawImage(src, 0, 0);
  }
}
