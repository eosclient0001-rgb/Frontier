import { test, expect } from "@playwright/test";
test("actual GPU plane cuts separate components; selected-piece deletion and one-edit undo preserve the remaining SDF", async ({
  page,
}) => {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { GPUErosion } = await import("/src/gpu-erosion.js"),
      { SIZE, MIN, CELL } = await import("/src/field.js"),
      { makePlane, selectConnectedChunk } = await import("/src/fractures.js");
    const s = new GPUErosion(
        document.createElement("canvas").getContext("webgl2"),
      ),
      a = new Float32Array(112 * 72 * 112 * 4);
    for (let z = 0; z < 112; z++)
      for (let y = 0; y < 72; y++)
        for (let x = 0; x < 112; x++) {
          const p = [x, y, z].map((v, k) => MIN[k] + (v + 0.5) * CELL[k]),
            q = [
              Math.abs(p[0]) - 6,
              Math.abs(p[1] - 5) - 5,
              Math.abs(p[2]) - 6,
            ],
            d =
              Math.hypot(...q.map((v) => Math.max(0, v))) +
              Math.min(0, Math.max(...q)),
            i = ((z * 72 + y) * 112 + x) * 4;
          a[i] = d;
          a[i + 3] = Math.max(0, Math.min(1, 0.5 - d / 0.64));
        }
    s.upload(a);
    const original = await s.readVolume(),
      whole = selectConnectedChunk(original, [3, 5, 0]).whole;
    const cut = makePlane([0, 0, -8], [0, 12, -8], [0, 0, 1], {
      tilt: 12,
      width: 1.2,
    });
    await s.saveFractureUndo();
    await s.cutPlanes([cut]);
    const sliced = await s.readVolume(),
      part = selectConnectedChunk(sliced, [3, 5, 0]);
    await s.undoFracture();
    const restored = await s.readVolume(),
      cutUndoExact = restored.every((v, i) => v === original[i]);
    await s.cutPlanes([cut]);
    await s.saveFractureUndo();
    s.setChunkSelection(part.mask);
    await s.deleteChunk();
    const removed = await s.readVolume();
    let badRemoved = 0,
      badKept = 0;
    for (let i = 0; i < part.mask.length; i++) {
      if (part.mask[i] === 255 && removed[i * 4] <= 0) badRemoved++;
      if (
        !part.mask[i] &&
        sliced[i * 4] < 0 &&
        removed[i * 4 + 3] !== sliced[i * 4 + 3]
      )
        badKept++;
    }
    await s.undoFracture();
    const final = await s.readVolume(),
      deleteUndoExact = final.every((v, i) => v === sliced[i]);
    const detail = makePlane(cut.a, cut.b, cut.view, {
      detail: true,
      width: 0.006,
    });
    await s.cutPlanes([detail]);
    const hairline = await s.readVolume();
    return {
      whole,
      split: !part.whole,
      fraction: part.fraction,
      cutUndoExact,
      deleteUndoExact,
      badRemoved,
      badKept,
      hairlineUnchanged: hairline.every((v, i) => v === final[i]),
      error: s.gl.getError(),
      audit: await s.audit(),
    };
  });
  expect(result.whole).toBe(true);
  expect(result.split).toBe(true);
  expect(result.fraction).toBeGreaterThan(0.2);
  expect(result.fraction).toBeLessThan(0.8);
  expect(result.cutUndoExact).toBe(true);
  expect(result.deleteUndoExact).toBe(true);
  expect(result.badRemoved).toBe(0);
  expect(result.badKept).toBe(0);
  expect(result.hairlineUnchanged).toBe(true);
  expect(result.error).toBe(0);
  expect(result.audit.massError).toBeNull();
});

test("painted cell-fracture UI previews Voronoi cells, fractures rock, and subtracts a clicked fragment", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  await page.locator("#inspector-switch").click();
  await page.locator('[data-tab="fracture"]').click();
  await page.locator("#fracture-paint").click();
  const r = await page.locator("#scene").boundingBox();
  await page.mouse.move(r.x + r.width * 0.42, r.y + r.height * 0.46);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.34, r.y + r.height * 0.59, {
    steps: 12,
  });
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      frontier.fractures.stamps.length >= 2 &&
      frontier.fractures.preview?.sites.length > 3,
  );
  await expect(page.locator("#fracture-apply")).toBeEnabled();
  const initial = await page.evaluate(() => frontier.fractures.preview.sites);
  await page.locator("#fracture-reroll").click();
  expect(
    await page.evaluate(() => frontier.fractures.preview.sites),
  ).not.toEqual(initial);
  await page.screenshot({ path: "artifacts/voronoi-painted-preview.png" });
  await page.evaluate(
    async () => (window.beforeFracture = await frontier.readVolume()),
  );
  await page.locator("#fracture-kind").selectOption("detail");
  await page.locator("#fracture-apply").click();
  await page.waitForFunction(
    () => !!frontier.fractures.detail && !frontier.fractures.preview,
  );
  expect(
    await page.evaluate(async () => {
      const v = await frontier.readVolume();
      return v.every((x, i) => x === beforeFracture[i]);
    }),
  ).toBe(true);
  await page.locator("#fracture-undo").click();
  await page.waitForFunction(
    () => !!frontier.fractures.preview && !frontier.fractures.detail,
  );
  await page.locator("#fracture-kind").selectOption("solid");
  await page.locator("#fracture-separate").check();
  await page.locator("#fracture-apply").click();
  await page.waitForFunction(
    () => !!frontier.fractures.lastApplied && !frontier.fractures.preview,
  );
  expect(
    await page.evaluate(async () => {
      const v = await frontier.readVolume();
      return v.some((x, i) => i % 4 === 0 && x !== beforeFracture[i]);
    }),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/voronoi-fractured.png" });
  // Pick the remaining rock near the painted front wall, not an arbitrary plane side.
  await page.locator("#fracture-select").click();
  await page.mouse.click(r.x + r.width * 0.42, r.y + r.height * 0.46);
  await page.waitForFunction(() => !!frontier.fractures.selection);
  const selected = await page.evaluate(() => frontier.fractures.selection);
  expect(selected.whole).toBe(false);
  if (selected.fraction > 0.65) await page.locator("#fracture-large").check();
  await page.evaluate(async () => {
    const v = await frontier.readVolume();
    window.oldSolid = v.reduce((a, b, i) => a + (i % 4 === 3 ? b : 0), 0);
  });
  await page.locator("#fracture-delete").click();
  await page.waitForFunction(
    () => !frontier.fractures.selection && frontier.fractures.canUndo,
  );
  expect(
    await page.evaluate(async () => {
      const v = await frontier.readVolume();
      return oldSolid - v.reduce((a, b, i) => a + (i % 4 === 3 ? b : 0), 0);
    }),
  ).toBeGreaterThan(1);
  await page.screenshot({ path: "artifacts/voronoi-chunk-removed.png" });
  await page.locator("#inspector-switch").click();
  await page.locator("[data-tab=erosion]").click();
  await page.locator("#step").click();
  await page.waitForFunction(() => frontier.iterations === 1);
  expect(await page.evaluate(() => frontier.fractures.canUndo)).toBe(false);
  await page.setViewportSize({ width: 650, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    650,
  );
  expect(errors).toEqual([]);
});

test("GPU Voronoi subtraction makes multiple disconnected cell fragments, leaves unpainted rock unchanged and does not read back during the cut", async ({
  page,
}) => {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  const report = await page.evaluate(async () => {
    const { GPUErosion } = await import("/src/gpu-erosion.js"),
      { SIZE, MIN, CELL } = await import("/src/field.js"),
      { generateCellPattern, regionDistance, cellAt } =
        await import("/src/cell-fracture.js");
    const gl = document.createElement("canvas").getContext("webgl2"),
      s = new GPUErosion(gl),
      N = 112 * 72 * 112,
      a = new Float32Array(N * 4);
    const world = (i) => {
      const x = i % 112,
        y = Math.floor(i / 112) % 72,
        z = Math.floor(i / (112 * 72));
      return [x, y, z].map((v, k) => MIN[k] + (v + 0.5) * CELL[k]);
    };
    for (let i = 0; i < N; i++) {
      const p = world(i),
        q = [Math.abs(p[0]) - 8, Math.abs(p[1] - 6) - 6, Math.abs(p[2]) - 7],
        d =
          Math.hypot(...q.map((v) => Math.max(0, v))) +
          Math.min(0, Math.max(...q));
      a[i * 4] = d;
      a[i * 4 + 3] = Math.max(0, Math.min(1, 0.5 - d / 0.64));
    }
    s.upload(a);
    const before = await s.readVolume();
    const pattern = generateCellPattern(
      [{ point: [0, 6, 7], view: [0, 0, -1], radius: 6 }],
      { size: 3.5, depth: 14, gap: 0.8, seed: 24 },
    );
    await s.saveFractureUndo();
    let reads = 0;
    const read = gl.readPixels.bind(gl);
    gl.readPixels = (...args) => {
      reads++;
      return read(...args);
    };
    await s.fractureCells(pattern);
    const during = reads;
    const after = await s.readVolume();
    let outsideChanged = 0,
      finite = true;
    for (let i = 0; i < N; i++) {
      if (
        !Number.isFinite(after[i * 4]) ||
        after[i * 4 + 3] < 0 ||
        after[i * 4 + 3] > 1
      )
        finite = false;
      if (
        regionDistance(world(i), pattern.brushes) > pattern.gap * 0.5 &&
        after[i * 4] !== before[i * 4]
      )
        outsideChanged++;
    }
    // Independently count 26-connected bodies, checking interior bodies stay in
    // a single Voronoi cell. The intact outside body is deliberately excluded.
    const visited = new Uint8Array(N),
      queue = new Uint32Array(N);
    let fragments = 0,
      mixedCells = 0;
    for (let i = 0; i < N; i++) {
      if (visited[i] || after[i * 4] >= 0) continue;
      let head = 0,
        tail = 1,
        inside = true;
      queue[0] = i;
      visited[i] = 1;
      const cells = new Set();
      while (head < tail) {
        const j = queue[head++],
          x = j % 112,
          y = Math.floor(j / 112) % 72,
          z = Math.floor(j / (112 * 72)),
          p = world(j);
        if (regionDistance(p, pattern.brushes) >= 0) inside = false;
        else cells.add(cellAt(p, pattern.sites).index);
        for (let dz = -1; dz <= 1; dz++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx,
                yy = y + dy,
                zz = z + dz;
              if (
                xx < 0 ||
                xx >= 112 ||
                yy < 0 ||
                yy >= 72 ||
                zz < 0 ||
                zz >= 112
              )
                continue;
              const k = (zz * 72 + yy) * 112 + xx;
              if (!visited[k] && after[k * 4] < 0) {
                visited[k] = 1;
                queue[tail++] = k;
              }
            }
      }
      if (inside && tail > 20) {
        fragments++;
        if (cells.size !== 1) mixedCells++;
      }
    }
    await s.undoFracture();
    const restored = await s.readVolume();
    return {
      sites: pattern.sites.length,
      fragments,
      mixedCells,
      outsideChanged,
      finite,
      during,
      undoExact: restored.every((v, i) => v === before[i]),
    };
  });
  expect(report.sites).toBeGreaterThan(5);
  expect(report.fragments).toBeGreaterThan(4);
  expect(report.mixedCells).toBe(0);
  expect(report.outsideChanged).toBe(0);
  expect(report.finite).toBe(true);
  expect(report.during).toBe(0);
  expect(report.undoExact).toBe(true);
});
