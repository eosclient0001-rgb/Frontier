/** Visual check: N crack LINES through the centre of a plate -> 2N wedges. */
import { carve } from '../src/fracture/Carver.ts';
import { box } from '../src/sdf/SDF.ts';
import type { Vec3 } from '../src/fracture/CrackNetwork.ts';

const N = Number(process.argv[2] ?? 3);
const REACH = Number(process.argv[3] ?? 2.2);
const half: Vec3 = [0.15, 0.15, 0.05];
const object = box(half[0], half[1], half[2]);
const bounds = { min: [-half[0], -half[1], -half[2]] as Vec3, max: [half[0], half[1], half[2]] as Vec3 };
const segs: any[] = [];
for (let i = 0; i < N; i++) {
  const a = (i / N) * Math.PI * 2;
  const dx = Math.cos(a), dy = Math.sin(a);
  segs.push({ a: [0, 0, 0], b: [dx * half[0] * REACH, dy * half[1] * REACH, 0], n: [-dy, dx, 0], aperture: 0.006, origin: [0, 0, 0], id: i });
}
const r = carve({
  object, bounds, resolution: 44, segments: segs, materialId: 0, density: 2500,
  faceRoughness: 0, faceRoughnessScale: 1, grainAxis: [0, 1, 0], drawAxis: [1, 0, 0], minFragmentVolume: 0,
});
console.log(`N=${N} reach=${REACH}x  cell=${(r.stats.cellSize * 1000).toFixed(1)}mm  islands=${r.stats.islands}  frags=${r.fragments.length}`);
console.log(r.slice(2));
