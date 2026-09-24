// Keyboard input -> abstract actions.
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();     // edge-triggered this frame
    this.steer = 0;
    this.pump = false;
    this.stall = false;
    this.tuck = false;
    this.launch = false;
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }
  endFrame() { this.pressed.clear(); }
  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  justPressed(code) { return this.pressed.has(code); }
  poll() {
    const L = this.down('KeyA', 'ArrowLeft');
    const R = this.down('KeyD', 'ArrowRight');
    this.steer = (R ? 1 : 0) - (L ? 1 : 0);
    this.pump = this.down('KeyW', 'Space', 'ArrowUp');
    this.stall = this.down('KeyS', 'ArrowDown');
    this.tuck = this.down('ShiftLeft', 'ShiftRight');
    this.launch = this.pump;
    this.kickout = this.pressed.has('KeyK');
    this.start = this.pressed.has('Space');
  }
}
