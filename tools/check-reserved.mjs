/**
 * WGSL reserved-keyword check.
 *
 * The WGSL spec reserves a large list of words for future use. They are not
 * keywords today and they read like perfectly ordinary variable names -
 * 'from', 'target', 'patch', 'sample', 'filter', 'shared' - but a conformant
 * compiler REJECTS them as identifiers. wgsl_reflect (used by the other
 * checks here) accepts them happily, so a shader can pass every offline test
 * and still fail to compile in the browser, taking its whole pipeline with
 * it. That is exactly what happened: 'patch' in render.wgsl meant the render
 * pipeline never built and the canvas showed nothing but the clear colour.
 *
 *   node tools/check-reserved.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shaderDir = join(here, '..', 'src', 'shaders');

// Reserved words from the WGSL spec (§ Reserved Words).
const RESERVED = new Set(`
NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto
await become binding_array cast catch class co_await co_return co_yield coherent
column_major common compile compile_fragment concept const_cast consteval constexpr
constinit crate debugger decltype delete demote demote_to_helper do dynamic_cast
enum explicit export extends extern external fallthrough filter final finally friend
from fxgroup get goto groupshared highp impl implements import inline instanceof
interface layout lowp macro macro_rules match mediump meta mod module move mutable
namespace new nil noexcept noinline nointerpolation non_coherent noncoherent noperspective
null nullptr of operator package packoffset partition pass patch pixelfragment
precise precision premerge priv protected pub public quat readonly reference
regardless register reinterpret_cast require resource restrict self set shared
sizeof smooth snorm static static_assert static_cast std subroutine super target
template this thread_local throw trait try type typedef typeid typename typeof
union unless unorm unsafe unsized use using varying virtual volatile wgsl where
with writeonly yield
`.trim().split(/\s+/));

// Identifier positions we can detect cheaply and unambiguously.
const DECL_RE = /\b(?:let|var|const|fn|alias|struct)\s+(?:<[^>]*>\s*)?([A-Za-z_][A-Za-z0-9_]*)/g;
const PARAM_RE = /\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:ptr\s*<|[A-Za-z_])/g;

let violations = 0;
const files = readdirSync(shaderDir).filter((f) => f.endsWith('.wgsl')).sort();

for (const f of files) {
  const src = readFileSync(join(shaderDir, f), 'utf8');
  const lines = src.split('\n');
  const hits = [];

  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    for (const re of [DECL_RE, PARAM_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code)) !== null) {
        if (RESERVED.has(m[1])) hits.push({ line: i + 1, name: m[1], text: line.trim() });
      }
    }
  });

  if (hits.length) {
    console.log(`\n  ✗ ${f}`);
    for (const h of hits) {
      console.log(`      line ${h.line}: '${h.name}' is a reserved keyword`);
      console.log(`        ${h.text}`);
      violations++;
    }
  }
}

if (violations === 0) {
  console.log('\nNo reserved keywords used as identifiers.');
  process.exit(0);
}
console.log(`\n${violations} reserved-keyword violation(s).`);
process.exit(1);
