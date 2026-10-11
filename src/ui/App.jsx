import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { TerrainApp, createDevice } from '../engine/app.js';
import { ATMO_DEFAULTS } from '../engine/atmosphere.js';
import { makeLayer, TERRAIN_OPS } from '../engine/terrain-schema.js';
import { makeTexLayer } from '../engine/texture-schema.js';
import { PRESETS, defaultPreset } from '../engine/presets.js';

import Rail from './Rail.jsx';
import Viewport from './Viewport.jsx';
import LayerStackPanel from './LayerStackPanel.jsx';
import {
  TerrainLayerInspector, TextureLayerInspector, TerrainPanel, TexturePanel,
  SunPanel, WaterPanel, RenderPanel, PresetsPanel, ExportPanel,
} from './panels.jsx';
import { presetToState, deserialize } from './project.js';
import './theme.css';

const WATER_DEFAULTS = {
  enabled: false,
  roughness: 0.06,
  waveAmplitude: 0.035,
  waveScale: 6,
  waveSpeed: 0.6,
  choppiness: 0.5,
  absorption: '#1d4f52',
  scatter: '#2f6b6b',
  foam: 0.5,
  shoreWidth: 2.5,
  reflectivity: 0.85,
  absorptionStrength: 0.12,
  sparkle: 1,
  sunGlitter: 1,
  flowDirection: 40,
  refractionIndex: 1.333,
};

const RENDER_DEFAULTS = {
  renderScale: 1,
  debugView: 0,
  wireframe: false,
  atmoQuality: 10,
  shadowStrength: 1,
  exposure: 0.62,
  contrast: 1.04,
  saturation: 1.06,
  vignette: 0.28,
  grain: 0.12,
  bloom: 0.35,
  bloomThreshold: 1.1,
};

const TEX_DEFAULTS = {
  normalStrength: 1.0,
  aoStrength: 0.85,
  cavityStrength: 0.55,
  wetnessStrength: 0.9,
};

function initialState() {
  const preset = defaultPreset();
  const res = preset.terrain.res ?? 1024;
  return {
    terrain: {
      res,
      meshRes: res,
      extent: preset.terrain.extent,
      heightMeters: preset.terrain.heightMeters,
      waterLevel: preset.terrain.waterLevel ?? 0.08,
      aoDirs: 24,
      aoSteps: 24,
      aoRadius: 34,
    },
    stack: preset.stack,
    textures: preset.textures,
    tex: { ...TEX_DEFAULTS },
    water: { ...WATER_DEFAULTS, ...(preset.water ?? {}) },
    atmo: { ...ATMO_DEFAULTS, ...(preset.atmo ?? {}) },
    render: { ...RENDER_DEFAULTS },
  };
}

const HISTORY_LIMIT = 80;
const COALESCE_MS = 700;

export default function App() {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const appRef = useRef(null);

  const [state, setState] = useState(initialState);
  const stateRef = useRef(state);
  const [tab, setTab] = useState('terrain');
  const [object, setObject] = useState('terrain');
  const [sel, setSel] = useState({ terrain: null, texture: null });
  const [status, setStatus] = useState({ phase: 'booting' });
  const [build, setBuild] = useState({ busy: false, progress: 1, label: null, flash: false });
  const [fps, setFps] = useState(0);
  const [autoBuild, setAutoBuild] = useState(true);
  const [maxRes, setMaxRes] = useState(2048);
  const [message, setMessage] = useState(null);
  const [errors, setErrors] = useState([]);
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });

  const past = useRef([]);
  const future = useRef([]);
  const lastCommit = useRef(0);

  /* ---------------------------------------------------------------- change plumbing */

  const apply = useCallback((next, { coalesce = false } = {}) => {
    const prev = stateRef.current;
    const value = typeof next === 'function' ? next(prev) : next;
    if (value === prev) return;
    const now = Date.now();
    const canCoalesce = coalesce && now - lastCommit.current < COALESCE_MS && past.current.length > 0;
    if (!canCoalesce) {
      past.current.push(prev);
      if (past.current.length > HISTORY_LIMIT) past.current.shift();
      future.current.length = 0;
      setHistoryDepth({ undo: past.current.length, redo: 0 });
    }
    lastCommit.current = now;
    stateRef.current = value;
    setState(value);
  }, []);

  const undo = useCallback(() => {
    const p = past.current.pop();
    if (!p) return;
    future.current.push(stateRef.current);
    stateRef.current = p;
    setState(p);
    setHistoryDepth({ undo: past.current.length, redo: future.current.length });
  }, []);

  const redo = useCallback(() => {
    const n = future.current.pop();
    if (!n) return;
    past.current.push(stateRef.current);
    stateRef.current = n;
    setState(n);
    setHistoryDepth({ undo: past.current.length, redo: future.current.length });
  }, []);

  /* ---------------------------------------------------------------- engine boot */

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let fpsClock = last;

    (async () => {
      try {
        const { adapter, device } = await createDevice((m) =>
          setErrors((list) => (list.includes(m) ? list : [...list.slice(-2), m])));
        if (disposed) return;

        // Pipeline and bind-group creation is validated explicitly so a mistake reports a message
        // instead of silently producing nothing.
        device.pushErrorScope('validation');
        const app = new TerrainApp(device, canvasRef.current);
        const buildError = await device.popErrorScope();
        if (buildError) throw new Error(buildError.message);
        appRef.current = app;
        app.setState(stateRef.current);
        let flashTimer = 0;
        app.onBuildState = (busy, progress, layerId) => {
          const op = layerId ? TERRAIN_OPS[stateRef.current.stack.find((l) => l.id === layerId)?.kind] : null;
          setBuild((b) => {
            if (b.busy && !busy) {
              clearTimeout(flashTimer);
              flashTimer = setTimeout(() => setBuild((x) => ({ ...x, flash: false })), 1600);
            }
            return { busy, progress, label: op ? op.label : null, flash: b.busy && !busy ? true : b.flash };
          });
        };
        app.attachControls(canvasRef.current);
        setMaxRes(app.maxRes);
        if (stateRef.current.terrain.res > app.maxRes) {
          apply((s) => ({
            ...s,
            terrain: {
              ...s.terrain,
              res: app.maxRes,
              meshRes: Math.min(s.terrain.meshRes, app.maxRes),
            },
          }));
        }

        const stage = stageRef.current;
        const fit = () => {
          const r = stage.getBoundingClientRect();
          app.resize(r.width, r.height);
        };
        fit();
        const ro = new ResizeObserver(fit);
        ro.observe(stage);

        app.rebuildNow();

        const loop = (t) => {
          const dt = Math.min(0.05, (t - last) / 1000);
          last = t;
          app.frame(dt);
          frames += 1;
          if (t - fpsClock > 500) {
            setFps(Math.round((frames * 1000) / (t - fpsClock)));
            frames = 0;
            fpsClock = t;
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);

        const info = adapter.info ?? {};
        setStatus({
          phase: 'ready',
          gpu: {
            vendor: info.vendor || (info.description ? String(info.description).slice(0, 22) : 'GPU'),
            architecture: info.architecture || '',
          },
        });
      } catch (err) {
        console.error(err);
        setStatus({ phase: 'error', message: err?.message ?? String(err) });
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    appRef.current?.setState(state);
  }, [state]);

  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => setMessage(null), 3200);
    return () => clearTimeout(t);
  }, [message]);

  /* ---------------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace')) {
        const id = sel[tab];
        if (id) {
          e.preventDefault();
          removeLayer(tab, id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, tab, undo, redo]);

  /* ---------------------------------------------------------------- stack editing */

  const patchStack = useCallback((nextStack, coalesce) => {
    apply((s) => ({ ...s, stack: typeof nextStack === 'function' ? nextStack(s.stack) : nextStack }), { coalesce });
  }, [apply]);

  const patchTextures = useCallback((nextTextures, coalesce) => {
    apply((s) => ({ ...s, textures: typeof nextTextures === 'function' ? nextTextures(s.textures) : nextTextures }), { coalesce });
  }, [apply]);

  const updateTerrainLayer = useCallback((layer, coalesce = true) => {
    patchStack((stack) => stack.map((l) => (l.id === layer.id ? layer : l)), coalesce);
  }, [patchStack]);

  const updateTextureLayer = useCallback((layer, coalesce = true) => {
    patchTextures((textures) => textures.map((l) => (l.id === layer.id ? layer : l)), coalesce);
  }, [patchTextures]);

  const changeTerrainKind = useCallback((id, kind) => {
    patchStack((stack) => stack.map((l) => (l.id === id ? { ...makeLayer(kind), id: l.id, name: l.name, maskMode: l.maskMode, maskMin: l.maskMin, maskMax: l.maskMax, maskFeather: l.maskFeather, maskInvert: l.maskInvert } : l)));
  }, [patchStack]);

  const changeTextureKind = useCallback((id, kind) => {
    patchTextures((textures) => textures.map((l) => (l.id === id ? { ...makeTexLayer(kind), id: l.id, name: l.name, maskMode: l.maskMode, maskMin: l.maskMin, maskMax: l.maskMax, maskFeather: l.maskFeather, invert: l.invert } : l)));
  }, [patchTextures]);

  const removeLayer = useCallback((which, id) => {
    if (which === 'terrain') {
      patchStack((stack) => (stack.length > 1 ? stack.filter((l) => l.id !== id) : stack));
      setSel((s) => ({ ...s, terrain: null }));
    } else {
      patchTextures((textures) => (textures.length > 1 ? textures.filter((l) => l.id !== id) : textures));
      setSel((s) => ({ ...s, texture: null }));
    }
  }, [patchStack, patchTextures]);

  const duplicateLayer = useCallback(() => {
    const id = sel[tab];
    if (!id) return;
    if (tab === 'terrain') {
      patchStack((stack) => {
        const i = stack.findIndex((l) => l.id === id);
        if (i < 0) return stack;
        const copy = { ...stack[i], id: `${stack[i].id}c${Math.random().toString(36).slice(2, 5)}`, name: `${stack[i].name} copy`, params: { ...stack[i].params } };
        const next = stack.slice();
        next.splice(i + 1, 0, copy);
        return next;
      });
    } else {
      patchTextures((textures) => {
        const i = textures.findIndex((l) => l.id === id);
        if (i < 0) return textures;
        const copy = { ...textures[i], id: `${textures[i].id}c${Math.random().toString(36).slice(2, 5)}`, name: `${textures[i].name} copy` };
        const next = textures.slice();
        next.splice(i + 1, 0, copy);
        return next;
      });
    }
  }, [sel, tab, patchStack, patchTextures]);

  const addTerrain = useCallback((kind) => {
    const layer = makeLayer(kind);
    patchStack((stack) => [layer, ...stack]);
    setSel((s) => ({ ...s, terrain: layer.id }));
    setObject('terrain');
    setTab('terrain');
  }, [patchStack]);

  const addTexture = useCallback((kind) => {
    const layer = makeTexLayer(kind);
    patchTextures((textures) => [layer, ...textures]);
    setSel((s) => ({ ...s, texture: layer.id }));
    setObject('textures');
    setTab('texture');
  }, [patchTextures]);

  const selectTerrain = useCallback((id) => {
    setSel((s) => ({ ...s, terrain: id }));
    if (id) { setObject('terrain'); setTab('terrain'); }
  }, []);

  const selectTexture = useCallback((id) => {
    setSel((s) => ({ ...s, texture: id }));
    if (id) { setObject('textures'); setTab('texture'); }
  }, []);

  const applyPreset = useCallback((preset) => {
    apply((s) => presetToState(preset, s, maxRes));
    setSel({ terrain: null, texture: null });
    setObject('terrain');
    setTab('terrain');
  }, [apply, maxRes]);

  const loadProjectText = useCallback((text) => {
    const next = deserialize(text, stateRef.current);
    apply(next);
    setSel({ terrain: null, texture: null });
    return 'Project loaded.';
  }, [apply]);

  /* ---------------------------------------------------------------- derived */

  const stats = useMemo(() => {
    const meshRes = Math.min(state.terrain.meshRes, state.terrain.res);
    return {
      terrainLayers: state.stack.filter((l) => l.enabled && TERRAIN_OPS[l.kind]).length,
      textureLayers: state.textures.length,
      passes: state.stack.reduce((n, l) => n + (l.enabled && l.kind === 'erosion' ? (l.params.iterations | 0) : 0), 0),
      vertices: meshRes * meshRes,
      triangles: (meshRes - 1) ** 2 * 2,
    };
  }, [state]);

  /* ---------------------------------------------------------------- inspector body */

  const inspector = useMemo(() => {
    const tIndex = state.stack.findIndex((l) => l.id === sel.terrain);
    const xIndex = state.textures.findIndex((l) => l.id === sel.texture);

    if (object === 'terrain' && tIndex >= 0) {
      return (
        <TerrainLayerInspector
          layer={state.stack[tIndex]}
          index={tIndex}
          total={state.stack.length}
          onChange={(l) => updateTerrainLayer(l)}
          onKind={(kind) => changeTerrainKind(state.stack[tIndex].id, kind)}
          onDelete={() => removeLayer('terrain', state.stack[tIndex].id)}
          onDuplicate={duplicateLayer}
        />
      );
    }
    if (object === 'textures' && xIndex >= 0) {
      return (
        <TextureLayerInspector
          layer={state.textures[xIndex]}
          index={xIndex}
          total={state.textures.length}
          onChange={(l) => updateTextureLayer(l)}
          onKind={(kind) => changeTextureKind(state.textures[xIndex].id, kind)}
          onDelete={() => removeLayer('texture', state.textures[xIndex].id)}
          onDuplicate={duplicateLayer}
        />
      );
    }
    if (object === 'textures') {
      return <TexturePanel tex={state.tex} onChange={(tex) => apply((s) => ({ ...s, tex }))} />;
    }
    if (object === 'sun') return <SunPanel atmo={state.atmo} onChange={(atmo) => apply((s) => ({ ...s, atmo }))} />;
    if (object === 'water') {
      return (
        <WaterPanel
          water={state.water}
          waterLevel={state.terrain.waterLevel}
          onChangeWater={(water) => apply((s) => ({ ...s, water }))}
          onChangeLevel={(waterLevel) => apply((s) => ({ ...s, terrain: { ...s.terrain, waterLevel } }))}
        />
      );
    }
    if (object === 'render') {
      return <RenderPanel render={state.render} stats={stats} onChange={(render) => apply((s) => ({ ...s, render }))} />;
    }
    if (object === 'presets') return <PresetsPanel onApply={applyPreset} activeId={PRESETS.find((p) => p.stack === state.stack)?.id} />;
    if (object === 'export') {
      return (
        <ExportPanel
          app={appRef.current}
          terrain={state.terrain}
          onMessage={setMessage}
          onLoadProject={loadProjectText}
        />
      );
    }
    return (
      <TerrainPanel
        terrain={state.terrain}
        stats={stats}
        maxRes={maxRes}
        onChange={(terrain) => apply((s) => ({ ...s, terrain }))}
      />
    );
  }, [object, sel, state, stats, maxRes, apply, updateTerrainLayer, updateTextureLayer,
    changeTerrainKind, changeTextureKind, removeLayer, duplicateLayer, applyPreset, loadProjectText]);

  /* ---------------------------------------------------------------- render */

  return (
    <div className="shell">
      <Rail
        object={object}
        onObject={(id) => {
          setObject(id);
          if (id === 'terrain') setTab('terrain');
          if (id === 'textures') setTab('texture');
          if (id !== 'terrain' && id !== 'textures') { setSel({ terrain: null, texture: null }); }
        }}
        stack={state.stack}
        textures={state.textures}
        building={build.busy}
        gpu={status.gpu}
        onUndo={undo}
        onRedo={redo}
        canUndo={historyDepth.undo > 0}
        canRedo={historyDepth.redo > 0}
      />

      <Viewport
        canvasRef={canvasRef}
        stageRef={stageRef}
        status={status}
        build={build}
        stats={stats}
        fps={fps}
        autoBuild={autoBuild}
        viewMode={state.render.debugView}
        onToggleAuto={() => {
          const app = appRef.current;
          if (!app) return;
          app.autoBuild = !app.autoBuild;
          setAutoBuild(app.autoBuild);
          if (app.autoBuild) app.scheduleRebuild(0);
          setMessage(app.autoBuild ? 'Auto build on' : 'Auto build off');
        }}
        onRebuild={() => { appRef.current?.rebuildNow(); }}
        onFrame={() => { appRef.current?.camera.frame(state.terrain.extent, state.terrain.heightMeters); }}
        onViewMode={(debugView) => apply((s) => ({ ...s, render: { ...s.render, debugView } }))}
      />

      <div className="side">
        <LayerStackPanel
          tab={tab}
          onTab={(t) => { setTab(t); setObject(t === 'terrain' ? 'terrain' : 'textures'); }}
          terrainLayers={state.stack}
          textureLayers={state.textures}
          selectedTerrain={object === 'terrain' ? sel.terrain : null}
          selectedTexture={object === 'textures' ? sel.texture : null}
          onSelectTerrain={selectTerrain}
          onSelectTexture={selectTexture}
          onToggleTerrain={(id) => patchStack((stack) => stack.map((l) => (l.id === id ? { ...l, enabled: !l.enabled } : l)))}
          onToggleTexture={(id) => patchTextures((textures) => textures.map((l) => (l.id === id ? { ...l, enabled: !l.enabled } : l)))}
          onAddTerrain={addTerrain}
          onAddTexture={addTexture}
          onReorderTerrain={(stack) => patchStack(stack)}
          onReorderTexture={(textures) => patchTextures(textures)}
          onDuplicate={duplicateLayer}
          onDelete={() => removeLayer(tab, sel[tab])}
        />
        <div className="splitter"><i /></div>
        <div className="inspector">{inspector}</div>
      </div>

      {message && <div className="toast">{message}</div>}
      {errors.length > 0 && (
        <div className="gpu-errors">
          {errors.map((e) => (
            <div key={e} className="gpu-error">
              <b>GPU</b> {e}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { makeLayer, makeTexLayer };
