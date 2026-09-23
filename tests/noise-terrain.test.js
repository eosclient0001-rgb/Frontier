import test from "node:test";
import assert from "node:assert/strict";
import {
  terrainDefaults,
  normalizeTerrain,
  createTerrainNoise,
  createNoiseTerrain,
} from "../src/noise-terrain.js";
import {
  defaults,
  baseSDF,
  generateVolume,
  SIZE,
  MIN,
  CELL,
  encodeScene,
} from "../src/field.js";

test("noise landscape controls sanitize invalid, fractional and out-of-bounds inputs", () => {
  const p = normalizeTerrain({
    terrainHeight: 1000,
    terrainOctaves: 3.8,
    terrainWidth: NaN,
    terrainSeed: -3,
    terrainNoise: 99,
  });
  assert.equal(p.terrainHeight, 500);
  assert.equal(p.terrainOctaves, 4);
  assert.equal(p.terrainWidth, terrainDefaults.terrainWidth);
  assert.equal(p.terrainSeed, 1);
  assert.equal(p.terrainNoise, 4);
});
test("all five noise families are deterministic, distinct and genuinely XYZ-dependent", () => {
  const families = [];
  for (let type = 0; type < 5; type++) {
    const sample = createTerrainNoise({ terrainNoise: type });
    const values = Array.from({ length: 30 }, (_, i) =>
      sample(i * 0.83 - 9, i * 0.37 + 2, i * -0.51 + 5),
    );
    assert.deepEqual(
      values,
      Array.from({ length: 30 }, (_, i) =>
        sample(i * 0.83 - 9, i * 0.37 + 2, i * -0.51 + 5),
      ),
    );
    assert(values.every((x) => Number.isFinite(x) && x >= -1 && x <= 1));
    families.push(JSON.stringify(values));
    if (type > 0)
      for (let k = 0; k < 3; k++) {
        const p = [2.3, 5.7, -4.3],
          q = [...p];
        q[k] += 0.9;
        assert.notEqual(sample(...p), sample(...q));
      }
  }
  assert.equal(new Set(families).size, 5);
  const a = createTerrainNoise(),
    b = createTerrainNoise({ terrainSeed: 7091 });
  assert.notEqual(a(2, 3, 4), b(2, 3, 4));
});
test("all starting forms are bounded volumes with a finite underside and editable dimensions", () => {
  for (const terrainForm of [0, 1, 2]) {
    const s = createNoiseTerrain({ terrainForm });
    assert(s(0, -1, 0) < 0, "solid base");
    assert(s(0, -3.8, 0) > 0, "finite underside");
    for (const p of [
      [22, 2, 0],
      [-22, 0, 0],
      [0, 0, 20],
      [0, 22, 0],
      [0, -4, 0],
    ])
      assert(s(...p) > 0);
  }
  const tall = createNoiseTerrain({ terrainNoise: 0, terrainHeight: 17 }),
    short = createNoiseTerrain({ terrainNoise: 0, terrainHeight: 6 });
  assert(tall(0, 12, 0) < 0);
  assert(short(0, 12, 0) > 0);
  const wide = createNoiseTerrain({ terrainWidth: 40 }),
    narrow = createNoiseTerrain({ terrainWidth: 12 });
  assert(wide(15, -1, 0) < 0);
  assert(narrow(15, -1, 0) > 0);
  const points = Array.from({ length: 200 }, (_, i) => [
    (i % 17) - 8,
    (i % 13) + 0.3,
    (i % 19) - 9,
  ]);
  const descriptions = [0, 1, 2].map((terrainForm) => {
    const sample = createNoiseTerrain({ terrainForm });
    return JSON.stringify(points.map((p) => sample(...p)));
  });
  assert.equal(new Set(descriptions).size, 3);
});
test("fractal and domain controls change the actual field, not just rendered normals", () => {
  const points = Array.from({ length: 100 }, (_, i) => [
    (i % 11) - 5,
    (i % 9) + 0.1,
    (i % 13) - 6,
  ]);
  const sample = (p) => {
    const f = createNoiseTerrain(p);
    return points.map((q) => f(...q));
  };
  const original = sample({});
  for (const p of [
    { terrainSeed: 9841 },
    { terrainNoise: 1 },
    { terrainAmplitude: 0 },
    { terrainScale: 14 },
    { terrainOctaves: 1 },
    { terrainGain: 0.8 },
    { terrainLacunarity: 2.5 },
    { terrainWarp: 1.3 },
    { terrainTerraces: 1 },
    { terrainHeading: 85 },
  ])
    assert.notDeepEqual(sample(p), original, JSON.stringify(p));
});
test("prepared worker volume matches the point sampler and exports the applied noise settings", async () => {
  const p = {
    ...defaults,
    preset: 4,
    terrainNoise: 1,
    terrainForm: 1,
    terrainSeed: 9017,
  };
  const a = generateVolume(p);
  assert.equal(a.length, SIZE.reduce((a, b) => a * b, 1) * 4);
  assert(a.every(Number.isFinite));
  assert(a.some((v, i) => i % 4 === 0 && v < 0));
  const x = 50,
    y = 24,
    z = 43,
    i = ((z * SIZE[1] + y) * SIZE[0] + x) * 4;
  assert(
    Math.abs(
      a[i] -
        baseSDF(
          MIN[0] + (x + 0.5) * CELL[0],
          MIN[1] + (y + 0.5) * CELL[1],
          MIN[2] + (z + 0.5) * CELL[2],
          p,
        ),
    ) < 1e-5,
  );
  const bytes = await encodeScene(a, p).arrayBuffer();
  assert(bytes.byteLength > a.byteLength);
  const headerSize = new DataView(bytes).getUint32(4, true);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(bytes, 8, headerSize)),
  );
  assert.equal(header.settings.terrainNoise, 1);
  assert.equal(header.settings.terrainForm, 1);
  assert.equal(header.settings.terrainSeed, 9017);
});
