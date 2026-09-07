/**
 * Offline WGSL sanity check.
 *
 * The sandbox has no GPU, so this parses every composed shader with
 * wgsl_reflect to catch syntax errors, and reports the entry points and
 * binding layout it found. It is a parser, not a full validator: it will not
 * catch type errors, but it catches the overwhelming majority of typos before
 * they ever reach the browser.
 *
 *   node tools/check-shaders.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WgslReflect } from '../node_modules/wgsl_reflect/wgsl_reflect.module.js';

const here = dirname(fileURLToPath(import.meta.url));
const shaderDir = join(here, '..', 'src', 'shaders');

// --- Re-implement the param struct generation without importing TypeScript ---
const paramsTs = readFileSync(join(here, '..', 'src', 'params.ts'), 'utf8');
const defRe = /name:\s*'([A-Za-z0-9_]+)',\s*kind:\s*'(f32|u32)'/g;
const params = [];
let m;
while ((m = defRe.exec(paramsTs)) !== null) params.push({ name: m[1], kind: m[2] });
const padded = Math.ceil(params.length / 4) * 4;

let generated = 'struct Params {\n';
for (const p of params) generated += `  ${p.name}: ${p.kind},\n`;
for (let i = params.length; i < padded; i++) generated += `  _pad${i - params.length}: f32,\n`;
generated += '}\n';

const sources = new Map();
for (const f of readdirSync(shaderDir)) {
  if (f.endsWith('.wgsl')) sources.set(f, readFileSync(join(shaderDir, f), 'utf8'));
}
sources.set('_generated_params.wgsl', generated);

const INCLUDE_RE = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm;

function compose(name) {
  const emitted = new Set();
  const expand = (n, stack) => {
    const src = sources.get(n);
    if (src === undefined) throw new Error(`missing include "${n}" (from ${stack.at(-1) ?? 'root'})`);
    if (stack.includes(n)) return '';
    return src.replace(INCLUDE_RE, (_x, inc) => {
      if (emitted.has(inc)) return `// [${inc} already included]`;
      emitted.add(inc);
      return expand(inc, [...stack, n]);
    });
  };
  return expand(name, []);
}

// Roots = shaders with at least one entry point (skip pure include libraries).
const roots = [...sources.keys()].filter((f) => {
  const s = sources.get(f);
  return /@(compute|vertex|fragment)/.test(s) && !f.startsWith('_');
});

console.log(`Params: ${params.length} scalars → ${padded * 4} bytes\n`);

let fail = 0;
for (const r of roots.sort()) {
  let composed;
  try {
    composed = compose(r);
  } catch (e) {
    console.log(`✗ ${r}\n    include error: ${e.message}`);
    fail++;
    continue;
  }
  try {
    const refl = new WgslReflect(composed);
    const eps = [
      ...refl.entry.compute.map((e) => `compute:${e.name}`),
      ...refl.entry.vertex.map((e) => `vertex:${e.name}`),
      ...refl.entry.fragment.map((e) => `fragment:${e.name}`),
    ];
    const binds = [];
    for (const g of refl.getBindGroups()) {
      g.forEach((b, i) => { if (b) binds.push(`${b.group}.${i}:${b.resourceType?.toString?.() ?? '?'}`); });
    }
    const lines = composed.split('\n').length;
    console.log(`✓ ${r.padEnd(26)} ${String(lines).padStart(5)} lines  [${eps.join(', ')}]`);
    if (binds.length) console.log(`    bindings: ${binds.join('  ')}`);
  } catch (e) {
    fail++;
    const msg = String(e.message ?? e);
    console.log(`✗ ${r}\n    ${msg}`);
    const lm = msg.match(/line:?\s*(\d+)/i);
    if (lm) {
      const ln = parseInt(lm[1], 10);
      const src = composed.split('\n');
      for (let i = Math.max(0, ln - 4); i < Math.min(src.length, ln + 3); i++) {
        console.log(`    ${String(i + 1).padStart(5)}${i === ln - 1 ? ' >' : '  '} ${src[i]}`);
      }
    }
  }
}
console.log(fail === 0 ? '\nAll shaders parsed.' : `\n${fail} shader(s) failed.`);
process.exit(fail === 0 ? 0 : 1);
