import test from "node:test";
import assert from "node:assert/strict";
import {
  erosionTiming,
  acceleratedSolidChange,
  kernelBounds,
  performancePresets,
} from "../src/erosion-performance.js";
import { terrainDomain } from "../src/domain.js";
import { maxSolidChange } from "../src/hydraulic-transport.js";
const world = terrainDomain({ worldEnabled: true }),
  local = terrainDomain({});
test("time-lapse is bounded, uses small collision steps and respects fine/non-square grids", () => {
  for (const d of [
    world,
    local,
    terrainDomain({
      worldEnabled: true,
      terrainWidth: 2000,
      terrainLength: 12,
      terrainHeight: 450,
    }),
  ])
    for (const value of [NaN, Infinity, -4, 1, 4, 8, 900]) {
      const t = erosionTiming({ timeLapse: value }, d);
      assert(t.dt >= 0.04 && t.dt <= 0.32);
      assert(t.substeps >= 4 && t.substeps <= 32);
      assert(t.dt / t.substeps <= 0.01000001);
      assert(t.dt <= Math.max(0.04, Math.min(...d.cell) / 12));
    }
  assert.equal(erosionTiming(performancePresets.fast, world).effective, 4);
  assert.equal(erosionTiming(performancePresets.rapid, world).effective, 8);
  assert.equal(erosionTiming(performancePresets.rapid, local).effective, 1);
});
test("rain presets advance time without inflating the physical per-second change ceiling", () => {
  assert.equal(
    acceleratedSolidChange({}, world),
    maxSolidChange({}, 0.04, world.band, Math.min(...world.cell)),
  );
  const normal = acceleratedSolidChange({}, world),
    fast = acceleratedSolidChange(performancePresets.fast, world);
  assert.equal(fast, normal * 4);
  assert(fast * world.band * 2 <= 0.01 * Math.min(...world.cell));
  assert(
    acceleratedSolidChange(
      { ...performancePresets.rapid, hydraulicMaxChange: 200 },
      local,
    ) *
      2 *
      local.band <=
      0.01 * Math.min(...local.cell),
  );
  assert.equal(erosionTiming({ weatheringRate: Infinity }, world).exposure, 1);
});
test("tight voxel support contains every positive kernel weight of the old 9-cubed gather", () => {
  let worstDefault = 0;
  for (const d of [
    world,
    local,
    terrainDomain({
      worldEnabled: true,
      terrainWidth: 1800,
      terrainLength: 400,
      terrainHeight: 450,
    }),
  ])
    for (let n = 0; n < 25; n++) {
      const p = d.min.map(
        (v, k) =>
          v + (n === 0 ? 0.5 : 30.137 + n * 0.713 + k * 0.29) * d.cell[k],
      );
      const r = Math.max(0.38, Math.min(...d.cell)) * (n % 4 === 0 ? 3.7 : 1.2),
        b = kernelBounds(p, r, d);
      const center = p.map((v, k) => Math.floor((v - d.min[k]) / d.cell[k]));
      for (let z = -4; z <= 4; z++)
        for (let y = -4; y <= 4; y++)
          for (let x = -4; x <= 4; x++) {
            const q = [x, y, z].map((v, k) => v + center[k]);
            if (q.some((v, k) => v < 0 || v >= [128, 80, 128][k])) continue;
            const distance = Math.hypot(
              ...q.map(
                (v, k) =>
                  (d.min[k] + (v + 0.5) * d.cell[k] - p[k]) /
                  Math.max(r, d.cell[k] * 0.95),
              ),
            );
            if (distance < 1)
              assert(q.every((v, k) => v >= b.lo[k] && v <= b.hi[k]));
          }
      if (d === world && n % 4 !== 0)
        worstDefault = Math.max(worstDefault, b.visits);
    }
  assert(worstDefault <= 36);
  assert(worstDefault < 729 / 10);
});
