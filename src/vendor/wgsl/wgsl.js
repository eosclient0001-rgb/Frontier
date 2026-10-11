/**
 * Frontier Terrain Forge — WGSL module system.
 *
 * Shaders on disk are real .wgsl files with two directives:
 *
 *   //#include "lib/noise.wgsl"   → textual include, resolved once per module
 *   {{NAME}}                      → replaced by a value from `defines`
 *
 * The same implementation is used by the browser (fetch) and by
 * tools/check.mjs (fs), so the source the static checker validates is bit for
 * bit the source the GPU compiles.
 */

/** POSIX-style path join that also normalises '..' segments. */
export function joinPath(dir, rel) {
  const parts = (dir + '/' + rel).split('/');
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return (dir.startsWith('/') ? '/' : '') + out.join('/');
}

export function dirName(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

const INCLUDE_RE = /^[ \t]*\/\/#include[ \t]+"([^"]+)"[ \t]*$/gm;

/**
 * Collect every file reachable from `entry` through includes (after define
 * substitution) into a Map keyed by resolved path.
 */
export async function collectModules(entry, defines, load) {
  const modules = new Map();
  const queue = [[entry, defines]];
  while (queue.length) {
    const [path, defs] = queue.shift();
    if (modules.has(path)) continue;
    const raw = await load(path);
    const source = substitute(raw, defs);
    modules.set(path, source);
    for (const match of source.matchAll(INCLUDE_RE)) {
      const next = joinPath(dirName(path), match[1]);
      if (!modules.has(next)) queue.push([next, defs]);
    }
  }
  return modules;
}

export function substitute(source, defines = {}) {
  if (!defines || Object.keys(defines).length === 0) return source;
  return source.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(defines, key) ? String(defines[key]) : m,
  );
}

/** Expand a collected module graph into a single WGSL source string. */
export function expand(path, modules, seen = new Set()) {
  const source = modules.get(path);
  if (source === undefined) throw new Error(`WGSL module not collected: ${path}`);
  if (seen.has(path)) return `// (already included: ${path})`;
  seen.add(path);
  return source.replace(INCLUDE_RE, (_m, spec) => {
    const next = joinPath(dirName(path), spec);
    return `// ── ${next} ──\n${expand(next, modules, seen)}`;
  });
}

/**
 * Browser/Node facade. `load` receives a resolved URL and returns the text.
 */
export class WgslLibrary {
  constructor(load, root) {
    this.load = load;
    this.root = root;
    this.cache = new Map();
  }

  async module(relPath, defines = {}) {
    const key = relPath + '|' + JSON.stringify(defines);
    if (this.cache.has(key)) return this.cache.get(key);
    const entry = joinPath(this.root, relPath);
    const modules = await collectModules(entry, defines, this.load);
    const source = expand(entry, modules);
    this.cache.set(key, source);
    return source;
  }
}

/** Convenience: a fetch-based loader rooted at the document base. */
export function createBrowserLibrary(baseUrl = './') {
  const root = new URL('src/vendor/wgsl', new URL(baseUrl, document.baseURI)).pathname;
  const load = async (path) => {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load shader ${path}: ${res.status}`);
    return res.text();
  };
  return new WgslLibrary(load, root);
}
