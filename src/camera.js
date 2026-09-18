/* Orbit / fly camera.
 *  · LMB drag: orbit around target (when no sculpt tool is active)
 *  · RMB drag: look in place (eye stays put)
 *  · MMB drag or Shift+LMB: pan
 *  · wheel: dolly
 *  · WASD / QE: fly, Shift = faster
 */
export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.target = [0, 4, 0];
    this.yaw = 0.7;
    this.pitch = 0.5;
    this.dist = 52;
    this.fov = 0.62;
    this.keys = new Set();
    this.mode = null; // 'orbit' | 'look' | 'pan'
    this.lastX = 0;
    this.lastY = 0;
    this._bind();
  }

  unitDir() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return [cp * Math.sin(this.yaw), sp, cp * Math.cos(this.yaw)];
  }

  eyePos() {
    const d = this.unitDir();
    return [
      this.target[0] + d[0] * this.dist,
      this.target[1] + d[1] * this.dist,
      this.target[2] + d[2] * this.dist,
    ];
  }

  rightDir() {
    const d = this.unitDir();
    // right = dir × up? compute cross(dir, worldUp) normalized
    let rx = d[2], rz = -d[0];
    const len = Math.hypot(rx, rz) || 1;
    return [rx / len, 0, rz / len];
  }

  reset() {
    this.target = [0, 4, 0];
    this.yaw = 0.7;
    this.pitch = 0.5;
    this.dist = 52;
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());

    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (e.button === 2) this.mode = "look";
      else if (e.button === 1 || e.shiftKey) this.mode = "pan";
      else if (e.button === 0 && !this.sculptActive) this.mode = "orbit";
      else this.mode = null;
    });

    c.addEventListener("pointermove", (e) => {
      if (!this.mode) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      const s = 0.0052;
      if (this.mode === "orbit") {
        this.yaw -= dx * s;
        this.pitch = clamp(this.pitch + dy * s, -1.3, 1.35);
      } else if (this.mode === "look") {
        const eye = this.eyePos();
        this.yaw -= dx * s;
        this.pitch = clamp(this.pitch + dy * s, -1.3, 1.35);
        const d = this.unitDir();
        this.target = [
          eye[0] - d[0] * this.dist,
          eye[1] - d[1] * this.dist,
          eye[2] - d[2] * this.dist,
        ];
      } else if (this.mode === "pan") {
        const r = this.rightDir();
        const k = this.dist * 0.0016;
        this.target[0] -= r[0] * dx * k;
        this.target[2] -= r[2] * dx * k;
        this.target[1] += dy * k;
      }
    });

    const end = (e) => {
      this.mode = null;
      try {
        c.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);

    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.dist = clamp(this.dist * Math.exp(e.deltaY * 0.0011), 4, 180);
      },
      { passive: false },
    );

    window.addEventListener("keydown", (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  update(dt) {
    if (this.keys.size === 0) return;
    const d = this.unitDir();
    const r = this.rightDir();
    const speed = (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 4 : 1) * this.dist * 0.5 * dt;
    // project forward onto horizontal plane for W/S so flight feels stable
    let fx = d[0], fz = d[2];
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    const move = [0, 0, 0];
    if (this.keys.has("KeyW")) { move[0] += fx; move[2] += fz; }
    if (this.keys.has("KeyS")) { move[0] -= fx; move[2] -= fz; }
    if (this.keys.has("KeyD")) { move[0] += r[0]; move[2] += r[2]; }
    if (this.keys.has("KeyA")) { move[0] -= r[0]; move[2] -= r[2]; }
    if (this.keys.has("KeyE")) move[1] += 1;
    if (this.keys.has("KeyQ")) move[1] -= 1;
    this.target[0] += move[0] * speed;
    this.target[1] += move[1] * speed;
    this.target[2] += move[2] * speed;
  }
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
