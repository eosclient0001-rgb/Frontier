// NormalMapGenerator.js
// High-performance Sobel / Scharr filter generating tangent-space Normal Maps from Height Maps

export class NormalMapGenerator {
  static generateFromHeightCanvas(heightCanvas, normalCanvas, bumpStrength = 2.0) {
    const width = heightCanvas.width;
    const height = heightCanvas.height;

    normalCanvas.width = width;
    normalCanvas.height = height;

    const hCtx = heightCanvas.getContext("2d", { willReadFrequently: true });
    const nCtx = normalCanvas.getContext("2d");

    const hImgData = hCtx.getImageData(0, 0, width, height);
    const hData = hImgData.data;

    const nImgData = nCtx.createImageData(width, height);
    const nData = nImgData.data;

    // Helper to get normalized height at x, y with edge clamping
    const getHeight = (x, y) => {
      const cx = Math.max(0, Math.min(width - 1, x));
      const cy = Math.max(0, Math.min(height - 1, y));
      return hData[(cy * width + cx) * 4] / 255.0;
    };

    const strength = bumpStrength;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Sample 3x3 neighborhood
        const tl = getHeight(x - 1, y - 1);
        const t  = getHeight(x,     y - 1);
        const tr = getHeight(x + 1, y - 1);

        const l  = getHeight(x - 1, y);
        const r  = getHeight(x + 1, y);

        const bl = getHeight(x - 1, y + 1);
        const b  = getHeight(x,     y + 1);
        const br = getHeight(x + 1, y + 1);

        // Sobel kernels
        const dx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
        const dy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);

        // Tangent normal vector
        let nx = -dx * strength;
        let ny = -dy * strength;
        let nz = 1.0;

        const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= invLen;
        ny *= invLen;
        nz *= invLen;

        const idx = (y * width + x) * 4;
        nData[idx]     = Math.round((nx * 0.5 + 0.5) * 255);
        nData[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        nData[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        nData[idx + 3] = 255;
      }
    }

    nCtx.putImageData(nImgData, 0, 0);
  }
}
