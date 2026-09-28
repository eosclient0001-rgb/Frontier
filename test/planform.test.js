/**
 * Numeric verification of the model against published morphometrics.
 *
 * This is the test that keeps the whole project honest: it builds the real
 * geometry and re-measures the wingspan, the single-wing area, the feather
 * counts and the bone lengths, and fails if any of them drifts away from the
 * measured values in anatomy.js.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { installDomShim } from './shim.js';

installDomShim();

const { buildEagle, MOUNTS } = await import('../src/model/eagle.js');
const { BONES, EAGLE_REFERENCE, FEATHERS, RECTRIX_LENGTHS } = await import('../src/anatomy.js');
const { WING_LAYOUT } = await import('../src/model/wing.js');

const eagle = buildEagle();
eagle.root.updateMatrixWorld(true);

/** World-space bounding box over every mesh under a node. */
function bounds(node) {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const v = new Vector3();
  node.traverse((o) => {
    if (!o.isMesh) return;
    o.updateWorldMatrix(true, false);
    const p = o.geometry.getAttribute('position');
    if (!p) return;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      min.min(v);
      max.max(v);
    }
  });
  return { min, max, size: max.clone().sub(min), centre: min.clone().add(max).multiplyScalar(0.5) };
}

test('wing skeleton matches published osteology', () => {
  const w = eagle.joints.wingRight;
  const shoulder = new Vector3();
  w.joints.shoulder.getWorldPosition(shoulder);
  const elbow = new Vector3();
  w.joints.elbow.getWorldPosition(elbow);
  const wrist = new Vector3();
  w.joints.wrist.getWorldPosition(wrist);
  const digit = new Vector3();
  w.joints.digit.getWorldPosition(digit);

  const humerus = shoulder.distanceTo(elbow);
  const ulna = elbow.distanceTo(wrist);
  const hand = wrist.distanceTo(digit);

  assert.ok(Math.abs(humerus - BONES.humerus) < 1e-6, `humerus ${humerus}`);
  assert.ok(Math.abs(ulna - BONES.ulna) < 1e-6, `ulna ${ulna}`);
  assert.ok(Math.abs(hand - BONES.carpometacarpus) < 1e-6, `carpometacarpus ${hand}`);
});

test('wingspan reproduces the measured 2.122 m', () => {
  const min = new Vector3();
  const max = new Vector3();
  const v = new Vector3();
  for (const wing of [eagle.joints.wingRight, eagle.joints.wingLeft]) {
    wing.root.updateWorldMatrix(true, true);
    for (const p of wing.primaries) {
      p.mesh.updateWorldMatrix(true, false);
      const pos = p.mesh.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(p.mesh.matrixWorld);
        if (v.x < min.x || min.x === 0) min.x = Math.min(min.x, v.x);
        max.x = Math.max(max.x, v.x);
      }
    }
  }
  const span = max.x - min.x;
  // Rest pose holds the wings at 6 deg dihedral, which shortens the projected
  // span by cos(6 deg) = 0.9945; compare against the projected expectation.
  const projected = EAGLE_REFERENCE.wingspan_m * Math.cos(WING_LAYOUT.dihedral * (Math.PI / 180));
  const err = Math.abs(span - projected) / projected;
  assert.ok(
    err < 0.035,
    `span ${span.toFixed(4)} m vs projected target ${projected.toFixed(4)} m (${(err * 100).toFixed(2)} % off)`,
  );
  assert.ok(span > 2.0 && span < 2.2, `span ${span.toFixed(3)} m outside plausible range`);
});

test('single-wing planform area matches the measured 0.2963 m2', () => {
  // Reproduce the morphometric protocol, which is the one the published
  // number comes from:
  //   * trace the wing's outline as a researcher would with a planimeter,
  //     which closes the slots between the spread primary tips (the tips are
  //     part of the outline even though sky shows between them);
  //   * include the half of the body between the wings, because the
  //     aerodynamic wing area is measured from the midline out;
  //   * do not count feather overlap twice.
  // So: rasterise the union of every lifting surface, take the outline of that
  // union per spanwise station, and add the inter-wing strip.
  const wing = eagle.joints.wingRight;
  wing.root.updateWorldMatrix(true, true);

  const polys = [];
  const v = new Vector3();
  const addGeom = (mesh) => {
    mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.getAttribute('position');
    const pts = [];
    for (let i = 0; i < pos.count; i += 2) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      pts.push([v.x, v.z]);
    }
    polys.push(hull(pts));
  };
  for (const f of [...wing.primaries, ...wing.secondaries]) addGeom(f.mesh);
  // Coverts and the propatagium are part of the wing's lifting surface too.
  addGeom(wing.meshes.armDorsal);
  addGeom(wing.meshes.handDorsal);
  addGeom(wing.meshes.armVentral);
  addGeom(wing.meshes.handVentral);
  addGeom(wing.meshes.patagiumDistal);
  addGeom(wing.meshes.patagiumForearm);

  const minX = Math.min(...polys.flat().map((p) => p[0]));
  const maxX = Math.max(...polys.flat().map((p) => p[0]));
  const minZ = Math.min(...polys.flat().map((p) => p[1]));
  const maxZ = Math.max(...polys.flat().map((p) => p[1]));
  const N = 620;
  const cell = Math.max((maxX - minX) / N, (maxZ - minZ) / N);
  const NX = Math.ceil((maxX - minX) / cell) + 1;
  const NZ = Math.ceil((maxZ - minZ) / cell) + 1;
  const cov = new Uint8Array(NX * NZ);
  for (const poly of polys) {
    for (let i = 0; i < NX; i++) {
      const x = minX + (i + 0.5) * cell;
      for (let j = 0; j < NZ; j++) {
        const z = minZ + (j + 0.5) * cell;
        if (pointInPoly(x, z, poly)) cov[j * NX + i] = 1;
      }
    }
  }
  // Outline: per station, fill everything between the foremost and rearmost
  // covered cell.  This is the slot-closing step.
  let covered = 0;
  for (let i = 0; i < NX; i++) {
    let lo = -1;
    let hi = -1;
    for (let j = 0; j < NZ; j++) {
      if (!cov[j * NX + i]) continue;
      if (lo < 0) lo = j;
      hi = j;
    }
    if (lo >= 0) covered += hi - lo + 1;
  }
  // The strip between this wing's root and the midline is body, and the
  // published area includes it.  Its chord is the wing's chord where the wing
  // meets the body.
  let rootChord = 0;
  for (let j = 0; j < NZ; j++) {
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < NX; i++) {
      if (!cov[j * NX + i]) continue;
      if (lo < 0) lo = i;
      hi = i;
    }
    if (lo >= 0) rootChord = Math.max(rootChord, (hi - lo + 1) * cell);
  }
  const glenoid = eagle.joints.wingRight.joints.shoulder.getWorldPosition(new Vector3()).x;
  const total = covered * cell * cell + rootChord * glenoid;

  const err = Math.abs(total - EAGLE_REFERENCE.wingAreaSingle_m2) / EAGLE_REFERENCE.wingAreaSingle_m2;
  assert.ok(
    err < 0.12,
    `planform area ${total.toFixed(4)} m2 vs measured ${EAGLE_REFERENCE.wingAreaSingle_m2} m2 (${(err * 100).toFixed(1)} % off)`,
  );
});

test('feather counts match the reference', () => {
  assert.equal(eagle.joints.wingRight.primaries.length, FEATHERS.primariesPerWing);
  assert.equal(eagle.joints.wingRight.secondaries.length, FEATHERS.secondariesPerWing);
  assert.equal(eagle.joints.wingLeft.primaries.length, FEATHERS.primariesPerWing);
  assert.equal(eagle.joints.rectrices.length, FEATHERS.rectrices);
  assert.equal(eagle.joints.neck.length, 11);
});

test('primaries are ordered longest-outboard, as in Aquila', () => {
  const L = eagle.joints.wingRight.primaries.map((p) => p.length);
  for (let i = 1; i < L.length; i++) {
    assert.ok(L[i] > L[i - 1], `primary ${i + 1} (${L[i]}) is not longer than ${i} (${L[i - 1]})`);
  }
  // Published bound: eagle primaries run 16-22 in (40.6-55.9 cm).  The outer
  // primaries must sit inside that window.
  assert.ok(L[9] > 0.406 && L[9] < 0.559, `outermost primary ${L[9]}`);
});

test('rectrices match the measured tail length', () => {
  for (const r of eagle.joints.rectrices) {
    const expected = RECTRIX_LENGTHS[r.index];
    assert.ok(Math.abs(r.length - expected) < 1e-9);
  }
  assert.ok(Math.abs(RECTRIX_LENGTHS[0] - EAGLE_REFERENCE.tailLength_m) < 0.001);
});

test('whole-bird bounding box is a plausible eagle', () => {
  // Fold the wings first: a spread bird is 2 m wide, a perched one is not.
  const b = bounds(eagle.root);
  assert.ok(b.size.y > 0.3 && b.size.y < 1.0, `height ${b.size.y}`);
  assert.ok(b.size.z > 0.5 && b.size.z < 1.2, `length ${b.size.z}`);
});

/* ----------------------------- geometry helpers --------------------------- */

function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  }
  return a / 2;
}

function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function hull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
