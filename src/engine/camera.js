// Orbit camera with the control scheme terrain editors are expected to have: left drag orbits,
// middle or right drag pans, wheel dollies, and the whole thing is framerate independent because
// damping is applied on a fixed exponential curve rather than per-frame lerps.

import { mat4, perspective, lookAt, multiply, invert, clamp } from './mat4.js';

const MIN_PITCH = -1.45;
const MAX_PITCH = 1.5;

export class OrbitCamera {
  constructor() {
    this.target = [0, 260, 0];
    this.distance = 5200;
    this.yaw = 0.6;
    this.pitch = 0.42;
    this.fov = 52 * (Math.PI / 180);
    this.near = 1.5;
    this.far = 60000;

    this._goalTarget = [...this.target];
    this._goalDistance = this.distance;
    this._goalYaw = this.yaw;
    this._goalPitch = this.pitch;

    this.position = [0, 0, 0];
    this.view = mat4();
    this.proj = mat4();
    this.viewProj = mat4();
    this.invViewProj = mat4();

    this._dragging = 0;
    this._last = [0, 0];
    this._keys = new Set();
    this._pointer = null;
  }

  attach(element) {
    this.element = element;
    const el = element;

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this._dragging = e.button === 0 && !e.shiftKey ? 1 : 2;
      this._last = [e.clientX, e.clientY];
      e.preventDefault();
    });
    el.addEventListener('pointerup', (e) => {
      this._dragging = 0;
      try { el.releasePointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    });
    el.addEventListener('pointercancel', () => { this._dragging = 0; });
    el.addEventListener('pointermove', (e) => {
      const dx = e.clientX - this._last[0];
      const dy = e.clientY - this._last[1];
      this._last = [e.clientX, e.clientY];
      if (this._dragging === 1) {
        this.orbit(dx, dy);
      } else if (this._dragging === 2) {
        this.pan(dx, dy);
      } else {
        this._pointer = [e.clientX, e.clientY];
      }
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dolly(e.deltaY);
    }, { passive: false });

    el.addEventListener('dblclick', (e) => {
      // Double click re-centres on whatever is under the cursor.
      const rect = el.getBoundingClientRect();
      this.focusAt(((e.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((e.clientY - rect.top) / rect.height) * 2);
    });

    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      this._keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this._keys.delete(e.code));
    window.addEventListener('blur', () => this._keys.clear());
  }

  // Screen-space input, separated from the event handlers so anything can drive the camera.
  orbit(dx, dy) {
    this._goalYaw -= dx * 0.0055;
    this._goalPitch = clamp(this._goalPitch + dy * 0.0045, MIN_PITCH, MAX_PITCH);
  }

  dolly(deltaY) {
    this._goalDistance = clamp(this._goalDistance * Math.exp(deltaY * 0.0012), 8, 90000);
  }

  pan(dx, dy) {
    const scale = this.distance * 0.0016;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    // Screen right and screen up projected onto the ground plane.
    this._goalTarget[0] -= (cy * dx - sy * dy * 0.6) * scale;
    this._goalTarget[2] -= (sy * dx + cy * dy * 0.6) * scale;
  }

  focusAt(ndcX, ndcY) {
    // Aim the orbit target at the point under the cursor by walking a ray until it meets the
    // ground plane at the target's height.
    const dir = this.rayDirection(ndcX, ndcY);
    if (dir[1] >= -0.02) return;
    const t = (this._goalTarget[1] - this.position[1]) / dir[1];
    if (t <= 0 || t > 200000) return;
    this._goalTarget = [
      this.position[0] + dir[0] * t,
      this._goalTarget[1],
      this.position[2] + dir[2] * t,
    ];
    this._goalDistance = Math.min(this._goalDistance, Math.max(40, t * 0.8));
  }

  rayDirection(ndcX, ndcY) {
    const inv = this.invViewProj;
    const x = inv[0] * ndcX + inv[4] * ndcY + inv[8] * 1 + inv[12];
    const y = inv[1] * ndcX + inv[5] * ndcY + inv[9] * 1 + inv[13];
    const z = inv[2] * ndcX + inv[6] * ndcY + inv[10] * 1 + inv[14];
    const w = inv[3] * ndcX + inv[7] * ndcY + inv[11] * 1 + inv[15] || 1;
    const px = x / w - this.position[0];
    const py = y / w - this.position[1];
    const pz = z / w - this.position[2];
    const len = Math.hypot(px, py, pz) || 1;
    return [px / len, py / len, pz / len];
  }

  setTarget(x, y, z) {
    this._goalTarget = [x, y, z];
    this.target = [x, y, z];
  }

  frame(extent, heightMeters) {
    this._goalTarget = [0, heightMeters * 0.25, 0];
    this._goalDistance = extent * 1.35;
    this._goalYaw = 0.6;
    this._goalPitch = 0.42;
  }

  update(dt, groundHeight) {
    const k = 1 - Math.exp(-dt * 12);
    this.target[0] += (this._goalTarget[0] - this.target[0]) * k;
    this.target[1] += (this._goalTarget[1] - this.target[1]) * k;
    this.target[2] += (this._goalTarget[2] - this.target[2]) * k;
    this.distance += (this._goalDistance - this.distance) * k;
    this.yaw += (this._goalYaw - this.yaw) * k;
    this.pitch += (this._goalPitch - this.pitch) * k;

    // Keyboard fly: WASD moves the focus point, QE changes height.
    if (this._keys.size) {
      const speed = this.distance * dt * 0.9;
      let fx = 0;
      let fz = 0;
      if (this._keys.has('KeyW')) fz += 1;
      if (this._keys.has('KeyS')) fz -= 1;
      if (this._keys.has('KeyA')) fx -= 1;
      if (this._keys.has('KeyD')) fx += 1;
      if (fx || fz) {
        const cy = Math.cos(this.yaw);
        const sy = Math.sin(this.yaw);
        this._goalTarget[0] += (fx * cy + fz * sy) * speed;
        this._goalTarget[2] += (fx * sy - fz * cy) * speed;
      }
      if (this._keys.has('KeyQ')) this._goalTarget[1] += speed * 0.6;
      if (this._keys.has('KeyE')) this._goalTarget[1] -= speed * 0.6;
      if (this._keys.has('KeyR')) this._goalDistance = clamp(this._goalDistance * (1 - dt), 8, 90000);
      if (this._keys.has('KeyF')) this._goalDistance = clamp(this._goalDistance * (1 + dt), 8, 90000);
    }

    // Keep the eye above the ground so the camera never sinks into the terrain.
    const cy = Math.cos(this.pitch);
    this.position[0] = this.target[0] - Math.sin(this.yaw) * cy * this.distance;
    this.position[1] = this.target[1] + Math.sin(this.pitch) * this.distance;
    this.position[2] = this.target[2] + Math.cos(this.yaw) * cy * this.distance;
    if (groundHeight !== undefined) {
      const floor = groundHeight + Math.max(2, this.distance * 0.004);
      if (this.position[1] < floor) this.position[1] = floor;
    }

    const dist = Math.max(this.distance, 1);
    this.near = clamp(dist * 0.002, 0.25, 200);
    this.far = Math.max(dist * 12, 12000);

    lookAt(this.view, this.position, this.target, [0, 1, 0]);
    const aspect = this.aspect || 1.6;
    perspective(this.proj, this.fov, aspect, this.near, this.far);
    multiply(this.viewProj, this.proj, this.view);
    invert(this.invViewProj, this.viewProj);
  }
}
