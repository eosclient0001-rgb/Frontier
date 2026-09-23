// ============================================================================
//  app.js — UI orchestration: schema-driven controls, worker pipeline,
//  audit/contract panels, SAT map gallery, exports.
// ============================================================================

import { FrontierViewer } from './gl.js';

// ---------------------------------------------------------------------------
//  parameter schema — every control in the left rail
// ---------------------------------------------------------------------------
const SCHEMA = [
  {
    group: 'Domain', open: true, items: [
      { key: 'seed', type: 'seed', label: 'Seed', value: 1337, hint: 'master seed — terrain, warp and hydraulics derive from it' },
      {
        key: 'quality', type: 'seg', label: 'Voxel resolution', value: 192,
        options: [
          { id: 128, label: '128·fast' },
          { id: 192, label: '192·balanced' },
          { id: 224, label: '224·high' },
          { id: 288, label: '288·ultra' },
        ], hint: 'grid width — sets the isotropic voxel size'
      },
    ]
  },
  {
    group: 'Mountain — multifractal', open: true, items: [
      { key: 'style', type: 'select', label: 'Noise style', value: 'ridged', options: [['ridged', 'Ridged multifractal'], ['hybrid', 'Hybrid multifractal'], ['fbm', 'fBm']] },
      { key: 'arrangement', type: 'select', label: 'Peak arrangement', value: 'single', options: [['single', 'Single massif'], ['twin', 'Twin peaks'], ['ridge', 'Ridge line'], ['range', 'Mountain range']] },
      { key: 'baseFreq', type: 'range', label: 'Base frequency', min: 0.006, max: 0.03, step: 0.001, value: 0.016, fmt: v => v.toFixed(3), hint: 'wavelength of the largest landform' },
      { key: 'peakHeight', type: 'range', label: 'Relief', min: 10, max: 52, step: 1, value: 30, fmt: v => v + ' m' },
      { key: 'peakRadius', type: 'range', label: 'Massif radius', min: 22, max: 48, step: 1, value: 40, fmt: v => v + ' m' },
      { key: 'maskPower', type: 'range', label: 'Mask falloff', min: 1.4, max: 4, step: 0.1, value: 2.4, fmt: v => 'p ' + v.toFixed(1) },
      { key: 'octaves', type: 'range', label: 'Octaves (requested)', min: 3, max: 12, step: 1, value: 9, fmt: v => v + '', hint: 'auto-clamped so detail ≥ 3 voxels' },
      { key: 'gain', type: 'range', label: 'Gain', min: 0.35, max: 0.62, step: 0.01, value: 0.46, fmt: v => v.toFixed(2) },
      { key: 'warp', type: 'range', label: 'Domain warp', min: 0, max: 20, step: 0.5, value: 8, fmt: v => v.toFixed(1) + ' m' },
      { key: 'tiltStrength', type: 'range', label: 'Tilt gradient', min: 0, max: 14, step: 0.5, value: 4, fmt: v => v.toFixed(1) + ' m' },
      { key: 'tiltAngleDeg', type: 'range', label: 'Tilt bearing', min: 0, max: 359, step: 1, value: 35, fmt: v => v + '°' },
      { key: 'baseHeight', type: 'range', label: 'Base elevation', min: 4, max: 24, step: 1, value: 12, fmt: v => v + ' m' },
    ]
  },
  {
    group: 'Hydraulic erosion — SDF particles', open: true, items: [
      { key: 'droplets', type: 'range', label: 'Droplets', min: 20000, max: 600000, step: 10000, value: 130000, fmt: v => (v / 1000) + 'k' },
      { key: 'erosionDepth', type: 'range', label: 'Master depth', min: 0.25, max: 3, step: 0.05, value: 1, fmt: v => '×' + v.toFixed(2), hint: 'scales every cut — the budget scales with it' },
      { key: 'capacity', type: 'range', label: 'Sediment capacity', min: 0.02, max: 0.3, step: 0.005, value: 0.09, fmt: v => v.toFixed(3) },
      { key: 'erosionRate', type: 'range', label: 'Erosion rate', min: 0.1, max: 1.2, step: 0.05, value: 0.5, fmt: v => v.toFixed(2) },
      { key: 'depositionRate', type: 'range', label: 'Deposition rate', min: 0.05, max: 0.8, step: 0.05, value: 0.25, fmt: v => v.toFixed(2) },
      { key: 'evaporation', type: 'range', label: 'Evaporation', min: 0.004, max: 0.06, step: 0.002, value: 0.02, fmt: v => v.toFixed(3) },
      { key: 'inertia', type: 'range', label: 'Inertia', min: 0.01, max: 0.4, step: 0.01, value: 0.06, fmt: v => v.toFixed(2) },
      { key: 'maxSteps', type: 'range', label: 'Max droplet lifetime', min: 16, max: 90, step: 2, value: 48, fmt: v => v + ' steps' },
      { key: 'stampRadiusVox', type: 'range', label: 'Stamp radius', min: 0.8, max: 2.5, step: 0.05, value: 1.15, fmt: v => v.toFixed(2) + ' vox' },
      { key: 'gravityScale', type: 'range', label: 'Gravity', min: 0.3, max: 1.6, step: 0.05, value: 0.9, fmt: v => v.toFixed(2) + ' g' },
    ]
  },
  {
    group: 'Mass wasting & fluvial', open: false, items: [
      { key: 'talusAngleDeg', type: 'range', label: 'Talus angle', min: 28, max: 55, step: 1, value: 42, fmt: v => v + '°', hint: 'angle of repose' },
      { key: 'talusRate', type: 'range', label: 'Talus rate', min: 0.05, max: 0.6, step: 0.05, value: 0.25, fmt: v => v.toFixed(2) },
      { key: 'incisionRounds', type: 'range', label: 'Stream-power rounds', min: 0, max: 8, step: 1, value: 4, fmt: v => v + '', hint: 'D8 drainage → E = K·A^m·S^n carved into the SDF' },
    ]
  },
  {
    group: 'Render & lighting', open: false, items: [
      { key: 'sunAz', type: 'range', label: 'Sun azimuth', min: 0, max: 6.28, step: 0.02, value: 2.35, fmt: v => (v * 180 / Math.PI).toFixed(0) + '°' },
      { key: 'sunEl', type: 'range', label: 'Sun elevation', min: 0.08, max: 1.4, step: 0.02, value: 0.62, fmt: v => (v * 180 / Math.PI).toFixed(0) + '°' },
      { key: 'snowline', type: 'range', label: 'Snow line', min: 20, max: 55, step: 0.5, value: 33, fmt: v => v.toFixed(1) + ' m' },
      { key: 'wet', type: 'range', label: 'Wetness effect', min: 0, max: 1, step: 0.05, value: 0.8, fmt: v => v.toFixed(2) },
      { key: 'exposure', type: 'range', label: 'Exposure', min: 0.5, max: 2, step: 0.05, value: 1, fmt: v => v.toFixed(2) },
      { key: 'ao', type: 'range', label: 'Ambient occlusion', min: 0, max: 2, step: 0.05, value: 1, fmt: v => v.toFixed(2) },
      {
        key: 'renderScale', type: 'seg', label: 'Ray-march quality', value: 0.75,
        options: [{ id: 0.5, label: '50%' }, { id: 0.75, label: '75%' }, { id: 1, label: '100%' }],
      },
    ]
  },
];

const RENDER_KEYS = new Set(['sunAz', 'sunEl', 'snowline', 'wet', 'exposure', 'ao', 'renderScale']);

// Named terrain presets — sparse parameter overlays on the schema defaults.
const PRESETS = [
  { label: 'Alpine Horn', values: { style: 'ridged', arrangement: 'single', baseFreq: 0.016, peakHeight: 30, peakRadius: 40, maskPower: 2.4, octaves: 9, gain: 0.46, warp: 8, tiltStrength: 4, baseHeight: 12, erosionDepth: 1, capacity: 0.09, snowline: 33, wet: 0.8, talusAngleDeg: 42, incisionRounds: 4 } },
  { label: 'Twin Summits', values: { style: 'ridged', arrangement: 'twin', baseFreq: 0.014, peakHeight: 34, peakRadius: 42, maskPower: 2.2, octaves: 9, gain: 0.46, warp: 10, tiltStrength: 3, baseHeight: 11, erosionDepth: 1, capacity: 0.09, snowline: 36, wet: 0.8, talusAngleDeg: 42, incisionRounds: 4 } },
  { label: 'Desert Mesa', values: { style: 'hybrid', arrangement: 'single', baseFreq: 0.011, peakHeight: 22, peakRadius: 42, maskPower: 3.6, octaves: 8, gain: 0.58, warp: 5, tiltStrength: 2, baseHeight: 10, erosionDepth: 1.3, capacity: 0.12, snowline: 55, wet: 0.25, talusAngleDeg: 50, incisionRounds: 3 } },
  { label: 'Volcanic Cone', values: { style: 'fbm', arrangement: 'single', baseFreq: 0.02, peakHeight: 38, peakRadius: 34, maskPower: 4.2, octaves: 9, gain: 0.5, warp: 3, tiltStrength: 1, baseHeight: 10, erosionDepth: 0.8, capacity: 0.07, snowline: 42, wet: 0.5, talusAngleDeg: 38, incisionRounds: 2 } },
  { label: 'Rolling Range', values: { style: 'fbm', arrangement: 'range', baseFreq: 0.009, peakHeight: 14, peakRadius: 46, maskPower: 2, octaves: 8, gain: 0.45, warp: 6, tiltStrength: 2, baseHeight: 10, erosionDepth: 1, capacity: 0.1, snowline: 55, wet: 0.7, talusAngleDeg: 40, incisionRounds: 5 } },
];

const SAT_INFO = [
  ['flow', 'Flow', 'D8 accumulated discharge — the drainage network. Drives channel wetness in the material.'],
  ['sediment', 'Sediment', 'Where droplets dropped their load — alluvial fans, floodplains, lake fills.'],
  ['wear', 'Wear', 'Total material removed per column — erosion intensity.'],
  ['peaks', 'Peaks', 'Local maxima of the surface, softly dilated — summits and high points.'],
  ['pointiness', 'Pointiness', 'Laplacian convexity: crests and noses positive, hollows negative (diverging).'],
  ['slope', 'Slope', 'Surface gradient magnitude, saturated at ~58°. Rock exposure driver.'],
  ['height', 'Height', 'Normalised elevation — hypsometric texturing / snow lines.'],
  ['wetness', 'Wetness', 'Smoothed flow accumulation — dampness for texturing.'],
  ['cut', 'Cut / Fill', 'Net elevation change from erosion — warm: incised, cool: deposited (diverging).'],
];

// ---------------------------------------------------------------------------
//  state
// ---------------------------------------------------------------------------
const params = {};
const $ = (s) => document.querySelector(s);
let worker = null, viewer = null, running = false, lastZip = null;
let satData = null, satN = [0, 0];

const LS_KEY = 'frontier-params-v1';
let savedParams = {};
try { savedParams = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { savedParams = {}; }
{
  const us = new URLSearchParams(location.search).get('seed');
  if (us) savedParams.seed = parseInt(us) || savedParams.seed;
}
function resolveDefault(item) {
  const s = savedParams[item.key];
  return (s !== undefined && typeof s === typeof item.value &&
          !(item.type === 'seg' && !item.options.some(o => o.id === s))) ? s : item.value;
}
function saveParams() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(params)); } catch {}
}

// ---------------------------------------------------------------------------
//  boot
// ---------------------------------------------------------------------------
initViewer();
buildControls();
initWorker();
autoRun();

function initViewer() {
  const canvas = $('#viewport');
  try {
    viewer = new FrontierViewer(canvas);
    viewer.start();
    fpsLoop();
  } catch (e) {
    const el = $('#gl-error');
    el.classList.remove('hidden');
    el.textContent = 'Renderer failed to start:\n' + (e.message || e);
  }
  $('#btn-inspect').addEventListener('click', (e) => {
    viewer.mode = viewer.mode === 1 ? 0 : 1;
    e.target.classList.toggle('active', viewer.mode === 1);
    $('#clip-hud').classList.toggle('hidden', viewer.mode !== 1);
  });
  $('#btn-trail').addEventListener('click', (e) => {
    viewer.showTrail = viewer.showTrail ? 0 : 1;
    e.target.classList.toggle('active', !!viewer.showTrail);
  });
  $('#clip-slider').addEventListener('input', (e) => {
    viewer.clipY = parseFloat(e.target.value);
    $('#clip-val').textContent = viewer.clipY.toFixed(1) + ' m';
  });
}

function fpsLoop() {
  let frames = 0, t0 = performance.now(), drawMode = 'SDF';
  function tick() {
    frames++;
    const now = performance.now();
    if (now - t0 > 700) {
      $('#hud-fps').textContent = (frames * 1000 / (now - t0)).toFixed(0);
      frames = 0; t0 = now;
      drawMode = viewer.mode === 1 ? 'inspect' : 'SDF raymarch';
      $('#hud-draw').textContent = drawMode;
    }
    requestAnimationFrame(tick);
  }
  tick();
}

// ---------------------------------------------------------------------------
//  controls
// ---------------------------------------------------------------------------
const ctlUpdaters = {};   // key -> (value) => sync control DOM + params

function buildControls() {
  const nav = $('#controls');
  for (const g of SCHEMA) {
    const grp = document.createElement('div');
    grp.className = 'group' + (g.open ? '' : ' closed');
    const head = document.createElement('div');
    head.className = 'group-head';
    head.innerHTML = `<span>${g.group}</span><span class="chev">▾</span>`;
    head.addEventListener('click', () => grp.classList.toggle('closed'));
    const body = document.createElement('div');
    body.className = 'group-body';
    grp.append(head, body);

    for (const item of g.items) {
      const ctl = document.createElement('div');
      ctl.className = 'ctl';
      if (item.type === 'range') ctl.appendChild(rangeCtl(item));
      else if (item.type === 'select') ctl.appendChild(selectCtl(item));
      else if (item.type === 'seg') ctl.appendChild(segCtl(item));
      else if (item.type === 'seed') ctl.appendChild(seedCtl(item));
      body.appendChild(ctl);
    }
    nav.appendChild(grp);
  }

  // preset bar
  const bar = $('#preset-bar');
  for (const pr of PRESETS) {
    const b = document.createElement('button');
    b.className = 'preset-btn';
    b.textContent = pr.label;
    b.addEventListener('click', () => {
      if (running) return;
      for (const [k, v] of Object.entries(pr.values))
        if (ctlUpdaters[k]) ctlUpdaters[k](v);
      saveParams();
      logLine(`preset — ${pr.label}`, 'accent');
      generate();
    });
    bar.appendChild(b);
  }

  $('#btn-generate').addEventListener('click', generate);
  $('#btn-export').addEventListener('click', exportBundle);
  $('#btn-shot').addEventListener('click', screenshot);

  document.addEventListener('keydown', (e) => {
    const t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
    if (e.key === 'r' || e.key === 'R') generate();
    else if (e.key === 'i' || e.key === 'I') $('#btn-inspect').click();
    else if (e.key === 't' || e.key === 'T') $('#btn-trail').click();
    else if (e.key === 's' || e.key === 'S') screenshot();
  });

  applyRenderParams();               // sync viewer with (possibly restored) params
  if (Object.keys(savedParams).length) logLine('parameters restored from last session', 'accent');
}

function rangeCtl(item) {
  params[item.key] = resolveDefault(item);
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'ctl-row';
  const lab = document.createElement('label');
  lab.textContent = item.label;
  const val = document.createElement('span');
  val.className = 'val';
  row.append(lab, val);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = item.min; input.max = item.max; input.step = item.step; input.value = params[item.key];
  const paint = () => {
    const v = parseFloat(input.value);
    val.textContent = item.fmt ? item.fmt(v) : v;
    const pct = (v - item.min) / (item.max - item.min) * 100;
    input.style.setProperty('--fill', pct + '%');
  };
  input.addEventListener('input', () => {
    params[item.key] = parseFloat(input.value);
    paint();
    if (RENDER_KEYS.has(item.key)) applyRenderParams();
    saveParams();
  });
  ctlUpdaters[item.key] = (v) => {
    params[item.key] = v;
    input.value = v;
    paint();
  };
  paint();
  wrap.append(row, input);
  if (item.hint) {
    const h = document.createElement('div');
    h.className = 'hint'; h.textContent = item.hint;
    wrap.appendChild(h);
  }
  return wrap;
}

function selectCtl(item) {
  params[item.key] = resolveDefault(item);
  const row = document.createElement('div');
  row.className = 'ctl-row';
  row.innerHTML = `<label>${item.label}</label>`;
  const sel = document.createElement('select');
  for (const [v, l] of item.options) {
    const o = document.createElement('option');
    o.value = v; o.textContent = l;
    if (String(v) === String(params[item.key])) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => { params[item.key] = sel.value; saveParams(); });
  ctlUpdaters[item.key] = (v) => { params[item.key] = v; sel.value = v; };
  row.appendChild(sel);
  return row;
}

function segCtl(item) {
  params[item.key] = resolveDefault(item);
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'ctl-row';
  row.innerHTML = `<label>${item.label}</label>`;
  const seg = document.createElement('div');
  seg.className = 'seg';
  for (const o of item.options) {
    const b = document.createElement('button');
    b.textContent = o.label;
    b.classList.toggle('active', o.id === params[item.key]);
    b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      params[item.key] = o.id;
      if (RENDER_KEYS.has(item.key)) applyRenderParams();
      saveParams();
    });
    seg.appendChild(b);
  }
  ctlUpdaters[item.key] = (v) => {
    params[item.key] = v;
    seg.querySelectorAll('button').forEach((x, i) => x.classList.toggle('active', item.options[i].id === v));
  };
  wrap.append(row, seg);
  if (item.hint) {
    const h = document.createElement('div');
    h.className = 'hint'; h.textContent = item.hint;
    wrap.appendChild(h);
  }
  return wrap;
}

function seedCtl(item) {
  params[item.key] = resolveDefault(item);
  const row = document.createElement('div');
  row.className = 'ctl-row';
  row.innerHTML = `<label>${item.label}</label>`;
  const line = document.createElement('div');
  line.className = 'seed-row';
  const num = document.createElement('input');
  num.type = 'number'; num.value = params[item.key];
  num.addEventListener('change', () => { params[item.key] = parseInt(num.value) || 1; saveParams(); });
  const dice = document.createElement('button');
  dice.className = 'icon-btn'; dice.textContent = '🎲'; dice.title = 'Random seed';
  dice.addEventListener('click', () => {
    const s = (Math.random() * 99999) | 0;
    num.value = s; params[item.key] = s; saveParams();
  });
  ctlUpdaters[item.key] = (v) => { params[item.key] = v; num.value = v; };
  line.append(num, dice);
  const wrap = document.createElement('div');
  wrap.appendChild(row);
  wrap.appendChild(line);
  if (item.hint) {
    const h = document.createElement('div');
    h.className = 'hint'; h.textContent = item.hint;
    wrap.appendChild(h);
  }
  return wrap;
}

function screenshot() {
  if (!viewer) return;
  viewer.requestCapture((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `frontier_view_${params.seed}_${params.quality}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    logLine('viewport captured → ' + a.download, 'ok');
  });
}

function applyRenderParams() {
  if (!viewer) return;
  viewer.sunAz = params.sunAz; viewer.sunEl = params.sunEl;
  viewer.snowline = params.snowline; viewer.wet = params.wet;
  viewer.exposure = params.exposure; viewer.ao = params.ao;
  viewer.renderScale = params.renderScale;
}

// ---------------------------------------------------------------------------
//  worker + pipeline
// ---------------------------------------------------------------------------
function initWorker() {
  worker = new Worker('src/worker.js', { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') setProgress(m.frac, m.label);
    else if (m.type === 'log') logLine(m.message);
    else if (m.type === 'contract') fillContract(m.contract);
    else if (m.type === 'done') onDone(m);
    else if (m.type === 'error') {
      setStatus('error', 'failed');
      logLine('ERROR ' + m.message, 'err');
      finishRun();
    }
  };
  worker.onerror = (e) => { logLine('worker error: ' + e.message, 'err'); finishRun(); };
}

function autoRun() {
  logLine('Frontier SDF Terrain Lab — 100 × 64 × 100 m test domain', 'accent');
  logLine('pipeline: multifractal → SDF voxels → particle hydraulics → D8 fluvial → SAT maps');
  setTimeout(generate, 250);
}

function buildPipelineParams() {
  return {
    seed: params.seed >>> 0,
    size: [100, 64, 100],
    res: params.quality,
    style: params.style,
    arrangement: params.arrangement,
    octaves: params.octaves,
    lacunarity: 2.0, gain: params.gain,
    baseFreq: params.baseFreq,
    warp: params.warp,
    peakHeight: params.peakHeight, peakRadius: params.peakRadius, maskPower: params.maskPower,
    tiltStrength: params.tiltStrength, tiltAngleDeg: params.tiltAngleDeg,
    baseHeight: params.baseHeight, bedrock: 6,
    droplets: params.droplets, maxSteps: params.maxSteps,
    inertia: params.inertia, capacity: params.capacity, minSlope: 0.02,
    erosionRate: params.erosionRate, depositionRate: params.depositionRate,
    evaporation: params.evaporation, erosionDepth: params.erosionDepth,
    stampRadiusVox: params.stampRadiusVox, gravityScale: params.gravityScale,
    talusAngleDeg: params.talusAngleDeg, talusRate: params.talusRate,
    reinitBandVox: 6, incisionRounds: params.incisionRounds
  };
}

function generate() {
  if (running) return;
  saveParams();
  running = true;
  lastZip = null;
  $('#btn-export').disabled = true;
  $('#btn-generate').disabled = true;
  $('#btn-generate').textContent = 'Simulating…';
  $('#progress-wrap').classList.remove('hidden');
  setStatus('run', 'simulating');
  const p = buildPipelineParams();
  worker.postMessage({ type: 'run', params: p, id: 1 });
}

function setProgress(frac, label) {
  const pct = Math.round(frac * 100);
  $('#progress-fill').style.width = pct + '%';
  $('#progress-pct').textContent = pct + '%';
  $('#progress-label').textContent = label || '';
}

function onDone(m) {
  setProgress(1, 'complete');
  // volume -> renderer
  if (viewer) {
    viewer.setVolume({ data: m.sdf.data, dims: m.sdf.dims, size: m.sdf.size, clamp: m.sdf.clamp });
    viewer.setSat(m.satA, m.satB, m.sdf.dims[0], m.sdf.dims[2]);
    viewer.setTrail(m.trail, m.sdf.dims[0], m.sdf.dims[2]);
  }
  $('#hud-grid').textContent = m.sdf.dims.join('×');
  $('#hud-voxel').textContent = (m.sdf.voxel[0] * 1000).toFixed(0) + ' mm';

  // clip slider range
  const cs = $('#clip-slider');
  cs.max = m.sdf.size[1];
  cs.value = Math.min(30, m.sdf.size[1] * 0.4);
  viewer.clipY = parseFloat(cs.value);
  $('#clip-val').textContent = viewer.clipY.toFixed(1) + ' m';

  fillAudit(m.audit, m.contract, m.elapsed);
  buildGallery(new Uint8Array(m.satA), new Uint8Array(m.satB), m.sdf.dims[0], m.sdf.dims[2], new Uint8Array(m.cutMap));
  lastZip = new Blob([m.zip], { type: 'application/zip' });
  $('#btn-export').disabled = false;

  setStatus('done', 'complete · ' + m.elapsed + ' s');
  logLine(`done in ${m.elapsed} s — volume uploaded to renderer`, 'ok');
  toast(`Terrain ready — voxel <span class="mono">${(m.sdf.voxel[0]*1000).toFixed(0)} mm</span>, channels <span class="mono">${(m.audit.channelMeanCut / m.sdf.voxel[0]).toFixed(1)} vox</span> deep`);
  finishRun();
}

function finishRun() {
  running = false;
  $('#btn-generate').disabled = false;
  $('#btn-generate').textContent = 'Generate terrain';
}

// ---------------------------------------------------------------------------
//  panels
// ---------------------------------------------------------------------------
function kv(container, rows) {
  const el = typeof container === 'string' ? $(container) : container;
  el.innerHTML = '';
  for (const [k, v, cls] of rows) {
    const kEl = document.createElement('span');
    kEl.className = 'k'; kEl.textContent = k;
    const vEl = document.createElement('span');
    vEl.className = 'v' + (cls ? ' ' + cls : '');
    vEl.innerHTML = v;
    el.append(kEl, vEl);
  }
}

function fillContract(c) {
  const voxMM = c.voxelMM;
  const cells = c.grid[0] * c.grid[1] * c.grid[2];
  kv('#contract-body', [
    ['Voxel (isotropic)', voxMM.toFixed(1) + ' mm', 'accent'],
    ['Grid', `${c.grid[0]}×${c.grid[1]}×${c.grid[2]}`],
    ['Cells', (cells / 1e6).toFixed(2) + ' M'],
    ['Min feature (3 vox)', (c.detailCapMM / 1000).toFixed(2) + ' m'],
    ['Cut budget', `${c.maxCutM.toFixed(2)} m (${(c.maxCutM / c.voxel).toFixed(1)} vox)`],
    ['Channel target', '≈ 1.0 voxel', ''],
  ]);
}

function fillAudit(a, c, elapsed) {
  const vox = a.voxMax;
  const chanVox = a.channelMeanCut / vox;
  kv('#audit-body', [
    ['Droplets', a.droplets.toLocaleString()],
    ['Active steps', (a.activeSteps / 1000 | 0) + 'k'],
    ['Carved', a.carveVolume.toFixed(0) + ' m³'],
    ['Deposited', a.depositVolume.toFixed(0) + ' m³'],
    ['Mean cut', a.meanCut.toFixed(3) + ' m'],
    ['Max cut', a.maxCut.toFixed(2) + ' m', a.maxCut <= c.maxCutM * 1.02 ? 'good' : 'bad'],
    ['Channel depth', `${a.channelMeanCut.toFixed(2)} m · ${chanVox.toFixed(2)} vox`,
      chanVox >= 0.4 ? 'good' : 'warn'],
    ['Relief (post)', a.relief.toFixed(1) + ' m'],
    ['Sim time', elapsed + ' s'],
  ]);
  const badge = $('#contract-badge');
  const chanOK = chanVox >= 0.4 && chanVox <= 3.0;
  const cutOK = a.maxCut <= c.maxCutM * 1.05;
  if (chanOK && cutOK) {
    badge.className = 'badge badge-good';
    badge.textContent = 'CUT ↔ RESOLUTION MATCHED';
  } else {
    badge.className = 'badge badge-warn';
    badge.textContent = chanOK ? 'CUT AT BUDGET LIMIT' : 'CHANNEL DETAIL BELOW GRID';
  }
}

function buildGallery(satA, satB, nx, nz, cutU8) {
  satData = { satA, satB, nx, nz, cut: cutU8 };
  const gal = $('#sat-gallery');
  gal.innerHTML = '';
  SAT_INFO.forEach(([key, label], i) => {
    const tile = document.createElement('div');
    tile.className = 'sat-tile';
    const cv = document.createElement('canvas');
    cv.width = nx; cv.height = nz;
    paintSat(cv, i);
    const lab = document.createElement('div');
    lab.className = 'sat-label';
    lab.textContent = label;
    tile.append(cv, lab);
    tile.addEventListener('click', () => openLightbox(i));
    gal.appendChild(tile);
  });
}

function paintSat(cv, i) {
  const { satA, satB, nx, nz, cut } = satData;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(nx, nz);
  const key = SAT_INFO[i][0];
  const bytes = key === 'cut' ? cut : channelBytesFor(i, satA, satB, nx, nz);
  for (let j = 0; j < nx * nz; j++) {
    const v = bytes[j] / 255;
    let r, g, b;
    if (key === 'cut') {                 // diverging: cool deposition, warm erosion
      const t = (bytes[j] / 255) * 2 - 1;
      if (t > 0) { r = 150 + t * 72; g = 160 - t * 55; b = 150 - t * 75; }
      else { r = 150 - t * 70; g = 160 + t * 15; b = 150 + t * 60; }
    } else if (key === 'pointiness') {   // diverging blue-white-red
      const t = v * 2 - 1;
      if (t > 0) { r = 90 + t * 165; g = 140 - t * 60; b = 200 - t * 140; }
      else { r = 90 - t * 40; g = 140 + t * 20; b = 200 + t * 55; }
    } else if (key === 'flow') {
      r = 20 + v * 60; g = 60 + v * 180; b = 90 + v * 165;
    } else if (key === 'sediment') {
      r = 40 + v * 215; g = 30 + v * 175; b = 15 + v * 95;
    } else if (key === 'wear') {
      r = 25 + v * 230; g = 15 + v * 60; b = 45 + v * 140;
    } else if (key === 'height') {
      // simple hypsometric
      if (v < 0.5) { const t = v / 0.5; r = 30 + t * 80; g = 60 + t * 100; b = 30 + t * 40; }
      else { const t = (v - 0.5) / 0.5; r = 110 + t * 145; g = 160 + t * 90; b = 70 + t * 185; }
    } else if (key === 'wetness') {
      r = 15 + v * 35; g = 45 + v * 130; b = 110 + v * 145;
    } else if (key === 'peaks') {
      r = 10 + v * 245; g = 12 + v * 235; b = 20 + v * 220;
    } else { // slope
      r = v * 255; g = v * 235; b = v * 205;
    }
    img.data[j * 4] = r; img.data[j * 4 + 1] = g; img.data[j * 4 + 2] = b; img.data[j * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function channelBytesFor(i, satA, satB, nx, nz) {
  const src = i < 4 ? satA : satB;
  const ch = i % 4;
  const out = new Uint8Array(nx * nz);
  for (let j = 0; j < out.length; j++) out[j] = src[j * 4 + ch];
  return out;
}

function openLightbox(i) {
  if (!satData) return;
  const [key, label, desc] = SAT_INFO[i];
  const cv = $('#lightbox-canvas');
  cv.width = satData.nx; cv.height = satData.nz;
  paintSat(cv, i);
  $('#lightbox-title').textContent = `${label} — ${key}`;
  $('#lightbox-desc').textContent = desc + `  (${satData.nx}×${satData.nz} @ ${(100 / satData.nx * 1000).toFixed(0)} mm/px)`;
  $('#lightbox').classList.remove('hidden');
}
$('#lightbox-close').addEventListener('click', () => $('#lightbox').classList.add('hidden'));
$('#lightbox').addEventListener('click', (e) => {
  if (e.target === $('#lightbox')) $('#lightbox').classList.add('hidden');
});

function exportBundle() {
  if (!lastZip) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(lastZip);
  a.download = `frontier_terrain_${params.seed}_${params.quality}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  logLine('export bundle downloaded (heightmap 16-bit, 8 SAT maps, u16 SDF volume, AUDIT.md)', 'ok');
}

// ---------------------------------------------------------------------------
//  misc UI
// ---------------------------------------------------------------------------
function setStatus(kind, text) {
  const pill = $('#status-pill');
  pill.className = 'pill pill-' + (kind === 'run' ? 'run' : kind === 'done' ? 'done' : kind === 'error' ? 'err' : 'idle');
  $('#status-text').textContent = text;
}

function logLine(msg, cls) {
  const con = $('#console');
  const t = new Date().toTimeString().slice(0, 8);
  const div = document.createElement('div');
  div.innerHTML = `<span class="t">${t}</span><span class="${cls || ''}">${msg}</span>`;
  con.appendChild(div);
  con.scrollTop = con.scrollHeight;
}

let toastTimer = null;
function toast(html) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.innerHTML = html;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}
