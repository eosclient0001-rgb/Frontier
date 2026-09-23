import { test, expect } from "@playwright/test";

test("reference-inspired charcoal shell is atomic, rounded, and exposes one keyboard-accessible workspace nav", async ({
  page,
}) => {
  await page.setViewportSize({ width: 770, height: 540 });
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  for (let pass = 0; pass < 2; pass++) {
    await page.goto("/?preset=0");
    await expect(page.locator("head link[rel=stylesheet]")).toHaveCount(1);
    await expect(page.locator("head link[rel=stylesheet]")).toHaveAttribute(
      "href",
      /interface\.css\?v=charcoal/,
    );
    for (const selector of ["#scene-outliner", "#scene-properties"]) {
      expect(
        await page
          .locator(selector)
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      ).toBe("rgb(21, 22, 23)");
      expect(
        await page
          .locator(selector)
          .evaluate((el) => parseFloat(getComputedStyle(el).borderRadius)),
      ).toBeGreaterThanOrEqual(18);
    }
    await expect(page.locator("[role=tablist]")).toHaveCount(1);
    await expect(page.locator("[role=tab]")).toHaveCount(6);
    await expect(page.locator("#inspector-menu,#inspector-switch")).toHaveCount(
      0,
    );
    await expect(page.locator("#view-menu")).toBeHidden();
    for (const tab of await page.locator("[role=tab]").all())
      await expect(tab).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => {
      document.querySelector("#loading").classList.add("hidden");
      return import("/src/studio-ui.js");
    });
    await page.locator("[data-tab=terrain]").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("[data-tab=sculpt]")).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.locator("[data-tab=satmaps]")).toBeFocused();
    await page.locator("#viewport-options").click();
    await expect(page.locator("#view-menu")).toBeVisible();
    await page.locator("#reset-camera").click();
    await expect(page.locator("#view-menu")).toBeHidden();
  }
});

test("outliner search filters without changing objects and stays applied after a tree refresh", async ({
  page,
}) => {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/?preset=0");
  await page.evaluate(async () => {
    await import("/src/studio-ui.js");
    document.querySelector("#scene-tree").innerHTML =
      '<div class="outliner-row"><button role="treeitem"><span class="tree-name">Desert canyon</span></button></div><div class="outliner-group"><div class="outliner-group-label">SHAPES</div><div class="outliner-row"><button role="treeitem"><span class="tree-name">Boulder 1</span></button></div></div>';
  });
  await page.locator("#scene-search").fill("BOULDER");
  await expect(page.locator(".outliner-row:not(.hidden)")).toHaveCount(1);
  await expect(page.locator("#scene-tree .tree-name").last()).toBeVisible();
  await expect(page.locator("#scene-tree .outliner-row")).toHaveCount(2);
  await page.evaluate(
    () =>
      (document.querySelector("#scene-tree .tree-name").textContent =
        "Boulder canyon"),
  );
  await expect(page.locator(".outliner-row:not(.hidden)")).toHaveCount(2);
  await page.locator("#scene-search").fill("not found");
  await expect(page.locator("#scene-search-empty")).toBeVisible();
  await expect(page.locator(".outliner-group")).toBeHidden();
  await page.locator("#scene-search").press("Escape");
  await expect(page.locator(".outliner-row:not(.hidden)")).toHaveCount(2);
  await expect(page.locator("#scene-search-empty")).toBeHidden();
});

test("live WebGL2 terrain, workspace navigation and searchable selection work in the new shell", async ({
  page,
}) => {
  test.setTimeout(240000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?preset=0");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  expect(await page.evaluate(() => frontier.diagnostics.frameHealth.ok)).toBe(
    true,
  );
  await page.evaluate(async () => {
    window.uiBefore = await frontier.readVolume();
    window.cameraBefore = frontier.camera;
  });
  await page.locator("[data-tab=water]").click();
  await page.locator("#panel-water [data-canyon-route]").click();
  await page.locator("#scene-search").fill("river");
  await expect(page.locator(".outliner-row:not(.hidden)")).toHaveCount(1);
  await page.locator(".outliner-row:not(.hidden) [role=treeitem]").click();
  await expect(page.locator("#panel-path")).toBeVisible();
  await page.locator("[data-tab=water]").click();
  await expect(page.locator("#panel-water")).toBeVisible();
  await expect(page.locator("[data-tab=water]")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.locator("#scene-search").fill("desert");
  await page.locator(".outliner-row:not(.hidden) [role=treeitem]").click();
  await expect(page.locator("#panel-terrain")).toBeVisible();
  await page.locator("#scene-search").press("Escape");
  await expect(page.locator(".outliner-row:not(.hidden)")).toHaveCount(2);
  for (const tab of ["sculpt", "erosion", "water", "fracture", "terrain"]) {
    await page.locator(`[data-tab=${tab}]`).click();
    await expect(page.locator(`#panel-${tab}`)).toBeVisible();
    await expect(page.locator(`[data-tab=${tab}]`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      page.locator("#workspace-tabs [aria-selected=true]"),
    ).toHaveCount(1);
  }
  expect(
    await page.evaluate(async () => {
      const v = await frontier.readVolume();
      return v.every((x, i) => x === uiBefore[i]);
    }),
  ).toBe(true);
  expect(await page.evaluate(() => frontier.camera)).toEqual(
    await page.evaluate(() => cameraBefore),
  );
  await page.screenshot({ path: "artifacts/frontier-charcoal-desktop.png" });
  await page.setViewportSize({ width: 770, height: 540 });
  await expect(page.locator("#scene")).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: "artifacts/frontier-charcoal-compact.png" });
  expect(errors).toEqual([]);
});
