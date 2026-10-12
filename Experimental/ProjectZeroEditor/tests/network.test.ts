import { describe, expect, it } from 'vitest';
import {
  addNode,
  addProp,
  addRoadChain,
  createEmptyNetwork,
  moveNode,
  parseNetwork,
  removeNode,
  removeSegment,
  serializeNetwork,
  validateNetwork,
  networkBounds,
} from '../src/model/network';
import { History } from '../src/model/history';
import { defaultTemplateFor } from '../src/model/profile';

const profile = defaultTemplateFor('arterial').profile();

describe('road network editing', () => {
  it('builds a smooth chain and shares nodes when snapping', () => {
    const net = createEmptyNetwork();
    const a = addNode(net, 0, 0, 'a');
    const pts = [
      { x: 0, z: 0 },
      { x: 50, z: 10 },
      { x: 100, z: 0 },
    ];
    const segs = addRoadChain(net, pts, [a.id, null, null], 'arterial', profile);
    expect(segs.length).toBe(2);
    expect(Object.keys(net.nodes).length).toBe(3);
    expect(validateNetwork(net)).toEqual([]);
  });

  it('removing a segment drops its props and orphaned nodes but keeps shared ones', () => {
    const net = createEmptyNetwork();
    const pts = [
      { x: 0, z: 0 },
      { x: 50, z: 0 },
      { x: 100, z: 0 },
    ];
    const [s1, s2] = addRoadChain(net, pts, [null, null, null], 'local', profile);
    addProp(net, s1.id, 0.5, 'speedBump');
    removeSegment(net, s1.id);
    expect(Object.keys(net.props).length).toBe(0);
    expect(net.nodes[s1.from]).toBeUndefined();
    expect(net.nodes[s1.to]).toBeDefined(); // still used by s2
    expect(net.segments[s2.id]).toBeDefined();
  });

  it('removeNode deletes every attached segment', () => {
    const net = createEmptyNetwork();
    const pts = [
      { x: 0, z: 0 },
      { x: 50, z: 0 },
      { x: 100, z: 0 },
    ];
    const [, s2] = addRoadChain(net, pts, [null, null, null], 'local', profile);
    removeNode(net, s2.from);
    expect(net.segments[s2.id]).toBeUndefined();
  });

  it('moving a node carries its handles so the curve shape is preserved', () => {
    const net = createEmptyNetwork();
    const pts = [
      { x: 0, z: 0 },
      { x: 60, z: 0 },
    ];
    const [seg] = addRoadChain(net, pts, [null, null], 'local', profile);
    const before = { ...seg.c1 };
    moveNode(net, seg.from, 0, 20);
    expect(net.segments[seg.id].c1.z).toBeCloseTo(before.z + 20, 6);
  });
});

describe('serialisation and validation', () => {
  it('round-trips through JSON', () => {
    const net = createEmptyNetwork();
    addRoadChain(net, [{ x: 0, z: 0 }, { x: 80, z: 0 }], [null, null], 'boulevard', profile);
    const text = serializeNetwork(net);
    const back = parseNetwork(text);
    expect(back).toEqual(JSON.parse(text));
  });

  it('reports dangling references and bad widths', () => {
    const net = createEmptyNetwork();
    addRoadChain(net, [{ x: 0, z: 0 }, { x: 80, z: 0 }], [null, null], 'local', profile);
    const seg = Object.values(net.segments)[0];
    delete net.nodes[seg.to];
    seg.profile.left[0].width = -1;
    const errors = validateNetwork(net);
    expect(errors.some((e) => e.includes('missing node'))).toBe(true);
    expect(errors.some((e) => e.includes('invalid width'))).toBe(true);
    expect(() => parseNetwork(JSON.stringify(net))).toThrow(/Invalid road network/);
  });

  it('rejects non-JSON input with a readable error', () => {
    expect(() => parseNetwork('{nope')).toThrow(/Not valid JSON/);
  });

  it('computes bounds', () => {
    const net = createEmptyNetwork();
    addNode(net, -5, 3);
    addNode(net, 10, -7);
    expect(networkBounds(net)).toEqual({ minX: -5, minZ: -7, maxX: 10, maxZ: 3 });
  });
});

describe('history', () => {
  it('undoes and redoes snapshots', () => {
    const h = new History();
    let net = createEmptyNetwork();
    h.record(net);
    net = JSON.parse(JSON.stringify(net));
    addNode(net, 1, 1, 'x');
    const undone = h.undo(net);
    expect(undone && Object.keys(undone.nodes).length).toBe(0);
    const redone = h.redo(undone!);
    expect(redone && Object.keys(redone.nodes).length).toBe(1);
  });
});
