/**
 * SDF volume + attribute channels.
 *
 * Convention: f(p) < 0 inside solid, > 0 outside. Voxel (i,j,k) center sits at
 * origin + (i+0.5, j+0.5, k+0.5) * vox. All sampling is world-space trilinear.
 */
import { clamp01 } from './noise';

export class Volume {
  res: number;          // voxels per side
  size: number;         // world units per side
  ox: number; oy: number; oz: number;  // world-space origin (min corner)
  vox: number;          // voxel size (world units)

  sdf: Float32Array;    // signed distance
  hard: Float32Array;   // hardness 0..1
  sed: Float32Array;    // loose sediment
  wet: Float32Array;    // wetness 0..1
  flow: Float32Array;   // accumulated flux
  erode: Float32Array;  // cumulative erosion mask
  rain: Float32Array;   // painted rain emitter mask 0..1
  sol: Float32Array;    // solubility 0..1

  /** Bumped on any mutation; mesher/UI watch it. */
  version = 0;
  /** Approximate world-space bbox of last edits (for future dirty-rect meshing). */
  dirtyMin = new Float32Array(3);
  dirtyMax = new Float32Array(3);

  constructor(res: number, size: number, ox = -size / 2, oy = 0, oz = -size / 2) {
    this.res = res;
    this.size = size;
    this.ox = ox; this.oy = oy; this.oz = oz;
    this.vox = size / res;
    const n = res * res * res;
    this.sdf = new Float32Array(n);
    this.hard = new Float32Array(n);
    this.sed = new Float32Array(n);
    this.wet = new Float32Array(n);
    this.flow = new Float32Array(n);
    this.erode = new Float32Array(n);
    this.rain = new Float32Array(n);
    this.sol = new Float32Array(n);
    this.resetDirty();
  }

  get count() { return this.res * this.res * this.res; }

  idx(i: number, j: number, k: number): number {
    return (k * this.res + j) * this.res + i;
  }

  cellCenter(i: number, j: number, k: number, out: Float32Array | number[]): void {
    out[0] = this.ox + (i + 0.5) * this.vox;
    out[1] = this.oy + (j + 0.5) * this.vox;
    out[2] = this.oz + (k + 0.5) * this.vox;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= this.ox && x < this.ox + this.size &&
      y >= this.oy && y < this.oy + this.size &&
      z >= this.oz && z < this.oz + this.size;
  }

  resetDirty(): void {
    const s = this.size;
    this.dirtyMin[0] = this.ox + s; this.dirtyMin[1] = this.oy + s; this.dirtyMin[2] = this.oz + s;
    this.dirtyMax[0] = this.ox; this.dirtyMax[1] = this.oy; this.dirtyMax[2] = this.oz;
  }

  markDirty(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    if (x0 < this.dirtyMin[0]) this.dirtyMin[0] = x0;
    if (y0 < this.dirtyMin[1]) this.dirtyMin[1] = y0;
    if (z0 < this.dirtyMin[2]) this.dirtyMin[2] = z0;
    if (x1 > this.dirtyMax[0]) this.dirtyMax[0] = x1;
    if (y1 > this.dirtyMax[1]) this.dirtyMax[1] = y1;
    if (z1 > this.dirtyMax[2]) this.dirtyMax[2] = z1;
    this.version++;
  }

  touch(): void { this.version++; }

  // ------------------------------------------------------------ sampling
  /** Trilinear sample of any channel. Out-of-bounds clamps to the edge cell. */
  sample(field: Float32Array, x: number, y: number, z: number): number {
    const gx = (x - this.ox) / this.vox - 0.5;
    const gy = (y - this.oy) / this.vox - 0.5;
    const gz = (z - this.oz) / this.vox - 0.5;
    let i0 = Math.floor(gx), j0 = Math.floor(gy), k0 = Math.floor(gz);
    let fx = gx - i0, fy = gy - j0, fz = gz - k0;
    const r = this.res;
    if (i0 < 0) { i0 = 0; fx = 0; } else if (i0 > r - 2) { i0 = r - 2; fx = 1; }
    if (j0 < 0) { j0 = 0; fy = 0; } else if (j0 > r - 2) { j0 = r - 2; fy = 1; }
    if (k0 < 0) { k0 = 0; fz = 0; } else if (k0 > r - 2) { k0 = r - 2; fz = 1; }
    const i1 = i0 + 1, j1 = j0 + 1, k1 = k0 + 1;
    const c000 = field[(k0 * r + j0) * r + i0];
    const c100 = field[(k0 * r + j0) * r + i1];
    const c010 = field[(k0 * r + j1) * r + i0];
    const c110 = field[(k0 * r + j1) * r + i1];
    const c001 = field[(k1 * r + j0) * r + i0];
    const c101 = field[(k1 * r + j0) * r + i1];
    const c011 = field[(k1 * r + j1) * r + i0];
    const c111 = field[(k1 * r + j1) * r + i1];
    const x00 = c000 + (c100 - c000) * fx;
    const x10 = c010 + (c110 - c010) * fx;
    const x01 = c001 + (c101 - c001) * fx;
    const x11 = c011 + (c111 - c011) * fx;
    const y0 = x00 + (x10 - x00) * fy;
    const y1 = x01 + (x11 - x01) * fy;
    return y0 + (y1 - y0) * fz;
  }

  sampleSdf(x: number, y: number, z: number): number {
    // Above the volume = air (positive), below = solid (negative): keeps
    // ballistic particles sane without special-casing.
    if (y >= this.oy + this.size) return (y - (this.oy + this.size)) + this.vox;
    if (y < this.oy) return (y - this.oy) - this.vox;
    if (x < this.ox || x >= this.ox + this.size || z < this.oz || z >= this.oz + this.size) {
      return this.vox * 2; // outside sides = air
    }
    return this.sample(this.sdf, x, y, z);
  }

  /** Central-difference gradient of the SDF (world units). Not normalized. */
  gradient(x: number, y: number, z: number, out: Float32Array | number[]): void {
    const e = this.vox * 0.75;
    out[0] = (this.sampleSdf(x + e, y, z) - this.sampleSdf(x - e, y, z)) / (2 * e);
    out[1] = (this.sampleSdf(x, y + e, z) - this.sampleSdf(x, y - e, z)) / (2 * e);
    out[2] = (this.sampleSdf(x, y, z + e) - this.sampleSdf(x, y, z - e)) / (2 * e);
  }

  /** Outward unit normal (SDF gradient normalized). Safe fallback = +Y. */
  normal(x: number, y: number, z: number, out: Float32Array | number[]): void {
    this.gradient(x, y, z, out);
    const l = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]);
    if (l > 1e-9) { out[0] /= l; out[1] /= l; out[2] /= l; }
    else { out[0] = 0; out[1] = 1; out[2] = 0; }
  }

  /**
   * Mean-curvature estimate near the surface via SDF Laplacian:
   * lap(f) ≈ 2·H·|∇f|  →  H = lap / (2·|grad|). Units: 1/m.
   */
  curvature(x: number, y: number, z: number): number {
    const e = this.vox * 1.5;
    const c = this.sampleSdf(x, y, z);
    const lap = this.sampleSdf(x + e, y, z) + this.sampleSdf(x - e, y, z) +
      this.sampleSdf(x, y + e, z) + this.sampleSdf(x, y - e, z) +
      this.sampleSdf(x, y, z + e) + this.sampleSdf(x, y, z - e) - 6 * c;
    const g = Math.sqrt(
      Math.pow((this.sampleSdf(x + e, y, z) - this.sampleSdf(x - e, y, z)) / (2 * e), 2) +
      Math.pow((this.sampleSdf(x, y + e, z) - this.sampleSdf(x, y - e, z)) / (2 * e), 2) +
      Math.pow((this.sampleSdf(x, y, z + e) - this.sampleSdf(x, y, z - e)) / (2 * e), 2)
    );
    const denom = 2 * Math.max(g, 1e-4) * e * e;
    return lap / denom;
  }

  /** Iñigo Quilez-style SDF ambient occlusion along a normal. */
  ambientOcclusion(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    let occ = 0, sca = 1;
    for (let i = 0; i < 5; i++) {
      const h = 0.01 + 0.14 * i * this.vox * 2;
      const d = this.sampleSdf(x + nx * h, y + ny * h, z + nz * h);
      occ += (h - d) * sca;
      sca *= 0.92;
    }
    return clamp01(1 - 2.2 * occ);
  }

  // ------------------------------------------------------------ splats
  /** Trilinear add of amount into a single cell neighborhood. */
  splat(field: Float32Array, x: number, y: number, z: number, amount: number): void {
    const gx = (x - this.ox) / this.vox - 0.5;
    const gy = (y - this.oy) / this.vox - 0.5;
    const gz = (z - this.oz) / this.vox - 0.5;
    const i0 = Math.floor(gx), j0 = Math.floor(gy), k0 = Math.floor(gz);
    const fx = gx - i0, fy = gy - j0, fz = gz - k0;
    const r = this.res;
    for (let dz = 0; dz <= 1; dz++) {
      const k = k0 + dz;
      if (k < 0 || k >= r) continue;
      const wz = dz === 0 ? 1 - fz : fz;
      for (let dy = 0; dy <= 1; dy++) {
        const j = j0 + dy;
        if (j < 0 || j >= r) continue;
        const wy = (dy === 0 ? 1 - fy : fy) * wz;
        for (let dx = 0; dx <= 1; dx++) {
          const i = i0 + dx;
          if (i < 0 || i >= r) continue;
          field[(k * r + j) * r + i] += amount * (dx === 0 ? 1 - fx : fx) * wy;
        }
      }
    }
  }

  /**
   * Spherical stamp with smooth falloff. Modes: 'add' | 'max' | 'set' | 'min'.
   * Used by paint tools and attribute side-effects of carving/deposition.
   */
  stampBall(
    field: Float32Array, cx: number, cy: number, cz: number, radius: number,
    amount: number, mode: 'add' | 'max' | 'set' | 'min' = 'add'
  ): void {
    const r = this.res, v = this.vox;
    const i0 = Math.max(0, Math.floor((cx - radius - this.ox) / v - 0.5));
    const i1 = Math.min(r - 1, Math.ceil((cx + radius - this.ox) / v - 0.5));
    const j0 = Math.max(0, Math.floor((cy - radius - this.oy) / v - 0.5));
    const j1 = Math.min(r - 1, Math.ceil((cy + radius - this.oy) / v - 0.5));
    const k0 = Math.max(0, Math.floor((cz - radius - this.oz) / v - 0.5));
    const k1 = Math.min(r - 1, Math.ceil((cz + radius - this.oz) / v - 0.5));
    const inv = 1 / Math.max(radius, 1e-9);
    for (let k = k0; k <= k1; k++) {
      const wz = this.oz + (k + 0.5) * v - cz;
      for (let j = j0; j <= j1; j++) {
        const wy = this.oy + (j + 0.5) * v - cy;
        for (let i = i0; i <= i1; i++) {
          const wx = this.ox + (i + 0.5) * v - cx;
          const d = Math.sqrt(wx * wx + wy * wy + wz * wz) * inv;
          if (d > 1) continue;
          const fall = 0.5 + 0.5 * Math.cos(d * Math.PI); // smooth 1→0
          const id = (k * r + j) * r + i;
          const val = amount * fall;
          if (mode === 'add') field[id] += val;
          else if (mode === 'max') { if (val > field[id]) field[id] = val > 1 ? 1 : val; }
          else if (mode === 'min') { if (val < field[id]) field[id] = val; }
          else field[id] = val;
        }
      }
    }
  }

  // ------------------------------------------------------------ maintenance
  /** Zero the simulation channels (keeps sdf/hard/sol/rain). */
  clearSim(): void {
    this.sed.fill(0); this.wet.fill(0); this.flow.fill(0); this.erode.fill(0);
    this.touch();
  }

  clearPaint(): void {
    this.rain.fill(0);
    this.touch();
  }

  /** Clamp runaway channels (call after sim bursts). */
  sanitize(): void {
    const { wet, rain, hard, sol } = this;
    for (let i = 0; i < wet.length; i++) {
      if (wet[i] > 1) wet[i] = 1; else if (wet[i] < 0) wet[i] = 0;
      if (rain[i] > 1) rain[i] = 1; else if (rain[i] < 0) rain[i] = 0;
      if (hard[i] > 1) hard[i] = 1; else if (hard[i] < 0) hard[i] = 0;
      if (sol[i] > 1) sol[i] = 1; else if (sol[i] < 0) sol[i] = 0;
      if (this.sed[i] < 0) this.sed[i] = 0;
      if (this.flow[i] < 0) this.flow[i] = 0;
      if (this.erode[i] < 0) this.erode[i] = 0;
    }
  }

  /** Fraction of voxels inside solid — handy for presets/debugging. */
  insideFraction(): number {
    let c = 0;
    const s = this.sdf;
    for (let i = 0; i < s.length; i += 7) if (s[i] < 0) c++;
    return c / Math.ceil(s.length / 7);
  }
}
