import { describe, expect, it } from "vitest";
import { generateWithReport } from "../src/core/generator";
import { buildNetwork, networkStats } from "../src/core/topology";
import { validateNetwork } from "../src/core/validate";
import { buildWorld } from "../src/mesh/worldBuilder";
import { parseProject } from "../src/core/model";

describe("generator", () => {
  for (const seed of [1, 2024]) {
    it(`seed ${seed}: builds a clean network with every crossing type`, () => {
      const { project, report } = generateWithReport(seed);
      const net = buildNetwork(project.roads);
      const issues = validateNetwork(net);
      console.log(`seed ${seed}`, JSON.stringify(report), networkStats(net));
      expect(issues.filter((i) => i.kind === "overlap")).toHaveLength(0);
      expect(net.crossings.filter((c) => c.kind === "grade").length).toBeGreaterThan(0);
      expect(net.crossings.filter((c) => c.kind === "level").length).toBeGreaterThan(0);
      expect(net.edges.some((e) => e.bridges.length > 0)).toBe(true);
      expect(net.nodes.some((n) => n.incident.length >= 3)).toBe(true);
      expect(new Set(project.roads.map((r) => r.seed)).size).toBe(project.roads.length);
    }, 60000);
  }

  it("round-trips through JSON and builds a finite world", () => {
    const { project } = generateWithReport(7);
    const again = parseProject(JSON.stringify(project));
    expect(again.roads).toHaveLength(project.roads.length);
    const world = buildWorld(again);
    for (const [key, g] of world.geometries) {
      const pos = g.getAttribute("position").array as Float32Array;
      for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) throw new Error(`NaN in ${key}`);
    }
    expect(world.geometries.get("asphalt")!.getAttribute("position").count).toBeGreaterThan(1000);
  }, 120000);
});
