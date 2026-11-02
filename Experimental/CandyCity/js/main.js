// Candy City — scene host: renderer, lighting, camera, sugar motes and HUD wiring.

import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/addons/controls/OrbitControls.js';
import { EffectComposer } from '../vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/addons/postprocessing/OutputPass.js';
import { createCandyTextures } from './textures.js';
import { buildCandyCity } from './city.js';
import { createSky } from './sky.js';

const query = new URLSearchParams(location.search);
const SHOW_UI = query.get('ui') !== '0';

const VIEWS = {
  overview: { position: [104, 76, 128], target: [0, 7, 0] },
  street: { position: [1.6, 3.3, 55], target: [0.5, 7.2, 2] },
  plaza: { position: [15, 10, 30], target: [0, 9, 0] },
  aerial: { position: [0.1, 178, 0.2], target: [0, 0, 0] },
  closeup: { position: [26, 6.5, 34], target: [12, 4.5, 6] },
  homes: { position: [52, 15, 74], target: [24, 5, 46] },
};

const canvas = document.getElementById('CandyViewport');
if (!canvas) throw new Error('Candy City viewport canvas is missing.');

function fail(message) {
  const overlay = document.getElementById('Loading');
  if (overlay) {
    overlay.innerHTML = `<div class="Lollipop" style="animation:none;background:#ffd3e2"></div>
      <h2>This browser cannot draw candy</h2>
      <div id="LoadingText">${message}</div>`;
  }
  throw new Error(message);
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
    stencil: false,
  });
} catch (error) {
  fail(`WebGL 2 is required: ${error.message}`);
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffd3e0, 240, 760);

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.4, 2400);
camera.position.set(240, 190, 280);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 7, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 4;
controls.maxDistance = 420;
controls.maxPolarAngle = Math.PI * 0.495;
controls.autoRotateSpeed = 0.35;
controls.enablePan = true;

// --- lighting ---------------------------------------------------------------
const SUNDIR = new THREE.Vector3(0.45, 0.72, 0.52).normalize();
const sun = new THREE.DirectionalLight(0xfff0d0, 2.85);
sun.position.copy(SUNDIR).multiplyScalar(180);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -140;
sun.shadow.camera.right = 140;
sun.shadow.camera.top = 140;
sun.shadow.camera.bottom = -140;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 420;
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.035;
sun.shadow.radius = 2.2;
scene.add(sun);
scene.add(sun.target);

const hemi = new THREE.HemisphereLight(0xa8d4ff, 0xffc2d4, 0.72);
scene.add(hemi);

// Cool bounce from the opposite side keeps candy shadows from going grey.
const fill = new THREE.DirectionalLight(0xbfd8ff, 0.42);
fill.position.set(-90, 60, -70);
scene.add(fill);

// --- sky --------------------------------------------------------------------
const sky = createSky(SUNDIR);
scene.add(sky.mesh);

// --- sugar motes ------------------------------------------------------------
let motes = null;

function buildMotes(sparkleTexture) {
  const count = 900;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 130;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = 0.6 + Math.random() * 34;
    positions[i * 3 + 2] = Math.sin(a) * r;
    seeds[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const mat = new THREE.PointsMaterial({
    size: 0.42,
    map: sparkleTexture || null,
    color: 0xfff1fa,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  motes = new THREE.Points(geo, mat);
  motes.name = 'SugarMotes';
  motes.userData.seeds = seeds;
  scene.add(motes);
}

// --- lamp light pools (intensity is driven by time of day) ------------------
const lampLights = [];
function buildLampLights(city) {
  for (const light of lampLights) scene.remove(light);
  lampLights.length = 0;
  const spots = (city.userData.lampSpots || []).filter((p) => Math.hypot(p.x, p.z) < 70);
  const step = Math.max(1, Math.floor(spots.length / 12));
  for (let i = 0; i < spots.length && lampLights.length < 12; i += step) {
    const p = spots[i];
    const light = new THREE.PointLight(0xffc46b, 0, 34, 1.6);
    light.position.set(p.x, p.y + 3.6, p.z);
    light.userData.peak = 26;
    scene.add(light);
    lampLights.push(light);
  }
}

// --- post processing --------------------------------------------------------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.34, 0.7, 0.86);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// --- time of day ------------------------------------------------------------
const state = {
  seed: Number(query.get('seed')) || 20260101,
  tod: query.has('tod') ? Number(query.get('tod')) : 0.06,
  autoRotate: query.get('rotate') === '1',
  city: null,
  textures: null,
};

function setTimeOfDay(t) {
  state.tod = t;
  // 0 = candy noon, 0.55 = strawberry sunset, 1 = sugar night
  const night = THREE.MathUtils.smoothstep(t, 0.42, 0.92);
  const elevation = THREE.MathUtils.lerp(0.66, -0.1, t);
  const azimuth = THREE.MathUtils.lerp(0.62, 1.5, t);
  const dir = new THREE.Vector3(
    Math.cos(elevation) * Math.cos(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.sin(azimuth),
  ).normalize();
  SUNDIR.copy(dir);
  sky.uniforms.uSunDir.value.copy(dir);
  sky.setDay(night);

  hemi.color.setHex(night > 0.5 ? 0x8fa4ff : 0xa8d4ff);
  hemi.groundColor.setHex(night > 0.5 ? 0x3a2f4a : 0xffc2d4);

  // sun colour: cream at noon, peach at golden hour, moon-blue at night
  const gold = THREE.MathUtils.clamp(1 - Math.abs(dir.y - 0.1) / 0.34, 0, 1);
  sun.position.copy(dir).multiplyScalar(190);
  sun.intensity = THREE.MathUtils.lerp(2.9, 0.16, night) * (1 - gold * 0.18);
  sun.color.setHex(0xfff0d0).lerp(new THREE.Color(0xffa552), gold).lerp(new THREE.Color(0x9fb4ff), night);
  hemi.color.lerp(new THREE.Color(0xffb98a), gold * 0.7);
  hemi.groundColor.lerp(new THREE.Color(0xff9a72), gold * 0.5);
  hemi.intensity = THREE.MathUtils.lerp(0.74, 0.46, night);
  fill.intensity = THREE.MathUtils.lerp(0.42, 0.24, night);

  const dayFog = new THREE.Color(0xffd3e0);
  const sunsetFog = new THREE.Color(0xffa583);
  const nightFog = new THREE.Color(0x3d2457);
  scene.fog.color.copy(dayFog).lerp(sunsetFog, THREE.MathUtils.clamp((t - 0.25) / 0.3, 0, 1));
  scene.fog.color.lerp(nightFog, night);
  scene.fog.near = THREE.MathUtils.lerp(240, 90, night);
  scene.fog.far = THREE.MathUtils.lerp(760, 420, night);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(1.06, 1.24, night) * (1 - gold * 0.07);

  if (state.city && state.city.userData.setNight) state.city.userData.setNight(night);
  for (const light of lampLights) light.intensity = night * light.userData.peak;
  if (motes) motes.material.opacity = 0.55 + night * 0.4;

  const todInput = document.getElementById('TodInput');
  if (todInput && Number(todInput.value) !== t) todInput.value = String(t);
  const todLabel = document.getElementById('TodLabel');
  if (todLabel) {
    const height = dir.y;
    todLabel.textContent = height > 0.42 ? 'Candy noon'
      : height > 0.14 ? 'Golden sugar'
        : height > -0.04 ? 'Strawberry sunset'
          : night > 0.75 ? 'Sugar night' : 'Dusk';
  }
}

// --- camera moves -----------------------------------------------------------
let camTween = null;

function setView(name, immediate = false) {
  const preset = VIEWS[name];
  if (!preset) return;
  if (immediate) {
    camera.position.fromArray(preset.position);
    controls.target.fromArray(preset.target);
    controls.update();
    return;
  }
  camTween = {
    t: 0,
    fromPos: camera.position.clone(),
    toPos: new THREE.Vector3().fromArray(preset.position),
    fromTarget: controls.target.clone(),
    toTarget: new THREE.Vector3().fromArray(preset.target),
  };
}

// --- build ------------------------------------------------------------------
async function nextFrame() {
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

const overlay = document.getElementById('Loading');
const loadingText = document.getElementById('LoadingText');

function setLoading(label, pct) {
  if (loadingText) loadingText.textContent = label;
  const bar = document.getElementById('LoadingBar');
  if (bar) bar.style.width = `${Math.round(pct)}%`;
}

let readyResolve;
const ready = new Promise((resolve) => { readyResolve = resolve; });

async function boot() {
  setLoading('painting sugar textures…', 8);
  await nextFrame();
  state.textures = createCandyTextures();
  setLoading('piping roads and raising gumdrops…', 55);
  await nextFrame();
  buildMotes(state.textures.sparkle);
  await buildCity(state.seed);
  setLoading('dusting with sprinkles…', 92);
  await nextFrame();

  setTimeOfDay(state.tod);
  controls.autoRotate = state.autoRotate;
  const view = query.get('view') || 'overview';
  setView(VIEWS[view] ? view : 'overview', true);

  if (overlay) {
    overlay.classList.add('is-gone');
    setTimeout(() => overlay.remove(), 900);
  }
  document.body.classList.add('is-ready');
  readyResolve(window.__candy);
  window.__candy.ready = ready;
}

async function buildCity(seed) {
  if (state.city) {
    scene.remove(state.city);
    state.city.userData.dispose();
  }
  state.city = buildCandyCity({ seed, textures: state.textures });
  scene.add(state.city);
  state.seed = seed;
  buildLampLights(state.city);
  setTimeOfDay(state.tod);
  const s = state.city.userData.stats;
  const statsEl = document.getElementById('SceneStats');
  if (statsEl) {
    statsEl.innerHTML =
      `<span>${s.houses}</span> houses · <span>${s.trees}</span> candy trees · ` +
      `<span>${s.lamps}</span> lamps · <span>${s.beans}</span> jelly beans · ` +
      `<span>${s.sprinkles}</span> sprinkles`;
  }
  return state.city;
}

// --- HUD --------------------------------------------------------------------
function wireUi() {
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });
  const todInput = document.getElementById('TodInput');
  if (todInput) {
    todInput.value = String(state.tod);
    todInput.addEventListener('input', () => setTimeOfDay(Number(todInput.value)));
  }
  const rotateBtn = document.getElementById('RotateBtn');
  if (rotateBtn) {
    const sync = () => rotateBtn.classList.toggle('is-on', controls.autoRotate);
    sync();
    rotateBtn.addEventListener('click', () => {
      controls.autoRotate = !controls.autoRotate;
      sync();
    });
  }
  const seedBtn = document.getElementById('SeedBtn');
  if (seedBtn) {
    seedBtn.addEventListener('click', async () => {
      const next = Math.floor(Math.random() * 900000) + 100000;
      setLoading('re-growing the sugar town…', 40);
      await buildCity(next);
      setView('overview');
      const seedLabel = document.getElementById('SeedLabel');
      if (seedLabel) seedLabel.textContent = `seed ${next}`;
    });
  }
  const shotBtn = document.getElementById('ShotBtn');
  if (shotBtn) {
    shotBtn.addEventListener('click', () => {
      renderer.render(scene, camera);
      const link = document.createElement('a');
      link.download = `CandyCity-${state.seed}.png`;
      link.href = renderer.domElement.toDataURL('image/png');
      link.click();
    });
  }
  const uiBtn = document.getElementById('UiBtn');
  if (uiBtn) {
    uiBtn.addEventListener('click', () => document.body.classList.toggle('ui-hidden'));
  }
  window.addEventListener('keydown', (event) => {
    if (event.key === 'h' || event.key === 'H') document.body.classList.toggle('ui-hidden');
    if (event.key === ' ') {
      event.preventDefault();
      controls.autoRotate = !controls.autoRotate;
      const b = document.getElementById('RotateBtn');
      if (b) b.classList.toggle('is-on', controls.autoRotate);
    }
  });
}

// --- loop -------------------------------------------------------------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  const time = clock.elapsedTime;

  if (camTween) {
    camTween.t = Math.min(1, camTween.t + dt / 1.5);
    const k = camTween.t * camTween.t * (3 - 2 * camTween.t);
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, k);
    controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, k);
    if (camTween.t >= 1) camTween = null;
  }

  controls.update();
  sky.update(time);

  if (state.city) state.city.userData.update(time);

  if (motes) {
    motes.rotation.y = time * 0.012;
    motes.position.y = Math.sin(time * 0.25) * 0.5;
  }

  // keep the sun's shadow frustum centred on the town
  sun.target.position.set(0, 0, 0);
  sun.target.updateMatrixWorld();

  renderer.info.reset();
  renderer.info.autoReset = false;
  composer.render();
  // renderer.info is now the sum of every pass in this frame (scene + bloom + output)
  const passCalls = renderer.info.render.calls;

  const fpsEl = document.getElementById('FpsLabel');
  if (fpsEl && time > 1) {
    fpsEl.textContent = `${Math.round(1 / Math.max(dt, 0.0001))} fps · ${passCalls} draws/frame`;
  }
}

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.resolution.set(w, h);
});

// --- public handles for validation -----------------------------------------
window.__candy = {
  THREE,
  scene,
  camera,
  renderer,
  controls,
  sky,
  get city() { return state.city; },
  get stats() { return state.city ? state.city.userData.stats : null; },
  get drawCalls() { return renderer.info.render.calls; },  // summed over the last frame by autoReset:false
  get triangles() { return renderer.info.render.triangles; },
  setView,
  setTimeOfDay,
  rebuild: buildCity,
  screenshot: () => {
    composer.render();
    return renderer.domElement.toDataURL('image/png');
  },
  ready,
};

if (SHOW_UI) wireUi();
else document.body.classList.add('ui-hidden');

animate();
boot().catch((error) => {
  console.error(error);
  setLoading(`failed: ${error.message}`, 100);
});
