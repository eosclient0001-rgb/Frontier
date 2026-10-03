// Headless smoke test for the control panel: stubs just enough DOM to build
// every widget in every tab. Run: node tools/ui-smoke.mjs
class El {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.style = {}; this.dataset = {}; this._cls = new Set(); }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const self = this;
    return {
      add: (c) => self._cls.add(c), remove: (c) => self._cls.delete(c),
      toggle: (c, on) => (on === undefined ? (self._cls.has(c) ? self._cls.delete(c) : self._cls.add(c)) : (on ? self._cls.add(c) : self._cls.delete(c))),
      contains: (c) => self._cls.has(c),
    };
  }
  set innerHTML(v) { this._html = v; } get innerHTML() { return this._html ?? ''; }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { this.children.push(...cs); }
  querySelector() { return new El(); }
  addEventListener() {}
  setPointerCapture() {} releasePointerCapture() {}
  getContext() { return null; }
}

const PANES = ['fabric', 'dress', 'physics', 'body', 'scene'].map((k) => {
  const e = new El(); e.dataset.pane = k; return e;
});
const TABS = ['fabric', 'dress', 'physics', 'body', 'scene'].map((k) => { const e = new El('button'); e.dataset.tab = k; return e; });
const BY_ID = {};
for (const id of ['viewport', 'fabricCanvas', 'error', 'gpuinfo', 'fps', 'verts', 'cons', 'statuspill',
  'btnPlay', 'btnReset', 'btnDrop', 'btnDance', 'fabricName']) BY_ID[id] = new El();

globalThis.document = {
  createElement: (t) => new El(t),
  querySelectorAll: (sel) => (sel.includes('pane') ? PANES : sel.includes('button') ? TABS : []),
  getElementById: (id) => (BY_ID[id] ??= new El()),
};
globalThis.window = { devicePixelRatio: 1 };
globalThis.requestAnimationFrame = () => 0;
// Node already exposes a read-only `navigator`; just make sure it has no .gpu
// so boot() takes the error path instead of touching a real GPU.
globalThis.performance = { now: () => 0 };

const realError = console.error;
console.error = () => {};               // boot() is expected to fail here (no WebGPU)
const m = await import('../src/main.js');
console.error = realError;
let failures = 0;
try {
  m.buildUI();
  console.log('  ✓ buildUI() constructed every tab without throwing');
} catch (e) {
  failures++;
  console.log('  ✗ buildUI() threw:', e.message);
}
const perPane = PANES.map((p) => `${p.dataset.pane}=${p.children.length}`);
console.log(`  ✓ pane sections: ${perPane.join(', ')}`);
const cfg = m.simConfig();
const keys = Object.keys(cfg);
const required = ['gravity', 'wind', 'airDrag', 'damping', 'thickness', 'friction', 'restitution',
  'substeps', 'iterations', 'floorY', 'pinBlend', 'pinEvery', 'bodyCollision'];
const missing = required.filter((k) => !keys.includes(k));
if (missing.length) { failures++; console.log('  ✗ simConfig missing:', missing.join(',')); }
else console.log(`  ✓ simConfig exposes all ${required.length} solver fields`);
if (m.fabricUniform.length !== 32) { failures++; console.log('  ✗ fabric uniform is not 32 floats'); }
else console.log('  ✓ fabric uniform packed to 32 floats (128 bytes)');

console.log(`\n${failures === 0 ? '✅ UI smoke test passed' : `❌ ${failures} problem(s)`}\n`);
process.exit(failures ? 1 : 0);
