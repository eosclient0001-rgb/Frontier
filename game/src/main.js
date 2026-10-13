// Entry point: wires the logic (Game) to the renderer, camera, effects, audio and HUD.
import * as THREE from 'three';
import { Game } from './game.js';
import { CAR } from './sim/vehicle.js';
import { clamp, damp } from './core/math.js';
import { createRenderer, createScene, createLights, createSky, createGround, createComposer, SUN_DIR } from './render/env.js';
import { createMaterials } from './render/materials.js';
import { makeCarMaterials, createPlayerCar } from './render/vehicles.js';
import { WorldView } from './render/world.js';
import { SpeedStreaks, Particles } from './render/fx.js';
import { Input } from './ui/input.js';
import { HUD } from './ui/hud.js';
import { Audio } from './ui/audio.js';

const canvas = document.getElementById('scene');
const renderer = createRenderer(canvas);
const scene = createScene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 6000);
scene.add(camera);
const lights = createLights(scene);
const sky = createSky(scene);
const mats = createMaterials(renderer);
const ground = createGround(scene, mats);
const cm = makeCarMaterials(mats.envMap);
const world = new WorldView(scene, mats, cm);
const car = createPlayerCar(cm);
car.rotation.order = 'YXZ';
scene.add(car);
const streaks = new SpeedStreaks(camera);
const particles = new Particles(scene);
const { composer } = createComposer(renderer, scene, camera);

const game = new Game();
const input = new Input();
const hud = new HUD();
const audio = new Audio();

const CAM_NAMES = ['Chase', 'Hood', 'Bumper'];
const cam = { mode: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 62, shake: 0, init: false };
let lastRunId = -1;
let last = performance.now();
let smokeAcc = 0;

hud.showOverlay('menu');
hud.setCamLabel(CAM_NAMES[cam.mode]);
hud.setMuteLabel(false);

function startRun() {
  game.start();
  audio.start();
  hud.showOverlay(null);
}

function restartRun() {
  game.newRun(Math.floor(Math.random() * 1e9));
  startRun();
}

function handleKeys() {
  if (input.wasPressed('KeyC')) {
    cam.mode = (cam.mode + 1) % CAM_NAMES.length;
    hud.setCamLabel(CAM_NAMES[cam.mode]);
  }
  if (input.wasPressed('KeyM')) {
    audio.setMuted(!audio.muted);
    hud.setMuteLabel(audio.muted);
  }
  const pauseKey = input.wasPressed('KeyP', 'Escape');
  const padStart = input.padPressed(9) && !padLatch.start;
  padLatch.start = input.padPressed(9);
  const enter = input.wasPressed('Enter');
  const restart = input.wasPressed('KeyR');

  if (game.state === 'menu') {
    if (enter || input.padPressed(0) || input.wasPressed('Space')) startRun();
  } else if (game.state === 'play' || game.state === 'pause') {
    if (pauseKey || padStart) {
      game.togglePause();
      hud.showOverlay(game.state === 'pause' ? 'pause' : null);
    }
    if (restart) restartRun();
  } else if (game.state === 'over') {
    if (enter || restart || input.wasPressed('Space')) restartRun();
  }
}
const padLatch = { start: false };

function handleEvents() {
  for (const e of game.drainEvents()) {
    switch (e.type) {
      case 'toast':
        hud.toast(e.text, e.tone);
        break;
      case 'impact':
        audio.impact(e.strength ?? 0.5);
        cam.shake = Math.min(1, cam.shake + (e.strength ?? 0.5) * 0.6);
        if (e.x !== undefined) particles.spark(e.x, e.y, e.z, e.strength ?? 0.5);
        break;
      case 'wall':
        audio.impact(e.strength ?? 0.5);
        cam.shake = Math.min(1, cam.shake + (e.strength ?? 0.5) * 0.5);
        particles.spark(e.x, e.y, e.z, e.strength ?? 0.5);
        break;
      case 'land':
        audio.impact(0.3 * (e.strength ?? 0.5));
        cam.shake = Math.min(1, cam.shake + 0.2);
        break;
      case 'chime':
        audio.chime(e.up !== false);
        break;
      case 'over':
        hud.showOver(game);
        hud.showOverlay('over');
        audio.impact(0.6);
        break;
      default:
        break;
    }
  }
}

function placeCamera(dt, v) {
  const sp = clamp(v.speed / 70, 0, 1);
  const fx = Math.cos(v.yaw);
  const fz = Math.sin(v.yaw);
  const car3 = new THREE.Vector3(v.x, v.y, v.z);
  const fwd = new THREE.Vector3(fx, 0, fz);
  let desired;
  let look;
  let lambda = 9;
  if (cam.mode === 1) {
    desired = car3.clone().addScaledVector(fwd, 0.2).add(new THREE.Vector3(0, 1.45, 0));
    look = car3.clone().addScaledVector(fwd, 30).add(new THREE.Vector3(0, 0.9, 0));
    lambda = 25;
  } else if (cam.mode === 2) {
    desired = car3.clone().addScaledVector(fwd, -3.4).add(new THREE.Vector3(0, 1.0, 0));
    look = car3.clone().addScaledVector(fwd, 12).add(new THREE.Vector3(0, 0.9, 0));
  } else {
    const back = 7.4 + sp * 2.4;
    desired = car3.clone().addScaledVector(fwd, -back).add(new THREE.Vector3(0, 2.7 + sp * 0.3, 0));
    look = car3.clone().addScaledVector(fwd, 9).add(new THREE.Vector3(0, 0.9, 0));
  }
  if (!cam.init) {
    cam.pos.copy(desired);
    cam.look.copy(look);
    cam.init = true;
  }
  cam.pos.x = damp(cam.pos.x, desired.x, lambda, dt);
  cam.pos.y = damp(cam.pos.y, desired.y, lambda * 0.8, dt);
  cam.pos.z = damp(cam.pos.z, desired.z, lambda, dt);
  cam.look.x = damp(cam.look.x, look.x, 14, dt);
  cam.look.y = damp(cam.look.y, look.y, 14, dt);
  cam.look.z = damp(cam.look.z, look.z, 14, dt);

  cam.shake = Math.max(0, cam.shake - dt * 2.2);
  const sh = cam.shake * cam.shake * 0.35;
  camera.position.set(cam.pos.x + (Math.random() - 0.5) * sh, cam.pos.y + (Math.random() - 0.5) * sh, cam.pos.z + (Math.random() - 0.5) * sh);
  camera.lookAt(cam.look);

  const targetFov = 62 + sp * 14 + (v.nitroOn ? 8 : 0) + (cam.mode === 1 ? -4 : 0);
  cam.fov = damp(cam.fov, targetFov, 4, dt);
  if (Math.abs(camera.fov - cam.fov) > 0.01) {
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
  }
}

function updateVisuals(dt) {
  const v = game.vehicle;
  if (game.runId !== lastRunId) {
    lastRunId = game.runId;
    world.clear();
    cam.init = false;
  }
  world.sync(game.route, game.playerDist, game.crossTrains, game.traffic.agents);

  // player car
  car.position.set(v.x, v.y - CAR.rideH, v.z);
  // body leans outward (opposite the cornering force), nose pitches with the grade
  car.rotation.set(-Math.atan(v.grade) * 0.9, Math.PI / 2 - v.yaw, clamp(v.latG, -1.2, 1.2) * -0.025);
  // front wheels: model +Z is forward and model -X is the car's right, so a right turn (positive delta) is a negative yaw
  for (const w of car.userData.frontWheels) w.rotation.y = -v.delta;
  car.visible = cam.mode !== 1;

  // sun and sky follow the car
  lights.sun.position.copy(car.position).addScaledVector(SUN_DIR, 300);
  lights.sun.target.position.copy(car.position);
  lights.sun.target.updateMatrixWorld();
  sky.position.copy(camera.position);
  ground.position.x = Math.round(v.x / 28) * 28;
  ground.position.z = Math.round(v.z / 28) * 28;

  placeCamera(dt, v);

  // effects
  streaks.update(dt, v.speed, v.nitroOn ? 1 : 0);
  smokeAcc += dt;
  const fx = Math.cos(v.yaw);
  const fz = Math.sin(v.yaw);
  if (game.drifting && smokeAcc > 0.03) {
    smokeAcc = 0;
    for (const side of [-1, 1]) {
      const rx = -fz * side * 0.9;
      const rz = fx * side * 0.9;
      particles.smoke(v.x - fx * 1.4 + rx, v.y - 0.5, v.z - fz * 1.4 + rz);
    }
  }
  particles.update(dt);

  audio.update(game.speedKmh, input.read().throttle, Math.abs(v.slipR));
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  handleKeys();
  if (game.state === 'play') game.update(dt, input);
  handleEvents();
  if (game.state === 'play') hud.update(game, dt);
  updateVisuals(game.state === 'pause' ? 0 : dt);
  composer.render();
  input.endFrame();
}

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  composer.setSize(w, h);
});

window.__game = game; // handy for debugging in the console
requestAnimationFrame(frame);
