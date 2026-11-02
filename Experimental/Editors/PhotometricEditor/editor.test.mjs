import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HtmlDocument = readFileSync(
  new URL("./index.html", import.meta.url),
  "utf8",
);
const ApplicationModule = readFileSync(
  new URL("./app.mjs", import.meta.url),
  "utf8",
);
const SceneModule = readFileSync(
  new URL("./scene.mjs", import.meta.url),
  "utf8",
);

test("every static application selector resolves to an authored HTML id", () => {
  const HtmlIdentifiers = new Set(
    [...HtmlDocument.matchAll(/\bid="([^"]+)"/g)].map((Match) => Match[1]),
  );
  const ApplicationSelectors = [
    ...ApplicationModule.matchAll(/Select\('#([A-Za-z][\w-]*)'\)/g),
  ].map((Match) => Match[1]);
  const MissingIdentifiers = [
    ...new Set(
      ApplicationSelectors.filter(
        (Identifier) => !HtmlIdentifiers.has(Identifier),
      ),
    ),
  ];
  assert.deepEqual(MissingIdentifiers, []);
});

test("all seven source modes have tabs, controls, photometric runtime support and labels", () => {
  for (const SourceType of ["ies", "spot", "point", "area", "directional", "ambient", "hemisphere"]) {
    assert.match(HtmlDocument, new RegExp(`data-source-type="${SourceType}"`));
    assert.match(HtmlDocument, new RegExp(`id="${SourceType}Controls"`));
    assert.match(ApplicationModule, new RegExp(`\\b${SourceType}:`));
  }
  assert.match(SceneModule, /new THREE\.SpotLight/);
  assert.match(SceneModule, /new THREE\.PointLight/);
  assert.match(SceneModule, /new THREE\.RectAreaLight/);
  assert.match(SceneModule, /new THREE\.DirectionalLight/);
  assert.match(SceneModule, /new THREE\.AmbientLight/);
  assert.match(SceneModule, /new THREE\.HemisphereLight/);
});

test("the 3D canvas and bundled environment remain wired to the browser page", () => {
  assert.match(HtmlDocument, /id="scene"/);
  assert.match(SceneModule, /EnvironmentArchives\/\$\{MapName\}\.png/);
  assert.match(HtmlDocument, /environmentIntensity/);
  assert.match(HtmlDocument, /environmentRotation/);
  assert.match(HtmlDocument, /node_modules\/three\/build\/three\.module\.js/);
});
