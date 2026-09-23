/**
 * skull.js — Tyrannosaurus rex cranium + mandible (FMNH PR 2081 "Sue").
 *
 * Reference measurements (Brochu 2003; Franoys skeletal table):
 *   premaxilla → posteroventral quadrate   1.46 m
 *   premaxilla → occipital condyle         1.30 m
 *   width across the temporal region       0.945 m
 *   mandibular ramus                       1.437 m
 *   teeth per side: 4 premaxillary · 12 maxillary · 14 dentary
 *
 * Construction
 *   The lateral wall is a single lateral-view outline with the real openings
 *   cut through it as holes: external naris, maxillary fenestra, antorbital
 *   fenestra, the keyhole-shaped orbit and the lateral temporal fenestra.
 *   The extruded wall is then bent into the skull's wedge shape (narrow
 *   snout, 94.5 cm wide cheeks; walls leaning in towards the roof) and
 *   mirrored.  The roof (nasals → frontals → parietals) is a top-view outline
 *   with the two supratemporal fenestrae and sagittal crest, draped over the
 *   dorsal profile.  Occiput, braincase, paroccipital processes and palate
 *   fill in the inside you can see through the openings.
 *
 * Frame: origin at the OCCIPITAL CONDYLE.  -Z anterior, +Y dorsal, +X right.
 * Outlines are authored as [anterior, dorsal] pairs in metres.
 */

import { Group, Mesh, Vector3, Shape, Path, ExtrudeGeometry } from 'three';
import {
  mergeGeoms, tubeGeometry, toothGeometry, ellipsoidGeom, transformGeom,
  roughenGeometry, mirrorX, smoothNormals, subdivideGeometry, lateralPlate, DEG,
} from './geo.js';
import { SPEC } from './spec.js';

const T = SPEC.skull.teethPerSide;
const JAW_JOINT = [-0.15, -0.40];       // [ant, dor] — quadrate condyle

/* ------------------------------------------------------------ outlines */

// Outer lateral profile, clockwise from the snout tip.
const CRANIUM = [
  [1.300, -0.060], [1.300, 0.030], [1.275, 0.090], [1.220, 0.125],          // premaxilla
  [1.100, 0.150], [0.960, 0.180], [0.820, 0.205], [0.700, 0.225],           // nasal ridge (rugose)
  [0.650, 0.262], [0.600, 0.283], [0.555, 0.262],                           // lacrimal horn
  [0.500, 0.245], [0.450, 0.258],                                           // over the orbit
  [0.400, 0.292], [0.345, 0.300],                                           // postorbital boss
  [0.230, 0.300], [0.100, 0.305], [-0.020, 0.285], [-0.110, 0.240],         // parietal / squamosal
  [-0.160, 0.160], [-0.180, 0.040], [-0.170, -0.120],                       // squamosal → quadratojugal
  [-0.185, -0.300], [-0.170, -0.400], [-0.110, -0.410],                     // quadrate condyle
  [-0.030, -0.365], [0.080, -0.320], [0.180, -0.300],                       // jugal (ventral inflection)
  [0.280, -0.318], [0.380, -0.338],
  [0.520, -0.355], [0.680, -0.372], [0.850, -0.372], [1.000, -0.350],       // maxillary tooth row (convex)
  [1.120, -0.305], [1.200, -0.250], [1.265, -0.175],                        // premaxillary tooth row
];

const HOLES = {
  naris: [[1.255, 0.075], [1.215, 0.100], [1.140, 0.098], [1.110, 0.070], [1.150, 0.052], [1.225, 0.052]],
  maxillaryFenestra: [[0.975, 0.020], [0.945, 0.055], [0.900, 0.050], [0.885, 0.005], [0.915, -0.030], [0.960, -0.020]],
  antorbital: [
    [0.860, 0.050], [0.820, 0.120], [0.745, 0.160], [0.665, 0.150], [0.615, 0.100],
    [0.595, 0.010], [0.605, -0.090], [0.650, -0.160], [0.730, -0.180], [0.800, -0.130], [0.845, -0.040],
  ],
  // keyhole orbit: round dorsal chamber for the eye, narrow ventral slot
  orbit: [
    [0.530, 0.180], [0.515, 0.222], [0.475, 0.235], [0.440, 0.215], [0.425, 0.170],
    [0.438, 0.120], [0.460, 0.080], [0.466, 0.010], [0.478, -0.075], [0.492, -0.010],
    [0.505, 0.080], [0.525, 0.130],
  ],
  lateralTemporal: [
    [0.345, 0.205], [0.300, 0.235], [0.210, 0.235], [0.130, 0.200], [0.060, 0.120],
    [0.050, 0.030], [0.090, -0.010], [0.035, -0.080], [0.010, -0.170], [0.060, -0.210],
    [0.160, -0.160], [0.260, -0.080], [0.320, 0.030], [0.350, 0.130],
  ],
};

// Mandible, relative to the jaw joint: [forward, up]
const MANDIBLE = [
  [-0.110, 0.010], [-0.030, 0.050], [0.080, 0.090], [0.220, 0.130], [0.320, 0.135],
  [0.440, 0.080], [0.560, 0.045], [0.700, 0.040], [0.900, 0.045], [1.100, 0.060],
  [1.260, 0.065], [1.345, 0.040], [1.360, -0.030], [1.330, -0.120], [1.230, -0.170],
  [1.050, -0.200], [0.850, -0.240], [0.620, -0.290], [0.420, -0.305], [0.250, -0.270],
  [0.110, -0.190], [0.000, -0.110], [-0.080, -0.060],
];
const MANDIBLE_HOLES = {
  externalMandibular: [[0.420, 0.010], [0.330, 0.050], [0.220, 0.030], [0.180, -0.040], [0.240, -0.110], [0.360, -0.110], [0.425, -0.060]],
  surangularForamen: [[0.130, 0.040], [0.105, 0.055], [0.085, 0.040], [0.105, 0.025]],
};

/* --------------------------------------------------------------- shape */

/** Half-width of the cranium at an anterior station (inner wall surface). */
function halfWidth(ant) {
  const K = [[-0.19, 0.415], [0.00, 0.43], [0.15, 0.415], [0.35, 0.33], [0.55, 0.23], [0.80, 0.165], [1.05, 0.135], [1.30, 0.095]];
  if (ant <= K[0][0]) return K[0][1];
  for (let i = 0; i < K.length - 1; i++) {
    if (ant <= K[i + 1][0]) {
      const t = (ant - K[i][0]) / (K[i + 1][0] - K[i][0]);
      return K[i][1] + (K[i + 1][1] - K[i][1]) * t * t * (3 - 2 * t);
    }
  }
  return K[K.length - 1][1];
}

/** Walls lean inward towards the roof (inverted-U cross section). */
function taper(dor) {
  const u = Math.min(1, Math.max(0, (dor + 0.05) / 0.36));
  return 1 - 0.40 * Math.pow(u, 1.6);
}

/** Dorsal profile height (m) at an anterior station — for draping the roof. */
function roofY(ant) {
  const top = CRANIUM.slice(3, 19);            // the dorsal edge points, anterior → posterior
  for (let i = 0; i < top.length - 1; i++) {
    const [a0, y0] = top[i], [a1, y1] = top[i + 1];
    if ((ant <= a0 && ant >= a1)) return y0 + (y1 - y0) * ((ant - a0) / (a1 - a0));
  }
  return ant > top[0][0] ? top[0][1] : top[top.length - 1][1];
}

function shapeWithHoles(outline, holes) {
  const s = new Shape();
  s.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) s.lineTo(outline[i][0], outline[i][1]);
  s.closePath();
  for (const h of holes) {
    const p = new Path();
    // holes must wind opposite to the outer contour
    const pts = h.slice().reverse();
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
    p.closePath();
    s.holes.push(p);
  }
  return s;
}

/**
 * Extrude a lateral outline and bend it into a curved wall.
 * lateral(ant, dor) gives the inner-surface distance from the midline.
 */
function bentWall(outline, holes, thickness, lateral, bevel, maxEdge = 0.05) {
  const shape = shapeWithHoles(outline, holes);
  let g = new ExtrudeGeometry(shape, {
    depth: thickness - 2 * bevel, bevelEnabled: true, bevelThickness: bevel,
    bevelSize: bevel * 0.9, bevelSegments: 3, curveSegments: 4,
  });
  g.translate(0, 0, bevel);
  g = subdivideGeometry(g, maxEdge);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const ant = p.getX(i), dor = p.getY(i), z = p.getZ(i);
    // body frame: X = lateral (right), Y = dorsal, Z = -anterior
    p.setXYZ(i, lateral(ant, dor) + z, dor, -ant);
  }
  // lateral frame x→-Z, y→Y, z→X is a reflection → flip winding
  flipWinding(g);
  smoothNormals(g);
  return g;
}

function flipWinding(g) {
  for (const name of ['position', 'uv']) {
    const a = g.attributes[name];
    if (!a) continue;
    const arr = a.array, c = a.itemSize;
    for (let i = 0; i + 2 < a.count; i += 3) {
      for (let k = 0; k < c; k++) {
        const x = (i + 1) * c + k, y = (i + 2) * c + k;
        const t = arr[x]; arr[x] = arr[y]; arr[y] = t;
      }
    }
  }
}

function both(g) {
  return mergeGeoms([g, mirrorX(g)]);
}

/* ================================================================ skull */

export function buildSkull(mats) {
  const group = new Group();
  group.name = 'skull';
  const parts = [];

  // ---- lateral walls (premaxilla, maxilla, nasal flank, lacrimal, jugal,
  //      postorbital, squamosal, quadratojugal as one sutured sheet)
  const wallT = 0.07;
  const lateral = (ant, dor) => halfWidth(ant) * taper(dor);
  const wall = bentWall(CRANIUM, Object.values(HOLES), wallT, lateral, 0.018, 0.045);
  parts.push(both(wall));

  // ---- bosses & horns that stick out of the wall
  const boss = (ant, dor, r, out = 0.02) => {
    const x = lateral(ant, dor) + wallT + out;
    return both(transformGeom(ellipsoidGeom(r[0], r[1], r[2], 12), { pos: [x, dor, -ant] }));
  };
  parts.push(boss(0.60, 0.255, [0.045, 0.038, 0.065]));           // lacrimal horn
  parts.push(boss(0.375, 0.262, [0.050, 0.042, 0.060]));          // postorbital boss
  parts.push(boss(0.26, -0.245, [0.040, 0.045, 0.085], 0.0));     // jugal horn / cornual process
  // nasal rugosities along the snout ridge
  for (let k = 0; k < 7; k++) {
    const a = 0.74 + k * 0.075;
    parts.push(transformGeom(ellipsoidGeom(0.075, 0.018, 0.04, 8), { pos: [0, roofY(a) + 0.012, -a] }));
  }

  // ---- skull roof: nasals · frontals · parietals, supratemporal fenestrae
  {
    const R = [
      [1.27, 0.0], [1.22, 0.075], [1.00, 0.085], [0.74, 0.10], [0.62, 0.16], [0.52, 0.22],
      [0.42, 0.25], [0.30, 0.27], [0.12, 0.27], [-0.02, 0.26], [-0.13, 0.19], [-0.15, 0.0],
    ];
    const outline = [...R, ...R.slice(1, -1).reverse().map(([a, l]) => [a, -l])];
    const holes = [];
    for (const s of [1, -1]) {
      const h = [];
      for (let k = 0; k < 14; k++) {
        const th = (k / 14) * Math.PI * 2;
        h.push([0.16 + 0.155 * Math.cos(th), s * (0.135 + 0.075 * Math.sin(th))]);
      }
      if (s < 0) h.reverse();
      holes.push(h);
    }
    const shape = shapeWithHoles(outline, holes.map((h) => h));
    let g = new ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2, curveSegments: 4 });
    g = subdivideGeometry(g, 0.05);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const ant = p.getX(i), lat = p.getY(i), z = p.getZ(i);
      const w = Math.abs(lat);
      // roof arches: highest at the midline, dropping to meet the walls
      const y = roofY(ant) - 0.045 - 0.25 * w * w + z;
      p.setXYZ(i, lat, y, -ant);
    }
    smoothNormals(g);
    parts.push(g);
    // sagittal crest between the supratemporal fenestrae
    parts.push(tubeGeometry(
      [new Vector3(0, roofY(0.34) - 0.02, -0.34), new Vector3(0, roofY(0.16) + 0.01, -0.16), new Vector3(0, roofY(-0.02) + 0.01, 0.02)],
      [[0.018, 0.04], [0.016, 0.05], [0.02, 0.05]], { radialSegments: 8, up0: new Vector3(1, 0, 0) }
    ));
  }

  // ---- occiput + braincase + paroccipital processes + condyle
  parts.push(lateralPlate([
    [-0.02, 0.29], [-0.10, 0.27], [-0.14, 0.12], [-0.12, -0.06], [-0.04, -0.12], [0.06, -0.08], [0.06, 0.18],
  ], 0.30, { centered: true, bevel: 0.03 }));
  parts.push(transformGeom(ellipsoidGeom(0.11, 0.13, 0.16, 16), { pos: [0, 0.02, -0.12] }));
  for (const s of [1, -1]) {
    const pp = tubeGeometry(
      [new Vector3(0.05 * s, 0.07, 0.04), new Vector3(0.20 * s, 0.13, 0.08), new Vector3(0.36 * s, 0.14, 0.11)],
      [[0.05, 0.035], [0.04, 0.03], [0.035, 0.03]], { radialSegments: 8, up0: new Vector3(0, 1, 0) }
    );
    parts.push(pp);
  }
  parts.push(transformGeom(ellipsoidGeom(0.05, 0.05, 0.05, 12), { pos: [0, 0, 0.03] }));   // occipital condyle
  // quadrate shafts (inside the cheek, down to the jaw joint)
  for (const s of [1, -1]) {
    parts.push(tubeGeometry(
      [new Vector3(s * 0.30, 0.12, 0.10), new Vector3(s * 0.36, -0.15, 0.14), new Vector3(s * 0.39, -0.39, 0.15)],
      [0.045, 0.04, 0.06], { radialSegments: 8, up0: new Vector3(0, 0, 1) }
    ));
  }

  // ---- palate: pterygoids, palatines, vomer (seen through the fenestrae)
  {
    const pal = [[1.16, -0.19], [1.00, -0.21], [0.80, -0.22], [0.55, -0.20], [0.30, -0.15], [0.10, -0.10], [0.10, -0.16], [0.35, -0.23], [0.60, -0.27], [0.85, -0.285], [1.10, -0.25]];
    for (const s of [1, -1]) {
      const g = lateralPlate(pal, 0.035, { lat: 0, bevel: 0.008 });
      g.translate(s * 0.07, 0, 0);
      parts.push(g);
    }
    // ectopterygoid braces from palate to jugal
    for (const s of [1, -1]) {
      parts.push(tubeGeometry(
        [new Vector3(s * 0.09, -0.19, -0.48), new Vector3(s * 0.20, -0.22, -0.42), new Vector3(s * lateral(0.38, -0.24), -0.25, -0.38)],
        [0.04, 0.035, 0.03], { radialSegments: 7, up0: new Vector3(0, 1, 0) }
      ));
    }
  }

  const skullGeom = mergeGeoms(parts);
  roughenGeometry(skullGeom, 0.0035, 11, 3.1);
  const skullMesh = new Mesh(skullGeom, mats.bone);
  skullMesh.castShadow = true;
  skullMesh.name = 'skullBones';
  group.add(skullMesh);

  /* ------------------------------------------------------------ upper teeth */
  const teeth = new Group();
  teeth.name = 'teeth';
  const upper = [];
  // premaxillary teeth: small, D-shaped in cross-section, tightly packed
  for (let i = 0; i < T.premaxilla; i++) {
    const a = 1.255 - i * 0.034;
    const dor = -0.19 - i * 0.025;
    const len = 0.075 + i * 0.006;
    for (const s of [1, -1]) {
      const g = toothGeometry({ length: len, base: len * 0.40, thick: len * 0.40, curve: 6 });
      upper.push(transformGeom(g, { pos: [s * (lateral(a, dor) + wallT * 0.35), dor + 0.015, -a] }));
    }
  }
  // maxillary teeth: the famous "killer bananas" — largest under the
  // antorbital fenestra (crowns ~12-15 cm exposed in Sue)
  for (let i = 0; i < T.maxilla; i++) {
    const u = i / (T.maxilla - 1);
    const a = 1.085 - u * 0.58;
    // follow the convex tooth row
    let dor = -0.372;
    for (let k = 29; k < CRANIUM.length - 1; k++) {
      const [a0, y0] = CRANIUM[k], [a1, y1] = CRANIUM[k + 1];
      if ((a >= a0 && a <= a1) || (a <= a0 && a >= a1)) { dor = y0 + (y1 - y0) * ((a - a0) / (a1 - a0)); break; }
    }
    const len = 0.085 + 0.065 * Math.sin(Math.PI * Math.min(1, 0.15 + u * 1.05)) - 0.03 * u;
    for (const s of [1, -1]) {
      const g = toothGeometry({ length: len, base: len * 0.42, thick: len * 0.30, curve: 11 });
      upper.push(transformGeom(g, { pos: [s * (lateral(a, dor) + wallT * 0.45), dor + 0.02, -a] }));
    }
  }
  const upperTeeth = new Mesh(mergeGeoms(upper), mats.tooth);
  upperTeeth.castShadow = true;
  upperTeeth.name = 'teeth';
  teeth.add(upperTeeth);
  group.add(teeth);

  /* --------------------------------------------------------------- mandible */
  const jaw = new Group();
  jaw.name = 'mandible';
  const jawT = 0.06;
  // lower jaw sits just inside the upper tooth row, so the upper teeth
  // overlap the dentary laterally when the mouth is closed
  const jawLat = (fwd, up) => {
    const ant = fwd + JAW_JOINT[0];
    return Math.max(0.05, halfWidth(ant) * 0.98 - 0.085 + 0.01 * up);
  };
  const jParts = [];
  const jwall = bentWall(MANDIBLE, Object.values(MANDIBLE_HOLES), jawT, jawLat, 0.016, 0.045);
  jParts.push(both(jwall));
  // retroarticular process + articular glenoid
  for (const s of [1, -1]) {
    jParts.push(transformGeom(ellipsoidGeom(0.06, 0.05, 0.07, 10), { pos: [s * (jawLat(0, 0) + 0.03), 0.0, 0.02] }));
  }
  // symphysis at the chin
  jParts.push(tubeGeometry(
    [new Vector3(-jawLat(1.3, -0.05) - 0.02, -0.05, -1.31), new Vector3(0, -0.07, -1.345), new Vector3(jawLat(1.3, -0.05) + 0.02, -0.05, -1.31)],
    [0.04, 0.045, 0.04], { radialSegments: 8, up0: new Vector3(0, 1, 0) }
  ));
  const jawGeom = mergeGeoms(jParts);
  roughenGeometry(jawGeom, 0.0035, 12, 7.7);
  const jawMesh = new Mesh(jawGeom, mats.bone);
  jawMesh.castShadow = true;
  jawMesh.name = 'mandibleBones';
  jaw.add(jawMesh);

  // dentary teeth (14 per side), pointing up
  const lower = [];
  for (let i = 0; i < T.dentary; i++) {
    const u = i / (T.dentary - 1);
    const f = 1.30 - u * 0.66;
    let up = 0.045;
    for (let k = 5; k < 12; k++) {
      const [a0, y0] = MANDIBLE[k], [a1, y1] = MANDIBLE[k + 1];
      if (f >= a0 && f <= a1) { up = y0 + (y1 - y0) * ((f - a0) / (a1 - a0)); break; }
    }
    const len = 0.070 + 0.060 * Math.sin(Math.PI * Math.min(1, 0.1 + u * 1.1));
    for (const s of [1, -1]) {
      const g = toothGeometry({ length: len, base: len * 0.40, thick: len * 0.30, curve: 10 });
      g.rotateZ(Math.PI);                         // point up; recurve stays posterior
      lower.push(transformGeom(g, { pos: [s * (jawLat(f, up) + jawT * 0.5), up - 0.02, -f] }));
    }
  }
  const lowerTeeth = new Mesh(mergeGeoms(lower), mats.tooth);
  lowerTeeth.castShadow = true;
  lowerTeeth.name = 'teeth';
  jaw.add(lowerTeeth);

  const jawJoint = new Vector3(0, JAW_JOINT[1], -JAW_JOINT[0]);
  jaw.position.copy(jawJoint);
  group.add(jaw);

  return {
    group, jaw, jawJoint,
    skullLength: SPEC.skull.length,
    skullWidth: SPEC.skull.width,
    snoutTip: new Vector3(0, -0.02, -1.30),
  };
}
