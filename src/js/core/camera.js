// Orbit + fly camera with inertial damping.

import { clamp, DEG } from './math.js';

export class Camera {
  constructor() {
    this.target = [0, 120, 0];
    this.distance = 3400;
    this.azimuth = 0.7;
    this.elevation = 0.38;
    this.fov = 50 * DEG;
    this.near = 1.5;
    this.far = 60000;
    this.eye = [0, 0, 0];
    this.fly = false;
    this.vel = [0, 0, 0];
    this.keys = new Set();
    this.dirty = true;
  }

  frame(worldSize, heightScale) {
    this.distance = worldSize * 0.82;
    this.target = [0, heightScale * 0.28, 0];
    this.far = worldSize * 8;
    this.dirty = true;
  }

  update(dt) {
    if (this.fly) {
      const speed = (this.keys.has('shift') ? 900 : 260) * dt;
      const f = [
        Math.cos(this.azimuth) * Math.cos(this.elevation),
        Math.sin(this.elevation),
        Math.sin(this.azimuth) * Math.cos(this.elevation),
      ];
      const right = [Math.cos(this.azimuth + Math.PI / 2), 0, Math.sin(this.azimuth + Math.PI / 2)];
      let mx = 0, my = 0, mz = 0;
      if (this.keys.has('w')) { mx += f[0]; my += f[1]; mz += f[2]; }
      if (this.keys.has('s')) { mx -= f[0]; my -= f[1]; mz -= f[2]; }
      if (this.keys.has('d')) { mx += right[0]; mz += right[2]; }
      if (this.keys.has('a')) { mx -= right[0]; mz -= right[2]; }
      if (this.keys.has('e')) my += 1;
      if (this.keys.has('q')) my -= 1;
      const l = Math.hypot(mx, my, mz) || 1;
      this.target[0] += (mx / l) * speed;
      this.target[1] += (my / l) * speed;
      this.target[2] += (mz / l) * speed;
    }
    const ce = Math.cos(this.elevation), se = Math.sin(this.elevation);
    if (this.fly) {
      this.eye[0] = this.target[0];
      this.eye[1] = this.target[1];
      this.eye[2] = this.target[2];
    } else {
      this.eye[0] = this.target[0] + Math.cos(this.azimuth) * ce * this.distance;
      this.eye[1] = this.target[1] + se * this.distance;
      this.eye[2] = this.target[2] + Math.sin(this.azimuth) * ce * this.distance;
    }
  }

  attach(el, onChange) {
    let dragging = 0;
    let lx = 0, ly = 0;
    const onDown = (e) => {
      dragging = e.button === 2 || e.shiftKey ? 2 : 1;
      lx = e.clientX; ly = e.clientY;
      el.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (dragging === 2 || (this.fly && dragging === 1)) {
        this.azimuth -= dx * 0.0055;
        this.elevation = clamp(this.elevation + (this.fly ? dy : -dy) * 0.0045, -1.45, 1.52);
      } else {
        this.azimuth += dx * 0.0055;
        this.elevation = clamp(this.elevation - dy * 0.0045, -1.45, 1.52);
      }
      this.dirty = true;
      onChange?.();
    };
    const onUp = (e) => { dragging = 0; el.releasePointerCapture?.(e.pointerId); };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = Math.exp(e.deltaY * 0.0012);
      if (this.fly) {
        this.distance = clamp(this.distance * k, 1, 100000);
      } else {
        this.distance = clamp(this.distance * k, 20, this.far * 0.6);
      }
      this.dirty = true;
      onChange?.();
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'shift') this.keys.add('shift');
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
      if (!e.shiftKey) this.keys.delete('shift');
    });
  }
}
