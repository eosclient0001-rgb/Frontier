/* ═══════════════ FRONTIER TYRE FORGE — tread pattern engine ═══════════════
 * Treads are defined as lists of normalised "ops" (0..1 tile space).
 *   x = circumferential direction (tile wraps seamlessly around the tyre)
 *   y = across the tread face (0 = outer shoulder, 1 = inner shoulder)
 * The same renderer draws the 3D texture tile, the flat strip preview,
 * the preset thumbnails and the editor canvas.
 */
import { mulberry32 } from './tiremath.js';

/* ── rubber base + noise ─────────────────────────────────────── */
let _noisePat = null;
export function noisePattern(ctx) {
  if (_noisePat) return _noisePat;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const cc = c.getContext('2d');
  const img = cc.createImageData(96, 96);
  const rnd = mulberry32(0xC0FFEE);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 20 + (rnd() * 34) | 0;
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v + 3; img.data[i + 3] = 255;
  }
  cc.putImageData(img, 0, 0);
  _noisePat = ctx.createPattern(c, 'repeat');
  return _noisePat;
}

function fillBase(ctx, W, H) {
  ctx.fillStyle = '#212226';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = noisePattern(ctx);
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  /* shoulders fall away — slight darkening at tile edges */
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,.34)');
  g.addColorStop(0.12, 'rgba(0,0,0,0)');
  g.addColorStop(0.88, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,.34)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function strokeGroove(ctx, path, wPx, alpha) {
  if (wPx <= 0) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#0a0b0d';
  ctx.lineWidth = wPx;
  ctx.stroke(path);
  ctx.strokeStyle = '#030304';
  ctx.lineWidth = Math.max(0.7, wPx * 0.55);
  ctx.stroke(path);
  ctx.globalAlpha = 1;
}

function hexPath(cx, cy, r) {
  const p = new Path2D();
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 6) + k * (Math.PI / 3);      // pointy-top
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    k ? p.lineTo(x, y) : p.moveTo(x, y);
  }
  p.closePath();
  return p;
}

/* ── op drawing ──────────────────────────────────────────────── */
const MIRRORABLE = new Set(['hgroove', 'vgroove', 'sipes', 'circle', 'hex', 'diamond', 'dimples', 'erase']);

function mirrorOp(o) {
  const m = { ...o };
  switch (o.t) {
    case 'hgroove': case 'sipes': case 'circle': case 'hex':
    case 'diamond': case 'dimples': case 'erase':
      m.y = 1 - o.y; break;
    case 'vgroove':
      m.y0 = 1 - (o.y1 ?? 0.99); m.y1 = 1 - (o.y0 ?? 0.01); m.a = -(o.a || 0); break;
    case 'sipes':
      m.a = -(o.a || 0); break;
  }
  return m;
}

function drawOne(ctx, W, H, o, d) {
  /* d = remaining tread depth 0..1 — grooves narrow & fade as they wear */
  const alpha = (o.alpha ?? 1) * Math.pow(Math.max(d, 0), 0.7);
  const wf = Math.max(d, 0);
  switch (o.t) {

    case 'hgroove': {
      const wPx = Math.max(0.6, o.w * W * wf);
      const amp = (o.wave || 0) * H, freq = o.freq || 3, ph = o.seed || 0;
      const p = new Path2D();
      for (let x = -10; x <= W + 10; x += 6) {
        const y = o.y * H + amp * Math.sin((x / W) * Math.PI * 2 * freq + ph);
        x <= -10 ? p.moveTo(x, y) : p.lineTo(x, y);
      }
      strokeGroove(ctx, p, wPx, alpha);
      break;
    }

    case 'vgroove': {
      const wPx = Math.max(0.6, o.w * W * wf);
      const y0 = (o.y0 ?? 0.01) * H, y1 = (o.y1 ?? 0.99) * H;
      const tanA = Math.tan((o.a || 0) * Math.PI / 180);
      for (const dx of [-W, 0, W]) {
        const p = new Path2D();
        p.moveTo(o.x * W + tanA * (y0 - H / 2) + dx, y0);
        p.lineTo(o.x * W + tanA * (y1 - H / 2) + dx, y1);
        strokeGroove(ctx, p, wPx, alpha);
      }
      break;
    }

    case 'chevron': {
      const wPx = Math.max(0.8, o.w * W * wf);
      const ax = o.x * W, ay = H / 2;
      const back = Math.tan((o.a || 35) * Math.PI / 180) * (H / 2);
      for (const dx of [-W, 0, W]) {
        const p = new Path2D();
        p.moveTo(ax - back + dx, 2);
        p.lineTo(ax + dx, ay);
        p.lineTo(ax - back + dx, H - 2);
        strokeGroove(ctx, p, wPx, alpha);
      }
      break;
    }

    case 'sipes': {
      const n = o.n || 6;
      const wPx = Math.max(0.5, o.w * W * Math.max(d, 0.25));
      const len = (o.len || 0.085) * H;
      const dx = Math.tan((o.a || 20) * Math.PI / 180) * len;
      const yPx = o.y * H;
      for (let k = 0; k < n; k++) {
        const xc = ((k + 0.5) / n) * W;
        const p = new Path2D();
        p.moveTo(xc - dx / 2, yPx - len / 2);
        p.lineTo(xc - dx / 2 + len * 0.22, yPx - len / 6);
        p.lineTo(xc + dx / 2 - len * 0.22, yPx + len / 6);
        p.lineTo(xc + dx / 2, yPx + len / 2);
        strokeGroove(ctx, p, wPx, alpha);
      }
      break;
    }

    case 'circle': {
      const r = o.r * W * Math.max(d, 0.15);
      if (r <= 0.5) break;
      const p = new Path2D();
      p.arc(o.x * W, o.y * H, r, 0, Math.PI * 2);
      if (o.ring) strokeGroove(ctx, p, Math.max(0.8, (o.w || 0.02) * W * wf), alpha);
      else { ctx.globalAlpha = alpha; ctx.fillStyle = '#08090b'; ctx.fill(p); ctx.globalAlpha = 1; }
      break;
    }

    case 'hex': {
      const r = o.r * W * Math.max(d, 0.15);
      if (r <= 0.5) break;
      const p = hexPath(o.x * W, o.y * H, r);
      if (o.ring) strokeGroove(ctx, p, Math.max(0.8, (o.w || 0.018) * W * wf), alpha);
      else { ctx.globalAlpha = alpha; ctx.fillStyle = '#08090b'; ctx.fill(p); ctx.globalAlpha = 1; }
      break;
    }

    case 'diamond': {
      const r = o.r * W * Math.max(d, 0.15);
      if (r <= 0.5) break;
      const cx = o.x * W, cy = o.y * H;
      const p = new Path2D();
      p.moveTo(cx, cy - r); p.lineTo(cx + r, cy); p.lineTo(cx, cy + r); p.lineTo(cx - r, cy);
      p.closePath();
      if (o.ring) strokeGroove(ctx, p, Math.max(0.8, (o.w || 0.018) * W * wf), alpha);
      else { ctx.globalAlpha = alpha; ctx.fillStyle = '#08090b'; ctx.fill(p); ctx.globalAlpha = 1; }
      break;
    }

    case 'blocks': {
      const cols = o.cols || 5, rows = o.rows || 3;
      const gx = Math.max(0.7, o.gx * W * wf), gy = Math.max(0.7, o.gy * H * wf);
      const y0 = (o.y0 ?? 0.02) * H, y1 = (o.y1 ?? 0.98) * H;
      const rowH = (y1 - y0) / rows;
      for (let j = 0; j <= rows; j++) {
        const p = new Path2D();
        p.moveTo(-10, y0 + j * rowH); p.lineTo(W + 10, y0 + j * rowH);
        strokeGroove(ctx, p, gy, alpha);
      }
      for (let r = 0; r < rows; r++) {
        const off = o.stagger && r % 2 ? 0.5 / cols : 0;
        const yy0 = y0 + r * rowH, yy1 = yy0 + rowH;
        for (let c = 1; c < cols; c++) {
          const xg = ((c / cols) + off) * W;
          for (const dx of [-W, 0, W]) {
            const p = new Path2D();
            p.moveTo(xg + dx, yy0 - gy / 2); p.lineTo(xg + dx, yy1 + gy / 2);
            strokeGroove(ctx, p, gx, alpha);
          }
        }
      }
      break;
    }

    case 'dimples': {
      const n = o.n || 6;
      const r = o.r * W * Math.max(d, 0.15);
      if (r <= 0.4) break;
      ctx.globalAlpha = alpha; ctx.fillStyle = '#08090b';
      for (let k = 0; k < n; k++) {
        const p = new Path2D();
        p.arc(((k + 0.5) / n) * W, o.y * H, r, 0, Math.PI * 2);
        ctx.fill(p);
      }
      ctx.globalAlpha = 1;
      break;
    }

    case 'holes': { /* wear-indicator holes (slicks) */
      const r = o.r * W * Math.max(d, 0.1);
      if (r <= 0.3) break;
      ctx.globalAlpha = alpha; ctx.fillStyle = '#060708';
      for (const ry of (o.rows || [0.5])) {
        for (let k = 0; k < (o.n || 4); k++) {
          const p = new Path2D();
          p.arc(((k + 0.5) / (o.n || 4)) * W, ry * H, r, 0, Math.PI * 2);
          ctx.fill(p);
        }
      }
      ctx.globalAlpha = 1;
      break;
    }

    case 'hexgrid': {
      const r = o.r * W * Math.max(d, 0.2);
      const gap = (o.gap || 0.02) * W;
      const lw = Math.max(0.8, (o.w || 0.018) * W * wf);
      if (r <= 1) break;
      const dx = Math.sqrt(3) * r + gap, dy = 1.5 * r + gap * 0.87;
      const y0 = (o.y0 ?? 0.04) * H, y1 = (o.y1 ?? 0.96) * H;
      let row = 0;
      for (let y = y0 + r; y < y1; y += dy, row++) {
        const off = row % 2 ? dx / 2 : 0;
        for (let x = -dx; x < W + dx; x += dx) {
          strokeGroove(ctx, hexPath(x + off, y, r), lw, alpha);
        }
      }
      break;
    }

    case 'erase': {
      const r = o.r * W;
      if (r <= 0.5) break;
      const p = new Path2D();
      p.arc(o.x * W, o.y * H, r, 0, Math.PI * 2);
      ctx.fillStyle = '#212226'; ctx.fill(p);
      ctx.save(); ctx.clip(p);
      ctx.globalAlpha = 0.5; ctx.fillStyle = noisePattern(ctx);
      ctx.fillRect(0, 0, W, H);
      ctx.restore(); ctx.globalAlpha = 1;
      break;
    }
  }
}

function drawWearOverlay(ctx, W, H, wear) {
  /* rubber polishes smooth & lightens as it wears */
  ctx.globalAlpha = wear * 0.15;
  ctx.fillStyle = '#8f949c';
  ctx.fillRect(0, 0, W, H);
  const rnd = mulberry32(77 + Math.round(wear * 100));
  const streaks = Math.round(30 * wear);
  for (let i = 0; i < streaks; i++) {
    const y = rnd() * H, hgt = 1 + rnd() * 3;
    ctx.globalAlpha = 0.04 + rnd() * 0.13 * wear;
    ctx.fillStyle = rnd() < 0.5 ? '#b9bec6' : '#0d0e10';
    ctx.fillRect(0, y, W, hgt);
  }
  ctx.globalAlpha = 1;
}

/** Master renderer: ops → finished tread tile (includes wear). */
export function renderTread(ctx, W, H, ops, wear = 0, opts = {}) {
  fillBase(ctx, W, H);
  const d = 1 - wear * 0.92;                 // remaining groove depth
  for (const op of ops) {
    const versions = [op];
    if (opts.mirror && MIRRORABLE.has(op.t)) versions.push(mirrorOp(op));
    for (const v of versions) drawOne(ctx, W, H, v, d);
  }
  if (wear > 0.01) drawWearOverlay(ctx, W, H, wear);
}

/* ═══════════════ NAMED PRESETS ═══════════════ */
export const CATS = {
  slick:   { label: 'Slick',      color: '#ff4d5e' },
  semi:    { label: 'Semi-Slick', color: '#ff9f43' },
  street:  { label: 'Street',     color: '#54a0ff' },
  drift:   { label: 'Drift',      color: '#b46cf0' },
  wet:     { label: 'Wet / Grip', color: '#00d2d3' },
  offroad: { label: 'Off-Road',   color: '#c9a227' },
  winter:  { label: 'Winter',     color: '#cfd8e3' },
  concept: { label: 'Concept',    color: '#2ecc71' },
};

function hgroove(y, w, extra = {}) { return { t: 'hgroove', y, w, ...extra }; }

const build = {
  gzero: () => [
    { t: 'holes', r: 0.013, n: 4, rows: [0.40, 0.50, 0.60] },
    { t: 'holes', r: 0.010, n: 4, rows: [0.45, 0.55] },
  ],
  vapor: () => [
    hgroove(0.36, 0.014), hgroove(0.64, 0.014),
    hgroove(0.50, 0.008, { alpha: 0.8 }),
    { t: 'dimples', y: 0.50, r: 0.011, n: 8 },
    { t: 'dimples', y: 0.22, r: 0.009, n: 8 },
    { t: 'dimples', y: 0.78, r: 0.009, n: 8 },
  ],
  nighthawk: () => {
    const ops = [
      hgroove(0.32, 0.034), hgroove(0.45, 0.026),
      hgroove(0.55, 0.026), hgroove(0.68, 0.034),
    ];
    for (let k = 0; k < 6; k++)
      ops.push({ t: 'vgroove', x: (k + 0.5) / 6, w: 0.02, a: k % 2 ? 26 : -26, y0: 0.05, y1: 0.95, alpha: 0.85 });
    for (const y of [0.385, 0.50, 0.615])
      ops.push({ t: 'sipes', y, n: 10, w: 0.006, a: 22, len: 0.075 });
    return ops;
  },
  apexgt: () => {
    const ops = [
      hgroove(0.50, 0.036),
      hgroove(0.60, 0.028), hgroove(0.72, 0.030), hgroove(0.84, 0.026),
      { t: 'sipes', y: 0.66, n: 9, w: 0.005, a: 24, len: 0.07 },
      { t: 'sipes', y: 0.78, n: 9, w: 0.005, a: -24, len: 0.07 },
      { t: 'blocks', cols: 4, rows: 2, gx: 0.030, gy: 0.034, stagger: 1, y0: 0.06, y1: 0.46 },
    ];
    return ops;
  },
  slipstream: () => {
    const ops = [
      hgroove(0.50, 0.018),
      hgroove(0.12, 0.012), hgroove(0.88, 0.012),
      hgroove(0.24, 0.003, { alpha: 0.45 }), hgroove(0.76, 0.003, { alpha: 0.45 }),
      hgroove(0.33, 0.003, { alpha: 0.4 }), hgroove(0.67, 0.003, { alpha: 0.4 }),
    ];
    for (const y of [0.30, 0.40, 0.60, 0.70])
      ops.push({ t: 'sipes', y, n: 8, w: 0.005, a: 16, len: 0.085 });
    return ops;
  },
  smokescreen: () => {
    const ops = [
      hgroove(0.15, 0.020), hgroove(0.85, 0.020),
      { t: 'dimples', y: 0.36, r: 0.020, n: 7 },
      { t: 'dimples', y: 0.50, r: 0.024, n: 7 },
      { t: 'dimples', y: 0.64, r: 0.020, n: 7 },
    ];
    for (const y of [0.24, 0.76])
      ops.push({ t: 'sipes', y, n: 5, w: 0.007, a: 32, len: 0.11 });
    return ops;
  },
  hydrostorm: () => {
    const ops = [
      hgroove(0.08, 0.05), hgroove(0.92, 0.05), hgroove(0.50, 0.028),
    ];
    for (let k = 0; k < 8; k++)
      ops.push({ t: 'chevron', x: (k + 0.55) / 8, w: 0.048, a: 36 });
    return ops;
  },
  monsoon7: () => {
    const ops = [];
    for (const y of [0.18, 0.34, 0.50, 0.66, 0.82]) ops.push(hgroove(y, 0.05));
    for (let k = 0; k < 7; k++)
      ops.push({ t: 'vgroove', x: (k + 0.5) / 7, w: 0.03, a: 30, y0: 0.20, y1: 0.48 });
    return ops;
  },
  grizzlymagnum: () => {
    const ops = [
      { t: 'blocks', cols: 5, rows: 3, gx: 0.058, gy: 0.075, stagger: 1, y0: 0.14, y1: 0.86 },
    ];
    for (let k = 0; k < 5; k++) {
      ops.push({ t: 'vgroove', x: (k + 0.3) / 5, w: 0.075, a: 14, y0: 0.00, y1: 0.14 });
      ops.push({ t: 'vgroove', x: (k + 0.7) / 5, w: 0.055, a: -20, y0: 0.00, y1: 0.10, alpha: 0.9 });
    }
    ops.push(hgroove(0.50, 0.02));
    return ops;
  },
  mudraptor: () => {
    const ops = [];
    for (let k = 0; k < 5; k++)
      ops.push({ t: 'vgroove', x: (k + 0.5) / 5, w: 0.10, a: 38, y0: 0.10, y1: 0.90 });
    for (let k = 0; k < 4; k++)
      ops.push({ t: 'vgroove', x: (k + 0.9) / 4 % 1, w: 0.13, a: 12, y0: 0.00, y1: 0.16 });
    ops.push(hgroove(0.50, 0.016, { alpha: 0.8 }));
    return ops;
  },
  icefang: () => {
    const ops = [hgroove(0.33, 0.02), hgroove(0.67, 0.02)];
    let i = 0;
    for (let y = 0.08; y <= 0.94; y += 0.086, i++)
      ops.push({ t: 'sipes', y, n: 12, w: 0.005, a: i % 2 ? 28 : -28, len: 0.062 });
    return ops;
  },
  hexcore: () => [
    { t: 'hexgrid', r: 0.060, gap: 0.022, w: 0.017, y0: 0.10, y1: 0.90 },
    hgroove(0.05, 0.022), hgroove(0.95, 0.022),
    { t: 'hex', x: 0.5, y: 0.5, r: 0.03, ring: true, w: 0.01 },
  ],
  orbitals: () => {
    const ops = [
      { t: 'circle', x: 0.25, y: 0.5, r: 0.115, ring: true, w: 0.024 },
      { t: 'circle', x: 0.75, y: 0.5, r: 0.115, ring: true, w: 0.024 },
      { t: 'circle', x: 0.50, y: 0.5, r: 0.045 },
      { t: 'circle', x: 0.00, y: 0.5, r: 0.075, ring: true, w: 0.016 },
      { t: 'circle', x: 1.00, y: 0.5, r: 0.075, ring: true, w: 0.016 },
      { t: 'dimples', y: 0.10, r: 0.013, n: 9 },
      { t: 'dimples', y: 0.90, r: 0.013, n: 9 },
    ];
    return ops;
  },
};

export const PRESETS = [
  { id: 'gzero',         name: 'GZero',            cat: 'slick',   dry: 10, wet: 1, dur: 3, depth: 3,  rep: 10,
    desc: 'Qualifying compound. Zero grooves, maximum contact patch — pure dry grip.' },
  { id: 'vapor',         name: 'Vapor R-Comp',     cat: 'semi',    dry: 9,  wet: 3, dur: 4, depth: 4,  rep: 12,
    desc: 'Track-day R-compound with D.O.T.-style micro grooves and heat dimples.' },
  { id: 'nighthawk',     name: 'NightHawk Street', cat: 'street',  dry: 6,  wet: 7, dur: 8, depth: 7.5, rep: 14,
    desc: 'Four-channel directional street pattern with interlocking sipe rows.' },
  { id: 'apexgt',        name: 'Apex GT Asym',     cat: 'street',  dry: 8,  wet: 6, dur: 7, depth: 7,  rep: 12,
    desc: 'Asymmetric: grooved wet inner half, mega-block dry outer shoulder.' },
  { id: 'slipstream',    name: 'Slipstream DK',    cat: 'drift',   dry: 5,  wet: 2, dur: 9, depth: 5,  rep: 14,
    desc: 'Hard compound, shallow sipes. Built to slide, built to smoke.' },
  { id: 'smokescreen',   name: 'Smokescreen',      cat: 'drift',   dry: 4,  wet: 2, dur: 8, depth: 5,  rep: 12,
    desc: 'Dimple-matrix drift tyre tuned for maximum haze on command.' },
  { id: 'hydrostorm',    name: 'HydroStorm V',     cat: 'wet',     dry: 5,  wet: 10, dur: 6, depth: 9, rep: 12,
    desc: 'Directional V-channels that pump water out of the footprint at speed.' },
  { id: 'monsoon7',      name: 'Monsoon 7',        cat: 'wet',     dry: 4,  wet: 9, dur: 7, depth: 10, rep: 14,
    desc: 'Five deep circumferential reservoirs with lateral evacuation scoops.' },
  { id: 'grizzlymagnum', name: 'Grizzly Magnum',   cat: 'offroad', dry: 7,  wet: 5, dur: 9, depth: 12, rep: 9,
    desc: 'Chunky staggered lugs and biting shoulder claws for gravel and rally.' },
  { id: 'mudraptor',     name: 'MudRaptor X',      cat: 'offroad', dry: 5,  wet: 6, dur: 8, depth: 13, rep: 8,
    desc: 'High-void mud claw with self-cleaning diagonal scoops.' },
  { id: 'icefang',       name: 'IceFang',          cat: 'winter',  dry: 3,  wet: 8, dur: 7, depth: 9, rep: 14,
    desc: 'A thousand alternating sipes clawing into snow, slush and black ice.' },
  { id: 'hexcore',       name: 'HexCore',          cat: 'concept', dry: 6,  wet: 6, dur: 6, depth: 6, rep: 10,
    desc: 'Honeycomb show tyre. Style first, physics second.' },
  { id: 'orbitals',      name: 'Orbit Rings',      cat: 'concept', dry: 6,  wet: 5, dur: 6, depth: 6, rep: 10,
    desc: 'Circular orbital groove concept — a space-age show tread.' },
].map(p => ({ ...p, build: build[p.id] }));

export const presetById = id => PRESETS.find(p => p.id === id);
export const cloneOps = ops => JSON.parse(JSON.stringify(ops));
