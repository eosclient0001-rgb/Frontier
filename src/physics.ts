import { ImplicitViscosity } from './viscosity';
import { BoundarySamples, type SphereObstacle } from './boundaries';
import { SurfaceTension } from './surface-tension';
import { apparentViscosity, invertMoment, strainRate } from './rheology';

export type MaterialKey = 'water' | 'milk' | 'honey' | 'chocolate';
export interface FluidMaterial {
  name: string; subtitle: string; color: string; absorption: [number, number, number];
  temperature: number; activationTemperature: number; shearThinning: number; wetting: number;
  viscosity: number; cohesion: number; vorticity: number; opacity: number; roughness: number; ior: number;
}
export const materials: Record<MaterialKey, FluidMaterial> = {
  water: { name: 'Water', temperature: 20, activationTemperature: 1800, shearThinning: 0, wetting: .45, subtitle: 'Clear & weightless', color: '#84d7cf', absorption: [.85, .2, .12], viscosity: .018, cohesion: .018, vorticity: .06, opacity: .01, roughness: .09, ior: 1.333 },
  milk: { name: 'Milk', temperature: 20, activationTemperature: 2200, shearThinning: .08, wetting: .55, subtitle: 'Soft & silky', color: '#f1e7cf', absorption: [.2, .25, .4], viscosity: .09, cohesion: .03, vorticity: .025, opacity: .96, roughness: .28, ior: 1.35 },
  honey: { name: 'Honey', temperature: 25, activationTemperature: 6500, shearThinning: 0, wetting: .85, subtitle: 'Golden & viscous', color: '#e3a229', absorption: [.18, 1.6, 5.8], viscosity: .78, cohesion: .08, vorticity: 0, opacity: .08, roughness: .18, ior: 1.49 },
  chocolate: { name: 'Chocolate', temperature: 40, activationTemperature: 5000, shearThinning: .8, wetting: .7, subtitle: 'Rich & velvety', color: '#603320', absorption: [2.1, 4.5, 6.5], viscosity: .58, cohesion: .07, vorticity: 0, opacity: .97, roughness: .24, ior: 1.46 },
};

/** Position-based incompressible fluid, 3-D spatial hash, poly6 density and spiky gradients.
 * Browser-scale approximation; coefficients are artistic, not calibrated rheology.
 */
export class FluidSolver {
  readonly maxParticles = 2800;
  readonly positions = new Float32Array(this.maxParticles * 3);
  readonly velocities = new Float32Array(this.maxParticles * 3);
  readonly viscositySolver = new ImplicitViscosity(this.maxParticles);
  private curls = new Float32Array(this.maxParticles * 3);
  private curlMagnitude = new Float32Array(this.maxParticles);
  revision = 0;
  implicitViscosity = true;
  vorticity = materials.water.vorticity;
  private previous = new Float32Array(this.maxParticles * 3);
  private corrections = new Float32Array(this.maxParticles * 3);
  private lambda = new Float32Array(this.maxParticles);
  private heads = new Int32Array(32 * 32 * 32);
  private next = new Int32Array(this.maxParticles);
  readonly neighborStride = 128;
  private neighbors = new Int32Array(this.maxParticles * this.neighborStride);
  readonly density = new Float32Array(this.maxParticles);
  readonly shearRates = new Float32Array(this.maxParticles);
  readonly apparentViscosities = new Float32Array(this.maxParticles);
  readonly surface = new SurfaceTension(this.maxParticles);
  readonly boundaries = new BoundarySamples(this.maxParticles, .31, 265);
  boundarySupport = true;
  pressureQuality: 'fast' | 'balanced' | 'precise' = 'balanced';
  temperature = materials.water.temperature;
  shearThinning = materials.water.shearThinning;
  wetting = materials.water.wetting;
  scene: 'basin' | 'droplet' = 'basin';
  readonly obstacle: SphereObstacle = { enabled: false, x: .65, y: .65, z: 0, radius: .34 };
  readonly pressure = { beforeMean: 0, beforePeak: 0, mean: 0, peak: 0, iterations: 0, converged: false, overflow: 0 };
  readonly rheology = { meanShear: 0, meanViscosity: 0, minViscosity: 0, maxViscosity: 0 };
  private boundaryGradient = new Float64Array(this.maxParticles * 3);
  private gradient = new Float64Array(9);
  private moment = new Float64Array(9);
  private inverseMoment = new Float64Array(9);
  private crossMoment = new Float64Array(9);
  private fluidOverflow = 0;
  private counts = new Uint8Array(this.maxParticles);
  count = 0;
  material: MaterialKey = 'water';
  viscosity = materials.water.viscosity;
  cohesion = materials.water.cohesion;
  gravity = 9.81;
  time = 0;
  bounds = { x: 1.95, z: 1.25, floor: .19, ceiling: 3.7 };
  private h = .31;
  private restDensity = 265;
  private emission = 0;
  private poly = 315 / (64 * Math.PI * Math.pow(.31, 9));
  private spiky = -45 / (Math.PI * Math.pow(.31, 6));

  constructor() { this.boundaries.rebuild(this.bounds, this.obstacle); this.reset(); }
  setMaterial(key: MaterialKey) {
    this.material = key;
    this.viscosity = materials[key].viscosity;
    this.cohesion = materials[key].cohesion;
    this.vorticity = materials[key].vorticity;
    this.temperature = materials[key].temperature; this.shearThinning = materials[key].shearThinning; this.wetting = materials[key].wetting;
  }
  setObstacle(enabled: boolean) {
    this.obstacle.enabled = enabled;
    this.boundaries.rebuild(this.bounds, this.obstacle);
    for (let i = 0; i < this.count; i++) this.collide(i * 3);
    this.revision++;
  }
  reset(scene = this.scene) {
    this.scene = scene;
    this.revision++; this.viscositySolver.clear();
    this.count = 0; this.time = 0; this.emission = 0; this.velocities.fill(0);
    Object.assign(this.pressure, { beforeMean: 0, beforePeak: 0, mean: 0, peak: 0, iterations: 0, converged: false, overflow: 0 });
    Object.assign(this.rheology, { meanShear: 0, meanViscosity: 0, minViscosity: 0, maxViscosity: 0 });
    this.positions.fill(0); this.density.fill(0); this.shearRates.fill(0); this.apparentViscosities.fill(0);
    if (scene === 'droplet') {
      for (let x = -4; x <= 4; x++) for (let y = -3; y <= 3; y++) for (let z = -4; z <= 4; z++) {
        if ((x * .157 / .72) ** 2 + (y * .157 / .48) ** 2 + (z * .157 / .63) ** 2 < 1) this.add(x * .157, 1 + y * .157, z * .157, 0, 0, 0);
      }
      this.updateNeighbors(); this.computeDensity(false); this.updateRheology();
      return;
    }
    // A small initial wave avoids an artificially motionless, perfect lattice.
    for (let y = 0; y < 4; y++) for (let x = 0; x < 24; x++) for (let z = 0; z < 15; z++) {
      const px = (x - 11.5) * .157;
      this.add(px, .22 + y * .157 + .07 * Math.sin(px * 1.8), (z - 7) * .157, 0, 0, 0);
    }
    // Relax the seeded lattice against solid density at rest. Otherwise the first
    // frame turns initialization overlap into a large, nonphysical velocity impulse.
    const quality = this.pressureQuality;
    this.pressureQuality = 'precise';
    this.solvePressure();
    this.pressureQuality = quality;
    this.velocities.fill(0); this.updateRheology();
  }
  private add(x: number, y: number, z: number, vx: number, vy: number, vz: number) {
    if (this.count >= this.maxParticles) return;
    this.revision++;
    const i = this.count++ * 3;
    this.positions.set([x, Math.max(this.bounds.floor, y), z], i);
    this.velocities.set([vx, vy, vz], i);
    this.collide(i);
  }
  pour(dt: number, rate: number) {
    this.emission += dt * rate * 120;
    while (this.emission >= 1 && this.count < this.maxParticles) {
      this.emission--;
      const a = this.time * 23 + this.count * 2.39996;
      const r = .12 * Math.sqrt((this.count % 11) / 10);
      this.add(-.65 + Math.cos(a) * r, 2.55, -.15 + Math.sin(a) * r, .08, -4.1, 0);
    }
    this.emission = Math.min(this.emission, 1);
  }
  stir(strength = 2.5, centerX = 0, centerZ = 0) {
    for (let i = 0; i < this.count; i++) {
      const k = i * 3, x = this.positions[k] - centerX, z = this.positions[k + 2] - centerZ;
      const f = Math.exp(-(x * x + z * z) * .6) * strength;
      this.velocities[k] += -z * f;
      this.velocities[k + 2] += x * f;
      this.velocities[k + 1] += f * .38;
    }
  }
  private hash() {
    this.heads.fill(-1); this.fluidOverflow = 0;
    const p = this.positions, h = this.h;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      const x = Math.max(1, Math.min(30, Math.floor((p[k] + 3) / h)));
      const y = Math.max(1, Math.min(30, Math.floor((p[k + 1] + 1) / h)));
      const z = Math.max(1, Math.min(30, Math.floor((p[k + 2] + 3) / h)));
      const cell = x + y * 32 + z * 1024;
      this.next[i] = this.heads[cell]; this.heads[cell] = i;
    }
    for (let i = 0; i < this.count; i++) {
      const k = i * 3, x = Math.floor((p[k] + 3) / h), y = Math.floor((p[k + 1] + 1) / h), z = Math.floor((p[k + 2] + 3) / h);
      let n = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        let j = this.heads[x + dx + (y + dy) * 32 + (z + dz) * 1024];
        while (j >= 0) {
          const t = j * 3, rx = p[k] - p[t], ry = p[k + 1] - p[t + 1], rz = p[k + 2] - p[t + 2];
          if (rx * rx + ry * ry + rz * rz < h * h) {
            if (n < this.neighborStride) this.neighbors[i * this.neighborStride + n++] = j;
            else this.fluidOverflow++;
          }
          j = this.next[j];
        }
      }
      this.counts[i] = n;
    }
  }
  private updateNeighbors() {
    this.hash(); this.boundaries.findNeighbors(this.positions, this.count);
  }

  /** Measured positive density error; underdensity at a free surface is not compression. */
  measureCompression(refresh = true) {
    if (refresh) this.updateNeighbors();
    this.computeDensity(false);
    return { mean: this.pressure.mean, peak: this.pressure.peak };
  }

  private computeDensity(lambdas: boolean) {
    const p = this.positions, h2 = this.h * this.h, boundary = this.boundaries;
    const gradFactor = -6 * this.poly / this.restDensity;
    let total = 0, peak = 0;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      let density = 0, gx = 0, gy = 0, gz = 0, grad2 = 0;
      for (let n = 0; n < this.counts[i]; n++) {
        const j = this.neighbors[i * this.neighborStride + n] * 3;
        const x = p[k] - p[j], y = p[k + 1] - p[j + 1], z = p[k + 2] - p[j + 2], r2 = x * x + y * y + z * z;
        if (r2 >= h2) continue;
        const q = h2 - r2;
        density += this.poly * q * q * q;
        if (lambdas) {
          // Exact derivative of the density kernel, including the boundary term below.
          const g = gradFactor * q * q, dx = x * g, dy = y * g, dz = z * g;
          gx += dx; gy += dy; gz += dz; grad2 += dx * dx + dy * dy + dz * dz;
        }
      }
      let bx = 0, by = 0, bz = 0;
      if (this.boundarySupport) for (let n = 0; n < boundary.counts[i]; n++) {
        const b = boundary.neighbors[i * boundary.stride + n], j = b * 3;
        const x = p[k] - boundary.positions[j], y = p[k + 1] - boundary.positions[j + 1], z = p[k + 2] - boundary.positions[j + 2], r2 = x * x + y * y + z * z;
        if (r2 >= h2) continue;
        const q = h2 - r2, mass = boundary.masses[b];
        density += mass * this.poly * q * q * q;
        if (lambdas) { const g = mass * gradFactor * q * q; bx += x * g; by += y * g; bz += z * g; }
      }
      this.density[i] = density;
      const compression = Math.max(0, density / this.restDensity - 1);
      total += compression; peak = Math.max(peak, compression);
      if (lambdas) {
        gx += bx; gy += by; gz += bz;
        this.boundaryGradient[k] = bx; this.boundaryGradient[k + 1] = by; this.boundaryGradient[k + 2] = bz;
        // Boundary samples are fixed: their derivatives belong to grad_i, not free DOFs.
        this.lambda[i] = -.65 * compression / (grad2 + gx * gx + gy * gy + gz * gz + 1e-5);
      }
    }
    this.pressure.mean = total / Math.max(1, this.count); this.pressure.peak = peak;
  }

  /** Adaptive-budget PBF projection, not a DFSPH or pressure-Poisson solver. */
  solvePressure() {
    this.updateNeighbors(); this.computeDensity(false);
    this.pressure.beforeMean = this.pressure.mean; this.pressure.beforePeak = this.pressure.peak;
    const budget = this.pressureQuality === 'precise' ? 12 : this.pressureQuality === 'fast' ? 3 : 6;
    const tolerance = this.pressureQuality === 'precise' ? .01 : this.pressureQuality === 'fast' ? .06 : .03;
    const p = this.positions, h2 = this.h * this.h, g0 = -6 * this.poly / this.restDensity;
    this.pressure.iterations = 0;
    for (let iteration = 0; iteration < budget; iteration++) {
      if (iteration > 0 && iteration % 2 === 0) this.updateNeighbors();
      this.computeDensity(true);
      if (iteration >= 2 && this.pressure.peak <= tolerance) break;
      for (let i = 0; i < this.count; i++) {
        const k = i * 3;
        let dx = this.lambda[i] * this.boundaryGradient[k], dy = this.lambda[i] * this.boundaryGradient[k + 1], dz = this.lambda[i] * this.boundaryGradient[k + 2];
        for (let n = 0; n < this.counts[i]; n++) {
          const ji = this.neighbors[i * this.neighborStride + n], j = ji * 3;
          if (ji === i) continue;
          const x = p[k] - p[j], y = p[k + 1] - p[j + 1], z = p[k + 2] - p[j + 2], r2 = x * x + y * y + z * z;
          if (r2 >= h2) continue;
          const f = (this.lambda[i] + this.lambda[ji]) * g0 * (h2 - r2) ** 2;
          dx += x * f; dy += y * f; dz += z * f;
        }
        const limit = Math.min(1, .035 / Math.max(1e-12, Math.hypot(dx, dy, dz)));
        this.corrections[k] = dx * limit; this.corrections[k + 1] = dy * limit; this.corrections[k + 2] = dz * limit;
      }
      for (let i = 0; i < this.count; i++) {
        const k = i * 3;
        p[k] += this.corrections[k]; p[k + 1] += this.corrections[k + 1]; p[k + 2] += this.corrections[k + 2];
        this.collide(k);
      }
      this.pressure.iterations++;
    }
    // Report the final state on a fresh graph, not the last iteration's stale estimate.
    this.updateNeighbors(); this.computeDensity(false);
    this.pressure.overflow = this.fluidOverflow + this.boundaries.overflow;
    this.pressure.converged = this.pressure.peak <= tolerance && this.pressure.overflow === 0;
  }

  step(dt: number) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Timestep must be finite and non-negative');
    if (dt === 0) return;
    this.revision++;
    dt = Math.min(dt, 1 / 45); this.time += dt;
    const p = this.positions, v = this.velocities, prev = this.previous;
    this.updateNeighbors(); this.computeDensity(false);
    this.surface.evaluate(p, this.count, this.neighbors, this.counts, this.neighborStride, this.density,
      this.h, this.restDensity, this.cohesion * 8, this.wetting, this.boundaries);
    prev.set(p.subarray(0, this.count * 3));
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      v[k + 1] -= this.gravity * dt;
      for (let axis = 0; axis < 3; axis++) { v[k + axis] += this.surface.acceleration[k + axis] * dt; p[k + axis] += v[k + axis] * dt; }
      this.collide(k);
    }
    this.solvePressure();
    for (let i = 0; i < this.count * 3; i++) v[i] = (p[i] - prev[i]) / dt;
    this.updateRheology();
    this.applyVelocityEffects(dt);
  }

  /** Weighted least-squares local grad(v). A full-rank linear field is reproduced exactly. */
  updateRheology() {
    const p = this.positions, v = this.velocities, h2 = this.h * this.h;
    const m = this.moment, b = this.crossMoment, inverse = this.inverseMoment, g = this.gradient;
    let shearSum = 0, nuSum = 0, minimum = Infinity, maximum = 0;
    const material = materials[this.material];
    const parameters = { baseViscosity: this.viscosity, temperature: this.temperature, referenceTemperature: material.temperature, activationTemperature: material.activationTemperature, shearThinning: this.shearThinning };
    for (let i = 0; i < this.count; i++) {
      const k = i * 3; m.fill(0); b.fill(0); g.fill(0);
      for (let n = 0; n < this.counts[i]; n++) {
        const j = this.neighbors[i * this.neighborStride + n] * 3;
        const x = p[j] - p[k], y = p[j + 1] - p[k + 1], z = p[j + 2] - p[k + 2], r2 = x * x + y * y + z * z;
        if (r2 >= h2 || r2 < 1e-10) continue;
        const w = (1 - r2 / h2) ** 3, vx = v[j] - v[k], vy = v[j + 1] - v[k + 1], vz = v[j + 2] - v[k + 2];
        m[0] += w*x*x; m[1] += w*x*y; m[2] += w*x*z; m[4] += w*y*y; m[5] += w*y*z; m[8] += w*z*z;
        b[0] += w*vx*x; b[1] += w*vx*y; b[2] += w*vx*z;
        b[3] += w*vy*x; b[4] += w*vy*y; b[5] += w*vy*z;
        b[6] += w*vz*x; b[7] += w*vz*y; b[8] += w*vz*z;
      }
      m[3] = m[1]; m[6] = m[2]; m[7] = m[5];
      if (invertMoment(m, inverse)) for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
        g[row*3+col] = b[row*3]*inverse[col] + b[row*3+1]*inverse[3+col] + b[row*3+2]*inverse[6+col];
      }
      // Sparse neighborhoods conservatively fall back to zero shear, not noisy huge rates.
      const shear = Math.min(250, strainRate(g)), nu = apparentViscosity(shear, parameters);
      this.shearRates[i] = shear; this.apparentViscosities[i] = nu;
      shearSum += shear; nuSum += nu; minimum = Math.min(minimum, nu); maximum = Math.max(maximum, nu);
    }
    this.rheology.meanShear = shearSum / Math.max(1, this.count); this.rheology.meanViscosity = nuSum / Math.max(1, this.count);
    this.rheology.minViscosity = this.count ? minimum : 0; this.rheology.maxViscosity = maximum;
  }

  private applyVelocityEffects(dt: number) {
    const p = this.positions, v = this.velocities, h = this.h, h2 = h * h;
    const implicit = this.viscositySolver;
    implicit.clear();
    // A dimensionless artistic knob maps to an effective kinematic coefficient.
    // Constant reference density keeps the pair matrix symmetric positive definite.

    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      const nu = this.apparentViscosities[i];
      let dx = 0, dy = 0, dz = 0, wx = 0, wy = 0, wz = 0;
      for (let n = 0; n < this.counts[i]; n++) {
        const ji = this.neighbors[i * this.neighborStride + n], j = ji * 3;
        if (ji === i) continue;
        const x = p[j] - p[k], y = p[j + 1] - p[k + 1], z = p[j + 2] - p[k + 2];
        const r2 = x * x + y * y + z * z;
        if (r2 >= h2 || r2 < 1e-10) continue;
        const w = this.poly * (h2 - r2) ** 3 / this.restDensity;
        const vx = v[j] - v[k], vy = v[j + 1] - v[k + 1], vz = v[j + 2] - v[k + 2];
        if (!this.implicitViscosity) { dx += vx * w; dy += vy * w; dz += vz * w; }
        const r = Math.sqrt(r2), gradient = -this.spiky * (h - r) ** 2 / (this.restDensity * r);
        if (this.vorticity > 0) {
          wx += (y * vz - z * vy) * gradient;
          wy += (z * vx - x * vz) * gradient;
          wz += (x * vy - y * vx) * gradient;
        }
        if (this.implicitViscosity && nu > 0 && ji > i) {
          const other = this.apparentViscosities[ji], pairNu = (nu + other) > 0 ? 2 * nu * other / (nu + other) : 0;
          const coefficient = dt * 10 * pairNu * gradient * r2 / (r2 + .01 * h2);
          implicit.addPair(i, ji, x / r, y / r, z / r, coefficient);
        }
      }
      if (this.implicitViscosity && nu > 0) {
        const boundary = this.boundaries;
        for (let n = 0; n < boundary.counts[i]; n++) {
          const bi = boundary.neighbors[i * boundary.stride + n], j = bi * 3;
          const x = p[k] - boundary.positions[j], y = p[k+1] - boundary.positions[j+1], z = p[k+2] - boundary.positions[j+2], r2 = x*x+y*y+z*z;
          if (r2 >= h2 || r2 < 1e-10) continue;
          const r = Math.sqrt(r2), gradient = -this.spiky * (h-r)**2 / (this.restDensity*r);
          const weight = dt * 10 * nu * boundary.masses[bi] * gradient * r2 / (r2 + .01*h2);
          implicit.addBoundaryPair(i, x/r, y/r, z/r, weight);
        }
      }
      const visc = Math.min(.85, Math.sqrt(2 * nu) * dt * 60);
      this.corrections[k] = dx * visc;
      this.corrections[k + 1] = dy * visc;
      this.corrections[k + 2] = dz * visc;
      this.curls[k] = wx; this.curls[k + 1] = wy; this.curls[k + 2] = wz;
      this.curlMagnitude[i] = Math.sqrt(wx * wx + wy * wy + wz * wz);
    }
    if (this.vorticity > 0) {
      for (let i = 0; i < this.count; i++) {
        const k = i * 3;
        let nx = 0, ny = 0, nz = 0;
        for (let n = 0; n < this.counts[i]; n++) {
          const ji = this.neighbors[i * this.neighborStride + n], j = ji * 3;
          const x = p[j] - p[k], y = p[j + 1] - p[k + 1], z = p[j + 2] - p[k + 2];
          const r2 = x * x + y * y + z * z;
          if (r2 >= h2 || r2 < 1e-10) continue;
          const r = Math.sqrt(r2);
          const gradient = -this.spiky * (h - r) ** 2 / (this.restDensity * r);
          const f = (this.curlMagnitude[ji] - this.curlMagnitude[i]) * gradient;
          nx += x * f; ny += y * f; nz += z * f;
        }
        const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (length < 1e-8) continue;
        const strength = this.vorticity * dt / length;
        const wx = this.curls[k], wy = this.curls[k + 1], wz = this.curls[k + 2];
        let ax = (ny * wz - nz * wy) * strength, ay = (nz * wx - nx * wz) * strength, az = (nx * wy - ny * wx) * strength;
        // Confinement intentionally restores energy; cap acceleration to prevent runaway.
        const cap = Math.min(1, (2 * dt) / Math.max(1e-8, Math.hypot(ax, ay, az)));
        ax *= cap; ay *= cap; az *= cap;
        this.corrections[k] += ax; this.corrections[k + 1] += ay; this.corrections[k + 2] += az;
      }
    }
    for (let i = 0; i < this.count * 3; i++) v[i] += this.corrections[i];
    if (this.implicitViscosity) implicit.solve(v, this.count);
    // No global drag: uniform translation and rotation are not viscosity.
    for (let i = 0; i < this.count * 3; i++) v[i] = Math.max(-12, Math.min(12, v[i]));
  }

  private collide(k: number) {
    const p = this.positions, b = this.bounds;
    p[k] = Math.max(-b.x, Math.min(b.x, p[k]));
    p[k + 1] = Math.max(b.floor, Math.min(b.ceiling, p[k + 1]));
    p[k + 2] = Math.max(-b.z, Math.min(b.z, p[k + 2]));
    const o = this.obstacle;
    if (o.enabled) {
      const x = p[k] - o.x, y = p[k+1] - o.y, z = p[k+2] - o.z, distance = Math.hypot(x,y,z), radius = o.radius + this.boundaries.clearance;
      if (distance < radius) {
        if (distance < 1e-9) { p[k+1] = o.y + radius; }
        else { const scale = (radius + 1e-6) / distance; p[k] = o.x+x*scale; p[k+1] = o.y+y*scale; p[k+2] = o.z+z*scale; }
      }
    }
  }
}
