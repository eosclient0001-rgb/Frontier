/**
 * Frontier Terrain Forge — viewport camera.
 *
 * Orbit camera with the conventions the terrain shaders assume: X and Z are the
 * ground plane (uv.x → +X, uv.y → +Z), Y is elevation in metres. Sun direction is
 * derived from the same azimuth/elevation the UI exposes, so rotating the light
 * and looking at the terrain stay consistent.
 */
import { clamp, degToRad, lookAt, multiply, orthographic, perspective } from './mat4.js';

const MIN_PITCH = degToRad(-2);
const MAX_PITCH = degToRad(88);

export class Camera {
  constructor(options = {}) {
    this.target = [0, (options.heightScale ?? 900) * 0.15, 0];
    this.distance = (options.worldSize ?? 4096) * 0.75;
    this.yaw = degToRad(132);
    this.pitch = degToRad(26);
    this.fov = degToRad(options.fov ?? 42);
    this.near = 1;
    this.far = (options.worldSize ?? 4096) * 12;
    this.mode = 'perspective';
    this._view = new Float32Array(16);
    this._proj = new Float32Array(16);
    this._viewProj = new Float32Array(16);
    this._invViewProj = new Float32Array(16);
  }

  get position() {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + Math.sin(this.yaw) * cp * this.distance,
      this.target[1] + Math.sin(this.pitch) * this.distance,
      this.target[2] + Math.cos(this.yaw) * cp * this.distance,
    ];
  }

  frame(world, heightScale = world.heightScale ?? 900) {
    const extent = Math.max(world.worldSize, world.worldSize * 0.35);
    this.target = [0, heightScale * 0.22, 0];
    this.distance = extent * 0.95;
    this.pitch = degToRad(26);
    this.far = Math.max(this.distance * 8, world.worldSize * 6);
    return this;
  }

  orbit(dx, dy) {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch + dy, MIN_PITCH, MAX_PITCH);
  }

  zoom(factor) {
    this.distance = clamp(this.distance * factor, 4, 200000);
  }

  /** Drag on the ground plane, scaled by distance so it feels consistent. */
  pan(dx, dy, aspect) {
    const scale = this.distance * 0.9;
    const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    const forward = [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)];
    this.target[0] -= (right[0] * dx - forward[0] * dy * (1 / Math.max(aspect, 1e-3))) * scale;
    this.target[2] -= (right[2] * dx - forward[2] * dy * (1 / Math.max(aspect, 1e-3))) * scale;
    return this;
  }

  matrices(aspect, world) {
    const eye = this.position;
    const up = Math.abs(Math.sin(this.pitch)) > 0.995 ? [0, 0, 1] : [0, 1, 0];
    lookAt(eye, this.target, up, this._view);
    if (this.mode === 'orthographic') {
      const half = this.distance * 0.62;
      orthographic(-half * aspect, half * aspect, -half, half, 0.1, this.far, this._proj);
    } else {
      perspective(this.fov, aspect, this.near, Math.max(this.far, world?.worldSize * 4 ?? this.far), this._proj);
    }
    multiply(this._proj, this._view, this._viewProj);
    return { view: this._view, proj: this._proj, viewProj: this._viewProj, eye };
  }

  /** Unit vector pointing from the terrain toward the sun. */
  static sunDirection(azimuthDeg, elevationDeg) {
    const az = degToRad(azimuthDeg);
    const el = degToRad(clamp(elevationDeg, 0.5, 89));
    const dir = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    return [dir[0] / len, dir[1] / len, dir[2] / len];
  }

  /**
   * Sun-space orthographic matrices covering the terrain, used by the shadow
   * pass. The depth range is derived from the terrain's own bounds so a 900 m
   * massif and a 40 m dune field both get the full 24-bit precision of the map.
   */
  static lightMatrices(sunDir, world) {
    const heightScale = world.heightScale ?? 900;
    const worldSize = world.worldSize ?? 4096;
    const center = [0, heightScale * 0.4, 0];
    const distance = worldSize * 0.75 + heightScale * 2;
    const eye = [
      center[0] + sunDir[0] * distance,
      center[1] + sunDir[1] * distance,
      center[2] + sunDir[2] * distance,
    ];
    const up = Math.abs(sunDir[1]) > 0.995 ? [0, 0, 1] : [0, 1, 0];
    const view = lookAt(eye, center, up);
    const half = worldSize * 0.72;
    const proj = orthographic(-half, half, -half, half, 1, distance + worldSize * 1.5 + heightScale * 2);
    return { viewProj: multiply(proj, view), halfExtent: half, distance };
  }
}
