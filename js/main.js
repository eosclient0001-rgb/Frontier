/* ============================================================================
 * Frontier — SDF Terrain Studio · main application
 * three.js viewport + worker orchestration + professional UI wiring
 * ==========================================================================*/
'use strict';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ------------------------------ parameters ------------------------------- */

const P = {
  gen: {
    sizeM: 100, seed: 1337, n: 512, heightM: 38,
    octaves: 6, persistence: 0.5, ridgedMix: 0.55, ridgeExp: 2.2,
    warp: 0.55, sharpness: 1.9, baseFreq: 2.6
  },
  ero: {
    sizeM: 100, particles: 300000, iterations: 24, stepsPerIter: 2,
    rain: 1.0, capacityK: 0.9, cutVoxels: 0.25, depVoxels: 0.35,
    stepVoxels: 1.0, evap: 0.995, respawnFrac: 0.25, slideLimit: 1.1,
    massWaste: 2, massWasteLimit: 0.5
  },
  splat: { flow: 1.4, sediment: 1.2, peak: 1.0, pines: 1.0, base: 1.0 },
  view: { autoRotate: false, contours: true, contourStep: 2, splatView: false, wireframe: false, shadows: true }
};

/* terrain state (main-thread copies) */
const T = {
  h: null, n: 0, hBefore: null,
  flow: null, dep: null,
  albedo: null, vis: null,
  Hmax: 1,
  genMs: 0, erodeMs: 0, splatMs: 0,
  erodedVol: 0, depositedVol: 0
};

let busy = false;

/* ------------------------------- helpers --------------------------------- */

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;

function fmtVol(v) {
  return (v >= 0 ? v : 0).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' m³';
}
function fmtMs(ms) {
  return ms < 1000 ? `${ms | 0} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function log(msg, level = 'info') {
  const c = $('console');
  const line = document.createElement('div');
  line.className = 'ln ' + level;
  const ts = new Date().toTimeString().slice(0, 8);
  line.innerHTML = `<span class="ts">${ts}</span> ${msg}`;
  c.appendChild(line);
  while (c.children.length > 200) c.removeChild(c.firstChild);
  c.scrollTop = c.scrollHeight;
}

function setProgress(frac, label) {
  $('progress-bar').style.width = (clamp(frac, 0, 1) * 100).toFixed(1) + '%';
  $('progress-label').textContent = label || '';
  $('progress-pct').textContent = Math.round(clamp(frac, 0, 1) * 100) + '%';
}

/* --------------------------- worker orchestration ------------------------ */

const worker = new Worker('js/terrain-worker.js');
const resolvers = {};

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'erode-progress') {
    const cell = 100 / ((T.n || P.gen.n) - 1);
    setProgress(m.iteration / m.iterations,
      `hydraulic erosion · iter ${m.iteration}/${m.iterations} · ${m.alive.toLocaleString()} drops alive · −${fmtVol(m.eroded * cell * cell)} / +${fmtVol(m.deposited * cell * cell)}`);
    return;
  }
  const r = resolvers[m.type];
  if (r) { delete resolvers[m.type]; r(m); }
};
worker.onerror = (e) => {
  log('worker error: ' + e.message, 'err');
  busy = false;
  setButtons(true);
};

function runWorker(msg, expect, transfer = []) {
  return new Promise((res) => {
    resolvers[expect] = res;
    worker.postMessage(msg, transfer);
  });
}

/* ------------------------------- three.js -------------------------------- */

const viewport = $('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.domElement.className = 'gl';
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x26313d, 260, 780);

/* sky dome */
{
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 512;
  const cx = cv.getContext('2d');
  const g = cx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.0, '#0e1520');
  g.addColorStop(0.38, '#22303f');
  g.addColorStop(0.52, '#41546a');
  g.addColorStop(0.60, '#5f7183');
  g.addColorStop(0.75, '#2a333d');
  g.addColorStop(1.0, '#151b22');
  cx.fillStyle = g;
  cx.fillRect(0, 0, 64, 512);
  const skyTex = new THREE.CanvasTexture(cv);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(700, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
  );
  scene.add(sky);
}

/* ground plane */
{
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(900, 64),
    new THREE.MeshStandardMaterial({ color: 0x161d25, roughness: 1.0, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  scene.add(ground);
}

/* lights */
const sun = new THREE.DirectionalLight(0xfff1dc, 2.9);
sun.position.set(70, 95, -45);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -75; sun.shadow.camera.right = 75;
sun.shadow.camera.top = 75; sun.shadow.camera.bottom = -75;
sun.shadow.camera.near = 20; sun.shadow.camera.far = 280;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.12;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x9fb4cc, 0x2a2e28, 0.55));

/* camera + controls */
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2500);
camera.position.set(78, 54, 96);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 10, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = 1.53;
controls.minDistance = 12;
controls.maxDistance = 420;
controls.autoRotateSpeed = 0.5;

/* --------------------------- terrain mesh -------------------------------- */

let terrainGeo = null;
let contourU = null, contourStepU = null;

/* placeholder texture keeps the USE_MAP define stable from frame one */
const placeholderTex = (() => {
  const d = new Uint8Array(2 * 2 * 4);
  d.fill(0x88);
  const t = new THREE.DataTexture(d, 2, 2);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
})();

const terrainMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  map: placeholderTex,
  roughness: 0.96,
  metalness: 0.0
});

/* contour-line overlay, injected into the standard material */
terrainMat.onBeforeCompile = (shader) => {
  shader.uniforms.uContour = (contourU = { value: P.view.contours ? 1 : 0 });
  shader.uniforms.uContourStep = (contourStepU = { value: P.view.contourStep });
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>',
      '#include <common>\nattribute float aH;\nvarying float vAHeight;')
    .replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvAHeight = aH;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>',
      '#include <common>\nvarying float vAHeight;\nuniform float uContour;\nuniform float uContourStep;')
    .replace('#include <dithering_fragment>',
      `#include <dithering_fragment>
      {
        float c = abs(fract(vAHeight / uContourStep - 0.5) - 0.5) * uContourStep;
        float line = (1.0 - smoothstep(0.0, 0.045, c)) * uContour;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.72, 0.83, 1.0), line * 0.5);
      }`);
};

const terrain = new THREE.Mesh(placeholderGeo(), terrainMat);
terrain.castShadow = true;
terrain.receiveShadow = true;
scene.add(terrain);

function placeholderGeo() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(4), 2));
  g.setAttribute('aH', new THREE.BufferAttribute(new Float32Array(4), 1));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  return g;
}

function buildGeometry(n) {
  const cell = 100 / (n - 1);
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  const aH = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const o = j * n + i;
      pos[o * 3] = (i - (n - 1) / 2) * cell;
      pos[o * 3 + 2] = (j - (n - 1) / 2) * cell;
      uv[o * 2] = i / (n - 1);
      uv[o * 2 + 1] = j / (n - 1);
    }
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let t = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[t++] = a; idx[t++] = c; idx[t++] = b;
      idx[t++] = c; idx[t++] = d; idx[t++] = b;
    }
  }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aH', new THREE.BufferAttribute(aH, 1));
  return g;
}

function rebuildMesh() {
  if (!T.h) return;
  const n = T.n;
  if (!terrainGeo || terrainGeo.userData.n !== n) {
    if (terrainGeo) terrainGeo.dispose();
    terrainGeo = buildGeometry(n);
    terrainGeo.userData.n = n;
    terrain.geometry = terrainGeo;
  }
  const posAttr = terrainGeo.attributes.position;
  const aHAttr = terrainGeo.attributes.aH;
  const pos = posAttr.array;
  for (let o = 0; o < T.h.length; o++) {
    pos[o * 3 + 1] = T.h[o];
    aHAttr.array[o] = T.h[o];
  }
  posAttr.needsUpdate = true;
  aHAttr.needsUpdate = true;
  terrainGeo.computeVertexNormals();
  terrainGeo.computeBoundingSphere();

  let max = 0, min = Infinity, acc = 0;
  for (let i = 0; i < T.h.length; i++) {
    const v = T.h[i];
    if (v > max) max = v;
    if (v < min) min = v;
    acc += v;
  }
  T.Hmax = max;
  updateHud({ min, max, mean: acc / (n * n) });
}

/* --------------------------- splat textures ------------------------------ */

let albedoTex = null, splatTex = null, texN = 0;

function makeSrgbTex(data, n) {
  const t = new THREE.DataTexture(data, n, n);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

function applyMaps() {
  terrainMat.map =
    P.view.splatView && splatTex ? splatTex : (albedoTex || placeholderTex);
  terrainMat.needsUpdate = true;
}

function setAlbedo(albedo, vis, n) {
  const rgba = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    rgba[i * 4] = albedo[i * 3];
    rgba[i * 4 + 1] = albedo[i * 3 + 1];
    rgba[i * 4 + 2] = albedo[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  if (texN !== n) {
    if (albedoTex) albedoTex.dispose();
    if (splatTex) splatTex.dispose();
    albedoTex = makeSrgbTex(rgba, n);
    splatTex = makeSrgbTex(new Uint8Array(vis), n);
    texN = n;
  } else {
    albedoTex.image.data.set(rgba);
    albedoTex.needsUpdate = true;
    splatTex.image.data.set(new Uint8Array(vis));
    splatTex.needsUpdate = true;
  }
  applyMaps();
  renderMiniSplat();
}

/* ------------------------------- minimaps -------------------------------- */

const miniOff = { cv: document.createElement('canvas'), n: 0 };

function putMini(canvasId, data /* Uint8ClampedArray n·n·4 */, n) {
  const cv = $(canvasId);
  if (miniOff.n !== n) { miniOff.cv.width = n; miniOff.cv.height = n; miniOff.n = n; }
  miniOff.cv.getContext('2d').putImageData(new ImageData(data, n, n), 0, 0);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(miniOff.cv, 0, 0, cv.width, cv.height);
}

function heightRamp(t) {
  const s = [[0, 20, 28, 40], [0.45, 51, 81, 122], [0.8, 127, 151, 179], [1, 232, 238, 244]];
  for (let k = 0; k < s.length - 1; k++) {
    const a = s[k], b = s[k + 1];
    if (t <= b[0]) {
      const f = (t - a[0]) / (b[0] - a[0]);
      return [lerp(a[1], b[1], f), lerp(a[2], b[2], f), lerp(a[3], b[3], f)];
    }
  }
  return [232, 238, 244];
}

function renderMiniHeight() {
  if (!T.h) return;
  const n = T.n;
  const d = new Uint8ClampedArray(n * n * 4);
  const inv = 1 / (T.Hmax || 1);
  for (let i = 0; i < n * n; i++) {
    const [r, g, b] = heightRamp(clamp(T.h[i] * inv, 0, 1));
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
  }
  putMini('mini-height', d, n);
}

function renderMiniSplat() {
  if (!T.vis) return;
  putMini('mini-splat', new Uint8ClampedArray(T.vis), T.n);
}

function renderMiniDelta() {
  const n = T.n;
  const d = new Uint8ClampedArray(n * n * 4);
  d.fill(16); // dark base alpha 100%
  for (let i = 0; i < n * n * 4; i += 4) d[i + 3] = 255;
  if (T.hBefore) {
    for (let i = 0; i < n * n; i++) {
      const dv = T.h[i] - T.hBefore[i];
      if (Math.abs(dv) < 0.002) continue;
      const t = clamp(Math.abs(dv) / 0.6, 0, 1);
      if (dv < 0) { d[i * 4] = 13 + 231 * t; d[i * 4 + 1] = 17 + 80 * t; d[i * 4 + 2] = 23 + 60 * t; }
      else { d[i * 4] = 13 + 39 * t; d[i * 4 + 1] = 17 + 194 * t; d[i * 4 + 2] = 23 + 130 * t; }
    }
  }
  putMini('mini-delta', d, n);
}

/* ---------------------------- HUD & status ------------------------------- */

let lastHudStats = null;
function updateHud(stats) {
  if (stats) lastHudStats = stats;
  const n = T.n || P.gen.n, cell = 100 / (n - 1);
  $('hud-line1').innerHTML =
    `GRID <b>${n}×${n}</b> · CELL <span class="num">${cell.toFixed(3)} m</span>`;
  $('hud-line2').innerHTML = lastHudStats
    ? `PEAK <b>${lastHudStats.max.toFixed(1)} m</b> · MEAN <b>${lastHudStats.mean.toFixed(1)} m</b> · BASE <b>${lastHudStats.min.toFixed(1)} m</b>`
    : '—';
  $('hud-line3').innerHTML = T.erodedVol
    ? `ERODED <b>−${fmtVol(T.erodedVol)}</b> · DEPOSITED <b>+${fmtVol(T.depositedVol)}</b>`
    : 'NO EROSION YET';
  $('hud-line4').innerHTML =
    `GEN <b>${T.genMs ? fmtMs(T.genMs) : '—'}</b> · ERODE <b>${T.erodeMs ? fmtMs(T.erodeMs) : '—'}</b> · SPLAT <b>${T.splatMs ? fmtMs(T.splatMs) : '—'}</b>`;

  $('sb-grid').innerHTML = `grid <b>${n}×${n}</b> · 100 m domain`;
  $('sb-voxel').innerHTML =
    `voxel <b>${cell.toFixed(3)} m</b> · cut <b>${P.ero.cutVoxels.toFixed(2)} vox</b> · step <b>${P.ero.stepVoxels.toFixed(2)} vox</b>`;
  $('sb-vol').innerHTML = T.erodedVol
    ? `vol <b>−${fmtVol(T.erodedVol)} / +${fmtVol(T.depositedVol)}</b>` : 'vol —';
  $('sb-peak').innerHTML = `peak <b>${T.Hmax ? T.Hmax.toFixed(1) : '—'} m</b>`;
  const t = (T.genMs + T.erodeMs + T.splatMs);
  $('sb-time').innerHTML = `time <b>${t ? fmtMs(t) : '—'}</b>`;
}

function updateVoxelNote() {
  const n = P.gen.n, cell = 100 / (n - 1);
  $('voxel-note').innerHTML =
    `voxel = <b>${cell.toFixed(3)} m</b> · ${n}×${n} on 100 m domain<br/>` +
    `max cut / step = <b>${P.ero.cutVoxels.toFixed(2)} vox = ${(P.ero.cutVoxels * cell).toFixed(4)} m</b><br/>` +
    `max deposit = <b>${P.ero.depVoxels.toFixed(2)} vox = ${(P.ero.depVoxels * cell).toFixed(4)} m</b><br/>` +
    `particle step = <b>${P.ero.stepVoxels.toFixed(2)} vox = ${(P.ero.stepVoxels * cell).toFixed(4)} m</b>`;
  $('sb-voxel').innerHTML =
    `voxel <b>${cell.toFixed(3)} m</b> · cut <b>${P.ero.cutVoxels.toFixed(2)} vox</b> · step <b>${P.ero.stepVoxels.toFixed(2)} vox</b>`;
}

/* ------------------------------- pipeline -------------------------------- */

async function generate() {
  setProgress(0.03, 'generating mountain · multi-fractal SDF');
  const m = await runWorker({ type: 'generate', params: { ...P.gen } }, 'height');
  T.h = m.h; T.n = m.n;
  T.hBefore = null; T.flow = null; T.dep = null;
  T.albedo = null; T.vis = null;
  T.genMs = m.ms;
  rebuildMesh();
  setAlbedoReset();
  renderMiniHeight();
  renderMiniDelta();
  log(`mountain generated — peak ${m.stats.max.toFixed(1)} m, mean ${m.stats.mean.toFixed(1)} m, ${m.h.length.toLocaleString()} voxels (${m.ms | 0} ms)`, 'ok');
}

function setAlbedoReset() {
  /* drop baked textures until the next splat bake */
  if (albedoTex) { albedoTex.dispose(); albedoTex = null; }
  if (splatTex) { splatTex.dispose(); splatTex = null; }
  texN = 0;
  applyMaps();
  T.vis = null;
  if (T.n) {
    const d = new Uint8ClampedArray(T.n * T.n * 4);
    d.fill(12);
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
    putMini('mini-splat', d, T.n);
  }
}

async function erode() {
  if (!T.h) await generate();
  setProgress(0.02, 'seeding particles on the SDF…');
  T.hBefore = T.h.slice();
  const m = await runWorker(
    { type: 'erode', h: T.h, n: T.n, params: { ...P.ero } },
    'eroded',
    [T.h.buffer]
  );
  T.h = m.h;
  T.flow = m.flow;
  T.dep = m.dep;
  T.erodedVol = m.stats.erodedVol;
  T.depositedVol = m.stats.depositedVol;
  T.erodeMs = m.ms;
  rebuildMesh();
  renderMiniHeight();
  renderMiniDelta();
  log(`hydraulic erosion done — eroded ${fmtVol(m.stats.erodedVol)}, deposited ${fmtVol(m.stats.depositedVol)}, peak ${m.stats.max.toFixed(1)} m (${m.ms | 0} ms)`, 'ok');
}

async function splat() {
  if (!T.h) await generate();
  const flow = T.flow || new Float32Array(T.n * T.n);
  const dep = T.dep || new Float32Array(T.n * T.n);
  setProgress(0.06, 'baking splat maps · flow / sediment / peak / pines / height');
  const m = await runWorker(
    {
      type: 'splat', h: T.h, flow, dep, n: T.n, Hmax: T.Hmax, sizeM: 100,
      params: { ...P.splat, seed: P.gen.seed }
    },
    'splat',
    [T.h.buffer, flow.buffer, dep.buffer]
  );
  T.h = m.h; T.flow = m.flow; T.dep = m.dep;
  T.albedo = m.albedo; T.vis = m.vis;
  T.splatMs = m.ms;
  setAlbedo(m.albedo, m.vis, m.n);
  log(`splat maps baked — flow ref ${m.stats.flowRef.toFixed(3)}, sediment ref ${m.stats.depRef.toFixed(4)} m (${m.ms | 0} ms)`, 'ok');
}

async function withBusy(fn) {
  if (busy) return;
  busy = true;
  setButtons(false);
  try {
    await fn();
    setProgress(1, 'complete');
  } catch (err) {
    console.error(err);
    log('error: ' + (err && err.message ? err.message : err), 'err');
    setProgress(0, 'failed');
  } finally {
    busy = false;
    setButtons(true);
  }
}

function setButtons(on) {
  $('btn-generate').disabled = !on;
  $('btn-erode').disabled = !on;
  $('btn-splat').disabled = !on;
  $('btn-pipeline').disabled = !on;
}

/* ------------------------------ UI wiring -------------------------------- */

function bindRange(id, apply, fmt) {
  const el = $(id);
  const val = $('v-' + id);
  const update = () => {
    const v = parseFloat(el.value);
    apply(v);
    if (val) val.textContent = fmt ? fmt(v) : v;
    updateVoxelNote();
    updateHud(null);
  };
  el.addEventListener('input', update);
  update();
}

/* generation */
$('gen-seed').addEventListener('input', (e) => {
  P.gen.seed = Math.max(1, Math.abs(Math.round(parseFloat(e.target.value) || 1)));
});
$('gen-seed-rand').addEventListener('click', () => {
  P.gen.seed = 1 + Math.floor(Math.random() * 999999);
  $('gen-seed').value = P.gen.seed;
  log(`seed → ${P.gen.seed}`);
});
$('gen-grid').addEventListener('change', (e) => {
  P.gen.n = parseInt(e.target.value, 10);
  updateVoxelNote();
  log(`grid resolution → ${P.gen.n}×${P.gen.n} (voxel ${(100 / (P.gen.n - 1)).toFixed(3)} m)`);
});
bindRange('gen-heightM', (v) => P.gen.heightM = v, (v) => v.toFixed(0) + ' m');
bindRange('gen-octaves', (v) => P.gen.octaves = Math.round(v), (v) => v.toFixed(0));
bindRange('gen-persistence', (v) => P.gen.persistence = v, (v) => v.toFixed(2));
bindRange('gen-ridgedMix', (v) => P.gen.ridgedMix = v, (v) => (v * 100).toFixed(0) + '%');
bindRange('gen-ridgeExp', (v) => P.gen.ridgeExp = v, (v) => v.toFixed(2));
bindRange('gen-warp', (v) => P.gen.warp = v, (v) => v.toFixed(2));
bindRange('gen-sharpness', (v) => P.gen.sharpness = v, (v) => v.toFixed(2));
bindRange('gen-baseFreq', (v) => P.gen.baseFreq = v, (v) => v.toFixed(1));

/* erosion */
bindRange('ero-particles', (v) => P.ero.particles = Math.round(v), (v) => (v / 1000).toFixed(0) + 'k');
bindRange('ero-iterations', (v) => P.ero.iterations = Math.round(v), (v) => v.toFixed(0));
bindRange('ero-stepsPerIter', (v) => P.ero.stepsPerIter = Math.round(v), (v) => v.toFixed(0));
bindRange('ero-rain', (v) => P.ero.rain = v, (v) => v.toFixed(2));
bindRange('ero-capacityK', (v) => P.ero.capacityK = v, (v) => v.toFixed(2));
bindRange('ero-cutVoxels', (v) => P.ero.cutVoxels = v,
  (v) => `${v.toFixed(2)} vox · ${(v * 100 / (P.gen.n - 1)).toFixed(3)} m`);
bindRange('ero-depVoxels', (v) => P.ero.depVoxels = v,
  (v) => `${v.toFixed(2)} vox · ${(v * 100 / (P.gen.n - 1)).toFixed(3)} m`);
bindRange('ero-stepVoxels', (v) => P.ero.stepVoxels = v,
  (v) => `${v.toFixed(2)} vox · ${(v * 100 / (P.gen.n - 1)).toFixed(3)} m`);
bindRange('ero-evap', (v) => P.ero.evap = v, (v) => v.toFixed(3));
bindRange('ero-respawnFrac', (v) => P.ero.respawnFrac = v, (v) => (v * 100).toFixed(0) + '%');
bindRange('ero-slideLimit', (v) => P.ero.slideLimit = v,
  (v) => `${v.toFixed(2)} · ${(Math.atan(v) * 180 / Math.PI).toFixed(0)}°`);
bindRange('ero-massWaste', (v) => P.ero.massWaste = Math.round(v), (v) => v.toFixed(0));

/* splat intensities */
bindRange('splat-flow', (v) => P.splat.flow = v, (v) => v.toFixed(2));
bindRange('splat-sediment', (v) => P.splat.sediment = v, (v) => v.toFixed(2));
bindRange('splat-peak', (v) => P.splat.peak = v, (v) => v.toFixed(2));
bindRange('splat-pines', (v) => P.splat.pines = v, (v) => v.toFixed(2));
bindRange('splat-base', (v) => P.splat.base = v, (v) => v.toFixed(2));

/* view */
$('view-autoRotate').addEventListener('change', (e) => {
  P.view.autoRotate = e.target.checked;
  controls.autoRotate = P.view.autoRotate;
});
$('view-contours').addEventListener('change', (e) => {
  P.view.contours = e.target.checked;
  if (contourU) contourU.value = P.view.contours ? 1 : 0;
});
$('view-splatView').addEventListener('change', (e) => {
  if (P.view.splatView && !splatTex) {
    e.target.checked = false;
    log('splat view unavailable — bake splat maps first', 'err');
    return;
  }
  P.view.splatView = e.target.checked;
  applyMaps();
  log(P.view.splatView ? 'splat-map view ON (R flow · G sediment · B peak · A pines)' : 'splat-map view OFF');
});
$('view-wireframe').addEventListener('change', (e) => {
  P.view.wireframe = e.target.checked;
  terrainMat.wireframe = P.view.wireframe;
});
$('view-shadows').addEventListener('change', (e) => {
  P.view.shadows = e.target.checked;
  sun.castShadow = P.view.shadows;
  terrain.castShadow = P.view.shadows;
});
bindRange('view-contourStep', (v) => {
  P.view.contourStep = v;
  if (contourStepU) contourStepU.value = v;
}, (v) => v.toFixed(1) + ' m');

/* buttons */
$('btn-generate').addEventListener('click', () => withBusy(generate));
$('btn-erode').addEventListener('click', () => withBusy(erode));
$('btn-splat').addEventListener('click', () => withBusy(splat));
$('btn-pipeline').addEventListener('click', () => withBusy(async () => {
  await generate();
  await erode();
  await splat();
  log('full pipeline complete — generate → hydraulic erosion → splat bake', 'ok');
}));

$('btn-shot').addEventListener('click', () => {
  renderer.render(scene, camera);
  const a = document.createElement('a');
  a.href = renderer.domElement.toDataURL('image/png');
  a.download = `frontier-terrain-${T.n}x${T.n}.png`;
  a.click();
  log('screenshot saved (PNG)');
});

/* ------------------------------- resize ---------------------------------- */

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (w === 0 || h === 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(viewport);

/* -------------------------------- render --------------------------------- */

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

/* --------------------------------- boot ---------------------------------- */

resize();
updateVoxelNote();
log('Frontier SDF Terrain Studio — ready');
log('SDF surface: d(x,y,z) = z − h(x,y) · erosion carves the field directly (no mesh)', 'info');
log('auto-starting full pipeline: generate → hydraulic erosion → splat bake…');
withBusy(async () => {
  await generate();
  await erode();
  await splat();
  log('full pipeline complete — generate → hydraulic erosion → splat bake', 'ok');
});
