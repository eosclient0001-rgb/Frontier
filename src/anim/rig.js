/**
 * The poseable rig.
 *
 * Everything downstream of the anatomy lives here:
 *
 *  - a cervical spine solver that takes a HEAD TARGET and turns it into 11
 *    individual vertebra rotations, so the neck bends the way a neck bends
 *    instead of swinging like a stick;
 *  - a two-bone hip/knee IK plus an explicit tarso-metatarsus and foot chain,
 *    so feet can be locked to the ground and the body vaults over them;
 *  - per-feather controls (pitch about the rachis, spanwise bend, fan spread)
 *    which is where the wing's secondary motion comes from — the flight
 *    feathers are not rigid to the wing;
 *  - critically damped springs that make the head, tail and primaries lag.
 */

import { Euler, Group, Matrix4, Quaternion, Vector3 } from 'three';
import { BONES, KINEMATIC_LIMITS, KINEMATIC_LIMITS as KL } from '../anatomy.js';
import { DEG, clamp, lerp, smoothstep, smootherstep } from '../lib/mathx.js';
import { MOUNTS, STAND_POSE } from '../model/eagle.js';
import { orientFeather } from '../model/wing.js';
import { Spring, Spring3 } from './spring.js';

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _q3 = new Quaternion();
const _m = new Matrix4();
const _v4 = new Vector3();
const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

/** Minimal rotation taking unit vector `a` to unit vector `b`. */
export function quatFromTo(a, b, out = _q) {
  const r = a.dot(b) + 1;
  if (r < 1e-8) {
    // 180 degrees: rotate about any perpendicular axis.
    const axis = Math.abs(a.x) > Math.abs(a.z) ? new Vector3(-a.y, a.x, 0) : new Vector3(0, -a.z, a.y);
    return out.setFromAxisAngle(axis.normalize(), Math.PI);
  }
  // The axis of the shortest arc from `a` to `b` is a x b, and the scalar part
  // is 1 + a.b.  Writing `b - a` here instead -- which is not the same vector
  // for any pair except b = -a -- silently rotates every aimed bone by an
  // arbitrary angle about its own axis: the femur comes out pointing tens of
  // degrees wide of where it was asked to point, the knee lands somewhere the
  // solver did not choose, and no downstream measurement can be trusted.
  out.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x, r);
  return out.normalize();
}

function composeJoint(out, twistAxis, twist, yawAxis, yaw, pitchAxis, pitch) {
  _q2.setFromAxisAngle(yawAxis, yaw);
  _q3.setFromAxisAngle(pitchAxis, pitch);
  _q2.multiply(_q3);
  if (twist) {
    _q3.setFromAxisAngle(twistAxis, twist);
    _q2.multiply(_q3);
  }
  return out.copy(_q2);
}

const restCache = new WeakMap();
function restQuat(joint) {
  let q = restCache.get(joint);
  if (!q) {
    q = joint.userData.restQuaternion ? joint.userData.restQuaternion.clone() : joint.quaternion.clone();
    restCache.set(joint, q);
  }
  return q;
}

/**
 * The canonical standing posture of one leg, in the eagle's own frame.
 *
 * Derived from published raptor biped kinematics: the tarso-metatarsus carries
 * the body up at a little over 20 deg from vertical, the tibiotarsus leans
 * back to put the knee cranio-laterally forward of the hip, and the toes take
 * the weight across the proximal pads rather than the tips.
 */
export const STANDING_LEG = Object.freeze({
  footX: 0.043,
  footZ: -0.012,
  /**
   * Ankle distance below the hip, as a fraction of femur + tibiotarsus.
   *
   * 0.9 -- near full extension -- is what a bird uses for the first instant of
   * a take-off jump, not for standing: it leaves the femur and tibiotarsus
   * almost in line, flattens the Z the leg is supposed to make, and puts the
   * hip so high that a walking bird has no reach left to swing or to hold
   * contact with.  A perched eagle stands in a deep crouch, with the feathered
   * part of the leg folded up inside the plumage and the tarso-metatarsus
   * doing nearly all the visible work.
   */
  extension: 0.72,
  tarsusPitch: 24,
  footPitch: 2,
  footYaw: 3.5,
  toeCurl: 0.22,
});

/* -------------------------------------------------------------------------- */
/*  Rig                                                                        */
/* -------------------------------------------------------------------------- */

export class EagleRig {
  constructor(eagle) {
    this.eagle = eagle;
    this.joints = eagle.joints;
    this.trunk = eagle.joints.trunk;
    this.neckSegments = eagle.joints.neck;
    this.headMount = eagle.joints.headMount;
    this.head = eagle.joints.head;
    this.NECK_N = this.neckSegments.length;
    this.NECK_L = this.eagle.meta.neckLength / this.NECK_N;

    this.wings = {
      right: this._indexWing(eagle.joints.wingRight, 1),
      left: this._indexWing(eagle.joints.wingLeft, -1),
    };
    this.legs = {
      right: this._indexLeg(eagle.joints.legs.right, 1),
      left: this._indexLeg(eagle.joints.legs.left, -1),
    };

    this.neckBase = MOUNTS.neckBase.clone();
    this.headOcciputLocal = new Vector3(0, 0.006, 0.035);

    // ---- secondary animation springs ------------------------------------
    // Damping ratios are chosen per element: soft tissue on the neck is
    // heavily damped, while a stiff primary feather rings a little when it is
    // unloaded at the end of a downstroke.
    this.springs = {
      head: new Spring3([0, 0, 0], 26, 1.0),
      headAim: new Spring3([0, 0, 0], 20, 1.0),
      tail: new Spring3([0, 0, 0], 17, 0.92),
      tailSpread: new Spring(0, 13, 1.0),
      featherBendR: new Spring(0, 30, 0.72),
      featherBendL: new Spring(0, 30, 0.72),
      featherFlutter: new Spring(0, 34, 0.4),
    };
    this._springList = Object.values(this.springs);
    this._springAcc = 0;

    // Cache the rest ankle targets by running FK on the standing pose.
    this.standAnkle = {
      right: this._fkAnkleStand(1),
      left: this._fkAnkleStand(-1),
    };
    /** Height of the trunk origin above the sole of the feet, standing. */
    this.calibrateStance();
  }

  _indexWing(wing, side) {
    return {
      side,
      rig: wing.root,
      joints: wing.joints,
      primaries: wing.primaries,
      secondaries: wing.secondaries,
      alula: wing.alula,
      feathers: [...wing.primaries, ...wing.secondaries],
      rest: {
        primaries: wing.primaries.map((f) => restQuat(f.pivot)),
        secondaries: wing.secondaries.map((f) => restQuat(f.pivot)),
        alula: wing.alula.map((f) => restQuat(f.pivot)),
      },
    };
  }

  _indexLeg(leg, side) {
    const j = leg.joints;
    return {
      side,
      root: leg.root,
      toes: leg.toes,
      footBase: leg.footBase,
      hip: j.hip,
      femur: j.knee,
      tibia: j.ankle,
      tarsus: j.hock,
      foot: j.foot,
      lengths: {
        femur: BONES.femur,
        tibia: BONES.tibiotarsus,
        tarsus: BONES.tarsometatarsus,
        footBase: 0.018,
      },
      origins: {
        hip: new Vector3(side * MOUNTS.hip.x, MOUNTS.hip.y, MOUNTS.hip.z),
      },
    };
  }

  /**
   * Measure the standing height off the geometry.
   *
   * How high a trunk sits above its own soles is a consequence of the leg
   * lengths, the ankle angle and the thickness of the foot pads -- it is not a
   * number anybody can write down correctly in advance, and the first attempt
   * at it was 4 cm out.  So the rig poses the canonical standing posture once,
   * measures where the soles actually land, and publishes that.
   *
   * Callers get it as `rig.standHeight`, and the ground plane of a standing
   * clip is simply `-rig.standHeight`.
   */
  calibrateStance(spec = STANDING_LEG) {
    const lF = BONES.femur;
    const lT = BONES.tibiotarsus;

    // Pose the trunk exactly as the standing clips will, before measuring.
    // The trunk's resting pitch tilts the leg's whole reach, and a stance
    // measured against an upright trunk is not the stance the bird takes.
    this.poseTrunk({ pitch: STAND_POSE.trunkPitch });
    this.trunk.updateMatrix();
    this.eagle.root.updateWorldMatrix(true, false);
    this._rootWorldInv = this.eagle.root.matrixWorld.clone().invert();
    this._trunkLocalInv = this.trunk.matrix.clone().invert();
    this.trunk.updateWorldMatrix(true, false);

    // Seed from a genuinely reachable pose: the intertarsal joint placed a
    // comfortable fraction of the leg's reach below the hip.  Asking the IK
    // for a point inside its own fold limit makes it clamp, and a clamped
    // pose measures the clamp rather than the bird -- an early version of
    // this did exactly that and produced a stance 7 cm too short.
    const ankleY = MOUNTS.hip.y - (lF + lT) * spec.extension;
    for (const leg of [this.legs.right, this.legs.left]) {
      this.poseLeg(leg, { ...spec, ankle: new Vector3(leg.side * spec.footX, ankleY, spec.footZ), plantY: null });
    }
    this.standHeight = -Math.min(...[this.legs.right, this.legs.left].map((l) => this.soleLowest(l)));

    // Then settle the height against the very handle the clips use, so that
    // the number published here is the number a standing clip reproduces.  If
    // the two disagreed the whole bird would hover or sink, and that is
    // exactly what a stale constant here once did.
    for (let pass = 0; pass < 6; pass++) {
      for (const leg of [this.legs.right, this.legs.left]) {
        this.poseLeg(leg, {
          ...spec,
          footRoot: new Vector3(leg.side * spec.footX, -this.standHeight, spec.footZ),
          plantY: -this.standHeight,
        });
      }
      const low = Math.min(...[this.legs.right, this.legs.left].map((l) => this.soleLowest(l)));
      const next = -low;
      this.stanceResidual = Math.abs(next - this.standHeight);
      this.standHeight = next;
      if (this.stanceResidual < 1e-5) break;
    }

    this.stance = { ...spec, ankleY };
    for (const leg of [this.legs.right, this.legs.left]) {
      this.poseLeg(leg, {
        ...spec,
        footRoot: new Vector3(leg.side * spec.footX, -this.standHeight, spec.footZ),
        plantY: -this.standHeight,
      });
    }
    return this.standHeight;
  }

  /* ---------------------------------------------------------------------- */
  /*  Trunk                                                                  */
  /* ---------------------------------------------------------------------- */

  poseTrunk({ pitch = 0, yaw = 0, roll = 0, x = 0, y = 0, z = 0 } = {}) {
    this.trunk.rotation.set(pitch * DEG, yaw * DEG, roll * DEG, 'YXZ');
    this.trunk.position.set(x, y, z);
  }

  /* ---------------------------------------------------------------------- */
  /*  Neck + head                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Solve the cervical spine so the head's centre lands on `headPos` (trunk
   * frame) with orientation `headAim`.
   *
   * @param {Vector3} headPos  desired centre of the skull
   * @param {{yaw:number,pitch:number,roll:number}} headAim degrees, trunk frame
   * @param {number} curve     0 = straight, 1 = relaxed S, >1 = tightly furled
   * @param {number} twistDistribute how much of the head's yaw is taken up by
   *        the neck itself rather than the head joint
   */
  poseNeck(headPos, headAim = {}, curve = 1, twistDistribute = 0.72) {
    const N = this.NECK_N;
    const L = this.NECK_L;
    const total = N * L;
    const B = this.neckBase;

    const T = headPos.clone();
    const d = _v.copy(T).sub(B);
    let dist = d.length();
    const u = _v2.copy(d).normalize();
    // Clamp to the neck's physical reach.
    const maxReach = total * 0.985;
    if (dist > maxReach) {
      dist = maxReach;
      T.copy(B).addScaledVector(u, dist);
    }
    T.y = Math.max(T.y, B.y - 0.02);

    // Slack has to go somewhere: it becomes the sagittal S of the neck.
    const slack = Math.max(0, total - dist);
    const perp = _v3.set(0, 0, 1).addScaledVector(u, -u.z);
    if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1);
    perp.normalize();
    const amp = clamp(slack * 0.62, 0, 0.062) * curve;

    const c1 = B.clone().addScaledVector(u, dist * 0.34).addScaledVector(perp, amp);
    const c2 = B.clone().addScaledVector(u, dist * 0.72).addScaledVector(perp, -amp * 0.42);

    // Sample the spline, then re-space it into N equal-length vertebrae.
    const SAMPLES = 96;
    const pts = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      pts.push(catmull3(B, c1, c2, T, t));
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const spine = [];
    const want = total;
    let seg = 0;
    for (let i = 0; i <= N; i++) {
      const targetS = (i / N) * want;
      while (seg < cum.length - 2 && cum[seg + 1] < targetS) seg++;
      const span = cum[seg + 1] - cum[seg] || 1e-9;
      const t = clamp((targetS - cum[seg]) / span, 0, 1);
      spine.push(pts[seg].clone().lerp(pts[seg + 1], t));
    }

    // Distributed twist: birds turn the head with the whole neck, not one joint.
    const totalTwist = (headAim.yaw ?? 0) * DEG * twistDistribute;
    const weights = [];
    let wSum = 0;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const w = Math.pow(Math.sin(Math.PI * t), 1.35) + 0.12;
      weights.push(w);
      wSum += w;
    }

    let prevWorld = new Quaternion(); // trunk frame; the neck base is unrotated
    const headAimQ = new Quaternion().setFromEuler(
      new Euler((headAim.pitch ?? 0) * DEG, (headAim.yaw ?? 0) * DEG, (headAim.roll ?? 0) * DEG, 'YXZ'),
    );

    for (let i = 0; i < N; i++) {
      const dir = spine[i + 1].clone().sub(spine[i]).normalize();
      const yaw = (totalTwist * weights[i]) / wSum;
      const curDir = Y_AXIS.clone().applyQuaternion(prevWorld);
      quatFromTo(curDir, dir, _q2);
      const world = _q2
        .clone()
        .multiply(prevWorld)
        .multiply(_q3.setFromAxisAngle(Y_AXIS, yaw));
      const local = prevWorld.clone().invert().multiply(world);
      this.neckSegments[i].quaternion.copy(local);
      prevWorld = world;
    }
    this._neckTipWorld = spine[N].clone();
    this._neckWorldQuat = prevWorld.clone();

    // Place the skull: the mount rotation is chosen so the head's world
    // orientation is exactly `headAim`, independent of how the neck curled.
    this.headMount.quaternion.copy(prevWorld.clone().invert().multiply(headAimQ));
    this.head.position.copy(this.headOcciputLocal);
    this.head.quaternion.identity();
    this.head.updateMatrix();
  }

  /** Legs are posed from an ankle target; FK determines the standing rest. */
  _fkAnkleStand(side) {
    // Solve the standing configuration once analytically.
    const hip = new Vector3(side * MOUNTS.hip.x, MOUNTS.hip.y, MOUNTS.hip.z);
    // Target: tarsus ~25 deg in front of vertical, foot flat on the ground
    // 0.256 m below the trunk origin.
    const footY = -0.256 + 0.021;
    const tarsusAngle = 25 * DEG;
    const ankle = new Vector3(
      side * 0.043,
      footY + BONES.tarsometatarsus * Math.cos(tarsusAngle),
      -0.012 - BONES.tarsometatarsus * Math.sin(tarsusAngle),
    );
    return { hip, ankle, tarsusAngle, footY };
  }

  /* ---------------------------------------------------------------------- */
  /*  Legs                                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * Pose a leg.
   *
   * `spec` takes either an explicit `ankle` point, or a `footRoot` at the sole
   * (the more useful handle: the sole is what touches the ground).  If
   * `plantY` is also given, the rig solves for the pose that puts the sole
   * exactly on that plane instead of trusting the nominal ankle offset.
   *
   * @param {object} leg
   * @param {{ankle?:Vector3, footRoot?:Vector3, plantY?:number,
   *          tarsusPitch:number, footPitch:number, footYaw:number,
   *          footRoll:number, toeCurl:number, kneePole?:Vector3}} spec
   */
  poseLeg(leg, spec) {
    if (spec.plantY !== undefined && spec.plantY !== null) {
      return this.poseLegPlanted(leg, spec);
    }
    return this._poseLegRaw(leg, spec);
  }

  /**
   * Pose a leg from an ankle target.
   * @param {object} leg
   * @param {{ankle:Vector3, tarsusPitch:number, footPitch:number,
   *          footYaw:number, footRoll:number, toeCurl:number,
   *          kneePole?:Vector3}} spec
   */
  /**
   * Lowest point of the sole in the trunk's own frame, measured off the real
   * toe geometry after the leg has been posed.
   *
   * It has to be measured rather than assumed: the sole's height under the
   * ankle depends on the toe curl, the ankle angle and the shape of the pads,
   * all of which change through a step.  A theoretical constant is off by
   * several centimetres by the time the toes have arched.
   */
  soleLowest(leg, frame = 'root') {
    leg.root.updateWorldMatrix(true, true);
    const inv = frame === 'trunk' ? this._trunkWorldInv : this._rootWorldInv;
    const v = new Vector3();
    let low = Infinity;
    for (const name of ['hallux', 'toe2', 'toe3', 'toe4']) {
      const t = leg.toes[name];
      if (!t) continue;
      t.traverse((o) => {
        if (!o.isMesh) return;
        o.updateWorldMatrix(true, false);
        const p = o.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
          if (inv) v.applyMatrix4(inv);
          if (v.y < low) low = v.y;
        }
      });
    }
    return low === Infinity ? null : low;
  }

  _poseLegRaw(leg, spec) {
    const { hip, femur, tibia, tarsus, foot, toes } = leg;
    const lF = BONES.femur;
    const lT = BONES.tibiotarsus;
    const hipPos = leg.origins.hip;

    // Either an explicit ankle target, or a sole position which is the more
    // useful handle: the sole is what touches the ground, so locking the sole
    // is what keeps a foot from sliding.
    let target;
    let footPoint = null;
    if (spec._footY !== undefined && spec._footY !== null) {
      // Internal: where the metatarso-phalangeal joint -- the distal end of
      // the tarso-metatarsus, the joint the foot rolls about -- should sit,
      // in the trunk's frame, straight from the ground solve.  Never routed
      // through the eagle/trunk frame conversion: that round trip is what let
      // the request and the measurement come to disagree by centimetres.
      footPoint = new Vector3(spec._footX ?? 0, spec._footY, spec._footZ ?? 0);
      const tp = (spec.tarsusPitch ?? 25) * DEG;
      const dirT = new Vector3(0, -Math.cos(tp), Math.sin(tp));
      target = footPoint.clone().addScaledVector(dirT, -BONES.tarsometatarsus);
    } else if (spec._trunkFoot) {
      // Internal: the same joint, already in the trunk's frame.
      footPoint = spec._trunkFoot.clone();
      const tp = (spec.tarsusPitch ?? 25) * DEG;
      const dirT = new Vector3(0, -Math.cos(tp), Math.sin(tp));
      target = footPoint.clone().addScaledVector(dirT, -BONES.tarsometatarsus);
    } else if (spec.footRoot) {
      // Given in the eagle's own frame; convert into the trunk's (posed) frame
      // so a planted foot stays planted while the trunk pitches, rocks and bobs.
      footPoint = this._trunkLocalInv
        ? spec.footRoot.clone().applyMatrix4(this._trunkLocalInv)
        : spec.footRoot.clone();
      const tp = (spec.tarsusPitch ?? 25) * DEG;
      const dirT = new Vector3(0, -Math.cos(tp), Math.sin(tp));
      target = footPoint.clone().addScaledVector(dirT, -BONES.tarsometatarsus);
    } else {
      // No sole given: solve straight to the hock.  If a caller supplies
      // neither (a pose that only talks about wings), fall back to the tucked
      // flight carry rather than failing to solve at all.
      target = spec.ankle ?? new Vector3(leg.side * 0.05, -0.055, 0.012);
      footPoint = null;
    }

    const toAnkle = _v.copy(target).sub(hipPos);
    let d = toAnkle.length();
    const maxD = (lF + lT) * 0.995;
    const minD = Math.abs(lF - lT) + 0.02;
    d = clamp(d, minD, maxD);
    const dir = toAnkle.clone().normalize();

    // The avian knee points cranio-laterally; that pole is what stops the IK
    // from picking the "backwards knee" solution.
    const pole = (spec.kneePole ?? new Vector3(0, 0, 1)).clone();
    pole.addScaledVector(dir, -pole.dot(dir));
    if (pole.lengthSq() < 1e-8) pole.set(0, 0, 1);
    pole.normalize();

    // Was the request reachable?  If the hip-to-ankle distance had to be
    // clamped, the ankle lands short of where it was asked for and the sole
    // cannot be put on the ground no matter how the solve is iterated.
    const clamped = Math.abs(d - toAnkle.length()) > 1e-9;

    const cosA1 = clamp((lF * lF + d * d - lT * lT) / (2 * lF * d), -1, 1);
    const a1 = Math.acos(cosA1);
    // Rotating the hip->ankle line by +a1 about (dir x pole) swings the knee
    // toward the pole, i.e. cranially: the avian knee folds forward.
    const axis = _v2.copy(dir).cross(pole).normalize();
    const femurDir = dir.clone().applyAxisAngle(axis, a1);
    const kneePos = hipPos.clone().addScaledVector(femurDir, lF);
    const tibiaDir = target.clone().sub(kneePos).normalize();

    // Rotate each joint so its -Y axis lines up with the bone's direction.
    const down = new Vector3(0, -1, 0);
    quatFromTo(down, femurDir, _q);
    femur.quaternion.copy(_q);

    const parentWorld = _q.clone();
    const curDir = down.clone().applyQuaternion(parentWorld);
    quatFromTo(curDir, tibiaDir, _q2);
    tibia.quaternion.copy(parentWorld.clone().invert().multiply(_q2.clone().multiply(parentWorld)));

    // Tarso-metatarsus: explicit pitch (it is the "shank" the bird actually
    // stands on, and controlling it directly is how you get a bird to stand
    // instead of a horse).
    const tarsusPitch = (spec.tarsusPitch ?? 25) * DEG;
    const tDir = new Vector3(0, -Math.cos(tarsusPitch), Math.sin(tarsusPitch)).applyAxisAngle(
      new Vector3(1, 0, 0),
      -(spec.tarsusRoll ?? 0) * DEG,
    );
    // Aim the tarso-metatarsus with an explicit roll instead of inheriting
    // whatever twist the tibiotarsus happens to carry.
    //
    // This matters more than it looks.  A minimal-rotation aim leaves the
    // shank's roll determined by the knee angle, so the foot -- which is rigid
    // in the shank's frame -- swings sideways every time the knee moves, and
    // the sole's height becomes a function of the whole chain rather than of
    // the shank angle alone.  With the roll pinned, the sole sits at a fixed
    // offset below the intertarsal joint determined by the two angles the
    // animator actually set, which is both how the leg really works and what
    // makes the ground solve below converge.
    const tibiaWorld = _q2.clone().multiply(parentWorld);
    const yAxis = _v3.copy(tDir).multiplyScalar(-1).normalize();
    const ref = _v4.set(0, 0, 1);
    ref.addScaledVector(yAxis, -ref.dot(yAxis));
    if (ref.lengthSq() < 1e-8) ref.set(0, 1, 0);
    ref.normalize();
    const roll = (spec.tarsusRoll ?? 0) * DEG;
    if (roll) ref.applyAxisAngle(yAxis, roll);
    const zAxis = ref.clone().normalize();
    const xAxis = new Vector3().crossVectors(yAxis, zAxis).normalize();
    zAxis.crossVectors(xAxis, yAxis).normalize();
    const basis = new Matrix4().makeBasis(xAxis, yAxis, zAxis);
    const tarsusWorld = new Quaternion().setFromRotationMatrix(basis);
    tarsus.quaternion.copy(tibiaWorld.clone().invert().multiply(tarsusWorld));

    // Foot: pitch relative to the tarso-metatarsus (ankle roll), yaw for toe-in
    // / toe-out, roll for lateral placement on uneven ground.
    const footPitch = (spec.footPitch ?? 0) * DEG;
    const footRoll = (spec.footRoll ?? 0) * DEG;
    const footYaw = (spec.footYaw ?? 0) * DEG;
    composeJoint(
      foot.quaternion,
      Y_AXIS,
      footYaw,
      Z_AXIS,
      footRoll,
      X_AXIS,
      footPitch,
    );

    // Toes: curl on contact, straighten through push-off.  Digit I opposes.
    const curl = clamp(spec.toeCurl ?? 0, 0, 1);
    for (const name of ['hallux', 'toe2', 'toe3', 'toe4']) {
      const t = toes[name];
      if (!t) continue;
      const dirSign = name === 'hallux' ? 1 : 1;
      t.rotation.x = dirSign * curl * 34 * DEG;
      if (name === 'toe2') t.rotation.y = (-38 + curl * 5) * DEG;
      else if (name === 'toe4') t.rotation.y = (38 - curl * 5) * DEG;
    }
    // The ankle the chain actually reaches, which is `target` itself unless
    // the IK clamped.  Publishing the reached point rather than the requested
    // one is what lets the ground solve below measure the leg instead of its
    // own arithmetic.
    const anklePos = hipPos.clone().addScaledVector(dir, d);
    leg.lastSolve = { kneePos, femurDir, tibiaDir, ankle: anklePos, clamped, foot: footPoint };

    return leg.lastSolve;
  }

  /**
   * Pose a leg so that the sole sits exactly on a requested plane.
   *
   * The leg is solved by asking for the *foot joint* -- the distal end of the
   * tarso-metatarsus, which is the joint the foot rolls about -- rather than
   * for the sole itself, because the sole is not a point the solver can name:
   * it is the lowest vertex of the toes, and its offset below the joint
   * depends on the toe curl and the foot angle.
   *
   * That offset, though, is *rigid*.  The shank is aimed with an explicit roll
   * and the foot is rigid in the shank's frame, so the sole's offset below the
   * joint is a function of the four joint angles alone and does not depend on
   * where the leg is in space.  So the solve measures it once, on the frame's
   * own posture, and then places the joint at (request - offset): the sole
   * lands on the ground by construction.
   *
   * A second measured pass polices the two things that can break that: the
   * IK clamping when the ground is further away than the leg can reach, and
   * the small residual the tibiotarsus aim leaves behind.  The plain scheme
   * this replaces -- iterating "move the request by the error" -- converges at
   * about half the gap per pass and so never settles near the ends of the
   * leg's travel, which is what left a walking eagle's trailing foot sunk a
   * centimetre into the floor.
   */
  poseLegPlanted(leg, spec) {
    const plantY = spec.plantY;

    // The caller says where the sole should be in the eagle's frame -- "on the
    // ground" -- and the trunk above it is pitched, rolled and bobbing, so the
    // request is converted into the trunk's frame here, once, exactly as the
    // leg solve expects it.  Taking the caller's height literally as a
    // trunk-frame coordinate instead makes the foot track the body's bob
    // rather than the ground.
    const requested = (spec.footRoot ?? spec.ankle ?? new Vector3(0, plantY, 0)).clone();
    requested.y = plantY;
    const anchor = this._trunkLocalInv
      ? requested.applyMatrix4(this._trunkLocalInv)
      : requested;

    const solve = (reqY) =>
      this._poseLegRaw(leg, {
        ...spec,
        plantY: null,
        footRoot: null,
        ankle: null,
        _footY: reqY,
        _footX: anchor.x,
        _footZ: anchor.z,
      });

    // Correct against the sole's height *in the eagle's frame*, which is where
    // the ground is.
    //
    // Measuring in the trunk's frame instead looks equivalent and is not: the
    // sole is the lowest vertex of the toes, and it does not sit directly under
    // the point being requested, so when the trunk is rolled or yawed any
    // sideways offset between the two is mixed back into the world height.  On
    // a walking bird that leak is worth several millimetres of foot that never
    // quite reaches the floor.  A trunk-frame request is converted to a
    // world-frame height change by the vertical scale of the trunk's own
    // rotation, which is the middle element of its matrix.
    const m11 = this.trunk.matrix.elements[5] || 1;
    let req = anchor.y;
    let bestReq = req;
    let bestAbs = Infinity;
    let bestErr = 0;
    for (let k = 0; k < 4; k++) {
      solve(req);
      const sole = this.soleLowest(leg);
      if (sole === null) break;
      const err = sole - plantY;
      if (Math.abs(err) < bestAbs) {
        bestAbs = Math.abs(err);
        bestReq = req;
        bestErr = err;
      }
      if (Math.abs(err) < 1e-6) break;
      // Asking for a higher sole raises it, so correct in that direction.
      req -= err / m11;
    }
    const result = solve(bestReq);

    result.plantError = bestErr;
    result.soleRoot = this.soleLowest(leg);
    return result;
  }

  /* ---------------------------------------------------------------------- */
  /*  Tail    return leg.lastSolve;
  }

  /* ---------------------------------------------------------------------- */
  /*  Tail                                                                   */
  /* ---------------------------------------------------------------------- */

  poseTail({ pitch = STAND_POSE.tailPitch, spread = STAND_POSE.tailSpread, roll = 0, yaw = 0 } = {}) {
    const rectrices = this.joints.rectrices;
    const halfFan = spread * 0.5;
    for (const rect of rectrices) {
      const side = rect.side;
      const u = rect.index / 5;
      const fan = halfFan * Math.pow(u, 0.85) * side + yaw * (0.3 + 0.7 * u);
      const p = pitch + 6 * (1 - u) - 2;
      const f = fan * DEG;
      const pi = p * DEG;
      const rl = roll * DEG * (0.6 + 0.4 * u);
      const cp = Math.cos(pi);
      const ey = new Vector3(side * Math.sin(f) * cp, Math.sin(pi), -Math.cos(f) * cp).normalize();
      const ez = new Vector3(0, 1, 0).addScaledVector(ey, -Math.sin(pi)).normalize();
      const ex = ey.clone().cross(ez).normalize();
      if (rl) {
        const q = new Quaternion().setFromAxisAngle(ey, rl);
        ex.applyQuaternion(q);
        ez.applyQuaternion(q);
      }
      rect.pivot.quaternion.setFromRotationMatrix(_m.makeBasis(ex, ey, ez));
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  Wings                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * @param {object} wing  indexed wing (right | left)
   * @param {object} s     pose state, see cycles.js
   */
  poseWing(wing, s, useBend = true) {
    const side = wing.side;
    const m = side; // mirror multiplier for Y/Z rotations
    const { shoulder, elbow, wrist, digit } = wing.joints;

    const sh = s.shoulder ?? {};
    composeJoint(
      shoulder.quaternion,
      X_AXIS,
      (sh.twist ?? 0) * DEG,
      Y_AXIS,
      (sh.sweep ?? 0) * DEG * m,
      Z_AXIS,
      (sh.elev ?? 0) * DEG * m,
    );

    const el = s.elbow ?? {};
    const elbowFlex = clamp(el.flex ?? 0, KL.elbowFlexion.min, KL.elbowFlexion.max);
    composeJoint(
      elbow.quaternion,
      X_AXIS,
      (el.twist ?? 0) * DEG,
      Y_AXIS,
      elbowFlex * DEG * m,
      Z_AXIS,
      (el.elev ?? 0) * DEG * m,
    );

    const wr = s.wrist ?? {};
    let wristFlex = wr.flex;
    if (wristFlex === undefined) {
      // Automatic radius/radiale coupling: flexing the elbow drags the wrist
      // closed.  This is a mechanical linkage, not a choice, and it is the
      // reason a folding bird wing Z-folds instead of bending like an arm.
      wristFlex =
        KL.wristCouplingBias + elbowFlex * KL.wristCouplingGain;
    }
    wristFlex = clamp(wristFlex, KL.wristFlexion.min, KL.wristFlexion.max);
    composeJoint(
      wrist.quaternion,
      X_AXIS,
      (wr.twist ?? 0) * DEG,
      Y_AXIS,
      wristFlex * DEG * m,
      Z_AXIS,
      (wr.elev ?? 0) * DEG * m,
    );

    const dg = s.digit ?? {};
    composeJoint(
      digit.quaternion,
      X_AXIS,
      (dg.twist ?? 0) * DEG,
      Y_AXIS,
      (dg.flex ?? 0) * DEG * m,
      Z_AXIS,
      (dg.elev ?? 0) * DEG * m,
    );

    this._poseFeathers(wing, s, useBend);

    // Alula deploys as a leading-edge slat at high angle of attack.
    const dep = clamp(s.alula ?? 0, 0, 1);
    wing.alula.forEach((a, i) => {
      const rest = wing.rest.alula[i];
      a.pivot.quaternion
        .copy(rest)
        .multiply(_q3.setFromAxisAngle(Y_AXIS, dep * (16 + 12 * i) * DEG));
    });
  }

  _poseFeathers(wing, s, useBend = true) {
    const f = s.feather ?? {};
    const sec = s.secondary ?? {};
    // The aeroelastic bend is realised through the spring, so the primaries
    // keep flexing after the wing has already reversed — that lag is the whole
    // reason a feather looks like a feather and not like a plank.
    const springBend = useBend ? (this._featherBend?.[wing.side > 0 ? 'right' : 'left'] ?? 0) : 0;
    const flutter = this._featherFlutter ?? 0;

    const pitchAt = (i, n) =>
      (f.pitch ?? 0) * DEG + ((f.pitchGrad ?? 0) * DEG * (i / (n - 1)));
    const bendAt = (i, n) =>
      ((useBend ? springBend : (f.bend ?? 0)) + flutter * (f.flutterGrad ? 1 : 0.4)) *
      DEG *
      lerp(0.35, 1.0, i / (n - 1));
    const spreadAt = (i, n) =>
      ((f.spread ?? 0) + (f.spreadGrad ?? 0) * (i / (n - 1))) * DEG;
    const liftAt = (i, n) => ((f.lift ?? 0) + (f.liftGrad ?? 0) * (i / (n - 1))) * DEG;

    wing.primaries.forEach((p, i) => {
      const n = wing.primaries.length;
      const rest = wing.rest.primaries[i];
      const q = _q.copy(rest);
      // Fan spread: rotate about the wing's dorsal axis.
      q.premultiply(_q2.setFromAxisAngle(Y_AXIS, spreadAt(i, n) * wing.side));
      // Out-of-plane lift, about the axis in the wing plane perpendicular to
      // the feather (this is the aeroelastic bend of the outer primaries).
      const ey = _v.copy(Y_AXIS).applyQuaternion(rest);
      const axis = _v2.copy(ey).cross(Y_AXIS);
      if (axis.lengthSq() > 1e-8) {
        axis.normalize();
        q.premultiply(_q3.setFromAxisAngle(axis, liftAt(i, n) + bendAt(i, n)));
      }
      // Feathering about the rachis: the propeller-pitch change that lets air
      // through on the upstroke.
      q.multiply(_q2.setFromAxisAngle(Y_AXIS, pitchAt(i, n)));
      p.pivot.quaternion.copy(q);
    });

    wing.secondaries.forEach((p, j) => {
      const n = wing.secondaries.length;
      const rest = wing.rest.secondaries[j];
      const q = _q.copy(rest);
      q.premultiply(
        _q2.setFromAxisAngle(
          Y_AXIS,
          (((sec.spread ?? 0) + (sec.spreadGrad ?? 0) * (j / (n - 1))) * DEG) * wing.side,
        ),
      );
      q.multiply(
        _q3.setFromAxisAngle(
          Y_AXIS,
          (((sec.pitch ?? 0) + (sec.pitchGrad ?? 0) * (j / (n - 1))) * DEG),
        ),
      );
      p.pivot.quaternion.copy(q);
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Beak                                                                   */
  /* ---------------------------------------------------------------------- */

  poseBeak({ open = 0 } = {}) {
    const o = clamp(open, 0, 1);
    // The upper mandible is the mobile one in birds (cranial kinesis); the
    // lower drops further.  Gape reaches ~55 deg in a full screech.
    const { upperPivot, lowerPivot, mouthMesh, tonguePivot, tongue } = this.joints;
    if (upperPivot) upperPivot.rotation.x = -o * 7 * DEG;
    if (lowerPivot) lowerPivot.rotation.x = o * 46 * DEG;
    if (mouthMesh) mouthMesh.visible = o > 0.06;
    if (tonguePivot) tonguePivot.rotation.x = o * 12 * DEG;
    if (tongue) tongue.visible = o > 0.06;
  }

  /* ---------------------------------------------------------------------- */
  /*  Master apply                                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * Pose everything from a single pose object.
   *
   * Order matters: the trunk must be placed and its world matrix refreshed
   * before the head is solved, because the head's target is given in world
   * space (that is the whole point of head stabilisation — a bird holds its
   * head still in the WORLD, not in its body).
   */
  apply(pose, dt = 1 / 60) {
    const sp = this.springs;

    /* 1. trunk ------------------------------------------------------------ */
    this.poseTrunk(pose.trunk);
    this.trunk.updateMatrix();
    // Inverses of the two frames the rig measures in: the eagle root's, which
    // is where the ground plane lives, and the trunk's, which is where the
    // legs are solved.  Mixing them up makes a foot track the body's bob
    // instead of the floor.
    this.eagle.root.updateWorldMatrix(true, false);
    this._rootWorldInv = this.eagle.root.matrixWorld.clone().invert();
    this.trunk.updateWorldMatrix(true, false);
    this._trunkWorldInv = this.trunk.matrixWorld.clone().invert();
    // Feet are specified in the eagle's frame but solved in the trunk's frame,
    // so a rocking trunk does not drag planted feet across the ground.
    this._trunkLocalInv = this.trunk.matrix.clone().invert();
    this.trunk.updateWorldMatrix(true, false);

    /* 2. gather spring targets ------------------------------------------- */
    const targetLocal = new Vector3();
    if (pose.head.localOffset) targetLocal.copy(pose.head.localOffset);
    else if (pose.head.target) targetLocal.copy(this.trunk.worldToLocal(pose.head.target.clone()));
    else targetLocal.set(0, this.neckBase.y + 0.088, this.neckBase.z + 0.028);

    if (!pose.head.noSpring) {
      // Head stabilisation lives in WORLD space: this is why a bird's head
      // stays put while its body bobs underneath.
      const world = this.trunk.localToWorld(targetLocal.clone());
      sp.head.setTarget([world.x, world.y, world.z]);
    } else {
      sp.head.reset([targetLocal.x, targetLocal.y, targetLocal.z]);
    }
    const aim = pose.head.aim ?? {};
    if (!pose.head.noSpring) sp.headAim.setTarget([aim.yaw ?? 0, aim.pitch ?? 0, aim.roll ?? 0]);
    else sp.headAim.reset([aim.yaw ?? 0, aim.pitch ?? 0, aim.roll ?? 0]);

    sp.tail.setTarget([pose.tail.pitch, pose.tail.yaw ?? 0, pose.tail.roll ?? 0]);
    sp.tailSpread.target = pose.tail.spread;
    sp.featherBendR.target = pose.spring.featherBend ?? pose.wings.R.feather.bend ?? 0;
    sp.featherBendL.target =
      pose.spring.featherBendLeft ?? pose.spring.featherBend ?? pose.wings.L.feather.bend ?? 0;
    sp.featherFlutter.target = pose.spring.featherFlutter ?? 0;
    if (pose.spring.headOmega) {
      sp.head.omega = pose.spring.headOmega;
      sp.headAim.omega = pose.spring.headOmega * 1.25;
    }
    if (pose.spring.tailOmega) {
      sp.tail.omega = pose.spring.tailOmega;
      sp.tailSpread.omega = pose.spring.tailOmega;
    }

    /* 3. integrate the secondary motion ----------------------------------- */
    this.updateSprings(dt);

    /* 4. tail — the fan trails the pelvis -------------------------------- */
    this.poseTail({
      pitch: sp.tail.x.value,
      yaw: sp.tail.y.value,
      roll: sp.tail.z.value,
      spread: sp.tailSpread.value,
    });

    /* 5. legs ------------------------------------------------------------- */
    this.poseLeg(this.legs.right, pose.legs.R);
    this.poseLeg(this.legs.left, pose.legs.L);

    /* 6. wings + feathers -------------------------------------------------- */
    this._featherBend = { right: sp.featherBendR.value, left: sp.featherBendL.value };
    this._featherFlutter = sp.featherFlutter.value;
    for (const key of ['R', 'L']) {
      const wing = this.wings[key === 'R' ? 'right' : 'left'];
      this.poseWing(wing, pose.wings[key], pose.spring.featherBend === undefined);
    }

    /* 7. neck + head ------------------------------------------------------ */
    if (!pose.head.noSpring) {
      targetLocal.copy(
        this.trunk.worldToLocal(new Vector3(sp.head.x.value, sp.head.y.value, sp.head.z.value)),
      );
    }
    const useAim = pose.head.noSpring
      ? { yaw: aim.yaw ?? 0, pitch: aim.pitch ?? 0, roll: aim.roll ?? 0 }
      : { yaw: sp.headAim.x.value, pitch: sp.headAim.y.value, roll: sp.headAim.z.value };
    this.poseNeck(targetLocal, useAim, pose.head.curve ?? 1, pose.head.twist ?? 0.72);

    /* 8. face ------------------------------------------------------------- */
    this.poseBeak(pose.beak);
    this.poseEyes(pose.eyes);
    this._lastPose = pose;
  }

  poseEyes({ yaw = 0, pitch = 0, blink = 0 } = {}) {
    const { eyeRight, eyeLeft } = this.joints;
    const b = clamp(blink, 0, 1);
    for (const eye of [eyeRight, eyeLeft]) {
      if (!eye) continue;
      // Birds have limited ocular mobility; a few degrees of gaze shift, then
      // the head does the rest.
      eye.orbital.rotation.y += 0;
      if (eye.lidPivot) eye.lidPivot.rotation.x = 0.5 - b * 1.42;
      if (eye.lowerLidPivot) eye.lowerLidPivot.rotation.x = Math.PI - 0.35 + b * 0.34;
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  Springs                                                                */
  /* ---------------------------------------------------------------------- */

  updateSprings(dt) {
    this._springAcc += Math.min(dt, 0.08);
    const h = 1 / 240;
    let guard = 0;
    while (this._springAcc >= h && guard++ < 64) {
      for (const s of this._springList) s.step(h);
      this._springAcc -= h;
    }
  }

  /** Snap all secondary motion to its target (used when scrubbing time). */
  resetSprings() {
    const sp = this.springs;
    const snap = (s, v) => {
      if (typeof v === 'number') s.reset(v);
      else s.reset(v);
    };
    snap(sp.tail, [this._lastPose?.tail.pitch ?? 0, 0, 0]);
    snap(sp.tailSpread, this._lastPose?.tail.spread ?? 20);
    snap(sp.featherBendR, this._lastPose?.spring?.featherBend ?? 0);
    snap(sp.featherBendL, this._lastPose?.spring?.featherBend ?? 0);
    snap(sp.featherFlutter, 0);
  }
}

/** Cubic through 4 control points with Catmull-Rom tangents. */
function catmull3(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const out = new Vector3();
  const a0 = p1.clone().multiplyScalar(2);
  const a1 = p2.clone().sub(p0);
  const a2 = p0.clone().multiplyScalar(2).sub(p1.clone().multiplyScalar(5)).add(p2.clone().multiplyScalar(4)).sub(p3);
  const a3 = p0.clone().multiplyScalar(-1).add(p1.clone().multiplyScalar(3)).sub(p2.clone().multiplyScalar(3)).add(p3);
  out.copy(a0).addScaledVector(a1, t).addScaledVector(a2, t2).addScaledVector(a3, t3).multiplyScalar(0.5);
  return out;
}

export { catmull3 };
