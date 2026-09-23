import { test, expect } from "@playwright/test";
async function lab(page, small = false) {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  await page.evaluate(async (small) => {
    const D = await import("/src/domain.js"),
      S = await import("/src/erosion-shaders.js"),
      { GPUErosion } = await import("/src/gpu-erosion.js"),
      { defaults } = await import("/src/field.js"),
      { erosionTiming } = await import("/src/erosion-performance.js"),
      { lifecycleUniforms, runoffUniforms } = await import(
        "/src/particle-lifecycle.js"
      ),
      { hydraulicUniforms } = await import("/src/hydraulic-transport.js");
    const p = {
      ...defaults,
      worldEnabled: true,
      preset: 4,
      terrainWidth: small ? 128 : 1000,
      terrainLength: small ? 128 : 1000,
      terrainHeight: 240,
      particleCount: 1,
      timeLapse: 8,
      weatheringRate: 16,
      rainfall: 0,
      wind: 0,
      riverEnabled: false,
      waterLevel: -30,
    };
    D.configureDomain(p);
    const gl = document.createElement("canvas").getContext("webgl2"),
      s = new GPUErosion(gl);
    window.lab = {
      D,
      S,
      s,
      gl,
      p,
      build(slope = 0.25, pit = 0, footHeight = 25) {
        const a = new Float32Array(D.SIZE.reduce((a, b) => a * b, 4));
        this.surface = (x) =>
          Math.max(footHeight, 100 + slope * x) -
          pit * Math.exp(-((x / 2) ** 2));
        for (let z = 0; z < 128; z++)
          for (let y = 0; y < 80; y++)
            for (let x = 0; x < 128; x++) {
              const wx = D.MIN[0] + (x + 0.5) * D.CELL[0],
                wy = D.MIN[1] + (y + 0.5) * D.CELL[1],
                i = ((z * 80 + y) * 128 + x) * 4;
              a[i] = (wy - this.surface(wx)) / Math.hypot(1, slope);
            }
        s.upload(a);
        return a;
      },
      seed({
        x = 300,
        air = 1,
        load = 0,
        remaining = 200,
        velocity = [0, -3.5, 0],
        kind = 0,
      } = {}) {
        const pos = new Float32Array(8192),
          vel = pos.slice(),
          meta = pos.slice(),
          life = pos.slice(),
          cargo = pos.slice(),
          species = pos.slice();
        for (let i = 3; i < pos.length; i += 4) pos[i] = -1;
        const y = this.surface(x) + 0.08 + air;
        pos.set([x, y, 0, 0]);
        vel.set([...velocity, 1]);
        meta.set([kind, Math.max(...D.CELL), 3, air > 0 ? -1.08 : 0.08]);
        life.set([remaining, 0, 0, y]);
        cargo.set([load, load, 0, 0]);
        species.set([load * 0.65, load * 0.3, load * 0.05, 0]);
        for (const [key, data] of Object.entries({
          positions: pos,
          velocities: vel,
          metadata: meta,
          lifecycles: life,
          cargos: cargo,
          species,
        }))
          s.uploadTexture(s[key][0], 64, 32, data);
        s.initialMass += load;
        if (kind < 0.5) {
          s.uploadTexture(
            s.rainLedgers[0],
            1,
            1,
            new Float32Array([1, 0, 0, 0]),
          );
          s.requestedRainVolume = 1;
        }
      },
      read() {
        return {
          pos: Array.from(
            s.read(s.positions[s.motionIndex], ...S.PARTICLE_SIZE).slice(0, 4),
          ),
          clock: Array.from(
            s.read(s.lifecycles[s.motionIndex], ...S.PARTICLE_SIZE).slice(0, 4),
          ),
          vel: Array.from(
            s.read(s.velocities[s.motionIndex], ...S.PARTICLE_SIZE).slice(0, 4),
          ),
        };
      },
      async move(n) {
        const values = {
          ...{},
          physics: [erosionTiming(p).dt, 0, 0.08, 0],
          config: [Math.max(...D.CELL), 0.15, 1, 0],
          lifeSettings: lifecycleUniforms(p),
          runoffSettings: runoffUniforms(p),
          hydraulic: hydraulicUniforms(p),
          environment: [-30, 0, 4821, 0],
          weather: [3, 0.45, 0.6, 0],
          river: [0, 0, 0, 0],
          windField: [0, 0, 0, 0],
          emitter: [0, 0, 490, 490],
        };
        for (let i = 0; i < n; i++) {
          const a = s.motionIndex,
            b = 1 - a;
          s.pass(
            "motion",
            [s.positions[b], s.velocities[b], s.metadata[b], s.impacts],
            ...S.PARTICLE_SIZE,
            {
              terrain: s.volume,
              flowPaths: s.flowPaths.texture,
              positions: s.positions[a],
              velocities: s.velocities[a],
              metadata: s.metadata[a],
              species: s.species[s.cargoIndex],
              lifecycle: s.lifecycles[a],
            },
            values,
          );
          s.pass(
            "lifecycle",
            [s.lifecycles[b]],
            ...S.PARTICLE_SIZE,
            {
              terrain: s.volume,
              positions: s.positions[b],
              velocities: s.velocities[b],
              previousPositions: s.positions[a],
              metadata: s.metadata[b],
              impacts: s.impacts,
              lifecycle: s.lifecycles[a],
            },
            values,
          );
          s.motionIndex = b;
          if (i % 64 === 63) await s.complete();
        }
        await s.complete();
        return this.read();
      },
    };
  }, small);
}

test("landed rain retains water and transports downslope to the foot, instead of dying near its first cut", async ({
  page,
}) => {
  await lab(page);
  const r = await page.evaluate(async () => {
    lab.build();
    lab.seed();
    const landed = await lab.move(8);
    lab.p.runoffLifetime = 1800; // existing captured budget must not extend
    const foot = await lab.move(700);
    return { landed, foot };
  });
  console.log("Downslope travel", r);
  expect(r.landed.clock[0]).toBeGreaterThan(14000);
  expect(r.landed.clock[0]).toBeLessThanOrEqual(15000);
  expect(r.foot.pos[0]).toBeLessThan(-300);
  expect(r.foot.pos[1]).toBeLessThan(30);
  expect(r.foot.pos[3]).toBeGreaterThan(150);
  expect(r.foot.vel[3]).toBeGreaterThan(0.6);
  expect(r.foot.clock[2]).toBe(0);
  expect(r.foot.clock[0]).toBeLessThan(10000);
});

test("bounded shallow-head routing crosses a small erosion pocket but does not pump water out of a deep basin", async ({
  page,
}) => {
  await lab(page, true);
  const r = await page.evaluate(async () => {
    lab.build(0.04, 0.3);
    lab.seed({ x: 0, air: 0, remaining: 15000, velocity: [0, 0, 0] });
    const shallow = await lab.move(400);
    lab.build(0.04, 3);
    lab.seed({ x: 0, air: 0, remaining: 15000, velocity: [0, 0, 0] });
    const deep = await lab.move(400);
    return { shallow, deep };
  });
  console.log("Pocket routing", r);
  expect(r.shallow.pos[0]).toBeLessThan(-8);
  expect(r.shallow.clock[2]).toBe(0);
  expect(r.deep.pos[0]).toBeGreaterThan(-4);
  expect(r.deep.clock[2]).not.toBe(0);
});

test("moving runoff reaching its numerical limit accounts sediment as outflow instead of a local deposit", async ({
  page,
}) => {
  await lab(page);
  const r = await page.evaluate(async () => {
    lab.build();
    lab.seed({
      air: 0,
      remaining: 1,
      load: 0.2,
      velocity: [-3, -0.75, 0],
      kind: 1,
    });
    const before = await lab.s.readVolume();
    await lab.s.step(lab.p, 3);
    const after = await lab.s.readVolume();
    return {
      audit: await lab.s.audit(),
      same: after.every((v, i) => i % 4 !== 3 || v === before[i]),
      state: lab.read(),
    };
  });
  expect(r.same).toBe(true);
  expect(r.audit.deposited).toBe(0);
  expect(r.audit.retired).toBeCloseTo(0.2, 5);
  expect(r.audit.carried).toBe(0);
  expect(Math.abs(r.audit.ledgerError)).toBeLessThan(0.0001);
  expect(r.state.pos[3]).toBe(-1);
});

test("16384 real GPU particles populate rows beyond the previous limit without per-step transfers; drawing stays capped", async ({
  page,
}) => {
  await lab(page);
  const r = await page.evaluate(async () => {
    const { s, p, S, gl } = lab;
    lab.build();
    let transfers = 0;
    const read = gl.readPixels.bind(gl);
    gl.readPixels = (...a) => {
      transfers++;
      return read(...a);
    };
    await s.step({
      ...p,
      particleCount: 16384,
      sourceMode: 3,
      rainfall: 1,
      windHeight: 240,
      windSpread: 10,
    });
    gl.readPixels = read;
    const positions = s.read(s.positions[s.motionIndex], ...S.PARTICLE_SIZE),
      audit = await s.audit();
    let high = 0;
    for (let i = 2048; i < 16384; i++) if (positions[i * 4 + 3] >= 0) high++;
    const { particleDrawPlan } = await import("/src/particle-pool.js");
    return {
      capacity: S.MAX_PARTICLES,
      shape: S.PARTICLE_SIZE,
      high,
      audit,
      transfers,
      plan: particleDrawPlan(s.activeCount),
    };
  });
  expect(r.capacity).toBe(16384);
  expect(r.shape).toEqual([64, 288]);
  expect(r.audit.active).toBe(16384);
  expect(r.high).toBe(14336);
  expect(r.transfers).toBe(0);
  expect(r.plan).toEqual({ stride: 4, count: 4096 });
  expect(r.audit.carried).toBe(0);
});

test("UI starts with 4096 samples, exposes 16384, and separates falling rain from runoff controls", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.frontier);
  await page.locator("[data-tab=erosion]").click();
  await expect(page.locator("#particleCount")).toHaveAttribute("max", "16384");
  expect(await page.evaluate(() => frontier.settings.particleCount)).toBe(4096);
  await page.locator("#rain-lifecycle-controls summary").click();
  await expect(page.locator("#runoffLifetime-value")).toHaveText("600 s");
  await expect(page.locator("#runoffEvaporation-value")).toHaveText(
    "0.10% / s",
  );
  await expect(page.locator("#rainStallTime-value")).toHaveText("8.0 s");
  await page.locator("#particleCount").evaluate((el) => {
    el.value = "16384";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(await page.evaluate(() => frontier.settings.particleCount)).toBe(
    16384,
  );
});

test("physical-volume rain runoff carries bounded sediment beyond the old expiry, instead of demanding unlimited fresh incision", async ({
  page,
}) => {
  await lab(page);
  const r = await page.evaluate(async () => {
    lab.build();
    Object.assign(lab.p, {
      rainSubstrateShear: 1,
      rainSubstrateErodibility: 1,
    }); // Explicit weak substrate, not resistant rock.
    lab.seed();
    const initial = await lab.s.readVolume();
    await lab.s.step(lab.p, 16);
    const first = await lab.s.audit(),
      start = lab.read();
    let transfers = 0;
    const read = lab.gl.readPixels.bind(lab.gl);
    lab.gl.readPixels = (...args) => {
      transfers++;
      return read(...args);
    };
    await lab.s.step(lab.p, 80);
    lab.gl.readPixels = read;
    const end = lab.read(),
      audit = await lab.s.audit(),
      after = await lab.s.readVolume();
    const residual = lab.s.read(lab.s.acceptance, ...lab.D.ATLAS_SIZE);
    let changedColumns = 0;
    for (let x = 0; x < 128; x++) {
      let changed = false;
      for (let y = 0; y < 80 && !changed; y++)
        for (let z = 0; z < 128; z++) {
          const i = ((z * 80 + y) * 128 + x) * 4 + 3;
          const a =
            ((Math.floor(z / 16) * 80 + y) * lab.D.ATLAS_SIZE[0] +
              (z % 16) * 128 +
              x) *
              4 +
            3;
          if (initial[i] - (after[i] + residual[a]) > 1e-9) {
            changed = true;
            break;
          }
        }
      if (changed) changedColumns++;
    }
    return { first, start, end, audit, changedColumns, transfers };
  });
  console.log("Coupled runoff", r);
  expect(r.end.pos[0]).toBeLessThan(r.start.pos[0] - 40);
  expect(r.end.pos[3]).toBeGreaterThan(20);
  expect(r.end.clock[2]).toBe(0);
  expect(r.audit.eroded).toBeGreaterThanOrEqual(r.first.eroded);
  expect(r.audit.eroded - r.audit.deposited).toBeLessThanOrEqual(0.006001); // 1 m³ source water × 0.6% volume concentration.
  expect(r.audit.carried).toBeGreaterThan(r.audit.deposited);
  expect(r.changedColumns).toBeGreaterThan(0); // Finite water may saturate; it must not carve an unlimited trail.
  expect(r.transfers).toBe(0);
  expect(Math.abs(r.audit.ledgerError)).toBeLessThan(0.005);
  expect(Math.abs(r.audit.massError) / r.audit.initialSolid).toBeLessThan(1e-7);
});

test("coupled runoff reaches a flat foot and deposits there, rather than stopping in its uphill incision", async ({
  page,
}) => {
  await lab(page, true);
  const r = await page.evaluate(async () => {
    lab.build(0.25, 0, 100);
    Object.assign(lab.p, {
      rainSubstrateShear: 1,
      rainSubstrateErodibility: 1,
    });
    lab.seed({ x: 20 });
    await lab.s.step(lab.p, 180);
    const volume = await lab.s.readVolume();
    let footDeposit = 0,
      uphillDeposit = 0;
    for (let x = 0; x < 128; x++)
      for (let y = 0; y < 80; y++)
        for (let z = 0; z < 128; z++) {
          const wx = lab.D.MIN[0] + (x + 0.5) * lab.D.CELL[0],
            i = ((z * 80 + y) * 128 + x) * 4;
          if (wx < 2) footDeposit += volume[i + 2];
          else uphillDeposit += volume[i + 2];
        }
    return {
      state: lab.read(),
      footDeposit,
      uphillDeposit,
      audit: await lab.s.audit(),
    };
  });
  console.log("Foot deposition", r);
  expect(r.state.pos[0]).toBeLessThan(0);
  expect(r.footDeposit).toBeGreaterThan(0);
  expect(Math.abs(r.audit.rainWater.balanceError)).toBeLessThan(1e-6);
  expect(r.footDeposit).toBeGreaterThan(r.uphillDeposit);
  expect(r.audit.eroded).toBeGreaterThan(0);
  expect(Math.abs(r.audit.ledgerError)).toBeLessThan(0.005);
});
