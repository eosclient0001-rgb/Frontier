// Dependency-free WGSL scanner.
//
// The test suite must run on a fresh clone with *no* install (node_modules is
// not preserved between sessions), so the structural facts the tests rely on —
// entry points, struct layouts, bindings, vertex inputs — are extracted here
// with plain text scanning rather than a parser package.
//
// `wgsl_reflect` is still used opportunistically by tools/wgsl-check.mjs as a
// full syntactic parse when it happens to be installed.

// ---------------------------------------------------------------- type layout
const SCALAR = { f16: [2, 2], f32: [4, 4], u32: [4, 4], i32: [4, 4], bool: [4, 4] };

const alignUp = (n, a) => Math.ceil(n / a) * a;

/** { align, size } for a WGSL type name, following the spec's layout rules. */
export function typeLayout(name) {
  const t = String(name).trim().replace(/\s+/g, '');
  if (SCALAR[t]) return { align: SCALAR[t][1], size: SCALAR[t][0] };

  let m = t.match(/^vec(\d)<(\w+)>$/);            // vec4<f32>
  if (!m) m = t.match(/^vec(\d)([fiuh])$/);       // vec4f
  if (m) {
    const n = Number(m[1]);
    const scalar = SCALAR[m[2]] ?? SCALAR[`${m[2]}32`] ?? [4, 4];
    const size = n * scalar[0];
    return { align: n === 3 ? 16 : size, size };
  }

  m = t.match(/^mat(\d)x(\d)([fiuh])$/);          // mat4x4f
  if (m) {
    const cols = Number(m[1]);
    const rows = Number(m[2]);
    const scalar = SCALAR[m[3]] ?? SCALAR[`${m[3]}32`] ?? [4, 4];
    const colSize = rows * scalar[0];
    const colAlign = rows === 3 ? 16 : colSize;
    return { align: colAlign, size: cols * alignUp(colSize, colAlign) };
  }

  m = t.match(/^array<(.+),\s*(\d+)>$/);          // array<vec4f, 4>
  if (m) {
    const inner = typeLayout(m[1]);
    const count = Number(m[2]);
    return { align: inner.align, size: count * alignUp(inner.size, inner.align) };
  }

  throw new Error(`wgsl-parse: unknown type "${name}"`);
}

const stripComments = (code) => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

// ---------------------------------------------------------------- structs
/**
 * Parse every `struct` declaration: member order, offsets and total size.
 * Offsets follow WGSL's alignment rules (offsets are aligned up to each
 * member's alignment; the struct size is a multiple of its largest alignment).
 */
export function parseStructs(code) {
  const src = stripComments(code);
  const out = new Map();
  const re = /struct\s+(\w+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    const body = m[2];
    const members = [];
    for (const decl of body.split(',')) {
      const d = decl.trim();
      if (!d) continue;
      const mm = d.match(/^(\w+)\s*:\s*(.+)$/);
      if (!mm) continue;
      const [, mname, mtype] = mm;
      const { align, size } = typeLayout(mtype);
      members.push({ name: mname, type: mtype.trim(), align, size, offset: 0 });
    }
    let offset = 0;
    let maxAlign = 1;
    for (const mem of members) {
      offset = alignUp(offset, mem.align);
      mem.offset = offset;
      offset += mem.size;
      maxAlign = Math.max(maxAlign, mem.align);
    }
    out.set(name, { name, members, size: alignUp(offset, maxAlign) });
  }
  return out;
}

// ---------------------------------------------------------------- entry points
export function parseEntries(code) {
  const src = stripComments(code);
  const entries = { compute: [], vertex: [], fragment: [] };
  let m;
  const rc = /@compute\s+@workgroup_size\(([^)]*)\)\s*fn\s+(\w+)/g;
  while ((m = rc.exec(src))) entries.compute.push({ name: m[2], workgroup: m[1].trim() });
  const rv = /@vertex\s*fn\s+(\w+)/g;
  while ((m = rv.exec(src))) entries.vertex.push({ name: m[1], params: paramList(src, m[1]) });
  const rf = /@fragment\s*fn\s+(\w+)/g;
  while ((m = rf.exec(src))) entries.fragment.push({ name: m[1], params: paramList(src, m[1]) });
  return entries;
}

/**
 * Text between the parentheses that follow `fn <name>`, honouring nesting so
 * that attributes like `@location(0)` inside the parameter list do not cut it
 * short.
 */
function paramList(src, fnName) {
  const at = src.search(new RegExp(`fn\\s+${fnName}\\s*\\(`));
  if (at < 0) return '';
  let i = src.indexOf('(', at);
  let depth = 0;
  const start = ++i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') { if (depth === 0) return src.slice(start, i); depth--; }
  }
  return src.slice(start);
}

/** `@location(n) name : type` inputs declared by a vertex entry point. */
export function parseVertexInputs(code) {
  const src = stripComments(code);
  const out = new Map();
  const re = /@vertex\s*fn\s+(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const params = paramList(src, m[1]);
    const inputs = [];
    const rl = /@location\((\d+)\)\s*(\w+)\s*:\s*([A-Za-z_]\w*(?:<[^<>]*>)?)/g;
    let l;
    while ((l = rl.exec(params))) {
      inputs.push({ location: Number(l[1]), name: l[2], type: l[3].trim() });
    }
    out.set(m[1], inputs);
  }
  return out;
}

// ---------------------------------------------------------------- bindings
/**
 * `@group(g) @binding(b) var<space> name : type;`
 * `access` is read_write for storage vars declared so, otherwise read.
 */
export function parseBindings(code) {
  const src = stripComments(code);
  const out = new Map();
  // var<uniform> / var<storage, read> / var<storage, read_write> / var<texture_2d<f32>>
  const re = /@group\((\d+)\)\s*@binding\((\d+)\)\s*var<\s*([a-z_0-9]+)\s*(?:,\s*([a-z_]+)\s*)?>\s*(\w+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(src))) {
    const [, group, binding, space, access, name, type] = m;
    out.set(Number(binding), {
      group: Number(group), binding: Number(binding), space,
      name, type: type.trim(),
      access: access === 'read_write' ? 'read_write' : 'read',
    });
  }
  return out;
}

/** Everything the tests need, in one call. */
export function parseShader(code) {
  return {
    code,
    structs: parseStructs(code),
    entries: parseEntries(code),
    bindings: parseBindings(code),
    vertexInputs: parseVertexInputs(code),
  };
}

/** Highest @binding index + 1, used to assert contiguity. */
export function bindingCount(bindings) {
  return bindings.size ? Math.max(...bindings.keys()) + 1 : 0;
}
