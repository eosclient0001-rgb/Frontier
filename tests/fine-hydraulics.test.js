import test from "node:test";
import assert from "node:assert/strict";
import { erosionResolution } from "../src/erosion-resolution.js";
import { terrainDomain } from "../src/domain.js";
import { encodeScene, defaults } from "../src/field.js";
test("hydraulic kernel stays in physical metres when the world grows", () => {
  for (const width of [1000, 2000, 4000])
    for (const cell of [0.25, 0.5, 1]) {
      const r = erosionResolution(
        { hydraulicShaping: true, hydraulicCell: cell },
        terrainDomain({
          worldEnabled: true,
          terrainWidth: width,
          terrainLength: width,
        }),
      );
      assert.equal(r.adaptiveActive, true);
      assert.deepEqual(r.cell, [cell, cell, cell]);
      assert.deepEqual(r.supportDiameter, [3 * cell, 3 * cell, 3 * cell]);
    }
});
test("version 3 export contains complete sparse arrays, with explicit payload offsets", async () => {
  const base = new Float32Array([0, 0, 0, 0.5]),
    fine = {
      layout: { capacity: 16, cell: 0.5 },
      domain: terrainDomain(),
      limit: 4,
      keys: new Float32Array(64),
      values: new Float32Array(32768),
      materials: new Float32Array(32768),
    };
  fine.values[123] = 0.123;
  fine.materials[234] = 0.456;
  const bytes = await encodeScene(base, defaults, {}, 0, fine).arrayBuffer(),
    n = new DataView(bytes).getUint32(4, true),
    h = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 8, n)));
  assert.equal(h.version, 3);
  assert.equal(h.refinement.layout.cell, 0.5);
  for (const section of h.refinement.sections) {
    const restored = new Float32Array(
      bytes.slice(
        8 + n + section.offset,
        8 + n + section.offset + section.length,
      ),
    );
    assert.deepEqual(restored, fine[section.name]);
  }
});
