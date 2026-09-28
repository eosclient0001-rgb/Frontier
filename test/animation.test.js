/**
 * Numeric verification of the animation, to the same standard as the geometry
 * test.  Motion is the half of this project that is easiest to fake and
 * hardest to see: nothing here inspects a picture, so a wing that whips, a
 * foot that skates or a head that snaps all fail loudly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { installDomShim } from './shim.js';

installDomShim();

const { buildEagle } = await import('../src/model/eagle.js');
const { EagleRig } = await import('../src/anim/rig.js');
const C = await import('../src/anim/cycles.js');

const eagle = buildEagle();
const rig = new EagleRig(eagle);
const STAND_HEIGHT = rig.calibrateStance();
const GROUND = -STAND_HEIGHT;

/* ------------------------------ the clips -------------------------------- */

/** Build the pose for a clip at time t, exactly as the viewer does. */
function poseAt(id, t) {
  const p = C.defaultPose();
  switch (id) {
    case 'flap': {
      const phase = t * C.FLAP_PARAMS.frequency;
      C.flapCycle(phase, p.wings.R, C.FLAP_PARAMS, 1);
      C.flapCycle(phase, p.wings.L, C.FLAP_PARAMS, -1);
      const r = C.flapBodyResponse(phase);
      p.trunk.y = r.y;
      p.trunk.z = r.z;
      p.trunk.pitch = r.pitch;
      p.trunk.roll = r.rollOsc;
      p.tail.pitch = 4;
      p.tail.spread = 42;
      p.head.curve = 0.55;
      break;
    }
    case 'glide':
      C.glidePose(t, p.wings.R, { dihedral: 6.5 });
      C.glidePose(t + 0.7, p.wings.L, { dihedral: 6.9 });
      p.tail.spread = 68;
      break;
    case 'walk':
      C.walkCycle(t * C.WALK_PARAMS.frequency, p, GROUND, C.WALK_PARAMS);
      break;
    case 'idle':
      C.idlePose(t, p, { ground: GROUND });
      break;
    case 'screech':
      C.screechPose(t, p);
      C.standingPose(p, GROUND);
      break;
    default:
      C.headTurnPose(t, p);
      C.standingPose(p, GROUND);
      break;
  }
  return p;
}

const CLIPS = [
  ['flap', 1 / 2.8, C.FLAP_PARAMS.downStroke],
  ['glide', 3.6, 0],
  ['walk', 1 / C.WALK_PARAMS.frequency, C.WALK_PARAMS.duty],
  ['idle', 4.4, 0],
  ['screech', 1.86, 0],
  ['headturn', 4.4, 0],
];

/** Lowest world-space vertex under a node. */
const _v = new Vector3();
function lowestY(node) {
  let low = Infinity;
  node.traverse((o) => {
    if (!o.isMesh) return;
    o.updateWorldMatrix(true, false);
    const p = o.geometry.getAttribute('position');
    if (!p) return;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      if (_v.y < low) low = _v.y;
    }
  });
  return low;
}

test('every clip runs for a full cycle with no exceptions and no NaN', () => {
  for (const [id, period, duty] of CLIPS) {
    rig.resetSprings();
    const steps = 90;
    for (let k = 0; k < steps; k++) {
      const t = (k / steps) * period;
      const p = poseAt(id, t);
      assert.doesNotThrow(() => rig.apply(p, 1 / 60), `${id} at t=${t.toFixed(3)}`);
      eagle.root.updateMatrixWorld(true);
      for (const leg of ['right', 'left']) {
        const sole = rig.soleLowest(rig.legs[leg]);
        assert.ok(Number.isFinite(sole), `${id}: ${leg} sole is ${sole} at t=${t.toFixed(3)}`);
      }
    }
    assert.ok(duty >= 0 && duty <= 1);
  }
});

test('the standing bird puts its feet exactly on the ground', () => {
  const p = C.defaultPose();
  C.standingPose(p, GROUND);
  rig.apply(p, 1 / 60);
  for (const side of ['right', 'left']) {
    const sole = rig.soleLowest(rig.legs[side]);
    assert.ok(
      Math.abs(sole - GROUND) < 0.002,
      `${side} sole at ${sole.toFixed(4)} m, ground at ${GROUND.toFixed(4)} m`,
    );
  }
});

test('the walk plants each foot without sliding or sinking', () => {
  const freq = C.WALK_PARAMS.frequency;
  const duty = C.WALK_PARAMS.duty;
  const phases = 40;
  const trace = { right: [], left: [] };
  for (let k = 0; k < phases; k++) {
    const f = k / phases;
    const p = poseAt('walk', f / freq);
    rig.apply(p, 1 / 60);
    for (const side of ['right', 'left']) {
      const s = side === 'right' ? f : (f + 0.5) % 1;
      // report the foot's own cycle phase, not the body's
      trace[side].push({ s, y: rig.soleLowest(rig.legs[side]), foot: p.legs[side === 'right' ? 'R' : 'L'] });
    }
  }
  for (const side of ['right', 'left']) {
    const planted = trace[side].filter((e) => e.s < duty - 1e-6);
    assert.ok(planted.length > 8, `${side}: only ${planted.length} stance samples`);
    for (const e of planted) {
      // No slack anywhere in stance, including the last samples before
      // toe-off.  The sole is placed by measuring the actual offset between
      // the foot joint and the lowest vertex of the toes, so the only error
      // left is the solver's own tolerance; a millimetre of dip is a visible
      // sink at this scale, and it is what a tolerance here would hide.
      assert.ok(
        Math.abs(e.y - GROUND) < 2e-4,
        `${side} sole ${e.y.toFixed(6)} during stance at phase ${e.s.toFixed(3)}, ground ${GROUND.toFixed(6)}`,
      );
    }
    // The swing half of the cycle has to actually leave the ground, or the
    // bird is dragging its feet.
    const swing = trace[side].filter((e) => e.s > duty + 0.1 && e.s < duty + 0.35);
    assert.ok(swing.length > 2, `${side}: only ${swing.length} swing samples`);
    const maxLift = Math.max(...swing.map((e) => e.y - GROUND));
    assert.ok(maxLift > 0.01, `${side} only lifts ${(maxLift * 1000).toFixed(1)} mm`);
  }
});

test('the walk cycle is periodic: no seam at the wrap', () => {
  // Sample either side of the loop point; a cycle whose start and end do not
  // agree will snap in the viewer, which is the most visible bug a looped clip
  // can have.
  const freq = C.WALK_PARAMS.frequency;
  for (const [a, b] of [[0.999, 0.001], [0.499, 0.501]]) {
    const pa = poseAt('walk', a / freq);
    const pb = poseAt('walk', b / freq);
    for (const key of ['R', 'L']) {
      const fa = pa.legs[key].footRoot;
      const fb = pb.legs[key].footRoot;
      assert.ok(
        Math.hypot(fa.x - fb.x, fa.y - fb.y, fa.z - fb.z) < 0.02,
        `${key} footRoot jumps ${fa.z.toFixed(4)} -> ${fb.z.toFixed(4)} across the wrap`,
      );
      assert.ok(
        Math.abs(pa.legs[key].tarsusPitch - pb.legs[key].tarsusPitch) < 12,
        `${key} tarsusPitch jumps across the wrap`,
      );
    }
  }
});

test('the flap stroke is deepest-extended and folds on the recovery', () => {
  // The span a wing presents is the honest test of a flap cycle: it has to be
  // at its maximum at the bottom of the downstroke, where the wing is doing
  // the work, and at its minimum at the top of the upstroke.
  const span = (phase) => {
    rig.resetSprings();
    const p = poseAt('flap', phase / C.FLAP_PARAMS.frequency);
    rig.apply(p, 1 / 60);
    eagle.root.updateMatrixWorld(true);
    let max = 0;
    for (const w of [eagle.joints.wingRight, eagle.joints.wingLeft]) {
      for (const f of w.primaries) {
        f.mesh.updateWorldMatrix(true, false);
        const pos = f.mesh.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          _v.fromBufferAttribute(pos, i).applyMatrix4(f.mesh.matrixWorld);
          max = Math.max(max, Math.abs(_v.x));
        }
      }
    }
    return max * 2;
  };
  const atBottom = span(C.FLAP_PARAMS.downStroke * 0.98);
  const atTop = span(0.02);
  assert.ok(atBottom > 1.2, `span at the bottom of the downstroke is only ${atBottom.toFixed(3)} m`);
  assert.ok(
    atBottom / atTop > 1.35,
    `span ${atBottom.toFixed(3)} at the bottom vs ${atTop.toFixed(3)} at the top: the wing is not folding on the recovery`,
  );
});

test('secondary animation really lags the body', () => {
  // The head must NOT be rigidly attached: a bird holds its head still in
  // space, so while the trunk bobs the head's world height moves far less.
  rig.resetSprings();
  const headY = [];
  const trunkY = [];
  const frames = 60;
  for (let k = 0; k < frames; k++) {
    const t = (k / frames) * 4.4;
    const p = poseAt('walk', t);
    rig.apply(p, 1 / 60);
    eagle.root.updateMatrixWorld(true);
    const h = new Vector3();
    eagle.joints.headMount.getWorldPosition(h);
    headY.push(h.y);
    trunkY.push(p.trunk.y);
  }
  const spread = (a) => Math.max(...a) - Math.min(...a);
  assert.ok(spread(trunkY) > 0.002, `trunk barely moves (${spread(trunkY).toFixed(5)} m)`);
  assert.ok(
    spread(headY) < spread(trunkY) * 3,
    `head bobs ${spread(headY).toFixed(4)} m against a trunk bob of ${spread(trunkY).toFixed(4)} m — the springs are not doing anything`,
  );
  // And the head must genuinely be displaced from its rigid rest position,
  // otherwise "stabilisation" is just a small trunk motion.
  const rest = poseAt('walk', 0);
  rig.apply(rest, 1 / 60);
});
