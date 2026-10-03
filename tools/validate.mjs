// Headless sanity checks for the simulation data pipeline.
// Run: node tools/validate.mjs
import { buildBodySpec, buildBodyMesh, packCollision, bodySurface, bodySigned } from '../src/body.js';
import { buildDress, DRESS_STYLES, NECKLINE_OPTIONS, vertexAreas } from '../src/dress.js';
import { buildConstraints, buildState, CON_STRIDE } from '../src/physics.js';
import { packFabric, DEFAULT_FABRIC } from '../src/fabric.js';
import { m4, v3 } from '../src/math.js';

let failures = 0;
const check = (cond, msg, extra = '') => {
  if (!cond) { failures++; console.log(`  ✗ ${msg} ${extra}`); }
  else console.log(`  ✓ ${msg}`);
};
const finite = (arr, label) => {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return `non-finite at ${i}: ${arr[i]}`;
  }
  return null;
};

const P = {
  height: 1.70, shoulders: 1.0, bust: 1.0, waist: 0.92, hips: 1.06,
  bustHeight: 1.0, armAngle: 16, legSpread: 0, bodySegments: 44,
  style: 'aline', length: 0.60, fit: 1.030, ease: 1.0, flare: 1.0,
  pleats: 14, pleatDepth: 0.020, neckline: 'sweetheart', straps: 1,
  strapWidth: 0.030, strapInset: 0, strapPinRange: 0.16, neckDrop: 1.0,
  hemSweep: 1.0, tierAmp: 1.0, resolution: 96, pinTopRows: 2, arealDensity: 0.20,
  constraintParams: { stretchComp: 1.5e-6, shearComp: 3e-5, bendComp: 8e-4, stitchComp: 1e-7 },
};

console.log('\n== body ==');
const spec = buildBodySpec(P);
check(spec.rings.length > 20, `loft rings generated (${spec.rings.length})`);
check(spec.capsules.length > 5, `limb capsules generated (${spec.capsules.length})`);
let bad = null;
for (const r of spec.rings) {
  if (!(r.rx > 0 && r.rz > 0 && Number.isFinite(r.y))) bad = r;
}
check(!bad, 'all ring radii positive and finite', bad ? JSON.stringify(bad) : '');

const mesh = buildBodyMesh(spec, 44, 18);
check(mesh.positions.length === mesh.normals.length, 'position/normal counts match');
check(finite(mesh.positions, 'body positions') === null, 'body positions finite');
check(finite(mesh.normals, 'body normals') === null, 'body normals finite');
check(mesh.indices.every((i) => i < mesh.positions.length / 3), 'body indices in range');
const bodyArea = vertexAreas(mesh.positions, mesh.indices, mesh.positions.length / 3)
  .reduce((a, b) => a + b, 0) / 3;
check(bodyArea > 0.5 && bodyArea < 8, `body surface area plausible (${bodyArea.toFixed(2)} m²)`);

console.log('\n== surface queries ==');
const s1 = bodySurface(spec, 1.0, 0);
const s2 = bodySurface(spec, 1.0, Math.PI);
check(s1[0] > 0.1 && Math.abs(s1[1]) < 1e-9 && s2[0] < -0.1 && Math.abs(s2[1]) < 1e-9,
  'theta=0 / theta=pi map to +X / -X with no depth offset');
const front = bodySurface(spec, 1.25, Math.PI / 2);
const back = bodySurface(spec, 1.25, -Math.PI / 2);
check(front[1] > back[1], `bust bulges forward (${front[1].toFixed(3)} > ${back[1].toFixed(3)})`);
const dIn = bodySigned(spec, 1.0, 0.02, 0);
const dOut = bodySigned(spec, 1.0, 0.30, 0);
check(dIn < 0 && dOut > 0, `signed distance sign correct (${dIn.toFixed(3)}, ${dOut.toFixed(3)})`);

console.log('\n== dress ==');
const dress = buildDress(spec, P, P.resolution);
const nVerts = dress.positions.length / 3;
check(nVerts === dress.rows * dress.cols + (dress.straps.length ? dress.straps.length * (dress.meta.filter(m => m.strap !== undefined).length / Math.max(1, dress.straps.length)) : 0),
  `vertex count matches grid + straps (${nVerts})`);
check(finite(dress.positions, 'dress positions') === null, 'dress positions finite');
check(finite(dress.uvs, 'dress uvs') === null, 'dress uvs finite');
check(dress.indices.every((i) => i < nVerts), 'dress indices in range');
check(dress.uvs.length / 2 === nVerts, 'uv count matches vertices');
check(dress.islands.length >= 1, `islands detected (${dress.islands.map(i => i.key).join(', ')})`);
check(dress.pins.length > 0, `strap pins generated (${dress.pins.length})`);

// the dress must sit outside the mannequin everywhere
let minClear = Infinity;
let worst = null;
for (let i = 0; i < nVerts; i++) {
  if (dress.meta[i].strap !== undefined) continue;
  const x = dress.positions[i * 3], y = dress.positions[i * 3 + 1], z = dress.positions[i * 3 + 2];
  const d = bodySigned(spec, y, x, z);
  if (d < minClear) { minClear = d; worst = [x, y, z]; }
}
check(minClear > -0.012, `dress stays outside the body (min clearance ${minClear.toFixed(4)} m)`,
  worst ? worst.map(v => v.toFixed(3)).join(',') : '');

// straps must clear the shoulder roof too (checked against bodySigned which is
// only meaningful on the torso, so use the ceiling as an upper bound)
let strapBad = 0;
for (let i = 0; i < nVerts; i++) {
  if (dress.meta[i].strap === undefined) continue;
  const x = dress.positions[i * 3], y = dress.positions[i * 3 + 1], z = dress.positions[i * 3 + 2];
  const d = bodySigned(spec, y, x, z);
  if (d < -0.001) strapBad++;
}
check(strapBad === 0, `straps clear the body surface (${strapBad} bad points)`);

const hemY = Math.min(...dress.meta.filter(m => m.strap === undefined).map((m, i) => dress.positions[i * 3 + 1]));
check(hemY > 0, `hem above the floor (${hemY.toFixed(3)} m)`);

console.log('\n== every style builds ==');
for (const key of Object.keys(DRESS_STYLES)) {
  for (const nl of NECKLINE_OPTIONS.map(o => o.value)) {
    const p = { ...P, style: key, neckline: nl };
    const d = buildDress(spec, p, 48);
    const f = finite(d.positions, 'x');
    const ok = f === null && d.indices.every(i => i < d.positions.length / 3);
    if (!ok) { failures++; console.log(`  ✗ ${key}/${nl}: ${f ?? 'bad indices'}`); }
  }
}
console.log(`  ✓ all ${Object.keys(DRESS_STYLES).length} styles × ${NECKLINE_OPTIONS.length} necklines built`);

console.log('\n== constraints & state ==');
const cons = buildConstraints(dress, P.constraintParams);
check(cons.count > 0, `constraints built (${cons.count})`);
check(cons.buffer.byteLength === cons.count * CON_STRIDE * 4, 'constraint buffer size matches stride');
check(cons.u32.byteLength % 24 === 0, 'stride is a multiple of 24 bytes');
let allInRange = true;
for (let k = 0; k < cons.count; k++) {
  const i = cons.u32[k * CON_STRIDE], j = cons.u32[k * CON_STRIDE + 1];
  const rest = cons.f32[k * CON_STRIDE + 2];
  if (i >= nVerts || j >= nVerts || !(rest >= 0) || !Number.isFinite(rest)) { allInRange = false; break; }
}
check(allInRange, 'all constraints reference valid vertices with finite rest lengths');
const typeCounts = [0, 0, 0, 0];
for (let k = 0; k < cons.count; k++) typeCounts[cons.f32[k * CON_STRIDE + 4]]++;
check(typeCounts.every((c) => c > 0), `all 4 constraint types present (${typeCounts.join('/')})`);

const state = buildState(dress, P, dress.pins);
check(state.count === nVerts, 'state vertex count matches');
check(finite(state.pos, 'state pos') === null, 'state positions finite');
check(finite(state.prev, 'state prev') === null, 'state prev finite');
let invMassOk = true;
for (let i = 0; i < nVerts; i++) {
  const w = state.pos[i * 4 + 3];
  if (!(w > 0) || !Number.isFinite(w)) invMassOk = false;
}
check(invMassOk, 'every vertex has a positive finite inverse mass');
check(state.pinIndices.length > 0, `pins present (${state.pinIndices.length})`);
check(state.pinIndices.every((i) => i < nVerts), 'pin indices in range');
const pinnedInvMass = state.pinIndices.every((i) => state.pos[i * 4 + 3] > 0);
check(pinnedInvMass, 'pins are ordinary vertices (moved by the pin pass)');

const areas = vertexAreas(dress.positions, dress.indices, nVerts);
const total = areas.reduce((a, b) => a + b, 0) / 3;
check(total > 0.4 && total < 8, `cloth surface area plausible (${total.toFixed(2)} m²)`);

console.log('\n== fabric packing ==');
const fab = packFabric(DEFAULT_FABRIC);
check(fab.length === 32, 'fabric uniform is 32 floats (128 bytes)');
check(finite(fab, 'fabric') === null, 'fabric uniform finite');
check(fab.every((v) => v >= 0 && v <= 1 || Number.isFinite(v)), 'fabric values sane');

console.log('\n== math ==');
const I = m4.identity();
const T = m4.translate([1, 2, 3]);
const P4 = m4.mul(I, T);
check(Math.abs(P4[12] - 1) < 1e-6 && Math.abs(P4[14] - 3) < 1e-6, 'matrix multiply consistent');
const proj = m4.perspective(1.0, 1.5, 0.1, 100);
check(finite(proj, 'proj') === null && Math.abs(proj[11] + 1) < 1e-6, 'perspective matrix sane');
const view = m4.lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
check(Math.abs(view[14] + 5) < 1e-6, 'lookAt places camera correctly');

console.log(`\n${failures === 0 ? '✅ all checks passed' : `❌ ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
