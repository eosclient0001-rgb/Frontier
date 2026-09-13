/**
 * Pooled particle store + SDF-native carve/deposit operators.
 *
 * THE anti-smoothing contract lives here: the ONLY ways simulators may move the
 * surface are carveSphere / carveCapsule (CSG subtraction) and depositBlob
 * (CSG union), plus the conservative voxel exchange in thermal.ts. There is no
 * blur/relax operator in this codebase — by design.
 */
import { Volume } from '../core/volume';
import { clamp, clamp01 } from '../core/noise';

export interface SimStats {
  carved: number;     // m³ removed (became sediment or left system)
  deposited: number;  // m³ added back as solid
  inFlight: number;   // m³ currently carried by live particles
  alive: number;
  spawned: number;
  killed: number;
}

export function newStats(): SimStats {
  return { carved: 0, deposited: 0, inFlight: 0, alive: 0, spawned: 0, killed: 0 };
}

export const P_BALLISTIC = 0;
export const P_FLOW = 1;

/** Preallocated struct-of-arrays pool with O(1) swap-remove. Zero allocs in loop. */
export class ParticlePool {
  cap: number;
  alive = 0;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  wat: Float32Array; sed: Float32Array; life: Float32Array;
  state: Uint8Array;
  ph: Float32Array; // per-particle random phase for jitter/turbulence

  constructor(cap: number) {
    this.cap = cap;
    this.px = new Float32Array(cap); this.py = new Float32Array(cap); this.pz = new Float32Array(cap);
    this.vx = new Float32Array(cap); this.vy = new Float32Array(cap); this.vz = new Float32Array(cap);
    this.wat = new Float32Array(cap); this.sed = new Float32Array(cap); this.life = new Float32Array(cap);
    this.state = new Uint8Array(cap);
    this.ph = new Float32Array(cap);
  }

  resize(cap: number): void {
    if (cap === this.cap) return;
    const n = new ParticlePool(cap);
    const m = Math.min(this.alive, cap);
    n.px.set(this.px.subarray(0, m)); n.py.set(this.py.subarray(0, m)); n.pz.set(this.pz.subarray(0, m));
    n.vx.set(this.vx.subarray(0, m)); n.vy.set(this.vy.subarray(0, m)); n.vz.set(this.vz.subarray(0, m));
    n.wat.set(this.wat.subarray(0, m)); n.sed.set(this.sed.subarray(0, m)); n.life.set(this.life.subarray(0, m));
    n.state.set(this.state.subarray(0, m)); n.ph.set(this.ph.subarray(0, m));
    n.alive = m;
    Object.assign(this, n);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number,
    wat: number, sed: number, life: number, state: number): boolean {
    if (this.alive >= this.cap) return false;
    const i = this.alive++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.wat[i] = wat; this.sed[i] = sed; this.life[i] = life;
    this.state[i] = state;
    this.ph[i] = Math.random() * Math.PI * 2;
    return true;
  }

  kill(i: number): void {
    const l = --this.alive;
    if (i !== l) {
      this.px[i] = this.px[l]; this.py[i] = this.py[l]; this.pz[i] = this.pz[l];
      this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.vz[i] = this.vz[l];
      this.wat[i] = this.wat[l]; this.sed[i] = this.sed[l]; this.life[i] = this.life[l];
      this.state[i] = this.state[l]; this.ph[i] = this.ph[l];
    }
  }

  clear(): void { this.alive = 0; }
}

/** Hardness resistance × wetness softening at a point. Multiplies removal radius. */
export function hardnessMod(vol: Volume, x: number, y: number, z: number, resist: number, soften: number): number {
  const h = clamp01(vol.sample(vol.hard, x, y, z));
  const w = clamp01(vol.sample(vol.wet, x, y, z));
  return (1 - Math.pow(h, 1.5) * clamp01(resist)) * (1 + w * soften);
}

export function rFromVolume(v: number): number {
  return v <= 0 ? 0 : Math.cbrt((3 * v) / (4 * Math.PI));
}

/**
 * CSG subtract a ball: f' = max(f, r - |p-c|).
 * Returns removed SOLID volume (m³). Accumulates the erosion mask.
 */
export function carveSphere(
  vol: Volume, cx: number, cy: number, cz: number, r: number, stats?: SimStats
): number {
  if (r <= 1e-9) return 0;
  const { res, vox, ox, oy, oz, sdf, erode } = vol;
  const v3 = vox * vox * vox;
  const i0 = Math.max(0, Math.floor((cx - r - ox) / vox - 0.5));
  const i1 = Math.min(res - 1, Math.ceil((cx + r - ox) / vox - 0.5));
  const j0 = Math.max(0, Math.floor((cy - r - oy) / vox - 0.5));
  const j1 = Math.min(res - 1, Math.ceil((cy + r - oy) / vox - 0.5));
  const k0 = Math.max(0, Math.floor((cz - r - oz) / vox - 0.5));
  const k1 = Math.min(res - 1, Math.ceil((cz + r - oz) / vox - 0.5));
  let removed = 0;
  for (let k = k0; k <= k1; k++) {
    const wz = oz + (k + 0.5) * vox - cz;
    for (let j = j0; j <= j1; j++) {
      const wy = oy + (j + 0.5) * vox - cy;
      for (let i = i0; i <= i1; i++) {
        const wx = ox + (i + 0.5) * vox - cx;
        const d = Math.sqrt(wx * wx + wy * wy + wz * wz);
        if (d >= r) continue;
        const id = (k * res + j) * res + i;
        const oldF = sdf[id];
        const newF = oldF > r - d ? oldF : r - d;
        if (newF !== oldF) {
          sdf[id] = newF;
          const before = oldF < 0 ? -oldF : 0;
          const after = newF < 0 ? -newF : 0;
          if (before > after) {
            const dv = (before - after) * v3;
            removed += dv;
            erode[id] += (before - after) * 2;
          }
        }
      }
    }
  }
  if (removed > 0) {
    vol.markDirty(cx - r, cy - r, cz - r, cx + r, cy + r, cz + r);
    if (stats) stats.carved += removed;
  }
  return removed;
}

/**
 * CSG subtract a capsule (segment a→b, radius r): gully/groove/scratch kernel.
 * Returns removed solid volume (m³).
 */
export function carveCapsule(
  vol: Volume,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  r: number, stats?: SimStats
): number {
  if (r <= 1e-9) return 0;
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  const { res, vox, ox, oy, oz, sdf, erode } = vol;
  const v3 = vox * vox * vox;
  const x0 = Math.min(ax, bx) - r, x1 = Math.max(ax, bx) + r;
  const y0 = Math.min(ay, by) - r, y1 = Math.max(ay, by) + r;
  const z0 = Math.min(az, bz) - r, z1 = Math.max(az, bz) + r;
  const i0 = Math.max(0, Math.floor((x0 - ox) / vox - 0.5));
  const i1 = Math.min(res - 1, Math.ceil((x1 - ox) / vox - 0.5));
  const j0 = Math.max(0, Math.floor((y0 - oy) / vox - 0.5));
  const j1 = Math.min(res - 1, Math.ceil((y1 - oy) / vox - 0.5));
  const k0 = Math.max(0, Math.floor((z0 - oz) / vox - 0.5));
  const k1 = Math.min(res - 1, Math.ceil((z1 - oz) / vox - 0.5));
  let removed = 0;
  const inv = len2 > 1e-12 ? 1 / len2 : 0;
  for (let k = k0; k <= k1; k++) {
    const wz = oz + (k + 0.5) * vox;
    for (let j = j0; j <= j1; j++) {
      const wy = oy + (j + 0.5) * vox;
      for (let i = i0; i <= i1; i++) {
        const wx = ox + (i + 0.5) * vox;
        const pax = wx - ax, pay = wy - ay, paz = wz - az;
        let t = (pax * abx + pay * aby + paz * abz) * inv;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = pax - abx * t, qy = pay - aby * t, qz = paz - abz * t;
        const d = Math.sqrt(qx * qx + qy * qy + qz * qz);
        if (d >= r) continue;
        const id = (k * res + j) * res + i;
        const oldF = sdf[id];
        const kf = r - d;
        const newF = oldF > kf ? oldF : kf;
        if (newF !== oldF) {
          sdf[id] = newF;
          const before = oldF < 0 ? -oldF : 0;
          const after = newF < 0 ? -newF : 0;
          if (before > after) {
            const dv = (before - after) * v3;
            removed += dv;
            erode[id] += (before - after) * 2;
          }
        }
      }
    }
  }
  if (removed > 0) {
    vol.markDirty(x0, y0, z0, x1, y1, z1);
    if (stats) stats.carved += removed;
  }
  return removed;
}

/**
 * CSG union a blob: f' = min(f, |p-c| - r). Deposition / fans / drifts.
 * Returns added solid volume (m³). Also feeds the loose-sediment channel.
 */
export function depositBlob(
  vol: Volume, cx: number, cy: number, cz: number, r: number, stats?: SimStats
): number {
  if (r <= 1e-9) return 0;
  const { res, vox, ox, oy, oz, sdf, sed } = vol;
  const v3 = vox * vox * vox;
  const i0 = Math.max(0, Math.floor((cx - r - ox) / vox - 0.5));
  const i1 = Math.min(res - 1, Math.ceil((cx + r - ox) / vox - 0.5));
  const j0 = Math.max(0, Math.floor((cy - r - oy) / vox - 0.5));
  const j1 = Math.min(res - 1, Math.ceil((cy + r - oy) / vox - 0.5));
  const k0 = Math.max(0, Math.floor((cz - r - oz) / vox - 0.5));
  const k1 = Math.min(res - 1, Math.ceil((cz + r - oz) / vox - 0.5));
  let added = 0;
  for (let k = k0; k <= k1; k++) {
    const wz = oz + (k + 0.5) * vox - cz;
    for (let j = j0; j <= j1; j++) {
      const wy = oy + (j + 0.5) * vox - cy;
      for (let i = i0; i <= i1; i++) {
        const wx = ox + (i + 0.5) * vox - cx;
        const d = Math.sqrt(wx * wx + wy * wy + wz * wz);
        if (d >= r) continue;
        const id = (k * res + j) * res + i;
        const oldF = sdf[id];
        const kf = d - r;
        const newF = oldF < kf ? oldF : kf;
        if (newF !== oldF) {
          sdf[id] = newF;
          const before = oldF < 0 ? -oldF : 0;
          const after = newF < 0 ? -newF : 0;
          if (after > before) {
            const dv = (after - before) * v3;
            added += dv;
            sed[id] += dv * 4;
          }
        }
      }
    }
  }
  if (added > 0) {
    vol.markDirty(cx - r, cy - r, cz - r, cx + r, cy + r, cz + r);
    if (stats) stats.deposited += added;
  }
  return added;
}

/** Clamp helper re-export for sims. */
export { clamp };
