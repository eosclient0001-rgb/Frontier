import { test, expect } from "@playwright/test";

test("workspace CSS lays out a visible center canvas before the application starts, including embedded and short windows", async ({
  page,
}) => {
  // Deliberately prevent app initialization: structural CSS must not depend on JS/HMR.
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  expect(await page.evaluate(() => Boolean(window.frontier))).toBe(false);
  for (const [width, height] of [
    [1440, 900],
    [1100, 800],
    [900, 650],
    [820, 480],
    [650, 600],
    [390, 700],
  ]) {
    await page.setViewportSize({ width, height });
    const r = await page.evaluate(() => {
      const box = (s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          bottom: r.bottom,
          right: r.right,
        };
      };
      return {
        canvas: box("#scene"),
        viewport: box("#viewport"),
        outliner: box(".outliner"),
        properties: box(".sidebar"),
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      };
    });
    expect(r.canvas.width).toBeGreaterThan(width > 700 ? 380 : width * 0.28);
    expect(r.canvas.height).toBeGreaterThan(height * 0.65);
    expect(r.canvas.bottom).toBeLessThanOrEqual(height);
    expect(r.canvas.right).toBeLessThanOrEqual(width);
    expect(r.canvas).toEqual(r.viewport);
    expect(r.scrollWidth).toBe(width);
    expect(r.scrollHeight).toBe(height);
    expect(r.outliner.width).toBeGreaterThan(0);
    expect(r.properties.width).toBeGreaterThan(0);
    expect(r.outliner.x).toBe(0);
    expect(r.outliner.right).toBeLessThanOrEqual(r.canvas.x + 0.1);
    expect(r.properties.x).toBeGreaterThanOrEqual(r.canvas.right - 0.1);
    expect(r.properties.right).toBe(width);
  }
});

test("panels stay on their requested sides after resizing and only collapse by explicit user action", async ({
  page,
}) => {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  await page.evaluate(() => import("/src/editor-layout.js"));
  const initial = await page.locator("#scene").boundingBox();
  await page.locator("#toggle-outliner").click();
  await expect(page.locator(".outliner")).toBeHidden();
  await page.locator("#toggle-properties").click();
  await expect(page.locator(".sidebar")).toBeHidden();
  const expanded = await page.locator("#scene").boundingBox();
  expect(expanded.width).toBeGreaterThan(initial.width + 350);
  expect(expanded.height).toBe(initial.height);
  await page.locator("#toggle-outliner").click();
  await page.locator("#toggle-properties").click();
  await expect(page.locator(".outliner")).toBeVisible();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.setViewportSize({ width: 650, height: 600 });
  await expect(page.locator(".outliner")).toBeVisible();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.locator("#toggle-outliner").click();
  await expect(page.locator(".outliner")).toBeHidden();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.setViewportSize({ width: 900, height: 650 });
  await expect(page.locator(".outliner")).toBeHidden();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.locator("#toggle-outliner").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".outliner")).toBeVisible();
  await expect(page.locator(".sidebar")).toBeVisible();
});

test("real terrain stays visible at the embedded preview size and after panel toggles", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 650 });
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  await expect(page.locator("#loading")).toBeHidden();
  expect(await page.evaluate(() => frontier.diagnostics.frameHealth.ok)).toBe(
    true,
  );
  await expect(page.locator("#scene")).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: "artifacts/layout-fixed-900.png" });
  await page.locator("#toggle-outliner").click();
  await page.locator("#toggle-properties").click();
  await page.screenshot({ path: "artifacts/layout-expanded-900.png" });
  const bounds = await page.locator("#scene").boundingBox();
  expect(bounds.width).toBe(900);
  expect(bounds.height).toBeGreaterThan(450);
  await page.setViewportSize({ width: 650, height: 600 });
  await page.locator("#toggle-properties").click();
  await page.locator("#inspector-switch").click();
  await page.locator("[data-tab=sculpt]").click();
  await page.locator("[data-tool=ridge]").click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.locator("#toggle-outliner").click();
  await expect(page.locator(".outliner")).toBeVisible();
  await expect(page.locator("#scene")).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: "artifacts/layout-compact-650.png" });
});
