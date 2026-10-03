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
  UI_QUAD: S.UI_QUAD,
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
  for (const sn of ['Camera', 'Fabric', 'Sim', 'Con', 'Col', 'Ring', 'Cap', 'Preview', 'Quad']) {
    const info = show(r, sn);
    if (info && !seen.has(sn)) {
      seen.add(sn);
      console.log(`  ${sn.padEnd(8)} size=${info.size.toString().padStart(3)}  ${info.members.join('  ')}`);
    }
  }
}

console.log('\n== packing sanity ==');
const layout = (r, name) => {
  const st = r.structs.find((s) => s.name === name);
  return st ? st.size : null;
};
const clothR = parsed.CLOTH_RENDER;
ok(layout(clothR, 'Camera') === 192, `Camera uniform = 192 bytes (app.js writes 48 f32)`, `got ${layout(clothR, 'Camera')}`);
ok(layout(clothR, 'Fabric') === 128, `Fabric uniform = 128 bytes (packFabric writes 32 f32)`, `got ${layout(clothR, 'Fabric')}`);
const predictR = parsed.PREDICT;
ok(layout(predictR, 'Sim') === 64, `Sim uniform = 64 bytes (app.js writes 16 f32)`, `got ${layout(predictR, 'Sim')}`);
const collideR = parsed.COLLIDE;
ok(layout(collideR, 'Col') === 176, `Collision uniform = 176 bytes (app.js writes 44 f32)`, `got ${layout(collideR, 'Col')}`);
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
for (const [name, code] of Object.entries(shaders)) {
  const b = bindingsUsed(code);
  const contiguous = b.every((v, i) => v === i);
  ok(contiguous, `${name} bindings are 0..${b.length - 1}`, JSON.stringify(b));
}

console.log(`\n${failures === 0 ? '✅ WGSL checks passed' : `❌ ${failures} problem(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);

