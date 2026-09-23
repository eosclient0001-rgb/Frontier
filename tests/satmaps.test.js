import test from "node:test";
import assert from "node:assert/strict";
import {
  satmapDefaults,
  satmapUniforms,
  satmapPalettes,
} from "../src/satmaps.js";
import { defaults, encodeScene } from "../src/field.js";
test("Satmaps uniforms are bounded and palettes are linear color values, not heightfield geometry", () => {
  for (const [key, value] of Object.entries(satmapDefaults))
    assert.equal(defaults[key], value);
  assert.equal(satmapPalettes.length, 4);
  assert.ok(
    satmapPalettes
      .flatMap((p) => p.colors.flat())
      .every((x) => x >= 0 && x <= 1),
  );
  const p = satmapUniforms({
    satmapPalette: 100,
    satmapView: NaN,
    satmapCurvature: Infinity,
    satmapBlend: -10,
  });
  assert.ok(Object.values(p).flat().every(Number.isFinite));
  assert.equal(p.satControl[1], 0);
  assert.equal(p.satControl[2], 0);
  assert.equal(satmapUniforms({ satmapEnabled: false }).satControl[0], 0);
});
test("exports retain material settings and XYZ water routes, explicitly excluding transient flow history", async () => {
  const settings = {
    ...defaults,
    satmapPalette: 2,
    satmapFlow: 0.7,
    waterOffset: 0.3,
    sceneObjects: [
      {
        id: "r",
        type: "water",
        visible: true,
        width: 3,
        speed: 2,
        points: [
          [0, 5, -4],
          [0, 3, 4],
        ],
      },
    ],
  };
  const bytes = await encodeScene(new Float32Array(4), settings).arrayBuffer();
  const n = new DataView(bytes).getUint32(4, true),
    h = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 8, n)));
  assert.equal(h.satmapModel, "volumetric-surface-material-v1");
  assert.equal(h.flowHistoryIncluded, false);
  assert.equal(h.settings.satmapPalette, 2);
  assert.equal(h.settings.waterOffset, 0.3);
  assert.deepEqual(h.settings.sceneObjects, settings.sceneObjects);
});

test("water transforms move only the selected route or point while retaining its grade and shared offset", async () => {
  const { objectPivot, moveObject, scaleObject } =
    await import("../src/shapes.js");
  const n = {
      type: "water",
      width: 3,
      points: [
        [-5, 6, 0],
        [5, 2, 0],
      ],
    },
    params = { waterLevel: 0.7, waterOffset: 0.4 };
  assert.deepEqual(objectPivot(n, params), [0, 4.4, 0]);
  moveObject(n, params, [0, 5.4, 0]);
  assert.deepEqual(n.points, [
    [-5, 7, 0],
    [5, 3, 0],
  ]);
  assert.equal(params.waterLevel, 0.7);
  assert.equal(params.waterOffset, 0.4);
  moveObject(n, params, [5, 4.4, 0], 1);
  assert.deepEqual(n.points, [
    [-5, 7, 0],
    [5, 4, 0],
  ]);
  scaleObject(n, params, [1, 2, 1]);
  assert.deepEqual(n.points, [
    [-5, 8.5, 0],
    [5, 2.5, 0],
  ]);
});
