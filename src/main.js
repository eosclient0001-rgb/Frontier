import { FluidSim, MATERIALS } from './sim.js';
import { Renderer } from './renderer.js';

const canvas = document.getElementById('c');
let renderer;
try { renderer = new Renderer(canvas); }
catch (e) { document.getElementById('err').textContent = 'Renderer error: ' + e.message; document.getElementById('err').style.display = 'block'; throw e; }

const sim = new FluidSim(70000);
const state = {
  scenario: 'dambreak', material: 'water', quality: 'med', paused: false, debug: false,
  substeps: 2, ballDensity: 600, radiusScale: 0.62, smooth: 3.0, blurIters: 2,
};
const QUALITY = { low: 0.06, med: 0.05, high: 0.042 };

// ---------------- scenarios ----------------
const SCENARIOS = {
  dambreak: { name: 'Dam Break', size: [3, 1.8, 1.2], setup(s) {
    s.addBlock([0, 0, 0], [1.0, 1.2, 1.2]);
    s.boxes.push({ c: [2.0, 0.2, 0.6], h: [0.12, 0.2, 0.25] });
  } },
  ocean: { name: 'Ocean Break', size: [3.4, 1.6, 1.0], setup(s) {
    s.piston = { amp: 0.45, period: 2.6, x: 0.02, vx: 0 };
    s.ramp = { x0: 1.6, slope: 0.32 };
    s.addBlock([0.03, 0, 0], [3.4, 0.5, 1.0]);
    s.addSphere([1.2, 0.7, 0.5], 0.09, 500);
    s.addSphere([2.2, 0.8, 0.3], 0.07, 450);
  } },
  splash: { name: 'Splash', size: [2.4, 2.0, 1.4], setup(s) {
    s.addBlock([0, 0, 0], [2.4, 0.3, 1.4]);
    s.addBlock([0.85, 1.0, 0.45], [1.55, 1.6, 0.95]);
    s.addSphere([0.5, 1.5, 0.4], 0.12, 3000, [1, 0, 0.5]);
    s.addSphere([1.9, 1.7, 1.0], 0.1, 700, [-1, 0, -0.3]);
  } },
  pour: { name: 'Pour & Stick', size: [2.0, 2.0, 1.2], setup(s) {
    s.boxes.push({ c: [0.75, 0.45, 0.6], h: [0.22, 0.06, 0.3] });
    s.addSphere([1.2, 0.85, 0.6], 0.18, 1000, [0, 0, 0], true);
    s.emitter = { pos: [0.95, 1.75, 0.6], dir: [0, -1, 0], speed: 2.0, radius: 0.12, acc: 0, until: 9 };
  } },
  objects: { name: 'Objects', size: [2.4, 2.0, 1.4], setup(s) {
    s.addBlock([0, 0, 0], [2.4, 0.5, 1.4]);
    const dens = [300, 700, 1200, 2500, 7800];
    dens.forEach((d, i) => s.addSphere([0.35 + i * 0.42, 1.2 + i * 0.12, 0.5 + (i % 2) * 0.4], 0.08 + (i % 3) * 0.025, d));
  } },
};

function reset() {
  const sc = SCENARIOS[state.scenario];
  sim.clear();
  sim.setMaterial(state.material);
  applySliders();
  sim.configure(QUALITY[state.quality], sc.size);
  sc.setup(sim);
  fitCamera();
}

// ---------------- camera ----------------
const cam = { yaw: -0.55, pitch: 0.42, dist: 4.2, fov: 0.85, target: [1.5, 0.5, 0.6], eye: [0, 0, 0] };
function fitCamera() {
  const [W, H, D] = sim.size;
  cam.target = [W / 2, H * 0.28, D / 2];
  cam.dist = Math.max(W, H) * 1.45;
}
function updateCam() {
  const cp = Math.cos(cam.pitch);
  cam.eye = [cam.target[0] + Math.sin(cam.yaw) * cp * cam.dist, cam.target[1] + Math.sin(cam.pitch) * cam.dist, cam.target[2] + Math.cos(cam.yaw) * cp * cam.dist];
}
let drag = null;
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.x = e.clientX; drag.y = e.clientY;
  cam.yaw -= dx * 0.006; cam.pitch = Math.max(-0.1, Math.min(1.45, cam.pitch + dy * 0.006));
});
canvas.addEventListener('pointerup', e => { if (drag && drag.moved < 5) throwBall(e); drag = null; });
canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist = Math.max(1, Math.min(15, cam.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });

function throwBall(e) {
  if (!renderer.invViewProj) return;
  const r = canvas.getBoundingClientRect();
  const nx = (e.clientX - r.left) / r.width * 2 - 1, ny = 1 - (e.clientY - r.top) / r.height * 2;
  const M = renderer.invViewProj;
  const un = (x, y, z) => { const w = M[3] * x + M[7] * y + M[11] * z + M[15]; return [0, 1, 2].map(i => (M[i] * x + M[4 + i] * y + M[8 + i] * z + M[12 + i]) / w); };
  const a = un(nx, ny, -1), b = un(nx, ny, 1);
  let d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const l = Math.hypot(...d); d = d.map(x => x / l);
  // ray vs tank AABB -> spawn just inside
  const [W, H, D] = sim.size; let t0 = 0, t1 = 1e9;
  const lo = [0, 0, 0], hi = [W, H, D];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) continue;
    let ta = (lo[i] - cam.eye[i]) / d[i], tb = (hi[i] - cam.eye[i]) / d[i]; if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  if (t0 > t1) t0 = cam.dist * 0.6;
  const rad = 0.06 + Math.random() * 0.05;
  const p = [0, 1, 2].map(i => Math.max(rad + 0.01, Math.min(sim.size[i] - rad - 0.01, cam.eye[i] + d[i] * (t0 + rad + 0.02))));
  if (p[1] < H * 0.5) p[1] = Math.min(H - rad, p[1] + 0.3);
  sim.addSphere(p, rad, state.ballDensity, d.map(x => x * 4.5));
}

// ---------------- UI ----------------
const $ = id => document.getElementById(id);
function buttons(container, items, key, onPick) {
  const el = $(container); el.innerHTML = '';
  for (const [k, label] of items) {
    const b = document.createElement('button'); b.textContent = label; b.dataset.k = k;
    if (state[key] === k) b.classList.add('on');
    b.onclick = () => { state[key] = k; [...el.children].forEach(c => c.classList.toggle('on', c.dataset.k === k)); onPick(k); };
    el.appendChild(b);
  }
}
buttons('mats', Object.entries(MATERIALS).map(([k, m]) => [k, m.name]), 'material', k => { sim.setMaterial(k); syncSliders(); });
buttons('scen', Object.entries(SCENARIOS).map(([k, s]) => [k, s.name]), 'scenario', () => reset());
buttons('qual', [['low', 'Low'], ['med', 'Medium'], ['high', 'High']], 'quality', () => reset());
buttons('balls', [[300, 'Wood'], [1100, 'Rubber'], [7800, 'Steel']].map(([d, n]) => [String(d), n]), 'ballDensityS', k => state.ballDensity = +k);
state.ballDensityS = '300'; state.ballDensity = 300;
[...$('balls').children].forEach(c => c.classList.toggle('on', c.dataset.k === '300'));

const sliders = [['visc', 'Viscosity', 0, 1, 0.01], ['adhesion', 'Adhesion (stick)', 0, 15, 0.1], ['cohesion', 'Cohesion', 0, 0.5, 0.01], ['friction', 'Surface friction', 0, 1, 0.01]];
const sl = $('sliders');
for (const [k, label, mn, mx, st] of sliders) {
  const row = document.createElement('label'); row.innerHTML = `<span>${label}</span><input type="range" id="s_${k}" min="${mn}" max="${mx}" step="${st}"><em id="v_${k}"></em>`;
  sl.appendChild(row);
  row.querySelector('input').oninput = (e) => { sim.mat[k] = +e.target.value; if (k === 'visc') sim.mat.viscIters = Math.max(1, Math.round(sim.mat.visc * 10)); $('v_' + k).textContent = (+e.target.value).toFixed(2); };
}
function syncSliders() { for (const [k] of sliders) { $('s_' + k).value = sim.mat[k]; $('v_' + k).textContent = (+sim.mat[k]).toFixed(2); } }
function applySliders() { syncSliders(); }
$('reset').onclick = reset;
$('pause').onclick = () => { state.paused = !state.paused; $('pause').textContent = state.paused ? 'Play' : 'Pause'; };
$('debug').onclick = () => { state.debug = !state.debug; $('debug').classList.toggle('on', state.debug); };
$('hide').onclick = () => document.body.classList.toggle('hideui');
window.addEventListener('keydown', e => {
  if (e.key === 'r') reset();
  if (e.key === ' ') { e.preventDefault(); $('pause').click(); }
  if (e.key === 'p') $('debug').click();
  const i = '12345'.indexOf(e.key); if (i >= 0) $('mats').children[i].click();
});

// ---------------- loop ----------------
reset();
let last = performance.now(), fpsAcc = 0, fpsN = 0, simMs = 0;
function frame(now) {
  const dtf = Math.min(0.05, (now - last) / 1000); last = now;
  fpsAcc += dtf; fpsN++;
  if (!state.paused) {
    const t0 = performance.now();
    const dt = 1 / 120;
    for (let i = 0; i < state.substeps; i++) sim.step(dt);
    simMs = simMs * 0.9 + (performance.now() - t0) * 0.1;
  }
  updateCam();
  renderer.render(sim, cam, { radiusScale: state.radiusScale, smooth: state.smooth, blurIters: state.blurIters, debug: state.debug });
  if (fpsAcc > 0.5) { $('stats').textContent = `${Math.round(fpsN / fpsAcc)} fps · ${sim.n.toLocaleString()} particles · sim ${simMs.toFixed(1)} ms`; fpsAcc = 0; fpsN = 0; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__sim = sim;
