import { ROAD } from './constants.js';

/**
 * One piece of road: a 1 m-sampled centreline with per-sample right vector, banking
 * and height. Lateral offsets are measured to the RIGHT of the driving direction
 * (positive lat = right-hand carriageway, where the player and forward traffic drive).
 *
 * Sections form a directed graph via `next` / `prev`. Y-splits create two sections
 * that share the same `prev` and `next` neighbours.
 */
export class Section {
  constructor(spec) {
    this.id = spec.id;
    this.kind = spec.kind; // straight | curve | ramp | ysplit-pre | ysplit-a | ysplit-b
    this.dist0 = spec.dist0; // route distance (m) at sample 0 along the player's chain
    this.elev = spec.elev; // deck level: 0 (street) or ELEV_HIGH (viaduct)
    this.isY = !!spec.isY;
    this.monorail = false; // monorail guideway runs on this section
    this.monoH = 0; // beam height above road for monorail
    this.railPar = false; // parallel heavy-rail tracks run here (ground only)
    this.rails = []; // perpendicular rail lines crossing this section
    this.removed = false;
    this.prev = [];
    this.next = [];

    const n = spec.xs.length;
    this.n = n;
    this.len = n - 1;
    this.px = Float64Array.from(spec.xs);
    this.py = Float64Array.from(spec.ys);
    this.pz = Float64Array.from(spec.zs);
    this.bs = Float64Array.from(spec.bs); // banking slope (tan): lateral height change per metre
    this.tx = new Float64Array(n);
    this.tz = new Float64Array(n);
    this.rx = new Float64Array(n);
    this.rz = new Float64Array(n);
    this.gy = new Float64Array(n); // grade (dy/ds)

    for (let i = 0; i < n; i++) {
      const a = Math.max(i - 1, 0);
      const b = Math.min(i + 1, n - 1);
      const dx = this.px[b] - this.px[a];
      const dz = this.pz[b] - this.pz[a];
      const dl = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / dl;
      this.tz[i] = dz / dl;
      this.rx[i] = -this.tz[i];
      this.rz[i] = this.tx[i];
      this.gy[i] = (this.py[b] - this.py[a]) / dl;
    }

    const m = ROAD.OUTER + 6;
    this.minX = Infinity;
    this.maxX = -Infinity;
    this.minZ = Infinity;
    this.maxZ = -Infinity;
    this.minY = Infinity;
    this.maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      this.minX = Math.min(this.minX, this.px[i]);
      this.maxX = Math.max(this.maxX, this.px[i]);
      this.minZ = Math.min(this.minZ, this.pz[i]);
      this.maxZ = Math.max(this.maxZ, this.pz[i]);
      this.minY = Math.min(this.minY, this.py[i]);
      this.maxY = Math.max(this.maxY, this.py[i]);
    }
    this.minX -= m;
    this.maxX += m;
    this.minZ -= m;
    this.maxZ += m;
  }

  /** Distance travelled along the section, clamped. */
  get endDist() {
    return this.dist0 + this.len;
  }

  _idx(s) {
    let f = s < 0 ? 0 : s > this.len ? this.len : s;
    let i = Math.floor(f);
    if (i >= this.len) i = this.len - 1;
    return [i, f - i];
  }

  /** Centre point at distance s and lateral offset lat (+ dy). Returns a fresh object. */
  point(s, lat = 0, dy = 0) {
    const [i, t] = this._idx(s);
    const j = i + 1;
    const cx = this.px[i] + (this.px[j] - this.px[i]) * t;
    const cz = this.pz[i] + (this.pz[j] - this.pz[i]) * t;
    const cy = this.py[i] + (this.py[j] - this.py[i]) * t;
    const bank = this.bs[i] + (this.bs[j] - this.bs[i]) * t;
    const rx = this.rx[i] + (this.rx[j] - this.rx[i]) * t;
    const rz = this.rz[i] + (this.rz[j] - this.rz[i]) * t;
    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t;
    const tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const gy = this.gy[i] + (this.gy[j] - this.gy[i]) * t;
    const rl = Math.hypot(rx, rz) || 1;
    const tl = Math.hypot(tx, tz) || 1;
    return {
      x: cx + (rx / rl) * lat,
      y: cy + bank * lat + dy,
      z: cz + (rz / rl) * lat,
      tx: tx / tl,
      tz: tz / tl,
      rx: rx / rl,
      rz: rz / rl,
      grade: gy,
      bank,
    };
  }

  /** Road surface height at (s, lat). */
  surfaceY(s, lat = 0) {
    const [i, t] = this._idx(s);
    const j = i + 1;
    const cy = this.py[i] + (this.py[j] - this.py[i]) * t;
    const bank = this.bs[i] + (this.bs[j] - this.bs[i]) * t;
    return cy + bank * lat;
  }

  /**
   * Nearest point on the centreline to (x, z).
   * Returns { s, lat, d } where d is horizontal distance to the centreline.
   */
  nearest(x, z) {
    const px = this.px;
    const pz = this.pz;
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const dx = px[i] - x;
      const dz = pz[i] - z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    let bestS = bi;
    let bestD = bd;
    let qx = px[bi];
    let qz = pz[bi];
    for (let j = bi - 1; j <= bi; j++) {
      if (j < 0 || j >= this.len) continue;
      const ex = px[j + 1] - px[j];
      const ez = pz[j + 1] - pz[j];
      const l2 = ex * ex + ez * ez || 1;
      let t = ((x - px[j]) * ex + (z - pz[j]) * ez) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = px[j] + ex * t;
      const cz = pz[j] + ez * t;
      const d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
      if (d < bestD) {
        bestD = d;
        bestS = j + t;
        qx = cx;
        qz = cz;
      }
    }
    const [i, t] = this._idx(bestS);
    const rx = this.rx[i] + (this.rx[i + 1] - this.rx[i]) * t;
    const rz = this.rz[i] + (this.rz[i + 1] - this.rz[i]) * t;
    const rl = Math.hypot(rx, rz) || 1;
    const lat = ((x - qx) * rx + (z - qz) * rz) / rl;
    return { s: bestS, lat, d: Math.sqrt(bestD) };
  }

  /** Quick AABB overlap test (XZ). */
  overlapsXZ(minX, maxX, minZ, maxZ) {
    return !(this.maxX < minX || this.minX > maxX || this.maxZ < minZ || this.minZ > maxZ);
  }
}
