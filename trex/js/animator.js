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

/* ================================================================ actions */

export const ACTION_DEFS = {
  /** Lunge, gape, snap, (shake if something was caught), recover. */
  bite: { dur: 1.65, lockFeet: false },
  /** Hips pivot and the tail whips round in a travelling wave. */
  tailSwipe: { dur: 2.1, lockFeet: true },
  /** Head up, jaws wide, side-to-side sweep with a tremor. */
  roar: { dur: 2.9, lockFeet: false },
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
    pitch: 0, yaw: 0, roll: 0, drop: 0, surge: 0,
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
      w: 1, look: new Vector3(), lookTarget: new Vector3(), nextLook: 0,
      jaw: 0, jawTarget: 0, nextJaw: 3, breath: 0, shift: 0,
      sniff: 0, nextSniff: 6,
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
   */
  startAction(type, opts = {}) {
    if (this.action) return false;
    const def = ACTION_DEFS[type];
    if (!def) return false;
    const a = { type, def, t: 0, started: !def.lockFeet, hit: false, ...opts };
    if (type === 'bite') {
      a.hasTarget = !!opts.target;
      // lunge so the jaws arrive at the target: rest reach of the tooth row ≈ 5.6 m
      a.surge = a.hasTarget ? -clamp((opts.reach ?? 5.8) - 5.6, -0.35, 0.95) : -0.55;
    }
    if (type === 'tailSwipe') a.side = opts.side ?? 1;
    this.action = a;
    this.emit('start', a);
    return true;
  }
  roar() { return this.startAction('roar'); }

  get busy() { return !!this.action; }

  get gaitLabel() {
    if (this.action) {
      const n = { bite: 'Bite', tailSwipe: 'Tail swipe', roar: 'Roar' }[this.action.type];
      return `Attack · ${n}`.replace('Attack · Roar', 'Roar');
    }
    if (this.speed < 0.3 && Math.abs(this.yawRate) > 6 * DEG) return 'Turn in place';
    return gaitName(this.speed, this.gait.duty);
  }

  /* ------------------------------------------------------------ update */

  update(dt) {
    dt = Math.min(dt, 1 / 20);
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
    const pivoting = Math.abs(this.yawRate) > 5 * DEG;

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
      const w1 = ease(t / 0.32);                 // wind-up / gape
      const w2 = ease((t - 0.30) / 0.26);        // strike
      const snap = ease((t - 0.56) / 0.08);      // jaws slam shut
      const rec = ease((t - 1.15) / 0.5);        // recover
      const strike = w2 * (1 - rec);
      const wind = w1 * (1 - w2);
      // Low targets: pitch the WHOLE BODY forward about the hips (the tail
      // rises as a counterweight) so the skull can come down at a natural
      // ~30-40° instead of folding the neck straight down.
      let bodyPitch = 9 * DEG;
      if (a.hasTarget && this.aimTarget) {
        const neckH = SPEC.stance.acetabulumHeight + 0.40;           // neck base height at rest
        const wantH = this.aimTarget.y + 1.55;                       // where the neck base should be
        bodyPitch = clamp(Math.asin(clamp((neckH - wantH) / 3.1, -0.3, 0.6)), 4 * DEG, 20 * DEG);
      }
      A.pitch = 3 * DEG * wind - bodyPitch * strike;
      A.surge = 0.15 * wind + (a.hasTarget ? 0 : a.surge * strike);
      A.drop = a.hasTarget ? 0 : 0.16 * strike;
      A.lungeW = a.hasTarget ? strike : 0;
      A.headPitch = (12 * wind - 4 * strike) * DEG;
      A.neckPitch = (a.hasTarget ? 6 * wind : 6 * wind - 22 * strike) * DEG;
      A.jaw = 1.0 * w1 * (1 - snap) + 0.05 * snap * (1 - rec);
      A.aimW = a.hasTarget ? Math.max(w1 * (1 - rec), strike) : 0;
      A.arms = strike;
      A.speedCap = t > 0.62 ? 2.0 : Infinity;
      if (a.hit) {
        const st = t - 0.66;
        if (st > 0 && st < 0.5) {
          const e = Math.sin(TAU * 4 * st) * (1 - st / 0.5);
          A.headYaw = 18 * DEG * e; A.neckYaw = 12 * DEG * e; A.headRoll = 12 * DEG * e; A.roll = 2.5 * DEG * e;
        }
      }
      if (!a.snapped && t >= 0.6) { a.snapped = true; this.emit('biteSnap', a); }
      if (a.hit && !a.released && t >= 1.16) { a.released = true; this.emit('biteRelease', a); }
    } else if (a.type === 'tailSwipe') {
      const s = a.side;
      const S = swipeCurve(t);
      const env = smoothstep(0, 0.3, t) * (1 - smoothstep(1.5, 2.1, t));
      // hips pivot hard on the planted feet; the chest counter-turns so the
      // head stays on the target while the tail comes round
      A.yaw = s * 40 * DEG * S;
      A.trunkYaw = -A.yaw * 0.55;
      A.roll = s * 5 * DEG * S;
      A.drop = 0.18 * Math.abs(S);
      A.pitch = -7 * DEG * Math.max(0, S);          // front down → tail base up...
      A.neckYaw = -s * (25 + 20 * Math.max(0, S)) * DEG * env;
      A.tailSide = s; A.tailT = t; A.tailDown = smoothstep(0.25, 0.6, t) * (1 - smoothstep(1.2, 1.8, t));   // ...then tail sweeps LOW
      A.jaw = 0.22 * env;
      A.speedCap = 0;
      if (t > 0.5 && t < 1.2) this.emit('tailSweep', a);
    } else if (a.type === 'roar') {
      const r = t < 0.5 ? ease(t / 0.5) : t < 2.2 ? 1 : 1 - ease((t - 2.2) / 0.7);
      A.roar = r;
      A.speedCap = 1.0;
      const hold = smoothstep(0.45, 0.7, t) * (1 - smoothstep(2.0, 2.3, t));
      A.headYaw = 14 * DEG * Math.sin((t - 0.5) * TAU * 0.55) * hold;
      A.neckYaw = 8 * DEG * Math.sin((t - 0.5) * TAU * 0.55) * hold;
      A.headRoll = 1.2 * DEG * Math.sin(t * TAU * 11) * hold;           // vocal tremor
      A.arms = -0.4 * r;
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
    const duty = g.duty;
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
      // running stance is biased caudally (foot lands closer under the COM)
      const fore = (0.5 - 0.14 * g.runW) * duty * g.stride;
      const land = this._neutral(f, _v2, fore);
      land.addScaledVector(fwd, this.speed * remaining);
      const landYaw = this.heading + this.yawRate * remaining;
      const e = ease(t * 1.08);
      f.pos.lerpVectors(f.lift, land, e);
      const lift = g.stepH * (this.speed < 0.4 ? 0.7 : 1);
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

    const y = SPEC.stance.acetabulumHeight - sm.crouch + bobRaw + idle.w * 0.012 * idle.breath - A.roar * 0.10 - A.drop;
    P.position.set(swayRaw + idle.w * idle.shift, y, surgeRaw + A.surge);
    this.lungeW = A.lungeW;
    if (A.lungeW > 0) P.position.addScaledVector(this.lunge, A.lungeW);

    const pitch = sm.pitch + idle.w * 0.4 * DEG * idle.breath - A.roar * 4 * DEG + A.pitch
      - 8 * DEG * g.bob * bobSign * Math.sin(TAU * 2 * (ph - d2));
    // hips lead a pivot slightly
    const yaw = yawRaw + idle.w * idle.shift * 0.4 + this.yawRate * 0.18 + A.yaw;
    _e.set(pitch, yaw, rollRaw - idle.w * idle.shift * 0.6 + A.roll, 'YXZ');
    P.quaternion.setFromEuler(_e);
    this.pelvisYaw = yawRaw;
    this.pelvisRoll = rollRaw;
    this.bobRaw = bobRaw;
  }

  /* -------------------------------------------------------------- idle */

  _updateIdle(dt) {
    const I = this.idle;
    const t = this.time;
    if (t > I.nextLook) {
      const wide = Math.random() < 0.35;
      I.lookTarget.set(
        (Math.random() * 2 - 1) * (wide ? 38 : 16),
        (Math.random() * 2 - 1) * 8 - (Math.random() < 0.25 ? 10 : 0),
        (Math.random() * 2 - 1) * 6
      );
      I.nextLook = t + 2.2 + Math.random() * 3.8;
    }
    I.look.lerp(I.lookTarget, 1 - Math.exp(-dt * 2.4));
    if (t > I.nextJaw) {
      I.jawTarget = I.jawTarget > 0.05 ? 0 : 0.10 + Math.random() * 0.22;
      I.nextJaw = t + (I.jawTarget > 0 ? 0.9 + Math.random() * 1.4 : 3 + Math.random() * 5);
    }
    I.jaw += (I.jawTarget - I.jaw) * (1 - Math.exp(-dt * 3));
    if (t > I.nextSniff) { I.sniff = 1; I.nextSniff = t + 7 + Math.random() * 8; }
    I.sniff = Math.max(0, I.sniff - dt * 0.9);
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
    const cy = clamp(dYaw, -70 * DEG, 70 * DEG), cp = clamp(dPitch, -46 * DEG, 35 * DEG);
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
    need.x = clamp(need.x, -0.6, 0.6);
    need.y = clamp(need.y, -0.55, 0.05);
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
      const yaw = (-this.pelvisYaw * 0.9 - this.yawRate * 0.12 + A.trunkYaw) / nT;
      const roll = -this.pelvisRoll * 0.7 / nT;
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
        lat += A.tailSide * swipeCurve(A.tailT - 0.32 * u) * (1.45 + 1.3 * u) * DEG;
        // the tail droops during the whip so the distal half sweeps at
        // roughly 0.5-1.5 m — low enough to strike prey on the ground
        vert -= (2.9 * (1 - u) * (1 - u) + 0.30) * DEG * A.tailDown;
      }
      // tail joints: +Y points anteriorly, the vertebra extends along -Y,
      // so dorsal flexion of the tail is a negative rotation about X
      _e.set(-vert, 0, lat, 'XYZ');
      j.quaternion.copy(j.userData.restQuat).multiply(_q1.setFromEuler(_e));
    }

    // --- neck & head
    const nN = S.neck.length;
    const noLook = Math.max(this.aimW, this.action ? 1 : 0);
    const lookYaw = (I.look.x * I.w * (1 - noLook)) * DEG + this.yawRate * 0.55;   // look into turns
    const lookPitch = (I.look.y * I.w * (1 - noLook) + g.neck * loco) * DEG;
    const sniff = I.sniff > 0 && !this.action ? Math.sin((1 - I.sniff) * TAU * 3) * 2.5 * DEG * I.sniff : 0;
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
      const pitch = (lookPitch * 0.55 + cancelPitch + sniff + A.neckPitch) * w / nN + this.aimPitch * 0.85 * wa
        + A.roar * (i < 5 ? -3.0 : 5.0) * DEG
        + 0.06 * DEG * I.breath * I.w;
      const yaw = (lookYaw * 0.6 + cancelYaw + A.neckYaw) * w / nN + this.aimYaw * 0.85 * wa;
      _e.set(pitch, 0, yaw, 'XYZ');
      j.quaternion.copy(j.userData.restQuat).multiply(_q1.setFromEuler(_e));
    }
    {
      const h = S.head;
      const pitch = lookPitch * 0.35 + sniff * 0.8 + A.roar * 12 * DEG + A.headPitch + this.aimPitch * 0.15;
      const yaw = lookYaw * 0.4 + A.headYaw + this.aimYaw * 0.15;
      const roll = I.look.z * DEG * I.w * 0.8 * (1 - noLook) + A.headRoll;
      // head frame: X right, Y up, Z back → yaw is about Y, roll about Z
      _e.set(pitch, yaw, roll, 'YXZ');
      h.quaternion.copy(h.userData.restQuat).multiply(_q1.setFromEuler(_e));
    }
    // jaw — NEGATIVE rotation about X swings the front of the mandible DOWN
    {
      const idleJaw = I.jaw * I.w * (this.action ? 0 : 1);
      const open = idleJaw + A.roar * 0.85 + A.jaw + 0.03 * g.runW;
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
