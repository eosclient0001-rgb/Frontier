import * as THREE from 'three';
import { TrackSystem, makeGround, STEP, clamp } from './track.js?v=3';
import { ParallelTrains } from './trains.js?v=3';
import { Car } from './car.js?v=3';

/* ============================================================
   FRONTIER GP — infinite procedural wide-track arcade racer
   WipEout-style track · modern daylight city (no neon)
   NFS-style free-driving arcade car physics
   ============================================================ */

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfe2f2);
scene.fog = new THREE.Fog(0xcfe2f2, 130, 640);

const camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, .1, 3000);
camera.position.set(0, 6, -14);

const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x707a72, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -95; sun.shadow.camera.right = 95;
sun.shadow.camera.top = 95; sun.shadow.camera.bottom = -95;
sun.shadow.camera.far = 420; sun.shadow.bias = -0.0004;
scene.add(sun); scene.add(sun.target);

/* ground plane that follows the player */
const ground = makeGround();
scene.add(ground);

/* soft daylight clouds */
const clouds = new THREE.Group(); scene.add(clouds);
{
  const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: .82 });
  const cg = new THREE.SphereGeometry(1, 10, 8);
  for (let i = 0; i < 18; i++) {
    const cl = new THREE.Group();
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const s = new THREE.Mesh(cg, cm);
      s.position.set(k * 9 - n * 4, Math.random() * 3, Math.random() * 6);
      s.scale.set(9 + Math.random() * 10, 2.6 + Math.random() * 1.6, 6 + Math.random() * 4);
      cl.add(s);
    }
    cl.position.set((Math.random() - .5) * 1100, 95 + Math.random() * 55, (Math.random() - .5) * 1100);
    clouds.add(cl);
  }
}

/* ---------------- world systems ---------------- */
const track = new TrackSystem(scene);
const car = new Car(scene);
car.hint = 3;
track.update(3);
car.resetToTrack(track);
const railTraffic = new ParallelTrains(scene, track);

/* ---------------- input ---------------- */
const keys = {};
let touch = { left: false, right: false, gas: false, brake: false, drift: false };
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyR') car.resetToTrack(track);
  if (e.code === 'KeyC') camMode = (camMode + 1) % 3;
  if (e.code === 'KeyM') toggleAudio();
});
addEventListener('keyup', e => { keys[e.code] = false; });
function bindTouch(id, prop) {
  const el = document.getElementById(id);
  const on = e => { e.preventDefault(); touch[prop] = true; };
  const off = e => { e.preventDefault(); touch[prop] = false; };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off); el.addEventListener('pointerleave', off); el.addEventListener('pointercancel', off);
}
bindTouch('tLeft', 'left'); bindTouch('tRight', 'right'); bindTouch('tGas', 'gas');
bindTouch('tBrake', 'brake'); bindTouch('tDrift', 'drift');

function readInput() {
  const steer = ((keys.KeyD || keys.ArrowRight || touch.right) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft || touch.left) ? 1 : 0);
  return {
    steer,
    throttle: (keys.KeyW || keys.ArrowUp || touch.gas) ? 1 : 0,
    brake: (keys.KeyS || keys.ArrowDown || touch.brake) ? 1 : 0,
    handbrake: !!keys.Space || touch.drift,
    boost: !!(keys.ShiftLeft || keys.ShiftRight),
  };
}

/* ---------------- engine audio (tiny synth, M to mute) ---------------- */
let audio = null, audioOn = true;
function initAudio() {
  if (audio) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const osc2 = ctx.createOscillator(); osc2.type = 'square';
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 420;
    const gain = ctx.createGain(); gain.gain.value = 0;
    osc.connect(filter); osc2.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc2.start();
    audio = { ctx, osc, osc2, filter, gain };
  } catch (e) { /* audio unavailable */ }
}
function toggleAudio() { audioOn = !audioOn; if (audio) audio.gain.gain.value = 0; }
function updateAudio(speedKmh, throttle) {
  if (!audio || !audioOn) return;
  const rpm = 50 + speedKmh * 1.15 + throttle * 14;
  audio.osc.frequency.setTargetAtTime(rpm, audio.ctx.currentTime, .05);
  audio.osc2.frequency.setTargetAtTime(rpm * .5 + 1, audio.ctx.currentTime, .05);
  audio.filter.frequency.setTargetAtTime(300 + speedKmh * 6, audio.ctx.currentTime, .08);
  audio.gain.gain.setTargetAtTime(driving ? .028 + throttle * .02 : 0, audio.ctx.currentTime, .09);
}

/* ---------------- HUD ---------------- */
const $ = id => document.getElementById(id);
const toastEl = $('toast');
let toastTimer = 0, lastToastKey = '';
function showToast(main, sub, cls = '', key = main, hold = 2.6) {
  if (key === lastToastKey && toastTimer > 0) return;
  lastToastKey = key; toastTimer = hold;
  $('toastMain').textContent = main; $('toastSub').textContent = sub;
  toastEl.className = 'hud show ' + cls;
}

let driving = false, camMode = 0, shake = 0, distance = 0, elapsed = 0;
$('startBtn').addEventListener('click', () => {
  $('menu').style.display = 'none';
  driving = true; initAudio();
  if (audio) audio.ctx.resume();
  showToast('GREEN LIGHT — GO!', 'INFINITE CITY CIRCUIT · WATCH FOR TRAINS', '', 'go', 2.2);
});

/* camera state */
const camPos = new THREE.Vector3(0, 6, -14);
let menuAngle = 0;

/* ---------------- main loop ---------------- */
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .05);
  const t = clock.elapsedTime;
  elapsed += dt;

  const input = driving ? readInput() : { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
  const info = car.update(dt, input, track);
  const playerFrame = car.hint;
  const playerS = playerFrame * STEP + (info.sample ? info.sample.along : 0);

  track.update(playerFrame);
  track.updateCrossings(dt, t);
  railTraffic.update(dt, playerS);
  if (driving) distance += Math.abs(info.speed) * dt;

  /* --- perpendicular ground-train collision --- */
  for (const c of track.crossings) {
    if (c.type !== 'ground' || c.state !== 'approach' || c.crashed || !c.train.visible) continue;
    const rel = car.pos.clone().sub(c.center);
    const along = rel.dot(c.fwd), perp = rel.dot(c.right);
    if (Math.abs(along) < 3.8 && Math.abs(perp - c.d) < 27 && Math.abs(car.pos.y - c.center.y) < 3.5) {
      c.crashed = true;
      car.vel.multiplyScalar(-.18);
      car.vy = 0; shake = 1.4;
      $('damageFlash').style.opacity = 1;
      setTimeout(() => $('damageFlash').style.opacity = 0, 180);
      showToast('💥 HIT BY CROSSING TRAIN', 'WAIT FOR THE SIGNALS NEXT TIME', 'red', 'hit' + c.id, 2.4);
    }
  }
  if (info.barrierHit > 4) {
    shake = Math.max(shake, Math.min(.8, info.barrierHit * .05));
    if (Math.random() < .25) showToast('BARRIER SCRAPE', 'THE WALLS ARE NOT YOUR FRIEND', '', 'scrape' + Math.floor(elapsed / 6), 1.4);
  }
  shake = Math.max(0, shake - dt * 2.2);

  /* --- feature warnings / track status --- */
  if (driving) {
    let found = null;
    for (let k = 16; k < 46 && !found; k += 2) {
      const f = track.frame(playerFrame + k); if (!f) break;
      if (f.crossing === 'ground') found = ['⚠ LEVEL CROSSING AHEAD', 'TRAINS CUT STRAIGHT THROUGH THE TRACK', 'red', 'xg' + f.i];
      else if (f.crossing === 'air') found = ['AERIAL RAILWAY AHEAD', 'TRAINS PASS OVERHEAD ON THE RAIL BRIDGE', 'blue', 'xa' + f.i];
      else if (f.splitAmt > .04 && f.splitAmt < .5 && f.splitType === 'y') found = ['Y-SPLIT AHEAD', 'FORK LEFT OR RIGHT — BOTH LINES MERGE BACK', '', 'sy' + f.i];
      else if (f.splitAmt > .04 && f.splitAmt < .5 && f.splitType === 'ud') found = ['UP / DOWN SPLIT AHEAD', 'LOW LINE ▾ OR BRIDGE LINE ▴ — COMMIT!', 'blue', 'su' + f.i];
    }
    if (found) showToast(...found);
    for (const c of track.crossings) {
      if (c.type === 'ground' && c.state === 'approach') {
        const dAhead = (c.frame - playerFrame) * STEP;
        if (dAhead > -20 && dAhead < 130) showToast('🚨 TRAIN CROSSING NOW', 'FLASHING SIGNALS — TRAIN ON THE TRACK', 'red', 'now' + c.id, 1.2);
      }
    }
  }
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) { toastEl.className = 'hud'; lastToastKey = ''; } }

  /* --- HUD values --- */
  $('speedVal').innerHTML = Math.round(info.speedKmh) + '<small> KM/H</small>';
  $('barFill').style.width = clamp(info.speedKmh / 300 * 100, 0, 100) + '%';
  $('statDist').textContent = (distance / 1000).toFixed(2) + ' km';
  $('statPos').textContent = 'S ' + Math.round(playerS) + ' m';
  $('steerTag').textContent = !driving ? '' : (input.steer < 0 ? '◀ STEER LEFT' : input.steer > 0 ? 'STEER RIGHT ▶' : '');
  $('driftTag').className = info.drifting ? 'on' : '';
  $('driftTag').id = 'driftTag';
  const s = info.sample;
  let surf = 'ASPHALT', line = 'MAIN LINE', mode = 'MAIN LINE';
  if (info.offTrack) { surf = 'CITY STREET — ROUGH'; line = 'OFF TRACK'; mode = 'OFF TRACK'; }
  else if (s) {
    if (s.frame.splitAmt > .05) {
      mode = s.frame.splitType === 'y' ? 'Y-SPLIT' : 'UP/DOWN SPLIT';
      line = s.frame.splitType === 'y' ? (s.branch === 'A' ? 'LEFT LINE' : 'RIGHT LINE')
        : (s.branch === 'A' ? 'LOW LINE' : 'BRIDGE LINE — HIGH');
      if (s.branch === 'B' && s.frame.splitType === 'ud') surf = 'BRIDGE DECK';
    } else if (s.frame.elevated) { mode = 'ELEVATED BRIDGE'; surf = 'BRIDGE DECK'; }
  }
  $('statSurf').textContent = surf; $('statLine').textContent = line; $('statMode').textContent = mode;
  let railTxt = 'GROUND ↓ ONCOMING · MONO ↑ SAME WAY';
  for (const c of track.crossings) if (c.state === 'approach' && Math.abs(c.frame - playerFrame) < 14) railTxt = c.type === 'ground' ? '⚠ CROSSING TRAIN!' : 'TRAIN OVERHEAD';
  $('statRail').textContent = railTxt;
  $('chipRail').className = 'chip' + (railTxt.includes('⚠') ? ' warn' : '');
  const wrongWay = s && info.speed > 3 &&
    new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading)).dot(s.frame.fwd) < -.45;
  $('wrongWay').className = wrongWay ? 'on' : '';
  $('vignette').style.opacity = clamp((info.speedKmh - 130) / 220, 0, .85);

  updateAudio(info.speedKmh, input.throttle);

  /* --- camera --- */
  const carFwd = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading));
  if (!driving) {
    menuAngle += dt * .25;
    const target = car.pos.clone().add(new THREE.Vector3(Math.sin(menuAngle) * 11, 4.2, Math.cos(menuAngle) * 11));
    camPos.lerp(target, Math.min(1, dt * 2));
    camera.position.copy(camPos);
    camera.lookAt(car.pos.x, car.pos.y + 1.4, car.pos.z);
    camera.fov += (58 - camera.fov) * dt * 3; camera.updateProjectionMatrix();
  } else if (camMode === 2) { // hood
    camera.position.copy(car.pos).addScaledVector(carFwd, 1.2); camera.position.y += 1.25;
    camera.lookAt(car.pos.clone().addScaledVector(carFwd, 30).setY(car.pos.y + 1));
    camera.fov += (68 - camera.fov) * dt * 3; camera.updateProjectionMatrix();
  } else {
    const dist = camMode === 1 ? 16 : 10.5, height = camMode === 1 ? 6 : 4.1;
    const desired = car.pos.clone().addScaledVector(carFwd, -dist);
    desired.y = car.pos.y + height;
    // keep camera above the deck when the track is banked/elevated
    if (s) desired.y = Math.max(desired.y, s.surfaceY + 2.2);
    camPos.lerp(desired, Math.min(1, dt * (camMode === 1 ? 3.2 : 4.6)));
    if (shake > 0) camPos.add(new THREE.Vector3((Math.random() - .5) * shake * .7, (Math.random() - .5) * shake * .5, (Math.random() - .5) * shake * .7));
    camera.position.copy(camPos);
    const look = car.pos.clone().addScaledVector(carFwd, 15); look.y = car.pos.y + 1.5;
    camera.lookAt(look);
    const targetFov = 62 + clamp(info.speedKmh / 300, 0, 1) * 13 + (input.boost ? 3 : 0);
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix();
  }

  /* sun + ground follow */
  sun.position.set(car.pos.x - 70, car.pos.y + 110, car.pos.z + 45);
  sun.target.position.copy(car.pos);
  ground.position.x = Math.round(car.pos.x / 60) * 60;
  ground.position.z = Math.round(car.pos.z / 60) * 60;
  clouds.position.x = car.pos.x; clouds.position.z = car.pos.z;
  clouds.children.forEach((c, i) => { c.position.x += dt * (1 + i % 3); if (c.position.x > 620) c.position.x = -620; });

  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
