import { PARAM_GROUPS, PRESETS, type ParamDef, type ParamStore } from '../params';

export interface PanelCallbacks {
  onChange(name: string, value: number): void;
  onPreset(name: string): void;
  onReset(): void;
  onTogglePlay(): boolean;
  onStepOnce(): void;
  onResolution(name: string): void;
  onDebugView(v: number): void;
  onBrushMode(mode: number): void;
  onExport(): void;
}

const DEBUG_VIEWS = [
  'Beauty', 'Rock hardness', 'Normals', 'March cost',
  'Water & flow', 'Sediment', 'Weathering', 'RAW SDF (diagnostic)',
];

const BRUSH_MODES = ['Subtract', 'Add', 'Smooth'];

/** Formats a value with a sensible number of digits for its range. */
function fmt(v: number, d: ParamDef): string {
  const span = d.max - d.min;
  if (d.kind === 'u32' || d.step === 1) return String(Math.round(v));
  if (span >= 100) return v.toFixed(1);
  if (span >= 10) return v.toFixed(2);
  if (span >= 1) return v.toFixed(3);
  return v.toExponential(2);
}

export class Panel {
  private root: HTMLElement;
  private store: ParamStore;
  private cb: PanelCallbacks;
  private inputs = new Map<string, { range: HTMLInputElement; num: HTMLInputElement }>();
  private playBtn!: HTMLButtonElement;
  private brushBtns: HTMLButtonElement[] = [];

  constructor(root: HTMLElement, store: ParamStore, cb: PanelCallbacks) {
    this.root = root;
    this.store = store;
    this.cb = cb;
    this.build();
  }

  private build() {
    const head = document.createElement('div');
    head.className = 'p-head';
    head.innerHTML = `
      <div class="p-title">Frontier · SDF Erosion</div>
      <div class="p-sub">Volumetric terrain. Every slider re-runs the physics live.</div>
    `;

    // --- preset selector ---
    const presetSel = document.createElement('select');
    presetSel.title = 'Starting landform';
    for (const k of Object.keys(PRESETS)) {
      const o = document.createElement('option');
      o.value = k; o.textContent = k;
      presetSel.appendChild(o);
    }
    presetSel.onchange = () => this.cb.onPreset(presetSel.value);
    const presetRow = document.createElement('div');
    presetRow.className = 'row';
    presetRow.appendChild(presetSel);
    head.appendChild(presetRow);

    // --- transport ---
    const row1 = document.createElement('div');
    row1.className = 'row';
    this.playBtn = document.createElement('button');
    this.playBtn.className = 'primary';
    this.playBtn.textContent = '▶ Run erosion';
    this.playBtn.onclick = () => {
      const running = this.cb.onTogglePlay();
      this.playBtn.textContent = running ? '❚❚ Pause' : '▶ Run erosion';
      this.playBtn.classList.toggle('active', running);
    };
    const stepBtn = document.createElement('button');
    stepBtn.textContent = '⏭ Step';
    stepBtn.title = 'Advance the simulation by a single step';
    stepBtn.onclick = () => this.cb.onStepOnce();
    row1.append(this.playBtn, stepBtn);
    head.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'row';
    const resetBtn = document.createElement('button');
    resetBtn.textContent = '↺ Rebuild terrain';
    resetBtn.title = 'Regenerate the initial landform and clear all erosion';
    resetBtn.onclick = () => this.cb.onReset();
    const expBtn = document.createElement('button');
    expBtn.textContent = '⬇ Save settings';
    expBtn.title = 'Download the current parameters as JSON';
    expBtn.onclick = () => this.cb.onExport();
    row2.append(resetBtn, expBtn);
    head.appendChild(row2);

    // --- resolution + debug ---
    const row3 = document.createElement('div');
    row3.className = 'row';
    const resSel = document.createElement('select');
    resSel.title = 'Voxel grid resolution';
    for (const k of ['Low', 'Medium', 'High', 'Ultra']) {
      const o = document.createElement('option');
      o.value = k; o.textContent = `Grid: ${k}`;
      resSel.appendChild(o);
    }
    resSel.value = 'Medium';
    resSel.onchange = () => this.cb.onResolution(resSel.value);

    const dbgSel = document.createElement('select');
    dbgSel.title = 'Inspect the simulation state directly';
    DEBUG_VIEWS.forEach((v, i) => {
      const o = document.createElement('option');
      o.value = String(i); o.textContent = v;
      dbgSel.appendChild(o);
    });
    dbgSel.onchange = () => this.cb.onDebugView(parseInt(dbgSel.value, 10));
    row3.append(resSel, dbgSel);
    head.appendChild(row3);

    // --- sculpt mode ---
    const sculptLabel = document.createElement('div');
    sculptLabel.className = 'p-sub';
    sculptLabel.style.marginTop = '10px';
    sculptLabel.textContent = 'Sculpt brush (hold Ctrl and drag on the terrain)';
    head.appendChild(sculptLabel);

    const row4 = document.createElement('div');
    row4.className = 'row';
    BRUSH_MODES.forEach((m, i) => {
      const b = document.createElement('button');
      b.textContent = m;
      if (i === 0) b.classList.add('active');
      b.onclick = () => {
        this.brushBtns.forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        this.cb.onBrushMode(i);
      };
      this.brushBtns.push(b);
      row4.appendChild(b);
    });
    head.appendChild(row4);

    this.root.appendChild(head);

    // --- parameter groups ---
    for (const g of PARAM_GROUPS) {
      const defs = this.store.defs.filter((d) => d.group === g && !d.hidden);
      if (defs.length === 0) continue;

      const group = document.createElement('div');
      group.className = 'group';
      // Start with the most-used groups open.
      if (!['Quality', 'Material', 'Lighting'].includes(g)) {
        // open
      } else {
        group.classList.add('collapsed');
      }

      const gh = document.createElement('div');
      gh.className = 'group-head';
      gh.innerHTML = `<span>${g}</span><span class="chev">▼</span>`;
      gh.onclick = () => group.classList.toggle('collapsed');

      const gb = document.createElement('div');
      gb.className = 'group-body';

      for (const d of defs) gb.appendChild(this.makeControl(d));

      group.append(gh, gb);
      this.root.appendChild(group);
    }
  }

  private makeControl(d: ParamDef): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'ctl';

    const top = document.createElement('div');
    top.className = 'ctl-top';

    const label = document.createElement('span');
    label.className = 'ctl-label';
    label.textContent = d.label;
    if (d.tip) {
      label.title = d.tip;
      label.onclick = () => wrap.classList.toggle('show-tip');
    }

    const valWrap = document.createElement('span');
    valWrap.className = 'ctl-val';
    const num = document.createElement('input');
    num.type = 'text';
    num.value = fmt(d.value, d);
    valWrap.appendChild(num);

    top.append(label, valWrap);

    const range = document.createElement('input');
    range.type = 'range';
    const steps = 1000;
    range.min = '0';
    range.max = String(steps);
    range.step = '1';

    const toSlider = (v: number) => {
      if (d.step === 1 || d.kind === 'u32') return v;
      return ((v - d.min) / (d.max - d.min)) * steps;
    };
    const fromSlider = (s: number) => {
      if (d.step === 1 || d.kind === 'u32') return s;
      return d.min + (s / steps) * (d.max - d.min);
    };

    if (d.step === 1 || d.kind === 'u32') {
      range.min = String(d.min);
      range.max = String(d.max);
      range.step = '1';
    }
    range.value = String(toSlider(d.value));

    const commit = (v: number) => {
      const clamped = Math.max(d.min, Math.min(d.max, v));
      this.store.set(d.name, clamped);
      num.value = fmt(clamped, d);
      this.cb.onChange(d.name, clamped);
    };

    range.oninput = () => commit(fromSlider(parseFloat(range.value)));
    num.onchange = () => {
      const v = parseFloat(num.value);
      if (Number.isFinite(v)) {
        commit(v);
        range.value = String(toSlider(Math.max(d.min, Math.min(d.max, v))));
      } else {
        num.value = fmt(this.store.get(d.name), d);
      }
    };

    wrap.append(top, range);

    if (d.tip) {
      const tip = document.createElement('div');
      tip.className = 'tip';
      tip.textContent = d.tip;
      wrap.appendChild(tip);
    }

    this.inputs.set(d.name, { range, num });
    return wrap;
  }

  /** Push store values back into the widgets (after a preset load). */
  refresh() {
    for (const d of this.store.defs) {
      const io = this.inputs.get(d.name);
      if (!io) continue;
      const v = this.store.get(d.name);
      io.num.value = fmt(v, d);
      if (d.step === 1 || d.kind === 'u32') {
        io.range.value = String(v);
      } else {
        io.range.value = String(((v - d.min) / (d.max - d.min)) * 1000);
      }
    }
  }

  setPlaying(running: boolean) {
    this.playBtn.textContent = running ? '❚❚ Pause' : '▶ Run erosion';
    this.playBtn.classList.toggle('active', running);
  }
}
