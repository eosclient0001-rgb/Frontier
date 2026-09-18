import { test, expect } from "@playwright/test";

test("GPU particles exchange actual material with a balanced ledger and no per-step CPU transfer", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.workerTasks = [];
    window.readbacks = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...args) {
      window.workerTasks.push(message?.type);
      return post.call(this, message, ...args);
    };
    const read = WebGL2RenderingContext.prototype.readPixels;
    WebGL2RenderingContext.prototype.readPixels = function (...args) {
      window.readbacks++;
      return read.apply(this, args);
    };
  });
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  expect(await page.evaluate(() => frontier.diagnostics.gpuErosion)).toBe(true);
  await page.evaluate(() => {
    window.workerTasks = [];
    window.readbacks = 0;
  });
  await page.locator("#inspector-switch").click();
  await page.locator("[data-tab=erosion]").click();
  await page.locator("#step").click();
  await page.waitForFunction(() => frontier.iterations === 1);
  expect(await page.evaluate(() => window.workerTasks)).toEqual([]);
  expect(await page.evaluate(() => window.readbacks)).toBe(0);
  let audit = await page.evaluate(() => frontier.auditErosion());
  expect(audit.active).toBeGreaterThan(100);
  expect(audit.eroded).toBeGreaterThan(0);
  expect(audit.carried).toBeGreaterThan(0);
  expect(Math.abs(audit.ledgerError)).toBeLessThan(0.005);
  expect(Math.abs(audit.massError)).toBeLessThan(0.01);
  await page.locator("#inspector-switch").click();
  await page.locator('[data-tab="erosion"]').click();
  await expect(page.locator("#particle-toggle")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.locator("#particle-toggle").click();
  expect(await page.evaluate(() => frontier.settings.showParticles)).toBe(
    false,
  );
  await page.locator("#run").click();
  await page.waitForFunction(() => frontier.iterations >= 8, null, {
    timeout: 120000,
  });
  await page.locator("#run").click();
  audit = await page.evaluate(() => frontier.auditErosion());
  expect(audit.deposited).toBeGreaterThan(0);
  expect(Math.abs(audit.ledgerError)).toBeLessThan(0.005);
  expect(Math.abs(audit.massError)).toBeLessThan(0.01);
  const validity = await page.evaluate(async () => {
    const a = await frontier.readVolume();
    let finite = true,
      inRange = true;
    for (let i = 0; i < a.length; i += 4) {
      if (!Number.isFinite(a[i])) finite = false;
      if (a[i + 3] < 0 || a[i + 3] > 1) inRange = false;
    }
    return { finite, inRange };
  });
  expect(validity).toEqual({ finite: true, inRange: true });
  expect(await page.evaluate(() => window.workerTasks)).toEqual([]);
});

test("zero rain from reset emits no agents and preserves solid occupancy", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  await page.locator("#inspector-switch").click();
  await page.locator('[data-tab="erosion"]').click();
  await page.locator("#rainfall").fill("0");
  await page.locator("#rainfall").dispatchEvent("input");
  await page.locator("#inspector-switch").click();
  await page.locator("[data-tab=erosion]").click();
  await page.locator("#step").click();
  await page.waitForFunction(() => frontier.iterations === 1);
  const a = await page.evaluate(() => frontier.auditErosion());
  expect(a.active).toBe(0);
  expect(a.eroded).toBe(0);
  expect(a.deposited).toBe(0);
  expect(a.carried).toBe(0);
  expect(Math.abs(a.massError)).toBeLessThan(0.001);
});

test("missing float render targets disables GPU erosion instead of substituting CPU simulation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const get = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function (name) {
      return name === "EXT_color_buffer_float" ? null : get.call(this, name);
    };
  });
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  expect(await page.evaluate(() => frontier.backend)).toBe("WebGL2");
  expect(await page.evaluate(() => frontier.diagnostics.gpuErosion)).toBe(
    false,
  );
  await expect(page.locator("#run")).toBeDisabled();
  await expect(page.locator("#step")).toBeDisabled();
  expect(
    await page.evaluate(() => frontier.diagnostics.erosionError),
  ).toContain("EXT_color_buffer_float");
});
