import test from "node:test";
import assert from "node:assert/strict";
import {
  canyonCenter,
  canyonTangent,
  canyonBaseHalfWidth,
} from "../src/canyon.js";
import { defaults, baseSDF, encodeScene, SIZE } from "../src/field.js";
import { waterUniformValues, effectiveWaveHeight } from "../src/water.js";

test("canyon width opens the 3D gap monotonically, without removing the bounded bed", () => {
  const narrow = { ...defaults, canyonWidth: 4 },
    wide = { ...defaults, canyonWidth: 12 };
  let changed = 0;
  for (let z = -10; z <= 10; z += 2)
    for (let y = 2; y <= 10; y += 2)
      for (let x = -12; x <= 12; x += 1) {
        const a = baseSDF(x, y, z, narrow),
          b = baseSDF(x, y, z, wide);
        assert.ok(b >= a - 1e-9);
        if (b > a + 0.1) changed++;
      }
  assert.ok(changed > 100);
  assert.ok(baseSDF(0, -1, 0, wide) < 0);
  assert.ok(baseSDF(25, 5, 0, wide) > 0);
});
test("meander and flare have independent meanings, and tangent is the centerline derivative", () => {
  assert.equal(canyonCenter(5, { canyonMeander: 0 }), 0);
  assert.equal(canyonCenter(5, { canyonMeander: 2 }), canyonCenter(5) * 2);
  const numerical =
    (canyonCenter(7 + 0.0001) - canyonCenter(7 - 0.0001)) / 0.0002;
  assert.ok(Math.abs(numerical - canyonTangent(7)) < 1e-7);
  assert.equal(
    canyonBaseHalfWidth(0, { canyonWidth: 10, canyonFlare: 0.2 }),
    5,
  );
  assert.equal(
    canyonBaseHalfWidth(10, { canyonWidth: 10, canyonFlare: 0.2 }),
    7,
  );
  assert.equal(
    baseSDF(5, 4, 3, { ...defaults, preset: 2, canyonWidth: 14 }),
    baseSDF(5, 4, 3, { ...defaults, preset: 2, canyonWidth: 3 }),
  );
});
test("water uniforms stay finite, use shared current/canyon settings, and bound wave steepness", () => {
  const u = waterUniformValues({
    ...defaults,
    canyonWidth: 12,
    canyonMeander: 1.5,
    riverSpeed: 5,
    riverOffset: 2,
    foamAmount: 0,
  });
  assert.equal(u.waterShape[0], 12);
  assert.equal(u.waterShape[1], 1.5);
  assert.equal(u.waterShape[3], 2);
  assert.equal(u.waterFoam[0], 0);
  assert.equal(u.waterFoam[3], 5);
  assert.equal(waterUniformValues({ riverEnabled: false }).waterFoam[3], 0);
  assert.ok(Object.values(u).flat().every(Number.isFinite));
  assert.equal(effectiveWaveHeight(0, 3), 0);
  assert.ok(effectiveWaveHeight(0.35, 1.5) <= 1.5 * 0.15);
});
test("water and canyon parameters survive the existing scene export", async () => {
  const settings = {
    ...defaults,
    canyonWidth: 11,
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
  assert.equal(header.settings.canyonWidth, 11);
  assert.equal(header.settings.waveHeight, 0.2);
  assert.equal(header.settings.foamAmount, 0.8);
});
