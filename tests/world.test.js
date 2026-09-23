import test from "node:test";
import assert from "node:assert/strict";
import { worldDefaults, worldBounds } from "../src/world.js";
import {
  defaults,
  generateVolume,
  encodeScene,
  raycastVolume,
  sculptVolume,
  sampleVolume,
} from "../src/field.js";
import {
  SIZE,
  MIN,
  MAX,
  CELL,
  BAND,
  SCENE_SCALE,
  ATLAS_SIZE,
  configureDomain,
  terrainDomain,
  footprintLimits,
  insideDetail,
} from "../src/domain.js";
import {
  sampleArea,
  maxSolidChange,
  hydraulicDefaults,
} from "../src/hydraulic-transport.js";
import { createNoiseTerrain } from "../src/noise-terrain.js";
import { makeShape, moveObject, scaleObject } from "../src/shapes.js";
import { generateCellPattern } from "../src/cell-fracture.js";
const p = { ...defaults, ...worldDefaults };
test("kilometre terrain has one complete domain, truthful metre cells and conservative SI ceiling", () => {
  configureDomain(p);
  assert.deepEqual(CELL, [8.0625, 4.0625, 8.0625]);
  assert.deepEqual(ATLAS_SIZE, [2048, 640]);
  assert(insideDetail([450, 200, -450]));
  assert(!insideDetail([600, 200, 0]));
  assert.equal(worldBounds(p).max[1], 301);
  assert.equal(hydraulicDefaults.hydraulicMaxChange, 5);
  assert(maxSolidChange(p, 0.04) * 2 * BAND <= 0.0002);
  assert(sampleArea(p) > 900);
  const d = terrainDomain({
    ...p,
    terrainWidth: 2400,
    terrainLength: 250,
    terrainHeight: 900,
  });
  assert(d.max[0] - d.min[0] > 2400);
  assert(d.max[2] - d.min[2] > 250);
  assert(d.max[1] > 900);
  const [lo, hi] = footprintLimits(d);
  assert(lo <= hi);
  assert(hi / Math.min(...d.cell) <= 3.800001);
  assert.throws(() => terrainDomain({ ...p, terrainWidth: NaN }), /finite/);
  assert.throws(() => terrainDomain({ ...p, terrainHeight: -10 }), /positive/);
});
test("generation samples global XYZ once, far picks/sculpt work, export includes the entire volume", async () => {
  const a = generateVolume({ ...p, worldOrigin: [192, 40, 96] }),
    f = createNoiseTerrain(p);
  for (const q of [
    [15, 22, 15],
    [106, 16, 90],
    [60, 40, 40],
  ]) {
    const xyz = q.map((v, k) => MIN[k] + (v + 0.5) * CELL[k]),
      i = ((q[2] * SIZE[1] + q[1]) * SIZE[0] + q[0]) * 4;
    assert(Math.abs(a[i] - f(...xyz)) < 0.001);
  }
  const hit = raycastVolume(a, [350, MAX[1] + 200, 300], [0, -1, 0]);
  assert(hit);
  assert(hit[0] > 300);
  const edited = sculptVolume(a, hit, Math.max(...CELL) * 3, "carve");
  assert(sampleVolume(edited, hit) > sampleVolume(a, hit) + 10);
  const bytes = await encodeScene(edited, p, {}, 0).arrayBuffer();
  const length = new Uint32Array(bytes, 0, 2)[1],
    header = JSON.parse(new TextDecoder().decode(bytes.slice(8, 8 + length)));
  assert.equal(header.world.model, "whole-terrain-sdf-v1");
  assert.equal(header.world.activeAreaOnly, false);
  assert.deepEqual(header.world.origin, [0, 0, 0]);
  assert.deepEqual(header.bounds, { min: MIN, max: MAX });
  assert.equal(bytes.byteLength, 8 + length + edited.byteLength);
  assert.deepEqual(header.world.cellMetres, CELL);
});
test("shape G/S, path translation and intact fracture use distant tall-domain coordinates", () => {
  configureDomain({
    ...p,
    terrainWidth: 1800,
    terrainLength: 500,
    terrainHeight: 700,
  });
  const n = makeShape("far");
  moveObject(n, p, [700, 500, 180]);
  assert.deepEqual(n.position, [700, 500, 180]);
  scaleObject(n, p, [15, 20, 15]);
  assert(n.size[0] > 20);
  assert(n.size[1] > 20);
  const route = {
    type: "water",
    points: [
      [300, 250, 20],
      [500, 200, 80],
    ],
    width: 35,
  };
  moveObject(route, p, [500, 295, 70]);
  assert.deepEqual(route.points[0], [400, 320, 40]);
  const pattern = generateCellPattern(
    [{ point: [600, 300, 150], view: [0, -1, 0], radius: 4 * SCENE_SCALE }],
    {
      size: 4.5 * SCENE_SCALE,
      depth: 18 * SCENE_SCALE,
      gap: 0.014,
      intact: true,
    },
  );
  assert(pattern.sites.length > 0);
  assert.equal(pattern.gap, 0.014);
  assert(pattern.sites.some((q) => q[0] > 500));
  configureDomain({ preset: 3 });
  assert.deepEqual(CELL, [0.25, 0.3, 0.25]);
});
