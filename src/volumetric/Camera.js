import { lookAt, multiply, perspective, invert, transformPoint } from '../gpu/mat4.js';

/**
 * Orbit camera with inertial damping, optional idle auto-rotation and
 * ray picking into the simulation volume (click to detonate).
 */
export class OrbitCamera {
  constructor(options = {}) {
    const o = {
      target: [0, 1.6, 0],
      distance: 7.5,
      yaw: 0.62,
      pitch: 0.24,
      fov: 45,
      near: 0.05,
      far: 200,
      minDistance: 1.5,
      maxDistance: 40,
      autoRotate: true,
      autoRotateSpeed: 0.06,
      autoRotateDelay: 4.0,
      ...options,
    };
    this.minDistance = o.minDistance;
    this.maxDistance = o.maxDistance;
    this.fov = (o.fov * Math.PI) / 180;
    this.near = o.near;
    this.far = o.far;
    this.autoRotate = o.autoRotate;
    this.autoRotateSpeed = o.autoRotateSpeed;
    this.autoRotateDelay = o.autoRotateDelay;

    this.target = [...o.target];
    this.desiredTarget = [...o.target];
    this.distance = o.distance;
    this.desiredDistance = o.distance;
    this.yaw = o.yaw;
    this.desiredYaw = o.yaw;
    this.pitch = o.pitch;
    this.desiredPitch = o.pitch;

    this.aspect = 16 / 9;
    this.idleTime = 0;
    this.eye = [0, 0, 0];
    this.view = new Float32Array(16);
    this.proj = new Float32Array(16);
    this.viewProj = new Float32Array(16);
    this.invViewProj = new Float32Array(16);
    this.forward = [0, 0, -1];
    this.right = [1, 0, 0];
    this.up = [0, 1, 0];
    this._updateMatrices();
  }

  setTarget(t) {
    this.target = [...t];
    this.desiredTarget = [...t];
  }

  frame(radius, center) {
    this.setTarget(center);
    this.desiredDistance = Math.max(this.minDistance, radius * 2.6);
  }

  _updateMatrices() {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    this.eye = [
      this.target[0] + this.distance * cp * sy,
      this.target[1] + this.distance * sp,
      this.target[2] + this.distance * cp * cy,
    ];
    lookAt(this.view, this.eye, this.target, [0, 1, 0]);
    perspective(this.proj, this.fov, this.aspect, this.near, this.far);
    multiply(this.viewProj, this.proj, this.view);
    invert(this.invViewProj, this.viewProj);

    // camera basis (for panning + picking)
    const f = [
      this.target[0] - this.eye[0],
      this.target[1] - this.eye[1],
      this.target[2] - this.eye[2],
    ];
    const fl = Math.hypot(f[0], f[1], f[2]) || 1;
    this.forward = [f[0] / fl, f[1] / fl, f[2] / fl];

    // right = normalize(cross(forward, worldUp)), worldUp = (0,1,0)
    const rx = this.forward[2];
    const ry = 0;
    const rz = -this.forward[0];
    const rl = Math.hypot(rx, ry, rz) || 1;
    this.right = [rx / rl, ry / rl, rz / rl];

    // up = cross(right, forward)
    this.up = [
      this.right[1] * this.forward[2] - this.right[2] * this.forward[1],
      this.right[2] * this.forward[0] - this.right[0] * this.forward[2],
      this.right[0] * this.forward[1] - this.right[1] * this.forward[0],
    ];
  }

  update(dt) {
    if (this.idleTime > this.autoRotateDelay && this.autoRotate) {
      this.desiredYaw += dt * this.autoRotateSpeed;
    }
    this.idleTime += dt;

    const k = 1 - Math.exp(-dt * 9);
    this.yaw += (this.desiredYaw - this.yaw) * k;
    this.pitch += (this.desiredPitch - this.pitch) * k;
    this.distance += (this.desiredDistance - this.distance) * k;
    for (let i = 0; i < 3; i += 1) {
      this.target[i] += (this.desiredTarget[i] - this.target[i]) * k;
    }
    this._updateMatrices();
  }

  orbit(dx, dy) {
    this.desiredYaw -= dx * 0.0055;
    this.desiredPitch = Math.max(-1.35, Math.min(1.45, this.desiredPitch + dy * 0.0045));
    this.idleTime = 0;
  }

  dolly(amount) {
    this.desiredDistance = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this.desiredDistance * Math.exp(amount * 0.0016))
    );
    this.idleTime = 0;
  }

  pan(dx, dy) {
    const scale = this.distance * 0.0016;
    for (let i = 0; i < 3; i += 1) {
      this.desiredTarget[i] += (-this.right[i] * dx + this.up[i] * dy) * scale;
    }
    this.idleTime = 0;
  }

  /** World-space ray for a normalised device coordinate. */
  ray(ndcX, ndcY) {
    const near = transformPoint([0, 0, 0], this.invViewProj, [ndcX, ndcY, 0]);
    const far = transformPoint([0, 0, 0], this.invViewProj, [ndcX, ndcY, 1]);
    const dir = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    return { origin: [...this.eye], direction: [dir[0] / len, dir[1] / len, dir[2] / len], near, far };
  }

  /** Pick a point inside the volume AABB, `depth` of the way along the ray. */
  pickInVolume(ndcX, ndcY, min, max, depth = 0.45) {
    const { origin, direction } = this.ray(ndcX, ndcY);
    let t0 = -Infinity;
    let t1 = Infinity;
    for (let i = 0; i < 3; i += 1) {
      const inv = 1 / (Math.abs(direction[i]) < 1e-6 ? 1e-6 : direction[i]);
      let ta = (min[i] - origin[i]) * inv;
      let tb = (max[i] - origin[i]) * inv;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
    }
    if (t1 <= Math.max(t0, 0)) {
      return [this.target[0], this.target[1], this.target[2]];
    }
    const t = Math.max(t0, 0) + (t1 - Math.max(t0, 0)) * depth;
    return [
      origin[0] + direction[0] * t,
      origin[1] + direction[1] * t,
      origin[2] + direction[2] * t,
    ];
  }
}

/** Wires DOM pointer events to an OrbitCamera. Returns a detach function. */
export function attachOrbitControls(camera, element, { onClick } = {}) {
  let dragging = null;
  let lastX = 0;
  let lastY = 0;
  let moved = 0;
  const pointers = new Map();

  const onPointerDown = (e) => {
    element.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragging = e.button === 2 || e.shiftKey || pointers.size === 2 ? 'pan' : 'orbit';
    lastX = e.clientX;
    lastY = e.clientY;
    moved = 0;
  };

  const onPointerMove = (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      // pinch / two-finger drag
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (onPointerMove._prevPinch) camera.dolly((onPointerMove._prevPinch - dist) * 3.2);
      onPointerMove._prevPinch = dist;
      camera.pan(dx * 0.5, dy * 0.5);
      moved += Math.abs(dx) + Math.abs(dy);
      return;
    }
    if (!dragging) return;
    moved += Math.abs(dx) + Math.abs(dy);
    if (dragging === 'orbit') camera.orbit(dx, dy);
    else camera.pan(dx, dy);
  };

  const onPointerUp = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) onPointerMove._prevPinch = 0;
    if (pointers.size === 0) dragging = null;
    if (moved < 5 && e.button === 0 && onClick) {
      const rect = element.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = 1 - ((e.clientY - rect.top) / rect.height) * 2;
      onClick(ndcX, ndcY);
    }
  };

  const onWheel = (e) => {
    e.preventDefault();
    camera.dolly(e.deltaY);
  };

  const onContextMenu = (e) => e.preventDefault();

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerUp);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('contextmenu', onContextMenu);

  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerUp);
    element.removeEventListener('wheel', onWheel);
    element.removeEventListener('contextmenu', onContextMenu);
  };
}
