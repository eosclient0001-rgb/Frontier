import test from "node:test";
import assert from "node:assert/strict";
import {
  lifecycleDefaults,
  lifecycleUniforms,
  PARTICLE_DT,
  SETTLE_TICKS,
  SETTLE_SECONDS,
} from "../src/particle-lifecycle.js";
import { defaults, encodeScene } from "../src/field.js";
test("lifecycle settings stay finite and bounded; settling is an integer tick budget", () => {
  assert.deepEqual(lifecycleUniforms(), [8, 0.002, 8, 0.12]);
  assert.deepEqual(
    lifecycleUniforms({
      rainLifetime: Infinity,
      rainEvaporation: NaN,
      rainStallTime: NaN,
    }),
    [8, 0.002, 8, 0.12],
  );
  assert.deepEqual(
    lifecycleUniforms({
      rainLifetime: 99,
      rainEvaporation: 0,
      rainStallTime: -1,
    }),
    [15, 0, 0.2, 0.12],
  );
  assert.equal(SETTLE_TICKS, 25);
  assert.equal(SETTLE_SECONDS, SETTLE_TICKS * PARTICLE_DT);
  for (const [k, v] of Object.entries(lifecycleDefaults))
    assert.equal(defaults[k], v);
});
test("exports record lifetime policy and controls without pretending to contain live particles", async () => {
  const settings = {
    ...defaults,
    rainLifetime: 4,
    rainStallTime: 0.3,
    rainEvaporation: 0.4,
  };
  const bytes = await encodeScene(new Float32Array(4), settings).arrayBuffer(),
    length = new DataView(bytes).getUint32(4, true);
  const h = JSON.parse(
    new TextDecoder().decode(new Uint8Array(bytes, 8, length)),
  );
  assert.equal(h.particleLifecycleModel, "rain-runoff-captured-v2");
  assert.equal(h.particleTimeStep, PARTICLE_DT);
  assert.equal(h.particleStateIncluded, false);
  assert.equal(h.settings.rainLifetime, 4);
  assert.equal(h.settings.rainEvaporation, 0.4);
  assert.equal(h.settings.rainStallTime, 0.3);
});
