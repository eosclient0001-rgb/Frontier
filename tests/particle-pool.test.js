import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PARTICLES,
  DEFAULT_HYDRAULIC_PARTICLES,
  MAX_HYDRAULIC_PARTICLES,
  hydraulicParticleCount,
  RAIN_PARTICLES,
  RAIN_START,
  TOTAL_PARTICLE_SLOTS,
  PARTICLE_SIZE,
  DEFAULT_WORLD_PARTICLES,
  particleCount,
  particleDrawPlan,
} from "../src/particle-pool.js";
import {
  runoffUniforms,
  lifecycleUniforms,
} from "../src/particle-lifecycle.js";
test("actual GPU pool has 16384 stable IDs, with bounded draw density and sanitized limits", () => {
  assert.equal(MAX_PARTICLES, 16384);
  assert.deepEqual(PARTICLE_SIZE, [64, 288]);
  assert.equal(DEFAULT_WORLD_PARTICLES, 4096);
  assert.equal(particleCount(Infinity), 4096);
  assert.equal(particleCount(-2), 1);
  assert.equal(particleCount(999999), 16384);
  for (const n of [1, 1024, 4096, 8192, 16384]) {
    const p = particleDrawPlan(n);
    assert(p.count <= 4096);
    assert((p.count - 1) * p.stride < n);
  }
  assert.deepEqual(particleDrawPlan(16384), { count: 4096, stride: 4 });
});
test("runoff has an independent finite travel budget and slow evaporation, with bounded routing head", () => {
  assert.deepEqual(runoffUniforms(), [600, 0.001, 0.35, 0]);
  assert.equal(lifecycleUniforms()[2], 8);
  assert.deepEqual(
    runoffUniforms({
      runoffLifetime: Infinity,
      runoffEvaporation: NaN,
      runoffHead: NaN,
    }),
    [600, 0.001, 0.35, 0],
  );
  assert.deepEqual(
    runoffUniforms({
      runoffLifetime: 99999,
      runoffEvaporation: 1,
      runoffHead: 9,
    }),
    [1800, 0.02, 2, 0],
  );
  assert(Math.exp(-runoffUniforms()[1] * 120) > 0.85);
});

test("precipitation has independent slots and reserved display capacity, not borrowed sediment carriers", () => {
  assert.equal(RAIN_START, MAX_PARTICLES);
  assert.equal(RAIN_PARTICLES, 2048);
  assert.equal(TOTAL_PARTICLE_SLOTS, 18432);
  assert.equal(PARTICLE_SIZE[0] * PARTICLE_SIZE[1], TOTAL_PARTICLE_SLOTS);
  for (const count of [1, 512, 4096, 16384])
    assert(particleDrawPlan(count).count + RAIN_PARTICLES <= 6144);
});

test("hydraulic authoring exposes 16 times the old default using the existing bounded GPU pool", () => {
  assert.equal(DEFAULT_HYDRAULIC_PARTICLES, 1024);
  assert.equal(MAX_HYDRAULIC_PARTICLES, MAX_PARTICLES);
  assert.equal(hydraulicParticleCount(undefined), 1024);
  assert.equal(hydraulicParticleCount(NaN), 1024);
  assert.equal(hydraulicParticleCount(Infinity), 1024);
  assert.equal(hydraulicParticleCount(999999), 16384);
  assert.equal(hydraulicParticleCount(-1), 1);
  assert.equal(hydraulicParticleCount(4096), 4096);
  assert.deepEqual(PARTICLE_SIZE, [64,288]);
});
