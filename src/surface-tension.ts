import type { BoundarySamples } from './boundaries';

/** Akinci et al. (2013), eq. 2: short-range repulsion plus longer-range cohesion. */
export function cohesionKernel(r: number, h: number) {
  if (r <= 0 || r >= h) return 0;
  const base = (h - r) ** 3 * r ** 3;
  return 32 / (Math.PI * h ** 9) * (r > h * .5 ? base : 2 * base - h ** 6 / 64);
}

/** Akinci et al. (2013), eq. 7. This controls adhesion, not a specified contact angle. */
export function adhesionKernel(r: number, h: number) {
  if (r <= h * .5 || r >= h) return 0;
  return .007 / h ** 3.25 * Math.max(0, -4 * r * r / h + 6 * r - 2 * h) ** .25;
}

export class SurfaceTension {
  readonly normals: Float64Array;
  readonly acceleration: Float64Array;
  forceScale = 1;
  constructor(capacity: number) {
    this.normals = new Float64Array(capacity * 3);
    this.acceleration = new Float64Array(capacity * 3);
  }

  evaluate(p: Float32Array, count: number, neighbors: Int32Array, counts: Uint8Array, stride: number,
    density: Float32Array, h: number, rho0: number, tension: number, wetting: number, boundary?: BoundarySamples) {
    const h2 = h * h, polyGradient = -6 * 315 / (64 * Math.PI * h ** 9);
    const normal = this.normals, out = this.acceleration;
    normal.fill(0, 0, count * 3); out.fill(0, 0, count * 3);
    this.forceScale = 1;
    if (tension <= 0 && wetting <= 0) return;
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      for (let n = 0; n < counts[i]; n++) {
        const ji = neighbors[i * stride + n], j = ji * 3;
        const x = p[k] - p[j], y = p[k + 1] - p[j + 1], z = p[k + 2] - p[j + 2], r2 = x * x + y * y + z * z;
        if (r2 >= h2) continue;
        const g = h * polyGradient * (h2 - r2) ** 2 / Math.max(density[ji], .2 * rho0);
        normal[k] += x * g; normal[k + 1] += y * g; normal[k + 2] += z * g;
      }
      if (boundary) for (let n = 0; n < boundary.counts[i]; n++) {
        const b = boundary.neighbors[i * boundary.stride + n], j = b * 3;
        const x = p[k] - boundary.positions[j], y = p[k + 1] - boundary.positions[j + 1], z = p[k + 2] - boundary.positions[j + 2], r2 = x * x + y * y + z * z;
        if (r2 >= h2) continue;
        const g = h * boundary.masses[b] * polyGradient * (h2 - r2) ** 2 / rho0;
        normal[k] += x * g; normal[k + 1] += y * g; normal[k + 2] += z * g;
      }
    }
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      if (tension > 0) for (let n = 0; n < counts[i]; n++) {
        const ji = neighbors[i * stride + n], j = ji * 3;
        if (ji <= i) continue;
        const x = p[k] - p[j], y = p[k + 1] - p[j + 1], z = p[k + 2] - p[j + 2], r = Math.hypot(x, y, z);
        if (r >= h || r < 1e-8) continue;
        const correction = Math.min(4, 2 * rho0 / Math.max(.2 * rho0, density[i] + density[ji]));
        const cohesion = cohesionKernel(r, h) / r;
        const scale = -tension * correction;
        const ax = scale * (cohesion * x + normal[k] - normal[j]);
        const ay = scale * (cohesion * y + normal[k + 1] - normal[j + 1]);
        const az = scale * (cohesion * z + normal[k + 2] - normal[j + 2]);
        // Evaluate once and scatter equal/opposite forces, including with truncated lists.
        out[k] += ax; out[k + 1] += ay; out[k + 2] += az;
        out[j] -= ax; out[j + 1] -= ay; out[j + 2] -= az;
      }
      if (boundary && wetting > 0) for (let n = 0; n < boundary.counts[i]; n++) {
        const b = boundary.neighbors[i * boundary.stride + n], j = b * 3;
        const x = p[k] - boundary.positions[j], y = p[k + 1] - boundary.positions[j + 1], z = p[k + 2] - boundary.positions[j + 2], r = Math.hypot(x, y, z);
        if (r <= h * .5 || r >= h) continue;
        const f = -wetting * boundary.masses[b] * adhesionKernel(r, h) / r;
        out[k] += x * f; out[k + 1] += y * f; out[k + 2] += z * f;
      }
    }
    // Explicit capillary forces need a timestep limit. Bound acceleration for this demo.
    // A single global scale preserves fluid-fluid linear force cancellation.
    let maximum = 0;
    for (let k = 0; k < count * 3; k += 3) maximum = Math.max(maximum, Math.hypot(out[k], out[k + 1], out[k + 2]));
    this.forceScale = Math.min(1, 35 / Math.max(maximum, 1e-12));
    if (this.forceScale < 1) for (let k = 0; k < count * 3; k++) out[k] *= this.forceScale;
  }
}
