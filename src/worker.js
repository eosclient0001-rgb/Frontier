// Simulation thread: runs the PBF solver off the main thread so rendering/camera stay smooth.
import { FluidSim } from './sim.js';
import { SCENARIOS, QUALITY } from './scenarios.js';

const sim = new FluidSim(70000);
let paused = false, acked = true, simMs = 0, last = performance.now(), acc = 0;
const DT = 1 / 120;

function reset(c) {
  const sc = SCENARIOS[c.scenario];
  sim.clear();
  sim.setMaterial(c.mat); sim.setMaterial2(c.mat2);
  Object.assign(sim.mat, c.over || {}); Object.assign(sim.mat2, c.over2 || {});
  sim.configure(QUALITY[c.quality], sc.size);
  sc.setup(sim);
}

self.onmessage = ({ data: m }) => {
  switch (m.type) {
    case 'reset': reset(m); break;
    case 'mat': sim.setMaterial(m.key); break;
    case 'mat2': sim.setMaterial2(m.key); break;
    case 'param': (m.which ? sim.mat2 : sim.mat)[m.k] = m.v; if (m.k === 'visc') (m.which ? sim.mat2 : sim.mat).viscIters = Math.max(1, Math.round(m.v * 10)); break;
    case 'mix': sim.mixRate = m.v; break;
    case 'pause': paused = m.v; break;
    case 'ball': sim.addSphere(m.p, m.r, m.d, m.v); break;
    case 'pour': {
      const [W, H, D] = sim.size;
      sim.emitters.push({ pos: [W * (0.3 + Math.random() * 0.4), H * 0.9, D * 0.5], dir: [0, -1, 0], speed: 2.2, radius: 0.1, acc: 0, until: sim.time + m.secs, conc: 1 });
      break;
    }
    case 'ack': acked = true; break;
  }
};

function snapshot() {
  const n = sim.n;
  const x = sim.x.slice(0, n * 3), foam = sim.foam.slice(0, n), conc = sim.conc.slice(0, n);
  const emit = [...(sim.emitter ? [sim.emitter] : []), ...sim.emitters].filter(e => sim.time < e.until).map(e => ({ pos: e.pos, radius: e.radius }));
  const wet = new Uint8Array(sim.wet.length);
  for (let k = 0; k < wet.length; k++) wet[k] = Math.min(255, sim.wet[k] * 255) | 0;
  postMessage({
    n, x, foam, conc, wet, wetDims: [sim.gx, sim.gy, sim.gz], h: sim.h, time: sim.time, s: sim.s, size: sim.size, simMs,
    spheres: sim.spheres.map(s => ({ c: s.c, r: s.r, rot: s.rot, color: s.color, fixed: s.fixed })),
    boxes: sim.boxes, ramp: sim.ramp, piston: sim.piston ? { x: sim.piston.x } : null, emitters: emit,
    mat: sim.mat, mat2: sim.mat2, avgConc: sim.avgConc,
  }, [x.buffer, foam.buffer, conc.buffer, wet.buffer]);
}

function tick() {
  const now = performance.now();
  acc += Math.min(0.1, (now - last) / 1000); last = now;
  if (!paused && acc >= DT) {
    const t0 = performance.now();
    let steps = 0;
    while (acc >= DT && steps < 3) { sim.step(DT); acc -= DT; steps++; }
    if (acc > DT * 3) acc = 0; // can't keep up -> run in slow motion instead of spiralling
    simMs = simMs * 0.85 + (performance.now() - t0) / steps * 0.15;
  } else if (paused) acc = 0;
  if (acked) { acked = false; snapshot(); }
  setTimeout(tick, 0);
}
tick();
