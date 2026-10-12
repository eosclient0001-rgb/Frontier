// Frontier Road Editor — seeded procedural city generator (roads only)
import { Network } from './network.js';
import { mulberry32, hashSeed, segIntersect } from './util.js';

export const CITY_DEFAULTS = {
  seed: 1337,
  extent: 2200,      // city size in meters (square)
  block: 220,        // block size
  avenueEvery: 3,    // every Nth line becomes an arterial avenue
  ring: true,        // ring road on the perimeter
  diagonal: true,    // diagonal grand boulevard
  highway: true,     // upgrade one avenue to motorway
  rail: true,        // railway with level crossings
  metro: true,       // subway portals + vents
  furniture: true,   // lamps, signals, bollards, crosswalks, bumps
  bumps: true,       // speed bumps on residential streets
};

export function generateCity(params = {}) {
  const P = { ...CITY_DEFAULTS, ...params };
  const seedNum = typeof P.seed === 'string' ? hashSeed(P.seed) : (P.seed >>> 0);
  const rng = mulberry32(seedNum);
  const net = new Network();

  const E = P.extent, half = E / 2, B = P.block;
  const nLines = Math.max(3, Math.round(E / B) + 1);
  const step = E / (nLines - 1);

  // grid node ids [i][j]
  const ids = [];
  for (let i = 0; i < nLines; i++) {
    ids.push([]);
    for (let j = 0; j < nLines; j++) {
      ids[i].push(net.addNode(-half + i * step, -half + j * step, 0).id);
    }
  }

  const isAvenue = k => k % P.avenueEvery === 0 && k !== 0 && k !== nLines - 1;
  const highwayLine = Math.round(nLines * 0.32);

  const lineProfile = (k, axis) => {
    if (P.highway && k === highwayLine) return 'highway';
    if (isAvenue(k)) return axis === 0 ? 'avenue' : 'boulevard';
    return 'street';
  };

  // grid edges
  for (let i = 0; i < nLines; i++) {
    for (let j = 0; j < nLines - 1; j++) {
      const eV = net.addEdge(ids[i][j], ids[i][j + 1], lineProfile(i, 0));
      const eH = net.addEdge(ids[j][i], ids[j + 1][i], lineProfile(i, 1));
      if (eV && P.bumps && eV.profile === 'street' && rng() < 0.35) eV.opts.bumps = true;
      if (eH && P.bumps && eH.profile === 'street' && rng() < 0.35) eH.opts.bumps = true;
    }
  }

  // ring road: replace perimeter edges with expressway
  if (P.ring) {
    for (const e of [...net.edges.values()]) {
      const A = net.nodes.get(e.a), Bn = net.nodes.get(e.b);
      const onEdge = p => Math.abs(Math.abs(p.x) - half) < 1 || Math.abs(Math.abs(p.z) - half) < 1;
      if (onEdge(A) && onEdge(Bn)) { e.profile = 'expressway'; e.opts.bumps = false; }
    }
  }

  // diagonal grand boulevard (corner→corner), splitting every grid edge it crosses
  if (P.diagonal) {
    const start = net.nearestNode(-half, -half, 2) || net.addNode(-half, -half, 0);
    const end = net.nearestNode(half, half, 2) || net.addNode(half, half, 0);
    let chain = [start.id];
    // collect crossing params along the diagonal
    const hits = [];
    for (const e of [...net.edges.values()]) {
      const A = net.nodes.get(e.a), Bn = net.nodes.get(e.b);
      const h = segIntersect(-half, -half, half, half, A.x, A.z, Bn.x, Bn.z);
      if (h && h.t > 0.02 && h.t < 0.98 && h.u > 0.02 && h.u < 0.98) hits.push({ e: e.id, t: h.u, d: h.t });
    }
    hits.sort((a, b) => a.d - b.d);
    let cursor = null;
    for (const h of hits) {
      // split the crossed grid edge
      const nn = net.splitEdge(h.e, h.t);
      if (nn) chain.push(nn.id);
      void cursor;
    }
    chain.push(end.id);
    for (let k = 0; k < chain.length - 1; k++) {
      const A = net.nodes.get(chain[k]), Bn = net.nodes.get(chain[k + 1]);
      if (Math.hypot(A.x - Bn.x, A.z - Bn.z) > 6) net.addEdge(chain[k], chain[k + 1], 'boulevard');
    }
  }

  // railway: slightly angled traverse, splitting roads at every crossing
  if (P.rail) {
    const z0 = -half * 0.35, z1 = half * 0.45;
    const rA = net.addNode(-half - 40, z0, 0);
    const rB = net.addNode(half + 40, z1, 0);
    const hits = [];
    for (const e of [...net.edges.values()]) {
      if (e.kind !== 'road') continue;
      const A = net.nodes.get(e.a), Bn = net.nodes.get(e.b);
      const h = segIntersect(-half - 40, z0, half + 40, z1, A.x, A.z, Bn.x, Bn.z);
      if (h && h.t > 0.03 && h.t < 0.97 && h.u > 0.03 && h.u < 0.97) hits.push({ e: e.id, t: h.u, d: h.t });
    }
    hits.sort((a, b) => a.d - b.d);
    const chain = [rA.id];
    for (const h of hits) {
      const nn = net.splitEdge(h.e, h.t);
      if (nn) chain.push(nn.id);
    }
    chain.push(rB.id);
    for (let k = 0; k < chain.length - 1; k++) net.addEdge(chain[k], chain[k + 1], 'rail', 'rail');
  }

  // metro portals + vents along the central avenue corridor
  if (P.metro) {
    const zc = -half + Math.round((nLines - 1) / 2) * step; // central grid line
    const xs = [-half * 0.55, 0, half * 0.55];
    for (const bx of xs) {
      const x = bx + (rng() - 0.5) * step * 0.4;
      // mouth faces the avenue (−Z side of the block)
      net.addProp('portal', x, zc + step * 0.5 + 6, Math.PI, { y: -0.4 });
    }
    net.addProp('vent', step * 0.9, zc - step * 0.45, 0, {});
    net.addProp('vent', -step * 1.4, zc + step * 1.35, 0.6, {});
  }

  return net;
}
