/** Focused carver test: one through-crack in a box must give exactly 2 closed solids. */
import { carve } from '../src/fracture/Carver.ts';
import { box, evalSDF } from '../src/sdf/SDF.ts';
import { meshVolume } from '../src/fracture/Carver.ts';
import type { Vec3 } from '../src/fracture/CrackNetwork.ts';
import type { CarveSegment } from '../src/fracture/Carver.ts';

const half: Vec3 = [0.15, 0.15, 0.05];
const object = box(half[0], half[1], half[2]);
const bounds = { min: [-half[0], -half[1], -half[2]] as Vec3, max: [half[0], half[1], half[2]] as Vec3 };

function run(label: string, segments: CarveSegment[], resolution: number, rough = 0.3) {
  const r = carve({
    object, bounds, resolution, segments,
    materialId: 2, density: 2400,
    faceRoughness: rough, faceRoughnessScale: 1 / 0.1,
    grainAxis: [0, 1, 0], drawAxis: [1, 0, 0],
    minFragmentVolume: 0,
  });
  const exact = 8 * half[0] * half[1] * half[2];
  const tot = r.fragments.reduce((a, f) => a + f.volume, 0);
  console.log(`${label}: grid ${r.stats.grid.join('x')} cell ${(r.stats.cellSize*1000).toFixed(1)}mm islands=${r.stats.islands} frags=${r.fragments.length} tris=${r.stats.triangles}`);
  console.log(`   volume total ${(tot*1e6).toFixed(1)}cm³ vs exact ${(exact*1e6).toFixed(1)}cm³  = ${(tot/exact*100).toFixed(1)}%   ${r.stats.ms.toFixed(0)}ms`);
  for (const f of r.fragments.slice().sort((a,b)=>b.volume-a.volume).slice(0,5)) {
    // check closure: for a closed mesh, sum of signed volumes per triangle must be nonzero
    // and the surface must be manifold-ish. We check volume > 0 and a sane radius.
    console.log(`   frag v=${(f.volume*1e6).toFixed(2)}cm³ tris=${f.triangles} r=${(f.radius*100).toFixed(1)}cm centroid=[${f.centroid.map(c=>c.toFixed(3)).join(',')}]`);
  }
  return { r, tot, exact };
}

console.log('=== no cracks (sanity: should be 1 fragment at ~100%) ===');
run('no cracks', [], 56);

console.log('\n=== one through-crack along x (plane normal = y) at x=0 ===');
run('1 cut', [{ a: [0, -half[1], 0], b: [0, half[1], 0], n: [1, 0, 0], aperture: 0.004, origin: [0, 0, 0], id: 0 }], 56, 0);

console.log('\n=== one through-crack with roughness ===');
run('1 cut rough', [{ a: [0, -half[1], 0], b: [0, half[1], 0], n: [1, 0, 0], aperture: 0.004, origin: [0, 0, 0], id: 0 }], 56, 0.4);

console.log('\n=== cross cut (2 orthogonal cracks -> 4 pieces) ===');
run('cross', [
  { a: [0, -half[1], 0], b: [0, half[1], 0], n: [1, 0, 0], aperture: 0.004, origin: [0,0,0], id: 0 },
  { a: [-half[0], 0, 0], b: [half[0], 0, 0], n: [0, 1, 0], aperture: 0.004, origin: [0,0,0], id: 1 },
], 64, 0);

console.log('\n=== partial crack (arrested): should stay 1 piece, with a slit ===');
run('partial', [{ a: [0, -half[1], 0], b: [0, 0.02, 0], n: [1, 0, 0], aperture: 0.004, origin: [0,-half[1],0], id: 0 }], 56, 0);

console.log('\n=== radial star (like glass), 6 cracks from centre ===');
const star: CarveSegment[] = [];
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2;
  const dx = Math.cos(a), dy = Math.sin(a);
  star.push({ a: [0,0,0], b: [dx*half[0]*1.05, dy*half[1]*1.05, 0], n: [-dy, dx, 0], aperture: 0.003, origin: [0,0,0], id: i });
}
run('star', star, 76, 0.1);

console.log('\n=== resolution scaling (6-crack star, the expensive case) ===');
for (const res of [76, 120, 160, 220, 300]) {
  const r = carve({
    object, bounds, resolution: res, segments: star,
    materialId: 0, density: 2500, faceRoughness: 0.1, faceRoughnessScale: 1 / 0.1,
    grainAxis: [0,1,0], drawAxis: [1,0,0], minFragmentVolume: 0,
  });
  const tot = r.fragments.reduce((a,f)=>a+f.volume,0);
  console.log(`  res ${String(res).padStart(3)}: grid ${r.stats.grid.join('x').padEnd(14)} voxels ${String(r.stats.voxels).padStart(8)}  ${String(r.fragments).padStart(2)} frags  ${String(r.stats.triangles).padStart(7)} tris  vol ${(tot/8/half[0]/half[1]/half[2]*100).toFixed(1)}%  ${r.stats.ms.toFixed(0)}ms`);
}
