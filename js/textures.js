/* ═══════════════ FRONTIER TYRE FORGE — sidewall & blueprint painters ═══════════════ */
import { noisePattern } from './patterns.js';

/* draw text around a circle (tyre-lettering style) */
function ringText(ctx, cx, cy, rPx, text, px, color, { spacing = 0.62, start = 0, font = null } = {}) {
  ctx.fillStyle = color;
  ctx.font = font ?? `700 ${px}px 'Arial Narrow','Segoe UI',sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = (px * spacing) / rPx;
  const total = step * (text.length - 1);
  let a0 = start - total / 2;
  for (let i = 0; i < text.length; i++) {
    const ang = a0 + i * step;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillText(text[i], 0, -rPx);
    ctx.restore();
  }
}

/**
 * Sidewall branding texture. Square canvas, planar-mapped over the sidewalls.
 * Everything is derived from the real tyre dimensions (px per mm).
 */
export function drawSidewall(canvas, sz, opts) {
  const S = canvas.width;
  const ctx = canvas.getContext('2d');
  const cx = S / 2, cy = S / 2;
  const scale = (S / 2 - 6) / sz.Ro;
  const accent = opts.accent || '#e23b2e';
  const name = (opts.name || 'FRONTIER').toUpperCase();

  /* base rubber */
  ctx.fillStyle = '#191a1d';
  ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = noisePattern(ctx);
  ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = 1;

  /* soft radial sheen of a moulded sidewall */
  const g = ctx.createRadialGradient(cx, cy, sz.Rr * scale, cx, cy, sz.Ro * scale);
  g.addColorStop(0, 'rgba(0,0,0,.55)');
  g.addColorStop(0.45, 'rgba(70,74,80,.10)');
  g.addColorStop(0.8, 'rgba(0,0,0,.18)');
  g.addColorStop(1, 'rgba(0,0,0,.5)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, sz.Ro * scale, 0, Math.PI * 2); ctx.fill();

  /* faint concentric mould rings */
  ctx.strokeStyle = 'rgba(255,255,255,.028)';
  ctx.lineWidth = 1;
  for (let r = sz.Rr + 8; r < sz.Ro; r += 7) {
    ctx.beginPath(); ctx.arc(cx, cy, r * scale, 0, Math.PI * 2); ctx.stroke();
  }

  const ring = (rMM, wPx, color, alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = wPx;
    ctx.beginPath(); ctx.arc(cx, cy, rMM * scale, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  };

  /* accent racing stripe + trim rings */
  ring(sz.Ro * 0.965, 5, accent, 0.95);
  ring(sz.Ro * 0.925, 1.5, '#43464c', 1);
  ring(sz.Rr + 5, 3, accent, 0.8);
  ring(sz.Rr + 11, 1.2, '#43464c', 1);

  /* lettering rings */
  const brand = 'FRONTIER';
  const topLine = `${brand}  •  ${name}  •  ${brand}`;
  ringText(ctx, cx, cy, sz.Ro * 0.815 * scale, topLine, Math.max(20, sz.Ro * scale * 0.085), '#d3d6da', { spacing: 0.60 });
  ringText(ctx, cx, cy, sz.Ro * 0.635 * scale,
    `${sz.label}   •   RADIAL   •   TUBELESS   •   MAX 350 KPH`,
    Math.max(14, sz.Ro * scale * 0.052), '#aab0b8', { spacing: 0.60, start: Math.PI });

  /* load/speed spec near the bead */
  ringText(ctx, cx, cy, (sz.Rr + (sz.Ro - sz.Rr) * 0.42) * scale,
    'DOT FRT-26  •  ' + name.split(' ')[0] + ' COMPOUND',
    Math.max(11, sz.Ro * scale * 0.034), '#767c85', { spacing: 0.6, start: Math.PI });

  /* little triangle balancing marks */
  ctx.fillStyle = accent;
  for (const ang of [Math.PI / 2]) {
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, -sz.Ro * 0.945 * scale);
    ctx.lineTo(-6, -sz.Ro * 0.90 * scale);
    ctx.lineTo(6, -sz.Ro * 0.90 * scale);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

/* ═══ 2D cross-section blueprint with dimension callouts ═══ */
export function drawBlueprint(canvas, sz, prof) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d0f12';
  ctx.fillRect(0, 0, W, H);

  /* grid */
  ctx.strokeStyle = 'rgba(255,255,255,.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  const pad = 64;
  const scale = Math.min((W - pad * 2) / (sz.W + 40), (H - pad - 34) / (sz.Ro + 14));
  const baseY = H - 30;                       // axle centreline
  const sx = x => W / 2 + x * scale;
  const sy = r => baseY - r * scale;

  /* rim cross-section */
  const wr = sz.W * 0.36;                     // rim half width
  ctx.strokeStyle = '#6d7683';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx(-wr), sy(sz.Rr)); ctx.lineTo(sx(wr), sy(sz.Rr));
  ctx.stroke();
  for (const s of [-1, 1]) {                  // flanges
    ctx.beginPath();
    ctx.moveTo(sx(s * wr), sy(sz.Rr));
    ctx.lineTo(sx(s * (wr + 7)), sy(sz.Rr + 9));
    ctx.lineTo(sx(s * (wr + 10)), sy(sz.Rr + 2));
    ctx.stroke();
  }
  /* axle centre mark */
  ctx.strokeStyle = 'rgba(120,130,142,.7)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(sx(0), sy(0)); ctx.lineTo(sx(0), sy(sz.Rr)); ctx.stroke();
  ctx.beginPath(); ctx.arc(sx(0), sy(0), 3, 0, Math.PI * 2); ctx.stroke();

  /* tyre profile silhouette */
  const pts = prof.pts;
  if (pts.length) {
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(sx(p.x), sy(p.r)) : ctx.moveTo(sx(p.x), sy(p.r)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,87,34,.09)';
    ctx.fill();
    ctx.strokeStyle = '#ff5722';
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }

  const dim = '#ffb347', txt = '#9aa0a8';
  const arrowH = (y, x0, x1) => {
    ctx.strokeStyle = dim; ctx.fillStyle = dim; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    for (const [x, d] of [[x0, 1], [x1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + d * 6, y - 3.4); ctx.lineTo(x + d * 6, y + 3.4);
      ctx.closePath(); ctx.fill();
    }
  };
  const arrowV = (x, y0, y1) => {
    ctx.strokeStyle = dim; ctx.fillStyle = dim; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
    for (const [y, d] of [[y0, 1], [y1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x - 3.4, y + d * 6); ctx.lineTo(x + 3.4, y + d * 6);
      ctx.closePath(); ctx.fill();
    }
  };

  ctx.font = '11px monospace';
  ctx.textBaseline = 'middle';

  /* width dimension */
  const yW = sy(sz.Ro) - 16;
  arrowH(yW, sx(-sz.W / 2), sx(sz.W / 2));
  ctx.strokeStyle = 'rgba(255,179,71,.35)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(sx(-sz.W / 2), yW); ctx.lineTo(sx(-sz.W / 2), sy(sz.Ro * 0.6)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sx(sz.W / 2), yW); ctx.lineTo(sx(sz.W / 2), sy(sz.Ro * 0.6)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = dim; ctx.textAlign = 'center';
  ctx.fillText(`${sz.W} mm`, sx(0), yW - 9);

  /* sidewall height dimension */
  const xS = sx(sz.W / 2) + 26;
  arrowV(xS, sy(sz.Rr), sy(sz.Ro));
  ctx.save();
  ctx.translate(xS + 10, (sy(sz.Rr) + sy(sz.Ro)) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.round(sz.H)} mm`, 0, 0);
  ctx.restore();

  /* rim callout */
  ctx.fillStyle = txt; ctx.textAlign = 'left';
  ctx.fillText(`RIM R${sz.rimIn}″`, sx(-wr) - 8, sy(sz.Rr) + 16);

  /* caption */
  ctx.fillStyle = '#e8eaed'; ctx.textAlign = 'left';
  ctx.font = 'bold 13px monospace';
  ctx.fillText(sz.label, 12, 18);
  ctx.font = '10px monospace'; ctx.fillStyle = txt;
  ctx.fillText(`OD ${Math.round(sz.OD)} mm   CIRC ${Math.round(sz.circ)} mm   ${Math.round(sz.revPerKm)} rev/km`, 12, 34);
}
