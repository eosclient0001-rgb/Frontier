/**
 * main.js — Scene, cameras, UI wiring for the T. rex skeleton viewer.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Fog, HemisphereLight, DirectionalLight,
  AmbientLight, Mesh, PlaneGeometry, CircleGeometry, MeshBasicMaterial, Vector3, Vector2, Raycaster,
  ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace, Clock, InstancedMesh, Object3D,
  Matrix4, DynamicDrawUsage, CanvasTexture, GridHelper, Group, SphereGeometry, MeshStandardMaterial,
  RingGeometry, Plane,
} from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { buildSkeleton } from './skeleton.js';
import { Animator } from './animator.js';
import { buildFlesh } from './flesh.js';
import { makeMaterials } from './materials.js';
import { Hunter } from './hunter.js';
import { Prey } from './prey.js';
import { gaitAt, WALK_SPEED, RUN_SPEED } from './gait.js';
import { SPEC } from './spec.js';

const $ = (id) => document.getElementById(id);
const loading = $('loading');
const setLoad = (t) => { $('loadingText').textContent = t; };

/* ------------------------------------------------------------ renderer */
const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);

const scene = new Scene();
const skyTop = new Color(0x8fa8bf), skyHorizon = new Color(0xd9c9a8);
scene.background = skyHorizon.clone();
scene.fog = new Fog(skyHorizon.getHex(), 45, 160);

// gradient sky dome
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#5f7f9e'); gr.addColorStop(0.55, '#b9bfb8'); gr.addColorStop(1, '#dccaa6');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  scene.background = t;
}

const camera = new PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 600);
camera.position.set(-11, 4.2, -6.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 2.2, -0.5);
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 1.2;
controls.maxDistance = 60;

/* -------------------------------------------------------------- lights */
scene.add(new HemisphereLight(0xcfdcef, 0x6b5a44, 0.9));
scene.add(new AmbientLight(0xffffff, 0.12));
const sun = new DirectionalLight(0xfff1dc, 2.6);
sun.position.set(-12, 22, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -11; sun.shadow.camera.right = 11;
sun.shadow.camera.top = 11; sun.shadow.camera.bottom = -11;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 60;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const rim = new DirectionalLight(0xbcd2ff, 0.7);
rim.position.set(10, 8, -14);
scene.add(rim);

/* --------------------------------------------------------------- build */
setLoad('Generating fossil textures…');
await new Promise((r) => requestAnimationFrame(r));
const mats = makeMaterials();

const ground = new Mesh(new PlaneGeometry(600, 600), mats.ground);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new GridHelper(40, 40, 0x3b3226, 0x3b3226);
grid.material.transparent = true; grid.material.opacity = 0.18;
grid.position.y = 0.002;
grid.visible = false;
scene.add(grid);

setLoad('Articulating 300+ bones (FMNH PR 2081 proportions)…');
await new Promise((r) => requestAnimationFrame(r));
const skel = buildSkeleton(mats);
scene.add(skel.rig);
const flesh = buildFlesh(skel, mats.flesh);
flesh.forEach((m) => (m.visible = false));
const anim = new Animator(skel);

const ray = new Raycaster();
const mouse = new Vector2();

/* ------------------------------------------------------------------ prey */
const prey = new Prey({ radius: 0.45 });
const preyMat = new MeshStandardMaterial({ color: 0xd8583c, roughness: 0.45, emissive: 0x3a0d04 });
const preyMesh = new Mesh(new SphereGeometry(prey.radius, 32, 20), preyMat);
preyMesh.castShadow = true;
{ // stripes so rolling is visible
  const c = document.createElement('canvas'); c.width = 64; c.height = 32;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 32);
  g.fillStyle = '#7a1c0c'; for (let i = 0; i < 64; i += 16) g.fillRect(i, 0, 6, 32);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; preyMat.map = t;
}
const preyRing = new Mesh(new RingGeometry(0.55, 0.72, 40).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.55, depthWrite: false }));
preyRing.position.y = 0.01;
const preyGroup = new Group();
preyGroup.add(preyMesh, preyRing);
preyGroup.visible = false;
scene.add(preyGroup);
const hunter = new Hunter(anim, skel, prey);
let hitFlash = 0;
hunter.on((ev, d) => {
  if (ev === 'hit') {
    hitFlash = 1;
    prey.knock(d.kind === 'tail' ? 2.5 : 3.0);
    shake = Math.max(shake, d.kind === 'tail' ? 0.06 : 0.04);
    toast(d.kind === 'tail' ? 'TAIL STRIKE!' : 'BITE!');
  } else if (ev === 'miss') toast(d.kind === 'tail' ? 'tail swipe missed' : 'bite missed', true);
});

/* ------------------------------------------------------------ footprints */
const PRINTS = 64;
const printTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(40,28,16,0.85)';
  const toe = (ang, len, w) => {
    g.save(); g.translate(64, 84); g.rotate(ang);
    g.beginPath(); g.ellipse(0, -len / 2, w, len / 2, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(-w * 0.5, -len + 2); g.lineTo(0, -len - 12); g.lineTo(w * 0.5, -len + 2); g.fill();
    g.restore();
  };
  toe(-0.42, 52, 9); toe(0, 64, 11); toe(0.42, 52, 9);
  g.beginPath(); g.ellipse(64, 88, 16, 13, 0, 0, Math.PI * 2); g.fill();
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
})();
const printMat = new MeshBasicMaterial({ map: printTex, transparent: true, depthWrite: false, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
const prints = new InstancedMesh(new PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2), printMat, PRINTS);
prints.instanceMatrix.setUsage(DynamicDrawUsage);
prints.count = 0;
prints.frustumCulled = false;
scene.add(prints);
let printIdx = 0;
const _o = new Object3D();
let showPrints = true;
let shake = 0;
anim.onFootstep = (side, pos, strength, yaw) => {
  if (showPrints) {
    _o.position.set(pos.x, 0.004, pos.z);
    _o.rotation.set(0, yaw, 0);
    _o.translateZ(-0.12);
    _o.updateMatrix();
    prints.setMatrixAt(printIdx % PRINTS, _o.matrix);
    printIdx++;
    prints.count = Math.min(PRINTS, printIdx);
    prints.instanceMatrix.needsUpdate = true;
  }
  shake = Math.max(shake, 0.02 * strength);
  pulseStep(side);
};

/* ------------------------------------------------------------- view modes */
const viewModes = {
  bones: () => { flesh.forEach((m) => (m.visible = false)); },
  xray: () => { flesh.forEach((m) => (m.visible = true)); mats.flesh.opacity = 0.22; mats.flesh.depthWrite = false; mats.flesh.transparent = true; mats.flesh.needsUpdate = true; },
  flesh: () => { flesh.forEach((m) => (m.visible = true)); mats.flesh.opacity = 1; mats.flesh.depthWrite = true; mats.flesh.transparent = false; mats.flesh.needsUpdate = true; },
};

/* ---------------------------------------------------------------- cameras */
let camMode = 'follow';
const camOffset = new Vector3();
const lastRig = skel.rig.position.clone();
function applyCameraPreset(name) {
  const p = skel.rig.position;
  const h = anim.heading;
  const rot = (x, z) => new Vector3(x * Math.cos(h) + z * Math.sin(h), 0, -x * Math.sin(h) + z * Math.cos(h));
  const presets = {
    side: [rot(-14, -0.5), 2.4], front: [rot(-3, -11), 2.8], rear: [rot(3.5, 12), 3.2],
    top: [rot(-0.3, 0.2), 22], hero: [rot(-6.5, -7.5), 1.2], foot: [rot(-3.2, -1), 0.5],
  };
  const [off, y] = presets[name];
  controls.target.set(p.x, name === 'foot' ? 0.9 : 2.1, p.z);
  camera.position.set(p.x + off.x, y + (name === 'top' ? 0 : 1.5), p.z + off.z);
}

/* ------------------------------------------------------------------- UI */
const ui = {
  speed: $('speed'), speedVal: $('speedVal'), gait: $('gaitName'),
  stats: $('stats'), dutyL: $('dutyL'), dutyR: $('dutyR'),
};
let targetSpeed = 0;
const setTarget = (v) => {
  targetSpeed = Math.max(0, Math.min(RUN_SPEED, v));
  ui.speed.value = targetSpeed;
  anim.setTargetSpeed(targetSpeed);
  document.querySelectorAll('[data-gait]').forEach((b) => b.classList.toggle('active', +b.dataset.v === targetSpeed));
};
ui.speed.addEventListener('input', () => { if (hunting) setHunting(false); setTarget(+ui.speed.value); });
document.querySelectorAll('[data-gait]').forEach((b) => b.addEventListener('click', () => { if (hunting) setHunting(false); setTarget(+b.dataset.v); }));
$('roar').addEventListener('click', () => anim.roar());
const startStudy = (type) => {
  if (hunting) setHunting(false);
  setTarget(0);
  anim.setTurn(0);
  anim.startAction(type);
};
$('look').addEventListener('click', () => startStudy('look'));
$('sniffAir').addEventListener('click', () => startStudy('sniffAir'));
$('sniffGround').addEventListener('click', () => startStudy('sniffGround'));
$('roarInPlace').addEventListener('click', () => startStudy('roarInPlace'));

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('active', x === b));
  viewModes[b.dataset.view]();
}));
document.querySelectorAll('[data-bone]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-bone]').forEach((x) => x.classList.toggle('active', x === b));
  mats.setBonePreset(b.dataset.bone);
}));
$('texT').addEventListener('change', (e) => mats.setTextured(e.target.checked));

/* ------------------------------------------------------- attacks & hunt */
const doTurn = (deg) => { if (!anim.busy) anim.turnBy(deg * Math.PI / 180); };
$('turnL').addEventListener('click', () => doTurn(90));
$('turnR').addEventListener('click', () => doTurn(-90));
$('turn180').addEventListener('click', () => doTurn(180));
const manualBite = () => {
  if (hunting) return;
  anim.startAction('bite', preyGroup.visible ? { target: null } : {});
};
const manualTail = (side) => { if (!hunting) anim.startAction('tailSwipe', { side }); };
$('bite').addEventListener('click', manualBite);
$('tailL').addEventListener('click', () => manualTail(-1));
$('tailR').addEventListener('click', () => manualTail(1));

let hunting = false;
function placePreyAhead(dist = 16) {
  const p = skel.rig.position;
  const a = anim.heading + (Math.random() - 0.5) * 1.2;
  prey.pos.set(p.x - Math.sin(a) * dist, prey.radius, p.z - Math.cos(a) * dist);
  prey.vel.set(0, 0, 0); prey.held = false;
}
function setHunting(v) {
  hunting = v;
  $('hunt').classList.toggle('active', v);
  $('hunt').textContent = v ? '■ Stop hunt' : '▶ Start hunt';
  document.body.classList.toggle('hunting', v);
  if (v) {
    if (!preyGroup.visible) { preyGroup.visible = true; placePreyAhead(); }
    targetSpeed = 0; ui.speed.value = 0;
    document.querySelectorAll('[data-gait]').forEach((b) => b.classList.remove('active'));
  } else { anim.setTargetSpeed(0); targetSpeed = 0; }
  hunter.setEnabled(v);
}
$('hunt').addEventListener('click', () => setHunting(!hunting));
$('spawn').addEventListener('click', () => { preyGroup.visible = true; placePreyAhead(); });
document.querySelectorAll('[data-prey]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-prey]').forEach((x) => x.classList.toggle('active', x === b));
  prey.mode = b.dataset.prey;
}));

// toast messages
const toastEl = $('toast');
let toastT = 0;
function toast(msg, dim = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('dim', dim);
  toastEl.classList.add('show');
  toastT = dim ? 0.9 : 1.4;
}

/* ------------------------------------------- drag / throw the prey ball */
const dragPlane = new Plane(new Vector3(0, 1, 0), 0);
let dragging = false;
const dragHist = [];
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!preyGroup.visible || e.button !== 0) return;
  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  if (ray.intersectObject(preyMesh, false).length) {
    dragging = true; prey.dragging = true; prey.held = false;
    controls.enabled = false;
    dragPlane.constant = -Math.max(prey.radius, prey.pos.y);
    dragHist.length = 0;
    renderer.domElement.setPointerCapture(e.pointerId);
    e.stopPropagation();
  }
}, true);
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = new Vector3();
  if (ray.ray.intersectPlane(dragPlane, hit)) {
    const d = hit.sub(skel.rig.position.clone().setY(hit.y));
    if (d.length() > 65) d.setLength(65);
    prey.pos.set(skel.rig.position.x + d.x, -dragPlane.constant, skel.rig.position.z + d.z);
    dragHist.push({ t: performance.now(), p: prey.pos.clone() });
    if (dragHist.length > 6) dragHist.shift();
  }
});
const endDrag = (e) => {
  if (!dragging) return;
  dragging = false; prey.dragging = false; controls.enabled = true;
  // throw velocity from the last few samples
  if (dragHist.length >= 2) {
    const a = dragHist[0], b = dragHist[dragHist.length - 1];
    const dt = Math.max(0.016, (b.t - a.t) / 1000);
    prey.vel.copy(b.p).sub(a.p).divideScalar(dt).clampLength(0, 14);
    prey.vel.y = Math.min(6, prey.vel.length() * 0.25);
  } else prey.vel.set(0, 0, 0);
};
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);
document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-cam]').forEach((x) => x.classList.toggle('active', x === b));
  camMode = b.dataset.cam === 'free' ? 'free' : 'follow';
  if (b.dataset.cam !== 'free' && b.dataset.cam !== 'follow') applyCameraPreset(b.dataset.cam);
}));
let slow = 1;
$('slowmo').addEventListener('change', (e) => (slow = e.target.checked ? 0.25 : 1));
$('prints').addEventListener('change', (e) => { showPrints = e.target.checked; prints.visible = showPrints; });
$('gridT').addEventListener('change', (e) => (grid.visible = e.target.checked));
let paused = false;
$('pause').addEventListener('click', () => { paused = !paused; $('pause').textContent = paused ? '▶ Play' : '❚❚ Pause'; });
$('hideUI').addEventListener('click', () => document.body.classList.toggle('noui'));

// keyboard: W/S speed up/down, A/D turn, 1-3 gaits, R roar, space pause
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === '1') setTarget(0);
  if (k === '2') setTarget(WALK_SPEED);
  if (k === '3') setTarget(RUN_SPEED);
  if (k === 'r') anim.roar();
  if (k === 'l') startStudy('look');
  if (k === 'y') startStudy('sniffAir');
  if (k === 'u') startStudy('sniffGround');
  if (k === 'o') startStudy('roarInPlace');
  if (k === 'q') doTurn(90);
  if (k === 'e') doTurn(-90);
  if (k === 'f') manualBite();
  if (k === 'z') manualTail(-1);
  if (k === 'c') manualTail(1);
  if (k === 't') setHunting(!hunting);
  if (k === 'h') document.body.classList.toggle('noui');
  if (k === ' ') { paused = !paused; $('pause').textContent = paused ? '▶ Play' : '❚❚ Pause'; e.preventDefault(); }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

/* ------------------------------------------------------------ bone picking */
const tip = $('tip');
let hoverTimer = 0;
renderer.domElement.addEventListener('pointermove', (e) => {
  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  tip.style.left = `${e.clientX + 14}px`;
  tip.style.top = `${e.clientY + 14}px`;
  hoverTimer = 1;
});
renderer.domElement.addEventListener('pointerleave', () => (tip.style.opacity = 0));
function pick() {
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects(skel.bones, false);
  const h = hits.find((x) => x.object.visible && x.object.userData.bone);
  if (h) {
    const b = h.object.userData.bone;
    tip.innerHTML = `<b>${b.name}</b>${b.detail ? `<br><span>${b.detail}</span>` : ''}`;
    tip.style.opacity = 1;
  } else tip.style.opacity = 0;
}

/* ------------------------------------------------------------- footfall UI */
const stepEls = { L: $('stepL'), R: $('stepR') };
function pulseStep(side) {
  const el = stepEls[side];
  el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
}

/* ------------------------------------------------------------------- loop */
const clock = new Clock();
let fpsAcc = 0, fpsN = 0, fps = 60;
function frame() {
  // Match Animator's bounded catch-up window; a hard 0.1 s cap made every
  // one-shot run in slow motion on a throttled tab or software renderer.
  const rdt = Math.min(clock.getDelta(), 0.25);
  const dt = paused ? 0 : rdt * slow;

  // keyboard speed/turn (manual mode only)
  if (!hunting) {
    if (keys.has('w') || keys.has('arrowup')) setTarget(targetSpeed + 3.0 * rdt);
    if (keys.has('s') || keys.has('arrowdown')) setTarget(targetSpeed - 4.0 * rdt);
    const kt = (keys.has('a') || keys.has('arrowleft') ? 1 : 0) - (keys.has('d') || keys.has('arrowright') ? 1 : 0);
    if (kt !== 0 || anim.turnTarget === null) anim.setTurn(kt);
  }

  if (dt > 0) {
    if (hunting) hunter.update(dt);
    anim.update(dt);
    if (preyGroup.visible) prey.update(dt, skel.rig.position);
  }
  if (preyGroup.visible) {
    preyMesh.position.copy(prey.pos);
    preyMesh.rotation.set(prey.roll.x, 0, prey.roll.z);
    preyRing.position.set(prey.pos.x, 0.012, prey.pos.z);
    preyRing.material.opacity = 0.35 + 0.3 * Math.max(0, 1 - prey.pos.y);
    hitFlash *= Math.exp(-rdt * 4);
    preyMat.emissive.setRGB(0.23 + hitFlash, 0.05 + hitFlash * 0.8, 0.02 + hitFlash * 0.4);
  }
  toastT -= rdt;
  if (toastT <= 0) toastEl.classList.remove('show');

  // follow camera: move camera + target by the rig displacement
  const p = skel.rig.position;
  if (camMode === 'follow') {
    const d = p.clone().sub(lastRig);
    camera.position.add(d);
    controls.target.add(d);
  }
  lastRig.copy(p);
  // keep the shadow frustum on the animal
  sun.position.set(p.x - 12, 22, p.z + 8);
  sun.target.position.set(p.x, 0, p.z);

  // footstep camera shake (tiny)
  shake *= Math.exp(-rdt * 10);
  const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
  controls.update();
  camera.position.x += sx; camera.position.y += sy;
  renderer.render(scene, camera);
  camera.position.x -= sx; camera.position.y -= sy;

  // HUD
  const g = anim.gait;
  if (hunting) ui.speed.value = anim.targetSpeed;
  ui.speedVal.textContent = `${anim.speed.toFixed(1)} m/s · ${(anim.speed * 3.6).toFixed(1)} km/h`;
  ui.gait.textContent = anim.gaitLabel;
  ui.gait.dataset.state = anim.gaitLabel.split(' ')[0].toLowerCase();
  fpsAcc += rdt; fpsN++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  ui.stats.innerHTML =
    `<div><span>Stride</span><b>${g.stride.toFixed(2)} m</b></div>` +
    `<div><span>Cadence</span><b>${(anim.speed > 0.05 ? 120 / g.T : 0).toFixed(0)} steps/min</b></div>` +
    `<div><span>Duty factor</span><b>${g.duty.toFixed(2)}</b></div>` +
    `<div><span>Froude</span><b>${g.froude.toFixed(2)}</b></div>` +
    `<div><span>Distance</span><b>${anim.distance.toFixed(0)} m</b></div>` +
    `<div><span>FPS</span><b>${fps}</b></div>` +
    (hunting ? `<div><span>Hunter</span><b>${hunter.state}</b></div><div><span>Hits</span><b>${hunter.stats.hits}/${hunter.stats.bites + hunter.stats.tail}</b></div>` : '');
  ui.dutyL.style.opacity = anim.feet.L.inStance ? 1 : 0.25;
  ui.dutyR.style.opacity = anim.feet.R.inStance ? 1 : 0.25;
  $('aerial').style.opacity = !anim.feet.L.inStance && !anim.feet.R.inStance ? 1 : 0.15;

  if (hoverTimer > 0) { pick(); hoverTimer = 0; }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// counts for the info panel
let boneCount = 0;
skel.bones.forEach(() => boneCount++);
$('specLine').textContent = `${SPEC.specimen} · ${SPEC.totalLength} m · femur ${SPEC.hindlimb.femur} m · skull ${SPEC.skull.length} m · ${SPEC.counts.cervical}+${SPEC.counts.dorsal}+${SPEC.counts.sacral}+${SPEC.counts.caudal} vertebrae`;

loading.classList.add('done');
setTimeout(() => loading.remove(), 700);
window.__trex = { skel, anim, scene, camera, renderer, hunter, prey };
frame();
