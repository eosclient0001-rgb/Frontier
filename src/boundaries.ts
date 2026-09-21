export interface BasinBounds { x: number; z: number; floor: number; ceiling: number; }
export interface SphereObstacle { enabled: boolean; x: number; y: number; z: number; radius: number; }

/** Static, volume-weighted boundary samples inspired by Akinci et al. (2012).
 * Samples contribute density/gradients; analytic constraints remain the collision safety net.
 * This is one-way coupling to a stationary container/obstacle, not rigid-body dynamics.
 */
export class BoundarySamples {
  readonly positions = new Float32Array(4000 * 3);
  readonly masses = new Float32Array(4000);
  readonly neighbors: Uint16Array;
  readonly counts: Uint8Array;
  readonly stride = 96;
  count = 0;
  overflow = 0;
  revision = 0;
  readonly clearance = .0785;
  private heads = new Int32Array(32 ** 3);
  private next = new Int32Array(4000);
  private poly: number;

  constructor(capacity: number, readonly h: number, readonly restDensity: number) {
    this.neighbors = new Uint16Array(capacity * this.stride);
    this.counts = new Uint8Array(capacity);
    this.poly = 315 / (64 * Math.PI * h ** 9);
  }

  rebuild(bounds: BasinBounds, obstacle: SphereObstacle) {
    this.count = 0;
    const seen = new Set<string>();
    const add = (x: number, y: number, z: number) => {
      const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (this.count >= this.masses.length) throw new Error('Boundary sample capacity exceeded');
      this.positions.set([x, y, z], this.count++ * 3);
    };
    const x = bounds.x + this.clearance, z = bounds.z + this.clearance, floor = bounds.floor - this.clearance;
    const nx = Math.ceil(2 * x / .157), nz = Math.ceil(2 * z / .157), ny = 9;
    const wallTop = 1.38;
    for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) add(-x + 2 * x * ix / nx, floor, -z + 2 * z * iz / nz);
    for (let iy = 1; iy <= ny; iy++) {
      const y = floor + (wallTop - floor) * iy / ny;
      for (let ix = 0; ix <= nx; ix++) { const px = -x + 2 * x * ix / nx; add(px, y, -z); add(px, y, z); }
      for (let iz = 1; iz < nz; iz++) { const pz = -z + 2 * z * iz / nz; add(-x, y, pz); add(x, y, pz); }
    }
    if (obstacle.enabled) {
      // Quasi-uniform Fibonacci sphere avoids duplicated poles and latitude crowding.
      const samples = Math.ceil(4 * Math.PI * obstacle.radius ** 2 / .021);
      for (let i = 0; i < samples; i++) {
        const y = 1 - 2 * (i + .5) / samples, r = Math.sqrt(1 - y * y), angle = i * 2.399963229728653;
        add(obstacle.x + obstacle.radius * Math.cos(angle) * r, obstacle.y + obstacle.radius * y, obstacle.z + obstacle.radius * Math.sin(angle) * r);
      }
    }
    this.heads.fill(-1);
    for (let i = 0; i < this.count; i++) {
      const k = i * 3, cell = this.cell(this.positions[k], this.positions[k + 1], this.positions[k + 2]);
      this.next[i] = this.heads[cell]; this.heads[cell] = i;
    }
    // Psi_b = rho0 / sum_k W_bk. Normalizes uneven sample density, including corners.
    const h2 = this.h * this.h;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3, px = this.positions[k], py = this.positions[k + 1], pz = this.positions[k + 2];
      const cell = this.cell(px, py, pz);
      let sum = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        let j = this.heads[cell + dx + 32 * dy + 1024 * dz];
        while (j >= 0) {
          const t = j * 3, r2 = (px - this.positions[t]) ** 2 + (py - this.positions[t + 1]) ** 2 + (pz - this.positions[t + 2]) ** 2;
          if (r2 < h2) sum += this.poly * (h2 - r2) ** 3;
          j = this.next[j];
        }
      }
      this.masses[i] = this.restDensity / Math.max(sum, 1e-8);
    }
    this.revision++;
  }

  private cell(x: number, y: number, z: number) {
    return Math.floor((x + 3) / this.h) + 32 * Math.floor((y + 1) / this.h) + 1024 * Math.floor((z + 3) / this.h);
  }

  findNeighbors(positions: Float32Array, count: number) {
    this.overflow = 0;
    const h2 = this.h * this.h;
    for (let i = 0; i < count; i++) {
      const k = i * 3, x = positions[k], y = positions[k + 1], z = positions[k + 2], cell = this.cell(x, y, z);
      let n = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        let j = this.heads[cell + dx + 32 * dy + 1024 * dz];
        while (j >= 0) {
          const t = j * 3, r2 = (x - this.positions[t]) ** 2 + (y - this.positions[t + 1]) ** 2 + (z - this.positions[t + 2]) ** 2;
          if (r2 < h2) {
            if (n < this.stride) this.neighbors[i * this.stride + n++] = j;
            else this.overflow++;
          }
          j = this.next[j];
        }
      }
      this.counts[i] = n;
    }
  }
}
