import Assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
const Browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const Context = await Browser.newContext({
    viewport: { width: 1600, height: 1000 },
  }),
  Page = await Context.newPage();
Page.setDefaultTimeout(45000);
const Errors = [];
Page.on("pageerror", (E) => Errors.push(E.message));
const URL = process.env.SOLIDARC_URL || "http://127.0.0.1:5173/";
const Ready = () =>
  Page.waitForFunction(
    () =>
      window.solidArc?.Document &&
      !solidArc.Busy &&
      !solidArc.Motion &&
      !solidArc.ResolveDetail,
  );
const Run = async (C) => {
  await Ready();
  await Page.evaluate((C) => solidArc.Command(C), C);
  await Ready();
};
const Figures = () =>
  Page.evaluate(() => structuredClone(solidArc.Description.figures));
const Point = async (P) => {
  const Q = await Page.evaluate((P) => {
    const M = solidArc.Flow.Base.frame.view.ViewClip,
      R = document.querySelector("#cad-canvas").getBoundingClientRect();
    const V = [0, 1, 2, 3].map(
      (I) => M[I] * P[0] + M[4 + I] * P[1] + M[8 + I] * (P[2] || 0) + M[12 + I],
    );
    return [
      R.x + ((V[0] / V[3] + 1) * R.width) / 2,
      R.y + ((V[1] / V[3] + 1) * R.height) / 2,
    ];
  }, P);
  await Page.mouse.click(...Q);
};
const Near = (A, B) => Assert.ok(Math.abs(A - B) < 3e-5, `${A} != ${B}`);
let Count = 0;
const Pass = (T) => console.log(`PASS ${++Count}: ${T}`);
try {
  await Page.goto(URL);
  await Ready();
  Assert.equal((await Figures()).length, 0);
  Assert.equal(await Page.locator("#recovery-dialog").isVisible(), false);
  Pass(
    "Fresh browser starts with an empty native document, no example geometry",
  );
  await Run("view top");
  await Page.locator("#construct-button").click();
  await Page.locator('[data-section="Sketch Draw"]').click();
  await Page.locator('[data-construct="3"]').click();
  Assert.equal((await Figures()).length, 0);
  Assert.equal(await Page.locator("#draw-prompt").isVisible(), true);
  await Point([1, 1]);
  const Target = await Page.evaluate(() => {
    const M = solidArc.Flow.Base.frame.view.ViewClip,
      R = document.querySelector("#cad-canvas").getBoundingClientRect(),
      P = [3, 2, 0];
    const V = [0, 1, 2, 3].map(
      (I) => M[I] * P[0] + M[4 + I] * P[1] + M[8 + I] * P[2] + M[12 + I],
    );
    return [
      R.x + ((V[0] / V[3] + 1) * R.width) / 2,
      R.y + ((V[1] / V[3] + 1) * R.height) / 2,
    ];
  });
  const PreviewRequests = await Page.evaluate(
    () => solidArc.Worker.Stats.requests,
  );
  await Page.mouse.move(...Target);
  await Page.waitForFunction(
    () => document.querySelectorAll("#drawing-labels span").length === 2,
  );
  Assert.equal((await Figures()).length, 0);
  Assert.equal(
    await Page.evaluate(() => solidArc.Worker.Stats.requests),
    PreviewRequests,
  );
  Assert.ok(
    (await Page.locator("#drawing-labels").textContent()).includes("2000.0 mm"),
  );
  Assert.equal(await Page.evaluate(() => solidArcGraphics.rgbaUploads), 0);
  if (process.env.BROWSER_ARTIFACTS) {
    await mkdir(process.env.BROWSER_ARTIFACTS, { recursive: true });
    await Page.screenshot({
      path: `${process.env.BROWSER_ARTIFACTS}/SolidArcDrawingDimensions.png`,
    });
  }
  await Page.mouse.click(...Target);
  await Ready();
  let F = (await Figures())[0];
  Near(F.low[0], 1);
  Near(F.high[0], 3);
  Near(F.high[1], 2);
  Pass(
    "Construct arms a rectangle; two user clicks set location/size, with live GPU dimension guides before commit",
  );
  await Run("undo");
  Assert.equal((await Figures()).length, 0);
  await Run("redo");
  Assert.equal((await Figures()).length, 1);
  Pass("Completed drawing is one native undo/redo transaction");
  await Page.evaluate(() => solidArc.Flow.Start("circle"));
  await Point([-1, -1]);
  await Page.keyboard.press("Escape");
  Assert.equal((await Figures()).length, 1);
  Pass("Escape cancels partial drawing without inserting geometry");
  await Page.locator("#cad-canvas").focus();
  await Page.keyboard.press("r");
  Assert.equal(await Page.evaluate(() => solidArc.Flow.Drawing?.tool), "rect");
  await Page.keyboard.press("Escape");
  await Page.evaluate(() => solidArc.Flow.Start("circle"));
  await Page.locator("#draw-circle-mode").selectOption("circle2");
  await Point([-2, -2]);
  await Point([0, -2]);
  await Ready();
  const DiameterCircle = (await Figures()).at(-1);
  Near(DiameterCircle.low[0], -2);
  Near(DiameterCircle.high[0], 0);
  Near(DiameterCircle.low[1], -3);
  Near(DiameterCircle.high[1], -1);
  const Cases = [
    [
      "circle",
      [
        [-2, 0],
        [-1, 0],
      ],
    ],
    [
      "centerrect",
      [
        [0, -2],
        [0.5, -1],
      ],
    ],
    [
      "arc",
      [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    ],
    [
      "ellipse",
      [
        [0, 0],
        [1.5, 0],
        [0, 0.5],
      ],
    ],
    [
      "slot",
      [
        [-1, 0],
        [1, 0],
      ],
    ],
    [
      "polygon",
      [
        [0, 0],
        [1, 0],
        [1, 0],
      ],
    ],
    [
      "polyline",
      [
        [-1, -1],
        [0, -1],
        [0, 0],
      ],
    ],
    [
      "spline",
      [
        [-1, 0],
        [0, 1],
        [1, 0],
      ],
    ],
    [
      "cpcurve",
      [
        [-1, 0],
        [0, 1],
        [1, 0],
      ],
    ],
  ];
  for (const [Tool, Points] of Cases) {
    const Before = (await Figures()).length;
    await Page.evaluate((T) => solidArc.Flow.Start(T), Tool);
    for (const P of Points) await Point(P);
    if (["polyline", "spline", "cpcurve"].includes(Tool))
      await Page.keyboard.press("Enter");
    await Ready();
    await Page.waitForFunction(() => !solidArc.Flow.Drawing);
    Assert.equal((await Figures()).length, Before + 1, Tool);
  }
  Pass(
    "Circle, centred rectangle, arc, ellipse, slot, polygon and multi-point tools commit actual C++ curves",
  );
  await Run(["workplane xz --origin=(0,2,0)", "view iso"]);
  await Page.evaluate(() => solidArc.Flow.Start("circle"));
  await Point([0, 2, 0]);
  await Point([1, 2, 0]);
  await Ready();
  F = (await Figures()).at(-1);
  Near(F.low[1], 2);
  Near(F.high[1], 2);
  Pass(
    "Pointer unprojection and native completion honor the chosen offset XZ workplane",
  );
  const FramesBefore = await Page.evaluate(() => solidArc.Device.FrameNumber);
  await Page.evaluate(() => solidArc.Flow.SaveNow());
  await Ready();
  Assert.equal(
    await Page.evaluate(() => solidArc.Device.FrameNumber),
    FramesBefore,
  );
  const Saved = await Page.evaluate(() =>
    JSON.parse(localStorage.getItem("solidarc.native.doc.v1")),
  );
  Assert.ok(Saved.text.length > 100);
  const N = (await Figures()).length;
  await Page.reload();
  await Ready();
  await Page.waitForSelector("#recovery-dialog[open]");
  Assert.equal((await Figures()).length, 0);
  await Page.locator("#recovery-continue").click();
  await Ready();
  Assert.equal((await Figures()).length, N);
  Pass(
    "Browser restart offers Welcome back / Continue previous and reopens the native .arc",
  );
  await Page.reload();
  await Ready();
  await Page.waitForSelector("#recovery-dialog[open]");
  await Page.locator("#recovery-new").click();
  Assert.equal((await Figures()).length, 0);
  await Page.locator("#construct-button").click();
  await Page.locator("#recover-previous").click();
  await Ready();
  Assert.equal((await Figures()).length, N);
  Pass(
    "New document starts empty and the previous drawing remains recoverable",
  );
  Assert.deepEqual(Errors, []);
  Assert.equal(await Page.evaluate(() => solidArc.Device.Gl.getError()), 0);
  Pass("No JavaScript or GL errors");
  console.log(`${Count} workflow checks passed.`);
} finally {
  const Session = await Page.evaluate(
    () => window.solidArc?.NativeSession,
  ).catch(() => null);
  if (Session)
    await Page.request
      .delete(new globalThis.URL("/native", URL).href, {
        headers: { "X-SolidArc-Session": Session },
      })
      .catch(() => {});
  await Browser.close();
}
