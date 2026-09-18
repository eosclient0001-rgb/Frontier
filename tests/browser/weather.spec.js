import { test, expect } from "@playwright/test";

async function harness(page) {
  // Exercise exactly the production GPU passes, without spending test time on
  // the raymarching viewport. No alternate CPU erosion implementation.
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    const { GPUErosion } = await import("/src/gpu-erosion.js");
    const { defaults, generateVolume } = await import("/src/field.js");
    const { profileFor, profileSettings } = await import("/src/weather.js");
    const canvas = document.createElement("canvas"),
      gl = canvas.getContext("webgl2");
    const solver = new GPUErosion(gl),
      volume = generateVolume(defaults);
    window.lab = {
      solver,
      volume,
      params: {
        ...defaults,
        particleCount: 128,
        rainfall: 1,
        erosion: 0.85,
        hardness: 0.25,
      },
      async reset(mode, patch = {}) {
        this.params = {
          ...defaults,
          particleCount: 128,
          rainfall: 1,
          erosion: 0.85,
          hardness: 0.25,
          sourceMode: mode,
          ...profileSettings(profileFor(mode)),
          ...patch,
        };
        solver.upload(volume);
      },
      async step(n) {
        for (let i = 0; i < n; i++) await solver.step(this.params);
        return solver.audit();
      },
    };
  });
}
function balanced(a) {
  expect(Math.abs(a.massError)).toBeLessThan(0.02);
  expect(Math.abs(a.ledgerError)).toBeLessThan(0.005);
  expect(Math.abs(a.compositionError)).toBeLessThan(0.005);
}

test("river emits low, travels downstream, scours the bed and transports actual material", async ({
  page,
}) => {
  await harness(page);
  await page.evaluate(() => lab.reset(2));
  const birth = await page.evaluate(() => lab.step(1));
  expect(birth.byMode[2].active).toBe(128);
  expect(birth.byMode[2].meanY).toBeLessThan(1.5);
  expect(birth.byMode[2].meanVz).toBeGreaterThan(2);
  await page.evaluate(() => {
    const s = lab.solver;
    lab.births = s.read(s.positions[s.motionIndex], 64, 32);
  });
  const after = await page.evaluate(() => lab.step(10));
  expect(after.eroded).toBeGreaterThan(0.05);
  expect(after.carried).toBeGreaterThan(0.01);
  expect(after.composition.sand).toBeGreaterThan(0);
  expect(after.composition.fines).toBeGreaterThan(0);
  expect(after.deposited).toBeGreaterThan(0);
  expect(after.byMode[2].meanVz).toBeGreaterThan(0.5);
  balanced(after);
  const inventory = await page.evaluate(() => {
    const s = lab.solver,
      v = s.read(s.volume, 1792, 504),
      m = s.read(s.material, 1792, 504);
    let invalid = 0,
      loose = 0,
      highRemoval = 0,
      bedRemoval = 0;
    for (let i = 0; i < m.length; i += 4) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        if (!Number.isFinite(m[i + k]) || m[i + k] < -1e-8) invalid++;
        sum += m[i + k];
      }
      if (sum > v[i + 3] * (44 / 112) * (26 / 72) * (40 / 112) + 1e-5)
        invalid++;
      loose += sum;
    }
    for (let z = 0; z < 112; z++)
      for (let y = 0; y < 72; y++)
        for (let x = 0; x < 112; x++) {
          const a =
              ((Math.floor(z / 16) * 72 + y) * 1792 + (z % 16) * 112 + x) * 4,
            original = ((z * 72 + y) * 112 + x) * 4;
          const removed = lab.volume[original + 3] - v[a + 3];
          if (-4 + ((y + 0.5) * 26) / 72 > 3) highRemoval += Math.abs(removed);
          else bedRemoval += removed;
        }
    const pos = s.read(s.positions[s.motionIndex], 64, 32),
      cargo = s.read(s.cargos[s.cargoIndex], 64, 32);
    let dz = 0,
      load = 0;
    for (let i = 0; i < 128 * 4; i += 4) {
      dz += (pos[i + 2] - lab.births[i + 2]) * cargo[i];
      load += cargo[i];
    }
    return {
      invalid,
      loose,
      highRemoval,
      bedRemoval,
      sedimentDownstream: dz / Math.max(load, 1e-9),
    };
  });
  expect(inventory.invalid).toBe(0);
  expect(inventory.loose).toBeGreaterThan(0);
  expect(inventory.highRemoval).toBeLessThan(0.001);
  expect(inventory.bedRemoval).toBeGreaterThan(0);
  expect(inventory.sedimentDownstream).toBeGreaterThan(0.25);
});

test("wind is emitted at height, abrades dry rock, and captures incoming size per agent", async ({
  page,
}) => {
  await harness(page);
  await page.evaluate(() =>
    lab.reset(3, { windHeight: 8, windSpread: 1, windSpeed: 8 }),
  );
  const birth = await page.evaluate(() => lab.step(1));
  expect(birth.byMode[3].active).toBe(128);
  expect(birth.byMode[3].meanY).toBeGreaterThan(7.5);
  expect(birth.byMode[3].meanY).toBeLessThan(8.5);
  expect(birth.byMode[3].meanDiameter).toBeCloseTo(0.12, 5);
  const after = await page.evaluate(() => lab.step(20));
  expect(after.eroded).toBeGreaterThan(0);
  expect(after.composition.sand).toBeGreaterThan(0);
  balanced(after);
  const unchanged = await page.evaluate(async () => {
    lab.params.agentDiameter = 0.8;
    await lab.step(1);
    const m = lab.solver.read(
      lab.solver.metadata[lab.solver.motionIndex],
      64,
      32,
    );
    return m[2];
  });
  expect(unchanged).toBeCloseTo(0.12, 5);
  const wet = await page.evaluate(() => {
    const s = lab.solver,
      v = s.read(s.volume, 1792, 504);
    let wet = 0;
    for (let i = 1; i < v.length; i += 4) wet += v[i];
    return wet;
  });
  expect(wet).toBe(0);
});

test("large rock impacts detach more and create coarse debris; chemical weathering dissolves without sand deposition", async ({
  page,
}) => {
  await harness(page);
  const small = await page.evaluate(async () => {
    await lab.reset(4, { agentDiameter: 15, deposition: 0 });
    return lab.step(5);
  });
  const big = await page.evaluate(async () => {
    await lab.reset(4, { agentDiameter: 150, deposition: 0 });
    return lab.step(5);
  });
  expect(big.eroded).toBeGreaterThan(small.eroded);
  expect(big.composition.coarse).toBeGreaterThan(0);
  expect(big.composition.sand).toBeGreaterThan(0);
  expect(big.composition.coarse / big.carried).toBeLessThan(0.7);
  expect(big.composition.fines / big.carried).toBeGreaterThan(0.08);
  balanced(big);
  const inert = await page.evaluate(async () => {
    await lab.reset(5, { chemicalRate: 0 });
    return lab.step(2);
  });
  expect(inert.eroded).toBe(0);
  const reaction = await page.evaluate(async () => {
    await lab.reset(5, { hardness: 1, chemicalRate: 1 });
    return lab.step(6);
  });
  expect(reaction.eroded).toBeGreaterThan(0);
  expect(reaction.composition.dissolved).toBeCloseTo(reaction.carried, 5);
  expect(reaction.composition.sand).toBe(0);
  expect(reaction.deposited).toBe(0);
  balanced(reaction);
});

test("suspending newborn slots does not repeatedly retire their cargo or change their weathering identity", async ({
  page,
}) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    await lab.reset(0, { particleCount: 256 });
    await lab.step(1);
    const s = lab.solver,
      read = () =>
        Array.from(s.read(s.cargos[s.cargoIndex], 64, 32).slice(128 * 4));
    const before = read(),
      speciesBefore = Array.from(
        s.read(s.species[s.cargoIndex], 64, 32).slice(128 * 4),
      );
    lab.params.particleCount = 128;
    lab.params.sourceMode = 3;
    await lab.step(4);
    return {
      before,
      after: read(),
      speciesBefore,
      speciesAfter: Array.from(
        s.read(s.species[s.cargoIndex], 64, 32).slice(128 * 4),
      ),
      audit: await s.audit(),
    };
  });
  expect(result.after).toEqual(result.before);
  expect(result.speciesAfter).toEqual(result.speciesBefore);
  balanced(result.audit);
});
