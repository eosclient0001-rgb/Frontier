/**
 * Minimal shader composer: resolves `#include "name.wgsl"` between WGSL files
 * and injects the generated Params struct + grid constants.
 *
 * Mirrors what Slang's module system does natively, so the port is mechanical:
 * each `#include` here becomes an `import` in Slang.
 */
import { generateParamsWGSL } from '../params';
import { constantsWGSL, type GridConfig } from '../config';

const files = import.meta.glob('../shaders/*.wgsl', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const sources = new Map<string, string>();
for (const [path, src] of Object.entries(files)) {
  const name = path.split('/').pop()!;
  sources.set(name, src);
}

const INCLUDE_RE = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm;
const cache = new Map<string, string>();

/** Must be called before any shader() call; re-call when resolution changes. */
export function configureShaders(g: GridConfig) {
  sources.set('_generated_params.wgsl', constantsWGSL(g) + '\n' + generateParamsWGSL());
  cache.clear();
}

/** Load a WGSL file with all includes resolved (each include emitted once). */
export function shader(name: string): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;

  if (!sources.has('_generated_params.wgsl')) {
    throw new Error('configureShaders() must be called before shader()');
  }

  const emitted = new Set<string>();
  const expand = (n: string, stack: string[]): string => {
    const src = sources.get(n);
    if (src === undefined) {
      throw new Error(`shader not found: "${n}" (have: ${[...sources.keys()].join(', ')})`);
    }
    if (stack.includes(n)) return '';
    return src.replace(INCLUDE_RE, (_m, inc: string) => {
      if (emitted.has(inc)) return `// [${inc} already included]`;
      emitted.add(inc);
      return expand(inc, [...stack, n]);
    });
  };

  const out = expand(name, []);
  cache.set(name, out);
  return out;
}

export function shaderNames(): string[] {
  return [...sources.keys()].sort();
}
