// TextDecalRenderer.js
// Renders rich typography decals onto multi-channel PBR textures

export class TextDecalRenderer {
  static renderToLayer(layer, options, targetSize = 2048) {
    const {
      text = "DANGER // KEEP CLEAR",
      fontFamily = "DM Sans",
      fontSize = 48,
      bold = true,
      italic = false,
      allCaps = true,
      letterSpacing = 4,
      badgeStyle = "hazard_box", // "none", "hazard_box", "pill", "reticle", "inverted_box"
      textColor = "#ffffff",
      badgeColor = "#ffcc00",
      u = 0.5,
      v = 0.5,
      scale = 0.35,
      rotation = 0, // degrees
      roughness = 0.3,
      metallic = 0.05,
      height = 0.35,
      opacity = 1.0
    } = options;

    const displayText = allCaps ? text.toUpperCase() : text;

    // Temporary canvas to render text badge
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = targetSize;
    tempCanvas.height = targetSize;
    const ctx = tempCanvas.getContext("2d");

    const posX = u * targetSize;
    const posY = v * targetSize;
    const rad = (rotation * Math.PI) / 180;

    ctx.save();
    ctx.translate(posX, posY);
    ctx.rotate(rad);

    // Compute scaled font size
    const actualFontSize = Math.max(12, Math.round(fontSize * scale * (targetSize / 1024)));
    const fontStyle = `${italic ? "italic " : ""}${bold ? "bold " : ""}${actualFontSize}px "${fontFamily}", -apple-system, sans-serif`;
    ctx.font = fontStyle;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    // Measure text
    const metrics = ctx.measureText(displayText);
    const textWidth = metrics.width + (displayText.length - 1) * letterSpacing;
    const paddingX = actualFontSize * 0.8;
    const paddingY = actualFontSize * 0.5;
    const boxW = textWidth + paddingX * 2;
    const boxH = actualFontSize * 1.8 + paddingY;

    // Draw Badge Background / Frame
    if (badgeStyle === "hazard_box") {
      // Yellow/black striped border box
      ctx.fillStyle = "#111111";
      ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);

      // Warning border
      ctx.strokeStyle = badgeColor;
      ctx.lineWidth = Math.max(3, actualFontSize * 0.12);
      ctx.strokeRect(-boxW / 2, -boxH / 2, boxW, boxH);

      // Hazard chevrons on sides
      ctx.fillStyle = badgeColor;
      const cornerSize = actualFontSize * 0.4;
      ctx.fillRect(-boxW / 2, -boxH / 2, cornerSize, cornerSize);
      ctx.fillRect(boxW / 2 - cornerSize, -boxH / 2, cornerSize, cornerSize);
      ctx.fillRect(-boxW / 2, boxH / 2 - cornerSize, cornerSize, cornerSize);
      ctx.fillRect(boxW / 2 - cornerSize, boxH / 2 - cornerSize, cornerSize, cornerSize);
    } else if (badgeStyle === "pill") {
      // Rounded stadium pill
      ctx.fillStyle = badgeColor;
      const radius = boxH / 2;
      ctx.beginPath();
      ctx.roundRect(-boxW / 2, -boxH / 2, boxW, boxH, radius);
      ctx.fill();
    } else if (badgeStyle === "inverted_box") {
      // Solid filled dark card
      ctx.fillStyle = "#0c0d10";
      ctx.beginPath();
      ctx.roundRect(-boxW / 2, -boxH / 2, boxW, boxH, 8);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (badgeStyle === "reticle") {
      // Tech brackets [ TEXT ]
      ctx.strokeStyle = badgeColor;
      ctx.lineWidth = Math.max(2, actualFontSize * 0.08);
      const bLen = boxW * 0.15;
      const bH = boxH / 2;
      const bW = boxW / 2;
      // Top-left
      ctx.beginPath();
      ctx.moveTo(-bW + bLen, -bH);
      ctx.lineTo(-bW, -bH);
      ctx.lineTo(-bW, -bH + bLen);
      // Bottom-left
      ctx.moveTo(-bW, bH - bLen);
      ctx.lineTo(-bW, bH);
      ctx.lineTo(-bW + bLen, bH);
      // Top-right
      ctx.moveTo(bW - bLen, -bH);
      ctx.lineTo(bW, -bH);
      ctx.lineTo(bW, -bH + bLen);
      // Bottom-right
      ctx.moveTo(bW, bH - bLen);
      ctx.lineTo(bW, bH);
      ctx.lineTo(bW - bLen, bH);
      ctx.stroke();
    }

    // Render Text Glyphs with letter spacing
    ctx.fillStyle = textColor;
    if (letterSpacing === 0) {
      ctx.fillText(displayText, 0, 0);
    } else {
      let currentX = -textWidth / 2 + metrics.width / displayText.length / 2;
      for (let i = 0; i < displayText.length; i++) {
        const char = displayText[i];
        const charWidth = ctx.measureText(char).width;
        ctx.fillText(char, currentX + charWidth / 2, 0);
        currentX += charWidth + letterSpacing;
      }
    }

    ctx.restore();

    // Composite to Color Canvas
    const colorCtx = layer.colorCanvas.getContext("2d");
    colorCtx.save();
    colorCtx.globalAlpha = opacity;
    colorCtx.drawImage(tempCanvas, 0, 0);
    colorCtx.restore();

    // Composite PBR Channels from Alpha Mask
    const imgData = ctx.getImageData(0, 0, targetSize, targetSize);
    const data = imgData.data;

    // Roughness
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

    // Metallic
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

    // Height / Emboss
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
