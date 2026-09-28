/**
 * The wing: skeleton, propatagium, and all 24 flight feathers plus the covert
 * rows that shingle over their bases.
 *
 * PLANFORM DERIVATION
 * -------------------
 * Published measurements pin the planform down, and this file is built so the
 * generated feather layout reproduces them:
 *
 *   wingspan          2.122 m   [Lish et al.: adult female mean]
 *   single wing area  0.2963 m2 [Lish et al.: wing loading 0.86 g/cm2 at
 *                                5097 g is mass / (2 x area)]
 *   arm bones         0.1925 + 0.2132 + 0.1046 m [Trail 2017; RBCM osteology]
 *   primaries         10 / wing, 0.41 - 0.56 m [Trail 2014]
 *   secondaries       14 / wing, up to 0.356 m [Trail 2014]
 *
 * None of the feather lengths is a free parameter:
 *
 *   1. The glenoid sits 0.046 m lateral of the midline, so the tip of the
 *      outermost primary must land 1.015 m outboard of it (= 2.122 / 2).
 *   2. Primary 10 is rooted at the distal end of the major digit, whose tip is
 *      0.1413 m outboard of the wrist.  With its quill fanned 11 deg back from
 *      the wing axis, its total length follows from (1).
 *   3. The other nine primaries are scaled by the measured within-wing length
 *      gradient, from 0.70 of primary 10 at the innermost to 1.00 at the tip.
 *      That gradient is not cosmetic: it is what carries the trailing edge
 *      smoothly across the wrist, where the chord jumps from the secondaries
 *      to the primaries.
 *   4. The 14 secondaries fan between 76 deg and 108 deg so that the innermost
 *      one closes the wing's trailing edge against the body and the outermost
 *      one meets primary 1; their lengths peak at the middle of the row, which
 *      bows the arm-wing trailing edge convexly, exactly as in the photographs.
 *
 * `test/planform.test.js` re-measures the span and the area off the built
 * geometry rather than trusting any of the arithmetic above.
 */

import { Group, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { BONES } from '../anatomy.js';
import {
  createMergeTarget,
  finishMerge,
  loftRings,
  makeFeather,
  pushGeometry,
  sampleCurve,
  superellipse,
  sweepPath,
} from '../lib/geometry.js';
import { DEG, TAU, clamp, lerp, smoothstep, smootherstep } from '../lib/mathx.js';

/* -------------------------------------------------------------------------- */
/*  Layout constants                                                           */
/* -------------------------------------------------------------------------- */

/* --- derived geometry ---------------------------------------------------- */
const GLENOID_X = 0.046;
/** Wingspan / 2, as measured from the midline. */
const HALF_SPAN = 1.061;
/** The outermost primary's tip must land this far outboard of the glenoid. */
const TARGET_TIP_X = HALF_SPAN - GLENOID_X; // 1.015
const WRIST_X = BONES.humerus + BONES.ulna; // 0.4057
/** Carpometacarpus + both phalanges of the major digit. */
const HAND_LEN = BONES.carpometacarpus + BONES.phalanxMajor1 + BONES.phalanxMajor2; // 0.1413

const P10_SWEEP = 11;
const P10_TILT = 1.5;
/** p1 / p10 length ratio; sets the trailing-edge continuity across the wrist. */
const PRIMARY_RATIO_IN = 0.7;

/** Fraction of the hand (wrist -> digit tip) at which primary i is rooted. */
const primesHandFrac = (i) => 0.04 + 0.9 * Math.pow(i / 9, 1.05);
/** Root of primary i, measured outboard from the glenoid. */
export const primesFollicleX = (i) => WRIST_X + HAND_LEN * primesHandFrac(i);

const P10_FOLLICLE_X = primesFollicleX(9);
const PRIMARY_LENGTH_OUT =
  (TARGET_TIP_X - P10_FOLLICLE_X) /
  (Math.cos(P10_SWEEP * DEG) * Math.cos(P10_TILT * DEG));
const PRIMARY_LENGTH_IN = PRIMARY_LENGTH_OUT * PRIMARY_RATIO_IN;

export const WING_LAYOUT = Object.freeze({
  humerusEnd: BONES.humerus, // 0.1925
  ulnaEnd: BONES.humerus + BONES.ulna, // 0.4057
  handEnd: BONES.humerus + BONES.ulna + BONES.carpometacarpus, // 0.5103
  digitEnd: WRIST_X + HAND_LEN, // 0.5470

  /** Flight-feather quills sit along the posterior edge of the arm and hand. */
  follicleZ: -0.006,
  /** Distance from the midline to the glenoid. */
  glenoidX: GLENOID_X,
  /** Measured wingspan this model must reproduce. */
  targetSpan: HALF_SPAN * 2,
  /** Outboard distance from the glenoid to the wing tip. */
  targetTip: TARGET_TIP_X,

  // Primaries.  Sweep is measured in the wing plane from +X; positive sweeps
  // the tip toward the trailing edge (-Z).  The innermost primary lies almost
  // along the trailing edge, the outermost points almost straight outboard.
  primarySweepIn: 74, // p1
  primarySweepOut: P10_SWEEP, // p10
  primarySweepBias: 1.25, // >1 packs the inner quills and spreads the fingers
  primaryLengthIn: PRIMARY_LENGTH_IN,
  primaryLengthOut: PRIMARY_LENGTH_OUT,

  // Secondaries, from the ulna.  s1 meets the primaries at the wrist, s14
  // (the innermost tertial) closes the trailing edge against the body.
  secondarySweepOut: 76, // s1, adjacent to the primaries
  secondarySweepIn: 108, // s14, innermost tertial
  secondaryLength: 0.334,
  secondaryLengthMid: 0.356, // the published maximum for eagle secondaries

  /**
   * Leading edge in the wing plane: [x, z].  It is derived, not drawn — it is
   * the line where the wing's soft tissue ends, and it always sits a little
   * forward of the quill line, by the local thickness of the leading-edge
   * tissue (0.064 m at the shoulder, 0.010 m at the tip).
   */
  leadingEdge: [
    [0.0, 0.058],
    [0.09, 0.05],
    [0.19, 0.044],
    [0.3, 0.03],
    [0.406, 0.016],
    [0.55, 0.011],
    [0.75, 0.008],
    [0.9, 0.006],
    [1.015, 0.004],
  ],

  /**
   * Covert rows.  Every row shingles over the base of one remex and the rows
   * tile the strip between the quill line and the leading edge, which is what
   * makes the wing a solid surface rather than a fan of feathers.  `reach` is
   * the fraction of that strip at which the row is anchored, so the rows
   * follow the wing's planform automatically; `len` is the row's length as a
   * fraction of its parent remex.
   */
  covertRows: [
    { name: 'greater', base: 0.03, reach: 0.16, len: 0.46, count: 4, pitch: 8 },
    { name: 'median', base: 0.02, reach: 0.42, len: 0.32, count: 4, pitch: 16 },
    { name: 'lesser', base: 0.012, reach: 0.66, len: 0.2, count: 3, pitch: 24 },
    { name: 'marginal', base: 0.008, reach: 0.88, len: 0.13, count: 3, pitch: 32 },
  ],
  underwingRow: { name: 'under', base: 0.02, reach: 0.3, len: 0.34, count: 4, pitch: -8 },

  dihedral: 4.5, // degrees of leading-edge-up washout across the wing
  camber: 0.016, // metres of dorsal bow at mid-chord
});

const L = WING_LAYOUT;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Change of basis mapping a feather's local frame
 * (+X leading vane, +Y distal, +Z dorsal) into the wing frame
 * (+X outboard, +Y dorsal, +Z forward).
 */
const qM0 = (() => {
  const m = new Matrix4().makeBasis(
    new Vector3(0, 0, 1),
    new Vector3(1, 0, 0),
    new Vector3(0, 1, 0),
  );
  return new Quaternion().setFromRotationMatrix(m);
})();

const _qy = new Quaternion();
const _qx = new Quaternion();
const _qtw = new Quaternion();
const _yAxis = new Vector3(0, 1, 0);
const _xAxis = new Vector3(1, 0, 0);

/**
 * Aim a feather pivot.
 * @param {Group} pivot
 * @param {number} phi   fan angle in the wing plane (deg, + = swept back)
 * @param {number} tilt  out-of-plane pitch (deg, + = leading edge up)
 * @param {number} twist roll about the feather's own rachis (deg)
 */
export function orientFeather(pivot, phi, tilt = 0, twist = 0) {
  _qy.setFromAxisAngle(_yAxis, phi * DEG);
  _qx.setFromAxisAngle(_xAxis, tilt * DEG);
  _qy.multiply(_qx);
  _qy.multiply(qM0);
  if (twist) {
    _qtw.setFromAxisAngle(_yAxis, twist * DEG);
    _qy.multiply(_qtw);
  }
  pivot.quaternion.copy(_qy);
  pivot.userData.restQuaternion = _qy.clone();
  return pivot;
}

const P_COUNT = 10;
const S_COUNT = 14;

function edgeCurve(points) {
  return sampleCurve(
    points.map(([x, z]) => new Vector3(x, 0, z)),
    80,
  );
}

function edgeAt(curve, x) {
  let i = 0;
  while (i < curve.length - 2 && curve[i + 1].x < x) i++;
  const a = curve[i];
  const b = curve[Math.min(i + 1, curve.length - 1)];
  const t = b.x === a.x ? 0 : clamp((x - a.x) / (b.x - a.x), 0, 1);
  return lerp(a.z, b.z, t);
}

/**
 * The wing's real leading edge, measured off the built geometry.
 *
 * Inboard of the wrist it is the propatagium (soft tissue).  Outboard it is
 * the *leading vanes of the primaries* — there is no separate structure there,
 * which is why the hand wing's outline has to be measured rather than drawn.
 * Returns a [x, z] table sampled every `step` metres.
 */
function leadingEnvelope(meshes, x0, x1, step = 0.01) {
  const n = Math.max(2, Math.round((x1 - x0) / step) + 1);
  const top = new Float64Array(n).fill(-Infinity);
  const v = new Vector3();
  for (const mesh of meshes) {
    if (!mesh) continue;
    mesh.updateWorldMatrix(true, false);
    const p = mesh.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      const k = Math.round((v.x - x0) / step);
      if (k >= 0 && k < n && v.z > top[k]) top[k] = v.z;
    }
  }
  // Interpolate across any bin that no mesh sampled.
  let lo = 0;
  while (lo < n && top[lo] === -Infinity) lo++;
  if (lo === n) return [{ x: x0, z: 0 }, { x: x1, z: 0 }];
  for (let k = 0; k < lo; k++) top[k] = top[lo];
  for (let k = lo; k < n; k++) {
    if (top[k] !== -Infinity) continue;
    let hi = k;
    while (hi < n && top[hi] === -Infinity) hi++;
    const a = top[k - 1] ?? top[lo];
    const b = hi < n ? top[hi] : a;
    for (let m = k; m < hi; m++) top[m] = lerp(a, b, (m - k + 1) / (hi - k + 1));
    k = hi - 1;
  }
  // Same {x, z} shape as the curves edgeAt() reads, so both are interchangeable.
  const table = [];
  for (let k = 0; k < n; k++) table.push({ x: x0 + k * step, z: top[k] });
  return table;
}

function boneMesh(material, length, rTop, rBot, flatten = 0.8) {
  const path = sampleCurve(
    [
      new Vector3(0, 0, 0),
      new Vector3(length * 0.33, 0.004, 0),
      new Vector3(length * 0.66, 0.003, 0),
      new Vector3(length, 0, 0),
    ],
    12,
  );
  return new Mesh(
    sweepPath(
      path,
      (t) => {
        const r =
          lerp(rTop, rBot, smoothstep(t)) *
          (0.82 + 0.18 * Math.sin(Math.PI * clamp(0.08 + t * 0.84, 0, 1)));
        return { pts: superellipse(12, r, r * flatten, 2.3) };
      },
      { up: new Vector3(0, 0, 1), capStart: false, capEnd: false },
    ),
    material,
  );
}

/** Secondary j: rooting point, fan angle and quill length. */
function secondarySpec(j) {
  const u = j / (S_COUNT - 1);
  return {
    u,
    x: 0.402 + (0.148 - 0.402) * Math.pow(u, 1.0),
    z: L.follicleZ + 0.005 * Math.sin(u * Math.PI) - 0.002 * u,
    phi: lerp(L.secondarySweepOut, L.secondarySweepIn, Math.pow(u, 0.9)),
    length: L.secondaryLength + (L.secondaryLengthMid - L.secondaryLength) * Math.sin(u * Math.PI),
  };
}

/* -------------------------------------------------------------------------- */
/*  Wing build                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Build the right wing in the wing frame: +X outboard, +Y dorsal, +Z forward.
 * The caller mounts it at the glenoid.
 */
export function buildWing(materials) {
  const { wingMaterial, covertsMaterial, body: bodyMat, underwingMaterial, boneMaterial } =
    materials;

  const root = new Group();
  root.name = 'wing';

  /* ---- joint chain ------------------------------------------------------ */
  const shoulder = new Group();
  shoulder.name = 'shoulder';
  root.add(shoulder);

  const humerus = boneMesh(boneMaterial, BONES.humerus, 0.0175, 0.0115);
  humerus.name = 'humerus';
  shoulder.add(humerus);

  const elbow = new Group();
  elbow.name = 'elbow';
  elbow.position.x = BONES.humerus;
  shoulder.add(elbow);

  const forearm = boneMesh(boneMaterial, BONES.ulna, 0.0115, 0.0084);
  forearm.name = 'ulna';
  elbow.add(forearm);

  const wrist = new Group();
  wrist.name = 'wrist';
  wrist.position.x = BONES.ulna;
  elbow.add(wrist);

  const hand = boneMesh(boneMaterial, BONES.carpometacarpus, 0.0092, 0.0055);
  hand.name = 'carpometacarpus';
  wrist.add(hand);

  const digit = new Group();
  digit.name = 'digit';
  digit.position.x = BONES.carpometacarpus;
  wrist.add(digit);

  // The two phalanges of the major digit, which carry the outer primaries.
  const phalanx = boneMesh(
    boneMaterial,
    BONES.phalanxMajor1 + BONES.phalanxMajor2,
    0.0052,
    0.0032,
    0.7,
  );
  phalanx.name = 'phalanges';
  digit.add(phalanx);

  /* ---- propatagium ------------------------------------------------------ */
  // The propatagium spans shoulder -> wrist along the leading edge and folds
  // at the elbow exactly like the real membrane, so it is built in two halves:
  // one rigid in the humerus frame, one in the forearm frame.
  const leCurve = edgeCurve(L.leadingEdge);
  /**
   * One half of the propatagium.  `xOrigin` is where that half starts in the
   * wing frame; the leading-edge curve is always sampled in the wing frame,
   * never in the joint's local frame, or the membrane slides forward of the
   * wing as soon as the joint is not at the origin.
   */
  const buildPatagium = (xOrigin, span, segments, thickness, depth) => {
    const rings = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const local = lerp(0, span, t);
      const z = edgeAt(leCurve, xOrigin + local);
      const k = smoothstep(t);
      const th = lerp(thickness[0], thickness[1], k);
      const dp = lerp(depth[0], depth[1], k);
      const camber = L.camber * Math.sin(Math.PI * clamp(t * 0.8 + 0.15, 0, 1));
      const ring = [];
      for (let s = 0; s < 14; s++) {
        const a = (s / 14) * TAU;
        const cz = Math.cos(a);
        const cy = Math.sin(a);
        ring.push(
          new Vector3(local, cy * th + camber * 0.3, z - dp * 0.5 + cz * dp * 0.5),
        );
      }
      rings.push(ring);
    }
    return new Mesh(loftRings(rings, { capStart: true, capEnd: true }), bodyMat);
  };

  const patagiumDistal = buildPatagium(0, BONES.humerus, 14, [0.013, 0.0075], [0.052, 0.036]);
  patagiumDistal.name = 'propatagiumProx';
  patagiumDistal.castShadow = true;
  patagiumDistal.receiveShadow = true;
  shoulder.add(patagiumDistal);

  // Built in the elbow's frame, which already carries the humerus offset.
  const patagiumForearm = buildPatagium(BONES.humerus, BONES.ulna, 14, [0.0075, 0.0052], [0.036, 0.026]);
  patagiumForearm.name = 'propatagiumDist';
  patagiumForearm.castShadow = true;
  patagiumForearm.receiveShadow = true;
  elbow.add(patagiumForearm);

  /* ---- primaries -------------------------------------------------------- */
  const primaries = [];
  for (let i = 0; i < P_COUNT; i++) {
    const u = i / (P_COUNT - 1);
    const f = primesHandFrac(i);
    // The quill lies along the posterior edge of the hand.  `fx` is expressed
    // in the digit's frame (which starts at the end of the carpometacarpus);
    // `anchorX` is the same point in the wing's own frame, which is what the
    // covert rows and the planform maths need.
    const anchorX = primesFollicleX(i);
    const fx = anchorX - WRIST_X - BONES.carpometacarpus;
    const fz = L.follicleZ - 0.004 * u;

    const phi = lerp(L.primarySweepIn, L.primarySweepOut, Math.pow(u, L.primarySweepBias));
    const len = lerp(L.primaryLengthIn, L.primaryLengthOut, Math.pow(u, 0.92));

    // Outer primaries are emarginated (notched) on the outer vane, producing
    // the slotted "fingers" of a soaring eagle's wingtip.
    const emarg = i >= 3 ? lerp(0.14, 0.46, (i - 3) / (P_COUNT - 4)) : 0;
    const geom = makeFeather({
      length: len,
      width: lerp(0.058, 0.048, u),
      outerVane: lerp(0.34, 0.3, u),
      emarginate: emarg,
      emarginateAt: lerp(0.58, 0.44, u),
      innerNotch: 0.06,
      camber: 0.05,
      sweep: 0.055,
      tipTwist: 0.22 + 0.16 * u,
      tipRoundness: lerp(0.42, 0.26, u),
      thickness: 0.0021,
      segments: 22,
    });

    const pivot = new Group();
    pivot.name = `primary${i + 1}`;
    pivot.position.set(fx, 0, fz);
    orientFeather(pivot, phi, 0.6 + 1.2 * u, 3 - 9 * u);
    const mesh = new Mesh(geom, wingMaterial);
    mesh.castShadow = true;
    mesh.name = `p${i + 1}`;
    pivot.add(mesh);
    // The hand's flight feathers must stay rigid with the hand bone.
    digit.add(pivot);
    primaries.push({ pivot, mesh, index: i, length: len, phi, fx: anchorX, fz });
  }

  /* ---- secondaries ------------------------------------------------------ */
  const secondaries = [];
  for (let j = 0; j < S_COUNT; j++) {
    const spec = secondarySpec(j);
    const geom = makeFeather({
      length: spec.length,
      width: 0.052,
      outerVane: 0.44, // rounded, near-symmetric vanes
      emarginate: 0,
      camber: 0.03,
      sweep: 0.03,
      tipTwist: 0.06,
      tipRoundness: 0.55,
      thickness: 0.0019,
      segments: 18,
    });

    const pivot = new Group();
    pivot.name = `secondary${j + 1}`;
    pivot.userData.remexIndex = j;
    pivot.position.set(spec.x - BONES.humerus, 0, spec.z); // in the forearm frame
    orientFeather(pivot, spec.phi, 0.2, 1.5);
    const mesh = new Mesh(geom, wingMaterial);
    mesh.castShadow = true;
    mesh.name = `s${j + 1}`;
    pivot.add(mesh);
    elbow.add(pivot);
    secondaries.push({
      pivot,
      mesh,
      index: j,
      length: spec.length,
      phi: spec.phi,
      fx: spec.x,
      fz: spec.z,
    });
  }

  /* ---- alula ------------------------------------------------------------ */
  // Three feathers on the alular digit (the avian "thumb").  At high angles of
  // attack they peel away from the leading edge and re-energise the boundary
  // layer over the hand, exactly like an aircraft leading-edge slat.
  const alula = [];
  for (let k = 0; k < 3; k++) {
    const u = k / 2;
    const geom = makeFeather({
      length: lerp(0.088, 0.12, u),
      width: lerp(0.021, 0.024, u),
      outerVane: 0.44,
      camber: 0.04,
      sweep: 0.02,
      tipRoundness: 0.62,
      thickness: 0.0014,
      segments: 12,
    });
    const pivot = new Group();
    pivot.name = `alula${k + 1}`;
    // Rooted on the leading edge just proximal of the wrist, lying almost
    // flush with it.  Deploying it (rotating the pivot forward) is what makes
    // the slat, so the rest angle must not already stick out into the airflow.
    pivot.position.set(-0.016 - 0.012 * u, 0.006 + 0.002 * u, 0.015 + 0.003 * u);
    orientFeather(pivot, 9 + 7 * u, 5, 4);
    const mesh = new Mesh(geom, wingMaterial);
    mesh.castShadow = true;
    pivot.add(mesh);
    wrist.add(pivot);
    alula.push({ pivot, mesh });
  }

  /* ---- coverts ---------------------------------------------------------- */
  // Four dorsal rows plus an underwing row, each shingled over the proximal
  // part of its parent remex.  They are merged into four meshes whose anchors
  // sit on the joints that own the underlying feathers, so they fold with the
  // wing instead of shearing off it.
  const anchors = {
    armDorsal: new Group(),
    armVentral: new Group(),
    handDorsal: new Group(),
    handVentral: new Group(),
  };
  for (const key of Object.keys(anchors)) {
    const isArm = key.startsWith('arm');
    const host = isArm ? elbow : wrist;
    const offset = isArm ? BONES.humerus : BONES.humerus + BONES.ulna;
    anchors[key].position.x = -offset;
    anchors[key].name = key;
    host.add(anchors[key]);
  }

  const targets = {
    armDorsal: createMergeTarget(),
    armVentral: createMergeTarget(),
    handDorsal: createMergeTarget(),
    handVentral: createMergeTarget(),
  };

  const mat4 = new Matrix4();
  // Measure the leading edge the wing actually has, then use it to place the
  // coverts: they must tile the strip between the quill line and that edge and
  // must never poke out in front of it.
  const leMeasured = leadingEnvelope(
    [patagiumDistal, patagiumForearm, ...primaries.map((f) => f.mesh), ...secondaries.map((f) => f.mesh)],
    0,
    L.targetTip + 0.01,
    0.01,
  );
  /**
   * Width of the strip between a remex's quill and the leading edge: the
   * surface the covert rows have to fill at that station.
   */
  const stripWidth = (x) => clamp(edgeAt(leMeasured, x) - L.follicleZ, 0.004, 0.16);

  const addCovert = (parent, row, k, target, dorsal) => {
    const { base, reach, len, count, pitch } = row;
    const phi = parent.phi;
    const dir = new Vector3(Math.cos(phi * DEG), 0, -Math.sin(phi * DEG));

    // A little deterministic jitter so rows do not line up into stripes.
    const h = (n) => ((parent.index * 7 + k * 13 + row.name.length * 5 + n * 3) % 11) / 11 - 0.5;
    const t = clamp(base + (k - (count - 1) * 0.5) * 0.055 + h(1) * 0.03, 0, 0.85);

    const W = stripWidth(parent.fx);
    // Coverts step forward across the strip along the chord, not along the
    // remex's own normal, so each row tracks the leading edge independently.
    const fwd = W * clamp(reach + h(2) * 0.07, 0.02, 0.97);

    // Position in the wing root frame.
    const bx = parent.fx + dir.x * t * parent.length;
    const bz = parent.fz + dir.z * t * parent.length + fwd;

    // A covert must reach back over the narrow base of its parent remex and
    // forward across the strip, so it is the greater of the two requirements.
    const cLen = Math.max(parent.length * len, W * 1.1);
    const cWidth = clamp(Math.max(parent.length * 0.16 + 0.012, W * 0.34), 0.016, 0.05);
    const g = makeFeather({
      length: cLen,
      width: cWidth,
      outerVane: 0.46,
      camber: 0.06,
      sweep: 0.04,
      tipRoundness: 0.62,
      thickness: 0.0017,
      segments: 8,
    });
    const pivot = new Group();
    pivot.position.set(bx, dorsal ? 0.008 + 0.002 * k : -0.0065 - 0.0012 * k, bz);
    // Each row fans a little further forward than the one beneath it, exactly
    // as the rows do on a real wing.
    orientFeather(pivot, phi - pitch * 0.55, pitch, 0);
    pivot.updateMatrix();
    mat4.compose(pivot.position, pivot.quaternion, new Vector3(1, 1, 1));
    pushGeometry(targets[target], g, mat4);
    g.dispose();
  };

  // Every parent feather carries its own index and wing-frame anchor so the
  // covert rows can be laid out relative to it.
  for (const f of [...primaries, ...secondaries]) {
    f.pivotWingX = f.fx;
    f.pivotWingZ = f.fz;
  }

  for (const row of L.covertRows) {
    for (let i = 0; i < primaries.length; i++)
      for (let k = 0; k < row.count; k++) addCovert(primaries[i], row, k, 'handDorsal', true);
    for (let j = 0; j < secondaries.length; j++)
      for (let k = 0; k < row.count; k++) addCovert(secondaries[j], row, k, 'armDorsal', true);
  }
  for (let j = 0; j < secondaries.length; j++)
    for (let k = 0; k < L.underwingRow.count; k++)
      addCovert(secondaries[j], L.underwingRow, k, 'armVentral', false);
  for (let i = 0; i < primaries.length; i++)
    for (let k = 0; k < 3; k++)
      addCovert(primaries[i], L.underwingRow, k, 'handVentral', false);

  const covertMeshes = {};
  for (const key of Object.keys(targets)) {
    const isVentral = key.endsWith('Ventral');
    const mesh = new Mesh(
      finishMerge(targets[key], key),
      isVentral ? underwingMaterial : covertsMaterial,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    anchors[key].add(mesh);
    covertMeshes[key] = mesh;
  }

  return {
    root,
    joints: { shoulder, elbow, wrist, digit },
    primaries,
    secondaries,
    alula,
    anchors,
    meshes: {
      humerus,
      forearm,
      hand,
      phalanx,
      patagiumDistal,
      patagiumForearm,
      ...covertMeshes,
    },
    planform: { leCurve },
  };
}

/* -------------------------------------------------------------------------- */
/*  Mirroring                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Mirror a geometry across x = 0, repairing winding and normals so the left
 * wing is a true mirror without a negative scale (which would break face
 * culling and invert the shading).
 */
export function mirrorGeometryX(geom) {
  const g = geom.clone();
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    p.setX(i, -p.getX(i));
    if (n) n.setX(i, -n.getX(i));
  }
  p.needsUpdate = true;
  if (n) n.needsUpdate = true;
  const idx = g.getIndex();
  if (idx) {
    const arr = idx.array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i];
      arr[i] = arr[i + 2];
      arr[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
  g.computeBoundingSphere();
  return g;
}

/**
 * Clone a built wing as its mirror image: geometry mirrored, x offsets
 * negated, and rest quaternions converted to their mirrored equivalents
 * (q -> (qx, -qy, -qz, qw) is the mirror of a rotation across x = 0).
 */
export function mirrorWing(wing) {
  const cloneNode = (node) => {
    const copy = new Group();
    copy.name = node.name;
    copy.position.set(-node.position.x, node.position.y, node.position.z);
    if (node.userData?.restQuaternion) {
      const q = node.userData.restQuaternion;
      copy.userData.restQuaternion = new Quaternion(q.x, -q.y, -q.z, q.w);
      copy.quaternion.copy(copy.userData.restQuaternion);
    } else {
      copy.quaternion.copy(node.quaternion);
      if (node.userData) copy.userData = { ...node.userData };
    }
    if (node.isMesh) {
      copy.isMesh = true;
      copy.geometry = mirrorGeometryX(node.geometry);
      copy.material = node.material;
      copy.castShadow = node.castShadow;
      copy.receiveShadow = node.receiveShadow;
    }
    for (const child of node.children) copy.add(cloneNode(child));
    return copy;
  };

  const root = cloneNode(wing.root);
  const find = (name) => {
    let found = null;
    root.traverse((o) => {
      if (o.name === name && !found) found = o;
    });
    return found;
  };
  const collect = (prefix, n, field) => {
    const out = [];
    for (let i = 1; i <= n; i++) {
      const g = find(`${prefix}${i}`);
      if (g) out.push({ pivot: g, mesh: g.children[0], index: i - 1, ...(field ?? {}) });
    }
    return out;
  };
  const primaries = collect('primary', 10);
  const secondaries = collect('secondary', 14);
  for (let i = 0; i < primaries.length; i++) Object.assign(primaries[i], pickRest(wing.primaries[i]));
  for (let j = 0; j < secondaries.length; j++)
    Object.assign(secondaries[j], pickRest(wing.secondaries[j]));

  const meshes = {};
  for (const key of ['humerus', 'forearm', 'hand', 'phalanx', 'patagiumDistal', 'patagiumForearm']) {
    const g = find(key === 'forearm' ? 'ulna' : key === 'hand' ? 'carpometacarpus' : key);
    if (g) meshes[key] = g;
  }
  for (const key of ['armDorsal', 'armVentral', 'handDorsal', 'handVentral']) {
    const a = find(key);
    if (a) meshes[key] = a.children[0];
  }

  return {
    root,
    joints: {
      shoulder: find('shoulder'),
      elbow: find('elbow'),
      wrist: find('wrist'),
      digit: find('digit'),
    },
    primaries,
    secondaries,
    alula: collect('alula', 3),
    anchors: {
      armDorsal: find('armDorsal'),
      armVentral: find('armVentral'),
      handDorsal: find('handDorsal'),
      handVentral: find('handVentral'),
    },
    meshes,
  };
}

const pickRest = (entry) => ({ length: entry.length, phi: entry.phi });
