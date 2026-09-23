import test from "node:test";
import assert from "node:assert/strict";
import { selectIntactCell } from "../src/intact-fracture.js";
import { selectConnectedChunk } from "../src/fractures.js";
import {
  generateCellPattern,
  fractureRemoval,
  cellAt,
  regionDistance,
} from "../src/cell-fracture.js";
const size = [12, 8, 8],
  min = [0, 0, 0],
  cell = [1, 1, 1];
const pattern = {
  intact: true,
  sites: [
    [2.5, 4, 4],
    [8.5, 4, 4],
  ],
  brushes: [{ a: [6, 0, 4], b: [6, 8, 4], radius: 100 }],
};
function solid() {
  const a = new Float32Array(12 * 8 * 8 * 4);
  for (let i = 0; i < a.length; i += 4) {
    a[i] = -1;
    a[i + 3] = 1;
  }
  return a;
}
test("intact map has hairlines, no boundary separation and no subtraction field", () => {
  const p = generateCellPattern(
    [{ point: [0, 6, 7], view: [0, 0, -1], radius: 6 }],
    { intact: true, separate: true, gap: 1, size: 3, depth: 14 },
  );
  assert.equal(p.intact, true);
  assert.equal(p.detail, true);
  assert.equal(p.separate, false);
  assert.ok(p.gap <= 0.08);
  assert.equal(fractureRemoval(p.sites[0], p), -Infinity);
});
test("touching labels are independently selectable without changing the connected volume", () => {
  const a = solid(),
    copy = a.slice(),
    point = [2.5, 4, 4];
  assert.equal(selectConnectedChunk(a, point, size, min, cell).whole, true);
  const left = selectIntactCell(a, point, pattern, size, min, cell),
    right = selectIntactCell(a, [8.5, 4, 4], pattern, size, min, cell);
  assert.equal(left.kind, "intact");
  assert.equal(left.cellId, 0);
  assert.equal(left.whole, false);
  assert.equal(left.count, 6 * 8 * 8);
  assert.equal(left.fraction, 0.5);
  for (let i = 0; i < left.mask.length; i++) {
    assert.ok(!(left.mask[i] && right.mask[i]));
    assert.equal(left.mask[i] === 255, i % 12 < 6);
  }
  assert.deepEqual(a, copy);
});
test("intact selection respects paint bounds and does not include disconnected islands in the same cell", () => {
  const a = solid();
  for (let z = 0; z < 8; z++)
    for (let x = 0; x < 12; x++) {
      const i = (z * 8 + 3) * 12 + x;
      a[i * 4] = 1;
      a[i * 4 + 3] = 0;
    }
  const part = selectIntactCell(a, [2.5, 1.5, 4], pattern, size, min, cell);
  assert.equal(part.count, 6 * 3 * 8);
  const bounded = {
    ...pattern,
    brushes: [{ a: [6, 0, 4], b: [6, 8, 4], radius: 3 }],
  };
  const selection = selectIntactCell(
    a,
    [4.5, 1.5, 4],
    bounded,
    size,
    min,
    cell,
  );
  for (let i = 0; i < selection.mask.length; i++)
    if (selection.mask[i]) {
      const p = [
        (i % 12) + 0.5,
        (Math.floor(i / 12) % 8) + 0.5,
        Math.floor(i / 96) + 0.5,
      ];
      assert.ok(regionDistance(p, bounded.brushes) <= 0);
      assert.equal(cellAt(p, pattern.sites).index, 0);
    }
  assert.throws(
    () => selectIntactCell(a, [0.5, 1, 4], bounded, size, min, cell),
    /inside/,
  );
  assert.throws(
    () => selectIntactCell(a, [NaN, 1, 4], bounded, size, min, cell),
    /Invalid/,
  );
});
