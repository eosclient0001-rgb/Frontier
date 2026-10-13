import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Route } from '../src/world/route.js';
import { AHEAD } from '../src/world/constants.js';

test('route generation is deterministic for a seed', () => {
  const a = new Route(123);
  const b = new Route(123);
  assert.equal(a.sections.length, b.sections.length);
  assert.deepEqual(
    a.sections.map((s) => [s.kind, Math.round(s.len)]),
    b.sections.map((s) => [s.kind, Math.round(s.len)]),
  );
});

test('route extends ahead of the car and prunes behind it', () => {
  const r = new Route(7);
  r.extendTo(AHEAD + 500);
  assert.ok(r.frontDist >= AHEAD + 500);
  r.prune(3000);
  // sections far behind the car are dropped unless they are still open ends of the graph
  for (const s of r.sections) assert.ok(s.dist0 + s.len >= 3000 - 420 - 1 || r.st.openEnds.includes(s));
});

test('sections are contiguous with their successors', () => {
  const r = new Route(99);
  r.extendTo(2500);
  let checked = 0;
  for (const s of r.sections) {
    for (const n of s.next) {
      const dx = n.px[0] - s.px[s.n - 1];
      const dz = n.pz[0] - s.pz[s.n - 1];
      assert.ok(Math.hypot(dx, dz) < 2.5, `gap ${Math.hypot(dx, dz).toFixed(2)} m between ${s.id} and ${n.id}`);
      checked++;
    }
  }
  assert.ok(checked > 0);
});

test('rails reference sections that carry them', () => {
  const r = new Route(2024);
  r.extendTo(3000);
  for (const rail of r.rails) assert.ok(rail.section.rails.includes(rail));
});
