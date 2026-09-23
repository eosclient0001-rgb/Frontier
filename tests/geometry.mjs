/* Validate buildTireGeometry topology with a stubbed THREE. */
class BufferAttribute {
  constructor(arr, size) { this.array = arr; this.itemSize = size; this.count = arr.length / size; }
}
class BufferGeometry {
  constructor() { this.attributes = {}; this.groups = []; this.index = null; }
  setAttribute(n, a) { this.attributes[n] = a; }
  setIndex(i) { this.index = i; }
  addGroup(s, c, m) { this.groups.push({ start: s, count: c, materialIndex: m }); }
  computeVertexNormals() {}
}
const v3 = () => ({ x: 0, y: 0, z: 0, set() { return this; }, copy() { return this; } });
class Color { constructor(c) { this.c = c; } }
class Group {
  constructor() { this.position = v3(); this.rotation = v3(); this.children = []; }
  add(...c) { this.children.push(...c); }
  traverse(f) { f(this); this.children.forEach(c => c.traverse ? c.traverse(f) : f(c)); }
}
class Mesh {
  constructor(g, m) { this.geometry = g; this.material = m; this.position = v3(); this.rotation = v3(); }
}
const stub = {
  BufferAttribute, BufferGeometry, DoubleSide: 2, Color, Group, Mesh,
  CylinderGeometry: class { rotateZ() { return this; } },
  TorusGeometry: class { rotateY() { return this; } },
  BoxGeometry: class {},
  MeshStandardMaterial: class { constructor(p) { Object.assign(this, p); } },
};

// expose the stub via a temporary node_modules/three package (self-created)
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync(new URL('../node_modules/three/', import.meta.url), { recursive: true });
writeFileSync(new URL('../node_modules/three/package.json', import.meta.url),
  '{ "name": "three", "version": "0.0.0-stub", "type": "module", "main": "index.js" }');
writeFileSync(new URL('../node_modules/three/index.js', import.meta.url), `
const T = globalThis.__THREE_STUB__;
export const BufferAttribute = T.BufferAttribute, BufferGeometry = T.BufferGeometry,
  DoubleSide = T.DoubleSide, Color = T.Color, Group = T.Group, Mesh = T.Mesh,
  CylinderGeometry = T.CylinderGeometry, TorusGeometry = T.TorusGeometry,
  BoxGeometry = T.BoxGeometry, MeshStandardMaterial = T.MeshStandardMaterial;`);
globalThis.__THREE_STUB__ = stub;

const { buildTireGeometry, buildRim } = await import('../js/geometry.js');
const { tireSize } = await import('../js/tiremath.js');

let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };

for (const [w, a, r] of [[145, 80, 13], [225, 45, 17], [305, 30, 20]]) {
  const sz = tireSize(w, a, r);
  const g = buildTireGeometry(sz);
  const pos = g.attributes.position, uv = g.attributes.uv, idx = g.index.array;
  check(`${sz.label}: pos/uv counts match`, pos.count === uv.count);
  const groupSum = g.groups.reduce((s, gr) => s + gr.count, 0);
  check(`${sz.label}: groups cover all indices`, groupSum === idx.length && g.groups.length === 2);
  check(`${sz.label}: idx in range`, idx.every(i => i < pos.count));
  /* radial bounds: sqrt(y²+z²) within [Rr-2, Ro+9] */
  let rMin = Infinity, rMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.array[i * 3 + 1], z = pos.array[i * 3 + 2];
    const rr = Math.hypot(y, z);
    rMin = Math.min(rMin, rr); rMax = Math.max(rMax, rr);
  }
  check(`${sz.label}: radial bounds [${rMin.toFixed(1)}, ${rMax.toFixed(1)}]`,
    rMin >= sz.Rr - 2.5 && rMax <= sz.Ro + 9);
  /* axial bounds */
  let xMax = 0;
  for (let i = 0; i < pos.count; i++) xMax = Math.max(xMax, Math.abs(pos.array[i * 3]));
  check(`${sz.label}: axial <= W/2+3 (${xMax.toFixed(1)})`, xMax <= sz.W / 2 + 3);
  /* uv bounds */
  let uvOK = true;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.array[i * 2], v = uv.array[i * 2 + 1];
    if (u < -0.01 || u > 1.01 || v < -0.01 || v > 1.01) uvOK = false;
  }
  check(`${sz.label}: uv within [0,1]`, uvOK);
  /* tread group non-empty */
  check(`${sz.label}: tread group sizable`, g.groups[0].count > 1000 && g.groups[1].count > 1000);
}

try {
  const sz = tireSize(225, 45, 17);
  buildRim(sz, { spokes: 5 });
  check('buildRim runs', true);
} catch (e) {
  check('buildRim runs: ' + e.message, false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
