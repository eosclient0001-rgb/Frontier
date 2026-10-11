/**
 * Frontier Terrain Forge — UI smoke test.
 *
 * The panels are the one part of the app that cannot be exercised by
 * tools/simulate.mjs, so this runs them against a minimal DOM shim: every
 * selection kind is rendered, every layer mutation is executed, and the
 * readback/export path is driven with a mock device. It catches the class of
 * bug that only shows up when a panel is actually built — a missing import, a
 * mistyped element id, a formatter that throws on an edge value.
 *
 *   node tools/uitest.mjs
 */

/* ------------------------------------------------------------------ DOM -- */
class ClassList {
  constructor(node) { this.node = node; this.set = new Set(); }
  add(...names) { for (const n of names) if (n) this.set.add(n); this.sync(); }
  remove(...names) { for (const n of names) this.set.delete(n); this.sync(); }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : force;
    if (on) this.set.add(name); else this.set.delete(name);
    this.sync();
    return on;
  }
  contains(name) { return this.set.has(name); }
  sync() { this.node._class = [...this.set].join(' '); }
}

class Node {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.parent = null;
    this._class = '';
    this.classList = new ClassList(this);
    this.style = new Proxy({}, { get: (t, k) => (k === 'setProperty' ? (n, v) => { t[n] = v; } : t[k]), set: (t, k, v) => { t[k] = v; return true; } });
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.width = 0;
    this.height = 0;
    this.draggable = false;
  }
  get className() { return this._class; }
  set className(v) { this.classList.set = new Set(String(v || '').split(/\s+/).filter(Boolean)); this.classList.sync(); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get childNodes() { return this.children; }
  append(...nodes) { for (const n of nodes.flat(4)) if (n != null) this.appendChild(n); }
  appendChild(node) {
    const child = typeof node === 'string' ? new TextNode(node) : node;
    child.parent = this;
    this.children.push(child);
    return child;
  }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parent = null; return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'class') this.className = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  fire(type, event = {}) {
    const payload = { type, target: this, currentTarget: this, stopPropagation() {}, preventDefault() {}, ...event };
    for (const fn of this.listeners.get(type) || []) fn(payload);
  }
  click() { this.fire('click'); }
  focus() {}
  select() {}
  blur() { this.fire('blur'); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40, x: 0, y: 0 }; }
  getContext() { return { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), putImageData() {}, clearRect() {}, drawImage() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, imageSmoothingEnabled: true, canvas: this }; }
  toBlob(cb) { cb(new Blob([new Uint8Array(8)], { type: 'image/png' })); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  contains(node) { return this.children.includes(node); }
  /** Deep text walk, used by the assertions. */
  text() { return this.children.map((c) => (c instanceof TextNode ? c.data : `${c.textContent ?? ''}${c.text()}`)).join(' '); }
  find(predicate, out = []) {
    for (const child of this.children) {
      if (child instanceof TextNode) continue;
      if (predicate(child)) out.push(child);
      child.find(predicate, out);
    }
    return out;
  }
}

class TextNode {
  constructor(data) { this.data = String(data); this.textContent = this.data; this.children = []; }
  find() { return []; }
}

class Element extends Node {}

const registry = new Map();
const shimElement = (id) => {
  if (!registry.has(id)) {
    const node = new Element('div');
    node.id = id;
    registry.set(id, node);
  }
  return registry.get(id);
};

globalThis.Node = Node;
globalThis.Element = Element;

globalThis.document = {
  baseURI: 'http://localhost/',
  body: new Element('body'),
  createElement: (tag) => new Element(tag),
  createElementNS: (_ns, tag) => new Element(tag),
  createTextNode: (text) => new TextNode(text),
  getElementById: (id) => shimElement(id),
  addEventListener() {},
  querySelector: () => null,
};
globalThis.window = {
  innerWidth: 1600,
  innerHeight: 900,
  devicePixelRatio: 2,
  addEventListener() {},
  requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;
globalThis.URL.createObjectURL = () => 'blob:mock';
globalThis.URL.revokeObjectURL = () => {};
globalThis.GPUBufferUsage = { MAP_READ: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8, STORAGE: 16, INDEX: 32, VERTEX: 64 };
globalThis.GPUMapMode = { READ: 1 };
globalThis.GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };

/* --------------------------------------------------------------- checks -- */
const failures = [];
const notes = [];
const check = (name, fn) => {
  try {
    const result = fn();
    if (result === false) failures.push(`${name}: returned false`);
    else notes.push(`✓ ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}\n    ${String(error.stack).split('\n')[1]?.trim() ?? ''}`);
  }
};
const expect = (condition, message) => { if (!condition) throw new Error(message); };

/* ---------------------------------------------------------------- mock -- */
function mockGpu() {
  const device = {
    queue: {
      submit() {},
      writeBuffer() {},
      writeTexture() {},
      onSubmittedWorkDone: async () => {},
    },
    createBuffer: (desc) => ({
      label: desc.label,
      size: desc.size,
      destroy() {},
      async mapAsync() {},
      getMappedRange: () => new ArrayBuffer(desc.size),
      unmap() {},
    }),
    createCommandEncoder: () => ({ copyTextureToBuffer() {}, copyTextureToTexture() {}, finish: () => ({}) }),
    createTexture: (desc) => ({ label: desc.label, createView: () => ({}), destroy() {} }),
  };
  return {
    device,
    info: { device: 'mock', vendor: 'mock', maxTexture: 8192, hasFloat32Filterable: true },
    counters: { dispatches: 0, draws: 0, generates: 0, lastGenerateMs: 0 },
    samplers: {},
    field: () => ({}),
    release() {},
    clearCaches() {},
    memoryReport: () => ({ liveBytes: 0, peakBytes: 0, megabytes: 0, peakMegabytes: 0, liveFields: 0 }),
  };
}

const field = (label, width, height, format = 'rgba8unorm') => ({
  label, width, height, format, srgb: format === 'rgba8unorm',
  texture: { label },
  view: () => ({}),
  binding: () => ({}),
});

/* ---------------------------------------------------------------- start -- */
const { Editor } = await import('../src/ui/state.js');
const { createStackPanel } = await import('../src/ui/stack.js');
const { createInspector } = await import('../src/ui/inspector.js');
const { readField, drawPreview, exportTexture, drawProfile } = await import('../src/ui/preview.js');
const { createProject, applyPreset, PRESETS, serializeProject, normalizeProject, validateProject } = await import('../src/gen/project.js');
const { MATERIAL_TYPES, TERRAIN_TYPES, EROSION_TYPES } = await import('../src/gen/schema.js');

const gpu = mockGpu();
const project = createProject();
const editor = new Editor(project);

let pendingGenerate = 0;
let pendingBake = 0;
const app = {
  refs: null,
  gpu,
  graph: { fields: { height: field('height', 256, 256, 'r32float') }, runDownsample() {}, passes: { downsample: {} }, commitStroke() {} },
  baker: { maps: { albedo: field('albedo', 64, 64), orm: field('orm', 64, 64), normal: field('normal', 64, 64), splat0: field('splat0', 64, 64), splat1: field('splat1', 64, 64) } },
  camera: { fov: 0.7, position: [0, 100, 100], matrices: () => ({ viewProj: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) }) },
  presets: PRESETS,
  regenerate: (kind) => { if (kind === 'texture') pendingBake++; else pendingGenerate++; },
  scheduleRegenerate: () => {},
  requestRender() {},
  exportMap() {},
  refreshProfile() {},
};

const refs = {
  tabs: new Element('div'), search: new Element('input'), scroll: new Element('div'),
  head: new Element('div'), body: new Element('div'),
};
app.refs = refs;

let stack;
let inspector;
check('stack panel builds', () => {
  stack = createStackPanel(editor, { tabs: refs.tabs, search: refs.search, scroll: refs.scroll });
  expect(refs.scroll.children.length > 0, 'no rail content');
  expect(refs.tabs.children.length === 2, 'expected two stack tabs');
  return true;
});

check('inspector builds', () => {
  inspector = createInspector(editor, app);
  expect(refs.body.children.length > 0, 'inspector body empty');
  return true;
});

check('every terrain layer selects and renders', () => {
  for (const layer of project.terrain) {
    editor.selectLayer(layer.id);
    expect(refs.head.children.length > 0, `no inspector head for ${layer.name}`);
  }
  return true;
});

check('every material layer selects and renders', () => {
  editor.setTab('texture');
  stack?.render();
  for (const layer of project.materials) {
    editor.selectLayer(layer.id);
    expect(refs.body.children.length > 0, `no inspector body for ${layer.name}`);
  }
  return true;
});

check('scene panels render', () => {
  for (const kind of ['world', 'lighting', 'display', 'bake']) {
    editor.select({ kind, id: null });
    expect(refs.body.children.length > 0, `panel ${kind} rendered nothing`);
  }
  return true;
});

check('layer mutations hold together', () => {
  editor.setTab('terrain');
  const length = () => editor.project.terrain.length;
  const before = length();
  const added = editor.addLayer('plateau');
  expect(length() === before + 1, 'addLayer did not insert');
  expect(added.type === 'plateau', 'wrong type');
  expect(editor.project.terrain.includes(added), 'inserted layer is not in the project');
  editor.duplicateLayer(added.id);
  expect(length() === before + 2, 'duplicate did not insert');
  editor.moveLayer(added.id, { toIndex: 0 });
  expect(editor.project.terrain[0].id === added.id, 'moveLayer did not move');
  const sims = editor.project.terrain.filter((l) => l.kind === 'sim').length;
  editor.addErosionLayer('hydraulic');
  expect(editor.project.terrain.filter((l) => l.kind === 'sim').length === sims + 1, 'erosion layer missing');
  editor.moveLayer(added.id, { toIndex: length() - 1 });
  editor.removeLayer(added.id);
  expect(length() === before + 2, `removeLayer left ${length()} layers`);
  expect(editor.project.terrain.every((l) => l.id !== added.id), 'removed layer still present');
  const problems = validateProject(editor.project);
  expect(problems.length === 0, `validateProject: ${problems.join(', ')}`);
  // leave the project as we found it
  for (const layer of [...editor.project.terrain]) {
    if (layer.id !== added.id && !project.terrain.some((l) => l.id === layer.id) && layer.type === 'hydraulic') editor.removeLayer(layer.id);
  }
  const copy = editor.project.terrain.find((l) => l.name?.endsWith('copy'));
  if (copy) editor.removeLayer(copy.id);
  return true;
});

check('every generator and material type can be added and rendered', () => {
  for (const type of TERRAIN_TYPES) {
    const layer = editor.addLayer(type.id);
    editor.selectLayer(layer.id);
    expect(refs.body.children.length > 0, `no controls for ${type.id}`);
    editor.removeLayer(layer.id);
  }
  editor.setTab('texture');
  for (const type of MATERIAL_TYPES) {
    const layer = editor.addLayer(type.id, { material: true });
    editor.selectLayer(layer.id);
    expect(refs.body.children.length > 0, `no controls for ${type.id}`);
    editor.removeLayer(layer.id);
  }
  for (const type of EROSION_TYPES) {
    const layer = editor.addErosionLayer(type.id);
    editor.selectLayer(layer.id);
    expect(refs.body.children.length > 0, `no controls for ${type.id}`);
    editor.removeLayer(layer.id);
  }
  return true;
});

check('masks can be added, tuned and removed', () => {
  editor.setTab('terrain');
  const layer = project.terrain[0];
  editor.selectLayer(layer.id);
  for (let i = 0; i < 4; i++) editor.addMask(layer.id, 1 + (i % 3));
  expect(layer.masks.length === 4, 'masks were not added');
  editor.addMask(layer.id, 2);
  expect(layer.masks.length === 4, 'the mask cap was not enforced');
  editor.selectLayer(layer.id);
  expect(refs.body.find((n) => n.className?.includes('mask-card')).length >= 4, 'mask cards were not rendered');
  editor.removeMask(layer.id, 0);
  expect(layer.masks.length === 3, 'mask was not removed');
  editor.selectLayer(layer.id);
  return true;
});

check('layer enable/disable and rename', () => {
  const layer = project.terrain[0];
  editor.setEnabled(layer.id, false);
  expect(layer.enabled === false, 'disable failed');
  editor.setEnabled(layer.id, true);
  editor.renameLayer(layer.id, 'Renamed');
  expect(layer.name === 'Renamed', 'rename failed');
  editor.renameLayer(layer.id, '   ');
  expect(layer.name === 'Renamed', 'blank rename should be ignored');
  return true;
});

check('undo and redo restore the stack', () => {
  const before = editor.project.terrain.length;
  editor.addLayer('hills');
  expect(editor.project.terrain.length === before + 1, 'layer not added');
  editor.undo();
  expect(editor.project.terrain.length === before, 'undo did not restore length');
  editor.redo();
  expect(editor.project.terrain.length === before + 1, 'redo did not re-apply');
  editor.undo();
  expect(editor.project.terrain.length === before, 'second undo failed');
  return true;
});

check('search filters the rail', () => {
  const rowsIn = () => refs.scroll.find((n) => String(n.className || '').split(' ').includes('row')).length;
  const all = rowsIn();
  refs.search.value = 'canyon';
  refs.search.fire('input');
  const filtered = rowsIn();
  expect(filtered < all, `search did not filter (${filtered} of ${all} rows)`);
  refs.search.value = 'zzz-no-such-layer';
  refs.search.fire('input');
  expect(rowsIn() <= filtered, 'search did not narrow to nothing');
  refs.search.value = '';
  refs.search.fire('input');
  expect(rowsIn() === all, 'clearing the search did not restore the list');
  return true;
});

check('presets load, serialise and validate', () => {
  for (const preset of PRESETS) {
    const next = applyPreset(preset);
    const problems = validateProject(next);
    expect(problems.length === 0, `${preset.name}: ${problems.join(', ')}`);
    const round = normalizeProject(JSON.parse(serializeProject(next)));
    expect(round.terrain.length === next.terrain.length, `${preset.name}: serialise round-trip changed the stack`);
    expect(round.materials.length === next.materials.length, `${preset.name}: serialise round-trip changed the materials`);
  }
  return true;
});

check('previews and export read from the GPU', async () => {
  const image = await readField(gpu, field('height', 32, 32, 'r32float'));
  expect(image.scalar.length === 32 * 32, 'scalar readback wrong size');
  const canvas = new Element('canvas');
  canvas.clientWidth = 64;
  canvas.clientHeight = 48;
  drawPreview(canvas, image, { tone: 'height' });
  drawProfile(new Element('canvas'), image);
  const { blob, filename } = await exportTexture(gpu, field('albedo', 16, 16), 'test-albedo.png');
  expect(blob instanceof Blob, 'export did not return a blob');
  expect(filename.endsWith('.png'), 'export filename wrong');
  return true;
});

check('map previews populate after a bake event', async () => {
  editor.select({ kind: 'bake', id: null });
  editor.emit('baked');
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(inspector.previewCanvases.size === 5, `expected 5 preview canvases, got ${inspector.previewCanvases.size}`);
  return true;
});

/* -------------------------------------------------------------- report -- */
await new Promise((resolve) => setTimeout(resolve, 50));

console.log('Frontier Terrain Forge — UI smoke test');
for (const note of notes) console.log('  ' + note);
if (failures.length) {
  console.log(`\n${failures.length} problem(s):\n`);
  for (const failure of failures) console.log(`  ✗ ${failure}\n`);
  process.exit(1);
}
console.log(`\n✓ panels clean · ${TERRAIN_TYPES.length} generators · ${MATERIAL_TYPES.length} materials · ${EROSION_TYPES.length} simulations · ${PRESETS.length} presets`);
