// Runs every preset's terrain stack through TerrainEngine.build() against the
// mock device, then a worst-case 2048² field, then a corrupted layer.
//
//   node tools/smoke-build.mjs

import { installGlobals, makeDevice, Recorder, ROOT } from './mock-gpu.mjs';

installGlobals();
const rec = new Recorder();
const device = makeDevice(rec);

const { TerrainEngine } = await import(`file://${ROOT}/src/js/core/terrain.js`);
const { createProject, PRESETS } = await import(`file://${ROOT}/src/js/core/state.js`);

const engine = new TerrainEngine(device);
await engine.init();
console.log(`terrain pipelines: ${Object.keys(engine.pipe).length} + pack + index`);

let total = 0;
for (const key of Object.keys(PRESETS)) {
  const project = createProject(key);
  rec.dispatches = 0;
  const marks = [];
  const ok = await engine.build(project, (f, label) => marks.push([f, label]));
  if (!ok) rec.note(`${key}: build returned false`);
  const bad = marks.filter(([f]) => !Number.isFinite(f) || f < 0 || f > 1.0001);
  if (bad.length) rec.note(`${key}: bad progress ${JSON.stringify(bad.slice(0, 3))}`);
  const end = marks[marks.length - 1];
  if (!end || end[0] < 0.999) rec.note(`${key}: progress stopped at ${end?.[0]}`);
  console.log(`  ${key.padEnd(10)} ops=${String(rec.dispatches).padStart(4)}  progress=${end?.[0].toFixed(3)}`);
  total += rec.dispatches;
}

// worst case
const stress = createProject('alpine');
stress.globals.res = 2048;
stress.globals.renderRes = 1536;
for (const l of stress.terrain) {
  if (l.type === 'hydraulic') l.params.droplets = 2000000;
  if (l.type === 'thermal') l.params.iterations = 300;
  if (l.type === 'slopeBlur') l.params.iterations = 16;
}
rec.dispatches = 0;
await engine.build(stress, () => {});
console.log(`  ${'stress'.padEnd(10)} ops=${String(rec.dispatches).padStart(4)}  (2048², 2M droplets)`);
total += rec.dispatches;

// a corrupted project must degrade, not throw
stress.terrain.push({ id: 'X', type: 'nope', enabled: true, params: {}, blend: 0, opacity: 1, mask: { enabled: false } });
rec.dispatches = 0;
await engine.build(stress, () => {});
console.log(`  ${'bogus'.padEnd(10)} ops=${String(rec.dispatches).padStart(4)}  (unknown layer type skipped)`);

console.log(`\ndispatches: ${total}`);
console.log(rec.problems.length ? `FAIL — ${rec.problems.length} problem(s)` : 'PASS — build graph is sound');
for (const p of rec.problems) console.log('  !', p);
process.exit(rec.problems.length ? 1 : 0);
