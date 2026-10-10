/* ═══════════════════════════════════════════════════════════════
   Terrain Forge — bootstrap
   ═══════════════════════════════════════════════════════════════ */
import { createEngine } from './engine.js';
import { createUI } from './ui.js';
import {
  defaultEnv, createTerrainLayer, createTextureLayer, presetStack, presetTextureStack,
  serializeProject, deserializeProject,
} from './state.js';
import { $, debounce, downloadBlob } from './util.js';

const STORAGE_KEY = 'frontier-terrain-forge-project';

const state = {
  name: 'Untitled world',
  env: defaultEnv(),
  terrain: { layers: [] },
  texture: { layers: [] },
  view: { mode: 0, shadows: true },
};

function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const project = deserializeProject(JSON.parse(raw));
    Object.assign(state, project);
    return true;
  } catch (err) {
    console.warn('Could not restore saved project:', err.message);
    return false;
  }
}

function showError(err) {
  console.error(err);
  const box = $('#viewport-error');
  box.hidden = false;
  $('#viewport-error-message').textContent = err.message || String(err);
}

let ui = null;

async function main() {
  const restored = restore();
  if (!state.terrain.layers.length) {
    state.terrain.layers = presetStack('alpine');
    state.texture.layers = presetTextureStack('alpine');
  }

  let engine = null;
  try {
    engine = await createEngine($('#gpu-canvas'), state);
  } catch (err) {
    showError(err);
    mountUI(null);
    return;
  }

  mountUI(engine);
  await hooks.regenerate(true);

  // render loop
  function frame() {
    if (engine.ready) engine.renderFrame(state.view.mode, state.view.shadows);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

let hooks = null;

function mountUI(engine) {
  hooks = {
    refs: { createTerrainLayer, createTextureLayer },
    regenerate: async (force) => {
      if (!engine) return;
      if (engine.busy && !force) return;
      ui.setProgress(0, 'Evaluating layers…');
      try {
        await engine.regenerate((f, label) => ui.setProgress(f, label));
      } catch (err) {
        console.error('Generation failed:', err);
      }
      ui.setProgress(1);
      ui.refreshSplatPreview();
      scheduleSave();
    },
    rebakeTexture: () => {
      engine?.bakeSplat();
    },
    envChanged: () => {
      markSaved(false);
      scheduleSave();
    },
    resolutionChanged: async () => {
      if (!engine) return;
      engine.allocateTextures(state.env.terrain.resolution);
      engine.resetCamera();
      await hooks.regenerate(true);
    },
    applyPreset: async (id) => {
      state.terrain.layers = presetStack(id);
      state.texture.layers = presetTextureStack(id);
      state.name = { alpine: 'Alpine ridge', canyon: 'Desert canyon', volcanic: 'Volcanic isle', dunes: 'Highland dunes', glacial: 'Glacial spires', plains: 'Rolling plains' }[id] || 'Untitled world';
      $('#scene-name').textContent = state.name;
      ui.renderAll();
      await hooks.regenerate(true);
    },
    exportKind: async (kind) => {
      if (!engine) return;
      if (kind === 'height') await engine.exportHeight16();
      if (kind === 'splat') await engine.exportSplat();
      if (kind === 'screenshot') await engine.screenshot();
    },
    saveProject: () => saveProject(false),
    loadProject: () => $('#project-file').click(),
    markSaved,
  };
  ui = createUI({ state, engine, hooks });
  window.__forge = { state, engine, ui, hooks };

  $('#project-file').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const project = deserializeProject(await file.text());
      Object.assign(state, project);
      $('#scene-name').textContent = state.name;
      engine.allocateTextures(state.env.terrain.resolution);
      engine.resetCamera();
      ui.renderAll();
      await hooks.regenerate(true);
    } catch (err) {
      window.alert('Could not open project: ' + err.message);
    }
    e.target.value = '';
  });

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyR' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) engine?.resetCamera();
  });
}

/* ── persistence ── */
const scheduleSave = debounce(() => saveProject(true), 600);
function saveProject(silent) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeProject(state)));
    markSaved(true);
  } catch (err) {
    console.warn('Local save failed:', err.message);
    markSaved(false);
  }
  if (!silent) {
    downloadBlob(new Blob([JSON.stringify(serializeProject(state), null, 2)], { type: 'application/json' }), `${state.name || 'terrain'}.terrain`);
  }
}
function markSaved(saved) {
  const pill = $('#save-status');
  const label = $('#save-status-label');
  if (!pill) return;
  pill.classList.toggle('saved', saved);
  label.textContent = saved ? 'All changes saved' : 'Save changes';
  $('#footer-status').textContent = saved ? 'Changes apply in real time' : 'Unsaved changes · autosave pending';
}

main();
