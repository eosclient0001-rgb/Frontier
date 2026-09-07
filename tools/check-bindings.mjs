/**
 * Cross-check WGSL binding declarations against the GPUBindGroupLayout
 * entries declared in TypeScript.
 *
 * A mismatch between the two is the single most common cause of a WebGPU
 * pipeline blowing up at creation time, and it is invisible to both tsc and a
 * WGSL parser because each side is individually valid. Since there is no GPU
 * in this sandbox to catch it at runtime, it gets checked statically here.
 *
 *   node tools/check-bindings.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shaderDir = join(here, '..', 'src', 'shaders');
const S = (p) => readFileSync(join(here, '..', p), 'utf8');

// ---- compose (same rules as the runtime composer) -------------------------
const sources = new Map();
for (const f of readdirSync(shaderDir)) {
  if (f.endsWith('.wgsl')) sources.set(f, readFileSync(join(shaderDir, f), 'utf8'));
}
sources.set('_generated_params.wgsl', 'struct Params { a: f32, }\n');
const INCLUDE_RE = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm;
function compose(name) {
  const emitted = new Set();
  const expand = (n, stack) => {
    const src = sources.get(n);
    if (!src) throw new Error(`missing ${n}`);
    if (stack.includes(n)) return '';
    return src.replace(INCLUDE_RE, (_x, inc) => {
      if (emitted.has(inc)) return '';
      emitted.add(inc);
      return expand(inc, [...stack, n]);
    });
  };
  return expand(name, []);
}

/** Classify a WGSL binding declaration into the layout entry kind it needs. */
function classify(decl) {
  const d = decl.replace(/\s+/g, ' ');
  if (/var<uniform>/.test(d)) return 'buffer:uniform';
  if (/var<storage,\s*read_write>/.test(d)) return 'buffer:storage';
  if (/var<storage,\s*read>/.test(d)) return 'buffer:read-only-storage';
  if (/var<storage>/.test(d)) return 'buffer:read-only-storage';
  if (/texture_storage_\w+<[^>]*,\s*write\s*>/.test(d)) {
    const f = d.match(/texture_storage_\w+<\s*([a-z0-9]+)/);
    return `storageTexture:write-only:${f ? f[1] : '?'}`;
  }
  if (/texture_storage_\w+<[^>]*,\s*read_write\s*>/.test(d)) return 'storageTexture:read-write';
  if (/texture_storage_\w+<[^>]*,\s*read\s*>/.test(d)) return 'storageTexture:read-only';
  if (/:\s*sampler\b/.test(d)) return 'sampler';
  if (/texture_\w+</.test(d) || /:\s*texture_/.test(d)) return 'texture';
  return 'unknown';
}

function wgslBindings(src) {
  const out = new Map();
  const re = /@group\((\d+)\)\s*@binding\((\d+)\)\s*(var[^;]*;)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const g = +m[1], b = +m[2];
    out.set(`${g}.${b}`, classify(m[3]));
  }
  return out;
}

/** Parse a createBindGroupLayout({...}) block from TS into the same shape. */
function tsLayout(src, label) {
  const i = src.indexOf(`label: '${label}'`);
  if (i < 0) return null;
  // find the enclosing entries array
  const from = src.indexOf('entries: [', i);
  if (from < 0) return null;
  let depth = 0, end = from;
  for (let k = src.indexOf('[', from); k < src.length; k++) {
    if (src[k] === '[') depth++;
    else if (src[k] === ']') { depth--; if (depth === 0) { end = k; break; } }
  }
  const body = src.slice(from, end);
  const out = new Map();
  // Split the entries array into balanced top-level { ... } objects rather
  // than using a lookahead, which silently dropped the final entry.
  const objs = [];
  let od = 0, start = -1;
  for (let k = 0; k < body.length; k++) {
    if (body[k] === '{') { if (od === 0) start = k; od++; }
    else if (body[k] === '}') { od--; if (od === 0 && start >= 0) { objs.push(body.slice(start, k + 1)); start = -1; } }
  }
  for (const e of objs) {
    const bm = e.match(/binding:\s*(\d+)/);
    if (!bm) continue;
    const b = +bm[1];
    let kind = 'unknown';
    const bt = e.match(/buffer:\s*\{\s*type:\s*'([^']+)'/);
    const st = e.match(/storageTexture:\s*\{\s*access:\s*'([^']+)'/);
    const sf = e.match(/format:\s*VOLUME_FORMAT|format:\s*'([^']+)'/);
    if (bt) kind = `buffer:${bt[1]}`;
    else if (st) {
      // VOLUME_FORMAT is the rgba16float constant from resources.ts
      const fmt = /VOLUME_FORMAT/.test(e) ? 'rgba16float' : (sf && sf[1] ? sf[1] : '?');
      kind = `storageTexture:${st[1]}:${fmt}`;
    }
    else if (/sampler:\s*\{/.test(e)) kind = 'sampler';
    else if (/texture:\s*\{/.test(e)) kind = 'texture';
    out.set(b, kind);
  }
  return out;
}

const simTs = S('src/sim/simulation.ts');
const renTs = S('src/render/renderer.ts');

// shader -> [ts source, layout label, group index]
const CASES = [
  ['surface.wgsl', simTs, 'sim layout', 0],
  ['hydro_flux.wgsl', simTs, 'sim layout', 0],
  ['hydro_update.wgsl', simTs, 'sim layout', 0],
  ['hydro_erode.wgsl', simTs, 'sim layout', 0],
  ['hydro_advect.wgsl', simTs, 'sim layout', 0],
  ['thermal.wgsl', simTs, 'sim layout', 0],
  ['apply_height.wgsl', simTs, 'sim layout', 0],
  ['erode3d.wgsl', simTs, 'sim layout', 0],
  ['redistance.wgsl', simTs, 'sim layout', 0],
  ['init_terrain.wgsl', simTs, 'init layout', 0],
  ['sculpt.wgsl', simTs, 'sculpt layout', 0],
  ['pick.wgsl', simTs, 'pick layout', 0],
  ['render.wgsl', renTs, 'render g0', 0],
  ['render.wgsl', renTs, 'render g1', 1],
];

let fail = 0;
for (const [shader, ts, label, group] of CASES) {
  const w = wgslBindings(compose(shader));
  const t = tsLayout(ts, label);
  if (!t) { console.log(`✗ ${shader} — TS layout '${label}' not found`); fail++; continue; }

  const wgslForGroup = new Map();
  for (const [k, v] of w) {
    const [g, b] = k.split('.').map(Number);
    if (g === group) wgslForGroup.set(b, v);
  }

  const problems = [];
  for (const [b, kind] of wgslForGroup) {
    if (!t.has(b)) problems.push(`binding ${b} (${kind}) declared in WGSL but missing from TS layout`);
    else if (t.get(b) !== kind) problems.push(`binding ${b}: WGSL ${kind} vs TS ${t.get(b)}`);
  }
  for (const [b, kind] of t) {
    if (!wgslForGroup.has(b)) problems.push(`binding ${b} (${kind}) in TS layout but unused by WGSL`);
  }

  if (problems.length === 0) {
    const list = [...wgslForGroup.entries()].sort((a, b) => a[0] - b[0]).map(([b, k]) => `${b}:${k}`).join(' ');
    console.log(`✓ ${shader.padEnd(20)} g${group} [${label}]  ${list}`);
  } else {
    fail++;
    console.log(`✗ ${shader} g${group} [${label}]`);
    for (const p of problems) console.log(`    ${p}`);
  }
}

console.log(fail === 0 ? '\nAll bind group layouts agree with the shaders.' : `\n${fail} binding mismatch(es).`);
process.exit(fail === 0 ? 0 : 1);
