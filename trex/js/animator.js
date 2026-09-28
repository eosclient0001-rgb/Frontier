/**
 * animator.js — Procedural locomotion, idle, turning and attack controller.
 *
 * Pipeline, once per frame:
 *   1. Speed smoothing (acceleration-limited) → gait parameters (gait.js).
 *   2. Turning: steering input, "turn-by" targets (turn in place), momentum.
 *   3. Stride phase at 1/T(v).  When stopping or turning on the spot the phase
 *      keeps running until the feet are squared up, so the animal steps
 *      round instead of skating.
 *   4. Root motion: the rig moves along its heading at exactly v, and planted
 *      feet are held fixed in WORLD space, so they never slide.
 *   5. Action layer (bite · tail swipe · roar): time-based one-shots that
 *      write additive offsets for the pelvis, spine, neck, head, jaw, tail
 *      and arms, plus hit events.
 *   6. Pelvis: height, bob (inverted pendulum walk ↔ spring-mass run), sway,
 *      pitch, yaw, roll, phase-locked to the footfalls, plus the action layer.
 *   7. Axial chain: trunk counter-rotation, tail wave, neck/head aim at a
 *      world target (closed-loop so it really points at it), jaw, arms.
 *   8. Leg IK: metatarsus pitch schedule → analytic femur/tibia solve.
 */

import { Vector3, Quaternion, Matrix4, Euler } from 'three';
import { gaitAt, gaitName, clamp, lerp, smoothstep, MAX_SPEED } from './gait.js';
import { LEG } from './skeleton.js';
import { SPEC } from './spec.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0);

const _v1 = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _v4 = new Vector3();
const _q1 = new Quaternion();
const _m1 = new Matrix4(), _m2 = new Matrix4();
const _e = new Euler();

/** Deterministic smooth 1D noise in [-1, 1]. */
function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const h = (n) => {
    const s = Math.sin((n + seed * 57.13) * 127.1) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const hash01 = (n) => {
  const x = Math.sin((n + 17.31) * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

/* ================================================================ actions */

export const ACTION_DEFS = {
  /** Lunge, gape, snap, (shake if something was caught), recover. */
  bite: { dur: 1.80, lockFeet: false },
  /** Hips pivot and the tail whips round in a travelling wave. */
  tailSwipe: { dur: 2.1, lockFeet: true },
  /** Head up, jaws wide, side-to-side sweep with a tremor. */
  roar: { dur: 2.9, lockFeet: false },
  /** Deliberate left-right-up visual scan, with the feet planted. */
  look: { dur: 3.8, lockFeet: true },
  /** Nostrils lifted: two short pulses followed by a settling breath. */
  sniffAir: { dur: 2.35, lockFeet: true },
  /** Nose lowered close to the ground: three searching pulses. */
  sniffGround: { dur: 3.05, lockFeet: true },
  /** A roar that never takes a step or translates the hips. */
  roarInPlace: { dur: 2.9, lockFeet: true },
};

/** Tail-swipe master curve: wind-up (-0.6) → whip (+1) → overshoot → rest. */
function swipeCurve(t) {
  if (t <= 0) return 0;
  if (t < 0.45) return -0.6 * ease(t / 0.45);
  if (t < 0.9) return lerp(-0.6, 1.0, ease((t - 0.45) / 0.45));
  if (t < 1.3) return lerp(1.0, -0.15, ease((t - 0.9) / 0.4));
  if (t < 2.0) return lerp(-0.15, 0, ease((t - 1.3) / 0.7));
  return 0;
}

function blankOverlay() {
  return {
    pitch: 0, yaw: 0, roll: 0, drop: 0, surge: 0, sideShift: 0,
    trunkYaw: 0, neckPitch: 0, neckYaw: 0, headPitch: 0, headYaw: 0, headRoll: 0,
    jaw: 0, aimW: 0, arms: 0, roar: 0, lungeW: 0,
    tailSide: 0, tailT: 0, tailDown: 0, speedCap: Infinity,
  };
}

/* ================================================================ animator */

export class Animator {
  constructor(skel, opts = {}) {
    this.s = skel;
    this.rig = skel.rig;

    // --- locomotion state
    this.speed = 0;
    this.targetSpeed = 0;
    this.turnInput = 0;
    this.turnTarget = null;           // absolute heading to turn to (turn in place)
    this.heading = 0;                 // yaw (rad), 0 = facing -Z, + = left
    this.yawRate = 0;
    this.turnW = 0;                   // readable weight-transfer blend for an in-place pivot
    this.turnSign = 0;
    this.turnBlend = 0;               // body/spine articulation for any steering turn
    this.turnBank = 0;
    this.pivoting = false;
    this.biteSerial = 0;
    this.phase = 0;
    this.time = 0;
    this.distance = 0;
    this.accel = opts.accel ?? 1.5;   // m/s² — a 9 t animal is not nimble
    this.decel = opts.decel ?? 2.1;
    this.maxTurnRate = 38 * DEG;      // rad/s at walking speed
    this.inPlaceTurnRate = 34 * DEG;  // rad/s when pivoting on the spot
    this.bounds = opts.bounds ?? 70;

    this.gait = gaitAt(0);
    this.smoothed = { pitch: 0, crouch: 0 };
    this.listeners = [];
    this.onFootstep = null;

    // --- actions
    this.action = null;
    this.A = blankOverlay();

    // --- aim (head/neck tracking of a world-space point)
    this.aimTarget = null;            // Vector3 (world) or null
    this.aimWeight = 0;               // external request 0..1
    this.aimW = 0;                    // smoothed effective weight
    this.aimYaw = 0; this.aimPitch = 0;
    this.aimCorr = { yaw: 0, pitch: 0 };
    this._aimWant = { yaw: 0, pitch: 0, clampedY: false, clampedP: false };
    this.lunge = new Vector3();       // closed-loop bite lunge (rig frame)
    this.lungeW = 0;                  // how much of it is applied this frame

    // --- idle state
    this.idle = {
      w: 1, look: new Vector3(), lookTarget: new Vector3(), nextLook: 0, lookEvent: 0,
      lookMode: 0, lookUntil: 0,
      jaw: 0, jawTarget: 0, nextJaw: 3, jawEvent: 0, breath: 0, shift: 0,
      sniff: 0, sniffMode: 0, sniffDuration: 1.8, nextSniff: 4.5, sniffEvent: 0,
    };

    // --- feet (world-space)
    this.feet = {};
    for (const key of ['L', 'R']) {
      const side = key === 'R' ? 1 : -1;
      const p = new Vector3(side * LEG.footLateral, 0, key === 'L' ? -0.25 : 0.25);
      this.feet[key] = {
        key, side, offset: key === 'L' ? 0 : 0.5, planted: true,
        pos: p.clone(), plant: p.clone(), lift: p.clone(),
        yaw: 0, plantYaw: 0, liftYaw: 0, swingT: 0, stanceT: 0, height: 0, inStance: true,
      };
    }

    this.rigPos = new Vector3(0, 0, 0);
    this.rig.position.copy(this.rigPos);
    this._rigInv = new Matrix4();

    // --- rest-pose references for aiming (pelvis frame)
    this.rig.updateMatrixWorld(true);
    const pelInv = this.s.pelvis.matrixWorld.clone().invert();
    const c10 = this.s.layout.items.find((it) => it.series === 'cervical' && it.index === 10);
    this.neckBase = c10.a.clone();
    const restMouth = this.s.mouth.getWorldPosition(new Vector3()).applyMatrix4(pelInv);
    const d = restMouth.clone().sub(this.neckBase);
    this.restAimPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }

  /* ------------------------------------------------------------ inputs */

  setTargetSpeed(v) { this.targetSpeed = clamp(v, 0, MAX_SPEED); }
  setTurn(x) { this.turnInput = clamp(x, -1, 1); if (x !== 0) this.turnTarget = null; }
  /** Turn in place by `angle` radians (+ = left). */
  turnBy(angle) { this.turnTarget = (this.turnTarget ?? this.heading) + angle; }
  on(fn) { this.listeners.push(fn); }
  emit(ev, data) { for (const fn of this.listeners) fn(ev, data, this); }

  /**
   * Start a one-shot action. Returns false if another action is running.
   * opts: bite { target: Vector3|null, reach: number (horizontal distance
   *        from the hips to the target along the heading) }
   *       tailSwipe { side: +1 swing right / -1 swing left }
   *       look { side: +1 begin looking right / -1 begin looking left }
   */
  startAction(type, opts = {}) {
    if (this.action) return false;
    const def = ACTION_DEFS[type];
    if (!def) return false;
    const a = { type, def, t: 0, started: !def.lockFeet, hit: false, ...opts };
    if (type === 'bite') {
      // Cycle three feeding strategies for repeated manual/hunt bites. A
      // caller can still pin one with { variant: 0|1|2 }.
      a.variant = opts.variant ?? (this.biteSerial++ % 3);
      a.hasTarget = !!opts.target;
      // lunge so the jaws arrive at the target: rest reach of the tooth row ≈ 5.6 m
      // A close target is behind the nominal 5.6 m tooth-row reach, so the
      // hips make a small controlled back-step rather than letting the jaw
      // overshoot it. Far targets still receive the restrained forward lunge.
      a.surge = a.hasTarget ? -clamp((opts.reach ?? 5.8) - 5.6, -1.5, 0.45) : -0.55;
    }
    if (type === 'tailSwipe') a.side = opts.side ?? 1;
    this.action = a;
    this.emit('start', a);
    return true;
  }
  roar() { return this.startAction('roar'); }
  look() { return this.startAction('look'); }
  sniffAir() { return this.startAction('sniffAir'); }
  sniffGround() { return this.startAction('sniffGround'); }
  roarInPlace() { return this.startAction('roarInPlace'); }

  get busy() { return !!this.action; }

  get gaitLabel() {
    if (this.action) {
      const n = {
        bite: 'Bite', tailSwipe: 'Tail swipe', roar: 'Roar', look: 'Look around',
        sniffAir: 'Sniff air', sniffGround: 'Sniff ground', roarInPlace: 'Roar in place',
      }[this.action.type];
      return `Attack · ${n}`.replace('Attack · Roar', 'Roar').replace('Attack · Look', 'Look').replace('Attack · Sniff', 'Sniff');
    }
    if (this.speed < 0.3 && Math.abs(this.yawRate) > 6 * DEG) return 'Turn in place';
    return gaitName(this.speed, this.gait.duty);
  }

  /* ------------------------------------------------------------ update */

  /**
   * Advance in bounded substeps.  A throttled/background tab may deliver a
   * large real-frame delta; clamping that delta makes a 3-second roar take
   * tens of seconds. Substeps retain stable IK while preserving wall-clock
   * animation time (up to a deliberately bounded 0.25 s catch-up window).
   */
  update(dt) {
    let left = Math.max(0, Math.min(dt, 0.25));
    while (left > 1e-9) {
      const step = Math.min(left, 1 / 30);
      this._updateStep(step);
      left -= step;
    }
  }

  _updateStep(dt) {
    this.time += dt;

    // ---- action layer first (it can cap speed / lock the feet)
    this._evalAction(dt);
    const A = this.A;

    // ---- 1. speed smoothing
    const target = Math.min(this.targetSpeed, A.speedCap);
    const dv = target - this.speed;
    const rate = dv > 0 ? this.accel : this.decel * (A.speedCap < this.speed ? 1.4 : 1);
    this.speed += clamp(dv, -rate * dt, rate * dt);
    if (Math.abs(this.speed) < 1e-4) this.speed = 0;
    const g = (this.gait = gaitAt(this.speed));

    // ---- 2. turning
    let turn = this.turnInput;
    if (this.turnTarget !== null && turn === 0) {
      const diff = wrapAngle(this.turnTarget - this.heading);
      turn = clamp(diff * 2.2, -1, 1);
      if (Math.abs(diff) < 1.5 * DEG && Math.abs(this.yawRate) < 4 * DEG) this.turnTarget = null;
    }
    const distFromHome = Math.hypot(this.rigPos.x, this.rigPos.z);
    if (distFromHome > this.bounds && this.speed > 0.2) {
      const want = Math.atan2(-this.rigPos.x, -this.rigPos.z);
      turn = clamp(turn + wrapAngle(want - this.heading) * 1.2, -1, 1);
    }
    const locked = this.action && this.action.def.lockFeet;
    if (locked) turn = 0;
    const locoW = smoothstep(0.05, 0.9, this.speed);
    const moveRate = this.maxTurnRate * (1 - 0.45 * smoothstep(2.5, 7, this.speed));
    const maxRate = lerp(this.inPlaceTurnRate, moveRate, locoW);
    this.yawRate += (turn * maxRate - this.yawRate) * (1 - Math.exp(-dt * 3.2));
    this.heading += this.yawRate * dt;
    const pivoting = this.speed < 0.35 && Math.abs(this.yawRate) > 5 * DEG;
    this.pivoting = pivoting;
    this.turnW += ((pivoting ? smoothstep(5 * DEG, 28 * DEG, Math.abs(this.yawRate)) : 0) - this.turnW)
      * (1 - Math.exp(-dt * 5.5));
    this.turnSign = Math.sign(this.yawRate);
    // A steering turn should travel from the feet through the pelvis, trunk,
    // neck and head. This separate blend is also active while walking, unlike
    // turnW which is reserved for the planted-foot pivot.
    const wantTurn = smoothstep(2 * DEG, 18 * DEG, Math.abs(this.yawRate));
    this.turnBlend += (wantTurn - this.turnBlend) * (1 - Math.exp(-dt * 5.0));
    this.turnBank += (-this.yawRate * (0.075 + 0.035 * this.turnBlend) - this.turnBank)
      * (1 - Math.exp(-dt * 4.0));

    // ---- 3. phase advance (with settle-to-stop and step-to-turn)
    const idleNow = target < 0.05 && this.speed < 0.25;
    let phaseRate = locoW;
    if (locked && this.action.started) phaseRate = 0;
    else if (idleNow) phaseRate = this._needsSettling() || pivoting ? Math.max(locoW, 1.05) : locoW;
    else if (pivoting) phaseRate = Math.max(phaseRate, 0.95);
    this.phase = (this.phase + (phaseRate * dt) / g.T) % 1;

    // ---- 4. root motion
    const fwd = _v1.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    this.rigPos.addScaledVector(fwd, this.speed * dt);
    this.distance += this.speed * dt;
    this.rig.position.copy(this.rigPos);
    this.rig.rotation.set(0, this.heading, 0);
    this.rig.updateMatrixWorld(true);
    this._rigInv.copy(this.rig.matrixWorld).invert();

    // ---- idle weight
    const idleTarget = this.speed < 0.15 && target < 0.05 && !this.action ? 1 : 0;
    this.idle.w += (idleTarget - this.idle.w) * (1 - Math.exp(-dt * (idleTarget ? 1.2 : 4)));

    // ---- 5. feet
    const stepping = phaseRate > 1e-3;
    for (const f of Object.values(this.feet)) this._updateFoot(f, g, fwd.clone(), stepping);

    // ---- 6-7. pelvis + axial
    this._updatePelvis(g, dt);
    this._updateIdle(dt);
    this._updateAxial(g, dt);

    // ---- 8. legs
    this.rig.updateMatrixWorld(true);
    for (const key of ['L', 'R']) this._solveLeg(key, g);
    this.rig.updateMatrixWorld(true);

    this._measureAim(dt);
    if (this.action) this.emit('frame', this.action);
  }

  /* ----------------------------------------------------------- actions */

  _evalAction(dt) {
    const A = (this.A = blankOverlay());
    const a = this.action;
    if (!a) return;
    if (!a.started) {
      // wait for both feet to be down before a planted-feet action
      A.speedCap = 0;
      if (this.feet.L.planted && this.feet.R.planted && this.speed < 0.2) a.started = true;
      else return;
    }
    a.t += dt;
    const t = a.t;

    if (a.type === 'bite') {
      // Feeding is staged rather than a single body bend: gape and brace,
      // bring the tooth row down on a nearly fixed head path, close the jaw
      // orthally, hold the puncture briefly, then pull back before recovery.
      const v = a.variant ?? 0;
      const wind = ease(t / (v === 1 ? 0.38 : 0.34));
      const close = smoothstep(v === 1 ? 0.45 : 0.40, v === 2 ? 0.64 : 0.68, t);
      const contact = smoothstep(0.58, 0.73, t);
      const pull = smoothstep(v === 2 ? 0.76 : 0.70, v === 1 ? 1.12 : 1.06, t)
        * (1 - smoothstep(1.08, v === 2 ? 1.50 : 1.42, t));
      const rec = ease((t - (v === 1 ? 1.28 : 1.20)) / 0.58);
      const strike = smoothstep(0.30, v === 1 ? 0.66 : 0.62, t) * (1 - rec);
      const lowTarget = a.hasTarget && this.aimTarget
        ? clamp((1.48 - this.aimTarget.y) * 1.05, 0, 1.18)
        : 0;

      // Do not solve a low bite by folding the torso. A small bracing pitch
      // is all the axial skeleton contributes; the hips lower as one rigid
      // unit when the target is near the ground, leaving the neck and jaw to
      // perform the visible feeding motion.
      A.pitch = (2.0 * wind - (v === 1 ? 3.5 : 4.5) * strike + 1.4 * pull) * DEG;
      A.drop = 0.10 * lowTarget * contact + (a.hasTarget ? 0 : 0.12 * strike);
      A.surge = 0.14 * wind + (v === 1 ? 0.22 : v === 2 ? 0.28 : 0.16) * pull;
      A.lungeW = a.hasTarget ? strike : 0;
      A.headPitch = (10 * wind - 2.5 * contact + (v === 2 ? 6 : v === 1 ? -2 : 2) * pull) * DEG;
      A.neckPitch = (a.hasTarget ? 3 * wind : 3 * wind - 9 * strike + 3 * pull) * DEG;
      // Variant 1 rakes slightly across the bite; variant 2 lifts the skull
      // after the puncture. Both remain small additive motions around the
      // aimed tooth row, never a loose neck whip.
      A.headYaw += (v === 1 ? 7 : v === 2 ? -3 : 0) * DEG * pull;
      A.neckYaw += (v === 1 ? -4 : v === 2 ? 2 : 0) * DEG * pull;
      A.roll += (v === 1 ? 1.8 : 0) * DEG * pull;
      // The mandible does almost all of the opening/closing. It is already
      // shut at the contact event, so the subsequent pull cannot read as a
      // neck snap or a floppy jaw.
      const gape = v === 1 ? 0.94 : v === 2 ? 1.08 : 1.02;
      A.jaw = gape * wind * (1 - close) + 0.035 * close * (1 - rec);
      A.aimW = a.hasTarget ? Math.max(wind * (1 - rec), contact) : 0;
      A.arms = strike * 0.9;
      A.speedCap = t > 0.76 ? 2.0 : Infinity;
      if (a.hit) {
        const st = t - 0.72;
        if (st > 0 && st < 0.42) {
          const e = Math.sin(TAU * 3 * st) * (1 - st / 0.42);
          A.headYaw = 7 * DEG * e; A.neckYaw = 5 * DEG * e; A.headRoll = 4 * DEG * e; A.roll = 1.2 * DEG * e;
        }
      }
      if (!a.snapped && t >= 0.69) { a.snapped = true; this.emit('biteSnap', a); }
      if (a.hit && !a.released && t >= 1.30) { a.released = true; this.emit('biteRelease', a); }
    } else if (a.type === 'tailSwipe') {
      const s = a.side;
      const S = swipeCurve(t);
      const wind = 1 - smoothstep(0.28, 0.55, t);
      const strike = smoothstep(0.50, 0.92, t);
      const recover = smoothstep(1.18, 1.95, t);
      const env = smoothstep(0, 0.22, t) * (1 - smoothstep(1.55, 2.1, t));
      // The feet remain the anchors: the hips first load the opposite side,
      // then pivot through it. The chest counter-turns while the caudal wave
      // travels down the tail, so the impact is distal rather than a rigid
      // rotation of the entire animal.
      A.yaw = s * (34 * S + 7 * strike * (1 - recover)) * DEG;
      A.trunkYaw = -A.yaw * (0.58 - 0.12 * strike);
      A.roll = s * (3.5 * S + 2.5 * strike) * DEG;
      A.sideShift = -s * 0.14 * wind + s * 0.06 * strike;
      A.drop = 0.05 + 0.12 * Math.abs(S);
      A.pitch = (-2.5 * Math.max(0, S) - 2.0 * strike) * DEG; // brace, do not fold
      A.neckYaw = -s * (14 + 20 * Math.max(0, S)) * DEG * env;
      A.tailSide = s; A.tailT = t;
      // The axial loop consumes this as a per-joint envelope; distal joints
      // receive the low, fast strike later than the tail base.
      A.tailDown = smoothstep(0.35, 0.72, t) * (1 - smoothstep(1.45, 2.0, t));
      A.jaw = 0.12 * env;
      A.speedCap = 0;
      if (t > 0.92 && t < 1.75) this.emit('tailSweep', a);
    } else if (a.type === 'roar' || a.type === 'roarInPlace') {
      const r = t < 0.5 ? ease(t / 0.5) : t < 2.2 ? 1 : 1 - ease((t - 2.2) / 0.7);
      A.roar = r;
      // roarInPlace explicitly brakes before it starts and never permits root
      // motion; the original roar remains a looser travelling roar.
      A.speedCap = a.type === 'roarInPlace' ? 0 : 1.0;
      const hold = smoothstep(0.45, 0.7, t) * (1 - smoothstep(2.0, 2.3, t));
      A.headYaw = 14 * DEG * Math.sin((t - 0.5) * TAU * 0.55) * hold;
      A.neckYaw = 8 * DEG * Math.sin((t - 0.5) * TAU * 0.55) * hold;
      A.headRoll = 1.2 * DEG * Math.sin(t * TAU * 11) * hold;           // vocal tremor
      A.arms = -0.4 * r;
    } else if (a.type === 'look') {
      // A broad, readable scan: left, centre, right, then a small upward
      // check.  The asymmetric harmonic keeps it from looking robotic.
      const q = clamp(t / a.def.dur, 0, 1);
      const scan = Math.sin((q * Math.PI * 2) - Math.PI / 2);
      const slowScan = Math.sin(q * Math.PI * 2.0 - Math.PI / 2);
      A.neckYaw = (34 * scan + 7 * slowScan) * DEG;
      A.headYaw = (25 * scan + 5 * Math.sin(q * TAU * 1.5)) * DEG;
      A.neckPitch = (5 + 8 * Math.sin(q * TAU - 0.35)) * DEG;
      A.headPitch = (3 + 6 * Math.sin(q * TAU - 0.35)) * DEG;
      A.headRoll = 4 * DEG * Math.sin(q * TAU * 1.15);
      A.jaw = 0.025 + 0.035 * (0.5 + 0.5 * Math.sin(q * TAU * 1.1));
      A.speedCap = 0;
    } else if (a.type === 'sniffAir') {
      // Lift the snout, pause, pulse the nares twice, and settle.  The jaw
      // barely parts so the animation reads as olfactory rather than a roar.
      const q = clamp(t / a.def.dur, 0, 1);
      const pulse = Math.pow(Math.max(0, Math.sin(q * TAU * 2.0)), 8);
      const settle = 1 - smoothstep(1.65, 2.35, t);
      A.neckPitch = (12 * settle + 2) * DEG;
      A.headPitch = (13 * settle + 2) * DEG;
      A.headRoll = 1.8 * DEG * Math.sin(q * TAU * 2);
      A.jaw = 0.045 + 0.055 * pulse;
      A.roar = 0.04 * pulse;
      A.speedCap = 0;
    } else if (a.type === 'sniffGround') {
      // Lower the neck in a smooth S-curve, hold the nostrils just above the
      // floor, pulse three times, then lift the head before ending.
      const q = clamp(t / a.def.dur, 0, 1);
      const down = smoothstep(0.0, 0.72, q);
      const up = smoothstep(0.70, 1.0, q);
      const lower = down * (1 - up) + (1 - up) * 0.08;
      const pulse = Math.pow(Math.max(0, Math.sin(q * TAU * 3.0 + 0.45)), 8);
      A.pitch = -20 * lower * DEG;
      A.drop = 0.15 * lower;
      A.neckPitch = (-104 * lower + 8 * up) * DEG;
      A.headPitch = (-55 * lower + 6 * up) * DEG;
      A.headYaw = 3.5 * DEG * Math.sin(q * TAU * 1.5);
      A.headRoll = 2.0 * DEG * Math.sin(q * TAU * 3.0);
      A.jaw = 0.035 + 0.06 * pulse;
      A.speedCap = 0;
    }

    if (t >= a.def.dur) {
      this.action = null;
      this.emit('end', a);
    }
  }

  /* ------------------------------------------------------------- feet */

  _neutral(f, out, fore = 0) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const lx = f.side * LEG.footLateral, lz = -fore + (f.key === 'L' ? -0.02 : 0.02);
    out.set(this.rigPos.x + lx * c + lz * s, 0, this.rigPos.z - lx * s + lz * c);
    return out;
  }

  _needsSettling() {
    for (const f of Object.values(this.feet)) {
      if (!f.planted) return true;
      const n = this._neutral(f, _v3);
      if (n.distanceTo(f.plant) > 0.30) return true;
      if (Math.abs(wrapAngle(f.plantYaw - this.heading)) > 12 * DEG) return true;
    }
    return false;
  }
  get settled() { return !this._needsSettling(); }

  _updateFoot(f, g, fwd, stepping) {
    const lp = (this.phase + f.offset) % 1;
    // A turn uses a shorter, alternating support window than the stationary
    // walk interpolation. There is still a brief double-support overlap,
    // but one foot clearly becomes the pivot while the other steps around it.
    const duty = lerp(g.duty, 0.58, this.turnW);
    const inStance = lp < duty;

    if (!stepping) {
      if (!f.planted) { f.planted = true; f.plant.copy(f.pos).setY(0); f.plantYaw = f.yaw; }
      f.pos.copy(f.plant); f.height = 0; f.yaw = f.plantYaw;
      f.stanceT = 0.5; f.swingT = 0; f.inStance = true;
      return;
    }

    if (inStance) {
      if (!f.planted) {
        f.planted = true;
        f.plant.copy(f.pos).setY(0);
        f.plantYaw = f.yaw;
        if (this.onFootstep) this.onFootstep(f.key, f.plant.clone(), clamp(0.25 + this.speed / 6, 0, 1.2), f.plantYaw);
      }
      f.pos.copy(f.plant); f.height = 0; f.yaw = f.plantYaw;
      f.stanceT = lp / duty; f.swingT = 0;
    } else {
      if (f.planted) { f.planted = false; f.lift.copy(f.plant); f.liftYaw = f.plantYaw; }
      const t = (lp - duty) / (1 - duty);
      f.swingT = t; f.stanceT = 1;
      const remaining = (1 - t) * (1 - duty) * g.T;
      // running stance is biased caudally (foot lands closer under the COM).
      // In a pivot, add a small deliberate step around the planted support,
      // rather than asking the swing foot to return to its old coordinates.
      const fore = (0.5 - 0.14 * g.runW) * duty * g.stride
        + 0.16 * this.turnW * this.turnSign;
      const land = this._neutral(f, _v2, fore);
      land.addScaledVector(fwd, this.speed * remaining);
      const landYaw = this.heading + this.yawRate * remaining;
      const e = ease(t * 1.08);
      f.pos.lerpVectors(f.lift, land, e);
      const lift = g.stepH * (this.speed < 0.4 ? 0.7 : 1) + 0.08 * this.turnW;
      f.height = lift * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 1.2);
      f.pos.y = f.height;
      f.yaw = f.liftYaw + wrapAngle(landYaw - f.liftYaw) * e;
    }
    f.inStance = inStance;
  }

  /* ------------------------------------------------------------ pelvis */

  _updatePelvis(g, dt) {
    const P = this.s.pelvis;
    const ph = this.phase;
    const d2 = g.duty / 2;
    const idle = this.idle;
    const A = this.A;
    const stepAmp = smoothstep(0.02, 0.6, this.speed + (this._needsSettling() ? 0.35 : 0));

    const bobSign = 1 - 2 * g.runW;
    const bobRaw = g.bob * bobSign * Math.cos(TAU * 2 * (ph - d2));
    const swayRaw = -g.sway * Math.cos(TAU * (ph - d2)) * stepAmp;
    const rollRaw = g.roll * DEG * Math.cos(TAU * (ph - d2)) * smoothstep(0.02, 0.6, this.speed);
    const yawRaw = g.yaw * DEG * Math.sin(TAU * (ph - d2)) * smoothstep(0.02, 0.6, this.speed);
    const surgeRaw = -0.03 * g.runW * Math.sin(TAU * 2 * (ph - d2)) * smoothstep(0.1, 1.0, this.speed);

    idle.breath = Math.sin(this.time * TAU / 4.2);
    idle.shift = noise1(this.time * 0.13, 3) * 0.06;

    const sm = this.smoothed;
    sm.crouch += (g.crouch - sm.crouch) * (1 - Math.exp(-dt * 3));
    const acc = this.targetSpeed - this.speed;
    const accLean = clamp(acc, -2, 2) * -1.1 * DEG * (1 - idle.w);
    sm.pitch += (g.pitch * DEG + accLean - sm.pitch) * (1 - Math.exp(-dt * 2.5));

    // During a pivot the center of mass deliberately follows the planted
    // support foot. The sign alternates once per half-cycle, so the two legs
    // visibly exchange the load instead of the torso simply spinning above
    // locked feet.
    const supportWave = Math.cos(TAU * (ph - 0.25));
    const pivotShift = -0.11 * this.turnW * supportWave;
    const pivotRoll = 4.5 * DEG * this.turnW * supportWave;
    const y = SPEC.stance.acetabulumHeight - sm.crouch + bobRaw + idle.w * 0.012 * idle.breath
      - A.roar * 0.10 - A.drop - 0.035 * this.turnW;
    P.position.set(swayRaw + idle.w * idle.shift + A.sideShift + pivotShift, y, surgeRaw + A.surge);
    this.lungeW = A.lungeW;
    if (A.lungeW > 0) P.position.addScaledVector(this.lunge, A.lungeW);

    const pitch = sm.pitch + idle.w * 0.4 * DEG * idle.breath - A.roar * 4 * DEG + A.pitch
      - 8 * DEG * g.bob * bobSign * Math.sin(TAU * 2 * (ph - d2));
    // hips lead a pivot slightly
    const yaw = yawRaw + idle.w * idle.shift * 0.4 + this.yawRate * 0.18 + A.yaw;
    _e.set(pitch, yaw, rollRaw - idle.w * idle.shift * 0.6 + A.roll + pivotRoll + this.turnBank, 'YXZ');
    P.quaternion.setFromEuler(_e);
    this.pelvisYaw = yawRaw;
    this.pelvisRoll = rollRaw;
    this.bobRaw = bobRaw;
  }

  /* -------------------------------------------------------------- idle */

  _updateIdle(dt) {
    const I = this.idle;
    const t = this.time;

    // Look around in readable beats: ease toward one side, hold the scan,
    // then return to centre before choosing the other side. Keeping the
    // centre return explicit prevents a random target from becoming a frozen
    // neck pose and makes the ambient behaviour look intentional.
    if (I.lookMode !== 0 && t > I.lookUntil) {
      I.lookMode = 0;
      I.lookTarget.set(0, 0, 0);
      I.nextLook = t + 1.0 + hash01(I.lookEvent + 10) * 2.4;
    } else if (I.lookMode === 0 && t > I.nextLook) {
      const e = I.lookEvent++;
      const side = hash01(e + 1) < 0.5 ? -1 : 1;
      const wide = hash01(e + 2) < 0.38;
      I.lookMode = side;
      I.lookTarget.set(
        side * (wide ? 28 + hash01(e + 3) * 12 : 13 + hash01(e + 3) * 10),
        (hash01(e + 4) * 2 - 1) * 5 + (hash01(e + 5) < 0.2 ? 7 : 0),
        0
      );
      I.lookUntil = t + 1.0 + hash01(e + 6) * 1.45;
      I.nextLook = Infinity;
    }
    I.look.lerp(I.lookTarget, 1 - Math.exp(-dt * (I.lookMode ? 2.8 : 2.1)));

    if (t > I.nextJaw) {
      const e = I.jawEvent++;
      I.jawTarget = I.jawTarget > 0.05 ? 0 : 0.10 + hash01(e + 31) * 0.22;
      I.nextJaw = t + (I.jawTarget > 0 ? 0.9 + hash01(e + 32) * 1.4 : 3 + hash01(e + 33) * 5);
    }
    I.jaw += (I.jawTarget - I.jaw) * (1 - Math.exp(-dt * 3));

    // Alternate a short air-sniff with a longer ground investigation. The
    // mode is consumed by the axial pose code below; it is not just a generic
    // vibration, so the ambient animation visibly searches both scent zones.
    if (I.sniff <= 0 && t > I.nextSniff) {
      const e = I.sniffEvent++;
      I.sniffMode = hash01(e + 70) < 0.52 ? 1 : -1; // +1 air, -1 ground
      I.sniffDuration = I.sniffMode > 0 ? 1.65 + hash01(e + 71) * 0.65 : 2.0 + hash01(e + 71) * 0.9;
      I.sniff = 1;
      I.nextSniff = t + I.sniffDuration + 4.5 + hash01(e + 72) * 6.0;
    }
    I.sniff = Math.max(0, I.sniff - dt / Math.max(0.1, I.sniffDuration));
  }

  /* --------------------------------------------------------------- aim */

  /** Desired neck/head yaw & pitch offsets that point the mouth at the target. */
  _computeAim(dt) {
    const want = Math.max(this.aimWeight, this.A.aimW);
    const active = want > 0.001 && this.aimTarget;
    this.aimW += ((active ? want : 0) - this.aimW) * (1 - Math.exp(-dt * (want > this.aimW ? 7 : 3)));
    if (!this.aimTarget) {
      this.aimYaw *= Math.exp(-dt * 3); this.aimPitch *= Math.exp(-dt * 3);
      return;
    }
    const P = this.s.pelvis;
    P.updateMatrix();
    _m1.multiplyMatrices(this.rig.matrixWorld, P.matrix).invert();
    const tl = _v3.copy(this.aimTarget).applyMatrix4(_m1);
    const dir = tl.sub(this.neckBase);
    const tYaw = Math.atan2(-dir.x, -dir.z);
    const tPitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    let dYaw = tYaw + this.aimCorr.yaw;
    let dPitch = tPitch - this.restAimPitch + this.aimCorr.pitch;
    const cy = clamp(dYaw, -70 * DEG, 70 * DEG), cp = clamp(dPitch, -68 * DEG, 35 * DEG);
    this._aimWant = { yaw: tYaw, pitch: tPitch, clampedY: cy !== dYaw, clampedP: cp !== dPitch };
    const k = 1 - Math.exp(-dt * 10);
    this.aimYaw += (cy * this.aimW - this.aimYaw) * k;
    this.aimPitch += (cp * this.aimW - this.aimPitch) * k;
  }

  /** Closed loop: measure where the mouth actually points, trim the error. */
  _measureAim(dt) {
    this._updateLunge(dt);
    if (!this.aimTarget || this.aimW < 0.2) {
      this.aimCorr.yaw *= Math.exp(-dt * 2); this.aimCorr.pitch *= Math.exp(-dt * 2);
      return;
    }
    _m2.copy(this.s.pelvis.matrixWorld).invert();
    const m = this.s.mouth.getWorldPosition(_v4).applyMatrix4(_m2).sub(this.neckBase);
    const aYaw = Math.atan2(-m.x, -m.z);
    const aPitch = Math.atan2(m.y, Math.hypot(m.x, m.z));
    const w = this._aimWant;
    const g = 1 - Math.exp(-dt * 6 * this.aimW);
    if (!w.clampedY) this.aimCorr.yaw = clamp(this.aimCorr.yaw + wrapAngle(w.yaw - aYaw) * g, -40 * DEG, 40 * DEG);
    if (!w.clampedP) this.aimCorr.pitch = clamp(this.aimCorr.pitch + (w.pitch - aPitch) * g, -40 * DEG, 40 * DEG);
  }

  /**
   * Closed-loop reach for a targeted bite: move the hips along the line of
   * the neck until the tooth row meets the target.  Only the component of
   * the error ALONG the head's line is used — the aim loop handles direction.
   */
  _updateLunge(dt) {
    const a = this.action;
    if (!a || a.type !== 'bite' || !a.hasTarget || !this.aimTarget) {
      this.lunge.multiplyScalar(Math.exp(-dt * 4));
      return;
    }
    const nb = _v3.copy(this.neckBase).applyMatrix4(this.s.pelvis.matrixWorld);
    const m = this.s.mouth.getWorldPosition(_v4);
    const dir = m.clone().sub(nb).normalize();
    const along = this.aimTarget.clone().sub(m).dot(dir);
    // world → rig frame (rig only yaws)
    const c = Math.cos(-this.heading), s = Math.sin(-this.heading);
    const dl = new Vector3(dir.x * c + dir.z * s, dir.y, -dir.x * s + dir.z * c);
    const need = this.lunge.clone().multiplyScalar(this.lungeW).addScaledVector(dl, along);
    const closeBite = (a.reach ?? 5.8) < 4.4;
    // Close rear/side approaches need a little more lateral/vertical jaw
    // reach, but remain bounded so the torso never folds into the bite.
    need.x = clamp(need.x, closeBite ? -0.95 : -0.6, closeBite ? 0.95 : 0.6);
    need.y = clamp(need.y, closeBite ? -0.85 : -0.55, 0.05);
    need.z = clamp(need.z, -1.4, 0.5);
    this.lunge.lerp(need, 1 - Math.exp(-dt * 9));
  }

  /* ------------------------------------------------------------- axial */

  _updateAxial(g, dt) {
    const S = this.s;
    const ph = this.phase;
    const I = this.idle;
    const A = this.A;
    const loco = 1 - I.w;
    const d2 = g.duty / 2;
    this._computeAim(dt);

    // --- trunk: counter-rotate the gait yaw/roll, breathing, action twist
    const nT = S.trunk.length;
    for (let i = 0; i < nT; i++) {
      const j = S.trunk[i];
      const u = i / (nT - 1);
      const turnLag = -this.yawRate * (0.14 + 0.42 * u) * this.turnBlend;
      const yaw = (-this.pelvisYaw * 0.72 - this.yawRate * 0.04 + turnLag + A.trunkYaw) / nT;
      const roll = (-this.pelvisRoll * 0.6 - this.turnBank * (0.35 + 0.65 * u)) / nT;
      const pitch = -0.08 * DEG * I.breath * I.w - A.roar * 1.0 * DEG * u;
      _e.set(pitch, roll, yaw, 'XYZ');
      j.quaternion.copy(j.userData.restQuat).multiply(_q1.setFromEuler(_e));
    }

    // --- tail: travelling lateral wave + turning + idle swish + tail swipe
    const nC = S.tail.length;
    const turnBend = this.yawRate * 0.9;          // body curves into a turn → tail trails outside
    for (let i = 0; i < nC; i++) {
      const j = S.tail[i];
      const u = i / (nC - 1);
      const amp = g.tail * DEG * (0.4 + 1.6 * u) * lerp(0.6, 1, loco);
      const lag = u * 1.6;
      let lat = amp * Math.sin(TAU * (ph - d2) - lag) + (turnBend / nC) * (0.5 + u)
        + I.w * 0.55 * DEG * Math.sin(this.time * 0.6 - u * 2.4) * (0.3 + u);   // idle swish
      let vert = -0.06 * DEG * Math.sin(TAU * 2 * (ph - d2) - lag * 1.3) * g.bob * 60 * (0.2 + u) * loco
        + 0.10 * DEG * g.runW * (1 - u)
        + A.roar * 0.35 * DEG * (1 - u);
      if (A.tailSide) {
        // A real travelling wave is delayed by the time it takes the trunk
        // torque to reach each caudal joint; the tip therefore strikes after
        // the hips, rather than every vertebra turning at once.
        const waveT = A.tailT - 0.18 - 0.70 * u;
        const wave = swipeCurve(waveT);
        const impact = smoothstep(0.32, 0.72, waveT) * (1 - smoothstep(1.02, 1.52, waveT));
        lat += A.tailSide * wave * (3.10 + 5.20 * u) * DEG;
        // the distal half drops only as the positive wave reaches it: this
        // reads as a low strike, not a uniformly drooping tail. The larger
        // caudal flexion is deliberately concentrated at the tail, not hips.
        vert -= (2.8 * (1 - u) * (1 - u) + 0.85) * DEG * impact * A.tailDown;
      }
      // tail joints: +Y points anteriorly, the vertebra extends along -Y,
      // so dorsal flexion of the tail is a negative rotation about X
      _e.set(-vert, 0, lat, 'XYZ');
      j.quaternion.copy(j.userData.restQuat).multiply(_q1.setFromEuler(_e));
    }

    // --- neck & head
    const nN = S.neck.length;
    const noLook = Math.max(this.aimW, this.action ? 1 : 0);
    const sniffW = I.sniff > 0 && !this.action ? I.sniff : 0;
    const sniffPulse = sniffW > 0 ? Math.pow(Math.max(0, Math.sin((1 - sniffW) * TAU * 2.4)), 7) : 0;
    const sniffPitch = sniffW * (I.sniffMode > 0 ? 5.5 : -10.0) * DEG + sniffPulse * 1.6 * DEG;
    const sniffYaw = sniffW * (I.sniffMode < 0 ? 3.0 * Math.sin((1 - sniffW) * TAU * 1.5) : 0) * DEG;
    const turnLook = this.yawRate * (0.58 + 0.34 * this.turnBlend);
    const lookYaw = (I.look.x * I.w * (1 - noLook)) * DEG + turnLook + sniffYaw;   // head leads the turn
    const lookPitch = (I.look.y * I.w * (1 - noLook) + g.neck * loco) * DEG;
    const cancelPitch = -(this.bobRaw || 0) * 0.9;
    const cancelYaw = -this.pelvisYaw * 0.1;
    for (let i = 0; i < nN; i++) {
      const j = S.neck[i];
      const u = i / (nN - 1);
      const w = 0.6 + 0.8 * u;
      // aiming is concentrated at the neck base: rotating near the root
      // swings the whole head, while an evenly spread bend only turns the
      // chord by about half the total angle
      const wa = (1.9 - 1.8 * u) / nN;
      const pitch = (lookPitch * 0.55 + cancelPitch + sniffPitch + A.neckPitch) * w / nN + this.aimPitch * 0.85 * wa
        + A.roar * (i < 5 ? -3.0 : 5.0) * DEG
        + 0.06 * DEG * I.breath * I.w;
      const yaw = (lookYaw * 0.6 + cancelYaw + A.neckYaw) * w / nN + this.aimYaw * 0.85 * wa;
      _e.set(pitch, 0, yaw, 'XYZ');
      j.quaternion.copy(j.userData.restQuat).multiply(_q1.setFromEuler(_e));
    }
    {
      const h = S.head;
      const pitch = lookPitch * 0.35 + sniffPitch * 0.8 + A.roar * 12 * DEG + A.headPitch + this.aimPitch * 0.15;
      const yaw = lookYaw * 0.58 + A.headYaw + this.aimYaw * 0.15;
      const roll = I.look.z * DEG * I.w * 0.8 * (1 - noLook) + A.headRoll;
      // head frame: X right, Y up, Z back → yaw is about Y, roll about Z
      _e.set(pitch, yaw, roll, 'YXZ');
      h.quaternion.copy(h.userData.restQuat).multiply(_q1.setFromEuler(_e));
    }
    // jaw — NEGATIVE rotation about X swings the front of the mandible DOWN
    {
      const idleJaw = I.jaw * I.w * (this.action ? 0 : 1);
      const open = idleJaw + sniffPulse * 0.018 + A.roar * 0.85 + A.jaw + 0.03 * g.runW;
      S.jaw.rotation.set(-Math.max(0, open), 0, 0);
    }

    // --- arms: passive swing; tucked at a run; reach forward in a bite
    for (const key of ['L', 'R']) {
      const a = S.arms[key];
      if (!a || !a.shoulder) continue;
      const side = key === 'R' ? 1 : -1;
      const swing = Math.sin(TAU * (ph - d2) + (side > 0 ? Math.PI : 0)) * 6 * DEG * loco;
      _e.set(swing - g.runW * 14 * DEG + A.arms * 28 * DEG + 2 * DEG * I.breath * I.w, 0, 0, 'XYZ');
      a.shoulder.quaternion.copy(a.shoulder.userData.restQuat).multiply(_q1.setFromEuler(_e));
      _e.set(g.runW * 18 * DEG - A.arms * 30 * DEG + I.w * 3 * DEG * I.breath, 0, 0, 'XYZ');
      a.elbow.quaternion.copy(a.elbow.userData.restQuat).multiply(_q1.setFromEuler(_e));
      _e.set(A.arms * 25 * DEG, 0, 0, 'XYZ');
      a.wrist.quaternion.copy(a.wrist.userData.restQuat).multiply(_q1.setFromEuler(_e));
    }
  }

  /* --------------------------------------------------------------- IK */

  _solveLeg(key, g) {
    const leg = this.s.legs[key];
    const f = this.feet[key];
    const side = f.side;
    const P = this.s.pelvis;

    const hip = new Vector3(side * LEG.hipLateral, -0.02, 0.0).applyMatrix4(P.matrix);
    const foot = f.pos.clone().applyMatrix4(this._rigInv);
    foot.y += LEG.padHeight;
    const footYaw = f.yaw - this.heading;
    const fFwd = new Vector3(-Math.sin(footYaw), 0, -Math.cos(footYaw));
    const pelFwd = new Vector3(0, 0, -1).applyQuaternion(P.quaternion).setY(0).normalize();
    const fwd = pelFwd.clone().lerp(fFwd, 0.5).normalize();

    const baseA = SPEC.stance.metatarsalPitch - 4 * g.runW;
    let alpha;
    if (f.inStance) {
      const t = f.stanceT;
      alpha = baseA + (8 * g.runW - 4) * Math.sin(Math.PI * t) * 0.5 + 20 * smoothstep(0.6, 1.0, t);
    } else {
      const t = f.swingT;
      alpha = baseA + 16 * (1 - smoothstep(0, 0.3, t)) + g.mtSwing * Math.sin(Math.PI * Math.min(1, t * 1.1)) - 4 * smoothstep(0.75, 1, t);
    }
    alpha = clamp(alpha, 25, f.inStance ? 86 : 78) * DEG;

    const maxReach = (LEG.femur + LEG.tibia) * 0.992;
    const swingMin = (LEG.femur + LEG.tibia) * 0.76;
    const back = fwd.clone().negate();
    const ankle = new Vector3();
    const place = (a) => ankle.copy(foot).addScaledVector(back, Math.cos(a) * LEG.metatarsus).addScaledVector(UP, Math.sin(a) * LEG.metatarsus);
    place(alpha);
    for (let n = 0; n < 16 && ankle.distanceTo(hip) > maxReach; n++) { alpha = Math.min(89 * DEG, alpha + 2.5 * DEG); place(alpha); }
    let dist = ankle.distanceTo(hip);
    if (dist > maxReach) { ankle.sub(hip).setLength(maxReach).add(hip); dist = maxReach; }
    const minReach = f.inStance ? Math.abs(LEG.femur - LEG.tibia) + 0.25 : swingMin;
    if (!f.inStance && ankle.distanceTo(hip) < minReach) {
      const need = minReach - ankle.distanceTo(hip);
      foot.y = Math.max(LEG.padHeight, foot.y - need);
      place(alpha);
    }
    for (let n = 0; n < 16 && ankle.distanceTo(hip) < minReach; n++) { alpha -= 2.5 * DEG; place(alpha); }
    dist = ankle.distanceTo(hip);

    const d = ankle.clone().sub(hip).normalize();
    const kdir = fwd.clone().addScaledVector(d, -fwd.dot(d)).normalize();
    const a = LEG.femur, b = LEG.tibia, c = dist;
    const cosA = clamp((a * a + c * c - b * b) / (2 * a * c), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const knee = hip.clone().addScaledVector(d, a * cosA).addScaledVector(kdir, a * sinA);
    const right = new Vector3().crossVectors(d, kdir).normalize();

    setBone(leg.femur, hip, knee, right);
    setBone(leg.tibia, knee, ankle, right);
    setBone(leg.meta, ankle, foot, right);

    leg.foot.position.copy(foot);
    leg.foot.rotation.set(0, footYaw, 0);
    let curl = 0;
    if (!f.inStance) curl = 38 * Math.sin(Math.PI * Math.min(1, f.swingT * 1.15)) * (0.6 + 0.4 * g.runW);
    const liftDeg = f.inStance ? 0 : 6 * smoothstep(0.7, 1, f.swingT);
    for (const dg of Object.values(leg.digits)) {
      const n = dg.joints.length;
      dg.joints.forEach((j, k) => {
        const flex = k === 0 ? -curl * 0.35 + liftDeg : -curl * 0.35 * (k / n + 0.4);
        j.rotation.set(flex * DEG, 0, 0);
      });
    }
  }
}

/** Orient a bone whose geometry extends along local -Y from its origin. */
function setBone(obj, from, to, rightHint) {
  const y = from.clone().sub(to).normalize();
  const x = rightHint.clone().addScaledVector(y, -rightHint.dot(y)).normalize();
  const z = new Vector3().crossVectors(x, y).normalize();
  _m1.makeBasis(x, y, z);
  obj.quaternion.setFromRotationMatrix(_m1);
  obj.position.copy(from);
}
