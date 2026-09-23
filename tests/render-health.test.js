import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectFrame,
  assertFrame,
  withDeadline,
  validateUniforms,
} from "../src/render-health.js";
function flat(r, g, b, a = 255) {
  const pixels = new Uint8Array(64 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([r, g, b, a], i);
  return pixels;
}
test("frame health rejects white, black, transparent and undrawn clear frames", () => {
  for (const frame of [
    flat(255, 255, 255),
    flat(0, 0, 0),
    flat(140, 100, 60, 0),
    flat(77, 77, 64),
    new Uint8Array(0),
  ])
    assert.equal(inspectFrame(frame).ok, false);
  assert.throws(() => assertFrame(flat(255, 255, 255)), /blank or invalid/);
});
test("frame health accepts opaque landscape variation and BGRA channel order", () => {
  const frame = flat(160, 130, 100);
  frame.set([60, 50, 40, 255]);
  frame.set([180, 190, 200, 255], 4);
  assert.equal(inspectFrame(frame).ok, true);
  const bgra = frame.slice();
  for (let i = 0; i < bgra.length; i += 4) {
    bgra[i] = frame[i + 2];
    bgra[i + 2] = frame[i];
  }
  assert.deepEqual(inspectFrame(frame), inspectFrame(bgra));
});
test("render uniforms must be complete and finite", () => {
  validateUniforms(new Float32Array(28));
  assert.throws(() => validateUniforms(new Float32Array(0)), /Invalid/);
  const values = new Float32Array(28);
  values[7] = Infinity;
  assert.throws(() => validateUniforms(values), /Invalid/);
  values[7] = NaN;
  assert.throws(() => validateUniforms(values), /Invalid/);
});
test("GPU deadlines settle success, failure and a hung queue", async () => {
  assert.equal(await withDeadline(Promise.resolve(7), 100, "test"), 7);
  await assert.rejects(
    withDeadline(Promise.reject(new Error("device lost")), 100, "test"),
    /device lost/,
  );
  await assert.rejects(
    withDeadline(new Promise(() => {}), 10, "frame completion"),
    /frame completion timed out/,
  );
});
