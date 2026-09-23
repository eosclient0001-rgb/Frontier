import { test, expect as assertion } from "@playwright/test";
const expect = assertion.configure({ timeout: 60000 });

test("default noise mountain stages edits, confirms generation, then erodes the generated GPU solid", async ({
  page,
}) => {
  test.setTimeout(300000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.noiseWorkerTasks = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (m, ...rest) {
      noiseWorkerTasks.push(m.type);
      return post.call(this, m, ...rest);
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  expect(await page.evaluate(() => frontier.settings.preset)).toBe(4);
  expect(await page.evaluate(() => frontier.diagnostics.frameHealth.ok)).toBe(
    true,
  );
  expect(
    await page.evaluate(() => ({
      water: frontier.settings.waterEnabled,
      river: frontier.settings.riverEnabled,
    })),
  ).toEqual({ water: false, river: false });
  await expect(page.locator("#scene-title")).toHaveText("Ridge range");
  await expect(page.locator("#terrainNoise")).toHaveValue("3");
  await expect(page.locator("#canyon-controls")).toBeHidden();
  await page.evaluate(async () => {
    window.baseBefore = await frontier.readVolume();
    noiseWorkerTasks.length = 0;
  });
  await page.screenshot({ path: "artifacts/noise-mountain.png" });
  await page.locator("#terrainForm").selectOption("1");
  await page.locator("#terrainNoise").selectOption("1");
  await page.locator("#terrainSeed").fill("7109");
  await page.locator("#terrainHeight-value").click();
  await page.locator("#terrainHeight-value input").fill("16");
  await page.locator("#terrainHeight-value input").press("Enter");
  expect(await page.evaluate(() => frontier.settings.terrainHeight)).toBe(14);
  expect(await page.evaluate(() => noiseWorkerTasks)).toEqual([]);
  expect(
    await page.evaluate(async () => {
      const v = await frontier.readVolume();
      return v.every((x, i) => x === baseBefore[i]);
    }),
  ).toBe(true);
  await page.locator("#terrain-erode").click();
  await expect(page.locator("#panel-terrain")).toBeVisible();
  await expect(page.locator("#terrain-generator-status")).toContainText(
    "Generate to apply",
  );
  page.once("dialog", (d) => d.dismiss());
  await page.locator("#terrain-generate").click();
  expect(await page.evaluate(() => frontier.settings.terrainNoise)).toBe(3);
  expect(await page.evaluate(() => noiseWorkerTasks)).toEqual([]);
  page.once("dialog", (d) => d.accept());
  await page.locator("#terrain-generate").click();
  await expect(page.locator("#terrain-generator-status")).toContainText(
    "Base ready",
  );
  await expect(page.locator("#terrain-generate")).toBeEnabled();
  expect(await page.evaluate(() => frontier.settings.terrainHeight)).toBe(16);
  expect(await page.evaluate(() => frontier.settings.terrainNoise)).toBe(1);
  expect(await page.evaluate(() => frontier.settings.terrainSeed)).toBe(7109);
  await expect(page.locator("#scene-title")).toHaveText("Ridge range");
  expect(await page.evaluate(() => noiseWorkerTasks)).toEqual([
    "world",
    "init",
  ]);
  expect(
    await page.evaluate(async () => {
      window.generated = await frontier.readVolume();
      return generated.some(
        (x, i) => i % 4 === 0 && Math.abs(x - baseBefore[i]) > 0.1,
      );
    }),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/noise-ridge-range.png" });
  await page.locator("#terrain-erode").click();
  await expect(page.locator("#panel-erosion")).toBeVisible();
  await page.locator('[data-source="0"]').click();
  await page.evaluate(() => (noiseWorkerTasks.length = 0));
  await page.locator("#step").click();
  await page.waitForFunction(() => frontier.iterations === 1);
  const report = await page.evaluate(async () => {
    const v = await frontier.readVolume();
    let changed = 0;
    for (let i = 0; i < v.length; i += 4) if (v[i] !== generated[i]) changed++;
    return {
      changed,
      audit: await frontier.auditErosion(),
      worker: noiseWorkerTasks,
    };
  });
  expect(report.changed).toBeGreaterThan(100);
  expect(report.audit.eroded).toBeGreaterThan(0);
  expect(report.audit.active).toBeGreaterThan(100);
  expect(Math.abs(report.audit.ledgerError)).toBeLessThan(0.005);
  expect(report.worker).toEqual([]);
  await page.locator('[data-source="3"]').click();
  expect(await page.evaluate(() => frontier.settings.sourceMode)).toBe(3);
  await page.locator("[data-tab=terrain]").click();
  // Regeneration resets the edit and reuses the applied seed deterministically.
  page.once("dialog", (d) => d.accept());
  await page.locator("#terrain-generate").click();
  await expect(page.locator("#terrain-generator-status")).toContainText(
    "Base ready",
  );
  expect(await page.evaluate(() => frontier.iterations)).toBe(0);
  expect(
    await page.evaluate(async () => {
      const v = await frontier.readVolume();
      return v.every((x, i) => x === generated[i]);
    }),
  ).toBe(true);
  await page.setViewportSize({ width: 770, height: 540 });
  await expect(page.locator("#terrain-generate")).toBeInViewport();
  await page.screenshot({ path: "artifacts/noise-terrain-compact.png" });
  expect(errors).toEqual([]);
});

test("new scene chooser switches between blank land and generated terrain without fixed scenes", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/?preset=0");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  await expect(page.locator("#canyon-controls")).toHaveCount(0);
  await page.locator("#new-scene").click();
  await page.locator('[data-preset="4"]').click();
  await expect(page.locator("#new-scene-dialog")).toBeHidden();
  await expect(page.locator("#add-object")).toBeEnabled();
  await expect(page.locator("#scene-title")).toHaveText("Ridge range");
  await expect(page.locator("#noise-terrain-controls")).toBeVisible();
  await expect(page.locator("#terrainNoise")).toHaveValue("3");
  expect(await page.evaluate(() => frontier.settings.riverEnabled)).toBe(false);
  await page.locator("#new-scene").click();
  page.once("dialog", (d) => d.accept());
  await page.locator("#new-plot").click();
  await expect(page.locator("#add-object")).toBeEnabled();
  await expect(page.locator("#scene-title")).toHaveText("Land plot");
  await expect(page.locator("#noise-terrain-controls")).toBeHidden();
  expect(await page.evaluate(() => frontier.settings.waterEnabled)).toBe(false);
});
