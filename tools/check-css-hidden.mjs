/**
 * Guard against a CSS rule defeating the HTML [hidden] attribute.
 *
 * [hidden] is only `display:none` in the user-agent stylesheet, so ANY author
 * rule that sets an explicit `display` on the same element wins and the
 * element stays visible forever. For a full-screen overlay that means the app
 * looks completely dead even while it is running perfectly underneath.
 *
 *   node tools/check-css-hidden.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const css = readFileSync(join(here, '..', 'src', 'ui', 'style.css'), 'utf8');

// Elements that rely on the hidden attribute.
const hiddenIds = [...html.matchAll(/<[^>]*id="([^"]+)"[^>]*\shidden(?:\s|>)/g)].map((m) => m[1]);

let fail = 0;
if (hiddenIds.length === 0) console.log('  (no elements use the hidden attribute)');

for (const id of hiddenIds) {
  // Find `#id { ... }` blocks that set an explicit display.
  const re = new RegExp(`#${id}\\s*\\{([^}]*)\\}`, 'g');
  let setsDisplay = null;
  let m;
  while ((m = re.exec(css)) !== null) {
    const dm = m[1].match(/display:\s*([a-z-]+)/);
    if (dm && dm[1] !== 'none') setsDisplay = dm[1];
  }

  const hasGuard = new RegExp(`#${id}\\[hidden\\]\\s*\\{[^}]*display:\\s*none`).test(css);

  if (setsDisplay && !hasGuard) {
    fail++;
    console.log(`  ✗ #${id}: CSS sets "display: ${setsDisplay}" which overrides [hidden].`);
    console.log(`      Add:  #${id}[hidden] { display: none; }`);
  } else if (setsDisplay) {
    console.log(`  ✓ #${id}: display:${setsDisplay} + [hidden] guard present`);
  } else {
    console.log(`  ✓ #${id}: no conflicting display rule`);
  }
}

console.log(fail === 0 ? '\n[hidden] is respected.' : `\n${fail} element(s) would never hide.`);
process.exit(fail === 0 ? 0 : 1);
