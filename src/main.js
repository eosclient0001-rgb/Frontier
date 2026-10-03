// Frontier Cloth Studio — entry point.
import { ClothStudio } from './app.js';
import { m4, v3, clamp, TAU } from './math.js';
import { DEFAULT_FABRIC, packFabric, FABRIC_PRESETS, PATTERN_TYPES, MOTIF_STYLES } from './fabric.js';
import * as UI from './ui.js';

// ------------------------------------------------------------------ state
const P = {
  // --- mannequin
  height: 1.70,
  shoulders: 1.0,
  bust: 1.0,
  waist: 0.92,
  hips: 1.06,
  bustHeight: 1.0,
  armAngle: 16,
  legSpread: 0,
  bodySegments: 44,

  // --- dress
  style: 'aline',
  length: 0.60,
  fit: 1.030,
  ease: 1.0,
  flare: 1.0,
  pleats: 14,
  pleatDepth: 0.020,
  neckline: 'sweetheart',
  straps: 1,
  strapWidth: 0.030,
  strapInset: 0,
  strapPinRange: 0.16,
  neckDrop: 1.0,
  hemSweep: 1.0,
  tierAmp: 1.0,
  resolution: 96,
  pinTopRows: 2,
  arealDensity: 0.20,

  constraintParams: { stretchComp: 1.5e-6, shearComp: 3e-5, bendComp: 8e-4, stitchComp: 1e-7 },
};

const FABRIC = { ...DEFAULT_FABRIC };
const fabricUniform = new Float32Array(32);
packFabric(FABRIC, fabricUniform);

// viewport-independent view state (kept out of the studio so the panel can be
// built even if the GPU device failed to initialise)
const view = { previewZoom: 3.0 };

const SIM = {
  gravity: [0, -9.81, 0],
  gravityOn: 1,
  windSpeed: 0,
  windAngle: 0.0,
  windGust: 1,
  airDrag: 0.35,
  damping: 0.008,
  thickness: 0.006,
  friction: 0.55,
  restitution: 0.02,
  substeps: 2,
  iterations: 6,
  floorY: 0.0,
  pinBlend: 1.0,
  pinEvery: 2,
  bodyCollision: 1,
  pinsEnabled: true,
  timeScale: 1.0,
};

const m4Inv = new Float32Array(16);

const camera = {
  yaw: 0.42,
  pitch: 0.10,
  dist: 2.85,
  target: [0, 0.95, 0],
  fov: 38 * Math.PI / 180,
  lightDir: v3.norm([0.45, 0.72, 0.62]),
  lightCol: [1.05, 1.02, 0.98],
  ambient: [0.16, 0.175, 0.21],
};

let studio = null;
let needsRebuild = true;
let lastRebuild = 0;
let dropTimer = 0;

const canvas = document.getElementById('viewport');
const fabricCanvas = document.getElementById('fabricCanvas');
const errorBox = document.getElementById('error');

function showError(msg) {
  errorBox.hidden = false;
  errorBox.innerHTML = `<b>Could not start the cloth simulator</b><br><br>${msg}`;
}

// ------------------------------------------------------------------ boot
(async function boot() {
  try {
    studio = await ClothStudio.create(canvas, fabricCanvas, P, FABRIC);
  } catch (e) {
    console.error(e);
    showError(String(e.message ?? e));
    return;
  }
  studio.onError = (msg) => {
    console.error(msg);
    const box = document.getElementById('error');
    box.hidden = false;
    box.textContent = msg;
  };
  const info = studio.info ?? {};
  const gpuName = info.description || info.device || info.vendor || 'WebGPU device';
  document.getElementById('gpuinfo').textContent = String(gpuName).slice(0, 42);
  studio.previewZoom = view.previewZoom;

  studio.rebuild();
  lastRebuild = performance.now();
  buildUI();
  setupInput();
  requestAnimationFrame(loop);
})();

// ------------------------------------------------------------------ UI
function markStructural() { needsRebuild = true; }
function markCompliance() { complianceDirty = true; }
let complianceDirty = false;

function buildUI() {
  const panes = {};
  document.querySelectorAll('.pane').forEach((p) => (panes[p.dataset.pane] = p));
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      Object.entries(panes).forEach(([k, p]) => p.classList.toggle('active', k === b.dataset.tab));
    };
  });

  // ---------------------------------------------------------------- FABRIC
  {
    const pane = panes.fabric;
    const s1 = UI.section(pane, 'Fabric Library', 'presets');
    UI.presetGrid(s1, (preset) => {
      Object.assign(FABRIC, preset);
      document.getElementById('fabricName').textContent = preset.name;
      syncFabricControls();
    });

    const s2 = UI.section(pane, 'Pattern', 'generator');
    UI.select(s2, 'Pattern type', FABRIC, 'type', PATTERN_TYPES, syncFabricControls);
    UI.slider(s2, 'Pattern scale', FABRIC, 'scale', 0.4, 16, 0.1, pushFabric, (v) => v.toFixed(2));
    UI.slider(s2, 'Rotation', FABRIC, 'rotation', 0, Math.PI * 2, 0.01, pushFabric, degFmt);
    UI.slider(s2, 'Stripe width', FABRIC, 'stripeWidth', 0.02, 0.9, 0.01, pushFabric);
    UI.slider(s2, 'Stripe angle', FABRIC, 'stripeAngle', 0, Math.PI, 0.01, pushFabric, degFmt);
    UI.slider(s2, 'Dot radius', FABRIC, 'dotRadius', 0.05, 0.6, 0.01, pushFabric);
    UI.slider(s2, 'Motif count', FABRIC, 'motifCount', 2, 14, 1, pushFabric, (v) => v.toFixed(0));
    UI.select(s2, 'Motif style', FABRIC, 'motifStyle', MOTIF_STYLES, pushFabric);

    const s3 = UI.section(pane, 'Colour', 'palette');
    UI.color(s3, 'Base colour', FABRIC, 'colA', pushFabric);
    UI.color(s3, 'Accent colour', FABRIC, 'colB', pushFabric);
    UI.color(s3, 'Shadow colour', FABRIC, 'colC', pushFabric);

    const s4 = UI.section(pane, 'Weave & Surface', 'micro detail');
    UI.slider(s4, 'Weave bump', FABRIC, 'weaveAmount', 0, 1.5, 0.01, pushFabric);
    UI.slider(s4, 'Weave scale', FABRIC, 'weaveScale', 0.3, 4, 0.05, pushFabric);
    UI.slider(s4, 'Dye variation', FABRIC, 'noiseAmount', 0, 1.5, 0.01, pushFabric);
    UI.slider(s4, 'Variation scale', FABRIC, 'noiseScale', 0.1, 4, 0.05, pushFabric);
    UI.slider(s4, 'Roughness', FABRIC, 'roughness', 0.05, 1, 0.01, pushFabric);
    UI.slider(s4, 'Sheen', FABRIC, 'sheen', 0, 1.2, 0.01, pushFabric);
    UI.slider(s4, 'Swatch zoom', view, 'previewZoom', 0.5, 12, 0.1, () => {
      if (studio) studio.previewZoom = view.previewZoom;
    });

    const s5 = UI.section(pane, 'Overlays', 'stacked layers', false);
    UI.slider(s5, 'Stripes', FABRIC, 'amountStripe', 0, 1, 0.01, pushFabric);
    UI.slider(s5, 'Plaid', FABRIC, 'amountPlaid', 0, 1, 0.01, pushFabric);
    UI.slider(s5, 'Dots', FABRIC, 'amountDot', 0, 1, 0.01, pushFabric);
    UI.slider(s5, 'Motifs', FABRIC, 'amountMotif', 0, 1, 0.01, pushFabric);
  }

  // ---------------------------------------------------------------- DRESS
  {
    const pane = panes.dress;
    const s0 = UI.section(pane, 'Garment', 'pattern block');
    UI.select(s0, 'Style', P, 'style', UI.styleOptions(), markStructural);
    UI.select(s0, 'Neckline', P, 'neckline', UI.NECKLINE_OPTIONS, markStructural);
    UI.slider(s0, 'Length', P, 'length', 0, 1, 0.01, markStructural, pctFmt);
    UI.slider(s0, 'Skirt flare', P, 'flare', 0, 2.5, 0.01, markStructural);
    UI.slider(s0, 'Body ease', P, 'ease', 0, 3, 0.01, markStructural);
    UI.slider(s0, 'Fit tightness', P, 'fit', 1.0, 1.14, 0.001, markStructural, (v) => v.toFixed(3));
    UI.slider(s0, 'Neckline depth', P, 'neckDrop', 0, 2, 0.01, markStructural);
    UI.slider(s0, 'Hem sweep', P, 'hemSweep', 0, 2, 0.01, markStructural);

    const s1 = UI.section(pane, 'Pleats & Drapes', 'gather');
    UI.slider(s1, 'Pleat count', P, 'pleats', 0, 48, 1, markStructural, (v) => v.toFixed(0));
    UI.slider(s1, 'Pleat depth', P, 'pleatDepth', 0, 0.06, 0.001, markStructural, (v) => v.toFixed(3));
    UI.slider(s1, 'Tier gather', P, 'tierAmp', 0, 2, 0.01, markStructural);

    const s2 = UI.section(pane, 'Straps & Seams', 'construction');
    UI.toggle(s2, 'Shoulder straps', P, 'straps', markStructural);
    UI.slider(s2, 'Strap width', P, 'strapWidth', 0.01, 0.08, 0.001, markStructural, (v) => v.toFixed(3));
    UI.slider(s2, 'Strap inset', P, 'strapInset', -30, 30, 1, markStructural, (v) => v.toFixed(0) + '°');
    UI.slider(s2, 'Seam pin width', P, 'strapPinRange', 0.02, 0.45, 0.01, markStructural);
    UI.slider(s2, 'Pinned top rows', P, 'pinTopRows', 0, 6, 1, markStructural, (v) => v.toFixed(0));

    const s3 = UI.section(pane, 'Mesh', 'simulation resolution', false);
    UI.slider(s3, 'Cloth resolution', P, 'resolution', 40, 150, 2, markStructural,
      (v) => `${v}×${Math.round(v * 0.8)}`);
    const btnRow = UI.buttonRow(pane, [
      { id: 'reset', label: 'Reset cloth', cls: 'primary', onClick: () => studio?.resetSim() },
      { id: 'relax', label: 'Settle 1s', onClick: () => settle(60) },
    ]);
    void btnRow;
  }

  // ---------------------------------------------------------------- PHYSICS
  {
    const pane = panes.physics;
    const s1 = UI.section(pane, 'Material Response', 'XPBD compliance');
    const cp = P.constraintParams;
    UI.slider(s1, 'Stretch stiffness', cp, 'stretchComp', 1e-8, 2e-4, 1e-8, markCompliance, sciFmt);
    UI.slider(s1, 'Shear stiffness', cp, 'shearComp', 1e-7, 2e-3, 1e-7, markCompliance, sciFmt);
    UI.slider(s1, 'Bending stiffness', cp, 'bendComp', 1e-5, 2e-2, 1e-6, markCompliance, sciFmt);
    UI.slider(s1, 'Seam stiffness', cp, 'stitchComp', 1e-9, 1e-5, 1e-9, markCompliance, sciFmt);
    UI.slider(s1, 'Areal density (kg/m²)', P, 'arealDensity', 0.03, 0.9, 0.005, markStructural, (v) => v.toFixed(3));

    const s2 = UI.section(pane, 'Forces');
    UI.slider(s2, 'Gravity', SIM, 'gravityOn', 0, 1, 1, null, (v) => (v ? 'on' : 'off'));
    UI.slider(s2, 'Wind speed', SIM, 'windSpeed', 0, 14, 0.1, null, (v) => v.toFixed(1));
    UI.slider(s2, 'Wind direction', SIM, 'windAngle', 0, TAU, 0.01, null, degFmt);
    UI.slider(s2, 'Gustiness', SIM, 'windGust', 0, 1, 0.01, null);
    UI.slider(s2, 'Air drag', SIM, 'airDrag', 0, 2, 0.01, null);
    UI.slider(s2, 'Damping', SIM, 'damping', 0, 0.06, 0.001, null, (v) => v.toFixed(3));

    const s3 = UI.section(pane, 'Contacts');
    UI.slider(s3, 'Collision thickness (m)', SIM, 'thickness', 0.001, 0.03, 0.001, null, (v) => v.toFixed(3));
    UI.slider(s3, 'Body friction', SIM, 'friction', 0, 1, 0.01, null);
    UI.slider(s3, 'Bounciness', SIM, 'restitution', 0, 0.6, 0.01, null);

    const s4 = UI.section(pane, 'Solver', 'quality vs speed');
    UI.slider(s4, 'Substeps', SIM, 'substeps', 1, 6, 1, null, (v) => v.toFixed(0));
    UI.slider(s4, 'Iterations', SIM, 'iterations', 1, 16, 1, null, (v) => v.toFixed(0));
    UI.slider(s4, 'Pin solve every N', SIM, 'pinEvery', 1, 8, 1, null, (v) => v.toFixed(0));
  }

  // ---------------------------------------------------------------- BODY
  {
    const pane = panes.body;
    const s1 = UI.section(pane, 'Mannequin', 'procedural figure');
    UI.slider(s1, 'Height (m)', P, 'height', 1.5, 1.95, 0.005, markStructural, (v) => v.toFixed(3));
    UI.slider(s1, 'Shoulders', P, 'shoulders', 0.7, 1.35, 0.01, markStructural);
    UI.slider(s1, 'Bust', P, 'bust', 0.6, 1.6, 0.01, markStructural);
    UI.slider(s1, 'Waist', P, 'waist', 0.6, 1.6, 0.01, markStructural);
    UI.slider(s1, 'Hips', P, 'hips', 0.7, 1.5, 0.01, markStructural);
    UI.slider(s1, 'Bust height', P, 'bustHeight', 0.5, 1.5, 0.01, markStructural);
    UI.slider(s1, 'Arm angle', P, 'armAngle', 0, 60, 1, markStructural, (v) => v.toFixed(0) + '°');
    UI.slider(s1, 'Leg spread', P, 'legSpread', 0, 14, 0.5, markStructural, (v) => v.toFixed(1) + '°');
    UI.slider(s1, 'Surface detail', P, 'bodySegments', 20, 72, 2, markStructural, (v) => v.toFixed(0));
  }

  // ---------------------------------------------------------------- SCENE
  {
    const pane = panes.scene;
    const s1 = UI.section(pane, 'Lighting', 'studio');
    const lightAngleSlot = { a: 0.62 };
    UI.slider(s1, 'Key light azimuth', lightAngleSlot, 'a', 0, TAU, 0.01, () => {
      camera.lightDir = v3.norm([Math.cos(lightAngleSlot.a) * 0.8, 0.72, Math.sin(lightAngleSlot.a) * 0.8]);
    }, degFmt);
    const li = { i: 1.0 };
    UI.slider(s1, 'Key intensity', li, 'i', 0.2, 2.2, 0.01, () => {
      camera.lightCol = [1.05 * li.i, 1.02 * li.i, 0.98 * li.i];
    });
    const ai = { v: 0.19 };
    UI.slider(s1, 'Ambient', ai, 'v', 0, 0.6, 0.005, () => {
      camera.ambient = [ai.v, ai.v * 1.06, ai.v * 1.25];
    });

    const s2 = UI.section(pane, 'Simulation', 'playback');
    UI.slider(s2, 'Time scale', SIM, 'timeScale', 0.1, 2, 0.01, null);
    UI.toggle(s2, 'Gravity', SIM, 'gravityOn', null);
    UI.toggle(s2, 'Body collision', SIM, 'bodyCollision', null);
    const nav = UI.section(pane, 'Camera', 'viewport');
    UI.buttonRow(nav, [
      { id: 'front', label: 'Front', onClick: () => setCam(0, 0.02, 2.7) },
      { id: 'side', label: 'Side', onClick: () => setCam(Math.PI / 2, 0.02, 2.7) },
      { id: 'back', label: 'Back', onClick: () => setCam(Math.PI, 0.02, 2.7) },
      { id: 'three', label: '¾', onClick: () => setCam(0.42, 0.1, 2.85) },
      { id: 'full', label: 'Full body', onClick: () => setCam(0.42, 0.06, 3.6) },
    ]);
  }

  syncFabricControls();
  updateHudCounts();
}

function pushFabric() { packFabric(FABRIC, fabricUniform); }
function setCam(yaw, pitch, dist) {
  camera.yaw = yaw; camera.pitch = pitch; camera.dist = dist;
}
function settle(seconds) {
  if (!studio) return;
  for (let i = 0; i < seconds; i++) { studio.worldTime += 1 / 60; studio.step(1 / 60, simConfig()); }
}

function syncFabricControls() {
  UI.refreshAll();
  pushFabric();
}

function updateHudCounts() {
  const verts = studio?.vertexCount?.toLocaleString() ?? '—';
  const cons = studio?.constraints?.count?.toLocaleString() ?? '—';
  document.getElementById('verts').textContent = verts;
  document.getElementById('cons').textContent = cons;
}

function degFmt(v) { return (v * 180 / Math.PI).toFixed(0) + '°'; }
function pctFmt(v) { return (v * 100).toFixed(0) + '%'; }
function sciFmt(v) { return Number(v).toExponential(1); }

function simConfig() {
  const g = SIM.gravityOn ? 1 : 0;
  const windDir = [Math.sin(SIM.windAngle), 0.06, Math.cos(SIM.windAngle)];
  const gust = SIM.windGust;
  const wind = SIM.windSpeed === 0 ? [0, 0, 0] : [
    windDir[0] * SIM.windSpeed * (0.7 + 0.3 * gust * Math.sin((studio?.worldTime ?? 0) * 0.9)),
    windDir[1] * SIM.windSpeed * 0.35,
    windDir[2] * SIM.windSpeed * (0.7 + 0.3 * gust * Math.cos((studio?.worldTime ?? 0) * 1.3)),
  ];
  return {
    gravity: [SIM.gravity[0] * g, SIM.gravity[1] * g, SIM.gravity[2] * g],
    wind,
    airDrag: SIM.airDrag,
    damping: SIM.damping,
    thickness: SIM.thickness,
    friction: SIM.friction,
    restitution: SIM.restitution,
    substeps: SIM.substeps,
    iterations: SIM.iterations,
    floorY: SIM.floorY,
    pinBlend: SIM.pinBlend,
    pinEvery: SIM.pinEvery,
    bodyCollision: !!SIM.bodyCollision,
  };
}

// ------------------------------------------------------------------ input
function setupInput() {
  if (!studio) return;
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) {
      const s = camera.dist * 0.0016;
      const right = [Math.cos(camera.yaw), 0, -Math.sin(camera.yaw)];
      camera.target[0] -= right[0] * dx * s;
      camera.target[2] -= right[2] * dx * s;
      camera.target[1] = clamp(camera.target[1] + dy * s, 0.1, 2.2);
    } else {
      camera.yaw -= dx * 0.0075;
      camera.pitch = clamp(camera.pitch + dy * 0.005, -0.55, 1.15);
    }
  });
  canvas.addEventListener('pointerup', (e) => { drag = null; canvas.releasePointerCapture?.(e.pointerId); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.dist = clamp(camera.dist * (1 + Math.sign(e.deltaY) * 0.08), 0.7, 8);
  }, { passive: false });

  const playBtn = document.getElementById('btnPlay');
  playBtn.onclick = () => {
    studio.paused = !studio.paused;
    playBtn.textContent = studio.paused ? 'Play' : 'Pause';
    document.getElementById('statuspill').textContent = studio.paused ? 'paused' : 'simulating';
    document.getElementById('statuspill').className = studio.paused ? 'pill paused' : 'pill live';
  };
  document.getElementById('btnReset').onclick = () => studio.resetSim();

  const dropBtn = document.getElementById('btnDrop');
  dropBtn.onclick = () => {
    SIM.pinsEnabled = !SIM.pinsEnabled;
    dropBtn.classList.toggle('active', !SIM.pinsEnabled);
    dropBtn.textContent = SIM.pinsEnabled ? 'Drop from body' : 'Pin back on';
  };

  const danceBtn = document.getElementById('btnDance');
  danceBtn.onclick = () => {
    dance.on = !dance.on;
    danceBtn.classList.toggle('active', dance.on);
    if (!dance.on) { studio.bodyMatrix = null; studio.bodyMatrixInverse = null; }
  };
  document.getElementById('statuspill').className = 'pill live';
}

const dance = { on: false, t: 0 };

function bodyTransform(dt) {
  if (!dance.on) return null;
  dance.t += dt;
  const t = dance.t;
  const yaw = Math.sin(t * 0.7) * 0.55 + Math.sin(t * 1.9) * 0.12;
  const bob = Math.sin(t * 1.85) * 0.035 + Math.sin(t * 0.9) * 0.012;
  const lean = Math.sin(t * 0.7 + 1.2) * 0.06;
  const sway = Math.sin(t * 1.4) * 0.05;
  const rotY = m4.identity();
  const c = Math.cos(yaw), s = Math.sin(yaw);
  rotY[0] = c; rotY[2] = -s; rotY[8] = s; rotY[10] = c;
  const leanM = m4.identity();
  const cl = Math.cos(lean), sl = Math.sin(lean);
  leanM[5] = cl; leanM[6] = sl; leanM[9] = -sl; leanM[10] = cl;
  const model = m4.mul(m4.translate([sway, bob, 0]), m4.mul(rotY, leanM));
  const inv = m4.mul(m4.mul(inverseRigid(leanM), inverseRigid(rotY)), m4.translate([-sway, -bob, 0]));
  return { model, inv };
}

function inverseRigid(M) {
  // transpose of the rotation block + inverse translation
  const o = m4.identity();
  o[0] = M[0]; o[4] = M[1]; o[8] = M[2];
  o[1] = M[4]; o[5] = M[5]; o[9] = M[6];
  o[2] = M[8]; o[6] = M[9]; o[10] = M[10];
  o[12] = -(o[0] * M[12] + o[4] * M[13] + o[8] * M[14]);
  o[13] = -(o[1] * M[12] + o[5] * M[13] + o[9] * M[14]);
  o[14] = -(o[2] * M[12] + o[6] * M[13] + o[10] * M[14]);
  return o;
}

// ------------------------------------------------------------------ loop
let last = performance.now();
let fpsAcc = 0, fpsCount = 0, fpsTimer = 0;
let simAccumulator = 0;

function loop(now) {
  const rawDt = Math.min((now - last) / 1000, 0.05);
  last = now;

  // debounced structural rebuilds
  if (needsRebuild && now - lastRebuild > 90) {
    needsRebuild = false;
    lastRebuild = now;
    try {
      studio.rebuild();
      updateHudCounts();
    } catch (e) {
      console.error(e);
      showError('Rebuild failed: ' + (e.message ?? e));
    }
  }
  if (complianceDirty && studio.constraints) {
    complianceDirty = false;
    studio.updateCompliance(P.constraintParams);
  }

  // ease the pin weight so "drop" / "pin back" glide instead of snapping
  const pinTarget = SIM.pinsEnabled ? 1 : 0;
  SIM.pinBlend += (pinTarget - SIM.pinBlend) * Math.min(1, rawDt * 4);

  // fixed timestep physics
  if (!studio.paused) {
    simAccumulator += rawDt * SIM.timeScale;
    const fixed = 1 / 60;
    let steps = 0;
    while (simAccumulator >= fixed && steps < 3) {
      simAccumulator -= fixed;
      studio.worldTime += fixed;
      studio.step(fixed, simConfig());
      steps++;
    }
    if (steps === 0 && rawDt > 0) { /* frame skipped, keeps motion smooth */ }
  }

  // dance rig
  if (studio) studio.previewZoom = view.previewZoom;

  const bt = bodyTransform(rawDt);
  if (bt) {
    studio.bodyMatrix = bt.model;
    studio.bodyMatrixInverse = bt.inv;
    studio.updatePins(bt.model);
  } else if (studio.bodyMatrix) {
    studio.bodyMatrix = null;
    studio.bodyMatrixInverse = null;
    studio.updatePins(m4.identity());
  }

  // keep the eye above the studio floor so the ground plane never occludes
  if (camera.target[1] + camera.dist * Math.sin(camera.pitch) < 0.14) {
    camera.pitch = Math.asin(clamp((0.14 - camera.target[1]) / camera.dist, -1, 1));
  }
  const eye = [
    camera.target[0] + camera.dist * Math.sin(camera.yaw) * Math.cos(camera.pitch),
    camera.target[1] + camera.dist * Math.sin(camera.pitch),
    camera.target[2] + camera.dist * Math.cos(camera.yaw) * Math.cos(camera.pitch),
  ];
  const aspect = canvas.width / Math.max(1, canvas.height);
  const proj = m4.perspective(camera.fov, aspect, 0.05, 60);
  const view = m4.lookAt(eye, camera.target, [0, 1, 0]);
  const vp = m4.mul(proj, view);

  studio.render({
    viewProj: vp,
    invViewProj: m4.invert(vp, m4Inv),
    eye,
    lightDir: camera.lightDir,
    lightCol: camera.lightCol,
    ambient: camera.ambient,
  }, fabricUniform);

  // hud
  fpsAcc += rawDt; fpsCount++; fpsTimer += rawDt;
  if (fpsTimer > 0.35) {
    document.getElementById('fps').textContent = (fpsCount / fpsAcc).toFixed(0);
    fpsAcc = 0; fpsCount = 0; fpsTimer = 0;
  }

  requestAnimationFrame(loop);
}

// exposed for the headless UI smoke test (tools/ui-smoke.mjs)
export { P, FABRIC, SIM, camera, buildUI, simConfig, fabricUniform, view };
