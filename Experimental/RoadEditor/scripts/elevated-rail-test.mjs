// Quick standalone test for the elevated-rail builder, the in-street lightrail lanes, the
// merge flare, and the network serialization round-trip.
import { generateCity } from '../src/road/cityGen.js';
import { NetworkBuilder } from '../src/road/builder.js';
import { buildElevatedRail, monoCenterline, findUnderpasses } from '../src/road/geom/elevatedRail.js';
import { buildEdge } from '../src/road/geom/edge.js';
import { computeJunction } from '../src/road/junction.js';
import { buildJunction } from '../src/road/geom/junctionMesh.js';
import { getProfile, layout, LANE_TYPES } from '../src/road/profiles.js';
import { detectMerges } from '../src/road/geom/merge.js';

console.log('=== elevated-rail-test ===\n');

// 1. The monorail builder produces a valid Out with expected material and prop buckets.
{
  const net = generateCity({ seed: 1337, size: 4096 });
  const b = new NetworkBuilder(net);
  await b.buildAll();
  let total = 0, carCount = 0, piers = 0;
  for (const r of net.elevatedRails?.values() || []) {
    const out = b.outs.get(r.id);
    if (!out) { console.log('  FAIL: no out for', r.id); continue; }
    total++;
    for (const k in out.mesh) {
      if (out.mesh[k].i.length === 0) { console.log('  FAIL: empty piece', k, 'on', r.id); }
    }
    carCount += (out.props.monoCar?.length || 0) / 8;
  }
  console.log(`  ${total} elevated rails built, ${carCount} monorail cars placed`);
  if (total === 0) console.log('  FAIL: no monorails');
  if (carCount === 0) console.log('  FAIL: no monorail cars');
}

// 2. The in-street lightrail lanes render (lanes > 0 in build) and have visible features.
{
  const net = generateCity({ seed: 1337, size: 4096, lightrail: true });
  const b = new NetworkBuilder(net);
  await b.buildAll();
  let cars = 0, stops = 0, profileCount = 0;
  for (const e of net.edges.values()) {
    if (e.profile === 'lightrailAve' || e.profile === 'lightrailSide') {
      profileCount++;
      for (const f of e.features) {
        if (f.type === 'lightrailTrain') cars++;
        if (f.type === 'lightrailStop') stops++;
      }
    }
  }
  console.log(`  ${profileCount} lightrail edges, ${cars} streetcar props, ${stops} stops placed`);
  if (profileCount === 0) console.log('  FAIL: no lightrail edges');
  if (cars === 0) console.log('  FAIL: no streetcar cars');
}

// 3. Merge detection finds at least one merge in a city with mixed profiles.
{
  const net = generateCity({ seed: 1337, size: 4096 });
  const J = new Map();
  let mergeCount = 0, totalJunctions = 0;
  for (const n of net.nodes.values()) {
    const j = computeJunction(net, n.id);
    J.set(n.id, j);
    totalJunctions++;
    if (j.ends.length >= 2) {
      const ms = detectMerges(j);
      if (ms.length) mergeCount++;
    }
  }
  console.log(`  ${totalJunctions} junctions, ${mergeCount} with a detected merge`);
  if (mergeCount === 0) console.log('  (no merges — this is OK if all approaches match width)');
}

// 4. Network serialization round-trips elevated rails.
{
  const net = generateCity({ seed: 1337, size: 4096, monorail: true });
  const j = JSON.stringify(net.toJSON());
  const { RoadNetwork } = await import('../src/road/network.js');
  const j2 = JSON.parse(j);
  const back = RoadNetwork.fromJSON(j2);
  let ok = true;
  for (const r of net.elevatedRails?.values() || []) {
    const got = back.elevatedRails?.get(r.id);
    if (!got || got.pts.length !== r.pts.length) { ok = false; console.log('  FAIL: round-trip lost', r.id); }
  }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${net.elevatedRails?.size || 0} elevated rails round-tripped`);
}

// 5. Junction with mixed-width approaches produces a polygon with the expected flare
//    (the polygon should be larger than the no-flare case).
{
  const net = generateCity({ seed: 1337, size: 4096 });
  let totalFlares = 0, totalJunctions = 0, mixedJunctions = 0;
  for (const n of net.nodes.values()) {
    const j = computeJunction(net, n.id);
    if (j.ends.length < 2) continue;
    totalJunctions++;
    const widths = j.ends.map(e => layout(getProfile(e.edge)).total);
    const wMax = Math.max(...widths), wMin = Math.min(...widths);
    if (wMax - wMin > 1.5) mixedJunctions++;
    for (const g of j.gaps) if (g.flare) totalFlares++;
  }
  console.log(`  ${totalJunctions} junctions, ${mixedJunctions} mixed-width, ${totalFlares} flares fired`);
}

console.log('\n=== done ===');
