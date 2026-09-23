/**
 * Solid PBR Texture Engine
 * 
 * Provides clean, solid textures and procedural utilities for PBR material rendering.
 */

import * as THREE from "../vendor/three.module.js";

/**
 * Creates a clean solid color texture (1x1 RGBA)
 */
export function createSolidColorTexture(r = 255, g = 255, b = 255, a = 255) {
  const canvas = typeof document !== "undefined"
    ? document.createElement("canvas")
    : { width: 1, height: 1, getContext: () => null };
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx) return new THREE.Texture();

  const imgData = ctx.createImageData(1, 1);
  imgData.data[0] = r;
  imgData.data[1] = g;
  imgData.data[2] = b;
  imgData.data[3] = a;
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  return tex;
}

/**
 * Creates a neutral flat normal map (128, 128, 255 -> [0, 0, 1])
 */
export function createFlatNormalTexture() {
  return createSolidColorTexture(128, 128, 255, 255);
}

export class TextureGenerator {
  constructor(seed = 1337) {
    this.seed = seed;
    this.flatNormal = createFlatNormalTexture();
    this.solidWhite = createSolidColorTexture(255, 255, 255, 255);
  }

  generateRockTexture(baseColor = [0.38, 0.36, 0.34], secondaryColor = [0.24, 0.22, 0.20]) {
    const r = Math.round(baseColor[0] * 255);
    const g = Math.round(baseColor[1] * 255);
    const b = Math.round(baseColor[2] * 255);
    return {
      diffuse: createSolidColorTexture(r, g, b, 255),
      normal: this.flatNormal,
      roughness: this.solidWhite,
    };
  }

  generateTalusTexture(talusColor = [0.44, 0.42, 0.40]) {
    const r = Math.round(talusColor[0] * 255);
    const g = Math.round(talusColor[1] * 255);
    const b = Math.round(talusColor[2] * 255);
    return {
      diffuse: createSolidColorTexture(r, g, b, 255),
      normal: this.flatNormal,
      roughness: this.solidWhite,
    };
  }

  generateGrassTexture(grassColor = [0.22, 0.42, 0.14], dryColor = [0.46, 0.48, 0.22]) {
    const r = Math.round(grassColor[0] * 255);
    const g = Math.round(grassColor[1] * 255);
    const b = Math.round(grassColor[2] * 255);
    return {
      diffuse: createSolidColorTexture(r, g, b, 255),
      normal: this.flatNormal,
      roughness: this.solidWhite,
    };
  }

  generateDirtTexture(dirtColor = [0.28, 0.22, 0.16]) {
    const r = Math.round(dirtColor[0] * 255);
    const g = Math.round(dirtColor[1] * 255);
    const b = Math.round(dirtColor[2] * 255);
    return {
      diffuse: createSolidColorTexture(r, g, b, 255),
      normal: this.flatNormal,
      roughness: this.solidWhite,
    };
  }

  generateSnowTexture(snowColor = [0.96, 0.98, 1.00], iceColor = [0.55, 0.78, 0.95]) {
    const r = Math.round(snowColor[0] * 255);
    const g = Math.round(snowColor[1] * 255);
    const b = Math.round(snowColor[2] * 255);
    return {
      diffuse: createSolidColorTexture(r, g, b, 255),
      normal: this.flatNormal,
      roughness: this.solidWhite,
    };
  }

  generateSatMacroMap() {
    return createSolidColorTexture(128, 128, 128, 255);
  }
}
