// ExportManager.js
// Exports PBR texture maps, ORM packed maps, OBJ/GLTF 3D models, and .paint projects

import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";

export class ExportManager {
  static downloadCanvasAsPNG(canvas, filename) {
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  static exportPackedORM(compositor, filename = "Packed_ORM.png") {
    const size = compositor.size;
    const ormCanvas = document.createElement("canvas");
    ormCanvas.width = size;
    ormCanvas.height = size;
    const ctx = ormCanvas.getContext("2d");

    // Roughness & Metallic source data
    const rData = compositor.roughnessCanvas.getContext("2d").getImageData(0, 0, size, size).data;
    const mData = compositor.metalnessCanvas.getContext("2d").getImageData(0, 0, size, size).data;

    const ormImg = ctx.createImageData(size, size);
    const dst = ormImg.data;

    for (let i = 0; i < dst.length; i += 4) {
      dst[i]     = 255;        // R: Ambient Occlusion (default 1.0)
      dst[i + 1] = rData[i];   // G: Roughness
      dst[i + 2] = mData[i];   // B: Metallic
      dst[i + 3] = 255;        // A: 1.0
    }

    ctx.putImageData(ormImg, 0, 0);
    this.downloadCanvasAsPNG(ormCanvas, filename);
  }

  static exportAllChannels(compositor, docName = "Texture") {
    this.downloadCanvasAsPNG(compositor.baseColorCanvas, `${docName}_BaseColor.png`);
    setTimeout(() => this.downloadCanvasAsPNG(compositor.roughnessCanvas, `${docName}_Roughness.png`), 200);
    setTimeout(() => this.downloadCanvasAsPNG(compositor.metalnessCanvas, `${docName}_Metallic.png`), 400);
    setTimeout(() => this.downloadCanvasAsPNG(compositor.normalCanvas, `${docName}_Normal.png`), 600);
    setTimeout(() => this.downloadCanvasAsPNG(compositor.heightCanvas, `${docName}_Height.png`), 800);
  }

  static exportGLTF(mesh, docName = "Model") {
    if (!mesh) return;
    const exporter = new GLTFExporter();
    exporter.parse(
      mesh,
      (gltf) => {
        const blob = new Blob([JSON.stringify(gltf, null, 2)], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${docName}.gltf`;
        link.click();
      },
      (error) => console.error("GLTF Export Error:", error),
      { binary: false }
    );
  }

  static exportOBJ(mesh, docName = "Model") {
    if (!mesh) return;
    const exporter = new OBJExporter();
    const result = exporter.parse(mesh);
    const blob = new Blob([result], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${docName}.obj`;
    link.click();
  }

  static saveProject(docName, modelId, layerStack) {
    const project = {
      version: "1.0",
      generator: "Frontier Texture Paint",
      date: new Date().toISOString(),
      docName,
      modelId,
      layers: layerStack.layers.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        visible: l.visible,
        locked: l.locked,
        opacity: l.opacity,
        blendMode: l.blendMode,
        channels: l.channels,
        colorData: l.colorCanvas.toDataURL("image/png"),
        roughnessData: l.roughnessCanvas.toDataURL("image/png"),
        metallicData: l.metallicCanvas.toDataURL("image/png"),
        heightData: l.heightCanvas.toDataURL("image/png"),
        fillSettings: l.fillSettings,
        decalSettings: l.decalSettings
      }))
    };

    const blob = new Blob([JSON.stringify(project)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${docName}.paint`;
    link.click();
  }

  static async loadProject(file, layerStack) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const project = JSON.parse(e.target.result);
          layerStack.layers = [];

          for (const lData of project.layers) {
            const layer = layerStack.addLayer({
              id: lData.id,
              name: lData.name,
              type: lData.type,
              visible: lData.visible,
              locked: lData.locked,
              opacity: lData.opacity,
              blendMode: lData.blendMode,
              channels: lData.channels,
              fillSettings: lData.fillSettings,
              decalSettings: lData.decalSettings
            });

            await this.loadImageToCanvas(lData.colorData, layer.colorCanvas);
            await this.loadImageToCanvas(lData.roughnessData, layer.roughnessCanvas);
            await this.loadImageToCanvas(lData.metallicData, layer.metallicCanvas);
            await this.loadImageToCanvas(lData.heightData, layer.heightCanvas);
            layer.updateThumbnail();
          }

          layerStack.activeLayerId = layerStack.layers[layerStack.layers.length - 1].id;
          layerStack.notify();
          resolve(project);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  static async loadImageToCanvas(dataUrl, canvas) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve();
      };
      img.src = dataUrl;
    });
  }
}
