import { test, expect } from "@playwright/test";
async function lab(page) {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    const D = await import("/src/domain.js"),
      S = await import("/src/erosion-shaders.js");
    const { defaults, generateVolume } = await import("/src/field.js"),
      { GPUErosion } = await import("/src/gpu-erosion.js");
    const p = {
      ...defaults,
      worldEnabled: true,
      preset: 4,
      terrainWidth: 1000,
      terrainLength: 1000,
      terrainHeight: 240,
      terrainAmplitude: 45,
      sourceMode: 0,
      particleCount: 256,
      rainfall: 1,
      rainRate: 20,
      timeLapse: 8,
      weatheringRate: 64,
      hydraulicPreview: 200,
      wind: 1,
      riverEnabled: false,
      waterLevel: -30,
    };
    D.configureDomain(p);
    const gl = document.createElement("canvas").getContext("webgl2"),
      s = new GPUErosion(gl);
    const plane = new Float32Array(128 * 80 * 128 * 4);
    const reset = (slope = 0) => {
      for (let z = 0; z < 128; z++)
        for (let y = 0; y < 80; y++)
          for (let x = 0; x < 128; x++)
            plane[((z * 80 + y) * 128 + x) * 4] =
              (D.MIN[1] +
                (y + 0.5) * D.CELL[1] -
                100 -
                slope * (D.MIN[0] + (x + 0.5) * D.CELL[0])) /
              Math.hypot(1, slope);
      s.upload(plane);
    };
    window.lab = { D, S, p, gl, s, reset, generateVolume };
    reset();
  });
}
test("GPU rain admission is fixed by mm/hour, not carrier count; complete water ledger closes", async ({
  page,
}) => {
  await lab(page);
  const r = await page.evaluate(async () => {
    const { s, p } = lab,
      rows = [];
    for (const count of [256, 4096]) {
      lab.reset();
      p.particleCount = count;
      await s.step(p, 8);
      rows.push(await s.audit());
    }
    return rows;
  });
  console.log(
    "Rain-volume pool comparison",
    r.map((a) => a.rainWater),
  );
  const expected = ((20 * 0.001) / 3600) * 980 * 980 * 8 * 0.32;
  for (const a of r) {
    expect(a.rainWater.admitted).toBeCloseTo(expected, 5);
    expect(Math.abs(a.rainWater.balanceError)).toBeLessThan(1e-5);
    expect(a.eroded).toBe(0);
  }
  expect(r[0].rainWater.admitted).toBe(r[1].rainWater.admitted);
});
test("128-update flat-ground storm does not perforate the floor even at 64× dose and 200× legacy preview", async ({
  page,
}) => {
  test.setTimeout(360000);
  await lab(page);
  const r = await page.evaluate(async () => {
    const { s, p, gl } = lab,
      before = await s.readVolume();
    let reads = 0,
      uploads = 0,
      allocations = 0;
    const read = gl.readPixels.bind(gl),
      upload = gl.texSubImage2D.bind(gl),
      allocate = gl.texStorage2D.bind(gl);
    gl.readPixels = (...args) => {
      reads++;
      return read(...args);
    };
    gl.texSubImage2D = (...args) => {
      uploads++;
      return upload(...args);
    };
    gl.texStorage2D = (...args) => {
      allocations++;
      return allocate(...args);
    };
    await s.step(p, 128);
    gl.readPixels = read;
    gl.texSubImage2D = upload;
    gl.texStorage2D = allocate;
    const after = await s.readVolume();
    let maxChange = 0;
    for (let i = 3; i < after.length; i += 4)
      maxChange = Math.max(maxChange, Math.abs(after[i] - before[i]));
    return { audit: await s.audit(), maxChange, reads, uploads, allocations };
  });
  console.log("Flat storm proof", r);
  expect(r.audit.eroded).toBe(0);
  expect(r.maxChange).toBe(0);
  expect(r.audit.rainWater.admitted).toBeGreaterThan(50);
  expect(r.audit.rainWater.requested).toBeGreaterThan(200);
  expect(r.audit.rainWater.admitted).toBeLessThanOrEqual(
    r.audit.rainWater.requested + 0.001,
  );
  expect(Math.abs(r.audit.rainWater.balanceError)).toBeLessThan(0.003);
  expect(r.reads + r.uploads + r.allocations).toBe(0);
});
test("a moving physical-volume rain parcel cuts a slope, preserves sub-ULP material changes, and distinguishes substrate resistance", async ({
  page,
}) => {
  await lab(page);
  const r = await page.evaluate(async () => {
    const { s, p, S } = lab;
    const rows = [],
      fields = [];
    for (const resistance of [1, 0.001, 0]) {
      lab.reset(0.5);
      Object.assign(p, {
        particleCount: 1,
        rainfall: 0,
        timeLapse: 4,
        weatheringRate: 1,
        rainSubstrateShear: 20,
        rainSubstrateErodibility: resistance,
        wind: 0,
        erosion: 0.45,
        hardness: 0.6,
      });
      const pos = s.read(s.positions[0], ...S.PARTICLE_SIZE),
        v = pos.slice().fill(0),
        m = v.slice(),
        l = v.slice();
      pos.set([0, 100.08, 0, 1]);
      v.set([-6, -3, 0, 0.01]);
      m.set([0, 4, 3, 0.08]);
      l.set([15000, 0, 0, 100.08]);
      for (const [name, data] of Object.entries({
        positions: pos,
        velocities: v,
        metadata: m,
        lifecycles: l,
      }))
        s.uploadTexture(s[name][0], ...S.PARTICLE_SIZE, data);
      s.uploadTexture(
        s.rainLedgers[0],
        1,
        1,
        new Float32Array([0.01, 0, 0, 0]),
      );
      const before = await s.readVolume();
      await s.step(p, 24);
      const after = await s.readVolume();
      let distanceChanges = 0;
      for (let i = 0; i < after.length; i += 4)
        if (
          Math.abs(after[i] - before[i]) > 1e-7 &&
          before[i + 3] > 0 &&
          before[i + 3] < 1
        )
          distanceChanges++;
      fields.push(after);
      rows.push({
        audit: await s.audit(),
        distanceChanges,
        position: Array.from(
          s.read(s.positions[s.motionIndex], ...S.PARTICLE_SIZE).slice(0, 4),
        ),
      });
    }
    rows.forEach((row, n) => {
      row.distanceChanges = 0;
      for (let i = 0; i < fields[n].length; i += 4)
        if (Math.abs(fields[n][i] - fields[2][i]) > 1e-7) row.distanceChanges++;
    });
    return rows;
  });
  console.log("Weak versus resistant substrate", r);
  expect(r[0].audit.eroded).toBeGreaterThan(0);
  expect(r[0].distanceChanges).toBeGreaterThan(0);
  expect(r[0].position[0]).toBeLessThan(-1);
  expect(r[1].audit.eroded).toBeLessThan(r[0].audit.eroded / 5);
  for (const row of r) {
    expect(Math.abs(row.audit.ledgerError)).toBeLessThan(1e-7);
    expect(Math.abs(row.audit.massError)).toBeLessThan(0.001);
    expect(Math.abs(row.audit.rainWater.balanceError)).toBeLessThan(1e-7);
  }
});
test("real mountain rainfall remains under the water/concentration bound and checkpoints retain both ledgers", async ({
  page,
}) => {
  test.setTimeout(360000);
  await lab(page);
  const r = await page.evaluate(async () => {
    const { s, p } = lab;
    s.upload(lab.generateVolume(p));
    const before = await s.readVolume();
    await s.step(p, 96);
    const audit = await s.audit(),
      after = await s.readVolume();
    let maxDepth = 0;
    for (let i = 3; i < after.length; i += 4)
      maxDepth = Math.max(maxDepth, (before[i] - after[i]) * 2 * lab.D.BAND);
    const snapshot = await s.checkpoint();
    s.upload(lab.generateVolume(p));
    s.restoreCheckpoint(snapshot);
    const restored = await s.checkpoint();
    return {
      audit,
      maxDepth,
      exact:
        Object.keys(snapshot.fields).every((k) =>
          snapshot.fields[k].every((v, i) => v === restored.fields[k][i]),
        ) && snapshot.rainLedger.every((v, i) => v === restored.rainLedger[i]),
    };
  });
  console.log("Mountain storm proof", r);
  const maxNetLoss = r.audit.rainWater.admitted * 0.006;
  expect(r.audit.eroded - r.audit.deposited).toBeLessThanOrEqual(
    maxNetLoss + 0.0001,
  );
  expect(r.maxDepth).toBeLessThan(0.01);
  expect(Math.abs(r.audit.rainWater.balanceError)).toBeLessThan(0.003);
  expect(r.exact).toBe(true);
});

test("aggregate loose-sediment requests cannot silently consume resistant substrate", async ({
  page,
}) => {
  await lab(page);
  const r = await page.evaluate(() => {
    const { s, gl, D } = lab,
      W = D.ATLAS_SIZE[0],
      H = D.ATLAS_SIZE[1],
      q = [64, 20, 64],
      uv = [(q[2] % 16) * 128 + q[0], Math.floor(q[2] / 16) * 80 + q[1]];
    const scalar = (texture, data) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        uv[0],
        uv[1],
        1,
        1,
        gl.RGBA,
        gl.FLOAT,
        new Float32Array(data),
      );
    };
    const run = (hard) => {
      lab.reset();
      scalar(s.material, [0.2, 0, 0, 0]);
      scalar(s.requests, [10, 0, 0, 0]);
      gl.bindTexture(gl.TEXTURE_2D, s.substrateRequests);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        uv[0],
        uv[1],
        1,
        1,
        gl.RED,
        gl.FLOAT,
        new Float32Array([hard]),
      );
      s.pass(
        "apply",
        [s.volumes[1], s.acceptances[1], s.materials[1], s.flowHistories[1]],
        W,
        H,
        {
          terrain: s.volume,
          requests: s.requests,
          substrateRequests: s.substrateRequests,
          previousAcceptance: s.acceptance,
          materials: s.material,
          speciesRequests: s.speciesRequests,
          previousFlow: s.flowField,
          flowRequests: s.flowRequests,
        },
        { maxSolidChange: 1, stepTicks: 1 },
      );
      const a = s.read(s.acceptances[1], W, H),
        m = s.read(s.materials[1], W, H),
        k = (uv[1] * W + uv[0]) * 4;
      return { eroded: a[k + 2], loose: m[k] };
    };
    return { protected: run(0), permitted: run(0.05), error: gl.getError() };
  });
  expect(r.protected.eroded).toBeCloseTo(0.2, 6);
  expect(r.permitted.eroded).toBeCloseTo(0.25, 6);
  expect(r.protected.loose).toBe(0);
  expect(r.permitted.loose).toBe(0);
  expect(r.error).toBe(0);
});

test("rain diameter changes actual falling speed, not just point size", async ({
  page,
}) => {
  await lab(page);
  const rows = await page.evaluate(async () => {
    const { s, p, S } = lab,
      rows = [];
    for (const diameter of [0.5, 5]) {
      lab.reset();
      Object.assign(p, {
        agentDiameter: diameter,
        particleCount: 4096,
        wind: 0,
        timeLapse: 1,
      });
      await s.step(p, 16);
      const m = s.read(s.metadata[s.motionIndex], ...S.PARTICLE_SIZE),
        v = s.read(s.velocities[s.motionIndex], ...S.PARTICLE_SIZE),
        pos = s.read(s.positions[s.motionIndex], ...S.PARTICLE_SIZE);
      const speeds = [];
      for (let i = S.RAIN_START; i < S.TOTAL_PARTICLE_SLOTS; i++)
        if (pos[i * 4 + 3] > 0.35 && m[i * 4 + 3] < 0)
          speeds.push(-v[i * 4 + 1]);
      rows.push(speeds.reduce((a, b) => a + b, 0) / speeds.length);
    }
    return rows;
  });
  console.log("Actual fall speed, 0.5 mm vs 5 mm", rows);
  expect(rows[0]).toBeLessThan(2.2);
  expect(rows[1]).toBeGreaterThan(rows[0] * 2);
});

test("production rain GLSL matches the double-precision closure across dry, loose, rock and saturated cases", async ({
  page,
}) => {
  await lab(page);
  const rows = await page.evaluate(async () => {
    const { program } = await import("/src/gpu-erosion.js"),
      { hydraulicGLSL } = await import("/src/hydraulic-transport.js"),
      { rainPhysicsGLSL, rainExchange } = await import("/src/rain-physics.js");
    const { s, gl } = lab;
    const fragment = `#version 300 es\nprecision highp float;\n${hydraulicGLSL}\n${rainPhysicsGLSL}\nuniform vec4 a,b,controls,model;out vec4 result;void main(){result=rainExchange(a.x,a.y,a.z,a.w,b.x,b.y,b.z,controls,model,b.w);}`;
    s.programs.rainCheck = program(
      gl,
      lab.S.fullscreenVertex,
      fragment,
      "Rain closure validation",
    );
    const t = s.texture(1, 1),
      rows = [];
    for (const p of [
      { volume: 0, speed: 0, slope: 0 },
      { volume: 0.001, speed: 6, slope: 0.5 },
      { volume: 0.001, speed: 6, slope: 0.5, looseVolume: 0.1 },
      { volume: 0.001, speed: 3, slope: 0.25, load: 0.001 },
      { volume: 0.01, speed: 12, slope: 1, dose: 64 },
    ]) {
      const c = rainExchange({ ...p, dt: 0.32 });
      s.pass(
        "rainCheck",
        [t],
        1,
        1,
        {},
        {
          a: [p.speed, p.slope, p.volume, p.load ?? 0],
          b: [p.looseVolume ?? 0, 0.00015, 0.32, p.dose ?? 1],
          controls: [0.45, 0.6, 0.35, 0.6],
          model: [0.00002, 0.02, 0.01, 200],
          rainPhysics: [20, 100, 0.001, 0.01],
        },
      );
      rows.push({
        gpu: Array.from(s.read(t, 1, 1)),
        cpu: [c.detach, c.deposit, c.capacity, c.tau],
      });
    }
    return rows;
  });
  for (const r of rows)
    for (let i = 0; i < 4; i++)
      expect(Math.abs(r.gpu[i] - r.cpu[i])).toBeLessThan(
        1e-11 + Math.abs(r.cpu[i]) * 3e-5,
      );
});

test("live controls expose rainfall units and the water shortfall ledger", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.frontier?.diagnostics.ready);
  await page.locator("[data-tab=erosion]").click();
  await expect(page.locator("#rainRate-value")).toHaveText("20 mm/h");
  await page.locator("#step").click();
  await page.waitForFunction(() => frontier.iterations === 1);
  await page.locator("#audit-erosion").click();
  await expect(page.locator("#erosion-audit")).toContainText(
    "RAIN WATER — m³",
    { timeout: 60000 },
  );
  await expect(page.locator("#erosion-audit")).toContainText("Unrepresented");
  await expect(page.locator("#erosion-audit")).toContainText("Balance error");
});
