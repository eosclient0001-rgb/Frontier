import { VolumetricFX, createVolumetricFX, PRESETS, PRESET_ORDER, QUALITY_ORDER } from '../src/index.js';

const $ = (id) => document.getElementById(id);
const canvas = $('gl');

let fx = null;

// ------------------------------------------------------------------ fatal UI
function fatal(message) {
  $('fatal').hidden = false;
  $('fatal-msg').textContent = message;
  console.error('[frontier]', message);
}

// ----------------------------------------------------------------- controls
const SLIDERS = [
  // Simulation
  { group: 'Simulation', key: 'resolution', label: 'grid', min: 32, max: 192, step: 8, target: 'solver', fmt: (v) => `${v}³`, onChange: (v) => { fx.solver.settings.resolution = v; fx.solver.resize(v); fx.solver.requestClear(); } },
  { group: 'Simulation', key: 'pressureIterations', label: 'pressure iters', min: 4, max: 60, step: 1, target: 'solver' },
  { group: 'Simulation', key: 'substeps', label: 'substeps', min: 1, max: 3, step: 1, target: 'solver' },
  { group: 'Simulation', key: 'buoyancy', label: 'buoyancy', min: 0, max: 24, step: 0.1, target: 'solver' },
  { group: 'Simulation', key: 'turbulence', label: 'turbulence', min: 0, max: 8, step: 0.05, target: 'solver' },
  { group: 'Simulation', key: 'vorticity', label: 'vorticity', min: 0, max: 12, step: 0.1, target: 'solver' },
  { group: 'Simulation', key: 'windSpeed', label: 'wind', min: 0, max: 3, step: 0.02, target: 'solver', get: () => Math.hypot(...fx.solver.settings.wind), onChange: (v) => {
      const w = fx.solver.settings.wind;
      const len = Math.hypot(...w) || 1;
      const dir = [w[0] / len, 0, w[2] / len];
      fx.solver.settings.wind = [dir[0] * v, w[1], dir[2] * v];
    } },
  { group: 'Simulation', key: 'dissipation', label: 'dissipation', min: 0, max: 0.4, step: 0.002, target: 'solver' },
  { group: 'Simulation', key: 'burnRate', label: 'burn rate', min: 0.2, max: 9, step: 0.1, target: 'solver', prop: 'fuelBurnRate' },

  // Rendering
  { group: 'Rendering', key: 'steps', label: 'march steps', min: 24, max: 220, step: 2, target: 'render' },
  { group: 'Rendering', key: 'extinction', label: 'smoke density', min: 0.2, max: 6, step: 0.05, target: 'render' },
  { group: 'Rendering', key: 'emission', label: 'fire brightness', min: 2, max: 120, step: 1, target: 'render' },
  { group: 'Rendering', key: 'flameScale', label: 'flame temp', min: 0.2, max: 2.4, step: 0.02, target: 'render' },
  { group: 'Rendering', key: 'smokeAlbedo', label: 'smoke albedo', min: 0, max: 2, step: 0.02, target: 'render' },
  { group: 'Rendering', key: 'shadowTaps', label: 'light shadows', min: 0, max: 5, step: 1, target: 'render' },
  { group: 'Rendering', key: 'exposure', label: 'exposure', min: -3, max: 3, step: 0.05, target: 'render' },
  { group: 'Rendering', key: 'scattering', label: 'anisotropy', min: -0.6, max: 0.85, step: 0.02, target: 'render' },
  { group: 'Rendering', key: 'sunElevation', label: 'sun height', min: -0.2, max: 1.4, step: 0.01, target: 'render', get: () => Math.asin(fx.renderer.settings.sunDirection[1] / Math.hypot(...fx.renderer.settings.sunDirection)), onChange: (v) => {
      const s = fx.renderer.settings.sunDirection;
      const az = Math.atan2(s[2], s[0]);
      fx.renderer.settings.sunDirection = [Math.cos(v) * Math.cos(az), Math.sin(v), Math.cos(v) * Math.sin(az)];
    } },
];

function buildSliders() {
  const host = $('sliders');
  let currentGroup = null;
  const outputs = [];
  for (const s of SLIDERS) {
    if (s.group !== currentGroup) {
      currentGroup = s.group;
      const h = document.createElement('h2');
      h.textContent = currentGroup;
      h.style.marginTop = '14px';
      host.appendChild(h);
    }
    const label = document.createElement('label');
    label.className = 'slider';
    const name = document.createElement('span');
    name.textContent = s.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = s.min;
    input.max = s.max;
    input.step = s.step;
    const value = document.createElement('em');
    label.append(name, input, value);
    host.appendChild(label);
    s.el = input;
    s.valueEl = value;
    outputs.push(s);
  }
  return outputs;
}

function refreshSliders(list) {
  for (const s of list) {
    const obj = s.target === 'solver' ? fx.solver.settings : fx.renderer.settings;
    const v = s.get ? s.get() : obj[s.prop ?? s.key];
    if (v === undefined || Number.isNaN(v)) continue;
    s.el.value = v;
    s.valueEl.textContent = (s.fmt ?? ((x) => (Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(2))))(Number(v));
  }
}

function wireSliders(list) {
  for (const s of list) {
    s.el.addEventListener('input', () => {
      const v = Number(s.el.value);
      s.valueEl.textContent = (s.fmt ?? ((x) => (Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(2))))(v);
      if (s.onChange) s.onChange(v);
      else {
        const obj = s.target === 'solver' ? fx.solver.settings : fx.renderer.settings;
        obj[s.prop ?? s.key] = v;
      }
      if (s.prop === 'resolution' || s.key === 'resolution') fx.solver.requestClear();
    });
  }
}

// -------------------------------------------------------------------- chips
function buildChips(host, entries, activeKey, onPick) {
  host.innerHTML = '';
  for (const [key, label] of entries) {
    const b = document.createElement('button');
    b.textContent = label;
    if (key === activeKey) b.classList.add('active');
    b.addEventListener('click', () => {
      [...host.children].forEach((c) => c.classList.remove('active'));
      b.classList.add('active');
      onPick(key);
    });
    host.appendChild(b);
  }
}

const DEBUG_MODES = [
  [0, 'Beauty'],
  [1, 'Density'],
  [2, 'Heat'],
  [3, 'Fuel'],
  [4, 'Velocity'],
  [5, 'SDF'],
];

// --------------------------------------------------------------------- boot
async function boot() {
  const sliders = buildSliders();

  fx = await createVolumetricFX({
    canvas,
    preset: 'campfire',
    quality: 'medium',
  });

  window.fx = fx; // handy for tinkering from the console

  // Surface GPU problems instead of rendering a black screen.
  const gpuErrors = [];
  fx.onDeviceError((message) => {
    if (gpuErrors.length < 4 && !gpuErrors.includes(message)) gpuErrors.push(message);
    console.error('[frontier] GPU error:', message);
    fatal(gpuErrors.join('\n'));
  });
  const shaderProblems = await fx.validateShaders();
  if (shaderProblems.length) {
    fatal(`Shader compilation failed:\n${shaderProblems.join('\n')}`);
    return;
  }

  // presets
  buildChips(
    $('presets'),
    PRESET_ORDER.map((k) => [k, PRESETS[k].label]),
    'campfire',
    (key) => {
      fx.setPreset(key);
      $('blurb').textContent = PRESETS[key].blurb ?? '';
      refreshSliders(sliders);
      resize();
      if (key === 'explosion' || key === 'inferno') setTimeout(() => fx.detonate({ power: key === 'inferno' ? 1.4 : 1 }), 120);
    }
  );
  $('blurb').textContent = PRESETS.campfire.blurb;

  // quality
  buildChips($('quality'), QUALITY_ORDER.map((k) => [k, k]), 'medium', (key) => {
    fx.setQuality(key);
    refreshSliders(sliders);
    resize();
  });

  // debug
  buildChips($('debug'), DEBUG_MODES, 0, (key) => {
    fx.renderer.settings.debugMode = Number(key);
    $('slice').parentElement.classList.toggle('hidden-slider', key === 0);
  });
  $('slice').parentElement.classList.add('hidden-slider');
  $('slice').addEventListener('input', (e) => {
    fx.renderer.settings.debugSlice = Number(e.target.value);
    $('slice-v').textContent = Number(e.target.value).toFixed(2);
  });

  // actions
  $('detonate').addEventListener('click', () => fx.detonate({ power: 1 }));
  $('pause').addEventListener('click', (e) => {
    fx.paused = !fx.paused;
    e.target.textContent = fx.paused ? 'Resume' : 'Pause';
  });
  $('reset').addEventListener('click', () => {
    fx.setPreset(fx.presetName, { keepCamera: true });
  });
  $('autoQuality').addEventListener('change', (e) => {
    fx.autoQuality = e.target.checked;
  });

  let autoDetonate = false;
  let autoTimer = 0;
  $('autoDetonate').addEventListener('change', (e) => {
    autoDetonate = e.target.checked;
    autoTimer = 0;
  });

  // panel toggle
  const panel = $('panel');
  $('panel-toggle').addEventListener('click', () => {
    panel.classList.toggle('hidden');
    const hidden = panel.classList.contains('hidden');
    $('panel-toggle').classList.toggle('collapsed', hidden);
    $('panel-toggle').textContent = hidden ? '⟩' : '⟨';
  });

  // controls + click to detonate
  fx.attachControls();
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      $('detonate').click();
    }
    if (e.key === 'p') $('pause').click();
    if (e.key === 'r') $('reset').click();
  });

  wireSliders(sliders);
  refreshSliders(sliders);
  resize();

  $('adapter').textContent = `${fx.gpu.info.vendor || 'adapter'} · ${fx.gpu.info.architecture || ''}`.trim();

  // stats + render loop
  let last = performance.now();
  const statFps = $('fps');
  const statGrid = $('grid');
  const statVoxels = $('voxels');
  const statSim = $('simms');
  const statScale = $('scale');
  let statTimer = 0;
  let probeTimer = 0;
  let probeEmptyFrames = 0;
  const statField = $('field');

  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!fx) return;

    if (autoDetonate) {
      autoTimer += dt;
      if (autoTimer > 4) {
        autoTimer = 0;
        fx.detonate({ power: 0.8 + Math.random() * 0.7 });
      }
    }

    fx.lastFrameTime = dt * 1000;
    const stats = fx.frame(dt);

    // Every ~1.5s read a small slab of the simulated fields back to the CPU.
    // It doubles as a health check: if heat and density stay at zero while
    // emitters are alive, something is wrong and we say so instead of showing a
    // silently empty volume.
    probeTimer += dt;
    if (probeTimer > 1.5 && !fx.paused) {
      probeTimer = 0;
      fx.solver.probeVolume().then((p) => {
        if (!p || p.error) return;
        statField.textContent = `d ${p.density.toFixed(2)} · h ${p.heat.toFixed(2)}`;
        const alive = p.heat > 0.002 || p.density > 0.002 || p.speed > 0.01;
        probeEmptyFrames = alive ? 0 : probeEmptyFrames + 1;
        if (probeEmptyFrames === 6) {
          const hint = $('hint');
          hint.innerHTML = 'volume reads empty — open the console; try <b>Reset</b> or a lower grid';
          hint.style.color = '#ff8a3d';
        }
      });
    }

    statTimer += dt;
    if (statTimer > 0.25) {
      statTimer = 0;
      statFps.textContent = stats.fps.toFixed(0);
      statGrid.textContent = `${stats.grid}³`;
      statVoxels.textContent = (stats.cells / 1e6).toFixed(2) + 'M';
      statSim.textContent = `${(stats.encodeMs ?? 0).toFixed(1)} ms`;
      statScale.textContent = `${Math.round((stats.renderScale ?? 1) * 100)}%`;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function resize() {
  fx?.resize();
}

boot().catch((err) => {
  fatal(err?.message ?? String(err));
});

// device loss / unexpected runtime errors should be visible, not silent
window.addEventListener('unhandledrejection', (e) => {
  console.error('[frontier] unhandled rejection', e.reason);
  if (String(e.reason).includes('Device') || String(e.reason).includes('device')) {
    fatal('The GPU device was lost. Reload the page (or lower the grid resolution).');
  }
});
