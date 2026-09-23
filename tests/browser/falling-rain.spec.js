import { test, expect } from "@playwright/test";
async function bare(page) {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
}
test("rain spawns in air, falls under gravity and delivers only one landing splash before settling", async ({
  page,
}) => {
  await bare(page);
  const result = await page.evaluate(async () => {
    const { GPUErosion } = await import("/src/gpu-erosion.js");
    const { defaults, generateVolume, sampleVolume } =
      await import("/src/field.js");
    const s = new GPUErosion(
      document.createElement("canvas").getContext("webgl2"),
    );
    const p = {
      ...defaults,
      preset: 3,
      particleCount: 256,
      rainfall: 1,
      wind: 0,
    };
    s.upload(generateVolume(p));
    await s.step(p);
    const { PARTICLE_SIZE, RAIN_START, RAIN_PARTICLES } = await import("/src/particle-pool.js");
    const births = s.read(s.positions[s.motionIndex], ...PARTICLE_SIZE),
      meta = s.read(s.metadata[s.motionIndex], ...PARTICLE_SIZE);
    let count = 0,
      minY = 100,
      maxY = -100,
      airborne = true;
    for (let i = RAIN_START; i < RAIN_START + RAIN_PARTICLES; i++)
      if (births[i * 4 + 3] >= 0) {
        count++;
        minY = Math.min(minY, births[i * 4 + 1]);
        maxY = Math.max(maxY, births[i * 4 + 1]);
        airborne &&= meta[i * 4 + 3] < 0;
      }
    const birthAudit = await s.audit();
    // Isolate a single real falling parcel for the full contact/retirement test.
    s.upload(generateVolume(p));
    const positions = new Float32Array(8192),
      velocities = new Float32Array(8192),
      metadata = new Float32Array(8192),
      life = new Float32Array(8192);
    for (let i = 3; i < positions.length; i += 4) positions[i] = -1;
    positions.set([0, 10, 0, 0]);
    velocities.set([0, -3.5, 0, 1]);
    metadata.set([0, 0.47, 3, -1.08]);
    life.set([200, 0, 0, 0]);
    for (const [name, data] of Object.entries({
      positions,
      velocities,
      metadata,
      lifecycles: life,
    }))
      s.uploadTexture(s[name][0], 64, 32, data);
    p.particleCount = 1;
    p.rainfall = 0;
    let splashes = 0,
      firstStep = -1,
      airErosion = 0,
      ys = [],
      firstSpeed = 0;
    for (let tick = 0; tick < 55; tick++) {
      await s.step(p);
      const hit = s.read(s.impacts, 64, 32),
        pos = s.read(s.positions[s.motionIndex], 64, 32);
      if (tick < 5) ys.push(pos[1]);
      if (hit[1] > 1.5) {
        splashes++;
        if (firstStep < 0) {
          firstStep = tick;
          firstSpeed = hit[0];
        }
      }
      if (tick === 4) airErosion = (await s.audit()).eroded;
    }
    const audit = await s.audit();
    return {
      count,
      minY,
      maxY,
      airborne,
      birthErosion: birthAudit.eroded,
      birthCarried: birthAudit.carried,
      ys,
      splashes,
      firstStep,
      firstSpeed,
      airErosion,
      audit,
    };
  });
  expect(result.count).toBeGreaterThan(0);
  expect(result.count).toBeLessThan(2048);
  expect(result.minY).toBeGreaterThan(10.5); // plot top 2.5 m + at least 8 m of actual flight
  expect(result.maxY).toBeLessThan(16);
  expect(result.airborne).toBe(true);
  expect(result.birthErosion).toBe(0);
  expect(result.birthCarried).toBe(0);
  expect(result.airErosion).toBe(0);
  for (let i = 1; i < result.ys.length; i++)
    expect(result.ys[i]).toBeLessThan(result.ys[i - 1]);
  expect(result.firstStep).toBeGreaterThan(5);
  expect(result.firstSpeed).toBeGreaterThan(3.5);
  expect(result.splashes).toBe(1);
  expect(result.audit.eroded).toBe(0); // A vertical impact on flat, motionless water must not dig a crater.
  expect(Math.abs(result.audit.ledgerError)).toBeLessThan(0.005);
  expect(Math.abs(result.audit.massError)).toBeLessThan(0.01);
});

test("falling rain renders visible streaks; visibility and pause do not advance the simulation", async ({
  page,
}) => {
  await bare(page);
  const result = await page.evaluate(async () => {
    const { createRenderer } = await import("/src/renderer.js"),
      { defaults, generateVolume } = await import("/src/field.js");
    document.body.innerHTML =
      '<canvas style="width:480px;height:360px"></canvas>';
    const canvas = document.querySelector("canvas"),
      p = {
        ...defaults,
        preset: 3,
        particleCount: 1024,
        rainfall: 1,
        waterEnabled: false,
      },
      width = 384,
      height = 288;
    const uniforms = new Float32Array([
      24,
      20,
      30,
      0,
      0,
      7,
      0,
      width / height,
      width,
      height,
      0,
      0,
      p.sun,
      0,
      0,
      0,
      p.strata,
      p.roughness,
      p.clarity,
      p.ripple,
      0,
      0,
      0,
      -1,
      0,
      3,
      0,
      0,
    ]);
    const r = await createRenderer(
      canvas,
      null,
      generateVolume(p),
      () => {},
      uniforms,
      p,
    );
    canvas.width = width;
    canvas.height = height;
    await r.step(p, 4);
    function capture() {
      r.draw(uniforms);
      const a = new Uint8Array(width * height * 4);
      r.gl.readPixels(0, 0, width, height, r.gl.RGBA, r.gl.UNSIGNED_BYTE, a);
      return a;
    }
    r.showParticles = false;
    const hidden = capture();
    r.showParticles = true;
    const visible = capture(),
      tick = r.solver.tick,
      paused = capture();
    let changed = 0;
    for (let i = 0; i < visible.length; i += 4)
      if (
        Math.abs(visible[i] - hidden[i]) +
          Math.abs(visible[i + 1] - hidden[i + 1]) +
          Math.abs(visible[i + 2] - hidden[i + 2]) >
        15
      )
        changed++;
    window.rainView = { r, p, uniforms, capture };
    return {
      changed,
      pausedExact: visible.every((v, i) => v === paused[i]),
      tick,
      after: r.solver.tick,
      error: r.gl.getError(),
    };
  });
  expect(result.changed).toBeGreaterThan(30);
  expect(result.pausedExact).toBe(true);
  expect(result.after).toBe(result.tick);
  expect(result.error).toBe(0);
  await page
    .locator("canvas")
    .screenshot({ path: "artifacts/falling-rain.png" });
});
