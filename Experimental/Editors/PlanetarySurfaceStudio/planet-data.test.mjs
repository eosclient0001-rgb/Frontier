import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Bodies, BodyIds, MoonProfiles, Catalog, CatalogIds, Pipeline, SampleHeight, NormalizeLongitude } from "./planet-data.mjs";

const AssetPath = (Name) => fileURLToPath(new URL(`./assets/planet-data/${Name}`, import.meta.url));
const MoonTexturePath = (Name) => fileURLToPath(new URL(`./assets/moon-uv/${Name}.jpg`, import.meta.url));

function ReadJpegDimensions(Bytes) {
  let Offset = 2;
  while (Offset < Bytes.length) {
    while (Bytes[Offset] === 0xff) Offset += 1;
    const Marker = Bytes[Offset++];
    if (Marker === 0xd8 || Marker === 0xd9 || (Marker >= 0xd0 && Marker <= 0xd7)) continue;
    const SegmentLength = Bytes.readUInt16BE(Offset);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(Marker)) {
      return { width: Bytes.readUInt16BE(Offset + 5), height: Bytes.readUInt16BE(Offset + 3) };
    }
    Offset += SegmentLength;
  }
  throw new Error("JPEG has no supported start-of-frame marker");
}

test("only bodies with documented, bundled elevation derivatives are selectable", async () => {
  assert.deepEqual(BodyIds, ["moon", "earth", "mars", "mercury", "venus", "ceres", "pluto"]);
  for (const Body of Object.values(Bodies)) {
    assert.ok(Body.sourceHeight?.product, `${Body.id} has a named source DEM`);
    assert.ok(Body.sourceHeight?.url.startsWith("https://"), `${Body.id} has a source record`);
    assert.equal((await stat(AssetPath(`${Body.id}-height.i16le`))).size, 1024 * 512 * 2);
    assert.ok(Body.heightRangeM[0] < Body.heightRangeM[1]);
  }
  assert.equal(Bodies.vesta, undefined, "the clipped published Vesta height derivative is not exposed as a supported body");
  assert.equal(Bodies.moon.imageFile, null, "aesthetic lunar imagery is not misrepresented as a scientific surface map");
});

test("nine additional moons have separate AI-generated equirectangular UV textures", async () => {
  assert.equal(Object.keys(MoonProfiles).length, 9);
  assert.equal(CatalogIds.length, 16);
  const MoonTextures = [Bodies.moon, ...Object.values(MoonProfiles)];
  assert.equal(MoonTextures.length, 10);
  for (const Moon of MoonTextures) {
    assert.ok(Moon.aiUvFile.endsWith(`/${Moon.id === "moon" ? "luna" : Moon.id}.jpg`));
    assert.ok(Moon.notes.some((Note) => Note.includes("longitude origin is arbitrary")));
    assert.equal(Moon.category, "moon");
    assert.equal(Moon.sourceSurface, null);
    if (Moon.id !== "moon") {
      assert.ok(Moon.parent);
      assert.equal(Moon.kind, "ai-uv-map");
      assert.equal(Moon.sourceHeight, null);
    }
    const TextureName = Moon.id === "moon" ? "luna" : Moon.id;
    const Texture = await readFile(MoonTexturePath(TextureName));
    assert.ok(Texture.length > 10_000, `${Moon.name} AI UV texture exists`);
    const { width, height } = ReadJpegDimensions(Texture);
    assert.ok(width > height, `${Moon.name} texture is landscape, not a globe portrait`);
    assert.ok(Math.abs(width / height - 2) < 0.06, `${Moon.name} texture is approximately 2:1 equirectangular`);
  }
  assert.ok(Bodies.moon.heightFile, "Luna retains LOLA elevation independently of its AI texture");
  assert.equal(Catalog.moon.name, "Luna");
});

test("surface image derivatives are limited to the bodies with bundled mapped images", async () => {
  for (const Body of Object.values(Bodies)) {
    if (!Body.imageFile) continue;
    const File = AssetPath(`${Body.id}-surface.webp`);
    const Bytes = await readFile(File);
    assert.ok(Bytes.length > 1000, `${Body.id} image exists`);
    assert.equal(Bytes.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(Bytes.subarray(8, 12).toString("ascii"), "WEBP");
    assert.equal(Bytes.subarray(12, 16).toString("ascii"), "VP8 ");
    assert.equal(Bytes.readUInt16LE(26) & 0x3fff, 4096);
    assert.equal(Bytes.readUInt16LE(28) & 0x3fff, 2048);
  }
  assert.ok(Pipeline.surfaceImage.hillshade.includes("0.30 + 0.70"));
  assert.ok(Pipeline.surfaceImage.hillshade.includes("not unshaded reflectance"));
  assert.ok(Pipeline.heightGrid.missingValueHandling.includes("cannot always be distinguished"));
});

test("height sampling wraps at the longitude seam and interpolates within the grid", () => {
  const Grid = new Int16Array(1024 * 512);
  Grid.fill(120);
  assert.equal(SampleHeight(Grid, 0, 0), 120);
  assert.equal(SampleHeight(Grid, 1, 0.5), 120);
  assert.equal(SampleHeight(Grid, -1, 0.5), 120);
  assert.equal(SampleHeight(Grid, 0.5, 1), 120);
  assert.equal(SampleHeight(Grid, 0.5, 0), 120);
  Grid[0] = 0;
  Grid[1] = 100;
  assert.equal(SampleHeight(Grid, 0.5 / 1024, 0), 50);
});

test("longitude readout respects the published display domain", () => {
  assert.equal(NormalizeLongitude(360, "0–360°E"), 0);
  assert.equal(NormalizeLongitude(-10, "0–360°E"), 350);
  assert.equal(NormalizeLongitude(190, "−180–180°E"), -170);
  assert.equal(NormalizeLongitude(-190, "−180–180°E"), 170);
});

test("Pluto and Venus limitations remain explicit", () => {
  assert.ok(Bodies.pluto.notes.some((Note) => Note.includes("closest approach")));
  assert.ok(Bodies.pluto.notes.some((Note) => Note.includes("far-side zero-filled")));
  assert.ok(Bodies.venus.notes.some((Note) => Note.includes("radar-derived synthetic colour")));
  assert.ok(Bodies.mercury.notes.some((Note) => Note.includes("not what Mercury looks like")));
});
