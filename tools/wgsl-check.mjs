// Shader + GPU-contract checks. Runs with no install: the WGSL is scanned by
// tools/wgsl-parse.mjs, and wgsl_reflect is used as an extra full parse only
// when node_modules happens to be present.
//
// Run: node tools/wgsl-check.mjs
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as S from '../src/shaders.js';
import { CONTRACT } from '../src/layout.js';
import { parseShader, bindingCount } from './wgsl-parse.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const reflectPath = join(here, '..', 'node_modules', 'wgsl_reflect');
let WgslReflect = null;
if (existsSync(reflectPath)) {
  try {
    const { createRequire } = await import('node:module');
    const { copyFileSync } = await import('node:fs');
    const cjs = join(reflectPath, 'wgsl_reflect.cjs');
    if (!existsSync(cjs)) copyFileSync(join(reflectPath, 'wgsl_reflect.node.js'), cjs);
    WgslReflect = createRequire(import.meta.url)('wgsl_reflect/wgsl_reflect.cjs').WgslReflect;
    console.log('(wgsl_reflect found: running the extra full-parse pass)');
  } catch {
    WgslReflect = null;
  }
} else {
  console.log('(wgsl_reflect not installed: using the built-in WGSL scanner — run npm install for the extra parse pass)');
}

const SHADERS = {
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

// bindings app.js creates per pipeline (a mismatch is a silent black canvas)
const APP_BINDINGS = {
  CLEAR_LAMBDA: 1, PREDICT: 6, SOLVE_CONS: 3, SOLVE_PINS: 4, COLLIDE: 5,
  FINALIZE: 4, RESET_VERTEX: 4, CLOTH_RENDER: 6, BODY_RENDER: 1,
  PATTERN_QUAD: 2, GROUND_PLANE: 1,
};

let failures = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures++; console.log(`  ✗ ${msg} ${extra}`); }
};

const parsed = new Map();
console.log('\n== WGSL structure ==');
for (const [name, code] of Object.entries(SHADERS)) {
  const p = parseShader(code);
  parsed.set(name, p);
  const eps = [
    ...p.entries.compute.map((e) => `compute:${e.name}`),
    ...p.entries.vertex.map((e) => `vertex:${e.name}`),
    ...p.entries.fragment.map((e) => `fragment:${e.name}`),
  ];
  ok(eps.length > 0, `${name} declares entry points (${eps.join(', ')})`);
  const b = bindingCount(p.bindings);
  const keys = [...p.bindings.keys()].sort((x, y) => x - y);
  ok(keys.every((v, i) => v === i), `${name} @bindings are contiguous 0..${b - 1}`, keys.join(','));
  ok(b === APP_BINDINGS[name], `${name} binds what app.js binds (${APP_BINDINGS[name]})`, `shader has ${b}`);
  for (const e of p.entries.compute) {
    ok(/^\d+(,\s*\d+)*$/.test(e.workgroup), `${name} workgroup_size(${e.workgroup}) is literal`);
  }
}

if (WgslReflect) {
  console.log('\n== full parse (wgsl_reflect) ==');
  for (const [name, code] of Object.entries(SHADERS)) {
    try {
      const r = new WgslReflect(code);
      const eps = [
        ...r.entry.compute.map((e) => 'compute:' + e.name),
        ...r.entry.vertex.map((e) => 'vertex:' + e.name),
        ...r.entry.fragment.map((e) => 'fragment:' + e.name),
      ];
      ok(eps.length > 0, `${name} parses and is complete (${eps.length} entry points)`);
    } catch (e) {
      failures++;
      console.log(`  ✗ ${name} failed to parse: ${e.message ?? e}`);
    }
  }
}

console.log('\n== JS <-> WGSL struct contract ==');
for (const [structName, table] of Object.entries(CONTRACT)) {
  let found = null;
  let foundIn = '';
  for (const [name, p] of parsed) {
    const st = p.structs.get(structName);
    if (st) { found = st; foundIn = name; break; }
  }
  if (!found) { failures++; console.log(`  ✗ ${structName}: no shader declares it`); continue; }
  ok(found.size === table.size, `${structName} size ${table.size} matches WGSL (${found.size}) [${foundIn}]`);
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
if (WgslReflect) {
  const check = (shaderName, structName, expected) => {
    const r = new WgslReflect(SHADERS[shaderName]);
    const st = r.structs.find((x) => x.name === structName);
    ok(st && st.size === expected, `${shaderName}: ${structName} = ${expected} bytes (full parse)`,
      st ? `got ${st.size}` : 'missing');
  };
  check('CLOTH_RENDER', 'Camera', CONTRACT.Camera.size);
  check('CLOTH_RENDER', 'Fabric', CONTRACT.Fabric.size);
  check('PREDICT', 'Sim', CONTRACT.Sim.size);
  check('COLLIDE', 'Col', CONTRACT.Col.size);
  check('COLLIDE', 'Ring', 32);
  check('COLLIDE', 'Cap', 32);
  check('SOLVE_CONS', 'Con', 24);
  check('PATTERN_QUAD', 'Preview', CONTRACT.Preview.size);
}

console.log('\n== vertex layouts ==');
{
  const p = parsed.get('BODY_RENDER');
  const inputs = p.vertexInputs.get('vs') ?? [];
  const locs = inputs.map((i) => i.location).sort((a, b) => a - b);
  ok(locs.join(',') === '0,1,2', 'BODY_RENDER vertex inputs are @location 0,1,2', locs.join(','));
  const sizes = ['vec3f', 'vec3f', 'vec2f'];
  ok(inputs.map((i) => i.type).join(',') === sizes.join(','),
    'BODY_RENDER inputs are (pos vec3f, normal vec3f, uv vec2f) — 32 byte stride',
    inputs.map((i) => i.type).join(','));
}

console.log('\n== solver step contract ==');
const writes = (code, buf) => new RegExp(`${buf}\\[[a-z0-9_ ]*\\]\\s*=`).test(code);
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

console.log('\n== WGSL shaping rules ==');
const rules = {
  'no ternary operator (use if/else)': (c) => !/\?[^:{}\n]+\s*:\s*[^:{}\n]+;/.test(c),
  'no backticks inside shader source': (c) => !c.includes('`'),
  'no reserved word "type" as an identifier': (c) => !/\blet\s+type\b|\bvar\s+type\b/.test(c),
};
for (const [name, code] of Object.entries(SHADERS)) {
  for (const [label, test] of Object.entries(rules)) ok(test(code), `${name}: ${label}`);
}
// Scalar types must match in WGSL: `i * 0.37` with `i: u32` is a hard compile
// error, and this environment has no compiler, so track which identifiers are
// integers and flag arithmetic against a float literal. Analysis is scoped per
// function, because the fabric library and the renderers reuse short names.
function functionBodies(code) {
  const src = code.replace(/\/\/[^\n]*/g, '');
  const out = [];
  const re = /fn\s+(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    // signature: from the name to the opening brace of the body
    const braceAt = src.indexOf('{', m.index);
    if (braceAt < 0) continue;
    let depth = 0;
    let i = braceAt;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    out.push({ name: m[1], text: src.slice(m.index, i + 1) });
  }
  return out;
}

function integerIdentifiers(bodyText) {
  const u32 = new Set();
  const decl = (name) => { if (name) u32.add(name); };
  for (const m of bodyText.matchAll(/(?:let|var)\s+(\w+)\s*:\s*u32/g)) decl(m[1]);
  for (const m of bodyText.matchAll(/(?:let|var)\s+(\w+)\s*=\s*[^;]*?\bu\b/g)) decl(m[1]);
  for (const m of bodyText.matchAll(/(?:let|var)\s+(\w+)\s*=\s*(?:gid|info|params|counts)\.[xyzw]\b/g)) decl(m[1]);
  for (const m of bodyText.matchAll(/(?:let|var)\s+(\w+)\s*=\s*u32\(/g)) decl(m[1]);
  for (const m of bodyText.matchAll(/(\w+)\s*:\s*u32/g)) decl(m[1]);
  // one hop of aliasing (let r = info.x; let cm = r + 1u;)
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of bodyText.matchAll(/(?:let|var)\s+(\w+)\s*=\s*([\w.]+)\s*(?:[;)\-+*/]|$)/gm)) {
      if (u32.has(m[2]) && !u32.has(m[1])) { u32.add(m[1]); grew = true; }
    }
  }
  return u32;
}

let mixes = 0;
for (const [name, code] of Object.entries(SHADERS)) {
  for (const fn of functionBodies(code)) {
    const ints = integerIdentifiers(fn.text);
    if (!ints.size) continue;
    for (const line of fn.text.split('\n')) {
      if (/^\s*\/\//.test(line)) continue;
      for (const id of ints) {
        const re = new RegExp(`\\b${id}\\s*[-+*/]\\s*\\d+\\.\\d+|\\d+\\.\\d+\\s*[-+*/]\\s*${id}\\b`);
        if (re.test(line) && !new RegExp(`f32\\(\\s*${id}\\s*\\)`).test(line)) {
          mixes++;
          console.log(`    ${name}.${fn.name}: ${line.trim()}`);
          break;
        }
      }
    }
  }
}
ok(mixes === 0, 'no implicit u32/f32 arithmetic (scalar types must match)', `${mixes} suspicious site(s)`);

console.log(`\n${failures === 0 ? '✅ WGSL checks passed' : `❌ ${failures} problem(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
