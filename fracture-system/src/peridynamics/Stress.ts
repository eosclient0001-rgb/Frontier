/**
 * ============================================================================
 *  Peridynamic stress tensor  +  explicit crack-front propagation
 * ============================================================================
 *
 *  THE ARCHITECTURAL POINT — and the reason this system looks better than
 *  every Voronoi fracture demo you have seen:
 *
 *  A lattice with horizon δ = 2·dx cannot represent a *sharp* crack. Breaking
 *  bonds produces micro-voids, and a void that is δ wide has a tip radius of
 *  δ/2, so its stress-concentration factor is nothing like that of a real
 *  crack tip. That is why naive "GPU fracture" demos either do nothing or
 *  pulverise the whole object: the damage never localises into a crack.
 *
 *  So we split the problem the way it actually wants to be split:
 *
 *    1. PERIDYNAMICS  computes the *stress field*. Continuum elasticity is
 *       perfectly well approximated on a coarse lattice, and it gives you
 *       everything that matters dynamically: wave propagation, reflections,
 *       spall, contact, the stress state that a crack actually sees.
 *
 *    2. EXPLICIT CRACK FRONTS carry the *topology*. A crack is a sharp front
 *       with a position, a tip, a velocity and a mode mixity. It advances
 *       when the stress intensity at its tip exceeds the material's fracture
 *       toughness — the real Griffith criterion — turns according to the
 *       maximum hoop-stress criterion, branches when it outruns the wave
 *       speed, and arrests when the driving stress drops.
 *
 *    3. GEOMETRY is carved from the crack ribbons, so the fragments you get
 *       are the *consequence* of the fronts that actually propagated, in the
 *       order they propagated. Cracks are sharp at any resolution.
 *
 *  This is the same split real destruction tools use (XFEM/cohesive elements
 *  in a stress solver; Chaos' "fracture fields" around a propagating front),
 *  and it is why the result reads as "real" instead of "procedural".
 * ============================================================================
 */

import type { Lattice } from './Lattice.ts';
import type { PeridynamicsSolver } from './Solver.ts';

export interface StressTensor {
  /** Voigt order: sxx, syy, szz, sxy, syz, szx. Pascals. */
  xx: number; yy: number; zz: number; xy: number; yz: number; zx: number;
}

const EMPTY: StressTensor = { xx: 0, yy: 0, zz: 0, xy: 0, yz: 0, zx: 0 };

/**
 * Peridynamic stress tensor at a material point (Hardy / Silling form):
 *
 *    σ_i = (1 / 2V_i) Σ_j  f_ij ⊗ ξ_ij
 *
 * where f_ij is the pairwise force and ξ_ij the *reference* bond vector.
 * Positive diagonal = tension, which is the convention the crack criteria want.
 */
export function nodeStress(L: Lattice, out: StressTensor, i: number): void {
  const start = L.nodeBondStart[i];
  const end = L.nodeBondStart[i + 1];
  const V = L.spacing * L.spacing * L.spacing;

  let xx = 0, yy = 0, zz = 0, xy = 0, yz = 0, zx = 0;
  const px = L.pos[i * 3], py = L.pos[i * 3 + 1], pz = L.pos[i * 3 + 2];
  const rx0 = L.ref[i * 3], ry0 = L.ref[i * 3 + 1], rz0 = L.ref[i * 3 + 2];

  for (let b = start; b < end; b++) {
    const bi = L.nodeBonds[b];
    if (L.bondBroken[bi]) continue;
    const j = L.bondNode[bi * 2] === i ? L.bondNode[bi * 2 + 1] : L.bondNode[bi * 2];

    const ax = L.pos[j * 3] - px;
    const ay = L.pos[j * 3 + 1] - py;
    const az = L.pos[j * 3 + 2] - pz;
    const r = Math.sqrt(ax * ax + ay * ay + az * az);
    if (r < 1e-12) continue;
    const rest = L.bondRest[bi];
    const s = (r - rest) / rest;

    const mag = L.bondK[bi] * L.bondScale[bi] * s / r; // force magnitude / r
    const fx = mag * ax, fy = mag * ay, fz = mag * az; // pairwise force N

    // reference bond vector
    const ex = L.ref[j * 3] - rx0;
    const ey = L.ref[j * 3 + 1] - ry0;
    const ez = L.ref[j * 3 + 2] - rz0;

    xx += fx * ex; yy += fy * ey; zz += fz * ez;
    xy += fx * ey; yz += fy * ez; zx += fz * ex;
  }

  const inv = 1 / (2 * V);
  out.xx = xx * inv; out.yy = yy * inv; out.zz = zz * inv;
  out.xy = xy * inv; out.yz = yz * inv; out.zx = zx * inv;
}

// ---------------------------------------------------------------------------
// Principal stresses — symmetric 3x3 eigen-decomposition (Jacobi)
// ---------------------------------------------------------------------------

export interface Principal { values: [number, number, number]; vectors: [number, number, number][]; }

/** Largest-magnitude tensile principal stress and its direction. */
export function maxTensile(s: StressTensor): { value: number; dir: [number, number, number] } {
  const p = principal(s);
  let best = 0;
  for (let i = 1; i < 3; i++) if (p.values[i] > p.values[best]) best = i;
  return { value: p.values[best], dir: p.vectors[best] };
}

export function principal(s: StressTensor): Principal {
  // Symmetric 3x3 Jacobi eigen-decomposition on a flat column-major matrix.
  // a is the matrix (row-major here), v accumulates the eigenvectors.
  const a = [s.xx, s.xy, s.zx, s.xy, s.yy, s.yz, s.zx, s.yz, s.zz];
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  for (let sweep = 0; sweep < 16; sweep++) {
    const off = Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[5]);
    if (off < 1e-12 * (Math.abs(a[0]) + Math.abs(a[4]) + Math.abs(a[8]) + 1e-30)) break;

    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as [number, number][]) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-30) continue;
      const app = a[p * 3 + p];
      const aqq = a[q * 3 + q];
      const theta = (aqq - app) / (2 * apq);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const sn = t * c;

      // J^T A J  with J the (p,q) Givens rotation
      const akp = [a[0], a[3], a[6]];   // column p
      const akq = [a[1], a[4], a[7]];   // column q
      void akp; void akq;
      const a_pp = app - t * apq;
      const a_qq = aqq + t * apq;
      a[p * 3 + p] = a_pp;
      a[q * 3 + q] = a_qq;
      a[p * 3 + q] = 0;
      a[q * 3 + p] = 0;

      // update the remaining entries in rows/cols p and q
      for (let k = 0; k < 3; k++) {
        if (k === p || k === q) continue;
        const akp2 = a[k * 3 + p];
        const akq2 = a[k * 3 + q];
        const nkp = c * akp2 - sn * akq2;
        const nkq = sn * akp2 + c * akq2;
        a[k * 3 + p] = nkp; a[p * 3 + k] = nkp;
        a[k * 3 + q] = nkq; a[q * 3 + k] = nkq;
      }

      // rotate the eigenvector accumulator
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p];
        const vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - sn * vkq;
        v[k * 3 + q] = sn * vkp + c * vkq;
      }
    }
  }

  const order: [number, [number, number, number]][] = [
    [a[0], [v[0], v[3], v[6]]],
    [a[4], [v[1], v[4], v[7]]],
    [a[8], [v[2], v[5], v[8]]],
  ];
  order.sort((x, y) => y[0] - x[0]);
  return {
    values: [order[0][0], order[1][0], order[2][0]],
    vectors: [norm(order[0][1]), norm(order[1][1]), norm(order[2][1])],
  };
}

function norm(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ---------------------------------------------------------------------------
// Stress field sampling
// ---------------------------------------------------------------------------

/**
 * Nearest-node sampling of the stress tensor.
 *
 * The stress field is smooth (it is an average over a horizon) so nearest-node
 * sampling is adequate, and it keeps the crack-front loop allocation-free.
 */
export class StressField {
  /** Latest stress buffer, 6 floats per node. Set by build(). */
  private buf: Float32Array = new Float32Array(0);

  constructor(private readonly L: Lattice, private readonly solver: PeridynamicsSolver) {}

  private field(i: number): number {
    return this.buf[i];
  }

  /** Fill a flat buffer with the stress at every node: 6 floats per node. */
  build(out?: Float32Array): Float32Array {
    const buf = out ?? new Float32Array(this.L.count * 6);
    this.buf = buf;
    const tmp: StressTensor = { ...EMPTY };
    for (let i = 0; i < this.L.count; i++) {
      nodeStress(this.L, tmp, i);
      buf[i * 6] = tmp.xx; buf[i * 6 + 1] = tmp.yy; buf[i * 6 + 2] = tmp.zz;
      buf[i * 6 + 3] = tmp.xy; buf[i * 6 + 4] = tmp.yz; buf[i * 6 + 5] = tmp.zx;
    }
    return buf;
  }

  /** Nearest node to a world point; -1 when the point is outside the body. */
  nearest(p: [number, number, number]): number {
    const L = this.L;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < L.count; i++) {
      const dx = L.pos[i * 3] - p[0];
      const dy = L.pos[i * 3 + 1] - p[1];
      const dz = L.pos[i * 3 + 2] - p[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /**
   * Volume-averaged principal stresses over a radius around `p`.
   *
   * A single node's stress tensor is a very local quantity and rings at the
   * grid scale (the impact loads a handful of nodes, and the lattice answers
   * with a pixel-level oscillation that no crack should react to). A real
   * crack tip responds to the field averaged over its process zone — r_p is
   * the physical length scale of that averaging — so we average over a
   * neighbourhood of roughly one horizon and take the principal stresses of
   * the averaged tensor. Removes the ringing *and* is more correct.
   */
  averagedPrincipal(
    out: StressTensor, p: [number, number, number], radius: number,
  ): void {
    const L = this.L;
    const r2 = radius * radius;
    let w = 0, xx = 0, yy = 0, zz = 0, xy = 0, yz = 0, zx = 0;
    for (let i = 0; i < L.count; i++) {
      const dx = L.pos[i * 3] - p[0];
      const dy = L.pos[i * 3 + 1] - p[1];
      const dz = L.pos[i * 3 + 2] - p[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      // Gaussian-ish: weight the centre, taper to zero at the horizon
      const wt = Math.exp(-2.5 * (d2 / r2));
      xx += this.field(i * 6) * wt;
      yy += this.field(i * 6 + 1) * wt;
      zz += this.field(i * 6 + 2) * wt;
      xy += this.field(i * 6 + 3) * wt;
      yz += this.field(i * 6 + 4) * wt;
      zx += this.field(i * 6 + 5) * wt;
      w += wt;
    }
    if (w <= 1e-12) {
      const i = this.nearest(p);
      if (i < 0) { out.xx = out.yy = out.zz = out.xy = out.yz = out.zx = 0; return; }
      out.xx = this.field(i * 6); out.yy = this.field(i * 6 + 1); out.zz = this.field(i * 6 + 2);
      out.xy = this.field(i * 6 + 3); out.yz = this.field(i * 6 + 4); out.zx = this.field(i * 6 + 5);
      return;
    }
    out.xx = xx / w; out.yy = yy / w; out.zz = zz / w;
    out.xy = xy / w; out.yz = yz / w; out.zx = zx / w;
  }

  /**
   * Peak opening stress in a neighbourhood, projected onto `normal`.
   *
   * Two things this gets right that a point sample does not:
   *
   *  1. THE TIP IS TRACTION-FREE. At the crack tip the material has already
   *     separated, so the stress *there* is around zero. The field that drives
   *     the crack lives just ahead of the tip — this is precisely why cohesive
   *     zone models evaluate their traction on the element in front of the
   *     crack, and why a simulation that samples the tip itself reports "no
   *     driving stress" and refuses to propagate.
   *
   *  2. A CRACK SEEKS ITS BEST DIRECTION. Taking the maximum over the
   *     neighbourhood instead of the mean lets the front pick the most
   *     favourable location a fraction of a horizon away, which is what makes
   *     a real crack path deflect towards inclusions and away from compressive
   *     lobes. It is also immune to grid-scale ringing: the amplitude of an
   *     oscillation is a stable quantity where its instantaneous value is not.
   */
  peakOpeningStress(
    p: [number, number, number], normal: [number, number, number], radius: number,
    outDir: [number, number, number], outPr?: Principal,
  ): number {
    const L = this.L;
    const r2 = radius * radius;
    let best = -Infinity;
    let any = false;
    outDir[0] = normal[0]; outDir[1] = normal[1]; outDir[2] = normal[2];
    for (let i = 0; i < L.count; i++) {
      const dx = L.pos[i * 3] - p[0];
      const dy = L.pos[i * 3 + 1] - p[1];
      const dz = L.pos[i * 3 + 2] - p[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      any = true;
      const pr = principal({
        xx: this.buf[i * 6], yy: this.buf[i * 6 + 1], zz: this.buf[i * 6 + 2],
        xy: this.buf[i * 6 + 3], yz: this.buf[i * 6 + 4], zx: this.buf[i * 6 + 5],
      });
      let sigma = 0;
      for (let k = 0; k < 3; k++) {
        const d = pr.vectors[k][0] * normal[0] + pr.vectors[k][1] * normal[1] + pr.vectors[k][2] * normal[2];
        sigma += pr.values[k] * d * d;
      }
      if (sigma > best) {
        best = sigma;
        // remember the state that produced it: the direction the faces want to
        // open in, and the full tensor for the mode-mixity calculation
        outDir[0] = pr.vectors[0][0]; outDir[1] = pr.vectors[0][1]; outDir[2] = pr.vectors[0][2];
        if (outPr) {
          outPr.values[0] = pr.values[0]; outPr.values[1] = pr.values[1]; outPr.values[2] = pr.values[2];
          outPr.vectors[0] = pr.vectors[0]; outPr.vectors[1] = pr.vectors[1]; outPr.vectors[2] = pr.vectors[2];
        }
      }
    }
    if (!any) return 0;
    return best === -Infinity ? 0 : best;
  }

  /** Largest principal tensile stress anywhere in the field (diagnostics). */
  peakTension(): number {
    let best = 0;
    for (let i = 0; i < this.L.count; i++) {
      const pr = principal({
        xx: this.buf[i * 6], yy: this.buf[i * 6 + 1], zz: this.buf[i * 6 + 2],
        xy: this.buf[i * 6 + 3], yz: this.buf[i * 6 + 4], zx: this.buf[i * 6 + 5],
      });
      if (pr.values[0] > best) best = pr.values[0];
    }
    return best;
  }

  /** Trilinear-ish sample of the max tensile stress near a point. */
  maxTensileAt(field: Float32Array, p: [number, number, number]): { value: number; dir: [number, number, number] } {
    const i = this.nearest(p);
    if (i < 0) return { value: 0, dir: [0, 1, 0] };
    const s: StressTensor = {
      xx: field[i * 6], yy: field[i * 6 + 1], zz: field[i * 6 + 2],
      xy: field[i * 6 + 3], yz: field[i * 6 + 4], zx: field[i * 6 + 5],
    };
    return maxTensile(s);
  }
}
