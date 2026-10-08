import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildCliffGeometry, CLIFF_WIDTH_M } from './cliffGeometry.js';

const TEXTURE_DIR = `${import.meta.env.BASE_URL}textures/rocky-cliff/`;
const FILES = {
  albedo: 'rocky_cliff_albedo.jpg',
  normal: 'rocky_cliff_normal.jpg',
  roughness: 'rocky_cliff_roughness.jpg',
  ao: 'rocky_cliff_ao.jpg',
  height: 'rocky_cliff_height.png',
};

// Must match the generator's --relief-m and --tile-m defaults (see README).
const RELIEF_M = 0.35;
const TILE_M = 3.0;

const SKY = 0xaec3d6;

const VIEWS = {
  overview: { position: [0, 13, 60], target: [0, 11, 0] },
  closeup: { position: [2.6, 12.6, 5.0], target: [0, 12.8, 0.6] },
  ground: { position: [0.8, 2.4, 7.5], target: [0, 4.2, 0.6] },
};

const $ = (id) => document.getElementById(id);
const canvas = $('scene');

// ---- Renderer, scene, camera ---------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 140, 460);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 1500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.minDistance = 0.5;
controls.maxDistance = 250;

// ---- Lights ----------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x6d5b47, 0.5));

const sun = new THREE.DirectionalLight(0xffe2bf, 2.8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 400 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.04;
sun.target.position.set(0, 10, 0);
scene.add(sun, sun.target);

function placeSun(azDeg, elDeg) {
  const az = THREE.MathUtils.degToRad(azDeg);
  const el = THREE.MathUtils.degToRad(elDeg);
  // 0 degrees = light straight on the face; larger angles rake across it.
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  sun.position.copy(dir).multiplyScalar(110).add(sun.target.position);
  $('azOut').textContent = `${azDeg}°`;
  $('elOut').textContent = `${elDeg}°`;
}

// ---- Ground ----------------------------------------------------------------
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1400, 1400),
  new THREE.MeshStandardMaterial({ color: 0x8f7d66, roughness: 1, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---- Textures --------------------------------------------------------------
const loader = new THREE.TextureLoader();
function loadTexture(file, colorSpace = THREE.NoColorSpace) {
  return new Promise((resolve, reject) => {
    loader.load(
      TEXTURE_DIR + file,
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = colorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        tex.repeat.set(1 / TILE_M, 1 / TILE_M);
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

async function init() {
  const [albedo, normal, roughness, ao, height] = await Promise.all([
    loadTexture(FILES.albedo, THREE.SRGBColorSpace),
    loadTexture(FILES.normal),
    loadTexture(FILES.roughness),
    loadTexture(FILES.ao),
    loadTexture(FILES.height),
  ]);
  const textures = { albedo, normal, roughness, ao, height };

  // Lit material: the full PBR set. Geometry displacement uses the height map.
  const lit = new THREE.MeshStandardMaterial({
    map: albedo,
    normalMap: normal,
    normalScale: new THREE.Vector2(1, 1),
    roughnessMap: roughness,
    roughness: 1,
    metalness: 0,
    aoMap: ao,
    aoMapIntensity: 1,
    displacementMap: height,
    displacementScale: RELIEF_M,
    displacementBias: -RELIEF_M / 2,
  });

  // Break up tiling. Over large patches, the albedo blends in a second sample at a
  // different scale, so the tile's bands do not line up in a visible grid.
  const breakUp = { value: 1 };
  lit.customProgramCacheKey = () => 'rocky-cliff-breakup-v2';
  lit.onBeforeCompile = (shader) => {
    shader.uniforms.uBreakUp = breakUp;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uBreakUp;
float breakHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float breakNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = breakHash(i);
  float b = breakHash(i + vec2(1.0, 0.0));
  float c = breakHash(i + vec2(0.0, 1.0));
  float d = breakHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  vec2 breakUv = vMapUv * 0.71 + vec2(0.31, 0.77);
  vec4 breakDiffuse = texture2D( map, breakUv );
  float breakMask = smoothstep(0.3, 0.7, breakNoise(vMapUv * 0.22 + 3.7)) * uBreakUp;
  sampledDiffuseColor = mix( sampledDiffuseColor, breakDiffuse, breakMask );
  diffuseColor *= sampledDiffuseColor;
#endif`,
      );
  };

  // Debug views show one map at a time, unlit, so each map can be checked on its own.
  const debug = {
    albedo: new THREE.MeshBasicMaterial({ map: albedo, toneMapped: false }),
    normal: new THREE.MeshBasicMaterial({ map: normal, toneMapped: false }),
    ao: new THREE.MeshBasicMaterial({ map: ao, toneMapped: false }),
    roughness: new THREE.MeshBasicMaterial({ map: roughness, toneMapped: false }),
    height: new THREE.MeshBasicMaterial({ map: height, toneMapped: false }),
  };

  const geometry = buildCliffGeometry();
  const cliff = new THREE.Mesh(geometry, lit);
  cliff.castShadow = true;
  cliff.receiveShadow = true;
  scene.add(cliff);

  // ---- UI ----------------------------------------------------------------
  const setMode = (mode) => {
    cliff.material = mode === 'lit' ? lit : debug[mode];
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  };
  document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  let flight = null;
  const flyTo = (name) => {
    const v = VIEWS[name];
    flight = {
      start: performance.now(),
      duration: 1200,
      fromPos: camera.position.clone(),
      toPos: new THREE.Vector3(...v.position),
      fromTarget: controls.target.clone(),
      toTarget: new THREE.Vector3(...v.target),
    };
    document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  };
  document.querySelectorAll('#views button').forEach((b) => b.addEventListener('click', () => flyTo(b.dataset.view)));
  controls.addEventListener('start', () => {
    flight = null; // a manual drag cancels the fly-to
  });

  $('breakup').addEventListener('change', (e) => {
    breakUp.value = e.target.checked ? 1 : 0;
  });

  $('tile').addEventListener('input', (e) => {
    const size = Number(e.target.value);
    $('tileOut').textContent = `${size.toFixed(1)} m`;
    for (const tex of Object.values(textures)) tex.repeat.set(1 / size, 1 / size);
  });
  $('normal').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('normalOut').textContent = v.toFixed(2);
    lit.normalScale.set(v, v);
  });
  $('ao').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('aoOut').textContent = v.toFixed(2);
    lit.aoMapIntensity = v;
  });
  $('relief').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('reliefOut').textContent = `${(RELIEF_M * v).toFixed(2)} m`;
    lit.displacementScale = RELIEF_M * v;
    lit.displacementBias = -(RELIEF_M * v) / 2;
  });
  const sunInput = () => placeSun(Number($('az').value), Number($('el').value));
  $('az').addEventListener('input', sunInput);
  $('el').addEventListener('input', sunInput);
  $('shadows').addEventListener('change', (e) => {
    sun.castShadow = e.target.checked;
    cliff.material.needsUpdate = true;
    scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
  });

  // Set the initial state from the controls' defaults.
  $('tileOut').textContent = `${TILE_M.toFixed(1)} m`;
  $('normalOut').textContent = '1.00';
  $('aoOut').textContent = '1.00';
  $('reliefOut').textContent = `${RELIEF_M.toFixed(2)} m`;
  placeSun(Number($('az').value), Number($('el').value));

  const triangles = geometry.index.count / 3;
  $('stats').textContent =
    `${textures.albedo.image.width}² px maps · ${(triangles / 1000).toFixed(0)}k triangles · ` +
    `${CLIFF_WIDTH_M} m wide face`;

  // Start in the close-up view so the detail is visible straight away.
  camera.position.set(...VIEWS.closeup.position);
  controls.target.set(...VIEWS.closeup.target);
  controls.update();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });

  renderer.setAnimationLoop(() => {
    if (flight) {
      const t = Math.min(1, (performance.now() - flight.start) / flight.duration);
      const e = t * t * (3 - 2 * t);
      camera.position.lerpVectors(flight.fromPos, flight.toPos, e);
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, e);
      if (t >= 1) flight = null;
    }
    controls.update();
    renderer.render(scene, camera);
  });

  $('loading').classList.add('done');
}

init().catch((err) => {
  console.error(err);
  $('loading').textContent = `Could not load the textures: ${err.message}`;
});
