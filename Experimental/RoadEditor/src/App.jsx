import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createViewport } from './viewport3d.js';
import { generateCity, gradeApproaches } from './core/generate.js';
import { PROFILE_LIBRARY, cloneProfile } from './core/profiles.js';
import { buildGeometry } from './core/geometry.js';
import { furnishProject } from './core/details.js';
import { validate } from './core/topology.js';
import { buildMoves, makeNode, rebuildArms, sanitizeNetwork, snapArmHeights, splitRoadAt, nextId } from './core/network.js';
import { TopBar, NetworkPanel, GeneratePanel, LayersPanel, RoadInspector, JunctionInspector, CataloguePanel, GatesPanel, StatusBar, SectionPanel } from './panels.jsx';
import { Chip, KeyCap } from './ui.jsx';

const DEFAULT_GEN = { seed: 20261012, size: 3000, layout: 'nfs-loop', charter: 'nfs-arterial', roundaboutRate: 0.08 };

const polyLen = (road) => {
  let d = 0;
  for (let i = 1; i < road.points.length; i += 1) d += Math.hypot(road.points[i][0] - road.points[i - 1][0], road.points[i][2] - road.points[i - 1][2]);
  return d;
};

/** Everything the editor needs about a city, built with the same core the node harness measures. */
function buildAll(gen) {
  const t0 = performance.now();
  const city = generateCity(gen);
  const tGen = performance.now();
  const project = {
    schema: 'frontier.roadway/0.1',
    options: city.options,
    settings: {},
    profiles: PROFILE_LIBRARY,
    roads: city.roads,
    nodes: city.nodes,
    rail: city.rail,
    terrain: city.terrain,
    districts: city.districts,
    charter: city.charter,
  };
  for (const node of project.nodes) node.moves = node.arms.length >= 3 ? buildMoves(project, node) : [];
  furnishProject(project, city.charter, city.terrain);
  const tFurn = performance.now();
  const geo = buildGeometry(project, { terrainStep: 90 });
  const tGeo = performance.now();
  const report = summarise(project, geo, city);
  return {
    city,
    project,
    geo,
    report,
    interchanges: city.interchanges?.length || 0,
    timings: { generate: tGen - t0, furnish: tFurn - tGen, geometry: tGeo - tFurn, total: performance.now() - t0 },
  };
}

/** Re-run the parts that depend on geometry after an edit (topology already rebuilt by the op). */
function rebuild(built) {
  const t0 = performance.now();
  const { project, city } = built;
  for (const node of project.nodes) node.arms = node.arms || [];
  rebuildArms(project);
  snapArmHeights(project);
  rebuildArms(project);
  gradeApproaches(project);
  for (const node of project.nodes) node.moves = node.arms.length >= 3 ? buildMoves(project, node) : [];
  furnishProject(project, city.charter, city.terrain);
  const geo = buildGeometry(project, { terrainStep: 90 });
  const report = summarise(project, geo, city);
  return { ...built, geo, report, timings: { ...built.timings, edit: performance.now() - t0 } };
}

function summarise(project, geo, city) {
  const bare = validate(project);
  const fails = bare.rules.reduce((a, r) => a + r.offenders.filter((o) => r.severity === 'fail').length, 0);
  const warns = bare.rules.reduce((a, r) => a + r.offenders.filter((o) => r.severity === 'warn').length, 0);
  const infos = bare.rules.reduce((a, r) => a + r.offenders.filter((o) => r.severity === 'info').length, 0);
  const passed = bare.rules.filter((r) => !r.offenders.length).length;
  const classes = {};
  let metros = 0;
  let ramps = 0;
  for (const road of project.roads) {
    classes[road.class] = (classes[road.class] || 0) + 1;
    metros += polyLen(road);
    if (road.class === 'ramp') ramps += 1;
  }
  return {
    ...bare,
    rules: bare.rules,
    fails,
    warns,
    infos,
    passed,
    total: bare.rules.length,
    roads: project.roads.length,
    junctions: project.nodes.filter((n) => n.arms.length >= 3).length,
    terminals: project.nodes.filter((n) => n.arms.length === 1).length,
    metres: metros,
    classes,
    ramps,
    triangles: geo.stats.triangles,
    perKm: Math.round(geo.stats.triangles / Math.max(1, metros / 1000)),
  };
}

export default function App() {
  const canvasRef = useRef(null);
  const miniRef = useRef(null);
  const vpRef = useRef(null);
  const keys = useRef({});
  const look = useRef({ dragging: false, x: 0, y: 0 });
  const [gen, setGen] = useState(DEFAULT_GEN);
  const [built, setBuilt] = useState(null);
  const [building, setBuilding] = useState(true);
  const [tool, setTool] = useState('fly');
  const [tab, setTab] = useState('network');
  const [rightTab, setRightTab] = useState('inspector');
  const [selection, setSelection] = useState({ roadId: null, nodeId: null });
  const [cam, setCam] = useState({ x: 0, y: 34, z: 520, yaw: 0, pitch: -0.22, speed: 42, fov: 62 * Math.PI / 180, viewDistance: 1500 });
  const [stats, setStats] = useState({ fps: 0, drawn: 0, culled: 0, ms: 0 });
  const [flags, setFlags] = useState({ terrain: true, markings: true, details: true, kerbs: true, structures: true, grid: false });
  const [detailSettings, setDetailSettings] = useState({});
  const [notices, setNotices] = useState(['Hold right mouse to look. W A S D travel, Q E altitude, Shift sprints.']);
  const [selectedStrip, setSelectedStrip] = useState(null);
  const builtRef = useRef(null);
  const camRef = useRef(null);

  const flash = useCallback((text) => {
    setNotices((n) => [text, ...n].slice(0, 6));
  }, []);

  /* ── build on mount and whenever the generator settings are committed ───────────────────────── */
  useEffect(() => { builtRef.current = built; }, [built]);

  const generate = useCallback((opts = gen) => {
    setBuilding(true);
    setGen(opts);
    // Yield a frame so the button state paints before the synchronous build.
    setTimeout(() => {
      const next = buildAll(opts);
      setBuilt(next);
      setBuilding(false);
      flash(`Generated ${next.report.roads} roads · ${(next.report.metres / 1000).toFixed(1)} km · ${next.report.fails} failing rules`);
      const firstRoad = next.project.roads.slice().sort((a, b) => polyLen(b) - polyLen(a))[0];
      if (firstRoad && vpRef.current) {
        vpRef.current.focusRoad(firstRoad, 140, 60);
        setCam((c) => ({ ...c, ...vpRef.current.state.cam }));
      }
    }, 30);
  }, [gen, flash]);

  useEffect(() => {
    generate(DEFAULT_GEN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── viewport ───────────────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const vp = createViewport(canvasRef.current);
    vpRef.current = vp;
    vp.state.flags = flags;

    let alive = true;
    let raf = 0;
    let last = performance.now();
    let fpsAcc = 0;
    let fpsCount = 0;
    let frame = 0;
    let hudTimer = 0;
    let lastPose = { x: Infinity, z: Infinity };

    const loop = (now) => {
      if (!alive) return;
      camRef.current = { ...vp.state.cam };
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      vp.move(dt, keys.current);

      // cinematic orbit for screenshot runs
      if (keys.current.orbit) {
        const r = 900;
        vp.state.cam.x = Math.cos(now / 8000) * r;
        vp.state.cam.z = Math.sin(now / 8000) * r;
        vp.state.cam.y = 210 + Math.sin(now / 5200) * 60;
        vp.state.cam.yaw = -now / 8000 + Math.PI / 2;
        vp.state.cam.pitch = -0.32;
      }

      const s = vp.render(now);
      fpsAcc += dt;
      fpsCount += 1;

      if (fpsAcc > 0.5) {
        setStats({ fps: fpsCount / fpsAcc, drawn: s.drawn, culled: s.culled, ms: s.ms });
        fpsAcc = 0;
        fpsCount = 0;
        const c = vp.state.cam;
        if (Math.hypot(c.x - lastPose.x, c.z - lastPose.z) > 4 || Math.abs(c.y - cam.y) > 8) {
          lastPose = { x: c.x, z: c.z };
          setCam((prev) => ({ ...prev, x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch }));
        }
      }

      frame += 1;
      if (frame % 12 === 0 && miniRef.current) vp.drawMinimap(miniRef.current, 168);

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const preserved = camRef.current;
    if (preserved) {
      vp.state.cam.x = preserved.x;
      vp.state.cam.y = preserved.y;
      vp.state.cam.z = preserved.z;
      vp.state.cam.yaw = preserved.yaw;
      vp.state.cam.pitch = preserved.pitch;
    } else {
      camRef.current = { ...vp.state.cam };
    }

    const onKey = (e, down) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', ' ': 'orbit' };
      keys.current[map[k] || k] = down;
      if (map[k] === 'orbit' && down) { e.preventDefault(); flash(keys.current.orbit ? 'Cinematic orbit on' : 'Cinematic orbit off'); }
      if (!down) return;
      if (k === 'f' && vp.state.selection?.roadId) {
        const road = builtRef.current?.project.roads.find((r) => r.id === vp.state.selection.roadId);
        if (road) { vp.focusRoad(road, 110, 40); setCam((c) => ({ ...c, ...vp.state.cam })); }
      }
      if (k === 'm') setFlags((f) => ({ ...f, markings: !f.markings }));
      if (k === 'z') setFlags((f) => ({ ...f, terrain: !f.terrain }));
      if (k === 'x') setFlags((f) => ({ ...f, details: !f.details }));
      if (k === 'g') setFlags((f) => ({ ...f, grid: !f.grid }));
      if (k === 't') { vp.state.cam.pitch = -0.72; vp.state.cam.y = Math.max(vp.state.cam.y, 420); flash('Top-down view'); }
      if (k === 'r') setRightTab('inspector');
      if (k === 'c') setRightTab('section');
      if (k === 'v') setRightTab('gates');
      if (k === 'b') setTab('network');
      if (k === 'n') setTab('generate');
    };
    const kd = (e) => onKey(e, true);
    const ku = (e) => onKey(e, false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);

    const canvas = canvasRef.current;
    const onDown = (e) => {
      if (e.button === 2) { look.current = { dragging: true, x: e.clientX, y: e.clientY }; return; }
      const rect = canvas.getBoundingClientRect();
      const hit = vp.pickAt(e.clientX - rect.left, e.clientY - rect.top);
      if (!hit) { setSelection({ roadId: null, nodeId: null }); return; }
      if (hit.kind === 'junction' || hit.nodeId) {
        setSelection({ roadId: null, nodeId: hit.nodeId });
        setRightTab('inspector');
        setTool('junction');
      } else {
        setSelection({ roadId: hit.roadId, nodeId: null });
        setRightTab(tool === 'section' ? 'section' : 'inspector');
      }
      vp.state.selection = hit.kind === 'junction' ? { nodeId: hit.nodeId } : { roadId: hit.roadId };
    };
    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (look.current.dragging) {
        const dx = e.clientX - look.current.x;
        const dy = e.clientY - look.current.y;
        look.current.x = e.clientX;
        look.current.y = e.clientY;
        vp.state.cam.yaw += dx * 0.0032;
        vp.state.cam.pitch = Math.max(-1.5, Math.min(1.5, vp.state.cam.pitch - dy * 0.0028));
        return;
      }
      if (frame % 2 === 0) {
        const hit = vp.pickAt(px, py);
        if (!hit) { vp.state.hoverLabel = null; return; }
        const road = builtRef.current?.project.roads.find((r) => r.id === hit.roadId);
        const node = builtRef.current?.project.nodes.find((n) => n.id === hit.nodeId);
        vp.state.hoverLabel = node
          ? `${node.type || 'junction'} · ${node.control || '—'} · ${node.arms.length} arms`
          : road
            ? `${road.name} · ${road.class} · ${road.profileId} · ${polyLen(road).toFixed(0)} m`
            : null;
      }
    };
    const onUp = (e) => { if (e.button === 2) look.current.dragging = false; };
    const onCtx = (e) => e.preventDefault();
    const onWheel = (e) => {
      const next = Math.max(4, Math.min(600, vp.state.cam.speed * (e.deltaY > 0 ? 0.9 : 1.1)));
      vp.state.cam.speed = next;
      setCam((c) => ({ ...c, speed: next }));
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    canvas.addEventListener('contextmenu', onCtx);
    canvas.addEventListener('wheel', onWheel, { passive: true });

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('contextmenu', onCtx);
      canvas.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (vpRef.current) { vpRef.current.state.flags = flags; } }, [flags]);
  useEffect(() => {
    if (vpRef.current && built) {
      vpRef.current.state.geometry = built.geo;
      vpRef.current.state.project = built.project;
      vpRef.current.state.selection = selection;
    }
  }, [built, selection]);

  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    vp.state.cam.speed = cam.speed;
    vp.state.fov = cam.fov;
    vp.state.viewDistance = cam.viewDistance;
  }, [cam.speed, cam.fov, cam.viewDistance]);

  useEffect(() => {
    const vp = vpRef.current;
    if (vp) vp.state.detail = detailSettings;
  }, [detailSettings]);

  /* ── editing operations ─────────────────────────────────────────────────────────────────────── */
  const applyEdit = useCallback((nextBuilt) => {
    setBuilt(rebuild(nextBuilt));
  }, []);

  const onRoadEdit = useCallback((op, payload) => {
    if (!built) return;
    const project = built.project;
    const { road } = payload;
    const fresh = { ...built, project: { ...project, roads: project.roads.slice(), nodes: project.nodes.slice() } };
    try {
      if (op === 'class') {
        road.class = payload.value;
        const candidate = PROFILE_LIBRARY.find((p) => p.class === road.class && p.right.length === road.profileId.length);
        road.profileId = PROFILE_LIBRARY.find((p) => p.class === road.class)?.id || road.profileId;
        flash(`${road.name} → ${payload.value} class · profile ${road.profileId}`);
      } else if (op === 'profile') {
        road.profileId = payload.value;
        flash(`${road.name} → ${payload.value}`);
      } else if (op === 'speed') {
        road.speed = payload.value;
      } else if (op === 'reverse') {
        road.points = road.points.slice().reverse();
        const a = road.startNode;
        road.startNode = road.endNode;
        road.endNode = a;
        if (road.spans?.length) {
          const last = road.points.length - 1;
          road.spans = road.spans.map((s) => ({ ...s, i0: last - s.i1, i1: last - s.i0 }));
        }
        flash(`${road.name} reversed`);
      } else if (op === 'oneway') {
        road.oneway = !road.oneway;
        flash(`${road.name} ${road.oneway ? 'set one-way' : 'set two-way'}`);
      } else if (op === 'split') {
        const mid = road.points[Math.floor(road.points.length / 2)];
        const parts = splitRoadAt(project, road, mid[0], mid[2]);
        if (!parts) { flash('Split failed: road too short'); return; }
        const node = makeNode({ x: parts.point[0], z: parts.point[2], y: parts.point[1], type: 'transition', control: 'uncontrolled', arms: [] });
        project.nodes.push(node);
        parts.first.endNode = node.id;
        parts.second.startNode = node.id;
        const i = project.roads.indexOf(road);
        project.roads.splice(i, 1, parts.first, parts.second);
        flash(`${road.name} split at ${polyLen(road).toFixed(0)} m`);
      } else if (op === 'delete') {
        const i = project.roads.indexOf(road);
        project.roads.splice(i, 1);
        sanitizeNetwork(project);
        setSelection({ roadId: null, nodeId: null });
        flash(`${road.name} deleted`);
      } else if (op === 'strip') {
        const { op: stripOp, side, index } = payload;
        const base = project.profiles.find((p) => p.id === road.profileId);
        const customId = `edit-${road.id}`;
        let custom = project.profiles.find((p) => p.id === customId);
        if (!custom) {
          custom = { ...cloneProfile(base), id: customId, name: `${base.name} (edited)`, tag: 'Edited' };
          project.profiles = project.profiles.concat([custom]);
          road.profileId = customId;
        }
        const list = custom[side];
        if (stripOp === 'width' && list[index]) list[index].width = payload.value;
        if (stripOp === 'type' && list[index]) list[index].type = payload.value;
        if (stripOp === 'remove' && list.length > 1) list.splice(index, 1);
        if (stripOp === 'add') list.splice(Math.max(0, list.findIndex((s) => s.type === 'kerb')), 0, { id: nextId('s'), type: 'traffic', width: 3.4 });
        flash(`Cross-section of ${road.name} edited (${side} ${stripOp})`);
      } else if (op === 'selectStrip') {
        setSelectedStrip(payload.strip?.id || null);
      }
      applyEdit(fresh);
    } catch (err) {
      flash(`Edit failed: ${err.message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, applyEdit, flash]);

  const onNodeEdit = useCallback((op, payload) => {
    if (!built) return;
    const project = built.project;
    const { node } = payload;
    if (op === 'type') { node.type = payload.value; node.radius = node.radius || 9; }
    if (op === 'control') node.control = payload.value;
    if (op === 'radius') node.radius = payload.value;
    if (op === 'crossings') {
      for (const arm of node.arms) {
        const road = project.roads.find((r) => r.id === arm.roadId);
        if (!road) continue;
        road.details = road.details || {};
        road.details.crossings = (road.details.crossings || []).concat([{ s: arm.end === 0 ? 14 : Math.max(14, polyLen(road) - 14), kind: node.control === 'signals' ? 'toucan' : 'zebra', nodeId: node.id }]);
      }
      flash(`Crossings added on ${node.arms.length} arms of ${node.id}`);
    }
    if (op === 'dissolve') {
      project.nodes = project.nodes.filter((n) => n.id !== node.id);
      for (const road of project.roads) {
        if (road.startNode === node.id) road.startNode = null;
        if (road.endNode === node.id) road.endNode = null;
      }
      sanitizeNetwork(project);
      setSelection({ roadId: null, nodeId: null });
      flash(`Junction ${node.id} dissolved`);
    }
    applyEdit({ ...built, project });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, applyEdit, flash]);

  useEffect(() => {
    if (vpRef.current && built) {
      vpRef.current.state.geometry = built.geo;
      vpRef.current.state.project = built.project;
    }
  }, [built]);

  const selectedRoad = useMemo(() => built?.project.roads.find((r) => r.id === selection.roadId) || null, [built, selection]);
  const selectedNode = useMemo(() => built?.project.nodes.find((n) => n.id === selection.nodeId) || null, [built, selection]);

  return (
    <div className="app">
      <TopBar
        gen={gen}
        setGen={setGen}
        onGenerate={() => generate(gen)}
        building={building}
        tool={tool}
        setTool={setTool}
        stats={stats}
        gateScore={built ? built.report.fails : null}
        onRunGate={() => {
          if (!built) return;
          const next = rebuild(built);
          setBuilt(next);
          flash(`Gate re-run: ${next.report.passed}/${next.report.total} rules passing · ${next.report.fails} fail`);
          setRightTab('gates');
        }}
      />

      <div className="body">
        <aside className="left">
          <div className="tabs">
            <Chip active={tab === 'network'} onClick={() => setTab('network')}>Network</Chip>
            <Chip active={tab === 'generate'} onClick={() => setTab('generate')}>Generate</Chip>
            <Chip active={tab === 'layers'} onClick={() => setTab('layers')}>Layers</Chip>
          </div>
          <div className="scroll-col">
            {tab === 'network' ? <NetworkPanel project={built?.project || { roads: [], nodes: [] }} selection={selection} onSelect={(s) => { setSelection(s); setRightTab('inspector'); }} onFocus={(road) => vpRef.current?.focusRoad(road, 110, 36)} /> : null}
            {tab === 'generate' ? <GeneratePanel gen={gen} setGen={setGen} onGenerate={() => generate(gen)} report={built?.report} timings={built?.timings} interchanges={built?.interchanges || 0} /> : null}
            {tab === 'layers' ? <LayersPanel flags={flags} setFlags={setFlags} cam={{ ...cam, fov: cam.fov, viewDistance: cam.viewDistance }} setCam={(patch) => setCam((c) => ({ ...c, ...patch }))} detailSettings={detailSettings} setDetailSettings={setDetailSettings} notices={notices} /> : null}
          </div>
        </aside>

        <main className="viewport">
          <canvas ref={canvasRef} />
          <div className="hud hud-tl">
            <span className="hud-chip">{tool === 'fly' ? 'Fly camera' : tool}</span>
            <span className="hud-chip">{stats.fps | 0} fps</span>
            <span className="hud-chip">{stats.drawn} polys</span>
            {building ? <span className="hud-chip busy">generating…</span> : null}
          </div>
          <div className="hud hud-bl">
            <span><KeyCap>W</KeyCap><KeyCap>A</KeyCap><KeyCap>S</KeyCap><KeyCap>D</KeyCap> fly</span>
            <span><KeyCap>Q</KeyCap><KeyCap>E</KeyCap> height</span>
            <span><KeyCap>RMB</KeyCap> look</span>
            <span><KeyCap>Space</KeyCap> orbit</span>
            <span><KeyCap>Z</KeyCap> terrain · <KeyCap>M</KeyCap> markings · <KeyCap>X</KeyCap> detail</span>
          </div>
          <div className="minimap">
            <canvas ref={miniRef} width="168" height="168" />
            <span className="mono">minimap · click a road in the tree to fly</span>
          </div>
        </main>

        <aside className="right">
          <div className="tabs">
            <Chip active={rightTab === 'inspector'} onClick={() => setRightTab('inspector')}>Inspector</Chip>
            <Chip active={rightTab === 'section'} onClick={() => setRightTab('section')}>Cross-section</Chip>
            <Chip active={rightTab === 'catalogue'} onClick={() => setRightTab('catalogue')}>Catalogue</Chip>
            <Chip active={rightTab === 'gates'} onClick={() => setRightTab('gates')}>Gates</Chip>
          </div>
          <div className="scroll-col">
            {rightTab === 'inspector' ? (selectedNode
              ? <JunctionInspector project={built.project} node={selectedNode} onEdit={onNodeEdit} onFocus={(t) => vpRef.current?.focusOn(t)} />
              : <RoadInspector project={built?.project || { profiles: PROFILE_LIBRARY, nodes: [], roads: [] }} road={selectedRoad} onEdit={onRoadEdit} onFocus={(road) => vpRef.current?.focusRoad(road, 110, 36)} selection={selection} onSelectNode={(id) => setSelection({ roadId: null, nodeId: id })} />)
              : null}
            {rightTab === 'section' ? <SectionPanel project={built?.project} road={selectedRoad} onEdit={onRoadEdit} selectedStrip={selectedStrip} onSelectStrip={setSelectedStrip} /> : null}
            {rightTab === 'catalogue' ? <CataloguePanel /> : null}
            {rightTab === 'gates' ? <GatesPanel report={built?.report} onFlyTo={(pos) => vpRef.current?.focusOn({ x: pos[0], z: pos[2], y: pos[1], height: 30 })} onRerun={() => setBuilt(rebuild(built))} /> : null}
          </div>
        </aside>
      </div>

      <StatusBar
        report={built?.report}
        timings={built?.timings}
        cam={cam}
        stats={stats}
        interchanges={built?.interchanges || 0}
        project={built?.project}
        onOpenInspector={() => setRightTab('inspector')}
      />
    </div>
  );
}
