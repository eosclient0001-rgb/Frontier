/**
 * ============================================================================
 *  Peridynamics — explicit time integrator
 * ============================================================================
 *
 *  Velocity-Verlet (leapfrog), O(bonds) per step, zero allocation in the hot
 *  loop. Everything lives in flat typed arrays so the identical data layout can
 *  be uploaded to a WebGPU compute pipeline — see `src/gpu/PeridynamicsGPU.ts`,
 *  which runs the same algorithm with one thread per bond plus a per-node force
 *  reduction, and produces bit-comparable damage fields.
 *
 *  What this buys you over "pre-fractured mesh + swap":
 *
 *    - the crack *starts* at the impact and travels outward at the material's
 *      crack speed, so you see propagation, not a pop-in,
 *    - cracks interact: one crack shields or amplifies another,
 *    - a crack driven into a compressive region (e.g. the far side of a brick
 *      under a point load) arrests, exactly like reality,
 *    - branch angles come out of the local stress state, so glass branches
 *      sharply and plastic never branches at all,
 *    - unload waves close cracks that never fully separated.
 * ============================================================================
 */

import { clamp } from './Lattice.ts';
import type { Lattice } from './Lattice.ts';

export interface SolverOptions {
  /** Viscous damping applied to velocities (fraction per second). */
  damping: number;
  /**
   * Process-zone kinetics, 1/s. Higher = damage localises faster (brittle,
   * sharper cracks); lower = more diffuse micro-cracking before failure.
   * Divided by `softening` implicitly through dt, so it stays resolution
   * independent.
   */
  damageRate: number;
  /** Multiply every dt by this — a slow-motion dial for cinematics. */
  timeScale: number;
  /** Hard cap on substeps per call, protects the frame budget. */
  maxSubsteps: number;
}

export const DEFAULT_SOLVER: SolverOptions = {
  damping: 0.35,
  damageRate: 900,
  timeScale: 1,
  maxSubsteps: 64,
};

/**
 * A striker in contact with the body.
 *
 * This is the difference between "flick the surface" and "hit it". An
 * instantaneous impulse delivers momentum to a handful of nodes and the
 * resulting wave rings out in ~100 microseconds without ever stressing the
 * bulk (measured: peak field stress 25 kPa, which is 5x too low to propagate
 * even a 1 cm crack). A real striker stays in contact for a finite time,
 * pushes the surface in, and *stores elastic energy* in the whole body — that
 * stored energy is what a running crack actually consumes. So we hold a
 * velocity boundary condition on the contact patch for the contact duration,
 * then release it.
 */
export interface ContactPatch {
  nodes: Int32Array;
  /** Target velocity (m/s) per node, 3 components each, ramped over the contact. */
  target: Float32Array;
  /** Substep countdown; the BC is released when it reaches zero. */
  stepsRemaining: number;
  totalSteps: number;
  radius: number;
}

export interface ImpactResult {
  nodesAffected: number;
  impulse: number; // N·s delivered
  /** eps_induced / s_c — the number that decides the fracture morphology. */
  strainRatio: number;
  /** Peak particle velocity imparted, m/s. */
  velocity: number;
  /** True when the strain ceiling clamped the impulse. */
  saturated: boolean;
}

export class PeridynamicsSolver {
  readonly lattice: Lattice;
  readonly opts: SolverOptions;

  /** Broken-bond tally per node — denominator is `nodeBondCount`. */
  private readonly brokenTally: Uint32Array;
  /** Union-find scratch for island detection. */
  private readonly ufParent: Int32Array;
  private readonly ufRank: Int32Array;

  /** Suggested stable timestep, seconds. */
  readonly dt: number;
  /** Number of steps executed so far (for the HUD / determinism checks). */
  stepCount = 0;
  /** Wall-clock seconds spent solving, for profiling. */
  solveTime = 0;
  /** Active striker contacts, applied every substep while they last. */
  private contacts: ContactPatch[] = [];

  constructor(lattice: Lattice, opts: Partial<SolverOptions> = {}) {
    this.lattice = lattice;
    this.opts = { ...DEFAULT_SOLVER, ...opts };
    this.brokenTally = new Uint32Array(lattice.count);
    this.ufParent = new Int32Array(lattice.count);
    this.ufRank = new Int32Array(lattice.count);
    this.dt = this.computeStableDt();
  }

  /**
   * CFL / harmonic bound for a spring lattice:
   *   ω_max = sqrt( Σ|k| / m ),  dt ≤ 2/ω_max
   * plus the elastic-wave CFL condition dt ≤ dx/c_p. We take 40 % of the
   * smaller, which is comfortably stable for brittle failure where bonds snap
   * (stiffness removal only ever *lowers* the eigenfrequencies).
   */
  private computeStableDt(): number {
    const L = this.lattice;
    let maxOmega = 0;
    for (let n = 0; n < L.count; n++) {
      const s = L.nodeBondStart[n], e = L.nodeBondStart[n + 1];
      let ksum = 0;
      for (let i = s; i < e; i++) ksum += L.bondK[L.nodeBonds[i]];
      const omega = Math.sqrt(ksum / Math.max(1e-12, L.mass[n]));
      if (omega > maxOmega) maxOmega = omega;
    }
    const dtHarmonic = maxOmega > 0 ? 2 / maxOmega : 1e-6;
    const cp = Math.sqrt(L.response.E / Math.max(1, L.mass[0] / (L.spacing ** 3)));
    const dtCFL = cp > 0 ? L.spacing / cp : dtHarmonic;
    return 0.4 * Math.min(dtHarmonic, dtCFL);
  }

  /**
   * Deliver an impact. A short, very localised velocity impulse is what a
   * striker actually imparts: the contact patch is small relative to the body,
   * which is why the crack field starts as a point source and becomes radial.
   */
  /**
   * Strike the body. The striker is modelled as a rigid indenter that stays in
   * contact for `contactTime` and drives the contact patch at a prescribed
   * velocity, storing elastic energy; when it releases, that energy is what
   * drives the crack fronts.
   */
  applyImpact(
    point: [number, number, number],
    direction: [number, number, number],
    /**
     * Impact energy in joules. Pass <= 0 to derive it from `maxStrainRatio`
     * instead, which is what you normally want: severity is the physically
     * meaningful authoring control (it is the strain normalised by the
     * material's own strength), and the energy is then a consequence.
     */
    energy: number,
    radius: number,
    /** Cap on the induced strain, as a multiple of the material's failure
     *  strain. This is the one control that decides "crack" vs "pulverise". */
    maxStrainRatio = 9,
    contactSteps = 14,
  ): ImpactResult {
    const L = this.lattice;
    let dl = Math.hypot(direction[0], direction[1], direction[2]) || 1;
    const dx = direction[0] / dl, dy = direction[1] / dl, dz = direction[2] / dl;

    // Gather the affected set first so we can normalise the total momentum.
    const hit: number[] = [];
    const weights: number[] = [];
    let totalMass = 0;
    const r2 = radius * radius;

    for (let n = 0; n < L.count; n++) {
      if (L.pinned[n]) continue;
      const px = L.pos[n * 3] - point[0];
      const py = L.pos[n * 3 + 1] - point[1];
      const pz = L.pos[n * 3 + 2] - point[2];
      const d2 = px * px + py * py + pz * pz;
      if (d2 > r2) continue;
      // Gaussian-ish falloff: peak compression at the contact, tapered edge.
      const w = Math.exp(-3.5 * (d2 / r2));
      hit.push(n);
      weights.push(w);
      totalMass += L.mass[n] * w;
    }

    if (hit.length === 0 || totalMass <= 0) {
      return { nodesAffected: 0, impulse: 0, strainRatio: 0, velocity: 0, saturated: false };
    }

    // E = ½ m v²  →  v = sqrt(2E/(m_eff · Σw))
    const cWaveEarly = Math.sqrt(this.lattice.response.E / Math.max(1e-6, L.mass[0] / (L.spacing ** 3)));
    const vTarget = maxStrainRatio * L.response.sc * cWaveEarly;
    const mEff = totalMass * hit.length * 0.5;
    let v0 = energy > 0
      ? Math.sqrt((2 * energy) / mEff)
      : vTarget;                                  // severity-driven
    if (energy <= 0) v0 = vTarget;

    // ---- strain regularisation ----------------------------------------
    // The strain a striker induces is roughly v/c, and the outcome depends
    // almost entirely on the ratio  eps_induced / s_c  (material strength):
    //   < 1   nothing happens, the wave passes and the body rings,
    //   1-4   a handful of radial cracks nucleate at the contact,
    //   4-10  the classic star / spider web pattern,
    //   > 12  the contact zone crushes and you get a pulverised cone.
    // Letting the raw energy drive v without a ceiling just means the ratio
    // scales with 1/softening, so a coarse (fast) lattice pulverises
    // everything while a fine one refuses to crack at all. Ceiling the
    // induced strain keeps the *outcome* the same at every resolution;
    // surplus energy widens the contact patch instead of deepening the
    // strain, which is what a bigger striker actually does.
    const cWave = cWaveEarly;
    const vCap = vTarget;
    const saturated = v0 > vCap;
    if (saturated) v0 = vCap;

    let impulse = 0;

    // Prescribed-velocity contact: the striker holds the surface moving at
    // the target speed for the contact duration. Energy goes in continuously
    // instead of as a single kick, which is what builds up the stored strain
    // field a running crack needs.
    const nodes = new Int32Array(hit.length);
    const target = new Float32Array(hit.length * 3);
    for (let i = 0; i < hit.length; i++) {
      const n = hit[i];
      const w = weights[i];
      const v = v0 * w;
      nodes[i] = n;
      target[i * 3] = dx * v;
      target[i * 3 + 1] = dy * v;
      target[i * 3 + 2] = dz * v;
      impulse += L.mass[n] * v;
    }

    this.contacts.push({
      nodes, target,
      stepsRemaining: contactSteps,
      totalSteps: contactSteps,
      radius,
    });

    // A small initial kick so the wave starts immediately rather than ramping
    // from zero over the first few substeps.
    this.applyContactVelocity(0.35);

    return {
      nodesAffected: hit.length,
      impulse,
      strainRatio: (v0 / cWave) / Math.max(1e-12, L.response.sc),
      velocity: v0,
      saturated,
    };
  }

  /** Wave speed used for the strain estimate, m/s. */
  get waveSpeed(): number {
    const L = this.lattice;
    return Math.sqrt(L.response.E / Math.max(1e-6, L.mass[0] / (L.spacing ** 3)));
  }

  /** Strain ratio a given impact energy would produce (for the HUD). */
  strainRatioFor(energy: number, radius: number): number {
    const L = this.lattice;
    const r2 = radius * radius;
    let totalMass = 0, n = 0;
    for (let i = 0; i < L.count; i++) {
      if (L.pinned[i]) continue;
      const px = L.pos[i * 3] - L.pos[0], py = L.pos[i * 3 + 1] - L.pos[1], pz = L.pos[i * 3 + 2] - L.pos[2];
      const d2 = px * px + py * py + pz * pz;
      if (d2 > r2) continue;
      totalMass += L.mass[i] * Math.exp(-3.5 * (d2 / r2));
      n++;
    }
    if (n === 0 || totalMass <= 0) return 0;
    const v0 = Math.sqrt((2 * Math.max(energy, 0)) / (totalMass * n * 0.5));
    return (v0 / this.waveSpeed) / Math.max(1e-12, L.response.sc);
  }

  /** Pin the nodes inside a slab (window frame, wall footing). */
  pinRegion(min: [number, number, number], max: [number, number, number]): number {
    const L = this.lattice;
    let n = 0;
    for (let i = 0; i < L.count; i++) {
      const x = L.pos[i * 3], y = L.pos[i * 3 + 1], z = L.pos[i * 3 + 2];
      if (x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1] && z >= min[2] && z <= max[2]) {
        L.pinned[i] = 1;
        L.vel[i * 3] = L.vel[i * 3 + 1] = L.vel[i * 3 + 2] = 0;
        n++;
      }
    }
    return n;
  }

  /**
   * Advance the simulation by `wallSeconds` of simulated time, respecting the
   * substep budget. Returns the number of substeps actually taken.
   */
  advance(wallSeconds: number, dtOverride?: number): number {
    const t0 = performance.now();
    const dt = (dtOverride ?? this.dt) * this.opts.timeScale;
    // contact patches run at the natural timestep regardless of time dilation
    const rawDt = dtOverride ?? this.dt;
    let remaining = wallSeconds;
    let substeps = 0;
    let sinceContactUpdate = 0;

    while (remaining > 1e-12 && substeps < this.opts.maxSubsteps) {
      const h = Math.min(dt, remaining);
      if (this.contacts.length) {
        // sub-divide so the striker BC is sampled at the stable timestep
        const nSub = Math.max(1, Math.min(32, Math.round(h / rawDt)));
        const hs = h / nSub;
        for (let s = 0; s < nSub; s++) this.stepOnce(hs);
        sinceContactUpdate++;
      } else {
        this.stepOnce(h);
      }
      remaining -= h;
      substeps++;
    }
    void sinceContactUpdate;

    this.solveTime += (performance.now() - t0) / 1000;
    return substeps;
  }

  /** Drive the active contact patches at a given fraction of their target. */
  private applyContactVelocity(fraction: number): void {
    const L = this.lattice;
    for (const c of this.contacts) {
      for (let i = 0; i < c.nodes.length; i++) {
        const n = c.nodes[i];
        L.vel[n * 3] = c.target[i * 3] * fraction;
        L.vel[n * 3 + 1] = c.target[i * 3 + 1] * fraction;
        L.vel[n * 3 + 2] = c.target[i * 3 + 2] * fraction;
      }
    }
  }

  /** Number of strikers currently in contact. */
  get activeContacts(): number {
    return this.contacts.length;
  }

  /** One velocity-Verlet step. */
  stepOnce(dt: number): void {
    const L = this.lattice;
    const { pos, vel, acc, mass, pinned, bondNode, bondRest, bondK, bondCrit, bondBroken, bondScale, bondPlastic } = L;
    const resp = L.response;
    const damp = Math.exp(-this.opts.damping * dt);

    // --- striker boundary condition ---------------------------------------
    // The patch velocity is prescribed (not accumulated) while the striker is
    // in contact, so the indenter cannot be pushed back by the elastic
    // reaction of the plate.
    if (this.contacts.length) {
      for (const c of this.contacts) {
        // triangular velocity profile: out and back, like a real bounce
        const phase = 1 - c.stepsRemaining / Math.max(1, c.totalSteps);
        const frac = Math.sin(Math.PI * Math.min(1, phase * 1.15));
        this.applyContactVelocity(Math.max(0.15, frac));
        c.stepsRemaining--;
      }
      for (let i = this.contacts.length - 1; i >= 0; i--) {
        if (this.contacts[i].stepsRemaining <= 0) this.contacts.splice(i, 1);
      }
    }

    // --- half kick --------------------------------------------------------
    for (let n = 0; n < L.count; n++) {
      if (pinned[n]) { vel[n * 3] = vel[n * 3 + 1] = vel[n * 3 + 2] = 0; continue; }
      vel[n * 3] = (vel[n * 3] + acc[n * 3] * 0.5 * dt) * damp;
      vel[n * 3 + 1] = (vel[n * 3 + 1] + acc[n * 3 + 1] * 0.5 * dt) * damp;
      vel[n * 3 + 2] = (vel[n * 3 + 2] + acc[n * 3 + 2] * 0.5 * dt) * damp;
    }

    // --- drift ------------------------------------------------------------
    for (let n = 0; n < L.count; n++) {
      if (pinned[n]) continue;
      pos[n * 3] += vel[n * 3] * dt;
      pos[n * 3 + 1] += vel[n * 3 + 1] * dt;
      pos[n * 3 + 2] += vel[n * 3 + 2] * dt;
    }

    // --- force evaluation + bond failure ----------------------------------
    acc.fill(0);

    const count = L.bondCount;
    const yieldStrain = resp.yieldStrain;
    const residual = resp.plasticResidual;
    const compression = resp.compressionFactor;
    const bondDamage = L.bondDamage;
    // Process-zone kinetics scale with how close the strain is to failure.
    const damageRate = dt * this.opts.damageRate;

    for (let b = 0; b < count; b++) {
      if (bondBroken[b]) continue;

      const a = bondNode[b * 2];
      const c = bondNode[b * 2 + 1];

      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];

      let rx = cx - ax, ry = cy - ay, rz = cz - az;
      const r = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (r < 1e-12) continue;
      const invR = 1 / r;
      rx *= invR; ry *= invR; rz *= invR;

      const rest = bondRest[b];
      const s = (r - rest) / rest;   // > 0 tension, < 0 compression

      // --- process zone (micro-damage) ----------------------------------
      // Accumulate where the bond is loaded well past half its strength and
      // is actually opening; let it relax when the load drops away, which is
      // what lets a crack close behind itself under a passing unload wave.
      let dmg = bondDamage[b];
      if (s > 0) {
        const over = s / bondCrit[b] - 0.45;
        if (over > 0) {
          dmg = Math.min(1, dmg + over * damageRate);
          // Stiffness and strength both degrade — this is the softening
          // branch that lets the crack tip advance at finite resolution.
          const soften = 1 - 0.80 * dmg;
          const effCrit = bondCrit[b] * (1 - 0.72 * dmg);
          if (s > effCrit) {
            bondBroken[b] = 1;
            const tallyA = ++this.brokenTally[a];
            const tallyC = ++this.brokenTally[c];
            L.damage[a] = tallyA / L.nodeBondCount[a];
            L.damage[c] = tallyC / L.nodeBondCount[c];
            continue;
          }
          bondDamage[b] = dmg;
          bondScale[b] = soften;
        } else if (dmg > 0) {
          bondDamage[b] = Math.max(0, dmg - damageRate * 0.35);
          bondScale[b] = 1 - 0.80 * bondDamage[b];
        }
      }

      // --- crushing (compressive failure / spall) -----------------------
      if (s < -bondCrit[b] * compression) {
        bondBroken[b] = 1;
        const tallyA = ++this.brokenTally[a];
        const tallyC = ++this.brokenTally[c];
        L.damage[a] = tallyA / L.nodeBondCount[a];
        L.damage[c] = tallyC / L.nodeBondCount[c];
        continue;
      }

      // --- plasticity (ductile materials) -------------------------------
      let scale = bondScale[b];
      if (yieldStrain !== Infinity) {
        const mag = Math.abs(s);
        if (mag > yieldStrain) {
          const plastic = Math.min(1, bondPlastic[b] + (mag - yieldStrain) * 14);
          bondPlastic[b] = plastic;
          scale = Math.min(scale, 1 - (1 - residual) * plastic);
          bondScale[b] = scale;
        }
      }

      // --- force --------------------------------------------------------
      const mag = bondK[b] * scale * s;

      const fx = mag * rx, fy = mag * ry, fz = mag * rz;
      const ia = a * 3, ic = c * 3;
      acc[ia] += fx / mass[a];
      acc[ia + 1] += fy / mass[a];
      acc[ia + 2] += fz / mass[a];
      acc[ic] -= fx / mass[c];
      acc[ic + 1] -= fy / mass[c];
      acc[ic + 2] -= fz / mass[c];
    }

    // --- second half kick -------------------------------------------------
    for (let n = 0; n < L.count; n++) {
      if (pinned[n]) continue;
      vel[n * 3] += acc[n * 3] * 0.5 * dt;
      vel[n * 3 + 1] += acc[n * 3 + 1] * 0.5 * dt;
      vel[n * 3 + 2] += acc[n * 3 + 2] * 0.5 * dt;
    }

    // Cheap guard against the rare blow-up: clamp runaway velocity.
    const vmax = 0.35 * L.spacing * 1e4;
    for (let n = 0; n < L.count * 3; n++) {
      const v = vel[n];
      if (v > vmax) vel[n] = vmax;
      else if (v < -vmax) vel[n] = -vmax;
    }

    this.stepCount++;
  }

  /**
   * Islands = connected components of the *unbroken bond graph*.
   *
   * This is the physically correct definition of a fragment: two material
   * points belong to the same rigid body iff there is still a load path between
   * them. When the last bond across a crack face snaps, the island count jumps
   * and the body falls apart — with no authored fracture levels anywhere.
   *
   * Returns per-node island ids (compacted, 0..k-1) and the population of each.
   */
  findIslands(): { ids: Int32Array; counts: Uint32Array; islandCount: number } {
    const L = this.lattice;
    const parent = this.ufParent;
    const rank = this.ufRank;

    for (let i = 0; i < L.count; i++) {
      parent[i] = i;
      rank[i] = 0;
    }

    const find = (x: number): number => {
      let root = x;
      while (parent[root] !== root) root = parent[root];
      while (parent[x] !== root) { const next = parent[x]; parent[x] = root; x = next; }
      return root;
    };
    const union = (a: number, b: number): void => {
      const ra = find(a), rb = find(b);
      if (ra === rb) return;
      if (rank[ra] < rank[rb]) parent[ra] = rb;
      else if (rank[ra] > rank[rb]) parent[rb] = ra;
      else { parent[rb] = ra; rank[ra]++; }
    };

    const bn = L.bondNode;
    const broken = L.bondBroken;
    for (let b = 0; b < L.bondCount; b++) {
      if (broken[b]) continue;
      union(bn[b * 2], bn[b * 2 + 1]);
    }

    // Compact the roots into dense ids.
    const ids = new Int32Array(L.count).fill(-1);
    const rootToId = new Int32Array(L.count).fill(-1);
    let islandCount = 0;
    for (let i = 0; i < L.count; i++) {
      const r = find(i);
      if (rootToId[r] < 0) rootToId[r] = islandCount++;
      ids[i] = rootToId[r];
    }

    const counts = new Uint32Array(islandCount);
    for (let i = 0; i < L.count; i++) counts[ids[i]]++;
    return { ids, counts, islandCount };
  }

  /** Discard fragments below `minNodes` by re-welding them into their largest neighbour. */
  static pruneIslands(
    ids: Int32Array, counts: Uint32Array, islandCount: number, minNodes: number,
  ): { ids: Int32Array; counts: Uint32Array; islandCount: number } {
    if (islandCount === 0) return { ids, counts, islandCount };
    let biggest = 0;
    for (let i = 1; i < islandCount; i++) if (counts[i] > counts[biggest]) biggest = i;
    let changed = false;
    for (let i = 0; i < ids.length; i++) {
      if (counts[ids[i]] < minNodes) { ids[i] = biggest; changed = true; }
    }
    if (!changed) return { ids, counts, islandCount };
    const remap = new Int32Array(islandCount).fill(-1);
    let n = 0;
    for (let i = 0; i < islandCount; i++) {
      if (counts[i] >= minNodes || i === biggest) remap[i] = n++;
    }
    const newIds = new Int32Array(ids.length);
    const newCounts = new Uint32Array(n);
    for (let i = 0; i < ids.length; i++) {
      const id = remap[ids[i]];
      newIds[i] = id;
      newCounts[id]++;
    }
    return { ids: newIds, counts: newCounts, islandCount: n };
  }
}

export { clamp };
