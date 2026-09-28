/**
 * Renderer, environment and camera.
 *
 * The bird is a *daylight outdoor* subject: it needs a sun with a soft,
 * slightly warm key, a strong sky-blue bounce from above and a warm
 * ground bounce from below, because that is the light that reveals the
 * bronze sheen on a golden eagle's nape and the translucency of the outer
 * primaries against the sky.
 */

import {
  ACESFilmicToneMapping,
  BackSide,
  CanvasTexture,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEG } from './lib/mathx.js';

const SKY_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
varying vec3 vWorld;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunSize;
void main() {
  vec3 d = normalize(vWorld);
  float h = d.y;
  vec3 col;
  if (h > 0.0) {
    float t = pow(clamp(h, 0.0, 1.0), 0.52);
    col = mix(uHorizon, uZenith, t);
  } else {
    col = mix(uHorizon, uGround, pow(clamp(-h, 0.0, 1.0), 0.6));
  }
  float cosang = dot(d, normalize(uSunDir));
  float disk = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.35, cosang);
  float glow = pow(max(cosang, 0.0), 12.0) * 0.35;
  col += uSunColor * (disk * 14.0 + glow);
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * The substrate texture: fine gravel over a coarse mottle, tiled so that one
 * tile spans `period` metres.  Seamless by construction -- every mark is drawn
 * with wrap-around copies, so the walk clip can slide it forever without a
 * visible seam.
 */
function groundTexture(period, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#6a6350';
  g.fillRect(0, 0, size, size);
  let seed = 20240928;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const wrap = [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]];
  for (let i = 0; i < 90; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 8 + rand() * 26;
    const v = 0.5 + rand() * 0.5;
    for (const [dx, dy] of wrap) {
      const grd = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      grd.addColorStop(0, `rgba(${(v * 34) | 0},${(v * 30) | 0},${(v * 22) | 0},0.30)`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    }
  }
  for (let i = 0; i < 2600; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 0.6 + rand() * 1.9;
    const v = rand();
    g.fillStyle =
      v > 0.5
        ? `rgba(255,250,235,${(0.05 + v * 0.1).toFixed(3)})`
        : `rgba(20,16,10,${(0.05 + (1 - v) * 0.13).toFixed(3)})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.repeat.set(80 / period, 80 / period);
  return tex;
}

export function createViewer(canvas) {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  scene.background = new Color(0x9db8d0);

  // 42 deg vertical FOV holds a 2.1 m wingspan comfortably at ~3 m.
  const camera = new PerspectiveCamera(42, 1, 0.05, 400);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 0.6;
  controls.maxDistance = 24;
  controls.target.set(0, 0, 0);

  /* ---- sky dome + image-based lighting ---------------------------------- */
  const sunDir = new Vector3(0.45, 0.62, 0.64).normalize();
  const skyMat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new Color(0x2f74c9).convertSRGBToLinear() },
      uHorizon: { value: new Color(0xc4d8ea).convertSRGBToLinear() },
      uGround: { value: new Color(0x4a4436).convertSRGBToLinear() },
      uSunDir: { value: sunDir.clone() },
      uSunColor: { value: new Color(0xfff2d6).convertSRGBToLinear() },
      uSunSize: { value: 0.015 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
  });
  const sky = new Mesh(new SphereGeometry(120, 48, 32), skyMat);
  sky.name = 'sky';
  scene.add(sky);

  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new Scene();
  const envSky = new Mesh(new SphereGeometry(50, 40, 24), skyMat.clone());
  envScene.add(envSky);
  const envRT = pmrem.fromScene(envScene, 0.02);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.9;

  /* ---- direct lighting -------------------------------------------------- */
  const sun = new DirectionalLight(0xfff0d8, 3.1);
  sun.position.copy(sunDir).multiplyScalar(12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 1.6;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 30;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.012;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new HemisphereLight(0xbcd6ef, 0x50442f, 1.05);
  scene.add(fill);

  const rim = new DirectionalLight(0xd8e8ff, 0.75);
  rim.position.set(-0.5, 0.25, -0.7).multiplyScalar(10);
  scene.add(rim);

  /* ---- ground ----------------------------------------------------------- */
  // A repeating substrate.  It has to repeat, and the period has to be known,
  // because the walk clip scrolls it under a stationary bird and that scroll
  // must wrap without a visible seam to be able to run forever.
  const GROUND_PERIOD = 1.6;
  const groundMat = new MeshStandardMaterial({
    color: 0x6a6350,
    roughness: 0.95,
    metalness: 0.0,
    map: groundTexture(GROUND_PERIOD),
  });
  const ground = new Mesh(new PlaneGeometry(80, 80), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  ground.userData.period = GROUND_PERIOD;
  scene.add(ground);

  /* ---- resize ----------------------------------------------------------- */
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (canvas.width !== w * renderer.getPixelRatio() || canvas.height !== h * renderer.getPixelRatio()) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    }
  }

  return {
    renderer,
    scene,
    camera,
    controls,
    sun,
    fill,
    rim,
    ground,
    sky,
    resize,
    sunDir,
  };
}

export function setCameraPreset(camera, controls, preset, subject = {}) {
  const { view = 'three-quarter', distance = 2.9, height = 0.35 } = preset ?? {};
  const target = new Vector3(0, subject.height ?? 0, 0);
  const angles = {
    'three-quarter': 42,
    side: 90,
    front: 0,
    back: 180,
    top: 30,
    profile: 88,
  };
  const az = (angles[view] ?? 42) * DEG;
  const el = (view === 'top' ? 72 : 12) * DEG;
  const pos = new Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  )
    .multiplyScalar(distance)
    .add(new Vector3(0, height, 0));
  camera.position.copy(pos);
  controls.target.copy(target);
  controls.update();
}
