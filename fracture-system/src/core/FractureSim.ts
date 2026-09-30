/**
 * ============================================================================
 *  FractureSim — the coupled simulation
 * ============================================================================
 *
 *  This is the piece that makes the difference between "a stress solve" and
 *  "a fracture". Two solvers have to be *coupled in time*:
 *
 *     peridynamics  dt ~ dx / c_p          (elastic wave crossing one cell)
 *     crack fronts  dt ~ dx / (0.5 c_R)    (crack crossing one cell)
 *
 *  Running them in sequence (solve the whole event, then propagate cracks)
 *  does not work: by the time the wave has settled, the stress that drove the
 *  crack is gone. The crack has to be fed the *transient* field. So we
 *  interleave — a few elastic steps, one crack step — which is exactly how
 *  explicit crack-front codes (and PhysX/Havok destruction) do it.
 *
 *  The consequence is the behaviour you actually want to see:
 *    - cracks appear at the impact and race outward,
 *    - the reflected wave from the far surface comes back and spawns a
 *      *second* generation of cracks (that is where a glass sheet gets its
 *      concentric rings from),
 *    - cracks that run out of driving stress stop mid-flight and stay put.
 * ============================================================================
 */

import { buildLattice } from '../peridynamics/Lattice.ts';
import type { Lattice } from '../peridynamics/Lattice.ts';
import { PeridynamicsSolver } from '../peridynamics/Solver.ts';
import { StressField, principal } from '../peridynamics/Stress.ts';
import type { Principal } from '../peridynamics/Stress.ts';
import { CrackNetwork } from '../fracture/CrackNetwork.ts';
import type { CrackSample, Vec3 } from '../fracture/CrackNetwork.ts';
import { carve } from '../fracture/Carver.ts';
import type { CarveResult, CarveSegment } from '../fracture/Carver.ts';
import { evalSDF, makePrefab, sdfNormal } from '../sdf/SDF.ts';
import type { PrefabShape, SDFNode } from '../sdf/SDF.ts';
import { MATERIAL_PARAMS, MaterialType } from '../materials.ts';
import type { FractureParameters } from '../materials.ts';

// ---------------------------------------------------------------------------
// Per-material tuning that is *not* a mechanical constant: how the material
// dissipates, how heterogeneous it is, and how its fracture surface reads.
// ---------------------------------------------------------------------------

export interface MaterialLook {
  /** Material index used by the solver, carver and shaders (stable!). */
  id: number;
  /** 0 = pristine homogeneous, 1 = wildly heterogeneous. */
  heterogeneity: number;
  /** Process-zone kinetics. High = sharp brittle cracks, low = diffuse. */
  damageRate: number;
  /** Fracture-surface relief amplitude, as a fraction of the aperture. */
  faceRoughness: number;
  /** Frequency of that relief relative to the object size. */
  faceRoughnessScale: number;
  /** Colour ramp for fracture faces (shader input). */
  interiorTint: [number, number, number];
  glassLike: boolean;
}

/**
 * Time-rescaling factor, the single knob that trades physical fidelity for
 * wall-clock speed. Applied uniformly to E, ρ and K_IC so that every
 * dimensionless group that decides the *shape* of the fracture is preserved
 * while the speed of sound drops by sqrt(SOFTENING).
 *
 * 60 => the whole event runs ~7.7x slower than reality, which is what makes a
 * 200 microsecond glass break watchable at 60 fps without any slow-motion
 * hack in the playback.
 */
export const SOFTENING = 60;

/** Neutral principal stresses — used when a sample lands outside the body. */
const ZERO_PRINCIPAL: Principal = {
  values: [0, 0, 0],
  vectors: [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
};

export const MATERIAL_LOOKS: Record<MaterialType, MaterialLook> = {
  [MaterialType.GLASS]: {
    id: 0, heterogeneity: 0.20, damageRate: 1400,
    faceRoughness: 0.05, faceRoughnessScale: 0.35,
    interiorTint: [0.75, 0.85, 0.85], glassLike: true,
  },
  [MaterialType.WOOD]: {
    id: 1, heterogeneity: 0.55, damageRate: 500,
    faceRoughness: 0.55, faceRoughnessScale: 0.30,
    interiorTint: [0.62, 0.46, 0.26], glassLike: false,
  },
  [MaterialType.CONCRETE]: {
    id: 2, heterogeneity: 0.80, damageRate: 700,
    faceRoughness: 0.50, faceRoughnessScale: 0.35,
    interiorTint: [0.68, 0.66, 0.62], glassLike: false,
  },
  [MaterialType.PLASTIC]: {
    id: 3, heterogeneity: 0.12, damageRate: 260,
    faceRoughness: 0.28, faceRoughnessScale: 0.30,
    interiorTint: [0.85, 0.85, 0.88], glassLike: false,
  },
  [MaterialType.ROCK]: {
    id: 4, heterogeneity: 0.65, damageRate: 800,
    faceRoughness: 0.42, faceRoughnessScale: 0.30,
    interiorTint: [0.55, 0.53, 0.50], glassLike: false,
  },
};

export interface SimConfig {
  material: MaterialType;
  shape: PrefabShape;
  /** Full extents in metres. */
  size: [number, number, number];
  /** 1 (coarse, fast) .. 5 (fine, slow). Sets the lattice spacing. */
  detail: number;
  /** Direction of the grain / bedding plane. */
  grainAxis: Vec3;
  /** Deterministic RNG seed for the crack network. */
  seed: number;
  /** Fix the rim, like glass in a frame or a beam in a wall. */
  anchored: boolean;
  /**
   * Calibration of the effective dynamic toughness, as a fraction of K_IC.
   *
   * Why this exists, honestly: a real pane of glass shatters because a striker
   * loads a *thin, deflected plate* and the near-tip field is enormously
   * amplified by the plate's bending geometry and by the dynamic stress
   * intensity factor — neither of which a 20-cell-thick lattice resolves. Using
   * the handbook static K_IC in that situation under-predicts propagation by
   * roughly an order of magnitude and you get a crack that runs 20 mm and
   * stalls, which is not what glass does.
   *
   * Rather than fudge the material constants or the strain scale, we keep all
   * of them physical and put the correction here, in one place, as a tunable
   * "dynamic toughness factor". Calibrate it once against reference footage of
   * the material you care about: the *pattern* statistics (radial crack count,
   * fragment size distribution, branch angles) come out right across a wide
   * range of this value, because those are governed by the stress field shape,
   * not its absolute magnitude.
   */
  toughnessScale: number;
}

export interface SimStats {
  state: 'intact' | 'fracturing' | 'settled';
  latticeNodes: number;
  latticeBonds: number;
  wallSeconds: number;
  substeps: number;
  msPerSubstep: number;
  damage: number;
  crackFronts: number;
  activeFronts: number;
  crackLength: number;
  maxCrackSpeed: number;
  fragments: number;
}

export class FractureSim {
  readonly cfg: SimConfig;
  readonly material: FractureParameters;
  readonly look: MaterialLook;
  readonly object: SDFNode;
  readonly half: Vec3;
  readonly spacing: number;

  readonly lattice: Lattice;
  readonly solver: PeridynamicsSolver;
  readonly field: StressField;
  readonly network: CrackNetwork;

  /** Cached stress buffer, refreshed every coupling step. */
  private stressBuf: Float32Array;
  /** Physical time simulated so far, seconds. */
  time = 0;
  state: 'intact' | 'fracturing' | 'settled' = 'intact';
  substeps = 0;
  wallSeconds = 0;
  /** Coupling iterations consumed so far — the event budget. */
  private iterations = 0;
  /**
   * How many crack segments have already been fed back into the lattice.
   * Only new segments are processed, so the coupling costs O(new geometry).
   */
  private fedSegments = 0;

  /** Extra carve volumes (Hertzian crush cone, etc.). */
  private crushVolumes: { center: Vec3; radius: number; flatten: number }[] = [];

  constructor(cfg: SimConfig) {
    this.cfg = cfg;
    this.material = MATERIAL_PARAMS[cfg.material];
    this.look = MATERIAL_LOOKS[cfg.material];

    const [sx, sy, sz] = cfg.size;
    this.half = [sx * 0.5, sy * 0.5, sz * 0.5];
    this.object = makePrefab(cfg.shape, cfg.size);

    // Lattice spacing: split the longest axis, but never let the *shortest*
    // axis fall below 4 cells or the body cannot bend or shear properly.
    const detail = Math.max(1, Math.min(5, cfg.detail));
    const target = [14, 17, 20, 24, 28][detail - 1];
    const longest = Math.max(sx, sy, sz);
    const shortest = Math.min(sx, sy, sz);
    // The shortest axis needs enough cells to bend and shear at all, but the
    // *total* node count is what the wall-clock cost scales with, so clamp the
    // resolution when an object is close to cubic.
    let spacing = Math.min(longest / target, shortest / 2.5);
    const approxNodes = (sx / spacing) * (sy / spacing) * (sz / spacing);
    const MAX_NODES = 26000;
    if (approxNodes > MAX_NODES) spacing *= Math.cbrt(approxNodes / MAX_NODES);
    this.spacing = spacing;

    this.lattice = buildLattice(this.object, {
      center: [0, 0, 0],
      halfSize: this.half,
      spacing: this.spacing,
      horizon: 2,
      material: this.material,
      grainAxis: cfg.grainAxis,
      heterogeneity: this.look.heterogeneity,
      softening: SOFTENING,
      jitter: 0.22,
      materialId: this.look.id,
    });

    this.solver = new PeridynamicsSolver(this.lattice, {
      damping: 0.45,
      damageRate: this.look.damageRate,
      maxSubsteps: 1 << 30,
    });
    this.field = new StressField(this.lattice, this.solver);
    this.stressBuf = new Float32Array(this.lattice.count * 6);

    this.network = new CrackNetwork({
      rayleighSpeed: this.rayleighSpeed,
      spacing: this.spacing,
      toughness: this.effectiveToughness * this.cfg.toughnessScale,
      material: this.material,
      grainAxis: cfg.grainAxis,
      materialId: this.look.id,
      maxFronts: 120,
      rngSeed: cfg.seed,
      outside: (p) => evalSDF(this.object, p[0], p[1], p[2]),
    });

    if (cfg.anchored) this.anchorRim();
  }

  // ── derived material properties ───────────────────────────────────────

  /** Dilatational wave speed of the *softened* material the solver runs. */
  get waveSpeed(): number {
    return Math.sqrt(this.lattice.response.E / this.material.density);
  }

  /** Rayleigh wave speed — the terminal speed of a crack front. */
  get rayleighSpeed(): number {
    const G = this.lattice.response.E / (2 * (1 + this.material.poissonRatio));
    return 0.92 * Math.sqrt(G / this.material.density);
  }

  /** How long the whole fracture event takes, seconds (physical). */
  get eventDuration(): number {
    return (2.5 * Math.max(...this.cfg.size)) / Math.max(1e-6, this.rayleighSpeed * 0.5);
  }

  get maxCrackIterations(): number {
    return Math.ceil(this.eventDuration / this.crackDt) + 8;
  }

  get crackDt(): number {
    return (this.spacing * 0.9) / Math.max(1e-6, this.rayleighSpeed * 0.55);
  }

  /**
   * Fracture toughness as seen by the *rescaled* material.
   *
   * The solver runs E/φ and G_f/φ so that the failure strain s_c and the
   * process-zone size r_p = (K_IC/σ_y)² are both unchanged — a pure time
   * rescale, which is what lets a coarse lattice produce the same crack
   * pattern as a fine one. But K_IC must be rescaled with it, K_IC -> K_IC/φ.
   * Miss this and the driving stress (∝ E/φ) falls below the propagation
   * stress K_IC/sqrt(πa/2) and *nothing ever fractures* — which is exactly
   * the symptom that makes naive implementations give up on real physics.
   */
  get effectiveToughness(): number {
    return (this.material.fractureToughness * 1e6) / SOFTENING;
  }

  /** How many elastic substeps per crack step. */
  private get substepsPerCrackStep(): number {
    return Math.max(1, Math.round(this.crackDt / this.solver.dt));
  }

  private anchorRim(): void {
    const H = this.half;
    const t = this.spacing * 1.2;
    const max = [H[0], H[1], H[2]];
    const min = [-H[0], -H[1], -H[2]];
    // pin the two faces with the smallest extent (the rim of a pane / the ends
    // of a beam), leaving the rest free
    if (this.cfg.shape === 'plate') {
      this.solver.pinRegion([min[0], min[1], min[2] - t], [max[0], max[1], min[2] + t]);
      this.solver.pinRegion([min[0], min[1], max[2] - t], [max[0], max[1], max[2] + t]);
    } else if (this.cfg.shape === 'beam') {
      this.solver.pinRegion([min[0], min[1], min[2]], [min[0] + t, max[1], max[2]]);
      this.solver.pinRegion([max[0] - t, min[1], min[2]], [max[0], max[1], max[2]]);
    }
  }

  // ── driving the simulation ────────────────────────────────────────────

  /**
   * Deliver an impact.
   *
   * `severity` is eps_induced / s_c — the only number that decides whether you
   * get a chip, a star of radial cracks, or a pulverised contact zone:
   *   0.5-1  nothing / paint damage      1-4  a few cracks
   *   4-10   full star fracture          10+  crushed core + full shatter
   */
  triggerImpact(
    rawPoint: Vec3,
    direction: Vec3,
    energy: number,
    severity: number,
    radiusScale = 1.8,
  ): { velocity: number; strainRatio: number; nodes: number } {
    // Clamp the strike point inside the body first. A contact that lands a
    // millimetre outside the free surface finds no material points at all, and
    // the failure mode of that mistake is *silent*: severity is reported as 0,
    // the crack count falls back to the minimum, and every front dies
    // immediately. (Every preset in this demo hit exactly this until the
    // clamp was added.)
    const point = this.clampInside(rawPoint);

    const radius = this.spacing * radiusScale;
    // Contact time.
    //
    // The naive choice (acoustic transit across the contact patch, ~90 us here)
    // makes the strike a *transient*: the wave rings out and is gone before the
    // crack can use it, and the crack stalls 20 mm from the impact. A real
    // striker on a plate stays in contact for a good fraction of the plate's
    // own bending period — hundreds of microseconds to milliseconds — and the
    // plate ends up holding a large stored strain field. That stored energy is
    // what a running crack actually consumes, so we scale the contact with the
    // object's structural response instead of with the contact patch.
    const contactSteps = Math.max(
      8,
      Math.round((0.05 * this.eventDuration) / this.solver.dt),
    );
    const res = this.solver.applyImpact(point, direction, energy, radius, severity, contactSteps);
    this.state = 'fracturing';

    // Seed the radial crack family. Sample the *hoop* stress on the contact
    // circle — that is where a Hertzian contact actually nucleates cracks.
    //
    // The seeds then have to be clamped back inside the body: on a thin pane a
    // contact near the surface throws half of the candidate points into empty
    // space, where the stress sampler reads zero and every crack dies before
    // it starts. (Symptoms: "fracture never propagates, no fragments".)
    const pr = this.samplePrincipal(point) ?? ZERO_PRINCIPAL;
    const count = this.network.seedImpact(
      { position: point, direction, energy, contactArea: Math.PI * radius * radius },
      pr,
      res.strainRatio,
      radius * 1.25,
      Math.max(...this.half),
    );

    // Re-place any seed that ended up outside, and align its crack plane with
    // the measured maximum principal stress direction rather than the purely
    // geometric hoop. Same crack count, but now they start where the material
    // is actually being pulled apart.
    for (const f of this.network.fronts) {
      if (f.stoppedReason !== '' || f.length > this.spacing * 4) continue;   // only the family just seeded
      f.seed = this.clampInside(f.seed);
      f.tip = [...f.seed] as Vec3;
      f.path = [[...f.seed] as Vec3];
      const sp = this.samplePrincipal(f.tip);
      if (sp && sp.values[0] > 0) {
        const dotN = sp.vectors[0][0] * f.normal[0] + sp.vectors[0][1] * f.normal[1] + sp.vectors[0][2] * f.normal[2];
        if (Math.abs(dotN) > 0.2) f.normal = [...sp.vectors[0]] as Vec3;
      }
      f.normals = [[...f.normal] as Vec3];
    }

    // Violent hits pulverise the contact zone (Hertzian cone). We model that
    // as an explicit crush volume rather than hoping the lattice resolves it.
    // The crushed core is only a few times the contact radius — it is the
    // Hertzian cone right under the striker, not a crater the size of the
    // object. (Scaling this with severity instead of with the contact patch
    // carves away most of the body and you find yourself "shattering" a brick
    // into a single small pebble.)
    if (severity > 9) {
      this.crushVolumes.push({
        center: [...point] as Vec3,
        radius: radius * Math.min(2.2, 1.0 + severity * 0.04),
        flatten: this.cfg.shape === 'plate' ? 0.7 : 1.0,
      });
    }

    return { velocity: res.velocity, strainRatio: res.strainRatio, nodes: res.nodesAffected + count };
  }

  /**
   * Move a point just inside the body by stepping along the SDF gradient.
   *
   * Stepping towards the object centre instead (the obvious first attempt)
   * drags the point a long way sideways — on a thin pane it moved seeds 17 cm
   * down the plate while only 2 cm was needed — so the crack then started in
   * a completely different stress regime than the one that was sampled.
   */
  clampInside(p: Vec3): Vec3 {
    const q: Vec3 = [...p] as Vec3;
    for (let i = 0; i < 8; i++) {
      const d = evalSDF(this.object, q[0], q[1], q[2]);
      if (d < -this.spacing * 0.35) return q;
      const n = sdfNormal(this.object, q[0], q[1], q[2]);
      const step = d + this.spacing * 0.5;
      q[0] -= n[0] * step;
      q[1] -= n[1] * step;
      q[2] -= n[2] * step;
    }
    return q;
  }

  private readonly principalScratch: Principal = {
    values: [0, 0, 0],
    vectors: [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
  };

  private readonly stressScratch: {
    xx: number; yy: number; zz: number; xy: number; yz: number; zx: number;
  } = { xx: 0, yy: 0, zz: 0, xy: 0, yz: 0, zx: 0 };

  /** Peak opening stress + direction + state, evaluated over the process zone. */
  sampleCrack(p: Vec3, normal: Vec3): CrackSample {
    const dir: Vec3 = [normal[0], normal[1], normal[2]];
    const sigma = this.field.peakOpeningStress(p, normal, this.spacing * 2.2, dir, this.principalScratch);
    return { sigma, normal: dir, principal: this.principalScratch };
  }

  private samplePrincipal(p: Vec3): Principal | null {
    if (this.field.nearest(p) < 0) return null;
    this.field.averagedPrincipal(this.stressScratch, p, this.spacing * 1.6);
    return principal(this.stressScratch);
  }

  /**
   * Advance the coupled simulation by up to `budgetMs` of wall-clock time.
   * Returns true while the event is still running. Designed to be called once
   * per animation frame so the UI stays interactive.
   */
  advance(budgetMs: number): boolean {
    if (this.state !== 'fracturing') return false;
    const t0 = performance.now();
    const sub = this.substepsPerCrackStep;
    let iterations = 0;

    while (performance.now() - t0 < budgetMs) {
      if (this.iterations >= this.maxCrackIterations) { this.state = 'settled'; break; }
      for (let i = 0; i < sub; i++) {
        this.solver.stepOnce(this.solver.dt);
        this.substeps++;
      }
      this.time += sub * this.solver.dt;

      this.feedCracksIntoPhysics();
      this.stressBuf = this.field.build(this.stressBuf);

      const st = this.network.step(
        this.crackDt,
        (p, nrm) => this.sampleCrack(p, nrm),
        Math.max(...this.half),
      );

      // Secondary nucleation. This is the mechanism behind the concentric
      // ring cracks in broken glass, the spall cracks under a concrete impact
      // and the chips around a rock strike — and, critically, it is what turns
      // a fan of independent radial cracks into a *connected network* that can
      // actually separate the body into fragments. Without it you get radial
      // cracks that all reach the free surface and still leave one piece,
      // which is correct physics for a single crack and useless for a game.
      if (iterations > 2) {
        this.seedFromField(this.network.fronts.length < 40 ? 2 : 1);
      }

      iterations++;
      this.iterations++;
      if (st.active === 0) {
        this.state = 'settled';
        break;
      }
    }

    this.wallSeconds += (performance.now() - t0) / 1000;
    return this.state === 'fracturing';
  }

  /**
   * Push every newly propagated crack segment into the lattice as bond
   * degradation. This closes the loop: crack fronts damage the material,
   * damaged material concentrates stress at the tip, and the tip is what the
   * next crack step reads.
   *
   * The lateral extent is deliberately larger than the segment itself: once a
   * crack has passed, the material either side of it is free, so the bonds
   * across the plane must go all the way out to the free surfaces.
   */
  private feedCracksIntoPhysics(): void {
    const segs = this.network.segments;
    if (this.fedSegments >= segs.length) return;
    const lateral = Math.max(...this.half) * 1.3;
    for (let i = this.fedSegments; i < segs.length; i++) {
      const s = segs[i];
      const front = this.network.fronts[s.id];
      // A front within its process zone softens rather than severs, which
      // gives the tip a cohesive zone instead of an instant free surface.
      const isTip = front ? front.active && i >= segs.length - 2 : false;
      const soften = isTip ? 0.45 : 1;
      this.lattice.breakBondsNear(s.a, s.b, s.n, s.aperture * 0.6 + this.spacing * 0.35, lateral, soften);
    }
    this.fedSegments = segs.length;
  }

  /**
   * Scan the stress field for un-cracked tensile hot spots and nucleate there.
   * Cheap because it only looks at every 4th node.
   */
  private seedFromField(maxNew: number): void {
    const L = this.lattice;
    // Nucleate wherever the field exceeds a modest fraction of the material's
    // tensile strength. Set this to 1.0x and you get almost no secondary
    // cracking (only the single hottest node qualifies); set it much below
    // ~0.4x and the body fizzes into dust.
    const threshold = this.lattice.response.sc * L.response.E * 0.14;
    const cands: { p: Vec3; stress: number; dir: Vec3 }[] = [];
    for (let i = 0; i < L.count; i += 3) {
      const s = {
        xx: this.stressBuf[i * 6], yy: this.stressBuf[i * 6 + 1], zz: this.stressBuf[i * 6 + 2],
        xy: this.stressBuf[i * 6 + 3], yz: this.stressBuf[i * 6 + 4], zx: this.stressBuf[i * 6 + 5],
      };
      const pr = principal(s);
      if (pr.values[0] < threshold) continue;
      cands.push({ p: [L.pos[i * 3], L.pos[i * 3 + 1], L.pos[i * 3 + 2]], stress: pr.values[0], dir: pr.vectors[0] });
    }
    if (cands.length === 0) return;
    cands.sort((a, b) => b.stress - a.stress);
    this.network.seedSecondary(cands, threshold, maxNew);
  }

  // ── geometry ──────────────────────────────────────────────────────────

  /** Build fragment geometry from the crack network. */
  carveFragments(resolutionOverride?: number): CarveResult {
    const segments: CarveSegment[] = [];
    for (const s of this.network.segments) {
      const front = this.network.fronts[s.id];
      segments.push({
        a: s.a, b: s.b, n: s.n, aperture: s.aperture,
        origin: front ? front.seed : s.a,
        id: s.id,
      });
    }
    // Crush cones add a spall cavity at the contact.
    for (const c of this.crushVolumes) {
      // Approximate a cone as a short fan of ribbons radiating from the centre.
      const dirs = 6;
      for (let i = 0; i < dirs; i++) {
        const ang = (i / dirs) * Math.PI * 2;
        const t: Vec3 = [Math.cos(ang), Math.sin(ang), 0];
        const a = c.center;
        const b: Vec3 = [
          c.center[0] + t[0] * c.radius * c.flatten,
          c.center[1] + t[1] * c.radius * c.flatten,
          c.center[2] + t[2] * c.radius * c.flatten,
        ];
        segments.push({ a, b, n: [0, 0, 1], aperture: c.radius * 0.22, origin: c.center, id: 9999 });
      }
    }

    const res = resolutionOverride ?? Math.min(84, Math.max(40, Math.round(Math.max(...this.cfg.size) / this.spacing) * 3));
    const b = this.half;
    return carve({
      object: this.object,
      bounds: { min: [-b[0], -b[1], -b[2]], max: [b[0], b[1], b[2]] },
      resolution: res,
      segments,
      materialId: this.look.id,
      density: this.material.density,
      faceRoughness: this.look.faceRoughness,
      faceRoughnessScale: 1 / (Math.max(...this.cfg.size) * this.look.faceRoughnessScale),
      grainAxis: this.cfg.grainAxis,
      drawAxis: [1, 0, 0],
      minFragmentVolume: Math.max(1e-9, Math.min(...this.cfg.size) ** 2 * 4e-4),
    });
  }

  /** Damage at the lattice node nearest a point, 0..1 — used by shaders. */
  damageAt(p: Vec3): number {
    const i = this.field.nearest(p);
    return i < 0 ? 0 : this.lattice.damage[i];
  }

  stats(): SimStats {
    const st = this.network.stats();
    return {
      state: this.state,
      latticeNodes: this.lattice.count,
      latticeBonds: this.lattice.bondCount,
      wallSeconds: this.wallSeconds,
      substeps: this.substeps,
      msPerSubstep: this.substeps ? (this.wallSeconds * 1000) / this.substeps : 0,
      damage: this.lattice.meanDamage(),
      crackFronts: st.total,
      activeFronts: st.active,
      crackLength: st.totalLength,
      maxCrackSpeed: st.maxSpeed,
      fragments: 0,
    };
  }

  reset(): void {
    this.lattice.reset();
    this.network.fronts.length = 0;
    this.network.segments.length = 0;
    this.crushVolumes.length = 0;
    this.time = 0;
    this.substeps = 0;
    this.iterations = 0;
    this.wallSeconds = 0;
    this.state = 'intact';
  }
}
