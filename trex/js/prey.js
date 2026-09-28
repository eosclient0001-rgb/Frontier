/**
 * prey.js — The ball the T. rex hunts.
 *
 * Physics: gravity, ground bounce, rolling friction, knock-back impulses.
 * Modes:
 *   'drag' — stays where you put it (drag / throw it with the mouse)
 *   'flee' — runs away when the T. rex gets close, with limited stamina
 *            (sprints, tires, jinks sideways) so the chase can be won.
 */
import { Vector3 } from 'three';

const G = 9.81;

export class Prey {
  constructor(opts = {}) {
    this.radius = opts.radius ?? 0.45;
    this.pos = new Vector3(0, this.radius, -9);
    this.vel = new Vector3();
    this.held = false;          // in the jaws
    this.dragging = false;      // held by the user's mouse
    this.mode = 'drag';
    this.stamina = 1;
    this.stunned = 0;           // seconds of no-flee after being hit
    this.jink = 0; this.jinkT = 0;
    this.bounds = opts.bounds ?? 55;
    this.roll = new Vector3();  // accumulated rolling rotation (for the mesh)
  }

  knock(stun = 2.5) { this.stunned = stun; }

  update(dt, hunterPos) {
    if (this.held || this.dragging) return;
    this.stunned = Math.max(0, this.stunned - dt);

    const onGround = this.pos.y <= this.radius + 0.02;
    if (this.mode === 'flee' && hunterPos && onGround && this.stunned <= 0) this._flee(dt, hunterPos);

    // integrate
    this.vel.y -= G * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y < this.radius) {
      this.pos.y = this.radius;
      if (this.vel.y < -1.2) this.vel.y *= -0.42; else this.vel.y = 0;
      const f = Math.exp(-dt * (this.mode === 'flee' && this.stunned <= 0 ? 0.6 : 1.6));
      this.vel.x *= f; this.vel.z *= f;
    }
    // soft arena wall
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > this.bounds) {
      const nx = this.pos.x / r, nz = this.pos.z / r;
      this.pos.x = nx * this.bounds; this.pos.z = nz * this.bounds;
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn > 0) { this.vel.x -= 1.6 * vn * nx; this.vel.z -= 1.6 * vn * nz; }
    }
    // rolling (visual): angular displacement = distance / radius
    this.roll.x += (-this.vel.z * dt) / this.radius;
    this.roll.z += (this.vel.x * dt) / this.radius;
  }

  _flee(dt, hunterPos) {
    const away = new Vector3(this.pos.x - hunterPos.x, 0, this.pos.z - hunterPos.z);
    const d = away.length();
    if (d > 16) { this.stamina = Math.min(1, this.stamina + dt * 0.25); return; }
    away.normalize();
    // steer back towards the middle near the arena edge
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > this.bounds * 0.7) {
      const toC = new Vector3(-this.pos.x, 0, -this.pos.z).normalize();
      away.lerp(toC, Math.min(1, (r - this.bounds * 0.7) / (this.bounds * 0.25))).normalize();
    }
    // jinks: random sideways cuts
    this.jinkT -= dt;
    if (this.jinkT <= 0) { this.jink = (Math.random() * 2 - 1) * 0.9; this.jinkT = 0.8 + Math.random() * 1.6; }
    const side = new Vector3(-away.z, 0, away.x);
    const dir = away.addScaledVector(side, this.jink).normalize();
    // stamina: sprint 4.8 m/s when fresh, 1.4 m/s when exhausted
    const urgency = Math.min(1, (16 - d) / 10);
    this.stamina = Math.max(0, this.stamina - dt * 0.18 * urgency);
    if (this.stamina < 0.05) this.stamina = Math.min(1, this.stamina + dt * 0.02);
    const want = (1.4 + 3.4 * Math.pow(this.stamina, 0.6)) * urgency;
    const vx = dir.x * want, vz = dir.z * want;
    const k = 1 - Math.exp(-dt * 3);
    this.vel.x += (vx - this.vel.x) * k;
    this.vel.z += (vz - this.vel.z) * k;
  }
}
