/**
 * Trunk, neck, head, bill, eyes and legs.
 *
 * All volumes are lofted from per-station cross-sections so the silhouette can
 * be dialled in against reference photographs, and every joint is a real
 * articulation node with anatomical limits (see anatomy.js KINEMATIC_LIMITS).
 */

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  Vector3,
} from 'three';
import { BONES, KINEMATIC_LIMITS, PLUMAGE } from '../anatomy.js';
import {
  loftRings,
  makeLens,
  makeSphericalCap,
  makeTalon,
  sampleCurve,
  superellipse,
  sweepPath,
} from '../lib/geometry.js';
import { DEG, TAU, clamp, lerp, smoothstep, smootherstep } from '../lib/mathx.js';

/** Smooth "egg" cross-section with independent dorsal / ventral radii. */
function bodySection(n, rx, rTop, rBot, e = 2.5) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const sco = Math.sign(c) * Math.pow(Math.abs(c), 2 / e);
    const ssi = Math.sign(s) * Math.pow(Math.abs(s), 2 / e);
    const blend = smoothstep(s * 0.5 + 0.5); // 0 ventral -> 1 dorsal
    const ry = lerp(rBot, rTop, blend);
    pts.push([sco * rx, ssi * ry]);
  }
  return pts;
}

/* -------------------------------------------------------------------------- */
/*  Trunk                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Trunk stations, measured in metres from the base of the tail (z = -0.035) to
 * the base of the neck (z = +0.225).  The sternum/keel region (z = 0.08-0.15)
 * is the deepest part of the body: it houses the pectoralis (up to 25 % of the
 * bird's mass) and carries the keel.
 */
export const TRUNK_STATIONS = [
  { z: -0.040, cy: 0.004, hw: 0.022, ht: 0.030, hb: 0.024 },
  { z: -0.018, cy: -0.002, hw: 0.038, ht: 0.048, hb: 0.042 },
  { z: 0.008, cy: -0.008, hw: 0.051, ht: 0.060, hb: 0.058 },
  { z: 0.042, cy: -0.012, hw: 0.059, ht: 0.068, hb: 0.070 },
  { z: 0.078, cy: -0.014, hw: 0.063, ht: 0.072, hb: 0.080 },
  { z: 0.114, cy: -0.014, hw: 0.063, ht: 0.072, hb: 0.079 },
  { z: 0.150, cy: -0.010, hw: 0.058, ht: 0.066, hb: 0.070 },
  { z: 0.184, cy: -0.001, hw: 0.048, ht: 0.054, hb: 0.054 },
  { z: 0.212, cy: 0.014, hw: 0.036, ht: 0.040, hb: 0.040 },
  { z: 0.232, cy: 0.030, hw: 0.027, ht: 0.030, hb: 0.028 },
];

/**
 * Tag a lofted part with its plumage regions.
 *
 * `region` receives a vertex's local position and returns 1 (underparts),
 * 2 (upperparts) or 3 (golden hackle), or any value between for a blend.
 * The +1 offset is deliberate: a mesh that is never tagged reads the missing
 * attribute as zero, which the material treats as "upperparts".
 */
function tagPlumage(geom, region) {
  const pos = geom.getAttribute('position');
  const plum = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    plum[i] = region(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  geom.setAttribute('aplum', new BufferAttribute(plum, 1));
  return geom;
}

export function buildTrunk(material) {
  const rings = TRUNK_STATIONS.map((s) =>
    bodySection(30, s.hw, s.ht, s.hb, 2.45).map(([x, y]) => new Vector3(x, s.cy + y, s.z)),
  );
  const geom = loftRings(rings, { capStart: true, capEnd: true });

  // Plumage regions.  The underparts are paler and warmer than the back, and
  // the hackle runs from the shoulders forward over the nape -- so the golden
  // region is the dorsal surface behind the neck, tapering out before the
  // shoulders and again at the tail.
  tagPlumage(geom, (x, y, z) => {
    const dorsal = smoothstep((y + 0.012) / 0.05);
    const nape = smoothstep((z - 0.135) / 0.075) * dorsal;
    const taper = smoothstep((z + 0.16) / 0.08);
    return 1 + dorsal + 2 * nape * taper;
  });

  const mesh = new Mesh(geom, material);
  mesh.name = 'trunk';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, geom };
}

/* -------------------------------------------------------------------------- */
/*  Neck                                                                       */
/* -------------------------------------------------------------------------- */

export const NECK_SEGMENTS = 11; // Aquila has 14 cervicals; 11 visible nodes read the same
export const NECK_LENGTH = 0.162;

/**
 * Neck construction.  Each cervical segment is its own Group so the chain can
 * be posed as a real articulated spine (birds turn the head by distributing
 * rotation over many short vertebrae, not one long one).
 */
export function buildNeck(material) {
  const group = new Group();
  group.name = 'neck';
  const segLen = NECK_LENGTH / NECK_SEGMENTS;
  const segs = [];
  let parent = group;

  for (let i = 0; i < NECK_SEGMENTS; i++) {
    const t = i / (NECK_SEGMENTS - 1);
    const g = new Group();
    g.name = `cervical${i + 1}`;
    g.position.y = i === 0 ? 0 : segLen;
    parent.add(g);

    const rings = [];
    const N = 9;
    for (let k = 0; k <= N; k++) {
      const u = k / N;
      // Neck thickness: thick at the base (that is where the syrinx and the
      // crop sit), narrowing toward the skull.
      const globalT = (i + u) / NECK_SEGMENTS;
      const r = lerp(0.030, 0.0165, smootherstep(globalT)) * (1 - 0.05 * Math.sin(globalT * Math.PI));
      const rx = r * 0.94;
      const rTop = r * 1.02;
      const rBot = r * 0.98;
      const yLocal = u * segLen - (i === 0 ? 0 : 0.02);
      rings.push(bodySection(20, rx, rTop, rBot, 2.2).map(([x, y]) => new Vector3(x, y, yLocal)));
    }
    // The neck tube runs along +Y in each segment's local frame.
    const geom = loftRings(
      rings.map((r) => r),
      { capStart: i === 0, capEnd: i === NECK_SEGMENTS - 1 },
    );
    // The nape faces backwards and the throat forwards: in a segment's local
    // frame the tube runs along +Y and its cross-section's own second axis
    // becomes local +Z, so the dorsum is -Z.
    tagPlumage(geom, (x, y, z) => 1.5 + 1.4 * smoothstep((-z + 0.005) / 0.018));
    const mesh = new Mesh(geom, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    segs.push(g);
    parent = g;
  }
  return { group, segments: segs, segmentLength: segLen };
}

/* -------------------------------------------------------------------------- */
/*  Skull, bill, eyes                                                          */
/* -------------------------------------------------------------------------- */

/** Head cross-sections along the head's +Z axis (bill points +Z). */
const HEAD_STATIONS = [
  { z: -0.040, cy: 0.008, hw: 0.012, ht: 0.014, hb: 0.012 },
  { z: -0.028, cy: 0.005, hw: 0.018, ht: 0.021, hb: 0.019 },
  { z: -0.016, cy: 0.002, hw: 0.022, ht: 0.025, hb: 0.023 },
  { z: -0.004, cy: 0.000, hw: 0.023, ht: 0.026, hb: 0.024 },
  { z: 0.008, cy: -0.001, hw: 0.022, ht: 0.025, hb: 0.023 },
  { z: 0.018, cy: -0.003, hw: 0.019, ht: 0.022, hb: 0.020 },
  { z: 0.028, cy: -0.006, hw: 0.014, ht: 0.017, hb: 0.015 },
  { z: 0.036, cy: -0.009, hw: 0.010, ht: 0.013, hb: 0.011 },
];

/** Where the eye sits in head space. */
export const EYE_POSITION = new Vector3(0.0195, 0.0055, 0.0055);

export function buildHead(materials) {
  const { body: bodyMat, beak, cere, eye, pupil, mouth, tongue } = materials;
  const group = new Group();
  group.name = 'skull';

  /* ---- cranium ---------------------------------------------------------- */
  const rings = HEAD_STATIONS.map((s) =>
    bodySection(24, s.hw, s.ht, s.hb, 2.3).map(([x, y]) => new Vector3(x, s.cy + y, s.z)),
  );
  // Crown and nape golden, lores and cheeks dark, throat pale.
  const craniumGeom = tagPlumage(loftRings(rings, { capStart: true, capEnd: false }), (x, y, z) =>
    1 + smoothstep((y + 0.004) / 0.014) + 1.5 * smoothstep((z + 0.012) / 0.026),
  );
  const cranium = new Mesh(craniumGeom, bodyMat);
  cranium.castShadow = true;
  cranium.receiveShadow = true;
  cranium.name = 'cranium';
  group.add(cranium);

  /* ---- supraorbital ridge (the eagle "brow") ---------------------------- */
  // Prominent in Aquila; it is what gives the species its glaring expression
  // and it also shields the large eye from glare.
  for (const side of [-1, 1]) {
    const controls = [
      new Vector3(side * 0.0215, 0.0145, 0.0195),
      new Vector3(side * 0.0225, 0.0165, 0.0055),
      new Vector3(side * 0.0215, 0.0155, -0.008),
      new Vector3(side * 0.017, 0.0115, -0.018),
    ];
    const path = sampleCurve(controls, 12);
    const brow = new Mesh(
      sweepPath(
        path,
        (t) => {
          const r = 0.0055 * (1 - 0.45 * t) * (0.55 + 0.45 * Math.sin(Math.PI * clamp(0.06 + t * 0.9, 0, 1)));
          return { pts: superellipse(10, r, r * 0.62, 2.4) };
        },
        { up: new Vector3(0, 1, 0) },
      ),
      bodyMat,
    );
    brow.castShadow = true;
    brow.name = `brow${side > 0 ? 'R' : 'L'}`;
    group.add(brow);
  }

  /* ---- upper mandible (the hooked, "aquiline" bill) --------------------- */
  // Culmen averages 4.5 cm with a strong terminal hook that overhangs the
  // lower mandible by ~6 mm — a diagnostic golden-eagle character.
  const upperControls = [
    new Vector3(0, -0.0075, 0.030),
    new Vector3(0, -0.0090, 0.043),
    new Vector3(0, -0.0125, 0.056),
    new Vector3(0, -0.0205, 0.0655),
    new Vector3(0, -0.0320, 0.0685),
    new Vector3(0, -0.0405, 0.0655),
  ];
  const upperPath = sampleCurve(upperControls, 22);
  const upper = new Mesh(
    sweepPath(
      upperPath,
      (t) => {
        // Height of the rostrum: deep at the base, thin at the tomia and tip.
        const h = lerp(0.0165, 0.0042, smoothstep(t)) * (1 - 0.25 * smoothstep((t - 0.72) / 0.28));
        const w = lerp(0.0135, 0.0028, smoothstep(t * 1.05));
        const pts = [];
        const N = 14;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * TAU;
          const x = Math.cos(a) * w;
          const raw = Math.sin(a);
          // Culmen ridge on top, flat tomia below.
          const y = raw > 0 ? raw * h : raw * h * 0.62;
          pts.push([x, y]);
        }
        return { pts };
      },
      { up: new Vector3(0, 1, 0) },
    ),
    beak,
  );
  upper.castShadow = true;
  upper.name = 'upperMandible';
  const upperPivot = new Group();
  upperPivot.name = 'upperMandiblePivot';
  upperPivot.add(upper);
  group.add(upperPivot);

  /* ---- lower mandible --------------------------------------------------- */
  const lowerControls = [
    new Vector3(0, -0.0175, 0.012),
    new Vector3(0, -0.0195, 0.028),
    new Vector3(0, -0.0235, 0.042),
    new Vector3(0, -0.0300, 0.052),
    new Vector3(0, -0.0360, 0.0535),
  ];
  const lowerPath = sampleCurve(lowerControls, 18);
  const lower = new Mesh(
    sweepPath(
      lowerPath,
      (t) => {
        const w = lerp(0.0130, 0.0034, smoothstep(t));
        const h = lerp(0.0090, 0.0045, smoothstep(t));
        const pts = [];
        const N = 12;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * TAU;
          const x = Math.cos(a) * w;
          const raw = Math.sin(a);
          const y = raw > 0 ? raw * h * 0.35 : raw * h;
          pts.push([x, y]);
        }
        return { pts };
      },
      { up: new Vector3(0, 1, 0) },
    ),
    beak,
  );
  lower.castShadow = true;
  lower.name = 'lowerMandible';
  const lowerPivot = new Group();
  lowerPivot.name = 'lowerMandiblePivot';
  lowerPivot.position.set(0, -0.0175, 0.012);
  lower.position.set(0, 0.0175, -0.012);
  lowerPivot.add(lower);
  group.add(lowerPivot);

  /* ---- cere ------------------------------------------------------------- */
  const cerePath = sampleCurve(
    [new Vector3(0, -0.006, 0.026), new Vector3(0, -0.0075, 0.033), new Vector3(0, -0.0085, 0.039)],
    8,
  );
  const cereMesh = new Mesh(
    sweepPath(cerePath, (t) => ({ pts: superellipse(14, lerp(0.0115, 0.0085, t), lerp(0.0135, 0.0105, t), 2.6) }), {
      up: new Vector3(0, 1, 0),
    }),
    cere,
  );
  cereMesh.name = 'cere';
  group.add(cereMesh);

  /* ---- mouth (visible when the bill opens for the screech) -------------- */
  const mouthGeom = new BufferGeometry();
  const mv = [];
  const mi = [];
  // A simple funnel from the gape to the throat; only seen during a screech.
  const mouthSections = 8;
  for (let i = 0; i <= mouthSections; i++) {
    const t = i / mouthSections;
    const z = lerp(0.030, -0.002, t);
    const w = lerp(0.016, 0.010, t);
    const h = lerp(0.014, 0.009, t);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU;
      mv.push(Math.cos(a) * w, -0.014 + Math.sin(a) * h, z);
    }
  }
  for (let i = 0; i < mouthSections; i++) {
    for (let k = 0; k < 10; k++) {
      const k1 = (k + 1) % 10;
      const a = i * 10 + k;
      const b = i * 10 + k1;
      const c = (i + 1) * 10 + k;
      const d = (i + 1) * 10 + k1;
      mi.push(a, c, b, b, c, d);
    }
  }
  mouthGeom.setAttribute('position', new BufferAttribute(new Float32Array(mv), 3));
  mouthGeom.setIndex(mi);
  mouthGeom.computeVertexNormals();
  const mouthMesh = new Mesh(mouthGeom, mouth);
  mouthMesh.name = 'mouth';
  mouthMesh.visible = false;
  group.add(mouthMesh);

  /* ---- tongue ----------------------------------------------------------- */
  const tonguePath = sampleCurve(
    [new Vector3(0, -0.019, 0.008), new Vector3(0, -0.021, 0.022), new Vector3(0, -0.024, 0.036)],
    8,
  );
  const tongueMesh = new Mesh(
    sweepPath(tonguePath, (t) => ({ pts: superellipse(10, lerp(0.0062, 0.0035, t), lerp(0.0026, 0.0012, t), 2.2) }), {
      up: new Vector3(0, 1, 0),
    }),
    tongue,
  );
  tongueMesh.name = 'tongue';
  const tonguePivot = new Group();
  tonguePivot.name = 'tonguePivot';
  tonguePivot.add(tongueMesh);
  group.add(tonguePivot);

  /* ---- eyes ------------------------------------------------------------- */
  // Raptor eyes are large and laterally placed; the fovea gives them a very
  // wide binocular overlap forward.  Anatomically the globe is ~24 mm across
  // in a 5 kg eagle; here the visible cornea is a 21 mm flattened dome.
  const eyes = {};
  for (const side of [-1, 1]) {
    const orbital = new Group();
    orbital.name = `orbital${side > 0 ? 'R' : 'L'}`;
    orbital.position.set(side * EYE_POSITION.x, EYE_POSITION.y, EYE_POSITION.z);
    // Converge slightly: the eyes aim forward-outward, not straight sideways.
    orbital.rotation.y = -side * 34 * DEG;
    orbital.rotation.z = side * -6 * DEG;

    const globe = new Mesh(makeLens(0.0108, 0.0105, 20, 8), eye);
    globe.name = 'cornea';
    globe.scale.set(1, 1, 1.25);
    orbital.add(globe);

    const iris = new Mesh(makeLens(0.0072, 0.0075, 20, 6), pupil);
    iris.position.z = 0.0062;
    iris.name = 'pupil';
    orbital.add(iris);

    // Eyelid: a spherical shell concentric with the globe.  Rotating its pivot
    // about the lateral axis sweeps it down over the cornea — a real eyelid,
    // not a decal.  Resting angle tucks it up under the brow ridge.
    const lidPivot = new Group();
    lidPivot.name = 'lidPivot';
    lidPivot.rotation.x = 0.5;
    const lid = new Mesh(makeSphericalCap(0.0116, 1.85, 22, 7), materials.eyelid);
    lid.name = 'lid';
    lid.castShadow = false;
    lidPivot.add(lid);
    orbital.add(lidPivot);
    // Lower lid: shorter sweep, hinged at the bottom.
    const lowerLidPivot = new Group();
    lowerLidPivot.name = 'lowerLidPivot';
    lowerLidPivot.rotation.x = Math.PI - 0.35;
    const lowerLid = new Mesh(makeSphericalCap(0.0116, 1.15, 22, 5), materials.eyelid);
    lowerLid.name = 'lowerLid';
    lowerLidPivot.add(lowerLid);
    orbital.add(lowerLidPivot);

    group.add(orbital);
    eyes[side > 0 ? 'right' : 'left'] = { orbital, lidPivot, lowerLidPivot, globe, iris };
  }

  return {
    group,
    parts: {
      cranium,
      upper,
      lower,
      upperPivot,
      lowerPivot,
      mouthMesh,
      tongue: tongueMesh,
      tonguePivot,
      cereMesh,
      eyes,
      eyeRight: eyes.right,
      eyeLeft: eyes.left,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Legs                                                                       */
/* -------------------------------------------------------------------------- */

const TOE_CONFIG = [
  // Digit I is the hallux: it points backward and carries the largest talon.
  { name: 'hallux', digit: 1, bone: BONES.hallux, yaw: 180, spread: 0, talon: 0.052, talonR: 0.0075 },
  { name: 'toe2', digit: 2, bone: BONES.toe2, yaw: -38, spread: -8, talon: 0.040, talonR: 0.0062 },
  { name: 'toe3', digit: 3, bone: BONES.toe3, yaw: 0, spread: 0, talon: 0.045, talonR: 0.0068 },
  { name: 'toe4', digit: 4, bone: BONES.toe4, yaw: 38, spread: 8, talon: 0.036, talonR: 0.0058 },
];

/**
 * One leg.  The chain is femur -> tibiotarsus -> tarsometatarsus -> foot, all
 * pointing along -Y in their local frames so the animator can drive them with
 * a simple (pitch, roll, twist) convention.
 */
export function buildLeg(materials, side) {
  const { legFeather: featherMat, foot, talon } = materials;
  const root = new Group();
  root.name = `leg${side > 0 ? 'R' : 'L'}`;

  const joints = {};
  // Each segment hangs from its *proximal* joint -- the joint it rotates
  // about -- and its mesh runs from that origin down the bone to the next
  // joint.  Anchoring segments at their distal ends instead (the obvious
  // reading of "place the group a bone-length below its parent") puts the
  // pivot at the wrong end, and then rotating a segment swings its children
  // about the wrong point: the whole chain stops being a chain, the sole
  // stops being a fixed distance below the intertarsal joint, and no amount
  // of iterating the ground solve can converge.
  const makeSegment = (name, length, parent, offsetY, radiusTop, radiusBot, material) => {
    const g = new Group();
    g.name = name;
    g.position.y = offsetY;
    parent.add(g);
    const rings = [];
    const N = 6;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const r = lerp(radiusTop, radiusBot, t);
      const y = -t * length + (name === 'femur' ? 0 : 0.012);
      rings.push(superellipse(14, r, r * 1.05, 2.4).map(([x, z]) => new Vector3(x, y, z)));
    }
    const mesh = new Mesh(loftRings(rings, { capStart: false, capEnd: false }), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return g;
  };

  // The femur is short and buried; the visible leg column is the feathered
  // tibiotarsus + tarsometatarsus.  Golden eagles are feathered to the toes.
  joints.hip = new Group();
  joints.hip.name = 'hip';
  root.add(joints.hip);
  joints.knee = makeSegment('femur', BONES.femur, joints.hip, 0, 0.033, 0.026, featherMat);
  joints.ankle = makeSegment(
    'tibiotarsus',
    BONES.tibiotarsus,
    joints.knee,
    -BONES.femur,
    0.0255,
    0.0175,
    featherMat,
  );
  joints.hock = makeSegment(
    'tarsometatarsus',
    BONES.tarsometatarsus,
    joints.ankle,
    -BONES.tibiotarsus,
    0.0175,
    0.0118,
    featherMat,
  );

  // Foot: metatarsal pad + 4 toes, hung off the distal end of the tarso-
  // metatarsus -- which is the pivot the foot actually rolls about.
  const footBase = new Group();
  footBase.name = 'foot';
  footBase.position.y = -BONES.tarsometatarsus;
  joints.hock.add(footBase);
  joints.foot = footBase;

  const pad = new Mesh(
    sweepPath(
      sampleCurve([new Vector3(0, 0, 0), new Vector3(0, -0.010, 0.006), new Vector3(0, -0.020, 0.006)], 6),
      (t) => ({ pts: superellipse(14, lerp(0.0135, 0.0145, t), lerp(0.017, 0.020, t), 2.6) }),
      { up: new Vector3(0, 1, 0) },
    ),
    foot,
  );
  pad.name = 'pad';
  pad.castShadow = true;
  footBase.add(pad);

  const toes = {};
  for (const cfg of TOE_CONFIG) {
    const pivot = new Group();
    pivot.name = cfg.name;
    pivot.rotation.y = cfg.yaw * DEG;
    pivot.position.y = -0.018;
    footBase.add(pivot);

    // Toes arch: birds walk on the pads of the proximal phalanges, so each
    // digit has a characteristic upward arch before the talon curls down.
    const segs = cfg.digit === 1 ? 3 : 4;
    const controls = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const drop = cfg.digit === 1 ? -0.012 : -0.016;
      const arch = Math.sin(t * Math.PI) * (cfg.digit === 1 ? 0.004 : 0.0055);
      controls.push(
        new Vector3(
          Math.sin(cfg.spread * DEG) * cfg.bone * t * 0.35,
          drop * t + arch,
          cfg.bone * t * (cfg.digit === 1 ? -1 : 1),
        ),
      );
    }
    const path = sampleCurve(controls, 16);
    const toe = new Mesh(
      sweepPath(
        path,
        (t) => {
          const r = lerp(0.0085, 0.0042, smoothstep(t));
          return { pts: superellipse(12, r, r * 1.06, 2.3) };
        },
        { up: new Vector3(0, 1, 0) },
      ),
      foot,
    );
    toe.castShadow = true;
    pivot.add(toe);

    // Knuckle bulges.
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const p = path[Math.round(t * (path.length - 1))];
      const knuckle = new Mesh(
        makeLens(lerp(0.0088, 0.0052, t), lerp(0.0065, 0.0042, t), 12, 6),
        foot,
      );
      knuckle.position.copy(p);
      knuckle.scale.set(1, 1.15, 0.9);
      pivot.add(knuckle);
    }

    // Talon.
    const tip = path[path.length - 1].clone();
    const talonMesh = new Mesh(makeTalon(cfg.talon, cfg.talonR, 0.62 + (cfg.digit === 1 ? 0.16 : 0)), talon);
    talonMesh.position.copy(tip);
    talonMesh.rotation.x = 0;
    if (cfg.digit === 1) talonMesh.rotation.y = Math.PI;
    talonMesh.castShadow = true;
    pivot.add(talonMesh);

    toes[cfg.name] = pivot;
  }

  return { root, joints, toes, footBase };
}


