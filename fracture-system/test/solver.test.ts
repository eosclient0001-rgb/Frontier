/**
 * Headless verification of the peridynamics core.
 * Run with:  node --experimental-transform-types test/solver.test.ts
 *
 * Checks stability, timing, crack-propagation behaviour and the material
 * differentiation the whole system is supposed to deliver.
 */
import { buildLattice } from '../src/peridynamics/Lattice.ts';
import { PeridynamicsSolver } from '../src/peridynamics/Solver.ts';
import { MATERIAL_PARAMS, MaterialType } from '../src/materials.ts';
import { box } from '../src/sdf/SDF.ts';

const IDS: Record<string, number> = {
  [MaterialType.GLASS]: 0,
  [MaterialType.WOOD]: 1,
  [MaterialType.CONCRETE]: 2,
  [MaterialType.PLASTIC]: 3,
  [MaterialType.ROCK]: 4,
};

function runOne(
  type: MaterialType,
  opts: { dx?: number; half?: [number, number, number]; energy?: number; steps?: number; softening?: number; hetero?: number; horizon?: number; strainRatio?: number } = {},
) {
  const dx = opts.dx ?? 0.02;
  const half: [number, number, number] = opts.half ?? [0.16, 0.16, 0.04];
  const t0 = performance.now();

  const lattice = buildLattice(box(half[0], half[1], half[2]), {
    center: [0, 0, 0],
    halfSize: half,
    spacing: dx,
    horizon: opts.horizon ?? 2,
    material: MATERIAL_PARAMS[type],
    grainAxis: [0, 1, 0],
    heterogeneity: opts.hetero ?? defaultHetero(type),
    softening: opts.softening ?? 60,
    jitter: 0.25,
    materialId: IDS[type],
  });
  const buildMs = performance.now() - t0;

  const solver = new PeridynamicsSolver(lattice, { damping: 0.6, maxSubsteps: 100000 });
  const dt = solver.dt;

  const energy = opts.energy ?? energyFor(type);
  const impact = solver.applyImpact([-half[0] * 0.85, 0.02, 0], [1, 0, 0], energy, dx * 2.2, opts.strainRatio ?? 9);

  const steps = opts.steps ?? 700;
  const t1 = performance.now();
  let firstBreakStep = -1;
  let saturationStep = -1;
  let maxKE = 0;
  for (let i = 0; i < steps; i++) {
    solver.stepOnce(dt);
    const md = lattice.meanDamage();
    if (firstBreakStep < 0 && md > 0.001) firstBreakStep = i;
    if (saturationStep < 0 && md > 0.06) saturationStep = i;
    maxKE = Math.max(maxKE, lattice.kineticEnergy());
    if (!Number.isFinite(lattice.pos[0])) { console.log(`  !! NaN at step ${i}`); break; }
  }
  const simMs = performance.now() - t1;

  const raw = solver.findIslands();
  const pruned = PeridynamicsSolver.pruneIslands(raw.ids, raw.counts, raw.islandCount, Math.max(4, lattice.count * 0.001));

  return {
    type,
    nodes: lattice.count,
    bonds: lattice.bondCount,
    dt,
    buildMs,
    steps,
    impact,
    msPerStep: simMs / steps,
    meanDamage: lattice.meanDamage(),
    firstBreakStep,
    saturationStep,
    islandsRaw: raw.islandCount,
    islandCount: pruned.islandCount,
    fragments: Array.from(pruned.counts).sort((a, b) => b - a).slice(0, 6),
    maxKE,
    stable: Number.isFinite(lattice.pos[0]) && lattice.pos[0] < 1,
    velocity: solver.lattice.meanVelocity(),
  };
}

function defaultHetero(t: MaterialType): number {
  switch (t) {
    case MaterialType.GLASS: return 0.18;
    case MaterialType.WOOD: return 0.55;
    case MaterialType.CONCRETE: return 0.85;
    case MaterialType.PLASTIC: return 0.12;
    default: return 0.6;
  }
}

function energyFor(t: MaterialType): number {
  switch (t) {
    case MaterialType.GLASS: return 12;
    case MaterialType.WOOD: return 40;
    case MaterialType.CONCRETE: return 90;
    case MaterialType.PLASTIC: return 120;
    default: return 70;
  }
}

const show = (r: ReturnType<typeof runOne>) => {
  console.log(`${r.type.toUpperCase().padEnd(9)} ${String(r.nodes).padStart(6)} nodes ${String(r.bonds).padStart(7)} bonds  dt=${r.dt.toExponential(2)}  build=${r.buildMs.toFixed(0)}ms`);
  console.log(`          ${r.steps} steps @ ${r.msPerStep.toFixed(2)} ms/step | damage=${r.meanDamage.toFixed(4)} firstBreak@${r.firstBreakStep} saturate@${r.saturationStep} ETmax=${r.maxKE.toExponential(1)}J`);
  console.log(`          islands ${r.islandsRaw} -> ${r.islandCount} frags  sizes=[${r.fragments.join(', ')}]  eps/sc=${r.impact.strainRatio.toFixed(1)} v=${r.impact.velocity.toFixed(2)}m/s ${r.stable ? 'STABLE' : 'UNSTABLE'}`);
  console.log();
};

console.log('=== 1. material differentiation (16x16x4 lattice @ 20mm) ===\n');
for (const t of [MaterialType.GLASS, MaterialType.WOOD, MaterialType.CONCRETE, MaterialType.PLASTIC, MaterialType.ROCK]) {
  show(runOne(t));
}

console.log('=== 2. resolution sweep on glass (700 steps) ===\n');
for (const dx of [0.02, 0.0125, 0.01]) {
  const r = runOne(MaterialType.GLASS, { dx, steps: 700 });
  console.log(`  dx=${(dx * 1000).toFixed(1)}mm: ${String(r.nodes).padStart(6)} nodes ${String(r.bonds).padStart(8)} bonds  ${r.msPerStep.toFixed(2)} ms/step  damage=${r.meanDamage.toFixed(4)}  frags=${r.islandCount} ${r.stable ? '' : 'UNSTABLE'}`);
}
console.log();

console.log('=== 3. softening sweep on glass (time-rescaling only) ===\n');
for (const soft of [20, 60, 150, 400]) {
  const r = runOne(MaterialType.GLASS, { softening: soft, steps: 700 });
  console.log(`  softening=${String(soft).padStart(3)}: dt=${r.dt.toExponential(2)}  ${r.msPerStep.toFixed(2)} ms/step  damage=${r.meanDamage.toFixed(4)}  firstBreak@${r.firstBreakStep}  frags=${r.islandCount} ${r.stable ? '' : 'UNSTABLE'}`);
}
console.log();

console.log('=== 4. impact severity sweep: glass (the crack-vs-pulverise dial) ===\n');
for (const ratio of [0.5, 1, 2, 4, 6, 9, 14, 20]) {
  const r = runOne(MaterialType.GLASS, { strainRatio: ratio, steps: 700 });
  console.log(`  eps/sc=${String(ratio).padStart(4)}: damage=${r.meanDamage.toFixed(4)}  bondsBroken=${(r.meanDamage * 100).toFixed(1)}%  islands=${r.islandCount}  frags=[${r.fragments.join(', ')}]`);
}
console.log();

console.log('=== 4b. same severity sweep, all materials ===\n');
for (const t of [MaterialType.GLASS, MaterialType.WOOD, MaterialType.CONCRETE, MaterialType.PLASTIC, MaterialType.ROCK]) {
  const row: string[] = [];
  for (const ratio of [2, 5, 9, 16]) {
    const r = runOne(t, { strainRatio: ratio, steps: 700 });
    row.push(`${String(ratio).padStart(2)}:${(r.meanDamage * 100).toFixed(0).padStart(2)}%/${String(r.islandCount).padStart(3)}frag`);
  }
  console.log(`  ${t.toUpperCase().padEnd(9)} ${row.join('  ')}`);
}
console.log();

console.log('=== 5. wood grain anisotropy (crack must follow grain) ===\n');
for (const grainAxis of [[0, 1, 0], [1, 0, 0], [0, 0, 1]] as [number, number, number][]) {
  const half: [number, number, number] = [0.16, 0.16, 0.04];
  const lattice = buildLattice(box(half[0], half[1], half[2]), {
    center: [0, 0, 0], halfSize: half, spacing: 0.02, horizon: 2,
    material: MATERIAL_PARAMS[MaterialType.WOOD], grainAxis,
    heterogeneity: 0.55, softening: 60, jitter: 0.25, materialId: 1,
  });
  const solver = new PeridynamicsSolver(lattice, { damping: 0.6, maxSubsteps: 100000 });
  solver.applyImpact([-half[0] * 0.85, 0, 0], [1, 0, 0], 120, 0.044);
  for (let i = 0; i < 700; i++) solver.stepOnce(solver.dt);

  // Measure the orientation of the damaged set with a simple covariance.
  let n = 0, sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, szz = 0;
  for (let i = 0; i < lattice.count; i++) {
    if (lattice.damage[i] < 0.15) continue;
    const x = lattice.ref[i * 3], y = lattice.ref[i * 3 + 1], z = lattice.ref[i * 3 + 2];
    n++; sx += x; sy += y; sz += z;
    sxx += x * x; syy += y * y; szz += z * z;
  }
  const span = n > 0
    ? `dx=${Math.sqrt(Math.max(0, sxx / n - (sx / n) ** 2)).toFixed(3)} dy=${Math.sqrt(Math.max(0, syy / n - (sy / n) ** 2)).toFixed(3)} dz=${Math.sqrt(Math.max(0, szz / n - (sz / n) ** 2)).toFixed(3)}`
    : 'none';
  console.log(`  grain=[${grainAxis.join(',')}] damagedNodes=${String(n).padStart(4)} spread ${span}`);
}
