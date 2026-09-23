import { test, expect } from "@playwright/test";
test("GPU checkpoint restores all terrain, sediment, flow and captured particle state; erosion still conserves exchange", async ({
  page,
}) => {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { GPUErosion } = await import("/src/gpu-erosion.js"),
      { defaults, generateVolume } = await import("/src/field.js");
    const s = new GPUErosion(
      document.createElement("canvas").getContext("webgl2"),
    );
    const p = {
      ...defaults,
      preset: 3,
      plotRotation: [0, 0, 12],
      particleCount: 256,
      rainfall: 1,
    };
    s.upload(generateVolume(p));
    await s.step(p, 2);
    const before = await s.checkpoint();
    s.upload(generateVolume({ ...p, plotHeight: 5 }));
    s.restoreCheckpoint(before);
    const after = await s.checkpoint();
    const equal = Object.keys(before.fields).every((k) =>
      before.fields[k].every((v, i) => v === after.fields[k][i]),
    );
    await s.step(p, 46);
    return { equal, tick: after.tick, audit: await s.audit() };
  });
  expect(result.equal).toBe(true);
  expect(result.tick).toBe(2);
  expect(result.audit.eroded).toBeGreaterThan(0);
  expect(Math.abs(result.audit.massError)).toBeLessThan(0.01);
  expect(Math.abs(result.audit.ledgerError)).toBeLessThan(0.005);
});
