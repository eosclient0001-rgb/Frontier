/** 3 crack LINES that span the plate edge-to-edge must give 6 wedges. */
import { carve } from '../src/fracture/Carver.ts';
import { box } from '../src/sdf/SDF.ts';
import type { Vec3 } from '../src/fracture/CrackNetwork.ts';

const half: Vec3 = [0.15, 0.15, 0.05];
const object = box(half[0], half[1], half[2]);
const bounds = { min: [-half[0], -half[1], -half[2]] as Vec3, max: [half[0], half[1], half[2]] as Vec3 };
const segs: any[] = [];
for (let i = 0; i < 3; i++) {
  const a = (i / 3) * Math.PI;
  const dx = Math.cos(a), dy = Math.sin(a);
  const R = 0.5;
  segs.push({ a: [-dx * R, -dy * R, 0], b: [dx * R, dy * R, 0], n: [-dy, dx, 0], aperture: 0.006, origin: [0, 0, 0], id: i });
}
const r = carve({
  object, bounds, resolution: 60, segments: segs, materialId: 0, density: 2500,
  faceRoughness: 0.1, faceRoughnessScale: 8, grainAxis: [0, 1, 0], drawAxis: [1, 0, 0], minFragmentVolume: 0,
});
const exact = 8 * half[0] * half[1] * half[2];
const tot = r.fragments.reduce((a, f) => a + f.volume, 0);
console.log(`islands=${r.stats.islands} frags=${r.fragments.length} tris=${r.stats.triangles} vol=${(tot/exact*100).toFixed(1)}% cell=${(r.stats.cellSize*1000).toFixed(1)}mm ${r.stats.ms.toFixed(0)}ms`);
console.log(r.slice(2));
for (const f of r.fragments.slice().sort((a,b)=>b.volume-a.volume)) {
  console.log(`  v=${(f.volume*1e6).toFixed(2)}cm³  tris=${f.triangles}  mass=${(f.mass*1000).toFixed(1)}g  r=${(f.radius*100).toFixed(1)}cm  I=[${f.inertia.map(i=>i.toExponential(2)).join(',')}]`);
}
