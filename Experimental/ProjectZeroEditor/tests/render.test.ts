import { describe, expect, it } from 'vitest';
import { MeshBatch } from '../src/render/batch';
import { buildSegment, buildProp } from '../src/render/roadBuilder';
import { sampleBezier } from '../src/model/geometry';
import { addRoadChain, createEmptyNetwork, addProp, segmentBezier } from '../src/model/network';
import { defaultTemplateFor } from '../src/model/profile';
import { ChunkedRoadWorld } from '../src/render/world';

describe('MeshBatch', () => {
  it('a box has 12 triangles and unit normals', () => {
    const b = new MeshBatch();
    b.orientedBox([0, 0, 0], [0, 1], { r: 1, up: 1, f: 1 }, 0xffffff);
    expect(b.triangleCount).toBe(12);
    for (let i = 0; i < b.normals.length; i += 3) {
      const l = Math.hypot(b.normals[i], b.normals[i + 1], b.normals[i + 2]);
      expect(l).toBeCloseTo(1, 5);
    }
  });

  it('a cylinder has sides*3 triangles (quads + caps)', () => {
    const b = new MeshBatch();
    b.cylinder([0, 0, 0], 1, 1, 8, 0);
    expect(b.triangleCount).toBe(8 * 3);
  });

  it('degenerate triangles are dropped', () => {
    const b = new MeshBatch();
    b.tri([0, 0, 0], [1, 0, 0], [2, 0, 0], 0);
    expect(b.isEmpty()).toBe(true);
  });
});

describe('road geometry', () => {
  it('every template produces geometry', () => {
    const net = createEmptyNetwork();
    const pts = [
      { x: 0, z: 0 },
      { x: 120, z: 30 },
    ];
    for (const cls of ['highway', 'arterial', 'boulevard', 'local', 'path', 'rail', 'subway'] as const) {
      const t = defaultTemplateFor(cls);
      const [seg] = addRoadChain(net, pts, [null, null], cls, t.profile());
      const batch = new MeshBatch();
      buildSegment(batch, seg, sampleBezier(segmentBezier(net, seg), 0.5));
      expect(batch.triangleCount, cls).toBeGreaterThan(0);
    }
  });

  it('every prop kind produces geometry', () => {
    const net = createEmptyNetwork();
    const [seg] = addRoadChain(net, [{ x: 0, z: 0 }, { x: 100, z: 0 }], [null, null], 'arterial', defaultTemplateFor('arterial').profile());
    const samples = sampleBezier(segmentBezier(net, seg), 0.5);
    for (const kind of ['bollard', 'speedBump', 'railCrossing', 'crosswalk', 'stopLine', 'subwayEntrance'] as const) {
      const p = addProp(net, seg.id, 0.5, kind, 0);
      const batch = new MeshBatch();
      buildProp(batch, p, seg, samples);
      expect(batch.triangleCount, kind).toBeGreaterThan(0);
    }
  });

  it('the chunked world only rebuilds chunks that changed', () => {
    const net = createEmptyNetwork();
    const world = new ChunkedRoadWorld(400);
    addRoadChain(net, [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 200, z: 0 }], [null, null, null], 'local', defaultTemplateFor('local').profile());
    expect(world.sync(net)).toBeGreaterThan(0);
    expect(world.sync(net)).toBe(0); // nothing changed
    const far = addRoadChain(net, [{ x: 2000, z: 2000 }, { x: 2100, z: 2000 }], [null, null], 'local', defaultTemplateFor('local').profile());
    expect(world.sync(net)).toBe(1); // only the new far chunk
    expect(far.length).toBe(1);
    expect(world.stats().chunks).toBeGreaterThanOrEqual(2);
  });
});
