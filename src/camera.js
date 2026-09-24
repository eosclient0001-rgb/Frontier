// Cameras: chase (gameplay), barrel cam, cinematic attract cam, Unreal-style free fly.
import { M4, V3, clamp, lerp, damp, smoothstep } from './math.js';

// ---- free-fly camera: hold RMB to look, WASD/QE move, Shift fast, wheel speed ----
export class FlyCam {
  constructor() {
    this.pos = V3.make(18, 6, -18);
    this.yaw = 2.5;
    this.pitch = -0.15;
    this.vel = V3.make();
    this.speedMul = 1;
    this.baseSpeed = 15;          // m/s at speedMul 1
    this.fov = 66 * Math.PI / 180;
    this.looking = false;
    this.active = false;
    this.sens = 0.0023;           // rad per pixel
    this._fwd = V3.make();
    this._right = V3.make();
  }

  // adopt the current view pose so entering feels seamless
  seed(pos, look) {
    V3.set(this.pos, pos[0], pos[1], Math.max(pos[1], 0.6));
    const fx = look[0] - pos[0], fy = look[1] - pos[1], fz = look[2] - pos[2];
    const len = Math.hypot(fx, fy, fz) || 1;
    this.pitch = Math.asin(clamp(fy / len, -1, 1));
    this.yaw = Math.atan2(fz, fx);
    V3.set(this.vel, 0, 0, 0);
  }

  forward(out) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    V3.set(out, cp * cy, sp, cp * sy);
    return out;
  }

  attach(canvas) {
    this.canvas = canvas;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 2) return;
      this.looking = true;
      try {
        const r = canvas.requestPointerLock && canvas.requestPointerLock();
        if (r && r.catch) r.catch(() => {});
      } catch (_) { /* pointer lock optional — movementX/Y works without it */ }
    });
    addEventListener('mouseup', (e) => {
      if (e.button !== 2) return;
      this.looking = false;
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch (_) {}
    });
    addEventListener('mousemove', (e) => {
      if (!this.active) return;
      if (!this.looking && document.pointerLockElement !== canvas) return;
      this.yaw += e.movementX * this.sens;
      this.pitch = clamp(this.pitch - e.movementY * this.sens, -1.54, 1.54);
    });
    addEventListener('wheel', (e) => {
      if (!this.active) return;
      this.speedMul = clamp(this.speedMul * (e.deltaY > 0 ? 0.8 : 1.25), 0.05, 12);
    }, { passive: true });
  }

  update(dt, input) {
    const f = this.forward(this._fwd);
    const r = this._right;
    V3.set(r, -Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const dn = (...c) => input.down(...c);
    let mx = 0, my = 0, mz = 0;
    if (dn('KeyW', 'ArrowUp')) { mx += f[0]; my += f[1]; mz += f[2]; }
    if (dn('KeyS', 'ArrowDown')) { mx -= f[0]; my -= f[1]; mz -= f[2]; }
    if (dn('KeyD', 'ArrowRight')) { mx += r[0]; my += r[1]; mz += r[2]; }
    if (dn('KeyA', 'ArrowLeft')) { mx -= r[0]; my -= r[1]; mz -= r[2]; }
    if (dn('KeyE')) my += 1;
    if (dn('KeyQ')) my -= 1;
    const len = Math.hypot(mx, my, mz);
    const boost = dn('ShiftLeft', 'ShiftRight') ? 4.5 : 1;
    const spd = this.baseSpeed * this.speedMul * boost;
    let tx = 0, ty = 0, tz = 0;
    if (len > 1e-6) { tx = (mx / len) * spd; ty = (my / len) * spd; tz = (mz / len) * spd; }
    const lam = 9;
    this.vel[0] = damp(this.vel[0], tx, lam, dt);
    this.vel[1] = damp(this.vel[1], ty, lam, dt);
    this.vel[2] = damp(this.vel[2], tz, lam, dt);
    this.pos[0] += this.vel[0] * dt;
    this.pos[1] += this.vel[1] * dt;
    this.pos[2] += this.vel[2] * dt;
    if (this.pos[1] < 0.5) { this.pos[1] = 0.5; this.vel[1] = Math.max(0, this.vel[1]); }
  }
}

export class Cameras {
  constructor() {
    this.pos = V3.make(0, 5, -10);
    this.look = V3.make(0, 0, 0);
    this.up = V3.make(0, 1, 0);
    this.vp = M4.make();
    this.proj = M4.make();
    this.view = M4.make();
    this.invVP = M4.make();
    this.sunDir = V3.make(0.5, 0.6, 0.2);
    this.mode = 'attract';
    this.fov = 66 * Math.PI / 180;
    this.time = 0;
    this.shake = 0;
    this._e = V3.make(); this._t = V3.make();
    this.fly = new FlyCam();
    this.freeReturn = 'chase';
  }

  setSun(p) {
    const az = p.sunAz, el = p.sunEl;
    // sun low over the sea behind the wave (so the face backlights & glows)
    V3.set(this.sunDir, Math.cos(el) * Math.sin(az) - 0.2, Math.sin(el), -Math.cos(el) * Math.cos(az) - 0.25);
    V3.norm(this.sunDir, this.sunDir);
  }

  cycle() {
    this.mode = this.mode === 'chase' ? 'chase_far' : this.mode === 'chase_far' ? 'barrel' : 'chase';
  }

  enterFree() {
    if (this.mode === 'free') return;
    this.freeReturn = this.mode === 'attract' ? 'attract' : (this.mode || 'chase');
    this.fly.seed(this.pos, this.look);
    this.fly.active = true;
    this.mode = 'free';
  }

  exitFree() {
    if (this.mode !== 'free') return;
    this.mode = this.freeReturn || 'chase';
    this.fly.active = false;
  }

  toggleFree() { if (this.mode === 'free') this.exitFree(); else this.enterFree(); }

  update(dt, t, rider, p, input) {
    this.time = t;
    this.fly.active = this.mode === 'free';
    if (this.mode === 'free') {
      if (input) this.fly.update(dt, input);
      V3.set(this.pos, this.fly.pos[0], this.fly.pos[1], this.fly.pos[2]);
      const f = this.fly.forward(this.fly._fwd);
      V3.set(this.look,
        this.pos[0] + f[0] * 12,
        this.pos[1] + f[1] * 12,
        this.pos[2] + f[2] * 12);
      this.fov = this.fly.fov;
      this.build();
      return;
    }
    const e = this._e, tg = this._t;
    const hx = Math.cos(rider.yaw), hz = Math.sin(rider.yaw);
    // right vector (looking down the line): perpendicular in XZ
    const rx = -hz, rz = hx;
    let fovT = 66 * Math.PI / 180;

    if (this.mode === 'attract') {
      // slow cinematic sweep along the peel, drifting toward the pocket
      const zb = p.zPeel0 + p.vPeel * t;
      const cx = p.xC0 + p.c * t;
      const a = t * 0.13;
      V3.set(e,
        cx + 16 + Math.sin(a) * 9,
        4.5 + Math.sin(a * 0.6) * 1.6,
        zb - 26 + Math.cos(a * 0.8) * 14
      );
      V3.set(tg, cx + 1.5, p.H * 0.55, zb + 4 + Math.sin(a * 0.5) * 6);
      fovT = 58 * Math.PI / 180;
    } else if (this.mode === 'chase') {
      // behind & slightly beachward of the rider, looking down the line
      const dist = 7.5, up = 3.4, lateral = 2.6;
      V3.set(e,
        rider.x - hx * dist + rx * lateral,
        rider.y + up,
        rider.z - hz * dist + rz * lateral
      );
      V3.set(tg,
        rider.x + hx * 9 + rx * 2.5,
        rider.y + 1.6 + smoothstep(0, 1, rider.info ? rider.info.hFrac : 0) * 0.8,
        rider.z + hz * 9 + rz * 2.5
      );
      fovT = (66 + clamp(rider.speed - 6, 0, 6) * 1.6) * Math.PI / 180;
    } else if (this.mode === 'chase_far') {
      const dist = 11, up = 5.2, lateral = 4.0;
      V3.set(e,
        rider.x - hx * dist + rx * lateral,
        rider.y + up,
        rider.z - hz * dist + rz * lateral
      );
      V3.set(tg, rider.x + hx * 7, rider.y + 1.2, rider.z + hz * 7);
      fovT = 60 * Math.PI / 180;
    } else if (this.mode === 'barrel') {
      // from the flats, up-face into the tube — the money shot
      V3.set(e,
        rider.x + rx * 1.0 + hx * -1.5,
        rider.y + 0.6,
        rider.z - 4.5
      );
      V3.set(tg, rider.x - 0.8, rider.y + 1.2, rider.z + 2.5);
      fovT = 74 * Math.PI / 180;
    }

    // smooth follow (skip smoothing in attract so the sweep is steady)
    const lam = this.mode === 'attract' ? 30 : 6.5;
    this.pos[0] = damp(this.pos[0], e[0], lam, dt);
    this.pos[1] = damp(this.pos[1], e[1], lam, dt);
    this.pos[2] = damp(this.pos[2], e[2], lam, dt);
    this.look[0] = damp(this.look[0], tg[0], lam * 1.4, dt);
    this.look[1] = damp(this.look[1], tg[1], lam * 1.4, dt);
    this.look[2] = damp(this.look[2], tg[2], lam * 1.4, dt);
    this.fov = damp(this.fov, fovT, 4, dt);

    // shake (lip impacts)
    this.shake = Math.max(0, this.shake - dt * 2.4);
    if (this.shake > 0) {
      const s = this.shake * 0.3;
      this.pos[0] += (Math.random() - 0.5) * s;
      this.pos[1] += (Math.random() - 0.5) * s;
    }

    this.build();
  }

  build() {
    M4.perspective(this.proj, this.fov, aspectGlobal, 0.1, 900);
    M4.lookAt(this.view, this.pos, this.look, this.up);
    M4.mul(this.vp, this.proj, this.view);
    // invVP for sky ray reconstruction (invert 4x4 — tiny M4 inverse)
    invert4(this.invVP, this.vp);
  }
}

export let aspectGlobal = 16 / 9;
export function setAspect(a) { aspectGlobal = a; }

function invert4(out, m) {
  // general 4x4 inverse (adjugate) — small and cheap enough per frame
  const inv = out;
  inv[0] = m[5]*m[10]*m[15] - m[5]*m[11]*m[14] - m[9]*m[6]*m[15] + m[9]*m[7]*m[14] + m[13]*m[6]*m[11] - m[13]*m[7]*m[10];
  inv[4] = -m[4]*m[10]*m[15] + m[4]*m[11]*m[14] + m[8]*m[6]*m[15] - m[8]*m[7]*m[14] - m[12]*m[6]*m[11] + m[12]*m[7]*m[10];
  inv[8] = m[4]*m[9]*m[15] - m[4]*m[11]*m[13] - m[8]*m[5]*m[15] + m[8]*m[7]*m[13] + m[12]*m[5]*m[11] - m[12]*m[7]*m[9];
  inv[12] = -m[4]*m[9]*m[14] + m[4]*m[10]*m[13] + m[8]*m[5]*m[14] - m[8]*m[6]*m[13] - m[12]*m[5]*m[10] + m[12]*m[6]*m[9];
  inv[1] = -m[1]*m[10]*m[15] + m[1]*m[11]*m[14] + m[9]*m[2]*m[15] - m[9]*m[3]*m[14] - m[13]*m[2]*m[11] + m[13]*m[3]*m[10];
  inv[5] = m[0]*m[10]*m[15] - m[0]*m[11]*m[14] - m[8]*m[2]*m[15] + m[8]*m[3]*m[14] + m[12]*m[2]*m[11] - m[12]*m[3]*m[10];
  inv[9] = -m[0]*m[9]*m[15] + m[0]*m[11]*m[13] + m[8]*m[1]*m[15] - m[8]*m[3]*m[13] - m[12]*m[1]*m[11] + m[12]*m[3]*m[9];
  inv[13] = m[0]*m[9]*m[14] - m[0]*m[10]*m[13] - m[8]*m[1]*m[14] + m[8]*m[2]*m[13] + m[12]*m[1]*m[10] - m[12]*m[2]*m[9];
  inv[2] = m[1]*m[6]*m[15] - m[1]*m[7]*m[14] - m[5]*m[2]*m[15] + m[5]*m[3]*m[14] + m[13]*m[2]*m[7] - m[13]*m[3]*m[6];
  inv[6] = -m[0]*m[6]*m[15] + m[0]*m[7]*m[14] + m[4]*m[2]*m[15] - m[4]*m[3]*m[14] - m[12]*m[2]*m[7] + m[12]*m[3]*m[6];
  inv[10] = m[0]*m[5]*m[15] - m[0]*m[7]*m[13] - m[4]*m[1]*m[15] + m[4]*m[3]*m[13] + m[12]*m[1]*m[7] - m[12]*m[3]*m[5];
  inv[14] = -m[0]*m[5]*m[14] + m[0]*m[6]*m[13] + m[4]*m[1]*m[14] - m[4]*m[2]*m[13] - m[12]*m[1]*m[6] + m[12]*m[2]*m[5];
  inv[3] = -m[1]*m[6]*m[11] + m[1]*m[7]*m[10] + m[5]*m[2]*m[11] - m[5]*m[3]*m[10] - m[9]*m[2]*m[7] + m[9]*m[3]*m[6];
  inv[7] = m[0]*m[6]*m[11] - m[0]*m[7]*m[10] - m[4]*m[2]*m[11] + m[4]*m[3]*m[10] + m[8]*m[2]*m[7] - m[8]*m[3]*m[6];
  inv[11] = -m[0]*m[5]*m[11] + m[0]*m[7]*m[9] + m[4]*m[1]*m[11] - m[4]*m[3]*m[9] - m[8]*m[1]*m[7] + m[8]*m[3]*m[5];
  inv[15] = m[0]*m[5]*m[10] - m[0]*m[6]*m[9] - m[4]*m[1]*m[10] + m[4]*m[2]*m[9] + m[8]*m[1]*m[6] - m[8]*m[2]*m[5];
  let det = m[0]*inv[0] + m[1]*inv[4] + m[2]*inv[8] + m[3]*inv[12];
  det = det ? 1 / det : 1;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}
