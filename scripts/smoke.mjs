// Headless smoke test: citygen → network → mesher, no DOM/WebGL required.
import { generateCity, CITY_DEFAULTS } from '../src/core/citygen.js';
import { buildWorld } from '../src/core/mesher.js';
import { Network, UndoStack } from '../src/core/network.js';

const mats = new Proxy({}, { get: (_, k) => ({ name: String(k), isMeshStandardMaterial: true }) });

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  ok' : '  FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

console.log('> city generation');
const t0 = Date.now();
const net = generateCity({ ...CITY_DEFAULTS, seed: 1337 });
console.log(`  nodes=${net.nodes.size} edges=${net.edges.size} props=${net.props.length} (${Date.now() - t0} ms)`);
check('has nodes', net.nodes.size > 50);
check('has edges', net.edges.size > 100);
check('has rail edges', [...net.edges.values()].some(e => e.kind === 'rail'));
check('has portals', net.props.some(p => p.type === 'portal'));

console.log('> world meshing');
const t1 = Date.now();
const world = buildWorld(net, mats, { furniture: true });
const ms = Date.now() - t1;
console.log(`  tris=${world.stats.tris.toLocaleString()} instanced=${world.stats.instanced} (${ms} ms)`);
check('produced triangles', world.stats.tris > 200000, world.stats.tris.toLocaleString());
check('instanced props', world.stats.instanced > 500, String(world.stats.instanced));
check('edge pick polys', world.edgePolys.size > 100);

console.log('> geometry sanity');
let nan = 0, minY = Infinity, maxY = -Infinity, verts = 0;
world.group.traverse(o => {
  if (!o.geometry?.attributes?.position) return;
  const p = o.geometry.attributes.position;
  verts += p.count;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (!Number.isFinite(x + y + z)) nan++;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
});
check('no NaN vertices', nan === 0, `${verts.toLocaleString()} verts checked`);
check('sane height range', minY > -5 && maxY < 200, `y range ${minY.toFixed(2)}..${maxY.toFixed(2)}`);

console.log('> drawing / editing ops');
const n2 = new Network();
const a = n2.addNode(0, 0, 0), b = n2.addNode(100, 0, 0), c = n2.addNode(100, 100, 0);
const e1 = n2.addEdge(a.id, b.id, 'avenue');
n2.addEdge(b.id, c.id, 'street');
check('edge added', !!e1);
check('dup edge rejected', n2.addEdge(a.id, b.id, 'street') === null);
const mid = n2.splitEdge(e1.id, 0.5);
check('split creates node', !!mid && n2.edges.size === 3, `node at ${mid?.x.toFixed(1)},${mid?.z.toFixed(1)}`);
const s = n2.sampleEdge([...n2.edges.values()][0], 2.5);
check('sampling works', s.length > 3, `${s.length} samples`);
const e2 = [...n2.edges.values()][1];
e2.opts.archHeight = 12;
const s2 = n2.sampleEdge(e2, 2);
const peak = Math.max(...s2.map(p => p.y));
check('bridge arch raises deck', peak > 8, `peak=${peak.toFixed(1)}m`);
const u = new UndoStack();
u.push(n2);
n2.removeEdge([...n2.edges.keys()][0]);
const restored = u.pop(n2);
check('undo restores', restored.edges.size === 3);
const w2 = buildWorld(n2, mats, { furniture: true });
check('small net meshes', w2.stats.tris > 1000, w2.stats.tris.toLocaleString() + ' tris');

console.log('> profiles library');
const { PROFILE_LIST } = await import('../src/core/profiles.js');
check('12+ road presets', PROFILE_LIST.length >= 12, `${PROFILE_LIST.length} presets`);
for (const p of PROFILE_LIST) {
  const w = p.bands.reduce((s, b) => s + b.w, 0);
  if (!(w > 2 && w < 60)) check(`width sane: ${p.id}`, false, `${w}m`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
