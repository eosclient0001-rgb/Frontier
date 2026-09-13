/**
 * SDF combinators + procedural terrain builders.
 *
 * Terrain is built in two passes:
 *  A. 2D landform field H(x,z) (ridged/fbm/canyon-river/island falloff/terrace),
 *     normalized to 0..1 so presets are predictable at any seed.
 *  B. 3D SDF fill: f = y - H + crag detail, minus cave carves; hardness +
 *     solubility from warped geologic strata.
 *
 * Pass A is a *design scaffold*, not a heightmap renderer — the simulated,
 * eroded, meshed truth is always the 3D SDF (caves/overhangs included).
 */
import { Volume } from './volume';
import {
  billow3, clamp, clamp01, domainWarp3, fbm3, lerp, perlin3,
  ridged3, smoothstep, strataCoord, terrace01,
} from './noise';

export type Landform = 'alpine' | 'canyon' | 'coastal' | 'karst' | 'dunes' | 'custom';

export interface TerrainParams {
  seed: number;
  landform: Landform;
  baseHeight: number;    // fraction of volume height where "sea/valley floor" sits (0..1)
  mountainAmp: number;   // fraction of volume height added by relief (0..1)
  rangeFreq: number;     // mountain noise frequency (features per volume)
  warpAmp: number;       // domain warp amount (fraction of volume)
  detailAmp: number;     // 3D crag detail (fraction of voxel*res… world-ish scale)
  detailFreq: number;    // crag frequency (per volume)
  terraceAmt: number;    // 0..1 blend to terraced relief
  terraceSteps: number;  // strata steps
  terraceSharp: number;  // riser sharpness 0..1
  caveAmt: number;       // 0..1 cave carve strength
  islandFalloff: number; // 0..1 radial falloff (coastal/island)
  riverCarve: number;    // 0..1 canyon river incision
  strataFreq: number;    // geologic bands per volume height
  dipTilt: number;       // strata dip tilt (0=flat, ~0.6=steep)
}

export const DEFAULT_TERRAIN: TerrainParams = {
  seed: 1337,
  landform: 'alpine',
  baseHeight: 0.34,
  mountainAmp: 0.52,
  rangeFreq: 2.2,
  warpAmp: 0.16,
  detailAmp: 0.012,
  detailFreq: 9.0,
  terraceAmt: 0.0,
  terraceSteps: 7,
  terraceSharp: 0.55,
  caveAmt: 0.35,
  islandFalloff: 0.0,
  riverCarve: 0.0,
  strataFreq: 9.0,
  dipTilt: 0.22,
};

export const LANDFORM_PRESETS: Record<Landform, Partial<TerrainParams>> = {
  alpine: { baseHeight: 0.30, mountainAmp: 0.58, rangeFreq: 2.4, warpAmp: 0.18, detailAmp: 0.016, detailFreq: 10, caveAmt: 0.25, strataFreq: 7, dipTilt: 0.3, terraceAmt: 0 },
  canyon: { baseHeight: 0.52, mountainAmp: 0.34, rangeFreq: 1.6, warpAmp: 0.10, detailAmp: 0.010, detailFreq: 12, caveAmt: 0.45, riverCarve: 0.9, terraceAmt: 0.65, terraceSteps: 9, terraceSharp: 0.7, strataFreq: 14, dipTilt: 0.05 },
  coastal: { baseHeight: 0.30, mountainAmp: 0.30, rangeFreq: 1.8, warpAmp: 0.14, detailAmp: 0.009, detailFreq: 8, caveAmt: 0.15, islandFalloff: 0.85, strataFreq: 6, dipTilt: 0.12, terraceAmt: 0 },
  karst: { baseHeight: 0.42, mountainAmp: 0.34, rangeFreq: 3.2, warpAmp: 0.20, detailAmp: 0.014, detailFreq: 14, caveAmt: 0.85, strataFreq: 11, dipTilt: 0.1, terraceAmt: 0.15, terraceSteps: 5, terraceSharp: 0.4 },
  dunes: { baseHeight: 0.36, mountainAmp: 0.16, rangeFreq: 1.4, warpAmp: 0.22, detailAmp: 0.006, detailFreq: 16, caveAmt: 0.0, islandFalloff: 0.25, strataFreq: 4, dipTilt: 0.05, terraceAmt: 0 },
  custom: {},
};

// --- CSG combinators -------------------------------------------------------
export const opUnion = (a: number, b: number) => Math.min(a, b);
export const opSub = (a: number, b: number) => Math.max(a, -b);
export const opIntersect = (a: number, b: number) => Math.max(a, b);
export function opSmoothUnion(a: number, b: number, k: number): number {
  const h = clamp(0.5 + 0.5 * (b - a) / Math.max(k, 1e-9), 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}

// --- SDF primitives ----------------------------------------------------------
export function sdSphere(x: number, y: number, z: number, cx: number, cy: number, cz: number, r: number): number {
  const dx = x - cx, dy = y - cy, dz = z - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

const _w = new Float32Array(3);

/** Build the terrain SDF + hard/sol channels. Async-chunked with progress. */
export async function buildTerrain(
  vol: Volume, p: TerrainParams,
  onProgress?: (t: number, label: string) => void
): Promise<void> {
  const res = vol.res, size = vol.size;
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  // ---- Pass A: landform field H(x,z) in 0..1 --------------------------------
  onProgress?.(0.02, 'landform');
  const H = new Float32Array(res * res);
  let hMin = Infinity, hMax = -Infinity;
  const warp = new Float32Array(3);
  const meanderSeed = p.seed + 777;

  for (let k = 0; k < res; k++) {
    const z = (k + 0.5) / res; // 0..1 across volume
    for (let i = 0; i < res; i++) {
      const x = (i + 0.5) / res;
      // Domain-warped sample coords (unit space).
      domainWarp3(x * p.rangeFreq, 0.5, z * p.rangeFreq, 1.0, p.warpAmp * p.rangeFreq, p.seed, warp);
      const wx = warp[0], wz = warp[2];

      // Base relief: ridged mountains + fbm hills.
      const ridge = ridged3(wx, 0.37, wz, 5, 2.1, 2.0, 1.0, p.seed);
      const hills = fbm3(wx * 0.7 + 13.1, 2.2, wz * 0.7 + 7.7, 4, 2.02, 0.5, p.seed + 5) * 0.5 + 0.5;
      let h = ridge * 0.72 + hills * 0.28;

      // Range mask: large fbm decides mountains vs plains (non-repetitive).
      const mask = fbm3(x * 1.3 + 3.1, 9.4, z * 1.3 + 1.7, 3, 2.0, 0.5, p.seed + 21) * 0.5 + 0.5;
      const m = smoothstep(0.25, 0.75, mask);
      h = lerp(hills * 0.55, h, 0.25 + 0.75 * m);

      // Landform sculpting.
      if (p.islandFalloff > 0) {
        const dx = x - 0.5, dz = z - 0.5;
        const r = Math.sqrt(dx * dx + dz * dz) * 2; // 0 center → ~1.41 corner
        h -= smoothstep(0.55, 1.05, r) * p.islandFalloff * 1.2;
      }
      if (p.riverCarve > 0) {
        // Winding canyon river along z.
        const mx = 0.5 + (fbm3(3.7, 11.1, z * 3.0, 3, 2.0, 0.5, meanderSeed)) * 0.28;
        const d = Math.abs(x - mx);
        const wHalf = 0.035 + 0.03 * (0.5 + 0.5 * perlin3(1.1, 5.5, z * 6.0, meanderSeed + 9));
        const cut = Math.exp(-(d * d) / (wHalf * wHalf));
        // Stepped canyon profile: inner gorge + outer amphitheater.
        const gorge = Math.exp(-(d * d) / ((wHalf * 0.35) * (wHalf * 0.35)));
        h -= p.riverCarve * (cut * 0.45 + gorge * 0.75);
      }

      // Terrace (canyon strata benches).
      if (p.terraceAmt > 0) {
        h = lerp(h, terrace01(h, p.terraceSteps, p.terraceSharp), p.terraceAmt);
      }
      H[k * res + i] = h;
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
    }
    if ((k & 15) === 0) { onProgress?.(0.02 + 0.18 * (k / res), 'landform'); await tick(); }
  }

  // Normalize → world heights.
  const span = Math.max(hMax - hMin, 1e-6);
  const yBase = vol.oy + p.baseHeight * size;
  const yAmp = p.mountainAmp * size;
  const Hw = new Float32Array(res * res);
  for (let n = 0; n < H.length; n++) Hw[n] = yBase + ((H[n] - hMin) / span) * yAmp;

  // ---- Pass B: 3D fill -------------------------------------------------------
  onProgress?.(0.22, 'sdf fill');
  const { sdf, hard, sol } = vol;
  const dipLen = Math.sqrt(1 + p.dipTilt * p.dipTilt);
  const dipX = (p.dipTilt * 0.6) / dipLen, dipY = 1 / dipLen, dipZ = (p.dipTilt * 0.8) / dipLen;
  const strataF = p.strataFreq / size;
  const warpF = 2.5 / size;
  const detF = p.detailFreq / size;
  const detA = p.detailAmp * size;
  const caveF = 3.4 / size;

  // Strata band hardness/solubility tables (6 rock types, cycled).
  const bandHard = [0.62, 0.34, 0.85, 0.55, 0.92, 0.42];
  const bandSol = [0.35, 0.75, 0.15, 0.60, 0.08, 0.50];

  for (let k = 0; k < res; k++) {
    const z = vol.oz + (k + 0.5) * vol.vox;
    for (let j = 0; j < res; j++) {
      const y = vol.oy + (j + 0.5) * vol.vox;
      const rowHw = k * res;
      const rowOut = (k * res + j) * res;
      for (let i = 0; i < res; i++) {
        const x = vol.ox + (i + 0.5) * vol.vox;
        const surf = Hw[rowHw + i];

        // Base: distance to landform surface + 3D crag.
        let f = y - surf;
        // Crag detail fades with depth (keeps deep voxels cheap & stable).
        const depthFade = clamp01(1 - (surf - y) / (size * 0.25));
        if (depthFade > 0 && detA > 0) {
          const crag = fbm3(x * detF, y * detF, z * detF, 4, 2.1, 0.5, p.seed + 55);
          // Ridged crag near cliffs: sharpen via billow mix.
          const sharp = billow3(x * detF * 1.7 + 4.4, y * detF * 1.7, z * detF * 1.7, 2, 2.0, 0.5, p.seed + 56);
          f += detA * depthFade * (crag * 0.7 + (sharp - 0.5) * 0.9);
        }

        // Caves: subtractive billow worms below the surface.
        if (p.caveAmt > 0 && y < surf - size * 0.02) {
          const w1 = billow3(x * caveF, y * caveF * 1.4, z * caveF, 3, 2.0, 0.5, p.seed + 91);
          const w2 = billow3(x * caveF + 9.1, y * caveF, z * caveF + 3.3, 2, 2.0, 0.5, p.seed + 92);
          const worm = Math.min(w1, w2);
          const depthMask = smoothstep(surf, surf - size * 0.10, y) * smoothstep(vol.oy - 1, vol.oy + size * 0.06, y);
          const carve = (worm - (1 - p.caveAmt * 0.55)) * size * 0.06 * depthMask;
          if (carve > 0) f = Math.max(f, carve); // CSG subtract (inside<0)
        }

        const id = rowOut + i;
        sdf[id] = f;

        // Hardness + solubility from warped strata.
        const s = strataCoord(x, y, z, dipX, dipY, dipZ, strataF, 0.9, warpF, p.seed + 301);
        const band = Math.abs(Math.floor(s)) % 6;
        const frac = s - Math.floor(s);
        const seam = smoothstep(0.0, 0.06, frac) * smoothstep(1.0, 0.94, frac); // soft seams
        const jitter = fbm3(x * detF * 0.5 + 31, y * detF * 0.5, z * detF * 0.5, 2, 2.0, 0.5, p.seed + 61);
        hard[id] = clamp01(lerp(bandHard[band] * 0.55, bandHard[band], seam) + jitter * 0.12);
        sol[id] = clamp01(lerp(bandSol[band], 0.5, 1 - seam) + jitter * 0.1);
      }
    }
    if ((k & 7) === 0) { onProgress?.(0.22 + 0.78 * (k / res), 'sdf fill'); await tick(); }
  }

  vol.clearSim();
  vol.touch();
  onProgress?.(1, 'done');
}
