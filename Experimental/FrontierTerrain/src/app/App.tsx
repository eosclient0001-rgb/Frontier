// Application shell: project state, undo history, change-driven GPU runs,
// presets, file I/O and wiring between the engine and the panels.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine } from '../engine/engine';
import type { CamState, RunOpts, ViewFlags } from '../engine/engine';
import {
  BLENDS, DEFAULT_SETTINGS, GEN_KINDS_ORDER, GROUP_ORDER, KINDS, MATERIALS, PRESETS, VIEW_MODES,
  TEX_DEFAULTS, makeGen, makeTex,
} from '../engine/model';
import type { GenLayer, Project, Settings, TexLayer } from '../engine/model';
import { exportPng, exportRaw16, loadProjectFile, saveProject } from '../io/export';
import { Sidebar } from './Sidebar';
import { Viewport } from './Viewport';
import { RightDock } from './RightDock';
import type { Stage } from './RightDock';
import type { AddGroup, StackItem } from './Stack';
import { GenInspector, TexInspector, TerrainStats, EmptyInspector } from './Inspector';

let enginePromise: Promise<Engine> | null = null;
function getEngine(canvas: HTMLCanvasElement): Promise<Engine> {
  if (!enginePromise) enginePromise = Engine.create(canvas);
  return enginePromise;
}

const GEN_ADD: AddGroup[] = GROUP_ORDER.map((g) => ({
  group: g,
  items: GEN_KINDS_ORDER.filter((k) => KINDS[k].group === g).map((k) => ({ id: k, label: KINDS[k].name, sub: KINDS[k].blurb })),
}));
const TEX_ADD: AddGroup[] = [{
  group: 'Materials',
  items: MATERIALS.map((m) => ({ id: String(m.id), label: m.name, sub: m.blurb, color: m.color })),
}];

const MAX_TEX = 8;
const UNDO_LIMIT = 120;

function keysOf(p: Project) {
  const s = p.settings;
  return {
    g: JSON.stringify([p.gen, s.res, s.seed, s.worldSize, s.maxH]),
    s: JSON.stringify([s.sunAz, s.sunEl, s.haze, s.maxH]),
    t: JSON.stringify([p.tex, s.maxH, s.texScale]),
  };
}

function freshCam(s: Settings): CamState {
  return { yaw: 0.75, pitch: 0.5, dist: s.worldSize * 0.95, target: [0, s.maxH * 0.22, 0], fov: 0.62 };
}

export function App() {
  const [proj, setProj] = useState<Project>(() => {
    const qs = new URLSearchParams(window.location.search);
    const p0 = (PRESETS.find((x) => x.id === qs.get('preset')) ?? PRESETS[0]).build(DEFAULT_SETTINGS);
    const r = Number(qs.get('res'));
    if (r === 512 || r === 1024 || r === 2048) p0.settings.res = r;
    return p0;
  });
  const projRef = useRef(proj);
  const past = useRef<Project[]>([]);
  const future = useRef<Project[]>([]);
  const lastCo = useRef({ key: '', t: 0 });
  const [, bump] = useState(0);

  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gpuInfo, setGpuInfo] = useState('WebGPU');
  const [stage, setStage] = useState<Stage>('terrain');
  const [selGen, setSelGen] = useState<string | null>(null);
  const [selTex, setSelTex] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(PRESETS[0].id);
  const [autoGen, setAutoGen] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [hist, setHist] = useState<number[]>(new Array(128).fill(0));
  const [hasFlow, setHasFlow] = useState(false);
  const [genMs, setGenMs] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState('Starting');

  const camRef = useRef<CamState>(freshCam(proj.settings));
  const settingsRef = useRef<Settings>(proj.settings);
  const flagsRef = useRef<ViewFlags>({ viewMode: proj.settings.viewMode, showWater: true, showRivers: true });
  settingsRef.current = proj.settings;
  flagsRef.current = { viewMode: proj.settings.viewMode, showWater: proj.settings.showWater, showRivers: proj.settings.showRivers };

  // ---- engine bootstrap -------------------------------------------------
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    const cv = canvasRef.current!;
    getEngine(cv)
      .then((e) => { if (alive) { setEngine(e); setGpuInfo(e.info); } })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : String(err)); });
    return () => { alive = false; };
  }, []);

  // ---- undoable commits ---------------------------------------------------
  const commit = useCallback((next: Project, coalesce?: string) => {
    const cur = projRef.current;
    if (next === cur) return;
    const now = Date.now();
    const same = !!coalesce && coalesce === lastCo.current.key && now - lastCo.current.t < 900;
    if (!same) {
      past.current.push(cur);
      if (past.current.length > UNDO_LIMIT) past.current.shift();
      future.current = [];
    }
    lastCo.current = { key: coalesce ?? '', t: now };
    projRef.current = next;
    setProj(next);
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(projRef.current);
    projRef.current = prev;
    setProj(prev);
    lastCo.current = { key: '', t: 0 };
  }, []);
  const redo = useCallback(() => {
    const nx = future.current.pop();
    if (!nx) return;
    past.current.push(projRef.current);
    projRef.current = nx;
    setProj(nx);
    lastCo.current = { key: '', t: 0 };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // ---- GPU runs ----------------------------------------------------------
  const pending = useRef<RunOpts>({ gen: true, sun: false, tex: false });
  const prevKeys = useRef<ReturnType<typeof keysOf> | null>(null);
  const autoRef = useRef(autoGen);
  autoRef.current = autoGen;
  const runSeq = useRef(0);
  const engRef = useRef<Engine | null>(null);
  engRef.current = engine;

  const flush = useCallback(async (force?: RunOpts) => {
    const e = engRef.current;
    if (!e) return;
    const opts = force ?? { ...pending.current };
    if (!opts.gen && !opts.sun && !opts.tex) return;
    pending.current = { gen: false, sun: false, tex: false };
    setDirty(false);
    const seq = ++runSeq.current;
    setBusy(true);
    setStatusMsg(opts.gen ? 'Generating terrain…' : opts.sun ? 'Baking shadows…' : 'Evaluating textures…');
    try {
      const r = await e.run(projRef.current, opts);
      setThumbs((t) => ({ ...t, ...r.thumbs }));
      setHist(r.hist);
      setHasFlow(r.hasFlow);
      if (opts.gen) setGenMs(r.ms);
      if (seq === runSeq.current) {
        setBusy(false);
        setStatusMsg(`Ready · ${Math.round(r.ms)} ms`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!engine) return;
    const k = keysOf(proj);
    const prev = prevKeys.current;
    const pn = pending.current;
    if (!prev || k.g !== prev.g) pn.gen = true;
    if (prev && k.s !== prev.s) pn.sun = true;
    if (prev && k.t !== prev.t) pn.tex = true;
    prevKeys.current = k;
    if (!pn.gen && !pn.sun && !pn.tex) return;
    if (!autoRef.current) {
      setDirty(true);
      setStatusMsg('Changes pending');
      return;
    }
    const t = window.setTimeout(() => { void flush(); }, 140);
    return () => window.clearTimeout(t);
  }, [proj, engine, flush]);

  // ---- helpers -----------------------------------------------------------
  const setSettings = (patch: Partial<Settings>, co?: string) => {
    const p = projRef.current;
    commit({ ...p, settings: { ...p.settings, ...patch } }, co);
  };
  const updateGen = (id: string, fn: (l: GenLayer) => GenLayer, co?: string) => {
    const p = projRef.current;
    commit({ ...p, gen: p.gen.map((l) => (l.id === id ? fn(l) : l)) }, co);
  };
  const updateTex = (id: string, fn: (l: TexLayer) => TexLayer, co?: string) => {
    const p = projRef.current;
    commit({ ...p, tex: p.tex.map((l) => (l.id === id ? fn(l) : l)) }, co);
  };
  const moveIn = <T,>(arr: T[], from: number, to: number): T[] => {
    const a = arr.slice();
    const [x] = a.splice(from, 1);
    a.splice(to, 0, x);
    return a;
  };

  const applyPreset = (id: string) => {
    const pr = PRESETS.find((x) => x.id === id);
    if (!pr) return;
    const next = pr.build(projRef.current.settings);
    commit(next);
    setActivePreset(id);
    setSelGen(null);
    setSelTex(null);
    camRef.current = freshCam(next.settings);
  };

  // ---- derived view data --------------------------------------------------
  const genItems: StackItem[] = proj.gen.map((l) => ({
    id: l.id,
    name: l.name,
    sub: `${KINDS[l.kind].name} · ${BLENDS.find((b) => b.id === l.blend)?.label}${l.opacity < 0.999 ? ` · ${Math.round(l.opacity * 100)}%` : ''}`,
    enabled: l.enabled,
    thumb: thumbs[`g:${l.id}`],
    badge: l.mask.kind !== 'none' ? `MASK · ${l.mask.kind.toUpperCase()}` : undefined,
  }));
  const texItems: StackItem[] = proj.tex.map((l, i) => {
    const masks = [
      l.p.altOn ? 'ALT' : '', l.p.slopeOn ? 'SLOPE' : '', l.p.curvOn ? 'CURV' : '',
      l.p.flowOn ? 'FLOW' : '', l.p.cavOn ? 'CAVITY' : '',
    ].filter(Boolean);
    return {
      id: l.id,
      name: l.name,
      sub: MATERIALS[l.mat].name,
      enabled: l.enabled,
      thumb: thumbs[`t:${l.id}`],
      badge: [i === proj.tex.findIndex((t) => t.enabled) ? 'BASE' : '', ...masks].filter(Boolean).join(' · ') || undefined,
    };
  });

  const selGenLayer = proj.gen.find((l) => l.id === selGen) ?? null;
  const selTexLayer = proj.tex.find((l) => l.id === selTex) ?? null;
  const cellM = proj.settings.worldSize / (proj.settings.res - 1);

  let inspector;
  if (stage === 'terrain') {
    inspector = selGenLayer ? (
      <GenInspector
        layer={selGenLayer}
        thumb={thumbs[`g:${selGenLayer.id}`]}
        settings={proj.settings}
        onChange={(fn, co) => updateGen(selGenLayer.id, fn, co)}
      />
    ) : (
      <TerrainStats hist={hist} settings={proj.settings} hasFlow={hasFlow} res={proj.settings.res} cellM={cellM} genMs={genMs} />
    );
  } else {
    inspector = selTexLayer ? (
      <TexInspector
        layer={selTexLayer}
        thumb={thumbs[`t:${selTexLayer.id}`]}
        settings={proj.settings}
        onChange={(fn, co) => updateTex(selTexLayer.id, fn, co)}
      />
    ) : (
      <EmptyInspector text={proj.tex.length ? 'Select a texture layer to edit its material and masks.' : 'Add a material from the stack to start texturing.'} />
    );
  }

  const statusText = error ? 'Error' : busy ? 'Working…' : dirty ? 'Changes pending' : statusMsg;
  // Viewport status line (camera HUD) is also used as a render trigger.

  return (
    <div className="shell">
      <Sidebar
        name={proj.name}
        settings={proj.settings}
        activePreset={activePreset}
        viewMode={proj.settings.viewMode}
        showWater={proj.settings.showWater}
        showRivers={proj.settings.showRivers}
        autoGen={autoGen}
        dirty={dirty}
        status={statusText}
        gpuInfo={gpuInfo}
        onName={(v) => commit({ ...projRef.current, name: v }, 'name')}
        onSettings={setSettings}
        onPreset={applyPreset}
        onView={(v) => setSettings({ viewMode: v })}
        onWater={(v) => setSettings({ showWater: v })}
        onRivers={(v) => setSettings({ showRivers: v })}
        onAuto={(v) => {
          setAutoGen(v);
          if (v) void flush();
        }}
        onGenerate={() => void flush({ gen: true, sun: true, tex: true })}
        onExportRaw={async () => {
          if (!engine) return;
          const h = await engine.readHeights();
          exportRaw16(h, engine.resolution, projRef.current.name);
        }}
        onExportPng={async () => {
          if (!engine) return;
          const h = await engine.readHeights();
          exportPng(h, engine.resolution, projRef.current.name);
        }}
        onSave={() => saveProject(projRef.current)}
        onLoad={async (f) => {
          try {
            const p = await loadProjectFile(f);
            commit(p);
            setActivePreset(null);
            setSelGen(null);
            setSelTex(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      />

      <main className="stage-main">
        <Viewport
          canvasRef={canvasRef}
          engine={engine}
          camRef={camRef}
          settingsRef={settingsRef}
          flagsRef={flagsRef}
          renderKey={proj}
          busy={busy}
          statusText={`${proj.settings.res}×${proj.settings.res} · ${cellM.toFixed(1)} m cells · ${(proj.settings.worldSize / 1000).toFixed(2)} km`}
          error={error}
          viewLabel={`${stage === 'terrain' ? 'Terrain' : 'Texture'} · ${proj.name}`}
          modeLabel={VIEW_MODES[proj.settings.viewMode]}
          onResetView={() => { camRef.current = freshCam(projRef.current.settings); bump((x) => x + 1); }}
        />
      </main>

      <RightDock
        stage={stage}
        setStage={(s) => { setStage(s); }}
        canUndo={past.current.length > 0}
        canRedo={future.current.length > 0}
        onUndo={undo}
        onRedo={redo}
        statusText={statusText}
        stackTitle={stage === 'terrain' ? 'Generation' : 'Texture'}
        stackItems={stage === 'terrain' ? genItems : texItems}
        selected={stage === 'terrain' ? selGen : selTex}
        onSelect={(id) => (stage === 'terrain' ? setSelGen(id) : setSelTex(id))}
        onToggle={(id, on) => (stage === 'terrain'
          ? updateGen(id, (l) => ({ ...l, enabled: on }))
          : updateTex(id, (l) => ({ ...l, enabled: on })))}
        onDelete={(id) => {
          const p = projRef.current;
          if (stage === 'terrain') { commit({ ...p, gen: p.gen.filter((l) => l.id !== id) }); if (selGen === id) setSelGen(null); }
          else { commit({ ...p, tex: p.tex.filter((l) => l.id !== id) }); if (selTex === id) setSelTex(null); }
        }}
        onMove={(from, to) => {
          const p = projRef.current;
          if (stage === 'terrain') commit({ ...p, gen: moveIn(p.gen, from, to) });
          else commit({ ...p, tex: moveIn(p.tex, from, to) });
        }}
        addGroups={stage === 'terrain' ? GEN_ADD : TEX_ADD}
        onAdd={(id) => {
          const p = projRef.current;
          if (stage === 'terrain') {
            const L = makeGen(id as GenLayer['kind']);
            commit({ ...p, gen: [...p.gen, L] });
            setSelGen(L.id);
          } else {
            if (p.tex.length >= MAX_TEX) return;
            const m = MATERIALS[Number(id)];
            const L = makeTex(m.id, m.name, '#ffffff', { ...TEX_DEFAULTS });
            commit({ ...p, tex: [...p.tex, L] });
            setSelTex(L.id);
          }
        }}
        maxItems={stage === 'texture' ? MAX_TEX : undefined}
        emptyText={stage === 'terrain' ? 'No generation layers. Add a fractal base to begin.' : 'No texture layers. Add a material to paint the terrain.'}
      >
        {inspector}
      </RightDock>
    </div>
  );
}
