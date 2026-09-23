/* ═══════════════ FRONTIER TYRE FORGE — tread editor ═══════════════
 * Draw grooves / chevrons / circles / hexagons / blocks directly on a
 * wrapping tile. The tile feeds the same renderer used by the 3D tyre.
 */
import { renderTread, cloneOps } from './patterns.js';

export class TreadEditor {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;                       // { state, ensureCustom(), refresh() }
    this.tool = 'hgroove';
    this.undoStack = [];
    this.stroke = null;                   // op currently being dragged
    this.anchor = null;
    this.lastErase = null;

    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', () => this.up());

    document.querySelectorAll('#toolBar button').forEach(b => {
      b.addEventListener('click', () => this.setTool(b.dataset.tool));
    });
    this.setTool('hgroove');
    this.render();
  }

  /* ── helpers ─────────────────────────────────── */
  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }
  P(id) { return parseFloat(document.getElementById(id).value); }
  snapshot() {
    this.undoStack.push(JSON.stringify(this.app.state.ops));
    if (this.undoStack.length > 60) this.undoStack.shift();
  }
  setTool(t) {
    this.tool = t;
    document.querySelectorAll('#toolBar button').forEach(b =>
      b.classList.toggle('on', b.dataset.tool === t));
  }

  /* ── pointer interaction ─────────────────────── */
  down(e) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.app.ensureCustom();
    this.snapshot();
    const p = this.pos(e);
    const EW = this.P('sEW'), ES = this.P('sES'), EA = this.P('sEA'), EN = this.P('sEN');
    const ops = this.app.state.ops;
    let op = null;

    switch (this.tool) {
      case 'hgroove': op = { t: 'hgroove', y: p.y, w: EW, wave: 0.006, freq: 3, seed: Math.random() * 6 }; break;
      case 'vgroove': op = { t: 'vgroove', x: p.x, w: EW, a: EA, y0: 0.02, y1: 0.98 }; break;
      case 'chevron': op = { t: 'chevron', x: p.x, w: Math.max(EW, 0.02), a: Math.max(12, Math.abs(EA)) }; break;
      case 'sipes':   op = { t: 'sipes', y: p.y, n: EN + 4, w: Math.max(0.004, EW * 0.25), a: EA, len: 0.085 }; break;
      case 'circle':  op = { t: 'circle', x: p.x, y: p.y, r: ES, ring: true, w: EW }; break;
      case 'hex':     op = { t: 'hex', x: p.x, y: p.y, r: ES, ring: true, w: EW }; break;
      case 'diamond': op = { t: 'diamond', x: p.x, y: p.y, r: ES, ring: true, w: EW }; break;
      case 'dimples': op = { t: 'dimples', y: p.y, r: Math.max(0.008, ES * 0.4), n: EN + 3 }; break;
      case 'blocks': {
        const i = ops.findIndex(o => o.t === 'blocks');
        if (i >= 0) ops.splice(i, 1);
        op = { t: 'blocks', cols: EN, rows: Math.max(2, Math.round(EN * 0.5)),
               gx: EW, gy: EW * 1.25, stagger: 1, y0: 0.03, y1: 0.97 };
        break;
      }
      case 'erase':
        op = { t: 'erase', x: p.x, y: p.y, r: Math.max(ES, 0.03) };
        this.lastErase = p;
        break;
    }
    if (op) { ops.push(op); this.stroke = op; this.anchor = p; }
    this.app.refresh();
    this.render();
  }

  move(e) {
    if (!this.stroke) return;
    const p = this.pos(e);
    const op = this.stroke;
    switch (op.t) {
      case 'hgroove': case 'sipes': case 'dimples': op.y = p.y; break;
      case 'vgroove': case 'chevron': op.x = p.x; break;
      case 'circle': case 'hex': case 'diamond':
        op.r = Math.max(0.012, Math.hypot(p.x - this.anchor.x, p.y - this.anchor.y));
        break;
      case 'erase': {
        const d = Math.hypot(p.x - this.lastErase.x, p.y - this.lastErase.y);
        if (d > op.r * 0.65) {
          this.app.state.ops.push({ t: 'erase', x: p.x, y: p.y, r: op.r });
          this.lastErase = p;
        }
        break;
      }
    }
    this.app.refresh();
    this.render();
  }

  up() { this.stroke = null; this.lastErase = null; }

  /* ── actions ─────────────────────────────────── */
  undo() {
    if (!this.undoStack.length) return;
    this.app.state.ops = JSON.parse(this.undoStack.pop());
    this.app.ensureCustom();
    this.app.refresh();
    this.render();
  }
  clear() {
    this.app.ensureCustom();
    this.snapshot();
    this.app.state.ops.length = 0;
    this.app.refresh();
    this.render();
  }
  importCurrent() {
    this.app.state.ops = cloneOps(this.app.state.ops);
    this.app.state.source = 'editor';
    this.app.refresh();
    this.render();
  }

  exportPNG(wear) {
    const T = 640, reps = 3;
    const c = document.createElement('canvas');
    c.width = T * reps; c.height = T;
    const cc = c.getContext('2d');
    const tile = document.createElement('canvas');
    tile.width = tile.height = T;
    renderTread(tile.getContext('2d'), T, T, this.app.state.ops, wear, { mirror: this.app.state.mirror });
    for (let i = 0; i < reps; i++) cc.drawImage(tile, i * T, 0);
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `frontier-tread-${(this.app.displayName() || 'tread').replace(/\s+/g, '-').toLowerCase()}.png`;
    a.click();
  }
  exportJSON(sizeLabel) {
    const data = {
      format: 'frontier-tyre-forge/tread-v1',
      name: this.app.displayName(),
      size: sizeLabel,
      mirror: this.app.state.mirror,
      ops: this.app.state.ops,
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `frontier-tread-${(this.app.displayName() || 'tread').replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ── paint ───────────────────────────────────── */
  render() {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    renderTread(ctx, W, H, this.app.state.ops, 0, { mirror: this.app.state.mirror });

    /* guides */
    ctx.save();
    ctx.strokeStyle = 'rgba(255,87,34,.4)';
    ctx.setLineDash([7, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    for (const fx of [0.25, 0.5, 0.75]) {
      ctx.beginPath(); ctx.moveTo(W * fx, 0); ctx.lineTo(W * fx, H); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }
}
