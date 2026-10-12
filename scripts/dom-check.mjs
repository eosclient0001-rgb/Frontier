// Static cross-checks: every DOM id referenced in src exists in index.html;
// the bundle parses; referenced assets exist.
import { readFileSync, existsSync } from 'node:fs';

let failures = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '  ok' : '  FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const html = readFileSync('public/index.html', 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));

const src = ['src/main.js', 'src/core/mesher.js', 'src/core/citygen.js', 'src/core/profiles.js',
  'src/core/network.js', 'src/core/textures.js', 'src/core/props.js', 'src/core/camera.js',
  'src/core/exporter.js', 'src/core/util.js'].map(f => readFileSync(f, 'utf8')).join('\n');

console.log('> DOM ids referenced by code exist in index.html');
const refs = new Set([...src.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]));
for (const r of [...refs].sort()) ok(`#${r}`, ids.has(r));

console.log('> css hooks referenced by code exist in styles.css');
const css = readFileSync('public/styles.css', 'utf8');
for (const cls of ['card', 'item', 'caps', 'btn', 'mode', 'list', 'form', 'kv', 'hint', 'hidden']) {
  ok(`.${cls}`, css.includes('.' + cls));
}

console.log('> bundle parses as a module');
try {
  const { execFileSync } = await import('node:child_process');
  const bundle = readFileSync('public/assets/app.bundle.js', 'utf8');
  // esbuild fully parses/validates; non-zero exit means a syntax error.
  execFileSync('node_modules/.bin/esbuild', ['--format=esm'], { input: bundle, stdio: ['pipe', 'pipe', 'pipe'] });
  ok('app.bundle.js parses', true, `${(bundle.length / 1024).toFixed(0)} KB`);
} catch (e) {
  ok('app.bundle.js parses', false, String(e.stderr || e.message || e));
}

console.log('> referenced static assets exist');
for (const a of ['public/styles.css', 'public/assets/app.bundle.js']) ok(a, existsSync(a));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL DOM CHECKS PASSED');
process.exit(failures ? 1 : 0);
