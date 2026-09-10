import { test, expect } from "@playwright/test";

test("OLED stylesheet is atomic, black, uncluttered and fully applied in the embedded preview", async ({
  page,
}) => {
  await page.setViewportSize({ width: 770, height: 540 });
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  for (let pass = 0; pass < 2; pass++) {
    await page.goto("/");
    await expect(page.locator("head link[rel=stylesheet]")).toHaveCount(1);
    await expect(page.locator("head link[rel=stylesheet]")).toHaveAttribute(
      "href",
      /interface\.css\?v=oled/,
    );
    for (const sel of [
      "#app",
      ".header",
      "#scene-outliner",
      "#scene-properties",
    ])
      expect(
        await page
          .locator(sel)
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      ).toBe("rgb(0, 0, 0)");
    await expect(
      page.locator(
        ".statusbar,.scene-empty,.outliner-footnote,.orientation,.scale-legend,.view-label",
      ),
    ).toHaveCount(0);
    expect(
      await page
        .locator("#app")
        .evaluate(
          (el) => getComputedStyle(el).gridTemplateRows.split(" ").length,
        ),
    ).toBe(2);
    await expect(page.locator("#viewport .simulation-bar")).toHaveCount(0);
    await expect(page.locator("#inspector-menu")).toBeHidden();
    await expect(page.locator("#view-menu")).toBeHidden();
    expect(
      await page
        .locator("#scene")
        .evaluate((el) => el.getBoundingClientRect().bottom),
    ).toBe(540);
    await page.evaluate(() => {
      document.querySelector("#loading").classList.add("hidden");
      return import("/src/studio-ui.js");
    });
    await page.locator("#inspector-switch").click();
    await expect(page.locator("#inspector-menu")).toBeVisible();
    await page.locator("[data-tab=erosion]").click();
    await expect(page.locator("#inspector-menu")).toBeHidden();
    await page.locator("#viewport-options").click();
    await expect(page.locator("#view-menu")).toBeVisible();
    await page.locator("#reset-camera").click();
    await expect(page.locator("#view-menu")).toBeHidden();
  }
});
