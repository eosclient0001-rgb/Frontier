// Validate a pure-quad tyre OBJ — no dependencies. Usage:
//   node References/ValidateQuadOBJ.mjs path/to/tyre.obj [--json]
// Checks: every face has exactly 4 vertices, indices are valid, no degenerate/duplicated faces,
// every edge is shared by exactly 2 faces traversed in opposite directions (closed, manifold,
// consistently oriented), signed volume is positive, and quad quality (corner angle / warp / aspect).
// Exit code 0 = clean pure-quad watertight mesh, 1 = problems found.
import fs from 'node:fs';

const file = process.argv[2];
const asJson = process.argv.includes('--json');
if (!file) { console.error('Usage: node ValidateQuadOBJ.mjs <file.obj> [--json]'); process.exit(2); }

const V = [], F = [];
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const p = line.trim().split(/\s+/);
  if (p[0] === 'v') V.push([+p[1], +p[2], +p[3]]);
  else if (p[0] === 'f') F.push(p.slice(1).map(tok => parseInt(tok.split('/')[0], 10) - 1));
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const area = q => { const [a, b, c, d] = q.map(i => V[i]); const tri = (p, x, y) => { const u = [x[0] - p[0], x[1] - p[1], x[2] - p[2]], v = [y[0] - p[0], y[1] - p[1], y[2] - p[2]]; return 0.5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]); }; return tri(a, b, c) + tri(a, c, d); };

const edges = new Map(); const seenFaces = new Set();
let nonQuad = 0, badIndex = 0, degenerate = 0, duplicates = 0, vol = 0;
let minAngle = 180, maxRatio = 1, maxWarp = 0, badQuads = 0;
const ekey = (a, b) => a < b ? a + '_' + b : b + '_' + a;

for (const q of F) {
  if (q.length !== 4) { nonQuad++; continue; }
  if (q.some(i => !(i >= 0 && i < V.length)) || new Set(q).size !== 4) badIndex++;
  if (area(q) < 1e-12) degenerate++;
  const fk = [...q].sort((a, b) => a - b).join(',');
  if (seenFaces.has(fk)) duplicates++; seenFaces.add(fk);
  const P = q.map(i => V[i]);
  const triV = (p, x, y) => (p[0] * (x[1] * y[2] - x[2] * y[1]) - p[1] * (x[0] * y[2] - x[2] * y[0]) + p[2] * (x[0] * y[1] - x[1] * y[0])) / 6;
  vol += triV(P[0], P[1], P[2]) + triV(P[0], P[2], P[3]);
  const el = [];
  for (let k = 0; k < 4; k++) { const a = P[k], b = P[(k + 1) % 4]; el.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])); const rec = edges.get(ekey(q[k], q[(k + 1) % 4])) || { n: 0, dirs: [] }; rec.n++; rec.dirs.push(q[k] < q[(k + 1) % 4] ? 1 : -1); edges.set(ekey(q[k], q[(k + 1) % 4]), rec); }
  let qMin = 180;
  for (let k = 0; k < 4; k++) { const p = P[k], a = P[(k + 3) % 4], b = P[(k + 1) % 4]; const u = [a[0] - p[0], a[1] - p[1], a[2] - p[2]], v = [b[0] - p[0], b[1] - p[1], b[2] - p[2]]; qMin = Math.min(qMin, Math.acos(clamp((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / ((Math.hypot(...u) || 1e-12) * (Math.hypot(...v) || 1e-12)), -1, 1)) * 180 / Math.PI); }
  minAngle = Math.min(minAngle, qMin);
  const ratio = Math.max(...el) / Math.max(1e-12, Math.min(...el)); maxRatio = Math.max(maxRatio, ratio);
  const nrm = (a, b, c) => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; };
  const n1 = nrm(P[0], P[1], P[2]), n2 = nrm(P[0], P[2], P[3]);
  const warp = Math.acos(clamp((n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]) / ((Math.hypot(...n1) || 1e-12) * (Math.hypot(...n2) || 1e-12)), -1, 1)) * 180 / Math.PI;
  maxWarp = Math.max(maxWarp, warp);
  if (qMin < 25 || ratio > 6 || warp > 15) badQuads++;
}
let boundary = 0, nonManifold = 0, inconsistent = 0;
for (const rec of edges.values()) { if (rec.n === 1) boundary++; else if (rec.n > 2) nonManifold++; else if (rec.dirs[0] === rec.dirs[1]) inconsistent++; }

const report = { file, vertices: V.length, faces: F.length, nonQuadFaces: nonQuad, badIndexFaces: badIndex, degenerateFaces: degenerate, duplicateFaces: duplicates, edges: edges.size, boundaryEdges: boundary, nonManifoldEdges: nonManifold, inconsistentEdges: inconsistent, eulerCharacteristic: V.length - edges.size + F.length, signedVolume: +vol.toFixed(6), minCornerAngleDeg: +minAngle.toFixed(1), maxEdgeRatio: +maxRatio.toFixed(2), maxWarpDeg: +maxWarp.toFixed(1), poorQuads: badQuads };
report.pureQuads = nonQuad === 0 && F.length > 0;
report.watertight = boundary === 0 && nonManifold === 0 && inconsistent === 0 && degenerate === 0 && duplicates === 0 && badIndex === 0;
report.ok = report.pureQuads && report.watertight && vol > 0;

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`${report.ok ? 'PASS' : 'FAIL'}  ${file}`);
  console.log(`  ${report.faces} faces (${report.pureQuads ? 'all quads ✓' : report.nonQuad + ' NON-QUAD ✗'}) · ${report.vertices} vertices · ${report.edges} edges (Euler ${report.eulerCharacteristic}, torus tyre = 0)`);
  console.log(`  boundary edges ${report.boundaryEdges} · non-manifold ${report.nonManifoldEdges} · inconsistent ${report.inconsistentEdges} · degenerate ${report.degenerateFaces} · duplicates ${report.duplicateFaces}`);
  console.log(`  signed volume ${report.signedVolume} (OBJ units^3, must be > 0) · min corner ${report.minCornerAngleDeg}° · max warp ${report.maxWarpDeg}° · max edge ratio ${report.maxEdgeRatio} · poor quads ${report.poorQuads}`);
}
process.exit(report.ok ? 0 : 1);
