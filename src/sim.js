// Position Based Fluids (Macklin & Müller 2013) + XSPH viscosity, adhesion,
// cohesion, Bingham-like yield (mud) and two-way rigid sphere coupling.
// CPU implementation with flat typed arrays and a counting-sort uniform grid.

export const MATERIALS = {
  water: {
    dry: 0.35, name: 'Water', density: 1000,
    visc: 0.02, viscIters: 1, cohesion: 0.04, adhesion: 0.6, friction: 0.03, yieldV: 0, foam: 1,
    render: { absorb: [1.6, 0.42, 0.22], scatter: 0.0, albedo: [0.1, 0.3, 0.4], rough: 0.04, f0: 0.02, refract: 1.0, wrap: 0.0, sss: [0, 0, 0], grain: 0, env: 1.0 },
  },
  milk: {
    dry: 0.12, name: 'Milk', density: 1030,
    visc: 0.08, viscIters: 1, cohesion: 0.06, adhesion: 1.5, friction: 0.12, yieldV: 0, foam: 0.35,
    render: { absorb: [0.2, 0.22, 0.3], scatter: 60, albedo: [0.93, 0.92, 0.88], rough: 0.12, f0: 0.025, refract: 0.2, wrap: 0.6, sss: [1.0, 0.95, 0.85], grain: 0, env: 0.7 },
  },
  chocolate: {
    dry: 0.015, name: 'Chocolate', density: 1300,
    visc: 0.75, viscIters: 4, cohesion: 0.22, adhesion: 7, friction: 0.6, yieldV: 0.02, foam: 0,
    render: { absorb: [8, 10, 12], scatter: 120, albedo: [0.2, 0.085, 0.035], rough: 0.18, f0: 0.04, refract: 0.0, wrap: 0.3, sss: [0.5, 0.15, 0.04], grain: 0, env: 0.9 },
  },
  honey: {
    dry: 0.006, name: 'Honey', density: 1420,
    visc: 0.95, viscIters: 10, cohesion: 0.3, adhesion: 9, friction: 0.88, yieldV: 0.0, foam: 0,
    render: { absorb: [0.35, 1.5, 6.0], scatter: 0.0, albedo: [0.8, 0.45, 0.05], rough: 0.06, f0: 0.045, refract: 1.4, wrap: 0.0, sss: [1.0, 0.55, 0.1], grain: 0, env: 1.0 },
  },
  mud: {
    dry: 0.01, name: 'Mud', density: 1700,
    visc: 0.85, viscIters: 5, cohesion: 0.28, adhesion: 11, friction: 0.92, yieldV: 0.12, foam: 0,
    render: { absorb: [10, 12, 14], scatter: 200, albedo: [0.24, 0.17, 0.11], rough: 0.55, f0: 0.03, refract: 0.0, wrap: 0.2, sss: [0.2, 0.12, 0.06], grain: 1, env: 0.35 },
  },
};

const MAXN = 64;

export class FluidSim {
  constructor(maxParticles = 60000) {
    this.max = maxParticles;
    const M = maxParticles;
    this.x = new Float32Array(M * 3);
    this.p = new Float32Array(M * 3);
    this.v = new Float32Array(M * 3);
    this.dp = new Float32Array(M * 3);
    this.tv = new Float32Array(M * 3);
    this.lam = new Float32Array(M);
    this.rho = new Float32Array(M);
    this.foam = new Float32Array(M);
    this.conc = new Float32Array(M); // fraction of secondary fluid B
    this.mixRate = 0.15;
    this.cell = new Int32Array(M);
    this.sorted = new Int32Array(M);
    this.nb = new Int32Array(M * MAXN);
    this.nbc = new Uint8Array(M);
    this.nbw = new Float32Array(M * MAXN);
    this.n = 0;
    this.gravity = -9.8;
    this.iters = 3;
    this.time = 0;
    this.spheres = [];
    this.boxes = [];      // static AABB obstacles {c:[..], h:[..]}
    this.ramp = null;     // {x0, slope}
    this.piston = null;   // {amp, period, x, vx}
    this.emitters = [];
    this.emitter = null;  // {pos, dir, speed, radius, acc, until}
    this.setMaterial('water');
    this.setMaterial2('milk');
    this.configure(0.05, [3, 2, 1.2]);
  }

  setMaterial(key) {
    this.matKey = key;
    this.mat = { ...MATERIALS[key] };
  }
  setMaterial2(key) { this.mat2Key = key; this.mat2 = { ...MATERIALS[key] }; }

  configure(spacing, size) {
    this.s = spacing;
    this.h = spacing * 2.0;
    this.pr = spacing * 0.5;
    this.size = size;
    const h = this.h;
    this.h2 = h * h;
    this.K6 = 315 / (64 * Math.PI * Math.pow(h, 9));
    this.KS = 45 / (Math.PI * Math.pow(h, 6));
    this.gx = Math.ceil(size[0] / h) + 1;
    this.gy = Math.ceil(size[1] / h) + 1;
    this.gz = Math.ceil(size[2] / h) + 1;
    this.ncell = this.gx * this.gy * this.gz;
    this.cellStart = new Int32Array(this.ncell + 1);
    this.cellCur = new Int32Array(this.ncell);
    this.wet = new Float32Array(this.ncell * 2); // surface wetness/stain per cell: [fluid A, fluid B]
    // rest density and reference gradient sum from a perfect lattice
    let rho = 0, g2 = 0;
    const R = 3;
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) for (let k = -R; k <= R; k++) {
      const dx = i * spacing, dy = j * spacing, dz = k * spacing;
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < this.h2) {
        const t = this.h2 - r2; rho += this.K6 * t * t * t;
        const r = Math.sqrt(r2);
        if (r > 1e-9) { const c = this.KS * (h - r) * (h - r); g2 += c * c; }
      }
    }
    this.rho0 = rho;
    this.denomRef = g2 / (rho * rho);
    this.eps = this.denomRef * 0.08;
    const dq = 0.2 * h; const t = this.h2 - dq * dq;
    this.Wdq = this.K6 * t * t * t;
    this.pmass = () => (this.mat.density * (1 - this.avgConc) + this.mat2.density * this.avgConc) * spacing * spacing * spacing;
    this.avgConc = 0;
  }

  clear() { this.emitters = []; this.n = 0; this.spheres = []; this.boxes = []; this.ramp = null; this.piston = null; this.emitter = null; this.time = 0; }

  addParticle(x, y, z, vx = 0, vy = 0, vz = 0, conc = 0) {
    if (this.n >= this.max) return false;
    const i = this.n++, i3 = i * 3;
    this.x[i3] = x; this.x[i3 + 1] = y; this.x[i3 + 2] = z;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.foam[i] = 0; this.conc[i] = conc;
    return true;
  }

  addBlock(min, max, vel = [0, 0, 0], conc = 0) {
    const s = this.s;
    for (let x = min[0] + s * 0.5; x < max[0]; x += s)
      for (let y = min[1] + s * 0.5; y < max[1]; y += s)
        for (let z = min[2] + s * 0.5; z < max[2]; z += s) {
          if (this.solidDist(x, y, z) < this.pr) continue;
          const j = s * 0.02;
          if (!this.addParticle(x + (Math.random() - .5) * j, y + (Math.random() - .5) * j, z + (Math.random() - .5) * j, vel[0], vel[1], vel[2], conc)) return;
        }
  }

  addSphere(c, r, density, vel = [0, 0, 0], fixed = false) {
    const m = density * 4 / 3 * Math.PI * r * r * r;
    const sp = { c: [...c], v: [...vel], r, m, fixed, density, J: [0, 0, 0], color: density > 2000 ? [0.6, 0.62, 0.66] : density > 900 ? [0.8, 0.25, 0.2] : [0.85, 0.65, 0.35], rot: [1, 0, 0, 0], w: [0, 0, 0] };
    this.spheres.push(sp);
    const dyn = this.spheres.filter(s => !s.fixed);
    if (dyn.length > 14) this.spheres.splice(this.spheres.indexOf(dyn[0]), 1);
    return sp;
  }

  // ---------- solid geometry ----------
  // returns signed distance to the nearest solid; fills this._n (normal into fluid), this._sv (solid velocity), this._sid
  solidDist(x, y, z) {
    const [W, H, D] = this.size;
    let best = 1e9, nx = 0, ny = 0, nz = 0, sid = -1, svx = 0, svy = 0, svz = 0;
    const lox = this.piston ? this.piston.x : 0;
    let d;
    d = x - lox; if (d < best) { best = d; nx = 1; ny = 0; nz = 0; sid = -2; svx = this.piston ? this.piston.vx : 0; svy = 0; svz = 0; }
    d = W - x; if (d < best) { best = d; nx = -1; ny = 0; nz = 0; sid = -1; svx = svy = svz = 0; }
    d = y; if (d < best) { best = d; nx = 0; ny = 1; nz = 0; sid = -1; svx = svy = svz = 0; }
    d = z; if (d < best) { best = d; nx = 0; ny = 0; nz = 1; sid = -1; svx = svy = svz = 0; }
    d = D - z; if (d < best) { best = d; nx = 0; ny = 0; nz = -1; sid = -1; svx = svy = svz = 0; }
    if (this.ramp) {
      const r = this.ramp; const inv = 1 / Math.sqrt(1 + r.slope * r.slope);
      const rnx = -r.slope * inv, rny = inv;
      d = (x - r.x0) * rnx + y * rny;
      if (x > r.x0 - 0.2 && d < best) { best = d; nx = rnx; ny = rny; nz = 0; sid = -1; svx = svy = svz = 0; }
    }
    for (let b = 0; b < this.boxes.length; b++) {
      const B = this.boxes[b];
      const px = x - B.c[0], py = y - B.c[1], pz = z - B.c[2];
      const qx = Math.abs(px) - B.h[0], qy = Math.abs(py) - B.h[1], qz = Math.abs(pz) - B.h[2];
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
      const ol = Math.sqrt(ox * ox + oy * oy + oz * oz);
      const inside = Math.min(Math.max(qx, qy, qz), 0);
      d = ol + inside;
      if (d < best) {
        best = d; sid = -1; svx = svy = svz = 0;
        if (ol > 1e-7) { nx = ox / ol * Math.sign(px); ny = oy / ol * Math.sign(py); nz = oz / ol * Math.sign(pz); }
        else if (qx >= qy && qx >= qz) { nx = Math.sign(px); ny = 0; nz = 0; }
        else if (qy >= qz) { nx = 0; ny = Math.sign(py); nz = 0; }
        else { nx = 0; ny = 0; nz = Math.sign(pz); }
      }
    }
    for (let k = 0; k < this.spheres.length; k++) {
      const S = this.spheres[k];
      const dx = x - S.c[0], dy = y - S.c[1], dz = z - S.c[2];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-9;
      d = l - S.r;
      if (d < best) {
        best = d; nx = dx / l; ny = dy / l; nz = dz / l; sid = k;
        // surface velocity including spin
        const w = S.w, rx = nx * S.r, ry = ny * S.r, rz = nz * S.r;
        svx = S.v[0] + w[1] * rz - w[2] * ry; svy = S.v[1] + w[2] * rx - w[0] * rz; svz = S.v[2] + w[0] * ry - w[1] * rx;
      }
    }
    this._nx = nx; this._ny = ny; this._nz = nz; this._sid = sid;
    this._svx = svx; this._svy = svy; this._svz = svz;
    return best;
  }

  collide(i, mp, invDt) {
    const p = this.p, i3 = i * 3;
    const x = p[i3], y = p[i3 + 1], z = p[i3 + 2];
    const H = this.size[1];
    if (y > H * 1.5) p[i3 + 1] = H * 1.5;
    for (let pass = 0; pass < 2; pass++) {
      const d = this.solidDist(p[i3], p[i3 + 1], p[i3 + 2]);
      const pen = this.pr - d;
      if (pen <= 0) break;
      p[i3] += this._nx * pen; p[i3 + 1] += this._ny * pen; p[i3 + 2] += this._nz * pen;
      const sid = this._sid;
      if (sid >= 0) {
        const S = this.spheres[sid];
        if (!S.fixed) S.hit = 1;
      }
    }
  }

  // ---------- grid ----------
  buildGrid() {
    const { n, p, h, gx, gy, gz, cell, cellStart, cellCur, sorted } = this;
    cellStart.fill(0);
    const ih = 1 / h;
    for (let i = 0; i < n; i++) {
      let cx = (p[i * 3] * ih) | 0, cy = (p[i * 3 + 1] * ih) | 0, cz = (p[i * 3 + 2] * ih) | 0;
      cx = cx < 0 ? 0 : cx >= gx ? gx - 1 : cx; cy = cy < 0 ? 0 : cy >= gy ? gy - 1 : cy; cz = cz < 0 ? 0 : cz >= gz ? gz - 1 : cz;
      const c = (cz * gy + cy) * gx + cx;
      cell[i] = c; cellStart[c + 1]++;
    }
    for (let c = 0; c < this.ncell; c++) cellStart[c + 1] += cellStart[c];
    cellCur.set(cellStart.subarray(0, this.ncell));
    for (let i = 0; i < n; i++) sorted[cellCur[cell[i]]++] = i;
  }

  // permute particle storage into grid order for cache coherence
  reorder() {
    const n = this.n, o = this.sorted;
    for (const key of ['x', 'v', 'p']) {
      const a = this[key], t = this.tv;
      for (let k = 0; k < n; k++) { const i = o[k]; t[k * 3] = a[i * 3]; t[k * 3 + 1] = a[i * 3 + 1]; t[k * 3 + 2] = a[i * 3 + 2]; }
      a.set(t.subarray(0, n * 3));
    }
    const f = this.foam, t1 = this.lam;
    for (let k = 0; k < n; k++) t1[k] = f[o[k]];
    f.set(t1.subarray(0, n));
    const cc = this.conc;
    for (let k = 0; k < n; k++) t1[k] = cc[o[k]];
    cc.set(t1.subarray(0, n));
  }

  findNeighbors() {
    const { n, p, h2, gx, gy, gz, cell, cellStart, sorted, nb, nbc } = this;
    for (let i = 0; i < n; i++) {
      const c = cell[i];
      const cx = c % gx, cy = ((c / gx) | 0) % gy, cz = (c / (gx * gy)) | 0;
      const xi = p[i * 3], yi = p[i * 3 + 1], zi = p[i * 3 + 2];
      let cnt = 0; const base = i * MAXN;
      const x0 = cx > 0 ? cx - 1 : 0, x1 = cx < gx - 1 ? cx + 1 : cx;
      for (let dz = -1; dz <= 1; dz++) {
        const z = cz + dz; if (z < 0 || z >= gz) continue;
        for (let dy = -1; dy <= 1; dy++) {
          const y = cy + dy; if (y < 0 || y >= gy) continue;
          const row = (z * gy + y) * gx;
          for (let k = cellStart[row + x0], e = cellStart[row + x1 + 1]; k < e; k++) {
            const j = sorted[k]; if (j === i) continue;
            const ex = p[j * 3] - xi, ey = p[j * 3 + 1] - yi, ez = p[j * 3 + 2] - zi;
            if (ex * ex + ey * ey + ez * ez < h2 && cnt < MAXN) nb[base + cnt++] = j;
          }
        }
      }
      nbc[i] = cnt;
    }
  }

  // ---------- step ----------
  stepRigid(dt) {
    const [W, H, D] = this.size;
    const S = this.spheres;
    for (const s of S) {
      if (s.fixed) { s.v[0] = s.v[1] = s.v[2] = 0; continue; }
      s.v[1] += this.gravity * dt;
      for (let k = 0; k < 3; k++) s.c[k] += s.v[k] * dt;
      // walls / solids (excluding spheres)
      const lox = this.piston ? this.piston.x : 0;
      const bounce = (axis, sign, lim) => {
        const pen = sign > 0 ? lim + s.r - s.c[axis] : s.c[axis] + s.r - lim;
        if (pen > 0) {
          s.c[axis] += sign * pen;
          const vn = s.v[axis] * sign;
          if (vn < 0) s.v[axis] -= (1.3) * vn * sign;
          for (let k = 0; k < 3; k++) if (k !== axis) s.v[k] *= 0.98;
        }
      };
      bounce(0, 1, lox); bounce(0, -1, W); bounce(1, 1, 0); bounce(2, 1, 0); bounce(2, -1, D);
      if (this.piston && s.c[0] - s.r < lox + 0.001) s.v[0] = Math.max(s.v[0], this.piston.vx);
      if (this.ramp) {
        const r = this.ramp, inv = 1 / Math.sqrt(1 + r.slope * r.slope), nx = -r.slope * inv, ny = inv;
        const d = (s.c[0] - r.x0) * nx + s.c[1] * ny - s.r;
        if (s.c[0] > r.x0 - 0.2 && d < 0) { s.c[0] -= nx * d; s.c[1] -= ny * d; const vn = s.v[0] * nx + s.v[1] * ny; if (vn < 0) { s.v[0] -= 1.3 * vn * nx; s.v[1] -= 1.3 * vn * ny; } }
      }
      for (const B of this.boxes) {
        const px = s.c[0] - B.c[0], py = s.c[1] - B.c[1], pz = s.c[2] - B.c[2];
        const cx = Math.max(-B.h[0], Math.min(B.h[0], px)), cy = Math.max(-B.h[1], Math.min(B.h[1], py)), cz = Math.max(-B.h[2], Math.min(B.h[2], pz));
        let dx = px - cx, dy = py - cy, dz = pz - cz; let l = Math.hypot(dx, dy, dz);
        if (l < s.r) {
          if (l < 1e-6) { dx = 0; dy = 1; dz = 0; l = 1; s.c[1] = B.c[1] + B.h[1] + s.r; }
          else { const pen = s.r - l; s.c[0] += dx / l * pen; s.c[1] += dy / l * pen; s.c[2] += dz / l * pen; }
          const nx = dx / l, ny = dy / l, nz = dz / l; const vn = s.v[0] * nx + s.v[1] * ny + s.v[2] * nz;
          if (vn < 0) { s.v[0] -= 1.3 * vn * nx; s.v[1] -= 1.3 * vn * ny; s.v[2] -= 1.3 * vn * nz; }
        }
      }
    }
    for (let a = 0; a < S.length; a++) for (let b = a + 1; b < S.length; b++) {
      const A = S[a], B = S[b];
      const dx = B.c[0] - A.c[0], dy = B.c[1] - A.c[1], dz = B.c[2] - A.c[2];
      const l = Math.hypot(dx, dy, dz), pen = A.r + B.r - l;
      if (pen > 0 && l > 1e-6) {
        const nx = dx / l, ny = dy / l, nz = dz / l;
        const ia = A.fixed ? 0 : 1 / A.m, ib = B.fixed ? 0 : 1 / B.m, it = ia + ib; if (it === 0) continue;
        A.c[0] -= nx * pen * ia / it; A.c[1] -= ny * pen * ia / it; A.c[2] -= nz * pen * ia / it;
        B.c[0] += nx * pen * ib / it; B.c[1] += ny * pen * ib / it; B.c[2] += nz * pen * ib / it;
        const vr = (B.v[0] - A.v[0]) * nx + (B.v[1] - A.v[1]) * ny + (B.v[2] - A.v[2]) * nz;
        if (vr < 0) { const j = -1.4 * vr / it; A.v[0] -= j * ia * nx; A.v[1] -= j * ia * ny; A.v[2] -= j * ia * nz; B.v[0] += j * ib * nx; B.v[1] += j * ib * ny; B.v[2] += j * ib * nz; }
      }
    }
  }

  emit(dt) {
    if (this.emitter) this.emitOne(this.emitter, dt);
    for (const e of this.emitters) this.emitOne(e, dt);
  }
  emitOne(e, dt) {
    if (this.time > e.until) return;
    e.acc += e.speed * dt;
    const s = this.s;
    while (e.acc >= s) {
      e.acc -= s;
      // disk perpendicular to dir (dir assumed mostly -y)
      const d = e.dir; let ux = 1, uy = 0, uz = 0;
      if (Math.abs(d[0]) > 0.9) { ux = 0; uz = 1; }
      // u = normalize(cross(d, a)), w = cross(d,u)
      let ax = d[1] * uz - d[2] * uy, ay = d[2] * ux - d[0] * uz, az = d[0] * uy - d[1] * ux;
      let l = Math.hypot(ax, ay, az); ax /= l; ay /= l; az /= l;
      const bx = d[1] * az - d[2] * ay, by = d[2] * ax - d[0] * az, bz = d[0] * ay - d[1] * ax;
      const R = e.radius;
      for (let i = -R; i <= R + 1e-6; i += s) for (let j = -R; j <= R + 1e-6; j += s) {
        if (i * i + j * j > R * R) continue;
        const jit = (Math.random() - 0.5) * s * 0.1;
        const off = e.acc;
        this.addParticle(e.pos[0] + ax * i + bx * j + d[0] * off + jit, e.pos[1] + ay * i + by * j + d[1] * off, e.pos[2] + az * i + bz * j + d[2] * off - jit,
          d[0] * e.speed, d[1] * e.speed, d[2] * e.speed, e.conc || 0);
      }
    }
  }

  step(dt) {
    this.time += dt;
    const invDt = 1 / dt;
    const m = this.mat;
    const mp = this.pmass();
    if (this.piston) {
      const P = this.piston, w = 2 * Math.PI / P.period;
      const nx = 0.02 + P.amp * 0.5 * (1 - Math.cos(w * this.time));
      P.vx = (nx - P.x) * invDt; P.x = nx;
    }
    for (const s of this.spheres) { s.J[0] = s.J[1] = s.J[2] = 0; }
    this.stepRigid(dt);
    this.emit(dt);

    const { n, x, p, v, lam, dp, nb, nbc, rho, foam } = this;
    const h = this.h, h2 = this.h2, K6 = this.K6, KS = this.KS, rho0 = this.rho0, irho0 = 1 / rho0;
    const g = this.gravity * dt;
    // predict
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      v[i3 + 1] += g;
      p[i3] = x[i3] + v[i3] * dt; p[i3 + 1] = x[i3 + 1] + v[i3 + 1] * dt; p[i3 + 2] = x[i3 + 2] + v[i3 + 2] * dt;
      this.collide(i, mp, invDt);
    }
    this.buildGrid();
    if ((this._stepCount = (this._stepCount | 0) + 1) % 8 === 0) { this.reorder(); this.buildGrid(); }
    this.findNeighbors();

    const m2 = this.mat2, conc = this.conc;
    const coh0 = m.cohesion, coh1 = m2.cohesion;
    const sK = 0.0015 / this.denomRef; // tensile instability correction
    const iWdq = 1 / this.Wdq;
    const W0 = K6 * h2 * h2 * h2;
    for (let it = 0; it < this.iters; it++) {
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, xi = p[i3], yi = p[i3 + 1], zi = p[i3 + 2];
        let r_ = W0, gx = 0, gy = 0, gz = 0, s2 = 0;
        const base = i * MAXN, c = nbc[i];
        for (let k = 0; k < c; k++) {
          const j = nb[base + k], j3 = j * 3;
          const dx = xi - p[j3], dy = yi - p[j3 + 1], dz = zi - p[j3 + 2];
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 >= h2) continue;
          const t = h2 - r2; r_ += K6 * t * t * t;
          const r = Math.sqrt(r2);
          if (r > 1e-9) {
            const hr = h - r, cg = -KS * hr * hr / r * irho0;
            const ax = cg * dx, ay = cg * dy, az = cg * dz;
            gx += ax; gy += ay; gz += az; s2 += ax * ax + ay * ay + az * az;
          }
        }
        rho[i] = r_;
        let C = r_ * irho0 - 1;
        if (C < 0) C *= coh0 + (coh1 - coh0) * conc[i];
        lam[i] = -C / (s2 + gx * gx + gy * gy + gz * gz + this.eps);
      }
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, xi = p[i3], yi = p[i3 + 1], zi = p[i3 + 2], li = lam[i];
        let ex = 0, ey = 0, ez = 0;
        const base = i * MAXN, c = nbc[i];
        for (let k = 0; k < c; k++) {
          const j = nb[base + k], j3 = j * 3;
          const dx = xi - p[j3], dy = yi - p[j3 + 1], dz = zi - p[j3 + 2];
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 >= h2) continue;
          const r = Math.sqrt(r2); if (r < 1e-9) continue;
          const t = h2 - r2; const wr = K6 * t * t * t * iWdq; const w2 = wr * wr;
          const corr = -sK * w2 * w2;
          const hr = h - r, cg = -KS * hr * hr / r * irho0 * (li + lam[j] + corr);
          ex += cg * dx; ey += cg * dy; ez += cg * dz;
        }
        dp[i3] = ex; dp[i3 + 1] = ey; dp[i3 + 2] = ez;
      }
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        p[i3] += dp[i3]; p[i3 + 1] += dp[i3 + 1]; p[i3 + 2] += dp[i3 + 2];
        this.collide(i, mp, invDt);
      }
    }

    // velocity update
    const vmax = 0.5 * h * invDt * 3;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      let vx = (p[i3] - x[i3]) * invDt, vy = (p[i3 + 1] - x[i3 + 1]) * invDt, vz = (p[i3 + 2] - x[i3 + 2]) * invDt;
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (sp > vmax) { const f = vmax / sp; vx *= f; vy *= f; vz *= f; }
      v[i3] = vx; v[i3 + 1] = vy; v[i3 + 2] = vz;
    }

    // XSPH viscosity (normalized, Jacobi, repeated for very viscous fluids)
    const tv = this.tv;
    const c0 = m.visc, c1 = m2.visc;
    const nbw = this.nbw;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, xi = p[i3], yi = p[i3 + 1], zi = p[i3 + 2], base = i * MAXN, cn = nbc[i];
      for (let k = 0; k < cn; k++) {
        const j3 = nb[base + k] * 3;
        const dx = xi - p[j3], dy = yi - p[j3 + 1], dz = zi - p[j3 + 2];
        const r2 = dx * dx + dy * dy + dz * dz; const t = h2 - r2;
        nbw[base + k] = t > 0 ? K6 * t * t * t : 0;
      }
    }
    const it0 = m.viscIters, it1 = m2.viscIters, itMax = Math.max(it0, it1);
    if (c0 > 0 || c1 > 0) for (let vi = 0; vi < itMax; vi++) {
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, base = i * MAXN, cn = nbc[i], ci = conc[i];
        // per-particle viscosity from the mixture; low-viscosity particles stop iterating earlier
        const myIt = it0 + (it1 - it0) * ci;
        if (vi >= myIt + 0.5) { tv[i3] = v[i3]; tv[i3 + 1] = v[i3 + 1]; tv[i3 + 2] = v[i3 + 2]; continue; }
        const c = c0 + (c1 - c0) * ci;
        let ax = v[i3] * W0, ay = v[i3 + 1] * W0, az = v[i3 + 2] * W0, ws = W0;
        for (let k = 0; k < cn; k++) {
          const w = nbw[base + k], j3 = nb[base + k] * 3;
          ax += v[j3] * w; ay += v[j3 + 1] * w; az += v[j3 + 2] * w; ws += w;
        }
        const iw = 1 / ws;
        tv[i3] = v[i3] + c * (ax * iw - v[i3]); tv[i3 + 1] = v[i3 + 1] + c * (ay * iw - v[i3 + 1]); tv[i3 + 2] = v[i3 + 2] + c * (az * iw - v[i3 + 2]);
      }
      v.set(tv.subarray(0, n * 3));
    }

    // concentration diffusion -> fluids blend where they touch (milk + chocolate = chocolate milk)
    let csum = 0;
    if (this.mixRate > 0) {
      const lam = this.lam, a = Math.min(1, this.mixRate * dt * 4);
      for (let i = 0; i < n; i++) {
        const base = i * MAXN, cn = nbc[i]; let acc = conc[i] * W0, ws = W0;
        for (let k = 0; k < cn; k++) { const w = nbw[base + k]; acc += conc[nb[base + k]] * w; ws += w; }
        lam[i] = conc[i] + a * (acc / ws - conc[i]);
      }
      for (let i = 0; i < n; i++) { conc[i] = lam[i]; csum += lam[i]; }
    } else for (let i = 0; i < n; i++) csum += conc[i];
    this.avgConc = n ? csum / n : 0;
    if (this._stepCount % 8 === 0) { // drying
      const wet = this.wet, da = m.dry * dt * 8, db = m2.dry * dt * 8;
      for (let k = 0; k < wet.length; k += 2) { wet[k] = Math.max(0, wet[k] - da); wet[k + 1] = Math.max(0, wet[k + 1] - db); }
    }

    // adhesion + friction against solids, yield stress, foam
    const adhR = this.s * 1.6;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, ci = conc[i];
      const adh = m.adhesion + (m2.adhesion - m.adhesion) * ci, fr = m.friction + (m2.friction - m.friction) * ci;
      const yv = m.yieldV + (m2.yieldV - m.yieldV) * ci, foamK = m.foam + (m2.foam - m.foam) * ci;
      const d = this.solidDist(p[i3], p[i3 + 1], p[i3 + 2]);
      if (d < adhR) {
        const nx = this._nx, ny = this._ny, nz = this._nz;
        const svx = this._svx, svy = this._svy, svz = this._svz;
        let rx = v[i3] - svx, ry = v[i3 + 1] - svy, rz = v[i3 + 2] - svz;
        let vn = rx * nx + ry * ny + rz * nz;
        const tx = rx - vn * nx, ty = ry - vn * ny, tz = rz - vn * nz;
        const fall = 1 - Math.max(0, d - this.pr) / (adhR - this.pr);
        // adhesion: pull toward surface; resists detaching
        vn -= adh * fall * dt * 4;
        if (vn < -0.5 && d <= this.pr * 1.05) vn = Math.max(vn, 0); // don't push into solid
        const kf = 1 - fr * fall;
        const nvx = svx + tx * kf + vn * nx, nvy = svy + ty * kf + vn * ny, nvz = svz + tz * kf + vn * nz;
        const sid = this._sid;
        if (sid >= 0) {
          const S = this.spheres[sid];
          if (!S.fixed) { S.J[0] -= (nvx - v[i3]) * mp * 0.15; S.J[1] -= (nvy - v[i3 + 1]) * mp * 0.15; S.J[2] -= (nvz - v[i3 + 2]) * mp * 0.15; }
        }
        v[i3] = nvx; v[i3 + 1] = nvy; v[i3 + 2] = nvz;
        if (sid < 0) { // static surfaces get wet / stained
          const wc = this.cell[i] * 2, wet = this.wet;
          const a = 1 - ci; if (wet[wc] < a) wet[wc] = a; if (wet[wc + 1] < ci) wet[wc + 1] = ci;
        }
      }
      if (yv > 0) {
        const sp2 = v[i3] * v[i3] + v[i3 + 1] * v[i3 + 1] + v[i3 + 2] * v[i3 + 2];
        if (sp2 < yv * yv && nbc[i] > 12) { v[i3] *= 0.6; v[i3 + 1] *= 0.6; v[i3 + 2] *= 0.6; }
      }
      // whitewater: fast + under-dense particles become foam/spray
      if (foamK > 0) {
        const sp = Math.sqrt(v[i3] * v[i3] + v[i3 + 1] * v[i3 + 1] + v[i3 + 2] * v[i3 + 2]);
        const deficit = Math.max(0, 1 - rho[i] * irho0 * 1.15);
        foam[i] = Math.min(1, foam[i] * 0.985 + foamK * Math.max(0, sp - 0.9) * (0.25 * deficit + 0.02) * dt * 30);
      } else foam[i] *= 0.9;
      x[i3] = p[i3]; x[i3 + 1] = p[i3 + 1]; x[i3 + 2] = p[i3 + 2];
    }

    // fluid -> rigid body: buoyancy from estimated submerged volume + viscous drag toward local flow
    const shell = this.h;
    for (const S of this.spheres) {
      if (S.fixed) continue;
      const R = S.r, Ro = R + shell, Ro2 = Ro * Ro;
      let cnt = 0, fvx = 0, fvy = 0, fvz = 0;
      const cx = S.c[0], cy = S.c[1], cz = S.c[2];
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, dx = x[i3] - cx, dy = x[i3 + 1] - cy, dz = x[i3 + 2] - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < Ro2) { cnt++; fvx += v[i3]; fvy += v[i3 + 1]; fvz += v[i3 + 2]; }
      }
      const expected = (4 / 3) * Math.PI * (Ro * Ro * Ro - R * R * R) / (this.s * this.s * this.s);
      const frac = Math.min(1, cnt / expected * 1.1);
      const Vs = (4 / 3) * Math.PI * R * R * R;
      const im = 1 / S.m;
      // buoyancy
      const ac = this.avgConc, mden = m.density * (1 - ac) + m2.density * ac, mvis = m.visc * (1 - ac) + m2.visc * ac;
      S.v[1] += mden * Vs * frac * -this.gravity * im * dt;
      if (cnt > 0) {
        fvx /= cnt; fvy /= cnt; fvz /= cnt;
        const k = (3 + 60 * mvis * mvis) * frac * Math.min(1, 1500 / S.density + 0.2);
        const a = 1 - Math.exp(-k * dt);
        S.v[0] += (fvx - S.v[0]) * a; S.v[1] += (fvy - S.v[1]) * a; S.v[2] += (fvz - S.v[2]) * a;
      }
      let dvx = S.J[0] * im, dvy = S.J[1] * im, dvz = S.J[2] * im;
      const l = Math.hypot(dvx, dvy, dvz), lim = 20 * dt;
      if (l > lim) { dvx *= lim / l; dvy *= lim / l; dvz *= lim / l; }
      S.v[0] += dvx; S.v[1] += dvy; S.v[2] += dvz;
    }
    for (const s of this.spheres) {
      if (s.fixed) continue;
      // visual rolling: spin from velocity along floor
      s.w[0] = s.v[2] / s.r * 0.5; s.w[2] = -s.v[0] / s.r * 0.5; s.w[1] *= 0.98;
      const wl = Math.hypot(...s.w);
      if (wl > 1e-5) {
        const ang = wl * dt, ax = s.w[0] / wl, ay = s.w[1] / wl, az = s.w[2] / wl, sn = Math.sin(ang / 2);
        const q = [Math.cos(ang / 2), ax * sn, ay * sn, az * sn], r = s.rot;
        s.rot = [q[0] * r[0] - q[1] * r[1] - q[2] * r[2] - q[3] * r[3], q[0] * r[1] + q[1] * r[0] + q[2] * r[3] - q[3] * r[2], q[0] * r[2] - q[1] * r[3] + q[2] * r[0] + q[3] * r[1], q[0] * r[3] + q[1] * r[2] - q[2] * r[1] + q[3] * r[0]];
        const ql = Math.hypot(...s.rot); s.rot = s.rot.map(e => e / ql);
      }
    }
  }
}
