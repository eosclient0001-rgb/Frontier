/**
 * Editor UI — topbar, node cards (left), view/brush/stats (right), statusbar.
 * Vanilla DOM: zero framework overhead, full styling control.
 */
import { AppState, SCENARIOS } from '../graph/nodes';
import { MaskView, MASK_VIEW_INDEX } from '../render/materials';
import { PaintMode, PAINT_COLORS } from './paint';

export interface StatsSnapshot {
  fps: number;
  verts: number;
  tris: number;
  rainAlive: number;
  windAlive: number;
  carved: number;
  deposited: number;
  inFlight: number;
  bakeMs: number;
  sdfVersion: number;
  simMs: number;
}

export interface UICallbacks {
  generate: () => void;
  togglePlay: () => void;
  stepBurst: () => void;
  settleNow: () => void;
  resetSim: () => void;
  remeshNow: () => void;
  scenario: (i: number) => void;
  exportOBJ: () => void;
  exportPNG: () => void;
  resChange: (res: number) => void;
  terrainEdited: () => void;
  shadeEdited: () => void;
  viewEdited: () => void;
  maskView: (m: MaskView) => void;
  brushEdited: () => void;
}

export interface UIRefs {
  setProgress: (t: number, label: string) => void;
  setPlaying: (playing: boolean) => void;
  setBusy: (busy: boolean) => void;
  updateStats: (s: StatsSnapshot) => void;
  setStatus: (msg: string) => void;
  syncAll: () => void;
}

// ---------------------------------------------------------------- helpers
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls = '', html = ''
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

interface SliderDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt?: (v: number) => string;
}

function fmtAuto(digits = 2): (v: number) => string {
  return (v) => {
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    if (Math.abs(v) >= 100) return v.toFixed(1);
    return v.toFixed(digits);
  };
}

function sliderRow(
  parent: HTMLElement, obj: Record<string, number | string | boolean>, def: SliderDef,
  onInput?: () => void, onChange?: () => void
): void {
  const row = el('div', 'row slider-row');
  const lab = el('label', '', def.label);
  const val = el('span', 'val', '');
  const input = el('input', '') as HTMLInputElement;
  input.type = 'range';
  input.min = String(def.min);
  input.max = String(def.max);
  input.step = String(def.step);
  input.value = String(obj[def.key] as number);
  const fmt = def.fmt ?? fmtAuto(2);
  const refresh = () => { val.textContent = fmt(obj[def.key] as number); };
  refresh();
  input.addEventListener('input', () => {
    obj[def.key] = parseFloat(input.value);
    refresh();
    onInput?.();
  });
  input.addEventListener('change', () => onChange?.());
  row.append(lab, input, val);
  parent.append(row);
  // Re-sync when presets change values programmatically.
  (parent as unknown as { __syncers: (() => void)[] }).__syncers ??= [];
  (parent as unknown as { __syncers: (() => void)[] }).__syncers.push(() => {
    input.value = String(obj[def.key] as number);
    refresh();
  });
}

function toggleRow(
  parent: HTMLElement, label: string, obj: Record<string, boolean>, key: string,
  onChange?: () => void, accent = ''
): void {
  const row = el('label', 'row toggle-row');
  const box = el('input', '') as HTMLInputElement;
  box.type = 'checkbox';
  box.checked = obj[key];
  box.addEventListener('change', () => { obj[key] = box.checked; onChange?.(); });
  row.append(box, el('span', `toggle-pill ${accent}`, ''), el('span', '', label));
  parent.append(row);
  (parent as unknown as { __syncers: (() => void)[] }).__syncers ??= [];
  (parent as unknown as { __syncers: (() => void)[] }).__syncers.push(() => { box.checked = obj[key]; });
}

function selectRow<T extends string>(
  parent: HTMLElement, label: string, options: readonly T[] | T[],
  obj: Record<string, T>, key: string, onChange?: () => void
): void {
  const row = el('div', 'row select-row');
  row.append(el('label', '', label));
  const sel = el('select', '') as HTMLSelectElement;
  for (const o of options) {
    const op = el('option', '') as HTMLOptionElement;
    op.value = o; op.textContent = o;
    sel.append(op);
  }
  sel.value = obj[key];
  sel.addEventListener('change', () => { obj[key] = sel.value as T; onChange?.(); });
  row.append(sel);
  parent.append(row);
  (parent as unknown as { __syncers: (() => void)[] }).__syncers ??= [];
  (parent as unknown as { __syncers: (() => void)[] }).__syncers.push(() => { sel.value = obj[key]; });
}

function card(
  parent: HTMLElement, title: string, subtitle: string,
  enabled?: { obj: Record<string, boolean>; key: string; onChange: () => void },
  startOpen = true
): HTMLElement {
  const c = el('section', 'card');
  const head = el('header', 'card-head');
  const titles = el('div', 'card-titles', `<h2>${title}</h2><p>${subtitle}</p>`);
  head.append(titles);
  if (enabled) {
    const sw = el('label', 'power') as HTMLLabelElement;
    const box = el('input', '') as HTMLInputElement;
    box.type = 'checkbox';
    box.checked = enabled.obj[enabled.key];
    box.addEventListener('change', (ev) => {
      ev.stopPropagation();
      enabled.obj[enabled.key] = box.checked;
      c.classList.toggle('disabled', !box.checked);
      enabled.onChange();
    });
    sw.append(box, el('span', 'power-dot', ''));
    sw.title = 'Enable / bypass node';
    head.append(sw);
    c.classList.toggle('disabled', !box.checked);
    (c as unknown as { __syncers: (() => void)[] }).__syncers ??= [];
    (c as unknown as { __syncers: (() => void)[] }).__syncers.push(() => {
      box.checked = enabled.obj[enabled.key];
      c.classList.toggle('disabled', !box.checked);
    });
  }
  const chev = el('span', 'chev', startOpen ? '▾' : '▸');
  head.append(chev);
  const body = el('div', 'card-body');
  if (!startOpen) body.style.display = 'none';
  head.addEventListener('click', () => {
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    chev.textContent = open ? '▸' : '▾';
  });
  c.append(head, body);
  parent.append(c);
  return body;
}

function btn(parent: HTMLElement, label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', `btn ${cls}`, label) as HTMLButtonElement;
  b.addEventListener('click', onClick);
  parent.append(b);
  return b;
}

// ---------------------------------------------------------------- build
export function buildUI(
  state: AppState, cb: UICallbacks,
  mounts: { top: HTMLElement; left: HTMLElement; right: HTMLElement; status: HTMLElement; overlay: HTMLElement }
): UIRefs {
  const syncers: (() => void)[] = [];
  const collectSyncers = (root: HTMLElement) => {
    root.querySelectorAll('*').forEach((n) => {
      const s = (n as unknown as { __syncers?: (() => void)[] }).__syncers;
      if (s) syncers.push(...s);
    });
  };

  // ---- topbar ---------------------------------------------------------------
  const brand = el('div', 'brand', '<span class="logo">◈</span> FRONTIER <em>SDF Terrain Studio</em>');
  mounts.top.append(brand);
  const tb = el('div', 'top-actions');
  mounts.top.append(tb);
  const genBtn = btn(tb, '⟳ Generate', 'primary', cb.generate);
  const playBtn = btn(tb, '▶ Simulate', 'play', cb.togglePlay);
  btn(tb, '⇥ +2s burst', '', cb.stepBurst);
  btn(tb, '⛰ Settle', '', cb.settleNow);
  btn(tb, '✕ Reset sim', '', cb.resetSim);
  const scenSel = el('select', 'scenario') as HTMLSelectElement;
  SCENARIOS.forEach((s, i) => {
    const o = el('option', '') as HTMLOptionElement;
    o.value = String(i); o.textContent = `☰ ${s.name}`;
    scenSel.append(o);
  });
  scenSel.title = 'Load scenario preset (rebuilds terrain)';
  scenSel.addEventListener('change', () => cb.scenario(parseInt(scenSel.value, 10)));
  tb.append(scenSel);
  const right = el('div', 'top-right');
  mounts.top.append(right);
  btn(right, '⬇ OBJ', '', cb.exportOBJ);
  btn(right, '⬇ PNG', '', cb.exportPNG);
  const fpsChip = el('div', 'chip fps', '— fps');
  right.append(fpsChip);

  // ---- left: node cards -------------------------------------------------------
  const T = (o: object) => o as Record<string, number | string | boolean>;
  const TB = (o: object) => o as Record<string, boolean>;

  // Terrain.
  const tb0 = card(mounts.left, '01 · Terrain SDF', 'ridged · fbm · warp · strata · caves', undefined, true);
  {
    const seedRow = el('div', 'row seed-row');
    seedRow.append(el('label', '', 'Seed'));
    const seedInput = el('input', 'seed') as HTMLInputElement;
    seedInput.type = 'number';
    seedInput.value = String(state.terrain.seed);
    seedInput.addEventListener('change', () => {
      state.terrain.seed = parseInt(seedInput.value || '1', 10);
      cb.terrainEdited();
    });
    const dice = el('button', 'btn dice', '🎲') as HTMLButtonElement;
    dice.title = 'Random seed + rebuild';
    dice.addEventListener('click', () => {
      state.terrain.seed = 1 + Math.floor(Math.random() * 99999);
      seedInput.value = String(state.terrain.seed);
      cb.terrainEdited();
    });
    seedRow.append(seedInput, dice);
    tb0.append(seedRow);
    syncers.push(() => { seedInput.value = String(state.terrain.seed); });
  }
  selectRow(tb0, 'Landform', ['alpine', 'canyon', 'coastal', 'karst', 'dunes', 'custom'] as const,
    T(state.terrain) as unknown as Record<string, 'alpine'>, 'landform', cb.terrainEdited);
  const tDefs: SliderDef[] = [
    { key: 'baseHeight', label: 'Base height', min: 0.1, max: 0.7, step: 0.01 },
    { key: 'mountainAmp', label: 'Relief', min: 0.05, max: 0.9, step: 0.01 },
    { key: 'rangeFreq', label: 'Range freq', min: 0.8, max: 5, step: 0.05 },
    { key: 'warpAmp', label: 'Domain warp', min: 0, max: 0.4, step: 0.005 },
    { key: 'detailAmp', label: 'Crag amp', min: 0, max: 0.04, step: 0.001, fmt: fmtAuto(3) },
    { key: 'detailFreq', label: 'Crag freq', min: 3, max: 24, step: 0.5, fmt: fmtAuto(1) },
    { key: 'terraceAmt', label: 'Terrace', min: 0, max: 1, step: 0.01 },
    { key: 'terraceSteps', label: 'Steps', min: 2, max: 16, step: 1, fmt: fmtAuto(0) },
    { key: 'terraceSharp', label: 'Riser', min: 0, max: 1, step: 0.01 },
    { key: 'caveAmt', label: 'Caves', min: 0, max: 1, step: 0.01 },
    { key: 'islandFalloff', label: 'Island falloff', min: 0, max: 1, step: 0.01 },
    { key: 'riverCarve', label: 'River incision', min: 0, max: 1, step: 0.01 },
    { key: 'strataFreq', label: 'Strata bands', min: 2, max: 24, step: 0.5, fmt: fmtAuto(1) },
    { key: 'dipTilt', label: 'Dip tilt', min: 0, max: 0.8, step: 0.01 },
  ];
  tDefs.forEach((d) => sliderRow(tb0, T(state.terrain), d, undefined, cb.terrainEdited));
  {
    const resRow = el('div', 'row select-row');
    resRow.append(el('label', '', 'Volume res'));
    const sel = el('select', '') as HTMLSelectElement;
    [64, 96, 128, 160].forEach((r) => {
      const o = el('option', '') as HTMLOptionElement;
      o.value = String(r); o.textContent = `${r}³`;
      sel.append(o);
    });
    sel.value = String(state.volumeRes);
    sel.title = 'Higher = finer detail, slower build';
    sel.addEventListener('change', () => cb.resChange(parseInt(sel.value, 10)));
    resRow.append(sel);
    tb0.append(resRow);
  }

  // Rain.
  const en = (o: object) => ({ obj: TB(o), key: 'enabled', onChange: () => undefined });
  const rb = card(mounts.left, '02 · Rain / Fluvial', 'ballistic → impact carve → runoff', en(state.rain), true);
  const rDefs: SliderDef[] = [
    { key: 'rate', label: 'Drops / sec', min: 500, max: 30000, step: 500, fmt: fmtAuto(0) },
    { key: 'globalRain', label: 'Global rain', min: 0, max: 1, step: 0.01 },
    { key: 'dropRadius', label: 'Drop radius', min: 0.1, max: 1.2, step: 0.02 },
    { key: 'gravity', label: 'Gravity', min: 1, max: 25, step: 0.1, fmt: fmtAuto(1) },
    { key: 'windX', label: 'Wind X', min: -6, max: 6, step: 0.1, fmt: fmtAuto(1) },
    { key: 'windZ', label: 'Wind Z', min: -6, max: 6, step: 0.1, fmt: fmtAuto(1) },
    { key: 'energyK', label: 'Impact power', min: 0, max: 0.3, step: 0.005, fmt: fmtAuto(3) },
    { key: 'flowSpeed', label: 'Flow threshold', min: 0.5, max: 10, step: 0.1, fmt: fmtAuto(1) },
    { key: 'streamK', label: 'Stream power', min: 0, max: 8, step: 0.1, fmt: fmtAuto(1) },
    { key: 'detachK', label: 'Detach rate', min: 0, max: 12, step: 0.1, fmt: fmtAuto(1) },
    { key: 'depositK', label: 'Deposit rate', min: 0, max: 14, step: 0.1, fmt: fmtAuto(1) },
    { key: 'manning', label: 'Friction', min: 0.2, max: 8, step: 0.1, fmt: fmtAuto(1) },
    { key: 'infiltrate', label: 'Infiltration', min: 0, max: 1, step: 0.01 },
    { key: 'grooveR', label: 'Groove radius', min: 0.15, max: 1.6, step: 0.02 },
    { key: 'hardnessResist', label: 'Hard resist', min: 0, max: 1, step: 0.01 },
  ];
  rDefs.forEach((d) => sliderRow(rb, T(state.rain), d));

  // Wind.
  const wb = card(mounts.left, '03 · Wind', 'saltation · abrasion · dunes', en(state.wind), false);
  const wDefs: SliderDef[] = [
    { key: 'rate', label: 'Grains / sec', min: 500, max: 20000, step: 500, fmt: fmtAuto(0) },
    { key: 'speed', label: 'Wind speed', min: 1, max: 25, step: 0.2, fmt: fmtAuto(1) },
    { key: 'turbulence', label: 'Turbulence', min: 0, max: 6, step: 0.1, fmt: fmtAuto(1) },
    { key: 'abrasionK', label: 'Abrasion', min: 0, max: 3, step: 0.05 },
    { key: 'saltRadius', label: 'Blast radius', min: 0.1, max: 1.4, step: 0.02 },
    { key: 'settleSpeed', label: 'Settle speed', min: 0.3, max: 8, step: 0.1, fmt: fmtAuto(1) },
    { key: 'depositK', label: 'Dune deposit', min: 0, max: 10, step: 0.1, fmt: fmtAuto(1) },
    { key: 'deflateK', label: 'Deflation', min: 0, max: 6, step: 0.1, fmt: fmtAuto(1) },
  ];
  wDefs.forEach((d) => sliderRow(wb, T(state.wind), d));
  {
    const row = el('div', 'row slider-row');
    row.append(el('label', '', 'Direction'));
    const input = el('input', '') as HTMLInputElement;
    input.type = 'range'; input.min = '0'; input.max = '360'; input.step = '1';
    const toDeg = () => (Math.atan2(state.wind.dirZ, state.wind.dirX) * 180) / Math.PI;
    const val = el('span', 'val', '');
    const refresh = () => { const d = ((toDeg() % 360) + 360) % 360; input.value = String(d); val.textContent = `${d.toFixed(0)}°`; };
    refresh();
    input.addEventListener('input', () => {
      const a = (parseFloat(input.value) * Math.PI) / 180;
      state.wind.dirX = Math.cos(a); state.wind.dirZ = Math.sin(a);
      refresh();
    });
    row.append(input, val);
    wb.append(row);
  }

  // Thermal.
  const hb = card(mounts.left, '04 · Thermal', '3D talus collapse (conservative)', en(state.thermal), false);
  const hDefs: SliderDef[] = [
    { key: 'talusDeg', label: 'Talus angle', min: 20, max: 55, step: 0.5, fmt: fmtAuto(1) },
    { key: 'rate', label: 'Rate', min: 0.02, max: 0.3, step: 0.01 },
    { key: 'iterations', label: 'Sweeps', min: 1, max: 40, step: 1, fmt: fmtAuto(0) },
    { key: 'hardnessEffect', label: 'Hard effect', min: 0, max: 1, step: 0.01 },
  ];
  hDefs.forEach((d) => sliderRow(hb, T(state.thermal), d));
  btn(hb, '⛰ Settle burst ×30', 'wide', cb.settleNow);

  // Chemical.
  const cb2 = card(mounts.left, '05 · Chemical', 'dissolution · karst · tufa', en(state.chemical), false);
  const cDefs: SliderDef[] = [
    { key: 'rate', label: 'Dissolve', min: 0, max: 1.5, step: 0.01 },
    { key: 'poreFreq', label: 'Pore freq', min: 6, max: 60, step: 1, fmt: fmtAuto(0) },
    { key: 'poreAmp', label: 'Pitting', min: 0, max: 1, step: 0.01 },
    { key: 'precipRate', label: 'Precipitate', min: 0, max: 0.4, step: 0.005, fmt: fmtAuto(3) },
  ];
  cDefs.forEach((d) => sliderRow(cb2, T(state.chemical), d));

  // Shade.
  const sb = card(mounts.left, '06 · Sat Shade', 'strata · biomes · AO · masks', undefined, false);
  const sDefs: SliderDef[] = [
    { key: 'waterLevel', label: 'Water level', min: 0, max: 72, step: 0.5, fmt: fmtAuto(1) },
    { key: 'snowline', label: 'Snowline', min: 0, max: 95, step: 1, fmt: fmtAuto(0) },
    { key: 'snowAmt', label: 'Snow cover', min: 0, max: 1, step: 0.01 },
    { key: 'arid', label: 'Aridity', min: 0, max: 1, step: 0.01 },
    { key: 'grainAmt', label: 'Micro grain', min: 0, max: 1.5, step: 0.01 },
    { key: 'sunDirX', label: 'Sun X', min: -1, max: 1, step: 0.01 },
    { key: 'sunDirY', label: 'Sun Y', min: 0.05, max: 1, step: 0.01 },
    { key: 'sunDirZ', label: 'Sun Z', min: -1, max: 1, step: 0.01 },
  ];
  sDefs.forEach((d) => sliderRow(sb, T(state.shade), d, cb.shadeEdited));
  selectRow(sb, 'View', Object.keys(MASK_VIEW_INDEX) as MaskView[],
    T(state.shade) as unknown as Record<string, MaskView>, 'maskView',
    () => cb.maskView(state.shade.maskView));

  // ---- right panel --------------------------------------------------------------
  const vb = card(mounts.right, 'Viewport', 'display · budget', undefined, true);
  toggleRow(vb, 'Rain particles', TB(state.view), 'showRainParticles', cb.viewEdited);
  toggleRow(vb, 'Wind particles', TB(state.view), 'showWindParticles', cb.viewEdited);
  toggleRow(vb, 'Water plane', TB(state.view), 'showWater', cb.viewEdited);
  toggleRow(vb, 'Wireframe', TB(state.view), 'wireframe', cb.viewEdited);
  toggleRow(vb, 'Shadows', TB(state.view), 'shadows', cb.viewEdited);
  toggleRow(vb, 'Auto remesh', TB(state.view), 'autoRemesh', cb.viewEdited);
  sliderRow(vb, T(state.view), { key: 'remeshMs', label: 'Remesh ms', min: 120, max: 2000, step: 10, fmt: fmtAuto(0) });
  sliderRow(vb, T(state.view), { key: 'simBudgetMs', label: 'Sim budget', min: 2, max: 24, step: 0.5, fmt: fmtAuto(1) });
  btn(vb, '◉ Remesh now (full bake)', 'wide', cb.remeshNow);

  const bb = card(mounts.right, 'Paint', 'masks → simulators', undefined, true);
  toggleRow(bb, 'Paint armed (drag on terrain)', TB(state.view), 'paintArmed', cb.viewEdited, 'accent');
  {
    const modes = el('div', 'mode-grid');
    const defs: { m: PaintMode; label: string; tip: string }[] = [
      { m: 'rain', label: '🌧 Rain', tip: 'Paint storm cells — rain spawns here' },
      { m: 'harden', label: '🪨 Harden', tip: 'Toughen rock against carving' },
      { m: 'soften', label: '🧽 Soften', tip: 'Weaken rock — carves fast' },
      { m: 'soluble', label: '⚗ Soluble', tip: 'Raise solubility for chemical attack' },
      { m: 'erase', label: '⌫ Erase', tip: 'Clear painted rain' },
    ];
    const btns: HTMLButtonElement[] = [];
    defs.forEach((d) => {
      const b = el('button', 'btn mode', d.label) as HTMLButtonElement;
      b.title = d.tip;
      b.style.setProperty('--mc', `#${PAINT_COLORS[d.m].toString(16).padStart(6, '0')}`);
      b.addEventListener('click', () => {
        state.brush.mode = d.m;
        btns.forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        cb.brushEdited();
      });
      modes.append(b);
      btns.push(b);
      if (state.brush.mode === d.m) b.classList.add('active');
    });
    bb.append(modes);
  }
  sliderRow(bb, T(state.brush), { key: 'radius', label: 'Radius', min: 1, max: 18, step: 0.5, fmt: fmtAuto(1) }, cb.brushEdited);
  sliderRow(bb, T(state.brush), { key: 'strength', label: 'Strength', min: 0.1, max: 1, step: 0.05 }, cb.brushEdited);
  bb.append(el('p', 'hint', 'Tip: arm paint, drag on the surface, then ▶ Simulate. Rain spawns from blue cells.'));

  const mb = card(mounts.right, 'Mask views', 'see what the sim sees', undefined, true);
  {
    const grid = el('div', 'mode-grid masks');
    (Object.keys(MASK_VIEW_INDEX) as MaskView[]).forEach((m) => {
      const b = el('button', 'btn mode sm', m) as HTMLButtonElement;
      b.addEventListener('click', () => {
        state.shade.maskView = m;
        grid.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        cb.maskView(m);
      });
      if (m === state.shade.maskView) b.classList.add('active');
      grid.append(b);
    });
    mb.append(grid);
  }

  const stb = card(mounts.right, 'Telemetry', 'mass balance · mesh · perf', undefined, true);
  const statGrid = el('div', 'stats');
  stb.append(statGrid);
  const statRows: Record<string, HTMLElement> = {};
  ['mesh', 'rain', 'wind', 'carved', 'balance', 'remesh', 'perf'].forEach((k) => {
    const r = el('div', 'stat', `<span class="k"></span><span class="v">—</span>`);
    statGrid.append(r);
    statRows[k] = r;
  });
  const setStat = (k: string, label: string, value: string) => {
    statRows[k].querySelector('.k')!.textContent = label;
    statRows[k].querySelector('.v')!.textContent = value;
  };

  // ---- statusbar / overlay --------------------------------------------------------
  const statusMsg = el('span', 'status-msg', 'Ready.');
  const progWrap = el('div', 'progress', '<div class="bar"></div>');
  const progBar = progWrap.querySelector('.bar') as HTMLElement;
  mounts.status.append(statusMsg, progWrap);
  const statusRight = el('span', 'status-right', '');
  mounts.status.append(statusRight);

  const overlayCard = el('div', 'overlay-card hidden', '');
  mounts.overlay.append(overlayCard);

  collectSyncers(mounts.left);
  collectSyncers(mounts.right);

  // ---- refs -------------------------------------------------------------------------
  return {
    setProgress: (t, label) => {
      progBar.style.width = `${Math.round(t * 100)}%`;
      progWrap.classList.toggle('active', t > 0 && t < 1);
      if (t >= 1) statusMsg.textContent = label === 'done' ? 'Ready.' : label;
      else statusMsg.textContent = `${label}… ${Math.round(t * 100)}%`;
    },
    setPlaying: (playing) => {
      playBtn.textContent = playing ? '⏸ Pause' : '▶ Simulate';
      playBtn.classList.toggle('playing', playing);
    },
    setBusy: (busy) => {
      genBtn.classList.toggle('busy', busy);
      genBtn.textContent = busy ? '… Building' : '⟳ Generate';
      overlayCard.classList.toggle('hidden', !busy);
      if (busy) overlayCard.textContent = 'Building SDF volume…';
    },
    updateStats: (s) => {
      fpsChip.textContent = `${s.fps.toFixed(0)} fps`;
      setStat('mesh', 'mesh', `${(s.verts / 1000).toFixed(0)}k v · ${(s.tris / 1000).toFixed(0)}k tri`);
      setStat('rain', 'rain', `${(s.rainAlive / 1000).toFixed(1)}k drops`);
      setStat('wind', 'wind', `${(s.windAlive / 1000).toFixed(1)}k grains`);
      setStat('carved', 'carved', `−${s.carved.toFixed(1)} m³ · +${s.deposited.toFixed(1)} m³`);
      const bal = s.deposited + s.inFlight - s.carved;
      setStat('balance', 'mass Δ', `${bal >= 0 ? '+' : ''}${bal.toFixed(1)} m³ ${Math.abs(bal) < Math.max(1, s.carved * 0.25) ? '✓' : ''}`);
      setStat('remesh', 'remesh', `${s.bakeMs.toFixed(0)} ms`);
      setStat('perf', 'sim', `${s.simMs.toFixed(1)} ms/f`);
      statusRight.textContent = `sdf v${s.sdfVersion}`;
    },
    setStatus: (msg) => { statusMsg.textContent = msg; },
    syncAll: () => syncers.forEach((f) => f()),
  };
}
