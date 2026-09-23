// ============================================================================
//  terrain.js — multifractal mountain synthesis -> heightfield -> true SDF
// ============================================================================

import { SDFVolume } from './sdf.js';
import { GradientNoise2D, ridgedMultifractal, hybridMultifractal, fbm, warp2, peakMask } from './noise.js';

/**
 * Build the base terrain.
 *
 * @param {object} p {
 *   seed, size:[sx,sy,sz], res,            // grid "width" resolution N (nx=nz=N)
 *   style: 'ridged'|'hybrid'|'fbm',
 *   octaves, lacunarity, gain, baseFreq,   // multifractal
 *   warp,                                  // domain warp amplitude (m)
 *   peakHeight (m relief), peakRadius (m), maskPower,
 *   tiltStrength (m), tiltAngleDeg,        // directional gradient tilt
 *   baseHeight (m),                        // plain elevation
 *   bedrock (m)                            // floor margin below base
 * }
 * @param {function} onProgress (pct 0..1, msg)
 * @returns {object} { vol, colH, heights0, octavesUsed, voxel, detailCap }
 */
export function buildBaseTerrain(p, onProgress = () => {}) {
  const sx = p.size[0], sy = p.size[1], sz = p.size[2];
  const N = p.res;
  const nx = N, nz = N, ny = Math.max(16, Math.round(N * sy / sx));
  const vol = new SDFVolume({ nx, ny, nz, size: [sx, sy, sz] });
  const vox = vol.vox[0]; // isotropic by construction

  // --- detail cap: smallest noise wavelength we allow is ~3 voxels --------
  const baseWavelength = 1 / p.baseFreq;            // metres (noise is x*baseFreq)
  const maxOctaves = Math.max(1, Math.floor(Math.log2(baseWavelength / (3 * vox))) + 1);
  const octaves = Math.min(p.octaves, maxOctaves);

  const noise = new GradientNoise2D(p.seed >>> 0);
  const warpNoise = new GradientNoise2D((p.seed >>> 0) ^ 0x9E3779B9);

  const { nx: NX, nz: NZ } = vol;
  const colH = new Float32Array(NX * NZ);
  const cx = sx / 2, cz = sz / 2;
  const tiltRad = (p.tiltAngleDeg || 0) * Math.PI / 180;
  const tx = Math.cos(tiltRad), tz = Math.sin(tiltRad);

  const bedrock = p.bedrock, base = p.baseHeight, relief = p.peakHeight;

  // --- pass 1: multifractal heightfield ------------------------------------
  let count = 0;
  for (let k = 0; k < NZ; k++) {
    const wz = vol.worldZ(k);
    for (let i = 0; i < NX; i++) {
      const wx = vol.worldX(i);

      // domain warp (metres)
      let px = wx, pz = wz;
      if (p.warp > 0) {
        const w = warp2(warpNoise, wx * 0.045, wz * 0.045, p.warp);
        px = w[0]; pz = w[1];
      }

      // multifractal field [0..1]
      let f;
      const common = { octaves, lacunarity: p.lacunarity, gain: p.gain };
      if (p.style === 'hybrid') f = hybridMultifractal(noise, px * p.baseFreq, pz * p.baseFreq, common);
      else if (p.style === 'fbm') f = fbm(noise, px * p.baseFreq, pz * p.baseFreq, common) * 0.5 + 0.5;
      else f = ridgedMultifractal(noise, px * p.baseFreq, pz * p.baseFreq, common);

      // peak massif mask
      const mask = peakMask(wx - cx, wz - cz, p.peakRadius, p.maskPower || 2.2);

      // directional gradient tilt (biases ridges toward one flank)
      const tilt = p.tiltStrength ? (wx - cx) * tx + (wz - cz) * tz : 0;
      const tiltNorm = p.peakRadius ? Math.max(-1, Math.min(1, tilt / p.peakRadius)) : 0;

      let h = base + relief * mask * f + tiltNorm * p.tiltStrength * (0.25 + 0.75 * mask);
      h = Math.max(bedrock + 1.0, h);
      colH[k * NX + i] = h;
      count++;
    }
    if ((k & 15) === 0) onProgress(k / NZ * 0.45, 'Synthesising multifractal field');
  }

  // --- pass 2: seed SDF as vertical distance, clamp to band ----------------
  const bandDist = 7 * Math.max(vol.vox[0], vol.vox[1], vol.vox[2]);
  const data = vol.data;
  for (let k = 0; k < NZ; k++) {
    for (let i = 0; i < NX; i++) {
      const h = colH[k * NX + i];
      for (let j = 0; j < ny; j++) {
        const y = vol.worldY(j);
        let d = y - h;
        if (d > bandDist) d = bandDist;
        else if (d < -bandDist) d = -bandDist;
        data[(k * ny + j) * NX + i] = d;
      }
    }
    if ((k & 31) === 0) onProgress(0.45 + (k / NZ) * 0.1, 'Seeding SDF');
  }

  // --- pass 3: redistance (true |∇d| = 1 near the surface) ------------------
  vol.reinitialize({ bandVox: 7, iters: 3, clampDist: bandDist });
  onProgress(1, 'SDF redistanced');

  return {
    vol, colH, heights0: colH.slice(), octavesUsed: octaves, voxel: vox,
    detailCap: baseWavelength / Math.pow(2, octaves - 1),
    grid: [nx, ny, nz], bandDist
  };
}
