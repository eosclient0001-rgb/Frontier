import test from "node:test";
import assert from "node:assert/strict";
import { ConstructPhotometricCookieTexture } from "./scene.mjs";
import {
  ValidatePhotometrySamples,
  InterpolateCandela,
  IntegrateLuminousFlux,
  GenerateSpotPhotometry,
  DecodeIES,
  EncodeIES,
} from "./photometry.mjs";

test("constant candela integrates to 4πI lumens", () => {
  const Points = [
    { angle: 0, cd: 100 },
    { angle: 180, cd: 100 },
  ];
  assert.ok(Math.abs(IntegrateLuminousFlux(Points) - 400 * Math.PI) < 0.001);
});

test("spot profile reaches exact peak and outer cutoff", () => {
  const Points = GenerateSpotPhotometry(1000, 1, 3);
  assert.equal(InterpolateCandela(Points, 1), 1000);
  assert.equal(InterpolateCandela(Points, 3), 0);
  assert.ok(InterpolateCandela(Points, 2) > 0);
});

test("spot profile is valid at boundary half-angles", () => {
  assert.equal(GenerateSpotPhotometry(250, 0, 180)[0].angle, 0);
  assert.equal(GenerateSpotPhotometry(250, 0, 180).at(-1).angle, 180);
  assert.throws(() => GenerateSpotPhotometry(-1, 2, 4));
  assert.throws(() => GenerateSpotPhotometry(100, 5, 5));
});

test("IES output roundtrips absolute axisymmetric candela", () => {
  const Points = [
    { angle: 0, cd: 1200 },
    { angle: 30, cd: 450 },
    { angle: 180, cd: 0 },
  ];
  assert.deepEqual(DecodeIES(EncodeIES(Points, "Test")), Points);
});

test("IES candela multiplier is applied on import", () => {
  const Document = EncodeIES([
    { angle: 0, cd: 10 },
    { angle: 180, cd: 0 },
  ]).replace("1 -1 1 2 1 1 2", "1 -1 2 2 1 1 2");
  assert.equal(DecodeIES(Document)[0].cd, 20);
});

test("unsupported asymmetry, tilt, invalid and incomplete data are rejected", () => {
  const Document = EncodeIES([
    { angle: 0, cd: 10 },
    { angle: 180, cd: 0 },
  ]);
  assert.throws(() => DecodeIES(Document.replace("TILT=NONE", "TILT=INCLUDE")));
  assert.throws(() =>
    DecodeIES(Document.replace("1 -1 1 2 1 1 2", "1 -1 1 2 2 1 2")),
  );
  assert.throws(() => DecodeIES(Document.replace("10 0\n", "10\n")));
  assert.throws(() =>
    ValidatePhotometrySamples([
      { angle: 0, cd: 1 },
      { angle: 180, cd: -1 },
    ]),
  );
});

test("photometric cookie preserves peak and attenuates to the measured cutoff", () => {
  const Texture = ConstructPhotometricCookieTexture(
    [
      { angle: 0, cd: 1000 },
      { angle: 30, cd: 1000 },
      { angle: 60, cd: 0 },
      { angle: 180, cd: 0 },
    ],
    60,
  );
  const Pixels = Texture.image.data;
  const CentreIndex = (128 * 256 + 128) * 4;
  const RimIndex = (128 * 256 + 255) * 4;
  assert.equal(Pixels[CentreIndex], 255);
  assert.ok(Pixels[RimIndex] < 15);
  Texture.dispose();
});

test("profile validation refuses unordered and incomplete angular coverage", () => {
  assert.throws(() =>
    ValidatePhotometrySamples([
      { angle: 0, cd: 1 },
      { angle: 20, cd: 2 },
      { angle: 10, cd: 1 },
    ]),
  );
  assert.throws(() =>
    ValidatePhotometrySamples([
      { angle: 5, cd: 1 },
      { angle: 180, cd: 1 },
    ]),
  );
});
