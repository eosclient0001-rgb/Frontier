#!/usr/bin/env node
/**
 * Frontier Terrain Forge — GPU layout generator.
 *
 *   node tools/gen-layout.mjs [--check]
 *
 * Reads every WGSL module, compiles it with naga (the compiler inside Chrome),
 * and reflects the resulting SPIR-V for the exact byte offsets of every uniform
 * member. The result is written to src/gen/gpu_layout.js, which the CPU-side
 * packer uses to write uniform buffers and the engine uses to build bind group
 * layouts. Nothing about the CPU/GPU interface is hand-mirrored, so it cannot
 * drift.
 *
 * --check regenerates into memory and fails if the file on disk differs.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWgsl, validate, writeSpirv } from 'naga-wasm';
import { WgslLibrary, dirName } from '../src/vendor/wgsl/wgsl.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHADER_DIR = join(ROOT, 'src/vendor/wgsl');
const OUT = join(ROOT, 'src/gen/gpu_layout.js');
const CHECK = process.argv.includes('--check');

/* ------------------------------------------------------------------ *
 * WGSL source parsing: struct members + binding declarations
 * ------------------------------------------------------------------ */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function parseStructs(source) {
  const src = stripComments(source);
  const structs = {};
  const re = /struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    let depth = 1;
    let i = re.lastIndex;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    const body = src.slice(re.lastIndex, i - 1);
    const members = [];
    // Split on top-level commas only — `array<vec4f, 8>` must stay in one piece.
    const parts = [];
    let depthAng = 0;
    let current = '';
    for (const ch of body) {
      if (ch === '<') depthAng++;
      else if (ch === '>') depthAng--;
      if (ch === ',' && depthAng === 0) { parts.push(current); current = ''; }
      else current += ch;
    }
    parts.push(current);
    for (const raw of parts) {
      const text = raw.trim();
      if (!text) continue;
      const mm = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z0-9_<>,\s]+)$/);
      if (mm) members.push({ name: mm[1], type: mm[2].replace(/\s+/g, '') });
    }
    structs[name] = members;
  }
  return structs;
}

function parseBindings(source) {
  const src = stripComments(source);
  const out = [];
  const re = /@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<([a-z_]+)>)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(src))) {
    const [, group, binding, space, name, typeText] = m;
    const type = typeText.trim();
    const entry = { name, group: Number(group), binding: Number(binding) };
    if (type.startsWith('texture_storage_2d')) {
      const fm = type.match(/texture_storage_2d<\s*([a-z0-9]+)\s*,\s*([a-z_]+)\s*>/);
      entry.kind = 'storage';
      entry.format = fm ? fm[1] : 'unknown';
      entry.access = fm ? fm[2] : 'read';
    } else if (type.startsWith('texture_2d')) {
      const fm = type.match(/texture_2d<\s*([a-z0-9]+)\s*>/);
      entry.kind = 'texture';
      entry.format = fm ? fm[1] : 'f32';
    } else if (type.startsWith('texture_depth') || type.startsWith('texture_cube')) {
      entry.kind = 'texture';
      entry.format = 'depth32float';
    } else if (type.startsWith('sampler')) {
      entry.kind = 'sampler';
      entry.type = type.includes('comparison') ? 'comparison' : 'filtering';
    } else if (type.startsWith('array<') && type.includes('texture')) {
      entry.kind = 'texture';
      entry.format = 'f32';
      entry.array = true;
    } else if (space === 'uniform') {
      entry.kind = 'uniform';
      entry.struct = type;
    } else if (space === 'storage') {
      entry.kind = 'buffer';
      entry.access = type.startsWith('array') ? 'read_write' : type.split(',').pop().replace('>', '').trim();
    } else {
      entry.kind = space || 'unknown';
      entry.type = type;
    }
    out.push(entry);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * SPIR-V reflection
 * ------------------------------------------------------------------ */
const OP = {
  NAME: 5,
  MEMBER_NAME: 6,
  DECORATE: 71,
  MEMBER_DECORATE: 72,
  TYPE_VOID: 19,
  TYPE_BOOL: 20,
  TYPE_INT: 21,
  TYPE_FLOAT: 22,
  TYPE_VECTOR: 23,
  TYPE_MATRIX: 24,
  TYPE_IMAGE: 25,
  TYPE_SAMPLER: 26,
  TYPE_SAMPLED_IMAGE: 27,
  TYPE_ARRAY: 28,
  TYPE_RUNTIME_ARRAY: 29,
  TYPE_STRUCT: 30,
  TYPE_POINTER: 32,
  VARIABLE: 59,
  CONSTANT: 43,
};
const DECOR = { ARRAY_STRIDE: 6, MATRIX_STRIDE: 7, BINDING: 33, DESCRIPTOR_SET: 34, OFFSET: 35 };

function reflectSpirv(words) {
  const types = new Map();
  const variables = new Map();
  const constants = new Map();
  const decorations = new Map();       // id -> [[decoration, args]]
  const memberDecorations = new Map(); // `${id}:${member}` -> [[decoration, args]]
  const pointerOf = new Map();         // id -> {storageClass, type}
  let i = 5;
  while (i < words.length) {
    const wordCount = words[i] >> 16;
    const opcode = words[i] & 0xffff;
    const a = [];
    for (let k = 1; k < wordCount; k++) a.push(words[i + k]);
    i += wordCount;
    switch (opcode) {
      case OP.TYPE_FLOAT: types.set(a[0], { kind: 'scalar', size: a[1] / 8, align: a[1] / 8 }); break;
      case OP.TYPE_INT: types.set(a[0], { kind: 'scalar', size: a[1] / 8, align: a[1] / 8 }); break;
      case OP.TYPE_BOOL: types.set(a[0], { kind: 'scalar', size: 4, align: 4 }); break;
      case OP.TYPE_VECTOR: {
        const comp = types.get(a[1]);
        const count = a[2];
        types.set(a[0], {
          kind: 'vector', component: a[1], count,
          size: comp.size * count,
          align: count === 3 ? 16 : comp.size * count,
        });
        break;
      }
      case OP.TYPE_MATRIX: {
        const col = types.get(a[1]);
        const count = a[2];
        types.set(a[0], { kind: 'matrix', column: a[1], count, size: null, align: 16 });
        break;
      }
      case OP.TYPE_ARRAY: types.set(a[0], { kind: 'array', element: a[1], length: a[2], size: null, align: 16 }); break;
      case OP.TYPE_STRUCT: types.set(a[0], { kind: 'struct', members: a.slice(1), size: null, align: 16 }); break;
      case OP.CONSTANT: constants.set(a[1], a[2]); break;
      case OP.TYPE_POINTER: pointerOf.set(a[0], { storageClass: a[1], type: a[2] }); break;
      // OpVariable: [resultType(pointer), resultId, storageClass, initializer?]
      case OP.VARIABLE: variables.set(a[1], { typeId: a[0], storageClass: a[2] }); break;
      case OP.TYPE_IMAGE: types.set(a[0], { kind: 'image', sampledType: a[1], dim: a[2], sampled: a[6], format: a[7] }); break;
      case OP.TYPE_SAMPLER: types.set(a[0], { kind: 'sampler', size: 0, align: 0 }); break;
      case OP.TYPE_SAMPLED_IMAGE: types.set(a[0], { kind: 'sampledImage', image: a[1] }); break;
      case OP.DECORATE: {
        if (!decorations.has(a[0])) decorations.set(a[0], []);
        decorations.get(a[0]).push([a[1], a.slice(2)]);
        break;
      }
      case OP.MEMBER_DECORATE: {
        const key = `${a[0]}:${a[1]}`;
        if (!memberDecorations.has(key)) memberDecorations.set(key, []);
        memberDecorations.get(key).push([a[2], a.slice(3)]);
        break;
      }
      default: break;
    }
  }

  const decorateValue = (id, dec) => {
    const list = decorations.get(id) || [];
    for (const [d, args] of list) if (d === dec) return args[0];
    return undefined;
  };
  const memberDecorateValue = (id, member, dec) => {
    const list = memberDecorations.get(`${id}:${member}`) || [];
    for (const [d, args] of list) if (d === dec) return args[0];
    return undefined;
  };

  // MatrixStride is a *member* decoration in SPIR-V, so size computation has to
  // carry the enclosing struct member context down with it.
  const sizeOf = (id, structId, memberIndex) => {
    const t = types.get(id);
    if (!t) return 0;
    const contextual = structId !== undefined && memberIndex !== undefined;
    if (t.kind === 'matrix') {
      // Always recompute: the stride comes from the enclosing member decoration.
      const col = types.get(t.column);
      const colSize = col ? sizeOf(t.column) : 16;
      const memberStride = contextual
        ? memberDecorateValue(structId, memberIndex, DECOR.MATRIX_STRIDE)
        : undefined;
      const stride = memberStride ?? decorateValue(id, DECOR.MATRIX_STRIDE) ?? Math.ceil(colSize / 16) * 16;
      t.size = stride * (t.count - 1) + colSize;
      return t.size;
    }
    if (t.size !== null && t.size !== undefined) return t.size;
    if (t.kind === 'array') {
      const stride = decorateValue(id, DECOR.ARRAY_STRIDE);
      const length = constants.get(t.length) ?? 0;   // OpTypeArray stores a constant <id>
      t.size = stride * length;
      return t.size;
    }
    if (t.kind === 'struct') {
      let end = 0;
      t.members.forEach((mid, idx) => {
        const off = memberDecorateValue(id, idx, DECOR.OFFSET) ?? 0;
        end = Math.max(end, off + sizeOf(mid, id, idx));
      });
      t.size = Math.ceil(end / 16) * 16;
      return t.size;
    }
    t.size = 0;
    return 0;
  };

  return { types, variables, constants, pointerOf, decorations, memberDecorations, sizeOf, decorateValue, memberDecorateValue };
}

/* ------------------------------------------------------------------ *
 * WGSL type helpers for the emitted metadata
 * ------------------------------------------------------------------ */
function describeMembers(wgslStructs, spirv, structId, wgslName, depth = 0) {
  const members = wgslStructs[wgslName] || [];
  const spirvMembers = spirv.types.get(structId)?.members || [];
  if (members.length !== spirvMembers.length) {
    throw new Error(
      `struct ${wgslName}: parsed ${members.length} members but SPIR-V has ${spirvMembers.length}`,
    );
  }
  const fields = {};
  members.forEach((member, index) => {
    const memberId = spirvMembers[index];
    const offset = spirv.memberDecorateValue(structId, index, DECOR.OFFSET) ?? 0;
    const type = spirv.types.get(memberId);
    const entry = { offset, size: spirv.sizeOf(memberId, structId, index), wgsl: member.type };
    if (member.type.startsWith('array<')) {
      const inner = member.type.slice(6, -1);
      const [elem, countText] = inner.split(',');
      const elemId = spirv.types.get(memberId)?.element;
      entry.array = {
        count: Number(countText),
        element: elem.trim(),
        stride: elemId !== undefined ? spirv.sizeOf(elemId) : 0,
      };
      if (wgslStructs[elem.trim()]) {
        entry.elementType = elem.trim();
        const elemId = spirv.types.get(memberId)?.element;
        if (elemId !== undefined) {
          entry.fields = describeMembers(wgslStructs, spirv, elemId, elem.trim(), depth + 1);
        }
      }
    } else if (wgslStructs[member.type]) {
      entry.fields = describeMembers(wgslStructs, spirv, memberId, member.type, depth + 1);
    }
    fields[member.name] = entry;
  });
  return fields;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
const library = new WgslLibrary((path) => readFileSync(path, 'utf8'), SHADER_DIR);

async function walkShaders(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'templates') continue;
      await walkShaders(full, out);
    } else if (name.endsWith('.wgsl')) out.push(full);
  }
  return out;
}

const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1; };
const generated = { $comment: 'AUTO-GENERATED by tools/gen-layout.mjs — do not edit by hand. Run: npm run layout', modules: {} };
const shaderFiles = await walkShaders(SHADER_DIR);
for (const file of shaderFiles) {
  const rel = relative(SHADER_DIR, file);
  if (rel.includes('templates/')) continue;
  const raw = readFileSync(file, 'utf8');
  const defines = raw.includes('{{LAYER}}') ? { LAYER: 'mountain' } : raw.includes('{{MATERIAL}}') ? { MATERIAL: 'mat_rock' } : {};
  let source;
  try {
    source = await library.module(rel, defines);
  } catch (err) {
    fail(`${rel}: ${err.message}`);
    continue;
  }
  const wgslStructs = parseStructs(source);
  const bindings = parseBindings(source);
  if (bindings.length === 0) continue;

  let spirv = null;
  try {
    const module = parseWgsl(source);
    const info = validate(module);
    spirv = reflectSpirv(writeSpirv(module, info, {}));
  } catch (err) {
    console.warn(`  ! ${rel}: could not reflect SPIR-V (${(err.message || err).toString().split('\n')[0]})`);
  }

  const mod = { bindings, structs: {} };
  if (spirv) {
    // Resolve each uniform block through the SPIR-V variable that carries the
    // DescriptorSet/Binding decorations → its pointee struct type.
    const varByDescriptor = new Map();
    for (const [id, list] of spirv.decorations) {
      let set;
      let bind;
      for (const [dec, args] of list) {
        if (dec === 34) set = args[0];
        if (dec === 33) bind = args[0];
      }
      if (set === undefined || bind === undefined) continue;
      const variable = spirv.variables.get(id);
      const pointer = variable ? spirv.pointerOf.get(variable.typeId) : null;
      if (!pointer) continue;
      varByDescriptor.set(`${set}:${bind}`, pointer.type);
    }
    for (const binding of bindings) {
      if (binding.kind !== 'uniform') continue;
      let typeId = varByDescriptor.get(`${binding.group}:${binding.binding}`);
      const declared = (wgslStructs[binding.struct] || []).length;
      // naga wraps uniform blocks in an outer Block struct when the inner
      // struct needs alignment fix-ups; unwrap until the member count matches.
      for (let guard = 0; guard < 4; guard++) {
        const probe = typeId !== undefined ? spirv.types.get(typeId) : null;
        if (!probe || probe.kind !== 'struct') break;
        if (probe.members.length === declared) break;
        if (probe.members.length === 1 && spirv.types.get(probe.members[0])?.kind === 'struct') {
          typeId = probe.members[0];
          continue;
        }
        break;
      }
      const type = typeId !== undefined ? spirv.types.get(typeId) : null;
      if (!type || type.kind !== 'struct') {
        fail(`could not resolve uniform ${binding.name} in ${rel}`);
        continue;
      }
      const candidate = describeMembers(wgslStructs, spirv, typeId, binding.struct);
      const size = spirv.sizeOf(typeId);
      const stride = Math.ceil(size / 16) * 16;
      if (stride !== size) fail(`${binding.struct} in ${rel}: size ${size} is not 16-byte aligned`);
      mod.structs[binding.struct] = { size, fields: candidate };
    }
  }
  generated.modules[rel] = mod;
}

const moduleCount = Object.keys(generated.modules).length;
const structCount = Object.values(generated.modules).reduce((sum, m) => sum + Object.keys(m.structs).length, 0);
const body = JSON.stringify(generated.modules, null, 2);
const content = `/**
 * Frontier Terrain Forge — GPU interface metadata.
 *
 * ${'AUTO-GENERATED by tools/gen-layout.mjs'} from the WGSL sources. Every byte
 * offset below comes from reflecting the SPIR-V that naga (the compiler inside
 * Chrome) produces, so CPU packing and GPU layout can never disagree.
 *
 * ${moduleCount} modules, ${structCount} uniform structs.
 *
 * Regenerate with:  npm run layout
 */
export const SHADER_LAYOUTS = ${body};

/** Module names, in the order the generator walked them. */
export const SHADER_MODULES = Object.keys(SHADER_LAYOUTS);

/** Look up a uniform field offset for a given module. */
export function fieldOffset(moduleName, structName, field) {
  const mod = SHADER_LAYOUTS[moduleName];
  const struct = mod && mod.structs[structName];
  if (!struct || !struct.fields[field]) {
    throw new Error(\`no layout for \${moduleName} \${structName}.\${field}\`);
  }
  return struct.fields[field].offset;
}

/** The declared bindings of a module (name, group, binding, kind, format). */
export function moduleBindings(moduleName) {
  const mod = SHADER_LAYOUTS[moduleName];
  return mod ? mod.bindings : [];
}
`;

if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== content) {
    console.error('✗ src/gen/gpu_layout.js is out of date — run `npm run layout`.');
    process.exit(1);
  }
  console.log('✓ GPU layout metadata is up to date');
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, content);
  const count = Object.keys(generated.modules).length;
  const structNames = new Set();
  for (const mod of Object.values(generated.modules)) for (const s of Object.keys(mod.structs)) structNames.add(s);
  console.log(`✓ wrote ${relative(ROOT, OUT)} — ${count} modules, ${structNames.size} uniform structs reflected`);
  for (const name of structNames) {
    for (const mod of Object.values(generated.modules)) {
      if (mod.structs[name]) {
        console.log(`    ${name}: ${mod.structs[name].size} bytes`);
        break;
      }
    }
  }
}
