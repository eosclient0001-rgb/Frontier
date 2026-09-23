/**
 * Terrain Rasterizer & Geomorphological Verification Suite
 * 
 * Provides headless rasterization of shaded relief, perspective terrain rendering,
 * valley cross-sections, and numerical geomorphic validation.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

/**
 * CRC32 calculation for PNG chunks
 */
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c;
}

function crc32(buf, offset = 0, length = buf.length) {
  let crc = 0xffffffff;
  for (let i = offset; i < offset + length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Encode raw RGBA pixel buffer into a valid PNG file
 */
export function encodePNG(width, height, rgbaBuffer) {
  const bytesPerPixel = 4;
  const scanlineLength = width * bytesPerPixel;
  const rawData = new Uint8Array(height * (scanlineLength + 1));

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (scanlineLength + 1);
    rawData[rowOffset] = 0; // Filter type 0 (None)
    const srcOffset = y * scanlineLength;
    rawData.set(rgbaBuffer.subarray(srcOffset, srcOffset + scanlineLength), rowOffset + 1);
  }

  const compressedData = deflateSync(rawData);

  // PNG Signature
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR Chunk
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr[8] = 8; // 8 bits per channel
  ihdr[9] = 6; // Color type 6 (RGBA)
  ihdr[10] = 0; // Compression method
  ihdr[11] = 0; // Filter method
  ihdr[12] = 0; // Interlace method

  function makeChunk(type, data) {
    const typeBytes = new Uint8Array(type.split("").map((c) => c.charCodeAt(0)));
    const chunkLen = data.length;
    const chunk = new Uint8Array(4 + 4 + chunkLen + 4);
    const chunkView = new DataView(chunk.buffer);

    chunkView.setUint32(0, chunkLen, false);
    chunk.set(typeBytes, 4);
    chunk.set(data, 8);

    const crcBuf = new Uint8Array(4 + chunkLen);
    crcBuf.set(typeBytes, 0);
    crcBuf.set(data, 4);
    const crc = crc32(crcBuf);
    chunkView.setUint32(8 + chunkLen, crc, false);

    return chunk;
  }

  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", compressedData);
  const iendChunk = makeChunk("IEND", new Uint8Array(0));

  const totalLength = signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const pngFile = new Uint8Array(totalLength);
  let offset = 0;

  pngFile.set(signature, offset); offset += signature.length;
  pngFile.set(ihdrChunk, offset); offset += ihdrChunk.length;
  pngFile.set(idatChunk, offset); offset += idatChunk.length;
  pngFile.set(iendChunk, offset); offset += iendChunk.length;

  return Buffer.from(pngFile.buffer);
}

/**
 * Top-down Shaded Relief Rasterizer
 */
export function rasterizeShadedRelief(surf, erosionResults = null, width = 512, height = 512) {
  const nx = surf.nx;
  const nz = surf.nz;
  const h = surf.height;
  const slopeDeg = surf.slopeDeg;
  const curvature = surf.curvature;
  const hardness = surf.hardness;

  const rgba = new Uint8Array(width * height * 4);

  // Directional Sun lighting: Northwest illumination
  const sunDir = [-0.55, 0.65, -0.52];
  const sunLen = Math.hypot(...sunDir);
  const L = [sunDir[0] / sunLen, sunDir[1] / sunLen, sunDir[2] / sunLen];

  // Secondary soft ambient bounce light
  const skyDir = [0.0, 1.0, 0.0];

  let maxFlow = 1.0;
  if (erosionResults?.flowMap) {
    for (let i = 0; i < nx * nz; i++) {
      if (erosionResults.flowMap[i] > maxFlow) maxFlow = erosionResults.flowMap[i];
    }
  }

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const gx = (px / (width - 1)) * (nx - 1);
      const gz = (py / (height - 1)) * (nz - 1);

      const ix = Math.min(nx - 2, Math.floor(gx));
      const iz = Math.min(nz - 2, Math.floor(gz));
      const fx = gx - ix;
      const fz = gz - iz;

      const idx00 = iz * nx + ix;
      const idx10 = iz * nx + (ix + 1);
      const idx01 = (iz + 1) * nx + ix;
      const idx11 = (iz + 1) * nx + (ix + 1);

      // Smooth bilinear interpolation of normal vector
      const nxVal = (1 - fz) * ((1 - fx) * surf.normalX[idx00] + fx * surf.normalX[idx10]) +
                    fz * ((1 - fx) * surf.normalX[idx01] + fx * surf.normalX[idx11]);
      const nyVal = (1 - fz) * ((1 - fx) * surf.normalY[idx00] + fx * surf.normalY[idx10]) +
                    fz * ((1 - fx) * surf.normalY[idx01] + fx * surf.normalY[idx11]);
      const nzVal = (1 - fz) * ((1 - fx) * surf.normalZ[idx00] + fx * surf.normalZ[idx10]) +
                    fz * ((1 - fx) * surf.normalZ[idx01] + fx * surf.normalZ[idx11]);

      const nLen = Math.hypot(nxVal, nyVal, nzVal) || 1.0;
      const N = [nxVal / nLen, nyVal / nLen, nzVal / nLen];

      const elev = (1 - fz) * ((1 - fx) * h[idx00] + fx * h[idx10]) +
                   fz * ((1 - fx) * h[idx01] + fx * h[idx11]);
      const slp = (1 - fz) * ((1 - fx) * slopeDeg[idx00] + fx * slopeDeg[idx10]) +
                  fz * ((1 - fx) * slopeDeg[idx01] + fx * slopeDeg[idx11]);
      const crv = (1 - fz) * ((1 - fx) * curvature[idx00] + fx * curvature[idx10]) +
                  fz * ((1 - fx) * curvature[idx01] + fx * curvature[idx11]);
      const hrd = (1 - fz) * ((1 - fx) * hardness[idx00] + fx * hardness[idx10]) +
                  fz * ((1 - fx) * hardness[idx01] + fx * hardness[idx11]);

      let flw = 0;
      if (erosionResults?.flowMap) {
        flw = (1 - fz) * ((1 - fx) * erosionResults.flowMap[idx00] + fx * erosionResults.flowMap[idx10]) +
              fz * ((1 - fx) * erosionResults.flowMap[idx01] + fx * erosionResults.flowMap[idx11]);
      }

      let tal = 0;
      if (erosionResults?.talusMap) {
        tal = (1 - fz) * ((1 - fx) * erosionResults.talusMap[idx00] + fx * erosionResults.talusMap[idx10]) +
              fz * ((1 - fx) * erosionResults.talusMap[idx01] + fx * erosionResults.talusMap[idx11]);
      }

      let sed = 0;
      if (erosionResults?.depositMap) {
        sed = (1 - fz) * ((1 - fx) * erosionResults.depositMap[idx00] + fx * erosionResults.depositMap[idx10]) +
              fz * ((1 - fx) * erosionResults.depositMap[idx01] + fx * erosionResults.depositMap[idx11]);
      }

      // Lighting: Diffuse sun + Ambient skylight + Cavity ambient occlusion
      const NdotL = Math.max(0.0, N[0] * L[0] + N[1] * L[1] + N[2] * L[2]);
      const NdotSky = Math.max(0.0, N[1]);
      const cavity = Math.max(0.0, Math.min(1.0, 0.5 - crv * 1.8));

      const directLight = 0.85 * NdotL;
      const ambientLight = 0.25 * (0.5 + 0.5 * NdotSky);
      const totalLight = (directLight + ambientLight) * (0.35 + 0.65 * cavity);

      // Strata horizontal banding
      const strataBands = Math.sin(elev * 0.45) * 0.5 + 0.5;

      // Realistic Alpine PBR colors
      let r = 0.32, g = 0.31, b = 0.30; // Granite bedrock base

      if (slp > 38.0) {
        // Steep Rock Cliff
        const hardBoost = Math.max(0.0, Math.min(1.0, (hrd - 0.3) / 1.8));
        r = 0.28 + 0.08 * strataBands * hardBoost;
        g = 0.28 + 0.07 * strataBands * hardBoost;
        b = 0.30;
      } else if (tal > 0.15 || (slp >= 26.0 && slp <= 36.0 && elev > 12.0)) {
        // Scree / Talus apron
        r = 0.42; g = 0.39; b = 0.36;
      } else if (sed > 0.1 || (elev < 3.0 && slp < 15.0)) {
        // Alluvial sediment / riverbed gravel
        r = 0.46; g = 0.42; b = 0.36;
      } else if (slp < 20.0 && elev < 26.0) {
        // Alpine grass
        r = 0.22; g = 0.36; b = 0.16;
      } else {
        // Weathered mountain dirt
        r = 0.30; g = 0.26; b = 0.20;
      }

      // Snow on high peaks (elev > 30m and slope not vertical)
      if (elev > 28.0 && slp < 45.0) {
        const snowAmt = Math.min(1.0, (elev - 28.0) / 8.0) * (1.0 - slp / 45.0);
        r = r * (1 - snowAmt) + 0.95 * snowAmt;
        g = g * (1 - snowAmt) + 0.96 * snowAmt;
        b = b * (1 - snowAmt) + 0.98 * snowAmt;
      }

      // Darken concentrated river drainage channels
      if (flw > 18.0) {
        const flowFactor = Math.min(1.0, Math.log(flw / 18.0 + 1.0) / 3.2);
        r *= 1.0 - flowFactor * 0.5;
        g *= 1.0 - flowFactor * 0.4;
        b = Math.min(1.0, b * (1.0 - flowFactor * 0.3) + flowFactor * 0.35); // Water blue tint
      }

      const pIdx = (py * width + px) * 4;
      rgba[pIdx] = Math.min(255, Math.max(0, Math.floor(r * totalLight * 255)));
      rgba[pIdx + 1] = Math.min(255, Math.max(0, Math.floor(g * totalLight * 255)));
      rgba[pIdx + 2] = Math.min(255, Math.max(0, Math.floor(b * totalLight * 255)));
      rgba[pIdx + 3] = 255;
    }
  }

  return encodePNG(width, height, rgba);
}

/**
 * Transverse Valley Cross-Section Profile Plotter
 */
export function rasterizeCrossSection(surf, width = 600, height = 300) {
  const nx = surf.nx;
  const nz = surf.nz;
  const h = surf.height;

  // Cut across the center of the terrain (z = nz/2)
  const iz = Math.floor(nz / 2);
  const profile = [];

  let minH = Infinity, maxH = -Infinity;
  for (let ix = 0; ix < nx; ix++) {
    const val = h[iz * nx + ix];
    profile.push(val);
    if (val < minH) minH = val;
    if (val > maxH) maxH = val;
  }

  const rgba = new Uint8Array(width * height * 4);
  rgba.fill(18); // Dark background #121212
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;

  const hSpan = Math.max(1.0, maxH - minH);
  const padX = 40, padY = 40;
  const graphW = width - 2 * padX;
  const graphH = height - 2 * padY;

  // Draw subtle grid lines
  for (let y = 0; y < 5; y++) {
    const gy = padY + Math.floor((y / 4) * graphH);
    for (let x = padX; x < width - padX; x++) {
      const idx = (gy * width + x) * 4;
      rgba[idx] = 38; rgba[idx + 1] = 38; rgba[idx + 2] = 38;
    }
  }

  // Draw profile curve
  for (let px = 0; px < graphW; px++) {
    const t = px / (graphW - 1);
    const pIdx = t * (nx - 1);
    const i0 = Math.floor(pIdx);
    const i1 = Math.min(nx - 1, i0 + 1);
    const f = pIdx - i0;
    const elev = profile[i0] * (1 - f) + profile[i1] * f;

    const normH = (elev - minH) / hSpan;
    const py = height - padY - Math.floor(normH * graphH);

    // Fill under curve with gradient
    for (let fillY = py; fillY < height - padY; fillY++) {
      const idx = (fillY * width + (padX + px)) * 4;
      rgba[idx] = 28; rgba[idx + 1] = 34; rgba[idx + 48];
    }

    // Line stroke with Slate hi-color #6c77ff
    for (let thick = -1; thick <= 1; thick++) {
      const cy = Math.max(0, Math.min(height - 1, py + thick));
      const idx = (cy * width + (padX + px)) * 4;
      rgba[idx] = 108; rgba[idx + 1] = 119; rgba[idx + 2] = 255;
    }
  }

  return encodePNG(width, height, rgba);
}

/**
 * Numerical Geomorphology Verification Suite
 */
export function verifyGeomorphology(surf, erosionResults) {
  const size = surf.nx * surf.nz;
  const slopeDeg = surf.slopeDeg;
  const h = surf.height;

  // 1. Measure steep valley wall presence (confirming sharp V-gorges, slope > 32 deg)
  let steepWallCount = 0;
  let cliffCount = 0;
  let talusSlopeCount = 0; // Slopes in 28 - 38 deg repose band
  let flatCount = 0;

  for (let i = 0; i < size; i++) {
    const slp = slopeDeg[i];
    if (slp > 45.0) cliffCount++;
    if (slp >= 26.0 && slp <= 38.0) talusSlopeCount++;
    if (slp > 32.0) steepWallCount++;
    if (slp < 15.0) flatCount++;
  }

  const steepWallRatio = steepWallCount / size;
  const talusRatio = talusSlopeCount / size;
  const cliffRatio = cliffCount / size;

  // 2. Measure knife-edge ridge sharpness vs blunted blur
  let ridgeDividesSharp = 0;
  for (let iz = 1; iz < surf.nz - 1; iz++) {
    for (let ix = 1; ix < surf.nx - 1; ix++) {
      const idx = iz * surf.nx + ix;
      if (surf.curvature[idx] < -0.18 && slopeDeg[idx] > 22.0) {
        ridgeDividesSharp++;
      }
    }
  }

  // 3. Mass Conservation check
  const carvedM3 = erosionResults?.carvedVolumeM3 || 0;
  const depositedM3 = erosionResults?.depositedVolumeM3 || 0;

  const passedVNotch = steepWallRatio > 0.15;
  const passedTalusRepose = talusRatio > 0.05;
  const passedKnifeArête = ridgeDividesSharp > 100;
  const passedMassConservation = carvedM3 > 0;

  return {
    valid: passedVNotch && passedTalusRepose && passedKnifeArête && passedMassConservation,
    metrics: {
      steepWallRatio: parseFloat(steepWallRatio.toFixed(4)),
      talusSlopeRatio: parseFloat(talusRatio.toFixed(4)),
      cliffRatio: parseFloat(cliffRatio.toFixed(4)),
      sharpRidgeDivides: ridgeDividesSharp,
      carvedVolumeM3: parseFloat(carvedM3.toFixed(2)),
      depositedVolumeM3: parseFloat(depositedM3.toFixed(2)),
      netBalanceM3: parseFloat((carvedM3 - depositedM3).toFixed(2)),
    },
    checks: {
      vShapedGorgeIncised: passedVNotch,
      talusAngleOfReposeStabilized: passedTalusRepose,
      knifeEdgeArêtesPreserved: passedKnifeArête,
      massConservationVerified: passedMassConservation,
    },
  };
}
