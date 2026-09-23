import { test, expect } from "@playwright/test";
async function lab(page) {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    const D = await import("/src/domain.js"),
      S = await import("/src/erosion-shaders.js"),
      { GPUErosion } = await import("/src/gpu-erosion.js"),
      { defaults } = await import("/src/field.js");
    const p = {
      ...defaults,
      worldEnabled: true,
      preset: 4,
      terrainWidth: 1000,
      terrainLength: 1000,
      terrainHeight: 240,
      particleCount: 512,
      sourceMode: 0,
      rainfall: 0.55,
      timeLapse: 4,
      erosion: 0,
      deposition: 0,
      wind: 0,
      riverEnabled: false,
      waterLevel: -30,
      rainStallTime: 30,
    };
    D.configureDomain(p);
    const gl = document.createElement("canvas").getContext("webgl2"),
      s = new GPUErosion(gl),
      plane = new Float32Array(128 * 80 * 128 * 4);
    window.lab = {
      D,
      S,
      p,
      gl,
      s,
      reset(slope = 0.25, count = 512, water = 0.5, load = 0.001) {
        for (let z = 0; z < 128; z++)
          for (let y = 0; y < 80; y++)
            for (let x = 0; x < 128; x++) {
              const i = ((z * 80 + y) * 128 + x) * 4,
                wx = D.MIN[0] + (x + 0.5) * D.CELL[0];
              plane[i] =
                (D.MIN[1] + (y + 0.5) * D.CELL[1] - 100 - slope * wx) /
                Math.hypot(1, slope);
            }
        s.upload(plane);
        p.particleCount = count;
        const pos = new Float32Array(S.TOTAL_PARTICLE_SLOTS * 4),
          v = pos.slice(),
          meta = pos.slice(),
          life = pos.slice(),
          cargo = pos.slice(),
          species = pos.slice();
        for (let i = 3; i < pos.length; i += 4) pos[i] = -1;
        for (let i = 0; i < count; i++) {
          const x = count === 1 ? 0 : -100 + (i % 32) * 6,
            z = count === 1 ? 0 : -100 + Math.floor(i / 32) * 6,
            k = i * 4,
            y = 100 + slope * x + 0.08;
          pos.set([x, y, z, 0], k);
          v.set([slope ? -3 : 0, slope ? -0.75 : 0, 0, water], k);
          meta.set([1, 8, 3, 0.08], k);
          life.set([15000, 0, 0, y], k);
          cargo.set([load, load, 0, 0], k);
          species.set([load * 0.65, load * 0.3, load * 0.05, 0], k);
        }
        for (const [name, data] of Object.entries({
          positions: pos,
          velocities: v,
          metadata: meta,
          lifecycles: life,
          cargos: cargo,
          species,
        }))
          s.uploadTexture(s[name][0], ...S.PARTICLE_SIZE, data);
        s.initialMass += count * load;
      },
      sample() {
        const pos = s.read(s.positions[s.motionIndex], ...S.PARTICLE_SIZE),
          hit = s.read(s.impacts, ...S.PARTICLE_SIZE);
        let primary = 0,
          air = 0,
          born = 0;
        for (let i = 0; i < p.particleCount; i++)
          if (pos[i * 4 + 3] >= 0) primary++;
        for (let i = S.RAIN_START; i < S.TOTAL_PARTICLE_SLOTS; i++) {
          if (pos[i * 4 + 3] >= 0) air++;
          if (hit[i * 4 + 3] > 0.5) born++;
        }
        return { primary, air, born };
      },
    };
  });
}

test("rain keeps fresh random birth positions while handing off real runoff at the default carrier budget", async ({
  page,
}) => {
  test.setTimeout(360000);
  await lab(page);
  const r = await page.evaluate(async () => {
    const { s, p, S, gl } = lab;
    lab.reset(0.25, 4096, 0.5, 0);
    s.upload(await s.readVolume());
    p.particleCount = 4096;
    const rows = [],
      firstBirth = new Map();
    let repeated = 0,
      moved = 0,
      exactRepeat = 0;
    let reads = 0,
      allocations = 0,
      fullPasses = 0;
    const read = gl.readPixels.bind(gl),
      alloc = gl.texStorage2D.bind(gl),
      pass = s.pass.bind(s);
    gl.texStorage2D = (...a) => {
      allocations++;
      return alloc(...a);
    };
    s.pass = (...a) => {
      if (a[2] === lab.D.ATLAS_SIZE[0] && a[3] === lab.D.ATLAS_SIZE[1])
        fullPasses++;
      return pass(...a);
    };
    for (let n = 0; n < 10; n++) {
      gl.readPixels = (...a) => {
        reads++;
        return read(...a);
      };
      await s.step(p, 16);
      gl.readPixels = read;
      const pos = s.read(s.positions[s.motionIndex], ...S.PARTICLE_SIZE),
        meta = s.read(s.metadata[s.motionIndex], ...S.PARTICLE_SIZE),
        hits = s.read(s.impacts, ...S.PARTICLE_SIZE);
      let carriers = 0,
        air = 0,
        ground = 0,
        born = 0;
      const xs = new Set();
      for (let i = 0; i < 4096; i++) if (pos[i * 4 + 3] >= 0) carriers++;
      for (let i = S.RAIN_START; i < S.TOTAL_PARTICLE_SLOTS; i++) {
        const k = i * 4;
        if (pos[k + 3] >= 0) {
          if (meta[k + 3] < 0) air++;
          else ground++;
        }
        if (hits[k + 3] > 0.5 && pos[k + 3] >= 0) {
          born++;
          xs.add(pos[k]);
          const previous = firstBirth.get(i);
          if (previous) {
            repeated++;
            const d = Math.hypot(
              pos[k] - previous[0],
              pos[k + 2] - previous[1],
            );
            if (d > 100) moved++;
            if (d === 0) exactRepeat++;
          }
          firstBirth.set(i, [pos[k], pos[k + 2]]);
        }
      }
      rows.push({ carriers, air, ground, born, uniqueX: xs.size });
    }
    s.pass = pass;
    gl.texStorage2D = alloc;
    return {
      rows,
      repeated,
      moved,
      exactRepeat,
      reads,
      allocations,
      fullPasses,
      audit: await s.audit(),
    };
  });
  console.log("Real-rain steady state", r.rows);
  expect(r.rows.slice(3).every((w) => w.air > 500 && w.born > 30)).toBe(true);
  expect(r.rows.at(-1).carriers).toBeGreaterThan(2000);
  expect(r.rows.every((w) => w.uniqueX >= w.born * 0.98)).toBe(true);
  expect(r.repeated).toBeGreaterThan(50);
  expect(r.moved / r.repeated).toBeGreaterThan(0.9);
  expect(r.exactRepeat).toBe(0);
  expect(r.reads).toBe(0);
  expect(r.allocations).toBe(0);
  expect(r.fullPasses).toBe(320);
  expect(r.audit.carried).toBe(0);
});

test("an actual drop cuts the SDF, hands off at the exact landing point, and remains visible as moving runoff", async ({
  page,
}) => {
  await lab(page);
  const r = await page.evaluate(async () => {
    const { s, p, S, gl } = lab;
    lab.reset(0.25, 64, 0.5, 0);
    s.upload(await s.readVolume());
    Object.assign(p, {
      rainfall: 0,
      erosion: 0.8,
      rainSubstrateShear: 1,
      rainSubstrateErodibility: 1,
      hardness: 0.3,
      weatheringRate: 16,
    });
    const pos = s.read(s.positions[0], ...S.PARTICLE_SIZE),
      v = s.read(s.velocities[0], ...S.PARTICLE_SIZE),
      m = s.read(s.metadata[0], ...S.PARTICLE_SIZE),
      l = s.read(s.lifecycles[0], ...S.PARTICLE_SIZE),
      k = S.RAIN_START * 4;
    pos.set([0, 108, 0, 0], k);
    v.set([0, -3.5, 0, 1], k);
    m.set([-1, 8, 3, -1.08], k);
    l.set([200, 0, 0, 108], k);
    for (const [name, data] of Object.entries({
      positions: pos,
      velocities: v,
      metadata: m,
      lifecycles: l,
    }))
      s.uploadTexture(s[name][0], ...S.PARTICLE_SIZE, data);
    const original = s.transferRain.bind(s);
    let handoff = null;
    s.transferRain = () => {
      const hit = s.read(s.impacts, ...S.PARTICLE_SIZE)[k + 1];
      let before = null,
        cargo = null;
      if (hit > 1.5 && !handoff) {
        before = Array.from(
          s
            .read(s.positions[s.motionIndex], ...S.PARTICLE_SIZE)
            .slice(k, k + 4),
        );
        cargo = s.read(s.cargos[s.cargoIndex], ...S.PARTICLE_SIZE)[k];
      }
      original();
      if (before) {
        const proposal = s.read(s.transferProposals, ...S.PARTICLE_SIZE)[k],
          target = Math.abs(proposal) - 1,
          after = s.read(s.positions[s.motionIndex], ...S.PARTICLE_SIZE);
        handoff = {
          before,
          after: Array.from(after.slice(target * 4, target * 4 + 4)),
          target,
          cargo,
          donorAge: after[k + 3],
        };
      }
    };
    const initial = await s.readVolume();
    await s.step(p, 24);
    s.transferRain = original;
    const final = s.read(s.positions[s.motionIndex], ...S.PARTICLE_SIZE),
      volume = await s.readVolume();
    let changed = 0;
    for (let i = 3; i < volume.length; i += 4)
      if (volume[i] < initial[i] - 1e-7) changed++;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    s.rainVisibleUntil = 100;
    const beforeDraw = final.slice();
    s.drawGrains(
      new Float32Array([
        0, 140, 100, 0, 0, 100, 0, 2, 300, 150, 0, 0, 0, 0, -30, 0,
      ]),
    );
    await s.complete();
    const pixels = new Uint8Array(300 * 150 * 4);
    gl.readPixels(0, 0, 300, 150, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 1] > 20 || pixels[i + 2] > 20) colored++;
    const still = s.read(s.positions[s.motionIndex], ...S.PARTICLE_SIZE);
    return {
      handoff,
      changed,
      colored,
      drawDoesNotMove: still.every((v, i) => v === beforeDraw[i]),
      end: handoff
        ? Array.from(final.slice(handoff.target * 4, handoff.target * 4 + 4))
        : null,
      audit: await s.audit(),
    };
  });
  console.log("Physical drop handoff", r);
  expect(r.handoff).not.toBeNull();
  expect(r.handoff.cargo).toBeGreaterThan(0);
  expect(r.handoff.after).toEqual(r.handoff.before);
  expect(r.handoff.donorAge).toBe(-1);
  expect(r.end[3]).toBeGreaterThan(r.handoff.after[3]);
  expect(r.end[0]).toBeLessThan(r.handoff.after[0] - 0.5);
  expect(r.audit.eroded).toBeGreaterThan(r.handoff.cargo);
  expect(r.changed).toBeGreaterThan(0);
  expect(r.colored).toBeGreaterThan(0);
  expect(r.drawDoesNotMove).toBe(true);
  expect(Math.abs(r.audit.ledgerError)).toBeLessThan(0.005);
});

test("local coalescence conserves water, all sediment components and ledger history; a full distant pool cannot delete a drop", async ({
  page,
}) => {
  await lab(page);
  const r = await page.evaluate(async () => {
    const { s, p, S } = lab;
    lab.reset(0.25, 16384, 0.5, 0);
    s.upload(await s.readVolume());
    const pos = s.read(s.positions[0], ...S.PARTICLE_SIZE),
      vel = pos.slice().fill(0),
      meta = vel.slice(),
      life = vel.slice(),
      cargo = vel.slice(),
      species = vel.slice();
    const root = S.RAIN_START - 1,
      primaryDonor = root - 8,
      rainDonor = S.TOTAL_PARTICLE_SLOTS - 1;
    for (const [id, x, water, load] of [
      [primaryDonor, 5, 0.3, 0.1],
      [root, 6, 0.4, 0.2],
      [rainDonor, 5.5, 0.5, 0.3],
    ]) {
      const k = id * 4;
      pos.set([x, 100 + 0.25 * x + 0.08, 0, 1], k);
      vel.set([-3, -0.75, 0, water], k);
      meta.set([id >= S.RAIN_START ? -1 : 0, 8, 3, 0.08], k);
      life.set([1000, 0, 0, pos[k + 1]], k);
      cargo.set([load, load, 0, 0], k);
      species.set([load * 0.6, load * 0.3, load * 0.1, 0], k);
    }
    for (const [name, data] of Object.entries({
      positions: pos,
      velocities: vel,
      metadata: meta,
      lifecycles: life,
      cargos: cargo,
      species,
    }))
      s.uploadTexture(s[name][0], ...S.PARTICLE_SIZE, data);
    s.initialMass += 0.6;
    s.activeCount = p.particleCount;
    const floatBlend = s.floatBlend;
    s.floatBlend = false; // Allocation uses exact R16F MAX claims even without float32 blending.
    s.tick = 7;
    s.transferRain();
    s.tick = 15;
    s.transferRain();
    await s.complete();
    s.floatBlend = floatBlend;
    const a = await s.audit(),
      v = s.read(s.velocities[s.motionIndex], ...S.PARTICLE_SIZE),
      positions = s.read(s.positions[s.motionIndex], ...S.PARTICLE_SIZE);
    const mergedWater = v[root * 4 + 3],
      donorsDead =
        positions[primaryDonor * 4 + 3] < 0 && positions[rainDonor * 4 + 3] < 0;
    const snapshot = await s.checkpoint();
    s.upload(await s.readVolume());
    s.restoreCheckpoint(snapshot);
    const restored = await s.checkpoint();
    const exact = Object.keys(snapshot.fields).every((key) =>
      snapshot.fields[key].every((v, i) => v === restored.fields[key][i]),
    );
    lab.reset(0.25, 16, 0.5, 0);
    const bpos = s.read(s.positions[0], ...S.PARTICLE_SIZE),
      bm = s.read(s.metadata[0], ...S.PARTICLE_SIZE),
      bc = s.read(s.cargos[0], ...S.PARTICLE_SIZE),
      bl = s.read(s.lifecycles[0], ...S.PARTICLE_SIZE),
      bv = s.read(s.velocities[0], ...S.PARTICLE_SIZE),
      bs = s.read(s.species[0], ...S.PARTICLE_SIZE);
    for (let i = 0; i < 16; i++) bm[i * 4] = 3;
    const k = S.RAIN_START * 4;
    bpos.set([300, 175.08, 0, 5], k);
    bm.set([-1, 8, 3, 0.08], k);
    bc.set([0.123, 0.123, 0, 0], k);
    bs.set([0.123, 0, 0, 0], k);
    bl.set([1000, 0, 0, 175.08], k);
    bv.set([-3, -0.75, 0, 1], k);
    for (const [name, data] of Object.entries({
      positions: bpos,
      metadata: bm,
      cargos: bc,
      lifecycles: bl,
      velocities: bv,
      species: bs,
    }))
      s.uploadTexture(s[name][0], ...S.PARTICLE_SIZE, data);
    s.activeCount = p.particleCount;
    s.transferRain();
    await s.complete();
    const blockedPosition = Array.from(
      s.read(s.positions[s.motionIndex], ...S.PARTICLE_SIZE).slice(k, k + 4),
    );
    s.initialMass += 0.123;
    p.rainfall = 0;
    await s.step(p, 2);
    const emissionOff = lab.sample();
    p.sourceMode = 3;
    p.rainfall = 1;
    await s.step(p, 2);
    const sourceChanged = lab.sample();
    const flowingPosition = Array.from(
      s.read(s.positions[s.motionIndex], ...S.PARTICLE_SIZE).slice(k, k + 4),
    );
    return {
      emissionOff,
      sourceChanged,
      flowingPosition,
      a,
      mergedWater,
      donorsDead,
      exact,
      blockedPosition,
      blockedLoad: s.read(s.cargos[s.cargoIndex], ...S.PARTICLE_SIZE)[k],
    };
  });
  expect(r.mergedWater).toBeCloseTo(1.2, 5);
  expect(r.donorsDead).toBe(true);
  expect(r.a.carried).toBeCloseTo(0.6, 5);
  expect(r.a.composition.sand).toBeCloseTo(0.36, 5);
  expect(r.a.composition.fines).toBeCloseTo(0.18, 5);
  expect(r.a.composition.coarse).toBeCloseTo(0.06, 5);
  expect(Math.abs(r.a.ledgerError)).toBeLessThan(0.00001);
  expect(r.exact).toBe(true);
  expect(r.blockedPosition).toEqual([300, Math.fround(175.08), 0, 5]);
  expect(r.blockedLoad).toBeCloseTo(0.123, 6);
  expect(r.emissionOff.born).toBe(0);
  expect(r.sourceChanged.born).toBe(0);
  expect(r.flowingPosition[3]).toBeGreaterThan(5);
  expect(r.flowingPosition[0]).toBeLessThan(300);
});
