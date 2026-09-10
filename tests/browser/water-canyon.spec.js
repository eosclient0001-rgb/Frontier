import { test, expect } from "@playwright/test";

test("water animates without simulation, foam and optics change real pixels, and extreme views stay finite", async ({
  page,
}) => {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    const { defaults, generateVolume } = await import("/src/field.js"),
      { createRenderer } = await import("/src/renderer.js");
    document.body.innerHTML =
      '<canvas id="water-test" style="width:600px;height:400px"></canvas>';
    const canvas = document.querySelector("canvas"),
      p = { ...defaults },
      width = 480,
      height = 320;
    const uniform = (time, eye = [0.8, 3.7, 12.5], target = [-1, 0.4, -6]) =>
      new Float32Array([
        ...eye,
        time,
        ...target,
        width / height,
        width,
        height,
        0,
        0,
        p.sun,
        p.haze,
        p.waterLevel,
        p.waterEnabled ? 1 : 0,
        p.strata,
        p.roughness,
        p.clarity,
        p.ripple,
        0,
        0,
        0,
        -1,
        0,
        0,
        0,
        0,
      ]);
    const renderer = await createRenderer(
      canvas,
      null,
      generateVolume(p),
      () => {},
      uniform(0),
      p,
    );
    canvas.width = width;
    canvas.height = height;
    window.waterLab = {
      p,
      renderer,
      canvas,
      render(time, eye, target) {
        renderer.draw(uniform(time, eye, target));
        const pixels = new Uint8Array(width * height * 4);
        renderer.gl.readPixels(
          0,
          0,
          width,
          height,
          renderer.gl.RGBA,
          renderer.gl.UNSIGNED_BYTE,
          pixels,
        );
        return pixels;
      },
    };
  });
  const result = await page.evaluate(() => {
    const { p, renderer } = waterLab,
      diff = (a, b) => {
        let changed = 0,
          bright = 0;
        for (let i = 0; i < a.length; i += 4) {
          let distance = 0;
          for (let k = 0; k < 3; k++) distance += Math.abs(a[i + k] - b[i + k]);
          if (distance > 12) changed++;
          bright += a[i] + a[i + 1] + a[i + 2] - (b[i] + b[i + 1] + b[i + 2]);
        }
        return { changed, bright };
      };
    p.foamAmount = 0;
    const noFoam = waterLab.render(1);
    p.foamAmount = 1;
    p.foamReach = 1.2;
    const foam = waterLab.render(1),
      later = waterLab.render(3.7);
    p.waterEnabled = false;
    const dry = waterLab.render(1);
    p.waterEnabled = true;
    p.waterReflection = 0;
    const matte = waterLab.render(1);
    p.waveHeight = 0.35;
    p.waveLength = 1.5;
    const extreme = waterLab.render(120, [1, 0.3, 9], [0, 3, -5]);
    return {
      foam: diff(foam, noFoam),
      animation: diff(foam, later),
      water: diff(foam, dry),
      reflection: diff(foam, matte),
      ticks: renderer.solver.tick,
      error: renderer.gl.getError(),
      opaque: extreme.every((x, i) => i % 4 !== 3 || x === 255),
    };
  });
  expect(result.foam.changed).toBeGreaterThan(100);
  expect(result.foam.bright).toBeGreaterThan(1000);
  expect(result.animation.changed).toBeGreaterThan(200);
  expect(result.water.changed).toBeGreaterThan(500);
  expect(result.reflection.changed).toBeGreaterThan(50);
  expect(result.ticks).toBe(0);
  expect(result.error).toBe(0);
  expect(result.opaque).toBe(true);
  await page.evaluate(() => {
    Object.assign(waterLab.p, {
      ...waterLab.p,
      waveHeight: 0.16,
      waveLength: 2.8,
      waterReflection: 0.8,
      foamAmount: 0.75,
      foamReach: 0.85,
    });
    waterLab.render(2.5);
  });
  await page
    .locator("canvas")
    .screenshot({ path: "artifacts/water-closeup.png" });
});

test("canyon spacing regenerates actual geometry and new water controls stay live without erosion", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  await page.evaluate(async () => {
    const a = await frontier.readVolume();
    window.oldCanyonSolid = a.reduce((s, x, i) => s + (i % 4 === 3 ? x : 0), 0);
  });
  await page.locator("#canyonWidth").fill("12");
  await page.locator("#canyonWidth").dispatchEvent("input");
  await page.waitForFunction(
    async () => {
      const a = await frontier.readVolume();
      return (
        oldCanyonSolid - a.reduce((s, x, i) => s + (i % 4 === 3 ? x : 0), 0) >
        1000
      );
    },
    null,
    { timeout: 60000, polling: 1000 },
  );
  expect(await page.evaluate(() => frontier.settings.canyonWidth)).toBe(12);
  expect(await page.evaluate(() => frontier.iterations)).toBe(0);
  await page.locator("#inspector-switch").click();
  await page.locator('[data-tab="water"]').click();
  await page.locator("#foamAmount").fill("0.9");
  await page.locator("#foamAmount").dispatchEvent("input");
  await page.locator("#waveHeight").fill("0.2");
  await page.locator("#waveHeight").dispatchEvent("input");
  expect(await page.evaluate(() => frontier.settings.foamAmount)).toBe(0.9);
  expect(await page.evaluate(() => frontier.settings.waveHeight)).toBe(0.2);
  expect(await page.evaluate(() => frontier.iterations)).toBe(0);
  await page.locator("#waterLevel").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/water-studio.png" });
  await page.locator("#new-scene").click();
  await page.locator('[data-preset="2"]').click();
  await expect(page.locator("#canyon-controls")).toHaveClass(/hidden/);
  await page.setViewportSize({ width: 650, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    650,
  );
  expect(errors).toEqual([]);
});
