import { test } from 'node:test';
import assert from 'node:assert/strict';
import { obbCollide } from '../src/sim/collide.js';
import { Game } from '../src/game.js';
import { CAR } from '../src/sim/vehicle.js';

const HL = 2.3;
const HW = 0.95;

test('boxes touch nose-to-tail at 4.6 m and not before', () => {
  assert.equal(obbCollide(0, 0, 0, HL, HW, 4.6 + 0.01, 0, 0, HL, HW).hit, false);
  assert.equal(obbCollide(0, 0, 0, HL, HW, 4.6 - 0.05, 0, 0, HL, HW).hit, true);
});

test('side-by-side cars 1.9 m apart do not overlap, 1.6 m apart do', () => {
  assert.equal(obbCollide(0, 0, 0, HL, HW, 0, 1.9 + 0.01, 0, HL, HW).hit, false);
  assert.equal(obbCollide(0, 0, 0, HL, HW, 0, 1.6, 0, HL, HW).hit, true);
});

test('push direction points from the other car toward the player', () => {
  const h = obbCollide(0, 0, 0, HL, HW, 3.0, 0, 0, HL, HW); // other car ahead
  assert.equal(h.hit, true);
  assert.ok(h.n[0] < -0.99 && Math.abs(h.n[1]) < 1e-9, `n=${h.n}`);
  assert.ok(Math.abs(h.depth - 1.6) < 1e-9);
});

test('rotated boxes are tested in their own orientation', () => {
  // player heads along +x. A car 3.5 m ahead-and-across overlaps when aligned, but not when turned 90 degrees
  const aligned = obbCollide(0, 0, 0, HL, HW, 3.5, 0, 0, HL, HW);
  const turned = obbCollide(0, 0, 0, HL, HW, 3.5, 0, Math.PI / 2, HL, HW);
  assert.equal(aligned.hit, true);
  assert.equal(turned.hit, false);
});

test('player contact with a traffic car clears the overlap and slows a fast closing car', () => {
  const g = new Game();
  g.newRun(31);
  g.start();
  const v = g.vehicle;
  v.placeOn({ sec: g.route.sections[0] }, 40, 7.3);
  v.vx = 30;
  v.vy = 0;
  v.r = 0;
  const car = {
    id: 9001, kind: 'car', dir: 1, dead: false, kick: 0,
    x: v.x + Math.cos(v.yaw) * 4.0, z: v.z + Math.sin(v.yaw) * 4.0, yaw: v.yaw, speed: 10,
  };
  g.traffic.agents.push(car);
  g._frameCollisions(1 / 60);
  const still = obbCollide(v.x, v.z, v.yaw, CAR.halfL, CAR.halfW, car.x, car.z, car.yaw, HL, HW);
  assert.equal(still.hit, false, 'overlap must be resolved');
  assert.ok(v.vx < 20, `player speed after impact ${v.vx.toFixed(1)}`);
  assert.ok(v.vx > 12, `player should share the closing speed, got ${v.vx.toFixed(1)}`);
  assert.ok(car.speed > 10.5, `rear-ended car should speed up, got ${car.speed.toFixed(1)}`);
});

test('near miss is awarded for passing a car closely at speed', () => {
  const g = new Game();
  g.newRun(32);
  g.start();
  const v = g.vehicle;
  v.placeOn({ sec: g.route.sections[0] }, 40, 7.3);
  v.vx = 25;
  const before = g.nearMisses;
  // oncoming car in the other carriageway, passing 1 m outside the player's box
  g.traffic.agents.push({ id: 9002, kind: 'car', dir: -1, dead: false, kick: 0, x: v.x + 0.2, z: v.z + 3.0, yaw: v.yaw + Math.PI, speed: 20 });
  g._frameCollisions(1 / 60);
  assert.equal(g.nearMisses, before + 1);
});
