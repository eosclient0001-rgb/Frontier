import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FluidSolver, materials, type MaterialKey } from '../src/physics';

test('initial fluid is a three-dimensional volume with deterministic reset', () => {
  const fluid = new FluidSolver();
  assert.equal(fluid.count, 1440);
  const initial = Array.from(fluid.positions);
  const xs = new Set<number>(), ys = new Set<number>(), zs = new Set<number>();
  for (let i = 0; i < fluid.count; i++) {
    xs.add(fluid.positions[3 * i]); ys.add(fluid.positions[3 * i + 1]); zs.add(fluid.positions[3 * i + 2]);
  }
  assert.ok(xs.size > 1 && ys.size > 1 && zs.size > 1);
  fluid.step(1 / 60); fluid.stir(); fluid.reset();
  assert.deepEqual(Array.from(fluid.positions), initial);
  assert.equal(fluid.time, 0);
  assert.ok(fluid.velocities.every(v => v === 0));
});

for (const material of Object.keys(materials) as MaterialKey[]) {
  test(`${material} stays finite and inside collision bounds after pouring and stirring`, () => {
    const fluid = new FluidSolver(); fluid.setMaterial(material);
    for (let frame = 0; frame < 90; frame++) {
      if (frame < 60) fluid.pour(1 / 60, .65);
      if (frame === 30) fluid.stir();
      fluid.step(1 / 60);
    }
    assert.ok(fluid.count > 1440);
    for (let i = 0; i < fluid.count; i++) {
      const p = fluid.positions, k = i * 3, b = fluid.bounds, epsilon = 1e-6;
      assert.ok(Number.isFinite(p[k]) && Number.isFinite(p[k + 1]) && Number.isFinite(p[k + 2]));
      assert.ok(Math.abs(p[k]) <= b.x + epsilon && Math.abs(p[k + 2]) <= b.z + epsilon);
      assert.ok(p[k + 1] >= b.floor - epsilon && p[k + 1] <= b.ceiling + epsilon);
      for (let a = 0; a < 3; a++) assert.ok(Number.isFinite(fluid.velocities[k + a]) && Math.abs(fluid.velocities[k + a]) <= 12);
    }
  });
}

test('emitter is time-based and bounded by the particle capacity', () => {
  const a = new FluidSolver(), b = new FluidSolver();
  a.pour(1, 1);
  for (let frame = 0; frame < 60; frame++) b.pour(1 / 60, 1);
  assert.equal(a.count, 1560); assert.equal(a.count, b.count);
  a.pour(1000, 2);
  assert.equal(a.count, a.maxParticles);
  a.pour(1000, 2); assert.equal(a.count, a.maxParticles);
});

test('presets provide different rheological and optical coefficients', () => {
  const fluid = new FluidSolver();
  fluid.setMaterial('honey');
  assert.equal(fluid.viscosity, materials.honey.viscosity);
  assert.ok(fluid.viscosity > materials.water.viscosity * 10);
  assert.ok(materials.milk.opacity > materials.water.opacity);
});

test('gravity and stir affect real particle velocities', () => {
  const fluid = new FluidSolver();
  fluid.gravity = 0;
  fluid.stir();
  assert.ok(fluid.velocities.some(v => Math.abs(v) > .5));
  fluid.step(1 / 60);
  assert.ok(fluid.positions.every(Number.isFinite));
});
