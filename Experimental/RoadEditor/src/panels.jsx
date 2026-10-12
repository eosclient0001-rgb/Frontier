import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Circle, Diamond, Eye, EyeOff, Filter, GitBranch, Layers,
  ListTree, Map as MapIcon, MousePointer2, Move3d, Ruler, Search, Shuffle, Sparkles, TrainFront,
  TriangleAlert, Waypoints, X, Zap,
} from 'lucide-react';
import {
  Row, Section, Grid, Metric, Toggle, Chip, Stepper, Select, Field, Badge, StripBar, KeyCap,
  CLASS_COLOUR, STRIP_COLOUR,
} from './ui.jsx';
import { ROAD_CLASSES, STRIP_TYPES, MARKING_KINDS, DETAIL_TYPES, JUNCTION_TYPES, STRUCTURE_TYPES, SURFACES, KERBS } from './core/standards.js';
import { CLASS_RANK } from './core/rank.js';

const num = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const km = (m) => `${num(m / 1000, 2)} km`;

/* ── top bar ──────────────────────────────────────────────────────────────────────────────────── */

export function TopBar({ gen, setGen, onGenerate, building, tool, setTool, stats, onRunGate, gateScore }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">F</span>
        <span className="brand-text">
          <b>Frontier</b>
          <em>Road Editor</em>
        </span>
        <Badge>design prototype</Badge>
      </div>

      <div className="chips">
        <span className="chip-static">seed <b>{gen.seed}</b></span>
        <span className="chip-static">{gen.size} m</span>
        <span className="chip-static">{gen.layout}</span>
        <span className="chip-static">{gen.charter}</span>
      </div>

      <div className="tools">
        {[
          ['fly', 'Fly camera', <Move3d size={14} />],
          ['select', 'Select', <MousePointer2 size={14} />],
          ['section', 'Cross-section', <Ruler size={14} />],
          ['junction', 'Junction', <Waypoints size={14} />],
          ['detail', 'Detail brush', <Sparkles size={14} />],
        ].map(([id, label, icon]) => (
          <Chip key={id} active={tool === id} onClick={() => setTool(id)} title={label}>
            {icon}<span>{label}</span>
          </Chip>
        ))}
      </div>

      <div className="topbar-right">
        <button type="button" className="btn" onClick={onGenerate} disabled={building}>
          {building ? 'Generating…' : 'Regenerate city'}
        </button>
        <button type="button" className="btn ghost" onClick={onRunGate} title="Run the validation gate in the browser">
          Run gate {gateScore ? <b>{gateScore}f/{gateScore}w</b> : null}
        </button>
        <span className="fps" title="frames per second / drawn / culled">
          <Zap size={13} /> {stats.fps | 0} fps
          <em>{stats.drawn} drawn · {stats.culled} culled · {num(stats.ms, 1)} ms</em>
        </span>
      </div>
    </header>
  );
}

/* ── network tree (left) ──────────────────────────────────────────────────────────────────────── */

export function NetworkPanel({ project, selection, onSelect, onFocus }) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('class');
  const [hidden, setHidden] = useState({});

  const groups = useMemo(() => {
    const map = new Map();
    for (const road of project.roads) {
      if (query && !`${road.name} ${road.id} ${road.class}`.toLowerCase().includes(query.toLowerCase())) continue;
      const key = group === 'class' ? road.class : road.name.replace(/\s+\d+$/, '');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(road);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [project, query, group]);

  return (
    <>
      <Section
        title="Network"
        right={<span className="muted mono">{project.roads.length} roads · {project.nodes.length} junctions</span>}
        dense
      >
        <div className="searchrow">
          <Search size={13} />
          <input value={query} placeholder="filter by name, id, class…" onChange={(e) => setQuery(e.target.value)} />
          {query ? <button type="button" className="iconbtn" onClick={() => setQuery('')}><X size={12} /></button> : null}
        </div>
        <div className="chipline">
          <Chip active={group === 'class'} onClick={() => setGroup('class')}>by class</Chip>
          <Chip active={group === 'name'} onClick={() => setGroup('name')}>by corridor</Chip>
        </div>
      </Section>

      <div className="tree scroll">
        {groups.map(([name, roads]) => {
          const isClass = Boolean(ROAD_CLASSES[name]);
          const open = !hidden[name];
          return (
            <div key={name} className="tree-group">
              <button type="button" className="tree-head" onClick={() => setHidden({ ...hidden, [name]: open })}>
                <span className="swatch" style={{ background: CLASS_COLOUR[name] || '#8d949c' }} />
                <b>{isClass ? ROAD_CLASSES[name].name : name}</b>
                <em>{roads.length}</em>
                {open ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              {open ? roads
                .slice()
                .sort((a, b) => polyLen(b) - polyLen(a))
                .slice(0, 60)
                .map((road) => (
                  <button
                    type="button"
                    key={road.id}
                    className={`tree-item${selection.roadId === road.id ? ' active' : ''}`}
                    onClick={() => onSelect({ roadId: road.id, nodeId: null })}
                    onDoubleClick={() => onFocus(road)}
                    title={`${road.name} · ${road.profileId} · ${road.points.length} points`}
                  >
                    <span className="mono id">{road.id}</span>
                    <span className="label">{road.name}</span>
                    <span className="len mono">{km(polyLen(road))}</span>
                    {road.spans?.length ? <span className="glyph" title={`${road.spans.length} structure span(s)`}>⌒</span> : null}
                  </button>
                )) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

function polyLen(road) {
  let d = 0;
  for (let i = 1; i < road.points.length; i += 1) {
    d += Math.hypot(road.points[i][0] - road.points[i - 1][0], road.points[i][2] - road.points[i - 1][2]);
  }
  return d;
}

/* ── generator (left) ─────────────────────────────────────────────────────────────────────────── */

export function GeneratePanel({ gen, setGen, onGenerate, report, timings, interchanges }) {
  const layouts = ['nfs-loop', 'grid', 'organic', 'radial', 'rural'];
  const charters = ['nfs-arterial', 'us-grid', 'euro-mixed', 'dutch', 'british', 'rural'];
  const classes = report?.classes || {};
  return (
    <>
      <Section title="City generator" right={<Chip onClick={() => setGen({ ...gen, seed: Math.floor(Math.random() * 1e9) })}><Shuffle size={12} /> seed</Chip>} dense>
        <Field label="Seed">
          <input className="input mono" type="number" value={gen.seed} onChange={(e) => setGen({ ...gen, seed: Number(e.target.value) })} />
        </Field>
        <Field label={`Map size — ${gen.size} m`}>
          <input type="range" min="1200" max="6000" step="200" value={gen.size} onChange={(e) => setGen({ ...gen, size: Number(e.target.value) })} />
        </Field>
        <Field label="Layout">
          <Select value={gen.layout} onChange={(v) => setGen({ ...gen, layout: v })} options={layouts} />
        </Field>
        <Field label="Charter">
          <Select value={gen.charter} onChange={(v) => setGen({ ...gen, charter: v })} options={charters} />
        </Field>
        <button type="button" className="btn wide" onClick={onGenerate}>Generate</button>
      </Section>

      <Section title="Generated network" dense>
        <Grid>
          <Metric label="carriageway" value={km(report?.metres || 0)} />
          <Metric label="roads" value={report?.roads ?? '—'} />
          <Metric label="junctions" value={report?.junctions ?? '—'} />
          <Metric label="terminals" value={report?.terminals ?? '—'} />
          <Metric label="triangles" value={(report?.triangles || 0).toLocaleString()} />
          <Metric label="per km" value={(report?.perKm || 0).toLocaleString()} />
        </Grid>
        <Row label="build">{timings ? `${timings.generate | 0} ms · ${timings.geometry | 0} ms geometry` : '—'}</Row>
        <Row label="interchanges">{interchanges} ribbon junctions · {report?.ramps ?? 0} ramps</Row>
      </Section>

      <Section title="Class mix" dense>
        {Object.entries(classes).sort((a, b) => CLASS_RANK[b[0]] - CLASS_RANK[a[0]]).map(([cls, count]) => (
          <div className="row" key={cls}>
            <span className="row-label"><span className="swatch" style={{ background: CLASS_COLOUR[cls] }} />{ROAD_CLASSES[cls]?.name || cls}</span>
            <span className="row-value mono">{count}</span>
          </div>
        ))}
      </Section>
    </>
  );
}

/* ── layers (left) ────────────────────────────────────────────────────────────────────────────── */

export function LayersPanel({ flags, setFlags, cam, setCam, detailSettings, setDetailSettings, notices }) {
  return (
    <>
      <Section title="Viewport layers" dense right={<span className="muted mono">paint order · ground → surface → markings → props</span>}>
        <Toggle checked={flags.terrain} onChange={(v) => setFlags({ ...flags, terrain: v })} label="Terrain + water" hint="Z">
        </Toggle>
        <Toggle checked={flags.kerbs} onChange={(v) => setFlags({ ...flags, kerbs: v })} label="Kerbs & kerb faces" />
        <Toggle checked={flags.markings} onChange={(v) => setFlags({ ...flags, markings: v })} label="Markings" hint="M" />
        <Toggle checked={flags.details} onChange={(v) => setFlags({ ...flags, details: v })} label="Furniture & detail props" hint="X" />
        <Toggle checked={flags.structures} onChange={(v) => setFlags({ ...flags, structures: v })} label="Bridges, walls, rail" />
        <Toggle checked={flags.grid} onChange={(v) => setFlags({ ...flags, grid: v })} label="Reference grid" />
      </Section>

      <Section title="Camera" dense>
        <Row label="pose" value={`${cam.x.toFixed(0)}, ${cam.y.toFixed(0)}, ${cam.z.toFixed(0)}`} />
        <Row label="yaw / pitch" value={`${(cam.yaw * 180 / Math.PI).toFixed(0)}° / ${(cam.pitch * 180 / Math.PI).toFixed(0)}°`} />
        <Field label={`Fly speed — ${cam.speed.toFixed(0)} m/s`}>
          <input type="range" min="6" max="400" step="2" value={cam.speed} onChange={(e) => setCam({ speed: Number(e.target.value) })} />
        </Field>
        <Field label={`Field of view — ${(cam.fov * 180 / Math.PI).toFixed(0)}°`}>
          <input type="range" min="35" max="95" step="1" value={cam.fov * 180 / Math.PI} onChange={(e) => setCam({ fov: Number(e.target.value) * Math.PI / 180 })} />
        </Field>
        <Field label={`View distance — ${cam.viewDistance} m`}>
          <input type="range" min="300" max="4000" step="50" value={cam.viewDistance} onChange={(e) => setCam({ viewDistance: Number(e.target.value) })} />
        </Field>
        <div className="keyrow">
          <span><KeyCap>W</KeyCap><KeyCap>A</KeyCap><KeyCap>S</KeyCap><KeyCap>D</KeyCap> travel</span>
          <span><KeyCap>Q</KeyCap><KeyCap>E</KeyCap> altitude</span>
          <span><KeyCap>⇧</KeyCap> sprint</span>
          <span><KeyCap>RMB</KeyCap> look</span>
        </div>
      </Section>

      <Section title="Detail generation" dense>
        {[
          ['furniture', 'Bollards, bins, benches, signs'],
          ['lighting', 'Street lighting columns'],
          ['humps', 'Speed bumps & raised junctions'],
          ['crossings', 'Pedestrian & cycle crossings'],
          ['bays', 'Bus stops, bays, loading'],
          ['rail', 'Rail crossings & protection'],
          ['subway', 'Subway entrances & stairs'],
          ['wear', 'Tyre wear & patched asphalt'],
        ].map(([key, label]) => (
          <Toggle key={key} checked={detailSettings[key] !== false} onChange={(v) => setDetailSettings({ ...detailSettings, [key]: v })} label={label} />
        ))}
      </Section>

      {notices?.length ? (
        <Section title="Notices" dense>
          {notices.map((n, i) => (
            <div className="notice" key={i}>{n}</div>
          ))}
        </Section>
      ) : null}
    </>
  );
}

/* ── road inspector (right) ───────────────────────────────────────────────────────────────────── */

export function RoadInspector({ project, road, onEdit, onFocus, selection, onSelectNode }) {
  if (!road) {
    return (
      <div className="empty">
        <Circle size={18} />
        <b>No road selected</b>
        <span>Click a road in the viewport or the network tree. <KeyCap>F</KeyCap> flies to the selection.</span>
      </div>
    );
  }
  const profile = project.profiles.find((p) => p.id === road.profileId) || project.profiles[0];
  const offsets = useMemo(() => profileOffsets(profile), [profile]);
  const cls = ROAD_CLASSES[road.class] || {};
  const details = road.details || {};
  const structure = (road.spans || []).map((s) => s.kind);
  const length = polyLen(road);

  return (
    <>
      <Section
        title={road.name}
        right={<span className="mono muted">{road.id}</span>}
        dense
      >
        <div className="chips">
          <span className="chip-static">{cls.name || road.class}</span>
          <span className="chip-static">{structure.length ? structure.join(' · ') : 'at grade'}</span>
          {road.oneway ? <span className="chip-static warn">one-way</span> : null}
        </div>
        <Grid cols={3}>
          <Metric label="length" value={km(length)} />
          <Metric label="width" value={num(profileWidth(profile), 1)} unit="m" />
          <Metric label="lanes" value={laneCount(profile)} />
        </Grid>
        <Row label="class">
          <Select
            value={road.class}
            onChange={(v) => onEdit('class', { road, value: v })}
            options={Object.keys(ROAD_CLASSES).map((k) => ({ value: k, label: `${ROAD_CLASSES[k].name} (${k})` }))}
          />
        </Row>
        <Row label="profile">
          <Select
            value={road.profileId}
            onChange={(v) => onEdit('profile', { road, value: v })}
            options={project.profiles.map((p) => ({ value: p.id, label: `${p.name}${p.class === road.class ? '' : ` · ${p.class}`}` }))}
          />
        </Row>
        <Row label="design speed">
          <Stepper value={road.speed || 0} step={5} min={10} max={130} digits={0} unit="km/h" onChange={(v) => onEdit('speed', { road, value: v })} />
        </Row>
        <Row label="gradient limit" value={`${((cls.grade?.[0] ?? 8)).toFixed(1)} %`} />
        <Row label="geometry" value={`${road.points.length} pts · ${(road.points.length - 1) > 0 ? num(length / (road.points.length - 1), 1) : '—'} m spacing`} />
        <Row label="nodes">
          <button type="button" className="link" onClick={() => onSelectNode(road.startNode)}>{road.startNode}</button>
          →
          <button type="button" className="link" onClick={() => onSelectNode(road.endNode)}>{road.endNode}</button>
        </Row>
        <div className="btnrow">
          <Chip onClick={() => onFocus(road)}>Fly to</Chip>
          <Chip onClick={() => onEdit('reverse', { road })}>Reverse</Chip>
          <Chip onClick={() => onEdit('oneway', { road })}>One-way</Chip>
          <Chip onClick={() => onEdit('split', { road })}>Split</Chip>
          <Chip tone="danger" onClick={() => onEdit('delete', { road })}>Delete</Chip>
        </div>
      </Section>

      <Section title="Cross-section" dense right={<span className="muted mono">{profile.name}</span>}>
        <StripBar offsets={offsets} strips={profile.right.concat(profile.left)} height={64}
          onSelect={(o) => onEdit('selectStrip', { road, strip: o.strip, side: o.side })} />
        <RoadStripList profile={profile} onEdit={(payload) => onEdit('strip', { road, ...payload })} />
        <Row label="kerb upstand" value={`${num(profileKerb(profile), 3)} m`} />
        <Row label="surfaces" value={`${(SURFACES[road.surface]?.name) || road.surface || 'asphalt'}`} />
      </Section>

      <Section title="Detail layer" dense right={<span className="muted mono">{Object.values(details).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0)} items</span>}>
        {Object.entries(details).length ? Object.entries(details).map(([key, list]) => (
          <Row key={key} label={key} value={Array.isArray(list) ? list.length : String(list)} />
        )) : <Row label="items" value="none — details disabled in the layer list" />}
      </Section>

      <Section title="Junction ends" dense>
        {[['start', road.startNode], ['end', road.endNode]].map(([which, id]) => {
          const node = project.nodes.find((n) => n.id === id);
          if (!node) return <Row key={which} label={which} value="unattached" />;
          return (
            <Row key={which} label={which}>
              <button type="button" className="link" onClick={() => onSelectNode(id)}>
                {node.type} · {node.control} · {node.arms.length} arms
              </button>
            </Row>
          );
        })}
      </Section>
    </>
  );
}

function RoadStripList({ profile, onEdit }) {
  const rows = [
    ...profile.left.map((s, i) => ({ s, side: 'left', i: profile.left.length - 1 - i })),
    ...profile.right.map((s, i) => ({ s, side: 'right', i })),
  ];
  return (
    <div className="striplist scroll">
      {rows.map(({ s, side, i }) => (
        <div className="striprow" key={s.id}>
          <span className="swatch" style={{ background: STRIP_COLOUR[s.type] || '#6f7681' }} />
          <span className="stripname">
            <select className="select slim" value={s.type} onChange={(e) => onEdit({ op: 'type', side, index: i, strip: s, value: e.target.value })}>
              {Object.entries(STRIP_TYPES).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
            </select>
          </span>
          <Stepper value={s.width} step={0.05} min={0} max={20} digits={2} unit=""
            onChange={(v) => onEdit({ op: 'width', side, index: i, strip: s, value: v })} />
          <button type="button" className="iconbtn" title="remove strip" onClick={() => onEdit({ op: 'remove', side, index: i, strip: s })}><X size={12} /></button>
        </div>
      ))}
      <div className="striprow addrow">
        <Chip onClick={() => onEdit({ op: 'add', side: 'right' })}>+ lane right</Chip>
        <Chip onClick={() => onEdit({ op: 'add', side: 'left' })}>+ lane left</Chip>
      </div>
    </div>
  );
}

function profileOffsets(profile) {
  // local copy of the core helper so the panel can render without importing the whole generator
  const out = [];
  let cursor = (profile.centre?.width || 0) / 2;
  for (const strip of profile.right) {
    out.push({ strip, side: 'right', from: cursor, to: cursor + strip.width });
    cursor += strip.width;
  }
  cursor = -(profile.centre?.width || 0) / 2;
  for (const strip of profile.left) {
    out.push({ strip, side: 'left', from: cursor - strip.width, to: cursor });
    cursor -= strip.width;
  }
  return out.sort((a, b) => a.from - b.from);
}

function profileWidth(profile) {
  const o = profileOffsets(profile);
  if (!o.length) return 0;
  return o[o.length - 1].to - o[0].from;
}

function laneCount(profile) {
  return profile.right.filter((s) => s.type === 'traffic' || s.type === 'bus').length
    + profile.left.filter((s) => s.type === 'traffic' || s.type === 'bus').length;
}

function profileKerb(profile) {
  const kerb = [...profile.right, ...profile.left].find((s) => s.type === 'kerb');
  return kerb ? (KERBS[kerb.kerb]?.upstand ?? 0.125) : 0;
}

/* ── junction inspector (right) ───────────────────────────────────────────────────────────────── */

export function JunctionInspector({ project, node, onEdit, onFocus }) {
  if (!node) {
    return (
      <div className="empty">
        <Circle size={18} />
        <b>No junction selected</b>
        <span>Pick a junction in the viewport — the inspector shows its control, radii, arms and lane movements.</span>
      </div>
    );
  }
  const arms = node.arms.map((arm) => {
    const road = project.roads.find((r) => r.id === arm.roadId);
    return { arm, road };
  });
  const plan = node.moves || [];
  return (
    <>
      <Section title={`Junction ${node.id}`} dense right={<span className="mono muted">{arms.length} arms</span>}>
        <Grid cols={3}>
          <Metric label="arms" value={arms.length} />
          <Metric label="type" value={node.type || '—'} />
          <Metric label="control" value={node.control || '—'} />
        </Grid>
        <Row label="position" value={`${node.x.toFixed(0)}, ${node.y.toFixed(1)}, ${node.z.toFixed(0)}`} />
        <Row label="type">
          <Select value={node.type || 'crossroads'} onChange={(v) => onEdit('type', { node, value: v })}
            options={Object.entries(JUNCTION_TYPES).map(([k, v]) => ({ value: k, label: `${v.name} (${v.arms ?? 'n'} arms)` }))} />
        </Row>
        <Row label="control">
          <Select value={node.control || 'yield'} onChange={(v) => onEdit('control', { node, value: v })}
            options={['uncontrolled', 'yield', 'all-way stop', 'signals', 'roundabout', 'priority', 'tram signals']} />
        </Row>
        <Row label="corner radius">
          <Stepper value={node.radius ?? 9} step={0.5} min={2} max={40} digits={1} onChange={(v) => onEdit('radius', { node, value: v })} />
        </Row>
        <Row label="pad" value={JUNCTION_TYPES[node.type]?.docs ? `${JUNCTION_TYPES[node.type].name} — ${JUNCTION_TYPES[node.type].docs.slice(0, 78)}…` : '—'} />
        <div className="btnrow">
          <Chip onClick={() => onFocus({ x: node.x, z: node.z, y: node.y, height: 42 })}>Fly to</Chip>
          <Chip onClick={() => onEdit('crossings', { node })}>Add crossings</Chip>
          <Chip tone="danger" onClick={() => onEdit('dissolve', { node })}>Dissolve</Chip>
        </div>
      </Section>

      <Section title="Approach plan" dense>
        <svg className="plan" viewBox="-90 -90 180 180" height="180">
          <circle cx="0" cy="0" r="86" fill="none" stroke="#282d34" />
          {arms.map(({ arm, road }) => {
            const a = Math.atan2(arm.dir ? arm.dir[1] : 0, arm.dir ? arm.dir[0] : 1);
            const w = road ? profileWidth(project.profiles.find((p) => p.id === road.profileId) || { right: [], left: [] }) / 2 : 3.5;
            const x = Math.cos(a) * 80;
            const y = Math.sin(a) * 80;
            const nx = -Math.sin(a);
            const ny = Math.cos(a);
            const colour = CLASS_COLOUR[road?.class] || '#8d949c';
            return (
              <g key={arm.roadId}>
                <line x1="0" y1="0" x2={x} y2={y} stroke={colour} strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />
                <polygon
                  points={`${x - nx * w},${y - ny * w} ${x + nx * w},${y + ny * w} ${nx * (w + 1.5)},${ny * (w + 1.5)} ${-nx * (w + 1.5)},${-ny * (w + 1.5)}`}
                  fill={colour} opacity="0.35" stroke={colour} strokeWidth="1"
                />
                <text x={x * 1.06} y={y * 1.06} fill="#aeb6c0" fontSize="7" textAnchor="middle" fontFamily="ui-monospace, monospace">
                  {road?.name?.split(' ')[0] || arm.roadId}
                </text>
              </g>
            );
          })}
          <circle cx="0" cy="0" r={node.radius ?? 9} fill="none" stroke="#ffd166" strokeWidth="1" />
        </svg>
      </Section>

      <Section title="Arms" dense>
        {arms.map(({ arm, road }) => (
          <div className="armrow" key={arm.roadId}>
            <span className="swatch" style={{ background: CLASS_COLOUR[road?.class] }} />
            <span className="armname">{road?.name || arm.roadId} <em>{arm.end === 0 ? 'start' : 'end'}</em></span>
            <span className="mono muted">{road ? `${laneCount(project.profiles.find((p) => p.id === road.profileId) || { right: [], left: [] })} lane` : '—'}</span>
            <span className="mono muted">{arm.angle !== undefined ? `${(arm.angle * 180 / Math.PI).toFixed(0)}°` : '—'}</span>
          </div>
        ))}
      </Section>

      {node.moves?.length ? (
        <Section title="Lane movements" dense right={<span className="muted mono">{node.moves.reduce((a, m) => a + (m.to || []).length, 0)} connections</span>}>
          {node.moves.slice(0, 14).map((m, i) => (
            <div className="armrow" key={i}>
              <span className="mono grow">in {m.from?.roadId || '—'}:{m.from?.lane ?? '—'}</span>
              <span className="mono muted">→</span>
              <span className="mono grow">{(m.to || []).map((t) => `${t.roadId}:${t.lane}`).join(', ')}</span>
            </div>
          ))}
        </Section>
      ) : null}
    </>
  );
}

/* ── catalogue (right) ────────────────────────────────────────────────────────────────────────── */

export function CataloguePanel() {
  const [tab, setTab] = useState('markings');
  const tabs = [
    ['markings', `Markings (${Object.keys(MARKING_KINDS).length})`],
    ['strips', `Strips (${Object.keys(STRIP_TYPES).length})`],
    ['details', `Detail (${Object.keys(DETAIL_TYPES).length})`],
    ['junctions', `Junctions (${Object.keys(JUNCTION_TYPES).length})`],
    ['structures', `Structures (${Object.keys(STRUCTURE_TYPES).length})`],
  ];
  return (
    <>
      <Section title="Engineering catalogue" dense right={<Badge>standards.js</Badge>}>
        <div className="chipline wrap">
          {tabs.map(([id, label]) => <Chip key={id} active={tab === id} onClick={() => setTab(id)}>{label}</Chip>)}
        </div>
        <span className="muted small">Every entry below is data, not a picture: the editor builds its geometry from these records, so a new surface or marking costs one object, not a rewrite.</span>
      </Section>

      <div className="scroll list">
        {tab === 'markings' ? Object.entries(MARKING_KINDS).map(([k, m]) => (
          <div className="catrow" key={k}>
            <span className="mono id">{k}</span>
            <span className="grow">
              <b>{m.name}</b>
              <em>{m.pattern} · {m.width} m{m.gap ? ` · gap ${m.gap} m` : ''}{m.duty ? ` · duty ${m.duty}` : ''}</em>
            </span>
            <span className="swatchline" style={{ background: m.colour }} />
          </div>
        )) : null}

        {tab === 'strips' ? Object.entries(STRIP_TYPES).map(([k, s]) => (
          <div className="catrow" key={k}>
            <span className="swatch" style={{ background: STRIP_COLOUR[k] || s.colour }} />
            <span className="grow">
              <b>{s.name}</b>
              <em>{num(s.defaultWidth, 2)} m default · {s.range[0]}–{s.range[1]} m</em>
              <em className="wrap">{s.docs}</em>
            </span>
          </div>
        )) : null}

        {tab === 'details' ? Object.entries(DETAIL_TYPES).map(([k, d]) => (
          <div className="catrow" key={k}>
            <span className="glyphbig">{k === 'bollard' ? '▮' : k.includes('hump') ? '⌒' : k.includes('rail') ? '✕' : k === 'tunnel' ? '◠' : '◈'}</span>
            <span className="grow">
              <b>{d.name}</b>
              <em>{d.family} · {d.size.join(' × ')} m</em>
              <em className="wrap">{d.variants ? d.variants.join(' · ') : d.docs}</em>
            </span>
          </div>
        )) : null}

        {tab === 'junctions' ? Object.entries(JUNCTION_TYPES).map(([k, j]) => (
          <div className="catrow" key={k}>
            <span className="mono id">{k}</span>
            <span className="grow">
              <b>{j.name}</b>
              <em>{j.arms ? `${j.arms} arms · ` : ''}{j.control} · cost {j.cost}</em>
              <em className="wrap">{j.docs}</em>
            </span>
          </div>
        )) : null}

        {tab === 'structures' ? Object.entries(STRUCTURE_TYPES).map(([k, s]) => (
          <div className="catrow" key={k}>
            <span className="glyphbig">{k === 'bridge' ? '⌒' : k === 'tunnel' ? '◠' : k === 'culvert' ? '▭' : '⌐'}</span>
            <span className="grow">
              <b>{s.name}</b>
              <em className="wrap">{s.kinds?.join(' · ')}</em>
              <em className="wrap">{s.docs}</em>
            </span>
          </div>
        )) : null}
      </div>
    </>
  );
}

/* ── gates / validation (right) ───────────────────────────────────────────────────────────────── */

export function GatesPanel({ report, onFlyTo, onRerun }) {
  if (!report) {
    return (
      <div className="empty">
        <AlertTriangle size={18} />
        <b>No report yet</b>
        <span>Generate a city to validate its topology.</span>
      </div>
    );
  }
  const score = Math.round((report.passed / report.total) * 100);
  return (
    <>
      <Section title="Topology gate" dense right={<Chip onClick={onRerun}>re-run</Chip>}>
        <div className="scoreline">
          <span className={`score ${report.fails ? 'warn' : 'ok'}`}>{score}%</span>
          <div className="scorebars">
            <Row label="rules" value={`${report.passed} / ${report.total} passing`} />
            <Row label="findings" value={`${report.fails} fail · ${report.warns} warn · ${report.infos} info`} />
          </div>
        </div>
      </Section>

      <div className="scroll list">
        {report.rules.map((rule) => {
          const tone = rule.severity === 'fail' ? 'fail' : rule.severity === 'warn' ? 'warn' : 'info';
          const state = rule.offenders.length === 0 ? 'pass' : tone;
          return (
            <div className={`rule ${state}`} key={rule.id}>
              <div className="rule-head">
                {state === 'pass' ? <CheckCircle2 size={13} /> : state === 'fail' ? <TriangleAlert size={13} /> : <AlertTriangle size={13} />}
                <b>{rule.name}</b>
                <span className="mono">{rule.offenders.length ? `${rule.offenders.length} × ${rule.severity || tone}` : 'pass'}</span>
              </div>
              <em>{rule.note}</em>
              {rule.offenders.slice(0, 6).map((o, i) => (
                <button type="button" key={i} className="offender" onClick={() => o.position && onFlyTo(o.position)}>
                  <span className="mono">{o.position ? `${o.position[0].toFixed(0)}, ${o.position[2].toFixed(0)}` : '—'}</span>
                  <span className="grow">{o.note || o.roadId || o.nodeId}</span>
                  <Move3d size={11} />
                </button>
              ))}
              {rule.offenders.length > 6 ? <em className="muted">+{rule.offenders.length - 6} more</em> : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── bottom bar ───────────────────────────────────────────────────────────────────────────────── */

export function StatusBar({ report, timings, cam, stats, interchanges, project, onOpenInspector }) {
  return (
    <footer className="statusbar">
      <span className="mono"><MapIcon size={12} /> {project ? `${project.roads.length} roads · ${project.nodes.length} junctions` : '—'}</span>
      <span className="mono"><Ruler size={12} /> {report ? `${num(report.metres / 1000, 1)} km` : '—'}</span>
      <span className="mono"><Layers size={12} /> {report ? `${(report.triangles || 0).toLocaleString()} tris · ${(report.perKm || 0).toLocaleString()}/km` : '—'}</span>
      <span className="mono"><Diamond size={12} /> {interchanges} interchanges</span>
      <span className="mono"><GitBranch size={12} /> {timings ? `${timings.total | 0} ms build` : '—'}</span>
      <span className="mono"><TrainFront size={12} /> rail {project?.rail?.length || 0}</span>
      <span className="mono"><Filter size={12} /> {stats.drawn} polys drawn</span>
      <span className="mono cam">x {cam.x.toFixed(0)} · y {cam.y.toFixed(0)} · z {cam.z.toFixed(0)} · {cam.speed.toFixed(0)} m/s</span>
      <button type="button" className="link right" onClick={onOpenInspector}><ListTree size={12} /> inspector</button>
    </footer>
  );
}

/* ── cross-section editor (right) ─────────────────────────────────────────────────────────────── */

const STRIP_RULES = {
  traffic: ['laneWidth', 'Lane'],
  bus: ['busLane', 'Bus lane'],
  cycle: ['cycleLane', 'Cycle lane'],
  'cycle-track': ['cycleLane', 'Cycle track'],
  footway: ['footway', 'Footway'],
  parking: ['parkingBay', 'Parking bay'],
  shoulder: ['laneWidth', 'Shoulder'],
};

export function SectionPanel({ project, road, onEdit, selectedStrip, onSelectStrip }) {
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  if (!project || !road) {
    return (
      <div className="empty">
        <Ruler size={18} />
        <b>Select a road to edit its cross-section</b>
        <span>Pick a road in the viewport, the tree, or press <KeyCap>C</KeyCap> after selecting one.</span>
      </div>
    );
  }
  const profile = project.profiles.find((p) => p.id === road.profileId) || project.profiles[0];
  const offsets = profileOffsets(profile);
  const library = project.profiles.filter((p) =>
    (classFilter === 'all' || p.class === classFilter)
    && (!query || `${p.name} ${p.id} ${p.tag || ''}`.toLowerCase().includes(query.toLowerCase())));
  const kerbToKerb = offsets.filter((o) => o.strip.type !== 'footway' && o.strip.type !== 'verge');
  const corridor = profileWidth(profile);
  const carriageway = kerbToKerb.length ? kerbToKerb[kerbToKerb.length - 1].to - kerbToKerb[0].from : 0;
  const warnings = [];
  for (const o of offsets) {
    const rule = STRIP_RULES[o.strip.type];
    if (!rule) continue;
    const limits = STRIP_LIMITS[rule[0]];
    if (limits && (o.strip.width < limits.min || o.strip.width > limits.max)) {
      warnings.push(`${rule[1]} ${o.strip.width.toFixed(2)} m outside ${limits.min}–${limits.max} m`);
    }
  }

  return (
    <>
      <Section title="Cross-section" dense right={<span className="mono muted">{profile.name}</span>}>
        <StripBar offsets={offsets} strips={profile.right.concat(profile.left)} height={72} selected={selectedStrip}
          onSelect={(o) => onSelectStrip?.(o.strip.id)} />
        <Grid cols={3}>
          <Metric label="corridor" value={num(corridor, 2)} unit="m" />
          <Metric label="kerb to kerb" value={num(carriageway, 2)} unit="m" />
          <Metric label="moving lanes" value={laneCount(profile)} />
        </Grid>
        <Row label="applied to" value={`${road.name} · ${road.id}`} />
        <Row label="kerb upstand" value={`${num(profileKerb(profile), 3)} m`} />
        {warnings.length ? (
          <div className="warnbox">
            <TriangleAlert size={12} />
            {warnings.slice(0, 4).map((w) => <em key={w}>{w}</em>)}
          </div>
        ) : (
          <div className="okbox"><CheckCircle2 size={12} /><em>Breadths inside the standard ranges</em></div>
        )}
      </Section>

      <Section title="Strips — outside in, both sides" dense>
        <div className="striplist scroll tall">
          {offsets.map((o, i) => {
            const side = o.side;
            const list = profile[side];
            const index = side === 'right' ? list.indexOf(o.strip) : list.length - 1 - list.indexOf(o.strip);
            const isKerb = o.strip.type === 'kerb';
            return (
              <div className={`striprow${selectedStrip === o.strip.id ? ' active' : ''}`} key={`${side}-${i}`} onClick={() => onSelectStrip?.(o.strip.id)}>
                <span className="swatch" style={{ background: STRIP_COLOUR[o.strip.type] || '#6f7681' }} />
                <span className="side mono">{o.side === 'right' ? 'R' : 'L'}</span>
                <select className="select slim" value={o.strip.type}
                  onChange={(e) => onEdit('strip', { road, op: 'type', side, index, strip: o.strip, value: e.target.value })}>
                  {Object.entries(STRIP_TYPES).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
                </select>
                <Stepper value={o.strip.width} step={0.05} min={0} max={20} digits={2} unit=""
                  onChange={(v) => onEdit('strip', { road, op: 'width', side, index, strip: o.strip, value: v })} />
                {isKerb ? (
                  <select className="select slim" value={o.strip.kerb || 'upstand'}
                    onChange={(e) => onEdit('strip', { road, op: 'kerbType', side, index, strip: o.strip, value: e.target.value })}>
                    {Object.entries(KERBS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
                  </select>
                ) : <span className="mono muted width-note">{num(o.from, 2)} → {num(o.to, 2)} m</span>}
                <button type="button" className="iconbtn" onClick={(e) => { e.stopPropagation(); onEdit('strip', { road, op: 'remove', side, index, strip: o.strip }); }}>
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="btnrow">
          <Chip onClick={() => onEdit('strip', { road, op: 'add', side: 'right' })}>+ lane right</Chip>
          <Chip onClick={() => onEdit('strip', { road, op: 'add', side: 'left' })}>+ lane left</Chip>
          <Chip onClick={() => onEdit('profile', { road, value: PROFILE_LIBRARY_FOR(road.class) })}>Reset to class preset</Chip>
        </div>
      </Section>

      <Section title="Preset library" dense right={<span className="muted mono">{library.length} of {project.profiles.length}</span>}>
        <div className="searchrow">
          <Search size={13} />
          <input value={query} placeholder="search presets…" onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="chipline wrap">
          <Chip active={classFilter === 'all'} onClick={() => setClassFilter('all')}>all</Chip>
          {Object.keys(ROAD_CLASSES).map((k) => (
            <Chip key={k} active={classFilter === k} onClick={() => setClassFilter(k)} title={ROAD_CLASSES[k].name}>{k}</Chip>
          ))}
        </div>
        <div className="presetlist scroll tall">
          {library.map((p) => (
            <button type="button" key={p.id} className={`presetrow${p.id === road.profileId ? ' active' : ''}`} onClick={() => onEdit('profile', { road, value: p.id })}>
              <span className="swatch" style={{ background: CLASS_COLOUR[p.class] }} />
              <span className="grow">
                <b>{p.name}</b>
                <em>{p.tag || p.class} · {num(profileWidth(p), 1)} m · {laneCount(p)} lane</em>
              </span>
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

const STRIP_LIMITS = {
  laneWidth: { min: 2.4, max: 4 },
  cycleLane: { min: 1.5, max: 2.5 },
  busLane: { min: 3, max: 3.6 },
  footway: { min: 1.5, max: 8 },
  parkingBay: { min: 1.8, max: 2.6 },
};

function PROFILE_LIBRARY_FOR(cls) {
  return (PROFILE_LIBRARY.find((p) => p.class === cls) || PROFILE_LIBRARY[0]).id;
}
