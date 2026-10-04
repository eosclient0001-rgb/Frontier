// BrushEngine.js
// Multi-channel 2D and 3D projection brush painter with stroke interpolation and symmetry

export class BrushEngine {
  constructor() {
    this.brushSettings = {
      size: 45, // px
      opacity: 1.0,
      hardness: 0.8, // 0 = soft, 1 = hard
      spacing: 0.1, // percentage of diameter
      flow: 1.0,
      shape: "round_soft", // "round_soft", "round_hard", "square", "noise", "stipple"
      color: "#e03e3e",
      roughness: 0.35,
      metallic: 0.9,
      height: 0.2, // bump
      emissionColor: "#000000",
      emissionIntensity: 0.0,
      symmetryX: false,
      symmetryY: false,
      symmetryZ: false,
      paintChannels: {
        color: true,
        roughness: true,
        metallic: true,
        height: true,
        emission: false
      }
    };

    this.isPainting = false;
    this.lastPoint = null;
  }

  createBrushTip(size, hardness, shape, colorHex, alpha = 1.0) {
    const tipCanvas = document.createElement("canvas");
    const radius = Math.max(1, Math.round(size / 2));
    const diameter = radius * 2;
    tipCanvas.width = diameter;
    tipCanvas.height = diameter;
    const ctx = tipCanvas.getContext("2d");

    ctx.save();
    if (shape === "round_hard" || hardness >= 0.98) {
      ctx.fillStyle = colorHex;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(radius, radius, radius, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === "square") {
      ctx.fillStyle = colorHex;
      ctx.globalAlpha = alpha;
      ctx.fillRect(0, 0, diameter, diameter);
    } else if (shape === "noise") {
      ctx.fillStyle = colorHex;
      for (let i = 0; i < diameter * 4; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = Math.pow(Math.random(), 0.7) * radius;
        const px = radius + Math.cos(ang) * dist;
        const py = radius + Math.sin(ang) * dist;
        const r = 1 + Math.random() * 2;
        ctx.globalAlpha = alpha * (1 - dist / radius) * (0.3 + Math.random() * 0.7);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Standard radial gradient soft/hard round
      const grad = ctx.createRadialGradient(
        radius, radius, Math.max(0, radius * hardness),
        radius, radius, radius
      );
      grad.addColorStop(0, colorHex);
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(radius, radius, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    return tipCanvas;
  }

  paintStamp(layer, x, y, isEraser = false) {
    if (!layer || layer.locked) return;

    const {
      size,
      opacity,
      hardness,
      shape,
      color,
      roughness,
      metallic,
      height,
      paintChannels,
      symmetryX,
      symmetryY
    } = this.brushSettings;

    const points = [{ x, y }];
    const w = layer.size;
    const h = layer.size;

    if (symmetryX) {
      points.push({ x: w - x, y });
    }
    if (symmetryY) {
      points.push({ x, y: h - y });
    }
    if (symmetryX && symmetryY) {
      points.push({ x: w - x, y: h - y });
    }

    const radius = Math.round(size / 2);

    for (const pt of points) {
      const px = Math.round(pt.x);
      const py = Math.round(pt.y);

      // Color Channel
      if (paintChannels.color && layer.channels.color) {
        const cCtx = layer.colorCanvas.getContext("2d");
        cCtx.save();
        if (isEraser) {
          cCtx.globalCompositeOperation = "destination-out";
          const eraserTip = this.createBrushTip(size, hardness, shape, "#ffffff", opacity);
          cCtx.drawImage(eraserTip, px - radius, py - radius);
        } else {
          const colorTip = this.createBrushTip(size, hardness, shape, color, opacity);
          cCtx.drawImage(colorTip, px - radius, py - radius);
        }
        cCtx.restore();
      }

      // Roughness Channel
      if (!isEraser && paintChannels.roughness && layer.channels.roughness) {
        const rCtx = layer.roughnessCanvas.getContext("2d");
        const rVal = Math.round(roughness * 255);
        const rHex = `rgb(${rVal}, ${rVal}, ${rVal})`;
        const rTip = this.createBrushTip(size, hardness, shape, rHex, opacity);
        rCtx.save();
        rCtx.drawImage(rTip, px - radius, py - radius);
        rCtx.restore();
      }

      // Metallic Channel
      if (!isEraser && paintChannels.metallic && layer.channels.metallic) {
        const mCtx = layer.metallicCanvas.getContext("2d");
        const mVal = Math.round(metallic * 255);
        const mHex = `rgb(${mVal}, ${mVal}, ${mVal})`;
        const mTip = this.createBrushTip(size, hardness, shape, mHex, opacity);
        mCtx.save();
        mCtx.drawImage(mTip, px - radius, py - radius);
        mCtx.restore();
      }

      // Height Channel (128 is neutral 0)
      if (!isEraser && paintChannels.height && layer.channels.height) {
        const hCtx = layer.heightCanvas.getContext("2d");
        const hVal = Math.round(128 + height * 127);
        const hHex = `rgb(${hVal}, ${hVal}, ${hVal})`;
        const hTip = this.createBrushTip(size, hardness, shape, hHex, opacity);
        hCtx.save();
        hCtx.drawImage(hTip, px - radius, py - radius);
        hCtx.restore();
      }
    }
  }

  paintStroke(layer, startX, startY, endX, endY, isEraser = false) {
    const dx = endX - startX;
    const dy = endY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const step = Math.max(1, this.brushSettings.size * this.brushSettings.spacing);
    const steps = Math.ceil(dist / step);

    if (steps === 0) {
      this.paintStamp(layer, endX, endY, isEraser);
      return;
    }

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = startX + dx * t;
      const y = startY + dy * t;
      this.paintStamp(layer, x, y, isEraser);
    }
  }

  bucketFill(layer) {
    if (!layer || layer.locked) return;
    const { color, roughness, metallic, height, paintChannels } = this.brushSettings;
    const w = layer.size;
    const h = layer.size;

    if (paintChannels.color && layer.channels.color) {
      const cCtx = layer.colorCanvas.getContext("2d");
      cCtx.fillStyle = color;
      cCtx.fillRect(0, 0, w, h);
    }

    if (paintChannels.roughness && layer.channels.roughness) {
      const rCtx = layer.roughnessCanvas.getContext("2d");
      const rVal = Math.round(roughness * 255);
      rCtx.fillStyle = `rgb(${rVal}, ${rVal}, ${rVal})`;
      rCtx.fillRect(0, 0, w, h);
    }

    if (paintChannels.metallic && layer.channels.metallic) {
      const mCtx = layer.metallicCanvas.getContext("2d");
      const mVal = Math.round(metallic * 255);
      mCtx.fillStyle = `rgb(${mVal}, ${mVal}, ${mVal})`;
      mCtx.fillRect(0, 0, w, h);
    }

    if (paintChannels.height && layer.channels.height) {
      const hCtx = layer.heightCanvas.getContext("2d");
      const hVal = Math.round(128 + height * 127);
      hCtx.fillStyle = `rgb(${hVal}, ${hVal}, ${hVal})`;
      hCtx.fillRect(0, 0, w, h);
    }

    layer.updateThumbnail();
  }
}
