// Layer stack panel — drag to reorder, click to select, inline chips for the
// settings that matter at a glance (mask, opacity, material).

import { TERRAIN_TYPES, TERRAIN_GROUPS, MATERIALS, MATERIAL_BY_KEY } from '../schema/layers.js';
import { nextId, maskHasAny } from '../core/state.js';
import { el, modal } from './widgets.js';
import { icon } from './icons.js';

const CARET = '<svg viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1.5 3L4.5 6l3-3"/></svg>';

export class LayerStack {
  constructor(opts) {
    this.root = document.getElementById('stack-list');
    this.hint = document.getElementById('stack-hint');
    this.tabs = document.getElementById('stack-tabs');
    this.state = opts.state;
    this.onSelect = opts.onSelect;
    this.onChange = opts.onChange;
    this.onAdd = opts.onAdd;
    this.onAddMaterial = opts.onAddMaterial;
    this.selection = null;

    this.tabs.addEventListener('click', (e) => {
      const t = e.target.closest('.tab');
      if (!t) return;
      this.tabs.querySelectorAll('.tab').forEach((x) => x.classList.remove('sel'));
      t.classList.add('sel');
      this.selection = null;
      this.render();
      this.onSelect?.(null);
    });

    document.getElementById('add-layer').addEventListener('click', () => this.openAdd());
  }

  get kind() {
    return this.tabs.querySelector('.tab.sel').dataset.stack;
  }

  get layers() {
    return this.kind === 'terrain' ? this.state.terrainLayers : this.state.textureLayers;
  }

  get selected() {
    return this.layers.find((l) => l.id === this.selection) || null;
  }

  setSelection(id, { scroll = false } = {}) {
    this.selection = id;
    this.render();
    if (scroll) {
      this.root.querySelector(`.layer[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }

  render() {
    const layers = this.layers;
    this.root.innerHTML = '';
    this.hint.textContent = this.kind === 'terrain'
      ? 'Later layers act on the result of earlier ones · drag to reorder'
      : 'Painted bottom-up onto the terrain · drag to reorder · mask drives placement';

    if (!layers.length) {
      const e = el('div', 'stack-empty');
      e.innerHTML = this.kind === 'terrain'
        ? 'No terrain layers yet.<br>Add a generator to start shaping the field.'
        : 'No texture layers yet.<br>Build the terrain, then add materials here.';
      this.root.append(e);
      return;
    }
    for (const layer of layers) this.root.append(this.row(layer));
  }

  // ── one row ───────────────────────────────────────────────────────────────
  row(layer) {
    const isTex = this.kind === 'texture';
    const info = isTex ? MATERIAL_BY_KEY[layer.material] : TERRAIN_TYPES[layer.type];
    const r = el('div', 'layer' + (layer.id === this.selection ? ' sel' : '') + (layer.enabled ? '' : ' off'));
    r.dataset.id = layer.id;

    // grip
    r.append(el('div', 'grip', icon('grip')));

    // icon
    const ic = el('div', 'layer-icon' + (isTex ? ' mat' : ''), icon(info?.icon || 'plane'));
    if (isTex && layer.colors) {
      const hex = (c) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
      ic.style.background = `linear-gradient(135deg,${hex(layer.colors[0])} 0 55%,${hex(layer.colors[1])} 55% 100%)`;
      ic.style.borderColor = 'rgba(0,0,0,.4)';
      ic.style.color = 'rgba(0,0,0,.35)';
    }
    r.append(ic);

    // name + meta
    const main = el('div', 'layer-main');
    const name = el('div', 'layer-name', layer.name);
    name.addEventListener('dblclick', () => this.rename(layer, name));
    const meta = el('div', 'layer-meta');
    const chips = [];
    if (!layer.enabled) chips.push(['', 'bypassed']);
    if (!isTex) {
      if (layer.type === 'hydraulic') chips.push(['warn', `${Math.round((layer.params.droplets || 0) / 1000)}k drops`]);
      if (layer.type === 'thermal') chips.push(['', `${layer.params.iterations}×`]);
      if (maskHasAny(layer.mask)) chips.push(['accent', 'mask']);
    } else {
      if (maskHasAny(layer.mask)) chips.push(['accent', 'mask']);
      else chips.push(['warn', 'unmasked']);
    }
    for (const [cls, txt] of chips) meta.append(el('span', 'chip ' + cls, txt));
    main.append(name, meta);
    r.append(main);

    // actions
    const acts = el('div', 'layer-actions');
    const op = el('div', 'layer-opacity');
    op.innerHTML = `<i style="width:${Math.round((layer.opacity ?? 1) * 100)}%"></i>`;
    op.title = `Opacity ${Math.round((layer.opacity ?? 1) * 100)}%`;
    acts.append(op);

    const eye = el('button', 'btn' + (layer.enabled ? '' : ' active'));
    eye.innerHTML = icon(layer.enabled ? 'eye' : 'eyeOff');
    eye.title = 'Bypass / enable';
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      layer.enabled = !layer.enabled;
      this.onChange?.(layer, { rebuild: true });
      this.render();
    });
    const dup = el('button', 'btn');
    dup.innerHTML = icon('copy');
    dup.title = 'Duplicate';
    dup.addEventListener('click', (e) => { e.stopPropagation(); this.duplicate(layer); });
    const del = el('button', 'btn');
    del.innerHTML = icon('trash');
    del.title = 'Delete';
    del.addEventListener('click', (e) => { e.stopPropagation(); this.remove(layer); });
    acts.append(eye, dup, del);
    r.append(acts);

    r.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      this.selection = layer.id;
      this.render();
      this.onSelect?.(layer);
    });

    // drag reorder
    r.draggable = true;
    r.addEventListener('dragstart', (e) => {
      this.dragId = layer.id;
      r.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(layer.id));
    });
    r.addEventListener('dragend', () => {
      r.classList.remove('dragging');
      this.clearDropMarks();
      this.dragId = null;
    });
    r.addEventListener('dragover', (e) => {
      if (!this.dragId || this.dragId === layer.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = r.getBoundingClientRect();
      this.clearDropMarks();
      r.classList.add(e.clientY > rect.top + rect.height / 2 ? 'drop-below' : 'drop-above');
    });
    r.addEventListener('drop', (e) => {
      e.preventDefault();
      this.reorder(this.dragId, layer.id, r.classList.contains('drop-below'));
      this.clearDropMarks();
    });

    return r;
  }

  clearDropMarks() {
    this.root.querySelectorAll('.drop-above, .drop-below')
      .forEach((x) => x.classList.remove('drop-above', 'drop-below'));
  }

  reorder(dragId, targetId, below) {
    const list = this.layers;
    const from = list.findIndex((l) => l.id === dragId);
    if (from < 0) return;
    const [item] = list.splice(from, 1);
    let to = list.findIndex((l) => l.id === targetId);
    if (below) to += 1;
    list.splice(Math.max(0, to), 0, item);
    this.onChange?.(item, { rebuild: true, structural: true });
    this.render();
  }

  rename(layer, nameEl) {
    const input = el('input');
    input.value = layer.name;
    nameEl.textContent = '';
    nameEl.append(input);
    input.focus();
    input.select();
    const commit = () => { layer.name = input.value.trim() || layer.name; this.render(); };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') this.render();
    });
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  duplicate(layer) {
    const copy = JSON.parse(JSON.stringify(layer));
    copy.id = nextId();
    copy.name = layer.name + ' copy';
    const list = this.layers;
    list.splice(list.indexOf(layer) + 1, 0, copy);
    this.selection = copy.id;
    this.render();
    this.onSelect?.(copy);
    this.onChange?.(copy, { rebuild: true, structural: true });
  }

  remove(layer) {
    const list = this.layers;
    const i = list.indexOf(layer);
    if (i >= 0) list.splice(i, 1);
    if (this.selection === layer.id) {
      this.selection = null;
      this.onSelect?.(null);
    }
    this.onChange?.(layer, { rebuild: true, structural: true });
    this.render();
  }

  // ── add layer ─────────────────────────────────────────────────────────────
  openAdd() {
    if (this.kind === 'texture') return this.openMaterialShelf();
    const grid = el('div', 'add-grid');
    for (const g of TERRAIN_GROUPS) {
      const items = Object.entries(TERRAIN_TYPES).filter(([, t]) => t.group === g);
      if (!items.length) continue;
      grid.append(el('div', 'add-group', g));
      for (const [type, t] of items) {
        const b = el('button', 'add-item');
        b.innerHTML = `<span class="ic">${icon(t.icon || 'plane')}</span>
          <span class="txt"><b>${t.name}</b><span>${t.hint || ''}</span></span>`;
        b.addEventListener('click', () => {
          document.querySelector('.modal-scrim')?.click();
          this.onAdd?.(type);
        });
        grid.append(b);
      }
    }
    modal({ title: 'Add terrain layer', body: grid });
  }

  openMaterialShelf() {
    const grid = el('div', 'mat-grid');
    for (const m of MATERIALS) {
      const hex = (c) => '#' + c.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
      const b = el('button', 'mat-item');
      b.innerHTML =
        `<span class="sw"><span class="a" style="background:${hex(m.color)}"></span>` +
        `<span class="b" style="background:${hex(m.color2)}"></span></span>` +
        `<span class="nm">${m.name}</span>`;
      b.addEventListener('click', () => {
        document.querySelector('.modal-scrim')?.click();
        this.onAddMaterial?.(m.key);
      });
      grid.append(b);
    }
    modal({ title: 'Add material layer', body: grid });
  }
}
