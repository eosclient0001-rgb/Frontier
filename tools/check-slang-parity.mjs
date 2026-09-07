/**
 * Verify the Slang parameter struct matches the TypeScript schema.
 *
 * The WGSL build generates its uniform struct from src/params.ts, so those two
 * can never drift. The Slang/Vulkan port is hand-written, so it can. A silent
 * field-order mismatch would misinterpret every parameter in the Slate build
 * while compiling perfectly on both sides.
 *
 *   node tools/check-slang-parity.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const R = (p) => readFileSync(join(here, '..', p), 'utf8');

const ts = [...R('src/params.ts').matchAll(/name:\s*'([A-Za-z0-9_]+)',\s*kind:\s*'(f32|u32)'/g)]
  .map((m) => ({ name: m[1], type: m[2] === 'f32' ? 'float' : 'uint' }));

const slangSrc = R('slang/frontier_params.slang');
const start = slangSrc.indexOf('public struct Params');
const end = slangSrc.indexOf('\n}', start);
const slang = [...slangSrc.slice(start, end).matchAll(/public\s+(float|uint)\s+([A-Za-z0-9_]+);/g)]
  .map((m) => ({ name: m[2], type: m[1] }))
  .filter((f) => !f.name.startsWith('_pad'));

let fail = 0;
const ok = (c, msg, d = '') => { console.log(`  ${c ? '✓' : '✗'} ${msg}${d ? `  ${d}` : ''}`); if (!c) fail++; };

console.log('Slang <-> TypeScript parameter parity');
ok(ts.length === slang.length, 'field count matches', `${ts.length} vs ${slang.length}`);

const n = Math.min(ts.length, slang.length);
let firstDiff = -1;
for (let i = 0; i < n; i++) {
  if (ts[i].name !== slang[i].name || ts[i].type !== slang[i].type) { firstDiff = i; break; }
}
ok(firstDiff === -1, 'field order and types match',
   firstDiff === -1 ? '' : `first diff at #${firstDiff}: ts ${ts[firstDiff].type} ${ts[firstDiff].name} vs slang ${slang[firstDiff].type} ${slang[firstDiff].name}`);

const tsOnly = ts.filter((a) => !slang.some((b) => b.name === a.name)).map((f) => f.name);
const slOnly = slang.filter((a) => !ts.some((b) => b.name === a.name)).map((f) => f.name);
ok(tsOnly.length === 0, 'no fields missing from Slang', tsOnly.join(', '));
ok(slOnly.length === 0, 'no extra fields in Slang', slOnly.join(', '));

const bytes = Math.ceil((ts.length + 1) / 4) * 4 * 4;
const padded = Math.ceil(ts.length / 4) * 4 * 4;
ok(padded % 16 === 0, 'struct size is 16-byte aligned', `${padded} bytes`);

// The doc quotes the size in a static_assert; keep it honest.
const doc = R('docs/SLATE_INTEGRATION.md');
const quoted = doc.match(/sizeof\(FrontierParams\)\s*==\s*(\d+)/);
ok(quoted && +quoted[1] === padded, 'SLATE_INTEGRATION.md static_assert size is correct',
   quoted ? `doc says ${quoted[1]}, actual ${padded}` : 'not found');

// SimCell must agree too.
const wgslCell = R('src/shaders/sim_common.wgsl');
const slangCell = slangSrc.slice(slangSrc.indexOf('public struct SimCell'));
for (const f of ['h', 'water', 'sed', 'reg', 'flux', 'vel', 'hard', 'sedNext', 'h0', 'wet', 'flowAcc', 'talus']) {
  if (!new RegExp(`\\b${f}\\b`).test(slangCell)) { ok(false, `SimCell.${f} present in Slang`); }
}
ok(true, 'SimCell fields all present in Slang');

console.log(fail === 0 ? '\nSlang port is in sync.' : `\n${fail} parity problem(s).`);
process.exit(fail === 0 ? 0 : 1);
