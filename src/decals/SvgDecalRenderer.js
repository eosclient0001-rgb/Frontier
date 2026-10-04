// SvgDecalRenderer.js
// Renders SVG decals into multi-channel PBR textures (Color, Roughness, Metallic, Height)

export class SvgDecalRenderer {
  static async svgToImage(svgString) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  }

  static async renderToLayer(layer, options, targetSize = 2048) {
    const {
      svgString,
      u = 0.5,
      v = 0.5,
      scale = 0.25,
      rotation = 0, // degrees
      tintColor = null,
      useTint = false,
      roughness = 0.2,
      metallic = 0.1,
      height = 0.25, // positive = embossed, negative = debossed
      opacity = 1.0
    } = options;

    const img = await this.svgToImage(svgString);

    // Setup decal dimensions
    const decalPixelSize = targetSize * scale;
    const aspect = img.width / img.height;
    let drawW = decalPixelSize;
    let drawH = decalPixelSize / aspect;

    const posX = u * targetSize;
    const posY = v * targetSize;
    const rad = (rotation * Math.PI) / 180;

    // Temporary canvas for drawing the decal isolated
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = targetSize;
    tempCanvas.height = targetSize;
    const ctx = tempCanvas.getContext("2d");

    ctx.save();
    ctx.translate(posX, posY);
    ctx.rotate(rad);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    // If tint is requested, apply color tint mask
    if (useTint && tintColor) {
      ctx.save();
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = tintColor;
      ctx.fillRect(0, 0, targetSize, targetSize);
      ctx.restore();
    }

    // Now composite onto layer canvases
    const layerColorCtx = layer.colorCanvas.getContext("2d");
    layerColorCtx.save();
    layerColorCtx.globalAlpha = opacity;
    layerColorCtx.drawImage(tempCanvas, 0, 0);
    layerColorCtx.restore();

    // Extract alpha mask for roughness, metallic, and height
    const imgData = ctx.getImageData(0, 0, targetSize, targetSize);
    const data = imgData.data;

    // Composite Roughness
    if (layer.channels.roughness) {
      const roughCtx = layer.roughnessCanvas.getContext("2d");
      const roughData = roughCtx.getImageData(0, 0, targetSize, targetSize);
      const rVal = Math.round(roughness * 255);

      for (let i = 0; i < data.length; i += 4) {
        const alpha = (data[i + 3] / 255) * opacity;
        if (alpha > 0.05) {
          roughData.data[i] = Math.round(roughData.data[i] * (1 - alpha) + rVal * alpha);
          roughData.data[i + 1] = roughData.data[i];
          roughData.data[i + 2] = roughData.data[i];
          roughData.data[i + 3] = 255;
        }
      }
      roughCtx.putImageData(roughData, 0, 0);
    }

    // Composite Metallic
    if (layer.channels.metallic) {
      const metalCtx = layer.metallicCanvas.getContext("2d");
      const metalData = metalCtx.getImageData(0, 0, targetSize, targetSize);
      const mVal = Math.round(metallic * 255);

      for (let i = 0; i < data.length; i += 4) {
        const alpha = (data[i + 3] / 255) * opacity;
        if (alpha > 0.05) {
          metalData.data[i] = Math.round(metalData.data[i] * (1 - alpha) + mVal * alpha);
          metalData.data[i + 1] = metalData.data[i];
          metalData.data[i + 2] = metalData.data[i];
          metalData.data[i + 3] = 255;
        }
      }
      metalCtx.putImageData(metalData, 0, 0);
    }

    // Composite Height (128 is neutral, >128 embossed, <128 debossed)
    if (layer.channels.height) {
      const heightCtx = layer.heightCanvas.getContext("2d");
      const heightData = heightCtx.getImageData(0, 0, targetSize, targetSize);
      const hVal = Math.round(128 + height * 127);

      for (let i = 0; i < data.length; i += 4) {
        const alpha = (data[i + 3] / 255) * opacity;
        if (alpha > 0.05) {
          heightData.data[i] = Math.round(heightData.data[i] * (1 - alpha) + hVal * alpha);
          heightData.data[i + 1] = heightData.data[i];
          heightData.data[i + 2] = heightData.data[i];
          heightData.data[i + 3] = 255;
        }
      }
      heightCtx.putImageData(heightData, 0, 0);
    }
  }
}
