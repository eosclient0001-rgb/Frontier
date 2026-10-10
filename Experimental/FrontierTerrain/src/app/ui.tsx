// Shared UI primitives, styled after the FrontierEditor design system:
// graphite cards, 3px range tracks, 29x17 toggles, small pills, metric numbers.
import type { CSSProperties, ReactNode } from 'react';

export function decimalsOf(step: number): number {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

export function Slider(props: {
  label: string; value: number; min: number; max: number; step?: number;
  unit?: string; onChange: (v: number) => void; onCommit?: () => void; hint?: string; compact?: boolean;
}) {
  const { label, value, min, max, unit = '', hint } = props;
  const step = props.step ?? 1;
  const dec = decimalsOf(step);
  const prog = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <label className={`slider ${props.compact ? 'compact' : ''}`}>
      <div className="slider-top">
        <span>{label}</span>
        <div className="slider-val">
          {value.toFixed(dec)}
          {unit && <small>{unit}</small>}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--progress': `${Math.min(100, Math.max(0, prog))}%` } as CSSProperties}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
        onPointerUp={props.onCommit}
      />
      {hint && <div className="slider-hint">{hint}</div>}
    </label>
  );
}

export function Toggle(props: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      className={`toggle ${props.on ? 'on' : ''}`}
      aria-pressed={props.on}
      aria-label={props.label}
      onClick={() => props.onChange(!props.on)}
      type="button"
    >
      <span />
    </button>
  );
}

export function ToggleRow(props: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle-row">
      <span>{props.label}</span>
      <Toggle on={props.on} onChange={props.onChange} label={props.label} />
    </div>
  );
}

export function Pills<T extends string | number>(props: {
  options: { id: T; label: string; sub?: string; color?: string }[];
  value: T; onChange: (v: T) => void; wrap?: boolean; className?: string;
}) {
  return (
    <div className={`pills ${props.wrap ? 'wrap' : ''} ${props.className ?? ''}`}>
      {props.options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          className={`pill ${o.id === props.value ? 'active' : ''}`}
          onClick={() => props.onChange(o.id)}
          title={o.sub}
        >
          {o.color && <i style={{ background: o.color }} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Card(props: {
  title: string; icon?: ReactNode; right?: ReactNode; children: ReactNode; wide?: boolean; className?: string;
}) {
  return (
    <section className={`card ${props.wide ? 'wide-card' : ''} ${props.className ?? ''}`}>
      <div className="card-heading">
        <span>{props.icon}{props.title}</span>
        {props.right}
      </div>
      {props.children}
    </section>
  );
}

export function SectionLabel(props: { left: string; right?: string }) {
  return (
    <div className="section-label">
      <span>{props.left}</span>
      {props.right && <span>{props.right}</span>}
    </div>
  );
}

export function Metric(props: { value: string; unit?: string; caption?: string }) {
  return (
    <div>
      <div className="metric">
        {props.value}
        {props.unit && <small>{props.unit}</small>}
      </div>
      {props.caption && <p className="muted">{props.caption}</p>}
    </div>
  );
}
