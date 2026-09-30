/**
 * ============================================================================
 *  Crack network — explicit, sharp, energy-driven crack fronts
 * ============================================================================
 *
 *  Each crack is a *front*: a tip position, a propagation direction, a crack
 *  plane normal, a speed and a length. It advances only when the stress
 *  intensity at its tip exceeds the material's fracture toughness, which we
 *  evaluate without needing a singular tip field:
 *
 *      sigma_p(a) = K_IC / sqrt( pi * a / 2 )        (propagation stress)
 *      advance     iff  sigma_n(tip) > sigma_p(a)
 *
 *  Consequences that fall out of that one inequality — and that no Voronoi
 *  tessellation can imitate:
 *
 *   - SIZE EFFECT. A long crack needs almost no stress to keep going, a short
 *     one needs a lot. So you get a few dominant cracks that run the whole
 *     object, and dozens of little ones that stall — the real fragment size
 *     distribution (power law, not uniform cells).
 *   - ARREST. Cracks stop when the driving stress decays. Partial damage
 *     becomes possible without any authored fracture levels.
 *   - BRANCHING. Above ~40 % of the Rayleigh wave speed a crack cannot shed
 *     energy fast enough and splits. We reproduce the measured branching
 *     angle distribution of glass and rock.
 *   - ANISOTROPY. Wood's toughness across the grain is ~20x lower than along
 *     it, so a crack that enters at an angle rotates until it is running with
 *     the grain — which is why wood *splits* and never shatters.
 *   - CRACK-PLANE ROTATION. The plane normal follows the maximum principal
 *     tensile stress, so a crack bends around holes and stiff inclusions and
 *     runs perpendicular to bending stress in a plate.
 *
 *  The stress that drives all of this comes from the peridynamic solver, so
 *  wave reflections, spall and contact effects are all in play.
 * ============================================================================
 */

import type { FractureParameters, ImpactData } from '../materials.ts';
import type { Principal } from '../peridynamics/Stress.ts';

export type Vec3 = [number, number, number];

export interface CrackSegment {
  /** Start and end of this polyline piece, world space. */
  a: Vec3;
  b: Vec3;
  /** Crack plane normal at this piece (opening direction). */
  n: Vec3;
  /** Local aperture, metres. */
  aperture: number;
  /** 0 = surface only, 1 = fully through the body. */
  penetration: number;
  id: number;
}

export interface CrackFront {
  id: number;
  active: boolean;
  seed: Vec3;
  tip: Vec3;
  /** Unit propagation direction. */
  dir: Vec3;
  /** Unit crack plane normal — the direction the faces open. */
  normal: Vec3;
  /** Accumulated path, used to build the ribbon geometry. */
  path: Vec3[];
  /** Plane normal history, one per path point. */
  normals: Vec3[];
  length: number;
  speed: number;
  peakSpeed: number;
  /**
   * Peak-hold opening stress driving this front, Pa.
   *
   * A crack tip does not respond to an instantaneous stress: it responds to
   * the highest opening stress the tip region has seen, because damage at the
   * tip accumulates and the crack outruns the unloading wave. Modelling this
   * as a leaky peak-hold (rise instantly, decay with a memory of a few steps)
   * is the difference between "the crack reacts to a transient and stops" and
   * "the crack runs while the stress holds".
   */
  drive: number;
  generation: number;
  birthTime: number;
  aperture: number;
  /** Reason the front stopped, for the debug HUD. */
  stoppedReason: '' | 'arrested' | 'surface' | 'coalesced' | 'compressive' | 'budget';
}

export interface CrackSample {
  /** Peak opening stress on the crack plane, Pa (tension positive). */
  sigma: number;
  /** Direction of maximum principal tension at that peak. */
  normal: Vec3;
  /** Full principal state at the peak location, for the mode-mixity term. */
  principal: Principal;
}

export interface CrackStats {
  active: number;
  total: number;
  totalLength: number;
  maxSpeed: number;
  branched: number;
  arrested: number;
}

export interface CrackNetworkOptions {
  /** Rayleigh wave speed of the material, m/s. */
  rayleighSpeed: number;
  /** Sampling spacing (lattice dx) — also the coalescence radius. */
  spacing: number;
  /** Toughness K_IC in Pa·m^0.5. */
  toughness: number;
  /** Material parameters driving pattern style. */
  material: FractureParameters;
  /** Grain / bedding axis for anisotropic materials. */
  grainAxis: Vec3;
  materialId: number;
  /** Hard cap on the number of fronts (perf + readability). */
  maxFronts: number;
  /** Deterministic seed. */
  rngSeed: number;
  /** Object SDF (negative inside) used to detect the free surface. */
  outside: (p: Vec3) => number;
}

const CBRANCH = 0.38;      // crack speed / c_R above which branching starts
const CMIN = 0.10;         // speed floor as a fraction of c_R

export class CrackNetwork {
  readonly fronts: CrackFront[] = [];
  readonly segments: CrackSegment[] = [];
  readonly opts: CrackNetworkOptions;

  private nextId = 0;
  private rngState: number;
  private simTime = 0;
  /** Spatial hash of segment midpoints, for cheap coalescence tests. */
  private hash = new Map<number, number[]>();
  private hashCell: number;

  constructor(opts: CrackNetworkOptions) {
    this.opts = opts;
    this.rngState = opts.rngSeed || 0x2f6e2b1;
    this.hashCell = opts.spacing * 2;
  }

  // -- RNG (xorshift, deterministic) --------------------------------------
  private rnd(): number {
    let x = this.rngState;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.rngState = x;
    return x / 4294967296;
  }

  /** Uniform random unit vector. */
  private rndDir(): Vec3 {
    const z = this.rnd() * 2 - 1;
    const t = this.rnd() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return [r * Math.cos(t), r * Math.sin(t), z];
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Seeding
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Seed the radial crack family from a point impact.
   *
   * Under a Hertzian contact the maximum tensile stress is *hoop* stress at
   * the edge of the contact circle. A crack opens in the hoop direction, so
   * its plane contains the radius: the crack runs radially outward. The
   * number of radial cracks grows with impact severity — this is a measured,
   * documented relationship (forensic glass literature counts 3-8 radial
   * cracks for a typical break, more for a violent one).
   */
  seedImpact(
    impact: ImpactData,
    principalStress: Principal,
    severity: number,
    contactRadius: number,
    objectHalfExtent: number,
  ): number {
    const p = this.opts.material;
    const count = Math.max(
      2,
      Math.min(12, Math.round(p.crackCount.min + (p.crackCount.max - p.crackCount.min) * Math.min(1, severity / 8))),
    );

    // The radial cracks lie in the plane perpendicular to the impact axis.
    const axis = normalize(impact.direction);
    const [u, v] = basis(axis);

    const created: number[] = [];
    for (let i = 0; i < count; i++) {
      // Jitter the angular placement: real radial cracks are never evenly spaced.
      const ang = (i / count) * Math.PI * 2 + (this.rnd() - 0.5) * (Math.PI / count) * 1.6;
      const radial: Vec3 = normalize([
        u[0] * Math.cos(ang) + v[0] * Math.sin(ang),
        u[1] * Math.cos(ang) + v[1] * Math.sin(ang),
        u[2] * Math.cos(ang) + v[2] * Math.sin(ang),
      ]);
      // Opening direction = hoop = perpendicular to the radius within the plane
      const hoop: Vec3 = normalize(cross(axis, radial));

      const seed: Vec3 = [
        impact.position[0] + radial[0] * contactRadius,
        impact.position[1] + radial[1] * contactRadius,
        impact.position[2] + radial[2] * contactRadius,
      ];

      this.addFront(seed, radial, hoop, 0, contactRadius * 0.6);
      created.push(this.fronts.length - 1);
    }

    // Very violent hits crush the contact zone into a Hertzian cone. This is
    // the pulverised core you see at the centre of a bullet hole in glass.
    if (severity > 10 && p.patternType === 'radial') {
      for (let i = 0; i < 3; i++) {
        const d = this.rndDir();
        const t: Vec3 = normalize([
          d[0] - axis[0] * (d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]),
          d[1] - axis[1] * (d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]),
          d[2] - axis[2] * (d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]),
        ]);
        this.addFront(impact.position, t, normalize(cross(t, axis)), 0, contactRadius * 0.3);
      }
    }

    void principalStress;
    void objectHalfExtent;
    return created.length;
  }

  /** Add a front directly (used by secondary-cracking and by scripted tests). */
  addFront(seed: Vec3, dir: Vec3, normal: Vec3, generation: number, initialLength: number): CrackFront {
    const id = this.nextId++;
    // Wedge the aperture: cracks in glass are essentially zero-width, concrete
    // cracks are millimetres wide. Scale with length so long cracks gape more
    // (that is what a real crack does as it unloads).
    const aperture = this.apertureFor(initialLength);
    const front: CrackFront = {
      id,
      active: true,
      seed: [...seed] as Vec3,
      tip: [...seed] as Vec3,
      dir: normalize(dir),
      normal: normalize(normal),
      path: [[...seed] as Vec3],
      normals: [normalize(normal)],
      length: initialLength,
      speed: 0,
      peakSpeed: 0,
      drive: 0,
      generation,
      birthTime: this.simTime,
      aperture,
      stoppedReason: '',
    };
    this.fronts.push(front);
    return front;
  }

  private apertureFor(length: number): number {
    const p = this.opts.material;
    const base = p.crackWidth.min + (p.crackWidth.max - p.crackWidth.min) * Math.min(1, length * 4);
    // Never go below ~1.3 lattice cells or the carved crack closes up again.
    return Math.max(base, this.opts.spacing * 1.3);
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Propagation
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Advance every active front by `dt`.
   *
   * `sample` returns the principal stresses at a point from the current
   * peridynamic stress field.
   */
  step(
    dt: number,
    sample: (p: Vec3, normal: Vec3) => CrackSample,
    bodyHalfExtent: number,
  ): CrackStats {
    this.simTime += dt;
    const { rayleighSpeed, spacing, toughness, materialId } = this.opts;
    const grain = normalize(this.opts.grainAxis);

    for (const f of this.fronts) {
      if (!f.active) continue;

      // ---- 1. local stress -------------------------------------------
      // Sample ahead of the tip (see StressField.peakOpeningStress) and use
      // the direction of maximum tension there for the crack-plane rotation.
      const ahead: Vec3 = [
        f.tip[0] + f.dir[0] * spacing * 0.7,
        f.tip[1] + f.dir[1] * spacing * 0.7,
        f.tip[2] + f.dir[2] * spacing * 0.7,
      ];
      const cs = sample(ahead, f.normal);
      const sigmaRaw = cs.sigma;
      const pr = cs.principal;
      // Direction of maximum principal tension at the peak location — this is
      // the direction the crack faces want to open in.
      const n1 = cs.normal;

      // ---- 2. crack plane orientation ---------------------------------
      // The faces open along the maximum principal stress, so the plane
      // normal is n1. Cracks have inertia: blend rather than snap, or the
      // path jitters at the lattice scale.
      const blendRate = 0.35;
      f.normal = normalize(lerp3(f.normal, n1, blendRate));

      // Anisotropy: effective toughness depends on the angle between the
      // crack plane normal and the grain. Opening *across* the grain is cheap
      // in wood, so the normal is pulled towards the grain axis.
      let kEff = toughness;
      if (materialId === 1 || materialId === 4) {
        const cosG = Math.abs(dot(f.normal, grain));
        // cosG = 1 -> opening along the grain (tough); 0 -> splitting (weak)
        const crossGrain = 1 - cosG;
        const ratio = materialId === 1 ? 0.06 : 0.35; // wood is far more extreme
        kEff = toughness * (ratio + (1 - ratio) * crossGrain);
        const pull = materialId === 1 ? 0.55 : 0.25;
        f.normal = normalize(lerp3(f.normal, grain, pull));
      }

      // ---- 3. resolved normal stress ----------------------------------
      // Leaky peak-hold: rise instantly to a new maximum, decay with a memory
      // of ~5 coupling steps otherwise. Physically this is the tip's damage
      // memory; numerically it stops a brief loading spike from being averaged
      // away by the unloading half of the wave.
      const memory = 0.80;
      f.drive = sigmaRaw > f.drive ? sigmaRaw : f.drive * memory;
      const sigmaN = f.drive;

      if (sigmaN <= 0) {
        // Compressive closure: the crack cannot open. It may re-open later.
        f.speed = 0;
        if (f.length < spacing) {
          f.active = false;
          f.stoppedReason = 'compressive';
        }
        continue;
      }

      // ---- 4. Griffith / toughness criterion --------------------------
      // sigma_p(a) = K_IC / sqrt(pi a / 2);  a = half-length
      const a = Math.max(f.length, spacing) * 0.5;
      const sigmaP = kEff / Math.sqrt((Math.PI * a) / 2);
      const ratio = sigmaN / Math.max(1e-9, sigmaP);

      if (ratio <= 1) {
        // Arrested: not enough driving stress for this crack length.
        f.speed *= 0.6;
        if (f.speed < rayleighSpeed * 0.02) {
          f.speed = 0;
          f.stoppedReason = 'arrested';
        }
        continue;
      }

      // ---- 5. velocity ------------------------------------------------
      // v = v_max (1 - (sigma_p/sigma_n)^2): the classic dynamic-crack
      // velocity law. Terminally limited by the Rayleigh speed, with the
      // practical branching cap at ~0.4-0.6 c_R.
      const vmax = rayleighSpeed * 0.55;
      const target = vmax * (1 - 1 / (ratio * ratio));
      f.speed += (Math.min(vmax, Math.max(0, target)) - f.speed) * Math.min(1, dt * rayleighSpeed / Math.max(spacing, 1e-9));
      f.speed = Math.max(f.speed, rayleighSpeed * CMIN * Math.min(1, ratio - 1));
      f.peakSpeed = Math.max(f.peakSpeed, f.speed);

      const advance = f.speed * dt;
      if (advance < spacing * 0.25) continue;

      // ---- 6. direction ------------------------------------------------
      // Travel within the crack plane: project the current heading onto the
      // plane whose normal is f.normal, then let the resolved mode-II shear
      // steer it (maximum hoop-stress criterion).
      let nd = sub(f.dir, scale3(f.normal, dot(f.dir, f.normal)));
      if (len3(nd) < 1e-6) {
        // Degenerate: pick any in-plane axis.
        const [t1] = basis(f.normal);
        nd = t1;
      }
      nd = normalize(nd);

      const shear = shearOnPlane(pr, f.normal, nd);
      const kii = shear * Math.sqrt((Math.PI * a) / 2);
      const kiiRatio = Math.min(1.5, Math.abs(kii) / Math.max(1e-9, kEff));
      if (kiiRatio > 1e-4) {
        // theta = 2 atan( (K_I - sqrt(K_I^2 + 8K_II^2)) / (4 K_II) )
        const ki = sigmaN * Math.sqrt((Math.PI * a) / 2);
        const theta = 2 * Math.atan2(ki - Math.sqrt(ki * ki + 8 * kii * kii), 4 * kii * Math.sign(shear || 1));
        // Steering authority is small: cracks are very directional objects.
        const turn = clamp(theta, -0.35, 0.35) * 0.25 * Math.min(1, kiiRatio * 3);
        const [t1, t2] = basis(f.normal);
        const c = Math.cos(turn), s = Math.sin(turn);
        const a1 = dot(nd, t1), a2 = dot(nd, t2);
        nd = normalize([
          t1[0] * (c * a1 - s * a2) + t2[0] * (s * a1 + c * a2),
          t1[1] * (c * a1 - s * a2) + t2[1] * (s * a1 + c * a2),
          t1[2] * (c * a1 - s * a2) + t2[2] * (s * a1 + c * a2),
        ]);
      }
      f.dir = normalize(lerp3(f.dir, nd, 0.55));

      // ---- 7. advance ---------------------------------------------------
      const prev: Vec3 = [...f.tip] as Vec3;
      f.tip = [
        f.tip[0] + f.dir[0] * advance,
        f.tip[1] + f.dir[1] * advance,
        f.tip[2] + f.dir[2] * advance,
      ];
      f.length += advance;
      f.aperture = this.apertureFor(f.length);

      // ---- 8. termination checks ---------------------------------------
      // Free surface
      if (this.opts.outside(f.tip) > 0) {
        const s = this.projectToSurface(prev, f.tip);
        f.tip = s;
        this.recordPath(f);
        f.active = false;
        f.stoppedReason = 'surface';
        continue;
      }

      // Runaway budget
      if (f.length > bodyHalfExtent * 6) {
        f.active = false;
        f.stoppedReason = 'budget';
        continue;
      }

      // Coalescence with an existing crack. Skipped while the front is still
      // inside its own nucleation cluster: the radial family all starts at the
      // contact point on purpose, and treating those siblings as "already
      // cracked" would kill every one of them on the first step.
      if (f.length > spacing * 3.5) {
        const junction = this.nearExistingCrack(f.tip, f.id, spacing * 1.6);
        if (junction) {
          // snap the tip onto the other crack so the two are geometrically
          // joined, then retire this front
          f.tip = junction;
          f.length += dist(prev, junction);
          this.recordPath(f);
          f.active = false;
          f.stoppedReason = 'coalesced';
          continue;
        }
      }

      this.recordPath(f);

      // ---- 9. branching -------------------------------------------------
      // Above ~40 % c_R the crack tip cannot radiate energy fast enough and
      // splits. Measured branch angles cluster at 15-45 degrees.
      const speedRatio = f.speed / rayleighSpeed;
      if (
        speedRatio > CBRANCH &&
        this.fronts.length < this.opts.maxFronts &&
        f.length > spacing * 4 &&
        this.rnd() < this.opts.material.branchingProbability * Math.min(1, (speedRatio - CBRANCH) * 6)
      ) {
        const [t1, t2] = basis(f.normal);
        const base = Math.atan2(dot(f.dir, t2), dot(f.dir, t1));
        const ang = this.opts.material.branchingAngle.min +
          this.rnd() * (this.opts.material.branchingAngle.max - this.opts.material.branchingAngle.min);
        const sgn = this.rnd() < 0.5 ? -1 : 1;
        const a2 = base + ang * sgn;
        const bdir = normalize([
          t1[0] * Math.cos(a2) + t2[0] * Math.sin(a2),
          t1[1] * Math.cos(a2) + t2[1] * Math.sin(a2),
          t1[2] * Math.cos(a2) + t2[2] * Math.sin(a2),
        ]);
        const b = this.addFront(f.tip, bdir, f.normal, f.generation + 1, f.length * 0.25);
        b.speed = f.speed * 0.6;
      }
    }

    return this.stats();
  }

  /**
   * Closest point on any *other* crack within `r` of `p`, or null.
   *
   * Returns the junction point rather than a boolean because coalescence has
   * to *join the cracks*, not merely stop the front: a front that halts 1.2
   * lattice cells short of the crack it was about to meet leaves an unbroken
   * ligament between them, and that single-cell ligament keeps the whole body
   * connected. The symptom is a beautiful crack network and a single fragment
   * — the network looks right and nothing separates, because nothing actually
   * touches.
   */
  private nearExistingCrack(p: Vec3, ignoreId: number, r: number): Vec3 | null {
    const cx = Math.floor(p[0] / this.hashCell);
    const cy = Math.floor(p[1] / this.hashCell);
    const cz = Math.floor(p[2] / this.hashCell);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const bucket = this.hash.get(hashKey(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const si of bucket) {
            const seg = this.segments[si];
            if (seg.id === ignoreId) continue;
            // Sibling fronts born at the same place (the radial family) are
            // not obstacles to each other until they have separated.
            const sib = this.fronts[seg.id];
            const mine = ignoreId >= 0 ? this.fronts[ignoreId] : null;
            if (sib && mine) {
              const ds = Math.hypot(sib.seed[0] - mine.seed[0], sib.seed[1] - mine.seed[1], sib.seed[2] - mine.seed[2]);
              if (ds < this.opts.spacing * 2.5) continue;
            }
            const q = closestPointOnSegment(p, seg.a, seg.b);
            if (dist(p, q) < r) return q;
          }
        }
      }
    }
    return null;
  }

  private recordPath(f: CrackFront): void {
    const last = f.path[f.path.length - 1];
    const d = dist(last, f.tip);
    if (d < this.opts.spacing * 0.4) {
      f.path[f.path.length - 1] = [...f.tip] as Vec3;
      return;
    }
    const prev = f.path[f.path.length - 1];
    const seg: CrackSegment = {
      a: [...prev] as Vec3,
      b: [...f.tip] as Vec3,
      n: [...f.normal] as Vec3,
      aperture: f.aperture,
      penetration: 1,
      id: f.id,
    };
    const si = this.segments.length;
    this.segments.push(seg);
    const key = hashKey(
      Math.floor(((prev[0] + f.tip[0]) * 0.5) / this.hashCell),
      Math.floor(((prev[1] + f.tip[1]) * 0.5) / this.hashCell),
      Math.floor(((prev[2] + f.tip[2]) * 0.5) / this.hashCell),
    );
    const bucket = this.hash.get(key);
    if (bucket) bucket.push(si);
    else this.hash.set(key, [si]);

    f.path.push([...f.tip] as Vec3);
    f.normals.push([...f.normal] as Vec3);
  }

  /** Binary-search the crossing of the free surface for a clean end point. */
  private projectToSurface(a: Vec3, b: Vec3): Vec3 {
    let lo = 0, hi = 1;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) * 0.5;
      const p: Vec3 = [a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid, a[2] + (b[2] - a[2]) * mid];
      if (this.opts.outside(p) > 0) hi = mid; else lo = mid;
    }
    return [a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo, a[2] + (b[2] - a[2]) * lo];
  }

  /**
   * Secondary cracking: seed new fronts wherever the stress field has a
   * tensile maximum that no crack has reached yet. This is what produces the
   * concentric / ring cracks in glass after the reflected bending wave
   * returns, and the scattered subsidiary cracks in concrete and rock.
   */
  seedSecondary(
    candidates: { p: Vec3; stress: number; dir: Vec3 }[],
    threshold: number,
    maxNew: number,
  ): number {
    let added = 0;
    for (const c of candidates) {
      if (added >= maxNew) break;
      if (c.stress < threshold) continue;
      if (this.nearExistingCrack(c.p, -1, this.opts.spacing * 1.5)) continue;
      const [u, v] = basis(c.dir);
      const t = this.rnd() < 0.5 ? u : v;
      this.addFront(c.p, t, c.dir, 1, this.opts.spacing * 1.2);
      added++;
    }
    return added;
  }

  stats(): CrackStats {
    let active = 0, totalLength = 0, maxSpeed = 0, branched = 0, arrested = 0;
    for (const f of this.fronts) {
      if (f.active) active++;
      totalLength += f.length;
      maxSpeed = Math.max(maxSpeed, f.peakSpeed);
      if (f.generation > 0) branched++;
      if (f.stoppedReason === 'arrested') arrested++;
    }
    return { active, total: this.fronts.length, totalLength, maxSpeed, branched, arrested };
  }

  /** Total crack surface area estimate (m²), for HUD and energy accounting. */
  surfaceArea(): number {
    let area = 0;
    for (const s of this.segments) {
      // ribbon extent across the body, approximate from the aperture ratio
      area += dist(s.a, s.b) * (this.opts.spacing * 8);
    }
    return area;
  }
}

// ---------------------------------------------------------------------------
// Vector helpers (flat, allocation-light)
// ---------------------------------------------------------------------------

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const len3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Any orthonormal pair spanning the plane with the given normal. */
export function basis(n: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t1 = normalize(cross(n, helper));
  const t2 = normalize(cross(n, t1));
  return [t1, t2];
}

/** Normal stress on the plane with the given normal (tension positive). */
function dotStress(pr: Principal, n: Vec3): number {
  // sigma_n = n . sigma . n reconstructed from the eigen decomposition
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const d = dot(pr.vectors[i], n);
    s += pr.values[i] * d * d;
  }
  return s;
}

/** Resolved in-plane shear on the plane, along `t`. */
function shearOnPlane(pr: Principal, n: Vec3, t: Vec3): number {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const d = dot(pr.vectors[i], n);
    const e = dot(pr.vectors[i], t);
    s += pr.values[i] * d * e;
  }
  return s;
}

function closestPointOnSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const denom = abx * abx + aby * aby + abz * abz;
  const t = denom > 1e-12 ? clamp((apx * abx + apy * aby + apz * abz) / denom, 0, 1) : 0;
  return [a[0] + abx * t, a[1] + aby * t, a[2] + abz * t];
}

function hashKey(x: number, y: number, z: number): number {
  return ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0;
}
