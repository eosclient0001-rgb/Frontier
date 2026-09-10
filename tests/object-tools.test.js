import test from "node:test";
import assert from "node:assert/strict";
import { fractalNoise, noiseDefaults, terraceY } from "../src/volume-noise.js";
import {
  makeShape,
  shapeDistance,
  moveObject,
  scaleObject,
  objectPivot,
  rayAxisParameter,
} from "../src/shapes.js";
import { makePath, pathCutDistance } from "../src/splines.js";
import { defaults, baseSDF } from "../src/field.js";
test("3D noise families are deterministic, seedable, and vary in all three coordinates", () => {
  for (const type of [1, 2, 3, 4]) {
    const p = { ...noiseDefaults, noiseType: type, noiseWarp: 0.7 },
      a = fractalNoise([1.2, 3.4, 5.6], p);
    assert.equal(a, fractalNoise([1.2, 3.4, 5.6], p));
    assert.ok(Math.abs(a) <= 1);
    for (let k = 0; k < 3; k++) {
      const q = [1.2, 3.4, 5.6];
      q[k] += 0.8;
      assert.notEqual(a, fractalNoise(q, p));
    }
    assert.notEqual(a, fractalNoise([1.2, 3.4, 5.6], { ...p, noiseSeed: 12 }));
  }
  assert.equal(fractalNoise([1, 2, 3], { noiseType: 0 }), 0);
});
test("boulder and rotated box are volumetric, with local noise and geometric terraces", () => {
  const n = makeShape("s");
  n.position = [0, 0, 0];
  n.noiseAmount = 0;
  assert.ok(shapeDistance([0, 0, 0], n) < 0);
  assert.ok(shapeDistance([0, -4, 0], n) > 0);
  n.primitive = 1;
  n.size = [8, 2, 2];
  assert.ok(shapeDistance([3, 0, 0], n) < 0);
  n.rotation = [0, 0, 90];
  assert.ok(shapeDistance([3, 0, 0], n) > 0);
  assert.ok(shapeDistance([0, 3, 0], n) < 0);
  assert.equal(terraceY(0.1, 1, 1), 0);
  assert.equal(terraceY(0.9, 1, 1), 1);
  assert.equal(terraceY(0.7, 1, 0), 0.7);
  n.primitive = 0;
  n.rotation = [0, 0, 0];
  n.size = [5, 5, 5];
  n.noiseAmount = 1;
  assert.notEqual(shapeDistance([2.5, 0, 0], n), 0);
});
test("spline translation and scaling modify the actual cutter; point mode changes only one control", () => {
  const n = {
      ...makePath("c", "cut"),
      points: [
        [-8, 3, 0],
        [8, 3, 0],
      ],
      width: 4,
      depth: 2,
    },
    p = { ...defaults };
  assert.ok(pathCutDistance([0, 0.5, 0], n) > 0);
  moveObject(n, p, [0, 2, 0]);
  assert.ok(pathCutDistance([0, 0.5, 0], n) < 0);
  assert.deepEqual(n.points, [
    [-8, 2, 0],
    [8, 2, 0],
  ]);
  scaleObject(n, p, [1.5, 1.5, 1.5]);
  assert.equal(n.width, 6);
  assert.equal(n.depth, 3);
  assert.deepEqual(n.points, [
    [-12, 2, 0],
    [12, 2, 0],
  ]);
  moveObject(n, p, [-12, 4, 0], 0);
  assert.equal(n.points[0][1], 4);
  assert.equal(n.points[1][1], 2);
  assert.deepEqual(objectPivot(n, p), [0, 3, 0]);
});
test("axis drag projection and local plot properties have bounded geometric effects", () => {
  assert.equal(
    rayAxisParameter(
      { origin: [0, 4, 10], direction: [0, 0, -1] },
      [0, 0, 0],
      1,
    ),
    4,
  );
  assert.equal(
    rayAxisParameter(
      { origin: [0, 4, 0], direction: [0, -1, 0] },
      [0, 0, 0],
      1,
    ),
    null,
  );
  const p = {
    ...defaults,
    preset: 3,
    plotWidth: 12,
    plotLength: 12,
    plotHeight: 6,
  };
  assert.ok(baseSDF(0, 5, 0, p) < 0);
  assert.ok(baseSDF(0, 5, 0, { ...p, plotHeight: 3 }) > 0);
  assert.ok(baseSDF(0, -2.5, 0, p) > 0);
  assert.ok(baseSDF(0, -2.5, 0, { ...p, plotBase: -3 }) < 0);
  assert.notEqual(
    baseSDF(6, 2, 0, p),
    baseSDF(6, 2, 0, {
      ...p,
      plotNoiseAmount: 1,
      plotNoiseType: 3,
      plotNoiseWarp: 0.8,
    }),
  );
  assert.ok(baseSDF(-6, 2, 0, { ...p, plotX: 4 }) > 0);
});
