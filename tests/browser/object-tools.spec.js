import { test, expect as assertion } from "@playwright/test";
const expect = assertion.configure({ timeout: 60000 });
async function lab(page) {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
}
test("GPU shape-only multifractal noise/terracing is local, live transforms and cut depth are geometric, hiding restores the base", async ({
  page,
}) => {
  await lab(page);
  const r = await page.evaluate(async () => {
    const { GPUErosion } = await import("/src/gpu-erosion.js"),
      { defaults, generateVolume, sampleVolume } =
        await import("/src/field.js"),
      { makeShape, shapeDistance, moveObject } = await import("/src/shapes.js"),
      { makePath } = await import("/src/splines.js");
    const s = new GPUErosion(
        document.createElement("canvas").getContext("webgl2"),
      ),
      p = { ...defaults, preset: 3 };
    s.upload(generateVolume(p));
    const original = await s.readVolume(),
      n = { ...makeShape("boulder"), position: [8, 5, 0], noiseAmount: 0 };
    await s.refreshSplineCuts([n]);
    const plain = await s.readVolume();
    n.rotation = [10, 25, 15];
    n.noiseType = 3;
    n.noiseAmount = 1;
    n.noiseWarp = 0.6;
    n.terraceStrength = 0.6;
    n.terraceHeight = 1.3;
    await s.refreshSplineCuts([n]);
    const textured = await s.readVolume();
    let changed = 0,
      lostFar = 0,
      error = 0;
    for (let i = 0; i < plain.length; i += 4)
      if (Math.abs(plain[i + 3] - textured[i + 3]) > 0.02) changed++;
    for (let x = 10; x < 25; x++)
      for (let y = 5; y < 30; y++) {
        const i = ((55 * 72 + y) * 112 + x) * 4;
        if (textured[i + 3] !== original[i + 3]) lostFar++;
      }
    for (let x = 65; x < 86; x += 3)
      for (let y = 17; y < 35; y += 3)
        for (let z = 45; z < 65; z += 3) {
          const p = [
              -22 + ((x + 0.5) * 44) / 112,
              -4 + ((y + 0.5) * 26) / 72,
              -20 + ((z + 0.5) * 40) / 112,
            ],
            i = ((z * 72 + y) * 112 + x) * 4;
          error = Math.max(
            error,
            Math.abs(textured[i] - Math.min(original[i], shapeDistance(p, n))),
          );
        }
    n.rotation = [0, 0, 0];
    n.noiseAmount = 0;
    n.terraceStrength = 0;
    const cut = {
      ...makePath("cut", "cut"),
      width: 2,
      depth: 2,
      points: [
        [4, 7, 0],
        [12, 7, 0],
      ],
    };
    await s.refreshSplineCuts([cut, n]);
    const shallow = await s.readVolume();
    moveObject(cut, p, [8, 5, 0]);
    await s.refreshSplineCuts([n, cut]);
    const deep = await s.readVolume();
    const deepens =
      sampleVolume(deep, [8, 4, 0]) - sampleVolume(shallow, [8, 4, 0]);
    await s.refreshSplineCuts([]);
    const restored = await s.readVolume();
    return {
      changed,
      lostFar,
      error,
      deepens,
      exact: restored.every((v, i) => v === original[i]),
      gl: s.gl.getError(),
    };
  });
  expect(r.changed).toBeGreaterThan(100);
  expect(r.lostFar).toBe(0);
  // Rotated GLSL trigonometry / multifractal float math may differ by millimeters;
  // this is still under 3% of one 0.36 m voxel. Occupancy locality is exact above.
  expect(r.error).toBeLessThan(0.01);
  expect(r.deepens).toBeGreaterThan(0.5);
  expect(r.exact).toBe(true);
  expect(r.gl).toBe(0);
});
test("volumetric Ridge and Dent sculpt vertical walls and underside without a heightfield, with brush detail and no CPU transfers", async ({
  page,
}) => {
  await lab(page);
  const r = await page.evaluate(async () => {
    const { GPUErosion } = await import("/src/gpu-erosion.js"),
      { defaults, generateVolume, sampleVolume } =
        await import("/src/field.js");
    const p = {
        ...defaults,
        preset: 3,
        plotWidth: 10,
        plotLength: 10,
        plotHeight: 8,
        brushStrength: 0.6,
        brushAspect: 1.5,
        brushDepth: 1,
        brushFalloff: 2,
      },
      s = new GPUErosion(document.createElement("canvas").getContext("webgl2")),
      a = generateVolume(p);
    s.upload(a);
    const base = await s.readVolume(),
      gl = s.gl,
      read = gl.readPixels.bind(gl),
      upload = gl.texImage2D.bind(gl);
    let reads = 0,
      uploads = 0;
    gl.readPixels = (...args) => {
      reads++;
      return read(...args);
    };
    gl.texImage2D = (...args) => {
      uploads++;
      return upload(...args);
    };
    await s.sculpt([5, 4, 0], 1.8, "ridge", {
      ...p,
      brushDirection: [0, 0, 1],
    });
    const transfers = { reads, uploads };
    gl.readPixels = read;
    gl.texImage2D = upload;
    const ridge = await s.readVolume();
    s.upload(a);
    await s.sculpt([5, 4, 0], 1.8, "dent", p);
    const dent = await s.readVolume();
    s.upload(a);
    await s.sculpt([0, -2, 0], 1.8, "dent", p);
    const underside = await s.readVolume();
    s.upload(a);
    await s.sculpt([5, 4, 0], 1.8, "ridge", {
      ...p,
      brushTexture: 1,
      brushNoiseType: 3,
    });
    const textured = await s.readVolume();
    let noiseChanges = 0;
    for (let i = 0; i < ridge.length; i += 4)
      if (Math.abs(textured[i + 3] - ridge[i + 3]) > 0.01) noiseChanges++;
    return {
      outside: sampleVolume(base, [5.25, 4, 0]),
      ridge: sampleVolume(ridge, [5.25, 4, 0]),
      dent: sampleVolume(dent, [4.8, 4, 0]),
      underside: sampleVolume(underside, [0, -1.8, 0]),
      topPreserved:
        sampleVolume(underside, [0, 7.8, 0]) ===
        sampleVolume(base, [0, 7.8, 0]),
      noiseChanges,
      transfers,
      gl: gl.getError(),
    };
  });
  expect(r.outside).toBeGreaterThan(0);
  expect(r.ridge).toBeLessThan(-0.05);
  expect(r.dent).toBeGreaterThan(0.05);
  expect(r.underside).toBeGreaterThan(0.05);
  expect(r.topPreserved).toBe(true);
  expect(r.noiseChanges).toBeGreaterThan(5);
  expect(r.transfers).toEqual({ reads: 0, uploads: 0 });
  expect(r.gl).toBe(0);
});
test("shape inspector, noise, scaling and Y gizmo update a real boulder while keeping the camera fixed", async ({
  page,
}) => {
  test.setTimeout(300000);
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  await page.locator("#new-scene").click();
  await page.locator("#new-plot").click();
  await expect(page.locator("#add-shape")).toBeEnabled();
  await expect(page.locator("[data-tool=ridge]")).toHaveClass(/active/);
  await page.locator("#add-object").click();
  await page.locator("#add-shape").click();
  await page.waitForFunction(() => !frontier.scene.pending);
  await expect(page.locator("#panel-shape")).toBeVisible();
  await page.locator("#shape-name").fill("Terraced boulder");
  await page.locator("#shape-name").press("Tab");
  await page.locator("#shape-size-x").fill("7");
  await page.locator("#shape-size-x").dispatchEvent("input");
  await page.waitForFunction(() => !frontier.scene.pending);
  expect(await page.evaluate(() => frontier.scene.objects[0].size[0])).toBe(7);
  await page.locator("#shape-noise-Type").selectOption("3");
  await page.waitForFunction(() => !frontier.scene.pending);
  await page.locator("#shape-terrace-strength").fill("0.6");
  await page.locator("#shape-terrace-strength").dispatchEvent("input");
  await page.waitForFunction(() => !frontier.scene.pending);
  expect(
    await page.evaluate(() => frontier.scene.objects[0].terraceStrength),
  ).toBe(0.6);
  const before = await page.evaluate(() => ({
    node: frontier.scene.objects[0],
    camera: frontier.camera,
  }));
  await expect(page.locator("[data-gizmo-axis=y]")).toBeVisible();
  const h = await page.locator("[data-gizmo-axis=y]").evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x, h.y - 35, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => !frontier.scene.pending);
  const after = await page.evaluate(() => ({
    node: frontier.scene.objects[0],
    camera: frontier.camera,
  }));
  expect(after.node.position[1]).toBeGreaterThan(before.node.position[1] + 0.5);
  expect(after.camera).toEqual(before.camera);
  await page.screenshot({ path: "artifacts/boulder-noise-gizmo.png" });
  await page.locator(".transform-options > summary").click();
  await page.locator("#object-scale").fill("0.7");
  await page.locator("#apply-object-scale").click();
  await page.waitForFunction(() => !frontier.scene.pending);
  expect(
    await page.evaluate(() => frontier.scene.objects[0].size[0]),
  ).toBeCloseTo(4.9);
  await page.locator("#shape-visible").uncheck();
  await page.waitForFunction(
    () => !frontier.scene.pending && !frontier.scene.liveBase,
  );
  await page.locator("#shape-delete").click();
  expect(await page.evaluate(() => frontier.scene.objects.length)).toBe(0);
});
test("whole-spline Y/scale controls recut the volume and plot noise regenerates real surface geometry", async ({
  page,
}) => {
  test.setTimeout(300000);
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  await page.locator("#new-scene").click();
  await page.locator("#new-plot").click();
  await expect(page.locator("#add-cut")).toBeEnabled();
  await page.evaluate(async () => {
    window.basePlot = await frontier.readVolume();
  });
  await page.locator("#inspector-switch").click();
  await page.locator("[data-tab=terrain]").click();
  await page.locator("#plot-controls .detail-settings summary").click();
  await page.locator("#plotNoiseAmount").fill("0.8");
  await page.locator("#plotNoiseAmount").dispatchEvent("input");
  await page.waitForFunction(
    async () => {
      if (document.querySelector("#add-cut").disabled) return false;
      const a = await frontier.readVolume();
      let d = 0;
      for (let i = 3; i < a.length; i += 4) d += Math.abs(a[i] - basePlot[i]);
      return d > 200;
    },
    null,
    { polling: 1000, timeout: 60000 },
  );
  await page.locator("#add-object").click();
  await page.locator("#add-cut").click();
  const r = await page.locator("#scene").boundingBox();
  for (const [i, u] of [0.35, 0.65].entries()) {
    await page.mouse.click(r.x + r.width * u, r.y + r.height * 0.48);
    await page.waitForFunction(
      (count) => frontier.scene.objects[0]?.points.length === count,
      i + 1,
    );
    await page.waitForFunction(() => !frontier.scene.pending);
    await expect(page.locator("#path-finish")).toBeEnabled();
  }
  await page.locator("#path-finish").click();
  await page.evaluate(async () => {
    window.cutBefore = await frontier.readVolume();
  });
  const old = await page.evaluate(() => frontier.scene.objects[0]);
  const y = old.points.reduce((s, p) => s + p[1], 0) / old.points.length;
  await page.locator("#transform-y").fill(String(y - 1));
  await page.locator("#transform-y").press("Tab");
  await page.waitForFunction(() => !frontier.scene.pending);
  const translated = await page.evaluate(() => frontier.scene.objects[0]);
  expect(translated.points[0][1]).toBeCloseTo(old.points[0][1] - 1, 4);
  expect(translated.points[1][1]).toBeCloseTo(old.points[1][1] - 1, 4);
  const deeper = await page.evaluate(async () => {
    const a = await frontier.readVolume();
    let lost = 0;
    for (let i = 3; i < a.length; i += 4) lost += cutBefore[i] - a[i];
    return lost;
  });
  expect(deeper).toBeGreaterThan(100);
  await page.locator(".transform-options > summary").click();
  await page.locator("#object-scale").fill("1.25");
  await page.locator("#apply-object-scale").click();
  await page.waitForFunction(() => !frontier.scene.pending);
  expect(
    await page.evaluate(() => frontier.scene.objects[0].width),
  ).toBeCloseTo(old.width * 1.25);
  expect(
    await page.evaluate(() => frontier.scene.objects[0].depth),
  ).toBeCloseTo(old.depth * 1.25);
  await page.locator("#gizmo-scale").click();
  await expect(page.locator("rect[data-gizmo-axis=x]")).toBeVisible();
  await page.screenshot({ path: "artifacts/spline-scale-noisy-plot.png" });
});
