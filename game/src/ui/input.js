// Keyboard + gamepad. Steering from the keyboard is digital (-1/0/1); the car smooths it.
const DEAD = 0.12;

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  isDown(...codes) {
    return codes.some((c) => this.down.has(c));
  }

  /** True once per key press (edge-triggered). */
  wasPressed(...codes) {
    let hit = false;
    for (const c of codes) {
      if (this.pressed.has(c)) {
        hit = true;
        this.pressed.delete(c);
      }
    }
    return hit;
  }

  endFrame() {
    this.pressed.clear();
  }

  read() {
    let steer = 0;
    if (this.isDown('ArrowLeft', 'KeyA')) steer -= 1;
    if (this.isDown('ArrowRight', 'KeyD')) steer += 1;
    let throttle = this.isDown('ArrowUp', 'KeyW') ? 1 : 0;
    let brake = this.isDown('ArrowDown', 'KeyS') ? 1 : 0;
    let hb = this.isDown('Space');
    let nitro = this.isDown('ShiftLeft', 'ShiftRight', 'KeyE');

    const pad = this._pad();
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > DEAD) steer = ax;
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);
      if (pad.buttons[1]?.pressed) hb = true;
      if (pad.buttons[0]?.pressed) nitro = true;
    }
    return { throttle, brake, steer: Math.max(-1, Math.min(1, steer)), hb, nitro };
  }

  padPressed(index) {
    const pad = this._pad();
    return !!(pad && pad.buttons[index]?.pressed);
  }

  _pad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }
}
