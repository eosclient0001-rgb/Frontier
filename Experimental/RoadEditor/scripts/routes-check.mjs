// Headless check of railway / tram routes: builds the reference city, walks every route and
// reports lengths, loops and the largest lateral jumps (should be small after smoothing).
import { generateCity } from '../src/road/cityGen.js';
import { buildRoutes, sampleRoute } from '../src/road/routes.js';
import { getProfile, layout } from '../src/road/profiles.js';

const net = generateCity({});
const rail = e => getProfile(e).category === 'rail';
const tramLanes = e => layout(getProfile(e)).lanes.filter(l => l.type === 'tram');
const groups = {
  mainline: buildRoutes(net, { accept: e => getProfile(e).railKind === 'mainline', lateral: () => 0 }),
  monorail: buildRoutes(net, { accept: e => getProfile(e).railKind === 'monorail', lateral: () => 0 }),
  tram: buildRoutes(net, {
    accept: e => tramLanes(e).length > 0,
    lateral: (e, fwd) => { const lanes = tramLanes(e); const want = fwd ? 1 : -1; const l = lanes.find(x => x.dir === want) || lanes.find(x => !x.dir) || lanes[0]; return (l.o0 + l.o1) / 2; },
  }),
};
for (const [k, rs] of Object.entries(groups)) {
  const lens = rs.map(r => r.length).sort((a, b) => b - a);
  const loops = rs.filter(r => r.loop).length;
  let worst = 0;
  for (const r of rs) for (let i = 1; i < r.B.length; i++) worst = Math.max(worst, Math.abs(r.B[i] - r.B[i - 1]));
  console.log(k.padEnd(9), 'routes', rs.length, 'loops', loops, 'longest(m)', lens.slice(0, 4).map(v => v.toFixed(0)).join(', '), 'max lateral step', worst.toFixed(3));
}
const r = groups.mainline[0];
if (r) { const p = sampleRoute(r, r.length * 0.5); console.log('mainline mid sample', p.x.toFixed(1), p.y.toFixed(2), p.z.toFixed(1), 'dir', p.tx.toFixed(2), p.tz.toFixed(2)); }
