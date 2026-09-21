/** Weighted covariance / PCA reconstruction inspired by Yu & Turk (2010).
 * CPU render-only adaptation: bounded, volume-normalized ellipsoid splats,
 * not the paper's summed implicit field and Marching Cubes isosurface.
 * Simulation positions are never modified.
 */
export class SurfaceReconstruction {
  readonly positions: Float32Array;
  readonly axisA: Float32Array;
  readonly axisB: Float32Array;
  readonly axisC: Float32Array;
  readonly volumeWeight: Float32Array;
  readonly support = .42;
  private heads = new Int32Array(32 ** 3);
  private next: Int32Array;
  private covariance = new Float64Array(9);
  private rotation = new Float64Array(9);

  constructor(capacity: number) {
    this.positions = new Float32Array(capacity * 3);
    this.axisA = new Float32Array(capacity * 3);
    this.axisB = new Float32Array(capacity * 3);
    this.axisC = new Float32Array(capacity * 3);
    this.volumeWeight = new Float32Array(capacity);
    this.next = new Int32Array(capacity);
  }

  private sphere(i: number, radius: number) {
    const k = i * 3;
    this.axisA[k] = radius; this.axisA[k + 1] = 0; this.axisA[k + 2] = 0;
    this.axisB[k] = 0; this.axisB[k + 1] = radius; this.axisB[k + 2] = 0;
    this.axisC[k] = 0; this.axisC[k + 1] = 0; this.axisC[k + 2] = radius;
    this.volumeWeight[i] = (1 / 265) / (4 * Math.PI / 3 * radius ** 3);
  }

  update(source: Float32Array, count: number, anisotropic = true) {
    this.positions.set(source.subarray(0, count * 3));
    if (!anisotropic) {
      for (let i = 0; i < count; i++) this.sphere(i, .155);
      return;
    }
    const h = this.support, h2 = h * h;
    this.heads.fill(-1);
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      const cell = Math.floor((source[k] + 3) / h) + 32 * Math.floor((source[k + 1] + 1) / h) + 1024 * Math.floor((source[k + 2] + 3) / h);
      this.next[i] = this.heads[cell]; this.heads[cell] = i;
    }
    for (let i = 0; i < count; i++) {
      const k = i * 3, x = source[k], y = source[k + 1], z = source[k + 2];
      const cx = Math.floor((x + 3) / h), cy = Math.floor((y + 1) / h), cz = Math.floor((z + 3) / h);
      let weight = 0, mx = 0, my = 0, mz = 0, xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0, neighbors = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        let j = this.heads[cx + dx + 32 * (cy + dy) + 1024 * (cz + dz)];
        while (j >= 0) {
          const t = j * 3, rx = source[t] - x, ry = source[t + 1] - y, rz = source[t + 2] - z;
          const r2 = rx * rx + ry * ry + rz * rz;
          if (r2 < h2) {
            const w = 1 - r2 * Math.sqrt(r2) / (h * h2);
            weight += w; mx += w * rx; my += w * ry; mz += w * rz;
            xx += w * rx * rx; xy += w * rx * ry; xz += w * rx * rz;
            yy += w * ry * ry; yz += w * ry * rz; zz += w * rz * rz;
            neighbors++;
          }
          j = this.next[j];
        }
      }
      // Isolated particles become near-mass-volume spherical droplets, not huge blobs.
      if (neighbors < 8) { this.sphere(i, .097); continue; }
      mx /= weight; my /= weight; mz /= weight;
      const c = this.covariance;
      c[0] = xx / weight - mx * mx; c[1] = c[3] = xy / weight - mx * my; c[2] = c[6] = xz / weight - mx * mz;
      c[4] = yy / weight - my * my; c[5] = c[7] = yz / weight - my * mz; c[8] = zz / weight - mz * mz;
      const rotation = this.rotation;
      rotation.fill(0); rotation[0] = rotation[4] = rotation[8] = 1;
      // Jacobi diagonalization of a real symmetric 3x3 covariance matrix.
      for (let sweep = 0; sweep < 5; sweep++) {
        this.rotate(0, 1); this.rotate(0, 2); this.rotate(1, 2);
      }
      const max = Math.max(c[0], c[4], c[8], 1e-8);
      // Bound aspect ratio to 3:1; volume normalization avoids artificial inflation.
      const e0 = Math.max(c[0], max / 3), e1 = Math.max(c[4], max / 3), e2 = Math.max(c[8], max / 3);
      const radius = .097 + .058 * Math.min(1, (neighbors - 7) / 20);
      const factor = radius / Math.cbrt(e0 * e1 * e2);
      const a = e0 * factor, b = e1 * factor, d = e2 * factor;
      for (let axis = 0; axis < 3; axis++) {
        this.axisA[k + axis] = rotation[axis * 3] * a;
        this.axisB[k + axis] = rotation[axis * 3 + 1] * b;
        this.axisC[k + axis] = rotation[axis * 3 + 2] * d;
      }
      this.volumeWeight[i] = (1 / 265) / (4 * Math.PI / 3 * radius ** 3);
      // Shift only render centers toward a weighted neighborhood average.
      const smoothing = .3 * Math.min(1, (neighbors - 7) / 20);
      this.positions[k] = x + mx * smoothing;
      this.positions[k + 1] = y + my * smoothing;
      this.positions[k + 2] = z + mz * smoothing;
    }
  }

  private rotate(p: number, q: number) {
    const c = this.covariance, v = this.rotation, pq = p * 3 + q;
    if (Math.abs(c[pq]) < 1e-12) return;
    const angle = .5 * Math.atan2(2 * c[pq], c[q * 3 + q] - c[p * 3 + p]);
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    const app = c[p * 3 + p], aqq = c[q * 3 + q], apq = c[pq];
    for (let k = 0; k < 3; k++) {
      if (k !== p && k !== q) {
        const kp = c[k * 3 + p], kq = c[k * 3 + q];
        c[k * 3 + p] = c[p * 3 + k] = cosine * kp - sine * kq;
        c[k * 3 + q] = c[q * 3 + k] = sine * kp + cosine * kq;
      }
      const vp = v[k * 3 + p], vq = v[k * 3 + q];
      v[k * 3 + p] = cosine * vp - sine * vq;
      v[k * 3 + q] = sine * vp + cosine * vq;
    }
    c[p * 3 + p] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq;
    c[q * 3 + q] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq;
    c[pq] = c[q * 3 + p] = 0;
  }
}
