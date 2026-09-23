import test from "node:test";
import assert from "node:assert/strict";
import { defaults, baseSDF, encodeScene, SIZE } from "../src/field.js";
import { waterUniformValues, effectiveWaveHeight } from "../src/water.js";

test("water uniforms stay finite, use shared route settings, and bound wave steepness", () => {
  const u = waterUniformValues({
    ...defaults,
    riverSpeed: 5,
    riverOffset: 2,
    foamAmount: 0,
  });
  assert.equal(u.waterShape, undefined);
  assert.equal(u.waterFoam[0], 0);
  assert.equal(u.waterFoam[3], 1);
  assert.equal(waterUniformValues({ riverEnabled: false }).waterFoam[3], 0);
  assert.ok(Object.values(u).flat().every(Number.isFinite));
  assert.equal(effectiveWaveHeight(0, 3), 0);
  assert.ok(effectiveWaveHeight(0.35, 1.5) <= 1.5 * 0.15);
});
test("water parameters survive the existing scene export", async () => {
  const settings = {
    ...defaults,
    waveHeight: 0.2,
    foamAmount: 0.8,
  };
  const volume = new Float32Array(SIZE.reduce((a, b) => a * b, 4));
  const data = await encodeScene(
    volume,
    settings,
    { target: [0, 4, 0] },
    0,
  ).arrayBuffer();
  const n = new DataView(data).getUint32(4, true),
    header = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 8, n)));
  assert.equal(header.settings.waveHeight, 0.2);
  assert.equal(header.settings.foamAmount, 0.8);
});
