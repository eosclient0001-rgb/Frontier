// Headless verification of the T. rex rig + gait (no browser needed).
// Run: npm test
import { MeshStandardMaterial, Vector3, Box3, Mesh, BoxGeometry, Quaternion, Euler } from 'three';
import { buildSkeleton, LEG } from '../trex/js/skeleton.js';
import { Animator } from '../trex/js/animator.js';
import { buildDecorations } from '../trex/js/decorations.js';
import { Hunter } from '../trex/js/hunter.js';
import { gaitAt, GAIT_KEYS, clamp, WALK_SPEED, RUN_SPEED } from '../trex/js/gait.js';
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
const dorsalRibMeshes = skel.bones.filter((m) => m.name.startsWith('Rib D')).length;
ok(dorsalRibMeshes === 26, `13 dorsal rib pairs as 26 named joints (${dorsalRibMeshes})`);
const missingJoints = skel.boneNames.filter((name) => !skel.getJoint(name) || !skel.getJoint(name).isObject3D);
const duplicateJoints = skel.joints.length - new Set(skel.joints).size;
ok(missingJoints.length === 0, `retarget map has a transform for every named bone (${skel.boneNames.length})`);
ok(duplicateJoints === 0, `every canonical bone has its own joint (${skel.joints.length} unique)`);
ok(skel.joints.every((j) => j.userData.retargetJoint && j.userData.restPosition && j.userData.restQuaternion), 'every joint stores a bind transform');
{
  const replacement = new Mesh(new BoxGeometry(0.03, 0.12, 0.03), mats.bone);
  skel.attachBoneMesh('limb.hind.fibula.L', replacement);
  ok(skel.getJoint('limb.hind.fibula.L').children.includes(replacement), 'replacement mesh attaches to a named joint');
  skel.clearBoneMesh('limb.hind.fibula.L');
  ok(!skel.getJoint('limb.hind.fibula.L').children.includes(replacement), 'replacement mesh can be cleared without changing the rig');
}

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

console.log('\nLook, sniff and roar-in-place studies');
{
  const study = (type, measure) => {
    const [sk, a] = mk(); run(a, 0.5);
    const base = sk.mouth.getWorldPosition(new Vector3());
    const startPos = a.rigPos.clone();
    const before = measure(sk, a, base);
    ok(a.startAction(type), `${type} action starts`);
    let observed = before;
    const frames = Math.ceil((a.constructor && ACTION_SECONDS[type] ? ACTION_SECONDS[type] : 4.2) * 60);
    for (let i = 0; i < frames; i++) { a.update(1 / 60); observed = measure(sk, a, base, observed); }
    ok(!a.busy, `${type} action completes`);
    ok(a.rigPos.distanceTo(startPos) < 0.02, `${type} keeps the feet/root in place`);
    return { before, observed };
  };
  const ACTION_SECONDS = { look: 4.2, sniffAir: 2.7, sniffGround: 3.4, roarInPlace: 3.3 };
  const look = study('look', (sk, a, base, old = 0) => Math.max(old, 1 - Math.abs(sk.head.quaternion.dot(new Quaternion()))));
  ok(look.observed > 0.01, 'look-around changes the head pose');
  const air = study('sniffAir', (sk, a, base, old = 0) => Math.max(old, sk.mouth.getWorldPosition(new Vector3()).y));
  ok(air.observed > air.before + 0.08, 'sniff-air lifts the snout');
  const ground = study('sniffGround', (sk, a, base, old = 1e9) => Math.min(old, sk.mouth.getWorldPosition(new Vector3()).y));
  ok(ground.observed < ground.before - 0.35, 'sniff-ground lowers the snout');
  const roarPlace = study('roarInPlace', (sk, a, base, old = 0) => Math.max(old, base.y - sk.mouth.getWorldPosition(new Vector3()).y));
  ok(roarPlace.observed > 0.45, 'roar-in-place visibly opens the jaw');
}

console.log('\nAmbient idle');
{
  const [sk, a] = mk();
  let lookMin = 999, lookMax = -999, airMax = -999, groundMin = 999;
  let sawAir = false, sawGround = false;
  const baseY = sk.mouth.getWorldPosition(new Vector3()).y;
  for (let t = 0; t < 40; t += 1 / 60) {
    a.update(1 / 60);
    const y = sk.mouth.getWorldPosition(new Vector3()).y;
    lookMin = Math.min(lookMin, a.idle.look.x);
    lookMax = Math.max(lookMax, a.idle.look.x);
    if (a.idle.sniff > 0) {
      if (a.idle.sniffMode > 0) { sawAir = true; airMax = Math.max(airMax, y); }
      else { sawGround = true; groundMin = Math.min(groundMin, y); }
    }
  }
  ok(lookMin < -10 && lookMax > 10, `idle scans both sides (${lookMin.toFixed(1)}° to ${lookMax.toFixed(1)}°)`);
  ok(sawAir && airMax > baseY + 0.025, `ambient air sniff lifts the snout (${baseY.toFixed(2)} → ${airMax.toFixed(2)} m)`);
  ok(sawGround && groundMin < baseY - 0.10, `ambient ground sniff lowers the snout (${baseY.toFixed(2)} → ${groundMin.toFixed(2)} m)`);
  ok(a.rigPos.length() < 0.01, 'ambient studies keep the root stationary');
}

console.log('\nTurn in place');
{
  const [sk, a] = mk(); run(a, 0.5);
  const h0 = a.heading; let steps = 0; const sequence = []; let maxShift = 0;
  a.onFootstep = (key) => { steps++; sequence.push(key); };
  a.turnBy(Math.PI / 2);
  // same criterion as above: a foot's position within one plant must not change
  let slide = 0; const lp = {};
  for (let t = 0; t < 6; t += 1 / 60) {
    a.update(1 / 60); maxShift = Math.max(maxShift, Math.abs(sk.pelvis.position.x));
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
  ok(sequence.includes('L') && sequence.includes('R') && sequence.every((key, i) => i === 0 || key !== sequence[i - 1]), `alternates planted feet (${sequence.join(' → ')})`);
  ok(maxShift > 0.05, `transfers weight over the support foot (${maxShift.toFixed(2)} m lateral shift)`);
  ok(slide < 0.02, `planted feet don't skate while pivoting (max ${(slide * 100).toFixed(2)} cm)`);
}

console.log('\nAttacks');
{
  const [biteSk, biteA] = mk(); run(biteA, 0.5);
  const biteTarget = new Vector3(0, 0.45, -5.8);
  biteA.aimTarget = biteTarget; biteA.aimWeight = 1;
  let maxBodyPitch = 0, windJaw = 0, biteSnap = null;
  biteA.on((ev) => {
    if (ev !== 'biteSnap') return;
    const m = wp(biteSk.mouth), n = wp(biteSk.snout), ab = n.clone().sub(m);
    const u = clamp(biteTarget.clone().sub(m).dot(ab) / ab.lengthSq(), 0, 1);
    biteSnap = {
      distance: m.clone().addScaledVector(ab, u).distanceTo(biteTarget),
      jaw: -biteSk.jaw.rotation.x,
    };
  });
  run(biteA, 1.0);
  biteA.startAction('bite', { target: biteTarget, reach: 5.8 });
  for (let t = 0; t < 2.0; t += 1 / 60) {
    biteA.update(1 / 60);
    maxBodyPitch = Math.max(maxBodyPitch, Math.abs(new Euler().setFromQuaternion(biteSk.pelvis.quaternion, 'YXZ').x));
    if (biteA.action?.t < 0.34) windJaw = Math.max(windJaw, biteA.A.jaw);
  }
  ok(maxBodyPitch < 10 * Math.PI / 180, `bite keeps the torso braced (max pelvis pitch ${(maxBodyPitch / Math.PI * 180).toFixed(1)}°)`);
  ok(windJaw > 0.7 && biteSnap?.jaw < 0.12, `bite closes the jaw orthally (${(windJaw * 180 / Math.PI).toFixed(0)}° open → ${(biteSnap?.jaw * 180 / Math.PI).toFixed(1)}° at contact)`);
  ok(biteSnap && biteSnap.distance < 0.87, `bite tooth row contacts before the pull (${biteSnap?.distance.toFixed(2)} m)`);

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
  let maxX = 0; const peaks = {};
  a.startAction('tailSwipe', { side: 1 });
  for (let t = 0; t < 2.3; t += 1 / 60) {
    a.update(1 / 60); maxX = Math.max(maxX, wp(sk.tail[40]).x);
    for (const i of [8, 40]) {
      const p = wp(sk.tail[i]);
      if (!peaks[i] || p.x > peaks[i].x) peaks[i] = { x: p.x, t, y: p.y };
    }
  }
  ok(maxX > 3.5, `tail swipe (side +1) whips the tail out to the right (${maxX.toFixed(1)} m)`);
  ok(peaks[40].t > peaks[8].t + 0.08 && peaks[40].y < 1.2, `tail wave travels to a low distal impact (${peaks[8].t.toFixed(2)} → ${peaks[40].t.toFixed(2)} s)`);
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

console.log('\nCybernetic decorations, bite variants and hunt policy');
{
  const [dSk, dAnim] = mk();
  dAnim.update(1 / 60);
  const decorations = buildDecorations(dSk);
  ok(decorations.antennae.parent === dSk.head && decorations.antennae.children.length === 2, 'two receiver antennae attach to the skull before the eyes');
  ok(decorations.actuators.length === 2, 'left and right hydraulic jaw actuators are present');
  ok(decorations.wires.length === 3, `exactly three electrical cables are present (${decorations.wires.map((w) => w.name).join(', ')})`);
  ok(decorations.wires.map((w) => w.color).join(',') === '16765471,16741928,15219509', 'cable colours are yellow, orange and red');
  const hipL = dSk.legs.L.femur.getWorldPosition(new Vector3());
  const hipR = dSk.legs.R.femur.getWorldPosition(new Vector3());
  ok(Math.abs(hipR.x - hipL.x) > 0.75, `pelvic hip joints are separated laterally (${Math.abs(hipR.x - hipL.x).toFixed(2)} m)`);

  decorations.update(1 / 60, dAnim);
  const wireStart = decorations.wires[0].points[5].clone();
  const closedPiston = decorations.actuators[0].piston.scale.y;
  dAnim.roar();
  for (let i = 0; i < 54; i++) { dAnim.update(1 / 60); decorations.update(1 / 60, dAnim); }
  const openPiston = decorations.actuators[0].piston.scale.y;
  const wireMoved = decorations.wires[0].points[5].distanceTo(wireStart);
  ok(Number.isFinite(openPiston) && Math.abs(openPiston - closedPiston) > 1e-3, 'jaw actuator piston visibly changes length with jaw motion');
  ok(wireMoved > 1e-3 && decorations.wires.every((w) => w.points.length === 11 && w.points.every((p) => Number.isFinite(p.x))), 'cables use finite dynamic Verlet points rather than rigid lines');

  const biteShapes = [];
  for (const variant of [0, 1, 2]) {
    const [, a] = mk();
    a.startAction('bite', { variant });
    for (let i = 0; i < 58; i++) a.update(1 / 60);
    biteShapes.push(`${a.A.headYaw.toFixed(4)}:${a.A.headPitch.toFixed(4)}:${a.A.surge.toFixed(4)}`);
  }
  ok(new Set(biteShapes).size === 3, `three bite variants produce distinct skull motion (${biteShapes.join(' | ')})`);

  const [turnSk, turnAnim] = mk();
  turnAnim.setTargetSpeed(3.0); turnAnim.setTurn(1);
  for (let i = 0; i < 150; i++) turnAnim.update(1 / 60);
  // In this rig's XYZ convention the local Z Euler channel is the axial yaw
  // channel; the Y channel is roll.
  const spineYaws = turnSk.trunk.map((j) => j.rotation.z);
  ok(Math.max(...spineYaws) - Math.min(...spineYaws) > 0.015, 'turn articulation is distributed through the trunk instead of one stiff rod');

  const chaseSk = buildSkeleton({ bone: new MeshStandardMaterial(), tooth: new MeshStandardMaterial() });
  const chaseAnim = new Animator(chaseSk);
  const chasePrey = { pos: new Vector3(), vel: new Vector3(), radius: 0.45, held: false };
  const chase = new Hunter(chaseAnim, chaseSk, chasePrey); chase.setEnabled(true);
  const ahead = (distance) => chaseAnim.rigPos.clone().add(new Vector3(-Math.sin(chaseAnim.heading) * distance, 0, -Math.cos(chaseAnim.heading) * distance));
  chasePrey.pos.copy(ahead(30)); chase.update(1 / 60);
  const farDecision = chaseAnim.targetSpeed;
  chasePrey.pos.copy(ahead(9)); chasePrey.vel.set(0, 0, 0); chase.update(1 / 60);
  const closeDecision = chaseAnim.targetSpeed;
  chasePrey.pos.copy(ahead(7)); chasePrey.vel.set(0, 0, -0.8); chase.update(1 / 60);
  const escapingDecision = chaseAnim.targetSpeed;
  ok(farDecision === RUN_SPEED, `far hunting chooses run (${farDecision.toFixed(1)} m/s)`);
  ok(closeDecision <= WALK_SPEED && closeDecision > 0.5, `near hunting chooses a controlled walk (${closeDecision.toFixed(1)} m/s)`);
  ok(escapingDecision > 0.5, `an escaping close prey keeps an active approach (${escapingDecision.toFixed(1)} m/s)`);
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
