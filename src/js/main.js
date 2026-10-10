// ─────────────────────────────────────────────────────────────────────────────
//  Frontier Terrain — application entry.
// ─────────────────────────────────────────────────────────────────────────────

import { createProject, applyPreset, PRESETS, makeTerrainLayer, makeTextureLayer,
         snapshot, restore, nextId } from './core/state.js';
import { TERRAIN_TYPES } from './schema/layers.js';
import { TerrainEngine } from './core/terrain.js';
import { Renderer } from './core/renderer.js';
import { Camera } from './core/camera.js';
import { LayerStack } from './ui/layerstack.js';
import { Inspector } from './ui/inspector.js';
import { seg, toast, modal, el, slider } from './ui/widgets.js';

const $ = (id) => document.getElementById(id);

const makeSlider = (obj, key, opts, onChange) => slider({
  value: obj[key], ...opts,
  onChange: (v) => { obj[key] = v; onChange?.(); },
});

const DEBUG_VIEWS = [
  ['Albedo', '1'], ['Normals', '2'], ['Rough', '3'], ['Height', '4'],
  ['AO', '5'], ['Flow', '6'], ['Deposit', '7'], ['Curv', '8'],
  ['Shadow', '9'], ['Slope', '10'],
];

class App {
  constructor() {
    this.project = createProject('alpine');
    this.camera = new Camera();
    this.building = false;
    this.buildQueued = false;
    this.buildStart = 0;
    this.frames = 0;
    this.fpsTime = performance.now();
    this.viewMode = 'shaded';
    this.lastBuildMs = 0;
  }

  async boot() {
    const loading = $('loading');
    const text = $('loading-text');

    if (!navigator.gpu) {
      text.innerHTML = '<b style="color:#e8b055">WebGPU is not available</b><br>' +
        '<span style="color:#8b9096">Open this in Chrome 113+, Edge 113+ or Safari 18+.</span>';
      $('gl-loading').querySelector('.spin').style.display = 'none';
      return;
    }
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('No GPU adapter');
      const device = await adapter.requestDevice({
        requiredLimits: {
          maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
          maxBufferSize: adapter.limits.maxBufferSize,
          maxTextureDimension2D: Math.min(adapter.limits.maxTextureDimension2D, 8192),
        },
      });
      device.addEventListener?.('uncapturederror', (e) => console.error('[webgpu]', e.error));
      this.device = device;
      text.textContent = 'Compiling shaders…';
      this.terrain = new TerrainEngine(device);
      await this.terrain.init();
      text.textContent = 'Building renderer…';
      this.renderer = new Renderer(device, $('gpu'), this.terrain);
      await this.renderer.init();
      this.renderer.configureContext();
    } catch (err) {
      console.error(err);
      text.innerHTML = `<b style="color:#e8b055">Renderer failed to start</b><br>
        <span style="color:#8b9096">${String(err.message || err)}</span>`;
      $('gl-loading').querySelector('.spin').style.display = 'none';
      return;
    }

    loading.classList.add('hidden');
    window.__frontier = { nextId, app: this, project: this.project };

    this.buildUI();
    this.camera.frame(this.project.globals.worldSize, this.project.globals.heightScale);
    this.camera.attach($('view'), () => { this.renderer.taaReset = 1; });
    this.resize();
    window.addEventListener('resize', () => this.resize());

    await this.build();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  buildUI() {
    const p = this.project;
    const g = p.globals;

    this.stack = new LayerStack({
      state: { get terrainLayers() { return p.terrain; }, get textureLayers() { return p.textures; } },
      onSelect: (layer) => this.inspector.show(layer, this.stack.kind),
      onChange: (layer, opts = {}) => {
        this.stack.render();
        if (opts.rebuild) this.scheduleBuild();
        else this.invalid();
      },
      onAdd: (type) => this.addTerrainLayer(type),
      onAddMaterial: (key) => {
        if (!this.terrain.res) { toast('Build the terrain first — textures are masked by it'); return; }
        this.addTextureLayer(key);
      },
    });

    this.inspector = new Inspector({
      state: { get globals() { return g; } },
      onChange: (o = {}) => {
        if (o.rebuild) this.scheduleBuild();
        else this.invalid();
      },
      onRebuild: (o = {}) => {
        if (o.live && !g.autoBuild) { this.invalid(); return; }
        this.scheduleBuild(o);
      },
      onInvalidate: () => this.invalid(),
    });

    this.stack.render();
    this.inspector.show(null, 'terrain');

    // ── top bar
    const presetSel = $('preset-select');
    for (const [key, preset] of Object.entries(PRESETS)) {
      const o = el('option', null, preset.name);
      o.value = key;
      presetSel.append(o);
    }
    presetSel.value = p.preset;
    presetSel.addEventListener('change', () => {
      if (!presetSel.value) return;
      applyPreset(p, presetSel.value);
      this.stack.selection = null;
      this.stack.render();
      this.inspector.show(null, this.stack.kind);
      this.refreshToggles();
      this.scheduleBuild({ camera: true });
      toast(`Preset · ${PRESETS[p.preset].name}`);
    });

    $('res-select').value = String(g.res);
    $('res-select').addEventListener('change', (e) => {
      g.res = Number(e.target.value);
      this.scheduleBuild();
    });
    $('rres-select').value = String(g.renderRes);
    $('rres-select').addEventListener('change', (e) => {
      g.renderRes = Number(e.target.value);
      this.scheduleBuild();
    });

    const ab = $('autobuild-btn');
    const paintAuto = () => {
      ab.classList.toggle('on', !!g.autoBuild);
      ab.querySelector('.dot').style.background = '';
    };
    paintAuto();
    ab.addEventListener('click', () => { g.autoBuild = !g.autoBuild; paintAuto(); });

    $('build-btn').addEventListener('click', () => this.scheduleBuild({ now: true }));

    $('tb-project').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'new') this.confirmNew();
      if (b.dataset.act === 'save') this.saveFile();
      if (b.dataset.act === 'open') this.openFile();
    });
    document.querySelector('[data-act="export"]').addEventListener('click', () => this.showExport());

    this.buildStrip();
    this.buildSunDial();
    this.buildSplitter();
    this.bindKeys();
    this.refreshToggles();
    this.updateStatusBar();
  }

  buildStrip() {
    const g = this.project.globals;

    // quality (internal resolution scale)
    $('quality-seg').append(seg([['½', '0.5'], ['1×', '1'], ['2×', '2']], String(g.resolutionScale), (v) => {
      g.resolutionScale = Number(v);
      this.resize();
    }, ''));

    // exposure, always within reach
    const ex = document.getElementById('exposure-ctl');
    const exSlider = makeSlider(g, 'exposure', { min: -1, max: 3, step: 0.01 }, () => this.invalid());
    ex.append(exSlider);

    // camera mode
    $('cam-seg').append(seg([['Orbit', 'orbit'], ['Fly', 'fly']], 'orbit', (v) => {
      this.camera.fly = v === 'fly';
      if (this.camera.fly) this.camera.distance = 1;
      this.invalid();
    }, ''));

    // debug channel
    const dbg = $('debug-seg');
    dbg.append(seg(DEBUG_VIEWS, String(g.debugMode), (v) => {
      g.debugMode = Number(v);
      this.invalid();
    }, ''));

    const syncDebug = () => {
      dbg.hidden = this.viewMode !== 'data';
      if (dbg.hidden) g.debugMode = 0;
      else if (g.debugMode < 1) g.debugMode = 1;
      dbg.querySelector('.seg').setValue(String(g.debugMode));
    };
    this.syncDebug = syncDebug;

    $('run-mode').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      this.viewMode = b.dataset.m;
      $('run-mode').querySelectorAll('.btn').forEach((x) => x.classList.toggle('sel', x === b));
      syncDebug();
      this.invalid();
    });

    const bind = (id, get, set) => {
      const b = $(id);
      b.addEventListener('click', () => { set(!get()); b.classList.toggle('on', get()); this.invalid(); });
      this._toggles.push([id, get]);
    };
    this._toggles = [];
    bind('water-btn', () => g.waterOn, (v) => { g.waterOn = v; });
    bind('taa-btn', () => g.taa, (v) => { g.taa = v; });
    bind('shadow-btn', () => g.shadowSoftness > 0.0001, (v) => { g.shadowSoftness = v ? 0.02 : 0; });

    $('frame-btn').addEventListener('click', () => {
      this.camera.frame(g.worldSize, g.heightScale);
      this.invalid();
    });
  }

  refreshToggles() {
    if (!this._toggles) return;
    for (const [id, get] of this._toggles) $(id).classList.toggle('on', get());
  }

  buildSunDial() {
    const dial = $('sundial');
    const g = this.project.globals;
    const paint = () => {
      const a = g.sunAzimuth * Math.PI / 180;
      const e = g.sunElevation * Math.PI / 180;
      const r = 34;
      const x = 60 + Math.cos(a) * Math.cos(e) * r;
      const y = 60 - Math.sin(e) * r;
      $('sun-knob').setAttribute('cx', x);
      $('sun-knob').setAttribute('cy', y);
      const k = 60 / Math.max(r, 1);
      $('sun-ray').setAttribute('x2', 60 + (x - 60) * k * 0.62);
      $('sun-ray').setAttribute('y2', 60 + (y - 60) * k * 0.62);
      $('sun-readout').textContent = `${Math.round(g.sunAzimuth)}° / ${Math.round(g.sunElevation)}°`;
    };
    paint();
    this.paintSun = paint;
    let down = false;
    const set = (ev) => {
      const r = dial.getBoundingClientRect();
      const dx = ev.clientX - (r.left + r.width / 2);
      const dy = ev.clientY - (r.top + r.height / 2);
      const rr = Math.min(r.width, r.height) / 2 - 8;
      const d = Math.hypot(dx, dy);
      const sinE = Math.max(-0.03, Math.min(1, 1 - (d / rr)));
      g.sunElevation = Math.round(Math.asin(sinE) * 180 / Math.PI * 2) / 2;
      g.sunAzimuth = Math.round(((Math.atan2(dy, dx) * 180 / Math.PI) + 450) % 360);
      paint();
      this.invalid();
    };
    dial.addEventListener('pointerdown', (e) => {
      down = true;
      dial.setPointerCapture?.(e.pointerId);
      set(e);
    });
    dial.addEventListener('pointermove', (e) => { if (down) set(e); });
    dial.addEventListener('pointerup', (e) => { down = false; dial.releasePointerCapture?.(e.pointerId); });
  }

  buildSplitter() {
    const sp = $('splitter');
    const dock = $('dock');
    let down = false;
    sp.addEventListener('pointerdown', (e) => {
      down = true;
      sp.setPointerCapture?.(e.pointerId);
      sp.classList.add('drag');
    });
    sp.addEventListener('pointermove', (e) => {
      if (!down) return;
      const r = dock.getBoundingClientRect();
      const frac = (e.clientY - r.top) / Math.max(r.height, 1);
      const f = Math.max(0.2, Math.min(0.85, frac));
      $('stack-panel').style.flex = `1 1 ${(f * 100).toFixed(1)}%`;
      $('inspector').style.flex = `1 1 ${((1 - f) * 100).toFixed(1)}%`;
    });
    sp.addEventListener('pointerup', (e) => {
      down = false;
      sp.releasePointerCapture?.(e.pointerId);
      sp.classList.remove('drag');
    });
  }

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'SELECT') return;
      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); }
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'b':
          if (!e.shiftKey) { this.scheduleBuild({ now: true }); }
          break;
        case 'f':
          this.camera.frame(this.project.globals.worldSize, this.project.globals.heightScale);
          this.invalid();
          break;
        case 'g':
          this.camera.keys.delete('g');
          break;
        default: break;
      }
    });
  }

  // ── layers ────────────────────────────────────────────────────────────────
  pushUndo() {
    this.undoStack = this.undoStack || [];
    this.undoStack.push(snapshot(this.project));
    if (this.undoStack.length > 40) this.undoStack.shift();
  }

  undo() {
    if (!this.undoStack?.length) { toast('Nothing to undo'); return; }
    restore(this.project, this.undoStack.pop());
    this.stack.selection = null;
    this.stack.render();
    this.inspector.show(null, this.stack.kind);
    this.refreshToggles();
    this.scheduleBuild({ now: true });
  }

  addTerrainLayer(type) {
    this.pushUndo();
    const def = TERRAIN_TYPES[type];
    const layer = makeTerrainLayer(type, {}, { name: def.name });
    if (def.kind === 'gen' && this.project.terrain.length) layer.blend = 1;
    this.project.terrain.push(layer);
    this.stack.setSelection(layer.id, { scroll: true });
    this.inspector.show(layer, 'terrain');
    this.scheduleBuild({ now: true });
  }

  addTextureLayer(matKey) {
    this.pushUndo();
    const layer = makeTextureLayer(matKey, {}, {});
    this.project.textures.push(layer);
    this.stack.setSelection(layer.id, { scroll: true });
    this.inspector.show(layer, 'texture');
    this.invalid();
    toast(`Added ${layer.name}`);
  }

  // ── build ─────────────────────────────────────────────────────────────────
  invalid() {
    this.dirty = true;
  }

  scheduleBuild(opts = {}) {
    const g = this.project.globals;
    if (opts.camera) this.camera.frame(g.worldSize, g.heightScale);
    if (!opts.now && !g.autoBuild) {
      this.pendingBuild = opts;
      this.setStatus('Pending', 'static');
      return;
    }
    clearTimeout(this.buildTimer);
    this.buildTimer = setTimeout(() => this.build(opts), opts.now ? 0 : 140);
  }

  setStatus(text, cls, frac) {
    $('status-text').textContent = text;
    const dot = $('build-status').querySelector('.live');
    dot.className = 'live ' + (cls || 'done');
    const conv = $('conv');
    if (frac == null) {
      conv.classList.add('idle');
    } else {
      conv.classList.remove('idle');
      conv.classList.toggle('done', frac >= 1);
      conv.querySelector('i').style.width = (frac * 100).toFixed(1) + '%';
    }
  }

  async build(opts = {}) {
    if (this.building) { this.buildQueued = opts; return; }
    this.building = true;
    this.setStatus('Building', 'run', 0);
    this.buildStart = performance.now();
    try {
      await this.terrain.build(this.project, (frac, label) => {
        this.setStatus(label || 'Building', 'run', frac);
      });
      this.lastBuildMs = performance.now() - this.buildStart;
      const n = this.project.terrain.length;
      this.setStatus(`Built · ${this.project.globals.res}² · ${n} layers`, 'done', 1);
      setTimeout(() => { if (!this.building) $('conv').classList.add('idle'); }, 700);
      this.renderer.taaReset = 2;
      this.renderer.paintSky();
      this.dirty = true;
      this.updateStatusBar();
    } catch (err) {
      console.error(err);
      this.setStatus('Build failed', 'static', null);
      toast('Build failed: ' + (err.message || err));
    }
    this.building = false;
    if (this.buildQueued) {
      const q = this.buildQueued;
      this.buildQueued = null;
      this.build(q);
    }
  }

  // ── frame ─────────────────────────────────────────────────────────────────
  resize() {
    const view = $('view');
    const canvas = $('gpu');
    const scale = this.project.globals.resolutionScale || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(64, Math.round(view.clientWidth * dpr * scale));
    const h = Math.max(64, Math.round(view.clientHeight * dpr * scale));
    const max = this.device.limits.maxTextureDimension2D;
    canvas.width = Math.min(w, max);
    canvas.height = Math.min(h, max);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    this.renderer.resize(canvas.width, canvas.height);
    this.dirty = true;
  }

  loop(t) {
    requestAnimationFrame((nt) => this.loop(nt));
    const dt = Math.min(0.1, (t - (this.lastT || t)) / 1000);
    this.lastT = t;

    this.camera.update(this.camera.fly ? dt : 0);
    if (this.camera.fly || this.camera.dirty) {
      this.renderer.taaReset = Math.max(this.renderer.taaReset, 1);
      this.camera.dirty = false;
      this.dirty = true;
    }

    if (this.renderer && !this.building) {
      this.renderer.render(this.project, this.camera, t / 1000, dt);
    }

    this.frames++;
    if (t - this.fpsTime > 500) {
      const fps = (this.frames * 1000) / (t - this.fpsTime);
      this.frames = 0;
      this.fpsTime = t;
      $('fps-status').querySelector('b').textContent = fps.toFixed(0);
      $('sb-right').textContent =
        `${this.project.globals.res}² field · ${this.lastBuildMs ? (this.lastBuildMs / 1000).toFixed(2) + 's' : '—'} build · ` +
        `${this.project.terrain.length} terrain · ${this.project.textures.length} texture`;
    }
  }

  updateStatusBar() {
    const g = this.project.globals;
    $('sb-left').textContent =
      `${g.worldSize} × ${g.worldSize} m · ${g.heightScale} m relief · seed ${g.seed}`;
  }

  // ── file ───────────────────────────────────────────────────────────────────
  confirmNew() {
    modal({
      title: 'New project',
      body: el('div', 'hint', 'Discard the current terrain and texture stacks and start from the Alpine preset?'),
      actions: [
        { label: 'Cancel' },
        { label: 'New project', cls: 'primary', onClick: () => {
          applyPreset(this.project, 'alpine');
          this.stack.selection = null;
          this.stack.render();
          this.inspector.show(null, this.stack.kind);
          this.refreshToggles();
          $('preset-select').value = 'alpine';
          this.scheduleBuild({ now: true, camera: true });
        } },
      ],
    });
  }

  saveFile() {
    const data = JSON.stringify(snapshot(this.project), null, 1);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `frontier-${this.project.preset}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Project saved');
  }

  openFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const json = JSON.parse(await f.text());
        restore(this.project, json);
        this.stack.selection = null;
        this.stack.render();
        this.inspector.show(null, this.stack.kind);
        this.refreshToggles();
        if (PRESETS[this.project.preset]) $('preset-select').value = this.project.preset;
        this.scheduleBuild({ now: true, camera: true });
        toast('Project loaded');
      } catch (err) {
        toast('Could not read that file');
      }
    });
    input.click();
  }

  showExport() {
    const g = this.project.globals;
    const info = el('div');
    info.innerHTML =
      `<div class="hint">Export writes 16-bit PNGs straight off the GPU so nothing is lost.</div>`;
    const opts = [
      ['height', 'Height (16-bit PNG)', true],
      ['normal', 'Normal map', true],
      ['ao', 'Ambient occlusion', false],
      ['flow', 'Flow / wetness', false],
      ['splat', 'Material splat (RGBA)', false],
    ];
    const state = {};
    for (const [k, label, def] of opts) {
      state[k] = def;
      const r = el('div', 'row');
      const t = document.createElement('button');
      t.className = 'toggle-pill' + (def ? ' on' : '');
      t.innerHTML = '<span></span>';
      t.addEventListener('click', () => { state[k] = !state[k]; t.classList.toggle('on', state[k]); });
      r.append(el('label', null, label), t);
      info.append(r);
    }
    const res = el('div', 'row');
    const sel = document.createElement('select');
    sel.className = 'sel';
    for (const v of ['1024', '2048', '4096']) {
      const o = el('option', null, v + '²');
      o.value = v;
      sel.append(o);
    }
    sel.value = '2048';
    res.append(el('label', null, 'Resolution'), sel);
    info.append(res);

    modal({
      title: 'Export maps',
      body: info,
      actions: [
        { label: 'Cancel' },
        { label: 'Export PNG', cls: 'primary', onClick: () => this.doExport(state, Number(sel.value)) },
      ],
    });
  }

  async doExport(state, res) {
    const names = Object.entries(state).filter(([, v]) => v).map(([k]) => k);
    if (!names.length) { toast('Nothing selected'); return; }
    toast(`Preparing ${names.join(', ')} at ${res}²…`);
    // The export pass renders the selected channels off-screen and reads them back.
    try {
      await this.renderer.exportMaps(this.project, names, res,
        (name, blob) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `terrain_${name}_${res}.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        });
      toast('Export complete');
    } catch (err) {
      console.error(err);
      toast('Export failed: ' + (err.message || err));
    }
  }
}

const app = new App();
window.app = app;
app.boot();
