import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';

const idle = { read: () => ({ throttle: 0.6, brake: 0, steer: 0, hb: false, nitro: false }), endFrame() {} };

test('a new run starts in menu state and does not advance the clock', () => {
  const g = new Game();
  g.newRun(5);
  assert.equal(g.state, 'menu');
  const before = g.clock;
  g.update(1 / 60, idle);
  assert.equal(g.clock, before);
});

test('the clock runs out and the run ends', () => {
  const g = new Game();
  g.newRun(11);
  g.start();
  for (let i = 0; i < 60 * 80 && g.state === 'play'; i++) g.update(1 / 60, idle);
  assert.equal(g.state, 'over');
  assert.equal(g.clock, 0);
});

test('pause freezes the simulation', () => {
  const g = new Game();
  g.newRun(3);
  g.start();
  g.update(1 / 60, idle);
  g.togglePause();
  const d = g.dist;
  const t = g.clock;
  for (let i = 0; i < 120; i++) g.update(1 / 60, idle);
  assert.equal(g.dist, d);
  assert.equal(g.clock, t);
});
