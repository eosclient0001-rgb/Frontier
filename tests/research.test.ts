import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImplicitViscosity } from '../src/viscosity';
import { SurfaceReconstruction } from '../src/reconstruction';
import { FluidSolver } from '../src/physics';

function energy(v: Float32Array) { return v.reduce((sum, x) => sum + x * x, 0); }
function near(a: number, b: number, epsilon = 1e-5) { assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`); }
const cloud = new Float32Array([-.2, .4, 0, .2, .4, 0, 0, .6, .1, 0, .2, -.1, .12, .5, -.2, -.12, .3, .2]);
function viscosityGraph(weight = 3) {
  const solver = new ImplicitViscosity(6);
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
    const x = cloud[3 * i] - cloud[3 * j], y = cloud[3 * i + 1] - cloud[3 * j + 1], z = cloud[3 * i + 2] - cloud[3 * j + 2];
    const r = Math.hypot(x, y, z);
    solver.addPair(i, j, x / r, y / r, z / r, weight);
  }
  return solver;
}

test('implicit viscosity matches the exact two-particle backward Euler solution', () => {
  const solver = new ImplicitViscosity(2);
  solver.addPair(0, 1, 1, 0, 0, 100);
  const v = new Float32Array([1, 2, 0, -1, 2, 0]);
  solver.solve(v, 2, 40, 1e-9);
  near(v[0], 1 / 201); near(v[3], -1 / 201);
  near(v[1], 2); near(v[4], 2);
  assert.ok(solver.relativeResidual < 1e-8);
});

test('implicit viscosity does not damp uniform translation', () => {
  const solver = viscosityGraph(50);
  const v = new Float32Array(Array.from({ length: 6 }, () => [2, -.4, 1]).flat());
  const initial = v.slice(); solver.solve(v, 6);
  assert.deepEqual(v, initial);
});

test('implicit viscosity preserves rigid-body rotation, unlike XSPH averaging', () => {
  const solver = viscosityGraph(30), v = new Float32Array(18);
  for (let i = 0; i < 6; i++) {
    const k = i * 3;
    // omega=(.3, 1, -.4); v=omega cross x, plus translation.
    v[k] = cloud[k + 2] + .4 * cloud[k + 1] + .7;
    v[k + 1] = -.4 * cloud[k] - .3 * cloud[k + 2] - .2;
    v[k + 2] = .3 * cloud[k + 1] - cloud[k] + .1;
  }
  const initial = v.slice(); solver.solve(v, 6, 60, 1e-9);
  v.forEach((x, i) => near(x, initial[i], 1e-6));
});

test('implicit viscosity dissipates energy and conserves linear and angular momentum', () => {
  const solver = viscosityGraph(8);
  const v = new Float32Array(Array.from({ length: 18 }, (_, i) => Math.sin(i * 1.7)));
  const before = v.slice(); const initialEnergy = energy(v);
  solver.solve(v, 6, 60, 1e-10);
  assert.ok(energy(v) < initialEnergy);
  const momentum = (values: Float32Array) => {
    const out = [0, 0, 0, 0, 0, 0];
    for (let k = 0; k < values.length; k += 3) {
      out[0] += values[k]; out[1] += values[k + 1]; out[2] += values[k + 2];
      out[3] += cloud[k + 1] * values[k + 2] - cloud[k + 2] * values[k + 1];
      out[4] += cloud[k + 2] * values[k] - cloud[k] * values[k + 2];
      out[5] += cloud[k] * values[k + 1] - cloud[k + 1] * values[k];
    }
    return out;
  };
  const a = momentum(before), b = momentum(v);
  a.forEach((x, i) => near(x, b[i], 1e-6));
});

test('implicit viscosity approaches the analytical decay under timestep refinement', () => {
  function run(steps: number) {
    const solver = new ImplicitViscosity(2);
    solver.addPair(0, 1, 1, 0, 0, 1 / steps);
    const v = new Float32Array([1, 0, 0, -1, 0, 0]);
    for (let i = 0; i < steps; i++) solver.solve(v, 2, 20, 1e-9);
    return v[0];
  }
  const exact = Math.exp(-2);
  assert.ok(Math.abs(run(120) - exact) < Math.abs(run(30) - exact));
});

function sheet() {
  const p: number[] = [];
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) p.push(x * .1, .7, z * .1);
  return new Float32Array(p);
}

test('PCA reconstruction flattens ellipsoids perpendicular to a planar sheet', () => {
  const p = sheet(), count = p.length / 3, reconstruction = new SurfaceReconstruction(count);
  reconstruction.update(p, count);
  const k = Math.floor(count / 2) * 3;
  const extent = (axis: number) => Math.hypot(reconstruction.axisA[k + axis], reconstruction.axisB[k + axis], reconstruction.axisC[k + axis]);
  assert.ok(extent(1) < extent(0) * .5);
  assert.ok(extent(1) < extent(2) * .5);
});

test('reconstruction is render-only, orthogonal, bounded and volume-normalized', () => {
  const fluid = new FluidSolver(), original = fluid.positions.slice();
  const reconstruction = new SurfaceReconstruction(fluid.maxParticles);
  reconstruction.update(fluid.positions, fluid.count);
  assert.deepEqual(fluid.positions, original);
  const arrays = [reconstruction.axisA, reconstruction.axisB, reconstruction.axisC];
  for (let i = 0; i < fluid.count; i++) {
    const k = i * 3;
    const lengths = arrays.map(a => Math.hypot(a[k], a[k + 1], a[k + 2]));
    assert.ok(lengths.every(n => Number.isFinite(n) && n > .04 && n < .33));
    assert.ok(Math.max(...lengths) / Math.min(...lengths) < 3.00001);
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
      near(arrays[a][k] * arrays[b][k] + arrays[a][k + 1] * arrays[b][k + 1] + arrays[a][k + 2] * arrays[b][k + 2], 0, 1e-7);
    }
    near(4 * Math.PI / 3 * lengths[0] * lengths[1] * lengths[2] * reconstruction.volumeWeight[i], 1 / 265, 1e-8);
  }
});

test('isolated particles remain spherical and the comparison mode restores fixed spheres', () => {
  const p = new Float32Array([0, 1, 0, 1, 1, 1]);
  const reconstruction = new SurfaceReconstruction(2);
  reconstruction.update(p, 2);
  near(reconstruction.axisA[0], .097); near(reconstruction.axisB[1], .097); near(reconstruction.axisC[2], .097);
  assert.deepEqual(reconstruction.positions, p);
  reconstruction.update(p, 2, false);
  near(reconstruction.axisA[0], .155); near(reconstruction.axisB[1], .155); near(reconstruction.axisC[2], .155);
});

test('PCA rendering responds to rotated sheets instead of using world-up flattening', () => {
  const p = sheet();
  for (let k = 0; k < p.length; k += 3) {
    const x = p[k], y = p[k + 1] - .7;
    p[k] = (x - y) / Math.SQRT2; p[k + 1] = .7 + (x + y) / Math.SQRT2;
  }
  const count = p.length / 3, reconstruction = new SurfaceReconstruction(count);
  reconstruction.update(p, count);
  const k = Math.floor(count / 2) * 3;
  const axes = [reconstruction.axisA, reconstruction.axisB, reconstruction.axisC];
  const normalExtent = Math.sqrt(axes.reduce((s, a) => s + ((a[k + 1] - a[k]) / Math.SQRT2) ** 2, 0));
  const tangentExtent = Math.sqrt(axes.reduce((s, a) => s + ((a[k + 1] + a[k]) / Math.SQRT2) ** 2, 0));
  assert.ok(normalExtent < tangentExtent * .5);
});

test('zero timestep is a no-op and invalid timesteps are rejected', () => {
  const fluid = new FluidSolver(), before = fluid.positions.slice();
  fluid.step(0); assert.deepEqual(fluid.positions, before);
  assert.throws(() => fluid.step(NaN), RangeError); assert.throws(() => fluid.step(-1), RangeError);
});

test('vorticity recovery does not invent rotation for an isolated translating particle', () => {
  const fluid = new FluidSolver(); fluid.count = 1; fluid.gravity = 0;
  fluid.positions.set([0, 2, 0]); fluid.velocities.set([1, .2, -.5]); fluid.vorticity = 1;
  fluid.step(1 / 60);
  near(fluid.velocities[0], 1); near(fluid.velocities[1], .2); near(fluid.velocities[2], -.5);
});


test('implicit wall response damps tangential motion without damping the normal component', () => {
  const solver = new ImplicitViscosity(1);
  solver.addWallDrag(0, 1, 3);
  const velocity = new Float32Array([2, -1, 4]);
  solver.solve(velocity, 1, 20, 1e-10);
  near(velocity[0], .5); near(velocity[1], -1); near(velocity[2], 1);
  solver.clear();
  const reset = velocity.slice(); solver.solve(velocity, 1);
  assert.deepEqual(velocity, reset);
});
