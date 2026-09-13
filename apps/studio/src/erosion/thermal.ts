/**
 * Thermal / talus erosion — 3D mass-conservative angle-of-repose collapse.
 *
 * For every narrow-band voxel steeper than the talus angle, a dollop of material
 * moves from the voxel to its downhill neighbor ALONG THE TRUE 3D GRADIENT
 * TANGENT. Every += has a matching -= : volume is conserved by construction,
 * cliffs shed outward into talus cones, and overhangs collapse. No blur kernel.
 */
import { Volume } from '../core/volume';
import { clamp01 } from '../core/noise';
import { SimStats, newStats } from './particles';

export interface ThermalParams {
  enabled: boolean;
  talusDeg: number;     // angle of repose
  rate: number;         // transfer coefficient (keep ≤ 0.3 for stability)
  iterations: number;   // sweeps per update call
  hardnessEffect: number; // 0..1 how much hardness slows collapse
  bandVox: number;      // narrow-band half-width in voxels
}

export const DEFAULT_THERMAL: ThermalParams = {
  enabled: false,
  talusDeg: 34,
  rate: 0.18,
  iterations: 6,
  hardnessEffect: 0.65,
  bandVox: 3,
};

export class ThermalSim {
  params: ThermalParams;
  stats: SimStats = newStats();
  private active: Int32Array | null = null;
  private activeCount = 0;
  private activeVersion = -1;

  constructor(params: ThermalParams = { ...DEFAULT_THERMAL }) {
    this.params = params;
  }

  reset(): void { this.stats = newStats(); this.activeVersion = -1; }

  /** Rebuild the narrow-band active list when the SDF changed (cheap scan). */
  private ensureActive(vol: Volume, band: number): void {
    if (this.activeVersion === vol.version && this.active) return;
    const n = vol.count;
    if (!this.active || this.active.length < n) this.active = new Int32Array(n);
    const { sdf } = vol;
    let c = 0;
    for (let i = 0; i < n; i++) {
      const f = sdf[i];
      if (f > -band && f < band) this.active![c++] = i;
    }
    this.activeCount = c;
    this.activeVersion = vol.version;
  }

  update(vol: Volume, dtSec = 1 / 60): void {
    const p = this.params;
    if (!p.enabled) return;
    const timeK = Math.min(Math.max(dtSec, 0), 0.12) * 9; // 1.0 base = full-rate sweep at ~111ms
    const band = p.bandVox * vol.vox;
    this.ensureActive(vol, band);
    const active = this.active!;
    const res = vol.res, vox = vol.vox;
    const { sdf, hard, sed, erode } = vol;
    const cosT = Math.cos((p.talusDeg * Math.PI) / 180);
    let moved = 0;

    const idx = (i: number, j: number, k: number) => (k * res + j) * res + i;
    for (let it = 0; it < p.iterations; it++) {
      // Strided order alternates per iteration to avoid directional bias.
      const off = it & 1;
      for (let a = 0; a < this.activeCount; a++) {
        const id = active[(a + off) % this.activeCount];
        const f = sdf[id];
        if (f < -band || f > band) continue;
        const i = id % res, j = (((id / res) | 0) % res) | 0, k = (id / (res * res)) | 0;
        if (i < 1 || j < 1 || k < 1 || i > res - 2 || j > res - 2 || k > res - 2) continue;
        // Lattice gradient (6 direct reads — fast, no trilinear).
        const gx = (sdf[idx(i + 1, j, k)] - sdf[idx(i - 1, j, k)]) / (2 * vox);
        const gy = (sdf[idx(i, j + 1, k)] - sdf[idx(i, j - 1, k)]) / (2 * vox);
        const gz = (sdf[idx(i, j, k + 1)] - sdf[idx(i, j, k - 1)]) / (2 * vox);
        const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) + 1e-9;
        const nx = gx / gl, ny = gy / gl, nz = gz / gl;
        const steep = cosT - ny;
        if (steep <= 0) continue;
        // Downhill tangent t = g - n(g·n), g=(0,-1,0).
        const gtn = -ny;
        let tx = -nx * gtn, ty = -1 - ny * gtn, tz = -nz * gtn;
        // Deterministic jitter breaks symmetry (hash by voxel id).
        let h = Math.imul(id + it * 7919, 2654435761);
        h ^= h >>> 13;
        const jr = 0.25;
        tx += (((h >>> 8) & 255) / 255 - 0.5) * jr;
        tz += (((h >>> 16) & 255) / 255 - 0.5) * jr;
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) + 1e-9;
        tx /= tl; ty /= tl; tz /= tl;
        const ni = Math.round(i + tx), nj = Math.round(j + ty), nk = Math.round(k + tz);
        if (ni === i && nj === j && nk === k) continue;
        if (ni < 0 || nj < 0 || nk < 0 || ni >= res || nj >= res || nk >= res) continue;
        const nid = idx(ni, nj, nk);
        const amt = p.rate * steep * vox * (1 - clamp01(hard[id]) * p.hardnessEffect) * timeK;
        if (amt <= 1e-9) continue;
        sdf[id] += amt;      // donor loses solid
        sdf[nid] -= amt;     // recipient gains solid (conservative!)
        sed[nid] += amt * 2;
        erode[id] += amt;
        moved += amt * vox * vox;
      }
    }
    if (moved > 0) {
      vol.touch();
      this.stats.carved += moved;
      this.stats.deposited += moved;
    }
  }
}
