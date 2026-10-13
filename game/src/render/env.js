// Renderer, post-processing, lights, sky dome and the city ground plane.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export const HAZE = new THREE.Color(0xc9d6e2);

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.logarithmicDepthBuffer = true; // long sightlines over elevated decks without z-fighting
  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = HAZE;
  scene.fog = new THREE.Fog(HAZE, 260, 2100);
  return scene;
}

export function createLights(scene) {
  const hemi = new THREE.HemisphereLight(0xdbe8f5, 0x7b7a74, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -110;
  cam.right = 110;
  cam.top = 110;
  cam.bottom = -110;
  cam.near = 10;
  cam.far = 700;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.35;
  scene.add(sun);
  scene.add(sun.target);
  return { hemi, sun };
}

/** Sun direction (normalised, from the scene toward the light). */
export const SUN_DIR = new THREE.Vector3(-0.55, 0.72, 0.42).normalize();

export function createSky(scene) {
  const geo = new THREE.SphereGeometry(4000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x4f86bd) },
      horizon: { value: new THREE.Color(0xd5e1ec) },
      ground: { value: new THREE.Color(0x9aa3ad) },
      sunDir: { value: SUN_DIR },
      sunCol: { value: new THREE.Color(1.0, 0.92, 0.78) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunCol;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = mix(horizon, top, smoothstep(0.0, 0.55, h));
        col = mix(ground, col, smoothstep(-0.05, 0.02, h));
        float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        col += sunCol * (pow(s, 900.0) * 3.0 + pow(s, 40.0) * 0.22 + pow(s, 6.0) * 0.06);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -10;
  scene.add(sky);
  return sky;
}

export function createGround(scene, mats) {
  const geo = new THREE.PlaneGeometry(14000, 14000);
  geo.rotateX(-Math.PI / 2);
  const g = new THREE.Mesh(geo, mats.ground);
  g.position.y = -0.06;
  g.receiveShadow = true;
  scene.add(g);
  return g;
}

export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.5, 0.94);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return { composer, bloom };
}
