/**
 * End-to-end: impact -> coupled peridynamics + crack fronts -> carved fragments.
 * Run:  node --experimental-transform-types test/pipeline.test.ts
 */
import { FractureSim } from '../src/core/FractureSim.ts';
import { MaterialType } from '../src/materials.ts';
import type { Vec3 } from '../src/fracture/CrackNetwork.ts';

function run(type: MaterialType, severity: number, detail = 3, verbose = true) {
  const t0 = performance.now();
  const sim = new FractureSim({
    material: type,
    shape: type === MaterialType.GLASS ? 'plate'
      : type === MaterialType.WOOD ? 'beam'
        : type === MaterialType.PLASTIC ? 'bar'
          : 'brick',
    size: type === MaterialType.GLASS ? [0.6, 0.5, 0.03]
      : type === MaterialType.WOOD ? [0.9, 0.14, 0.05]
        : type === MaterialType.PLASTIC ? [0.5, 0.12, 0.12]
          : [0.35, 0.35, 0.35],
    detail,
    grainAxis: type === MaterialType.WOOD ? [1, 0, 0] : [0, 1, 0],
    anchored: type === MaterialType.GLASS,
    seed: 20250930,
    toughnessScale: 0.3,
  });
  const buildMs = performance.now() - t0;

  const half = sim.half;
  const point: Vec3 = [-half[0] * 0.7, half[1] * 0.2, half[2] * 0.9];
  const dir: Vec3 = [1, 0.15, -0.3];
  const impact = sim.triggerImpact(point, dir, 1e9, severity);

  const tSolve = performance.now();
  let guard = 0;
  while (sim.advance(1e9) && guard++ < 4000) { /* run to completion */ }
  const solveMs = performance.now() - tSolve;

  const tCarve = performance.now();
  const result = sim.carveFragments();
  const carveMs = performance.now() - tCarve;

  const frags = result.fragments.slice().sort((a, b) => b.volume - a.volume);
  const totalVol = frags.reduce((a, f) => a + f.volume, 0);
  const objectVol = sim.cfg.size[0] * sim.cfg.size[1] * sim.cfg.size[2];
  const st = sim.stats();
  const reasons: Record<string, number> = {};
  for (const f of sim.network.fronts) if (f.stoppedReason) reasons[f.stoppedReason] = (reasons[f.stoppedReason] ?? 0) + 1;

  if (verbose) {
    console.log(`\n--- ${type.toUpperCase()} ${sim.cfg.shape} ${sim.cfg.size.map(s => (s * 100).toFixed(0) + 'cm').join('x')} severity ${severity}x detail ${detail} ---`);
    console.log(`  build   ${buildMs.toFixed(0)}ms  lattice ${st.latticeNodes} nodes / ${st.latticeBonds} bonds, dx=${(sim.spacing * 1000).toFixed(1)}mm`);
    console.log(`  impact  v=${impact.velocity.toFixed(2)}m/s  eps/sc=${impact.strainRatio.toFixed(1)}`);
    console.log(`  solve   ${(solveMs / 1000).toFixed(2)}s wall (${st.substeps} substeps, ${st.msPerSubstep.toFixed(3)} ms/substep), sim time ${(sim.time * 1000).toFixed(3)}ms`);
    console.log(`  damage  ${(st.damage * 100).toFixed(1)}%  wave speed ${sim.waveSpeed.toFixed(0)}m/s  cR ${sim.rayleighSpeed.toFixed(0)}m/s`);
    console.log(`  cracks  ${st.crackFronts} fronts, ${st.crackLength.toFixed(3)}m total, peak ${st.maxCrackSpeed.toFixed(0)}m/s  arrest=${JSON.stringify(reasons)}`);
    console.log(`  carve   grid ${result.stats.grid.join('x')} cell=${(result.stats.cellSize * 1000).toFixed(1)}mm islands=${result.stats.islands} ${carveMs.toFixed(0)}ms`);
    console.log(`  FRAGS   ${frags.length} pieces, ${result.stats.triangles} tris, ${(totalVol / objectVol * 100).toFixed(1)}% volume`);
    if (frags.length) {
      console.log(`  sizes   ${frags.slice(0, 8).map(f => (f.volume * 1e6).toFixed(1)).join(' ')} cm³   (biggest/mass ${frags[0].mass.toFixed(3)}kg, r=${(frags[0].radius * 100).toFixed(1)}cm)`);
      const ratios = frags.slice(1, 6).map(f => (f.volume / frags[0].volume).toFixed(3));
      console.log(`  ratios  ${ratios.join(' ')}  (fragment/biggest)`);
    }
  }
  return { type, severity, ...result.stats, fragments: frags.length, totalVol, objectVol, solveMs, carveMs, crackLength: st.crackLength, fronts: st.crackFronts, biggest: frags[0]?.volume ?? 0, substeps: st.substeps };
}

console.log('=== FULL PIPELINE (coupled) ===');
for (const t of [MaterialType.GLASS, MaterialType.WOOD, MaterialType.CONCRETE, MaterialType.PLASTIC, MaterialType.ROCK]) {
  run(t, 9);
}

console.log('\n\n=== GLASS: severity response (does the fragment count scale?) ===');
for (const s of [2, 5, 10, 20, 40]) {
  const r = run(MaterialType.GLASS, s, 3, false);
  console.log(`  severity ${String(s).padStart(2)}x -> ${String(r.fronts).padStart(3)} fronts  ${r.crackLength.toFixed(2)}m crack  ${String(r.islands).padStart(3)} islands  ${String(r.fragments).padStart(3)} fragments  biggest ${(r.biggest * 1e6).toFixed(0)}cm³  (${(r.solveMs / 1000).toFixed(2)}s solve)`);
}

console.log('\n=== DETAIL LEVEL performance (glass pane) ===');
for (const d of [2, 3, 4]) {
  const r = run(MaterialType.GLASS, 9, d, false);
  console.log(`  detail ${d}: ${r.substeps} substeps, solve ${(r.solveMs / 1000).toFixed(2)}s, carve ${r.carveMs.toFixed(0)}ms, ${r.fragments} fragments, ${r.triangles} tris`);
}

if (process.env.SKIP_WOOD) { console.log('(wood grain sweep skipped)'); }
else console.log('\n=== WOOD: grain direction controls the split ===');
for (const grain of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]) {
  const sim = new FractureSim({
    material: MaterialType.WOOD, shape: 'beam', size: [0.9, 0.14, 0.05],
    detail: 3, grainAxis: grain, anchored: false, seed: 7, toughnessScale: 0.3,
  });
  sim.triggerImpact([-sim.half[0] * 0.7, 0, 0], [1, 0, 0], 1e9, 12);
  let g = 0;
  while (sim.advance(1e9) && g++ < 3000) { /* complete */ }
  const net = sim.network;
  let ex = 0, ey = 0, ez = 0;
  for (const s of net.segments) {
    const dx = Math.abs(s.b[0] - s.a[0]), dy = Math.abs(s.b[1] - s.a[1]), dz = Math.abs(s.b[2] - s.a[2]);
    ex += dx; ey += dy; ez += dz;
  }
  const tot = ex + ey + ez || 1;
  console.log(`  grain [${grain.join(',')}] -> crack travel share x=${(ex / tot * 100).toFixed(0)}% y=${(ey / tot * 100).toFixed(0)}% z=${(ez / tot * 100).toFixed(0)}%  (${net.segments.length} segments, ${net.stats().totalLength.toFixed(2)}m)`);
}
