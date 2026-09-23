// Headless verification of the T. rex rig + gait (no browser needed).
// Run: npm test
import { MeshStandardMaterial, Vector3, Box3 } from 'three';
import { buildSkeleton, LEG } from '../trex/js/skeleton.js';
import { Animator } from '../trex/js/animator.js';
import { gaitAt, GAIT_KEYS } from '../trex/js/gait.js';
import { SPEC } from '../trex/js/spec.js';
import { simulate } from './hunt-sim.mjs';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failures++; };

const mats = { bone: new MeshStandardMaterial(), tooth: new MeshStandardMaterial() };
const t0 = Date.now();
const skel = buildSkeleton(mats);
console.log(`built skeleton in ${Date.now() - t0} ms`);

// ---------------------------------------------------------------- anatomy
console.log('\nAnatomy vs FMNH PR 2081');
let verts = 0, meshes = 0;
skel.rig.traverse((o) => { if (o.isMesh) { meshes++; verts += o.geometry.attributes.position.count; } });
console.log(`  meshes: ${meshes}, vertices: ${verts.toLocaleString()}`);
const count = (pre) => skel.bones.filter((m) => m.name.startsWith(pre) && /\d$/.test(m.name)).length;
ok(count('Cervical') === 10, `10 cervical vertebrae (${count('Cervical')})`);
ok(count('Dorsal ') === 13, `13 dorsal vertebrae (${count('Dorsal ')})`);
ok(count('Sacral ') === 5, `5 sacral vertebrae (${count('Sacral ')})`);
ok(count('Caudal') === 47, `47 caudal vertebrae (${count('Caudal')})`);
ok(count('Rib pair') === 13, `13 dorsal rib pairs (${count('Rib pair')})`);

const anim = new Animator(skel);
anim.update(1 / 60);
skel.rig.updateMatrixWorld(true);
const box = new Box3().setFromObject(skel.rig);
const size = box.getSize(new Vector3());
console.log(`  bounding box: L ${size.z.toFixed(2)} m, H ${size.y.toFixed(2)} m, W ${size.x.toFixed(2)} m`);
ok(size.z > 11.6 && size.z < 13.0, `total length ≈ 12.3 m (${size.z.toFixed(2)})`);
ok(size.y > 3.5 && size.y < 4.4, `height 3.5–4.4 m (${size.y.toFixed(2)})`);
ok(Math.abs(box.min.y) < 0.06, `feet on the ground (min y ${box.min.y.toFixed(3)})`);
const hipTop = new Vector3(); skel.pelvis.getWorldPosition(hipTop);
ok(hipTop.y + 0.62 > 3.5 && hipTop.y + 0.62 < 3.96, `ilium top 3.5–3.96 m (${(hipTop.y + 0.62).toFixed(2)})`);

// --------------------------------------------------------------- gait model
console.log('\nGait model');
for (const k of GAIT_KEYS) {
  const g = gaitAt(k.v);
  console.log(`  v=${k.v.toFixed(1)} T=${g.T.toFixed(2)} stride=${g.stride.toFixed(2)} duty=${g.duty.toFixed(2)} Fr=${g.froude.toFixed(2)}`);
}
ok(gaitAt(2.2).duty > 0.5 && gaitAt(7.2).duty < 0.5, 'walk has double support, run has aerial phase');

// ------------------------------------------------------------ simulation
console.log('\nSimulation: idle → walk → run → walk → stop, with turns');
const script = [
  [0, 0, 0], [3, 2.2, 0], [9, 2.2, 0.6], [13, 7.2, 0], [20, 3.5, -0.5], [26, 0, 0], [32, 0, 0],
];
const dt = 1 / 60;
let nan = false, maxSlide = 0, overReach = 0, steps = 0, maxDip = 0, minFootY = 1e9;
const lastPlant = { L: null, R: null };
anim.onFootstep = () => steps++;
const tmp = new Vector3(), hip = new Vector3(), knee = new Vector3(), ankle = new Vector3();
const labels = new Set();
for (let t = 0; t < 32; t += dt) {
  let row = script[0];
  for (const r of script) if (t >= r[0]) row = r;
  anim.setTargetSpeed(row[1]);
  anim.setTurn(row[2]);
  anim.update(dt);
  labels.add(anim.gaitLabel);
  skel.rig.updateMatrixWorld(true);
  for (const key of ['L', 'R']) {
    const f = anim.feet[key];
    if (f.inStance && f.planted) {
      if (lastPlant[key] && lastPlant[key].plantId === f.plant) {
        const leg = skel.legs[key];
        leg.foot.getWorldPosition(tmp);
        const slide = Math.hypot(tmp.x - lastPlant[key].x, tmp.z - lastPlant[key].z);
        maxSlide = Math.max(maxSlide, slide);
      }
      const leg = skel.legs[key];
      leg.foot.getWorldPosition(tmp);
      lastPlant[key] = { plantId: f.plant, x: tmp.x, z: tmp.z };
    } else lastPlant[key] = null;
    const leg = skel.legs[key];
    leg.femur.getWorldPosition(hip); leg.tibia.getWorldPosition(knee); leg.meta.getWorldPosition(ankle);
    const lf = hip.distanceTo(knee), lt = knee.distanceTo(ankle);
    overReach = Math.max(overReach, Math.abs(lf - LEG.femur), Math.abs(lt - LEG.tibia));
    leg.foot.getWorldPosition(tmp);
    minFootY = Math.min(minFootY, tmp.y);
  }
  skel.rig.traverse((o) => { if (!nan && (isNaN(o.position.x) || isNaN(o.quaternion.w))) nan = o.name || o.type; });
}
ok(!nan, `no NaNs in any joint ${nan ? '(' + nan + ')' : ''}`);
ok(maxSlide < 0.02, `planted feet do not slide (max ${(maxSlide * 100).toFixed(2)} cm)`);
ok(overReach < 1e-3, `bone lengths preserved by IK (max err ${(overReach * 1000).toFixed(3)} mm)`);
ok(minFootY > 0.0, `feet never go through the ground (min MTP y ${minFootY.toFixed(3)})`);
ok(steps > 20, `footsteps fired (${steps})`);
console.log(`  gait states seen: ${[...labels].join(', ')}`);
ok(labels.has('Walk') && labels.has('Run') && labels.has('Idle'), 'idle, walk and run all reached');
ok(anim.speed === 0, `comes to a full stop (v=${anim.speed})`);
ok(anim.feet.L.planted && anim.feet.R.planted, 'both feet planted after stopping');


/* ------------------------------------------------------------ round 2 */
const mk = () => { const sk = buildSkeleton({ bone: new MeshStandardMaterial(), tooth: new MeshStandardMaterial() }); return [sk, new Animator(sk)]; };
const run = (a, sec) => { for (let t = 0; t < sec; t += 1 / 60) a.update(1 / 60); };
const wp = (o, v = new Vector3()) => o.getWorldPosition(v);

console.log('\nRoar');
{
  const [sk, a] = mk(); run(a, 0.5);
  const tip = () => { const p = new Vector3(0, 0.02, -1.30); sk.jaw.localToWorld(p); return p.y; };
  const closedGap = wp(sk.snout).y - tip();
  a.roar(); run(a, 1.2);
  const openGap = wp(sk.snout).y - tip();
  ok(openGap > closedGap + 0.6, `lower jaw opens DOWNWARD (snout-to-jaw-tip gap ${closedGap.toFixed(2)} → ${openGap.toFixed(2)} m)`);
  run(a, 2.5);
  ok(!a.busy, 'roar completes and returns to idle');
}

console.log('\nTurn in place');
{
  const [sk, a] = mk(); run(a, 0.5);
  const h0 = a.heading; let steps = 0; a.onFootstep = () => steps++;
  a.turnBy(Math.PI / 2);
  // same criterion as above: a foot's position within one plant must not change
  let slide = 0; const lp = {};
  for (let t = 0; t < 6; t += 1 / 60) {
    a.update(1 / 60); sk.rig.updateMatrixWorld(true);
    for (const key of ['L', 'R']) {
      const f = a.feet[key];
      if (!(f.inStance && f.planted)) { lp[key] = null; continue; }
      const p = wp(sk.legs[key].foot);
      if (lp[key] && lp[key].id === f.plant) slide = Math.max(slide, Math.hypot(p.x - lp[key].x, p.z - lp[key].z));
      else lp[key] = { id: f.plant, x: p.x, z: p.z };
    }
  }
  const turned = (a.heading - h0) * 180 / Math.PI;
  ok(Math.abs(turned - 90) < 3, `turns 90° on the spot (${turned.toFixed(1)}°)`);
  ok(a.rigPos.length() < 0.25, `stays in place (drift ${a.rigPos.length().toFixed(2)} m)`);
  ok(steps >= 2, `steps its feet round (${steps} steps)`);
  ok(slide < 0.02, `planted feet don't skate while pivoting (max ${(slide * 100).toFixed(2)} cm)`);
}

console.log('\nAttacks');
{
  let hits = 0; const N = [[0, 0.45, -5.8], [1, 1.5, -5.5], [0, 2.5, -6], [-1.2, 0.8, -5.0], [0, 0.45, -7]];
  for (const T of N) {
    const [sk, a] = mk(); run(a, 0.5);
    const P = new Vector3(...T); a.aimTarget = P; a.aimWeight = 1; run(a, 1.5);
    let d = 9;
    a.on((ev) => { if (ev === 'biteSnap') { const m = wp(sk.mouth), n = wp(sk.snout); const ab = n.clone().sub(m);
      const u = Math.max(0, Math.min(1, P.clone().sub(m).dot(ab) / ab.lengthSq())); d = m.addScaledVector(ab, u).distanceTo(P); } });
    a.startAction('bite', { target: P, reach: -T[2] }); run(a, 2);
    if (d < 0.87) hits++;
  }
  ok(hits === N.length, `aimed bite: tooth row reaches the target at the snap (${hits}/${N.length})`);
  const [sk, a] = mk(); run(a, 0.5);
  let maxX = 0; a.startAction('tailSwipe', { side: 1 });
  for (let t = 0; t < 2.3; t += 1 / 60) { a.update(1 / 60); maxX = Math.max(maxX, wp(sk.tail[40]).x); }
  ok(maxX > 3.5, `tail swipe (side +1) whips the tail out to the right (${maxX.toFixed(1)} m)`);
  ok(!a.busy, 'tail swipe completes');
}

console.log('\nHunt: chase the ball and attack');
{
  const spots = [[0, 0.45, -30], [3, 2, -8], [-4, 0.45, -1], [-15, 0.45, 10], [0, 0.45, -2.5], [2, 0.45, 3.5]];
  const { results, nan } = simulate({ spots, seconds: 20 });
  const ev = results.flatMap((r) => r.events);
  results.forEach((r) => console.log(`    ball @ ${r.spot.join(',')} → ${r.firstHit ? 'hit in ' + r.firstHit.toFixed(1) + ' s' : 'NO HIT'}  (${r.events.join(' ')})`));
  ok(!nan, 'no NaNs during the hunt');
  ok(results.every((r) => r.firstHit), `catches the ball from every start position (${results.filter((r) => r.firstHit).length}/${spots.length})`);
  ok(ev.includes('hit:bite') && ev.includes('hit:tail'), 'uses both the bite and the tail swipe');
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
