/** Smoke test the exact presets the demo ships with, and report timings. */
import { FractureSim } from '../src/core/FractureSim.ts';
import { MaterialType } from '../src/materials.ts';
import type { Vec3 } from '../src/fracture/CrackNetwork.ts';
import type { PrefabShape } from '../src/sdf/SDF.ts';

const PRESETS: { name: string; material: MaterialType; shape: PrefabShape; size: [number, number, number]; anchored: boolean; sev: number }[] = [
  { name: 'glass',    material: MaterialType.GLASS,    shape: 'plate', size: [0.5, 0.4, 0.024], anchored: true,  sev: 12 },
  { name: 'wood',     material: MaterialType.WOOD,     shape: 'beam',  size: [0.8, 0.12, 0.05], anchored: false, sev: 20 },
  { name: 'concrete', material: MaterialType.CONCRETE, shape: 'brick', size: [0.34, 0.34, 0.34], anchored: false, sev: 20 },
  { name: 'plastic',  material: MaterialType.PLASTIC,  shape: 'bar',   size: [0.45, 0.1, 0.1],  anchored: false, sev: 25 },
  { name: 'rock',     material: MaterialType.ROCK,     shape: 'rock',  size: [0.34, 0.3, 0.3],  anchored: false, sev: 22 },
];

for (const p of PRESETS) {
  const sim = new FractureSim({
    material: p.material, shape: p.shape, size: p.size, detail: 3,
    grainAxis: p.material === MaterialType.WOOD ? [1, 0, 0] : [0, 1, 0],
    anchored: p.anchored, seed: 20250930, toughnessScale: 0.3,
  });
  const tIntact = performance.now();
  const intact = sim.carveFragments(30);
  const intactMs = performance.now() - tIntact;

  const pt: Vec3 = [-p.size[0] * 0.32, p.size[1] * 0.24, p.size[2] * 0.55];
  sim.triggerImpact(pt, [1, 0.2, -0.4], 0, p.sev);

  const tSolve = performance.now();
  let iters = 0;
  while (sim.advance(1e9) && iters++ < 4000) { /* to completion */ }
  const solveMs = performance.now() - tSolve;

  const tCarve = performance.now();
  const r = sim.carveFragments();
  const carveMs = performance.now() - tCarve;
  const st = sim.stats();
  const frags = r.fragments.slice().sort((a, b) => b.volume - a.volume);
  const vol = r.fragments.reduce((a, f) => a + f.volume, 0);
  const total = p.size[0] * p.size[1] * p.size[2];
  const reasons: Record<string, number> = {};
  for (const f of sim.network.fronts) reasons[f.stoppedReason || 'running'] = (reasons[f.stoppedReason || 'running'] ?? 0) + 1;

  console.log(`\n${p.name.toUpperCase()}`);
  console.log(`  intact mesh: ${intact.fragments.length} frag, ${(intact.stats.triangles/1000).toFixed(0)}k tris, ${intactMs.toFixed(0)}ms`);
  console.log(`  lattice: ${st.latticeNodes} nodes / ${st.latticeBonds} bonds, dx=${(sim.spacing*1000).toFixed(1)}mm`);
  console.log(`  event: ${iters} coupling steps, ${(solveMs/1000).toFixed(2)}s wall, ${(solveMs/Math.max(1,iters)).toFixed(1)}ms/step, damage=${(st.damage*100).toFixed(1)}%`);
  console.log(`  cracks: ${st.crackFronts} fronts (${st.activeFronts} live), ${(st.crackLength*1000).toFixed(0)}mm total, peak ${st.maxCrackSpeed.toFixed(0)}m/s, ${JSON.stringify(reasons)}`);
  console.log(`  carve: ${r.stats.grid.join('x')} cell ${(r.stats.cellSize*1000).toFixed(1)}mm in ${carveMs.toFixed(0)}ms`);
  console.log(`  RESULT: ${frags.length} fragments, ${(r.stats.triangles/1000).toFixed(0)}k tris, ${((vol/total)*100).toFixed(1)}% volume`);
  if (frags.length) console.log(`  top sizes(cm3): ${frags.slice(0,6).map(f=>(f.volume*1e6).toFixed(1)).join(' ')}`);
}
