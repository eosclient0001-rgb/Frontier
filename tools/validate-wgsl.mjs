#!/usr/bin/env node
/**
 * WGSL validation gate.
 *
 * Compiles every shader module with naga (vendored wasm build) exactly as the
 * browser would: includes resolved, then parsed + type-checked. Any error is
 * reported with the source file and line so it can be fixed before the page
 * is ever opened.
 *
 *   node tools/validate-wgsl.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const SHADER_DIR = path.join(root, 'src', 'shaders');

const { initSync, run } = await import(
  pathToFileURL(path.join(here, 'vendor', 'nagami.js')).href
);
initSync({ module: fs.readFileSync(path.join(here, 'vendor', 'nagami_bg.wasm')) });

/** Same resolver the runtime uses: `#include "x.wgsl"` is spliced in place. */
function resolveIncludes(text, dir, seen = new Set()) {
  return text.replace(/^[ \t]*#include\s+"([^"]+)"[ \t]*$/gm, (_m, rel) => {
    const file = path.resolve(dir, rel);
    if (seen.has(file)) return '// #include (cycle) ' + rel;
    seen.add(file);
    if (!fs.existsSync(file)) throw new Error(`missing include ${rel} (from ${dir})`);
    return resolveIncludes(fs.readFileSync(file, 'utf8'), path.dirname(file), seen);
  });
}

/** Shader modules the app actually compiles (name -> entry file). */
const MODULES = [
  ['lib', 'lib.wgsl'],
  ['frame', 'frame.wgsl'],
  ['shading', 'shading.wgsl'],
  ['atmosphere', 'atmosphere.wgsl'],
  ['materials', 'materials.wgsl'],
  ['terrain_gen', 'terrain_gen.wgsl'],
  ['terrain_filter', 'terrain_filter.wgsl'],
  ['erosion', 'erosion.wgsl'],
  ['surface', 'surface.wgsl'],
  ['pack', 'pack.wgsl'],
  ['index_gen', 'index_gen.wgsl'],
  ['render', 'render.wgsl'],
  ['water', 'water.wgsl'],
  ['post', 'post.wgsl'],
  ['sky_lut', 'sky_lut.wgsl'],
];

let failures = 0;
let checked = 0;

for (const [name, file] of MODULES) {
  const full = path.join(SHADER_DIR, file);
  if (!fs.existsSync(full)) {
    console.log(`  ?  ${name.padEnd(14)} (${file}) not present yet`);
    continue;
  }
  let src;
  try {
    src = resolveIncludes(fs.readFileSync(full, 'utf8'), SHADER_DIR);
  } catch (e) {
    console.log(`  x  ${name.padEnd(14)} include error: ${e.message}`);
    failures++;
    continue;
  }
  try {
    run(src, { profile: 'baseline', mangle: false, validateEachPass: false });
    const lines = src.split('\n').length;
    console.log(`  ok ${name.padEnd(14)} ${String(lines).padStart(5)} lines`);
    checked++;
  } catch (e) {
    failures++;
    console.log(`  x  ${name.padEnd(14)} ${e.code || 'error'}`);
    const msg = (e.message || String(e)).split('\n').slice(0, 24).join('\n');
    console.log(msg.replace(/^/gm, '       '));
    if (e.line) {
      const lines = src.split('\n');
      const l = e.line;
      for (let i = Math.max(0, l - 3); i < Math.min(lines.length, l + 2); i++) {
        const mark = i === l - 1 ? ' >> ' : '    ';
        console.log(`       ${mark}${String(i + 1).padStart(4)} | ${lines[i]}`);
      }
    }
  }
}

console.log(`\n${checked} module(s) valid, ${failures} failing.`);
process.exit(failures ? 1 : 0);
