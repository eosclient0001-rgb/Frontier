// node Verification/plant_smoke.mjs — every species × many seeds: one connected mesh, sane sizes, no NaN.
import { generatePlant, randomParams, connectedComponents, SPECIES, CATALOGUE } from '../plant.js';
let fails = 0, checks = 0;
const ok = (c, msg) => { checks++; if (!c) { fails++; console.log('  ✗', msg); } };
const expect = { palm: [1, 19], banana: [1.5, 9], fern: [.2, 7], aroid: [.2, 4] };
for (const cat of CATALOGUE) {
  const sp = cat.species; const t0 = Date.now(); let tri = 0, verts = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const P = randomParams(sp, seed, cat.variant);
    const r = generatePlant(sp, P);
    const pos = r.geometry.attributes.position.array;
    let nan = false; for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) { nan = true; break; }
    ok(!nan, `${sp}#${seed} NaN in positions`);
    ok(connectedComponents(r.geometry) === 1, `${sp}#${seed} mesh is not a single connected piece`);
    ok(r.stats.height >= expect[sp][0] && r.stats.height <= expect[sp][1], `${sp}#${seed} height ${r.stats.height} out of range`);
    ok(r.stats.triangles < 120000, `${sp}#${seed} too heavy: ${r.stats.triangles} tris`);
    const idx = r.geometry.index.array; let bad = false; for (let i = 0; i < idx.length; i++) if (idx[i] >= r.stats.vertices) bad = true;
    ok(!bad, `${sp}#${seed} index out of range`);
    // vertex colours present, no texture
    ok(r.geometry.attributes.color && r.geometry.attributes.color.count === r.stats.vertices, `${sp}#${seed} colour attr missing`);
    ok(!r.geometry.attributes.uv, `${sp}#${seed} has UVs (should be untextured)`);
    tri += r.stats.triangles; verts += r.stats.vertices;
  }
  // determinism
  const a = generatePlant(sp, randomParams(sp, 7, cat.variant)).geometry.attributes.position.array, b = generatePlant(sp, randomParams(sp, 7, cat.variant)).geometry.attributes.position.array;
  let same = a.length === b.length; for (let i = 0; same && i < a.length; i++) if (a[i] !== b[i]) same = false;
  ok(same, `${sp} not deterministic for same seed`);
  // uniqueness
  const c = generatePlant(sp, randomParams(sp, 8, cat.variant)).geometry.attributes.position.array;
  ok(!(a.length === c.length && a.every((v, i) => v === c[i])), `${sp} seeds 7 and 8 produce identical meshes`);
  console.log(`${cat.id.padEnd(18)} 20 seeds · avg ${Math.round(tri / 20)} tris / ${Math.round(verts / 20)} verts · ${Date.now() - t0} ms`);
}
console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
