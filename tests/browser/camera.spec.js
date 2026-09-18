import { test, expect } from "@playwright/test";
const moved = (a, b) => Math.hypot(...a.map((v, k) => v - b[k]));
test("viewport flight, RMB eye-pivot, input focus, blur and reset are wired to the real camera", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  const before = await page.evaluate(() => frontier.camera);
  await page.locator("#scene").focus();
  const flightBounds = await page.locator("#scene").boundingBox();
  await page.mouse.move(
    flightBounds.x + flightBounds.width * 0.5,
    flightBounds.y + flightBounds.height * 0.5,
  );
  await page.mouse.down({ button: "right" });
  await page.keyboard.down("w");
  await page.waitForFunction(
    (t) => Math.hypot(...frontier.camera.eye.map((v, k) => v - t[k])) > 0.1,
    before.eye,
  );
  await page.keyboard.up("w");
  const forward = await page.evaluate(() => frontier.camera);
  expect(moved(before.eye, forward.eye)).toBeGreaterThan(0.1);
  await page.keyboard.down("e");
  await page.waitForFunction(
    (y) => frontier.camera.target[1] > y + 0.1,
    forward.target[1],
  );
  await page.keyboard.up("e");
  const raised = await page.evaluate(() => frontier.camera);
  await page.keyboard.down("q");
  await page.waitForFunction(
    (y) => frontier.camera.target[1] < y - 0.1,
    raised.target[1],
  );
  await page.keyboard.up("q");
  await page.mouse.up({ button: "right" });
  const r = await page.locator("#scene").boundingBox();
  await page.mouse.move(r.x + r.width * 0.5, r.y + r.height * 0.5);
  await page.mouse.down({ button: "right" });
  await page.waitForFunction(
    () => document.pointerLockElement === document.querySelector("#scene"),
  );
  // CDP absolute mouseMove generates compensating cursor-warp events while
  // pointer-locked in headless Chromium. Supply a relative pointer event after
  // acquiring a real lock; the separate denied-lock test uses native dragging.
  const { pivot, looked } = await page.evaluate(() => {
    const pivot = frontier.camera;
    document.querySelector("#scene").dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 1,
        pointerType: "mouse",
        buttons: 2,
        movementX: 50,
        movementY: 25,
      }),
    );
    return { pivot, looked: frontier.camera };
  });
  await page.mouse.up({ button: "right" });
  expect(looked.yaw).toBeCloseTo(pivot.yaw - 0.15, 8);
  expect(moved(looked.eye, pivot.eye)).toBeLessThan(0.00001);
  await page.locator("#inspector-switch").click();
  await page.locator('[data-tab="erosion"]').click();
  await page.locator("#rainfall").focus();
  const frozen = await page.evaluate(() => frontier.camera);
  await page.keyboard.down("w");
  await page.waitForTimeout(250);
  await page.keyboard.up("w");
  expect(await page.evaluate(() => frontier.camera.eye)).toEqual(frozen.eye);
  await page.locator("#scene").focus();
  await page.mouse.move(r.x + r.width * 0.5, r.y + r.height * 0.5);
  await page.mouse.down({ button: "right" });
  await page.keyboard.down("w");
  await page.waitForFunction(
    (t) => Math.hypot(...frontier.camera.eye.map((v, k) => v - t[k])) > 0.1,
    frozen.eye,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  const blurred = await page.evaluate(() => frontier.camera.eye);
  await page.waitForTimeout(250);
  await page.keyboard.up("w");
  expect(await page.evaluate(() => frontier.camera.eye)).toEqual(blurred);
  await page.mouse.up({ button: "right" });
  await page.locator("#viewport-options").click();
  await page.locator("#navigation-mode").click();
  await expect(page.locator("#navigation-mode")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Home");
  expect(await page.evaluate(() => frontier.camera.target)).toEqual(
    before.target,
  );
  expect(errors).toEqual([]);
});

test("weather UI exposes distinct size presets and preserves per-emitter tuning", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  await page.locator("#inspector-switch").click();
  await page.locator('[data-tab="erosion"]').click();
  await page.locator('[data-source="3"]').click();
  await expect(page.locator("#wind-controls")).toHaveAttribute("open", "");
  expect(await page.evaluate(() => frontier.settings.agentDiameter)).toBe(0.12);
  await page.locator("#agentDiameter").fill("0.32");
  await page.locator("#agentDiameter").dispatchEvent("input");
  await page.locator('[data-source="4"]').click();
  expect(await page.evaluate(() => frontier.settings.agentDiameter)).toBe(70);
  await page.locator('[data-source="3"]').click();
  expect(await page.evaluate(() => frontier.settings.agentDiameter)).toBe(0.32);
  await page.locator('[data-source="2"]').click();
  await expect(page.locator("#river-controls")).toHaveAttribute("open", "");
  expect(await page.evaluate(() => frontier.settings.sourceMode)).toBe(2);
  await page.locator("#sediment-toggle").click();
  expect(await page.evaluate(() => frontier.settings.showSediment)).toBe(false);
  await page.screenshot({ path: "artifacts/weather-studio.png" });
  await page.setViewportSize({ width: 650, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    650,
  );
});

test("denied pointer lock keeps RMB drag usable and Escape cancels fallback capture", async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.requestPointerLock = () =>
      Promise.reject(new DOMException("Blocked by iframe", "SecurityError"));
  });
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  const r = await page.locator("#scene").boundingBox(),
    x = r.x + r.width * 0.5,
    y = r.y + r.height * 0.5;
  await page.mouse.move(x, y);
  const before = await page.evaluate(() => frontier.camera);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(x + 40, y + 10, { steps: 3 });
  const looking = await page.evaluate(() => frontier.camera);
  expect(Math.abs(looking.yaw - before.yaw)).toBeGreaterThan(0.01);
  expect(moved(looking.eye, before.eye)).toBeLessThan(0.00001);
  await page.keyboard.press("Escape");
  await page.mouse.move(x + 80, y + 30, { steps: 3 });
  await page.mouse.up({ button: "right" });
  expect(await page.evaluate(() => frontier.camera.yaw)).toBe(looking.yaw);
});
