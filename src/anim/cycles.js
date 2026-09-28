/**
 * Animation cycles.
 *
 * Each function is a pure function of cycle phase and returns a pose
 * fragment.  The numbers are not arbitrary: they encode published and
 * measured avian kinematics.
 *
 *  FLAP
 *    frequency      2.8 Hz  [PNAS 2021, wild golden eagle accelerometer]
 *    down:up ratio  58:42   (the power stroke is longer than the recovery)
 *    pronation leads the stroke by ~9 % of the cycle — the wing sets its
 *    angle of attack *before* the stroke starts, which is what makes a bird
 *    wing look driven rather than floppy;
 *    the hand lags the arm by ~0.10 of a cycle (spanwise phase lag), so the
 *    wing whips outward.  Lift/drag then peaks at the wingtip after the
 *    shoulder has already reversed.
 *
 *  GLIDE
 *    5-8 deg dihedral (golden eagles are the Aquila that habitually soars
 *    with the wings in a shallow V), zero pronation, alula retracted,
 *    primaries slotted open, plus low-amplitude aeroelastic flutter of the
 *    outer primaries and slow roll micro-corrections.
 *
 *  WALK
 *    duty factor 0.655 (avian walking, Biewener/Alexander), stride 0.27 m at
 *    1.15 strides/s => 0.31 m/s ground speed.  The body vaults over a stiff
 *    leg (COM highest at mid-stance) — the opposite phasing to a running
 *    biped.  The head holds station in space then thrusts forward: the
 *    documented "head bobbing" of walking birds.
 */

import { Vector3 } from 'three';
import { KINEMATIC_LIMITS } from '../anatomy.js';
import { STAND_POSE } from '../model/eagle.js';
import { DEG, clamp, fbm1, lerp, noise1, pulse, smoothstep, smootherstep, wrap01 } from '../lib/mathx.js';

/**
 * Height of the ground plane in the eagle's own frame when the bird is
 * standing.  Derived: the trunk origin sits `STAND_HEIGHT` above the sole
 * plane, so the sole plane is at minus that.  `EagleRig.standHeight` publishes
 * the same number for the viewer, and `test/` checks the feet really land
 * here rather than trusting the arithmetic.
 */
// Fallback ground height for callers with no rig to calibrate against (the
// rig publishes its own standHeight).  Keep it in step with the built model:
// a stale value here silently hovers the whole bird.
export const GROUND_LEVEL = -0.274814;

/* -------------------------------------------------------------------------- */
/*  Pose scaffolding                                                           */
/* -------------------------------------------------------------------------- */

export function zeroWing() {
  return {
    shoulder: { elev: 0, sweep: 0, twist: 0 },
    elbow: { flex: null, elev: 0, twist: 0 },
    wrist: { flex: null, elev: 0, twist: 0 },
    digit: { flex: 0, elev: 0, twist: 0 },
    feather: { pitch: 0, pitchGrad: 0, bend: 0, bendGrad: 0, spread: 0, spreadGrad: 0, lift: 0, liftGrad: 0 },
    secondary: { pitch: 0, pitchGrad: 0, spread: 0, spreadGrad: 0 },
    alula: 0,
  };
}

/**
 * A leg at rest in flight: the eagle folds it up against the belly, the
 * tarso-metatarsus swung back so the clenched foot sits under the tail.
 * This is the neutral the flight clips start from, and it is why they never
 * have to mention the legs at all.
 */
export function zeroLeg(side = 1) {
  const s = side === 'L' || side === -1 ? -1 : 1;
  return {
    ankle: new Vector3(s * 0.05, -0.055, 0.012),
    footRoot: null,
    tarsusPitch: -107, // tarsus points back and slightly up
    footPitch: -46, // ankle cocked so the foot rides along the belly
    footYaw: 0,
    footRoll: 0,
    toeCurl: 0.82, // toes clenched
  };
}

export function defaultPose() {
  return {
    trunk: { pitch: STAND_POSE.trunkPitch, yaw: 0, roll: 0, x: 0, y: 0, z: 0 },
    head: {
      target: null, // world-space; null = derive from the neck's rest carry
      aim: { yaw: 0, pitch: -4, roll: 0 },
      curve: 1,
      twist: 0.72,
    },
    beak: { open: 0 },
    eyes: { yaw: 0, pitch: 0, blink: 0 },
    tail: { pitch: STAND_POSE.tailPitch, spread: STAND_POSE.tailSpread, roll: 0, yaw: 0 },
    wings: { R: zeroWing(), L: zeroWing() },
    legs: { R: zeroLeg(1), L: zeroLeg(-1) },
    spring: { featherBend: 0, featherPitch: 0, featherFlutter: 0, tailFollow: [0, 0, 0] },
    ground: 0,
  };
}

const copyWing = (src) =>
  JSON.parse(JSON.stringify(src), (k, v) => v);

/* -------------------------------------------------------------------------- */
/*  FLAP                                                                       */
/* -------------------------------------------------------------------------- */

export const FLAP_PARAMS = Object.freeze({
  frequency: 2.8,
  downStroke: 0.58,
  // Stroke envelope, from high-speed film of large soaring raptors rather
  // than from the pigeon-style textbook numbers: an eagle's beat is shallower
  // than a pigeon's, and -- the part that is easy to get wrong -- it keeps the
  // wing almost fully spread throughout.  Folding the hand in at the top of
  // the upstroke, as a small bird does, drops the span by three quarters and
  // makes a 2.1 m eagle look like a crow at 2.8 beats a second.
  elevTop: 44,
  elevBottom: -32,
  sweepBack: -16,
  sweepFwd: 12,
  // Twist is pronation/supination of the whole wing and it is a small term:
  // driven hard it does not feather the wing, it rolls the primaries round the
  // wing's long axis and swings the tip inboard, collapsing the span exactly
  // where an eagle keeps it widest.  The feathering belongs to the feathers'
  // own pitch, below, which is where a real wing does it too.
  twistPro: 14,
  twistSup: -12,
  elbowBottom: 4, // extended at the bottom of the downstroke (power stroke)
  elbowTop: 20, // folded at the top of the upstroke (recovery)
  wristBottom: 3,
  wristTop: 15,
  handLag: 0.1,
  feathering: 34,
  dihedral: 6,
});

/**
 * One complete wingbeat.
 * @param {number} phase 0..1, 0 = top of the upstroke = start of the downstroke
 * @param {object} p FLAP_PARAMS overrides
 * @param {number} side +1 right / -1 left
 * @param {object} out wing pose to fill
 */
export function flapCycle(phase, out, p = FLAP_PARAMS, side = 1) {
  const f = wrap01(phase);
  const df = p.downStroke;

  // Stroke variable: 1 at the top of the upstroke, 0 at the bottom of the
  // downstroke.  Both halves are eased, so the wing accelerates through
  // mid-stroke and decelerates into each reversal, exactly like a real
  // wingbeat.  This is the single clock everything else is read against; if
  // its sense is ever flipped the wing folds when it should be stretched.
  const strokeAt = (x) => {
    const k = wrap01(x);
    return k < df ? 1 - smootherstep(k / df) : smootherstep((k - df) / (1 - df));
  };
  const stroke = strokeAt(f);

  const elev = lerp(p.elevBottom, p.elevTop, stroke);
  // Sustained-stroke velocity: +1 rising, -1 descending, 0 at each reversal.
  // Drives the aeroelastic response below.
  const vel = (f < df ? -1 : 1) * Math.sin(Math.PI * clamp(
    f < df ? f / df : (f - df) / (1 - df),
    0,
    1,
  ));

  // Sweep: forward through the downstroke, back through the upstroke.  The
  // extremes lag the elevation by ~8 % of the cycle, because the wing carries
  // momentum through the reversal.
  const sweep = lerp(p.sweepFwd, p.sweepBack, strokeAt(f - 0.08));

  // Pronation leads the stroke: the wing sets its angle of attack slightly
  // before the stroke begins, and supinates as the upstroke starts.
  const proStroke = clamp((strokeAt(f + 0.09) - stroke) * 3.2 + 0.5, 0, 1);
  const twist = f < df
    ? lerp(p.twistSup, p.twistPro, smootherstep(clamp((f + 0.09) / (df * 0.55), 0, 1)))
    : lerp(p.twistPro, p.twistSup, smootherstep(clamp((proStroke), 0, 1)) * 0.0 + smootherstep(clamp((f - df) / (0.42), 0, 1)));

  // The hand trails the arm (spanwise phase lag): it is still coming down when
  // the arm has already started back up, and vice versa.  That lag is most of
  // what makes a wingbeat look like a wingbeat on camera.
  const handStroke = strokeAt(f - p.handLag);
  const handElev = lerp(-8, 12, handStroke);

  // The elbow extends fully at the bottom of the downstroke — that is the
  // power stroke, and it needs the whole wing — and folds on the upstroke to
  // recover.  Same phase for the wrist, which is driven by the radius sliding
  // on the ulna.
  const elbowFlex = lerp(p.elbowBottom, p.elbowTop, handStroke);
  const wristFlex = lerp(p.wristBottom, p.wristTop, smootherstep(handStroke));

  out.shoulder.elev = elev + p.dihedral;
  out.shoulder.sweep = sweep;
  out.shoulder.twist = twist;
  out.elbow.flex = elbowFlex;
  out.elbow.elev = handElev;
  out.wrist.flex = wristFlex;
  out.wrist.elev = handElev * 0.6;
  out.digit.flex = handElev * 0.35;

  // Feathering: the primaries pitch to let air through on the upstroke.
  const feather = (f < df ? 1 : -1) * p.feathering * (0.5 + 0.5 * Math.abs(vel));
  out.feather.pitch = feather * 0.35 + twist * 0.25;
  out.feather.pitchGrad = feather * 0.9;
  out.feather.spread = f > df ? 5.5 : 1.0;
  out.feather.spreadGrad = f > df ? 11 : 3;
  out.feather.bend = -vel * 7.5; // tips lag and curl under load
  out.feather.bendGrad = -vel * 5.5;
  out.feather.lift = 0;
  out.feather.liftGrad = 0;
  out.secondary.pitch = twist * 0.18;
  out.secondary.spread = f > df ? 3 : 0.5;
  out.alula = f > df ? 0.75 : 0.08;

  return { elev, sweep, twist, vel, stroke };
}

/** Body response to a flapping wingbeat (mass reacts to the wing's lift). */
export function flapBodyResponse(phase, p = FLAP_PARAMS) {
  const f = wrap01(phase);
  const df = p.downStroke;
  const stroke = f < df ? smootherstep(f / df) : 1 - smootherstep((f - df) / (1 - df));
  // Peak lift late in the downstroke lifts the body; the upstroke lets it sink.
  const lift = f < df ? Math.sin(Math.PI * clamp(f / df, 0, 1)) : -Math.sin(Math.PI * clamp((f - df) / (1 - df), 0, 1));
  return {
    y: lift * 0.032 - 0.004,
    z: -Math.cos(2 * Math.PI * stroke) * 0.012,
    pitch: lift * 2.6 + 1.2,
    rollOsc: Math.sin(2 * Math.PI * f) * 0.5,
  };
}

/* -------------------------------------------------------------------------- */
/*  GLIDE                                                                      */
/* -------------------------------------------------------------------------- */

export function glidePose(t, out, opts = {}) {
  const { dihedral = 6.5, spread = 1.0, speed = 1.0 } = opts;
  // Slow roll/pitch phasing as the bird rides a thermal; plus tiny
  // asymmetric corrections of the kind a real soaring eagle makes.
  const corr = fbm1(t * 0.18, 3, 11);
  const corr2 = fbm1(t * 0.23 + 5.1, 3, 23);
  const corr3 = fbm1(t * 0.31 + 9.7, 2, 41);

  out.shoulder.elev = dihedral + corr * 1.4;
  out.shoulder.sweep = -2.5 + corr2 * 1.6;
  out.shoulder.twist = 1.2 + corr3 * 1.1;
  out.elbow.flex = 3.2 + Math.abs(corr) * 1.5;
  out.elbow.elev = -1.6;
  out.wrist.flex = 4.5 + Math.abs(corr2) * 1.5;
  out.wrist.elev = -2.2;
  out.digit.flex = -1.5;

  // The wing is unloaded: the primaries separate into the slotted tip and
  // flutter with a small high-frequency aeroelastic ripple.
  const flutter = Math.sin(t * 2 * Math.PI * 11.5) * 0.5 + Math.sin(t * 2 * Math.PI * 7.3 + 1.1) * 0.5;
  out.feather.pitch = -2 + corr * 1.0;
  out.feather.pitchGrad = -3.5;
  out.feather.spread = (10 + corr2 * 2.2) * spread;
  out.feather.spreadGrad = (16 + corr3 * 3) * spread;
  out.feather.bend = 3.4 + corr * 1.2 + flutter * 0.85 * speed;
  out.feather.bendGrad = 6.2 + flutter * 1.5 * speed;
  out.feather.lift = 0.8;
  out.feather.liftGrad = 2.4;
  out.secondary.pitch = -1.2 + corr2 * 0.5;
  out.secondary.spread = 2.4;
  out.secondary.spreadGrad = 1.6;
  out.alula = 0.04;
  return { corr, corr2, corr3, flutter };
}

/* -------------------------------------------------------------------------- */
/*  WALK                                                                       */
/* -------------------------------------------------------------------------- */

export const WALK_PARAMS = Object.freeze({
  // Stride length is limited by the leg, not chosen: at the end of stance the
  // foot is behind the body by half the stance excursion, and past about
  // 0.17 m per stride the intertarsal joint is further from the hip than the
  // femur and tibiotarsus can reach -- the IK clamps and the sole dips through
  // the floor.  This is the longest stride the built leg can actually take.
  strideLength: 0.17,
  frequency: 1.15,
  duty: 0.655,
  liftHeight: 0.052,
  bodyBob: 0.016,
  bodySway: 0.009,
  bodyRoll: 2.6,
  bodyYaw: 2.2,
  headHold: 0.24, // fraction of the cycle the head is locked in space
  headThrust: 0.2,
  tarsusTouchdown: 38,
  tarsusMidstance: 20,
  tarsusToeOff: 7,
  toeCurlContact: 0.62,
  toeCurlPush: 0.05,
});

export function walkSpeed(p = WALK_PARAMS) {
  return p.strideLength * p.frequency;
}

/**
 * One leg's step cycle.
 * @param {number} phase 0..1, 0 = touch-down of THIS foot
 */
export function walkLeg(phase, footPhaseOffsetZ, out, p = WALK_PARAMS) {
  const f = wrap01(phase);
  const duty = p.duty;
  const speed = walkSpeed(p);
  const T = 1 / p.frequency;
  const excursion = speed * duty * T; // how far the foot travels in body space

  let z;
  let lift = 0;
  let tarsusPitch;
  let toeCurl;

  if (f < duty) {
    // Stance: the foot is locked to the world, so in body space it slides
    // backwards at exactly the ground speed.  No foot slip, by construction.
    const u = f / duty;
    z = footPhaseOffsetZ + excursion * 0.5 - u * excursion;
    lift = 0;
    // Shank angle: leans forward at contact, vertical at mid-stance, sweeps
    // back into toe-off as the body passes over the planted foot.
    tarsusPitch =
      u < 0.5
        ? lerp(p.tarsusTouchdown, p.tarsusMidstance, smootherstep(u / 0.5))
        : lerp(p.tarsusMidstance, p.tarsusToeOff, smootherstep((u - 0.5) / 0.5));
    // The toes grip on contact then relax into the push-off.
    toeCurl = lerp(p.toeCurlContact, p.toeCurlPush, smootherstep(clamp(u / 0.55, 0, 1)));
  } else {
    // Swing: the foot lifts, travels forward and prepares to land.
    const u = (f - duty) / (1 - duty);
    const travel = excursion;
    z = footPhaseOffsetZ - excursion * 0.5 + travel * smootherstep(clamp((u - 0.12) / 0.76, 0, 1));
    lift = p.liftHeight * Math.sin(Math.PI * clamp(u, 0, 1)) * (u < 0.5 ? 1 : 0.72);
    tarsusPitch = lerp(
      p.tarsusToeOff,
      p.tarsusTouchdown,
      smootherstep(clamp((u - 0.2) / 0.8, 0, 1)),
    );
    toeCurl = lerp(0.05, p.toeCurlContact, smootherstep(clamp((u - 0.55) / 0.45, 0, 1)));
  }

  out.footPhase = f;
  out.z = z;
  out.lift = lift;
  out.tarsusPitch = tarsusPitch;
  out.toeCurl = toeCurl;
  return out;
}

/**
 * Full walk pose at phase `phase` (0 = right foot touch-down).
 * `groundY` is the world height of the sole plane.
 */
export function walkCycle(phase, pose, groundY = 0, p = WALK_PARAMS) {
  const f = wrap01(phase);
  const speed = walkSpeed(p);
  const T = 1 / p.frequency;

  // ---- body: vaulting gait, COM highest at mid-stance ----------------------
  // Two stance phases per stride, so the vertical oscillation runs at twice
  // stride frequency -- but it has to be *phased* to mid-stance, not to
  // touchdown.  The bird vaults over a stiff leg: the trunk is highest when
  // the body passes over the planted foot and lowest at each contact.  Getting
  // that half-cycle wrong makes the bird crouch exactly when it should be
  // rising, and it is the difference between a walk and a waddle.
  const midStance = p.duty * 0.5;
  const bob = p.bodyBob * 0.5 * (1 + Math.cos(2 * Math.PI * 2 * (f - midStance)));
  // Lateral sway: the trunk shifts over the loaded leg once per stride.
  const sway = Math.sin(2 * Math.PI * f) * p.bodySway;
  const roll = Math.sin(2 * Math.PI * f) * p.bodyRoll;
  const yaw = Math.sin(2 * Math.PI * f + Math.PI * 0.5) * p.bodyYaw;

  pose.trunk.y = bob;
  pose.trunk.x = sway;
  pose.trunk.z = 0;
  pose.trunk.roll = roll;
  pose.trunk.yaw = yaw;
  pose.trunk.pitch = STAND_POSE.trunkPitch + Math.cos(2 * Math.PI * 2 * (f - midStance)) * 1.5;

  // ---- legs ---------------------------------------------------------------
  const legStates = {};
  for (const side of ['R', 'L']) {
    const phaseOffset = side === 'R' ? 0 : 0.5;
    const st = walkLeg(f - phaseOffset, 0, {}, p);
    legStates[side] = st;
    const leg = pose.legs[side];
    const sign = side === 'R' ? 1 : -1;
    // Position is given in the eagle's own frame, where the ground sits at
    // `groundY`.  During stance this point is FIXED in the world, so the foot
    // cannot slide: the body vaults over it instead.
    leg.footRoot = new Vector3(sign * 0.043, groundY, st.z);
    leg.tarsusPitch = st.tarsusPitch;
    // Keep the sole level with the substrate while planted; allow a slight
    // toes-down presentation just before contact.
    const contactBlend = st.footPhase < p.duty ? 1 : clamp(1 - (st.footPhase - p.duty) / 0.25, 0, 1);
    leg.footPitch = (25 - st.tarsusPitch) + (1 - contactBlend) * -14;
    // The rig solves the ankle so that the sole sits exactly on the plane the
    // sole is asked for: on the substrate through stance, and on the lift arc
    // through swing.  `footRoot` above is only a handle for the *horizontal*
    // placement, so the two can never fight each other.
    leg.plantY = groundY + st.lift;
    leg.toeCurl = st.toeCurl;
    leg.footYaw = sign * 3.5;
    leg.footRoll = -roll * 0.5 * sign;
  }

  // ---- head: hold-in-space / thrust ("head bobbing") -----------------------
  // The head's WORLD position is a staircase: locked while the body slides
  // forward underneath it, then a fast thrust to the next fix.  The neck's
  // reach sets how long the hold can last, so it is derived, not picked.
  const neckRange = 0.062; // metres of fore/aft head travel the neck allows
  const holdFrac = clamp(neckRange / (speed * T), 0.08, 0.45);
  const thrustFrac = p.headThrust * (1 - holdFrac) / (p.headHold + p.headThrust);
  let headWorldAdvance;
  // work in phase-normalised units relative to the current body position
  const cycleDistance = speed * T;
  if (f < holdFrac) {
    headWorldAdvance = 0; // frozen in space
  } else if (f < holdFrac + thrustFrac) {
    const u = (f - holdFrac) / thrustFrac;
    headWorldAdvance = cycleDistance * holdFrac * smootherstep(u);
  } else {
    const u = (f - holdFrac - thrustFrac) / (1 - holdFrac - thrustFrac);
    headWorldAdvance = cycleDistance * (holdFrac + u * (1 - holdFrac));
  }
  const bodyAdvance = cycleDistance * f;
  // Local fore/aft offset of the head relative to the body's centre of mass.
  const headLocalZ = 0.055 + (headWorldAdvance - bodyAdvance);
  const headBobY = -Math.cos(2 * Math.PI * 2 * f) * 0.006;

  pose.head.aim.yaw = -yaw * 0.55 + Math.sin(2 * Math.PI * f) * 2.0;
  pose.head.aim.pitch = -6 + Math.cos(2 * Math.PI * 2 * f) * 1.4;
  pose.head.aim.roll = -roll * 0.35;
  pose.head.curve = 1.15;
  pose.head.localOffset = new Vector3(0, 0.032 + headBobY, headLocalZ - 0.055);

  // ---- tail: counter-sway and a small lift on each step -------------------
  pose.tail.pitch = STAND_POSE.tailPitch + Math.cos(2 * Math.PI * 2 * f) * 3.2;
  pose.tail.spread = 22 + Math.sin(2 * Math.PI * f) * 4;
  pose.tail.yaw = -yaw * 1.5;
  pose.tail.roll = -roll * 0.8;

  // ---- wings: balance, and a small settle between steps -------------------
  for (const side of ['R', 'L']) {
    const w = pose.wings[side];
    const st = legStates[side];
    const isSwing = st.footPhase >= p.duty;
    const settle = Math.sin(2 * Math.PI * f + (side === 'R' ? 0 : Math.PI)) * 0.5 + 0.5;
    w.shoulder.elev = 4 + settle * 2.2;
    w.shoulder.sweep = 1.5;
    w.shoulder.twist = -3;
    w.elbow.flex = 88 - settle * 4;
    w.elbow.elev = -6;
    w.wrist.flex = 96;
    w.wrist.elev = 6;
    w.feather.pitch = -4;
    w.feather.spread = 2;
    w.feather.bend = 2;
    w.alula = 0.02;
  }
  pose.beak.open = 0;
  pose.eyes.blink = 0;
  return { bob, sway, roll, headLocalZ };
}

/* -------------------------------------------------------------------------- */
/*  IDLE                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Perched idle: breathing, weight shifts, micro head saccades, tail flicks,
 * a blink, and a slow wing settle.  Layered noise keeps it from ever looping
 * visibly on the short timescales, while the "events" are placed on a fixed
 * schedule so the clip is reproducible.
 */
export function idlePose(t, pose, opts = {}) {
  const ground = opts.ground ?? GROUND_LEVEL;
  const breath = Math.sin(t * 2 * Math.PI * 0.38);
  const swaySlow = fbm1(t * 0.11, 3, 3);
  const micro = fbm1(t * 0.9, 3, 7);

  pose.trunk.pitch = STAND_POSE.trunkPitch + breath * 0.55 + micro * 0.35;
  pose.trunk.roll = swaySlow * 1.1;
  pose.trunk.yaw = fbm1(t * 0.13 + 2.2, 3, 9) * 1.6;
  pose.trunk.y = breath * 0.0045 + Math.abs(micro) * 0.0015;
  pose.trunk.x = swaySlow * 0.0035;

  // Head: mostly still, punctuated by quick looks.  Real eagles scan
  // constantly, moving the head far more than the body.
  const scan = Math.sin(t * 0.53) + Math.sin(t * 0.31 + 1.7);
  const saccade = Math.tanh(scan * 2.2);
  pose.head.aim.yaw = saccade * 22 + micro * 2.5;
  pose.head.aim.pitch = -5 + Math.sin(t * 0.71 + 0.4) * 6 + micro * 1.2;
  pose.head.aim.roll = -pose.trunk.roll * 0.5 + saccade * 3;
  pose.head.curve = 1.0 + 0.2 * breath;

  // Tail: settles, and flicks occasionally as a balance correction.
  const flick = pulse(wrap01(t * 0.16), 0.06, 0.1) - pulse(wrap01(t * 0.16 + 0.5), 0.05, 0.09);
  pose.tail.pitch = STAND_POSE.tailPitch + breath * 0.8 + flick * 5;
  pose.tail.spread = STAND_POSE.tailSpread + Math.sin(t * 0.4) * 1.5 + Math.abs(flick) * 4;
  pose.tail.roll = -pose.trunk.roll * 0.9;
  pose.tail.yaw = -pose.trunk.yaw * 1.2;

  // Wings: folded, with a settle.  Folded wing geometry is a Z: humerus back
  // and down, forearm forward, hand back — driven by the elbow, with the
  // wrist following through the radius/radiale linkage.
  for (const side of ['R', 'L']) {
    const w = pose.wings[side];
    const settle = Math.sin(t * 0.47 + (side === 'R' ? 0 : 1.3)) * 0.5 + 0.5;
    w.shoulder.elev = -6 - settle * 2.5;
    w.shoulder.sweep = -34 - settle * 3;
    w.shoulder.twist = 34;
    w.elbow.flex = 128 - settle * 4;
    w.elbow.elev = 12;
    w.wrist.flex = 104;
    w.wrist.elev = -26;
    w.digit.flex = 10;
    w.feather.pitch = 6;
    w.feather.bend = 1.5;
    w.feather.spread = 0;
    w.alula = 0;
  }

  const legs = pose.legs;
  for (const side of ['R', 'L']) {
    const sign = side === 'R' ? 1 : -1;
    // The feet stay planted; the weight shift is the BODY moving over them.
    // `footRoot` is only the horizontal handle -- the height comes from
    // `plantY`, which the rig solves against.  Nudging footRoot's own y as if
    // it were the sole (an earlier version added 21 mm here) bypasses the
    // solve and hovers the bird.
    legs[side].footRoot = new Vector3(sign * 0.043, ground, -0.012);
    legs[side].plantY = ground;
    legs[side].tarsusPitch = 25 + swaySlow * 2.5 * sign;
    legs[side].footPitch = 25 - (25 + swaySlow * 2.5 * sign);
    legs[side].toeCurl = 0.2;
    legs[side].footYaw = sign * 3.5;
  }

  // Blink: a fast, rare event (nictitating membrane sweeps ~5x/minute).
  const blinkPhase = wrap01(t * 0.085);
  pose.eyes.blink = pulse(blinkPhase, 0.05, 0.05);
  pose.beak.open = Math.max(0, Math.sin(t * 0.23) - 0.93) * 6;
  return { breath, saccade };
}

/* -------------------------------------------------------------------------- */
/*  SCREECH                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The golden eagle's territorial call.  Golden eagles are mostly silent; the
 * call is a series of weak, high yelps, delivered with the head thrown back
 * and the bill opened to a wide gape (the "sky dance" display on territory is
 * the same posture, flown).
 *
 * Structure: anticipation (head drops and cocks), then 3 calls spaced
 * ~0.55 s apart, each with a fast open and a slower close, then recovery.
 */
export const SCREECH_PARAMS = Object.freeze({
  calls: 3,
  callPeriod: 0.62,
  openTime: 0.1,
  closeTime: 0.26,
  holdTime: 0.22,
  gape: 1.0,
  headBackPitch: 34, // degrees, beak driven upward
  neckExtend: 1.0,
});

export function screechPose(t, pose, p = SCREECH_PARAMS) {
  const total = p.calls * p.callPeriod;
  const anticipation = 0.55;
  const tLocal = t - anticipation;

  pose.trunk.pitch = STAND_POSE.trunkPitch + 5.5 * smoothstep(clamp(tLocal / 0.3, 0, 1)) *
    (tLocal > 0 && tLocal < total ? 1 : 0.3);
  pose.trunk.y = 0.004 * Math.sin(clamp(tLocal, 0, total) * 2);

  // --- call envelope: three discrete yelps ---------------------------------
  let open = 0;
  let callIndex = -1;
  let callPhase = 0;
  if (tLocal > 0 && tLocal < total) {
    callIndex = Math.floor(tLocal / p.callPeriod);
    callPhase = (tLocal % p.callPeriod) / p.callPeriod;
    const tc = tLocal - callIndex * p.callPeriod;
    const o = smoothstep(clamp(tc / p.openTime, 0, 1));
    const c = 1 - smootherstep(clamp((tc - p.openTime - p.holdTime) / p.closeTime, 0, 1));
    open = Math.min(o, c);
  }
  pose.beak.open = open * p.gape;

  // Throat and neck fluff up during the call: the hyoid and the cervical
  // musculature are visibly working.
  const effort = open;

  // --- posture --------------------------------------------------------------
  // Neck extends up and the head is thrown back so the gape points skyward;
  // the whole head rocks back further at the peak of each yelp.
  const ext = 0.36 + 0.62 * (tLocal <= 0
    ? 0.25 * smoothstep(clamp((t + anticipation) / 0.5, 0, 1)) * 0
    : smoothstep(clamp(tLocal / 0.22, 0, 1)) * (tLocal < total ? 1 : 1 - smoothstep(clamp((tLocal - total) / 0.6, 0, 1))));
  pose.head.curve = lerp(1.1, 0.32, ext);
  pose.head.aim.pitch = lerp(-6, p.headBackPitch, ext) + effort * 5;
  pose.head.aim.yaw = Math.sin(tLocal * 1.1) * 6 * open + (1 - ext) * 4;
  pose.head.aim.roll = effort * 3;
  pose.head.neckStretch = effort * 0.012;

  // Wings: shoulders lift and the wingtips cross behind, the way an eagle
  // braces against its own call.
  for (const side of ['R', 'L']) {
    const w = pose.wings[side];
    const s = effort * 1.0 + 0.3 * smoothstep(clamp(tLocal / 0.4, 0, 1));
    w.shoulder.elev = -6 + s * 5;
    w.shoulder.sweep = -34 - s * 5;
    w.shoulder.twist = 34;
    w.elbow.flex = 128 - s * 5;
    w.elbow.elev = 12;
    w.wrist.flex = 104;
    w.wrist.elev = -26;
    w.digit.flex = 10 + s * 4;
    w.feather.pitch = 6 + s * 3;
    w.feather.bend = 1.5 + s * 2;
  }

  // Head comes forward and down into each yelp; the body rocks slightly.
  pose.trunk.roll = Math.sin(tLocal * 2.3) * 0.8 * open;
  pose.tail.pitch = STAND_POSE.tailPitch - effort * 4;
  pose.tail.spread = STAND_POSE.tailSpread + effort * 12;
  pose.eyes.blink = 0;
  return { open, callIndex, callPhase, ext, effort };
}

/* -------------------------------------------------------------------------- */
/*  HEAD TURN                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A deliberate head turn — the alert scanning behaviour of a perched eagle.
 *
 * A bird does not turn its head on the neck like a turret: the eyes lead, the
 * skull follows in a fast saccade (~140 ms), overshoots by a few degrees, and
 * settles, while the cervicals distribute the rotation over ~150 deg of
 * available yaw.  The body counter-rotates slightly and the near wing settles.
 */
export const HEADTURN_PARAMS = Object.freeze({
  yawLeft: 96,
  yawRight: -104,
  saccadeTime: 0.17,
  settleTime: 0.34,
});

export function headTurnPose(t, pose, p = HEADTURN_PARAMS) {
  // Timeline (seconds): 0-0.9 hold, 0.9-1.07 turn left, 1.07-1.6 settle,
  // 1.6-2.6 hold, 2.6-2.77 turn right, 2.77-3.3 settle, 3.3-4.0 hold.
  const events = [
    { at: 0.9, from: 0, to: p.yawLeft },
    { at: 1.85, from: p.yawLeft, to: p.yawLeft * 0.86 },
    { at: 2.7, from: p.yawLeft * 0.86, to: p.yawRight },
    { at: 3.7, from: p.yawRight, to: 0 },
  ];
  const T = 4.4;
  const tt = ((t % T) + T) % T;
  let yaw = 0;
  let turning = 0;
  for (const e of events) {
    if (tt >= e.at) {
      const u = clamp((tt - e.at) / p.settleTime, 0, 1);
      yaw = lerp(e.from, e.to, smootherstep(u));
      // Saccade + overshoot: the skull whips to target and rings down.
      const s = clamp((tt - e.at) / p.saccadeTime, 0, 1);
      const over = Math.exp(-s * 3.2) * Math.sin(s * Math.PI * 1.6);
      yaw += (e.to - e.from) * over * 0.16;
      turning = clamp(1 - u * 1.6, 0, 1);
    }
  }

  // The neck takes the load: it extends and arcs toward the turn.
  const ext = 0.55 + 0.4 * smoothstep(clamp((Math.abs(yaw) - 8) / 60, 0, 1));
  pose.head.curve = 1.05 - ext * 0.45;
  pose.head.aim.yaw = yaw;
  pose.head.aim.pitch = -4 + Math.sin(tt * 0.8) * 4.5 - Math.abs(yaw) / 90 * 3;
  pose.head.aim.roll = -yaw / 90 * 9;
  pose.head.twist = 0.8;

  // Body: the trunk counter-rotates a little, the tail follows through, and
  // the wing on the side being turned toward settles slightly.
  pose.trunk.yaw = -yaw * 0.09;
  pose.trunk.roll = -yaw * 0.02;
  pose.trunk.pitch = STAND_POSE.trunkPitch + Math.sin(tt * 0.7) * 0.5;
  pose.tail.yaw = -yaw * 0.22;
  pose.tail.pitch = STAND_POSE.tailPitch + Math.sin(tt * 0.9) * 1.5;
  pose.tail.spread = STAND_POSE.tailSpread + 2;

  for (const side of ['R', 'L']) {
    const w = pose.wings[side];
    const toward = (side === 'R' && yaw > 0) || (side === 'L' && yaw < 0) ? 1 : 0;
    const settle = toward * Math.abs(yaw) / 100;
    w.shoulder.elev = -6 - settle * 3.5;
    w.shoulder.sweep = -34 - settle * 4;
    w.shoulder.twist = 34 + settle * 4;
    w.elbow.flex = 128 - settle * 3;
    w.elbow.elev = 12;
    w.wrist.flex = 104;
    w.wrist.elev = -26 + settle * 5;
    w.digit.flex = 10;
    w.feather.pitch = 6 + settle * 4;
    w.feather.bend = 1.5;
  }

  // A blink right after each saccade completes.
  let blink = 0;
  for (const e of events) {
    const dt = tt - (e.at + p.saccadeTime * 1.4);
    if (dt > -0.06 && dt < 0.18) blink = Math.max(blink, pulse(clamp((dt + 0.06) / 0.24, 0, 1), 0.4, 0.4));
  }
  pose.eyes.blink = blink;
  pose.trunk.y = Math.sin(tt * 0.6) * 0.002;
  return { yaw, turning, blink, tt };
}

/* -------------------------------------------------------------------------- */
/*  Shared standing posture                                                    */
/* -------------------------------------------------------------------------- */

/** Neutral perched stance, used as the base for idle / screech / head turn. */
export function standingPose(pose, ground = GROUND_LEVEL) {
  for (const side of ['R', 'L']) {
    const s = side === 'R' ? 1 : -1;
    pose.legs[side].footRoot = new Vector3(s * 0.043, ground, -0.012);
    pose.legs[side].tarsusPitch = 25;
    pose.legs[side].footPitch = 0;
    pose.legs[side].toeCurl = 0.2;
    pose.legs[side].footYaw = s * 3.5;
    pose.legs[side].plantY = ground;
  }
  pose.trunk.pitch = STAND_POSE.trunkPitch;
  pose.tail.pitch = STAND_POSE.tailPitch;
  pose.tail.spread = STAND_POSE.tailSpread;
  return pose;
}

export { copyWing };
