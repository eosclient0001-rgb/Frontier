import { test, expect } from "@playwright/test";

for (const legacyLink of [false, true]) {
  test(`${legacyLink ? "WebGL2 legacy URL" : "WebGL2 default"}: real volume edits and studio controls`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(legacyLink ? "/?webgl" : "/");
    await page.waitForFunction(() => window.frontier, { timeout: 60_000 });
    const backend = await page.evaluate(() => window.frontier.backend);
    expect(backend).toBe("WebGL2");
    expect(await page.evaluate(() => frontier.diagnostics.webgpuEnabled)).toBe(
      false,
    );
    await page.evaluate(async () => {
      window.beforeVolume = await frontier.readVolume();
    });
    await page.locator("#inspector-switch").click();
    await page.locator("[data-tab=erosion]").click();
    await page.locator("#step").click();
    await page.waitForFunction(() => frontier.iterations === 1);
    const simulation = await page.evaluate(async () => {
      const a = await frontier.readVolume();
      let changed = 0,
        wet = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i] !== beforeVolume[i]) changed++;
        if (a[i + 1] > 0) wet++;
      }
      return { changed, wet };
    });
    expect(simulation.changed).toBeGreaterThan(1000);
    expect(simulation.wet).toBeGreaterThan(1000);
    await page.locator("#inspector-switch").click();
    await page.locator('[data-tab="erosion"]').click();
    await page.locator("#rainfall").fill("0.9");
    await page.locator("#rainfall").dispatchEvent("input");
    expect(await page.evaluate(() => frontier.settings.rainfall)).toBe(0.9);
    await page.locator("#run").click();
    await page.waitForFunction(() => frontier.iterations > 4, {
      timeout: 60_000,
    });
    await page.locator("#run").click();
    await expect(page.locator("#run-label")).toHaveText("Run erosion");
    await page.locator("#inspector-switch").click();
    await page.locator('[data-tab="terrain"]').click();
    await page.locator("#inspector-switch").click();
    await page.locator("[data-tab=sculpt]").click();
    await page.locator('[data-tool="carve"]').click();
    await page.evaluate(async () => {
      window.beforeVolume = await frontier.readVolume();
    });
    const r = await page.locator("#scene").boundingBox();
    await page.mouse.click(r.x + r.width * 0.42, r.y + r.height * 0.46);
    // In particular, a single click during an in-flight hover pick must not vanish.
    await page.waitForFunction(
      async () => {
        const a = await frontier.readVolume();
        let removed = 0;
        for (let i = 0; i < a.length; i += 4)
          if (beforeVolume[i] < 0 && a[i] > 0) removed++;
        return removed > 5;
      },
      null,
      { timeout: 60_000, polling: 1000 },
    );
    await page.locator("#inspector-switch").click();
    await page.locator('[data-tab="water"]').click();
    await page.locator("#water-toggle").click();
    expect(await page.evaluate(() => frontier.settings.waterEnabled)).toBe(
      false,
    );
    await page.locator("#viewport-options").click();
    await page.locator("#view-mode").click();
    await expect(page.locator("#view-mode span")).toHaveText("Clay view");
    await page.locator("#help").click();
    await expect(page.locator("#help-dialog")).toBeVisible();
    await page.locator("#close-help").click();
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.frontier$/);
    await page.locator("#new-scene").click();
    await page.locator('[data-preset="2"]').click();
    await page.waitForFunction(
      () => frontier.settings.preset === 2 && frontier.iterations === 0,
      { timeout: 60_000 },
    );
    await expect(page.locator("#biome-name")).toHaveText("Monument valley");
    await page.setViewportSize({ width: 650, height: 800 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(650);
    expect(errors).toEqual([]);
  });
}
