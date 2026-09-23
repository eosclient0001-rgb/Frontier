// ============================================================================
//  sdf.js — isotropic-voxel 3D signed distance field volume + fast sweeping
//  redistancing (anisotropic-capable Godunov eikonal solver).
//
//  Sign convention: sdf < 0 inside rock, sdf > 0 in air. Distances in metres.
//  Pure ES module, no DOM.
// ============================================================================

const INF = 1e30;

export class SDFVolume {
  /**
   * @param {object} o  {nx, ny, nz, size:[sx,sy,sz] metres}
   */
  constructor({ nx, ny, nz, size }) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.size = size;
    this.vox = [size[0] / nx, size[1] / ny, size[2] / nz];
    this.data = new Float32Array(nx * ny * nz);
  }

  get cells() { return this.nx * this.ny * this.nz; }
  /** Linear index. Layout: i = (z*ny + y)*nx + x */
  idx(x, y, z) { return (z * this.ny + y) * this.nx + x; }

  /** World-space column origin helpers (cell centres). */
  worldX(i) { return (i + 0.5) * this.vox[0]; }
  worldY(j) { return (j + 0.5) * this.vox[1]; }
  worldZ(k) { return (k + 0.5) * this.vox[2]; }

  /** Trilinear SDF sample at world position (clamped at borders). */
  sample(x, y, z) {
    const { nx, ny, nz, data, vox } = this;
    let gx = x / vox[0] - 0.5, gy = y / vox[1] - 0.5, gz = z / vox[2] - 0.5;
    gx = Math.min(nx - 1.001, Math.max(0, gx));
    gy = Math.min(ny - 1.001, Math.max(0, gy));
    gz = Math.min(nz - 1.001, Math.max(0, gz));
    const i0 = gx | 0, j0 = gy | 0, k0 = gz | 0;
    const fx = gx - i0, fy = gy - j0, fz = gz - k0;
    const i1 = Math.min(i0 + 1, nx - 1), j1 = Math.min(j0 + 1, ny - 1), k1 = Math.min(k0 + 1, nz - 1);
    const s = ny * nx, r = nx;
    const b000 = data[k0 * s + j0 * r + i0],     b100 = data[k0 * s + j0 * r + i1];
    const b010 = data[k0 * s + j1 * r + i0],     b110 = data[k0 * s + j1 * r + i1];
    const b001 = data[k1 * s + j0 * r + i0],     b101 = data[k1 * s + j0 * r + i1];
    const b011 = data[k1 * s + j1 * r + i0],     b111 = data[k1 * s + j1 * r + i1];
    const c00 = b000 + (b100 - b000) * fx, c10 = b010 + (b110 - b010) * fx;
    const c01 = b001 + (b101 - b001) * fx, c11 = b011 + (b111 - b011) * fx;
    const c0 = c00 + (c10 - c00) * fy, c1 = c01 + (c11 - c01) * fy;
    return c0 + (c1 - c0) * fz;
  }

  /** World-space gradient via central differences of trilinear samples. */
  grad(x, y, z, out) {
    const h = this.vox;
    out = out || [0, 0, 0];
    out[0] = (this.sample(x + h[0], y, z) - this.sample(x - h[0], y, z)) / (2 * h[0]);
    out[1] = (this.sample(x, y + h[1], z) - this.sample(x, y - h[1], z)) / (2 * h[1]);
    out[2] = (this.sample(x, y, z + h[2]) - this.sample(x, y, z - h[2])) / (2 * h[2]);
    return out;
  }

  /**
   * Topmost surface height in a world-space column: first sign change
   * (air -> rock) scanning downward, linearly interpolated. Returns -1 if the
   * column contains no surface.
   */
  columnHeight(x, z) {
    const ny = this.ny;
    let yPrev = this.worldY(ny - 1);
    let dPrev = this.sample(x, yPrev, z);
    if (dPrev <= 0) return yPrev; // column fully buried
    for (let j = ny - 2; j >= 0; j--) {
      const y = this.worldY(j);
      const d = this.sample(x, y, z);
      if (d <= 0) {
        const t = dPrev / (dPrev - d);
        return yPrev + (y - yPrev) * t; // interpolate the zero crossing
      }
      dPrev = d; yPrev = y;
    }
    return -1;
  }

  /**
   * Fast-sweeping redistancing. Solves |∇d| = 1 in a narrow band around the
   * zero level set (Godunov upwind solve, per-axis spacing respected), then
   * clamps the far field to ±clampDist which keeps the field conservative
   * (never overestimating true distance) for sphere tracing.
   *
   * @param {object} o {bandVox=7, iters=3, clampDist} distances in metres
   */
  reinitialize({ bandVox = 7, iters = 3, clampDist } = {}) {
    const { nx, ny, nz, data, vox } = this;
    const band = clampDist !== undefined ? clampDist : bandVox * Math.max(vox[0], vox[1], vox[2]);
    const hx = vox[0], hy = vox[1], hz = vox[2];

    for (let it = 0; it < iters; it++) {
      for (let dir = 0; dir < 8; dir++) {
        const xs = (dir & 1) ? -1 : 1, ys = (dir & 2) ? -1 : 1, zs = (dir & 4) ? -1 : 1;
        for (let zz = 0; zz < nz; zz++) {
          const z = zs > 0 ? zz : nz - 1 - zz;
          for (let yy = 0; yy < ny; yy++) {
            const y = ys > 0 ? yy : ny - 1 - yy;
            let rowBase = (z * ny + y) * nx;
            for (let xx = 0; xx < nx; xx++) {
              const x = xs > 0 ? xx : nx - 1 - xx;
              const i = rowBase + x;
              const s = data[i];
              const a = s < 0 ? -s : s;
              if (a > band) continue;
              const xm = x > 0 ? Math.abs(data[i - 1]) : INF;
              const xp = x < nx - 1 ? Math.abs(data[i + 1]) : INF;
              const ym = y > 0 ? Math.abs(data[i - nx]) : INF;
              const yp = y < ny - 1 ? Math.abs(data[i + nx]) : INF;
              const zm = z > 0 ? Math.abs(data[i - ny * nx]) : INF;
              const zp = z < nz - 1 ? Math.abs(data[i + ny * nx]) : INF;
              const mx = Math.min(xm, xp), my = Math.min(ym, yp), mz = Math.min(zm, zp);
              const sol = solveEikonal(mx, my, mz, hx, hy, hz);
              if (sol < a) data[i] = s < 0 ? -sol : sol;
            }
          }
        }
      }
    }
    // Clamp far field (conservative for ray marching, halves dynamic range).
    const cd = clampDist !== undefined ? clampDist : band;
    const n = data.length;
    for (let i = 0; i < n; i++) {
      const v = data[i];
      if (v > cd) data[i] = cd;
      else if (v < -cd) data[i] = -cd;
    }
  }
}

/**
 * Godunov 3D eikonal solve on an anisotropic grid.
 * m* are the min |d| of the two neighbours along each axis; h* the spacings.
 */
export function solveEikonal(mx, my, mz, hx, hy, hz) {
  // sort axes ascending by m (insertion sort of 3)
  let m0 = mx, h0 = hx, m1 = my, h1 = hy, m2 = mz, h2 = hz, t;
  if (m1 < m0) { t = m0; m0 = m1; m1 = t; t = h0; h0 = h1; h1 = t; }
  if (m2 < m0) { t = m0; m0 = m2; m2 = t; t = h0; h0 = h2; h2 = t; }
  if (m2 < m1) { t = m1; m1 = m2; m2 = t; t = h1; h1 = h2; h2 = t; }

  let a = 0, b = 0, c = -1, d = INF;
  const M = [m0, m1, m2], H = [h0, h1, h2];
  for (let k = 0; k < 3; k++) {
    if (M[k] >= INF) break;
    const ih = 1 / (H[k] * H[k]);
    const an = a + ih, bn = b + M[k] * ih, cn = c + M[k] * M[k] * ih;
    const disc = bn * bn - an * cn;
    if (disc < 0) break;
    const root = (bn + Math.sqrt(disc)) / an;
    const nextM = k < 2 ? M[k + 1] : INF;
    if (root <= nextM) { a = an; b = bn; c = cn; d = root; }
    else break;
  }
  if (d === INF) {
    // no valid quadratic — pure upwind fallback
    d = INF;
    if (m0 < INF) d = Math.min(d, m0 + h0);
    if (m1 < INF) d = Math.min(d, m1 + h1);
    if (m2 < INF) d = Math.min(d, m2 + h2);
    if (d === INF) d = h0;
  }
  return d;
}
