// =================================================================================================
//  app.js — the engine host
// -------------------------------------------------------------------------------------------------
//  Owns the GPU device, the solver, the renderer and the camera, and decides what has to be
//  recomputed when the editor state changes.
//
//  Rebuilds are debounced rather than immediate. A terrain stack is a recipe, not a frame: dragging
//  a rainfall slider should not start four hundred solver passes per mouse move. Texture layers and
//  the atmosphere cost nothing to update, so those are pushed straight through.
// =================================================================================================

import { TerrainSolver } from './solver.js';
import { Renderer, MAX_TEX_LAYERS } from './renderer.js';
import { OrbitCamera } from './camera.js';
import { ATMO_DEFAULTS } from './atmosphere.js';
import { TERRAIN_OPS } from './terrain-schema.js';

export async function createDevice(onError = () => {}) {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available in this browser. Try Chrome 113+, Edge 113+ or Safari 18.');
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter could be created on this machine.');
  // Ask for the headroom a 4K heightfield needs, clamped to what the adapter can actually give.
  // Without this the erosion flux buffer is capped at the default 128 MiB and 4K is unreachable
  // even on hardware that could do it.
  const want = {
    maxBufferSize: 1 << 30,
    maxStorageBufferBindingSize: 1 << 29,
  };
  const requiredLimits = {};
  for (const [k, v] of Object.entries(want)) {
    const have = adapter.limits?.[k];
    if (have !== undefined) requiredLimits[k] = Math.min(v, have);
  }
  const device = await adapter.requestDevice({ label: 'frontier-terrain', requiredLimits });
  device.lost?.then((info) => {
    onError(`GPU device lost: ${info.reason || 'unknown reason'}. Reload to continue.`);
  });
  device.addEventListener?.('uncapturederror', (e) => {
    const message = e.error?.message ?? String(e);
    console.error('[frontier] WebGPU error:', message);
    // Surfaced rather than swallowed: a validation error otherwise looks exactly like a bug in
    // the tone mapping — a black screen with no explanation.
    onError(message);
  });
  return { adapter, device };
}

const RECIPE_KEYS = ['enabled', 'kind', 'opacity', 'blend', 'maskMode', 'maskMin', 'maskMax',
  'maskFeather', 'maskContrast', 'maskNoiseScale', 'maskNoiseSeed', 'maskInvert'];

function stackRecipe(layers) {
  return layers
    .map((l) => [
      ...RECIPE_KEYS.map((k) => String(l[k])),
      Object.entries(l.params ?? {}).map(([k, v]) => `${k}:${v}`).join(','),
    ].join('|'))
    .join('//');
}

export class TerrainApp {
  constructor(device, canvas) {
    this.device = device;
    this.canvas = canvas;
    this.solver = new TerrainSolver(device);
    this.state = null;
    // The renderer reads a flat view: terrain metrics, texture globals, atmosphere, post and the
    // water block all live at the top level so the shader-side structs stay simple.
    this.view = null;
    this.time = 0;
    this.autoBuild = true;
    this._rebuildTimer = null;
    this._recipe = '';
    this.onBuildState = () => {};
    this.camera = new OrbitCamera();
    this.solver.configure({ res: 1024, extent: 4000, heightMeters: 1200 });
    this.renderer = new Renderer(device, canvas, this.solver);
    this.renderer.setMeshRes(1024);
    this._pendingTex = true;
    this._pendingAtmo = true;
  }

  get maxRes() {
    return TerrainSolver.maxResFor(this.device);
  }

  attachControls(element) {
    this.camera.attach(element);
  }

  setState(state) {
    const prev = this.state;
    this.state = state;
    this.view = {
      ...state.terrain,
      ...state.tex,
      ...state.atmo,
      ...state.render,
      water: state.water,
      stack: state.stack,
      textures: state.textures,
    };

    if (!prev || prev.render.renderScale !== state.render.renderScale) {
      this.renderer.renderScale = state.render.renderScale;
      // The internal resolution changed, so everything sized from it has to be rebuilt.
      if (this._css) this.resize(this._css.w, this._css.h);
    }
    this.renderer.debugView = state.render.debugView;
    this.renderer.wireframe = state.render.wireframe;
    this.renderer.atmoQuality = state.render.atmoQuality ?? 10;
    this.renderer.shadowStrength = state.render.shadowStrength;

    const structural =
      !prev ||
      prev.terrain.res !== state.terrain.res ||
      prev.terrain.extent !== state.terrain.extent ||
      prev.terrain.heightMeters !== state.terrain.heightMeters;

    if (structural) {
      this.solver.configure(state.terrain);
      this.renderer.rebuildSceneBind();
      this.renderer.setMeshRes(Math.min(state.terrain.meshRes ?? 1024, state.terrain.res));
      this.camera.frame(state.terrain.extent, state.terrain.heightMeters);
      this._recipe = '';
    } else if (prev && prev.terrain.meshRes !== state.terrain.meshRes) {
      this.renderer.setMeshRes(Math.min(state.terrain.meshRes, state.terrain.res));
    }

    const recipe = stackRecipe(state.stack);
    if (recipe !== this._recipe) {
      this._recipe = recipe;
      this.scheduleRebuild(prev ? 220 : 0);
    }

    if (!prev || prev.textures !== state.textures || this._pendingTex) {
      this.renderer.updateTextureLayers(state.textures);
      this._pendingTex = false;
    }

    if (!prev || prev.atmo !== state.atmo || this._pendingAtmo) {
      this.renderer.updateAtmosphere(state.atmo);
      this._pendingAtmo = false;
    }
  }

  scheduleRebuild(delay = 220) {
    if (!this.autoBuild) return;
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => this.rebuildNow(), delay);
  }

  rebuildNow() {
    clearTimeout(this._rebuildTimer);
    if (!this.state) return;
    this.solver.startBuild(this.state.stack);
    this.onBuildState(true, 0);
  }

  cancelBuild() {
    clearTimeout(this._rebuildTimer);
    this.solver.busy = false;
    this.solver.progress = 1;
    this.onBuildState(false, 1);
  }

  resize(width, height) {
    this._css = { w: width, h: height };
    this.canvas.width = Math.max(2, Math.floor(width * this.renderer.renderScale));
    this.canvas.height = Math.max(2, Math.floor(height * this.renderer.renderScale));
    this.camera.aspect = this.canvas.width / this.canvas.height;
    this.renderer.resize(width, height);
  }

  frame(dt) {
    this.time += dt;
    if (this.solver.busy) {
      const still = this.solver.tick(9);
      this.onBuildState(still, this.solver.progress, this.solver.activeLayerId);
      if (!still) this.onBuildState(false, 1, null);
    }
    this.camera.update(dt);
    if (this.view) this.renderer.render(this.camera, this.view, this.time);
  }

  // --- derived readouts for the UI ----------------------------------------------------------------

  statSummary() {
    const s = this.state;
    if (!s) return null;
    const layers = s.stack.filter((l) => l.enabled && TERRAIN_OPS[l.kind]);
    const eroders = layers.filter((l) => l.kind === 'erosion');
    return {
      terrainLayers: layers.length,
      textureLayers: Math.min(s.textures.length, MAX_TEX_LAYERS),
      passes: eroders.reduce((n, l) => n + (l.params.iterations | 0), 0),
      vertices: (this.renderer.meshRes ?? 0) ** 2,
      triangles: Math.round(((this.renderer.meshRes ?? 0) - 1) ** 2 * 2),
    };
  }
}

export { ATMO_DEFAULTS };
