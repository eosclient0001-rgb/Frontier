// Arcade car model in the spirit of NFS-style handling:
//  - bicycle model with saturating (tanh) tyre forces
//  - load transfer (braking pitches weight forward, acceleration back)
//  - speed-sensitive steering lock, steering rate limit
//  - handbrake breaks the rear grip for controllable slides
//  - throttle on the rear wheels: power oversteer when the rear traction budget is spent
//  - light yaw-rate assist that keeps the car pointed where you steer, relaxed while sliding
//  - banking and grade act on the car, guard rails clamp it, nitro is a timed boost
import { ROAD, GRAVITY as G } from '../world/constants.js';
import { clamp, lerp } from '../core/math.js';

export const DT = 1 / 120;

export const CAR = {
  mass: 1350, // kg
  Iz: 2600, // yaw inertia
  a: 1.2, // CG to front axle (m)
  b: 1.6, // CG to rear axle (m)
  L: 2.8,
  cgH: 0.5,
  Cf: 95000, // cornering stiffness (N/rad)
  Cr: 115000,
  mu: 1.15, // tyre friction coefficient
  rearGripBonus: 1.25, // arcade: rear tyres slightly stickier than their static load suggests
  vTop: 76, // m/s (~274 km/h)
  accel: 8.6, // m/s^2 at standstill
  brakeDecel: 15.5,
  nitroTop: 96,
  nitroAccel: 12.5,
  nitroDur: 4.0, // seconds per full bar
  steerLo: 0.56, // max road-wheel angle at standstill (rad)
  steerHi: 0.085, // at speed
  steerRef: 42, // m/s where steering reaches steerHi
  kUS: 0.0011, // understeer gradient for the kinematic yaw target
  assistGain: 6.5,
  hbLock: 0.55,
  hbLatFactor: 0.5,
  tcsSlip: 0.12, // arcade traction control: power tapers once the rear is sliding past this
  rideH: 0.38, // chassis reference height above the road
  halfW: 0.95,
  halfL: 2.3,
};

export class Vehicle {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.yaw = 0;
    this.vx = 0; // forward speed (body)
    this.vy = 0; // lateral speed (body, +right)
    this.r = 0; // yaw rate (+right)
    this.vyW = 0; // vertical speed when airborne
    this.ax = 0;
    this.ay = 0;
    this.steer = 0;
    this.nitroLeft = 1;
    this.nitroOn = false;
    this.grounded = true;
    this.sec = null;
    this.s = 0;
    this.lat = 0;
    this.h = 0;
    this.grade = 0;
    this.bank = 0;
    this.gripMul = 1;
    this.slipF = 0;
    this.slipR = 0;
    this.drifting = false;
    this.latG = 0;
    this.longG = 0;
    this.wallHit = 0; // accumulates impact magnitude this frame
    this.landed = 0; // landing impact this frame
    this.lost = false; // fell out of the world
  }

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }

  get heading() {
    return [Math.cos(this.yaw), Math.sin(this.yaw)];
  }

  placeOn(surf, s, lat, yaw = null) {
    const p = surf.sec.point(s, lat);
    this.x = p.x;
    this.z = p.z;
    this.y = p.y + CAR.rideH;
    this.yaw = yaw ?? Math.atan2(p.tz, p.tx);
    this.sec = surf.sec;
    this.s = s;
    this.lat = lat;
    this.h = p.y;
    this.grounded = true;
    this.lost = false;
  }

  reset(x, z, yaw, speed) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = speed;
    this.vy = 0;
    this.r = 0;
    this.vyW = 0;
    this.steer = 0;
    this.nitroLeft = 1;
    this.grounded = true;
    this.lost = false;
  }

  /**
   * One fixed physics step.
   * @param {number} dt
   * @param {{throttle:number, brake:number, steer:number, hb:boolean, nitro:boolean}} inp
   * @param {(x:number,y:number,z:number,hint:object|null)=>object|null} surfaceFn
   */
  step(dt, inp, surfaceFn) {
    const m = CAR.mass;
    const speed = Math.hypot(this.vx, this.vy);
    const sp = clamp(speed / CAR.steerRef, 0, 1);

    // --- steering: speed-sensitive lock, rate-limited so the wheel feels like it has weight ---
    const steerRate = lerp(7, 3, sp);
    this.steer += clamp(inp.steer - this.steer, -steerRate * dt, steerRate * dt);
    const maxSteer = lerp(CAR.steerLo, CAR.steerHi, sp);
    const delta = this.steer * maxSteer;

    // --- drive / nitro ---
    const wantNitro = inp.nitro && this.nitroLeft > 0 && inp.throttle > 0.3;
    this.nitroOn = wantNitro;
    if (wantNitro) this.nitroLeft = Math.max(0, this.nitroLeft - dt / CAR.nitroDur);
    const vTop = wantNitro ? CAR.nitroTop : CAR.vTop;
    const accel = wantNitro ? CAR.nitroAccel : CAR.accel;
    const vxPos = Math.max(this.vx, 0);
    const aDriveRaw = inp.throttle * accel * clamp(1 - (vxPos / vTop) ** 2, -0.25, 1);

    // --- axle loads with longitudinal weight transfer ---
    const L = CAR.L;
    const Fzf = Math.max(m * G * (CAR.b / L) - (m * this.ax * CAR.cgH) / L, 0.2 * m * G * (CAR.b / L));
    const Fzr = Math.max(m * G * (CAR.a / L) + (m * this.ax * CAR.cgH) / L, 0.2 * m * G * (CAR.a / L));
    const grip = this.gripMul;
    const muF = CAR.mu * Fzf * grip;
    const muR = CAR.mu * CAR.rearGripBonus * Fzr * grip;

    // --- slip angles ---
    const vxa = Math.max(Math.abs(this.vx), 1.5);
    const alphaF = Math.atan2(this.vy + CAR.a * this.r, vxa) - delta;
    const alphaR = Math.atan2(this.vy - CAR.b * this.r, vxa);
    this.slipF = alphaF;
    this.slipR = alphaR;
    // arcade traction control: keeps power oversteer catchable instead of an instant spin
    const tcs = inp.hb ? 1 : clamp(1 - (Math.abs(alphaR) - CAR.tcsSlip) / 0.25, 0.2, 1);
    const aDrive = aDriveRaw * tcs;

    // --- tyre forces (saturating) ---
    // brakes: front takes 60% and rear 40%, each limited by its own grip (friction circle)
    const brakeTot = -inp.brake * m * CAR.brakeDecel * (this.vx > 0.2 ? 1 : 0);
    const FxFb = clamp(brakeTot * 0.6, -muF, 0);
    const FxRb = clamp(brakeTot * 0.4, -muR, 0);
    const latCapF = Math.sqrt(Math.max(1e-3, muF * muF - FxFb * FxFb));
    const FyF = -latCapF * Math.tanh((CAR.Cf * alphaF) / latCapF);

    const hbF = inp.hb ? -Math.sign(this.vx || 1) * muR * CAR.hbLock : 0;
    const FxR = clamp(m * aDrive + FxRb + hbF, -muR, muR);
    const latCapR = Math.sqrt(Math.max(1e-3, muR * muR - FxR * FxR)) * (inp.hb ? CAR.hbLatFactor : 1);
    const FyR = -latCapR * Math.tanh((CAR.Cr * alphaR) / latCapR);

    const FxTot = FxR + FxFb - FyF * Math.sin(delta);
    const FyTot = FyF * Math.cos(delta) + FyR;

    // --- rigid-body accelerations (body frame) ---
    const grade = this.grounded ? this.grade : 0;
    const bank = this.grounded ? this.bank : 0;
    const ax = FxTot / m + this.vy * this.r - G * grade;
    const ay = FyTot / m - this.vx * this.r - G * bank;

    // yaw: tyre moment + arcade assist toward the kinematic yaw rate for this steering angle
    const rdotTyre = (CAR.a * FyF * Math.cos(delta) - CAR.b * FyR) / CAR.Iz;
    // kinematic yaw target, capped to what the tyres can actually deliver (~0.95 g)
    const rLimit = ((inp.hb ? 1.5 : 0.95) * G) / Math.max(vxa, 4);
    const rDes = clamp((vxa * delta) / (L + CAR.kUS * vxa * vxa), -rLimit, rLimit);
    const slipMag = Math.abs(alphaR);
    // assist fades with rear slip normally; while handbraking it holds the drift angle instead
    let assist = CAR.assistGain * (inp.hb ? 0.9 : clamp(1 - slipMag / 0.4, 0, 1));
    const rdot = rdotTyre + (rDes - this.r) * assist;

    this.ax = ax;
    this.ay = ay;
    this.latG = FyTot / m / G; // total lateral force / weight, what the driver feels
    this.longG = FxTot / m / G;

    this.vx += ax * dt;
    this.vy += ay * dt;
    this.r += rdot * dt;
    this.r = clamp(this.r, -2.6, 2.6);
    if (this.vx < 0) this.vx = 0;
    this.yaw += this.r * dt;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    this.x += (this.vx * cy - this.vy * sy) * dt;
    this.z += (this.vx * sy + this.vy * cy) * dt;

    // --- road / world interaction ---
    this.wallHit = 0;
    this.landed = 0;
    const surf = surfaceFn(this.x, this.y, this.z, this.sec);
    if (surf) {
      if (!this.grounded) {
        const target = surf.h + CAR.rideH;
        if (this.y <= target && this.vyW <= 0) {
          this.landed = -this.vyW;
          this.vyW = 0;
          this.y = target;
          this.grounded = true;
        }
      }
      this.sec = surf.sec;
      this.s = surf.s;
      this.h = surf.h;
      this.grade = surf.grade;
      this.bank = surf.bank;
      this.lat = surf.lat;
      if (this.grounded) this.y = surf.h + CAR.rideH;
      if (surf.sec) {
        const onShoulder = Math.abs(surf.lat) > ROAD.MEDIAN_HALF + ROAD.CARRIAGE + 0.3;
        this.gripMul = onShoulder ? 0.78 : 1;
        // guard rails (outer) and the central reservation (inner) clamp lateral position
        const lo = ROAD.WALL_LO;
        const hi = ROAD.WALL_HI;
        if (surf.lat < lo || surf.lat > hi) {
          const cl = clamp(surf.lat, lo, hi);
          const p = surf.sec.point(surf.s, cl);
          this.x = p.x;
          this.z = p.z;
          this.lat = cl;
          const into = Math.abs(this.vy) + Math.abs(this.r) * 3;
          this.wallHit = into;
          this.vy *= -0.32;
          this.r *= -0.25;
          this.vx *= 0.9994; // scrape drag: about 7% per second while in contact
        }
      }
    } else {
      this.grounded = false;
      this.sec = null;
      this.gripMul = 1;
    }

    if (!this.grounded) {
      this.vyW -= G * dt;
      this.y += this.vyW * dt;
      if (this.y < -40) this.lost = true;
    }
  }
}
