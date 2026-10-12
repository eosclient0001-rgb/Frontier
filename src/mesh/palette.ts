// Surface and prop colours. Authored as sRGB hex and converted to linear once, because vertex colours are linear.

import * as THREE from "three";
import type { RGB } from "./MeshBucket";
import { valueNoise } from "../core/math";

function lin(hex: number): RGB {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

export const COLOUR = {
  asphalt: lin(0x2d2f34),
  asphaltWorn: lin(0x23252a),
  asphaltPatch: lin(0x4a4c52),
  parking: lin(0x4a4e57),
  bus: lin(0x8c3a2f),
  cycle: lin(0x2e7a50),
  sidewalk: lin(0xa9a59b),
  paving: lin(0xb9b2a0),
  curb: lin(0xcfccc2),
  grass: lin(0x5d7a40),
  verge: lin(0x6c7a44),
  gravel: lin(0x8a7c60),
  dirt: lin(0x8b6a45),
  ballast: lin(0x6d6963),
  marking: lin(0xf0f0ec),
  yellow: lin(0xf2c200),
  concrete: lin(0x9a978f),
  concreteDark: lin(0x6f6c66),
  steel: lin(0x6e7784),
  steelDark: lin(0x414852),
  barrierRed: lin(0xd23a2e),
  barrierWhite: lin(0xf4f4f1),
  bollard: lin(0xf3f3f0),
  lampPost: lin(0x2d3035),
  lampLight: lin(0xffe2a0),
  signalRed: lin(0xff3b30),
  water: lin(0x2b5f80),
  terrainLow: lin(0x3e5a2c),
  terrainHigh: lin(0x6c7a48),
  terrainRock: lin(0x6e655a),
  tunnel: lin(0x5b8cff),
  railRed: lin(0xb6382f)
};

// Multiply a colour by low-frequency noise so surfaces show soft wear instead of flat fills.
export function shade(c: RGB, x: number, z: number, amount: number, seed = 91): RGB {
  const n = valueNoise(x * 0.23, z * 0.23, seed) * 0.6 + valueNoise(x * 0.9, z * 0.9, seed + 7) * 0.4;
  const k = 1 + n * amount;
  return [c[0] * k, c[1] * k, c[2] * k];
}

export function tint(c: RGB, r: number, g: number, b: number): RGB {
  return [c[0] * r, c[1] * g, c[2] * b];
}
