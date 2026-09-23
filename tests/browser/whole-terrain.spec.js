import { test, expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 60000 });
async function bare(page) {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
}
test("non-square tall whole-volume GPU: remote shapes, sculpt, spline cuts, intact selection and terrain-wide rain", async ({
  page,
}) => {
  test.setTimeout(300000);
  await bare(page);
  const result = await page.evaluate(async () => {
    const { GPUErosion } = await import("/src/gpu-erosion.js"),
      { defaults, sampleVolume } = await import("/src/field.js"),
      { worldDefaults } = await import("/src/world.js");
    const { configureDomain, SIZE, MIN, MAX, CELL, BAND, SCENE_SCALE } =
      await import("/src/domain.js");
    const { makeShape } = await import("/src/shapes.js"),
      { makePath } = await import("/src/splines.js");
    const { generateCellPattern } = await import("/src/cell-fracture.js"),
      { selectIntactCell } = await import("/src/intact-fracture.js");
    const p = {
      ...defaults,
      ...worldDefaults,
      terrainWidth: 1800,
      terrainLength: 500,
      terrainHeight: 700,
      particleCount: 1024,
      rainfall: 1,
      wind: 0,
    };
    configureDomain(p);
    const d = { cell: [...CELL], max: [...MAX], min: [...MIN] },
      a = new Float32Array(SIZE.reduce((x, y) => x * y, 4));
    const surface = (x, z) => 350 + 0.12 * x + 0.04 * z;
    for (let z = 0; z < SIZE[2]; z++)
      for (let y = 0; y < SIZE[1]; y++)
        for (let x = 0; x < SIZE[0]; x++) {
          const xyz = [x, y, z].map((v, k) => MIN[k] + (v + 0.5) * CELL[k]),
            i = ((z * SIZE[1] + y) * SIZE[0] + x) * 4;
          const dist = Math.max(
            (xyz[1] - surface(xyz[0], xyz[2])) / Math.hypot(1, 0.12, 0.04),
            MIN[1] + CELL[1] - xyz[1],
          );
          a[i] = dist;
          a[i + 3] = Math.max(0, Math.min(1, 0.5 - dist / (2 * BAND)));
        }
    const gl = document.createElement("canvas").getContext("webgl2"),
      s = new GPUErosion(gl);
    s.upload(a);
    const hit = await s.pick([650, MAX[1] + 100, 160], [0, -1, 0]);
    const shape = makeShape("far");
    Object.assign(shape, { position: [650, 570, 160], size: [140, 120, 140] });
    s.applyShape(shape);
    const shapeHit = await s.pick([650, MAX[1] + 100, 160], [0, -1, 0]);
    const solid = await s.readVolume();
    const pattern = generateCellPattern(
      [{ point: shapeHit, view: [0, -1, 0], radius: 50 }],
      {
        size: 4.5 * Math.max(1, Math.min(...CELL) / 0.25),
        depth: 18 * Math.max(1, Math.min(...CELL) / 0.25),
        gap: 0.014,
        intact: true,
      },
    );
    const selection = selectIntactCell(solid, shapeHit, pattern);
    await s.sculpt(shapeHit, Math.max(...CELL) * 3, "carve", p);
    const carved = sampleVolume(await s.readVolume(), shapeHit);
    s.upload(a);
    s.applyShape(shape);
    const cut = {
      ...makePath("cut", "cut"),
      points: [
        [610, 610, 140],
        [690, 610, 180],
      ],
      width: 65,
      depth: 90,
    };
    s.applySplineCut(cut);
    const cutDistance = sampleVolume(await s.readVolume(), [650, 600, 160]);
    s.setChunkSelection(selection.mask);
    await s.deleteChunk();
    const removed = await s.readVolume();
    let removedCells = 0;
    for (let i = 0; i < selection.mask.length; i++)
      if (selection.mask[i] && removed[i * 4 + 3] < 0.01) removedCells++;
    s.upload(a);
    await s.step({ ...p, sourceMode: 2, sceneObjects: [] });
    const noRoute = (await s.audit()).active;
    const route = {
      ...makePath("river", "water"),
      points: [
        [650, surface(650, 160) + 3, 160],
        [780, surface(780, 160) + 3, 180],
      ],
      width: 60,
    };
    s.upload(a);
    await s.step({
      ...p,
      sourceMode: 2,
      riverEnabled: true,
      sceneObjects: [route],
    });
    const river = s.read(s.positions[s.motionIndex], 64, 32);
    let riverX = [],
      riverY = [];
    for (let i = 0; i < p.particleCount; i++) {
      const k = i * 4;
      if (river[k + 3] >= 0) {
        riverX.push(river[k]);
        riverY.push(river[k + 1]);
      }
    }
    s.upload(a);
    await s.step({
      ...p,
      sourceMode: 3,
      windHeight: 600,
      windSpread: 60,
      windDirection: 0,
    });
    const wind = s.read(s.positions[s.motionIndex], 64, 32);
    let windY = [],
      windZ = [];
    for (let i = 0; i < p.particleCount; i++) {
      const k = i * 4;
      if (wind[k + 3] >= 0) {
        windY.push(wind[k + 1]);
        windZ.push(wind[k + 2]);
      }
    }
    s.upload(a);
    await s.step(p);
    const births = s.read(s.positions[s.motionIndex], 64, 32);
    let xs = [],
      zs = [],
      ys = [],
      clearances = [];
    for (let i = 0; i < p.particleCount; i++) {
      const k = i * 4;
      if (births[k + 3] < 0) continue;
      xs.push(births[k]);
      ys.push(births[k + 1]);
      zs.push(births[k + 2]);
      clearances.push(births[k + 1] - surface(births[k], births[k + 2]));
    }
    const birthAudit = await s.audit();
    let transfers = 0;
    const read = gl.readPixels.bind(gl);
    gl.readPixels = (...args) => {
      transfers++;
      return read(...args);
    };
    for (let batch = 0; batch < 8; batch++) await s.step(p, 10);
    const perStepTransfers = transfers;
    gl.readPixels = read;
    const audit = await s.audit();
    return {
      d,
      hit,
      shapeHit,
      removedCells,
      noRoute,
      riverCount: riverX.length,
      riverMinX: Math.min(...riverX),
      riverMinY: Math.min(...riverY),
      windCount: windY.length,
      windMinY: Math.min(...windY),
      windZSpan: Math.max(...windZ) - Math.min(...windZ),
      selectionCount: selection.count ?? selection.voxels,
      selectionKeys: Object.keys(selection),
      carved,
      cutDistance,
      births: xs.length,
      xspan: Math.max(...xs) - Math.min(...xs),
      zspan: Math.max(...zs) - Math.min(...zs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      clearance: Math.min(...clearances),
      birthAudit,
      audit,
      perStepTransfers,
    };
  });

  expect(result.hit[0]).toBe(650);
  expect(result.hit[1]).toBeGreaterThan(400);
  expect(result.shapeHit[1]).toBeGreaterThan(625);
  expect(result.selectionCount).toBeGreaterThan(0);
  expect(result.removedCells).toBeGreaterThan(0);
  expect(result.noRoute).toBe(0);
  expect(result.riverCount).toBeGreaterThan(100);
  expect(result.riverMinX).toBeGreaterThan(600);
  expect(result.riverMinY).toBeGreaterThan(400);
  expect(result.windCount).toBeGreaterThan(100);
  expect(result.windMinY).toBeGreaterThan(560);
  expect(result.windZSpan).toBeGreaterThan(350);
  expect(result.carved).toBeGreaterThan(15);
  expect(result.cutDistance).toBeGreaterThan(10);
  expect(result.births).toBeGreaterThan(30);
  expect(result.xspan).toBeGreaterThan(1300);
  expect(result.zspan).toBeGreaterThan(350);
  expect(result.minY).toBeGreaterThan(200);
  expect(result.maxY).toBeLessThan(600);
  expect(result.clearance).toBeGreaterThan(15);
  expect(result.birthAudit.eroded).toBe(0);
  expect(result.perStepTransfers).toBe(0);
  expect(result.audit.eroded).toBeGreaterThan(0);
  expect(Math.abs(result.audit.ledgerError)).toBeLessThan(0.005);
  expect(
    Math.abs(result.audit.massError) / result.audit.initialSolid,
  ).toBeLessThan(1e-7);
});

test("whole-terrain UI has no patch restrictions; remote screen sculpt and drawn water points use world XYZ", async ({
  page,
}) => {
  test.setTimeout(360000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?preset=0");
  await page.waitForFunction(() => window.frontier);

  await expect(page.locator("#world-detail")).toContainText(
    "8.06 × 4.06 × 8.06 m",
  );
  await expect(
    page.locator('#world-activate,#world-focus,[data-preset="0"]'),
  ).toHaveCount(0);
  const project = async (x, z) =>
    page.evaluate(
      async ([x, z]) => {
        const { raycastVolume } = await import("/src/field.js"),
          { cameraEye, cameraBasis } = await import("/src/camera.js");
        const a = await frontier.readVolume();
        window.beforeTerrain = a;
        const p = raycastVolume(
          a,
          [x, frontier.world.max[1] + 100, z],
          [0, -1, 0],
        );
        window.remoteHit = p;
        const c = frontier.camera,
          eye = cameraEye(c),
          b = cameraBasis(c),
          q = p.map((v, k) => v - eye[k]),
          dot = (v) => q.reduce((a, x, k) => a + x * v[k], 0),
          depth = dot(b.forward),
          r = document.querySelector("canvas").getBoundingClientRect();
        return {
          x:
            r.left +
            r.width *
              (0.5 + dot(b.right) / ((2 * 0.62 * depth * r.width) / r.height)),
          y: r.top + r.height * (0.5 - dot(b.up) / (2 * 0.62 * depth)),
          point: p,
        };
      },
      [x, z],
    );
  const screen = await project(350, 300);
  await page.locator("[data-tab=sculpt]").click();
  await page.locator("[data-tool=carve]").click();
  await page.mouse.move(screen.x, screen.y);
  await page.mouse.click(screen.x, screen.y);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const a = await frontier.readVolume();
          let count = 0;
          for (let i = 0; i < a.length; i += 4)
            if (a[i] !== beforeTerrain[i]) count++;
          return count;
        }),
      { timeout: 60000 },
    )
    .toBeGreaterThan(0);
  const changed = await page.evaluate(async () => {
    const { sampleVolume } = await import("/src/field.js");
    return (
      sampleVolume(await frontier.readVolume(), remoteHit) -
      sampleVolume(beforeTerrain, remoteHit)
    );
  });
  expect(changed).toBeGreaterThan(8);
  await page.locator("#add-water").evaluate((e) => e.click());
  const s1 = await project(-350, 260);
  await page.mouse.click(s1.x, s1.y);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          frontier.settings.sceneObjects.find((n) => n.type === "water")?.points
            .length,
      ),
    )
    .toBe(1);
  const s2 = await project(350, 260);
  await page.mouse.click(s2.x, s2.y);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          frontier.settings.sceneObjects.find((n) => n.type === "water")?.points
            .length,
      ),
    )
    .toBe(2);
  await page.locator("#path-finish").click();
  const route = await page.evaluate(() =>
    frontier.settings.sceneObjects.find((n) => n.type === "water"),
  );
  expect(route.points[0][0]).toBeLessThan(-300);
  expect(route.points[1][0]).toBeGreaterThan(300);
  expect(route.width).toBeGreaterThan(30);
  await page.locator("#gizmo-move").click();
  await expect
    .poll(() => page.locator("[data-gizmo-axis]").count())
    .toBeGreaterThanOrEqual(2);
  await page.locator("#transform-y").fill("150");
  await page.locator("#transform-y").dispatchEvent("change");
  const moved = await page.evaluate(() =>
    frontier.settings.sceneObjects.find((n) => n.type === "water"),
  );
  expect(moved.points.every((p) => p[1] > 100)).toBe(true);
  await page.locator("#gizmo-rotate").click();
  await expect
    .poll(() => page.locator("[data-gizmo-rotation]").count())
    .toBeGreaterThan(0);
  await page.locator("#gizmo-scale").click();
  await expect
    .poll(() => page.locator("[data-gizmo-axis]").count())
    .toBeGreaterThanOrEqual(2);
  await page
    .locator("#transform-y")
    .fill(String((route.points[0][1] + route.points[1][1]) / 2));
  await page.locator("#transform-y").dispatchEvent("change");
  await page.locator("#gizmo-off").click();
  await page.screenshot({ path: "artifacts/whole-terrain-water-route.png" });
  expect(errors).toEqual([]);
});

test("regeneration applies non-square footprint and tall Y bounds to renderer and all spatial controls", async ({
  page,
}) => {
  test.setTimeout(240000);
  await page.goto("/");
  await page.waitForFunction(() => window.frontier);
  await page.evaluate(() => {
    for (const [id, v] of Object.entries({
      terrainWidth: 1800,
      terrainLength: 500,
      terrainHeight: 450,
    })) {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  expect(await page.evaluate(() => frontier.world.cell)).toEqual([
    8.0625, 4.0625, 8.0625,
  ]); // unapplied draft stays isolated
  page.on("dialog", (d) => d.accept());
  await page.locator("#terrain-generate").click();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          frontier.world.cell.map((v) => Number(v.toFixed(6))),
        ),
      { timeout: 120000 },
    )
    .toEqual([14.5125, 7.11, 4.35625]);
  await expect(page.locator("#terrain-generate")).toBeEnabled();
  const applied = await page.evaluate(() => ({
    world: frontier.world,
    settings: frontier.settings,
    camera: frontier.camera,
    limits: Object.fromEntries(
      [
        "point-x",
        "point-y",
        "point-z",
        "shape-size-y",
        "path-width",
        "windHeight",
        "fracture-brush",
        "radius",
      ].map((id) => {
        const e = document.getElementById(id);
        return [
          id,
          { min: Number(e.min), max: Number(e.max), value: Number(e.value) },
        ];
      }),
    ),
    health: frontier.diagnostics,
  }));
  expect(applied.world.max).toEqual([928.8, 523.8, 278.8]);
  expect(applied.limits["point-y"].max).toBe(523.8);
  expect(applied.limits["point-x"].max).toBe(928.8);
  expect(applied.limits["point-z"].max).toBe(278.8);
  expect(applied.settings.radius).toBeGreaterThan(40);
  expect(applied.limits["fracture-brush"].value).toBeGreaterThan(50);
  expect(applied.settings.windHeight).toBeGreaterThan(200);
  expect(applied.camera.distance).toBeGreaterThan(2000);
  expect(applied.health.erosionError).toBeNull();
});
