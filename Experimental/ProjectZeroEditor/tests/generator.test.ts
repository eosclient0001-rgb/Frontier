import { describe, expect, it } from 'vitest';
import { DEFAULT_CITY, generateCity, mulberry32 } from '../src/model/generator';
import { validateNetwork } from '../src/model/network';
import { layoutBands } from '../src/model/profile';
import { TEMPLATES } from '../src/model/profile';

const small = { width: 720, depth: 720, block: 120 };

describe('city generator', () => {
  it('is deterministic for a seed', () => {
    const a = generateCity({ ...small, seed: 7 });
    const b = generateCity({ ...small, seed: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = generateCity({ ...small, seed: 8 });
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });

  it('produces a valid network with every requested road type', () => {
    const net = generateCity({ ...small, seed: 3 });
    expect(validateNetwork(net)).toEqual([]);
    const classes = new Set(Object.values(net.segments).map((s) => s.cls));
    for (const c of ['highway', 'arterial', 'boulevard', 'local', 'path', 'rail', 'subway']) {
      expect(classes.has(c as never), c).toBe(true);
    }
    const kinds = new Set(Object.values(net.props).map((p) => p.kind));
    for (const k of ['crosswalk', 'stopLine', 'railCrossing', 'bollard', 'subwayEntrance']) {
      expect(kinds.has(k as never), k).toBe(true);
    }
  });

  it('puts bus, bike and parking lanes on the right streets', () => {
    const net = generateCity({ ...small, seed: 11 });
    const lanes = (cls: string) =>
      new Set(
        Object.values(net.segments)
          .filter((s) => s.cls === cls)
          .flatMap((s) => [...s.profile.left, ...s.profile.right].map((l) => l.type)),
      );
    expect(lanes('arterial').has('bus')).toBe(true);
    expect(lanes('boulevard').has('bike')).toBe(true);
    expect(lanes('boulevard').has('parking')).toBe(true);
    expect(lanes('local').has('parking')).toBe(true);
  });

  it('switches options off cleanly', () => {
    const net = generateCity({
      ...small,
      seed: 5,
      busLanes: false,
      bikeLanes: false,
      parking: false,
      pedestrianPaths: false,
      railway: false,
      subway: false,
      speedBumps: false,
    });
    const types = new Set(
      Object.values(net.segments).flatMap((s) => [...s.profile.left, ...s.profile.right].map((l) => l.type)),
    );
    expect(types.has('bus')).toBe(false);
    expect(types.has('bike')).toBe(false);
    expect(Object.values(net.segments).some((s) => s.cls === 'rail')).toBe(false);
    expect(Object.values(net.props).some((p) => p.kind === 'speedBump')).toBe(false);
  });

  it('keeps the default large map within a practical size budget', () => {
    const net = generateCity(DEFAULT_CITY);
    expect(Object.keys(net.segments).length).toBeGreaterThan(1000);
    expect(Object.keys(net.segments).length).toBeLessThan(20000);
  });

  it('prng is in [0,1) and reproducible', () => {
    const r = mulberry32(42);
    const xs = Array.from({ length: 1000 }, () => r());
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mulberry32(42)()).toBe(mulberry32(42)());
  });
});

describe('lane profiles', () => {
  it('lays out bands without gaps and with ascending offsets', () => {
    for (const t of TEMPLATES) {
      const bands = layoutBands(t.profile());
      for (let i = 1; i < bands.length; i++) {
        expect(bands[i].lo, `${t.id} gap at ${i}`).toBeCloseTo(bands[i - 1].hi, 6);
      }
      for (const b of bands) expect(b.hi).toBeGreaterThan(b.lo);
    }
  });
});
