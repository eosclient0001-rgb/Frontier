import test from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  baseSDF,
  generateVolume,
  sampleVolume,
  sculptVolume,
  simulateVolume,
  raycastVolume,
  SIZE,
  MIN,
  MAX,
  encodeScene,
  noise,
} from "../src/field.js";
import { toHalf, fromHalf } from "../src/renderer.js";
let volume;
test("deterministic 3D formation with different seeded geometry", () => {
  assert.equal(baseSDF(-15, 8, 3, defaults), baseSDF(-15, 8, 3, defaults));
  assert.notEqual(
    baseSDF(-15, 8, 3, defaults),
    baseSDF(-15, 8, 3, { ...defaults, seed: 7309 }),
  );
  assert(noise(1.1, 2.2, 3.3) >= 0 && noise(1.1, 2.2, 3.3) <= 1);
});
test("finite volume contains rock, an open canyon, and a lateral cave", () => {
  volume = generateVolume(defaults);
  assert.equal(volume.length, SIZE.reduce((a, b) => a * b) * 4);
  assert(sampleVolume(volume, [-10, 6, 0]) < 0, "solid mesa");
  assert(sampleVolume(volume, [0, 8, 0]) > 0, "open canyon");
  assert(sampleVolume(volume, [-5.9, 3.2, 7]) > 0, "side cave");
  assert(sampleVolume(volume, [-5.9, 8, 7]) < 0, "rock above the cave");
  for (const v of volume) assert(Number.isFinite(v));
});
test("sculpting can carve inside rock and build in empty space", () => {
  const center = [-10, 6, 0];
  const carved = sculptVolume(volume, center, 2, "carve");
  assert(sampleVolume(carved, center) > 1.5);
  assert(sampleVolume(volume, center) < 0, "immutable original");
  const built = sculptVolume(volume, [0, 8, 0], 1.5, "add");
  assert(sampleVolume(built, [0, 8, 0]) < -1);
  const smoothed = sculptVolume(carved, [-8, 6, 0], 2, "smooth");
  assert(smoothed.some((v, i) => i % 4 === 0 && v !== carved[i]));
});
test("surface erosion changes XYZ distances and transports moisture", () => {
  const next = simulateVolume(volume, defaults);
  let wet = 0,
    eroded = 0;
  for (let i = 0; i < next.length; i += 4) {
    if (next[i] > volume[i]) eroded++;
    if (next[i + 1] > 0) wet++;
    assert(Number.isFinite(next[i]));
  }
  assert(eroded > 1000);
  assert(wet > 1000);
  const inert = simulateVolume(volume, {
    ...defaults,
    rainfall: 0,
    erosion: 0,
    thermal: 0,
    wind: 0,
    deposition: 0,
  });
  assert.deepEqual(inert, volume);
});
test("picking intersects the visible 3D surface and misses empty rays", () => {
  const p = raycastVolume(volume, [-10, 30, 0], [0, -1, 0]);
  assert(p && p[1] > 7 && p[1] < 20);
  assert.equal(raycastVolume(volume, [40, 30, 40], [0, 1, 0]), null);
});
test("all presets are bounded and finite", () => {
  for (const preset of [0, 1, 2])
    for (const xyz of [
      [0, 0, 0],
      [0, 10, 0],
      [-8, 6, 5],
      [30, 10, 30],
    ])
      assert(Number.isFinite(baseSDF(...xyz, { ...defaults, preset })));
  for (const xyz of [
    [30, 10, 30],
    [-30, 10, -30],
    [0, 30, 0],
  ])
    assert(baseSDF(...xyz, defaults) > 0);
});
test("GPU half precision conversion round trips signed values", () => {
  for (const v of [-20, -1, -0.25, 0, 0.00001, 0.1, 1, 8, 35])
    assert(
      Math.abs(fromHalf(toHalf(v)) - v) <= Math.max(0.001, Math.abs(v) * 0.001),
    );
});
test("export includes format, bounds, channels and raw float volume", async () => {
  const bytes = await encodeScene(
    volume,
    defaults,
    { yaw: 0.4 },
    7,
  ).arrayBuffer();
  const view = new DataView(bytes);
  assert.equal(view.getUint32(0, true), 0x46534446);
  const len = view.getUint32(4, true);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(bytes, 8, len)),
  );
  assert.equal(header.format, "frontier-sdf");
  assert.equal(header.version, 2);
  assert.equal(header.channels[3], "solidFraction");
  assert.equal(header.particleStateIncluded, false);
  assert.equal(header.materialLayersIncluded, false);
  assert.equal(header.fractureDetailsIncluded, true);
  assert.deepEqual(header.dimensions, SIZE);
  assert.deepEqual(header.bounds, { min: MIN, max: MAX });
  assert.equal(header.iterations, 7);
  assert.equal(bytes.byteLength, 8 + len + volume.byteLength);
});
