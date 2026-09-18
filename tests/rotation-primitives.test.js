import test from "node:test";
import assert from "node:assert/strict";
import { PRIMITIVES, primitiveDistance } from "../src/primitives.js";
import {
  rotateEuler,
  rotationMatrix,
  rotateVector,
  rayPlaneAngle,
  angleDelta,
} from "../src/rotation.js";
import { makeShape, shapeDistance, rotateObject } from "../src/shapes.js";
import { makePath } from "../src/splines.js";
import { defaults, baseSDF } from "../src/field.js";
import { gizmoShortcut, isTextEditing } from "../src/editor-shortcuts.js";
test("G/R/S only route to their gizmos outside camera flight, forms, modifiers and active drags", () => {
  for (const [code, mode] of [
    ["KeyG", "move"],
    ["KeyR", "rotate"],
    ["KeyS", "scale"],
  ]) {
    assert.equal(gizmoShortcut({ code }), mode);
    for (const block of ["flying", "typing", "dragging"])
      assert.equal(gizmoShortcut({ code }, { [block]: true }), null);
    for (const flag of ["ctrlKey", "altKey", "metaKey", "repeat"])
      assert.equal(gizmoShortcut({ code, [flag]: true }), null);
  }
  assert.equal(gizmoShortcut({ code: "KeyW" }), null);
  for (const tagName of ["INPUT", "SELECT", "TEXTAREA"])
    assert.equal(isTextEditing({ tagName }), true);
  assert.equal(isTextEditing({ isContentEditable: true }), true);
  assert.equal(isTextEditing({ tagName: "CANVAS" }), false);
});
test("world-axis Euler composition matches vector rotation, including gimbal configurations", () => {
  for (const original of [
    [0, 0, 0],
    [30, 50, -20],
    [0, 90, 15],
    [90, -90, 45],
  ])
    for (const axis of [0, 1, 2]) {
      const a = 0.72,
        m = rotationMatrix(original),
        next = rotationMatrix(rotateEuler(original, axis, a));
      for (let k = 0; k < 3; k++) {
        const expected = rotateVector(
          m.map((row) => row[k]),
          axis,
          a,
        );
        for (let i = 0; i < 3; i++)
          assert.ok(Math.abs(expected[i] - next[i][k]) < 1e-6);
      }
    }
  assert.ok(Math.abs(angleDelta(-3.1, 3.1) - 0.08318530718) < 1e-9);
  assert.equal(
    rayPlaneAngle({ origin: [4, 10, 0], direction: [0, -1, 0] }, [0, 0, 0], 1),
    Math.PI / 2,
  );
  assert.equal(
    rayPlaneAngle({ origin: [0, 10, 0], direction: [1, 0, 0] }, [0, 0, 0], 1),
    null,
  );
});
test("rotation changes actual shape, plot and spline geometry, while water remains horizontal", () => {
  const n = {
    ...makeShape("s"),
    position: [0, 0, 0],
    size: [8, 2, 2],
    primitive: 1,
    noiseAmount: 0,
  };
  assert.ok(shapeDistance([3, 0, 0], n) < 0);
  rotateObject(n, {}, 2, Math.PI / 2);
  assert.ok(shapeDistance([3, 0, 0], n) > 0);
  assert.ok(shapeDistance([0, 3, 0], n) < 0);
  const p = { ...defaults, preset: 3 };
  assert.ok(baseSDF(5, 0, 0, p) < 0);
  rotateObject({ type: "plot" }, p, 2, Math.PI / 2);
  assert.ok(baseSDF(5, 0, 0, p) > 0);
  assert.ok(baseSDF(0, 10, 0, p) < 0);
  const cut = {
    ...makePath("c", "cut"),
    points: [
      [-4, 2, 0],
      [4, 2, 0],
    ],
  };
  rotateObject(cut, p, 1, Math.PI / 2);
  assert.ok(Math.abs(cut.points[0][0]) < 1e-8);
  assert.equal(cut.points[0][2], 4);
  const water = { ...cut, type: "water" },
    before = structuredClone(water.points);
  rotateObject(water, p, 0, 0.5);
  assert.deepEqual(water.points, before);
  rotateObject(water, p, 1, 0.5);
  assert.equal(water.points[0][1], 2);
});
test("seven distinct bounded 3D primitives include a genuine torus hole and seed-independent organic forms", () => {
  assert.equal(PRIMITIVES.length, 7);
  for (const kind of PRIMITIVES) {
    for (let x = -3; x <= 3; x += 0.3) {
      const d = primitiveDistance([x, 0.3, -0.4], [2, 3, 2], kind.id, 0.2, 0.5);
      assert.ok(Number.isFinite(d));
    }
    assert.ok(primitiveDistance([10, 0, 0], [2, 3, 2], kind.id) > 0);
    if (kind.id !== 3)
      assert.ok(primitiveDistance([0, 0, 0], [2, 3, 2], kind.id) < 0);
  }
  assert.ok(primitiveDistance([0, 0, 0], [2, 3, 2], 3) > 0);
  assert.ok(primitiveDistance([1.5, 0, 0], [2, 3, 2], 3) < 0);
  for (const kind of [2, 3, 4, 5]) {
    let changed = 0;
    for (let x = 0; x < 2.5; x += 0.2)
      if (
        Math.abs(
          primitiveDistance([x, 0.8, 0.3], [2, 3, 2], kind, 0.2, 0.2) -
            primitiveDistance([x, 0.8, 0.3], [2, 3, 2], kind, 0.2, 0.8),
        ) > 1e-5
      )
        changed++;
    assert.ok(changed > 0);
  }
});
