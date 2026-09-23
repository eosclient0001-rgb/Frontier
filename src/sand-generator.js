/**
 * 3D SDF-Driven Photorealistic Sand & Crystalline Mineral Texture Generator
 * 
 * Synthesizes photorealistic multi-spectral crystalline sand and 3D polyhedral rocks:
 * - Macro-scale mineral drift patches (quartz, carnelian, feldspar, olivine, magnetite)
 * - Micro-cellular quartz crystal grains with faceted micro-normals
 * - 3D Convex Polyhedron SDF Rocks (angular boulders, discoid skipping stones, crystal shards)
 * - Multi-layered PBR map suite (Albedo, Normal, Displacement, Roughness, AO)
 */

import { NoiseGenerator, createPRNG } from "./math-noise.js";

// ===========================================================================
// 3D SDF ROCK PRIMITIVES (Exact Euclidean Polyhedra & Chamfered Bevels)
// ===========================================================================

class SDFRock {
  constructor({
    type = "angular", // "angular", "flatDiscoid", "crystalShard", "roundedCobble"
    center = [0, 0, 0],
    scale = [1, 1, 1],
    rotation = [0, 0, 0],
    color = [0.5, 0.5, 0.5],
    roughness = 0.65,
    seed = 1,
  }) {
    this.type = type;
    this.center = center;
    this.scale = scale;
    this.color = color;
    this.roughness = roughness;

    const rng = createPRNG(seed);
    this.planes = [];

    const numPlanes = type === "crystalShard" ? 8 : type === "angular" ? 11 : 8;
    for (let i = 0; i < numPlanes; i++) {
      const u = rng() * 2 - 1;
      const theta = rng() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - u * u));
      let nx = r * Math.cos(theta);
      let ny = Math.abs(u) * 0.8 + 0.2;
      let nz = r * Math.sin(theta);

      if (type === "flatDiscoid") {
        ny *= 2.6;
      } else if (type === "crystalShard") {
        const hexAngle = (Math.floor(rng() * 6) * Math.PI) / 3;
        nx = Math.cos(hexAngle);
        nz = Math.sin(hexAngle);
        ny = rng() * 0.6;
      }

      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;

      const dist = 0.65 + rng() * 0.35;
      this.planes.push({ nx, ny, nz, d: dist });
    }

    this.chamfer = type === "roundedCobble" ? 0.22 : 0.08;
    this.cosRot = Math.cos(rotation[1]);
    this.sinRot = Math.sin(rotation[1]);
  }

  sample(x, y, z) {
    let lx = (x - this.center[0]);
    let ly = (y - this.center[1]);
    let lz = (z - this.center[2]);

    const rx = lx * this.cosRot - lz * this.sinRot;
    const rz = lx * this.sinRot + lz * this.cosRot;
    lx = rx / this.scale[0];
    ly = ly / this.scale[1];
    lz = rz / this.scale[2];

    let maxDist = -Infinity;
    for (let i = 0; i < this.planes.length; i++) {
      const p = this.planes[i];
      const planeDist = p.nx * lx + p.ny * ly + p.nz * lz - p.d;
      if (planeDist > maxDist) {
        maxDist = planeDist;
      }
    }

    return maxDist - this.chamfer;
  }
}

// ===========================================================================
// MAIN PROCEDURAL CRYSTALLINE SAND & ROCK GENERATOR
// ===========================================================================

export class SandTextureGenerator {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
  }

  generate(params = {}) {
    const {
      width = 1024,
      height = 1024,
      seed = 42,

      // Sand Grains & Crystals
      grainScale = 110.0,         // micro-grain density
      crystalSparkle = 1.0,       // crystalline facet sparkle
      mineralVariety = 0.85,      // multi-spectral mineral diversity
      magnetiteFlecks = 0.35,     // dark iron/basalt flecks

      // 3D SDF Rocks & Pebbles
      pebbleEnable = true,
      pebbleDensity = 22,         // count of stones per tile
      pebbleMinSize = 14,         // pixels
      pebbleMaxSize = 56,         // pixels
      pebbleHeight = 0.90,        // protrusion height
      rockVariety = "mixed",      // "mixed", "angular", "discoid", "crystals"

      // Moisture / Wetness
      wetness = 0.0,              // 0 = dry sparkling sand, 1 = glistening wet shoreline

      // Base Sand & Mineral Colors
      sandColorBase = [0.88, 0.76, 0.54],     // Primary quartz sand
      sandColorMineral = [0.92, 0.68, 0.48],  // Secondary mineral crystals (feldspar/carnelian)
      sandColorDark = [0.65, 0.50, 0.35],     // Shadow/crevice sand
      fleckColor = [0.12, 0.12, 0.14],        // Magnetite / dark mineral
      stoneColor1 = [0.48, 0.46, 0.48],       // Primary stone tint (slate/granite)
      stoneColor2 = [0.85, 0.82, 0.78],       // Secondary stone accent (quartzite/calcite)
    } = params;

    const noise = new NoiseGenerator(seed);
    const macroNoise = new NoiseGenerator(seed + 88);
    const grainNoise = new NoiseGenerator(seed + 101);
    const rng = createPRNG(seed + 555);

    const size = width * height;
    const heightMap = new Float32Array(size);
    const albedoR = new Float32Array(size);
    const albedoG = new Float32Array(size);
    const albedoB = new Float32Array(size);
    const roughnessMap = new Float32Array(size);
    const aoMap = new Float32Array(size);
    const normalMap = new Uint8ClampedArray(size * 4);

    // 1. Synthesize 3D SDF Rocks & Stones
    const rocks = [];
    if (pebbleEnable && pebbleDensity > 0) {
      const rockTypes = ["angular", "flatDiscoid", "crystalShard", "roundedCobble"];

      for (let p = 0; p < pebbleDensity; p++) {
        const cx = rng() * width;
        const cy = rng() * height;
        const rSize = pebbleMinSize + rng() * (pebbleMaxSize - pebbleMinSize);
        const rotY = rng() * Math.PI * 2;

        let type = rockTypes[Math.floor(rng() * rockTypes.length)];
        if (rockVariety === "angular") type = "angular";
        else if (rockVariety === "discoid") type = "flatDiscoid";
        else if (rockVariety === "crystals") type = "crystalShard";

        let color = [...stoneColor1];
        let rough = 0.65;
        const mineralType = rng();

        if (mineralType < 0.35) {
          color = [...stoneColor2]; // accent stone
          rough = 0.35;
        } else if (mineralType < 0.65) {
          color = [stoneColor1[0] * 0.55, stoneColor1[1] * 0.55, stoneColor1[2] * 0.55]; // dark rock variant
          rough = 0.50;
        } else {
          color = [...stoneColor1];
          rough = 0.70;
        }

        const scaleX = rSize;
        const scaleZ = rSize * (0.65 + rng() * 0.5);
        const scaleY = (rSize * (0.5 + rng() * 0.5)) * pebbleHeight;

        rocks.push(new SDFRock({
          type,
          center: [cx, 0, cy],
          scale: [scaleX, scaleY, scaleZ],
          rotation: [0, rotY, 0],
          color,
          roughness: rough,
          seed: p * 77 + seed,
        }));
      }
    }

    // 2. Synthesize High-Detail Crystalline Sand Matrix & Voronoi Micro-Grains
    for (let y = 0; y < height; y++) {
      const v = y / height;
      for (let x = 0; x < width; x++) {
        const u = x / width;
        const idx = y * width + x;

        // Macro-scale multi-spectral mineral drift patches
        const macroDrift1 = macroNoise.noise2D(u * 2.5, v * 2.5);
        const macroDrift2 = macroNoise.noise2D(u * 5.0 + 8.0, v * 5.0 + 4.0);

        // Voronoi cell for micro-quartz crystals
        const gx = u * grainScale;
        const gy = v * grainScale;

        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const fx = gx - ix;
        const fy = gy - iy;

        let minDist1 = 1.0;
        let cellHash1 = 0;
        let cellHash2 = 0;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const cx = ix + dx;
            const cy = iy + dy;
            const hx = ((Math.sin(cx * 127.1 + cy * 311.7) * 43758.5453) % 1.0 + 1.0) % 1.0;
            const hy = ((Math.sin(cx * 269.5 + cy * 183.3) * 43758.5453) % 1.0 + 1.0) % 1.0;
            const d = Math.hypot(dx + hx - fx, dy + hy - fy);

            if (d < minDist1) {
              minDist1 = d;
              cellHash1 = hx;
              cellHash2 = hy;
            }
          }
        }

        // 3D Dome shape of individual crystalline sand grain
        const grainRadius = 0.48;
        const grainH = minDist1 < grainRadius
          ? Math.sqrt(Math.max(0, 1.0 - Math.pow(minDist1 / grainRadius, 2.0))) * 0.085
          : 0.0;

        // Micro-facet crystal tilt perturbation
        const facetTilt = (cellHash1 - 0.5) * 0.015 * crystalSparkle;
        const groundWarp = noise.fBm2D(u * 5.0, v * 5.0, 3, 2.0, 0.5) * 0.05;
        let totalH = 0.35 + grainH + facetTilt + groundWarp;

        let hitRock = null;
        let rockHeight = 0;
        let minSDFDist = Infinity;

        // Sample 3D SDF Rocks
        if (rocks.length > 0) {
          for (let r = 0; r < rocks.length; r++) {
            const rock = rocks[r];

            let dx = x - rock.center[0];
            let dz = y - rock.center[2];
            if (dx > width * 0.5) dx -= width;
            if (dx < -width * 0.5) dx -= width;
            if (dz > height * 0.5) dz -= height;
            if (dz < -height * 0.5) dz += height;

            const approxRadius = rock.scale[0] * 1.5;
            if (Math.hypot(dx, dz) > approxRadius) continue;

            const sdfBase = rock.sample(dx, 0, dz);
            if (sdfBase < minSDFDist) minSDFDist = sdfBase;

            if (sdfBase <= 0.0) {
              const topH = Math.max(0, -sdfBase * 0.8) * pebbleHeight + totalH;
              if (topH > rockHeight) {
                rockHeight = topH;
                hitRock = rock;
              }
            }
          }
        }

        let isRock = false;
        if (hitRock && rockHeight > totalH) {
          totalH = rockHeight;
          isRock = true;
        }

        if (!isRock && minSDFDist > 0.0 && minSDFDist < 0.25) {
          const crevice = Math.sin((minSDFDist / 0.25) * Math.PI) * 0.025;
          totalH -= crevice;
        }

        heightMap[idx] = totalH;

        // --- C. Multi-Spectral Crystalline Albedo ---
        if (isRock) {
          const rNoise = noise.fBm2D(u * 36.0, v * 36.0, 3, 2.0, 0.5);
          const col = hitRock.color;
          albedoR[idx] = col[0] * (0.88 + 0.24 * rNoise);
          albedoG[idx] = col[1] * (0.88 + 0.24 * rNoise);
          albedoB[idx] = col[2] * (0.88 + 0.24 * rNoise);
          roughnessMap[idx] = hitRock.roughness;
          aoMap[idx] = 0.92;

        } else {
          // Rich Multi-Mineral Crystalline Palette:
          let grainCol = [...sandColorBase];

          // Mineral classification per crystal grain
          const mType = cellHash1;

          if (mType < 0.28) {
            // 1. Primary Quartz Tone
            grainCol = [...sandColorBase];
          } else if (mType < 0.52) {
            // 2. Secondary Mineral Crystals (e.g. Feldspar / Coral / Carnelian)
            grainCol = [...sandColorMineral];
          } else if (mType < 0.76) {
            // 3. Highlight Sparkling Calcite / Quartz Shard
            grainCol = [
              Math.min(1.0, sandColorBase[0] * 0.5 + sandColorMineral[0] * 0.5 + 0.14),
              Math.min(1.0, sandColorBase[1] * 0.5 + sandColorMineral[1] * 0.5 + 0.14),
              Math.min(1.0, sandColorBase[2] * 0.5 + sandColorMineral[2] * 0.5 + 0.14),
            ];
          } else {
            // 4. Shadow / Crevice Sand
            grainCol = [...sandColorDark];
          }

          // Dark Magnetite / Ilmenite heavy mineral flecks
          const isMagnetite = cellHash2 > (1.0 - magnetiteFlecks * 0.35);
          if (isMagnetite) {
            grainCol = [...fleckColor];
          }

          // Blend macro-scale mineral drift patches
          const macroVar = 1.0 + macroDrift1 * 0.18 * mineralVariety;
          const macroHueShift = macroDrift2 * 0.12 * mineralVariety;

          let r = (grainCol[0] + macroHueShift) * macroVar;
          let g = grainCol[1] * macroVar;
          let b = (grainCol[2] - macroHueShift * 0.5) * macroVar;

          // Grain boundary crevice shading (ambient occlusion between grains)
          const creviceShade = Math.max(0.60, 1.0 - (1.0 - grainH / 0.085) * 0.40);
          r *= creviceShade;
          g *= creviceShade;
          b *= creviceShade;

          albedoR[idx] = Math.min(1.0, Math.max(0.0, r));
          albedoG[idx] = Math.min(1.0, Math.max(0.0, g));
          albedoB[idx] = Math.min(1.0, Math.max(0.0, b));

          // PBR Micro-Roughness: Crystalline facets are smooth & reflective (R = 0.25 - 0.45), crevices are matte
          const crystalRough = isMagnetite ? 0.20 : 0.72 - (grainH / 0.085) * 0.45 * crystalSparkle;
          roughnessMap[idx] = Math.max(0.12, crystalRough);
          aoMap[idx] = Math.max(0.55, 0.75 + 0.25 * (grainH / 0.085));
        }

        // Moisture / Wetness Darkening & Mirror Sheen
        if (wetness > 0.0) {
          const wetDarken = 1.0 - wetness * 0.58;
          albedoR[idx] *= wetDarken;
          albedoG[idx] *= wetDarken;
          albedoB[idx] *= wetDarken;

          roughnessMap[idx] = Math.max(0.025, roughnessMap[idx] * (1.0 - wetness * 0.96));
        }
      }
    }

    // 3. High-Precision Tangent-Space Normal Map using Sobel Filter
    const normalStrength = 6.0;

    for (let y = 0; y < height; y++) {
      const yPrev = (y - 1 + height) % height;
      const yNext = (y + 1) % height;

      for (let x = 0; x < width; x++) {
        const xPrev = (x - 1 + width) % width;
        const xNext = (x + 1) % width;
        const idx = y * width + x;

        const tl = heightMap[yPrev * width + xPrev];
        const t  = heightMap[yPrev * width + x];
        const tr = heightMap[yPrev * width + xNext];
        const l  = heightMap[y * width + xPrev];
        const r  = heightMap[y * width + xNext];
        const bl = heightMap[yNext * width + xPrev];
        const b  = heightMap[yNext * width + x];
        const br = heightMap[yNext * width + xNext];

        const dX = ((tr + 2.0 * r + br) - (tl + 2.0 * l + bl)) * normalStrength;
        const dY = ((bl + 2.0 * b + br) - (tl + 2.0 * t + tr)) * normalStrength;
        const dZ = 1.0;

        const len = Math.hypot(dX, dY, dZ) || 1.0;
        const nx = -dX / len;
        const ny = -dY / len;
        const nz = dZ / len;

        const nIdx = idx * 4;
        normalMap[nIdx]     = Math.floor((nx * 0.5 + 0.5) * 255.0);
        normalMap[nIdx + 1] = Math.floor((ny * 0.5 + 0.5) * 255.0);
        normalMap[nIdx + 2] = Math.floor((nz * 0.5 + 0.5) * 255.0);
        normalMap[nIdx + 3] = 255;
      }
    }

    // 4. Export Typed ImageData Buffers
    const albedoImageData = this.ctx.createImageData(width, height);
    const heightImageData = this.ctx.createImageData(width, height);
    const roughnessImageData = this.ctx.createImageData(width, height);
    const aoImageData = this.ctx.createImageData(width, height);
    const normalImageData = this.ctx.createImageData(width, height);

    for (let i = 0; i < size; i++) {
      const pxIdx = i * 4;

      // Albedo
      albedoImageData.data[pxIdx]     = Math.floor(Math.min(1.0, albedoR[i]) * 255);
      albedoImageData.data[pxIdx + 1] = Math.floor(Math.min(1.0, albedoG[i]) * 255);
      albedoImageData.data[pxIdx + 2] = Math.floor(Math.min(1.0, albedoB[i]) * 255);
      albedoImageData.data[pxIdx + 3] = 255;

      // Height
      const hNorm = Math.max(0.0, Math.min(1.0, heightMap[i]));
      const hByte = Math.floor(hNorm * 255);
      heightImageData.data[pxIdx]     = hByte;
      heightImageData.data[pxIdx + 1] = hByte;
      heightImageData.data[pxIdx + 2] = hByte;
      heightImageData.data[pxIdx + 3] = 255;

      // Roughness
      const rByte = Math.floor(Math.max(0.0, Math.min(1.0, roughnessMap[i])) * 255);
      roughnessImageData.data[pxIdx]     = rByte;
      roughnessImageData.data[pxIdx + 1] = rByte;
      roughnessImageData.data[pxIdx + 2] = rByte;
      roughnessImageData.data[pxIdx + 3] = 255;

      // AO
      const aoByte = Math.floor(Math.max(0.0, Math.min(1.0, aoMap[i])) * 255);
      aoImageData.data[pxIdx]     = aoByte;
      aoImageData.data[pxIdx + 1] = aoByte;
      aoImageData.data[pxIdx + 2] = aoByte;
      aoImageData.data[pxIdx + 3] = 255;

      // Normal
      normalImageData.data[pxIdx]     = normalMap[pxIdx];
      normalImageData.data[pxIdx + 1] = normalMap[pxIdx + 1];
      normalImageData.data[pxIdx + 2] = normalMap[pxIdx + 2];
      normalImageData.data[pxIdx + 3] = 255;
    }

    return {
      width,
      height,
      heightMap,
      albedoImageData,
      normalImageData,
      heightImageData,
      roughnessImageData,
      aoImageData,
    };
  }
}
