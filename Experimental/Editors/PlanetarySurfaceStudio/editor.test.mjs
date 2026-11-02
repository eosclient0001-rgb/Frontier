import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Bodies, Catalog, MoonProfiles } from "./planet-data.mjs";

const Html = await readFile(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");
const Portal = await readFile(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
const Css = await readFile(fileURLToPath(new URL("./style.css", import.meta.url)), "utf8");
const App = await readFile(fileURLToPath(new URL("./app.mjs", import.meta.url)), "utf8");

test("the sourced globe, object cards, filters and AI UV mode are wired", () => {
  const HtmlIds = new Set([...Html.matchAll(/\bid="([^"]+)"/g)].map((Match) => Match[1]));
  for (const Match of App.matchAll(/\$\("([^"]+)"\)/g)) {
    assert.ok(HtmlIds.has(Match[1]), `app selector #${Match[1]} exists in the UI`);
  }
  for (const Id of ["bodyList", "scene", "surfaceCard", "heightCard", "aiCard", "exaggeration", "sunAzimuth", "sunAltitude", "atmosphereStrength", "surfaceSourceLink", "surfaceTerms", "heightSourceLink", "heightTerms", "bodyNotes", "exportView"]) {
    assert.ok(HtmlIds.has(Id), `${Id} exists in the UI`);
  }
  assert.doesNotMatch(Html, /id="(?:moonPortrait|atmosphereFade)"/);
  assert.doesNotMatch(App, /moonPortrait|illustrationFile|\$\("atmosphereFade"\)/);
  assert.match(Html, />AI UV</);
  assert.match(Html, /2:1 UV MAP · NOT DATA/);
  assert.match(App, /new THREE\.SphereGeometry\(1, 192, 128\)/);
  assert.match(App, /new THREE\.MeshStandardMaterial\(\{ map: Texture, roughness: 0\.94/);
  assert.match(App, /directional light creates the terminator/);
  assert.match(App, /AI-generated equirectangular UV illustration/);
  assert.ok(Catalog.moon.aiUvFile.endsWith("/luna.jpg"));
  assert.ok(Bodies.moon.heightFile, "Luna retains its separate LOLA elevation grid");
  assert.equal(Object.keys(MoonProfiles).length, 9);
});

test("the segmented dark-and-gold card system remains legible and responsive", () => {
  assert.match(Html, /class="eos-segment"/);
  assert.match(Html, /class="dataset-card"/);
  assert.match(Css, /linear-gradient\(#eed12f/);
  assert.match(Css, /@media \(max-width: 850px\)/);
  assert.match(Css, /@media \(max-width: 570px\)/);
  assert.match(Css, /\.page-heading h1 \{ font-size: clamp\(24px/);
  assert.match(Css, /\.workspace \{ grid-template-columns: minmax\(0, 1fr\); \}\s*\.topbar/);
  assert.match(Css, /\.control-line, \.atmosphere-preview \{ font-size: 11px/);
  assert.match(Html, /CLOUD LAYER/);
  assert.match(Html, /not spacecraft imagery, measured terrain or albedo/);
});

test("the atmosphere uses a soft shader fade rather than a portrait overlay", () => {
  assert.match(App, /smoothstep\(0\.0,0\.32,facing\)/);
  assert.match(App, /smoothstep\(0\.26,0\.72,facing\)/);
  assert.match(App, /Atmosphere\.scale\.setScalar\(1\.055 \+ Relief\)/);
  assert.doesNotMatch(Css, /\.atmosphere-fade/);
});

test("sourced maps keep baked shading while AI textures use natural dynamic lighting", () => {
  assert.match(App, /new THREE\.MeshBasicMaterial\(\{ map: Texture \}\)/);
  assert.match(App, /CurrentMode === "illustration"\s*\? new THREE\.MeshStandardMaterial\(\{ map: Texture, roughness: 0\.94/);
  assert.match(App, /new THREE\.MeshStandardMaterial\(\{ vertexColors: true/);
  assert.match(App, /const NoDynamicLight = CurrentMode === "surface"/);
});

test("the Frontier portal links to every runnable editor directory", async () => {
  const EditorsRoot = fileURLToPath(new URL("../", import.meta.url));
  const Directories = await readdir(EditorsRoot, { withFileTypes: true });
  const ExpectedRoutes = [];
  for (const Entry of Directories) {
    if (!Entry.isDirectory()) continue;
    try {
      await stat(new URL(`../${Entry.name}/index.html`, import.meta.url));
      ExpectedRoutes.push(`/Experimental/Editors/${Entry.name}/`);
    } catch {
      // Non-editor folders do not have a launch page.
    }
  }
  const CardRoutes = [...Portal.matchAll(/class="editor-card" href="([^"]+)"/g)].map((Match) => Match[1]);
  const QuickLinks = [...Portal.matchAll(/<nav class="editor-quick-links"[\s\S]*?<\/nav>/g)].flatMap((Match) => [...Match[0].matchAll(/href="([^"]+)"/g)].map((Link) => Link[1]));
  assert.deepEqual(CardRoutes.sort(), ExpectedRoutes.sort());
  assert.deepEqual(QuickLinks.sort(), ExpectedRoutes.sort());
  assert.match(Portal, /02 AVAILABLE/);
  assert.match(Portal, /<span class="editor-mark" aria-hidden="true">IES<\/span>/);
  assert.match(Portal, /<span class="editor-mark" aria-hidden="true">3D<\/span>/);
});
