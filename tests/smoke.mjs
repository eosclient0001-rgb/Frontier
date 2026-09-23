/* Node smoke test: stubs Canvas2D + DOM just enough to exercise the
 * tread engine, sidewall painter, blueprint and tyre math headlessly. */

class FakeGradient { addColorStop() {} }
class FakePattern {}
class Path2D {
  moveTo() {} lineTo() {} arc() {} closePath() {} rect() {}
}
globalThis.Path2D = Path2D;

function makeCtx() {
  const noop = () => {};
  return {
    fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1,
    lineCap: '', lineJoin: '', font: '', textAlign: '', textBaseline: '',
    setLineDash: noop, save: noop, restore: noop, translate: noop,
    rotate: noop, scale: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    arc: noop, closePath: noop, fill: noop, stroke: noop, clip: noop,
    fillRect: noop, clearRect: noop, strokeRect: noop, fillText: noop,
    putImageData: noop,
    createLinearGradient: () => new FakeGradient(),
    createRadialGradient: () => new FakeGradient(),
    createPattern: () => new FakePattern(),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
}
globalThis.document = {
  createElement(tag) {
    return {
      tagName: tag, width: 0, height: 0,
      getContext: () => makeCtx(),
      toDataURL: () => 'data:image/png;base64,',
      click: () => {},
      addEventListener: noopFn, classList: { toggle: noopFn, add: noopFn, remove: noopFn },
      style: {}, dataset: {},
      append: noopFn, appendChild: noopFn,
    };
  },
};
function noopFn() {}
globalThis.URL = globalThis.URL || { createObjectURL: () => 'blob:x', revokeObjectURL: noopFn };
if (!globalThis.Blob) globalThis.Blob = class {};

const { tireSize, buildProfile } = await import('../js/tiremath.js');
const { renderTread, PRESETS, cloneOps } = await import('../js/patterns.js');
const { drawSidewall, drawBlueprint } = await import('../js/textures.js');

let pass = 0, fail = 0;
const check = (name, cond) => {
  cond ? pass++ : (fail++, console.error('  ✗ FAIL:', name));
  console.log((cond ? '  ✓ ' : '  ✗ ') + name);
};

console.log('— tyre math —');
for (const [w, a, r] of [[145, 80, 13], [225, 45, 17], [355, 25, 22]]) {
  const sz = tireSize(w, a, r);
  check(`size ${sz.label}: OD sensible`, sz.OD > 400 && sz.OD < 1000);
  check(`size ${sz.label}: Ro = Rr + H`, Math.abs(sz.Ro - (sz.Rr + sz.H)) < 1e-9);
  const prof = buildProfile(sz);
  const xs = prof.pts.map(p => p.x);
  const rs = prof.pts.map(p => p.r);
  check(`profile ${sz.label}: ${prof.pts.length} pts`, prof.pts.length > 100);
  check(`profile ${sz.label}: symmetric x`, Math.abs(Math.min(...xs) + Math.max(...xs)) < 1e-6);
  check(`profile ${sz.label}: max r ≈ Ro+crown`, Math.max(...rs) > sz.Ro && Math.max(...rs) < sz.Ro + 10);
  check(`profile ${sz.label}: min r at bead`, Math.abs(Math.min(...rs) - (sz.Rr - 1.5)) < 1e-6);
  check(`profile ${sz.label}: has tread zone`, prof.zone.includes(1));
  check(`profile ${sz.label}: width bounded`, Math.max(...xs) <= sz.W / 2 + 3);
}

console.log('— pattern renderer: all presets × wear × mirror —');
const ctx = makeCtx();
for (const p of PRESETS) {
  for (const wear of [0, 0.5, 0.95]) {
    try {
      renderTread(ctx, 256, 256, p.build(), wear, { mirror: true });
      renderTread(ctx, 256, 256, p.build(), wear, { mirror: false });
      check(`preset ${p.id} wear=${wear}`, true);
    } catch (e) {
      check(`preset ${p.id} wear=${wear}: ${e.message}`, false);
    }
  }
}

console.log('— editor op types —');
const opTests = [
  { t: 'hgroove', y: 0.3, w: 0.04, wave: 0.01, freq: 4, seed: 1 },
  { t: 'vgroove', x: 0.4, w: 0.05, a: 30, y0: 0.1, y1: 0.9 },
  { t: 'chevron', x: 0.5, w: 0.05, a: 35 },
  { t: 'sipes', y: 0.5, n: 8, w: 0.006, a: 25, len: 0.09 },
  { t: 'circle', x: 0.5, y: 0.5, r: 0.1, ring: true, w: 0.02 },
  { t: 'circle', x: 0.2, y: 0.7, r: 0.05 },
  { t: 'hex', x: 0.5, y: 0.5, r: 0.08, ring: true, w: 0.02 },
  { t: 'diamond', x: 0.3, y: 0.3, r: 0.07 },
  { t: 'blocks', cols: 5, rows: 3, gx: 0.04, gy: 0.05, stagger: 1, y0: 0.05, y1: 0.95 },
  { t: 'dimples', y: 0.5, r: 0.02, n: 8 },
  { t: 'holes', r: 0.012, n: 4, rows: [0.5] },
  { t: 'hexgrid', r: 0.06, gap: 0.02, w: 0.016, y0: 0.1, y1: 0.9 },
  { t: 'erase', x: 0.5, y: 0.5, r: 0.1 },
];
for (const op of opTests) {
  try {
    renderTread(ctx, 256, 256, [op], 0, { mirror: true });
    check(`op ${op.t}`, true);
  } catch (e) {
    check(`op ${op.t}: ${e.message}`, false);
  }
}
check('cloneOps deep-copies', JSON.stringify(cloneOps(opTests)) === JSON.stringify(opTests));

console.log('— sidewall & blueprint —');
const sz = tireSize(225, 45, 17);
const fakeCanvas = (w, h) => ({ width: w, height: h, getContext: () => makeCtx() });
try {
  drawSidewall(fakeCanvas(1024, 1024), sz, { name: 'Grizzly Magnum', accent: '#e23b2e' });
  check('drawSidewall', true);
} catch (e) { check('drawSidewall: ' + e.message, false); }
try {
  drawBlueprint(fakeCanvas(560, 340), sz, buildProfile(sz));
  check('drawBlueprint', true);
} catch (e) { check('drawBlueprint: ' + e.message, false); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
