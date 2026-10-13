import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, DT } from '../src/sim/vehicle.js';
import { Route } from '../src/world/route.js';
import { queryRoad } from '../src/sim/surface.js';

// Real road under the car: a straight opening block from a fixed seed.
const route = new Route(1);
const surf = (x, y, z, hint) => queryRoad(route, x, y, z, hint);

function start(v, speed) {
  const first = route.sections[0];
  v.placeOn({ sec: first }, 20, 7.3);
  v.vx = speed;
}

function run(v, seconds, inp) {
  for (let i = 0; i < seconds / DT; i++) v.step(DT, inp, surf);
}

test('car accelerates on the straight and stays on the road', () => {
  const v = new Vehicle();
  start(v, 0);
  run(v, 6, { throttle: 1, brake: 0, steer: 0, hb: false, nitro: false });
  assert.ok(v.vx > 40, `speed after 6 s: ${v.vx}`);
  assert.ok(Number.isFinite(v.x) && Number.isFinite(v.z));
});

test('steady steering produces a bounded circle without spinning out', () => {
  const v = new Vehicle();
  start(v, 20);
  run(v, 4, { throttle: 0.6, brake: 0, steer: 0.21, hb: false, nitro: false });
  assert.ok(Math.abs(v.r) < 0.6, `yaw rate ${v.r}`);
  assert.ok(v.speed > 15);
});

test('braking decelerates the car', () => {
  const v = new Vehicle();
  start(v, 30);
  run(v, 1, { throttle: 0, brake: 1, steer: 0, hb: false, nitro: false });
  assert.ok(v.vx < 22, `speed after braking: ${v.vx}`);
});
