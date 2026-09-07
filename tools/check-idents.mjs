/**
 * Offline identifier-resolution check for the composed WGSL shaders.
 *
 * wgsl_reflect parses but does not resolve names, so a missing #include sails
 * straight through it and only explodes in the browser. Since this sandbox has
 * no GPU, this pass closes that gap: it collects every declared function,
 * struct, const, override, alias and binding in the composed source, then
 * verifies that every called identifier resolves to either a declaration or a
 * WGSL builtin.
 *
 *   node tools/check-idents.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shaderDir = join(here, '..', 'src', 'shaders');

const paramsTs = readFileSync(join(here, '..', 'src', 'params.ts'), 'utf8');
const defRe = /name:\s*'([A-Za-z0-9_]+)',\s*kind:\s*'(f32|u32)'/g;
const params = [];
let mm;
while ((mm = defRe.exec(paramsTs)) !== null) params.push({ name: mm[1], kind: mm[2] });
const padded = Math.ceil(params.length / 4) * 4;

const cfgTs = readFileSync(join(here, '..', 'src', 'config.ts'), 'utf8');
const gridConsts = ['VOLX', 'VOLY', 'VOLZ', 'SIMX', 'SIMZ', 'WORLD_W', 'WORLD_H', 'WORLD_D'];

let generated = gridConsts.map((c) => `const ${c}: i32 = 1;`).join('\n') + '\nstruct Params {\n';
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
    if (src === undefined) throw new Error(`missing include "${n}"`);
    if (stack.includes(n)) return '';
    return src.replace(INCLUDE_RE, (_x, inc) => {
      if (emitted.has(inc)) return '';
      emitted.add(inc);
      return expand(inc, [...stack, n]);
    });
  };
  return expand(name, []);
}

// WGSL builtin functions + types + keywords that may appear in call position.
const BUILTINS = new Set(`
abs acos acosh all any asin asinh atan atanh atan2 ceil clamp cos cosh
countLeadingZeros countOneBits countTrailingZeros cross degrees determinant
distance dot dot4U8Packed dot4I8Packed exp exp2 extractBits faceForward
firstLeadingBit firstTrailingBit floor fma fract frexp inverseSqrt ldexp
length log log2 max min mix modf normalize pow quantizeToF16 radians reflect
refract reverseBits round saturate sign sin sinh smoothstep sqrt step tan tanh
transpose trunc
dpdx dpdxCoarse dpdxFine dpdy dpdyCoarse dpdyFine fwidth fwidthCoarse fwidthFine
textureDimensions textureGather textureGatherCompare textureLoad
textureNumLayers textureNumLevels textureNumSamples textureSample
textureSampleBias textureSampleCompare textureSampleCompareLevel
textureSampleGrad textureSampleLevel textureSampleBaseClampToEdge textureStore
atomicLoad atomicStore atomicAdd atomicSub atomicMax atomicMin atomicAnd
atomicOr atomicXor atomicExchange atomicCompareExchangeWeak
pack4x8snorm pack4x8unorm pack2x16snorm pack2x16unorm pack2x16float
unpack4x8snorm unpack4x8unorm unpack2x16snorm unpack2x16unorm unpack2x16float
storageBarrier workgroupBarrier textureBarrier workgroupUniformLoad
arrayLength select bitcast
f32 i32 u32 bool f16
vec2 vec3 vec4 vec2f vec3f vec4f vec2i vec3i vec4i vec2u vec3u vec4u
vec2h vec3h vec4h vec2b vec3b vec4b
mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4
mat2x2f mat2x3f mat2x4f mat3x2f mat3x3f mat3x4f mat4x2f mat4x3f mat4x4f
array atomic ptr sampler sampler_comparison
texture_1d texture_2d texture_2d_array texture_3d texture_cube
texture_cube_array texture_multisampled_2d texture_storage_1d
texture_storage_2d texture_storage_2d_array texture_storage_3d
texture_depth_2d texture_depth_2d_array texture_depth_cube
texture_depth_cube_array texture_depth_multisampled_2d
if else for while loop switch case default break continue return discard
let var const override struct fn alias true false
`.trim().split(/\s+/));

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** Remove `@attribute(...)` so attribute names are not read as calls. */
function stripAttributes(s) {
  return s.replace(/@[A-Za-z_][A-Za-z0-9_]*\s*(\([^()]*\))?/g, ' ');
}

let fail = 0;
const roots = [...sources.keys()].filter((f) => {
  const s = sources.get(f);
  return /@(compute|vertex|fragment)/.test(s) && !f.startsWith('_');
}).sort();

for (const root of roots) {
  const raw = compose(root);
  const src = stripAttributes(stripComments(raw));

  const declared = new Set();
  for (const m of src.matchAll(/\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) declared.add(m[1]);
  for (const m of src.matchAll(/\bstruct\s+([A-Za-z_][A-Za-z0-9_]*)/g)) declared.add(m[1]);
  for (const m of src.matchAll(/\balias\s+([A-Za-z_][A-Za-z0-9_]*)/g)) declared.add(m[1]);
  for (const m of src.matchAll(/\b(?:const|override)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) declared.add(m[1]);
  for (const m of src.matchAll(/\bvar\s*(?:<[^>]*>)?\s*([A-Za-z_][A-Za-z0-9_]*)/g)) declared.add(m[1]);
  for (const m of src.matchAll(/\blet\s+([A-Za-z_][A-Za-z0-9_]*)/g)) declared.add(m[1]);
  // function parameters
  for (const m of src.matchAll(/\bfn\s+[A-Za-z0-9_]*\s*\(([^)]*)\)/g)) {
    for (const pm of m[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) declared.add(pm[1]);
  }

  // Every identifier used in call position `name(`
  const missing = new Map();
  for (const m of src.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const id = m[1];
    if (BUILTINS.has(id) || declared.has(id)) continue;
    const line = raw.slice(0, m.index).split('\n').length;
    if (!missing.has(id)) missing.set(id, line);
  }

  if (missing.size === 0) {
    console.log(`✓ ${root}`);
  } else {
    fail++;
    console.log(`✗ ${root}`);
    for (const [id, line] of missing) console.log(`    undefined: ${id}()  (composed line ~${line})`);
  }
}

console.log(fail === 0 ? '\nAll identifiers resolve.' : `\n${fail} shader(s) have unresolved identifiers.`);
process.exit(fail === 0 ? 0 : 1);
