// Parse every WGSL shader with wgsl_reflect and verify struct layouts match the
// byte packing done on the JS side. Run: node tools/wgsl-check.mjs
import { createRequire } from 'node:module';
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// wgsl_reflect ships a CJS build inside a "type": "module" package, so Node
// refuses to load it as-is. Keep a .cjs copy next to it and require that.
const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..', 'node_modules', 'wgsl_reflect');
if (!existsSync(join(pkg, 'wgsl_reflect.cjs'))) {
  copyFileSync(join(pkg, 'wgsl_reflect.node.js'), join(pkg, 'wgsl_reflect.cjs'));
}
const require = createRequire(import.meta.url);
const { WgslReflect } = require('wgsl_reflect/wgsl_reflect.cjs');
import * as S from '../src/shaders.js';
import { CONTRACT } from '../src/layout.js';

let failures = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures++; console.log(`  ✗ ${msg} ${extra}`); }
};

const shaders = {
  CLEAR_LAMBDA: S.CLEAR_LAMBDA,
  PREDICT: S.PREDICT,
  SOLVE_CONS: S.SOLVE_CONS,
  SOLVE_PINS: S.SOLVE_PINS,
  COLLIDE: S.COLLIDE,
  FINALIZE: S.FINALIZE,
  RESET_VERTEX: S.RESET_VERTEX,
  CLOTH_RENDER: S.CLOTH_RENDER,
  BODY_RENDER: S.BODY_RENDER,
  PATTERN_QUAD: S.PATTERN_QUAD,
  GROUND_PLANE: S.GROUND_PLANE,
};

const parsed = {};
console.log('\n== WGSL parse ==');
for (const [name, code] of Object.entries(shaders)) {
  try {
    const r = new WgslReflect(code);
    parsed[name] = r;
    const entries = [
      ...r.entry.compute.map((e) => 'compute:' + e.name),
      ...r.entry.vertex.map((e) => 'vertex:' + e.name),
      ...r.entry.fragment.map((e) => 'fragment:' + e.name),
    ];
    ok(entries.length > 0, `${name} parses (${entries.join(', ') || 'no entry points'})`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name} failed to parse: ${e.message ?? e}`);
  }
}

console.log('\n== struct layouts (WGSL) ==');
const seen = new Set();
const show = (r, structName) => {
  const st = r.structs.find((s) => s.name === structName);
  if (!st) return null;
  const members = st.members.map((m) => `${m.name}:${m.type.name}@${m.offset}/${m.size}`);
  return { size: st.size, members };
};
for (const [name, r] of Object.entries(parsed)) {
  for (const sn of ['Camera', 'Fabric', 'Sim', 'Con', 'Col', 'Ring', 'Cap', 'Preview']) {
    const info = show(r, sn);
    if (info && !seen.has(sn)) {
      seen.add(sn);
      console.log(`  ${sn.padEnd(8)} size=${info.size.toString().padStart(3)}  ${info.members.join('  ')}`);
    }
  }
}

console.log('\n== JS <-> WGSL struct contract ==');
// The offsets app.js writes are declared in src/layout.js; assert the shaders
// agree member-for-member so a packing change cannot silently break the GPU.
for (const [structName, table] of Object.entries(CONTRACT)) {
  let found = null;
  for (const r of Object.values(parsed)) {
    const st = r.structs.find((x) => x.name === structName);
    if (st) { if (found && found.size !== st.size) failures++; found = st; }
  }
  if (!found) { failures++; console.log(`  ✗ ${structName}: no shader declares it`); continue; }
  ok(found.size === table.size, `${structName} size ${table.size} matches WGSL (${found.size})`);
  const names = found.members.map((m) => m.name);
  const want = table.members.map((m) => m.name);
  ok(names.join(',') === want.join(','), `${structName} member order`, `wgsl=[${names}] js=[${want}]`);
  for (const m of table.members) {
    const wm = found.members.find((x) => x.name === m.name);
    if (!wm) continue;
    ok(wm.offset === m.offset && wm.size === m.size,
      `${structName}.${m.name} @${m.offset}/${m.size}`,
      `wgsl @${wm.offset}/${wm.size}`);
  }
}

console.log('\n== solver step contract ==');
// Guard the loop invariants the CPU mirror in tools/sim-test.mjs asserts.
const writes = (code, buf) => new RegExp(`${buf}\\[[a-z0-9_ ]*\\]\\s*=`, 'g').test(code);
ok(writes(S.PREDICT, 'pos') && writes(S.PREDICT, 'vel') && writes(S.PREDICT, 'prev'),
  'PREDICT integrates pos and records vel/prev');
ok(writes(S.SOLVE_CONS, 'pos'), 'SOLVE_CONS moves pos');
ok(S.SOLVE_CONS.includes('cons[ci].lam ='), 'SOLVE_CONS accumulates lambda');
ok(writes(S.SOLVE_PINS, 'pos'), 'SOLVE_PINS writes pos');
ok(writes(S.COLLIDE, 'pos') && S.COLLIDE.includes('prev[i] ='), 'COLLIDE projects pos and folds friction into prev');
ok(S.FINALIZE.includes('pos[i].xyz - prev[i].xyz'), 'FINALIZE derives velocity from pos/prev');
ok(writes(S.RESET_VERTEX, 'pos') && writes(S.RESET_VERTEX, 'vel') && writes(S.RESET_VERTEX, 'prev'),
  'RESET_VERTEX restores pos/vel/prev');
ok(S.PREDICT.includes('nrm[i]') && S.CLOTH_RENDER.includes('nrm[vi]'),
  'straps shade and take wind from the baked rest normals');

console.log('\n== packing sanity ==');
const layout = (r, name) => {
  const st = r.structs.find((s) => s.name === name);
  return st ? st.size : null;
};
const clothR = parsed.CLOTH_RENDER;
ok(layout(clothR, 'Camera') === CONTRACT.Camera.size,
  `Camera uniform = ${CONTRACT.Camera.size} bytes`, `got ${layout(clothR, 'Camera')}`);
ok(layout(clothR, 'Fabric') === CONTRACT.Fabric.size,
  `Fabric uniform = ${CONTRACT.Fabric.size} bytes (packFabric writes 32 f32)`, `got ${layout(clothR, 'Fabric')}`);
const predictR = parsed.PREDICT;
ok(layout(predictR, 'Sim') === CONTRACT.Sim.size,
  `Sim uniform = ${CONTRACT.Sim.size} bytes`, `got ${layout(predictR, 'Sim')}`);
const collideR = parsed.COLLIDE;
ok(layout(collideR, 'Col') === CONTRACT.Col.size,
  `Collision uniform = ${CONTRACT.Col.size} bytes`, `got ${layout(collideR, 'Col')}`);
ok(layout(collideR, 'Ring') === 32, `Ring = 32 bytes (packCollision strides 32)`, `got ${layout(collideR, 'Ring')}`);
ok(layout(collideR, 'Cap') === 32, `Cap = 32 bytes (packCollision strides 32)`, `got ${layout(collideR, 'Cap')}`);
const solveR = parsed.SOLVE_CONS;
ok(layout(solveR, 'Con') === 24, `Con = 24 bytes (CON_STRIDE 6 x 4)`, `got ${layout(solveR, 'Con')}`);

console.log('\n== binding consistency ==');
const bindingsUsed = (code) => {
  const set = new Set();
  const re = /@group\(0\)\s*@binding\((\d+)\)/g;
  let m;
  while ((m = re.exec(code))) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
};
// binding numbers app.js binds, per pipeline
const APP_BINDINGS = {
  CLEAR_LAMBDA: 1, PREDICT: 6, SOLVE_CONS: 3, SOLVE_PINS: 4, COLLIDE: 5,
  FINALIZE: 4, RESET_VERTEX: 4, CLOTH_RENDER: 6, BODY_RENDER: 1,
  PATTERN_QUAD: 2, GROUND_PLANE: 1,
};
for (const [name, code] of Object.entries(shaders)) {
  const b = bindingsUsed(code);
  const contiguous = b.every((v, i) => v === i);
  ok(contiguous, `${name} bindings are 0..${b.length - 1}`, JSON.stringify(b));
  if (APP_BINDINGS[name] !== undefined) {
    ok(b.length === APP_BINDINGS[name],
      `${name} bind count matches app.js (${APP_BINDINGS[name]})`, `shader has ${b.length}`);
  }
}

console.log(`\n${failures === 0 ? '✅ WGSL checks passed' : `❌ ${failures} problem(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);

