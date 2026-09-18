/* Static GLSL sanity lint: reconstructs each shader source as it is composed
 * (shared volume libs + earlier local libs + the consuming template literal),
 * then checks that every identifier used is declared, built-in, or a swizzle
 * member. Catches typos and missing declarations without a GPU.
 */
import { readFileSync } from "node:fs";

const BUILTINS = new Set(`
dot cross normalize length distance mix clamp smoothstep min max abs sign floor ceil fract mod
pow exp exp2 log log2 sqrt inversesqrt sin cos tan asin acos atan reflect refract step radians
degrees any all lessThan greaterThan greaterThanEqual lessThanEqual equal notEqual isnan isinf
texelFetch texture textureLod textureSize
`.split(/\s+/));

const TYPES = new Set(`
float int uint bool void vec2 vec3 vec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 bvec2 bvec3 bvec4
mat2 mat3 mat4 mat2x2 mat3x3 mat4x4 sampler2D samplerCube sampler2DArray
`.split(/\s+/));

const KEYWORDS = new Set(`
if else for while do return break continue discard in out inout uniform varying layout const
flat smooth centroid precision highp mediump lowp struct true false attribute
location binding rgba16f rgba32f r32f center origin coherent restrict readonly writeonly
`.split(/\s+/));

const GL_NAMES = new Set(`
gl_FragCoord gl_VertexID gl_InstanceID gl_Position gl_PointSize gl_PointCoord gl_FragDepth
`.split(/\s+/));

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/^#[^\n]*$/gm, " "); // preprocessor directives
}

function extractLiterals(fileText) {
  const literals = [];
  const re = /`((?:\\.|[^`\\])*)`/gs;
  let m;
  while ((m = re.exec(fileText))) {
    let body = m[1];
    if (body.includes("${")) {
      // resolve interpolations to neutral values; skip wrappers that embed
      // other literals by reference (their content is linted separately)
      body = body.replace(/\$\{[^}]*\}/g, (inner) => (/TILE|ATLAS|PT_|MAX_|SLI|COLS/.test(inner) ? "16" : "1"));
      if (/atlasGLSL|glslHeader/.test(m[1])) {
        literals.push({ body, wrapper: true });
        continue;
      }
    }
    literals.push({ body, wrapper: false });
  }
  return literals;
}

function* identifiers(src) {
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m;
  while ((m = re.exec(src))) {
    const before = src[m.index - 1];
    if (before === ".") continue; // swizzle / member
    if (before >= "0" && before <= "9") continue; // exponent of a literal (1e-6)
    yield { name: m[0], index: m.index };
  }
}

function collectDeclarations(src) {
  const declared = new Set();
  // function definitions
  for (const m of src.matchAll(/\b(?:float|int|uint|bool|void|vec[234]|ivec[234]|mat[234])\s+([A-Za-z_]\w*)\s*\(/g)) {
    declared.add(m[1]);
  }
  // TYPE name  (uniforms, ins/outs, params, single locals)
  for (const m of src.matchAll(/\b(?:float|int|uint|bool|vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234]|sampler2D|samplerCube)\s+([A-Za-z_]\w*)/g)) {
    declared.add(m[1]);
  }
  // comma-initializer lists:  float a = .5, sum = 0., norm = 0.;   vec3 LO = ..., HI = ...;
  for (const m of src.matchAll(/,\s*([A-Za-z_]\w*)\s*(?=[=,;)])/g)) {
    declared.add(m[1]);
  }
  // for-loop induction vars
  for (const m of src.matchAll(/\bfor\s*\(\s*(?:int|float)\s+([A-Za-z_]\w*)/g)) declared.add(m[1]);
  return declared;
}

function lintShader(name, source) {
  const errors = [];
  const src = stripComments(source);
  const declared = collectDeclarations(src);
  const seen = new Map();
  for (const { name: ident, index } of identifiers(src)) {
    if (TYPES.has(ident) || KEYWORDS.has(ident) || BUILTINS.has(ident) || GL_NAMES.has(ident)) continue;
    if (declared.has(ident)) continue;
    if (!seen.has(ident)) seen.set(ident, index);
  }
  for (const [ident, index] of seen) {
    const line = src.slice(0, index).split("\n").length;
    errors.push(`${name}: unresolved identifier "${ident}" (near line ${line})`);
  }
  const pairs = [["{", "}"], ["(", ")"]];
  for (const [o, c] of pairs) {
    const no = src.split(o).length - 1;
    const nc = src.split(c).length - 1;
    if (no !== nc) errors.push(`${name}: unbalanced ${o}${c} (${no}/${nc})`);
  }
  return errors;
}

const isShaderish = (lit) =>
  /void main|uniform |out vec|in vec|texelFetch|gl_Position|#version/.test(lit);

function lintFile(path, baseLibs) {
  const text = readFileSync(path, "utf8");
  const literals = extractLiterals(text);
  const errors = [];
  const localLibs = [];
  literals.forEach(({ body, wrapper }, i) => {
    if (body.trim().length < 30 || wrapper) return;
    // compose as: shared volume libs + every earlier literal in this file + this one
    const composed = [...baseLibs, ...localLibs, body].join("\n");
    if (isShaderish(body)) {
      errors.push(...lintShader(`${path}#${i}`, composed));
    }
    localLibs.push(body);
  });
  return errors;
}

const volumeText = readFileSync(new URL("../src/volume.js", import.meta.url), "utf8");
const baseLibs = extractLiterals(volumeText)
  .filter((l) => !l.wrapper && l.body.length > 200)
  .map((l) => l.body);

const files = process.argv.slice(2);
let total = 0;
for (const f of files) {
  const errors = lintFile(f, baseLibs);
  for (const e of errors) {
    console.log("  ✗ " + e);
    total++;
  }
  if (errors.length === 0) console.log(`  ✓ ${f}`);
}
console.log(total === 0 ? "\nGLSL lint clean" : `\n${total} problem(s)`);
process.exit(total === 0 ? 0 : 1);
