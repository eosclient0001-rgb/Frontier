import React, { useEffect, useRef } from 'react';

export function NoiseThumb({ params, height = 78 }) {
  const ref = useRef(null);
  useEffect(() => {
    let alive = true;
    const canvas = ref.current;
    if (!canvas) return undefined;
    import('../engine/noise-ref.js').then(({ fractalThumbnail }) => {
      if (!alive || !ref.current) return;
      const { data, width, height: h } = fractalThumbnail(params, 264, 152);
      const ctx = ref.current.getContext('2d');
      const img = new ImageData(data, width, h);
      // Draw at 2x so the thumbnail stays crisp; the noise is band-limited so upscaling is safe.
      const tmp = document.createElement('canvas');
      tmp.width = width;
      tmp.height = h;
      tmp.getContext('2d').putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    });
    return () => { alive = false; };
  }, [JSON.stringify(params)]);
  return (
    <div className="graphic-frame" style={{ padding: 0, overflow: 'hidden' }}>
      <canvas
        ref={ref}
        width={264}
        height={152}
        style={{ width: '100%', height, display: 'block', borderRadius: 9 }}
      />
    </div>
  );
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function MaskBand({ min = 0, max = 1, feather = 0.08, invert = false, label = 'value' }) {
  const W = 300;
  const H = 62;
  const pad = 8;
  const f = Math.max(feather, 1e-4);
  const mask = (v) => {
    let m = smoothstep(min - f, min + f, v) * (1 - smoothstep(max - f, max + f, v));
    if (invert) m = 1 - m;
    return m;
  };
  const pts = [];
  for (let i = 0; i <= 96; i++) {
    const v = i / 96;
    const x = pad + v * (W - pad * 2);
    const y = H - pad - mask(v) * (H - pad * 2 - 12);
    pts.push(`${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  const area = `${pts.join(' ')} L${W - pad} ${H - pad} L${pad} ${H - pad} Z`;
  const loX = pad + min * (W - pad * 2);
  const hiX = pad + max * (W - pad * 2);
  return (
    <svg className="graphic" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} band ${min} to ${max}`}>
      <rect x={pad} y={pad} width={W - pad * 2} height={H - pad * 2} rx="6" fill="#1a1a1a" />
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={pad + g * (W - pad * 2)} y1={pad} x2={pad + g * (W - pad * 2)} y2={H - pad}
          stroke="#2b2b2b" strokeDasharray="2 4" />
      ))}
      <path d={area} fill="url(#maskFill)" opacity="0.5" />
      <path d={pts.join(' ')} fill="none" stroke="#d2d2d2" strokeWidth="1.4" />
      <line x1={loX} y1={pad} x2={loX} y2={H - pad} stroke="#6f6f6f" strokeWidth="1" strokeDasharray="3 3" />
      <line x1={hiX} y1={pad} x2={hiX} y2={H - pad} stroke="#6f6f6f" strokeWidth="1" strokeDasharray="3 3" />
      <defs>
        <linearGradient id="maskFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8f8f8f" />
          <stop offset="100%" stopColor="#8f8f8f" stopOpacity="0" />
        </linearGradient>
      </defs>
      <text x={pad + 2} y={H - 1} fill="#5f5f5f" fontSize="8">0</text>
      <text x={W - pad - 6} y={H - 1} fill="#5f5f5f" fontSize="8">1</text>
    </svg>
  );
}

export function SunDial({ elevation, azimuth }) {
  const size = 168;
  const c = size / 2;
  const r = c - 14;
  const el = Math.max(-6, Math.min(90, elevation));
  const rad = (1 - Math.max(0, el) / 90) * r;
  const ang = ((azimuth - 90) * Math.PI) / 180;
  // North is up, azimuth runs clockwise.
  const sx = c + Math.sin((azimuth * Math.PI) / 180) * rad;
  const sy = c - Math.cos((azimuth * Math.PI) / 180) * rad;
  const warm = 1 - Math.max(0, Math.sin((el * Math.PI) / 180));
  const colour = `rgb(255, ${Math.round(255 - warm * 66)}, ${Math.round(255 - warm * 132)})`;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', display: 'block' }} role="img"
      aria-label={`Sun at ${Math.round(elevation)} degrees elevation, ${Math.round(azimuth)} degrees azimuth`}>
      <circle cx={c} cy={c} r={r} fill="#191919" stroke="#2e2e2e" />
      <circle cx={c} cy={c} r={r * 0.66} fill="none" stroke="#242424" />
      <circle cx={c} cy={c} r={r * 0.33} fill="none" stroke="#242424" />
      <line x1={c - r} y1={c} x2={c + r} y2={c} stroke="#242424" />
      <line x1={c} y1={c - r} x2={c} y2={c + r} stroke="#242424" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const p = ((a * Math.PI) / 180);
        return (
          <line key={a}
            x1={c + Math.sin(p) * (r - 5)} y1={c - Math.cos(p) * (r - 5)}
            x2={c + Math.sin(p) * r} y2={c - Math.cos(p) * r} stroke="#3a3a3a" />
        );
      })}
      <text x={c} y={13} fill="#5e5e5e" fontSize="8" textAnchor="middle">N</text>
      <text x={c} y={size - 4} fill="#5e5e5e" fontSize="8" textAnchor="middle">S</text>
      <text x={size - 6} y={c + 3} fill="#5e5e5e" fontSize="8" textAnchor="end">E</text>
      <text x={6} y={c + 3} fill="#5e5e5e" fontSize="8">W</text>
      <line x1={c} y1={c} x2={sx} y2={sy} stroke="#4a4a4a" strokeDasharray="2 3" />
      <circle cx={sx} cy={sy} r={10} fill={colour} opacity="0.16" />
      <circle cx={sx} cy={sy} r={4} fill={colour} />
      <text x={c} y={c + r + 12} fill="#6a6a6a" fontSize="8.5" textAnchor="middle">
        {el <= 0 ? 'below horizon' : `${Math.round(azimuth)}° / ${Math.round(el)}° elevation`}
      </text>
    </svg>
  );
}

export function SlopeDiagram({ min, max }) {
  const W = 300;
  const H = 74;
  return (
    <svg className="graphic" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`slope band ${min} to ${max}`}>
      <rect x="0" y="0" width={W} height={H} rx="7" fill="#191919" />
      {Array.from({ length: 26 }, (_, i) => {
        const t = i / 25;
        const angle = t * 78;
        const x = 12 + t * (W - 74);
        const len = 30;
        const rad = (angle * Math.PI) / 180;
        const on = t >= min / 1 && t <= max;
        return (
          <g key={i}>
            <line x1={x} y1={H - 16} x2={x + Math.cos(rad) * len} y2={H - 16 - Math.sin(rad) * len}
              stroke={on ? '#cfcfcf' : '#3a3a3a'} strokeWidth={on ? 1.6 : 1.2} />
          </g>
        );
      })}
      <text x="12" y="14" fill="#5f5f5f" fontSize="8">flat</text>
      <text x={W - 30} y="14" fill="#5f5f5f" fontSize="8">vertical</text>
    </svg>
  );
}

export function AltitudeDiagram({ min, max, snow }) {
  const W = 300;
  const H = 74;
  const y0 = 8;
  const y1 = H - 14;
  const toY = (t) => y1 - t * (y1 - y0);
  return (
    <svg className="graphic" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`altitude band ${min} to ${max}`}>
      <rect x="0" y="0" width={W} height={H} rx="7" fill="#191919" />
      <defs>
        <linearGradient id="altRamp" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#3c4a35" />
          <stop offset="45%" stopColor="#6a6350" />
          <stop offset="72%" stopColor="#8b8378" />
          <stop offset="100%" stopColor="#e8eef4" />
        </linearGradient>
      </defs>
      <rect x="34" y={y0} width="26" height={y1 - y0} fill="url(#altRamp)" rx="3" />
      <rect x="34" y={toY(max)} width="26" height={Math.max(1, toY(min) - toY(max))}
        fill="none" stroke="#e2e2e2" strokeWidth="1.5" rx="2" />
      <line x1="30" y1={toY(max)} x2={W - 8} y2={toY(max)} stroke="#5c5c5c" strokeDasharray="3 3" />
      <line x1="30" y1={toY(min)} x2={W - 8} y2={toY(min)} stroke="#5c5c5c" strokeDasharray="3 3" />
      <text x={W - 8} y={toY(max) - 3} fill="#8b8b8b" fontSize="8" textAnchor="end">high {max.toFixed(2)}</text>
      <text x={W - 8} y={toY(min) + 9} fill="#8b8b8b" fontSize="8" textAnchor="end">low {min.toFixed(2)}</text>
    </svg>
  );
}

export function MaterialChip({ a, b, rough, size = 22 }) {
  const gloss = 1 - Math.min(1, rough ?? 0.7);
  return (
    <div
      className="layer-swatch"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${a} 0%, ${a} 38%, ${b} 100%)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,${0.05 + gloss * 0.22}), inset 0 -1px 0 rgba(0,0,0,0.35)`,
      }}
    />
  );
}
