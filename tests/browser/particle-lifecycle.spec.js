import { test, expect } from "@playwright/test";
async function harness(page) {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    const D = await import("/src/domain.js");
    const { GPUErosion } = await import("/src/gpu-erosion.js");
    const { defaults, generateVolume } = await import("/src/field.js");
    const { PARTICLE_DT, lifecycleUniforms } =
      await import("/src/particle-lifecycle.js");
    const solver = new GPUErosion(
      document.createElement("canvas").getContext("webgl2"),
    );
    const plane = new Float32Array(D.SIZE[0] * D.SIZE[1] * D.SIZE[0] * 4);
    for (let z = 0; z < D.SIZE[0]; z++)
      for (let y = 0; y < D.SIZE[1]; y++)
        for (let x = 0; x < D.SIZE[0]; x++) {
          const i = ((z * D.SIZE[1] + y) * D.SIZE[0] + x) * 4;
          plane[i] = D.MIN[1] + (y + 0.5) * D.CELL[1] - 2.5;
          plane[i + 3] = Math.max(
            0,
            Math.min(1, 0.5 - plane[i] / (2 * D.BAND)),
          );
        }
    window.lab = {
      solver,
      defaults,
      plane,
      PARTICLE_DT,
      lifecycleUniforms,
      params: {
        ...defaults,
        rainStallTime: 0.6,
        particleCount: 1,
        rainfall: 0,
        wind: 0,
        riverEnabled: false,
        waterLevel: -3,
        hardness: 0,
        erosion: 1,
        restitution: 1,
      },
      seed({
        phase = 0,
        water = 1,
        load = 0,
        position = [0, 2.6, 0],
        velocity = [0, -2.5, 0],
        remaining = 200,
      } = {}) {
        solver.upload(plane);
        const p = new Float32Array(8192),
          v = new Float32Array(8192),
          m = new Float32Array(8192),
          life = new Float32Array(8192),
          cargo = new Float32Array(8192),
          species = new Float32Array(8192);
        for (let i = 3; i < p.length; i += 4) p[i] = -1;
        p.set([...position, 0]);
        v.set([...velocity, water]);
        m.set([0, 0.85, 3, 1]);
        life.set([remaining, 0, phase, 0]);
        cargo.set([load, load, 0, 0]);
        species.set([load * 0.45, load * 0.35, load * 0.15, load * 0.05]);
        solver.uploadTexture(solver.positions[0], 64, 32, p);
        solver.uploadTexture(solver.velocities[0], 64, 32, v);
        solver.uploadTexture(solver.metadata[0], 64, 32, m);
        solver.uploadTexture(solver.lifecycles[0], 64, 32, life);
        solver.uploadTexture(solver.cargos[0], 64, 32, cargo);
        solver.uploadTexture(solver.species[0], 64, 32, species);
        // This fixture seeds previously detached cargo into the initial inventory.
        solver.initialMass += load;
      },
      async step(n) {
        for (let i = 0; i < n; i++) await solver.step(this.params);
      },
      particle() {
        return Array.from(
          solver.read(solver.positions[solver.motionIndex], 64, 32).slice(0, 4),
        );
      },
      clock() {
        return Array.from(
          solver
            .read(solver.lifecycles[solver.motionIndex], 64, 32)
            .slice(0, 4),
        );
      },
    };
  });
}
function balanced(a) {
  expect(Math.abs(a.ledgerError)).toBeLessThan(0.0001);
  expect(Math.abs(a.massError)).toBeLessThan(0.002);
  expect(Math.abs(a.compositionError)).toBeLessThan(0.0001);
}

test("resting rain cannot dig with normal collision jitter, settles and dies even with bounce set to one", async ({
  page,
}) => {
  await harness(page);
  const r = await page.evaluate(async () => {
    const D = await import("/src/domain.js");
    const { solver: s } = lab;
    lab.seed();
    const before = await s.readVolume();
    await lab.step(14);
    const movingClock = lab.clock();
    await lab.step(1);
    const onTime = lab.clock();
    await lab.step(1);
    const settled = lab.clock(),
      vel = Array.from(s.read(s.velocities[s.motionIndex], 64, 32).slice(0, 4));
    await lab.step(30);
    const after = await s.readVolume(),
      death = lab.particle(),
      audit = await s.audit();
    await lab.step(4);
    const again = await s.audit();
    return {
      settled,
      movingClock,
      onTime,
      vel,
      death,
      audit,
      again,
      occupancy: after.every((v, i) => i % 4 !== 3 || v === before[i]),
    };
  });
  expect(r.movingClock[2]).toBe(0);
  expect(r.onTime[2]).toBe(1);
  expect(r.settled[2]).toBe(1);
  expect(r.vel.slice(0, 3)).toEqual([0, 0, 0]);
  expect(r.death[3]).toBe(-1);
  expect(r.audit.eroded).toBe(0);
  expect(r.audit.deposited).toBe(0);
  expect(r.occupancy).toBe(true);
  expect(r.again.retired).toBe(r.audit.retired);
  balanced(r.audit);
});

test("dying drops only deposit carried solids; accepted material and unplaced/dissolved retirement stay conserved", async ({
  page,
}) => {
  await harness(page);
  const r = await page.evaluate(async () => {
    const D = await import("/src/domain.js");
    lab.seed({ phase: 1, water: 0, load: 0.04, velocity: [0, 0, 0] });
    lab.params.deposition = 0;
    lab.params.hydraulicMaxChange = 50; // explicit settling-test capacity, not the current 5 mm/s default
    const s = lab.solver,
      before = await s.readVolume();
    let last = before,
      decreases = 0,
      maxDetach = 0;
    for (let i = 0; i < 28; i++) {
      await lab.step(1);
      const v = await s.readVolume();
      for (let j = 3; j < v.length; j += 4)
        if (v[j] < last[j] - 1e-7) decreases++;
      last = v;
      maxDetach = Math.max(maxDetach, s.read(s.exchanges, 64, 32)[0]);
    }
    const audit = await s.audit(),
      m = s.read(s.material, D.ATLAS_SIZE[0], D.ATLAS_SIZE[1]);
    let fines = 0;
    for (let i = 1; i < m.length; i += 4) fines += m[i];
    await lab.step(3);
    return {
      audit,
      after: await s.audit(),
      decreases,
      maxDetach,
      fines,
      death: lab.particle(),
    };
  });
  expect(r.maxDetach).toBe(0);
  expect(r.decreases).toBe(0);
  expect(r.audit.eroded).toBeCloseTo(0.04, 6);
  expect(r.audit.deposited).toBeGreaterThan(0.03);
  expect(r.fines).toBeGreaterThan(0.01);
  expect(r.audit.retired).toBeGreaterThanOrEqual(0.00199);
  expect(r.audit.carried).toBe(0);
  expect(r.death[3]).toBe(-1);
  expect(r.after.retired).toBe(r.audit.retired);
  balanced(r.audit);
});

test("birth captures a hard tick lifetime; drying and stall timers cause earlier, non-eroding settling", async ({
  page,
}) => {
  await harness(page);
  const r = await page.evaluate(async () => {
    const D = await import("/src/domain.js");
    const s = lab.solver;
    lab.seed({ position: [0, 14, 0], velocity: [1, 0, 0], remaining: 50 });
    // Raise the UI cap after birth: it MUST NOT extend this particle's budget.
    lab.params.rainLifetime = 15;
    lab.params.rainEvaporation = 0.05;
    const values = {
      physics: [0.04, 0, 1, 0],
      config: [0.85, 0.15, 1, 0],
      environment: [-3, 0, 4821, 0],
      weather: [3, 0.45, 0.6, 0],
      river: [0, 0, 0, 0],
      windField: [0, 0, 0, 0],
      emitter: [0, 0, 18, 15],
      canyonShape: [0, 0, 0, 0],
      lifeSettings: lab.lifecycleUniforms(lab.params),
    };
    // Production particle passes only: no surface exchange is needed to test clocks.
    const tick = () => {
      const a = s.motionIndex,
        b = 1 - a;
      s.pass(
        "motion",
        [s.positions[b], s.velocities[b], s.metadata[b], s.impacts],
        64,
        32,
        {
          terrain: s.volume,
          flowPaths: s.flowPaths.texture,
          positions: s.positions[a],
          velocities: s.velocities[a],
          metadata: s.metadata[a],
          species: s.species[0],
          lifecycle: s.lifecycles[a],
        },
        values,
      );
      s.pass(
        "lifecycle",
        [s.lifecycles[b]],
        64,
        32,
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
    };
    for (let i = 0; i < 49; i++) tick();
    const active = lab.clock();
    tick();
    const terminal = lab.clock();
    for (let i = 0; i < 25; i++) tick();
    const dead = lab.particle();
    // Rain is now measured in m³, not the old dimensionless wetness tag:
    // 0.014 m³ is fourteen litres and must NOT be classified as dry.
    lab.seed({ water: 0.014, velocity: [1, 0, 0] });
    await lab.step(1);
    const wet = lab.clock();
    lab.seed({ water: 1e-13, velocity: [1, 0, 0] });
    await lab.step(1);
    const dry = lab.clock();
    s.upload(lab.plane);
    lab.params.rainfall = 1;
    lab.params.rainLifetime = 2;
    // Births now live in the real precipitation pool, not primary slot zero.
    const { PARTICLE_SIZE, RAIN_START, TOTAL_PARTICLE_SLOTS } = await import("/src/particle-pool.js");
    let id = -1;
    for (let attempt = 0; attempt < 128 && id < 0; attempt++) {
      await lab.step(1);
      const pos = s.read(s.positions[s.motionIndex], ...PARTICLE_SIZE);
      for (let i = RAIN_START; i < TOTAL_PARTICLE_SLOTS; i++)
        if (pos[i * 4 + 3] >= 0) { id = i; break; }
    }
    const captured = () => Array.from(s.read(s.lifecycles[s.motionIndex], ...PARTICLE_SIZE).slice(id * 4, id * 4 + 4));
    const born = captured();
    lab.params.rainfall = 0;
    lab.params.rainLifetime = 15;
    await lab.step(1);
    const budgetAfterEdit = captured();
    return { active, terminal, dead, wet, dry, born, budgetAfterEdit };
  });
  expect(r.active[0]).toBe(1);
  expect(r.active[2]).toBe(0);
  expect(r.terminal[0]).toBe(0);
  expect(r.terminal[2]).toBe(3); // A moving numerical timeout is outflow, not a forced sediment dump.
  expect(r.dead[3]).toBe(-1);
  expect(r.wet[2]).toBe(0);
  expect(r.dry[2]).toBe(1);
  expect(r.born[0]).toBe(50);
  expect(r.budgetAfterEdit[0]).toBe(49);
});

test("rain lifetime UI uses simulation seconds and precise water-loss percentage editing", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  await page.locator("[data-tab=erosion]").click();
  await page.locator("#rain-lifecycle-controls summary").click();
  await expect(page.locator("#rainLifetime-value")).toHaveText("8.0 s");
  await expect(page.locator("#rainEvaporation-value")).toHaveText("20% / s");
  await page.locator("#rainEvaporation-value").click();
  await page.locator("#rainEvaporation-value input").fill("40");
  await page.locator("#rainEvaporation-value input").press("Enter");
  expect(await page.evaluate(() => frontier.settings.rainEvaporation)).toBe(
    0.4,
  );
  await page.locator("#rainLifetime-value").click();
  await page.locator("#rainLifetime-value input").fill("4");
  await page.locator("#rainLifetime-value input").press("Enter");
  expect(await page.evaluate(() => frontier.settings.rainLifetime)).toBe(4);
  expect(await page.evaluate(() => frontier.iterations)).toBe(0);
  await page.locator("#rain-lifecycle-controls summary").click();
  await page.locator("#hydraulic-rate-controls summary").click();
  await expect(page.locator("#hydraulicDepth-value")).toHaveText("20 mm");
  await expect(page.locator("#hydraulicDrag-value")).toHaveText("0.010");
  await expect(page.locator("#hydraulicMaxChange-value")).toHaveText("5 mm/s");
  await expect(page.locator("#hydraulicPreview-value")).toHaveText("10×");
  await page.locator("#hydraulicPreview-value").click();
  await page.locator("#hydraulicPreview-value input").fill("25");
  await page.locator("#hydraulicPreview-value input").press("Enter");
  expect(await page.evaluate(() => frontier.settings.hydraulicPreview)).toBe(
    25,
  );
  await page.locator("#hydraulicErodibility-value").click();
  await page.locator("#hydraulicErodibility-value input").fill("0.015");
  await page.locator("#hydraulicErodibility-value input").press("Enter");
  expect(
    await page.evaluate(() => frontier.settings.hydraulicErodibility),
  ).toBeCloseTo(0.015, 6);
  await page.screenshot({ path: "artifacts/hydraulic-controls.png" });
});

test("a whole rain batch drains to zero live agents after emission stops, with no hidden immortal slots", async ({
  page,
}) => {
  await harness(page);
  const r = await page.evaluate(async () => {
    const D = await import("/src/domain.js");
    const s = lab.solver;
    s.upload(lab.plane);
    Object.assign(lab.params, {
      particleCount: 128,
      rainfall: 1,
      rainLifetime: 2,
      rainEvaporation: 0.05,
      rainStallTime: 0.2,
      runoffLifetime: 10,
    });
    await lab.step(1);
    const birth = await s.audit();
    lab.params.rainfall = 0;
    await lab.step(76);
    const drained = await s.audit(),
      before = await s.readVolume();
    await lab.step(4);
    const later = await s.audit(),
      after = await s.readVolume();
    return {
      birth,
      drained,
      later,
      unchanged: after.every((v, i) => i % 4 !== 3 || v === before[i]),
    };
  });
  expect(r.birth.precipitationAirborne).toBeGreaterThan(0);
  expect(r.birth.precipitationAirborne).toBeLessThan(2048); // Staggered airborne births, not a synchronous contact batch.
  expect(r.drained.totalActive).toBe(0);
  expect(r.drained.carried).toBe(0);
  expect(r.later.eroded).toBe(r.drained.eroded);
  expect(r.later.retired).toBe(r.drained.retired);
  expect(r.unchanged).toBe(true);
  balanced(r.drained);
});

test("moving unsaturated rain keeps eroding after picking up sediment, instead of tiny settling cancelling all detachment", async ({
  page,
}) => {
  await harness(page);
  const r = await page.evaluate(async () => {
    const D = await import("/src/domain.js");
    lab.seed({ load: 0.005, velocity: [2, 0, 0] });
    lab.params.deposition = 0.35;
    const s = lab.solver;
    await lab.step(1);
    const first = await s.audit(),
      exchange = Array.from(s.read(s.exchanges, 64, 32).slice(0, 4));
    await lab.step(7);
    return { first, exchange, after: await s.audit() };
  });
  expect(r.exchange[0]).toBeGreaterThan(0.0001);
  expect(r.exchange[1]).toBe(0);
  expect(r.first.eroded).toBeGreaterThan(0.0051);
  expect(r.after.eroded).toBeGreaterThan(r.first.eroded + 0.0001);
  balanced(r.after);
});

test("saturated moving rain still deposits without detaching more rock", async ({
  page,
}) => {
  await harness(page);
  const r = await page.evaluate(async () => {
    const D = await import("/src/domain.js");
    // A 128-sample, 1× parcel carries at most ~0.02 m³ at this film depth;
    // 0.19 m³ particulate is genuinely overloaded, independent of flow speed.
    lab.params.particleCount = 128;
    lab.params.hydraulicPreview = 1;
    lab.seed({ load: 0.2, velocity: [2, 0, 0] });
    lab.params.deposition = 0.35;
    await lab.step(1);
    const s = lab.solver;
    return {
      exchange: Array.from(s.read(s.exchanges, 64, 32).slice(0, 2)),
      audit: await s.audit(),
    };
  });
  expect(r.exchange[0]).toBe(0);
  expect(r.exchange[1]).toBeGreaterThan(0);
  expect(r.audit.eroded).toBeCloseTo(0.2, 6);
  expect(r.audit.deposited).toBeGreaterThan(0);
  balanced(r.audit);
});

test("Fast whole-mountain preview removes more slope material in the same GPU-pass budget without breaking accounting", async ({
  page,
}) => {
  await harness(page);
  const r = await page.evaluate(async () => {
    const { generateVolume } = await import("/src/field.js"),
      { worldDefaults } = await import("/src/world.js");
    const s = lab.solver,
      p = {
        ...lab.defaults,
        ...worldDefaults,
        preset: 4,
        waterEnabled: false,
        riverEnabled: false,
        strata: 0.15,
        roughness: 0.5,
      };
    const data = generateVolume(p);
    s.upload(data);
    const initial = await s.readVolume();
    const run = async (settings) => {
      s.upload(data);
      await s.step({ ...p, ...settings }, 32);
      const volume = await s.readVolume(),
        audit = await s.audit();
      let slopeRemoved = 0;
      for (let z = 0; z < 128; z++)
        for (let y = 0; y < 80; y++)
          for (let x = 0; x < 128; x++) {
            if (s.domain.min[1] + (y + 0.5) * s.domain.cell[1] <= 1) continue;
            const i = ((z * 80 + y) * 128 + x) * 4;
            slopeRemoved +=
              Math.max(0, initial[i + 3] - volume[i + 3]) *
              s.domain.voxelVolume;
          }
      return { audit, slopeRemoved };
    };
    return {
      reference: await run({ timeLapse: 1, weatheringRate: 1 }),
      fast: await run({ timeLapse: 4, weatheringRate: 16 }),
    };
  });
  expect(r.fast.audit.eroded).toBeGreaterThan(r.reference.audit.eroded * 4);
  expect(r.fast.slopeRemoved).toBeGreaterThan(
    Math.max(0.01, r.reference.slopeRemoved * 2),
  );
  for (const v of [r.reference, r.fast]) {
    expect(Math.abs(v.audit.ledgerError)).toBeLessThan(0.005);
    expect(Math.abs(v.audit.massError) / v.audit.initialSolid).toBeLessThan(
      1e-7,
    );
    expect(v.audit.maxAge).toBeLessThanOrEqual(8.001);
  }
});

test("production hydraulic GLSL agrees with the double-precision closure", async ({
  page,
}) => {
  await harness(page);
  const results = await page.evaluate(async () => {
    const D = await import("/src/domain.js");
    const { program } = await import("/src/gpu-erosion.js");
    const { fullscreenVertex } = await import("/src/erosion-shaders.js");
    const { hydraulicGLSL, hydraulicExchange, hydraulicUniforms } =
      await import("/src/hydraulic-transport.js");
    const s = lab.solver,
      t = s.texture(1, 1);
    s.programs.reference = program(
      s.gl,
      fullscreenVertex,
      `#version 300 es
precision highp float;
${hydraulicGLSL}
uniform vec4 inputs,site,controls,model;
uniform float dt;
out vec4 result;
void main(){result=waterExchange(inputs.x,inputs.y,inputs.z,inputs.w,site.x,site.y,site.z,dt,controls,model);}`,
      "hydraulic reference",
    );
    return [
      { speed: 2, water: 1, load: 0 },
      { speed: 2, load: 0.3 },
      { speed: 0, load: 0.01 },
      { speed: 5, water: 0, load: 0.01 },
      { speed: 3, dt: 0.00001, grain: 0.00025 },
      { speed: 0.2, load: 0.1, hardness: 0.9 },
      {
        speed: 4,
        hydraulicDepth: 80,
        hydraulicPreview: 1,
        bedding: 0.4,
        loose: 0.8,
      },
    ].map((p) => {
      const v = {
        speed: 0,
        water: 1,
        load: 0,
        grain: 0.00015,
        bedding: 0,
        loose: 0,
        area: 1,
        dt: 0.04,
        strength: 0.45,
        hardness: 0.6,
        deposition: 0.35,
        capacity: 0.6,
        ...p,
      };
      s.pass(
        "reference",
        [t],
        1,
        1,
        {},
        {
          inputs: [v.speed, v.water, v.load, v.grain],
          site: [v.bedding, v.loose, v.area, 0],
          controls: [v.strength, v.hardness, v.deposition, v.capacity],
          model: hydraulicUniforms(v),
          dt: v.dt,
        },
      );
      const cpu = hydraulicExchange(v);
      return {
        gpu: Array.from(s.read(t, 1, 1)),
        cpu: [cpu.detach, cpu.deposit, cpu.capacity, cpu.tau],
      };
    });
  });
  for (const { gpu, cpu } of results)
    for (let i = 0; i < 4; i++)
      expect(Math.abs(gpu[i] - cpu[i])).toBeLessThan(
        1e-9 + Math.abs(cpu[i]) * 2e-5,
      );
});

test("overlapping GPU carriers share the aggregate erosion and deposition ceiling without losing cargo", async ({
  page,
}) => {
  await harness(page);
  const results = await page.evaluate(async () => {
    const D = await import("/src/domain.js");
    const { maxSolidChange } = await import("/src/hydraulic-transport.js");
    const s = lab.solver,
      results = [];
    for (const phase of [0, 1]) {
      const load = phase === 1 ? 0.2 : 0,
        count = 128;
      lab.params.particleCount = count;
      lab.params.hydraulicMaxChange = 1;
      lab.params.hydraulicPreview = 200;
      lab.seed({ phase, load, velocity: [8, 0, 0] });
      for (const t of [
        s.positions[0],
        s.velocities[0],
        s.metadata[0],
        s.lifecycles[0],
        s.cargos[0],
        s.species[0],
      ]) {
        const values = s.read(t, 64, 32),
          first = values.slice(0, 4);
        for (let i = 1; i < count; i++) values.set(first, i * 4);
        s.uploadTexture(t, 64, 32, values);
      }
      s.initialMass += load * (count - 1);
      const before = await s.readVolume();
      await lab.step(1);
      const after = await s.readVolume();
      let maximum = 0;
      for (let i = 3; i < before.length; i += 4)
        maximum = Math.max(
          maximum,
          phase === 0 ? before[i] - after[i] : after[i] - before[i],
        );
      results.push({
        maximum,
        limit: maxSolidChange(lab.params),
        audit: await s.audit(),
      });
    }
    return results;
  });
  for (const r of results) {
    expect(r.maximum).toBeLessThanOrEqual(r.limit + 8e-8);
    expect(r.maximum).toBeGreaterThan(r.limit * 0.9);
    balanced(r.audit);
  }
});

test("GPU flow history records water motion, excludes dry rock agents, and resets without steady-state CPU transfers", async ({
  page,
}) => {
  await harness(page);
  const r = await page.evaluate(async () => {
    const D = await import("/src/domain.js");
    lab.seed({ velocity: [2, 0, 0] });
    lab.params.particleCount = 128;
    const s = lab.solver,
      gl = s.gl;
    s.flowPaths.update(lab.params);
    const read = gl.readPixels.bind(gl),
      upload = gl.texSubImage2D.bind(gl);
    let reads = 0,
      uploads = 0;
    gl.readPixels = (...a) => {
      reads++;
      return read(...a);
    };
    gl.texSubImage2D = (...a) => {
      uploads++;
      return upload(...a);
    };
    await lab.step(3);
    gl.readPixels = read;
    gl.texSubImage2D = upload;
    const history = s.read(s.flowField, D.ATLAS_SIZE[0], D.ATLAS_SIZE[1]);
    let exposure = 0,
      x = 0;
    for (let i = 0; i < history.length; i += 4) {
      x += history[i];
      exposure += history[i + 3];
    }
    lab.seed({ velocity: [2, 0, 0] });
    const reset = s
      .read(s.flowField, D.ATLAS_SIZE[0], D.ATLAS_SIZE[1])
      .every((v) => v === 0);
    const meta = s.read(s.metadata[0], 64, 32);
    meta[0] = 3;
    s.uploadTexture(s.metadata[0], 64, 32, meta);
    await lab.step(1);
    const dry = s
      .read(s.flowField, D.ATLAS_SIZE[0], D.ATLAS_SIZE[1])
      .every((v) => v === 0);
    return { reads, uploads, exposure, x, reset, dry, error: gl.getError() };
  });
  expect(r.reads).toBe(0);
  expect(r.uploads).toBe(0);
  expect(r.exposure).toBeGreaterThan(0);
  expect(r.x).toBeGreaterThan(0);
  expect(r.reset).toBe(true);
  expect(r.dry).toBe(true);
  expect(r.error).toBe(0);
});
