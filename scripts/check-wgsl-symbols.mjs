// Static symbol check for the WGSL sources.
// wgsl_reflect only parses; it will happily accept a call to a function that does not exist or a
// struct member that was renamed. This walks every shader with its includes resolved and verifies
// that (a) every call target is a defined function, a builtin or a type constructor, and
// (b) every `.member` access on a module-level variable exists on that variable's struct.
// Run with: node scripts/check-wgsl-symbols.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = `${root}/src/engine/shaders`;

const files = readdirSync(dir).filter((f) => f.endsWith('.wgsl'));
const src = Object.fromEntries(files.map((f) => [f, readFileSync(`${dir}/${f}`, 'utf8')]));

function resolveIncludes(name, seen = new Set()) {
  if (seen.has(name)) return '';
  seen.add(name);
  const body = src[name];
  if (body === undefined) throw new Error(`missing shader ${name}`);
  return body.replace(/^\s*#include\s+"([^"]+)"\s*$/gm, (_, inc) => resolveIncludes(inc, seen));
}

// --- vocabulary the checker should not complain about ----------------------------------------------

const BUILTINS = new Set(`
abs acos acosh all any asin asinh atan atanh atan2 ceil clamp cos cosh countLeadingZeros countOneBits
countTrailingZeros cross degrees determinant distance dot exp exp2 extractBits faceForward firstLeadingBit
firstTrailingBit floor fma fract frexp inverseSqrt ldexp length log log2 max min mix modf normalize pow
quantizeToF16 radians reflect refract reverseBits round saturate select sign sin sinh smoothstep sqrt step
tan tanh transpose trunc dpdx dpdxCoarse dpdxFine dpdy dpdyCoarse dpdyFine fwidth fwidthCoarse fwidthFine
textureDimensions textureLoad textureSample textureSampleBias textureSampleCompare textureSampleGrad
textureSampleLevel textureSampleCompareLevel textureSampleBaseClampToEdge textureStore textureNumLayers textureNumLevels
textureNumSamples workgroupUniformLoad storageBarrier workgroupBarrier textureBarrier
arrayLength bitcast discard
`.trim().split(/\s+/));

const CONSTRUCTORS = new Set();
for (const t of ['f32', 'i32', 'u32', 'bool']) CONSTRUCTORS.add(t);
for (const n of [2, 3, 4]) {
  for (const t of ['f', 'i', 'u']) CONSTRUCTORS.add(`vec${n}${t}`);
}
for (const n of [2, 3, 4]) {
  CONSTRUCTORS.add(`mat${n}x${n}f`);
  for (const c of [2, 3, 4]) {
    for (const r of [2, 3, 4]) CONSTRUCTORS.add(`mat${c}x${r}f`);
  }
}

const KEYWORDS = new Set('if for while loop switch return let var const fn struct else case default break continue discard true false bitcast'.split(' '));

// --- parse ------------------------------------------------------------------------------------------

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function parseStructs(text) {
  const out = new Map();
  const re = /struct\s+(\w+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const members = m[2]
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(':')[0].trim());
    out.set(m[1], members);
  }
  return out;
}

function parseFunctions(text) {
  const out = new Set();
  const re = /fn\s+(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(text))) out.add(m[1]);
  return out;
}

function parseModuleVars(text) {
  // @group(n) @binding(m) var<addr> name : Type;   and plain var/const forms
  const out = new Map(); // name -> type
  const re = /@group\s*\(\s*\d+\s*\)\s*@binding\s*\(\s*\d+\s*\)\s*var(?:<[^>]*>)?\s+(\w+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(text))) out.set(m[1], m[2].trim().replace(/^array<.*$/, 'array'));
  return out;
}

// --- check ------------------------------------------------------------------------------------------

let problems = 0;
let callsChecked = 0;
let membersChecked = 0;

for (const [name, raw] of Object.entries(src)) {
  // Include-only files are checked through their hosts, and again on their own for hygiene.
  const text = stripComments(resolveIncludes(name));
  const structs = parseStructs(text);
  const fns = parseFunctions(text);
  const vars = parseModuleVars(text);

  // (a) call targets
  const callRe = /(\w+)\s*\(/g;
  let m;
  const badCalls = new Set();
  while ((m = callRe.exec(text))) {
    const id = m[1];
    callsChecked += 1;
    if (BUILTINS.has(id) || CONSTRUCTORS.has(id) || KEYWORDS.has(id) || fns.has(id)) continue;
    // Skip declarations ("fn foo("), attribute lists and swizzles that look like calls.
    const before = text.slice(Math.max(0, m.index - 12), m.index).trim();
    if (before.endsWith('fn') || before.endsWith('@')) continue;
    badCalls.add(id);
  }

  // (b) struct member access on module-level variables
  const badMembers = new Set();
  for (const [varName, type] of vars) {
    const structName = type.replace(/^array<\s*/, '').replace(/[\s>,].*$/, '');
    const members = structs.get(structName);
    if (!members) continue;
    const memberRe = new RegExp(`\\b${varName}\\.(\\w+)`, 'g');
    let mm;
    while ((mm = memberRe.exec(text))) {
      membersChecked += 1;
      let member = mm[1];
      // vec4f p0 has components x/y/z/w and the swizzles used on it; structs here only use
      // declared member names, so an unknown member is a real error.
      if (!members.includes(member)) badMembers.add(`${varName}.${member} (on ${structName})`);
    }
  }

  if (badCalls.size || badMembers.size) {
    problems += badCalls.size + badMembers.size;
    console.log(`\n${name}`);
    for (const c of badCalls) console.log(`  unknown call      ${c}(...)`);
    for (const c of badMembers) console.log(`  unknown member    ${c}`);
  }
}

console.log(`\n${problems ? 'PROBLEMS FOUND' : 'clean'} — ${callsChecked} call sites, ${membersChecked} member accesses, ${files.length} shaders\n`);
process.exit(problems ? 1 : 0);
