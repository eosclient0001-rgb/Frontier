import test from "node:test";
import assert from "node:assert/strict";
import {
  makePlane,
  planeDistance,
  boundedPlane,
  selectConnectedChunk,
} from "../src/fractures.js";
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
test("A/B plus view defines an orthonormal plane; tilt rotates around the guide", () => {
  const p = makePlane([-2, 4, 0], [2, 4, 0], [0, 0, -1]);
  assert.ok(Math.abs(dot(p.u, p.v)) < 1e-9);
  assert.ok(Math.abs(dot(p.u, p.n)) < 1e-9);
  assert.equal(planeDistance([0, 4, 0], p), -0.6);
  const tilted = makePlane(p.a, p.b, p.view, { tilt: 45, width: 0.001 });
  assert.equal(tilted.width, 0.8);
  assert.ok(Math.abs(dot(tilted.n, p.n) - Math.SQRT1_2) < 1e-9);
  assert.throws(
    () => makePlane([0, 0, 0], [0, 0, 0], [0, 1, 0]),
    /apart|15 cm/,
  );
  assert.throws(() => makePlane([0, 0, NaN], [1, 0, 0], [0, 1, 0]), /Invalid/);
});
test("finite cut boundaries and visual hairlines have different widths", () => {
  const p = makePlane([-1, 0, 0], [1, 0, 0], [0, 0, 1], { span: 2, depth: 2 });
  assert.ok(planeDistance([2, 0, 0], p) > 0);
  assert.ok(planeDistance([0, 0, 2], p) > 0);
  const d = makePlane(p.a, p.b, p.view, { detail: true, width: 0.006 });
  assert.equal(d.width, 0.006);
  for (const q of boundedPlane(makePlane(p.a, p.b, p.view)))
    assert.ok(q[0] >= -22 && q[0] <= 22 && q[2] >= -20 && q[2] <= 20);
});
function field(n, solid) {
  const v = new Float32Array(n * n * n * 4);
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = ((z * n + y) * n + x) * 4,
          s = solid(x, y, z);
        v[i] = s ? -0.5 : 0.5;
        v[i + 3] = s ? 1 : 0;
      }
  return v;
}
test("chunk selection preserves diagonal/edge bridges, and refuses to call a connected body a separate chunk", () => {
  const n = 7,
    v = field(
      n,
      (x, y, z) =>
        (x === 1 && y === 1 && z === 1) || (x === 2 && y === 2 && z === 2),
    );
  const c = selectConnectedChunk(
    v,
    [1.5, 1.5, 1.5],
    [n, n, n],
    [0, 0, 0],
    [1, 1, 1],
  );
  assert.equal(c.count, 2);
  assert.equal(c.whole, true);
});
test("a full gap isolates the clicked component while a hidden bed bridge keeps it connected", () => {
  const n = 9,
    solid = (x, y, z) =>
      y > 1 && y < 7 && z > 1 && z < 7 && x > 0 && x < 8 && x !== 4;
  const a = selectConnectedChunk(
    field(n, solid),
    [2, 4, 4],
    [n, n, n],
    [0, 0, 0],
    [1, 1, 1],
  );
  assert.equal(a.whole, false);
  assert.equal(a.fraction, 0.5);
  const b = selectConnectedChunk(
    field(n, (x, y, z) => solid(x, y, z) || (y === 2 && z === 4 && x === 4)),
    [2, 4, 4],
    [n, n, n],
    [0, 0, 0],
    [1, 1, 1],
  );
  assert.equal(b.whole, true);
  assert.ok(a.mask[(4 * n + 4) * n + 6] === 0);
});
