import { test, expect } from "@playwright/test";
test("startup recovers the old worker from the reported screenshot and loads the kilometre renderer", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.startedWorkers = [];
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        const first = window.startedWorkers.length === 0;
        window.startedWorkers.push(String(url));
        const stale = first
          ? URL.createObjectURL(
              new Blob(
                [
                  `self.onmessage=({data:m})=>self.postMessage({id:m.id,error:'Unsupported worker request: '+m.type,code:'UNKNOWN_REQUEST'});`,
                ],
                { type: "text/javascript" },
              ),
            )
          : null;
        super(stale || url, options);
        if (stale) URL.revokeObjectURL(stale);
      }
    };
  });
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 120000 });
  await expect(page.locator("#render-recovery")).toBeHidden();
  await expect(page.locator("#world-size")).toHaveText("1.00 × 1.00 km");
  const info = await page.evaluate(() => ({
    workers: startedWorkers,
    backend: frontier.backend,
    world: frontier.world,
    diagnostics: frontier.diagnostics,
  }));
  expect(info.workers).toHaveLength(2);
  expect(info.workers[0]).toContain("worker-entry-v4.js");
  expect(info.workers[1]).toContain("worker-recovery-v4.js");
  expect(info.backend).toBe("WebGL2");
  expect(info.world.dimensions).toEqual([128, 80, 128]);
  expect(info.diagnostics.error).toBeFalsy();
  expect(errors).toEqual([]);
});

test("normal preview startup loads the current worker without a recovery loop", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 120000 });
  await expect(page.locator("#render-recovery")).toBeHidden();
  await expect(page.locator("#world-size")).toHaveText("1.00 × 1.00 km");
  expect(await page.evaluate(() => frontier.diagnostics.gpuErosion)).toBe(true);
  expect(errors).toEqual([]);
});

test("a failed app module displays an actionable error instead of the static forming screen", async ({
  page,
}) => {
  await page.route("**/src/main.js*", (route) => route.abort("failed"));
  await page.goto("/");
  await expect(page.locator("#loading strong")).toHaveText(
    "Frontier could not start",
  );
  await expect(page.locator("#render-recovery")).toBeVisible();
  await expect(page.locator("#retry-renderer")).toBeEnabled();
});
test("a worker blocked by the browser is surfaced as a startup error", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.Worker = class {
      constructor() {
        throw new Error("Worker blocked by browser");
      }
    };
  });
  await page.goto("/");
  await expect(page.locator("#render-recovery")).toBeVisible();
  await expect(page.locator("#loading>span")).toContainText(
    "Worker blocked by browser",
  );
});
