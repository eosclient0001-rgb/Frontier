/**
 * skeleton.js — Builds the complete articulated T. rex skeleton + rig.
 *
 * Hierarchy
 *   rig (ground point under the hips; translates + yaws in the world)
 *   ├─ pelvis   (origin = acetabulum)  ilium · pubis · ischium · sacrum
 *   │   ├─ trunk chain  D13 → D1  (each dorsal carries its rib pair)
 *   │   │     └─ pectoral girdle + forelimbs on D2
 *   │   │     └─ neck chain C10 → C1 → head → mandible
 *   │   └─ tail chain  Ca1 → Ca47  (with chevrons)
 *   ├─ leg.L / leg.R  femur · tibia+fibula · metatarsus · digits I-IV
 *       (flat — posed every frame by the IK solver in rig space)
 *
 * Joint-local frame for every axial joint:
 *   +X = right, +Y = along the column towards the head, +Z = dorsal.
 */

import { Group, Object3D, Mesh, Vector3, Quaternion, Matrix4 } from 'three';
import {
  mergeGeoms, lateralPlate, longBone, vertebraGeometry, tubeGeometry,
  toothGeometry, ellipsoidGeom, transformGeom, roughenGeometry, mirrorX, DEG,
} from './geo.js';
import { SPEC, buildAxialLayout, profileAt } from './spec.js';
import { buildSkull } from './skull.js';

/* ------------------------------------------------------------ constants */

export const LEG = {
  hipLateral: 0.36,                        // femoral shaft top; head sits medially at ~0.22
  footLateral: 0.26,                       // narrow theropod trackway gauge
  femur: SPEC.hindlimb.femur,              // 1.321
  tibia: SPEC.hindlimb.tibiotarsus,        // 1.245
  metatarsus: SPEC.hindlimb.metatarsalIII, // 0.671
  padHeight: 0.07,                         // MTP joint above the ground
};

// phalanges per digit (formula 2-3-4-5-x); lengths in m, last = ungual claw
export const DIGITS = {
  I:   { lengths: [0.10, 0.075], splay: -34, base: [-0.085, 0.36], width: 0.030 },
  II:  { lengths: [0.175, 0.125, 0.125], splay: -21, base: [-0.068, 0.0], width: 0.052 },
  III: { lengths: [0.19, 0.14, 0.10, 0.125], splay: 0, base: [0.0, -0.025], width: 0.060 },
  IV:  { lengths: [0.13, 0.09, 0.07, 0.05, 0.10], splay: 23, base: [0.07, 0.0], width: 0.048 },
};

const _m = new Matrix4();
const _q = new Quaternion();

/* --------------------------------------------------------------- utils */

function meshOf(geom, mat, name, info) {
  const m = new Mesh(geom, mat);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = false;
  m.userData.bone = info || { name };
  return m;
}

/** basis → quaternion for the axial frame: X right, Y = dir, Z = dorsal. */
function axialQuat(dir) {
  const y = dir.clone().normalize();
  const x = new Vector3(1, 0, 0);
  const z = new Vector3().crossVectors(x, y).normalize();
  _m.makeBasis(x, y, z);
  return new Quaternion().setFromRotationMatrix(_m);
}

/** Make `child` (with a desired pelvis-frame matrix) a child of `parent`. */
function attach(parent, child, pos, quat, parentWorld) {
  const M = new Matrix4().compose(pos, quat, new Vector3(1, 1, 1));
  const L = parentWorld.clone().invert().multiply(M);
  L.decompose(child.position, child.quaternion, child.scale);
  child.userData.restQuat = child.quaternion.clone();
  child.userData.restPos = child.position.clone();
  parent.add(child);
  return M;
}

/* ================================================================ build */

export function buildSkeleton(mats) {
  const rig = new Group();
  rig.name = 'rig';

  const pelvis = new Object3D();
  pelvis.name = 'pelvis';
  pelvis.position.set(0, SPEC.stance.acetabulumHeight, 0);
  rig.add(pelvis);

  const layout = buildAxialLayout();
  const bones = [];              // every mesh with userData.bone (for picking)
  const reg = (m) => (bones.push(m), m);

  /* --------------------------------------------------------- pelvic girdle */
  buildPelvicGirdle(pelvis, mats, reg);

  /* -------------------------------------------------------------- sacrum */
  const sacrals = layout.items.filter((it) => it.series === 'sacral');
  for (const it of sacrals) {
    const [hw, hd] = profileAt('sacral', it.index);
    const g = vertebraGeometry({
      length: it.length * 1.02, centrumHeight: 0.19, centrumWidth: 0.17,
      spineHeight: 0.24, spineLength: it.length * 1.02, spineThickness: 0.05,
      transverseLength: 0.19, transverseRise: 0.08,
    });
    roughenGeometry(g, 0.003, 14, it.index);
    const holder = new Object3D();
    holder.position.copy(it.a);
    holder.quaternion.copy(axialQuat(it.dir));
    holder.add(reg(meshOf(g, mats.bone, `Sacral ${it.index}`, {
      name: `Sacral vertebra S${it.index}`, detail: 'fused sacrum (5), pneumatised', length: it.length,
    })));
    pelvis.add(holder);
  }
  // fused supraneural plate over the sacrum
  {
    const s1 = sacrals[sacrals.length - 1], s5 = sacrals[0];
    const pts = [s5.a.clone(), s1.b.clone()].map((p) => p.add(new Vector3(0, 0.33, 0)));
    const g = tubeGeometry(pts, [[0.035, 0.05], [0.035, 0.05]], { radialSegments: 8, up0: new Vector3(0, 1, 0) });
    pelvis.add(reg(meshOf(g, mats.bone, 'Sacral supraneural', { name: 'Fused sacral neural spines' })));
  }

  /* --------------------------------------------------------- trunk chain */
  const pelvisWorld = new Matrix4();   // pelvis frame = identity for layout
  const dorsals = layout.items.filter((it) => it.series === 'dorsal'); // D13..D1
  const trunk = [];
  let parent = pelvis, parentM = pelvisWorld;
  for (const it of dorsals) {
    const j = new Object3D();
    j.name = `D${it.index}`;
    const M = attach(parent, j, it.a, axialQuat(it.dir), parentM);
    const [hw, hd, hv] = profileAt('dorsal', it.index);
    const spineH = 0.30 + 0.10 * Math.sin((Math.PI * (it.index - 1)) / 12);
    const g = vertebraGeometry({
      length: it.length, centrumHeight: 0.19 - 0.02 * (it.index / 13), centrumWidth: 0.165,
      spineHeight: spineH, spineLength: it.length * 0.78, spineThickness: 0.045,
      spineRake: -4 + it.index * 0.6, transverseLength: 0.24 - 0.004 * it.index, transverseRise: 0.10,
    });
    roughenGeometry(g, 0.003, 14, it.index + 20);
    j.add(reg(meshOf(g, mats.bone, `Dorsal ${it.index}`, {
      name: `Dorsal vertebra D${it.index}`, detail: `centrum ${(it.length * 100).toFixed(1)} cm, spine ${(spineH * 100).toFixed(0)} cm`, length: it.length,
    })));
    // --- rib pair
    const rib = buildRibPair(it, hw, hd, hv);
    if (rib) j.add(reg(meshOf(rib.geom, mats.bone, `Rib pair ${it.index}`, {
      name: `Dorsal rib pair ${it.index}`, detail: `arc length ${(rib.length * 100).toFixed(1)} cm`, length: rib.length,
    })));
    trunk.push(j);
    parent = j; parentM = M;
  }
  const trunkEndM = parentM;

  /* --------------------------------------------------------- gastralia */
  {
    const d8 = trunk[dorsals.findIndex((d) => d.index === 8)];
    const g = buildGastralia(layout);
    const holder = new Object3D();
    const pm = new Matrix4();
    // express in D8's frame: build pelvis-frame geometry, then transform
    let acc = new Matrix4();
    let node = d8; const chain = [];
    while (node && node !== pelvis) { chain.unshift(node); node = node.parent; }
    for (const n of chain) { n.updateMatrix(); acc.multiply(n.matrix); }
    g.applyMatrix4(acc.clone().invert());
    d8.add(reg(meshOf(g, mats.bone, 'Gastralia', {
      name: 'Gastralia (belly ribs)', detail: `${SPEC.gastraliaPairs} pairs, segmented`,
    })));
  }

  /* ---------------------------------------------------- pectoral + arms */
  const d2Index = dorsals.findIndex((d) => d.index === 2);
  const d2 = trunk[d2Index];
  const d2M = matrixInPelvis(d2, pelvis);
  const arms = buildPectoral(d2, d2M, mats, reg);

  /* ----------------------------------------------------------- neck */
  const cervicals = layout.items.filter((it) => it.series === 'cervical'); // C10..C1
  const neck = [];
  parent = trunk[trunk.length - 1]; parentM = trunkEndM;
  for (const it of cervicals) {
    const j = new Object3D();
    j.name = `C${it.index}`;
    const M = attach(parent, j, it.a, axialQuat(it.dir), parentM);
    const [hw] = profileAt('cervical', it.index);
    const g = vertebraGeometry({
      length: it.length, centrumHeight: 0.16 - (10 - it.index) * 0.002, centrumWidth: 0.185,
      spineHeight: it.index <= 2 ? 0.10 : 0.16 - 0.004 * it.index, spineLength: it.length * 0.7,
      spineThickness: 0.05, spineRake: 8, transverseLength: 0.13 + 0.005 * it.index,
      transverseRise: -0.02, transverseSweep: 0.05,
    });
    // cervical ribs: short, posteriorly directed
    const cr = [];
    if (it.index >= 3) {
      for (const s of [1, -1]) {
        cr.push(tubeGeometry(
          [new Vector3(s * 0.12, it.length * 0.4, -0.06), new Vector3(s * 0.16, -it.length * 0.4, -0.11), new Vector3(s * 0.15, -it.length * 1.05, -0.13)],
          [0.022, 0.016, 0.007], { radialSegments: 6, up0: new Vector3(0, 0, 1) }
        ));
      }
    }
    const merged = mergeGeoms([g, ...cr]);
    roughenGeometry(merged, 0.003, 14, it.index + 60);
    j.add(reg(meshOf(merged, mats.bone, `Cervical ${it.index}`, {
      name: it.index === 1 ? 'Atlas (C1)' : it.index === 2 ? 'Axis (C2)' : `Cervical vertebra C${it.index}`,
      detail: `centrum ${(it.length * 100).toFixed(1)} cm`, length: it.length,
    })));
    neck.push(j);
    parent = j; parentM = M;
  }

  /* ----------------------------------------------------------- head */
  const atlas = cervicals[cervicals.length - 1];
  const head = new Object3D();
  head.name = 'head';
  const headPitch = -6 * DEG; // skull held near horizontal, snout slightly down
  const headQ = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), headPitch);
  attach(parent, head, atlas.b.clone().add(atlas.dir.clone().multiplyScalar(0.03)), headQ, parentM);
  const skull = buildSkull(mats);
  head.add(skull.group);
  skull.group.traverse((o) => {
    if (o.isMesh) {
      o.userData.bone = o.parent && o.parent.name === 'mandible'
        ? { name: 'Mandible', detail: `dentary · splenial · surangular · angular · articular — ramus ${SPEC.skull.mandibleRamus} m` }
        : { name: 'Skull (cranium)', detail: `${SPEC.skull.length} m long, ${SPEC.skull.width} m wide, ~58 teeth` };
      if (o.material === mats.tooth) o.userData.bone = { name: 'Teeth', detail: '4 premaxillary · 12 maxillary · 14 dentary per side' };
      bones.push(o);
    }
  });

  /* ----------------------------------------------------------- tail */
  const caudals = layout.items.filter((it) => it.series === 'caudal').reverse(); // Ca1..Ca47
  const tail = [];
  parent = pelvis; parentM = pelvisWorld;
  for (const it of caudals) {
    const j = new Object3D();
    j.name = `Ca${it.index}`;
    const M = attach(parent, j, it.b, axialQuat(it.dir), parentM);
    const u = (it.index - 1) / (SPEC.counts.caudal - 1);
    const size = it.length / 0.26;
    const g = vertebraGeometry({
      length: it.length, centrumHeight: Math.max(0.028, 0.20 * Math.pow(1 - u, 0.9) + 0.02),
      centrumWidth: Math.max(0.024, 0.17 * Math.pow(1 - u, 0.9) + 0.018),
      spineHeight: it.index < 34 ? 0.30 * Math.pow(1 - it.index / 34, 1.2) + 0.02 : 0,
      spineLength: it.length * 0.6, spineThickness: Math.max(0.012, 0.04 * (1 - u)),
      spineRake: 28, transverseLength: it.index <= 16 ? 0.24 * (1 - it.index / 17) + 0.03 : 0,
      transverseSweep: 0.04, chevronHeight: it.index >= 2 && it.index < 38 ? 0.46 * Math.pow(1 - it.index / 38, 1.15) : 0,
      radialSegments: it.index > 30 ? 8 : 10, centrumSamples: it.index > 30 ? 6 : 9,
    });
    g.translate(0, -it.length, 0);
    if (it.index < 30) roughenGeometry(g, 0.0025 * size + 0.001, 16, it.index + 90);
    j.add(reg(meshOf(g, mats.bone, `Caudal ${it.index}`, {
      name: `Caudal vertebra Ca${it.index}`, detail: `centrum ${(it.length * 100).toFixed(1)} cm${it.index >= 2 && it.index < 38 ? ', with chevron' : ''}`, length: it.length,
    })));
    tail.push(j);
    parent = j; parentM = M;
  }

  /* ----------------------------------------------------------- legs */
  const legs = { L: buildLeg(-1, mats, reg), R: buildLeg(1, mats, reg) };
  rig.add(legs.L.group, legs.R.group);

  /* -------------------------------------------------------- summary */
  return {
    rig, pelvis, trunk, neck, head, jaw: skull.jaw, tail, legs, arms, bones, layout,
    skull,
    measurements: {
      axialLength: layout.axialLength,
      totalLength: layout.tailTipPos.z - (layout.atlasAnterior.z - SPEC.skull.length * Math.cos(headPitch)),
    },
  };
}

function matrixInPelvis(node, pelvis) {
  const acc = new Matrix4();
  const chain = [];
  let n = node;
  while (n && n !== pelvis) { chain.unshift(n); n = n.parent; }
  for (const c of chain) { c.updateMatrix(); acc.multiply(c.matrix); }
  return acc;
}

/* ============================================================ ribs */

/**
 * A pair of dorsal ribs authored in the vertebra's local frame
 * (x right, y anterior, z dorsal). Arc lengths follow the published
 * longest-rib value (147.8 cm) at D5-D6, shorter fore and aft.
 */
function buildRibPair(it, hw, hd, hv) {
  const i = it.index;
  // target rib length profile (m)
  const L = [0, 0.78, 1.10, 1.34, 1.45, 1.478, 1.46, 1.40, 1.30, 1.16, 1.00, 0.82, 0.62, 0.42][i];
  if (!L) return null;
  const parts = [];
  let arc = 0;
  for (const s of [1, -1]) {
    const x0 = 0.24, z0 = 0.14;
    // Bezier control points in (lateral, dorsal); depth scaled to hit L
    const W = hw * 0.98;
    const bez = (D) => [
      [x0, z0], [W * 1.12, z0 - 0.05], [W * 1.06, -D * 0.72], [W * 0.42, -D],
    ];
    const sample = (D) => {
      const [p0, p1, p2, p3] = bez(D);
      const pts = [];
      for (let k = 0; k <= 18; k++) {
        const t = k / 18, mt = 1 - t;
        const x = mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0];
        const z = mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1];
        // ribs sweep posteriorly as they descend (-y)
        pts.push(new Vector3(s * x, it.length * 0.5 - 0.20 * t * t - 0.04 * t, z));
      }
      return pts;
    };
    // solve D by bisection so that arc length == L
    let lo = 0.1, hi = 2.0, pts = null;
    for (let n = 0; n < 24; n++) {
      const mid = (lo + hi) / 2;
      pts = sample(mid);
      let len = 0;
      for (let k = 1; k < pts.length; k++) len += pts[k].distanceTo(pts[k - 1]);
      if (len > L) hi = mid; else lo = mid;
      arc = len;
    }
    const radii = pts.map((_, k) => {
      const t = k / (pts.length - 1);
      const r = 0.042 - 0.024 * Math.min(1, t / 0.35) - 0.006 * Math.max(0, t - 0.6);
      return [r * 0.6, r * 1.15];
    });
    parts.push(tubeGeometry(pts, radii, { radialSegments: 7, up0: new Vector3(0, 1, 0) }));
    // rib head (capitulum) articulating with the centrum
    parts.push(tubeGeometry(
      [new Vector3(s * x0, it.length * 0.5, z0), new Vector3(s * 0.08, it.length * 0.52, -0.02)],
      [0.024, 0.018], { radialSegments: 6, up0: new Vector3(0, 1, 0) }
    ));
  }
  const geom = mergeGeoms(parts);
  roughenGeometry(geom, 0.002, 18, it.index * 3.3);
  return { geom, length: arc };
}

/* ============================================================ gastralia */

function buildGastralia(layout) {
  const parts = [];
  const n = SPEC.gastraliaPairs;
  // belly line: from the pubic boot (ant 0.40, dor -1.18) forward to the
  // sternal region beneath D2 (ant ~2.5, dor ~ -1.0)
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const ant = 0.62 + t * 1.95;
    const dor = -1.10 + 0.34 * Math.sin(Math.PI * Math.min(1, t * 0.8)) * 0 - 0.10 * Math.sin(Math.PI * t) + 0.12 * t;
    const half = 0.30 + 0.30 * Math.sin(Math.PI * (0.15 + 0.7 * t));
    for (const s of [1, -1]) {
      const pts = [
        new Vector3(s * 0.02, dor - 0.03, -ant),
        new Vector3(s * half * 0.55, dor + 0.02, -ant + 0.06),
        new Vector3(s * half, dor + 0.20, -ant + 0.14),
      ];
      parts.push(tubeGeometry(pts, [0.016, 0.013, 0.007], { radialSegments: 5, up0: new Vector3(0, 1, 0) }));
    }
  }
  return mergeGeoms(parts);
}

/* ============================================================ pelvic girdle */

function buildPelvicGirdle(pelvis, mats, reg) {
  // --- ilium: long low blade with pre- and post-acetabular processes
  const ilium = [
    [0.62, 0.10], [0.74, 0.22], [0.79, 0.40], [0.73, 0.54], [0.55, 0.60], [0.30, 0.62],
    [0.0, 0.615], [-0.30, 0.60], [-0.55, 0.555], [-0.72, 0.45], [-0.80, 0.32], [-0.77, 0.20],
    [-0.60, 0.12], [-0.40, 0.08], [-0.24, 0.03], [-0.18, -0.06], [-0.13, 0.08], [-0.05, 0.14],
    [0.05, 0.145], [0.13, 0.09], [0.16, -0.05], [0.25, -0.07], [0.31, 0.03], [0.46, 0.07],
  ];
  const ilG = mergeGeoms([
    lateralPlate(ilium, 0.06, { lat: 0.15, side: 1, bevel: 0.018 }),
    lateralPlate(ilium, 0.06, { lat: 0.15, side: -1, bevel: 0.018 }),
  ]);
  roughenGeometry(ilG, 0.004, 9, 1.2);
  pelvis.add(reg(meshOf(ilG, mats.bone, 'Ilium', {
    name: 'Ilium (pair)', detail: `blade ~1.59 m long, ${SPEC.iliumHeight} m tall`,
  })));

  // --- pubis: long, anteroventral, fused distally into the apron + boot
  const pParts = [];
  for (const s of [1, -1]) {
    const pts = [
      new Vector3(s * 0.20, -0.02, -0.20), new Vector3(s * 0.17, -0.40, -0.30),
      new Vector3(s * 0.10, -0.80, -0.38), new Vector3(s * 0.05, -1.08, -0.42),
    ];
    pParts.push(tubeGeometry(pts, [[0.09, 0.06], [0.065, 0.05], [0.055, 0.05], [0.06, 0.06]], { radialSegments: 9, up0: new Vector3(0, 0, 1) }));
  }
  // pubic apron (midline sheet joining the shafts)
  pParts.push(lateralPlate([[0.30, -0.45], [0.38, -0.80], [0.43, -1.08], [0.36, -1.10], [0.30, -0.80], [0.25, -0.50]], 0.10, { lat: 0, centered: true, bevel: 0.015 }));
  // pubic boot: the great distal expansion
  pParts.push(lateralPlate([
    [0.82, -1.10], [0.78, -1.18], [0.60, -1.235], [0.40, -1.24], [0.18, -1.21],
    [0.04, -1.16], [0.10, -1.10], [0.30, -1.07], [0.52, -1.06], [0.70, -1.07],
  ], 0.22, { lat: 0, centered: true, bevel: 0.05 }));
  const pubG = mergeGeoms(pParts);
  roughenGeometry(pubG, 0.004, 9, 2.4);
  pelvis.add(reg(meshOf(pubG, mats.bone, 'Pubis', {
    name: 'Pubis (pair) + pubic boot', detail: '~1.3 m, boot ~0.78 m long',
  })));

  // --- ischium: shorter, posteroventral, with obturator flange
  const iParts = [];
  for (const s of [1, -1]) {
    const pts = [
      new Vector3(s * 0.19, -0.06, 0.20), new Vector3(s * 0.15, -0.32, 0.38),
      new Vector3(s * 0.09, -0.60, 0.56), new Vector3(s * 0.05, -0.78, 0.68),
    ];
    iParts.push(tubeGeometry(pts, [[0.07, 0.05], [0.05, 0.04], [0.04, 0.035], [0.05, 0.05]], { radialSegments: 8, up0: new Vector3(0, 0, 1) }));
    iParts.push(transformGeom(ellipsoidGeom(0.025, 0.08, 0.05, 10), { pos: [s * 0.16, -0.26, 0.24] })); // obturator process
  }
  const isG = mergeGeoms(iParts);
  roughenGeometry(isG, 0.004, 9, 3.6);
  pelvis.add(reg(meshOf(isG, mats.bone, 'Ischium', {
    name: 'Ischium (pair)', detail: '~0.95 m, fused distally',
  })));
}

/* ============================================================ pectoral */

function buildPectoral(d2, d2M, mats, reg) {
  // author in pelvis frame, then convert into D2's frame
  const inv = d2M.clone().invert();
  const toLocal = (g) => (g.applyMatrix4(inv), g);
  const origin = new Vector3().setFromMatrixPosition(d2M);   // D2 posterior

  const parts = [];
  const arms = {};
  for (const s of [1, -1]) {
    // glenoid (shoulder socket): low on the chest, ahead of D2
    const glen = origin.clone().add(new Vector3(s * 0.46, -0.78, -0.30));
    // scapula: 1.31 m scapulocoracoid, strap blade sweeping up & back
    const tip = glen.clone().add(new Vector3(s * 0.20, 0.74, 0.62));
    const mid = glen.clone().lerp(tip, 0.5).add(new Vector3(s * 0.12, 0, 0));
    const scap = tubeGeometry(
      [glen.clone().add(new Vector3(0, 0.05, 0.02)), glen.clone().lerp(mid, 0.5), mid, tip],
      [[0.035, 0.13], [0.03, 0.075], [0.028, 0.07], [0.022, 0.10]],
      { radialSegments: 8, up0: new Vector3(0, 0, 1) }
    );
    parts.push(scap);
    // coracoid: rounded plate anteroventral of the glenoid
    parts.push(transformGeom(ellipsoidGeom(0.03, 0.15, 0.17, 14), {
      pos: [glen.x - s * 0.04, glen.y - 0.06, glen.z - 0.15], rot: [0, s * 0.3, 0],
    }));
    arms[s > 0 ? 'R' : 'L'] = { glenoid: glen };
  }
  // furcula (wishbone) — Sue was the first T. rex found with one
  {
    const a = origin.clone().add(new Vector3(0.42, -0.62, -0.40));
    const b = origin.clone().add(new Vector3(0, -0.88, -0.62));
    const c = origin.clone().add(new Vector3(-0.42, -0.62, -0.40));
    parts.push(tubeGeometry([a, a.clone().lerp(b, 0.5).add(new Vector3(0, -0.06, -0.05)), b, c.clone().lerp(b, 0.5).add(new Vector3(0, -0.06, -0.05)), c],
      [0.025, 0.03, 0.035, 0.03, 0.025], { radialSegments: 7, up0: new Vector3(0, 1, 0) }));
  }
  const g = toLocal(mergeGeoms(parts));
  roughenGeometry(g, 0.003, 10, 4.4);
  d2.add(reg(meshOf(g, mats.bone, 'Pectoral girdle', {
    name: 'Scapulocoracoid + furcula', detail: `scapulocoracoid ${SPEC.scapulocoracoid} m`,
  })));

  // arms as small joint chains hanging from the glenoid
  const F = SPEC.forelimb;
  for (const key of ['L', 'R']) {
    const s = key === 'R' ? 1 : -1;
    const shoulder = new Object3D();
    shoulder.name = `shoulder.${key}`;
    const glenLocal = arms[key].glenoid.clone().applyMatrix4(inv);
    shoulder.position.copy(glenLocal);
    // hang the humerus down & slightly forward (world), expressed in D2 space
    const wq = new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), new Vector3(s * 0.12, -0.85, -0.5).normalize());
    const d2q = new Quaternion().setFromRotationMatrix(d2M);
    shoulder.quaternion.copy(d2q.clone().invert().multiply(wq));
    shoulder.userData.restQuat = shoulder.quaternion.clone();
    d2.add(shoulder);

    const hum = longBone({ length: F.humerus, shaft: 0.028, prox: 0.05, dist: 0.045, bow: new Vector3(0, 0, 0.015) });
    hum.rotateX(Math.PI);                         // extend along -Y
    shoulder.add(reg(meshOf(hum, mats.bone, `Humerus ${key}`, { name: `Humerus (${key})`, detail: `${F.humerus * 100} cm` , length: F.humerus })));

    const elbow = new Object3D();
    elbow.name = `elbow.${key}`;
    elbow.position.set(0, -F.humerus, 0);
    elbow.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 70 * DEG);   // forearm flexed forward
    elbow.userData.restQuat = elbow.quaternion.clone();
    shoulder.add(elbow);
    const ul = longBone({ length: F.ulna, shaft: 0.02, prox: 0.04, dist: 0.028 });
    ul.rotateX(Math.PI); ul.translate(s * 0.012, 0, 0.012);
    const ra = longBone({ length: F.radius, shaft: 0.014, prox: 0.022, dist: 0.024 });
    ra.rotateX(Math.PI); ra.translate(-s * 0.018, 0, -0.012);
    elbow.add(reg(meshOf(mergeGeoms([ul, ra]), mats.bone, `Forearm ${key}`, {
      name: `Ulna + radius (${key})`, detail: `ulna ${F.ulna * 100} cm · radius ${F.radius * 100} cm`,
    })));

    const wrist = new Object3D();
    wrist.name = `wrist.${key}`;
    wrist.position.set(0, -F.ulna, 0);
    wrist.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 15 * DEG);
    wrist.userData.restQuat = wrist.quaternion.clone();
    elbow.add(wrist);
    // manus: two functional digits (I, II) + vestigial metacarpal III
    const mp = [];
    const fingers = [
      { x: -0.02, lens: [0.075, 0.085, 0.075], r: 0.017 },
      { x: 0.02, lens: [0.085, 0.07, 0.065, 0.07], r: 0.016 },
    ];
    for (const f of fingers) {
      let y = 0;
      const pts = [new Vector3(f.x * s, 0, 0)];
      const radii = [f.r];
      let ang = 0;
      for (let k = 0; k < f.lens.length; k++) {
        ang += 12 * DEG;
        y -= f.lens[k] * Math.cos(ang);
        pts.push(new Vector3(f.x * s, y, -Math.sin(ang) * f.lens[k] * (k + 1) * 0.6));
        radii.push(k === f.lens.length - 1 ? 0.004 : f.r * (1 - 0.15 * k));
      }
      mp.push(tubeGeometry(pts, radii, { radialSegments: 6, up0: new Vector3(0, 0, 1) }));
    }
    mp.push(tubeGeometry([new Vector3(0.045 * s, 0, 0), new Vector3(0.05 * s, -0.05, 0)], [0.009, 0.004], { radialSegments: 5 }));
    wrist.add(reg(meshOf(mergeGeoms(mp), mats.bone, `Manus ${key}`, { name: `Manus (${key})`, detail: 'two clawed digits + vestigial MC III' })));

    arms[key] = { shoulder, elbow, wrist };
  }
  return arms;
}

/* ============================================================ legs */

/**
 * Leg bones, each a child of the leg group (in rig space), each with its own
 * pivot at the proximal joint and extending along local -Y.  Local +X = the
 * joint hinge axis (lateral); local -Z = the bone's anterior face.
 */
function buildLeg(side, mats, reg) {
  const key = side > 0 ? 'R' : 'L';
  const group = new Group();
  group.name = `leg.${key}`;
  const s = side;

  // ---- femur: robust, anteriorly bowed, medially directed head
  const femur = new Object3D(); femur.name = `femur.${key}`;
  {
    const shaft = longBone({
      length: LEG.femur, shaft: 0.092, prox: 0.13, dist: 0.145, proxFlare: 0.22, distFlare: 0.22,
      ellipse: [1.0, 0.95], bow: new Vector3(0, 0, 0.055), radialSegments: 14, samples: 18,
    });
    shaft.rotateX(Math.PI);                             // down -Y, bow → -Z (anterior)
    const headG = transformGeom(ellipsoidGeom(0.105, 0.10, 0.10, 16), { pos: [-s * 0.14, 0.01, 0] });
    const neckG = tubeGeometry([new Vector3(0, -0.08, 0), new Vector3(-s * 0.12, 0.0, 0)], [0.1, 0.085], { radialSegments: 10 });
    const troch = transformGeom(ellipsoidGeom(0.075, 0.13, 0.11, 12), { pos: [s * 0.05, -0.06, 0.01] });   // greater trochanter
    const lesser = transformGeom(ellipsoidGeom(0.05, 0.10, 0.05, 10), { pos: [s * 0.04, -0.16, -0.08] });  // lesser (anterior) trochanter
    const fourth = transformGeom(ellipsoidGeom(0.035, 0.09, 0.035, 8), { pos: [-s * 0.06, -0.50, 0.07] });  // 4th trochanter
    const condM = transformGeom(ellipsoidGeom(0.075, 0.09, 0.11, 12), { pos: [-s * 0.065, -LEG.femur + 0.02, 0.02] });
    const condL = transformGeom(ellipsoidGeom(0.07, 0.085, 0.11, 12), { pos: [s * 0.07, -LEG.femur + 0.03, 0.02] });
    const g = mergeGeoms([shaft, headG, neckG, troch, lesser, fourth, condM, condL]);
    roughenGeometry(g, 0.004, 8, 11 + s);
    femur.add(reg(meshOf(g, mats.bone, `Femur ${key}`, { name: `Femur (${key})`, detail: `${(LEG.femur * 100).toFixed(1)} cm, circumference 58 cm`, length: LEG.femur })));
  }

  // ---- tibia (+ astragalus/calcaneum) and fibula
  const tibia = new Object3D(); tibia.name = `tibia.${key}`;
  {
    const shaft = longBone({ length: LEG.tibia, shaft: 0.075, prox: 0.12, dist: 0.12, proxFlare: 0.25, distFlare: 0.25, ellipse: [1.0, 0.9], radialSegments: 12, samples: 16 });
    shaft.rotateX(Math.PI);
    const cnem = transformGeom(ellipsoidGeom(0.05, 0.16, 0.12, 12), { pos: [s * 0.02, -0.12, -0.12] });     // cnemial crest
    const astr = transformGeom(ellipsoidGeom(0.17, 0.075, 0.085, 14), { pos: [0, -LEG.tibia + 0.04, 0] });   // astragalus + calcaneum
    const asc = lateralPlate([[0.08, -0.95], [0.02, -1.22], [-0.06, -1.22], [-0.02, -0.95]], 0.04, { lat: 0, centered: true, bevel: 0.01 });
    const ascT = transformGeom(asc, { pos: [0, 0, -0.07] });
    const fib = longBone({ length: LEG.tibia * 0.92, shaft: 0.024, prox: 0.07, dist: 0.035, proxFlare: 0.2, distFlare: 0.2 });
    fib.rotateX(Math.PI);
    fib.translate(s * 0.10, -0.03, 0.03);
    const g = mergeGeoms([shaft, cnem, astr, ascT, fib]);
    roughenGeometry(g, 0.004, 9, 21 + s);
    tibia.add(reg(meshOf(g, mats.bone, `Tibia ${key}`, { name: `Tibiotarsus + fibula (${key})`, detail: `tibia ${(LEG.tibia * 100).toFixed(1)} cm (with astragalus)`, length: LEG.tibia })));
  }

  // ---- metatarsus: arctometatarsalian — MT III pinched proximally
  const meta = new Object3D(); meta.name = `metatarsus.${key}`;
  {
    const L = LEG.metatarsus;
    const mk = (x, len, rProx, rMid, rDist, zOff = 0) => {
      const pts = [], rad = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts.push(new Vector3(x * (0.55 + 0.45 * t), -len * t, zOff * Math.sin(Math.PI * t)));
        const r = t < 0.5 ? rProx + (rMid - rProx) * (t / 0.5) : rMid + (rDist - rMid) * ((t - 0.5) / 0.5);
        rad.push([r, r * 1.1]);
      }
      return tubeGeometry(pts, rad, { radialSegments: 9, up0: new Vector3(0, 0, 1) });
    };
    const mt3 = mk(0, L, 0.018, 0.045, 0.06, -0.01);
    const mt2 = mk(-s * 0.065, L * 0.87, 0.05, 0.045, 0.055);
    const mt4 = mk(s * 0.07, L * 0.925, 0.05, 0.043, 0.052);
    const mt5 = tubeGeometry([new Vector3(s * 0.09, -0.03, 0.02), new Vector3(s * 0.11, -0.25, 0.03)], [0.022, 0.006], { radialSegments: 6 });
    // distal condyles (ginglymoid) where each digit articulates
    const c3 = transformGeom(ellipsoidGeom(0.055, 0.05, 0.06, 10), { pos: [0, -L, 0] });
    const c2 = transformGeom(ellipsoidGeom(0.05, 0.045, 0.055, 10), { pos: [-s * 0.065, -L * 0.87, 0] });
    const c4 = transformGeom(ellipsoidGeom(0.048, 0.045, 0.055, 10), { pos: [s * 0.07, -L * 0.925, 0] });
    const g = mergeGeoms([mt2, mt3, mt4, mt5, c2, c3, c4]);
    roughenGeometry(g, 0.003, 11, 31 + s);
    meta.add(reg(meshOf(g, mats.bone, `Metatarsus ${key}`, { name: `Metatarsals II-V (${key})`, detail: `MT III ${(L * 100).toFixed(1)} cm, arctometatarsalian`, length: L })));
  }

  // ---- digits: each digit is a chain of phalanx joints along local -Z
  const foot = new Object3D(); foot.name = `foot.${key}`;       // at the MTP, yawed to heading
  const digits = {};
  for (const [name, d] of Object.entries(DIGITS)) {
    if (name === 'I') continue;                                  // hallux rides on the metatarsus
    const root = new Object3D();
    root.name = `digit${name}.${key}`;
    root.position.set(s * d.base[0], 0, d.base[1]);
    root.rotation.y = -s * d.splay * DEG;
    foot.add(root);
    const joints = [];
    let parentJ = root;
    d.lengths.forEach((len, k) => {
      const j = new Object3D();
      j.name = `${name}.p${k + 1}`;
      if (k > 0) j.position.set(0, 0, -d.lengths[k - 1]);
      parentJ.add(j);
      const ungual = k === d.lengths.length - 1;
      let g;
      if (ungual) {
        // claw: laterally compressed, curved, pointed
        const pts = [], rad = [];
        for (let i = 0; i <= 7; i++) {
          const t = i / 7;
          pts.push(new Vector3(0, -Math.pow(t, 1.8) * len * 0.35, -len * t));
          rad.push([d.width * 0.55 * (1 - t * 0.9), d.width * 0.75 * (1 - t * 0.85)]);
        }
        g = tubeGeometry(pts, rad, { radialSegments: 8, up0: new Vector3(1, 0, 0) });
      } else {
        const r0 = d.width * (1 - 0.12 * k);
        g = tubeGeometry(
          [0, 0.2, 0.5, 0.8, 1].map((t) => new Vector3(0, 0.004 * Math.sin(Math.PI * t), -len * t)),
          [r0 * 1.05, r0 * 0.78, r0 * 0.7, r0 * 0.8, r0 * 0.95].map((r) => [r * 1.1, r * 0.8]),
          { radialSegments: 8, up0: new Vector3(1, 0, 0) }
        );
      }
      j.add(reg(meshOf(g, mats.bone, `Pes ${name}-${k + 1} ${key}`, {
        name: `Pedal digit ${name}, ${ungual ? 'ungual (claw)' : 'phalanx ' + (k + 1)} (${key})`, detail: `${(len * 100).toFixed(1)} cm`, length: len,
      })));
      joints.push(j);
      parentJ = j;
    });
    digits[name] = { root, joints, def: d };
  }
  // hallux (digit I): small dewclaw on the back/inside of the metatarsus
  {
    const d = DIGITS.I;
    const g = mergeGeoms([
      tubeGeometry([new Vector3(-s * 0.06, -LEG.metatarsus * 0.62, 0.05), new Vector3(-s * 0.085, -LEG.metatarsus * 0.62 - d.lengths[0] * 0.8, 0.08)], [0.022, 0.018], { radialSegments: 6 }),
      tubeGeometry([new Vector3(-s * 0.085, -LEG.metatarsus * 0.62 - d.lengths[0] * 0.8, 0.08), new Vector3(-s * 0.09, -LEG.metatarsus * 0.62 - d.lengths[0] * 0.8 - 0.07, 0.04)], [0.017, 0.003], { radialSegments: 6 }),
    ]);
    meta.add(reg(meshOf(g, mats.bone, `Hallux ${key}`, { name: `Pedal digit I — hallux (${key})`, detail: 'non-weight-bearing dewclaw' })));
  }

  group.add(femur, tibia, meta, foot);
  return { key, side, group, femur, tibia, meta, foot, digits };
}
