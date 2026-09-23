import { test, expect } from "@playwright/test";
async function lab(page) {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    const D = await import("/src/domain.js"),
      { GPUErosion, program } = await import("/src/gpu-erosion.js"),
      S = await import("/src/erosion-shaders.js"),
      { defaults } = await import("/src/field.js");
    D.configureDomain({ worldEnabled: true });
    const gl = document.createElement("canvas").getContext("webgl2"),
      s = new GPUErosion(gl),
      a = new Float32Array(128 * 80 * 128 * 4);
    const surface = (x, z) => 100 + 0.05 * x + 0.02 * z;
    for (let z = 0; z < 128; z++)
      for (let y = 0; y < 80; y++)
        for (let x = 0; x < 128; x++) {
          const p = [x, y, z].map((v, k) => D.MIN[k] + (v + 0.5) * D.CELL[k]),
            i = ((z * 80 + y) * 128 + x) * 4;
          a[i] = (p[1] - surface(p[0], p[2])) / Math.hypot(1, 0.05, 0.02);
        }
    const p = {
      ...defaults,
      worldEnabled: true,
      preset: 4,
      terrainWidth: 1000,
      terrainLength: 1000,
      terrainHeight: 240,
      particleCount: 1,
      rainfall: 0,
      wind: 0,
      riverEnabled: false,
      waterLevel: -20,
      hardness: 0.3,
    };
    window.lab = {
      D,
      S,
      gl,
      s,
      program,
      p,
      a,
      surface,
      seed({ count = 1, air = 0, remaining = 200 } = {}) {
        s.upload(a);
        const pos = new Float32Array(8192),
          vel = new Float32Array(8192),
          meta = new Float32Array(8192),
          life = new Float32Array(8192);
        for (let i = 3; i < 8192; i += 4) pos[i] = -1;
        for (let i = 0; i < count; i++) {
          const x = 250 + (i % 16) * 4,
            z = 150 + Math.floor(i / 16) * 3,
            k = i * 4;
          pos.set([x, surface(x, z) + 0.08 + air, z, 0], k);
          vel.set([air ? 0 : 6, air ? -3.5 : 0.3, air ? 0 : 1, 1], k);
          meta.set([0, 5, 3, air ? -1.08 : 0.08], k);
          life.set([remaining, 0, 0, 0], k);
        }
        s.uploadTexture(s.positions[0], 64, 32, pos);
        s.uploadTexture(s.velocities[0], 64, 32, vel);
        s.uploadTexture(s.metadata[0], 64, 32, meta);
        s.uploadTexture(s.lifecycles[0], 64, 32, life);
        p.particleCount = count;
      },
      particle() {
        return Array.from(
          s.read(s.positions[s.motionIndex], 64, 32).slice(0, 4),
        );
      },
      clock() {
        return Array.from(
          s.read(s.lifecycles[s.motionIndex], 64, 32).slice(0, 4),
        );
      },
    };
  });
}

test("accelerated airborne motion matches small reference steps, lands once, and speed changes preserve captured life", async ({
  page,
}) => {
  await lab(page);
  const r = await page.evaluate(async () => {
    const { s, p } = lab;
    lab.seed({ air: 10 });
    await s.step({ ...p, timeLapse: 1 }, 8);
    const reference = lab.particle();
    lab.seed({ air: 10 });
    await s.step({ ...p, timeLapse: 8 });
    const fast = lab.particle(),
      airAudit = await s.audit();
    let splashes = 0;
    for (let i = 0; i < 20; i++) {
      await s.step({ ...p, timeLapse: 8, weatheringRate: 16 });
      if (s.read(s.impacts, 64, 32)[1] > 1.5) splashes++;
    }
    const landed = await s.audit(),
      dead = lab.particle();
    lab.seed({ air: 80, remaining: 53 });
    for (let i = 0; i < 6; i++)
      await s.step({
        ...p,
        timeLapse: 8,
        rainLifetime: 15,
        rainEvaporation: 0.05,
      });
    const before = lab.clock();
    await s.step({
      ...p,
      timeLapse: 4,
      rainLifetime: 15,
      rainEvaporation: 0.05,
    });
    await s.step({
      ...p,
      timeLapse: 8,
      rainLifetime: 15,
      rainEvaporation: 0.05,
    });
    const end = lab.clock(),
      age = lab.particle()[3];
    await s.step({ ...p, timeLapse: 8 }, 6);
    const retired = lab.particle();
    return {
      reference,
      fast,
      airAudit,
      splashes,
      landed,
      dead,
      before,
      end,
      age,
      retired,
    };
  });
  for (let k = 0; k < 4; k++) expect(r.fast[k]).toBeCloseTo(r.reference[k], 3);
  expect(r.airAudit.eroded).toBe(0);
  expect(r.splashes).toBe(1);
  expect(r.landed.eroded).toBeGreaterThan(0);
  expect(Math.abs(r.landed.ledgerError)).toBeLessThan(0.005);
  expect(r.dead[3]).toBeGreaterThan(6); // Landed runoff no longer expires under the falling-drop clock.
  expect(r.before[2]).toBe(0);
  expect(r.end[2]).toBe(1);
  expect(r.end[0]).toBe(0);
  expect(r.age).toBeCloseTo(2.12, 4);
  expect(r.retired[3]).toBe(-1);
});

test("Fast increases real bounded terrain change without more particles, transfers, textures or atlas passes", async ({
  page,
}) => {
  await lab(page);
  const r = await page.evaluate(async () => {
    const { s, gl, p, D } = lab;
    lab.seed();
    const initial = await s.readVolume();
    await s.step({ ...p, timeLapse: 1, weatheringRate: 1 });
    const reference = await s.audit();
    lab.seed();
    let reads = 0,
      allocations = 0,
      draws = 0, atlasDraws = 0;
    const read = gl.readPixels.bind(gl),
      alloc = gl.texStorage2D.bind(gl),
      draw = gl.drawArrays.bind(gl);
    gl.readPixels = (...a) => {
      reads++;
      return read(...a);
    };
    gl.texStorage2D = (...a) => {
      allocations++;
      return alloc(...a);
    };
    gl.drawArrays = (...a) => {
      draws++;
      const viewport = gl.getParameter(gl.VIEWPORT);
      if (viewport[2] === D.ATLAS_SIZE[0] && viewport[3] === D.ATLAS_SIZE[1]) atlasDraws++;
      return draw(...a);
    };
    await s.step({ ...p, timeLapse: 4, weatheringRate: 16 });
    gl.readPixels = read;
    gl.texStorage2D = alloc;
    gl.drawArrays = draw;
    const fast = await s.audit(),
      after = await s.readVolume();
    let maxChange = 0;
    for (let i = 3; i < after.length; i += 4)
      maxChange = Math.max(
        maxChange,
        Math.abs(after[i] - initial[i]) * 2 * D.BAND,
      );
    return { reference, fast, maxChange, reads, allocations, draws, atlasDraws };
  });
  console.log("Fast preview measured exchange", {
    reference: r.reference.eroded,
    fast: r.fast.eroded,
    maxSurfaceChange: r.maxChange,
  });
  expect(r.fast.eroded).toBeGreaterThan(r.reference.eroded * 4);
  expect(r.maxChange).toBeGreaterThan(0.001);
  expect(r.maxChange).toBeLessThanOrEqual(0.0128 + 0.000003);
  expect(r.fast.active).toBe(r.reference.active);
  expect(r.reads).toBe(0);
  expect(r.allocations).toBe(0);
  expect(r.atlasDraws).toBe(2); // Surface exchange and rain-film pass, unchanged.
  expect(r.draws).toBe(17); // Six additional bounded, particle/bucket-sized transfer passes.
  expect(Math.abs(r.fast.ledgerError)).toBeLessThan(0.005);
  expect(Math.abs(r.fast.massError) / r.fast.initialSolid).toBeLessThan(1e-7);
});

test("tight support matches the previous full-cube GPU exchange and reduces gather iterations", async ({
  page,
}) => {
  await lab(page);
  const r = await page.evaluate(async () => {
    const { s, p, S, gl, program } = lab;
    const full = (source) =>
      source.replace(
        /void kernelBounds[\s\S]*?\n\}/,
        `void kernelBounds(vec3 c,float radius,out ivec3 lo,out ivec3 hi){ivec3 center=ivec3(floor((c-LO)/CELL));lo=max(center-4,ivec3(0));hi=min(center+4,DIM-1);}`,
      );
    const oldEvent = program(
        gl,
        S.fullscreenVertex,
        full(S.eventFragment),
        "reference full-cube event",
      ),
      oldCargo = program(
        gl,
        S.fullscreenVertex,
        full(S.cargoFragment),
        "reference full-cube feedback",
      ),
      newEvent = s.programs.event,
      newCargo = s.programs.cargo;
    lab.seed({ count: 256 });
    await s.step(p, 4);
    lab.seed({ count: 256 });
    await s.step(p, 8);
    const fast = await s.readVolume(),
      fa = await s.audit(),
      fastMs = s.lastPassMs;
    s.programs.event = oldEvent;
    s.programs.cargo = oldCargo;
    lab.seed({ count: 256 });
    await s.step(p, 4);
    lab.seed({ count: 256 });
    await s.step(p, 8);
    const slow = await s.readVolume(),
      sa = await s.audit(),
      oldMs = s.lastPassMs;
    let error = 0;
    for (let i = 0; i < fast.length; i++)
      error = Math.max(error, Math.abs(fast[i] - slow[i]));
    gl.deleteProgram(oldEvent.handle);
    gl.deleteProgram(oldCargo.handle);
    s.programs.event = newEvent;
    s.programs.cargo = newCargo;
    return { error, fa, sa, fastMs, oldMs };
  });
  console.log("Kernel comparison (software GPU wall ms/pass, not native FPS)", {
    optimized: r.fastMs,
    fullCube: r.oldMs,
  });
  expect(r.error).toBeLessThan(0.0001);
  expect(r.fa.eroded).toBeCloseTo(r.sa.eroded, 4);
  expect(Math.abs(r.fa.ledgerError)).toBeLessThan(0.005);
});

test("performance presets are visible, change speed without resetting terrain, and keep the particle pool fixed", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/");
  await page.waitForFunction(() => window.frontier);
  await page.locator("[data-tab=erosion]").click();
  await expect(page.locator("[data-erosion-preset=fast]")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const before = await page.evaluate(() => frontier.settings);
  await page.locator("[data-erosion-preset=rapid]").click();
  await expect(page.locator("#timeLapse-value")).toHaveText("8×");
  await expect(page.locator("#weatheringRate-value")).toHaveText("1×");
  expect(await page.evaluate(() => frontier.settings.particleCount)).toBe(
    before.particleCount,
  );
  await page.locator("#step").click();
  await page.waitForFunction(() => frontier.iterations === 1);
  await expect(page.locator("#erosion-performance-status")).toContainText(
    "0.3 simulated s",
  );
  await page.locator("[data-erosion-preset=reference]").click();
  await expect(page.locator("[data-erosion-preset=reference]")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("[data-erosion-preset=rapid]")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(await page.evaluate(() => frontier.iterations)).toBe(1);
  expect(await page.evaluate(() => frontier.settings.weatheringRate)).toBe(1);
  await page.screenshot({ path: "artifacts/erosion-performance-controls.png" });
});
