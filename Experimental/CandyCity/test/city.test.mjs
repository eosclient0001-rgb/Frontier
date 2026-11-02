// Headless validation of the procedural generator.
// Run: node test/city.test.mjs
// This checks structure, determinism and mesh integrity — not rendering.

import { buildCandyCity } from '../js/city.js';

let failures = 0;
function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
}

function fingerprint(stats) {
  return JSON.stringify(stats);
}

const seed = 20260101;
const a = buildCandyCity({ seed, textures: null });
const b = buildCandyCity({ seed, textures: null });
const sa = a.userData.stats;
const sb = b.userData.stats;

console.log('--- Candy City generator checks ---');
console.log(JSON.stringify(sa, null, 2));

check('grid blocks generated', sa.blocks === 36, `blocks=${sa.blocks}`);
check('houses placed', sa.houses >= 24, `houses=${sa.houses}`);
check('every block lots accounted for', sa.houses + sa.parks === sa.lots,
  `houses+parks=${sa.houses + sa.parks} lots=${sa.lots}`);
check('parks placed', sa.parks >= 1, `parks=${sa.parks}`);
check('every open block is built on', sa.lots === sa.blocks - 1,
  `lots=${sa.lots} buildable blocks=${sa.blocks - 1} (one block is the plaza)`);
check('candy trees placed', sa.trees >= 45, `trees=${sa.trees}`);
check('street lamps placed', sa.lamps >= 20, `lamps=${sa.lamps}`);
check('jelly-bean crosswalks', sa.beans >= 900, `beans=${sa.beans}`);
check('bean bookkeeping matches instancing', sa.beans <= sa.instancedBeanCount && sa.beans > 0,
  `crosswalk beans=${sa.beans} instanced=${sa.instancedBeanCount}`);
check('ground sprinkles', sa.sprinkles >= 3000, `sprinkles=${sa.sprinkles}`);
check('candy cars', sa.cars >= 1, `cars=${sa.cars}`);
check('triangles budget', sa.triangles > 150000 && sa.triangles < 2500000, `triangles=${sa.triangles}`);
check('merged draw buckets', sa.meshes > 8 && sa.meshes < 40, `meshes=${sa.meshes}`);

// Determinism: identical seed must yield byte-identical statistics.
check('deterministic statistics', fingerprint(sa) === fingerprint(sb));
const c = buildCandyCity({ seed: seed + 1, textures: null });
check('a different seed changes the town',
  JSON.stringify(c.userData.stats) !== JSON.stringify(sa));

// Mesh integrity: finite positions and valid bounds.
let meshes = 0;
let bad = 0;
let instanced = 0;
a.traverse((obj) => {
  if (!obj.isMesh) return;
  meshes++;
  if (obj.isInstancedMesh) instanced++;
  const pos = obj.geometry.attributes.position;
  if (!pos) { bad++; return; }
  for (let i = 0; i < pos.count * 3; i++) {
    if (!Number.isFinite(pos.array[i])) { bad++; break; }
  }
  obj.geometry.computeBoundingSphere();
  const bs = obj.geometry.boundingSphere;
  if (!bs || !Number.isFinite(bs.radius) || bs.radius <= 0) bad++;
});

check('every mesh has finite geometry', bad === 0, `meshes=${meshes} bad=${bad}`);
check('instanced detail layers present', instanced >= 2, `instanced=${instanced}`);

// Every candy surface material must be a real three material.
let mats = 0;
let badMat = 0;
const seen = new Set();
a.traverse((obj) => {
  if (!obj.isMesh) return;
  const list = Array.isArray(obj.material) ? obj.material : [obj.material];
  for (const m of list) {
    if (!m || seen.has(m.uuid)) continue;
    seen.add(m.uuid);
    mats++;
    if (m.type !== 'MeshStandardMaterial' && m.type !== 'MeshPhysicalMaterial') badMat++;
  }
});
check('candy materials resolved', mats >= 12 && badMat === 0, `materials=${mats} bad=${badMat}`);

// Animation hook must be safe to call.
a.userData.update(1.5);
check('animation hook runs', true);

a.userData.dispose();
b.userData.dispose();
c.userData.dispose();

console.log(failures === 0 ? '\nAll generator checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
