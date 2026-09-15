// ============================================================================
// main.js — Frontier Canyon Forge: scene setup, UI wiring, render loop.
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { TYPES, generateCanyon, makeSampler, seedOffset } from './terrain.js';
import { buildTerrainMaterial, buildWaterMaterial } from './canyonMaterial.js';
import { buildRocks, buildBushes } from './props.js';

const MAT_OPTS = {
  grand: {
    sand: 0.9, streak: 1.0, swirl: 0, ripple: 0,
    sandColor: 0xd9c096, dustColor: 0xcbb58e,
    bumpScale: 0.5, bumpEps: 0.6, bumpAmp: 1.35,
    bedFreq: 2.2, bedAmp: 0.55, grooveFreq: 1.0,
    rockColor: 0x8f5f43, bushColor: 0x62683a,
    waterColor: 0x47766a, skyTint: 0xbfd4e6, ringColor: 0xc9b184,
  },
  slot: {
    sand: 0.5, streak: 1.25, swirl: 5.0, ripple: 0,
    sandColor: 0xdb9a63, dustColor: 0xc98a5a,
    bumpScale: 1.5, bumpEps: 0.22, bumpAmp: 0.9,
    bedFreq: 3.4, bedAmp: 0.4, grooveFreq: 1.7,
    rockColor: 0xa34a2d, bushColor: 0x5f6136,
    waterColor: 0x5a6e5a, skyTint: 0xcfd8e2, ringColor: 0xc08a5c,
  },
  wadi: {
    sand: 1.0, streak: 0.3, swirl: 0, ripple: 1.0,
    sandColor: 0xe0cba0, dustColor: 0xd6c194,
    bumpScale: 0.7, bumpEps: 0.5, bumpAmp: 0.9,
    bedFreq: 1.6, bedAmp: 0.35, grooveFreq: 0.8,
    rockColor: 0xb59a72, bushColor: 0x6b7040,
    waterColor: 0x6b6b4a, skyTint: 0xd4dde8, ringColor: 0xd9c194,
  },
};

const state = {
  type: 'grand',
  seed: 2026,
  size: 512,
  erosion: 1.0,
  sun: 0.35,
  rocks: true,
  bushes: true,
  orbit: false,
  appliedType: null,
  world: 2400,
};

let renderer, scene, camera, controls, clock;
let sky, dirLight, hemi, waterMesh, ringMesh;
let terrainMesh = null, rockGroup = null, bushGroup = null;
let waterTime = 0;

// ------------------------------- helpers ------------------------------------
const $ = (id) => document.getElementById(id);
const tick = () => new Promise((r) => setTimeout(r, 0));

function showLoader(f, label) {
  const loader = $('loader');
  loader.classList.remove('hidden');
  $('loadbar').style.width = `${Math.round(f * 100)}%`;
  $('loadlabel').textContent = label || '';
}
function hideLoader() {
  $('loader').classList.add('hidden');
}

function disposeGroup(gr) {
  if (!gr) return;
  gr.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
  });
  // materials are shared per group; dispose once
  const mats = new Set();
  gr.traverse((obj) => { if (obj.material) mats.add(obj.material); });
  mats.forEach((m) => m.dispose());
}

// --------------------------------- scene ------------------------------------
function init() {
  const container = $('viewport');
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.55;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc7d3e0, 1000, 8000);

  camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 1, 30000);
  camera.position.set(980, 560, 1180);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.autoRotateSpeed = 0.5;
  controls.enableZoom = false; // custom smooth zoom (see setupCameraControls)
  setupCameraControls();

  sky = new Sky();
  sky.material.uniforms.turbidity.value = 6;
  sky.material.uniforms.rayleigh.value = 1.2;
  sky.material.uniforms.mieCoefficient.value = 0.006;
  sky.material.uniforms.mieDirectionalG.value = 0.85;
  scene.add(sky);

  dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.bias = -0.00015;
  scene.add(dirLight);
  scene.add(dirLight.target);

  hemi = new THREE.HemisphereLight(0xbcd0e8, 0x8a6f52, 0.4);
  scene.add(hemi);

  // water (unit plane, rescaled per canyon)
  waterMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    buildWaterMaterial({ color: 0x47766a, skyTint: 0xbfd4e6 })
  );
  waterMesh.receiveShadow = true;
  waterMesh.renderOrder = 2;
  scene.add(waterMesh);

  clock = new THREE.Clock();
  window.addEventListener('resize', onResize);
  animate();
}

function onResize() {
  const container = $('viewport');
  const w = container.clientWidth, h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

// --------------------- Unreal-style camera (fly + smooth zoom) --------------
let zoomGoal = null;
let pinchDist = 0;
const flyKeys = new Set();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _move = new THREE.Vector3();
const _off = new THREE.Vector3();

function setupCameraControls() {
  // Smooth wheel zoom: each tick adjusts an exponential distance goal,
  // the camera eases toward it every frame (no stepping/snapping).
  renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (zoomGoal === null) zoomGoal = camera.position.distanceTo(controls.target);
    const step = e.deltaMode === 1 ? 16 : 1; // line-mode wheels
    zoomGoal *= Math.exp(e.deltaY * step * 0.0011);
    zoomGoal = THREE.MathUtils.clamp(zoomGoal, controls.minDistance, controls.maxDistance);
  }, { passive: false });

  // Basic pinch zoom for touch (OrbitControls still handles rotate + pan).
  const pinchGap = (t) => Math.hypot(
    t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY
  );
  renderer.domElement.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) pinchDist = pinchGap(e.touches);
  }, { passive: true });
  renderer.domElement.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && pinchDist > 0) {
      const d = pinchGap(e.touches);
      if (zoomGoal === null) zoomGoal = camera.position.distanceTo(controls.target);
      zoomGoal = THREE.MathUtils.clamp(
        zoomGoal * (pinchDist / Math.max(d, 1)),
        controls.minDistance, controls.maxDistance
      );
      pinchDist = d;
    }
  }, { passive: true });
  renderer.domElement.addEventListener('touchend', () => { pinchDist = 0; });

  // WASD / arrows + Q/E flight keys (ignored while typing in the panel).
  window.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    flyKeys.add(e.code);
  });
  window.addEventListener('keyup', (e) => flyKeys.delete(e.code));
  window.addEventListener('blur', () => flyKeys.clear());

  // Manual orbiting cancels an in-flight zoom so they never fight.
  controls.addEventListener('start', () => { zoomGoal = null; });
}

function updateCameraFlight(dt) {
  // Ease toward the zoom goal.
  if (zoomGoal !== null) {
    _off.copy(camera.position).sub(controls.target);
    const dist = _off.length();
    if (dist > 1e-6) {
      const k = 1 - Math.exp(-dt * 9);
      const nd = THREE.MathUtils.lerp(dist, zoomGoal, k);
      _off.setLength(nd);
      camera.position.copy(controls.target).add(_off);
      if (Math.abs(nd - zoomGoal) < Math.max(zoomGoal * 0.001, 1e-4)) zoomGoal = null;
    } else {
      zoomGoal = null;
    }
  }

  // Fly: move camera AND orbit target together (Unreal viewport style).
  let f = 0, r = 0, u = 0;
  if (flyKeys.has('KeyW') || flyKeys.has('ArrowUp')) f += 1;
  if (flyKeys.has('KeyS') || flyKeys.has('ArrowDown')) f -= 1;
  if (flyKeys.has('KeyD') || flyKeys.has('ArrowRight')) r += 1;
  if (flyKeys.has('KeyA') || flyKeys.has('ArrowLeft')) r -= 1;
  if (flyKeys.has('KeyE')) u += 1;
  if (flyKeys.has('KeyQ')) u -= 1;
  if (f !== 0 || r !== 0 || u !== 0) {
    camera.getWorldDirection(_fwd); // forward incl. pitch, like UE fly
    _right.crossVectors(_fwd, _up).normalize();
    _move.set(0, 0, 0)
      .addScaledVector(_fwd, f)
      .addScaledVector(_right, r)
      .addScaledVector(_up, u)
      .normalize();
    // Speed scales with distance to target, like UE's viewport camera speed.
    const dist = camera.position.distanceTo(controls.target);
    const world = state.world || 2400;
    let speed = THREE.MathUtils.clamp(dist * 0.9, world * 0.005, world * 0.6);
    if (flyKeys.has('ShiftLeft') || flyKeys.has('ShiftRight')) speed *= 4;
    _move.multiplyScalar(speed * dt);
    camera.position.add(_move);
    controls.target.add(_move);
    zoomGoal = null;
  }
}

function updateSun() {
  const cfg = TYPES[state.type];
  const t = state.sun;
  const el = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(9, 55, t));
  const az = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(118, 196, t));
  const sun = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - el, az);
  sky.material.uniforms.sunPosition.value.copy(sun);
  dirLight.position.copy(sun).multiplyScalar(cfg.world * 1.6);
  dirLight.target.position.set(0, (TYPES[state.type].depth || 30) * -0.25, 0);
  dirLight.color.lerpColors(new THREE.Color(0xff9a4d), new THREE.Color(0xfff3e2), Math.min(1, t * 1.4));
  dirLight.intensity = THREE.MathUtils.lerp(2.2, 3.0, t);
  hemi.intensity = THREE.MathUtils.lerp(0.25, 0.55, t);
  scene.fog.color.lerpColors(new THREE.Color(0xdbb287), new THREE.Color(0xc7d3e0), t);
}

function applyWorldScale(world) {
  sky.scale.setScalar(world * 6);
  const s = dirLight.shadow.camera;
  s.left = -world * 0.5; s.right = world * 0.5;
  s.top = world * 0.5; s.bottom = -world * 0.5;
  s.near = world * 0.4; s.far = world * 3.2;
  dirLight.shadow.camera.updateProjectionMatrix();
  dirLight.shadow.normalBias = world * 0.001;
  dirLight.shadow.bias = -0.00015;
  scene.fog.near = world * 0.6;
  scene.fog.far = world * 3.0;
  camera.near = world / 2000;
  camera.far = world * 8;
  camera.updateProjectionMatrix();
  controls.minDistance = world * 0.02;
  controls.maxDistance = world * 3;
}

function resetCamera() {
  const cfg = TYPES[state.type];
  camera.position.set(cfg.camPos[0], cfg.camPos[1], cfg.camPos[2]);
  controls.target.set(cfg.camTgt[0], cfg.camTgt[1], cfg.camTgt[2]);
  controls.update();
}

// ------------------------------ generation ----------------------------------
function buildTerrainMesh(data) {
  const { heights, ao, size: N, world } = data;
  const geo = new THREE.PlaneGeometry(world, world, N - 1, N - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const aoArr = new Float32Array(pos.count);
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), z = pos.getZ(k);
    const gx = Math.round((x / world + 0.5) * (N - 1));
    const gz = Math.round((z / world + 0.5) * (N - 1));
    const idx = gz * N + gx;
    pos.setY(k, heights[idx]);
    aoArr[k] = ao[idx];
  }
  geo.setAttribute('aAO', new THREE.BufferAttribute(aoArr, 1));
  geo.computeVertexNormals();
  return geo;
}

let generating = false;
async function regenerate() {
  if (generating) return;
  generating = true;
  $('generate').disabled = true;
  try {
    showLoader(0, 'Starting...');
    await tick();
    const { type, seed, size, erosion } = state;
    const cfg = TYPES[type];
    const data = await generateCanyon({ type, seed, size, erosion, onProgress: showLoader });

    showLoader(0.97, 'Building meshes...');
    await tick();

    // terrain
    if (terrainMesh) {
      scene.remove(terrainMesh);
      terrainMesh.geometry.dispose();
      terrainMesh.material.dispose();
    }
    const mo = MAT_OPTS[type];
    const tmat = buildTerrainMaterial(data.strata, {
      waterY: data.waterY,
      warpFreq: cfg.warpFreq, warpAmp: cfg.warpAmp,
      seedOff: seedOffset(seed),
      sand: mo.sand, streak: mo.streak, swirl: mo.swirl, ripple: mo.ripple,
      sandColor: mo.sandColor, dustColor: mo.dustColor,
      bumpScale: mo.bumpScale, bumpEps: mo.bumpEps, bumpAmp: mo.bumpAmp,
      bedFreq: mo.bedFreq, bedAmp: mo.bedAmp, grooveFreq: mo.grooveFreq,
    });
    terrainMesh = new THREE.Mesh(buildTerrainMesh(data), tmat);
    terrainMesh.castShadow = true;
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // water
    waterMesh.material.dispose();
    waterMesh.material = buildWaterMaterial({ color: mo.waterColor, skyTint: mo.skyTint });
    waterMesh.scale.set(data.world, 1, data.world);
    waterMesh.position.y = data.waterY;

    // outer desert ring (hides the void past the map edge)
    if (ringMesh) {
      scene.remove(ringMesh);
      ringMesh.geometry.dispose();
      ringMesh.material.dispose();
    }
    ringMesh = new THREE.Mesh(
      new THREE.RingGeometry(data.world * 0.505, data.world * 5, 48, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: mo.ringColor, roughness: 1, metalness: 0 })
    );
    ringMesh.position.y = data.rimY - cfg.plateauAmp - 6;
    ringMesh.receiveShadow = true;
    scene.add(ringMesh);

    // props
    const sampler = makeSampler(data);
    if (rockGroup) { scene.remove(rockGroup); disposeGroup(rockGroup); }
    if (bushGroup) { scene.remove(bushGroup); disposeGroup(bushGroup); }
    rockGroup = null; bushGroup = null;
    if (state.rocks && cfg.rocks) {
      rockGroup = buildRocks(sampler, {
        count: cfg.rocks, minScale: cfg.rockMin, maxScale: cfg.rockMax,
        waterY: data.waterY, extent: data.world * 0.49,
        seed: (seed ^ 0x1b873593) >>> 0, color: mo.rockColor,
      });
      scene.add(rockGroup);
    }
    if (state.bushes && cfg.bushes) {
      const spread = Math.max(cfg.world / 2400, 0.35);
      bushGroup = buildBushes(sampler, {
        count: cfg.bushes, minScale: 1.2 * spread, maxScale: 4.5 * spread,
        waterY: data.waterY, rimY: data.rimY, extent: data.world * 0.49,
        seed: (seed ^ 0x85ebca6b) >>> 0, color: mo.bushColor,
      });
      scene.add(bushGroup);
    }

    applyWorldScale(data.world);
    updateSun();
    if (state.appliedType !== type) {
      state.appliedType = type;
      resetCamera();
    }
    updateStats(data);
  } catch (err) {
    console.error(err);
    $('loadlabel').textContent = 'Error: ' + err.message;
    await new Promise((r) => setTimeout(r, 2500));
  } finally {
    hideLoader();
    generating = false;
    $('generate').disabled = false;
  }
}

function updateStats(data) {
  const tris = renderer.info.render.triangles;
  $('stats').innerHTML =
    `<span><b>${TYPES[state.type].label}</b> · seed ${state.seed}</span>` +
    `<span>${(tris / 1e6).toFixed(2)}M tris · gen ${(data.stats.genMs / 1000).toFixed(1)}s</span>`;
}

// --------------------------------- loop -------------------------------------
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  waterTime += dt;
  const wsh = waterMesh && waterMesh.material && waterMesh.material.userData.shader;
  if (wsh) wsh.uniforms.uTime.value = waterTime;
  controls.autoRotate = state.orbit;
  updateCameraFlight(dt);
  controls.update();
  renderer.render(scene, camera);
}

// ---------------------------------- UI --------------------------------------
function bindUI() {
  document.querySelectorAll('#typeSeg button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#typeSeg button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.type = btn.dataset.type;
      regenerate();
    });
  });
  $('seed').addEventListener('change', () => {
    const v = parseInt($('seed').value, 10);
    state.seed = Number.isFinite(v) ? v : 2026;
  });
  $('dice').addEventListener('click', () => {
    state.seed = Math.floor(Math.random() * 100000);
    $('seed').value = state.seed;
    regenerate();
  });
  $('detail').addEventListener('change', () => {
    state.size = parseInt($('detail').value, 10);
  });
  $('erosion').addEventListener('input', () => {
    state.erosion = parseInt($('erosion').value, 10) / 100;
    $('erosionVal').textContent = `${$('erosion').value}%`;
  });
  $('sun').addEventListener('input', () => {
    state.sun = parseInt($('sun').value, 10) / 100;
    updateSun();
  });
  $('tRocks').addEventListener('change', () => { state.rocks = $('tRocks').checked; regenerate(); });
  $('tBushes').addEventListener('change', () => { state.bushes = $('tBushes').checked; regenerate(); });
  $('tOrbit').addEventListener('change', () => { state.orbit = $('tOrbit').checked; });
  $('generate').addEventListener('click', regenerate);
  $('collapse').addEventListener('click', () => {
    document.body.classList.toggle('panel-hidden');
  });

  // periodic triangle counter refresh
  setInterval(() => {
    if (terrainMesh && !generating) {
      const tris = renderer.info.render.triangles;
      const el = $('stats').querySelectorAll('span')[1];
      if (el) el.textContent = `${(tris / 1e6).toFixed(2)}M tris · seed ${state.seed}`;
    }
  }, 1500);
}

// ---------------------------------- boot ------------------------------------
init();
bindUI();
applyWorldScale(TYPES[state.type].world);
updateSun();
resetCamera();
regenerate();
