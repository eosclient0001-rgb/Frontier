import { test, expect } from "@playwright/test";
async function setup(page, capacity = 64, width = 1000) {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  await page.evaluate(
    async ({ capacity, width }) => {
      const D = await import("/src/domain.js");
      const { GPUErosion } = await import("/src/gpu-erosion.js");
      const { SparseSDF } = await import("/src/sparse-sdf.js");
      D.configureDomain({
        worldEnabled: true,
        preset: 4,
        terrainWidth: width,
        terrainLength: width,
        terrainHeight: 240,
      });
      const gl = document.createElement("canvas").getContext("webgl2");
      const base = new GPUErosion(gl);
      const plane = new Float32Array(128 * 80 * 128 * 4);
      for (let z = 0; z < 128; z++)
        for (let y = 0; y < 80; y++)
          for (let x = 0; x < 128; x++)
            plane[((z * 80 + y) * 128 + x) * 4] =
              D.MIN[1] + (y + 0.5) * D.CELL[1] - 100.125;
      base.upload(plane);
      const fine = new SparseSDF(gl, base.volume, D.currentDomain(), {
        capacity,
      });
      const points = fine.texture(256, 256, gl.RGBA32F);
      const data = new Float32Array(256 * 256 * 4);
      for (let i = 3; i < data.length; i += 4) data[i] = -1;
      window.lab = {
        gl,
        base,
        fine,
        points,
        data,
        D,
        set(points) {
          data.fill(0);
          for (let i = 3; i < data.length; i += 4) data[i] = -1;
          points.forEach((p, i) => data.set([...p, 0], i * 4));
          fine.upload(this.points, 256, 256, data);
        },
        refine(count, halo = 0.5) {
          for (let i = 0; i < 4; i++)
            fine.refinePoints(points, 256, 256, count, halo);
        },
      };
    },
    { capacity, width },
  );
}
test("sparse XYZ storage preserves sub-metre cuts at distant world positions, with no per-update CPU transfers", async ({
  page,
}) => {
  await setup(page);
  const r = await page.evaluate(() => {
    const { gl, fine, points } = lab;
    const a = [-301.875, 100.125, 302.125],
      b = [300.125, 100.125, -301.875];
    lab.set([a, b]);
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
    lab.refine(2);
    fine.carveSphere(a, 0.4);
    fine.carveSphere(b, 0.4);
    gl.readPixels = read;
    gl.texSubImage2D = upload;
    gl.texStorage2D = allocate;
    const samples = fine.sample([
      a,
      b,
      [a[0] - 0.75, a[1] - 0.125, a[2]],
      [a[0] + 0.75, a[1] - 0.125, a[2]],
      [a[0], a[1] - 0.75, a[2]],
      [0, 100, 0],
    ]);
    const before = fine.audit();
    fine.carveSphere(a, 0.4);
    fine.carveSphere(b, 0.4);
    const repeated = fine.audit(),
      checkpoint = fine.snapshot();
    fine.reset(lab.base.volume, lab.D.currentDomain());
    fine.restore(checkpoint, lab.base.volume);
    const restored = fine.snapshot();
    return {
      samples,
      before,
      repeated,
      reads,
      uploads,
      allocations,
      exact:
        checkpoint.values.every((v, i) => v === restored.values[i]) &&
        checkpoint.keys.every((v, i) => v === restored.keys[i]),
      error: gl.getError(),
    };
  });
  expect(r.samples[0].refined).toBeGreaterThan(0.35);
  expect(r.samples[1].refined).toBeGreaterThan(0.35);
  for (const s of [r.samples[2], r.samples[3], r.samples[5]])
    expect(Math.abs(s.refined - s.base)).toBeLessThan(0.0001);
  // A cavity changes distance-to-surface below it, without removing that solid.
  expect(r.samples[4].refined).toBeLessThan(-0.2375);
  expect(r.before.removed).toBeGreaterThan(0.01);
  expect(r.before.removed).toBeLessThan(1);
  expect(r.repeated.removed).toBe(r.before.removed); // No overlap double-counting.
  expect(r.before.cellMetres).toBe(0.25);
  expect(r.exact).toBe(true);
  expect(r.reads + r.uploads + r.allocations).toBe(0);
  expect(r.error).toBe(0);
});
test("full refinement pool reports unresolved requests and never evicts or erases earlier cuts", async ({
  page,
}) => {
  await setup(page, 16);
  const r = await page.evaluate(() => {
    const { fine, gl } = lab,
      a = [-301.875, 100.125, 302.125];
    lab.set([a]);
    lab.refine(1);
    fine.carveSphere(a, 0.4);
    const before = fine.sample([a])[0],
      first = fine.audit();
    lab.set(
      Array.from({ length: 128 }, (_, i) => [
        -480.125 + (i % 16) * 55,
        100.125,
        -470.125 + Math.floor(i / 16) * 55,
      ]),
    );
    for (let i = 0; i < 8; i++)
      fine.refinePoints(lab.points, 256, 256, 128, 0.5);
    const status = fine.read(fine.status, 256, 256),
      after = fine.sample([a])[0],
      last = fine.audit();
    let misses = 0;
    for (let i = 0; i < 128; i++) misses += status[i * 4 + 1];
    return { before, after, first, last, misses, error: gl.getError() };
  });
  expect(r.last.bricks).toBe(16);
  expect(r.misses).toBeGreaterThan(0);
  expect(r.after).toEqual(r.before);
  expect(r.last.removed).toBe(r.first.removed);
  expect(r.error).toBe(0);
});
test("GPU allocation decodes the highest request ID exactly without float32 blending", async ({
  page,
}) => {
  await setup(page, 16);
  const r = await page.evaluate(() => {
    const { fine, gl, data, points } = lab;
    data.set([430.125, 100.125, 431.125, 0], 65535 * 4);
    fine.upload(points, 256, 256, data);
    fine.refinePoints(points, 256, 256, 65536, 0);
    const status = fine.read(fine.status, 256, 256);
    return {
      last: Array.from(status.slice(65535 * 4)),
      audit: fine.audit(),
      keys: Array.from(fine.snapshot().keys),
      error: gl.getError(),
    };
  });
  expect(r.last).toEqual([8, 0, 8, 1]);
  expect(r.audit.bricks).toBe(1);
  expect(
    r.keys.some(
      (v, i) =>
        i % 4 === 0 &&
        v === 473 &&
        r.keys[i + 1] === 62 &&
        r.keys[i + 2] === 473 &&
        r.keys[i + 3] === 1,
    ),
  ).toBe(true);
  expect(r.error).toBe(0);
});

test("doubling world dimensions does not enlarge the fine cut; enclosed cavities retain a solid roof", async ({
  page,
}) => {
  const runs = [];
  for (const width of [1000, 2000]) {
    await setup(page, 64, width);
    runs.push(
      await page.evaluate(() => {
        const { fine } = lab,
          a = [25.125, 99.125, 25.125];
        lab.set([a]);
        lab.refine(1);
        fine.carveSphere(a, 0.4);
        return {
          samples: fine.sample([
            a,
            [a[0], 99.875, a[2]],
            [a[0] + 0.75, a[1], a[2]],
          ]),
          audit: fine.audit(),
        };
      }),
    );
  }
  for (const r of runs) {
    expect(r.samples[0].refined).toBeGreaterThan(0.35);
    expect(r.samples[1].refined).toBeLessThan(0); // Solid roof above an enclosed cavity.
    expect(r.samples[2].refined).toBeLessThan(-0.2375);
  }
  expect(Math.abs(runs[0].audit.removed - runs[1].audit.removed)).toBeLessThan(
    0.00001,
  );
});

test("the live UI exposes the connected hydraulic refinement workflow", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.frontier?.diagnostics.ready);
  await page.locator("[data-tab=erosion]").click();
  await expect(page.locator("#erosion-resolution-status")).toContainText(
    "Hydraulic shaping: 0.5 m XYZ cells",
  );
  await expect(page.locator("#erosion-resolution-status")).toContainText(
    "1.50 m kernel width",
  );
  await expect(page.locator("label[for=footprint]")).toContainText(
    "Numerical spread radius",
  );
});
