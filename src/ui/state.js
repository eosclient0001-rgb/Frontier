/**
 * Frontier Terrain Forge — editor state.
 *
 * One mutable project object, one selection, and a tiny event bus. Every panel
 * renders from this and mutates through `edit()`, so a change made in the
 * inspector, the layer stack or a brush stroke all take the same path and mark
 * the same dirty flags.
 *
 * Dirty flags are the whole scheduling story:
 *   terrain → the height field (and therefore everything) must be regenerated
 *   texture → the material maps must be re-baked
 *   view    → only the viewport needs a redraw
 */
import { makeLayer, makeErosionLayer, uid, normalizeProject } from '../gen/project.js';
import { MATERIAL_BY_ID, EROSION_BY_ID, TERRAIN_BY_ID, defaultParams, DEFAULT_MASK } from '../gen/schema.js';

export const layerKindOf = (layer) => {
  if (!layer) return 'terrain';
  if (layer.kind === 'sim' || EROSION_BY_ID[layer.type]) return 'sim';
  return layer.material ? 'material' : 'terrain';
};

export const typeOf = (layer) => TERRAIN_BY_ID[layer?.type] || MATERIAL_BY_ID[layer?.type] || EROSION_BY_ID[layer?.type] || null;

export class Editor {
  constructor(project) {
    this.project = project;
    this.selection = { kind: 'layer', id: project.terrain[0]?.id ?? null };
    this.dirty = { terrain: true, texture: true, view: true };
    this.listeners = new Map();
    this.history = [];
    this.future = [];
    this.stats = null;
    this.bakeStats = null;
    this.generateStats = null;
    this.gpuInfo = null;
    this.busy = null;
    this.brushEnabled = false;
    this.messages = [];
  }

  /* ------------------------------------------------------------ events -- */
  on(topic, fn) {
    if (!this.listeners.has(topic)) this.listeners.set(topic, new Set());
    this.listeners.get(topic).add(fn);
    return () => this.listeners.get(topic)?.delete(fn);
  }

  emit(topic, detail) {
    for (const fn of this.listeners.get(topic) || []) fn(detail, this);
    if (topic !== 'any') for (const fn of this.listeners.get('any') || []) fn({ topic, detail }, this);
  }

  log(level, message) {
    this.messages.push({ level, message, time: Date.now() });
    if (this.messages.length > 200) this.messages.shift();
    this.emit('log', { level, message });
  }

  /* ---------------------------------------------------------- mutation -- */
  edit(mutator, { terrain = false, texture = false, view = true, label } = {}) {
    mutator(this.project);
    if (terrain) { this.dirty.terrain = true; this.dirty.texture = true; }
    if (texture) this.dirty.texture = true;
    if (view) this.dirty.view = true;
    this.emit('change', { terrain, texture, view, label });
    return this.project;
  }

  /** Structural edits push a history entry; continuous ones do not. */
  structural(mutator, flags) {
    this.pushHistory();
    return this.edit(mutator, flags);
  }

  pushHistory() {
    try {
      this.history.push(JSON.stringify(this.project));
      if (this.history.length > 60) this.history.shift();
      this.future.length = 0;
    } catch { /* project is always serialisable, but never break the app over it */ }
  }

  undo() {
    if (!this.history.length) return false;
    const snapshot = this.history.pop();
    this.future.push(JSON.stringify(this.project));
    this.project = normalizeProject(JSON.parse(snapshot));
    this.selection = { kind: 'layer', id: this.project.terrain[0]?.id ?? null };
    this.dirty = { terrain: true, texture: true, view: true };
    this.emit('change', { terrain: true, texture: true, view: true, label: 'undo' });
    this.emit('selection', this.selection);
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    const snapshot = this.future.pop();
    this.history.push(JSON.stringify(this.project));
    this.project = normalizeProject(JSON.parse(snapshot));
    this.dirty = { terrain: true, texture: true, view: true };
    this.emit('change', { terrain: true, texture: true, view: true, label: 'redo' });
    return true;
  }

  replaceProject(project, { regenerate = true } = {}) {
    this.pushHistory();
    this.project = project;
    this.selection = { kind: 'layer', id: project.terrain[0]?.id ?? null };
    if (regenerate) this.dirty = { terrain: true, texture: true, view: true };
    this.emit('change', { terrain: true, texture: true, view: true, label: 'project' });
    this.emit('selection', this.selection);
  }

  setTab(tab) {
    if (this.tab === tab) return;
    this.tab = tab;
    this.emit('tab', tab);
  }

  /* --------------------------------------------------------- selection -- */
  select(selection) {
    this.selection = selection;
    this.emit('selection', selection);
  }

  get selected() {
    const { kind, id } = this.selection;
    if (kind !== 'layer') return null;
    return [...this.project.terrain, ...this.project.materials].find((layer) => layer.id === id) || null;
  }

  get selectedType() { return typeOf(this.selected); }

  selectLayer(id) {
    if (!id) return;
    const layer = [...this.project.terrain, ...this.project.materials].find((l) => l.id === id);
    if (layer) this.tab = layer.material ? 'texture' : 'terrain';
    this.select({ kind: 'layer', id });
  }

  /* ------------------------------------------------------ layer editing -- */
  /** The mutation runs inside the history snapshot, so undo always sees the
   *  state from before the change. */
  addLayer(typeId, { material = false, index = null } = {}) {
    const type = material ? MATERIAL_BY_ID[typeId] : TERRAIN_BY_ID[typeId];
    if (!type) return null;
    const layer = makeLayer(typeId, {}, material ? { material: true, name: type.label } : { name: type.label });
    this.structural((project) => {
      const list = material ? project.materials : project.terrain;
      list.splice(index === null ? list.length : Math.max(0, Math.min(list.length, index)), 0, layer);
    }, { terrain: !material, texture: material });
    this.selectLayer(layer.id);
    return layer;
  }

  addErosionLayer(typeId, index = null) {
    const type = EROSION_BY_ID[typeId];
    if (!type) return null;
    const layer = makeErosionLayer(typeId);
    this.structural((project) => {
      const list = project.terrain;
      list.splice(index === null ? list.length : Math.max(0, Math.min(list.length, index)), 0, layer);
    }, { terrain: true });
    this.selectLayer(layer.id);
    return layer;
  }

  duplicateLayer(id) {
    const source = [...this.project.terrain, ...this.project.materials].find((l) => l.id === id);
    if (!source) return;
    const clone = JSON.parse(JSON.stringify(source));
    clone.id = uid(source.type);
    clone.name = `${source.name} copy`;
    this.structural((project) => {
      const list = source.material ? project.materials : project.terrain;
      const at = list.findIndex((l) => l.id === id);
      list.splice(at + 1, 0, clone);
    }, { terrain: !source.material, texture: !!source.material });
    this.selectLayer(clone.id);
  }

  removeLayer(id) {
    let selection = null;
    let flags = null;
    this.structural((project) => {
      for (const list of [project.terrain, project.materials]) {
        const index = list.findIndex((l) => l.id === id);
        if (index < 0) continue;
        const [removed] = list.splice(index, 1);
        const next = list[Math.min(index, list.length - 1)];
        flags = { terrain: !removed.material, texture: !!removed.material };
        selection = next ? { kind: 'layer', id: next.id } : { kind: removed.material ? 'bake' : 'world', id: null };
        return;
      }
    }, { terrain: true, texture: true });
    if (selection) this.select(selection);
    void flags;
  }

  moveLayer(id, { toIndex = null, beforeId = null } = {}) {
    const source = [...this.project.terrain, ...this.project.materials].find((l) => l.id === id);
    if (!source) return;
    this.structural((project) => {
      const list = source.material ? project.materials : project.terrain;
      const from = list.findIndex((l) => l.id === id);
      if (from < 0) return;
      const [layer] = list.splice(from, 1);
      let to = toIndex;
      if (to === null) {
        to = beforeId ? list.findIndex((l) => l.id === beforeId) : list.length;
        if (to < 0) to = list.length;
      }
      list.splice(Math.max(0, Math.min(list.length, to)), 0, layer);
    }, { terrain: !source.material, texture: !!source.material });
  }

  resetLayer(id) {
    const layer = [...this.project.terrain, ...this.project.materials].find((l) => l.id === id);
    const type = typeOf(layer);
    if (!layer || !type) return;
    this.structural(() => { layer.params = defaultParams(type); }, { terrain: !layer.material, texture: !!layer.material });
  }

  renameLayer(id, name) {
    const layer = [...this.project.terrain, ...this.project.materials].find((l) => l.id === id);
    if (!layer || !name.trim()) return;
    this.structural(() => { layer.name = name.trim(); }, {});
  }

  setEnabled(id, enabled) {
    const layer = [...this.project.terrain, ...this.project.materials].find((l) => l.id === id);
    if (!layer) return;
    this.edit(() => { layer.enabled = enabled; this.dirty.view = true; }, { terrain: !layer.material, texture: !!layer.material });
  }

  addMask(id, kind = 1) {
    const layer = [...this.project.terrain, ...this.project.materials].find((l) => l.id === id);
    if (!layer || (layer.masks || []).length >= 4) return;
    this.structural(() => { (layer.masks = layer.masks || []).push(DEFAULT_MASK(kind)); }, { terrain: !layer.material, texture: !!layer.material });
  }

  removeMask(id, index) {
    const layer = [...this.project.terrain, ...this.project.materials].find((l) => l.id === id);
    if (!layer) return;
    this.structural(() => { layer.masks.splice(index, 1); }, { terrain: !layer.material, texture: !!layer.material });
  }

  setDisplay(key, value) {
    this.edit((project) => { project.display[key] = value; });
  }

  setTexture(key, value) {
    this.edit((project) => { project.texture[key] = value; }, { texture: true });
  }

  setWorld(key, value) {
    this.edit((project) => { project.world[key] = value; }, { terrain: true });
  }

  /* ------------------------------------------------------------ brushes -- */
  setBrush(patch) {
    Object.assign(this.project.brush, patch);
    this.emit('brush', this.project.brush);
  }
}
