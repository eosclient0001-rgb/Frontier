/**
 * animator.js — Procedural locomotion + idle controller.
 *
 * Pipeline, once per frame:
 *   1. Speed smoothing (acceleration-limited) → gait parameters (gait.js).
 *   2. Advance the stride phase at 1/T(v).  When stopping, the phase keeps
 *      running until both feet are planted near their neutral stance spots,
 *      producing a natural "square-up" step instead of freezing mid-stride.
 *   3. Root motion: the rig moves along its heading at exactly v, so planted
 *      feet (held fixed in WORLD space) never slide.
 *   4. Pelvis: height, bob (inverted pendulum ↔ spring-mass), sway, pitch,
 *      yaw, roll — all phase-locked to the footfalls.
 *   5. Feet: stance = locked; swing = eased arc from lift-off to a predicted
 *      landing spot (so turning and speed changes re-target naturally).
 *   6. Leg IK: metatarsus angle chosen from stance progress (heel rise, toe-off,
 *      swing flexion), then analytic two-bone solve femur/tibia with the knee
 *      pointing forward, then digits flex/extend.
 *   7. Axial chain: dorsal counter-rotation, tail travelling wave with lag,
 *      neck/head stabilisation, breathing, idle look-around, jaw.
 */

import { Vector3, Quaternion, Matrix4, Euler, Object3D } from 'three';
import { gaitAt, gaitName, clamp, lerp, smoothstep, MAX_SPEED } from './gait.js';
import { LEG } from './skeleton.js';
import { SPEC } from './spec.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const Yv = new Vector3(0, 1, 0);
const Zv = new Vector3(0, 0, 1);

const _v1 = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3();
const _q1 = new Quaternion(), _q2 = new Quaternion();
const _m1 = new Matrix4();
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

const easeInOut = (t) => t * t * (3 - 2 * t);

export class Animator {
  constructor(skel, opts = {}) {
    this.s = skel;
    this.rig = skel.rig;

    // --- locomotion state
    this.speed = 0;            // current smoothed speed (m/s)
    this.targetSpeed = 0;
    this.turnInput = 0;        // -1..1
    this.heading = 0;          // yaw (rad), 0 = facing -Z
    this.yawRate = 0;
    this.phase = 0;            // 0..1 stride phase (left foot touchdown at 0)
    this.time = 0;
    this.distance = 0;
    this.accel = opts.accel ?? 1.5;   // m/s²  — a 9 t animal is not nimble
    this.decel = opts.decel ?? 2.1;
    this.maxTurnRate = 38 * DEG;      // rad/s at walking speed
    this.bounds = opts.bounds ?? 70;  // soft world radius; auto-steers home

    this.gait = gaitAt(0);
    this.pelvisPitchVel = 0;
    this.smoothed = { bob: 0, pitch: 0, crouch: 0, surge: 0 };
    this.onFootstep = null;           // callback(side, worldPos, strength)

    // --- idle state
    this.idle = {
      w: 1,             // idle blend weight 1 = fully idle
      look: new Vector3(),
      lookTarget: new Vector3(),
      nextLook: 0,
      jaw: 0, jawTarget: 0, nextJaw: 3,
      breath: 0,
      shift: 0,
      roar: 0,          // roar envelope 0..1 (triggered)
      roarT: -1,
      sniff: 0, nextSniff: 6,
    };

    // --- feet (world-space)
    this.feet = {};
    for (const key of ['L', 'R']) {
      const side = key === 'R' ? 1 : -1;
      const p = new Vector3(side * LEG.footLateral, 0, key === 'L' ? -0.25 : 0.25);
      this.feet[key] = {
        key, side,
        offset: key === 'L' ? 0 : 0.5,
        planted: true,
        pos: p.clone(),           // current MTP ground point (world)
        plant: p.clone(),         // locked stance location
        lift: p.clone(),          // lift-off point
        yaw: 0, plantYaw: 0, liftYaw: 0,
        swingT: 0, stanceT: 0,
        height: 0,
        wasStance: true,
      };
    }

    // world transform bookkeeping
    this.rigPos = new Vector3(0, 0, 0);
    this.rig.position.copy(this.rigPos);
    this._rigInv = new Matrix4();
  }

  /* ----------------------------------------------------------- inputs */

  setTargetSpeed(v) { this.targetSpeed = clamp(v, 0, MAX_SPEED); }
  setTurn(x) { this.turnInput = clamp(x, -1, 1); }
  roar() { if (this.idle.roarT < 0) this.idle.roarT = 0; }

  get gaitLabel() { return this.idle.roarT >= 0 && this.speed < 0.3 ? 'Idle · roar' : gaitName(this.speed, this.gait.duty); }

  /* ------------------------------------------------------------ update */

  update(dt) {
    dt = Math.min(dt, 1 / 20);
    this.time += dt;

    // ---- 1. speed smoothing
    const dv = this.targetSpeed - this.speed;
    const rate = dv > 0 ? this.accel : this.decel;
    this.speed += clamp(dv, -rate * dt, rate * dt);
    if (Math.abs(this.speed) < 1e-4) this.speed = 0;
    const g = (this.gait = gaitAt(this.speed));

    // ---- 2. turning (turn rate shrinks at speed: momentum)
    let turn = this.turnInput;
    // soft boundary: steer back towards the origin when wandering too far
    const distFromHome = Math.hypot(this.rigPos.x, this.rigPos.z);
    if (distFromHome > this.bounds && this.speed > 0.2) {
      const want = Math.atan2(-this.rigPos.x, -this.rigPos.z);        // heading that points home
      const fwdAng = Math.atan2(-Math.sin(this.heading), -Math.cos(this.heading));
      let d = Math.atan2(Math.sin(want - fwdAng), Math.cos(want - fwdAng));
      turn = clamp(turn + d * 1.2, -1, 1);
    }
    const locoW = smoothstep(0.05, 0.9, this.speed);
    const maxRate = this.maxTurnRate * (1 - 0.45 * smoothstep(2.5, 7, this.speed)) * lerp(0.55, 1, locoW);
    const desiredYawRate = turn * maxRate;
    this.yawRate += (desiredYawRate - this.yawRate) * (1 - Math.exp(-dt * 3.0));
    this.heading += this.yawRate * dt;

    // ---- 3. phase advance (with settle-to-stop logic)
    const idleNow = this.targetSpeed < 0.05 && this.speed < 0.25;
    let phaseRate = locoW;
    if (idleNow) {
      const unsettled = this._needsSettling() || Math.abs(this.yawRate) > 8 * DEG;
      phaseRate = unsettled ? Math.max(locoW, 0.75) : locoW;
    } else if (Math.abs(this.yawRate) > 6 * DEG) {
      phaseRate = Math.max(phaseRate, 0.75);               // turn on the spot = step
    }
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
    const idleTarget = this.speed < 0.15 && this.targetSpeed < 0.05 ? 1 : 0;
    this.idle.w += (idleTarget - this.idle.w) * (1 - Math.exp(-dt * (idleTarget ? 1.2 : 4)));

    // ---- 5. feet
    const stepping = phaseRate > 1e-3;
    for (const f of Object.values(this.feet)) this._updateFoot(f, g, fwd, stepping, dt);

    // ---- 6. pelvis + axial
    this._updatePelvis(g, dt);
    this._updateIdle(dt);
    this._updateAxial(g, dt);

    // ---- 7. legs
    this.rig.updateMatrixWorld(true);
    for (const key of ['L', 'R']) this._solveLeg(key, g);
  }

  /* ------------------------------------------------------------- feet */

  /** Neutral stance spot for a foot, in world space, relative to the rig. */
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
      if (Math.abs(Math.atan2(Math.sin(f.plantYaw - this.heading), Math.cos(f.plantYaw - this.heading))) > 12 * DEG) return true;
    }
    return false;
  }

  _updateFoot(f, g, fwd, stepping, dt) {
    const lp = (this.phase + f.offset) % 1;
    const duty = g.duty;
    const inStance = lp < duty;

    if (!stepping) {
      // frozen phase: keep feet planted where they are
      if (!f.planted) {
        f.planted = true; f.plant.copy(f.pos).setY(0); f.plantYaw = f.yaw;
      }
      f.pos.copy(f.plant); f.height = 0; f.yaw = f.plantYaw;
      f.stanceT = 0.5; f.swingT = 0;
      f.inStance = true;
      return;
    }

    if (inStance) {
      if (!f.planted) {
        // touchdown
        f.planted = true;
        f.plant.copy(f.pos).setY(0);
        f.plantYaw = f.yaw;
        if (this.onFootstep) this.onFootstep(f.key, f.plant.clone(), clamp(0.25 + this.speed / 6, 0, 1.2), f.plantYaw);
      }
      f.pos.copy(f.plant);
      f.height = 0;
      f.yaw = f.plantYaw;
      f.stanceT = lp / duty;
      f.swingT = 0;
    } else {
      if (f.planted) {
        // lift-off
        f.planted = false;
        f.lift.copy(f.plant);
        f.liftYaw = f.plantYaw;
      }
      const t = (lp - duty) / (1 - duty);
      f.swingT = t;
      f.stanceT = 1;
      // predicted landing: where the neutral spot will be at touchdown, plus
      // half the stance excursion so the foot lands ahead of the hip.
      const remaining = (1 - t) * (1 - duty) * g.T;
      // running stance is biased caudally (foot lands closer under the COM)
      const fore = (0.5 - 0.14 * g.runW) * duty * g.stride;
      const land = this._neutral(f, _v2, fore);
      land.addScaledVector(fwd, this.speed * remaining);
      // turning: anticipate the heading change
      const landYaw = this.heading + this.yawRate * remaining;
      const e = easeInOut(clamp(t * 1.08, 0, 1));
      f.pos.lerpVectors(f.lift, land, e);
      const lift = g.stepH * (this.speed < 0.4 ? 0.7 : 1);
      f.height = lift * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 1.2);
      f.pos.y = f.height;
      const dy = Math.atan2(Math.sin(landYaw - f.liftYaw), Math.cos(landYaw - f.liftYaw));
      f.yaw = f.liftYaw + dy * e;
    }
    f.inStance = inStance;
  }

  /* ------------------------------------------------------------ pelvis */

  _updatePelvis(g, dt) {
    const P = this.s.pelvis;
    const ph = this.phase;
    const d2 = g.duty / 2;
    const idle = this.idle;

    // vertical bob: two per stride. Walk: peak at mid-stance; run: trough.
    const bobSign = 1 - 2 * g.runW;
    const bobRaw = g.bob * bobSign * Math.cos(TAU * 2 * (ph - d2));
    // lateral sway & roll: towards the stance foot (L stance centred at d2)
    const swayRaw = -g.sway * Math.cos(TAU * (ph - d2)) * smoothstep(0.02, 0.6, this.speed + (this._needsSettling() ? 0.4 : 0));
    const rollRaw = g.roll * DEG * Math.cos(TAU * (ph - d2)) * smoothstep(0.02, 0.6, this.speed);
    // yaw: the swing-side hip swings forward
    const yawRaw = g.yaw * DEG * Math.sin(TAU * (ph - d2)) * smoothstep(0.02, 0.6, this.speed);
    // fore-aft surge (braking at touchdown, propulsion at toe-off)
    const surgeRaw = -0.03 * g.runW * Math.sin(TAU * 2 * (ph - d2)) * locoAmp(this.speed);

    // idle: breathing + slow weight shifting
    idle.breath = Math.sin(this.time * TAU / 4.2);
    idle.shift = noise1(this.time * 0.13, 3) * 0.06;

    const sm = this.smoothed;
    const k = 1 - Math.exp(-dt * 8);
    sm.crouch += (g.crouch - sm.crouch) * (1 - Math.exp(-dt * 3));
    // acceleration lean: pitch forward when speeding up
    const acc = (this.targetSpeed - this.speed);
    const accLean = clamp(acc, -2, 2) * -1.1 * DEG * (1 - idle.w);
    sm.pitch += (g.pitch * DEG + accLean - sm.pitch) * (1 - Math.exp(-dt * 2.5));

    const roarDip = idle.roar * 0.10;
    const y = SPEC.stance.acetabulumHeight - sm.crouch + bobRaw + idle.w * (0.012 * idle.breath) - roarDip;
    P.position.set(swayRaw + idle.w * idle.shift, y, surgeRaw);

    const pitch = sm.pitch + idle.w * (0.4 * DEG * idle.breath) - idle.roar * 4 * DEG
      - 0.8 * DEG * g.bob * bobSign * Math.sin(TAU * 2 * (ph - d2)) * 10;
    _e.set(pitch, yawRaw + idle.w * idle.shift * 0.4, rollRaw - idle.w * idle.shift * 0.6, 'YXZ');
    P.quaternion.setFromEuler(_e);
    this.pelvisYaw = yawRaw;
    this.pelvisRoll = rollRaw;
    this.bobRaw = bobRaw;
  }

  /* -------------------------------------------------------------- idle */

  _updateIdle(dt) {
    const I = this.idle;
    const t = this.time;
    // look-around: pick a new gaze target every few seconds
    if (t > I.nextLook) {
      const wide = Math.random() < 0.35;
      I.lookTarget.set(
        (Math.random() * 2 - 1) * (wide ? 38 : 16),   // yaw deg
        (Math.random() * 2 - 1) * 8 - (Math.random() < 0.25 ? 10 : 0), // pitch deg
        (Math.random() * 2 - 1) * 6                   // roll (head tilt)
      );
      I.nextLook = t + 2.2 + Math.random() * 3.8;
    }
    // critically-damped-ish follow: fast saccade then settle
    const k = 1 - Math.exp(-dt * 2.4);
    I.look.lerp(I.lookTarget, k);

    // jaw: occasional slow open (panting / display)
    if (t > I.nextJaw) {
      I.jawTarget = I.jawTarget > 0.05 ? 0 : 0.10 + Math.random() * 0.22;
      I.nextJaw = t + (I.jawTarget > 0 ? 0.9 + Math.random() * 1.4 : 3 + Math.random() * 5);
    }
    I.jaw += (I.jawTarget - I.jaw) * (1 - Math.exp(-dt * 3));

    // sniff: quick small head bobs
    if (t > I.nextSniff) { I.sniff = 1; I.nextSniff = t + 7 + Math.random() * 8; }
    I.sniff = Math.max(0, I.sniff - dt * 0.9);

    // roar envelope (2.8 s): wind-up, open, hold, close
    if (I.roarT >= 0) {
      I.roarT += dt;
      const r = I.roarT;
      I.roar = r < 0.5 ? easeInOut(r / 0.5) : r < 2.2 ? 1 : r < 2.8 ? 1 - easeInOut((r - 2.2) / 0.6) : 0;
      if (r >= 2.8) { I.roarT = -1; I.roar = 0; }
    }
  }

  /* ------------------------------------------------------------- axial */

  _updateAxial(g, dt) {
    const S = this.s;
    const ph = this.phase;
    const I = this.idle;
    const loco = 1 - I.w;
    const d2 = g.duty / 2;

    // --- trunk: counter-rotate the pelvic yaw/roll so the shoulders stay
    //     steady, add breathing flexion
    const nT = S.trunk.length;
    for (let i = 0; i < nT; i++) {
      const j = S.trunk[i];
      const u = i / (nT - 1);
      const yaw = -this.pelvisYaw * 0.9 / nT;
      const roll = -this.pelvisRoll * 0.7 / nT;
      const pitch = -0.08 * DEG * I.breath * I.w + (-I.roar * 1.0 * DEG) * u;
      // local frame: X right, Y along the column, Z dorsal
      //   lateral bend = rotation about Z, flexion = about X, twist = about Y
      _e.set(pitch, roll, yaw, 'XYZ');
      j.quaternion.copy(j.userData.restQuat).multiply(_q1.setFromEuler(_e));
    }

    // --- tail: travelling lateral wave (one per stride) + vertical lag
    const nC = S.tail.length;
    const turnBend = -this.yawRate * 0.9;              // tail swings outside of the turn
    for (let i = 0; i < nC; i++) {
      const j = S.tail[i];
      const u = i / (nC - 1);
      const amp = g.tail * DEG * (0.4 + 1.6 * u) * lerp(0.6, 1, loco);
      const lag = u * 1.6;                                 // wave travels down the tail
      const lat = amp * Math.sin(TAU * (ph - d2) - lag) + (turnBend / nC) * (0.5 + u)
        + I.w * 0.35 * DEG * Math.sin(this.time * 0.55 - u * 2.2) * (0.3 + u);
      const vert = -0.06 * DEG * Math.sin(TAU * 2 * (ph - d2) - lag * 1.3) * g.bob * 60 * (0.2 + u) * loco
        + (0.10 * DEG * g.runW) * (1 - u)                 // stiffer, raised tail base at a run
        + I.roar * 0.35 * DEG * (1 - u);
      // tail joints point posteriorly (+Y towards the head), so dorsal
      // flexion of the tail is a negative rotation about X
      _e.set(-vert, 0, lat, 'XYZ');
      j.quaternion.copy(j.userData.restQuat).multiply(_q1.setFromEuler(_e));
    }

    // --- neck & head: stabilise the skull (bird-like gaze stabilisation)
    const nN = S.neck.length;
    const look = I.look;
    const lookYaw = (look.x * I.w + (-this.yawRate * 0.55 / DEG) * loco) * DEG;  // look into turns
    const lookPitch = (look.y * I.w + g.neck * loco) * DEG;
    const sniff = I.sniff > 0 ? Math.sin((1 - I.sniff) * TAU * 3) * 2.5 * DEG * I.sniff : 0;
    // cancel the pelvis oscillation so the head doesn't wobble
    const cancelPitch = -(this.bobRaw || 0) * 0.9 - this.s.pelvis.rotation.x * 0;
    const cancelYaw = -this.pelvisYaw * 0.1;
    for (let i = 0; i < nN; i++) {
      const j = S.neck[i];
      const u = i / (nN - 1);            // 0 = C10 (base), 1 = C1 (atlas)
      const w = 0.6 + 0.8 * u;
      const pitch = (lookPitch * 0.55 + cancelPitch + sniff) * w / nN
        + I.roar * (i < 5 ? -3.0 : 5.0) * DEG
        + 0.06 * DEG * I.breath * I.w;
      const yaw = (lookYaw * 0.6 + cancelYaw) * w / nN;
      _e.set(pitch, 0, yaw, 'XYZ');
      j.quaternion.copy(j.userData.restQuat).multiply(_q1.setFromEuler(_e));
    }
    // head joint: remaining gaze + tilt; stabilise against body pitch osc
    {
      const h = S.head;
      const pitch = lookPitch * 0.35 + sniff * 0.8 + I.roar * 12 * DEG
        - (this.s.pelvis.quaternion.x * 2) * 0.35;
      const yaw = lookYaw * 0.4;
      const roll = look.z * DEG * I.w * 0.8;
      _e.set(pitch, roll, yaw, 'XYZ');
      h.quaternion.copy(h.userData.restQuat).multiply(_q1.setFromEuler(_e));
    }
    // jaw
    {
      const open = I.jaw * I.w + I.roar * 0.62 + 0.03 * g.runW;      // radians
      S.jaw.rotation.set(Math.max(0, open) * 0.9, 0, 0);
    }

    // --- arms: small passive swing, tucked at a run
    for (const key of ['L', 'R']) {
      const a = S.arms[key];
      if (!a || !a.shoulder) continue;
      const side = key === 'R' ? 1 : -1;
      const swing = Math.sin(TAU * (ph - d2) + (side > 0 ? Math.PI : 0)) * 6 * DEG * loco;
      _e.set(swing - g.runW * 18 * DEG + I.roar * -15 * DEG, 0, side * I.roar * 10 * DEG, 'XYZ');
      a.shoulder.quaternion.copy(a.shoulder.userData.restQuat).multiply(_q1.setFromEuler(_e));
      _e.set(g.runW * 25 * DEG + I.w * 3 * DEG * I.breath + I.roar * 20 * DEG, 0, 0, 'XYZ');
      a.elbow.quaternion.copy(a.elbow.userData.restQuat).multiply(_q1.setFromEuler(_e));
      _e.set(I.roar * 20 * DEG, 0, 0, 'XYZ');
      a.wrist.quaternion.copy(a.wrist.userData.restQuat).multiply(_q1.setFromEuler(_e));
    }
  }

  /* --------------------------------------------------------------- IK */

  _solveLeg(key, g) {
    const leg = this.s.legs[key];
    const f = this.feet[key];
    const side = f.side;
    const P = this.s.pelvis;

    // hip joint in rig space
    const hip = _v1.set(side * LEG.hipLateral, -0.02, 0.0).applyMatrix4(P.matrix);

    // foot (MTP) target in rig space
    const foot = f.pos.clone().applyMatrix4(this._rigInv);
    foot.y += LEG.padHeight;
    const footYaw = f.yaw - this.heading;           // yaw relative to the rig
    const fFwd = new Vector3(-Math.sin(footYaw), 0, -Math.cos(footYaw));

    // leg plane forward: blend of the foot's forward and the pelvis forward
    const pelFwd = new Vector3(0, 0, -1).applyQuaternion(P.quaternion).setY(0).normalize();
    const fwd = pelFwd.clone().lerp(fFwd, 0.5).normalize();

    // --- metatarsus pitch schedule (deg from horizontal).
    //     mid-stance ~55°, heel rises to ~72° at toe-off, swing flexes the
    //     ankle so the metatarsus hangs steeply, then extends pre-landing.
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
    // keep the swing leg from folding up under the belly: the ankle may not
    // come closer to the hip than ~70% of femur+tibia
    const swingMin = (LEG.femur + LEG.tibia) * 0.76;
    const back = fwd.clone().negate();
    const ankle = new Vector3();
    const place = (a) => ankle.copy(foot).addScaledVector(back, Math.cos(a) * LEG.metatarsus).addScaledVector(UP, Math.sin(a) * LEG.metatarsus);
    place(alpha);
    // too far? raise the heel until the femur+tibia can reach
    for (let n = 0; n < 16 && ankle.distanceTo(hip) > maxReach; n++) { alpha = Math.min(89 * DEG, alpha + 2.5 * DEG); place(alpha); }
    // still too far (extreme): pull the foot target in along the hip line
    let dist = ankle.distanceTo(hip);
    if (dist > maxReach) {
      ankle.sub(hip).setLength(maxReach).add(hip);
      dist = maxReach;
    }
    // too close: lower the heel
    const minReach = f.inStance ? Math.abs(LEG.femur - LEG.tibia) + 0.25 : swingMin;
    // swing: if the ankle is too close, lower it (drop the foot) instead
    if (!f.inStance && ankle.distanceTo(hip) < minReach) {
      const need = minReach - ankle.distanceTo(hip);
      foot.y = Math.max(LEG.padHeight, foot.y - need);
      place(alpha);
    }
    for (let n = 0; n < 16 && ankle.distanceTo(hip) < minReach; n++) { alpha -= 2.5 * DEG; place(alpha); }
    dist = ankle.distanceTo(hip);

    // --- two-bone solve: knee in the plane spanned by (hip→ankle, fwd)
    const d = ankle.clone().sub(hip).normalize();
    const kdir = fwd.clone().addScaledVector(d, -fwd.dot(d)).normalize();
    const a = LEG.femur, b = LEG.tibia, c = dist;
    const cosA = clamp((a * a + c * c - b * b) / (2 * a * c), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const knee = hip.clone().addScaledVector(d, a * cosA).addScaledVector(kdir, a * sinA);
    // plane right axis
    const right = new Vector3().crossVectors(d, kdir).normalize();

    setBone(leg.femur, hip, knee, right);
    setBone(leg.tibia, knee, ankle, right);
    setBone(leg.meta, ankle, foot, right);

    // --- foot + digits
    leg.foot.position.copy(foot);
    leg.foot.rotation.set(0, footYaw, 0);
    // toe flex: during swing the digits curl (plantarflex) then extend to land;
    // at toe-off the toes stay flat while the metatarsus rotates over them
    let curl = 0;
    if (!f.inStance) curl = 38 * Math.sin(Math.PI * Math.min(1, f.swingT * 1.15)) * (0.6 + 0.4 * g.runW);
    const liftDeg = f.inStance ? 0 : 6 * smoothstep(0.7, 1, f.swingT);
    for (const d of Object.values(leg.digits)) {
      const n = d.joints.length;
      d.joints.forEach((j, k) => {
        const flex = (k === 0 ? -curl * 0.35 + liftDeg : -curl * 0.35 * (k / n + 0.4));
        j.rotation.set(flex * DEG, 0, 0);
      });
    }
  }
}

function locoAmp(v) { return smoothstep(0.1, 1.0, v); }

/** Orient a bone whose geometry extends along local -Y from its origin. */
function setBone(obj, from, to, rightHint) {
  const y = from.clone().sub(to).normalize();           // local +Y points back up the bone
  const x = rightHint.clone().addScaledVector(y, -rightHint.dot(y)).normalize();
  const z = new Vector3().crossVectors(x, y).normalize();
  _m1.makeBasis(x, y, z);
  obj.quaternion.setFromRotationMatrix(_m1);
  obj.position.copy(from);
}
