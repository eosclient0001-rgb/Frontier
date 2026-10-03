#!/usr/bin/env node
/**
 * WGSL validation harness.
 *
 * Every shader is authored as a JS module exporting a template string, so this
 * script imports them, writes real .wgsl files and runs naga over each one.
 * naga is the same WGSL front-end used by wgpu, which catches type errors,
 * bad builtins, layout violations and most of what Tint/Dawn would reject.
 *
 *   npm run check
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SHADERS = {
  common: '../src/volumetric/shaders/common.wgsl.js',
  advect: '../src/volumetric/shaders/advect.wgsl.js',
  sources: '../src/volumetric/shaders/sources.wgsl.js',
  curl: '../src/volumetric/shaders/curl.wgsl.js',
  vorticity: '../src/volumetric/shaders/vorticity.wgsl.js',
  projection: '../src/volumetric/shaders/projection.wgsl.js',
  clear: '../src/volumetric/shaders/clear.wgsl.js',
  sdf: '../src/volumetric/shaders/sdf.wgsl.js',
  render: '../src/volumetric/shaders/render.wgsl.js',
};

const EXPORTS = {
  common: ['WGSL_COMMON'],
  advect: ['WGSL_ADVECT'],
  sources: ['WGSL_SOURCES'],
  curl: ['WGSL_CURL'],
  vorticity: ['WGSL_VORTICITY'],
  projection: ['WGSL_DIVERGENCE', 'WGSL_JACOBI', 'WGSL_PROJECT'],
  clear: ['WGSL_CLEAR_STATE', 'WGSL_CLEAR_SOLVER'],
  sdf: ['WGSL_SDF'],
  render: ['WGSL_RENDER'],
};

const nagaBin = join(ROOT, 'node_modules', 'naga-wasi-cli', 'bin', 'naga.mjs');
const outDir = join(ROOT, '.shader-out');

mkdirSync(outDir, { recursive: true });

let failures = 0;
let checked = 0;
const files = [];

for (const [name, rel] of Object.entries(SHADERS)) {
  const mod = await import(new URL(rel, import.meta.url));
  for (const exportName of EXPORTS[name]) {
    const code = mod[exportName];
    const file = join(outDir, `${exportName.toLowerCase()}.wgsl`);
    writeFileSync(file, code);
    files.push([exportName, file]);
  }
}

// `common` has no entry point: validate it by compiling it into the passes,
// which import it. Skip the standalone compile.
for (const [exportName, file] of files) {
  if (exportName === 'WGSL_COMMON') continue;
  checked += 1;
  // naga runs under WASI: it can only see the pre-opened cwd, so validate
  // with a relative filename from inside the output directory.
  const res = spawnSync(process.execPath, [nagaBin, basename(file)], { encoding: 'utf8', cwd: outDir });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`.replace(/ExperimentalWarning.*\n?/g, '');
  const ok = res.status === 0 && /Validation successful/i.test(output);
  if (!ok) failures += 1;
  const status = ok ? '\u2713' : '\u2717';
  const firstLine = output.trim().split('\n').slice(0, ok ? 1 : 12).join('\n    ');
  console.log(`${status} ${exportName.padEnd(18)} ${firstLine}`);
}

rmSync(outDir, { recursive: true, force: true });

if (failures) {
  console.error(`\n${failures} of ${checked} shaders failed validation.`);
  process.exit(1);
}
console.log(`\nAll ${checked} shaders validated.`);
