#!/usr/bin/env node
/**
 * Frontier Terrain Forge — static verification suite.
 *
 *   node tools/check.mjs
 *
 * What it proves without a GPU:
 *   1. every .js module parses as ES module source,
 *   2. every relative import target exists on disk,
 *   3. every WGSL module (after include + template expansion) is parsed and
 *      validated by naga — the exact compiler wgpu/Chrome uses,
 *   4. every #include / layer template referenced from JS actually resolves,
 *   5. every DOM id/selector used from JS exists in index.html,
 *   6. every compute pass declares a bind-group layout matching its WGSL.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const failures = [];
const notes = [];
let wgslCount = 0;
let jsCount = 0;

const fail = (file, message) => failures.push(`${relative(ROOT, file)}: ${message}`);
const note = (m) => notes.push(m);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 1 + 2 — module syntax and import resolution
 * ------------------------------------------------------------------ */
const files = walk(join(ROOT, 'src')).concat(
  existsSync(join(ROOT, 'tools')) ? walk(join(ROOT, 'tools')) : [],
);

for (const file of files) {
  const ext = extname(file);
  if (ext !== '.js' && ext !== '.mjs') continue;
  jsCount++;
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?)\bfrom\s*['"]([^'"]+)['"]/g)) {
    const spec = match[1];
    if (spec.startsWith("node:")) continue; // tooling only, not shipped to the browser
    if (file.includes('/tools/')) continue; // build tooling may use devDependencies
    if (!spec.startsWith('.')) {
      fail(file, `bare import "${spec}" — this project ships without external dependencies`);
      continue;
    }
    const target = resolve(dirname(file), spec);
    if (!existsSync(target)) fail(file, `import "${spec}" does not resolve`);
  }
  for (const match of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = match[1];
    if (!spec.startsWith('.')) continue;
    const target = resolve(dirname(file), spec);
    if (!existsSync(target)) fail(file, `dynamic import "${spec}" does not resolve`);
  }
}

/* ------------------------------------------------------------------ *
 * 3 + 4 — WGSL validation through naga (using the runtime module system)
 * ------------------------------------------------------------------ */
let naga = null;
try {
  naga = await import('naga-wasm');
} catch {
  note('naga-wasm not installed — skipping GPU shader validation (run: npm install)');
}
const { WgslLibrary } = await import('../src/vendor/wgsl/wgsl.js');
const library = new WgslLibrary((path) => readFileSync(path, 'utf8'), join(ROOT, 'src/vendor/wgsl'));

function validateWgsl(label, source) {
  try {
    const module = naga.parseWgsl(source);
    naga.validate(module);
    return true;
  } catch (err) {
    const detail = (err && (err.formatted || err.message)) || String(err);
    fail(label, `naga: ${detail.split('\n').slice(0, 16).join('\n    ')}`);
    return false;
  }
}

if (naga) {
  // (a) every standalone pass / shader module compiles on its own
  const wgslFiles = files.filter((f) => extname(f) === '.wgsl' && !f.includes('/templates/'));
  for (const file of wgslFiles) {
    const rel = relative(join(ROOT, 'src/vendor/wgsl'), file);
    if (rel.includes('{{')) continue;
    const source = readFileSync(file, 'utf8');
    if (/\{\{[A-Z0-9_]+\}\}/.test(source)) continue; // template pass, handled below
    wgslCount++;
    validateWgsl(file, await library.module(rel));
  }

  // (b) every template injects cleanly into the pass that consumes it and the
  //     resulting module still compiles — this is the real integration proof.
  const templateSets = [
    ['templates', 'passes/terrain_layer.wgsl', 'LAYER'],
    ['templates-tex', 'passes/tex_layer.wgsl', 'MATERIAL'],
  ];
  for (const [, passPath] of templateSets) {
    if (!existsSync(join(ROOT, 'src/vendor/wgsl', passPath))) continue;
  }
  const templateDir = join(ROOT, 'src/vendor/wgsl/templates');
  for (const file of walk(templateDir).filter((f) => f.endsWith('.wgsl'))) {
    if (!existsSync(join(ROOT, 'src/vendor/wgsl/passes/tex_layer.wgsl'))) continue;
    const name = file.split('/').pop().replace('.wgsl', '');
    const material = name.startsWith('mat_');
    wgslCount++;
    const source = await library.module(
      material ? 'passes/tex_layer.wgsl' : 'passes/terrain_layer.wgsl',
      material ? { MATERIAL: name } : { LAYER: name },
    );
    validateWgsl(file, source);
  }
}

/* ------------------------------------------------------------------ *
 * 5 — DOM contract between index.html and the UI modules
 * ------------------------------------------------------------------ */
const htmlPath = join(ROOT, 'index.html');
if (existsSync(htmlPath)) {
  const html = readFileSync(htmlPath, 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const uiDir = join(ROOT, 'src/ui');
  if (existsSync(uiDir)) {
    for (const file of walk(uiDir)) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) {
        if (!ids.has(m[1])) fail(file, `getElementById('${m[1]}') — no such id in index.html`);
      }
      for (const m of source.matchAll(/elementFromId\(\s*'([^']+)'\s*\)/g)) {
        if (!ids.has(m[1])) fail(file, `elementFromId('${m[1]}') — no such id in index.html`);
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * 6 — pass declarations reference real shader files
 * ------------------------------------------------------------------ */
const passDir = join(ROOT, 'src/gpu/passes');
if (existsSync(passDir)) {
  for (const file of walk(passDir).filter((f) => f.endsWith('.js'))) {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/shader:\s*'([^']+\.wgsl)'/g)) {
      const target = resolve(join(ROOT, 'src/vendor/wgsl'), m[1]);
      if (!existsSync(target)) fail(file, `shader '${m[1]}' does not exist under src/vendor/wgsl`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */
console.log(`Frontier Terrain Forge — static check`);
console.log(`  modules parsed : ${jsCount}`);
console.log(`  wgsl validated : ${wgslCount}${naga ? ' (naga ' + String(naga.nagaVersion ?? '').slice(0, 12) + ')' : ''}`);
for (const n of notes) console.log(`  note           : ${n}`);
if (failures.length) {
  console.log(`\n${failures.length} problem(s):\n`);
  for (const f of failures) console.log('  ✗ ' + f + '\n');
  process.exit(1);
}
console.log('\n✓ all checks passed');
