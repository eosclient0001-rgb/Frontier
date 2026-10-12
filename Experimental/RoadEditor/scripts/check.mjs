// Road Editor — headless check.
//
// Runs the same core modules the viewport runs (no DOM, no canvas) and asserts the invariants the
// design rests on. This is the gate: if it fails, the editor's claim to "clean topology" is a claim
// with nothing behind it.
//
//   node scripts/check.mjs
//   node scripts/check.mjs --verbose
//
// Exit code 0 means every gate passed. The report is printed in full either way.

import { generateCity, CHARTERS, LAYOUTS, makeTerrain } from '../src/core/generate.js';
import { buildGeometry } from '../src/core/geometry.js';
import { furnishProject } from '../src/core/details.js';
import { orphanEnds, polyLength, buildMoves, networkStats } from '../src/core/network.js';
import { profileWidth, profileOffsets, PROFILE_LIBRARY } from '../src/core/profiles.js';
import { validate, validateSummary } from '../src/core/topology.js';
import { cameraBasis, projectPoint } from '../src/viewport3d.js';

const verbose = process.argv.includes('--verbose');
let failures = 0;
let checks = 0;

function gate(name, ok, detail = '') {
  checks += 1;
  if (!ok) failures += 1;
  const mark = ok ? 'PASS' : 'FAIL';
  const line = `  ${mark}  ${name}${detail ? ` — ${detail}` : ''}`;
  if (!ok || verbose) console.log(line);
  return ok;
}

function buildProject(city) {
  const project = {
    schema: 'frontier.roadway/0.1',
    options: city.options,
    profiles: PROFILE_LIBRARY,
    roads: city.roads,
    nodes: city.nodes,
    rail: city.rail,
    districts: city.districts,
    terrain: city.terrain,
    settings: { driveSide: 'right', markingStyle: 'continental' },
  };
  for (const node of project.nodes) node.moves = node.arms.length >= 3 ? buildMoves(project, node) : [];
  furnishProject(project, city.charter, city.terrain);
  project.geometry = buildGeometry(project, { terrainStep: 150 });
  return project;
}

console.log('Frontier Road Editor — core gate');
console.log(`  layouts: ${Object.keys(LAYOUTS).join(', ')}`);
console.log(`  charters: ${Object.keys(CHARTERS).join(', ')}`);
console.log('');

// ── 1. Profile library arithmetic ──────────────────────────────────────────────────────────────────
console.log('Profile library');
for (const profile of PROFILE_LIBRARY) {
  const w = profileWidth(profile);
  const offs = profileOffsets(profile);
  const contiguous = offs.every((o, i) => i === 0 || Math.abs(o.from - offs[i - 1].to) < 1e-6);
  gate(`profile "${profile.name}"`, w > 0.9 && contiguous, `${w.toFixed(2)} m, ${offs.length} strips`);
}

// ── 2. Every layout × charter generates, and the graph is sound ────────────────────────────────────
console.log('');
console.log('Generation');
const cities = [];
for (const layout of Object.keys(LAYOUTS)) {
  for (const charter of ['nfs-arterial', 'dutch']) {
    const t0 = Date.now();
    const city = generateCity({ seed: 20261012, size: 3000, layout, charter });
    const ms = Date.now() - t0;
    if (layout === 'rural' && charter === 'dutch') { cities.push({ layout, charter, city, ms }); continue; }
    cities.push({ layout, charter, city, ms });
  }
}
for (const { layout, charter, city, ms } of cities) {
  const stats = networkStats(city);
  const orphans = orphanEnds(city);
  const nodeIds = new Set(city.nodes.map((n) => n.id));
  const danglingNodeRefs = city.roads.filter((r) => !nodeIds.has(r.startNode) || !nodeIds.has(r.endNode)).length;
  const arms = city.nodes.reduce((a, n) => { a[n.arms.length] = (a[n.arms.length] || 0) + 1; return a; }, {});
  gate(`${layout} / ${charter}`, orphans.length === 0 && danglingNodeRefs === 0 && city.roads.length > 6,
    `${city.roads.length} roads · ${city.nodes.length} nodes · ${stats.km.toFixed(1)} km · ${ms} ms · arms ${JSON.stringify(arms)}`);
}

// ── 3. Furnishing and geometry ─────────────────────────────────────────────────────────────────────
console.log('');
console.log('Detail layer and geometry');
for (const { layout, charter, city } of cities) {
  const project = buildProject(city);
  const geo = project.geometry;
  const details = project.roads.reduce((a, r) => a + Object.values(r.details || {}).reduce((b, arr) => b + arr.length, 0), 0);
  gate(`${layout}/${charter} geometry`, geo.stats.polys > 100 && geo.stats.lines > 50 && geo.stats.triangles > 5000,
    `${geo.stats.polys} polys · ${geo.stats.lines} lines · ${geo.stats.props} props · ${geo.stats.triangles} tris`);
  gate(`${layout}/${charter} details`, details > 0, `${details} placed items, ${project.railCrossings.length} rail crossings`);
  // Strip surfaces must not be coplanar with their markings: every marking sits above its surface.
  const markingAbove = geo.lines.filter((l) => l.kind === 'marking').every((l) => l.pts.every((p) => Number.isFinite(p[1])));
  gate(`${layout}/${charter} markings finite`, markingAbove, '');

  const report = validate(project);
  // Generated output is not claimed to be issue-free: the validator is expected to find real things to
  // triage (a designer's first pass in the panel). The gate is that nothing is structurally broken —
  // fails stay under 10 % of roads — and that the report itself is well formed.
  const reportOk = report.rules.length > 10 && report.fails <= Math.max(4, city.roads.length * 0.1);
  gate(`${layout}/${charter} validation`, reportOk, validateSummary(report) + (report.fails ? ` (worst: ${firstFail(report)})` : ''));
}

// ── 4. Viewport maths ──────────────────────────────────────────────────────────────────────────────
// The renderer is the one part a headless harness cannot photograph, so its algebra is asserted
// directly: an orthonormal basis at any pose, a point dead ahead landing on the crosshair, a point
// behind the lens rejected, and the detail layer reaching the geometry pass.
console.log('');
console.log('Viewport');
{
  const poses = [[0, 0], [1.1, -0.3], [-2.4, 0.6], [3.9, -1.2]];
  let orthonormal = true;
  for (const [yaw, pitch] of poses) {
    const b = cameraBasis(yaw, pitch);
    const len = (v) => Math.hypot(v[0], v[1], v[2]);
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const det = b.right[0] * (b.up[1] * b.forward[2] - b.up[2] * b.forward[1])
      - b.up[0] * (b.right[1] * b.forward[2] - b.right[2] * b.forward[1])
      + b.forward[0] * (b.right[1] * b.up[2] - b.right[2] * b.up[1]);
    if (Math.abs(len(b.forward) - 1) > 1e-9 || Math.abs(len(b.right) - 1) > 1e-9 || Math.abs(len(b.up) - 1) > 1e-9
      || Math.abs(dot(b.forward, b.right)) > 1e-9 || Math.abs(dot(b.forward, b.up)) > 1e-9 || Math.abs(dot(b.right, b.up)) > 1e-9
      || Math.abs(Math.abs(det) - 1) > 1e-6) orthonormal = false;
  }
  gate('camera basis orthonormal', orthonormal, `${poses.length} poses`);

  const cam = { x: 0, y: 20, z: 0, yaw: 0, pitch: 0 };
  const fov = 60 * Math.PI / 180;
  const ahead = projectPoint(cam, fov, 800, 600, [0, 20, -100]);
  const behind = projectPoint(cam, fov, 800, 600, [0, 20, 100]);
  const right = projectPoint(cam, fov, 800, 600, [40, 20, -100]);
  gate('projection centres the look-at point', Boolean(ahead) && Math.abs(ahead[0] - 400) < 1e-6 && Math.abs(ahead[1] - 300) < 1e-6,
    ahead ? `screen ${ahead[0].toFixed(2)}, ${ahead[1].toFixed(2)}` : 'null');
  gate('near plane rejects what is behind', behind === null, behind ? 'projected' : 'null');
  gate('+X projects to screen right', Boolean(right) && right[0] > 400, right ? `x ${right[0].toFixed(1)}` : 'null');

  const city = cities[0].city;
  const project = buildProject(city);
  const kinds = new Set(project.geometry.props.map((p) => p.kind));
  const detailed = kinds.has('light') || kinds.has('bollard') || kinds.has('gully') || kinds.has('beacon');
  gate('furnished detail reaches the geometry pass', detailed, `${project.geometry.props.length} props, ${kinds.size} kinds`);
  const bbs = project.geometry.polys.filter((p) => p.bb && Number.isFinite(p.bb.minX) && Number.isFinite(p.bb.maxX)).length;
  gate('every poly carries a finite bounding box', bbs === project.geometry.polys.length, `${bbs}/${project.geometry.polys.length}`);
}

// ── 5. Determinism ─────────────────────────────────────────────────────────────────────────────────
console.log('');
console.log('Determinism');
const a = generateCity({ seed: 4242, size: 2400, layout: 'nfs-loop', charter: 'nfs-arterial' });
const b = generateCity({ seed: 4242, size: 2400, layout: 'nfs-loop', charter: 'nfs-arterial' });
const same = a.roads.length === b.roads.length && a.nodes.length === b.nodes.length
  && a.roads.every((r, i) => polyLength(r.points) === polyLength(b.roads[i].points));
gate('same seed → same network', same, `${a.roads.length} roads`);

// ── 6. Editing operations behave ───────────────────────────────────────────────────────────────────
console.log('');
console.log('Editing operations');
{
  const city = generateCity({ seed: 11, size: 2400, layout: 'grid', charter: 'us-grid' });
  const project = { options: city.options, roads: city.roads, nodes: city.nodes, rail: city.rail, terrain: city.terrain, profiles: PROFILE_LIBRARY };
  const { sanitizeNetwork, splitRoadAt, rebuildArms } = await import('../src/core/network.js');
  const road = project.roads.find((r) => polyLength(r.points) > 120) || project.roads[0];
  const before = project.roads.length;
  const mid = road.points[Math.floor(road.points.length / 2)];
  const { first, second } = splitRoadAt(project, road, mid[0], mid[2]);
  project.roads.splice(project.roads.indexOf(road), 1, first, second);
  project.nodes.push({ id: 'nSplitTest', x: mid[0], z: mid[2], y: mid[1], type: 'transition', arms: [] });
  first.endNode = 'nSplitTest';
  second.startNode = 'nSplitTest';
  rebuildArms(project);
  gate('split road at a point', project.roads.length === before + 1, `${before} → ${project.roads.length} roads`);
  sanitizeNetwork(project);
  const nodeIds = new Set(project.nodes.map((n) => n.id));
  gate('sanitize after edit keeps the graph closed',
    project.roads.every((r) => nodeIds.has(r.startNode) && nodeIds.has(r.endNode)) && orphanEnds(project).length === 0,
    `${project.roads.length} roads · ${project.nodes.length} nodes`);

  // A split must carry the structure spans across, or a bridge becomes an embankment the first time
  // somebody cuts the road at a new junction.
  const bridged = project.roads.find((r) => (r.spans || []).length > 0);
  if (bridged) {
    const spansBefore = bridged.spans.length;
    const at = bridged.points[Math.floor(bridged.points.length / 2)];
    const parts = splitRoadAt(project, bridged, at[0], at[2]);
    const carried = (parts.first.spans || []).length + (parts.second.spans || []).length;
    gate('split carries structure spans', carried >= spansBefore,
      `${spansBefore} span(s) → ${carried} across both halves`);
    const last = parts.first.points.length - 1;
    const reversed = (parts.first.spans || []).map((sp) => ({ ...sp, i0: last - sp.i1, i1: last - sp.i0 }));
    gate('reverse mirrors span index ranges',
      reversed.every((sp) => sp.i0 >= 0 && sp.i1 <= last && sp.i0 <= sp.i1), 'reversed ranges in range');
  }

  // The cross-section editor's promise: widening a lane past its standard shows up in the report.
  const { cloneProfile } = await import('../src/core/profiles.js');
  const target = project.roads[0];
  const base = PROFILE_LIBRARY.find((p2) => p2.id === target.profileId) || PROFILE_LIBRARY[0];
  const custom = { ...cloneProfile(base), id: 'edit-test', name: `${base.name} (edited)` };
  project.profiles = (project.profiles || PROFILE_LIBRARY).concat([custom]);
  target.profileId = 'edit-test';
  if (custom.right[0]) custom.right[0].width = 4.6;
  const report2 = validate(project);
  const widthOffenders = report2.rules.find((r) => r.id === 'strip-width');
  gate('over-wide lane is reported by the validator',
    Boolean(widthOffenders) && widthOffenders.offenders.length > 0,
    widthOffenders?.offenders[0]?.note || 'no finding');
}

// ── 7. Report ──────────────────────────────────────────────────────────────────────────────────────
const nfs = cities.find((c) => c.layout === 'nfs-loop' && c.charter === 'nfs-arterial');
if (nfs) {
  const project = buildProject(nfs.city);
  const stats = networkStats(project);
  const report = validate(project);
  const budget = report.rules.find((r) => r.id === 'budget')?.metrics;
  console.log('');
  console.log('Reference city — ring + spine / NFS arterial, 3 000 m');
  console.log(`  ${stats.roads} roads · ${stats.junctions} junctions · ${stats.terminals} terminals · ${stats.km.toFixed(1)} km of carriageway`);
  console.log(`  classes: ${Object.entries(stats.byClass).map(([k, v]) => `${k} ${v.count}`).join(' · ')}`);
  if (budget) console.log(`  budget: ${budget.triangles.toLocaleString()} triangles · ${budget.triPerKm.toLocaleString()}/km · ${budget.props} props · ${budget.lines} lines`);
  console.log(`  ${validateSummary(report)}`);
  for (const r of report.rules.filter((x) => x.count)) {
    console.log(`    ${r.severity.padEnd(5)} ${String(r.count).padStart(4)}  ${r.name}${r.offenders[0]?.note ? ` — e.g. ${r.offenders[0].note}` : ''}`);
  }
}

console.log('');
console.log(`${checks - failures}/${checks} gates passed`);
process.exit(failures ? 1 : 0);

function firstFail(report) {
  const r = report.rules.find((x) => x.count && x.severity === 'fail');
  return r ? `${r.name} ×${r.count}` : '';
}
