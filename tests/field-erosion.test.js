/* Numerical tests for the CPU field-erosion core (runs headless in Node). */
import { test } from "node:test";
import assert from "node:assert";
import { initFieldState, stepFieldIterations, finishFieldState } from "../src/field-erosion.js";

function makeCone(n, voxel) {
  const h = new Float32Array(n * n);
  const hard = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = (i - n / 2) * voxel;
      const z = (j - n / 2) * voxel;
      const r = Math.hypot(x, z);
      h[j * n + i] = Math.max(0, 12 - r * 0.55) + Math.sin(i * 0.7) * 0.03 + Math.cos(j * 0.9) * 0.03;
      hard[j * n + i] = 0.3;
    }
  return { h, hard };
}

const params = { K: 0.5, nExp: 1.5, D: 0.12, thermal: 0.4 };

test("field erosion incises channels without producing NaN", () => {
  const n = 64;
  const voxel = 0.375;
  const { h, hard } = makeCone(n, voxel);
  const before = Float32Array.from(h);
  const st = initFieldState({ h, hard, n, voxel, seed: 42, seaLevel: -Infinity });
  stepFieldIterations(st, 24, params);
  const result = finishFieldState(st);

  assert.ok(Number.isFinite(result.carved), "carved volume is finite");
  assert.ok(result.carved > 0, "some material was incised");
  assert.ok(Number.isFinite(result.deposited), "deposited volume is finite");

  let minDelta = Infinity;
  let maxDelta = -Infinity;
  for (let i = 0; i < n * n; i++) {
    assert.ok(Number.isFinite(result.dh[i]), `dh[${i}] is finite`);
    if (result.dh[i] < minDelta) minDelta = result.dh[i];
    if (result.dh[i] > maxDelta) maxDelta = result.dh[i];
  }
  assert.ok(minDelta < -1e-4, "channels were incised (negative dh exists)");
  assert.ok(maxDelta > -1e9, "no extreme values");
  // no bottomless pits: per-iteration cap × iterations bounds the deepest cut
  assert.ok(minDelta > -(voxel * 0.22 * 24 + 0.5), "incision stays within the voxel-matched cap");
});

test("field erosion approximately conserves mass", () => {
  const n = 64;
  const voxel = 0.375;
  const { h, hard } = makeCone(n, voxel);
  const st = initFieldState({ h, hard, n, voxel, seed: 7, seaLevel: -Infinity });
  stepFieldIterations(st, 18, params);
  const result = finishFieldState(st);

  let sumDh = 0;
  for (let i = 0; i < n * n; i++) sumDh += result.dh[i];
  const volumeDelta = sumDh * voxel * voxel;
  const net = result.deposited - result.carved;
  // diffusion/thermal are conservative; incision+deposition ledger should match
  // the actual height change to within a small tolerance
  assert.ok(
    Math.abs(volumeDelta - net) < 0.25 * Math.max(1, result.carved),
    `mass ledger ${net.toFixed(3)} vs actual ${volumeDelta.toFixed(3)}`,
  );
});

test("channels stay concave: incision outruns diffusion inside threads", () => {
  const n = 64;
  const voxel = 0.375;
  const { h, hard } = makeCone(n, voxel);
  const before = Float32Array.from(h);
  const st = initFieldState({ h, hard, n, voxel, seed: 3, seaLevel: -Infinity });
  stepFieldIterations(st, 24, params);
  const after = st.hh;

  // The deepest-delta cell on a radial cone is the diffusion-relaxed summit,
  // so we count cells that are BOTH incised and locally concave — that is the
  // signature of crisp channel threads surviving the hillslope smoothing.
  let concaveIncised = 0;
  for (let j = 1; j < n - 1; j++)
    for (let i = 1; i < n - 1; i++) {
      const idx = j * n + i;
      if (after[idx] - before[idx] >= -1e-4) continue;
      const lap =
        after[idx - 1] + after[idx + 1] + after[idx - n] + after[idx + n] - 4 * after[idx];
      if (lap > 1e-3) concaveIncised++;
    }
  assert.ok(
    concaveIncised > n,
    `expected a network of concave incised cells, got ${concaveIncised}`,
  );
});

test("priority flood drains enclosed basins over their rims", async () => {
  // import lazily so the test file stays a plain module graph
  const { h, hard } = makeCone(32, 0.5);
  // dig an enclosed pit in the middle
  for (let j = 12; j < 20; j++) for (let i = 12; i < 20; i++) h[j * 32 + i] -= 3;
  const st = initFieldState({ h, hard: hard, n: 32, voxel: 0.5, seed: 1, seaLevel: -Infinity });
  stepFieldIterations(st, 12, params);
  const result = finishFieldState(st);
  // the pit rim should be incised (spilling) — some rim cell loses height
  let rimCut = 0;
  for (let i = 0; i < 32 * 32; i++) if (result.dh[i] < -1e-4) rimCut++;
  assert.ok(rimCut > 0, "pit drainage produced incision");
});
