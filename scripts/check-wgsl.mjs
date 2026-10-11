// Parses every WGSL source in src/engine/shaders with wgsl_reflect, resolving #include directives
// exactly the way the runtime loader does. Catches syntax errors before they reach the browser.
import { WgslReflect } from '../node_modules/wgsl_reflect/wgsl_reflect.module.js';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'src/engine/shaders');
const files = readdirSync(dir).filter((f) => f.endsWith('.wgsl'));
const cache = new Map();

function load(file, stack = []) {
  const key = resolve(file);
  if (cache.has(key)) return cache.get(key);
  if (stack.includes(key)) throw new Error(`circular include: ${stack.join(' -> ')} -> ${key}`);
  let src = readFileSync(key, 'utf8');
  src = src.replace(/^\s*#include\s+"([^"]+)"\s*$/gm, (_, rel) => {
    const target = join(dirname(key), rel);
    return load(target, [...stack, key]);
  });
  cache.set(key, src);
  return src;
}

let failed = 0;
for (const f of files.sort()) {
  const path = join(dir, f);
  try {
    const src = load(path);
    const r = new WgslReflect(src);
    const eps = [...r.entry.vertex, ...r.entry.fragment, ...r.entry.compute].map((e) => e.name);
    console.log(`ok   ${f.padEnd(26)} ${String(src.length).padStart(6)} chars  [${eps.join(', ')}]`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${f}\n     ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
