// Frontier Road Editor — main application
import * as THREE from 'three';
import { buildMaterials } from './core/textures.js';
import { PROFILES, PROFILE_LIST, profileOf } from './core/profiles.js';
import { Network, UndoStack } from './core/network.js';
import { buildWorld } from './core/mesher.js';
import { generateCity, CITY_DEFAULTS } from './core/citygen.js';
import { FlyCam } from './core/camera.js';
import { exportOBJ, exportGLB } from './core/exporter.js';
import { PROP_PALETTE } from './core/props.js';
import { clamp, fmt } from './core/util.js';

// ── renderer / scene ──────────────────────────────────────────────────────
const viewport = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const HORIZON = new THREE.Color(0xdfe5e4);
scene.fog = new THREE.Fog(HORIZON, 700, 4200);
const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 9000);

// gradient sky dome
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0x5f9ecb) }, mid: { value: new THREE.Color(0xa8c8dc) }, hor: { value: HORIZON.clone() } },
  vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 hor;
    void main(){ float h = normalize(vP).y;
      vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.7, h)) : mix(hor, mid, smoothstep(-0.02, 0.12, h));
      gl_FragColor = vec4(c, 1.0); }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(6500, 24, 12), skyMat);
scene.add(sky);

const hemi = new THREE.HemisphereLight(0xcfe3f0, 0x8b8272, 0.95);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1da, 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 50; sun.shadow.camera.far = 3000;
const SB = 420;
sun.shadow.camera.left = -SB; sun.shadow.camera.right = SB;
sun.shadow.camera.top = SB; sun.shadow.camera.bottom = -SB;
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);

const { mats } = buildMaterials(renderer.capabilities.getMaxAnisotropy());

// ground
const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), mats.grass);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
ground.name = 'ground';
scene.add(ground);

// ── app state ─────────────────────────────────────────────────────────────
let net = new Network();
const undo = new UndoStack();
let world = null;               // {group, edgePolys, stats}
let nodeGizmos = null;          // InstancedMesh
let nodeOrder = [];             // index → nodeId for gizmo picking
let selOverlay = null;          // highlight mesh
const state = {
  tool: 'select',
  profile: 'street',
  propType: 'lamp',
  draw: null,                   // {kind, pts:[{x,z,nodeId?}], }
  selection: null,              // {kind:'edge'|'node'|'prop', id}
  city: { ...CITY_DEFAULTS },
};

function pushUndo() { undo.push(net); }

// ── world build ───────────────────────────────────────────────────────────
function disposeGroup(g) {
  if (!g) return;
  g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  scene.remove(g);
}

function rebuild() {
  disposeGroup(world?.group);
  const t0 = performance.now();
  world = buildWorld(net, mats, { furniture: true });
  world.group.traverse(o => {
    if (o.isMesh || o.isInstancedMesh) { o.castShadow = true; o.receiveShadow = true; }
    if (o.isInstancedMesh) o.raycast = () => {}; // picking is done analytically
  });
  scene.add(world.group);
  rebuildGizmos();
  updateSelectionOverlay();
  lastBuildMs = performance.now() - t0;
  updateStats();
  renderInspector();
}

function rebuildGizmos() {
  if (nodeGizmos) { scene.remove(nodeGizmos); nodeGizmos.dispose?.(); }
  nodeOrder = [...net.nodes.keys()];
  if (!nodeOrder.length) { nodeGizmos = null; return; }
  const g = new THREE.CircleGeometry(1.5, 20);
  g.rotateX(-Math.PI / 2);
  nodeGizmos = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x4fd8e0, transparent: true, opacity: 0.55, depthTest: true }), nodeOrder.length);
  const m4 = new THREE.Matrix4();
  nodeOrder.forEach((nid, i) => {
    const n = net.nodes.get(nid);
    m4.makeTranslation(n.x, n.elev + 0.06, n.z);
    nodeGizmos.setMatrixAt(i, m4);
  });
  nodeGizmos.instanceMatrix.needsUpdate = true;
  nodeGizmos.name = 'nodeGizmos';
  scene.add(nodeGizmos);
}

// ── selection ─────────────────────────────────────────────────────────────
function edgeAt(x, z, maxExtra = 3) {
  if (!world) return null;
  let best = null, bd = Infinity;
  for (const [eid, poly] of world.edgePolys) {
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i], b = poly[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const l2 = dx * dx + dz * dz || 1e-6;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
      const px = a.x + dx * t, pz = a.z + dz * t;
      const d = Math.hypot(x - px, z - pz);
      const lim = a.half + maxExtra;
      if (d < lim && d < bd) { bd = d; best = { eid, x: px, z: pz, y: a.y, tx: dx / Math.sqrt(l2), tz: dz / Math.sqrt(l2) }; }
    }
  }
  return best;
}
function propAt(x, z) {
  let best = null, bd = 4.2 * 4.2;
  for (const p of net.props) {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function select(kind, id) {
  state.selection = kind ? { kind, id } : null;
  updateSelectionOverlay();
  renderInspector();
}

function updateSelectionOverlay() {
  if (selOverlay) { scene.remove(selOverlay); selOverlay.geometry?.dispose(); selOverlay = null; }
  const s = state.selection;
  if (!s) return;
  if (s.kind === 'edge') {
    const e = net.edges.get(s.id);
    if (!e) return;
    const S = net.sampleEdge(e, 2.5);
    if (S.length < 2) return;
    const P = profileOf(e.profile);
    const W = P.bands.reduce((a, b) => a + b.w, 0), half = W / 2;
    const pos = [];
    for (let i = 0; i < S.length; i++) {
      const p = S[i];
      let tx, tz;
      const q = S[Math.min(i + 1, S.length - 1)], o = S[Math.max(i - 1, 0)];
      tx = q.x - o.x; tz = q.z - o.z;
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const rx = -tz, rz = tx;
      pos.push(p.x + rx * -half, p.y + 0.08, p.z + rz * -half, p.x + rx * half, p.y + 0.08, p.z + rz * half);
    }
    const idx = [];
    for (let i = 0; i < S.length - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    selOverlay = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x4fd8e0, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
    scene.add(selOverlay);
  } else if (s.kind === 'node') {
    const n = net.nodes.get(s.id);
    if (!n) return;
    const g = new THREE.RingGeometry(1.6, 2.6, 28);
    g.rotateX(-Math.PI / 2);
    selOverlay = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x4fd8e0, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    selOverlay.position.set(n.x, n.elev + 0.08, n.z);
    scene.add(selOverlay);
  } else if (s.kind === 'prop') {
    const p = net.props.find(q => q.id === s.id);
    if (!p) return;
    const g = new THREE.RingGeometry(1.2, 1.8, 24);
    g.rotateX(-Math.PI / 2);
    selOverlay = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    selOverlay.position.set(p.x, (p.y ?? 0) + 0.1, p.z);
    scene.add(selOverlay);
  }
}

// ── drawing tool ──────────────────────────────────────────────────────────
let drawLine = null;
function updateDrawPreview() {
  if (drawLine) { scene.remove(drawLine); drawLine.geometry.dispose(); drawLine = null; }
  if (!state.draw || !state.draw.pts.length) return;
  const pts = state.draw.pts.map(p => new THREE.Vector3(p.x, 0.35, p.z));
  if (state.draw.cursor) pts.push(new THREE.Vector3(state.draw.cursor.x, 0.35, state.draw.cursor.z));
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  drawLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x4fd8e0 }));
  scene.add(drawLine);
}

function finishDraw() {
  const d = state.draw;
  if (!d) return;
  const pts = d.pts;
  state.draw = null;
  updateDrawPreview();
  if (pts.length < 2) { toast('Need at least 2 points'); return; }
  pushUndo();
  const prof = d.kind === 'rail' ? 'rail' : state.profile;
  let prev = null;
  pts.forEach((p, i) => {
    let node = p.nodeId ? net.nodes.get(p.nodeId) : net.nearestNode(p.x, p.z, 6);
    if (!node) node = net.addNode(p.x, p.z, 0);
    if (prev && node.id !== prev.id) net.addEdge(prev.id, node.id, prof, d.kind);
    prev = node;
  });
  rebuild();
  toast(`${d.kind === 'rail' ? 'Railway' : 'Road'} placed · ${pts.length} points`);
}

// ── pointer input ─────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downXY = null;

function pickPoint(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const targets = [ground];
  if (world) targets.push(world.group);
  const hits = raycaster.intersectObjects(targets, true);
  for (const h of hits) {
    if (h.object.name === 'nodeGizmos') continue;
    return h.point;
  }
  return null;
}

renderer.domElement.addEventListener('pointerdown', e => { if (e.button === 0) downXY = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('dblclick', () => { if (state.draw) finishDraw(); });

renderer.domElement.addEventListener('pointermove', e => {
  if (!state.draw) return;
  const p = pickPoint(e);
  if (p) { state.draw.cursor = { x: p.x, z: p.z }; updateDrawPreview(); }
});

renderer.domElement.addEventListener('pointerup', e => {
  if (e.button !== 0 || !downXY) return;
  const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
  downXY = null;
  if (moved > 5) return; // was a camera drag / drag intent
  const p = pickPoint(e);
  if (!p) return;
  handleClick(p);
});

function handleClick(p) {
  const { tool } = state;
  if (tool === 'road' || tool === 'rail') {
    if (!state.draw) state.draw = { kind: tool, pts: [], cursor: null };
    const near = net.nearestNode(p.x, p.z, 12);
    const d = state.draw;
    const last = d.pts[d.pts.length - 1];
    if (near) {
      if (!last || (last.nodeId !== near.id && Math.hypot(last.x - near.x, last.z - near.z) > 2)) {
        d.pts.push({ x: near.x, z: near.z, nodeId: near.id });
      }
    } else if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 4) {
      d.pts.push({ x: p.x, z: p.z });
    }
    updateDrawPreview();
    setStatus(`Drawing ${d.kind} · ${d.pts.length} pts · double-click / Enter to finish · Esc cancels`);
    return;
  }
  if (tool === 'erase') {
    const pr = propAt(p.x, p.z);
    if (pr) { pushUndo(); net.removeProp(pr.id); rebuild(); toast('Prop removed'); return; }
    const hit = edgeAt(p.x, p.z, 1);
    if (hit) { pushUndo(); net.removeEdge(hit.eid); rebuild(); toast('Removed'); return; }
    return;
  }
  if (tool === 'prop') {
    pushUndo();
    if (state.propType === 'bump') {
      const hit = edgeAt(p.x, p.z, 1);
      if (!hit) { toast('Place speed bumps on a road'); return; }
      net.addProp('bump', hit.x, hit.z, Math.atan2(hit.tx, hit.tz), { y: hit.y, w: 7 });
    } else {
      const rot = Math.atan2(-Math.sin(fly.yaw), -Math.cos(fly.yaw)); // face camera
      net.addProp(state.propType, p.x, p.z, rot, {});
    }
    rebuild();
    return;
  }
  // select tool
  const n = net.nearestNode(p.x, p.z, 7);
  if (n && net.degree(n.id) > 0) { select('node', n.id); return; }
  const pr = propAt(p.x, p.z);
  if (pr) { select('prop', pr.id); return; }
  const hit = edgeAt(p.x, p.z, 1.5);
  if (hit) { select('edge', hit.eid); return; }
  select(null);
}

// ── keyboard ──────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.code === 'Escape') { state.draw = null; updateDrawPreview(); select(null); helpOverlay.classList.add('hidden'); }
  if (e.code === 'Enter' && state.draw) finishDraw();
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); doUndo(); }
  if (e.code === 'Delete' || e.code === 'Backspace') deleteSelection();
  if (e.code === 'KeyF') focusSelection();
  if (e.code === 'KeyT') fly.topDown(new THREE.Vector3(0, 0, 0), 1600);
  const tools = { Digit1: 'select', Digit2: 'road', Digit3: 'rail', Digit4: 'prop', Digit5: 'erase' };
  if (tools[e.code]) setTool(tools[e.code]);
});

function deleteSelection() {
  const s = state.selection;
  if (!s) return;
  pushUndo();
  if (s.kind === 'edge') net.removeEdge(s.id);
  if (s.kind === 'node') net.removeNode(s.id);
  if (s.kind === 'prop') net.removeProp(s.id);
  state.selection = null;
  rebuild();
}
function focusSelection() {
  const s = state.selection;
  if (!s) return;
  let p = null;
  if (s.kind === 'node') { const n = net.nodes.get(s.id); p = n && new THREE.Vector3(n.x, n.elev, n.z); }
  if (s.kind === 'prop') { const q = net.props.find(x => x.id === s.id); p = q && new THREE.Vector3(q.x, q.y ?? 0, q.z); }
  if (s.kind === 'edge') {
    const poly = world?.edgePolys.get(s.id);
    if (poly) { const m = poly[Math.floor(poly.length / 2)]; p = new THREE.Vector3(m.x, m.y, m.z); }
  }
  if (p) fly.focusOn(p);
}
function doUndo() {
  if (!undo.canUndo) { toast('Nothing to undo'); return; }
  net = undo.pop(net);
  state.selection = null;
  rebuild();
  toast('Undone');
}

// ── fly camera ────────────────────────────────────────────────────────────
const fly = new FlyCam(camera, renderer.domElement);
fly.focusOn(new THREE.Vector3(0, 0, 0), 420);

// ── UI: top bar ───────────────────────────────────────────────────────────
const toolMode = document.getElementById('toolMode');
function setTool(t) {
  state.tool = t;
  if (t !== 'road' && t !== 'rail') { state.draw = null; updateDrawPreview(); }
  for (const b of toolMode.querySelectorAll('button')) b.classList.toggle('on', b.dataset.tool === t);
  const hints = {
    select: 'Select · click roads / node discs / props · Del removes · F focuses',
    road: `Drawing “${PROFILES[state.profile].name}” · click to add points · double-click / Enter finishes`,
    rail: 'Drawing railway · click to add points · double-click / Enter finishes · crossings are automatic',
    prop: `Placing “${PROP_PALETTE.find(p => p.type === state.propType)?.name}” · click the ground`,
    erase: 'Erase · click roads, rails or props to delete',
  };
  setStatus(hints[t]);
}
toolMode.addEventListener('click', e => {
  const b = e.target.closest('button[data-tool]');
  if (b) setTool(b.dataset.tool);
});

// ── UI: road library ──────────────────────────────────────────────────────
const SURF_COLOR = {
  asphalt: '#2c2e31', asphaltDark: '#232527', asphaltRed: '#6b332e', asphaltGreen: '#2e5a3c',
  concrete: '#9aa0a4', concreteSmooth: '#a6abae', cobble: '#6b675f', dirt: '#7a6248',
  gravel: '#6f6c66', grass: '#4a6a3c',
};
function drawProfilePreview(canvas, p) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const total = p.bands.reduce((s, b) => s + b.w, 0);
  let x = 0;
  const base = H - 3;
  for (const b of p.bands) {
    const w = (b.w / total) * (W - 8);
    const h = 2 + Math.min(9, (b.h + (b.role === 'barrier' ? b.h : 0)) * 14);
    ctx.fillStyle = SURF_COLOR[b.t] || '#555';
    ctx.fillRect(4 + x, base - h, Math.max(1, w - 0.5), h);
    if (b.role === 'barrier') { ctx.fillStyle = '#c8cdd1'; ctx.fillRect(4 + x + w * 0.25, base - h - 3, w * 0.5, 3); }
    if (['lane', 'bus'].includes(b.role)) {
      ctx.fillStyle = b.dir > 0 ? 'rgba(255,255,255,.55)' : 'rgba(255,220,120,.5)';
      ctx.fillRect(4 + x + w / 2 - 0.5, base - h + 1, 1, h - 2);
    }
    x += w;
  }
}
const profileList = document.getElementById('profileList');
const cats = {};
for (const p of PROFILE_LIST) (cats[p.cat] ||= []).push(p);
for (const [cat, list] of Object.entries(cats)) {
  const h = document.createElement('div');
  h.className = 'caps dim';
  h.style.cssText = 'margin:6px 2px 2px;font-size:9.5px';
  h.textContent = cat;
  profileList.appendChild(h);
  for (const p of list) {
    const it = document.createElement('div');
    it.className = 'item' + (p.id === state.profile ? ' sel' : '');
    it.dataset.pid = p.id;
    const cv = document.createElement('canvas');
    cv.width = 118; cv.height = 20;
    drawProfilePreview(cv, p);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<div class="nm">${p.name}</div><div class="ds">${p.desc}</div>`;
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = fmt(p.bands.reduce((s, b) => s + b.w, 0)) + 'm';
    it.append(cv, meta, tag);
    it.addEventListener('click', () => {
      state.profile = p.id;
      profileList.querySelectorAll('.item').forEach(el => el.classList.toggle('sel', el.dataset.pid === p.id));
      if (state.tool !== 'road') setTool('road');
      else setTool('road');
      renderInspector();
    });
    profileList.appendChild(it);
  }
}

// ── UI: prop palette ──────────────────────────────────────────────────────
const propList = document.getElementById('propList');
for (const p of PROP_PALETTE) {
  const it = document.createElement('div');
  it.className = 'item' + (p.type === state.propType ? ' sel' : '');
  it.dataset.ptype = p.type;
  it.innerHTML = `<div class="dot" style="background:${p.type === 'portal' ? '#a6abae' : p.type === 'cone' ? '#d9561e' : p.type === 'tree' ? '#3f6b34' : '#e8e8e2'}"></div>
    <div class="meta"><div class="nm">${p.name}</div><div class="ds">${p.desc}</div></div>`;
  it.addEventListener('click', () => {
    state.propType = p.type;
    propList.querySelectorAll('.item').forEach(el => el.classList.toggle('sel', el.dataset.ptype === p.type));
    setTool('prop');
  });
  propList.appendChild(it);
}

// ── UI: city generator form ───────────────────────────────────────────────
const cityForm = document.getElementById('cityForm');
function cityField(key, label, opts) {
  const v = state.city[key];
  if (opts.type === 'range') {
    return `<div class="row"><label>${label}</label><input type="range" min="${opts.min}" max="${opts.max}" step="${opts.step}" value="${v}" data-k="${key}"><span class="val" data-v="${key}">${v}</span></div>`;
  }
  if (opts.type === 'check') {
    return `<label class="check"><input type="checkbox" data-k="${key}" ${v ? 'checked' : ''}>${label}</label>`;
  }
  return `<div class="row"><label>${label}</label><input type="text" value="${v}" data-k="${key}"></div>`;
}
cityForm.innerHTML =
  `<div class="row"><label>Seed</label><input type="number" value="${state.city.seed}" data-k="seed"></div>` +
  cityField('extent', 'City size', { type: 'range', min: 800, max: 4000, step: 200 }) +
  cityField('block', 'Block size', { type: 'range', min: 140, max: 400, step: 20 }) +
  cityField('avenueEvery', 'Avenue every', { type: 'range', min: 2, max: 5, step: 1 }) +
  '<hr>' +
  cityField('ring', 'Ring road', { type: 'check' }) +
  cityField('diagonal', 'Diagonal boulevard', { type: 'check' }) +
  cityField('highway', 'Motorway spine', { type: 'check' }) +
  cityField('rail', 'Railway + crossings', { type: 'check' }) +
  cityField('metro', 'Subway portals', { type: 'check' }) +
  cityField('furniture', 'Signals · crosswalks · lamps', { type: 'check' }) +
  cityField('bumps', 'Speed bumps on streets', { type: 'check' });
cityForm.addEventListener('input', e => {
  const k = e.target.dataset.k;
  if (!k) return;
  let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (k === 'seed') v = Number(v) || 0;
  if (['extent', 'block', 'avenueEvery'].includes(k)) { v = Number(v); cityForm.querySelector(`[data-v="${k}"]`).textContent = v; }
  state.city[k] = v;
});
document.getElementById('btnCityGen').addEventListener('click', () => generateNow());
document.getElementById('btnGenerate').addEventListener('click', () => {
  document.getElementById('cardCity').scrollIntoView({ behavior: 'smooth' });
  document.getElementById('cardCity').style.borderColor = 'rgba(79,216,224,.5)';
  setTimeout(() => document.getElementById('cardCity').style.borderColor = '', 900);
});
function generateNow() {
  pushUndo();
  toast(`Generating city (seed ${state.city.seed})…`);
  setTimeout(() => {
    net = generateCity(state.city);
    state.selection = null;
    rebuild();
    fly.focusOn(new THREE.Vector3(0, 0, 0), Math.max(500, state.city.extent * 0.32));
    toast(`City generated · ${net.nodes.size} nodes · ${net.edges.size} edges · build ${lastBuildMs.toFixed(0)} ms`);
  }, 30);
}

// ── UI: viewport card ─────────────────────────────────────────────────────
const viewForm = document.getElementById('viewForm');
viewForm.innerHTML =
  `<div class="row"><label>Time of day</label><select id="selTOD">
     <option value="noon" selected>Noon</option><option value="golden">Golden hour</option><option value="overcast">Overcast</option>
   </select></div>
   <div class="row"><label>View distance</label><input type="range" id="rngFar" min="1200" max="8000" step="200" value="4200"><span class="val" id="valFar">4200</span></div>
   <label class="check"><input type="checkbox" id="chkShadows" checked>Dynamic shadows</label>
   <div class="row"><label>Camera</label><span class="val" style="flex:1;text-align:left" id="camInfo">—</span></div>`;
const TOD = {
  noon: { sun: 0xfff1da, si: 2.3, hemi: 0.95, top: 0x5f9ecb, mid: 0xa8c8dc, hor: 0xdfe5e4 },
  golden: { sun: 0xffb066, si: 2.5, hemi: 0.55, top: 0x3c5a86, mid: 0xc98d5f, hor: 0xe8c9a0 },
  overcast: { sun: 0xdfe8ee, si: 1.0, hemi: 0.85, top: 0x9fb2bd, mid: 0xb9c6cd, hor: 0xccd5d9 },
};
viewForm.querySelector('#selTOD').addEventListener('change', e => {
  const t = TOD[e.target.value];
  sun.color.set(t.sun); sun.intensity = t.si; hemi.intensity = t.hemi;
  skyMat.uniforms.top.value.set(t.top); skyMat.uniforms.mid.value.set(t.mid);
  skyMat.uniforms.hor.value.set(t.hor);
  scene.fog.color.set(t.hor);
});
viewForm.querySelector('#rngFar').addEventListener('input', e => {
  const v = Number(e.target.value);
  scene.fog.far = v; scene.fog.near = v * 0.16;
  camera.far = v + 4000;
  camera.updateProjectionMatrix();
  viewForm.querySelector('#valFar').textContent = v;
});
viewForm.querySelector('#chkShadows').addEventListener('change', e => {
  renderer.shadowMap.enabled = e.target.checked;
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
});

// ── UI: inspector ─────────────────────────────────────────────────────────
const inspectorBody = document.getElementById('inspectorBody');
function renderInspector() {
  const s = state.selection;
  if (!s) {
    inspectorBody.innerHTML = `
      <div class="kv"><span>Nodes</span><b>${net.nodes.size}</b></div>
      <div class="kv"><span>Road / rail edges</span><b>${net.edges.size}</b></div>
      <div class="kv"><span>Props</span><b>${net.props.length}</b></div>
      <div class="kv"><span>Triangles</span><b>${world ? world.stats.tris.toLocaleString() : '—'}</b></div>
      <div class="kv"><span>Instanced props</span><b>${world ? world.stats.instanced.toLocaleString() : '—'}</b></div>
      <hr>
      <div class="hint" style="color:var(--faint)">Select a road to change its profile, raise it into a bridge, or toggle details. Select a node disc to edit elevation.</div>
      <button class="btn ghost wide" id="btnClear">Clear map</button>`;
    inspectorBody.querySelector('#btnClear').addEventListener('click', () => {
      pushUndo(); net = new Network(); state.selection = null; rebuild();
    });
    return;
  }
  if (s.kind === 'edge') {
    const e = net.edges.get(s.id);
    if (!e) { select(null); return; }
    const P = profileOf(e.profile);
    const S = net.sampleEdge(e, 4);
    const len = S.length > 1 ? S.reduce((a, p, i) => i ? a + Math.hypot(p.x - S[i - 1].x, p.z - S[i - 1].z) : 0, 0) : 0;
    const maxElev = S.reduce((m, p) => Math.max(m, p.y), 0);
    const opts = Object.keys(PROFILES).filter(k => k !== 'rail').map(k =>
      `<option value="${k}" ${k === e.profile ? 'selected' : ''}>${PROFILES[k].name}</option>`).join('');
    inspectorBody.innerHTML = `
      <div class="kv"><span>Kind</span><b>${e.kind === 'rail' ? 'Railway' : 'Road'}</b></div>
      <div class="kv"><span>Length</span><b>${fmt(len)} m</b></div>
      <div class="kv"><span>Right-of-way</span><b>${fmt(P.bands.reduce((a, b) => a + b.w, 0), 1)} m</b></div>
      ${maxElev > 0.4 ? '<div class="kv"><span>Structure</span><b class="ok">Bridge · piers auto</b></div>' : ''}
      ${e.kind === 'road' ? `
      <hr><div class="row"><label>Profile</label><select id="selProfile">${opts}</select></div>
      <div class="row"><label>Bridge lift</label><input type="range" id="rngArch" min="0" max="45" step="1" value="${e.opts.archHeight || 0}"><span class="val" id="valArch">${e.opts.archHeight || 0}</span></div>
      ${P.bumpable ? `<label class="check"><input type="checkbox" id="chkBumps" ${e.opts.bumps ? 'checked' : ''}>Speed bumps</label>` : ''}
      <label class="check"><input type="checkbox" id="chkDetails" ${e.opts.details !== false ? 'checked' : ''}>Lamps · trees · markings</label>` : ''}
      <hr>
      <div class="row">
        <button class="btn ghost" id="btnSplit" style="flex:1">Split at mid</button>
        <button class="btn danger" id="btnDelEdge" style="flex:1">Delete</button>
      </div>`;
    inspectorBody.querySelector('#selProfile')?.addEventListener('change', ev => {
      pushUndo(); e.profile = ev.target.value; rebuild();
    });
    const arch = inspectorBody.querySelector('#rngArch');
    arch?.addEventListener('input', ev => { inspectorBody.querySelector('#valArch').textContent = ev.target.value; });
    arch?.addEventListener('change', ev => { pushUndo(); e.opts.archHeight = Number(ev.target.value); rebuild(); });
    inspectorBody.querySelector('#chkBumps')?.addEventListener('change', ev => { pushUndo(); e.opts.bumps = ev.target.checked; rebuild(); });
    inspectorBody.querySelector('#chkDetails')?.addEventListener('change', ev => { pushUndo(); e.opts.details = ev.target.checked; rebuild(); });
    inspectorBody.querySelector('#btnSplit').addEventListener('click', () => { pushUndo(); net.splitEdge(e.id, 0.5); rebuild(); });
    inspectorBody.querySelector('#btnDelEdge').addEventListener('click', deleteSelection);
    return;
  }
  if (s.kind === 'node') {
    const n = net.nodes.get(s.id);
    if (!n) { select(null); return; }
    inspectorBody.innerHTML = `
      <div class="kv"><span>Node</span><b>${n.id.slice(0, 8)}</b></div>
      <div class="kv"><span>Position</span><b>${fmt(n.x)}, ${fmt(n.z)}</b></div>
      <div class="kv"><span>Connected edges</span><b>${net.degree(n.id)}</b></div>
      <hr>
      <div class="row"><label>Elevation</label><input type="range" id="rngElev" min="-4" max="60" step="0.5" value="${n.elev}"><span class="val" id="valElev">${fmt(n.elev, 1)}</span></div>
      <div class="hint" style="color:var(--faint)">Raise nodes to build ramps, overpasses and bridge approaches.</div>
      <button class="btn danger wide" id="btnDelNode">Delete node & edges</button>`;
    const rng = inspectorBody.querySelector('#rngElev');
    rng.addEventListener('input', ev => { inspectorBody.querySelector('#valElev').textContent = Number(ev.target.value).toFixed(1); });
    rng.addEventListener('change', ev => { pushUndo(); n.elev = Number(ev.target.value); rebuild(); });
    inspectorBody.querySelector('#btnDelNode').addEventListener('click', deleteSelection);
    return;
  }
  if (s.kind === 'prop') {
    const p = net.props.find(q => q.id === s.id);
    if (!p) { select(null); return; }
    const def = PROP_PALETTE.find(d => d.type === p.type);
    inspectorBody.innerHTML = `
      <div class="kv"><span>Prop</span><b>${def?.name || p.type}</b></div>
      <div class="kv"><span>Position</span><b>${fmt(p.x)}, ${fmt(p.z)}</b></div>
      <hr>
      <div class="row"><label>Rotation</label><input type="range" id="rngRot" min="-180" max="180" step="5" value="${Math.round((p.rot * 180 / Math.PI) % 360)}"><span class="val" id="valRot">${Math.round(p.rot * 180 / Math.PI) % 360}°</span></div>
      ${p.type === 'bump' ? `<div class="row"><label>Width</label><input type="range" id="rngBW" min="3" max="30" step="0.5" value="${p.w || 7}"><span class="val" id="valBW">${p.w || 7}</span></div>` : ''}
      <button class="btn danger wide" id="btnDelProp">Delete prop</button>`;
    const rr = inspectorBody.querySelector('#rngRot');
    rr.addEventListener('input', ev => { inspectorBody.querySelector('#valRot').textContent = ev.target.value + '°'; });
    rr.addEventListener('change', ev => { pushUndo(); p.rot = Number(ev.target.value) * Math.PI / 180; rebuild(); });
    const bw = inspectorBody.querySelector('#rngBW');
    bw?.addEventListener('change', ev => { pushUndo(); p.w = Number(ev.target.value); rebuild(); });
    inspectorBody.querySelector('#btnDelProp').addEventListener('click', deleteSelection);
  }
}

// ── status / toast / stats ────────────────────────────────────────────────
const statusHint = document.getElementById('statusHint');
const statsNet = document.getElementById('statsNet');
const statsGpu = document.getElementById('statsGpu');
const statsFps = document.getElementById('statsFps');
const toastEl = document.getElementById('toast');
let toastT = null, lastBuildMs = 0;
function setStatus(t) { statusHint.textContent = t; }
function toast(t) {
  toastEl.textContent = t;
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('show'), 2600);
}
function updateStats() {
  statsNet.textContent = `${net.nodes.size} nodes · ${net.edges.size} edges · ${net.props.length} props`;
}

// ── top bar buttons ───────────────────────────────────────────────────────
document.getElementById('btnUndo').addEventListener('click', doUndo);
document.getElementById('btnExportObj').addEventListener('click', () => {
  toast('Baking OBJ…');
  setTimeout(() => {
    const bytes = exportOBJ(world.group, 'frontier-city');
    toast(`OBJ downloaded (${(bytes / 1048576).toFixed(0)} MB)`);
  }, 20);
});
document.getElementById('btnExportGltf').addEventListener('click', () => { toast('Baking GLB…'); setTimeout(() => exportGLB(world.group), 20); });
const helpOverlay = document.getElementById('helpOverlay');
document.getElementById('btnHelp').addEventListener('click', () => helpOverlay.classList.remove('hidden'));
document.getElementById('btnHelpClose').addEventListener('click', () => helpOverlay.classList.add('hidden'));
helpOverlay.addEventListener('click', e => { if (e.target === helpOverlay) helpOverlay.classList.add('hidden'); });

// ── resize / loop ─────────────────────────────────────────────────────────
function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fly.update(dt);
  // keep the sun + its shadow frustum following the camera
  sun.position.set(fly.pos.x + 380, 620, fly.pos.z + 240);
  sun.target.position.set(fly.pos.x, 0, fly.pos.z);
  sky.position.copy(fly.pos);
  renderer.render(scene, camera);
  fpsAcc += dt; fpsN++;
  if ((fpsT += dt) > 0.5) {
    statsFps.textContent = `${Math.round(fpsN / fpsAcc)} FPS`;
    statsGpu.textContent = `${renderer.info.render.triangles.toLocaleString()} tris · ${renderer.info.render.calls} calls`;
    viewForm.querySelector('#camInfo').textContent = `${fmt(fly.speed)} m/s`;
    fpsAcc = 0; fpsN = 0; fpsT = 0;
  }
}

// ── boot ──────────────────────────────────────────────────────────────────
setTool('select');
net = generateCity(state.city);
rebuild();
fly.focusOn(new THREE.Vector3(0, 0, 0), Math.max(500, state.city.extent * 0.32));
toast('Welcome to Frontier Road Editor — press ? for help');
requestAnimationFrame(loop);
