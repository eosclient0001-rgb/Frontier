import { MATERIALS } from './materials.js';
import { GpuSim } from './gpusim.js';
import { SCENARIOS, QUALITY } from './scenarios.js';
import { Renderer } from './renderer.js';

const canvas = document.getElementById('c');
let renderer;
try { renderer = new Renderer(canvas); }
catch (e) { document.getElementById('err').textContent = 'Renderer error: ' + e.message; document.getElementById('err').style.display = 'block'; throw e; }

// GPU FLIP solver shares the renderer's WebGL2 context: particles never leave the GPU
const sim = new GpuSim(renderer.gl, 640);
const post = (m) => handle(m);
function handle(m) {
  switch (m.type) {
    case 'mat': sim.setMaterial(m.key); break;
    case 'mat2': sim.setMaterial2(m.key); break;
    case 'param': { const t = m.which ? sim.mat2 : sim.mat; t[m.k] = m.v; if (m.k === 'visc') t.viscIters = Math.max(1, Math.round(m.v * 10)); break; }
    case 'mix': sim.mixRate = m.v; break;
    case 'ball': sim.addSphere(m.p, m.r, m.d, m.v); break;
    case 'pour': { const [W, H, D] = sim.size; sim.emitters.push({ pos: [W * (0.3 + Math.random() * 0.4), H * 0.9, D * 0.5], dir: [0, -1, 0], speed: 2.2, radius: 0.1, acc: 0, until: sim.time + m.secs, conc: 1 }); break; }
    case 'reset': {
      const sc = SCENARIOS[m.scenario];
      sim.clear(); sim.setMaterial(m.mat); sim.setMaterial2(m.mat2);
      Object.assign(sim.mat, m.over); Object.assign(sim.mat2, m.over2);
      sim.configure(QUALITY[m.quality], sc.size);
      sc.setup(sim);
      break;
    }
  }
}

const state = {
  scenario: 'dambreak', material: 'water', material2: 'milk', quality: 'med', paused: false, debug: false,
  ballDensity: 300, radiusScale: 1.25, smooth: 3.0, blurIters: 2,
};
const over = [{}, {}]; // slider overrides for A / B
let editing = 0;       // which fluid the sliders edit

function reset() {
  const sc = SCENARIOS[state.scenario];
  post({ type: 'reset', scenario: state.scenario, quality: state.quality, mat: state.material, mat2: state.material2, over: over[0], over2: over[1] });
  fitCamera(sc.size);
}

// ---------------- camera ----------------
const cam = { yaw: -0.55, pitch: 0.42, dist: 4.2, fov: 0.85, target: [1.5, 0.5, 0.6], eye: [0, 0, 0] };
function fitCamera(size) {
  const [W, H, D] = size;
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
  if (!renderer.invViewProj || !sim) return;
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
  post({ type: 'ball', p, r: rad, d: state.ballDensity, v: d.map(x => x * 4.5) });
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
const matItems = Object.entries(MATERIALS).map(([k, m]) => [k, m.name]);
buttons('mats', matItems, 'material', k => { over[0] = {}; post({ type: 'mat', key: k }); if (editing === 0) syncSliders(); });
buttons('mats2', matItems, 'material2', k => { over[1] = {}; post({ type: 'mat2', key: k }); if (editing === 1) syncSliders(); });
buttons('scen', Object.entries(SCENARIOS).map(([k, s]) => [k, s.name]), 'scenario', k => {
  const d = SCENARIOS[k].defaults;
  if (d) { state.material = d[0]; state.material2 = d[1]; over[0] = {}; over[1] = {}; markOn('mats', d[0]); markOn('mats2', d[1]); syncSliders(); }
  reset();
});
buttons('qual', [['low', 'Low'], ['med', 'Medium'], ['high', 'High']], 'quality', () => reset());
state.ballDensityS = '300';
buttons('balls', [['300', 'Wood'], ['1100', 'Rubber'], ['7800', 'Steel']], 'ballDensityS', k => state.ballDensity = +k);
state.editS = '0';
buttons('edit', [['0', 'Edit A'], ['1', 'Edit B']], 'editS', k => { editing = +k; syncSliders(); });
function markOn(id, k) { [...$(id).children].forEach(c => c.classList.toggle('on', c.dataset.k === k)); }

const sliders = [['visc', 'Viscosity', 0, 1, 0.01], ['adhesion', 'Adhesion (stick)', 0, 15, 0.1], ['cohesion', 'Cohesion', 0, 0.5, 0.01], ['friction', 'Surface friction', 0, 1, 0.01]];
const sl = $('sliders');
for (const [k, label, mn, mx, st] of sliders) {
  const row = document.createElement('label'); row.innerHTML = `<span>${label}</span><input type="range" id="s_${k}" min="${mn}" max="${mx}" step="${st}"><em id="v_${k}"></em>`;
  sl.appendChild(row);
  row.querySelector('input').oninput = (e) => {
    const v = +e.target.value; over[editing][k] = v;
    if (k === 'visc') over[editing].viscIters = Math.max(1, Math.round(v * 10));
    post({ type: 'param', which: editing, k, v }); $('v_' + k).textContent = v.toFixed(2);
  };
}
function syncSliders() {
  const key = editing ? state.material2 : state.material;
  for (const [k] of sliders) { const v = over[editing][k] ?? MATERIALS[key][k]; $('s_' + k).value = v; $('v_' + k).textContent = (+v).toFixed(2); }
}
syncSliders();
$('mixr').oninput = e => { post({ type: 'mix', v: +e.target.value }); $('mixv').textContent = (+e.target.value).toFixed(2); };
$('pourB').onclick = () => post({ type: 'pour', secs: 2.5 });
$('reset').onclick = reset;
$('pause').onclick = () => { state.paused = !state.paused;  $('pause').textContent = state.paused ? 'Play' : 'Pause'; };
$('debug').onclick = () => { state.debug = !state.debug; $('debug').classList.toggle('on', state.debug); };
$('hide').onclick = () => document.body.classList.toggle('hideui');
window.addEventListener('keydown', e => {
  if (e.key === 'r') reset();
  if (e.key === ' ') { e.preventDefault(); $('pause').click(); }
  if (e.key === 'p') $('debug').click();
  if (e.key === 'b') $('pourB').click();
  const i = '12345'.indexOf(e.key); if (i >= 0) $('mats').children[i].click();
});

// ---------------- loop: GPU substeps + rigid coupling + render, all on the GPU timeline
reset();
let last = performance.now(), fpsAcc = 0, fpsN = 0, frameMs = 16;
function frame(now) {
  const dtf = Math.min(0.1, (now - last) / 1000); last = now;
  fpsAcc += dtf; fpsN++; frameMs = frameMs * 0.9 + dtf * 1000 * 0.1;
  if (!state.paused) {
    const sub = 2, dt = 1 / 120;
    for (let i = 0; i < sub; i++) sim.step(dt);
    sim.coupleRigid(dt * sub);
  }
  updateCam();
  renderer.render(sim, cam, { radiusScale: state.radiusScale, smooth: state.smooth, blurIters: state.blurIters, debug: state.debug });
  if (fpsAcc > 0.5) {
    $('stats').textContent = `GPU FLIP · ${Math.round(fpsN / fpsAcc)} fps · ${sim.n.toLocaleString()} particles · grid ${sim.gx}×${sim.gy}×${sim.gz}`;
    fpsAcc = 0; fpsN = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__sim = sim;
