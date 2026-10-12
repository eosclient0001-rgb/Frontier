import { describe, expect, it } from 'vitest';
import {
  chainHandles,
  closestOnSamples,
  convexHull,
  intersectSamples,
  sampleAtU,
  sampleBezier,
  sampleLength,
  sliceSamples,
} from '../src/model/geometry';
import type { CubicBezier } from '../src/model/geometry';

const straight: CubicBezier = {
  p0: { x: 0, z: 0 },
  c1: { x: 100 / 3, z: 0 },
  c2: { x: 200 / 3, z: 0 },
  p3: { x: 100, z: 0 },
};

describe('sampleBezier', () => {
  it('collapses a straight line to its end points but keeps the true length', () => {
    const s = sampleBezier(straight, 0.5);
    expect(s.length).toBe(2);
    expect(sampleLength(s)).toBeCloseTo(100, 3);
    expect(s[0].x).toBe(0);
    expect(s[s.length - 1].x).toBe(100);
  });

  it('gives left normals that point +z for travel along +x', () => {
    const s = sampleBezier(straight, 1);
    // Travelling +x, left-hand normal is (-tz, tx) = (0, 1) in (x,z) => +z.
    const mid = sampleAtU(s, 0.5);
    expect(mid.nx).toBeCloseTo(0, 6);
    expect(mid.nz).toBeCloseTo(1, 6);
  });

  it('keeps more samples on curves than on straights', () => {
    const k = 0.5523 * 100;
    const arc: CubicBezier = { p0: { x: 100, z: 0 }, c1: { x: 100, z: k }, c2: { x: k, z: 100 }, p3: { x: 0, z: 100 } };
    expect(sampleBezier(arc, 0.5).length).toBeGreaterThan(10);
  });

  it('measures a quarter circle-ish curve close to its analytic length', () => {
    // Cubic approximation of a quarter circle of radius 100.
    const k = 0.5523 * 100;
    const arc: CubicBezier = {
      p0: { x: 100, z: 0 },
      c1: { x: 100, z: k },
      c2: { x: k, z: 100 },
      p3: { x: 0, z: 100 },
    };
    const s = sampleBezier(arc, 0.5);
    expect(sampleLength(s)).toBeCloseTo((Math.PI / 2) * 100, 0);
    // Every kept sample must sit on the true curve within the tolerance.
    for (const p of s) expect(Math.abs(Math.hypot(p.x, p.z) - 100)).toBeLessThan(0.1);
  });
});

describe('sampleAtU / sliceSamples', () => {
  it('interpolates positions by arc length', () => {
    const s = sampleBezier(straight, 0.5);
    expect(sampleAtU(s, 0.25).x).toBeCloseTo(25, 2);
    expect(sampleAtU(s, 1.5).x).toBeCloseTo(100, 6); // clamped
  });

  it('slices a sub-range with interpolated end points', () => {
    const s = sampleBezier(straight, 0.5);
    const piece = sliceSamples(s, 10, 13);
    expect(piece[0].x).toBeCloseTo(10, 2);
    expect(piece[piece.length - 1].x).toBeCloseTo(13, 2);
    expect(sliceSamples(s, 50, 50)).toEqual([]);
  });
});

describe('closestOnSamples', () => {
  it('returns the signed lateral offset (+ left) and the fraction along the curve', () => {
    const s = sampleBezier(straight, 0.5);
    // A point 3 m to the left (+z) of the road at x = 40.
    const r = closestOnSamples(s, { x: 40, z: 3 });
    expect(r.u).toBeCloseTo(0.4, 2);
    expect(r.lateral).toBeCloseTo(3, 2);
    expect(r.distance).toBeCloseTo(3, 2);
  });
});

describe('intersectSamples', () => {
  it('finds a crossing between two perpendicular roads', () => {
    const a = sampleBezier(straight, 0.5);
    const b = sampleBezier(
      { p0: { x: 50, z: -50 }, c1: { x: 50, z: -16 }, c2: { x: 50, z: 16 }, p3: { x: 50, z: 50 } },
      0.5,
    );
    const hits = intersectSamples(a, b);
    expect(hits.length).toBe(1);
    expect(hits[0].uA).toBeCloseTo(0.5, 2);
    expect(hits[0].uB).toBeCloseTo(0.5, 2);
  });
});

describe('convexHull', () => {
  it('drops interior points and returns counter-clockwise order', () => {
    const hull = convexHull([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
      { x: 0, z: 10 },
      { x: 5, z: 5 },
      { x: 5, z: 0 },
    ]);
    expect(hull.length).toBe(4);
    // Signed area positive => CCW.
    let area = 0;
    for (let i = 0; i < hull.length; i++) {
      const p = hull[i];
      const q = hull[(i + 1) % hull.length];
      area += p.x * q.z - q.x * p.z;
    }
    expect(area).toBeGreaterThan(0);
  });
});

describe('chainHandles', () => {
  it('produces a smooth bezier through a collinear chain', () => {
    const pts = [
      { x: 0, z: 0 },
      { x: 50, z: 0 },
      { x: 100, z: 0 },
    ];
    const h = chainHandles(pts, 0);
    expect(h.c1.x).toBeCloseTo(50 / 3, 4);
    expect(h.c1.z).toBeCloseTo(0, 6);
    expect(h.c2.x).toBeCloseTo(50 - 50 / 3, 4);
  });
});
