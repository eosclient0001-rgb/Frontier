// Static cross-check: every pipeline entry point requested from JS must exist in
// the shader module it is built from (includes resolved), and every @group(0)
// @binding(n) the shader declares must be present in the JS bind group layout.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || '.');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function resolve(file, seen = new Set()) {
  const abs = path.join(ROOT, file);
  if (seen.has(abs)) return '';
  seen.add(abs);
  return read(file).split('\n').map((line) => {
    const m = /^\s*#include\s+"([^"]+)"\s*$/.exec(line);
    return m ? resolve(path.join(path.dirname(file), m[1]), seen) : line;
  }).join('\n');
}

/** Entry points declared in a resolved module. */
function entries(src) {
  const out = new Set();
  for (const m of src.matchAll(/^\s*fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)) out.add(m[1]);
  return out;
}

/** @group(0) @binding(N) declarations. */
function bindings(src) {
  const out = new Map();
  const re = /@group\(\s*(\d+)\s*\)\s*@binding\(\s*(\d+)\s*\)[^;{]*?(?:var(?:<[^>]*>)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^;]+);)/gs;
  for (const m of src.matchAll(re)) {
    if (m[1] !== '0') continue;
    out.set(Number(m[2]), { name: m[3], type: m[4].trim() });
  }
  return out;
}

const FILES = ['src/js/core/terrain.js', 'src/js/core/renderer.js'];
let problems = 0;

for (const file of FILES) {
  const js = read(file);

  // loadShader('...') -> variable
  const shaderVar = {};
  for (const m of js.matchAll(/loadShader\(\s*'([^']+)'\s*\)/g)) {
    const whole = m[0];
    const before = js.slice(0, m.index);
    const decl = /([A-Za-z_$][\w$]*)\s*(?::\s*[^,)]+)?\s*=\s*(?:await\s+)?loadShader\(\s*'([^']+)'\s*\)/.exec(
      js.slice(Math.max(0, m.index - 60), m.index + whole.length));
    if (decl) shaderVar[decl[1]] = decl[2];
    void before;
  }
  // also handle "const [gen, filt] = await Promise.all([loadShader(...), ...])"
  for (const m of js.matchAll(/const\s*\[([^\]]+)\]\s*=\s*await\s+Promise\.all\(\[([\s\S]*?)\]\)/g)) {
    const names = m[1].split(',').map((s) => s.trim());
    const calls = [...m[2].matchAll(/loadShader\(\s*'([^']+)'\s*\)/g)].map((c) => c[1]);
    names.forEach((n, i) => { if (calls[i]) shaderVar[n] = calls[i]; });
  }

  const sources = {};
  for (const [v, f] of Object.entries(shaderVar)) sources[v] = resolve(f);

  // makePipelines(device, <var>, '<label>', { ... })
  const calls = [...js.matchAll(/makePipelines\(\s*device\s*,\s*([A-Za-z_$][\w$]*)\s*,\s*'[^']*'\s*,\s*\{/g)];
  for (const c of calls) {
    const varName = c[1];
    const src = sources[varName];
    if (!src) { console.log(`  ?  ${file}: unknown shader variable ${varName}`); problems++; continue; }
    // walk braces to find the spec object
    let i = c.index + c[0].length - 1;
    let depth = 0, end = i;
    for (; i < js.length; i++) {
      if (js[i] === '{') depth++;
      else if (js[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const spec = js.slice(c.index, end + 1);
    const have = entries(src);
    // split the spec object into top-level key/value chunks
    const body = spec.slice(spec.indexOf('{') + 1, end - c.index - 1);
    const chunks = [];
    let d2 = 0, start = 0;
    for (let k = 0; k < body.length; k++) {
      const ch = body[k];
      if (ch === '{' || ch === '(' || ch === '[') d2++;
      else if (ch === '}' || ch === ')' || ch === ']') d2--;
      else if (ch === ',' && d2 === 0) { chunks.push(body.slice(start, k)); start = k + 1; }
    }
    chunks.push(body.slice(start));

    const missing = [];
    let n = 0;
    for (const chunk of chunks) {
      const km = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(chunk);
      if (!km) continue;
      const key = km[1];
      const isSpec = /^\s*[A-Za-z_$][\w$]*\s*:\s*\{[\s\S]*\}\s*$/.test(chunk)
        || /^\s*[A-Za-z_$][\w$]*\s*:\s*[A-Za-z_$][\w$]*\s*$/.test(chunk);
      if (!isSpec) continue;
      n++;
      const vm = /\bvertex\s*:\s*'([^']+)'/.exec(chunk);
      const fm = /\bfragment\s*:\s*'([^']+)'/.exec(chunk);
      const em = /\bentry\s*:\s*'([^']+)'/.exec(chunk);
      const want = [
        ...(vm ? [[key + ':vs', vm[1]]] : []),
        ...(fm ? [[key + ':fs', fm[1]]] : []),
        ...(em ? [[key, em[1]]] : []),
        ...(vm || fm || em ? [] : [[key, key]]),
      ];
      for (const [lbl, entry] of want) {
        if (!have.has(entry)) missing.push(`${lbl} -> ${entry}`);
      }
    }
    const label = varName;
    if (missing.length) {
      console.log(`  ✗  ${file} · ${label}: missing entry points: ${missing.join(', ')}`);
      problems++;
    } else {
      console.log(`  ✓  ${file} · ${label}: ${n} pipelines, ${have.size} fns`);
    }
    void bindings;
  }

  // report binding usage per shader for a manual sanity read
  for (const [v, f] of Object.entries(shaderVar)) {
    const b = bindings(sources[v]);
    const list = [...b.entries()].sort((a, z) => a[0] - z[0]).map(([n, d]) => `${n}:${d.name}`);
    console.log(`     ${f.padEnd(30)} bindings ${list.join(' ')}`);
  }
}

console.log(problems ? `\n${problems} problem(s)` : '\nall pipeline entry points resolve');
process.exit(problems ? 1 : 0);
