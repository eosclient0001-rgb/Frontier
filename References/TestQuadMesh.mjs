// Headless proof for the pure-quad tyre mesh in TyreGenerator.html — no browser, no canvas, no heightmap.
// Usage: node References/TestQuadMesh.mjs [path-to-TyreGenerator.html]
// Extracts the <script id="quad-core"> block, builds meshes for representative tread patterns and asserts:
// every face is a quad, the shell is watertight/manifold/consistently oriented, no degenerate faces,
// signed volume is positive, and quad counts stay low at the default pitch.
import fs from 'node:fs';
import vm from 'node:vm';

const htmlPath = process.argv[2] || new URL('./TyreGenerator.html', import.meta.url).pathname;
const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/<script id="quad-core">([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: <script id="quad-core"> not found in ' + htmlPath); process.exit(1); }
const ctx = vm.createContext({});
const Q = vm.runInContext(m[1] + '\n;QuadCore;', ctx);
if (!Q) { console.error('FAIL: QuadCore not defined'); process.exit(1); }

const baseT = { width: 245, aspect: 40, rim: 18, treadDepth: 8, wear: 0, wearBias: 0, treadFrac: 0.88, crown: 2.0, shoulder: 18, bulge: 1.0, rimWidthFrac: 0.78, across: 96, quadPitch: 6, liner: true };
const L = (type, o = {}) => Object.assign({ type }, o);

const CASES = [
  ['slick (land only)', []],
  ['circumferential grooves', [L('circ', { pos: 0, width: 8, depth: 1 }), L('circ', { pos: 0.55, width: 7, depth: 1 }), L('circ', { pos: -0.55, width: 7, depth: 1, zig: 4, zigCount: 40 })]],
  ['lateral + chevron (diagonal)', [L('lateral', { count: 48, angle: 20, width: 6, depth: 1, from: -1, to: 1, phase: 0, mirror: false, curve: 0, zig: 0 }), L('chevron', { count: 40, angle: 55, width: 7, depth: 1, from: 0.08, to: 1.3, phase: 0, mirror: true, curve: 0.3, zig: 0 })]],
  ['crossing grooves (pinch hazard)', [L('circ', { pos: 0, width: 10, depth: 1 }), L('lateral', { count: 36, angle: 0, width: 8, depth: 1, from: -1, to: 1, phase: 0, mirror: false, curve: 0, zig: 0 }), L('lateral', { count: 36, angle: 65, width: 6, depth: 0.7, from: -1, to: 1, phase: 0.5, mirror: false, curve: 0, zig: 0 })]],
  ['dimples + hex cells', [L('dimple', { rows: 5, count: 60, radius: 4, depth: 0.7, from: -1, to: 1, stagger: true, ring: false }), L('hex', { size: 14, width: 4, depth: 0.8, from: -1, to: 1, rotate: 0 })]],
  ['drawn shapes (groove path + block)', [L('shape', { kind: 'path', pts: [[0, -60], [40, 0], [0, 60]], width: 8, depth: 1, repeat: 36, mirror: true }), L('shape', { kind: 'poly', pts: [[10, -30], [50, -30], [50, 30], [10, 30]], width: 6, depth: 0.8, repeat: 36, mirror: false })]],
  ['grooves reaching the shoulder edge', [L('lateral', { count: 28, angle: 18, width: 11, depth: 1, from: 0.3, to: 1.3, phase: 0, mirror: false, curve: 0, zig: 0 }), L('lateral', { count: 28, angle: -18, width: 11, depth: 1, from: -1.3, to: -0.3, phase: 0.5, mirror: false, curve: 0, zig: 0 })]],
  ['multi-depth grooves', [L('circ', { pos: 0.3, width: 9, depth: 1 }), L('lateral', { count: 48, angle: 30, width: 5, depth: 0.5, from: -1, to: 1, phase: 0.25, mirror: false, curve: 0.2, zig: 0 }), L('dimple', { rows: 3, count: 48, radius: 3.5, depth: 0.35, from: -0.8, to: 0.8, stagger: false, ring: true })]],
];

let failures = 0;
const check = (label, mesh, opts = {}) => {
  const r = mesh.report, problems = [];
  if (!mesh.F.every(f => f.q.length === 4)) problems.push('non-quad face present');
  if (r.nonQuadFaces || r.badIndexFaces) problems.push(`nonQuad=${r.nonQuadFaces} badIndex=${r.badIndexFaces}`);
  if (r.degenerateFaces) problems.push(`degenerateFaces=${r.degenerateFaces}`);
  if (r.nonManifoldEdges) problems.push(`nonManifoldEdges=${r.nonManifoldEdges}`);
  if (r.inconsistentEdges) problems.push(`inconsistentEdges=${r.inconsistentEdges}`);
  if (r.signedVolumeMm3 <= 0) problems.push(`signedVolumeMm3=${r.signedVolumeMm3}`);
  if (!opts.expectBoundary && !r.watertight) problems.push(`not watertight (boundary=${r.boundaryEdges})`);
  if (opts.expectBoundary && r.boundaryEdges === 0) problems.push('expected bead boundary loops with liner off, got none');
  if (opts.maxQuads && r.quads > opts.maxQuads) problems.push(`quads=${r.quads} > budget ${opts.maxQuads}`);
  if (opts.maxWarp && r.maxWarpDeg > opts.maxWarp) problems.push(`maxWarp=${r.maxWarpDeg}deg > ${opts.maxWarp}deg (folded quad)`);
  if (opts.minSnapped && mesh.nodesSnapped < opts.minSnapped) problems.push(`nodesSnapped=${mesh.nodesSnapped} < ${opts.minSnapped} (edge flow lost)`);
  const status = problems.length ? 'FAIL' : 'PASS';
  if (problems.length) failures++;
  console.log(`${status}  ${label}\n      quads=${r.quads} verts=${r.vertices} boundary=${r.boundaryEdges} nonManifold=${r.nonManifoldEdges} inconsistent=${r.inconsistentEdges} degenerate=${r.degenerateFaces} euler=${r.euler} vol=${(r.signedVolumeMm3 / 1e9).toFixed(3)} m^3 minAngle=${r.minCornerAngleDeg}deg maxWarp=${r.maxWarpDeg}deg badQuads=${r.badQuads} pinchesFixed=${mesh.pinchesFixed} snapped=${mesh.nodesSnapped} dropped=[${mesh.dropped.map(d => d.type + ': ' + d.reason).join('; ')}]${problems.length ? '\n      -> ' + problems.join('; ') : ''}`);
  return r;
};

for (const [label, layers] of CASES) {
  const T = { ...baseT };
  const d = Q.dims(T);
  const mesh = Q.buildQuadMeshData({ name: label, layers }, d, Q.buildProfile(d, T), T, {});
  // Budget 62k: raised from 60k when sub-cell groove capture landed — before that, the hex layer in
  // 'dimples + hex cells' silently produced ZERO groove cells (the pattern vanished), so the old
  // budget was calibrated on an incomplete mesh. maxWarp guards the foldover repair; minSnapped
  // guards edge flow (diagonal grooves must pull nodes onto the vector boundary, not stair-step).
  check(label, mesh, { maxQuads: 62000, maxWarp: 45, minSnapped: label.includes('diagonal') || label.includes('crossing') || label.includes('shapes') ? 800 : 0 });
}

// variants
{
  const T = { ...baseT, liner: false };
  const d = Q.dims(T);
  check('liner OFF (open at beads only)', Q.buildQuadMeshData({ layers: [L('circ', { pos: 0, width: 8, depth: 1 })] }, d, Q.buildProfile(d, T), T, {}), { expectBoundary: true });
}
for (const wear of [0.5, 1]) {
  const T = { ...baseT, wear };
  const d = Q.dims(T);
  check(`wear=${wear}`, Q.buildQuadMeshData({ layers: [L('circ', { pos: 0, width: 8, depth: 1 }), L('lateral', { count: 40, angle: 25, width: 6, depth: 1, from: -1, to: 1, phase: 0, mirror: false, curve: 0, zig: 0 })] }, d, Q.buildProfile(d, T), T, {}));
}
for (const pitch of [3, 10]) {
  const T = { ...baseT, quadPitch: pitch };
  const d = Q.dims(T);
  check(`pitch=${pitch}mm`, Q.buildQuadMeshData({ layers: [L('circ', { pos: 0.3, width: 8, depth: 1 }), L('chevron', { count: 36, angle: 50, width: 7, depth: 1, from: 0.05, to: 1.3, phase: 0, mirror: true, curve: 0.4, zig: 0 })] }, d, Q.buildProfile(d, T), T, {}));
}
{ // thin (sub-cell) grooves must be CAPTURED as one-cell strips at default pitch, not silently dropped
  const layers = [L('lateral', { count: 40, angle: 35, width: 3, depth: 1, from: -1, to: 1, phase: 0, mirror: false, curve: 0, zig: 0 })];
  const T = { ...baseT };
  const d = Q.dims(T);
  const m = Q.buildQuadMeshData({ layers }, d, Q.buildProfile(d, T), T, {});
  if (m.dropped.some(x => x.type === 'lateral')) { console.log('FAIL  3mm lateral dropped at 6mm pitch (thin groove vanished)'); failures++; }
  else if (!m.report.watertight) { console.log('FAIL  3mm lateral mesh not watertight'); failures++; }
  else console.log(`PASS  3mm lateral captured at 6mm pitch (quads=${m.report.quads}, snapped=${m.nodesSnapped})`);
}
{ // thin sipes must be REPORTED as dropped at coarse pitch, and meshed at fine pitch — never silently faked
  const layers = [L('sipe', { count: 120, angle: 10, width: 1.2, depth: 0.55, from: -1, to: 1, phase: 0.5, mirror: false, curve: 0, zig: 1 })];
  const T = { ...baseT };
  const d = Q.dims(T);
  const coarse = Q.buildQuadMeshData({ layers }, d, Q.buildProfile(d, T), T, {});
  if (!coarse.dropped.some(x => x.type === 'sipe')) { console.log('FAIL  sipe drop not reported at 6mm pitch'); failures++; }
  else console.log('PASS  sipe dropped + reported at 6mm pitch');
  const Tf = { ...baseT, quadPitch: 1.5 };
  const df = Q.dims(Tf);
  const fine = Q.buildQuadMeshData({ layers }, df, Q.buildProfile(df, Tf), Tf, {});
  if (fine.dropped.some(x => x.type === 'sipe')) { console.log('FAIL  sipe still dropped at 1.5mm pitch'); failures++; }
  else console.log(`PASS  sipe meshed at 1.5mm pitch (quads=${fine.report.quads}, watertight=${fine.report.watertight})`);
}

// ---- every preset shipped in the page ----
{
  const mod = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const seg = mod.slice(mod.indexOf('const LAYER_DEFS'), mod.indexOf('const PRE ='));
  const pctx = vm.createContext({});
  vm.runInContext(seg + '\n;globalThis.P=PRESETS;', pctx);
  for (const pr of pctx.P) {
    const T = { ...baseT, ...(pr.tyre || {}) };
    const d = Q.dims(T);
    check('preset: ' + pr.name, Q.buildQuadMeshData({ name: pr.name, layers: pr.layers }, d, Q.buildProfile(d, T), T, {}));
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
