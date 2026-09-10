import { test, expect as assertion } from "@playwright/test";
const expect = assertion.configure({ timeout: 60000 });
async function laboratory(page) {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
}
test("GPU height sculpt preserves 3D cavities and live spline cuts are geometric, graded and exactly reversible", async ({
  page,
}) => {
  await laboratory(page);
  const result = await page.evaluate(async () => {
    const { GPUErosion } = await import("/src/gpu-erosion.js"),
      { generateVolume, defaults, sampleVolume } =
        await import("/src/field.js"),
      { makePath, pathCutDistance } = await import("/src/splines.js");
    const s = new GPUErosion(
        document.createElement("canvas").getContext("webgl2"),
      ),
      p = { ...defaults, preset: 3 };
    s.upload(generateVolume(p));
    await s.sculpt([0, 1, 0], 0.75, "carve");
    const before = await s.readVolume(),
      originalTop = await s.pick([0, 12, 0], [0, -1, 0]);
    await s.sculpt([0, 2.5, 0], 4, "raise", { heightStrength: 0.5 });
    const raised = await s.readVolume(),
      raisedTop = await s.pick([0, 12, 0], [0, -1, 0]);
    const cavity = sampleVolume(raised, [0, 1.5, 0]),
      farUnchanged =
        sampleVolume(raised, [8, 2, 0]) === sampleVolume(before, [8, 2, 0]);
    const cut = {
      ...makePath("cut", "cut"),
      points: [
        [-10, 2.5, -8],
        [0, 3, 0],
        [10, 2.5, 8],
      ],
      width: 3,
      depth: 2,
    };
    await s.refreshSplineCuts([cut]);
    const cutVolume = await s.readVolume();
    let lost = 0,
      error = 0;
    for (let i = 0; i < raised.length; i += 4)
      lost += raised[i + 3] - cutVolume[i + 3];
    for (let z = 15; z < 100; z += 12)
      for (let y = 3; y < 30; y += 4)
        for (let x = 15; x < 100; x += 12) {
          const world = [
              -22 + ((x + 0.5) * 44) / 112,
              -4 + ((y + 0.5) * 26) / 72,
              -20 + ((z + 0.5) * 40) / 112,
            ],
            index = ((z * 72 + y) * 112 + x) * 4;
          error = Math.max(
            error,
            Math.abs(
              cutVolume[index] -
                Math.max(raised[index], -pathCutDistance(world, cut)),
            ),
          );
        }
    await s.refreshSplineCuts([{ ...cut, visible: false }]);
    const restored = await s.readVolume(),
      exact = restored.every((v, i) => v === raised[i]);
    await s.refreshSplineCuts([cut]);
    await s.sculpt([6, 2.5, 0], 4, "raise", { heightStrength: 0.4 });
    await s.refreshSplineCuts([]);
    const modifiedBase = await s.readVolume(),
      newHeight = await s.pick([6, 12, 0], [0, -1, 0]);
    await s.refreshSplineCuts([cut]);
    let baked = [];
    s.onSplineBake = (ids) => (baked = ids);
    await s.sculpt([10, 2.5, 0], 1, "carve");
    const bakedVolume = await s.readVolume();
    await s.refreshSplineCuts([]);
    const afterDelete = await s.readVolume();
    return {
      top: originalTop[1],
      raised: raisedTop[1],
      cavity,
      farUnchanged,
      lost,
      error,
      exact,
      newHeight: newHeight[1],
      baseChanged: !modifiedBase.every((v, i) => v === raised[i]),
      baked,
      bakedPreserved: afterDelete.every((v, i) => v === bakedVolume[i]),
      gl: s.gl.getError(),
    };
  });
  expect(result.raised - result.top).toBeGreaterThan(0.3);
  expect(result.raised - result.top).toBeLessThan(0.7);
  expect(result.cavity).toBeGreaterThan(0.15);
  expect(result.farUnchanged).toBe(true);
  expect(result.lost).toBeGreaterThan(1000);
  expect(result.error).toBeLessThan(0.0001);
  expect(result.exact).toBe(true);
  expect(result.newHeight).toBeGreaterThan(2.7);
  expect(result.baseChanged).toBe(true);
  expect(result.baked).toEqual(["cut"]);
  expect(result.bakedPreserved).toBe(true);
  expect(result.gl).toBe(0);
});
test("water spline directs GPU river births and transport, reversal reverses current, hidden routes emit none, with no steady-state CPU transfer", async ({
  page,
}) => {
  await laboratory(page);
  const result = await page.evaluate(async () => {
    const { GPUErosion } = await import("/src/gpu-erosion.js"),
      { generateVolume, defaults } = await import("/src/field.js"),
      { makePath } = await import("/src/splines.js");
    const s = new GPUErosion(
        document.createElement("canvas").getContext("webgl2"),
      ),
      route = {
        ...makePath("river", "water"),
        points: [
          [-10, 5, 0],
          [10, 5, 0],
        ],
        width: 2,
        speed: 4,
      },
      p = {
        ...defaults,
        preset: 3,
        sourceMode: 2,
        waterLevel: 5,
        rainfall: 1,
        particleCount: 128,
        sceneObjects: [route],
      },
      volume = generateVolume(p);
    s.upload(volume);
    s.flowPaths.update(p);
    const gl = s.gl,
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
    await s.step(p, 1);
    const transfers = { reads, uploads };
    gl.readPixels = read;
    gl.texImage2D = upload;
    function stats() {
      const pos = s.read(s.positions[s.motionIndex], 64, 32),
        vel = s.read(s.velocities[s.motionIndex], 64, 32);
      let active = 0,
        vx = 0,
        vz = 0,
        maxZ = 0;
      for (let i = 0; i < 128 * 4; i += 4)
        if (pos[i + 3] >= 0) {
          active++;
          vx += vel[i];
          vz += vel[i + 2];
          maxZ = Math.max(maxZ, Math.abs(pos[i + 2]));
        }
      return {
        active,
        vx: vx / Math.max(1, active),
        vz: vz / Math.max(1, active),
        maxZ,
      };
    }
    const forward = stats();
    s.upload(volume);
    route.points.reverse();
    await s.step(p, 1);
    const backward = stats();
    s.upload(volume);
    route.visible = false;
    await s.step(p, 1);
    const hidden = stats();
    return { forward, backward, hidden, transfers, gl: gl.getError() };
  });
  expect(result.forward.active).toBe(128);
  expect(result.forward.vx).toBeGreaterThan(2);
  expect(Math.abs(result.forward.vz)).toBeLessThan(0.5);
  expect(result.forward.maxZ).toBeLessThan(1);
  expect(result.backward.vx).toBeLessThan(-2);
  expect(result.hidden.active).toBe(0);
  expect(result.transfers).toEqual({ reads: 0, uploads: 0 });
  expect(result.gl).toBe(0);
});
test("left outliner and right inspector support land, viewport point placement/drag, live cut visibility, and a separate water path", async ({
  page,
}) => {
  test.setTimeout(300000);
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  await page.locator("#new-scene").click();
  await page.locator("#new-plot").click();
  await expect(page.locator("#add-cut")).toBeEnabled();
  await page.waitForFunction(() => frontier.settings.preset === 3);
  await expect(page.locator("[data-tool=ridge]")).toHaveClass(/active/);
  const geometry = await page.evaluate(async () => {
    const { sampleVolume } = await import("/src/field.js");
    window.plotBefore = await frontier.readVolume();
    return sampleVolume(plotBefore, [0, 2, 0]);
  });
  expect(geometry).toBeLessThan(0);
  await page.locator("#add-object").click();
  await page.locator("#add-cut").click();
  const rect = await page.locator("#scene").boundingBox();
  let count = 0;
  for (const [u, v] of [
    [0.36, 0.42],
    [0.5, 0.5],
    [0.64, 0.58],
  ]) {
    await page.mouse.click(rect.x + rect.width * u, rect.y + rect.height * v);
    await expect(page.locator("#add-cut")).toBeEnabled();
    await page.waitForFunction(
      (n) => frontier.scene.objects[0]?.points.length === n,
      ++count,
    );
    await page.waitForFunction(() => !frontier.scene.pending);
  }
  await expect(page.locator("#point-list button")).toHaveCount(3);
  await page.waitForFunction(() => frontier.scene.liveBase);
  await page.locator("#path-finish").click();
  await page.locator("#object-name").fill("Main channel");
  await page.locator("#object-name").press("Tab");
  await expect(page.locator("[data-object=path-1]")).toContainText(
    "Main channel",
  );
  const beforeDrag = await page.evaluate(
    () => frontier.scene.objects[0].points[2],
  );
  const handle = page.locator("#spline-overlay [data-spline-point]").last(),
    h = await handle.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 18, h.y + h.height / 2 - 12, {
    steps: 4,
  });
  await page.mouse.up();
  await page.waitForFunction(() => !frontier.scene.pending);
  await expect(page.locator("#add-cut")).toBeEnabled();
  const afterDrag = await page.evaluate(
    () => frontier.scene.objects[0].points[2],
  );
  expect(
    Math.hypot(afterDrag[0] - beforeDrag[0], afterDrag[2] - beforeDrag[2]),
  ).toBeGreaterThan(0.5);
  await page.locator("#object-visible").uncheck();
  await page.waitForFunction(() => !frontier.scene.liveBase);
  const exact = await page.evaluate(async () => {
    const a = await frontier.readVolume();
    return a.every((v, i) => v === plotBefore[i]);
  });
  expect(exact).toBe(true);
  await page.locator("#object-visible").check();
  await page.waitForFunction(() => frontier.scene.liveBase);
  await expect(page.locator("#path-copy-water")).toBeEnabled();
  await page.locator("#path-copy-water").click();
  await expect(page.locator("#path-kind")).toHaveText("WATER FLOW SPLINE");
  expect(
    await page.evaluate(() => frontier.scene.objects.map((n) => n.type)),
  ).toEqual(["cut", "water"]);
  await expect(page.locator("#point-y")).toBeDisabled();
  const positions = await Promise.all(
    [".outliner", "#viewport", ".sidebar"].map((s) =>
      page.locator(s).boundingBox(),
    ),
  );
  expect(positions[0].x).toBeLessThan(positions[1].x);
  expect(positions[2].x).toBeGreaterThan(
    positions[1].x + positions[1].width - 1,
  );
  await page.screenshot({ path: "artifacts/land-spline-editor.png" });
  await page.setViewportSize({ width: 650, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    650,
  );
  await expect(page.locator("#path-width")).toBeVisible();
  expect(await page.evaluate(() => frontier.diagnostics.error)).toBeFalsy();
});
test("water spline footprint and terrain visibility change rendered pixels without changing the SDF", async ({
  page,
}) => {
  await laboratory(page);
  const r = await page.evaluate(async () => {
    const { createRenderer } = await import("/src/renderer.js"),
      { generateVolume, defaults } = await import("/src/field.js"),
      { makePath } = await import("/src/splines.js");
    document.body.innerHTML =
      '<canvas style="width:400px;height:300px"></canvas>';
    const canvas = document.querySelector("canvas"),
      width = 320,
      height = 240,
      route = {
        ...makePath("r", "water"),
        points: [
          [-5, 3.2, -12],
          [-5, 3.2, 12],
        ],
        width: 5,
      },
      p = { ...defaults, preset: 3, waterLevel: 3.2, sceneObjects: [route] };
    const uniform = () =>
      new Float32Array([
        16,
        22,
        30,
        2,
        0,
        1,
        0,
        width / height,
        width,
        height,
        0,
        0,
        p.sun,
        p.haze,
        p.waterLevel,
        p.waterEnabled ? 1 : 0,
        p.strata,
        p.roughness,
        p.clarity,
        p.ripple,
        0,
        0,
        0,
        -1,
        0,
        3,
        0,
        0,
      ]);
    const renderer = await createRenderer(
      canvas,
      null,
      generateVolume(p),
      () => {},
      uniform(),
      p,
    );
    canvas.width = width;
    canvas.height = height;
    const gl = renderer.gl,
      original = await renderer.readVolume();
    function render() {
      renderer.draw(uniform());
      const a = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, a);
      return a;
    }
    function changed(a, b) {
      let n = 0;
      for (let i = 0; i < a.length; i += 4)
        if (
          Math.abs(a[i] - b[i]) +
            Math.abs(a[i + 1] - b[i + 1]) +
            Math.abs(a[i + 2] - b[i + 2]) >
          8
        )
          n++;
      return n;
    }
    const left = render();
    route.points.forEach((p) => (p[0] = 5));
    const right = render();
    route.visible = false;
    const hidden = render();
    p.waterEnabled = false;
    const off = render();
    p.showTerrain = false;
    const noTerrain = render();
    const final = await renderer.readVolume();
    return {
      routePixels: changed(left, right),
      hiddenPixels: changed(right, hidden),
      hiddenEqualsOff: hidden.every((v, i) => v === off[i]),
      terrainPixels: changed(noTerrain, off),
      sameVolume: final.every((v, i) => v === original[i]),
      opaque: noTerrain.every((v, i) => i % 4 !== 3 || v === 255),
      gl: gl.getError(),
    };
  });
  expect(r.routePixels).toBeGreaterThan(500);
  expect(r.hiddenPixels).toBeGreaterThan(200);
  expect(r.hiddenEqualsOff).toBe(true);
  expect(r.terrainPixels).toBeGreaterThan(5000);
  expect(r.sameVolume).toBe(true);
  expect(r.opaque).toBe(true);
  expect(r.gl).toBe(0);
});
