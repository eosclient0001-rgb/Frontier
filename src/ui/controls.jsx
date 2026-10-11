import React, { useMemo } from 'react';

export function Card({ title, icon: Icon, accent, note, right, children }) {
  return (
    <div className="card" style={accent ? { '--accent': accent } : undefined}>
      {title && (
        <div className="card-head">
          <span>{Icon ? <Icon size={15} /> : null}{title}</span>
          {right}
        </div>
      )}
      {note && <p className="card-note">{note}</p>}
      {children}
    </div>
  );
}

export function Slider({
  label, value, min, max, step = 0.01, unit = '', hint, onChange,
  decimals, format, disabled,
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const shown = format
    ? format(value)
    : decimals !== undefined
      ? value.toFixed(decimals)
      : Number.isInteger(step) && step >= 1
        ? String(Math.round(value))
        : String(Math.round(value * 1000) / 1000);
  return (
    <div className="field" style={disabled ? { opacity: 0.45, pointerEvents: 'none' } : undefined}>
      <div className="field-head">
        <span>{label}</span>
        <span className="v">{shown}{unit && <span className="u">{unit}</span>}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--progress': `${Math.max(0, Math.min(100, pct))}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export function Toggle({ label, value, onChange, hint }) {
  return (
    <div>
      <div className="row">
        <span>{label}</span>
        <button
          className={`toggle${value ? ' on' : ''}`}
          onClick={() => onChange(!value)}
          role="switch"
          aria-checked={value}
          aria-label={label}
        >
          <span />
        </button>
      </div>
      {hint && <div className="field-hint" style={{ marginTop: 0 }}>{hint}</div>}
    </div>
  );
}

export function Select({ label, value, options, onChange, hint }) {
  return (
    <div className="field">
      {label && <div className="field-head"><span>{label}</span></div>}
      <select className="select" value={value} onChange={(e) => onChange(parseOptions(options, e.target.value))}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

function parseOptions(options, raw) {
  const numeric = Number(raw);
  const match = options.find((o) => String(o.id) === raw || o.id === numeric);
  return match ? match.id : numeric;
}

export function NumberField({ label, value, step = 1, min, max, onChange }) {
  return (
    <div className="field">
      <div className="field-head"><span>{label}</span></div>
      <input
        className="number"
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
      />
    </div>
  );
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function ColorField({ label, value, onChange }) {
  const [text, setText] = React.useState(value);
  React.useEffect(() => setText(value), [value]);
  return (
    <div className="field">
      {label && <div className="field-head"><span>{label}</span></div>}
      <div className="color-field">
        <input type="color" value={HEX.test(value) ? value : '#888888'} onChange={(e) => onChange(e.target.value)} />
        <input
          className="color-hex"
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            if (HEX.test(e.target.value)) onChange(e.target.value);
          }}
          onBlur={() => setText(value)}
        />
      </div>
    </div>
  );
}

export function Seg({ value, options, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

// Renders one entry from an operator's field list. The inspector never knows the field names —
// the schema drives it.
export function SchemaField({ field, value, onChange }) {
  const { key, label, min, max, step, unit, hint, type, options } = field;
  if (type === 'select') {
    return <Select key={key} label={label} value={value} options={options} onChange={onChange} hint={hint} />;
  }
  if (type === 'toggle') {
    return <Toggle key={key} label={label} value={!!value} onChange={onChange} hint={hint} />;
  }
  if (type === 'int') {
    return (
      <NumberField
        key={key}
        label={label}
        value={Math.round(value)}
        step={1}
        min={min}
        max={max}
        onChange={(v) => onChange(Math.round(v))}
      />
    );
  }
  return (
    <Slider
      key={key}
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      unit={unit}
      hint={hint}
      onChange={onChange}
      decimals={step >= 1 ? 0 : undefined}
    />
  );
}

export function useDebounced(fn, delay) {
  const ref = React.useRef();
  return useMemo(
    () => (...args) => {
      clearTimeout(ref.current);
      ref.current = setTimeout(() => fn(...args), delay);
    },
    [fn, delay]
  );
}
