import { test, expect as assertion } from "@playwright/test";
const expect = assertion.configure({ timeout: 60000 });
test("all seven GPU primitives match rotated CPU geometry; profile changes are live and torus has a real hole", async ({
  page,
}) => {
  test.setTimeout(300000);
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { GPUErosion } = await import("/src/gpu-erosion.js"),
      { defaults, generateVolume, sampleVolume } =
        await import("/src/field.js"),
      { makeShape, shapeDistance } = await import("/src/shapes.js");
    const s = new GPUErosion(
      document.createElement("canvas").getContext("webgl2"),
    );
    s.upload(generateVolume({ ...defaults, preset: 3 }));
    const base = await s.readVolume(),
      results = [];
    for (let primitive = 0; primitive < 7; primitive++) {
      const n = {
        ...makeShape("primitive"),
        position: [0, 8, 0],
        size: [7, 5, 6],
        primitive,
        rotation: [13, 27, -9],
        noiseAmount: 0,
        profile: 0.35,
      };
      await s.refreshSplineCuts([n]);
      const a = await s.readVolume();
      let error = 0,
        solid = 0,
        profileChanges = 0;
      for (let z = 43; z < 69; z += 2)
        for (let y = 22; y < 41; y += 2)
          for (let x = 43; x < 69; x += 2) {
            const p = [
                -22 + ((x + 0.5) * 44) / 112,
                -4 + ((y + 0.5) * 26) / 72,
                -20 + ((z + 0.5) * 40) / 112,
              ],
              i = ((z * 72 + y) * 112 + x) * 4;
            error = Math.max(
              error,
              Math.abs(a[i] - Math.min(base[i], shapeDistance(p, n))),
            );
            if (a[i] < 0 && base[i] > 0) solid++;
          }
      n.profile = 0.75;
      await s.refreshSplineCuts([n]);
      const b = await s.readVolume();
      for (let i = 3; i < b.length; i += 4)
        if (Math.abs(b[i] - a[i]) > 0.02) profileChanges++;
      results.push({ primitive, error, solid, profileChanges });
    }
    const ring = {
      ...makeShape("ring"),
      position: [0, 8, 0],
      size: [7, 5, 6],
      primitive: 3,
      noiseAmount: 0,
    };
    await s.refreshSplineCuts([ring]);
    const a = await s.readVolume();
    await s.refreshSplineCuts([]);
    const restored = await s.readVolume();
    return {
      results,
      hole: sampleVolume(a, [0, 8, 0]),
      rim: sampleVolume(a, [2.625, 8, 0]),
      restored: restored.every((v, i) => v === base[i]),
      gl: s.gl.getError(),
    };
  });
  // Rotated float/half-float atlas values allow < 1 cm error (voxel size ~36 cm).
  for (const r of result.results) {
    expect(r.error, `primitive ${r.primitive}`).toBeLessThan(0.01);
    expect(r.solid).toBeGreaterThan(10);
    if ([2, 3, 4, 5].includes(r.primitive))
      expect(r.profileChanges).toBeGreaterThan(10);
    else expect(r.profileChanges).toBe(0);
  }
  expect(result.hole).toBeGreaterThan(0.5);
  expect(result.rim).toBeLessThan(-0.2);
  expect(result.restored).toBe(true);
  expect(result.gl).toBe(0);
});
test("G/R/S switch real handles, RMB+S only flies, form typing is safe, and ring drag rotates GPU solid without moving camera", async ({
  page,
}) => {
  test.setTimeout(300000);
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.requestPointerLock = () =>
      Promise.reject(new Error("test fallback"));
  });
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  await page.locator("#new-scene").click();
  await page.locator("#new-plot").click();
  await expect(page.locator("#add-shape")).toBeEnabled();
  await page.locator("#add-object").click();
  await page.locator("#add-shape").click();
  await page.waitForFunction(() => !frontier.scene.pending);
  await expect(page.locator("#shape-primitive option")).toHaveCount(7);
  await page.locator("#shape-primitive").selectOption("1");
  await page.waitForFunction(() => !frontier.scene.pending);
  for (const [id, value] of [
    ["shape-size-x", "8"],
    ["shape-noise-Amount", "0"],
  ]) {
    await page.locator("#" + id).fill(value);
    await page.locator("#" + id).dispatchEvent("input");
    await page.waitForFunction(() => !frontier.scene.pending);
  }
  await page.locator("#scene").focus();
  const original = await page.evaluate(() => frontier.camera);
  await page.keyboard.press("s");
  await expect(page.locator("#gizmo-scale")).toHaveClass(/active/);
  await expect(page.locator("rect[data-gizmo-axis=x]")).toBeVisible();
  await page.keyboard.down("w");
  await page.waitForTimeout(250);
  await page.keyboard.up("w");
  expect(await page.evaluate(() => frontier.camera)).toEqual(original);
  await page.keyboard.press("g");
  await expect(page.locator("circle[data-gizmo-axis=x]")).toBeVisible();
  await page.keyboard.press("r");
  await expect(page.locator("[data-gizmo-rotation]")).toHaveCount(3);
  expect(await page.evaluate(() => frontier.camera)).toEqual(original);
  await page.locator("#shape-name").fill("GRS organic form");
  await page.locator("#shape-name").press("s");
  await page.locator("#shape-name").press("Tab");
  await expect(page.locator("#gizmo-rotate")).toHaveClass(/active/);
  await page.locator("#shape-primitive").focus();
  await page.keyboard.press("s");
  await expect(page.locator("#gizmo-rotate")).toHaveClass(/active/);
  await page.locator("#scene").focus();
  await page.keyboard.press("Control+g");
  await expect(page.locator("#gizmo-rotate")).toHaveClass(/active/);
  const rect = await page.locator("#scene").boundingBox();
  await page.mouse.move(rect.x + rect.width * 0.5, rect.y + rect.height * 0.5);
  await page.mouse.down({ button: "right" });
  await page.keyboard.down("s");
  await page.waitForFunction(
    (eye) => Math.hypot(...frontier.camera.eye.map((v, k) => v - eye[k])) > 0.1,
    original.eye,
  );
  await page.keyboard.press("g");
  await expect(page.locator("#gizmo-rotate")).toHaveClass(/active/);
  await page.mouse.up({ button: "right" });
  const stopped = await page.evaluate(() => frontier.camera);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => frontier.camera)).toEqual(stopped);
  await page.keyboard.up("s");
  await page.keyboard.press("Home");
  await page.keyboard.press("r");
  await page.evaluate(async () => {
    window.beforeRotation = await frontier.readVolume();
  });
  const before = await page.evaluate(() => ({
    camera: frontier.camera,
    node: frontier.scene.objects[0],
  }));
  // Project two points on the actual world-Y rotation ring; drag through 60 degrees.
  const drag = await page.evaluate(() => {
    const c = frontier.camera,
      n = frontier.scene.objects[0],
      r = document.querySelector("#scene").getBoundingClientRect(),
      norm = (v) => {
        const l = Math.hypot(...v);
        return v.map((x) => x / l);
      },
      cross = (a, b) => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ],
      dot = (a, b) => a.reduce((s, v, k) => s + v * b[k], 0),
      f = norm(c.target.map((v, k) => v - c.eye[k])),
      right = norm(cross(f, [0, 1, 0])),
      up = cross(right, f);
    return [0.2, 0.2 + Math.PI / 3].map((a) => {
      const p = [
          n.position[0] + 4 * Math.sin(a),
          n.position[1],
          n.position[2] + 4 * Math.cos(a),
        ],
        v = p.map((x, k) => x - c.eye[k]),
        z = dot(v, f);
      return {
        x: r.left + r.width / 2 + ((dot(v, right) / z) * r.height) / (2 * 0.62),
        y: r.top + r.height / 2 - ((dot(v, up) / z) * r.height) / (2 * 0.62),
      };
    });
  });
  await page.mouse.move(drag[0].x, drag[0].y);
  await page.mouse.down();
  await page.mouse.move(drag[1].x, drag[1].y, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => !frontier.scene.pending);
  const after = await page.evaluate(async () => {
    const { sampleVolume } = await import("/src/field.js"),
      n = frontier.scene.objects[0],
      p = [n.position[0] + 3.5, n.position[1], n.position[2]],
      a = await frontier.readVolume();
    return {
      camera: frontier.camera,
      node: n,
      old: sampleVolume(beforeRotation, p),
      next: sampleVolume(a, p),
    };
  });
  expect(after.camera).toEqual(before.camera);
  expect(after.node.rotation[1]).toBeCloseTo(60, 0);
  expect(after.old).toBeLessThan(-0.1);
  expect(after.next).toBeGreaterThan(0.1);
  await page.locator("#shape-primitive").selectOption("5");
  await page.waitForFunction(() => !frontier.scene.pending);
  await expect(page.locator("#shape-profile")).toBeEnabled();
  await page.locator("#scene").focus();
  await page.screenshot({ path: "artifacts/organic-rotation-gizmo.png" });
});
