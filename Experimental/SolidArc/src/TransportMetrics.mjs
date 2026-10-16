import Assert from "node:assert/strict";
import { chromium } from "playwright";

const Browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  for (const Mode of ["no-worker", "legacy-pixels", "unavailable-backend"]) {
    const Page = await Browser.newPage();
    const Errors = [];
    Page.on("pageerror", (ErrorValue) => Errors.push(ErrorValue.message));
    await Page.addInitScript(() => {
      window.WorkerConstructions = 0;
      window.Worker = class {
        constructor() {
          ++window.WorkerConstructions;
          throw Error("Browser Workers are unavailable in this embedded preview");
        }
      };
    });
    if (Mode === "legacy-pixels") await Page.route(/\/native$/, (Route) => Route.fulfill({
      contentType: "application/json", body: JSON.stringify({description: {figures: []}, pixels: []}),
    }));
    if (Mode === "unavailable-backend") await Page.route(/\/native\/health$/, (Route) => Route.fulfill({
      status: 503, contentType: "application/json", body: JSON.stringify({error: "Test unavailable service"}),
    }));
    await Page.goto(process.env.SOLIDARC_URL || "http://127.0.0.1:5173/");
    if (Mode === "no-worker") {
      await Page.waitForFunction(() => window.solidArc?.Ready && !solidArc.Busy && solidArc.Description.figures.length === 0);
      Assert.equal(await Page.evaluate(() => solidArcGraphics.backend), "WebGL2");
      Assert.ok(await Page.evaluate(() => solidArc.Device.FrameNumber > 0));
    } else {
      const Message = Mode === "legacy-pixels" ? "An outdated CPU geometry worker" : "Native geometry service unavailable";
      await Page.waitForFunction((Message) => document.querySelector("#loading-overlay")?.textContent.includes(Message), Message);
      Assert.equal(await Page.evaluate(() => solidArc.Ready), false);
      Assert.equal(await Page.evaluate(() => solidArc.Device.FrameNumber), 0);
    }
    Assert.equal(await Page.evaluate(() => WorkerConstructions), 0);
    Assert.deepEqual(Errors, []);
    console.log(`PASS: ${Mode} — no browser Worker required, no unhandled exceptions`);
    await Page.goto("about:blank");
    await Page.close();
  }
} finally {
  await Browser.close();
}
