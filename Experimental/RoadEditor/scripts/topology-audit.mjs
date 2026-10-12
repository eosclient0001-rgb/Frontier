// Topology audit of the generated city: finds
//  (a) road pairs that overlap in plan at the same height without sharing a node (a curve running
//      close to a road, or across it, without a junction), and
//  (b) junctions whose approaches leave the node at very narrow angles (slivers).
// Usage: node scripts/topology-audit.mjs [seed] [size]
import { generateCity } from '../src/road/cityGen.js';
import { NetworkBuilder } from '../src/road/builder.js';
import { getProfile, layout } from '../src/road/profiles.js';

const seed = +(process.argv[2] || 1337), size = +(process.argv[3] || 4096);
const net = generateCity({ seed, size });
const edges = [...net.edges.values()].filter(e => !net.isRail(e));
const half = e => layout(getProfile(e)).total / 2;
const cl = new Map(), bbox = new Map();
for (const e of edges) {
  const c = net.centerline(e); cl.set(e.id, c);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < c.X.length; i++) { x0 = Math.min(x0, c.X[i]); x1 = Math.max(x1, c.X[i]); z0 = Math.min(z0, c.Z[i]); z1 = Math.max(z1, c.Z[i]); }
  bbox.set(e.id, [x0, z0, x1, z1]);
}
// spatial hash over sample points
const CELL = 40, grid = new Map();
for (const e of edges) {
  const c = cl.get(e.id);
  for (let i = 0; i < c.X.length; i += 2) {
    const k = Math.floor(c.X[i] / CELL) + ',' + Math.floor(c.Z[i] / CELL);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push([e.id, c.X[i], c.Z[i], c.Y[i]]);
  }
}
const flagged = new Map();
const pairKey = (a, b) => a < b ? a + '|' + b : b + '|' + a;
for (const e of edges) {
  const c = cl.get(e.id), hw = half(e);
  // min distance from each sample of e to other edges' samples in nearby cells
  for (let i = 0; i < c.X.length; i += 2) {
    const cx = Math.floor(c.X[i] / CELL), cz = Math.floor(c.Z[i] / CELL);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const bucket = grid.get((cx + dx) + ',' + (cz + dz)); if (!bucket) continue;
      for (const [oid, ox, oz, oy] of bucket) {
        if (oid === e.id) continue;
        const o = net.edges.get(oid);
        if (o.a === e.a || o.a === e.b || o.b === e.a || o.b === e.b) continue; // shared node: handled by junction
        const d = Math.hypot(c.X[i] - ox, c.Z[i] - oz);
        const lim = hw + half(o);
        if (d < lim * 0.9 && Math.abs(c.Y[i] - oy) < 1.5) {
          const k = pairKey(e.id, oid);
          const prev = flagged.get(k);
          if (!prev || d < prev.d) flagged.set(k, { d, a: e.id, b: oid, x: (c.X[i] + ox) / 2, z: (c.Z[i] + oz) / 2, lim });
        }
      }
    }
  }
}
// (b) narrow-angle approaches at a node
const narrow = [];
for (const N of net.nodes.values()) {
  const es = net.nodeEdges(N.id).filter(e => !net.isRail(e));
  if (es.length < 2) continue;
  const angs = es.map(e => { const c = cl.get(e.id); const far = e.a === N.id ? 1 : c.X.length - 2; const dx = c.X[far] - N.x, dz = c.Z[far] - N.z; return Math.atan2(dz, dx); }).sort((a, b) => a - b);
  let minA = Infinity;
  for (let i = 0; i < angs.length; i++) { let d = Math.abs(angs[(i + 1) % angs.length] - angs[i]); if (angs.length === 1) d = Math.PI * 2; d = Math.min(d, Math.PI * 2 - d); minA = Math.min(minA, d); }
  if (es.length >= 2 && minA < 0.25) narrow.push({ id: N.id, deg: +(minA * 180 / Math.PI).toFixed(1), x: N.x, z: N.z, names: es.map(e => e.name).join(' / ') });
}
const pairs = [...flagged.values()].sort((a, b) => a.d - b.d);
console.log(`seed ${seed} size ${size}: ${edges.length} road edges`);
console.log(`(a) same-level overlapping pairs (no shared node): ${pairs.length}`);
for (const p of pairs.slice(0, 25)) console.log(`   d=${p.d.toFixed(1)} lim=${p.lim.toFixed(1)} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) ${net.edges.get(p.a).name} [${getProfile(net.edges.get(p.a)).id}] × ${net.edges.get(p.b).name} [${getProfile(net.edges.get(p.b)).id}]`);
console.log(`(b) narrow approach angles (<14°): ${narrow.length}`);
for (const n of narrow.slice(0, 15)) console.log(`   node ${n.id} ${n.deg}° at (${n.x.toFixed(1)}, ${n.z.toFixed(1)}) ${n.names}`);
