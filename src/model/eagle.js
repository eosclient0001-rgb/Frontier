/**
 * Assembly of the complete Golden Eagle rig.
 *
 * Shell hierarchy (all joints are real articulation nodes):
 *
 *   eagle
 *   └ trunk .............................. hips/pelvis frame, carries tail + neck + wings
 *      ├ pygostyle ─ rectrix pivots (12)
 *      ├ neck c1..c11 ─ skull ─ {upper/lower mandible, eyes, tongue}
 *      ├ legR: hip ─ femur ─ tibiotarsus ─ tarsometatarsus ─ foot ─ 4 digits ─ talons
 *      ├ legL: (mirror)
 *      ├ wingR: shoulder ─ elbow ─ wrist ─ digit ─ p1..p10, s1..s14, alula, coverts
 *      └ wingL: (mirror)
 */

import { Group, Mesh, Quaternion, Vector3, Matrix4, DoubleSide, MeshStandardMaterial } from 'three';
import { BONES, FEATHERS, PLUMAGE, RECTRIX_LENGTHS } from '../anatomy.js';
import {
  finishMerge,
  createMergeTarget,
  makeFeather,
  pushGeometry,
  sampleCurve,
  superellipse,
  sweepPath,
} from '../lib/geometry.js';
import { DEG, TAU, clamp, lerp, smoothstep, smootherstep } from '../lib/mathx.js';
import { buildHead, buildLeg, buildNeck, buildTrunk, NECK_LENGTH, NECK_SEGMENTS } from './body.js';
import { buildWing, mirrorWing, orientFeather } from './wing.js';
import * as M from './materials.js';

/* -------------------------------------------------------------------------- */
/*  Mount points (body space: +X right, +Y up, +Z forward)                     */
/* -------------------------------------------------------------------------- */

export const MOUNTS = Object.freeze({
  /** Glenoid: top-lateral corner of the thorax. */
  shoulder: new Vector3(0.046, 0.042, 0.118),
  /** Hip joint, dorsolateral on the ilium. */
  hip: new Vector3(0.045, 0.02, -0.004),
  /** Base of the rectrices. */
  tailBase: new Vector3(0, 0.006, -0.042),
  /** Base of the neck. */
  neckBase: new Vector3(0, 0.03, 0.226),
});

/** Rest angles (degrees) that put the bird in a natural standing posture. */
export const STAND_POSE = Object.freeze({
  femurPitch: -66, // about +X; -Y rotates forward
  tibiaPitch: 96, // relative to the femur -> ~30 deg behind vertical
  tarsusPitch: -55, // relative to the tibia -> ~25 deg in front of vertical
  hipAbduct: -7, // legs slightly under the body, not straight down
  // The keel is carried well forward of the hip; the trunk leans nose-up a
  // little and the tail counterbalances.
  trunkPitch: -7,
  tailPitch: -19,
  tailSpread: 26,
});

/* -------------------------------------------------------------------------- */
/*  Materials                                                                  */
/* -------------------------------------------------------------------------- */

export function createMaterials() {
  const body = M.makeBodyMaterial();
  const flightFeather = M.makeFeatherMaterial(1.0);
  const golden = M.makeGoldenMaterial();
  const coverts = M.makeCovertMaterial();
  const underwing = M.makeUnderwingMaterial();
  const legFeather = M.makeFeatherMaterial(1.18);
  const bone = new MeshStandardMaterial({ color: 0xb9ac95, roughness: 0.6 });

  return {
    body,
    bodyFeather: body,
    wingMaterial: flightFeather,
    flightFeather,
    goldenMaterial: golden,
    napeGolden: golden,
    covertsMaterial: coverts,
    underwingMaterial: underwing,
    tailMaterial: M.makeTailMaterial(),
    tailPaleMaterial: M.makeTailPaleMaterial(),
    legFeather,
    boneMaterial: bone,
    beadMaterial: bone,
    beak: M.makeBeakMaterial(),
    cere: M.makeCereMaterial(),
    eye: M.makeEyeMaterial(),
    pupil: M.makePupilMaterial(),
    eyelid: M.makeFeatherMaterial(1.1),
    mouth: M.makeMouthMaterial(),
    tongue: M.makeTongueMaterial(),
    foot: M.makeFootMaterial(),
    talon: M.makeTalonMaterial(),
  };
}

/* -------------------------------------------------------------------------- */
/*  Tail                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Tail fan: 12 rectrices.  The outermost pair is strongly asymmetric (narrow
 * outer vane, broad inner vane) which is what lets the fan close into a
 * compact bundle when the tail is furled.
 */
export function buildTail(materials, trunkPivot) {
  const root = new Group();
  root.name = 'pygostyle';

  // Short pygostyle nub the feathers actually grow from.
  const nub = new Mesh(
    sweepPath(
      sampleCurve(
        [new Vector3(0, 0, 0), new Vector3(0, -0.004, -0.014), new Vector3(0, -0.006, -0.026)],
        6,
      ),
      (t) => ({ pts: superellipse(12, lerp(0.014, 0.007, t), lerp(0.016, 0.0075, t), 2.4) }),
      { up: new Vector3(0, 1, 0) },
    ),
    materials.body,
  );
  nub.name = 'pygostyleBody';
  root.add(nub);

  const rectrices = [];
  for (let side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const r = i + 1; // r1 central .. r6 outermost
      const len = RECTRIX_LENGTHS[i];
      // Narrow outer vane, broad inner vane — strongest on the outer pair.
      const outerVane = lerp(0.47, 0.3, i / 5);

      const geom = makeFeather({
        length: len,
        width: lerp(0.052, 0.056, i / 5),
        outerVane,
        camber: 0.02,
        sweep: 0.035,
        tipTwist: 0.03,
        tipRoundness: 0.6,
        thickness: 0.0019,
        segments: 16,
      });

      const pivot = new Group();
      pivot.name = `rectrix${side > 0 ? 'R' : 'L'}${r}`;
      // Follicles sit in a shallow arc across the pygostyle.
      pivot.position.set(side * (0.0045 * i), lerp(0.004, -0.004, i / 5), -0.02 - 0.003 * i);
      root.add(pivot);

      // Feather geometry is built for the right-hand side; the left side is a
      // true mirror.
      let mesh;
      if (side < 0) {
        const mirrored = geom.clone();
        const p = mirrored.getAttribute('position');
        const n = mirrored.getAttribute('normal');
        for (let v = 0; v < p.count; v++) {
          p.setX(v, -p.getX(v));
          n.setX(v, -n.getX(v));
        }
        const idx = mirrored.getIndex();
        for (let k = 0; k < idx.count; k += 3) {
          const t = idx.getX(k);
          idx.setX(k, idx.getX(k + 2));
          idx.setX(k + 2, t);
        }
        mirrored.computeVertexNormals();
        mesh = new Mesh(mirrored, materials.tailMaterial);
      } else {
        mesh = new Mesh(geom, materials.tailMaterial);
      }
      mesh.castShadow = true;
      mesh.name = `r${r}`;
      pivot.add(mesh);
      pivot.userData.rest = { side, index: i, length: len };
      rectrices.push({ pivot, mesh, side, index: i, length: len });
    }
  }

  // Rest orientation: fan closed, tail angled down behind the bird.
  applyTailPose(rectrices, STAND_POSE.tailSpread, STAND_POSE.tailPitch, 0);

  trunkPivot.add(root);
  return { root, rectrices };
}

const _ex = new Vector3();
const _ey = new Vector3();
const _ez = new Vector3();
const _mat = new Matrix4();

/**
 * Aim a tail feather.
 * @param {number} spread  total fan angle across the full tail, degrees
 * @param {number} pitch   tail droop/lift, degrees (+ = raised)
 * @param {number} roll    lateral roll of the whole fan, degrees
 */
export function applyTailPose(rectrices, spread, pitch, roll) {
  const halfFan = spread * 0.5;
  for (const rect of rectrices) {
    const { side, index } = rect;
    const u = index / 5;
    // The fan opens from the centre outward; the central pair barely moves.
    const fan = (halfFan * Math.pow(u, 0.85)) * side;
    const p = pitch + 6 * (1 - u) - 2;
    const f = fan * DEG;
    const pi = p * DEG;
    const rl = roll * DEG * (0.6 + 0.4 * u);

    const cp = Math.cos(pi);
    const sp = Math.sin(pi);
    // Feather axis: back and outward, pitched by `pi`.
    _ey.set(side * Math.sin(f) * cp, sp, -Math.cos(f) * cp).normalize();
    // Dorsal of the feather.
    _ez.set(0, 1, 0).addScaledVector(_ey, -sp).normalize();
    // Outer-vane side.
    _ex.copy(_ey).cross(_ez).normalize();
    // Roll about the feather's own long axis.
    if (rl) {
      const q = new Quaternion().setFromAxisAngle(_ey, rl);
      _ex.applyQuaternion(q);
      _ez.applyQuaternion(q);
    }
    _mat.makeBasis(_ex, _ey, _ez);
    rect.pivot.quaternion.setFromRotationMatrix(_mat);
  }
}

/* -------------------------------------------------------------------------- */
/*  Whole eagle                                                                */
/* -------------------------------------------------------------------------- */

export function buildEagle(options = {}) {
  const materials = options.materials ?? createMaterials();
  const root = new Group();
  root.name = 'GoldenEagle';

  /* ---- trunk ------------------------------------------------------------ */
  const trunkPivot = new Group();
  trunkPivot.name = 'trunk';
  root.add(trunkPivot);

  const { mesh: trunkMesh, geom: trunkGeom } = buildTrunk(materials.body);
  trunkPivot.add(trunkMesh);

  // Scapular feathers: the overlapping "shoulder shawl" that breaks the
  // silhouette between the body and the wing.
  const scapulars = createMergeTarget();
  {
    const mat = new Matrix4();
    for (let side of [-1, 1]) {
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 9; i++) {
          const u = i / 8;
          const z = lerp(0.155, 0.02, u) + row * 0.012;
          const x = side * lerp(0.03, 0.052, Math.sin(u * Math.PI * 0.8)) * (1 - row * 0.06);
          const y = lerp(0.05, 0.058, Math.sin(u * Math.PI)) - row * 0.008;
          const g = makeFeather({
            length: lerp(0.075, 0.105, u) * (1 - row * 0.12),
            width: lerp(0.026, 0.034, u),
            outerVane: 0.46,
            camber: 0.07,
            sweep: 0.05,
            tipRoundness: 0.65,
            thickness: 0.0016,
            segments: 8,
          });
          const p = new Group();
          p.position.set(x, y, z);
          const yaw = (side > 0 ? 1 : -1) * (18 + 30 * u) + row * 4;
          const pitch = -26 - row * 6;
          orientFeather(p, yaw, pitch, 0);
          p.updateMatrix();
          mat.compose(p.position, p.quaternion, new Vector3(1, 1, 1));
          pushGeometry(scapulars, g, mat);
          g.dispose();
        }
      }
    }
  }
  const scapularMesh = new Mesh(finishMerge(scapulars, 'scapulars'), materials.covertsMaterial);
  scapularMesh.castShadow = true;
  scapularMesh.receiveShadow = true;
  trunkPivot.add(scapularMesh);

  /* ---- neck + head ------------------------------------------------------ */
  const neck = buildNeck(materials.body);
  neck.group.position.copy(MOUNTS.neckBase);
  trunkPivot.add(neck.group);

  const head = buildHead(materials);
  // The skull rides on the last cervical through a mount node: the mount takes
  // the solved head orientation and the skull sits on it with the foramen
  // magnum (not the head's centroid) resting on the neck's tip.
  const lastCervical = neck.segments[neck.segments.length - 1];
  const headMount = new Group();
  headMount.name = 'headMount';
  headMount.position.set(0, neck.segmentLength, 0);
  lastCervical.add(headMount);
  head.group.position.set(0, 0.006, 0.035);
  headMount.add(head.group);

  /* ---- tail ------------------------------------------------------------- */
  const tail = buildTail(materials, trunkPivot);
  tail.root.position.copy(MOUNTS.tailBase);

  /* ---- legs ------------------------------------------------------------- */
  const legs = {};
  for (const side of [-1, 1]) {
    const leg = buildLeg(materials, side);
    leg.root.position.set(side * MOUNTS.hip.x, MOUNTS.hip.y, MOUNTS.hip.z);
    trunkPivot.add(leg.root);
    legs[side > 0 ? 'right' : 'left'] = leg;
  }

  /* ---- wings ------------------------------------------------------------ */
  const wingR = buildWing(materials);
  const wingRig = new Group();
  wingRig.name = 'wingRigR';
  wingRig.position.copy(MOUNTS.shoulder);
  wingRig.add(wingR.root);
  trunkPivot.add(wingRig);

  const wingL = mirrorWing(wingR);
  const wingLRig = new Group();
  wingLRig.name = 'wingRigL';
  wingLRig.position.set(-MOUNTS.shoulder.x, MOUNTS.shoulder.y, MOUNTS.shoulder.z);
  wingLRig.add(wingL.root);
  trunkPivot.add(wingLRig);

  root.userData.rig = {
    root,
    trunkPivot,
    neck,
    head,
    tail,
    legs,
    wings: { right: { rig: wingRig, ...wingR }, left: { rig: wingLRig, ...wingL } },
    materials,
    trunkGeom,
  };

  return {
    root,
    materials,
    joints: {
      trunk: trunkPivot,
      neck: neck.segments,
      headMount,
      head: head.group,
      ...head.parts,
      tail: tail.root,
      rectrices: tail.rectrices,
      legs,
      wingRight: wingR,
      wingLeft: wingL,
      wingRigRight: wingRig,
      wingRigLeft: wingLRig,
    },
    counts: {
      primaries: FEATHERS.primariesPerWing * 2,
      secondaries: FEATHERS.secondariesPerWing * 2,
      rectrices: FEATHERS.rectrices,
      alula: FEATHERS.alulaFeathers * 2,
      cervicals: NECK_SEGMENTS,
    },
    meta: { neckLength: NECK_LENGTH, bones: BONES, plumage: PLUMAGE },
  };
}

export { buildWing, mirrorWing, orientFeather };
