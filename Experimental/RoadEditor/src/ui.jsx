import React from 'react';

/* Small, dependency-free widgets. The editor is dense on purpose: this is a tool panel set for a
   native editor, not a marketing page. */

export function Section({ title, right, children, dense }) {
  return (
    <div className={`section${dense ? ' dense' : ''}`}>
      <div className="section-head">
        <span className="section-title">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Row({ label, value, title, children, mono = true }) {
  return (
    <div className="row" title={title}>
      <span className="row-label">{label}</span>
      <span className={`row-value${mono ? ' mono' : ''}`}>{children ?? value}</span>
    </div>
  );
}

export function Grid({ children, cols = 2 }) {
  return <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{children}</div>;
}

export function Metric({ label, value, unit, tone }) {
  return (
    <div className={`metric${tone ? ` ${tone}` : ''}`}>
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}{unit ? ` (${unit})` : ''}</span>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="box" />
      <span className="toggle-label">{label}</span>
    </label>
  );
}

export function Chip({ active, onClick, children, tone, title }) {
  return (
    <button type="button" title={title} className={`chip${active ? ' active' : ''}${tone ? ` ${tone}` : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

export function Stepper({ value, step = 1, min = 0, max = 999, onChange, digits = 2, unit = 'm' }) {
  const round = (v) => Math.round(v * 100) / 100;
  return (
    <span className="stepper">
      <button type="button" onClick={() => onChange(round(Math.max(min, value - step)))}>−</button>
      <span className="stepper-value mono">{value.toFixed(digits)}{unit ? <em>{unit}</em> : null}</span>
      <button type="button" onClick={() => onChange(round(Math.min(max, value + step)))}>+</button>
    </span>
  );
}

export function Select({ value, onChange, options, title }) {
  return (
    <select className="select" title={title} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
      ))}
    </select>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field" title={hint}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function Bar({ value, max, tone }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <span className="bar">
      <span className={`bar-fill${tone ? ` ${tone}` : ''}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

export function Badge({ children, tone }) {
  return <span className={`badge${tone ? ` ${tone}` : ''}`}>{children}</span>;
}

export function KeyCap({ children }) {
  return <kbd>{children}</kbd>;
}

/** The two-tone strip bar used by the cross-section editor and the road inspector. */
export function StripBar({ strips, offsets, selected, onSelect, height = 46 }) {
  if (!offsets.length) return null;
  const left = offsets[0].from;
  const right = offsets[offsets.length - 1].to;
  const span = right - left || 1;
  const W = 640;
  return (
    <svg className="stripbar" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" height={height}>
      <rect x="0" y="0" width={W} height={height} fill="#191c21" />
      {offsets.map((o, i) => {
        const x = ((o.from - left) / span) * W;
        const w = Math.max(1, ((o.to - o.from) / span) * W);
        const isKerb = o.strip.type === 'kerb';
        const base = o.strip.height ?? 0;
        const h = isKerb ? 12 : 16 + base * 24;
        const y = height - 16 - h;
        const colour = STRIP_COLOUR[o.strip.type] || '#6f7681';
        return (
          <g key={`${o.side}-${i}`} onClick={() => onSelect?.(o)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
            <rect x={x} y={y} width={w} height={h} fill={colour} stroke={selected === o.index ? '#ffd166' : 'rgba(0,0,0,0.45)'} strokeWidth={selected === o.index ? 2 : 1} />
            {w > 26 ? (
              <text x={x + w / 2} y={y - 4} fill="#c9ced6" fontSize="9" textAnchor="middle" fontFamily="ui-monospace, monospace">
                {o.strip.width.toFixed(2)}
              </text>
            ) : null}
          </g>
        );
      })}
      <line x1="0" y1={height - 16} x2={W} y2={height - 16} stroke="#2b3038" strokeWidth="1" />
      <line x1={((0 - left) / span) * W} y1="0" x2={((0 - left) / span) * W} y2={height} stroke="#3d444d" strokeDasharray="3 3" />
    </svg>
  );
}

export const STRIP_COLOUR = {
  traffic: '#3b3f46',
  bus: '#5a3a3a',
  cycle: '#2f4a3a',
  'cycle-track': '#2b4433',
  parking: '#41434a',
  loading: '#4a4340',
  shoulder: '#33363c',
  emergency: '#33363c',
  hardstrip: '#33363c',
  median: '#3c4a38',
  buffer: '#43464d',
  kerb: '#8b8f96',
  footway: '#5c626b',
  'pedestrian-area': '#5c626b',
  verge: '#3d5a35',
  'tree-lawn': '#3a5a30',
  planting: '#3a5a30',
  tactile: '#6a6f77',
  tram: '#4a4a52',
  drainage: '#3f4a52',
  guardrail: '#7a7f86',
  'noise-barrier': '#6b7078',
  railway: '#54463a',
  stairs: '#5a5f66',
  wall: '#6d7178',
};

export const CLASS_COLOUR = {
  motorway: '#e0a83c',
  expressway: '#e0a83c',
  arterial: '#e8e2d0',
  collector: '#b9bfc6',
  local: '#8d949c',
  lane: '#8d949c',
  service: '#7c8288',
  ramp: '#7fd6a0',
  busway: '#c98ad6',
  tramway: '#c98ad6',
  cycleway: '#6fd0a8',
  footway: '#7fa8d6',
  pedestrian: '#7fa8d6',
  'parking-aisle': '#6f747a',
};
