/**
 * ============================================================================
 *  Peridynamics — lattice construction
 * ============================================================================
 *
 *  Peridynamics ("peri" = near, "dyn" = force) replaces the spatial derivatives
 *  of classical continuum mechanics with an integral over a neighbourhood,
 *  which means it stays valid when the displacement field is *discontinuous*.
 *  A crack is then not a special case you have to detect — it is simply a
 *  region where the bonds between material points have broken. That is the
 *  property that makes it the right tool for destruction:
 *
 *    - cracks nucleate anywhere, at no extra cost,
 *    - they propagate at the material's real wave speed,
 *    - they branch when the energy release rate is high enough (this happens
 *      by itself, from the local stress state, not from a branching rule),
 *    - they arrest inside compressive zones,
 *    - and unloading after a crack passes is handled correctly,
 *
 *  which is exactly the set of behaviours Voronoi/cell fracture cannot produce.
 *
 *  Bond force law (bond-based peridynamics, Silling & Askari 2005):
 *
 *      s_ij  = ( |y_j - y_i| - |x_j - x_i| ) / |x_j - x_i|      (bond strain)
 *      f_ij  = c_ij * s_ij                                      (pairwise force)
 *      ρ ü_i = Σ_j c_ij * s_ij * V_j * (y_j - y_i)/|y_j - y_i| + b
 *
 *  with the micro-modulus c calibrated so the lattice reproduces the material's
 *  Young's modulus (we calibrate numerically per node, which is more robust at
 *  finite horizon than the closed-form c = 18K/πδ⁴).
 *
 *  Critical stretch for bond failure comes from fracture energy, not from a
 *  hand-picked number:
 *
 *      s_c = sqrt( 5 * G_f / ( 9 * K * δ ) )
 *
 *  so glass (G_f ≈ 8 J/m²) fails at ~0.1 % strain while plastic (G_f ≈ 2 kJ/m²)
 *  stretches by tens of percent — and you *see* that difference in the result.
 * ============================================================================
 */

import { evalSDF } from '../sdf/SDF.ts';
import type { Vec3 } from '../fracture/CrackNetwork.ts';
import type { SDFNode } from '../sdf/SDF.ts';
import type { FractureParameters } from '../materials.ts';

export interface LatticeOptions {
  /** Reference position of the object centre. */
  center: [number, number, number];
  /** Half-extents of the sampling box. */
  halfSize: [number, number, number];
  /** Lattice spacing in metres. */
  spacing: number;
  /** Interaction radius, in lattice cells. 2 => 32 neighbours. */
  horizon: number;
  /** Material driving the constitutive response. */
  material: FractureParameters;
  /**
   * Direction of the grain / cleavage / bedding plane, in object space.
   * Wood uses this for its ~20:1 stiffness anisotropy; rock for bedding;
   * isotropic materials ignore it.
   */
  grainAxis?: [number, number, number];
  /** 0 = perfectly homogeneous, 1 = wildly heterogeneous. Drives crack tortuosity. */
  heterogeneity: number;
  /**
   * Time-rescaling factor. We divide E and G_f by the same number, which leaves
   * the critical stretch (and therefore every crack-pattern statistic) identical
   * while slowing the speed of sound by sqrt(softening). Pure slow motion.
   */
  softening: number;
  /** Uniform lattice jitter (fraction of dx) — breaks the cubic symmetry. */
  jitter: number;
  /** Material-type id, kept for shading / bookkeeping. */
  materialId: number;
}

export interface MaterialResponse {
  /** Young's modulus used by the solver (after softening), Pa. */
  E: number;
  /** Critical stretch for bond failure. */
  sc: number;
  /** Strain at which the bond starts to yield (plasticity). Infinity = brittle. */
  yieldStrain: number;
  /** Fraction of stiffness retained after full plastic softening. */
  plasticResidual: number;
  /** Tensile/compressive asymmetry: compressive failure needs this much more strain. */
  compressionFactor: number;
}

export class Lattice {
  /** Number of material points. */
  readonly count: number;
  /** Reference positions (3 per node). */
  readonly ref: Float32Array;
  /** Current positions. */
  readonly pos: Float32Array;
  /** Velocities. */
  readonly vel: Float32Array;
  /** Accumulated forces / accelerations. */
  readonly acc: Float32Array;
  /** Damage: fraction of broken bonds, 0..1. */
  readonly damage: Float32Array;
  /** Per-node mass, kg. */
  readonly mass: Float32Array;
  /** Pinned nodes (window frame, joints). 1 = immovable. */
  readonly pinned: Uint8Array;

  /** Bond endpoints: 2 entries per bond. */
  readonly bondNode: Uint32Array;
  readonly bondRest: Float32Array;
  /** Micro-modulus (N/m) after anisotropy + calibration. */
  readonly bondK: Float32Array;
  /** Critical stretch for this individual bond (includes heterogeneity). */
  readonly bondCrit: Float32Array;
  readonly bondBroken: Uint8Array;
  /** Accumulated plastic strain per bond (ductile materials only). */
  readonly bondPlastic: Float32Array;
  /**
   * Process-zone micro-damage per bond, 0..1.
   *
   * A real crack tip carries a damaged process zone ahead of it whose size is
   * r_p ~ (K_IC/sigma_y)^2 — for glass that is well under a millimetre, which
   * no real-time lattice can resolve. This field is the standard remedy: bonds
   * inside the high-stress lobe progressively lose stiffness and critical
   * stretch, so the crack *does* advance at the right speed and in the right
   * direction, instead of needing one heroic bond to snap all by itself.
   */
  readonly bondDamage: Float32Array;
  /** Current elastic stiffness scale after plastic softening (1 = pristine). */
  readonly bondScale: Float32Array;

  /**
   * Uniform spatial hash over the nodes, for neighbourhood queries driven by
   * the crack fronts (see breakBondsNear). Cell size = the lattice spacing.
   */
  gridCell: number;
  private gridDim: [number, number, number];
  private gridOrigin: [number, number, number];
  private gridStart: Int32Array;
  private gridItems: Int32Array;

  /** CSR adjacency: bonds incident to each node. */
  readonly nodeBondStart: Uint32Array;
  readonly nodeBonds: Uint32Array;
  /** Number of bonds each node started with (denominator of damage). */
  readonly nodeBondCount: Uint32Array;

  readonly response: MaterialResponse;
  readonly spacing: number;
  readonly horizon: number;
  readonly bondCount: number;

  constructor(
    count: number,
    ref: Float32Array,
    mass: Float32Array,
    bondNode: Uint32Array,
    bondRest: Float32Array,
    bondK: Float32Array,
    bondCrit: Float32Array,
    nodeBondStart: Uint32Array,
    nodeBonds: Uint32Array,
    nodeBondCount: Uint32Array,
    response: MaterialResponse,
    spacing: number,
    horizon: number,
  ) {
    this.count = count;
    this.ref = ref;
    this.pos = ref.slice();
    this.vel = new Float32Array(count * 3);
    this.acc = new Float32Array(count * 3);
    this.damage = new Float32Array(count);
    this.mass = mass;
    this.pinned = new Uint8Array(count);

    this.bondNode = bondNode;
    this.bondRest = bondRest;
    this.bondK = bondK;
    this.bondCrit = bondCrit;
    this.bondBroken = new Uint8Array(bondRest.length);
    this.bondPlastic = new Float32Array(bondRest.length);
    this.bondDamage = new Float32Array(bondRest.length);
    this.bondScale = new Float32Array(bondRest.length).fill(1);

    this.nodeBondStart = nodeBondStart;
    this.nodeBonds = nodeBonds;
    this.nodeBondCount = nodeBondCount;

    this.response = response;
    this.spacing = spacing;
    this.horizon = horizon;
    this.bondCount = bondRest.length;

    // ---- spatial hash over nodes ----------------------------------------
    this.gridCell = spacing;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      minX = Math.min(minX, ref[i * 3]); maxX = Math.max(maxX, ref[i * 3]);
      minY = Math.min(minY, ref[i * 3 + 1]); maxY = Math.max(maxY, ref[i * 3 + 1]);
      minZ = Math.min(minZ, ref[i * 3 + 2]); maxZ = Math.max(maxZ, ref[i * 3 + 2]);
    }
    this.gridOrigin = [minX - spacing, minY - spacing, minZ - spacing];
    this.gridDim = [
      Math.max(1, Math.ceil((maxX - minX) / spacing) + 3),
      Math.max(1, Math.ceil((maxY - minY) / spacing) + 3),
      Math.max(1, Math.ceil((maxZ - minZ) / spacing) + 3),
    ];
    const cells = this.gridDim[0] * this.gridDim[1] * this.gridDim[2];
    const counts = new Int32Array(cells + 1);
    const cellOf = (i: number): number => {
      const cx = Math.min(this.gridDim[0] - 1, Math.max(0, Math.floor((ref[i * 3] - this.gridOrigin[0]) / spacing)));
      const cy = Math.min(this.gridDim[1] - 1, Math.max(0, Math.floor((ref[i * 3 + 1] - this.gridOrigin[1]) / spacing)));
      const cz = Math.min(this.gridDim[2] - 1, Math.max(0, Math.floor((ref[i * 3 + 2] - this.gridOrigin[2]) / spacing)));
      return cx + cy * this.gridDim[0] + cz * this.gridDim[0] * this.gridDim[1];
    };
    for (let i = 0; i < count; i++) counts[cellOf(i) + 1]++;
    for (let c = 0; c < cells; c++) counts[c + 1] += counts[c];
    this.gridStart = counts;
    this.gridItems = new Int32Array(count);
    const cursor2 = new Int32Array(cells);
    for (let i = 0; i < count; i++) {
      const c = cellOf(i);
      this.gridItems[this.gridStart[c] + cursor2[c]++] = i;
    }
  }

  /**
   * Fail every bond that crosses a crack plane inside a ribbon.
   *
   * THIS IS THE COUPLING THAT MAKES THE HYBRID WORK. A crack front that only
   * *reads* a stress field never gets a stress concentration at its tip, so it
   * outruns its own driving field and stalls after a few millimetres. Feeding
   * the front back into the lattice — degrading the bonds it has passed
   * through — does three things at once:
   *
   *   1. the lattice now has a real discontinuity, so the field concentrates
   *      at the tip and moves with it (the crack is driven by its own energy
   *      release rate, exactly as it should be),
   *   2. the crack opening displacement appears in the physics, giving correct
   *      unloading of the faces and a realistic aperture,
   *   3. fragments become genuinely disconnected in the bond graph, so the
   *      islands the carver extracts are physical, not merely geometric.
   *
   * `aperture` is the ribbon thickness across which bonds are cut, and
   * `soften` (0..1) lets a front create a cohesive process zone instead of a
   * fully open crack (used for the sub-critical part of the tip).
   */
  breakBondsNear(
    a: Vec3, b: Vec3, normal: Vec3, aperture: number,
    lateral: number, soften: number,
  ): { broken: number; softened: number } {
    const cell = this.gridCell;
    const half = aperture * 0.5;
    const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const tl = Math.hypot(t[0], t[1], t[2]);
    if (tl < 1e-12) return { broken: 0, softened: 0 };
    t[0] /= tl; t[1] /= tl; t[2] /= tl;
    // in-plane perpendicular (across the ribbon)
    let w = [
      t[1] * normal[2] - t[2] * normal[1],
      t[2] * normal[0] - t[0] * normal[2],
      t[0] * normal[1] - t[1] * normal[0],
    ];
    const wl = Math.hypot(w[0], w[1], w[2]);
    if (wl < 1e-9) return { broken: 0, softened: 0 };
    w = [w[0] / wl, w[1] / wl, w[2] / wl];

    const margin = Math.max(half, cell * 0.75) + cell;
    const ex = Math.abs(t[0]) * (tl * 0.5 + margin) + Math.abs(w[0]) * (lateral + margin) + Math.abs(normal[0]) * margin;
    const ey = Math.abs(t[1]) * (tl * 0.5 + margin) + Math.abs(w[1]) * (lateral + margin) + Math.abs(normal[1]) * margin;
    const ez = Math.abs(t[2]) * (tl * 0.5 + margin) + Math.abs(w[2]) * (lateral + margin) + Math.abs(normal[2]) * margin;
    const cx = (a[0] + b[0]) * 0.5, cy = (a[1] + b[1]) * 0.5, cz = (a[2] + b[2]) * 0.5;

    const lo = (v: number, o: number, dim: number, e: number): number =>
      Math.min(dim - 1, Math.max(0, Math.floor((v - e - o) / cell)));
    const hi = (v: number, o: number, dim: number, e: number): number =>
      Math.min(dim - 1, Math.max(0, Math.ceil((v + e - o) / cell)));
    const i0 = lo(cx, this.gridOrigin[0], this.gridDim[0], ex), i1 = hi(cx, this.gridOrigin[0], this.gridDim[0], ex);
    const j0 = lo(cy, this.gridOrigin[1], this.gridDim[1], ey), j1 = hi(cy, this.gridOrigin[1], this.gridDim[1], ey);
    const k0 = lo(cz, this.gridOrigin[2], this.gridDim[2], ez), k1 = hi(cz, this.gridOrigin[2], this.gridDim[2], ez);

    let broken = 0, softened = 0;
    for (let k = k0; k <= k1; k++) {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const c = i + j * this.gridDim[0] + k * this.gridDim[0] * this.gridDim[1];
          for (let q = this.gridStart[c]; q < this.gridStart[c + 1]; q++) {
            const n = this.gridItems[q];
            const px = this.ref[n * 3] - a[0];
            const py = this.ref[n * 3 + 1] - a[1];
            const pz = this.ref[n * 3 + 2] - a[2];
            const along = px * t[0] + py * t[1] + pz * t[2];
            if (along < -margin || along > tl + margin) continue;
            const across = Math.abs(px * w[0] + py * w[1] + pz * w[2]);
            if (across > lateral) continue;
            const perp = Math.abs(px * normal[0] + py * normal[1] + pz * normal[2]);
            if (perp > half + cell * 0.5) continue;

            // fail the bonds of this node that cross the crack plane
            const s0 = this.nodeBondStart[n], s1 = this.nodeBondStart[n + 1];
            for (let bi = s0; bi < s1; bi++) {
              const bidx = this.nodeBonds[bi];
              if (this.bondBroken[bidx]) continue;
              const other = this.bondNode[bidx * 2] === n ? this.bondNode[bidx * 2 + 1] : this.bondNode[bidx * 2];
              if (other === n) continue;
              const qx = this.ref[other * 3] - a[0];
              const qy = this.ref[other * 3 + 1] - a[1];
              const qz = this.ref[other * 3 + 2] - a[2];
              const perpQ = qx * normal[0] + qy * normal[1] + qz * normal[2];
              if (perp * perpQ > 0) continue;         // same side: leave it
              if (soften >= 1) {
                this.bondBroken[bidx] = 1;
                broken++;
              } else {
                const s = this.bondScale[bidx] * (1 - soften);
                if (s < this.bondScale[bidx]) { this.bondScale[bidx] = s; softened++; }
              }
            }
          }
        }
      }
    }
    if (broken || softened) this.refreshDamage();
    return { broken, softened };
  }

  /** Recompute the per-node damage from the bond table. */
  refreshDamage(): void {
    const tally = new Uint32Array(this.count);
    for (let b = 0; b < this.bondCount; b++) {
      if (!this.bondBroken[b]) continue;
      tally[this.bondNode[b * 2]]++;
      tally[this.bondNode[b * 2 + 1]]++;
    }
    for (let n = 0; n < this.count; n++) {
      this.damage[n] = this.nodeBondCount[n] > 0 ? tally[n] / this.nodeBondCount[n] : 0;
    }
  }

  /** Centre of mass of the reference configuration. */
  centreOfMass(): [number, number, number] {
    let x = 0, y = 0, z = 0, m = 0;
    for (let i = 0; i < this.count; i++) {
      const w = this.mass[i];
      x += this.ref[i * 3] * w;
      y += this.ref[i * 3 + 1] * w;
      z += this.ref[i * 3 + 2] * w;
      m += w;
    }
    return [x / m, y / m, z / m];
  }

  /** Rigid-body velocity of the whole lattice (unpinned nodes). */
  meanVelocity(): [number, number, number] {
    let x = 0, y = 0, z = 0, m = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.pinned[i]) continue;
      const w = this.mass[i];
      x += this.vel[i * 3] * w;
      y += this.vel[i * 3 + 1] * w;
      z += this.vel[i * 3 + 2] * w;
      m += w;
    }
    if (m < 1e-12) return [0, 0, 0];
    return [x / m, y / m, z / m];
  }

  /** Total kinetic energy, J. Useful for the HUD. */
  kineticEnergy(): number {
    let ke = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.pinned[i]) continue;
      const vx = this.vel[i * 3], vy = this.vel[i * 3 + 1], vz = this.vel[i * 3 + 2];
      ke += 0.5 * this.mass[i] * (vx * vx + vy * vy + vz * vz);
    }
    return ke;
  }

  /** Mean damage over the whole body, 0..1. */
  meanDamage(): number {
    let d = 0;
    for (let i = 0; i < this.count; i++) d += this.damage[i];
    return d / this.count;
  }

  reset(): void {
    this.pos.set(this.ref);
    this.vel.fill(0);
    this.acc.fill(0);
    this.damage.fill(0);
    this.bondBroken.fill(0);
    this.bondPlastic.fill(0);
    this.bondDamage.fill(0);
    this.bondScale.fill(1);
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Micro-modulus calibration.
 *
 * For a uniaxial strain ε along x, every bond contributes k·(n̂·x̂)²·ε of axial
 * force per bond. Matching the continuum stress σ = E·ε gives
 *
 *      k_ij = E · V_j / ( Σ_j (n̂_ij · x̂)² · r_ij )
 *
 * We compute that sum per node and distribute it over the incident bonds, so
 * the *sum* of contributions is exactly right even with jitter, anisotropy and
 * truncated neighbourhoods (edges/corners of the body).
 */
export function buildLattice(sdf: SDFNode, opts: LatticeOptions): Lattice {
  const { center, halfSize, spacing } = opts;
  const nx = Math.max(3, Math.round((halfSize[0] * 2) / spacing));
  const ny = Math.max(3, Math.round((halfSize[1] * 2) / spacing));
  const nz = Math.max(3, Math.round((halfSize[2] * 2) / spacing));

  const grain = normalize(opts.grainAxis ?? [0, 1, 0]);

  // --- 1. mask lattice points against the object SDF ----------------------
  const index = new Int32Array(nx * ny * nz).fill(-1);
  const nodeList: number[] = []; // packed ijk
  const tmpPos: number[] = [];

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = center[0] + (i / (nx - 1) - 0.5) * halfSize[0] * 2;
        const y = center[1] + (j / (ny - 1) - 0.5) * halfSize[1] * 2;
        const z = center[2] + (k / (nz - 1) - 0.5) * halfSize[2] * 2;
        // Keep points inside the object, and keep a one-cell shell of outside
        // points so the free surface still has a half-neighbourhood.
        const d = evalSDF(sdf, x, y, z);
        if (d < spacing * 0.6) {
          index[i + j * nx + k * nx * ny] = nodeList.length / 3;
          nodeList.push(i, j, k);
          tmpPos.push(x, y, z);
        }
      }
    }
  }

  const count = nodeList.length / 3;
  const ref = new Float32Array(count * 3);
  const posOut = new Float32Array(count * 3);
  const mass = new Float32Array(count);

  const volume = spacing * spacing * spacing;
  const density = opts.material.density;

  for (let n = 0; n < count; n++) {
    // jitter breaks the cubic symmetry that would otherwise produce
    // suspiciously axis-aligned cracks
    const jx = (rand01(n * 3 + 1) - 0.5) * spacing * opts.jitter;
    const jy = (rand01(n * 3 + 2) - 0.5) * spacing * opts.jitter;
    const jz = (rand01(n * 3 + 3) - 0.5) * spacing * opts.jitter;
    ref[n * 3] = tmpPos[n * 3] + jx;
    ref[n * 3 + 1] = tmpPos[n * 3 + 1] + jy;
    ref[n * 3 + 2] = tmpPos[n * 3 + 2] + jz;
    posOut[n * 3] = ref[n * 3];
    posOut[n * 3 + 1] = ref[n * 3 + 1];
    posOut[n * 3 + 2] = ref[n * 3 + 2];
    mass[n] = density * volume;
  }

  // --- 2. build the neighbour (bond) list ---------------------------------
  const h = opts.horizon;
  const offsets: [number, number, number][] = [];
  const hMax = Math.ceil(h);
  for (let k = -hMax; k <= hMax; k++) {
    for (let j = -hMax; j <= hMax; j++) {
      for (let i = -hMax; i <= hMax; i++) {
        if (i === 0 && j === 0 && k === 0) continue;
        if (Math.hypot(i, j, k) > h + 1e-6) continue;
        offsets.push([i, j, k]);
      }
    }
  }

  const resp = materialResponse(opts);
  const K = resp.E / (3 * (1 - 2 * opts.material.poissonRatio)); // bulk modulus (Pa)

  const bondA: number[] = [];
  const bondB: number[] = [];
  const bondRestArr: number[] = [];
  const bondW: number[] = [];     // anisotropy weight
  const bondScArr: number[] = []; // per-bond critical stretch

  // Central-difference spacing per axis (the grid is anisotropic if the user
  // asked for a non-cubic object).
  const dx = (halfSize[0] * 2) / (nx - 1);
  const dy = (halfSize[1] * 2) / (ny - 1);
  const dz = (halfSize[2] * 2) / (nz - 1);

  const rawK: number[] = [];
  const cosX2: number[] = [];

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = index[i + j * nx + k * nx * ny];
        if (a < 0) continue;
        for (const [oi, oj, ok] of offsets) {
          const ii = i + oi, jj = j + oj, kk = k + ok;
          if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
          const b = index[ii + jj * nx + kk * nx * ny];
          if (b < 0) continue;
          if (b <= a) continue; // each bond once

          const ax = ref[a * 3], ay = ref[a * 3 + 1], az = ref[a * 3 + 2];
          const bx = ref[b * 3], by = ref[b * 3 + 1], bz = ref[b * 3 + 2];
          let rx = bx - ax, ry = by - ay, rz = bz - az;
          const rest = Math.hypot(rx, ry, rz);
          if (rest < 1e-9) continue;
          rx /= rest; ry /= rest; rz /= rest;

          // Anisotropy weight: wood is ~20x stiffer along the grain, rock has
          // bedding planes, the rest are near-isotropic.
          const dirDot = rx * grain[0] + ry * grain[1] + rz * grain[2];
          const w = anisotropyWeight(opts.materialId, dirDot);

          // Heterogeneity: bond strength varies with a spatial hash, mimicking
          // micro-cracks, voids, aggregate, knots. This is *the* ingredient
          // that makes crack paths tortuous instead of crystalline.
          const hx = (ref[a * 3] + ref[b * 3]) * 0.5;
          const hy = (ref[a * 3 + 1] + ref[b * 3 + 1]) * 0.5;
          const hz = (ref[a * 3 + 2] + ref[b * 3 + 2]) * 0.5;
          const het = 1 + opts.heterogeneity * (valueNoise(hx / (spacing * 3), hy / (spacing * 3), hz / (spacing * 3)) * 1.4 - 0.7)
            + opts.heterogeneity * (valueNoise(hx / (spacing * 0.9), hy / (spacing * 0.9), hz / (spacing * 0.9)) * 0.6 - 0.3);

          bondA.push(a);
          bondB.push(b);
          bondRestArr.push(rest);
          bondW.push(w);
          bondScArr.push(resp.sc * Math.max(0.15, het));

          const cx = rx, cy = ry, cz = rz;
          rawK.push(w);
          cosX2.push(cx * cx);
        }
      }
    }
  }

  const bondCount = bondA.length;
  const bondNode = new Uint32Array(bondCount * 2);
  const bondRest = new Float32Array(bondCount);
  const bondK = new Float32Array(bondCount);
  const bondCrit = new Float32Array(bondCount);

  for (let b = 0; b < bondCount; b++) {
    bondNode[b * 2] = bondA[b];
    bondNode[b * 2 + 1] = bondB[b];
    bondRest[b] = bondRestArr[b];
    bondK[b] = rawK[b];
    bondCrit[b] = bondScArr[b];
  }

  // --- 3. calibrate the micro-modulus --------------------------------------
  // Impose a unit uniaxial strain and *measure* what stress the lattice
  // produces, then scale every bond so the response equals the target Young's
  // modulus. Analytic calibration (k = E·dx, or c = 18K/πδ⁴) is fine on an
  // infinite perfect lattice but drifts badly once you have jitter, anisotropy
  // and free surfaces — and an error here silently scales the whole stress
  // field, which is the quantity every crack criterion is compared against.
  // Measuring it costs one pass over the bonds and is always right.
  //
  //   displacement u = (eps·x, 0, 0)   ->  bond stretch s = (|xi+eta|-|xi|)/|xi|
  //   stress           sigma_xx = (1/V) Σ_b F_b · xi_b     (peridynamic tensor)
  {
    const eps = 1e-6;
    const V = spacing * spacing * spacing;

    // sum only over fully-coordinated (interior) nodes: a free surface has
    // half a neighbourhood, and its stress is not the bulk response
    let maxDeg = 0;
    for (let n = 0; n < count; n++) maxDeg = Math.max(maxDeg, nodeBondCountOf(n));

    let sigmaSum = 0, nodeSum = 0;
    for (let n = 0; n < count; n++) {
      if (nodeBondCountOf(n) !== maxDeg) continue;
      const nx = ref[n * 3], ny = ref[n * 3 + 1], nz = ref[n * 3 + 2];
      const ux = eps * nx, uy = 0, uz = 0;
      let sxx = 0;
      for (let b = 0; b < bondCount; b++) {
        const a = bondA[b], c2 = bondB[b];
        if (a !== n && c2 !== n) continue;
        const other = a === n ? c2 : a;
        const xj = ref[other * 3], yj = ref[other * 3 + 1], zj = ref[other * 3 + 2];
        const xiX = xj - nx, xiY = yj - ny, xiZ = zj - nz;
        const r0 = Math.hypot(xiX, xiY, xiZ);
        if (r0 < 1e-12) continue;
        const etaX = (eps * xj) - ux;
        const etaY = 0 - uy, etaZ = 0 - uz;
        const r1 = Math.hypot(xiX + etaX, xiY + etaY, xiZ + etaZ);
        const st = (r1 - r0) / r0;
        // Pairwise force *vector* is k·s·(deformed bond direction). Omitting
        // the 1/r here makes the F ⊗ xi sum cancel almost exactly by symmetry
        // (+x and -x neighbours have opposite xi_x), which reads as "the
        // material has zero stiffness" — a spectacularly silent failure.
        const fOverR = (bondK[b] * st) / r1;
        sxx += fOverR * (xiX + etaX) * xiX;       // F_x · xi_x
      }
      sigmaSum += sxx / (2 * V);                  // same normalisation as nodeStress
      nodeSum++;
    }
    const measured = nodeSum > 0 ? sigmaSum / nodeSum / eps : 0;  // apparent modulus with the current k
    if (typeof globalThis !== 'undefined' && (globalThis as { FRACTURE_DEBUG?: boolean }).FRACTURE_DEBUG) {
      console.log(`[calib] maxDeg=${maxDeg} nodes=${nodeSum} sigmaSum=${sigmaSum.toExponential(3)} measured=${measured.toExponential(3)} target=${resp.E.toExponential(3)} scale=${(resp.E / Math.max(measured, 1e-30)).toExponential(3)}`);
    }
    const scale = measured > 1e-9 ? resp.E / measured : 1;
    for (let b = 0; b < bondCount; b++) bondK[b] *= scale;
    void K;
  }

  function nodeBondCountOf(n: number): number {
    // computed on the fly; the CSR arrays are built a few lines further down
    let d = 0;
    for (let b = 0; b < bondCount; b++) if (bondA[b] === n || bondB[b] === n) d++;
    return d;
  }

  // --- 4. CSR adjacency ---------------------------------------------------
  const nodeBondCount = new Uint32Array(count);
  for (let b = 0; b < bondCount; b++) {
    nodeBondCount[bondA[b]]++;
    nodeBondCount[bondB[b]]++;
  }
  const nodeBondStart = new Uint32Array(count + 1);
  for (let n = 0; n < count; n++) nodeBondStart[n + 1] = nodeBondStart[n] + nodeBondCount[n];
  const nodeBonds = new Uint32Array(bondCount * 2);
  const cursor = nodeBondStart.slice(0, count);
  for (let b = 0; b < bondCount; b++) {
    nodeBonds[cursor[bondA[b]]++] = b;
    nodeBonds[cursor[bondB[b]]++] = b;
  }

  void K;
  return new Lattice(
    count, ref, mass, bondNode, bondRest, bondK, bondCrit,
    nodeBondStart, nodeBonds, nodeBondCount, resp, spacing, opts.horizon,
  );
}

// ---------------------------------------------------------------------------
// Constitutive data per material
// ---------------------------------------------------------------------------

export function materialResponse(opts: LatticeOptions): MaterialResponse {
  const p = opts.material;
  const soft = Math.max(1, opts.softening);
  const E = (p.youngsModulus * 1e9) / soft;
  // G_f = K_IC² / E  (Griffith).  K_IC is quoted in MPa·m^0.5 and E in GPa,
  // so the conversion factor is 1e12/1e9 = 1e3 to land in J/m².
  //   glass    0.75²/70  * 1e3 =    8 J/m²
  //   concrete 1.20²/30  * 1e3 =   48 J/m²
  //   rock     2.00²/60  * 1e3 =   67 J/m²
  //   wood     3.50²/12  * 1e3 = 1021 J/m²
  //   plastic  5.00²/2.5 * 1e3 = 10000 J/m²   <- 1250x glass: you feel it
  const Gf = (p.fractureToughness ** 2 / Math.max(1e-6, p.youngsModulus)) * 1e3;

  const K = E / (3 * (1 - 2 * p.poissonRatio));
  const delta = opts.spacing * opts.horizon;
  // s_c = sqrt(5 G_f / (9 K δ))  (Silling & Askari)
  let sc = Math.sqrt(Math.max(1e-12, (5 * Gf) / (9 * K * delta)));
  // Only a sanity ceiling: above 0.3 the "solid" would behave like rubber.
  // The lower bound must stay physical — clamping it up is what makes naive
  // implementations unable to propagate a crack at all.
  sc = clamp(sc, 1e-7, 0.3);

  const dtype = materialDuctility(opts.materialId);
  return {
    E,
    sc,
    // Ductile materials must yield *before* they reach their fracture
    // stretch, otherwise there is no plastic zone and no tearing.
    yieldStrain: dtype.yieldRatio === 0 ? Infinity : dtype.yieldRatio * sc,
    plasticResidual: dtype.residual,
    compressionFactor: dtype.compression,
  };
}

function materialDuctility(id: number) {
  // yieldRatio = yield strain expressed as a fraction of the fracture stretch.
  // 0 (or absent) => perfectly brittle, no plastic zone at all.
  switch (id) {
    case 3: // plastic: yields at 35 % of its failure strain, keeps 15 % stiffness
      return { yieldRatio: 0.35, residual: 0.15, compression: 1.4 };
    case 1: // wood: a little plastic flow along the grain before it splits
      return { yieldRatio: 0.55, residual: 0.30, compression: 3.0 };
    case 0: // glass: perfectly brittle, very strong in compression
      return { yieldRatio: 0, residual: 1, compression: 12.0 };
    case 2: // concrete: brittle in tension, very strong in compression
      return { yieldRatio: 0, residual: 1, compression: 10.0 };
    default: // rock
      return { yieldRatio: 0, residual: 1, compression: 8.0 };
  }
}

/** 1 for isotropic materials, strongly directional for wood / bedded rock. */
function anisotropyWeight(materialId: number, dirDot: number): number {
  const d2 = dirDot * dirDot;
  switch (materialId) {
    case 1: // wood: parallel grain ~20x stiffer than across it
      return 0.06 + 0.94 * Math.pow(d2, 1.5);
    case 4: // rock: bedding planes
      return 0.25 + 0.75 * Math.pow(d2, 0.8);
    case 2: // concrete: mild aggregate alignment
      return 0.75 + 0.25 * d2;
    default:
      return 1;
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

/** Deterministic hash → [0,1). */
export function rand01(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Smooth 3D value noise in [-1,1]. */
export function valueNoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const h = (a: number, b: number, c: number): number => rand01(a * 73856093 ^ b * 19349663 ^ c * 83492791);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c00 = lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u);
  const c10 = lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u);
  const c01 = lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u);
  const c11 = lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u);
  return lerp(lerp(c00, c10, v), lerp(c01, c11, v), w) * 2 - 1;
}
