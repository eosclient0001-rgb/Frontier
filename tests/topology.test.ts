import { describe, expect, it } from "vitest";
import { buildNetwork, GRADE_SEPARATION } from "../src/core/topology";
import { buildJunctions } from "../src/core/junction";
import { makeRoad } from "./helpers";

describe("topology", () => {
  it("merges a plus-shaped crossing at equal height into one four-way node", () => {
    const net = buildNetwork([
      makeRoad("h", [[-120, 0], [120, 0]]),
      makeRoad("v", [[0, -120], [0, 120]])
    ]);
    const fourWay = net.nodes.filter((n) => n.incident.length === 4);
    expect(fourWay).toHaveLength(1);
    expect(net.edges).toHaveLength(4);
    expect(Math.hypot(fourWay[0].x, fourWay[0].z)).toBeLessThan(1);
  });

  it("creates a T node when an endpoint lands on another road body", () => {
    const net = buildNetwork([
      makeRoad("main", [[-150, 0], [150, 0]]),
      makeRoad("stem", [[0, 60], [0, 1.5]])
    ]);
    const three = net.nodes.filter((n) => n.incident.length === 3);
    expect(three).toHaveLength(1);
    expect(net.edges).toHaveLength(3);
  });

  it("merges three endpoints that meet within the merge radius into a Y", () => {
    const net = buildNetwork([
      makeRoad("a", [[-100, 0], [0, 0]]),
      makeRoad("b", [[100, 60], [0.8, 0.5]]),
      makeRoad("c", [[0.4, -80], [-0.3, 0.2]])
    ]);
    const degrees = net.nodes.map((n) => n.incident.length).sort();
    expect(degrees).toContain(3);
    expect(net.nodes.filter((n) => n.incident.length >= 3)).toHaveLength(1);
  });

  it("keeps grade-separated crossings apart (no shared node)", () => {
    const net = buildNetwork([
      makeRoad("ground", [[-120, 0], [120, 0]], "avenue"),
      makeRoad("elevated", [[0, -120, 9], [0, 0, 9], [0, 120, 9]], "motorway")
    ]);
    expect(net.crossings.filter((c) => c.kind === "grade")).toHaveLength(1);
    expect(net.nodes.every((n) => n.incident.length === 1)).toBe(true);
    expect(net.edges.length).toBeGreaterThanOrEqual(2);
  });

  it("classifies a small lift difference as at-grade (below the separation threshold)", () => {
    const net = buildNetwork([
      makeRoad("a", [[-120, 0], [120, 0]]),
      makeRoad("b", [[0, -120, 1], [0, 0, 1], [0, 120, 1]])
    ]);
    expect(GRADE_SEPARATION).toBeGreaterThan(1);
    expect(net.nodes.filter((n) => n.incident.length === 4)).toHaveLength(1);
  });

  it("splits a road that crosses itself into shared nodes", () => {
    const net = buildNetwork([makeRoad("loop", [[-80, -80], [80, 80], [80, -80], [-80, 80]])]);
    expect(net.nodes.some((n) => n.incident.length === 4)).toBe(true);
  });

  it("produces edges whose endpoints match their node positions", () => {
    const net = buildNetwork([
      makeRoad("h", [[-120, 3], [120, 3]]),
      makeRoad("v", [[5, -120], [5, 120]])
    ]);
    for (const e of net.edges) {
      const na = net.nodeMap.get(e.a)!;
      const nb = net.nodeMap.get(e.b)!;
      expect(Math.hypot(e.pts[0].x - na.x, e.pts[0].z - na.z)).toBeLessThan(1e-6);
      expect(Math.hypot(e.pts[e.pts.length - 1].x - nb.x, e.pts[e.pts.length - 1].z - nb.z)).toBeLessThan(1e-6);
    }
  });
});

function segmentsCross(a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }, d: { x: number; z: number }): boolean {
  const o = (p: typeof a, q: typeof a, r: typeof a) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

describe("junctions", () => {
  it("produces a simple junction ring for a plus crossing", () => {
    const net = buildNetwork([makeRoad("h", [[-120, 0], [120, 0]]), makeRoad("v", [[0, -120], [0, 120]])]);
    const j = buildJunctions(net);
    // Four dead-end caps plus the central four-way junction.
    expect(j.patches).toHaveLength(5);
    const ring = j.patches.find((p) => net.nodeMap.get(p.nodeId)!.incident.length === 4)!.ring;
    expect(ring.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < ring.length; i++) {
      for (let k = i + 2; k < ring.length; k++) {
        if (i === 0 && k === ring.length - 1) continue;
        expect(segmentsCross(ring[i], ring[(i + 1) % ring.length], ring[k], ring[(k + 1) % ring.length])).toBe(false);
      }
    }
  });

  it("gives every incident road end a cap on both sides", () => {
    const net = buildNetwork([makeRoad("h", [[-120, 0], [120, 0]]), makeRoad("v", [[0, -120], [0, 120]])]);
    const j = buildJunctions(net);
    for (const e of net.edges) {
      expect(j.caps.get(`${e.id}|a`)).toBeDefined();
      expect(j.caps.get(`${e.id}|b`)).toBeDefined();
    }
  });
});
