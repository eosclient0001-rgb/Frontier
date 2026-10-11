/**
 * Frontier Terrain Forge — application entry point.
 *
 * Wires the engine (GPU services, terrain graph, texture baker, renderer) to the
 * editor UI (layer stack, inspector, viewport). The scheduling is deliberately
 * simple and explicit:
 *
 *   terrain stack changes → generate() → bake() → render()
 *   material stack changes → bake() → render()
 *   brush strokes         → sculpt/paint dabs → commit → bake() → render()
 *
 * Only the stages whose inputs actually changed are re-run, and the viewport
 * keeps drawing while they do, so the interface never blocks on a generation.
 */
import { createGpu } from './gpu/gpu.js';
import { GpuUnavailableError } from './gpu/device.js';
import { Renderer } from './gpu/renderer.js';
import { TerrainGraph } from './sim/terrain.js';
import { TextureBaker } from './tex/bake.js';
import { Camera } from './core/camera.js';
import { createProject, applyPreset, PRESETS, serializeProject, normalizeProject } from './gen/project.js';
import { VIEW_MODES } from './gen/schema.js';
import { Editor } from './ui/state.js';
import { createStackPanel } from './ui/stack.js';
import { createInspector } from './ui/inspector.js';
import { createViewport } from './ui/viewport.js';
import { el, clear, icon, download } from './ui/dom.js';
import { openMenu } from './ui/menu.js';
import { readScalarPreview, drawProfile, exportTexture } from './ui/preview.js';

const refs = {};
/** Aliases the panels ask for by shorter names. */
for (const id of [
  'app', 'rail', 'rail-tabs', 'layer-search', 'rail-scroll', 'project-card', 'project-name', 'project-meta',
  'viewport', 'viewport-canvas', 'display-toggles', 'brush-bar', 'banner', 'banner-title', 'banner-body',
  'status', 'status-dot', 'status-text', 'brand-tile', 'preset-label', 'doc-title', 'preset-button',
  'reset-button', 'view-modes', 'stat-relief', 'stat-memory', 'stat-fps', 'generate',
  'inspector', 'inspector-head', 'inspector-body', 'log', 'log-close', 'log-body',
]) {
  refs[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id);
}

// Aliases: the panels ask for their own containers by short names.
refs.canvas = refs.viewportCanvas;
refs.tools = refs.displayToggles;
refs.head = refs.inspectorHead;
refs.body = refs.inspectorBody;

// Fail loudly rather than half-booting if the markup and the script drift apart.
const MISSING = Object.entries(refs).filter(([, node]) => !node).map(([key]) => key);
if (MISSING.length) throw new Error(`index.html is missing element(s) for: ${MISSING.join(', ')}`);

const logLines = [];
function pushLog(level, message) {
  logLines.push({ level, message, time: new Date() });
  if (logLines.length > 300) logLines.shift();
  if (!refs.logBody) return;
  const line = el('div', { class: `log-line ${level}`, text: `${new Date().toLocaleTimeString()}  ${message}` });
  refs.logBody.append(line);
  refs.logBody.scrollTop = refs.logBody.scrollHeight;
  refs.log.hidden = false;
}

function showBanner(title, body) {
  refs.banner.hidden = false;
  refs.bannerTitle.textContent = title;
  refs.bannerBody.innerHTML = body;
}

/* ------------------------------------------------------------------ boot -- */
let gpu;
try {
  gpu = await createGpu({ log: ({ level, message }) => pushLog(level || 'info', message) });
} catch (error) {
  const detail = error instanceof GpuUnavailableError && error.detail ? `<br><br>${error.detail}` : '';
  showBanner(error.message || 'WebGPU could not be initialised.', `${detail}<br><br>The terrain engine needs a WebGPU device: Chrome/Edge 113+, Safari 18+ or Firefox 141+.`);
  pushLog('error', error.message || String(error));
  refs.statusText.textContent = 'no WebGPU device';
  refs.statusDot.className = 'status-dot bad';
  throw error;
}

const project = createProject();
const editor = new Editor(project);
editor.gpuInfo = gpu.info;

const graph = new TerrainGraph(gpu, { log: (message) => pushLog('dim', message) });
const baker = new TextureBaker(gpu, { log: (message) => pushLog('dim', message) });
const renderer = new Renderer(gpu, { log: (message) => pushLog('info', message) });
await renderer.init(refs.viewportCanvas);

const camera = new Camera({ worldSize: project.world.worldSize, heightScale: project.world.heightScale });
camera.mode = project.display.cameraMode || 'perspective';
camera.frame(project.world);

/* ------------------------------------------------------------ scheduling -- */
const app = {
  refs,
  gpu,
  graph,
  baker,
  renderer,
  camera,
  editor,
  presets: PRESETS,
  needsRender: true,
  pendingBake: false,
  busy: null,
  time: 0,
  lastFrameMs: 16,
  dragging: false,
  requestRender() { app.needsRender = true; },
  markMapsDirty() { app.pendingBake = true; },
  setResolution() { /* the resize path is driven by the viewport */ },
  updateCameraRange() { camera.far = Math.max(camera.distance * 8, project.world.worldSize * 6); },
};

async function generate() {
  if (app.busy === 'generate') return;
  app.busy = 'generate';
  const started = performance.now();
  refs.generate.classList.add('busy');
  refs.generate.textContent = 'Generating…';
  viewport.setStatus('generating terrain…', 'busy');
  try {
    await graph.generate(project, {
      onStage: (stage, index, total) => {
        if (index % 4 === 0) viewport.setStatus(`generating · ${stage.op} ${index + 1}/${total}`, 'busy');
      },
    });
    editor.maps = graph.maps;
    editor.generateStats = { ms: performance.now() - started, dispatches: gpu.counters.dispatches };
    editor.memory = gpu.memoryReport();
    renderer.setMaps(graph.maps, baker.maps);
    editor.dirty.terrain = false;
    editor.emit('generated');
    editor.stats = await graph.stats();
    editor.emit('stats');
    viewport.setStatus(`terrain ready · ${Math.round(editor.generateStats.ms)} ms · ${gpu.counters.dispatches.toLocaleString()} dispatches`, 'ok');
  } catch (error) {
    viewport.setStatus(`generation failed: ${error.message}`, 'bad');
    pushLog('error', `generation failed: ${error.message}`);
    console.error(error);
  } finally {
    app.busy = null;
    refs.generate.classList.remove('busy');
    refs.generate.textContent = 'Generate';
    refreshHud();
  }
  if (editor.dirty.texture) await bake();
  app.requestRender();
}

async function bake() {
  if (app.busy === 'bake' || !graph.maps) return;
  app.busy = 'bake';
  app.pendingBake = false;
  const started = performance.now();
  viewport.setStatus('baking materials…', 'busy');
  try {
    await baker.bake(project, graph.maps, {
      onStage: (stage, index, total) => viewport.setStatus(`baking · ${stage} ${index + 1}/${total}`, 'busy'),
    });
    renderer.setMaps(graph.maps, baker.maps);
    editor.bakeStats = { ...baker.lastStats, ms: performance.now() - started };
    editor.memory = gpu.memoryReport();
    editor.dirty.texture = false;
    editor.emit('baked');
    viewport.setStatus(`materials baked · ${Math.round(editor.bakeStats.ms)} ms · ${editor.bakeStats.layers} layers`, 'ok');
  } catch (error) {
    viewport.setStatus(`bake failed: ${error.message}`, 'bad');
    pushLog('error', `bake failed: ${error.message}`);
    console.error(error);
  } finally {
    app.busy = null;
    refreshHud();
  }
  app.requestRender();
}

let regenTimer = 0;
const scheduleRegenerate = (kind) => {
  clearTimeout(regenTimer);
  regenTimer = setTimeout(() => {
    if (kind === 'texture') { if (!app.busy) bake(); }
    else if (!app.busy) generate();
  }, 160);
};

app.regenerate = (kind) => (kind === 'texture' ? bake() : generate());
app.scheduleRegenerate = scheduleRegenerate;
app.scheduleRegen = () => scheduleRegenerate('terrain');
app.scheduleBake = () => scheduleRegenerate('texture');
app.generate = generate;
app.bake = bake;

app.frameCamera = () => {
  camera.frame(project.world);
  app.requestRender();
};

app.loadPreset = (preset) => {
  const next = applyPreset(preset);
  editor.replaceProject(next);
  camera.frame(next.world);
  editor.select({ kind: 'layer', id: next.terrain[0]?.id ?? null });
  generate();
};

app.setCameraMode = (mode) => { camera.mode = mode; app.requestRender(); };

app.exportMap = async (key) => {
  const field = baker.maps?.[key] || graph.maps?.[key];
  if (!field) {
    pushLog('warn', `nothing to export for “${key}” yet — generate and bake first`);
    return;
  }
  try {
    const { blob, filename } = await exportTexture(gpu, field, `${project.name.replace(/\s+/g, '-').toLowerCase()}-${key}.png`);
    download(blob, filename);
    pushLog('info', `exported ${filename}`);
  } catch (error) {
    pushLog('error', `export failed: ${error.message}`);
  }
};

let fpsAccum = 0;
let fpsFrames = 0;
app.onFrame = (ms) => {
  fpsAccum += ms;
  fpsFrames++;
  if (fpsFrames >= 20) {
    const average = fpsAccum / fpsFrames;
    refs.statFps.textContent = average > 0.01 ? `${(1000 / average).toFixed(0)} fps` : '—';
    fpsAccum = 0;
    fpsFrames = 0;
  }
};

app.refreshProfile = async (canvas) => {
  if (!graph.fields) return;
  try {
    const image = await readScalarPreview(gpu, graph, graph.fields.height, 512);
    if (image) drawProfile(canvas, image);
  } catch (error) { /* profiles are best-effort */ }
};

/** Called once per rendered frame: flushes pending bakes, never blocks. */
app.tick = () => {
  if (app.pendingBake && !app.busy) {
    const now = performance.now();
    if (now - (app.lastBakeAt || 0) > 140) {
      app.lastBakeAt = now;
      bake();
    }
  }
};

/* ------------------------------------------------------------------- UI -- */
const viewport = createViewport(editor, app);
createStackPanel(editor, { tabs: refs.railTabs, search: refs.layerSearch, scroll: refs.railScroll });
createInspector(editor, { refs, ...app });

/* top bar ---------------------------------------------------------------- */
function refreshHud() {
  const stats = editor.stats;
  refs.statRelief.textContent = stats ? `${Math.round(stats.relief).toLocaleString()} m` : '—';
  const memory = editor.memory || gpu.memoryReport();
  refs.statMemory.textContent = `${memory.megabytes.toFixed(0)} MB`;
  refs.docTitle.textContent = project.name;
  refs.presetLabel.textContent = `${project.world.resolution}² FIELD · ${(project.world.worldSize / 1000).toFixed(1)} KM`;
  refs.projectName.value = project.name;
  refs.projectMeta.textContent = `${project.terrain.length} terrain · ${project.materials.length} materials · ${gpu.info.device || gpu.info.vendor}`;
}

function renderViewModes() {
  clear(refs.viewModes);
  for (const mode of VIEW_MODES) {
    refs.viewModes.append(el('button', {
      class: `pill${project.display.viewMode === mode.id ? ' on' : ''}`,
      text: mode.short,
      onclick: () => {
        project.display.viewMode = mode.id;
        editor.emit('change', {});
        renderViewModes();
        app.requestRender();
      },
    }));
  }
}

refs.generate.addEventListener('click', () => generate());
refs.resetButton.addEventListener('click', () => app.frameCamera());
refs.presetButton.addEventListener('click', (event) => {
  const rect = event.currentTarget.getBoundingClientRect();
  openMenu({ x: rect.left, y: rect.bottom + 6 }, {
    title: 'Presets',
    items: PRESETS.map((preset) => ({ label: preset.name, hint: '', icon: 'sparkle', title: preset.description, onClick: () => app.loadPreset(preset) })),
  });
});
refs.projectName.addEventListener('change', () => {
  project.name = refs.projectName.value.trim() || 'Untitled terrain';
  editor.emit('change', {});
  refreshHud();
});
refs.logClose.addEventListener('click', () => { refs.log.hidden = true; });

/* stack panel footer actions -------------------------------------------- */
refs.projectCard.addEventListener('click', (event) => {
  if (event.target.closest('input')) return;
  const rect = refs.projectCard.getBoundingClientRect();
  openMenu({ x: rect.left + 8, y: rect.top - 8 }, {
    title: project.name,
    items: [
      { label: 'Frame terrain', icon: 'camera', onClick: () => app.frameCamera() },
      { label: 'Randomise world seed', icon: 'sparkle', onClick: () => { project.seed = Math.floor(Math.random() * 99999); editor.emit('change', { terrain: true }); generate(); } },
      { label: 'Save project (.json)', icon: 'download', dividerBefore: true, onClick: () => {
        download(new Blob([serializeProject(project)], { type: 'application/json' }), `${project.name.replace(/\s+/g, '-').toLowerCase()}.frontier.json`);
      } },
      { label: 'Export height map', icon: 'download', onClick: () => app.exportMap('height') },
      { label: 'Export baked albedo', icon: 'download', onClick: () => app.exportMap('albedo') },
      { label: 'Console', icon: 'grid', dividerBefore: true, onClick: () => { refs.log.hidden = !refs.log.hidden; } },
    ],
  });
});

/* keyboard -------------------------------------------------------------- */
window.addEventListener('keydown', (event) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
  if (typing) return;
  if (event.key === 'g' || event.key === 'G') { generate(); }
  else if (event.key === 'f' || event.key === 'F') app.frameCamera();
  else if (event.key >= '1' && event.key <= '8') {
    project.display.viewMode = Number(event.key) - 1;
    renderViewModes();
    app.requestRender();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey ? editor.redo() : editor.undo()) generate();
  } else if (event.key === 'Escape') {
    editor.brushEnabled = false;
    viewport.renderBrushBar();
  } else if (event.key === '[' || event.key === ']') {
    const radius = Math.min(0.4, Math.max(0.005, project.brush.radius * (event.key === '[' ? 0.85 : 1.18)));
    editor.setBrush({ radius });
    viewport.renderBrushBar();
  }
});

editor.on('change', (payload) => {
  if (payload?.terrain) { editor.dirty.terrain = true; }
  refreshHud();
});
editor.on('selection', refreshHud);
editor.on('log', ({ level, message }) => pushLog(level, message));

renderViewModes();
refreshHud();
pushLog('info', `device: ${gpu.info.device || gpu.info.vendor} · max texture ${gpu.info.maxTexture}² · ${gpu.info.hasFloat32Filterable ? 'float32 filter' : 'no float32 filter'}`);

/* first generation ------------------------------------------------------- */
viewport.setStatus('generating terrain…', 'busy');
await generate();
