/**
 * Unreal-style fly navigation, layered on top of OrbitControls.
 *
 * - Hold RIGHT mouse + move: look around (yaw/pitch from current position)
 * - W/S or Up/Down: fly forward/back along the view direction
 * - A/D or Left/Right: strafe
 * - E/Q: move up/down (world axis)
 * - Shift: 4x boost
 * - Mouse wheel WHILE looking: adjust fly speed (persisted to view state)
 *
 * OrbitControls stays active for left-drag orbit / wheel dolly / pan; the two
 * cooperate by moving the orbit target along with the camera.
 */
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class FlyControls {
  speed = 20;
  rotSpeed = 0.0032;
  boost = 4;
  onSpeedChange: ((v: number) => void) | null = null;

  private keys = new Set<string>();
  private looking = false;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private hint: HTMLElement | null = null;
  private _dir = new THREE.Vector3();
  private _right = new THREE.Vector3();
  private _up = new THREE.Vector3(0, 1, 0);
  private _mv = new THREE.Vector3();
  private _eu = new THREE.Euler();

  constructor(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    this.camera = camera;
    this.controls = controls;
    window.addEventListener('keydown', (e) => {
      const t = (e.target as HTMLElement | null)?.tagName;
      if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  attach(canvas: HTMLCanvasElement): void {
    const wrap = canvas.parentElement!;
    this.hint = document.createElement('div');
    this.hint.className = 'fly-hint';
    wrap.appendChild(this.hint);
    this.refreshHint();

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2) {
        this.looking = true;
        this.controls.enabled = false; // also blocks orbit's wheel-dolly
        try { canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.looking) return;
      this._eu.setFromQuaternion(this.camera.quaternion, 'YXZ');
      this._eu.y -= e.movementX * this.rotSpeed;
      this._eu.x -= e.movementY * this.rotSpeed;
      this._eu.x = Math.max(-1.55, Math.min(1.55, this._eu.x));
      this._eu.z = 0;
      this.camera.quaternion.setFromEuler(this._eu);
      // Keep the orbit target ahead of the camera so orbiting stays coherent.
      const dist = this.camera.position.distanceTo(this.controls.target);
      this.camera.getWorldDirection(this._dir);
      this.controls.target.copy(this.camera.position)
        .addScaledVector(this._dir, Math.max(dist, 0.5));
    });
    const end = (e: PointerEvent) => {
      if (e.button === 2) this.looking = false;
      // Only re-enable orbit when NO button is held (paint stroke may be active).
      if (e.buttons === 0) this.controls.enabled = true;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    // Wheel adjusts fly speed while looking (orbit zoom is disabled then).
    canvas.addEventListener('wheel', (e) => {
      if (!this.looking) return;
      e.preventDefault();
      this.setSpeed(this.speed * Math.exp(-e.deltaY * 0.0012));
    }, { passive: false });
  }

  /** External sync (e.g. UI slider) without firing the change callback. */
  syncSpeed(v: number): void {
    this.speed = Math.max(1, Math.min(150, v));
    this.refreshHint();
  }

  setSpeed(v: number): void {
    this.syncSpeed(v);
    this.onSpeedChange?.(this.speed);
  }

  private refreshHint(): void {
    if (this.hint) {
      this.hint.textContent =
        `RMB-look · WASD fly · Q/E down/up · Shift ×4 · wheel speed ${this.speed.toFixed(0)} · dbl-click focus`;
    }
  }

  update(dt: number): void {
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - ((k.has('KeyS') || k.has('ArrowDown')) ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - ((k.has('KeyA') || k.has('ArrowLeft')) ? 1 : 0);
    const u = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    if (!f && !r && !u) return;
    const mul = (k.has('ShiftLeft') || k.has('ShiftRight')) ? this.boost : 1;
    const step = this.speed * mul * Math.min(dt, 0.05);
    this.camera.getWorldDirection(this._dir);
    this._right.crossVectors(this._dir, this.camera.up).normalize();
    this._mv.set(0, 0, 0)
      .addScaledVector(this._dir, f * step)
      .addScaledVector(this._right, r * step)
      .addScaledVector(this._up, u * step);
    this.camera.position.add(this._mv);
    this.controls.target.add(this._mv);
  }
}
