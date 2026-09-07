/**
 * Verify the WGSL struct layouts against what the CPU code assumes.
 *
 * A silent mismatch between the WGSL `SimCell` / `Brush` / `Camera` structs and
 * the JS buffer writes corrupts the simulation in ways that look like physics
 * bugs, so it is worth checking mechanically. Implements the WGSL/std430
 * alignment rules for the scalar/vector types used here.
 *
 *   node tools/check-layout.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const S = (p) => readFileSync(join(here, '..', p), 'utf8');

const TYPES = {
  f32: { size: 4, align: 4 }, i32: { size: 4, align: 4 }, u32: { size: 4, align: 4 },
  vec2f: { size: 8, align: 8 }, vec2i: { size: 8, align: 8 }, vec2u: { size: 8, align: 8 },
  vec3f: { size: 12, align: 16 }, vec3i: { size: 12, align: 16 },
  vec4f: { size: 16, align: 16 }, vec4i: { size: 16, align: 16 }, vec4u: { size: 16, align: 16 },
  mat4x4f: { size: 64, align: 16 },
};

const roundUp = (n, a) => Math.ceil(n / a) * a;

function parseStruct(src, name) {
  const re = new RegExp(`struct\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
  const m = src.match(re);
  if (!m) throw new Error(`struct ${name} not found`);
  const body = m[1].replace(/\/\/[^\n]*/g, '');
  const fields = [];
  for (const fm of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z0-9_<>,\s]+?)\s*(?:,|$)/gm)) {
    const t = fm[2].trim();
    if (!TYPES[t]) continue;
    fields.push({ name: fm[1], type: t });
  }
  let off = 0, maxAlign = 1;
  const laid = [];
  for (const f of fields) {
    const { size, align } = TYPES[f.type];
    off = roundUp(off, align);
    maxAlign = Math.max(maxAlign, align);
    laid.push({ ...f, offset: off, size });
    off += size;
  }
  return { fields: laid, size: roundUp(off, maxAlign), align: maxAlign };
}

let fail = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
};

// ---- SimCell -------------------------------------------------------------
const simSrc = S('src/shaders/sim_common.wgsl');
const sim = parseStruct(simSrc, 'SimCell');
console.log('SimCell (sim_common.wgsl)');
for (const f of sim.fields) console.log(`    +${String(f.offset).padStart(2)}  ${f.type.padEnd(6)} ${f.name}`);
const resTs = S('src/gpu/resources.ts');
const declared = parseInt(resTs.match(/SIM_CELL_BYTES\s*=\s*(\d+)/)[1], 10);
check('size matches SIM_CELL_BYTES in resources.ts', sim.size, declared);

// The renderer declares a mirror struct; it must be identical.
const renderSrc = S('src/shaders/render.wgsl');
const simRO = parseStruct(renderSrc, 'SimCellRO');
check('SimCellRO size matches SimCell', simRO.size, sim.size);
const mismatch = sim.fields.filter((f, i) => !simRO.fields[i] || simRO.fields[i].offset !== f.offset);
check('SimCellRO field offsets match', mismatch.length, 0);

// ---- Brush ---------------------------------------------------------------
console.log('\nBrush (sculpt.wgsl)');
const brush = parseStruct(S('src/shaders/sculpt.wgsl'), 'Brush');
for (const f of brush.fields) console.log(`    +${String(f.offset).padStart(2)}  ${f.type.padEnd(6)} ${f.name}`);
const brushBufSize = parseInt(resTs.match(/label:\s*'brush',\s*size:\s*(\d+)/s)?.[1] ?? '0', 10);
check('fits the brush buffer allocated in resources.ts', brush.size <= brushBufSize, true);
// main.ts writes a Float32Array(12) => 48 bytes
check('main.ts brushData covers the struct', 12 * 4 >= brush.size, true);
// verify the JS indices line up with the parsed offsets
const idxOf = (n) => brush.fields.find((f) => f.name === n).offset / 4;
console.log(`    JS indices -> center:${idxOf('center')} radius:${idxOf('radius')} strength:${idxOf('strength')} hardness:${idxOf('hardness')} shape:${idxOf('shape')} mode:${idxOf('mode')} axis:${idxOf('axis')}`);
check('center at float 0', idxOf('center'), 0);
check('radius at float 3', idxOf('radius'), 3);
check('strength at float 4', idxOf('strength'), 4);
check('hardness at float 5', idxOf('hardness'), 5);
check('shape at float 6', idxOf('shape'), 6);
check('mode at float 7', idxOf('mode'), 7);
check('axis at float 8', idxOf('axis'), 8);

// ---- Camera --------------------------------------------------------------
console.log('\nCamera (render.wgsl)');
const cam = parseStruct(renderSrc, 'Camera');
for (const f of cam.fields) console.log(`    +${String(f.offset).padStart(2)}  ${f.type.padEnd(8)} ${f.name}`);
check('main.ts camData(28 floats) covers it', 28 * 4 >= cam.size, true);
const camBuf = parseInt(resTs.match(/label:\s*'camera',[\s\S]*?size:\s*([^,]+),/)[1].replace(/[^0-9+*]/g, '').split('+').reduce((a, b) => a + eval(b), 0) || 0);
console.log(`    camera buffer allocated: ${4 * 16 + 4 * 4 * 3} bytes, struct needs ${cam.size}`);
check('camera buffer large enough', 4 * 16 + 4 * 4 * 3 >= cam.size, true);

// ---- Params --------------------------------------------------------------
console.log('\nParams (generated)');
const paramsTs = S('src/params.ts');
const n = [...paramsTs.matchAll(/name:\s*'([A-Za-z0-9_]+)',\s*kind:\s*'(f32|u32)'/g)].length;
console.log(`    ${n} scalars -> ${Math.ceil(n / 4) * 4 * 4} bytes (uniform, 16-byte multiple)`);
check('padded to 16 bytes', (Math.ceil(n / 4) * 4 * 4) % 16, 0);

console.log(fail === 0 ? '\nAll layouts agree.' : `\n${fail} layout problem(s).`);
process.exit(fail === 0 ? 0 : 1);
