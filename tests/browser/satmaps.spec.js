import { test, expect } from "@playwright/test";
async function bare(page) {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
}
test("Satmaps follows Fracture, edits percentages correctly, and never regenerates geometry", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  await page.evaluate(async () => {
    window.satBefore = await frontier.readVolume();
  });
  const tabs = await page
    .locator(".tab")
    .evaluateAll((xs) => xs.map((x) => x.dataset.tab));
  expect(tabs[tabs.indexOf("fracture") + 1]).toBe("satmaps");
  await expect(
    page.locator(
      "#geology-controls,#geologyPattern,#edit-geology,#inspect-geology,#talus-controls,#satmapContrast,#satmapDetail,#satmap-search",
    ),
  ).toHaveCount(0);
  await expect(page.locator("#satmap-view option")).toHaveCount(7);
  await expect(page.locator("[data-satmap-palette]")).toHaveCount(4);
  expect(await page.evaluate(() => frontier.settings.satmapBlend)).toBe(0.85);
  await page.locator("[data-tab=satmaps]").click();
  await expect(page.locator("#inspector-title")).toHaveText("Satmaps");
  await page.locator('[data-satmap-palette="1"]').click();
  await page.locator("#satmapFlow-value").click();
  await page.locator("#satmapFlow-value input").fill("75");
  await page.locator("#satmapFlow-value input").press("Enter");
  expect(await page.evaluate(() => frontier.settings.satmapFlow)).toBe(0.75);
  await page.locator("#satmap-view").selectOption("4");
  expect(await page.evaluate(() => frontier.settings.satmapView)).toBe(4);
  await page.locator("#satmap-view").selectOption("0");
  expect(
    await page.evaluate(async () => {
      const a = await frontier.readVolume();
      return a.every((v, i) => v === satBefore[i]);
    }),
  ).toBe(true);
  expect(await page.evaluate(() => frontier.diagnostics.error)).toBeFalsy();
  await page.locator(".panels").evaluate((el) => el.scrollTo(0, 0));
  await expect(page.locator(".satmap-presets")).toBeVisible();
  await page.screenshot({ path: "artifacts/satmaps-panel.png" });
});
test("surface palettes and six diagnostic maps affect pixels, not the SDF", async ({
  page,
}) => {
  await bare(page);
  const r = await page.evaluate(async () => {
    const { createRenderer } = await import("/src/renderer.js"),
      { defaults, generateVolume } = await import("/src/field.js");
    document.body.innerHTML =
      '<canvas style="width:320px;height:240px"></canvas>';
    const canvas = document.querySelector("canvas"),
      p = { ...defaults, preset: 4, waterEnabled: false },
      w = 256,
      h = 192;
    const u = new Float32Array([
      23,
      21,
      30,
      1,
      0,
      4,
      0,
      w / h,
      w,
      h,
      0,
      0,
      p.sun,
      0,
      p.waterLevel,
      0,
      p.strata,
      p.roughness,
      p.clarity,
      p.ripple,
      0,
      0,
      0,
      -1,
      0,
      4,
      0,
      0,
    ]);
    const renderer = await createRenderer(
      canvas,
      null,
      generateVolume(p),
      () => {},
      u,
      p,
    );
    canvas.width = w;
    canvas.height = h;
    const initial = await renderer.readVolume(),
      gl = renderer.gl;
    const render = () => {
      renderer.draw(u);
      const a = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, a);
      return a;
    };
    const delta = (a, b) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4)
        if (
          Math.abs(a[i] - b[i]) +
            Math.abs(a[i + 1] - b[i + 1]) +
            Math.abs(a[i + 2] - b[i + 2]) >
          12
        )
          n++;
      return n;
    };
    const first = render();
    p.satmapPalette = 2;
    const other = render(),
      changes = [];
    for (let view = 1; view <= 6; view++) {
      p.satmapView = view;
      changes.push(delta(other, render()));
    }
    const last = await renderer.readVolume();
    return {
      palette: delta(first, other),
      changes,
      unchanged: last.every((v, i) => v === initial[i]),
      error: gl.getError(),
    };
  });
  expect(r.palette).toBeGreaterThan(500);
  for (const n of r.changes) expect(n).toBeGreaterThan(500);
  expect(r.unchanged).toBe(true);
  expect(r.error).toBe(0);
});
test("GPU curvature recognizes convex and cavity faces on all XYZ axes", async ({
  page,
}) => {
  await bare(page);
  const r = await page.evaluate(async () => {
    const { GPUErosion, program } = await import("/src/gpu-erosion.js"),
      { fullscreenVertex } = await import("/src/erosion-shaders.js"),
      { satmapGLSL } = await import("/src/satmaps.js");
    const s = new GPUErosion(
        document.createElement("canvas").getContext("webgl2"),
      ),
      t = s.texture(1, 1);
    s.programs.curvature = program(
      s.gl,
      fullscreenVertex,
      `#version 300 es
precision highp float;
uniform vec4 point;uniform float signValue;
const vec3 low=vec3(-22,-4,-20),high=vec3(22,22,20);
float field(vec3 p){return signValue*(length(p)-2.);}
float noise(vec3 p){return 0.;}float ambient(vec3 p,vec3 n){return 1.;}
${satmapGLSL}
out vec4 color;void main(){color=vec4(satCurvature(point.xyz,normalize(point.xyz)*signValue));}`,
      "SDF curvature check",
    );
    const results = [];
    for (const sign of [1, -1])
      for (const p of [
        [2, 0, 0],
        [-2, 0, 0],
        [0, 2, 0],
        [0, -2, 0],
        [0, 0, 2],
        [0, 0, -2],
      ]) {
        s.pass(
          "curvature",
          [t],
          1,
          1,
          {},
          { point: [...p, 0], signValue: sign },
        );
        results.push(s.read(t, 1, 1)[0] * sign);
      }
    return results;
  });
  for (const v of r) {
    expect(v).toBeGreaterThan(0.9);
    expect(v).toBeLessThan(1.1);
  }
});
test("Water tab starts a visible shared route and allows genuine point elevations", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  await page.locator("[data-tab=water]").click();
  await expect(page.locator("#panel-water [data-route-status]")).toContainText(
    "No route",
  );
  await page.locator("#panel-water [data-draw-route]").click();
  const rect = await page.locator("#scene").boundingBox();
  for (const [i, u, v] of [
    [1, 0.4, 0.64],
    [2, 0.62, 0.66],
  ]) {
    await page.mouse.click(rect.x + rect.width * u, rect.y + rect.height * v);
    await page.waitForFunction(
      (n) =>
        frontier.scene.objects.some(
          (o) => o.type === "water" && o.points.length === n,
        ),
      i,
    );
  }
  await page.locator("#path-finish").click();
  await expect(page.locator("#point-y")).toBeEnabled();
  await page.locator("#point-y").fill("3.4");
  await page.locator("#point-y").press("Tab");
  expect(
    await page.evaluate(
      () =>
        frontier.scene.objects.find((o) => o.type === "water").points.at(-1)[1],
    ),
  ).toBe(3.4);
  await expect(page.locator("#spline-overlay")).toContainText("INLET");
  await page.locator("[data-tab=water]").click();
  await expect(page.locator("#panel-water [data-route-status]")).toContainText(
    "1 shared route",
  );
  expect(await page.evaluate(() => frontier.settings.waterEnabled)).toBe(true);
  expect(await page.evaluate(() => frontier.settings.sourceMode)).toBe(2);
  expect(await page.evaluate(() => frontier.diagnostics.error)).toBeFalsy();
  await page.screenshot({ path: "artifacts/shared-river-route.png" });
});
