// Twelve seeds must all produce a complete, sane town.
// Run: node test/seed-sweep.mjs
import { buildCandyCity } from '../js/city.js';
let bad = 0;
for (const seed of [1, 7, 42, 99, 1234, 20260101, 555555, 888888, 31337, 2024, 777, 900001]) {
  const city = buildCandyCity({ seed, textures: null });
  const s = city.userData.stats;
  const ok = s.houses > 15 && s.trees > 100 && s.triangles > 200000 && s.meshes < 60 && Number.isFinite(s.triangles);
  if (!ok) bad++;
  console.log(seed, JSON.stringify({ h: s.houses, p: s.parks, t: s.trees, l: s.lamps, b: s.beans, tr: s.triangles, m: s.meshes, ok }));
  city.userData.dispose();
}
console.log(bad === 0 ? 'all seeds ok' : `${bad} bad seeds`);
process.exit(bad ? 1 : 0);
