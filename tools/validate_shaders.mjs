// Validate every GLSL shader with glslangValidator.
import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SKY_VS, SKY_FS } from '../src/sky.js';
import { WATER_VS, WATER_FS } from '../src/water.js';
import { BEACH_VS, BEACH_FS } from '../src/beach.js';
import { SURFER_VS, SURFER_FS } from '../src/surfer.js';
import { SPRAY_VS, SPRAY_FS } from '../src/spray.js';

const BIN = new URL('../node_modules/glslang-validator-prebuilt-predownloaded/bin/glslangValidator.linux', import.meta.url).pathname;

try { chmodSync(BIN, 0o755); } catch (e) { /* best effort */ }
if (!existsSync(BIN)) {
  console.error('glslangValidator binary missing — run `npm install` (dev dependency).');
  process.exit(2);
}

const shaders = [
  ['sky.vert', SKY_VS, 'vert'], ['sky.frag', SKY_FS, 'frag'],
  ['water.vert', WATER_VS, 'vert'], ['water.frag', WATER_FS, 'frag'],
  ['beach.vert', BEACH_VS, 'vert'], ['beach.frag', BEACH_FS, 'frag'],
  ['surfer.vert', SURFER_VS, 'vert'], ['surfer.frag', SURFER_FS, 'frag'],
  ['spray.vert', SPRAY_VS, 'vert'], ['spray.frag', SPRAY_FS, 'frag'],
];

const dir = mkdtempSync(join(tmpdir(), 'glsl-'));
let failed = 0;
for (const [name, src, stage] of shaders) {
  const f = join(dir, name);
  writeFileSync(f, src);
  try {
    const out = execFileSync(BIN, ['-S', stage, f], { encoding: 'utf8' });
    console.log(`OK   ${name}${out.trim() ? ' — ' + out.trim() : ''}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}`);
    console.log((e.stdout || '') + (e.stderr || '') || ('(validator did not run: ' + (e.message || e) + ')'));
  }
}
process.exit(failed ? 1 : 0);
