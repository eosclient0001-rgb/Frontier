import { test, expect as assertion } from "@playwright/test";
const expect = assertion.configure({ timeout: 60000 });

test("Slate component shell has single entry points, keyboard-safe creation surfaces and editable value pills", async ({
  page,
}) => {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  await page.evaluate(() => import("/src/studio-ui.js"));
  await expect(
    page.locator(
      ".preset-bar, .outliner-bottom, #run-sidebar, #cycle-preset, .scene-caption",
    ),
  ).toHaveCount(0);
  await expect(page.locator("#run")).toHaveCount(1);
  await expect(page.locator(".tab-list")).toHaveCount(1);
  await expect(page.locator("#add-menu")).toBeHidden();
  await page.locator("#new-scene").click();
  await expect(page.locator("#new-scene-dialog")).toBeVisible();
  await page.locator("#cancel-new-scene").click();
  await expect(page.locator("#new-scene-dialog")).toBeHidden();
  await expect(page.locator("#new-scene")).toBeFocused();
  await page.locator("#new-scene").press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.locator("#new-scene-dialog")).toBeHidden();
  await page.locator("#new-scene").click();
  await page.locator("#new-plot").click();
  await expect(page.locator("#new-scene-dialog")).toBeHidden();
  await page.locator("#add-object").click();
  await expect(page.locator("#add-shape")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#add-menu")).toBeHidden();
  await page.locator("#add-object").click();
  await page.locator("#add-shape").click();
  await expect(page.locator("#add-menu")).toBeHidden();
  // Exercise the same range's conversion and step semantics without a renderer.
  await page.evaluate(() => {
    document.querySelector("#panel-water").classList.remove("hidden");
    document.querySelector("#panel-terrain").classList.add("hidden");
  });
  const old = await page.locator("#waveHeight").inputValue();
  await page.locator("#waveHeight-value").click();
  const field = page.locator("#waveHeight-value input");
  expect(Number(await field.inputValue())).toBeCloseTo(Number(old) * 100);
  await field.fill("18");
  await field.press("Enter");
  expect(Number(await page.locator("#waveHeight").inputValue())).toBeCloseTo(
    0.18,
  );
  await page.locator("#waveHeight-value").click();
  await field.fill("21");
  await field.press("Escape");
  expect(Number(await page.locator("#waveHeight").inputValue())).toBeCloseTo(
    0.18,
  );
});

test("new inspector navigation, exact numeric editing and modal guards work against the real editor", async ({
  page,
}) => {
  test.setTimeout(300000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  const original = await page.evaluate(() => ({
    camera: frontier.camera,
    settings: frontier.settings,
  }));
  await page.locator("#new-scene").click();
  // Focus the dialog itself: Space on a focused Close button should still
  // activate that native button, rather than act as the erosion shortcut.
  await page.locator("#new-scene-dialog").evaluate((el) => {
    el.tabIndex = -1;
    el.focus();
  });
  for (const key of ["s", "r", "g", "Space", "Home"])
    await page.keyboard.press(key);
  expect(await page.evaluate(() => frontier.camera)).toEqual(original.camera);
  await page.locator("#cancel-new-scene").click();
  expect(await page.evaluate(() => frontier.settings)).toEqual(
    original.settings,
  );
  await page.locator("#new-scene").click();
  await page.locator("#new-plot").click();
  await expect(page.locator("#add-object")).toBeEnabled();
  await page.locator("#add-object").click();
  await page.locator("#add-shape").click();
  await page.waitForFunction(() => !frontier.scene.pending);
  await expect(page.locator("#add-menu")).toBeHidden();
  await expect(page.locator("#scene-empty")).toBeHidden();
  await expect(page.locator("#object-transform")).toBeVisible();
  await expect(page.locator("#shape-profile")).toBeHidden();
  await page.locator("#shape-size-x-value").click();
  await page.locator("#shape-size-x-value input").fill("7.3");
  await page.locator("#shape-size-x-value input").press("Enter");
  await page.waitForFunction(() => !frontier.scene.pending);
  expect(
    await page.evaluate(() => frontier.scene.objects[0].size[0]),
  ).toBeCloseTo(7.3);
  await page.locator("#inspector-switch").click();
  await page.locator("[data-tab=erosion]").click();
  await expect(page.locator("[data-tab=erosion]")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.locator("#inspector-title")).toHaveText("Erosion");
  await expect(page.locator("#object-transform")).toBeHidden();
  await page.evaluate(() =>
    document.querySelector(".panels").scrollTo(0, 1000),
  );
  await page.locator("#inspector-switch").click();
  await page.locator("[data-tab=sculpt]").click();
  await expect(page.locator("#panel-sculpt")).toBeVisible();
  expect(await page.locator(".panels").evaluate((e) => e.scrollTop)).toBe(0);
  await page.locator("[data-tool=dent]").click();
  await expect(page.locator("[data-tool=dent]")).toHaveClass(/active/);
  await page.locator("#scene").focus();
  await page.keyboard.press("r");
  await expect(page.locator("#panel-shape")).toBeVisible();
  await expect(page.locator("[data-tab=terrain]")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.locator("#gizmo-rotate")).toHaveClass(/active/);
  await page.locator("#inspector-switch").click();
  await page.locator("[data-tab=terrain]").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-tab=sculpt]")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspector-menu")).toBeHidden();
  await expect(page.locator("#panel-sculpt")).toBeVisible();
  await page.locator("#inspector-switch").click();
  await expect(page.locator("[data-tab=sculpt]")).toBeFocused();
  const camera = await page.evaluate(() => frontier.camera);
  await page.keyboard.press("End");
  await expect(page.locator("[data-tab=fracture]")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.locator("[data-tab=terrain]")).toBeFocused();
  expect(await page.evaluate(() => frontier.camera)).toEqual(camera);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.screenshot({
    path: "artifacts/slate-inspector-final.png",
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
