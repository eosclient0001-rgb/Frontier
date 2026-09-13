/**
 * Chemical erosion — dissolution + precipitation (karst).
 *
 * Per-voxel surface retreat ∝ wetness × solubility × micro-porosity noise.
 * The high-frequency porosity term guarantees roughness INCREASES (pitting,
 * etching, pinnacles) — the opposite of smoothing. Precipitation (tufa) adds
 * material back where water slows and evaporates.
 */
import { Volume } from '../core/volume';
import { clamp01, valueNoise3 } from '../core/noise';
import { SimStats, newStats } from './particles';

export interface ChemicalParams {
  enabled: boolean;
  rate: number;        // dissolution speed (surface retreat per second at wet=1,sol=1)
  precipRate: number;  // precipitation speed
  poreFreq: number;    // micro-porosity frequency (per volume)
  poreAmp: number;     // 0..1 how much porosity modulates rate
  flowLow: number;     // below this flux → precipitation zone
  wetMid: number;      // above this wetness → precipitation needs water
  bandVox: number;
}

export const DEFAULT_CHEMICAL: ChemicalParams = {
  enabled: false,
  rate: 0.25,
  precipRate: 0.06,
  poreFreq: 26,
  poreAmp: 0.75,
  flowLow: 0.02,
  wetMid: 0.25,
  bandVox: 2,
};

export class ChemicalSim {
  params: ChemicalParams;
  stats: SimStats = newStats();
  private active: Int32Array | null = null;
  private activeCount = 0;
  private activeVersion = -1;
  private cursor = 0;

  constructor(params: ChemicalParams = { ...DEFAULT_CHEMICAL }) {
    this.params = params;
  }

  reset(): void { this.stats = newStats(); this.activeVersion = -1; this.cursor = 0; }

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

  /** dt in seconds; processes a time-sliced fraction of the narrow band. */
  update(vol: Volume, dt: number, budgetMs: number): void {
    const p = this.params;
    if (!p.enabled) return;
    const deadline = performance.now() + Math.max(0.5, budgetMs);
    dt = Math.min(dt, 0.1);
    const band = p.bandVox * vol.vox;
    this.ensureActive(vol, band);
    if (this.activeCount === 0) return;
    const active = this.active!;
    const res = vol.res, vox = vol.vox;
    const { sdf, wet, flow, sol, erode, sed } = vol;
    const freq = p.poreFreq / vol.size;
    if (this.cursor >= this.activeCount) this.cursor = 0;
    const start = this.cursor;
    let processed = 0, i = start;
    let dissolved = 0, precipitated = 0;
    const v2 = vox * vox; // retreat × area ≈ volume
    while (processed < this.activeCount) {
      if (i >= this.activeCount) i = 0;
      if (processed > 0 && i === start) break;
      if ((processed & 1023) === 0 && performance.now() > deadline && processed > 2048) break;
      processed++;
      const id = active[i++];
      const w = wet[id];
      if (w <= 0.003 && flow[id] <= 0) continue;
      const vi = id % res, vj = (((id / res) | 0) % res) | 0, vk = (id / (res * res)) | 0;
      const x = vol.ox + (vi + 0.5) * vox;
      const y = vol.oy + (vj + 0.5) * vox;
      const z = vol.oz + (vk + 0.5) * vox;
      const s = clamp01(sol[id]);
      const pore = valueNoise3(x * freq, y * freq, z * freq, 4242);
      const rate = p.rate * vox * clamp01(w) * (0.25 + 0.75 * s) * (1 - p.poreAmp + p.poreAmp * pore * 1.6) * dt;
      if (rate > 1e-12) {
        sdf[id] += rate;         // dissolve: surface retreats (f increases)
        erode[id] += rate * 3;
        dissolved += rate * v2;
      }
      if (flow[id] < p.flowLow && w > p.wetMid) {
        const pr = p.precipRate * vox * clamp01(w) * (p.flowLow - flow[id] + 0.005) * 20 * dt;
        const prc = Math.min(pr, vox * 0.2 * dt * 60 * 0.016 + 1e-9);
        if (prc > 1e-12) {
          sdf[id] -= prc;        // precipitate: surface grows
          sed[id] += prc * 2;
          precipitated += prc * v2;
        }
      }
    }
    this.cursor = i >= this.activeCount ? 0 : i;
    if (dissolved + precipitated > 0) {
      vol.touch();
      this.stats.carved += dissolved;
      this.stats.deposited += precipitated;
    }
  }
}
