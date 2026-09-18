import { test, expect } from "@playwright/test";

test("default startup does not access WebGPU, even if it is broken", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.webgpuAccesses = 0;
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      get() {
        window.webgpuAccesses++;
        throw new Error("WebGPU must not be probed");
      },
    });
  });
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  expect(await page.evaluate(() => window.webgpuAccesses)).toBe(0);
  expect(await page.evaluate(() => frontier.backend)).toBe("WebGL2");
  expect(await page.evaluate(() => frontier.diagnostics.frameHealth.ok)).toBe(
    true,
  );
  await expect(page.locator("#renderer-info")).toHaveText("WebGL2 ✓");
  await expect(page.locator("#loading")).toBeHidden();
});

test("blank WebGL2 output shows persistent recovery, not an active white canvas", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const source = WebGL2RenderingContext.prototype.shaderSource;
    WebGL2RenderingContext.prototype.shaderSource = function (shader, code) {
      return source.call(
        this,
        shader,
        code.replace(
          "fragColor=vec4(color+dither,1);",
          "fragColor=vec4(clamp(color+dither+vec3(100),vec3(1),vec3(1)),1);",
        ),
      );
    };
  });
  await page.goto("/");
  await expect(page.locator("#loading>span")).toContainText(
    "blank or invalid",
    { timeout: 60000 },
  );
  await expect(page.locator("#renderer-label")).toHaveText(
    "Graphics unavailable",
  );
  await expect(
    page.locator("#render-recovery .compatibility-link"),
  ).toBeVisible();
  await page.locator("#error-details").click();
  await expect(page.locator("#renderer-diagnostics")).toContainText(
    "blank or invalid",
  );
});

test("lost WebGL2 context shows recovery and can restart", async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      const context = get.call(this, type, ...args);
      if (type === "webgl2") window.testGL = context;
      return context;
    };
  });
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  await page.evaluate(() => {
    const extension = window.testGL.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("Context-loss test extension unavailable");
    extension.loseContext();
  });
  await expect(page.locator("#loading")).toBeVisible();
  await expect(page.locator("#loading>span")).toContainText(
    "Graphics context lost",
  );
  await expect(page.locator("#renderer-label")).toHaveText(
    "Renderer interrupted",
  );
  expect(await page.evaluate(() => frontier.diagnostics.ready)).toBe(false);
  await page.locator("#render-recovery .compatibility-link").click();
  await page.waitForFunction(
    () => window.frontier?.backend === "WebGL2",
    null,
    { timeout: 60000 },
  );
  await expect(page.locator("#loading")).toBeHidden();
});
