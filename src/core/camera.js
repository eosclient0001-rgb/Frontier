// Frontier Road Editor — Unreal-style fly camera (WASD + right-drag look)
import * as THREE from 'three';
import { clamp } from './util.js';

export class FlyCam {
  constructor(camera, dom) {
    this.cam = camera;
    this.dom = dom;
    this.pos = new THREE.Vector3(260, 190, 420);
    this.yaw = Math.PI * 0.8;   // looking toward origin-ish
    this.pitch = -0.5;
    this.speed = 42;            // m/s base
    this.keys = new Set();
    this.looking = false;
    this._bind();
  }

  _bind() {
    const d = this.dom;
    d.addEventListener('contextmenu', e => e.preventDefault());
    d.addEventListener('pointerdown', e => {
      if (e.button === 2) { this.looking = true; d.setPointerCapture(e.pointerId); }
    });
    d.addEventListener('pointerup', e => {
      if (e.button === 2) this.looking = false;
    });
    d.addEventListener('pointermove', e => {
      if (!this.looking) return;
      this.yaw -= e.movementX * 0.0032;
      this.pitch = clamp(this.pitch - e.movementY * 0.0028, -1.52, 1.52);
    });
    d.addEventListener('wheel', e => {
      this.speed = clamp(this.speed * (e.deltaY > 0 ? 0.86 : 1.16), 3, 900);
    }, { passive: true });
    window.addEventListener('keydown', e => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.looking = false; });
  }

  get forward() {
    return new THREE.Vector3(
      Math.cos(this.pitch) * Math.sin(this.yaw),
      Math.sin(this.pitch),
      Math.cos(this.pitch) * Math.cos(this.yaw),
    );
  }

  focusOn(p, dist = 160) {
    this.pos.set(p.x + dist * 0.5, Math.max(60, p.y + dist * 0.55), p.z + dist * 0.72);
    const dir = new THREE.Vector3(p.x - this.pos.x, p.y - this.pos.y, p.z - this.pos.z);
    this.yaw = Math.atan2(dir.x, dir.z);
    this.pitch = Math.asin(clamp(dir.y / dir.length(), -1, 1));
  }

  topDown(center, height = 1400) {
    this.pos.set(center.x, height, center.z + 0.01);
    this.pitch = -1.52;
  }

  update(dt) {
    const k = this.keys;
    const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 4.5 : 1;
    const v = this.speed * boost * dt;
    const look = this.forward;
    const fwd = new THREE.Vector3(look.x, 0, look.z).normalize(); // horizontal travel dir
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);            // cross(fwd, up) → true right
    if (k.has('KeyW')) this.pos.addScaledVector(look, v);
    if (k.has('KeyS')) this.pos.addScaledVector(look, -v);
    if (k.has('KeyA')) this.pos.addScaledVector(right, -v);
    if (k.has('KeyD')) this.pos.addScaledVector(right, v);
    if (k.has('KeyE') || k.has('Space')) this.pos.y += v;
    if (k.has('KeyQ')) this.pos.y -= v;
    if (this.pos.y < 1.2) this.pos.y = 1.2;
    this.cam.position.copy(this.pos);
    const t = this.pos.clone().add(look);
    this.cam.lookAt(t);
  }
}
