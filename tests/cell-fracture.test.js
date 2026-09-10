import test from "node:test";
import assert from "node:assert/strict";
import {
  generateCellPattern,
  regionDistance,
  cellAt,
  fractureRemoval,
  packCellPatterns,
} from "../src/cell-fracture.js";
const stamp = { point: [0, 7, 8], view: [0, 0, -1], radius: 6 };
test("painted 3D Voronoi patterns are deterministic, irregular and responsive to chunk size and seed", () => {
  const a = generateCellPattern([stamp]),
    b = generateCellPattern([stamp]);
  assert.deepEqual(a, b);
  assert.ok(a.sites.length > 4);
  assert.ok(a.sites.some((s) => Math.abs(s[1] - a.sites[0][1]) > 2));
  const small = generateCellPattern([stamp], { size: 3 }),
    large = generateCellPattern([stamp], { size: 7 });
  assert.ok(small.sites.length > large.sites.length);
  assert.notDeepEqual(
    a.sites,
    generateCellPattern([stamp], { seed: 45 }).sites,
  );
  assert.notDeepEqual(
    a.sites,
    generateCellPattern([stamp], { variation: 0 }).sites,
  );
});
test("Voronoi face distance has shared boundaries, interiors and several nonparallel face directions", () => {
  const sites = [
    [-2, 0, 0],
    [2, 0, 0],
    [0, 4, 0],
    [0, 0, 4],
  ];
  assert.equal(cellAt([0, 0, 0], sites).face, 0);
  assert.equal(cellAt([-2, 0, 0], sites).index, 0);
  assert.ok(cellAt([-2, 0, 0], sites).face > 1);
  assert.equal(cellAt([0, 4, 0], sites).index, 2);
  assert.equal(cellAt([0, 0, 4], sites).index, 3);
});
test("cutters are restricted to painted volume; boundary isolation and hairline output are explicit", () => {
  const p = generateCellPattern([stamp]);
  assert.ok(regionDistance([0, 7, 0], p.brushes) < 0);
  assert.equal(fractureRemoval([21, 20, 18], p), -Infinity);
  const detail = generateCellPattern([stamp], { detail: true, gap: 0.004 });
  assert.equal(detail.gap, 0.004);
  assert.equal(generateCellPattern([stamp], { gap: 0.004 }).gap, 0.8);
  const data = packCellPatterns([p, detail]);
  assert.equal(data.length, 1024);
  assert.equal(data[0], p.sites.length);
  assert.equal(data[512], detail.sites.length);
});
test("large regions remain covered at bounded cost rather than truncating sites from one side", () => {
  const stamps = [
    { point: [-10, 10, 15], view: [0, 0, -1], radius: 10 },
    { point: [10, 10, 15], view: [0, 0, -1], radius: 10 },
  ];
  const p = generateCellPattern(stamps, { size: 2, depth: 30 });
  assert.ok(p.sites.length <= 64);
  assert.ok(p.effectiveSize > 2);
  assert.ok(p.sites.some((s) => s[0] < -5));
  assert.ok(p.sites.some((s) => s[0] > 5));
  assert.throws(() => generateCellPattern([stamp], { size: 0 }), /Invalid/);
  assert.equal(generateCellPattern([]), null);
});
