import test from "node:test";
import assert from "node:assert/strict";
import { baseSDF, defaults } from "../src/field.js";
import {
  sampleSpline,
  pathCutDistance,
  nearestSplineXZ,
  makePath,
  packFlowPaths,
} from "../src/splines.js";
test("land plot is a bounded XYZ solid with editable dimensions and bottom, not a heightmap", () => {
  const p = { ...defaults, preset: 3 };
  assert.ok(Math.abs(baseSDF(0, 2.5, 0, p)) < 1e-10);
  assert.ok(baseSDF(0, 0, 0, p) < 0);
  assert.ok(baseSDF(0, -3, 0, p) > 0);
  assert.ok(baseSDF(20, 0, 0, p) > 0);
  assert.ok(baseSDF(0, 0, 18, p) > 0);
  assert.ok(baseSDF(8, 0, 0, { ...p, plotWidth: 10 }) > 0);
  assert.ok(baseSDF(0, 4, 0, { ...p, plotHeight: 5 }) < 0);
});
test("bounded Catmull-Rom interpolates controls, remains finite and reverses tangent", () => {
  const points = [
      [-10, 2, -9],
      [-3, 4, 0],
      [8, 3, 9],
    ],
    sample = sampleSpline(points);
  assert.deepEqual(sample[0], points[0]);
  assert.deepEqual(sample.at(-1), points.at(-1));
  assert.ok(sample.length <= 33);
  assert.ok(sample.some((p) => p.every((v, k) => v === points[1][k])));
  assert.ok(sample.flat().every(Number.isFinite));
  const forward = nearestSplineXZ(
      [0, 0, 0],
      [
        [-8, 2, 0],
        [8, 2, 0],
      ],
    ),
    back = nearestSplineXZ(
      [0, 0, 0],
      [
        [8, 2, 0],
        [-8, 2, 0],
      ],
    );
  assert.equal(forward.tangent[0], 1);
  assert.equal(back.tangent[0], -1);
  assert.equal(
    sampleSpline(
      Array.from({ length: 12 }, (_, i) => [i, 2, i]),
      16,
    ).length,
    12,
  );
});
test("cut field has open top, graded bed, bounded width and widened banks", () => {
  const n = {
    ...makePath("cut", "cut"),
    points: [
      [-8, 3, 0],
      [8, 3, 0],
    ],
    width: 4,
    depth: 2,
    bankSlope: 0.5,
  };
  assert.ok(pathCutDistance([0, 1.5, 0], n) < 0);
  assert.ok(pathCutDistance([0, 0.2, 0], n) > 0);
  assert.ok(pathCutDistance([0, 15, 0], n) < 0);
  assert.ok(pathCutDistance([0, 1.2, 4], n) > 0);
  assert.ok(pathCutDistance([0, 8, 4], n) < 0);
  n.points[1][1] = 5;
  assert.ok(pathCutDistance([7, 2, 0], n) > 0);
  assert.equal(
    pathCutDistance([0, 2, 0], {
      ...n,
      points: [
        [1, 2, 1],
        [1, 2, 1],
      ],
    }),
    Infinity,
  );
});
test("flow routes pack continuous arc lengths, width/speed and distinct path inlets; hidden means no custom flow", () => {
  const a = {
      ...makePath("a", "water"),
      width: 4,
      speed: 2,
      points: [
        [-10, 1, 0],
        [10, 1, 0],
      ],
    },
    b = {
      ...makePath("b", "water"),
      points: [
        [0, 1, -8],
        [0, 1, 8],
      ],
    };
  const packed = packFlowPaths({ sceneObjects: [a, b] });
  assert.equal(packed[0], 32);
  assert.equal(packed[1], 1);
  assert.ok(Math.abs(packed[2] - 36) < 1e-5);
  assert.equal(packed[7], 2);
  assert.equal(packed[11], 2);
  assert.deepEqual(Array.from(packed.slice(12, 14)), [-10, 0]);
  assert.deepEqual(
    Array.from(packed.slice((3 + 16 * 3) * 4, (3 + 16 * 3) * 4 + 2)),
    [0, -8],
  );
  const hidden = packFlowPaths({ sceneObjects: [{ ...a, visible: false }] });
  assert.equal(hidden[0], 0);
  assert.equal(hidden[1], 1);
  assert.equal(packFlowPaths({ preset: 3 })[1], 1);
  assert.equal(packFlowPaths({ preset: 0 })[1], 0);
  assert.ok(packed.every(Number.isFinite));
});
