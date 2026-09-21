/** CPU, matrix-free implicit radial SPH viscosity.
 * Adapted from Weiler et al. (2018), eqs. 7–10: backward Euler and
 * symmetric pairwise velocity projections. Constant density, equal masses,
 * diagonal (not block) Jacobi preconditioning; no DFSPH stage.
 * v0.3 adds symmetric rank-one stationary boundary-sample contributions.
 * The UI coefficient is dimensionless, NOT a measured dynamic viscosity.
 */
export class ImplicitViscosity {
  readonly a: Uint16Array;
  readonly b: Uint16Array;
  readonly directions: Float64Array;
  readonly weights: Float64Array;
  edgeCount = 0;
  iterations = 0;
  relativeResidual = 0;
  private x: Float64Array;
  private residual: Float64Array;
  private direction: Float64Array;
  private product: Float64Array;
  private preconditioner: Float64Array;
  private z: Float64Array;
  private boundaryDiagonal: Float64Array;
  private boundaryBlocks: Float64Array;

  constructor(maxParticles: number, maxEdges = maxParticles * 100) {
    this.a = new Uint16Array(maxEdges); this.b = new Uint16Array(maxEdges);
    this.directions = new Float64Array(maxEdges * 3); this.weights = new Float64Array(maxEdges);
    this.x = new Float64Array(maxParticles * 3);
    this.residual = new Float64Array(maxParticles * 3);
    this.direction = new Float64Array(maxParticles * 3);
    this.product = new Float64Array(maxParticles * 3);
    this.preconditioner = new Float64Array(maxParticles * 3);
    this.z = new Float64Array(maxParticles * 3);
    this.boundaryDiagonal = new Float64Array(maxParticles * 3);
    this.boundaryBlocks = new Float64Array(maxParticles * 6);
  }

  clear() { this.edgeCount = 0; this.iterations = 0; this.relativeResidual = 0; this.boundaryDiagonal.fill(0); this.boundaryBlocks.fill(0); }

  /** weight already includes dt and the kinematic-viscosity approximation. */
  addPair(i: number, j: number, nx: number, ny: number, nz: number, weight: number) {
    if (this.edgeCount >= this.weights.length) throw new RangeError('Viscosity edge capacity exceeded');
    const e = this.edgeCount++, k = e * 3;
    this.a[e] = i; this.b[e] = j; this.weights[e] = weight;
    this.directions[k] = nx; this.directions[k + 1] = ny; this.directions[k + 2] = nz;
  }

  /** Approximate stationary-wall drag on tangential velocity, not SPH ghost particles. */
  addWallDrag(particle: number, normalAxis: number, coefficient: number) {
    for (let axis = 0; axis < 3; axis++) if (axis !== normalAxis) this.boundaryDiagonal[particle * 3 + axis] += coefficient;
  }

  /** Stationary sampled solid: a positive rank-one contribution to the fluid block. */
  addBoundaryPair(particle: number, x: number, y: number, z: number, weight: number) {
    const k = particle * 6, b = this.boundaryBlocks;
    b[k] += weight*x*x; b[k+1] += weight*x*y; b[k+2] += weight*x*z;
    b[k+3] += weight*y*y; b[k+4] += weight*y*z; b[k+5] += weight*z*z;
  }

  private multiply(input: Float64Array, output: Float64Array, size: number) {
    for (let k = 0; k < size; k++) output[k] = input[k] * (1 + this.boundaryDiagonal[k]);
    for (let i = 0; i < size/3; i++) {
      const k = i*3, t = i*6, b = this.boundaryBlocks, x = input[k], y = input[k+1], z = input[k+2];
      output[k] += b[t]*x+b[t+1]*y+b[t+2]*z;
      output[k+1] += b[t+1]*x+b[t+3]*y+b[t+4]*z;
      output[k+2] += b[t+2]*x+b[t+4]*y+b[t+5]*z;
    }
    for (let e = 0; e < this.edgeCount; e++) {
      const i = this.a[e] * 3, j = this.b[e] * 3, k = e * 3;
      const nx = this.directions[k], ny = this.directions[k + 1], nz = this.directions[k + 2];
      const f = this.weights[e] * ((input[i] - input[j]) * nx + (input[i + 1] - input[j + 1]) * ny + (input[i + 2] - input[j + 2]) * nz);
      output[i] += nx * f; output[j] -= nx * f;
      output[i + 1] += ny * f; output[j + 1] -= ny * f;
      output[i + 2] += nz * f; output[j + 2] -= nz * f;
    }
  }

  solve(velocity: Float32Array, count: number, maxIterations = 18, tolerance = 1e-5) {
    this.iterations = 0; this.relativeResidual = 0;
    if (!count) return;
    const size = count * 3, x = this.x, r = this.residual, p = this.direction, ap = this.product, diagonal = this.preconditioner, z = this.z;
    x.set(velocity.subarray(0, size));
    for (let k = 0; k < size; k++) diagonal[k] = 1 + this.boundaryDiagonal[k];
    for (let e = 0; e < this.edgeCount; e++) {
      const i = this.a[e] * 3, j = this.b[e] * 3;
      for (let axis = 0; axis < 3; axis++) {
        const n = this.directions[e * 3 + axis], d = this.weights[e] * n * n;
        diagonal[i + axis] += d; diagonal[j + axis] += d;
      }
    }
    for (let i = 0; i < count; i++) {
      diagonal[i*3] += this.boundaryBlocks[i*6]; diagonal[i*3+1] += this.boundaryBlocks[i*6+3]; diagonal[i*3+2] += this.boundaryBlocks[i*6+5];
    }
    this.multiply(x, ap, size);
    let rhsNorm = 0, rz = 0, residualNorm = 0;
    for (let k = 0; k < size; k++) {
      r[k] = velocity[k] - ap[k]; z[k] = r[k] / diagonal[k]; p[k] = z[k];
      rz += r[k] * z[k]; rhsNorm += velocity[k] * velocity[k]; residualNorm += r[k] * r[k];
    }
    const threshold = tolerance * tolerance * Math.max(rhsNorm, 1e-16);
    for (let iteration = 0; iteration < maxIterations && residualNorm > threshold; iteration++) {
      this.multiply(p, ap, size);
      let pAp = 0;
      for (let k = 0; k < size; k++) pAp += p[k] * ap[k];
      if (pAp <= 1e-30) break;
      const alpha = rz / pAp;
      residualNorm = 0;
      for (let k = 0; k < size; k++) {
        x[k] += alpha * p[k]; r[k] -= alpha * ap[k];
        z[k] = r[k] / diagonal[k]; residualNorm += r[k] * r[k];
      }
      let nextRz = 0;
      for (let k = 0; k < size; k++) nextRz += r[k] * z[k];
      const beta = nextRz / Math.max(rz, 1e-30);
      for (let k = 0; k < size; k++) p[k] = z[k] + beta * p[k];
      rz = nextRz; this.iterations = iteration + 1;
    }
    this.relativeResidual = Math.sqrt(residualNorm / Math.max(rhsNorm, 1e-16));
    velocity.set(x.subarray(0, size));
  }
}
