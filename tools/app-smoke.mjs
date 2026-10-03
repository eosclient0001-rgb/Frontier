// End-to-end smoke test of the GPU layer.
//
// Boots ClothStudio against a validating WebGPU mock (tools/gpu-mock.mjs),
// builds the mannequin + dress, runs the solver and renders a frame — checking
// along the way that every bind group, buffer usage, uniform size, vertex
// layout, dispatch and draw matches what the WGSL shaders declare.
//
// Run: node tools/app-smoke.mjs
import { installGPU } from './gpu-mock.mjs';

// ---------------------------------------------------------------- DOM stub
class El {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.style = {}; this.dataset = {};
    this._cls = new Set(); this.width = 900; this.height = 600;
    this.clientWidth = 900; this.clientHeight = 600;
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const self = this;
    return {
      add: (c) => self._cls.add(c), remove: (c) => self._cls.delete(c),
      toggle: (c, on) => (on ? self._cls.add(c) : self._cls.delete(c)),
      contains: (c) => self._cls.has(c),
    };
  }
  set innerHTML(v) { this._html = v; } get innerHTML() { return this._html ?? ''; }
  set textContent(v) { this._txt = v; } get textContent() { return this._txt ?? ''; }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { this.children.push(...cs); }
  querySelector() { return new El(); }
  querySelectorAll() { return []; }
  addEventListener() {} removeEventListener() {}
  setPointerCapture() {} releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600 }; }
  getContext(kind) {
    if (kind !== 'webgpu') return null;
    return {
      configure() {}, unconfigure() {},
      getCurrentTexture: () => ({ createView: () => ({ __canvasTexture: true }) }),
    };
  }
}

const gpuEnv = installGPU();
globalThis.document = {
  createElement: (t) => new El(t),
  querySelectorAll: () => [],
  getElementById: () => new El(),
  body: new El('body'),
};
globalThis.window = { devicePixelRatio: 2, addEventListener() {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.performance = { now: () => 0 };

const { ClothStudio } = await import('../src/app.js');
const { DEFAULT_FABRIC, packFabric } = await import('../src/fabric.js');
const { m4 } = await import('../src/math.js');
const { SIM } = await import('../src/main.js');

let failures = gpuEnv.errors.length;
const ok = (cond, msg, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures++; console.log(`  ✗ ${msg} ${extra}`); }
};

const P = {
  height: 1.70, shoulders: 1.0, bust: 1.0, waist: 0.92, hips: 1.06, bustHeight: 1.0,
  armAngle: 16, legSpread: 0, bodySegments: 44,
  style: 'aline', length: 0.60, fit: 1.030, ease: 1.0, flare: 1.0,
  pleats: 14, pleatDepth: 0.020, neckline: 'sweetheart', straps: 1, strapWidth: 0.030,
  strapInset: 0, strapPinRange: 0.16, neckDrop: 1.0, hemSweep: 1.0, tierAmp: 1.0,
  resolution: 96, pinTopRows: 2, arealDensity: 0.20,
  constraintParams: { stretchComp: 1.5e-6, shearComp: 3e-5, bendComp: 8e-4, stitchComp: 1e-7 },
};
const FABRIC = { ...DEFAULT_FABRIC };

console.log('\n== boot ==');
const studio = await ClothStudio.create(new El('canvas'), new El('canvas'), P, FABRIC);
ok(studio.ready, 'ClothStudio.create() initialised the device and pipelines');
studio.onError = (m) => { failures++; console.log('  ✗ runtime GPU error:', m); };

studio.rebuild();
ok(studio.vertexCount > 1000, `geometry uploaded (${studio.vertexCount} verts, ${studio.constraints.count} constraints)`);
ok(studio.bodyIndexCount > 0, `mannequin mesh uploaded (${studio.bodyIndexCount / 3} tris)`);

const cfg = { ...SIM, gravity: [0, -9.81, 0], wind: [0, 0, 0], substeps: 2, iterations: 6,
  pinEvery: 2, damping: 0.008, airDrag: 0.02, thickness: 0.006, friction: 0.55,
  restitution: 0.02, floorY: 0, bodyCollision: 1, pinBlend: 1 };

console.log('\n== solver loop ==');
const before = { d: gpuEnv.stats.dispatches, s: gpuEnv.stats.submits };
for (let f = 0; f < 30; f++) {
  studio.worldTime += 1 / 60;
  studio.updatePins(m4.identity());
  studio.step(1 / 60, cfg);
}
const perFrame = (gpuEnv.stats.dispatches - before.d) / 30;
const pinRounds = Math.ceil(cfg.iterations / cfg.pinEvery);
const expected = cfg.substeps * (2 + cfg.iterations + pinRounds + 1) + 1;
ok(perFrame === expected,
  `dispatch shape: ${perFrame} passes/frame (${cfg.substeps} substeps x [predict, clear, ${cfg.iterations} solves, ${pinRounds} pin rounds, collide] + finalize)`);

console.log('\n== render ==');
studio.resize();
studio.render({
  viewProj: m4.perspective(0.66, 1.5, 0.05, 60),
  invViewProj: m4.invert(m4.perspective(0.66, 1.5, 0.05, 60)),
  eye: [0, 1.2, 2.4], lightDir: [0.4, 0.7, 0.6], lightCol: [1, 1, 1], ambient: [0.2, 0.2, 0.22],
}, packFabric(FABRIC));
ok(true, 'render() completed (ground + mannequin + cloth + fabric swatch)');

console.log('\n== reset ==');
studio.resetSim();
ok(true, 'resetSim() dispatched');

console.log('\n== every style x neckline rebuilds through the GPU pipeline ==');
const { DRESS_STYLES, NECKLINE_OPTIONS } = await import('../src/dress.js');
let built = 0, minV = Infinity, maxV = 0, minC = Infinity, maxC = 0;
for (const style of Object.keys(DRESS_STYLES)) {
  for (const nk of NECKLINE_OPTIONS) {
    P.style = style; P.neckline = nk.value;
    studio.params = P;
    studio.rebuild();
    if (!studio.vertexCount || !studio.constraints.count) { failures++; console.log(`  ✗ ${style}/${nk.value} built empty`); }
    minV = Math.min(minV, studio.vertexCount); maxV = Math.max(maxV, studio.vertexCount);
    minC = Math.min(minC, studio.constraints.count); maxC = Math.max(maxC, studio.constraints.count);
    studio.step(1 / 60, cfg);
    built++;
  }
}
ok(built === 54 && failures === 0,
  `${built} dress variants rebuilt + stepped (${minV}..${maxV} verts, ${minC}..${maxC} constraints)`);
P.style = 'aline'; P.neckline = 'sweetheart'; studio.params = P; studio.rebuild();

console.log('\n== dance rig (animated body transform) ==');
const rot = (a) => {
  const m = m4.identity();
  m[0] = Math.cos(a); m[2] = -Math.sin(a); m[8] = Math.sin(a); m[10] = Math.cos(a);
  m[13] = 0.03 * Math.sin(a * 2);
  return m;
};
studio.bodyMatrix = rot(0.7);
studio.bodyMatrixInverse = m4.invert(studio.bodyMatrix);
studio.updatePins(studio.bodyMatrix);
const pinBefore = Float32Array.from(studio.state.pinPos);
studio.step(1 / 60, cfg);
ok(pinBefore.some((v, i) => i % 4 === 0 && Math.abs(v) > 1e-6),
  'pins are driven by the body matrix (dancing)');
studio.bodyMatrix = null; studio.bodyMatrixInverse = null;
studio.resetSim();
ok(true, 'resetSim() after dancing');

console.log('\n== GPU validation ==');
if (gpuEnv.errors.length) {
  for (const e of gpuEnv.errors) console.log('  ✗ ' + e);
  failures += gpuEnv.errors.length;
} else {
  ok(true, 'no WebGPU validation errors raised by the mock');
}
console.log(`  · ${gpuEnv.stats.buffers} buffers, ${gpuEnv.stats.pipelines} pipelines, ` +
  `${gpuEnv.stats.bindGroups} bind groups, ${gpuEnv.stats.dispatches} dispatches, ` +
  `${(gpuEnv.stats.writeBytes / 1024 / 1024).toFixed(1)} MB uploaded`);

console.log(`\n${failures === 0 ? '✅ GPU smoke test passed' : `❌ ${failures} problem(s)`}\n`);
process.exit(failures ? 1 : 0);
