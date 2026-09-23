/* ═══════════════ FRONTIER TYRE FORGE — main application ═══════════════ */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { tireSize, buildProfile, wearLabel, clamp } from './tiremath.js';
import { buildTireGeometry, buildRim } from './geometry.js';
import { drawSidewall, drawBlueprint } from './textures.js';
import { PRESETS, presetById, CATS, renderTread, cloneOps } from './patterns.js';
import { TreadEditor } from './editor.js';

const $ = id => document.getElementById(id);

/* ── state ─────────────────────────────────────────────────── */
const DEFAULT = presetById('grizzlymagnum');
const state = {
  width: 225, aspect: 45, rim: 17,
  wear: 0, depth: DEFAULT.depth, repeat: DEFAULT.rep,
  presetId: DEFAULT.id, source: 'preset',
  ops: cloneOps(DEFAULT.build()),
  customName: 'Custom Tread',
  mirror: true,
  accent: '#e23b2e', rimColor: '#383d45',
  showRim: true, spin: false, rpm: 24,
};
let currentSize = tireSize(state.width, state.aspect, state.rim);

/* ── renderer / scene ──────────────────────────────────────── */
const canvas3d = $('scene3d');
const renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true, preserveDrawingBuffer: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0b0d);
scene.fog = new THREE.Fog(0x0a0b0d, 2600, 7800);

const camera = new THREE.PerspectiveCamera(38, 1, 1, 30000);
const controls = new OrbitControls(camera, canvas3d);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.52;
controls.minDistance = 150;
controls.maxDistance = 6000;

/* environment for metal reflections */
{
  const pm = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x14161a);
  const plane = (w, h, col, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col }));
    m.position.copy(pos); m.lookAt(0, 0, 0); env.add(m);
  };
  plane(3000, 900, 0xffffff, new THREE.Vector3(0, 1400, 0));
  plane(1600, 1200, 0x6f8db3, new THREE.Vector3(-1600, 400, 800));
  plane(1600, 1000, 0xffc79e, new THREE.Vector3(1700, 300, -600));
  plane(2400, 600, 0x39424e, new THREE.Vector3(0, 200, -1800));
  scene.environment = pm.fromScene(env, 0.05).texture;
  pm.dispose();
}

/* lights */
const hemi = new THREE.HemisphereLight(0x8fa3b8, 0x15161a, 0.55);
const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
const fill = new THREE.DirectionalLight(0x86b6ff, 0.7);
scene.add(hemi, key, key.target, fill);

/* ground */
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(2600, 72).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x141519, roughness: 0.96, metalness: 0 }));
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.PolarGridHelper(2600, 24, 14, 64, 0x232730, 0x1a1d24);
grid.position.y = 0.8;
scene.add(grid);

/* wheel assembly */
const wheel = new THREE.Group();
scene.add(wheel);
let tireMesh = null, rimGroup = null;

/* ── tread textures (one tile feeds map + bump) ────────────── */
const TILE = 640;
const tileCanvas = document.createElement('canvas');
tileCanvas.width = tileCanvas.height = TILE;
const tileCtx = tileCanvas.getContext('2d');

const treadTex = new THREE.CanvasTexture(tileCanvas);
treadTex.wrapS = THREE.RepeatWrapping;
treadTex.colorSpace = THREE.SRGBColorSpace;
const bumpTex = new THREE.CanvasTexture(tileCanvas);
bumpTex.wrapS = THREE.RepeatWrapping;

const sideCanvas = document.createElement('canvas');
sideCanvas.width = sideCanvas.height = 1024;
const sideTex = new THREE.CanvasTexture(sideCanvas);
sideTex.colorSpace = THREE.SRGBColorSpace;

const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
for (const t of [treadTex, bumpTex, sideTex]) t.anisotropy = maxAniso;

const treadMat = new THREE.MeshStandardMaterial({
  map: treadTex, bumpMap: bumpTex, bumpScale: 2.5,
  roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide,
});
const sideMat = new THREE.MeshStandardMaterial({
  map: sideTex, roughness: 0.88, metalness: 0.0, side: THREE.DoubleSide,
});

/* ── rebuild / refresh pipeline ────────────────────────────── */
function rebuildTyre() {
  const sz = tireSize(state.width, state.aspect, state.rim);
  currentSize = sz;
  const prof = buildProfile(sz);

  const geo = buildTireGeometry(sz);
  if (tireMesh) {
    tireMesh.geometry.dispose();
    tireMesh.geometry = geo;
  } else {
    tireMesh = new THREE.Mesh(geo, [treadMat, sideMat]);
    tireMesh.castShadow = true;
    tireMesh.receiveShadow = true;
    wheel.add(tireMesh);
  }
  wheel.position.y = sz.Ro;

  /* rim */
  if (rimGroup) {
    wheel.remove(rimGroup);
    rimGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    rimGroup = null;
  }
  if (state.showRim) {
    rimGroup = buildRim(sz, {
      color: new THREE.Color(state.rimColor),
      accent: new THREE.Color(state.accent),
      spokes: 5,
    });
    rimGroup.traverse(o => { if (o.isMesh) o.castShadow = true; });
    wheel.add(rimGroup);
  }

  /* lighting + camera framing follows size */
  key.position.set(sz.Ro * 2.3, sz.Ro * 3.2, sz.Ro * 2.1);
  key.target.position.set(0, sz.Ro * 0.9, 0);
  const sc = key.shadow.camera;
  sc.left = sc.bottom = -sz.Ro * 2.3;
  sc.right = sc.top = sz.Ro * 2.3;
  sc.near = 10; sc.far = sz.Ro * 14;
  sc.updateProjectionMatrix();
  fill.position.set(-sz.Ro * 2.6, sz.Ro * 1.4, -sz.Ro * 2.4);
  controls.target.set(0, sz.Ro * 0.92, 0);

  drawSidewall(sideCanvas, sz, { name: displayName(), accent: state.accent });
  sideTex.needsUpdate = true;
  drawBlueprint($('blueprint'), sz, prof);
  updateSpecs(sz);
}

function frameCamera() {
  const sz = currentSize;
  camera.position.set(sz.Ro * 2.05, sz.Ro * 1.30, sz.Ro * 3.05);
  controls.target.set(0, sz.Ro * 0.92, 0);
}

function refreshTread() {
  renderTread(tileCtx, TILE, TILE, state.ops, state.wear, { mirror: state.mirror });
  treadTex.needsUpdate = true;
  bumpTex.needsUpdate = true;
  treadTex.repeat.set(state.repeat, 1);
  bumpTex.repeat.set(state.repeat, 1);
  treadMat.bumpScale = state.depth * 0.42 * (1 - state.wear * 0.92);
  treadMat.roughness = 0.94 - state.wear * 0.42;
  drawStrip();
  updateHUD();
}

function redrawSidewall() {
  drawSidewall(sideCanvas, currentSize, { name: displayName(), accent: state.accent });
  sideTex.needsUpdate = true;
}

function updateSpecs(sz) {
  $('sizeChip').textContent = sz.label;
  $('odChip').textContent = `OD ${Math.round(sz.OD)} mm`;
  $('specGrid').innerHTML = [
    ['Overall Ø', `${Math.round(sz.OD)} mm`],
    ['Circumference', `${Math.round(sz.circ)} mm`],
    ['Sidewall', `${Math.round(sz.H)} mm`],
    ['Rim Ø', `${Math.round(sz.Rr * 2)} mm`],
    ['Revs / km', sz.revPerKm.toFixed(0)],
    ['Tread width', `${Math.round(sz.W * 0.8)} mm`],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}

function updateHUD() {
  $('wearChip').textContent = wearLabel(state.wear);
  $('stripWear').textContent = `WEAR ${Math.round(state.wear * 100)}% — ${wearLabel(state.wear)}`;
  const p = state.source === 'preset' ? presetById(state.presetId) : null;
  $('ovName').textContent = displayName().toUpperCase();
  $('ovSize').textContent = currentSize.label;
  const cat = $('ovCat');
  if (p) {
    cat.textContent = CATS[p.cat].label;
    cat.style.background = CATS[p.cat].color;
    cat.style.color = (p.cat === 'winter' || p.cat === 'wet') ? '#10151a' : '#fff';
    $('ovDesc').textContent = p.desc;
    $('ovStats').innerHTML = [['DRY', p.dry], ['WET', p.wet], ['DURABILITY', p.dur]]
      .map(([k, v]) => `<div class="stat"><span>${k}</span><span class="bar"><i style="width:${v * 10}%"></i></span><span>${v}</span></div>`)
      .join('');
  } else {
    cat.textContent = 'CUSTOM';
    cat.style.background = '#ff5722';
    cat.style.color = '#fff';
    $('ovDesc').textContent = 'User-designed tread — built in the editor. Export it as PNG or JSON.';
    $('ovStats').innerHTML = '';
  }
}

function drawStrip() {
  const c = $('stripCanvas');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const h = c.height, w = h;
  for (let i = 0; i * w < c.width; i++) ctx.drawImage(tileCanvas, i * w, 0, w, h);
}

function displayName() {
  return state.source === 'preset' ? presetById(state.presetId).name : state.customName;
}

/* ── preset cards + filters ────────────────────────────────── */
function buildPresetCards() {
  const gridEl = $('presetGrid');
  const off = document.createElement('canvas');
  off.width = off.height = 200;
  const offCtx = off.getContext('2d');
  for (const p of PRESETS) {
    const card = document.createElement('div');
    card.className = 'preset-card';
    card.dataset.id = p.id;
    card.dataset.cat = p.cat;
    const cv = document.createElement('canvas');
    cv.width = 220; cv.height = 62;
    renderTread(offCtx, 200, 200, p.build(), 0, { mirror: true });
    const cctx = cv.getContext('2d');
    for (let i = 0; i < 4; i++) cctx.drawImage(off, i * 55, 0, 62, 62);
    const body = document.createElement('div');
    body.className = 'pc-body';
    body.innerHTML = `<div class="pc-name">${p.name}</div>
      <div class="pc-cat" style="color:${CATS[p.cat].color}">${CATS[p.cat].label}</div>`;
    card.append(cv, body);
    card.addEventListener('click', () => selectPreset(p.id));
    gridEl.appendChild(card);
  }
  /* filter chips */
  const chips = $('filterChips');
  const cats = [['all', 'All'], ...Object.entries(CATS).map(([k, v]) => [k, v.label])];
  for (const [id, label] of cats) {
    const b = document.createElement('button');
    b.textContent = label;
    if (id === 'all') b.classList.add('on');
    b.addEventListener('click', () => {
      chips.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      gridEl.querySelectorAll('.preset-card').forEach(c => {
        c.style.display = (id === 'all' || c.dataset.cat === id) ? '' : 'none';
      });
    });
    chips.appendChild(b);
  }
}

function selectPreset(id) {
  const p = presetById(id);
  state.presetId = id;
  state.source = 'preset';
  state.ops = cloneOps(p.build());
  state.depth = p.depth;
  state.repeat = p.rep;
  $('sDepth').value = p.depth;  $('oDepth').textContent = `${p.depth.toFixed(1)} mm`;
  $('sRepeat').value = p.rep;   $('oRepeat').textContent = `${p.rep}×`;
  document.querySelectorAll('.preset-card').forEach(c =>
    c.classList.toggle('sel', c.dataset.id === id));
  refreshTread();
  redrawSidewall();
  editor.render();
}

/* ── editor hookup ─────────────────────────────────────────── */
const editor = new TreadEditor($('editorCanvas'), {
  state,
  displayName,
  ensureCustom() {
    if (state.source !== 'editor') {
      state.ops = cloneOps(state.ops);
      state.source = 'editor';
      document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('sel'));
    }
  },
  refresh: refreshTread,
});

$('btnUndo').addEventListener('click', () => editor.undo());
$('btnClear').addEventListener('click', () => editor.clear());
$('btnImport').addEventListener('click', () => editor.importCurrent());
$('btnPng').addEventListener('click', () => editor.exportPNG(state.wear));
$('btnJson').addEventListener('click', () => editor.exportJSON(currentSize.label));
$('customName').addEventListener('input', e => {
  state.customName = e.target.value || 'Custom Tread';
  if (state.source === 'editor') { updateHUD(); redrawSidewall(); }
});
$('cbMirror').addEventListener('change', e => {
  state.mirror = e.target.checked;
  refreshTread();
  editor.render();
});
for (const [sl, out, fmt] of [
  ['sEW', 'oEW', v => v.toFixed(3)],
  ['sES', 'oES', v => v.toFixed(3)],
  ['sEA', 'oEA', v => `${Math.round(v)}°`],
  ['sEN', 'oEN', v => `${Math.round(v)}`],
]) {
  $(sl).addEventListener('input', e => $(out).textContent = fmt(parseFloat(e.target.value)));
}

/* ── left panel wiring ─────────────────────────────────────── */
function onSize() {
  state.width = +$('sWidth').value;
  state.aspect = +$('sAspect').value;
  state.rim = +$('sRim').value;
  $('oWidth').textContent = `${state.width} mm`;
  $('oAspect').textContent = `${state.aspect} %`;
  $('oRim').textContent = `${state.rim} in`;
  rebuildTyre();
  updateHUD();
}
$('sWidth').addEventListener('input', onSize);
$('sAspect').addEventListener('input', onSize);
$('sRim').addEventListener('input', onSize);

$('sWear').addEventListener('input', e => {
  state.wear = +e.target.value / 100;
  $('oWear').textContent = `${e.target.value} %`;
  refreshTread();
});
$('sDepth').addEventListener('input', e => {
  state.depth = +e.target.value;
  $('oDepth').textContent = `${state.depth.toFixed(1)} mm`;
  refreshTread();
});
$('sRepeat').addEventListener('input', e => {
  state.repeat = +e.target.value;
  $('oRepeat').textContent = `${state.repeat}×`;
  refreshTread();
});
$('cAccent').addEventListener('input', e => {
  state.accent = e.target.value;
  redrawSidewall();
  if (state.showRim) onSize();
});
$('cRim').addEventListener('input', e => {
  state.rimColor = e.target.value;
  if (state.showRim) onSize();
});
$('cbRim').addEventListener('change', e => { state.showRim = e.target.checked; rebuildTyre(); });
$('cbSpin').addEventListener('change', e => { state.spin = e.target.checked; });
$('sRpm').addEventListener('input', e => {
  state.rpm = +e.target.value;
  $('oRpm').textContent = `${state.rpm} rpm`;
});
$('btnCam').addEventListener('click', frameCamera);
$('btnShot').addEventListener('click', () => {
  renderer.render(scene, camera);
  const a = document.createElement('a');
  a.href = renderer.domElement.toDataURL('image/png');
  a.download = `frontier-tyre-${displayName().replace(/\s+/g, '-').toLowerCase()}.png`;
  a.click();
});

/* ── resize ────────────────────────────────────────────────── */
function resize() {
  const vp = $('viewport');
  const w = vp.clientWidth, h = vp.clientHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const strip = $('stripCanvas');
  strip.width = Math.max(600, w - 36);
  drawStrip();
}
new ResizeObserver(resize).observe($('viewport'));

/* ── boot ──────────────────────────────────────────────────── */
buildPresetCards();
document.querySelector(`.preset-card[data-id="${state.presetId}"]`)
  ?.classList.add('sel');
$('sDepth').value = state.depth;
$('oDepth').textContent = `${state.depth.toFixed(1)} mm`;
$('sRepeat').value = state.repeat;
$('oRepeat').textContent = `${state.repeat}×`;
onSize();
frameCamera();
refreshTread();

const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state.spin) wheel.rotation.x -= state.rpm * (Math.PI * 2 / 60) * dt;
  controls.update();
  renderer.render(scene, camera);
}
tick();
