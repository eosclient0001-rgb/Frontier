/** Localisation sweep: which settings give connected through-cracks? */
import { buildLattice } from '../src/peridynamics/Lattice.ts';
import { PeridynamicsSolver } from '../src/peridynamics/Solver.ts';
import { MATERIAL_PARAMS, MaterialType } from '../src/materials.ts';
import { box } from '../src/sdf/SDF.ts';

const IDS: Record<string, number> = {
  [MaterialType.GLASS]: 0, [MaterialType.WOOD]: 1, [MaterialType.CONCRETE]: 2,
  [MaterialType.PLASTIC]: 3, [MaterialType.ROCK]: 4,
};

function experiment(type: MaterialType, horizon: number, damageRate: number, strainRatio: number, steps = 900) {
  const dx = 0.02;
  const half: [number, number, number] = [0.16, 0.16, 0.04];
  const lattice = buildLattice(box(half[0], half[1], half[2]), {
    center: [0, 0, 0], halfSize: half, spacing: dx, horizon,
    material: MATERIAL_PARAMS[type], grainAxis: [0, 1, 0],
    heterogeneity: type === MaterialType.GLASS ? 0.18 : type === MaterialType.WOOD ? 0.55 : type === MaterialType.PLASTIC ? 0.12 : 0.75,
    softening: 60, jitter: 0.2, materialId: IDS[type],
  });
  const solver = new PeridynamicsSolver(lattice, { damping: 0.5, damageRate, maxSubsteps: 1e6 });
  solver.applyImpact([-half[0] * 0.85, 0.01, 0], [1, 0, 0], 1e9, dx * 2.2, strainRatio);
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) solver.stepOnce(solver.dt);
  const ms = performance.now() - t0;

  const raw = solver.findIslands();
  const pruned = PeridynamicsSolver.pruneIslands(raw.ids, raw.counts, raw.islandCount, Math.max(3, lattice.count * 0.002));
  const sizes = Array.from(pruned.counts).sort((a, b) => b - a);
  const mainFrac = sizes[0] / lattice.count;

  // Localisation metric: how anisotropic is the broken-bond network?
  // A through-crack is planar -> the broken-bond centroid cloud is flat.
  let n = 0, sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, szz = 0;
  for (let i = 0; i < lattice.count; i++) {
    if (lattice.damage[i] < 0.12) continue;
    const x = lattice.ref[i * 3], y = lattice.ref[i * 3 + 1], z = lattice.ref[i * 3 + 2];
    n++; sx += x; sy += y; sz += z; sxx += x * x; syy += y * y; szz += z * z;
  }
  const sd = n > 1 ? [
    Math.sqrt(Math.max(0, sxx / n - (sx / n) ** 2)),
    Math.sqrt(Math.max(0, syy / n - (sy / n) ** 2)),
    Math.sqrt(Math.max(0, szz / n - (sz / n) ** 2)),
  ] : [0, 0, 0];

  return { bumps: lattice.bondCount, ms: ms / steps, damage: lattice.meanDamage(), islands: pruned.islandCount, mainFrac, sizes: sizes.slice(0, 5), sd, stable: Number.isFinite(lattice.pos[0]) };
}

console.log('material   horizon  rate  eps/sc | bonds  ms/step  damage  islands  mainFrac  fragsizes');
for (const type of [MaterialType.GLASS, MaterialType.CONCRETE, MaterialType.WOOD, MaterialType.ROCK]) {
  for (const horizon of [1.0, 1.5, 2.0]) {
    for (const rate of [400, 2500, 12000]) {
      for (const ratio of [5, 9]) {
        const r = experiment(type, horizon, rate, ratio);
        console.log(`${type.padEnd(9)} ${horizon.toFixed(1)}  ${String(rate).padStart(5)} ${String(ratio).padStart(4)}  | ${String(r.bumps).padStart(6)} ${r.ms.toFixed(2).padStart(7)}  ${(r.damage*100).toFixed(1).padStart(5)}%  ${String(r.islands).padStart(6)}  ${r.mainFrac.toFixed(3).padStart(7)}  [${r.sizes.join(',')}] ${r.stable?'':'UNSTABLE'}`);
      }
    }
  }
}
