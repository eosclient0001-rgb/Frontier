// MaterialPresets.js
// 16 rich PBR smart materials with multi-channel attributes & procedural surface finish

export const MATERIAL_PRESETS = [
  {
    id: "damaged_steel",
    name: "Damaged Steel",
    category: "metal",
    color: "#7a818c",
    roughness: 0.35,
    metallic: 0.95,
    height: -0.15,
    pattern: "scratches",
    description: "Industrial gunmetal with micro-scratches and surface pitting"
  },
  {
    id: "cyber_gold",
    name: "Cyber 24K Gold",
    category: "metal",
    color: "#ffd24d",
    roughness: 0.12,
    metallic: 1.0,
    height: 0.0,
    pattern: "smooth",
    description: "Ultra-pure reflective gold with specular highlights"
  },
  {
    id: "matte_carbon",
    name: "Carbon Fiber",
    category: "cyber",
    color: "#1c1d22",
    roughness: 0.42,
    metallic: 0.12,
    height: 0.25,
    pattern: "weave",
    description: "Micro-woven aerospace carbon composite"
  },
  {
    id: "glossy_ceramic",
    name: "Glossy Ceramic",
    category: "plastic",
    color: "#f5f6fa",
    roughness: 0.04,
    metallic: 0.0,
    height: 0.0,
    pattern: "smooth",
    description: "Pristine white glazed porcelain enamel"
  },
  {
    id: "rusted_iron",
    name: "Rusted Iron",
    category: "weathered",
    color: "#4a2416",
    roughness: 0.88,
    metallic: 0.25,
    height: 0.45,
    pattern: "noise",
    description: "Heavy oxidized ferric corrosion with deep pits"
  },
  {
    id: "weathered_red",
    name: "Chipped Red Paint",
    category: "weathered",
    color: "#b02222",
    roughness: 0.58,
    metallic: 0.05,
    height: 0.12,
    pattern: "noise",
    description: "Industrial machinery paint with edge wear"
  },
  {
    id: "tactical_olive",
    name: "Tactical Olive Drab",
    category: "military",
    color: "#444c2a",
    roughness: 0.78,
    metallic: 0.02,
    height: 0.05,
    pattern: "stipple",
    description: "Non-reflective military vehicle matte finish"
  },
  {
    id: "polished_copper",
    name: "Polished Copper",
    category: "metal",
    color: "#cb6e51",
    roughness: 0.2,
    metallic: 0.98,
    height: 0.0,
    pattern: "smooth",
    description: "Warm radiant copper with subtle oxidation"
  },
  {
    id: "neon_cyan_glow",
    name: "Cyber Neon Cyan",
    category: "cyber",
    color: "#00f0ff",
    roughness: 0.08,
    metallic: 0.05,
    height: 0.0,
    pattern: "smooth",
    emissiveColor: "#00f0ff",
    emissiveIntensity: 4.0,
    description: "High-intensity glowing electroluminescent panel"
  },
  {
    id: "caution_yellow",
    name: "Safety Enamel",
    category: "plastic",
    color: "#ffb400",
    roughness: 0.28,
    metallic: 0.05,
    height: 0.0,
    pattern: "smooth",
    description: "High-durability hazard caution yellow coat"
  },
  {
    id: "knurled_rubber",
    name: "Tire Grip Rubber",
    category: "weathered",
    color: "#18181b",
    roughness: 0.86,
    metallic: 0.0,
    height: 0.4,
    pattern: "knurl",
    description: "Diamond crosshatch non-slip industrial grip"
  },
  {
    id: "brushed_titanium",
    name: "Brushed Titanium",
    category: "metal",
    color: "#9da3ad",
    roughness: 0.32,
    metallic: 0.92,
    height: -0.08,
    pattern: "brushed",
    description: "Anisotropic linear brushed aircraft alloy"
  },
  {
    id: "anodized_blue",
    name: "Anodized Cobalt",
    category: "metal",
    color: "#1e6ee6",
    roughness: 0.24,
    metallic: 0.88,
    height: 0.0,
    pattern: "smooth",
    description: "Vibrant electrochemically colored aluminum"
  },
  {
    id: "obsidian_glass",
    name: "Obsidian Mirror",
    category: "plastic",
    color: "#08080c",
    roughness: 0.02,
    metallic: 0.1,
    height: 0.0,
    pattern: "smooth",
    description: "Glossy deep black volcanic glass finish"
  },
  {
    id: "weathered_bronze",
    name: "Bronze & Patina",
    category: "weathered",
    color: "#546e62",
    roughness: 0.68,
    metallic: 0.72,
    height: 0.28,
    pattern: "noise",
    description: "Aged statuary bronze with green verdigris crust"
  },
  {
    id: "clean_polymer",
    name: "Sci-Fi Chassis White",
    category: "cyber",
    color: "#eceef2",
    roughness: 0.24,
    metallic: 0.04,
    height: 0.0,
    pattern: "smooth",
    description: "Pristine injection molded armor composite"
  }
];

export class ProceduralPatternGenerator {
  static fillCanvasWithPattern(canvas, patternType, baseColorHex, intensity = 0.5) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = baseColorHex;
    ctx.fillRect(0, 0, w, h);

    if (patternType === "smooth") return;

    if (patternType === "scratches") {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 400; i++) {
        const x1 = Math.random() * w;
        const y1 = Math.random() * h;
        const len = 10 + Math.random() * 40;
        const ang = Math.random() * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + Math.cos(ang) * len, y1 + Math.sin(ang) * len);
        ctx.stroke();
      }
      ctx.restore();
    } else if (patternType === "weave") {
      ctx.save();
      const tileSize = 16;
      for (let y = 0; y < h; y += tileSize) {
        for (let x = 0; x < w; x += tileSize) {
          if (((x / tileSize) + (y / tileSize)) % 2 === 0) {
            ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
            ctx.fillRect(x, y, tileSize, tileSize);
          } else {
            ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
            ctx.fillRect(x, y, tileSize, tileSize);
          }
        }
      }
      ctx.restore();
    } else if (patternType === "knurl") {
      ctx.save();
      const step = 20;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
      ctx.lineWidth = 2;
      for (let i = -w; i < w * 2; i += step) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + h, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(i, h);
        ctx.lineTo(i + h, 0);
        ctx.stroke();
      }
      ctx.restore();
    } else if (patternType === "noise") {
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 40 * intensity;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
      }
      ctx.putImageData(imgData, 0, 0);
    } else if (patternType === "brushed") {
      ctx.save();
      for (let y = 0; y < h; y += 3) {
        ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
        ctx.fillRect(0, y, w, 2);
      }
      ctx.restore();
    }
  }
}
