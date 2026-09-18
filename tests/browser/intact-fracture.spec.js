import { test, expect as assertion } from "@playwright/test";
const expect = assertion.configure({ timeout: 60000 });
test("intact marking leaves GPU volume/materials exact and live objects live; only selected touching cell is removed, with exact undo", async ({
  page,
}) => {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  const report = await page.evaluate(async () => {
    const { GPUErosion } = await import("/src/gpu-erosion.js"),
      { defaults, generateVolume } = await import("/src/field.js"),
      { selectConnectedChunk } = await import("/src/fractures.js"),
      { selectIntactCell } = await import("/src/intact-fracture.js"),
      { makeShape } = await import("/src/shapes.js");
    const s = new GPUErosion(
      document.createElement("canvas").getContext("webgl2"),
    );
    s.upload(
      generateVolume({
        ...defaults,
        preset: 3,
        plotWidth: 14,
        plotLength: 14,
        plotHeight: 8,
      }),
    );
    await s.refreshSplineCuts([
      { ...makeShape("live"), position: [0, 8, 0], noiseAmount: 0 },
    ]);
    const before = await s.readVolume(),
      materials = s.read(s.material, 1792, 504),
      pattern = {
        intact: true,
        detail: true,
        gap: 0.014,
        separate: false,
        sites: [
          [-3, 3, 0],
          [3, 3, 0],
        ],
        brushes: [{ a: [0, -3, 0], b: [0, 11, 0], radius: 9 }],
      };
    const connected = selectConnectedChunk(before, [-3, 7.8, 0]).whole;
    await s.fractureCells(pattern);
    const marked = await s.readVolume(),
      markedMaterial = s.read(s.material, 1792, 504),
      live = s.splineBaseActive;
    // A descriptor with a stale detail flag must still be non-destructive.
    await s.fractureCells({ ...pattern, detail: false });
    const guarded = await s.readVolume();
    const selection = selectIntactCell(marked, [-3, 7.8, 0], pattern);
    s.setChunkSelection(selection.mask);
    await s.saveFractureUndo();
    await s.deleteChunk();
    const after = await s.readVolume(),
      afterMaterial = s.read(s.material, 1792, 504);
    let kept = 0,
      removed = 0;
    for (let i = 0; i < selection.mask.length; i++) {
      if (selection.mask[i] === 255 && after[i * 4] >= 0) removed++;
      if (!selection.mask[i] && after[i * 4 + 3] !== before[i * 4 + 3]) kept++;
    }
    // Material atlas is independently checked by repacking the mask through the public setter's layout.
    let materialErrors = 0;
    for (let z = 0; z < 112; z++)
      for (let y = 0; y < 72; y++)
        for (let x = 0; x < 112; x++) {
          const i = (z * 72 + y) * 112 + x,
            j = ((Math.floor(z / 16) * 72 + y) * 1792 + (z % 16) * 112 + x) * 4;
          if (!selection.mask[i])
            for (let c = 0; c < 4; c++)
              if (afterMaterial[j + c] !== materials[j + c]) materialErrors++;
        }
    await s.undoFracture();
    const restored = await s.readVolume(),
      restoredMaterial = s.read(s.material, 1792, 504);
    return {
      connected,
      live,
      unchanged:
        marked.every((v, i) => v === before[i]) &&
        markedMaterial.every((v, i) => v === materials[i]) &&
        guarded.every((v, i) => v === before[i]),
      whole: selection.whole,
      count: selection.count,
      removed,
      kept,
      materialErrors,
      undo:
        restored.every((v, i) => v === before[i]) &&
        restoredMaterial.every((v, i) => v === materials[i]),
      gl: s.gl.getError(),
    };
  });
  expect(report.connected).toBe(true);
  expect(report.live).toBe(true);
  expect(report.unchanged).toBe(true);
  expect(report.whole).toBe(false);
  expect(report.count).toBeGreaterThan(100);
  expect(report.removed).toBe(report.count);
  expect(report.kept).toBe(0);
  expect(report.materialErrors).toBe(0);
  expect(report.undo).toBe(true);
  expect(report.gl).toBe(0);
});
for (const staleWorker of [false, true])
  test(`default intact piece removal and undo${staleWorker ? " recovers a stale worker without losing edits" : " preserves all other rock"}`, async ({
    page,
  }) => {
    test.setTimeout(300000);
    const errors = [];
    let workerLoads = 0,
      injected = false;
    if (staleWorker)
      await page.context().route("**/src/worker.js*", async (route) => {
        const response = await route.fetch();
        let body = await response.text();
        workerLoads++;
        if (workerLoads === 1) {
          const handler = "self.onmessage = ({ data: m }) => {";
          if (!body.includes(handler))
            throw new Error(
              "Worker fault injection did not find the request handler",
            );
          body = body.replace(
            handler,
            handler +
              `
if(m.type==='selectIntactCell'){self.postMessage({id:m.id,volume:new Float32Array(4)});return;}`,
          );
          injected = true;
        }
        await route.fulfill({ response, body });
      });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
    await page.locator("#inspector-switch").click();
    await page.locator("[data-tab=fracture]").click();
    await expect(page.locator("#fracture-kind")).toHaveValue("intact");
    await expect(page.locator("#fracture-width")).toHaveValue("0.014");
    await expect(page.locator("#fracture-separate")).toBeHidden();
    await page.locator("#fracture-paint").click();
    const r = await page.locator("#scene").boundingBox();
    const x = r.x + r.width * 0.42,
      y = r.y + r.height * 0.46;
    await page.mouse.click(x, y);
    await page.waitForFunction(
      () => frontier.fractures.preview?.sites.length > 2,
    );
    await expect(page.locator("#fracture-apply")).toBeEnabled();
    await page.evaluate(async () => {
      window.intactBefore = await frontier.readVolume();
    });
    await page.locator("#fracture-apply").click();
    await page.waitForFunction(
      () => !!frontier.fractures.partition && !frontier.fractures.preview,
    );
    await expect(page.locator("#fracture-select")).toBeEnabled();
    expect(
      await page.evaluate(async () => {
        const v = await frontier.readVolume();
        return v.every((x, i) => x === intactBefore[i]);
      }),
    ).toBe(true);
    await page.screenshot({ path: "artifacts/intact-hairline-cracks.png" });
    await page.locator("#fracture-select").click();
    await page.mouse.click(x, y);
    await page.waitForFunction(() => !!frontier.fractures.selection);
    const part = await page.evaluate(() => frontier.fractures.selection);
    expect(part.kind).toBe("intact");
    expect(part.whole).toBe(false);
    expect(part.fraction).toBeLessThan(0.65);
    await page.locator("#fracture-delete").click();
    await page.waitForFunction(
      () => !frontier.fractures.selection && frontier.fractures.canUndo,
    );
    await expect(page.locator("#fracture-undo")).toBeEnabled();
    expect(
      await page.evaluate(async () => {
        const a = await frontier.readVolume();
        return a.some((x, i) => i % 4 === 3 && x < intactBefore[i]);
      }),
    ).toBe(true);
    await page.screenshot({
      path: "artifacts/intact-selected-piece-removed.png",
    });
    await page.locator("#fracture-undo").click();
    await expect(page.locator("#fracture-select")).toBeEnabled();
    expect(
      await page.evaluate(async () => {
        const a = await frontier.readVolume();
        return (
          a.every((v, i) => v === intactBefore[i]) &&
          !!frontier.fractures.partition
        );
      }),
    ).toBe(true);
    await page.locator("#fracture-select").click();
    await page.mouse.click(x, y);
    await page.waitForFunction(() => !!frontier.fractures.selection);
    expect(await page.evaluate(() => frontier.fractures.selection.cellId)).toBe(
      part.cellId,
    );
    expect(errors).toEqual([]);
    if (staleWorker) {
      expect(injected).toBe(true);
      expect(workerLoads).toBe(2);
    }
  });
