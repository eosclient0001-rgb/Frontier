import * as THREE from 'three';
import { World } from './world.js';
import { buildCarModel, ArcadeCar } from './car.js';
import { groundAt, frameAt, centerX, surfaceYAt, nextSplit, nextCrossing, clamp } from './trackMath.js';

// ─── renderer / scene — modern daylight city, deliberately NOT neon ────────
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xafd3e6);
scene.fog = new THREE.Fog(0xcfe0ea, 190, 880);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 2200);

const hemi = new THREE.HemisphereLight(0xd8ecff, 0x8a7f6d, 0.95); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dd, 2.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -110; sun.shadow.camera.right = 110;
sun.shadow.camera.top = 110; sun.shadow.camera.bottom = -110;
sun.shadow.camera.far = 420; sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);

const world = new World(scene);
const carModel = buildCarModel(0xd8401c);
scene.add(carModel);
const car = new ArcadeCar(carModel);
car.place(12, 0);

// ─── input (real driving inputs — no lane snapping anywhere) ─────────────────
const keys = {};
const touch = { steer: 0, throttle: 0, handbrake: false };
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyR') resetCar();
  if (e.code === 'KeyC') cycleCamera();
  if (e.code === 'KeyM') toggleAudio();
  if (e.code === 'Escape' && running) togglePause();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
function bindTouch(id, on, off) {
  const el = document.getElementById(id);
  const start = (e) => { e.preventDefault(); el.classList.add('on'); on(); };
  const end = (e) => { e.preventDefault(); el.classList.remove('on'); off(); };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', end); el.addEventListener('pointerleave', end); el.addEventListener('pointercancel', end);
}
bindTouch('t-left', () => touch.steer = -1, () => { if (touch.steer < 0) touch.steer = 0; });
bindTouch('t-right', () => touch.steer = 1, () => { if (touch.steer > 0) touch.steer = 0; });
bindTouch('t-gas', () => touch.throttle = 1, () => { if (touch.throttle > 0) touch.throttle = 0; });
bindTouch('t-brake', () => touch.throttle = -1, () => { if (touch.throttle < 0) touch.throttle = 0; });
bindTouch('t-drift', () => touch.handbrake = true, () => touch.handbrake = false);
if ('ontouchstart' in window) document.getElementById('touch').classList.remove('hidden');

function readInput() {
  let steer = 0, throttle = 0;
  if (keys.KeyA || keys.ArrowLeft) steer -= 1;
  if (keys.KeyD || keys.ArrowRight) steer += 1;
  if (keys.KeyW || keys.ArrowUp) throttle += 1;
  if (keys.KeyS || keys.ArrowDown) throttle -= 1;
  steer += touch.steer; throttle += touch.throttle;
  return {
    steer: clamp(steer, -1, 1), throttle: clamp(throttle, -1, 1),
    handbrake: !!(keys.Space || touch.handbrake),
    boost: !!(keys.ShiftLeft || keys.ShiftRight),
  };
}

// ─── tiny engine synth (starts on the Start button — a user gesture) ────────
let audio = null, muted = false;
function startAudio() {
  if (audio) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const osc2 = ctx.createOscillator(); osc2.type = 'square';
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 420;
    const gain = ctx.createGain(); gain.gain.value = 0.0;
    osc.connect(filter); osc2.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc2.start();
    audio = { ctx, osc, osc2, filter, gain };
  } catch { /* audio is optional */ }
}
function toggleAudio() { muted = !muted; if (audio) audio.gain.gain.value = 0; }
function updateAudio(input) {
  if (!audio || muted) return;
  const rpm = 55 + Math.abs(car.speed) * 2.1 + (input.throttle > 0 ? 14 : 0);
  audio.osc.frequency.value = rpm;
  audio.osc2.frequency.value = rpm * 0.5 + 2;
  audio.filter.frequency.value = 320 + Math.abs(car.speed) * 9;
  audio.gain.gain.value = running && !paused ? 0.045 : 0.0;
}

// ─── game state / HUD ────────────────────────────────────────────────────────
let running = false, paused = false, elapsed = 0, topSpeed = 0, camMode = 0;
const $ = (id) => document.getElementById(id);
const camModes = ['CHASE CAM', 'LOW CHASE', 'HOOD CAM'];
function resetCar() {
  const s = Math.max(12, car.pos.z);
  car.place(s, 0);
  car.lastBranchSide = 0;
}
function cycleCamera() { camMode = (camMode + 1) % 3; $('gear').textContent = `NFS ARCADE · ${camModes[camMode]}`; }
function togglePause() { paused = !paused; $('paused').classList.toggle('hidden', !paused); }
$('start-btn').addEventListener('click', () => {
  $('overlay').classList.add('hidden');
  $('hud').classList.remove('hidden');
  running = true; startAudio();
  $('toast').textContent = 'GO!'; $('toast').classList.remove('hidden');
  setTimeout(() => $('toast').classList.add('hidden'), 1100);
});

const mini = $('minimap').getContext('2d');
function drawMinimap() {
  const w = 230, h = 150; mini.clearRect(0, 0, w, h);
  const s0 = car.pos.z - 40, span = 640;
  const px = (s) => w / 2 + (centerX(s) - centerX(car.pos.z)) * 0.32;
  const py = (s) => h - 12 - ((s - s0) / span) * (h - 20);
  // perpendicular railways (red) + splits (orange) ahead
  for (let s = s0; s < s0 + span; s += 8) {
    const nc = nextCrossing(s);
    if (nc.dist < 8 && nc.dist > -8) { mini.strokeStyle = nc.type === 'LEVEL' ? '#ff5040' : '#ff9a8a'; mini.lineWidth = 3; mini.beginPath(); mini.moveTo(8, py(s)); mini.lineTo(w - 8, py(s)); mini.stroke(); }
    const ns = nextSplit(s);
    if (ns.dist < 8 && ns.dist > -8) { mini.strokeStyle = '#ff7a1a'; mini.lineWidth = 4; mini.beginPath(); mini.moveTo(px(s) - 16, py(s)); mini.lineTo(px(s) + 16, py(s)); mini.stroke(); }
  }
  mini.strokeStyle = '#e8eef2'; mini.lineWidth = 7; mini.beginPath();
  for (let s = s0; s <= s0 + span; s += 14) { const x = px(s), y = py(s); s === s0 ? mini.moveTo(x, y) : mini.lineTo(x, y); }
  mini.stroke();
  mini.fillStyle = '#ffd23e'; mini.beginPath(); mini.arc(px(car.pos.z), py(car.pos.z), 5, 0, 7); mini.fill();
  mini.fillStyle = 'rgba(255,255,255,0.75)'; mini.font = '9px Arial'; mini.fillText('TRACK AHEAD · RED = RAIL CROSSING · ORANGE = SPLIT', 8, 12);
}

// ─── crash interactions (level-crossing trains + road traffic) ──────────────
let lastTrainHit = -9, lastTrafficHit = -9;
function checkCrashes(prevSpeed) {
  const s = car.pos.z;
  // perpendicular train AT track level — this is the deadly one
  for (const c of world.crossings) {
    const st = c.state;
    if (!st || st.type !== 'LEVEL' || !st.active) continue;
    if (Math.abs(s - st.s) < 4.6) {
      const f = frameAt(st.s);
      const uCross = (car.pos.x - f.cx) * f.rx + (car.pos.z - st.s) * f.rz;
      if (Math.abs(uCross - st.trainX) < 23 && elapsed - lastTrainHit > 1.6) {
        lastTrainHit = elapsed;
        car.vel.multiplyScalar(0.12); car.vel.y = 3;
        car.grounded = false; car.barrierHit = 1;
        showToast('💥 TRAIN HIT!');
      }
    }
  }
  // road traffic
  for (const t of world.traffic) {
    if (Math.abs(t.s - s) < 4.4 && Math.abs(t.u - (car.pos.x - centerX(s))) < 2.3 && car.grounded) {
      const rel = car.speed - t.speed;
      if (rel > 3 && elapsed - lastTrafficHit > 1.2) {
        lastTrafficHit = elapsed;
        car.vel.multiplyScalar(0.45); car.barrierHit = 0.9;
        t.speed += 4; showToast('💥 TRAFFIC HIT');
      }
    }
  }
  // boost pads
  for (const p of world.pads) {
    if (Math.abs(p.s - s) < 4.5 && Math.abs(p.u - (car.pos.x - centerX(s))) < 2.6 && car.grounded) {
      if (car.padBoost <= 0) { car.padBoost = 0.85; car.nitro = Math.min(100, car.nitro + 22); showSmall('⚡ BOOST PAD'); }
    }
  }
}
let toastTimer = null;
function showToast(txt) {
  $('toast').textContent = txt; $('toast').classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 1000);
}
function showSmall(txt) { showToast(txt); }

// ─── camera — smooth NFS chase, widens with speed, kicks on nitro ───────────
const camPos = new THREE.Vector3(0, 18, -12), camLook = new THREE.Vector3();
let fov = 68, shake = 0;
function updateCamera(dt) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  let dist = 10.5, height = 4.2;
  if (camMode === 1) { dist = 8; height = 2.6; }
  if (camMode === 2) { dist = -0.4; height = 1.35; }
  const target = new THREE.Vector3(car.pos.x - fx * dist, car.pos.y + height, car.pos.z - fz * dist);
  if (camMode === 2) camPos.copy(target);
  else camPos.lerp(target, 1 - Math.exp(-(car.boosting ? 4.2 : 5.5) * dt));
  camera.position.copy(camPos);
  camLook.lerp(new THREE.Vector3(car.pos.x + fx * 14, car.pos.y + 1.4, car.pos.z + fz * 14), 1 - Math.exp(-8 * dt));
  camera.lookAt(camLook);
  const targetFov = 68 + clamp(car.speed / 96, 0, 1) * 13 + (car.boosting ? 5 : 0);
  fov = THREE.MathUtils.lerp(fov, targetFov, 1 - Math.exp(-4 * dt));
  camera.fov = fov; camera.updateProjectionMatrix();
  shake = Math.max(0, shake - dt * 2.4);
  if (car.barrierHit > 0.4) shake = Math.max(shake, 0.14);
  if (car.offroadRumble()) shake = Math.max(shake, 0.05);
  camera.position.x += (Math.random() - 0.5) * shake;
  camera.position.y += (Math.random() - 0.5) * shake * 0.7;
}
// small helper hung off the car for off-road rumble
car.offroadRumble = () => car.offRoadTime > 0.1 && car.speed > 8;

// sun + shadow frustum follows the car
function updateSun() {
  sun.position.set(car.pos.x + 70, 130, car.pos.z - 45);
  sun.target.position.copy(car.pos);
}

// ─── warnings / HUD refresh ──────────────────────────────────────────────────
function fmtTime(t) { const m = Math.floor(t / 60), ss = (t % 60).toFixed(1); return `${m}:${ss.padStart(4, '0')}`; }
let hudTick = 0;
function updateHUD(dt, ground) {
  hudTick += dt; if (hudTick < 0.08) return; hudTick = 0;
  $('speed').textContent = car.speedKmh;
  $('stat-dist').textContent = (Math.max(0, car.maxS) / 1000).toFixed(2) + ' km';
  $('stat-time').textContent = fmtTime(elapsed);
  $('stat-drift').textContent = Math.floor(car.driftScore).toLocaleString();
  topSpeed = Math.max(topSpeed, car.speedKmh); $('stat-top').textContent = topSpeed + ' km/h';
  $('nitro-fill').style.width = car.nitro.toFixed(0) + '%';
  $('drift-fill').style.width = clamp(Math.abs(car.slip) / 12 * 100, 0, 100) + '%';
  $('state-label').textContent = !car.grounded ? 'AIRBORNE' : car.drifting ? 'DRIFTING!' : ground.split ? (ground.splitType === 'VERT' ? 'SPLIT · UP/DOWN' : 'SPLIT · Y') : ground.surface === 'track' ? 'GRIP' : 'OFF TRACK';
  $('offroad').classList.toggle('hidden', !(car.offRoadTime > 1.2));

  // warning banner — splits and, more urgently, gated train crossings
  const ns = nextSplit(car.pos.z), nc = nextCrossing(car.pos.z);
  let warn = '';
  if (nc.type === 'LEVEL' && nc.dist > 0 && nc.dist < 210) {
    const c = world.crossings.find((x) => x.state && x.state.k === Math.round((nc.s - 175) / 430));
    if (c && (c.state.closed || c.state.active)) warn = '🚦 TRAIN CROSSING AHEAD — GATES DOWN';
    else if (nc.dist < 130) warn = '⚠ RAIL CROSSING AHEAD';
  }
  if (!warn && ns.dist > 0 && ns.dist < 190) warn = ns.type === 'VERT' ? '🔀 UP / DOWN SPLIT AHEAD — PICK A DECK' : '🔀 Y-SPLIT AHEAD — PICK A SIDE';
  if (!warn && nc.type === 'BRIDGE' && nc.dist > 0 && nc.dist < 120) warn = '🚝 TRAIN PASSING OVERHEAD';
  $('warning').textContent = warn;
  $('warning').classList.toggle('hidden', !warn);
  $('vignette').style.boxShadow = car.barrierHit > 0.25 ? 'inset 0 0 120px rgba(200,30,10,0.55)' : 'inset 0 0 120px rgba(180,20,10,0)';
  drawMinimap();
}

// ─── main loop ───────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const input = readInput();
  if (running && !paused) {
    elapsed += dt;
    const ground = car.update(dt, input);
    checkCrashes();
    world.update(dt, elapsed, car.pos);
    updateAudio(input);
    updateHUD(dt, ground);
    if (car.pos.y < -8) resetCar(); // fell to the streets / through the world
  } else {
    // idle turntable behind the menu
    const t = clock.elapsedTime * 0.14;
    camera.position.set(car.pos.x + Math.sin(t) * 11, car.pos.y + 4.5, car.pos.z + Math.cos(t) * 11);
    camera.lookAt(car.pos.x, car.pos.y + 1, car.pos.z);
    world.update(0, 0, car.pos);
  }
  updateSun();
  if (running && !paused) updateCamera(dt);
  renderer.render(scene, camera);
}
loop();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
