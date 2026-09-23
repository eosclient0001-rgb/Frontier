import { test, expect } from "@playwright/test";
async function lab(page, render = false) {
  await page.route("**/src/main.js*", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  await page.evaluate(async (render) => {
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
      terrainAmplitude: 45,
      hydraulicShaping: true,
      hydraulicCell: 0.5,
      hydraulicSamples: 1,
      hydraulicBrickCapacity: 64,
      hydraulicWater: 8,
      sourceMode: 0,
      rainfall: 0,
      wind: 0,
      riverEnabled: false,
      waterLevel: -30,
      timeLapse: 4,
      erosion: 0.65,
      hardness: 0.3,
      deposition: 0.5,
      capacity: 0.6,
      satmapEnabled: false,
    };
    D.configureDomain(p);
    const data = new Float32Array(128 * 80 * 128 * 4);
    for (let z = 0; z < 128; z++)
      for (let y = 0; y < 80; y++)
        for (let x = 0; x < 128; x++)
          data[((z * 80 + y) * 128 + x) * 4] =
            (D.MIN[1] +
              (y + 0.5) * D.CELL[1] -
              100 -
              0.25 * (D.MIN[0] + (x + 0.5) * D.CELL[0])) /
            Math.hypot(1, 0.25);
    let s,
      gl,
      r = null;
    const canvas = document.createElement("canvas");
    const uniforms = new Float32Array([
      4,
      105,
      8,
      0,
      -1,
      99.75,
      0,
      4 / 3,
      256,
      192,
      0,
      0,
      45,
      0,
      0,
      0,
      0.15,
      0,
      0.5,
      0,
      0,
      0,
      0,
      -1,
      1,
      4,
      0,
      0,
    ]);
    if (render) {
      document.body.innerHTML = "";
      canvas.style.cssText = "width:512px;height:384px";
      document.body.append(canvas);
      const { createRenderer } = await import("/src/renderer.js");
      r = await createRenderer(canvas, null, data, () => {}, uniforms, p);
      s = r.solver;
      gl = r.gl;
      canvas.width = 256;
      canvas.height = 192;
      r.showParticles = false;
      r.showSediment = false;
    } else {
      gl = canvas.getContext("webgl2");
      s = new GPUErosion(gl);
      s.upload(data);
      s.configureHydraulics(p);
    }
    const pos = s.read(s.positions[0], ...S.PARTICLE_SIZE),
      v = pos.slice().fill(0),
      m = v.slice(),
      l = v.slice();
    pos.set([0, 100.08, 0, 1]);
    v.set([-3, -0.75, 0, 8]);
    m.set([0, 0.75, 3, 0.08]);
    l.set([750, 0, 0, 100.08]);
    for (const [key, a] of Object.entries({
      positions: pos,
      velocities: v,
      metadata: m,
      lifecycles: l,
    }))
      s.uploadTexture(s[key][0], ...S.PARTICLE_SIZE, a);
    s.uploadTexture(s.rainLedgers[0], 1, 1, new Float32Array([8, 0, 0, 0]));
    window.lab = { s, p, S, D, gl, r, uniforms };
  }, render);
}
test("fine hydraulic exchange removes real sub-metre terrain and carries accepted sediment", async ({
  page,
}) => {
  await lab(page);
  const r = await page.evaluate(async () => {
    const { s, p, S, gl } = lab;
    await s.step(p, 8);
    const a = await s.audit(),
      pos = Array.from(
        s.read(s.positions[s.motionIndex], ...S.PARTICLE_SIZE).slice(0, 4),
      );
    const field = s.fine.snapshot();
    let touched = 0;
    for (let i = 1; i < field.values.length; i += 4)
      if (field.values[i] > 0) touched++;
    return { audit: a, pos, touched, error: gl.getError() };
  });
  console.log("Fine hydraulic result", r);
  expect(r.audit.eroded).toBeGreaterThan(0.01);
  expect(r.audit.carried).toBeGreaterThan(0);
  expect(r.touched).toBeGreaterThan(5);
  expect(r.pos[0]).toBeLessThan(-1);
  expect(Math.abs(r.audit.ledgerError)).toBeLessThan(0.0001);
  expect(Math.abs(r.audit.massError)).toBeLessThan(0.001);
  expect(r.error).toBe(0);
});

test("live hydraulic workflow starts with the refined field enabled and reports the real kernel width", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(
    () => window.frontier?.diagnostics.ready,
    {},
    { timeout: 120000 },
  );
  await page.locator("[data-tab=erosion]").click();
  await expect(page.locator("#erosion-workflow")).toHaveValue("hydraulic");
  await expect(page.locator("#erosion-resolution-status")).toContainText(
    "0.5 m XYZ cells",
  );
  await expect(page.locator("#erosion-resolution-status")).toContainText(
    "1.50 m kernel width",
  );
  await page.locator("#step").click();
  await page.waitForFunction(
    () => frontier.iterations === 1,
    {},
    { timeout: 120000 },
  );
  const r = await page.evaluate(async () => ({
    diagnostics: frontier.diagnostics,
    audit: await frontier.auditErosion(),
  }));
  expect(r.diagnostics.erosionError).toBeNull();
  expect(r.audit.hydraulicShaping).toBe(true);
  expect(r.audit.refinement.cellMetres).toBe(0.5);
});

test("the viewport and GPU pick use the eroded fine field; checkpoint and export preserve it", async ({
  page,
}) => {
  await lab(page, true);
  const r = await page.evaluate(async () => {
    const { s, p, gl, r, uniforms } = lab;
    const capture = () => {
      r.draw(uniforms);
      const data = new Uint8Array(256 * 192 * 4);
      gl.readPixels(0, 0, 256, 192, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return data;
    };
    const before = capture(),
      pickBefore = await s.pick([-1, 110, 0], [0, -1, 0]);
    await s.step(p, 16);
    const after = capture(),
      pickAfter = await s.pick([-1, 110, 0], [0, -1, 0]);
    let pixels = 0;
    for (let i = 0; i < after.length; i += 4)
      if (
        Math.abs(before[i] - after[i]) +
          Math.abs(before[i + 1] - after[i + 1]) +
          Math.abs(before[i + 2] - after[i + 2]) >
        6
      )
        pixels++;
    const snapshot = await s.checkpoint();
    s.restoreCheckpoint(snapshot);
    const restored = await s.checkpoint();
    const { encodeScene } = await import("/src/field.js");
    const bytes = await encodeScene(
      await s.readVolume(),
      p,
      {},
      s.tick,
      s.fine.snapshot(),
    ).arrayBuffer();
    const length = new DataView(bytes).getUint32(4, true),
      header = JSON.parse(
        new TextDecoder().decode(new Uint8Array(bytes, 8, length)),
      );
    const section = header.refinement.sections.find((s) => s.name === "values"),
      exported = new Float32Array(
        bytes.slice(
          8 + length + section.offset,
          8 + length + section.offset + section.length,
        ),
      );
    return {
      pixels,
      pickBefore,
      pickAfter,
      version: header.version,
      cell: header.refinement.layout.cell,
      exact:
        snapshot.fine.values.every((v, i) => v === restored.fine.values[i]) &&
        snapshot.fine.materials.every(
          (v, i) => v === restored.fine.materials[i],
        ),
      exportExact: snapshot.fine.values.every((v, i) => v === exported[i]),
      error: gl.getError(),
    };
  });
  console.log("Fine visual/pick/export proof", r);
  expect(r.pixels).toBeGreaterThan(10);
  expect(r.pickAfter[1]).toBeLessThan(r.pickBefore[1] - 0.005);
  expect(r.version).toBe(3);
  expect(r.cell).toBe(0.5);
  expect(r.exact && r.exportExact).toBe(true);
  expect(r.error).toBe(0);
  await page
    .locator("canvas")
    .screenshot({ path: "artifacts/fine-hydraulic-closeup.png" });
});

test("coarse sculpting elsewhere preserves existing fine cuts", async ({
  page,
}) => {
  await lab(page);
  const r = await page.evaluate(async () => {
    const { s, p } = lab;
    await s.step(p, 8);
    const before = s.fine.snapshot();
    await s.sculpt([-400, 0, -400], 8, "carve", p);
    const after = s.fine.snapshot();
    return {
      exact: before.values.every((v, i) => v === after.values[i]),
      audit: await s.audit(),
    };
  });
  expect(r.exact).toBe(true);
  expect(r.audit.refinement.removed).toBeGreaterThan(0);
});

test("zero strength leaves the surface unchanged; saturated refinement has no coarse-brush fallback", async ({
  page,
}) => {
  await lab(page);
  const r = await page.evaluate(async () => {
    const { s, p, S, gl } = lab;
    p.erosion = 0;
    const before = await s.pick([-1, 110, 0], [0, -1, 0]);
    await s.step(p, 8);
    const after = await s.pick([-1, 110, 0], [0, -1, 0]),
      zero = await s.audit();
    const coarse = await s.readVolume();
    s.upload(coarse);
    p.hydraulicBrickCapacity = 16;
    p.hydraulicSamples = 16;
    s.configureHydraulics(p);
    let pos = s.read(s.positions[0], ...S.PARTICLE_SIZE),
      vel = pos.slice().fill(0),
      meta = vel.slice(),
      life = vel.slice();
    for (let i = 0; i < 16; i++) {
      const x = -240 + i * 30,
        k = i * 4;
      pos.set([x, 100 + 0.25 * x + 0.08, 0, 1], k);
      vel.set([-3, -0.75, 0, 8], k);
      meta.set([0, 0.75, 3, 0.08], k);
      life.set([750, 0, 0, 100 + 0.25 * x + 0.08], k);
    }
    for (const [key, data] of Object.entries({
      positions: pos,
      velocities: vel,
      metadata: meta,
      lifecycles: life,
    }))
      s.uploadTexture(s[key][0], ...S.PARTICLE_SIZE, data);
    await s.step(p, 8);
    const filled = s.fine.audit();
    pos = s.read(s.positions[s.motionIndex], ...S.PARTICLE_SIZE);
    for (let i = 3; i < pos.length; i += 4) pos[i] = -1;
    pos.set([350, 187.58, 350, 1]);
    s.uploadTexture(s.positions[s.motionIndex], ...S.PARTICLE_SIZE, pos);
    p.hydraulicSamples = 1;
    p.erosion = 0.65;
    const initial = s.fine.snapshot();
    await s.step(p, 4);
    const final = s.fine.snapshot(),
      audit = await s.audit(),
      base = await s.readVolume();
    return {
      before,
      after,
      zero,
      filled,
      audit,
      exact: initial.values.every((v, i) => v === final.values[i]),
      baseUnchanged: base.every((v, i) => v === coarse[i]),
      error: gl.getError(),
    };
  });
  expect(Math.abs(r.after[1] - r.before[1])).toBeLessThan(0.0001);
  expect(r.zero.refinement.removed).toBe(0);
  expect(r.filled.bricks).toBe(16);
  expect(r.audit.refinement.missingContacts).toBeGreaterThan(0);
  expect(r.exact && r.baseUnchanged).toBe(true);
  expect(r.error).toBe(0);
});

test("fine sediment deposits more when flow is slow, with accepted volume returned to the real field", async ({
  page,
}) => {
  await lab(page);
  const rows = await page.evaluate(async () => {
    const { s, p, S } = lab,
      base = await s.readVolume(),
      rows = [];
    for (const speed of [0, 6]) {
      s.upload(base);
      s.configureHydraulics(p);
      p.erosion = 0;
      const pos = s.read(s.positions[0], ...S.PARTICLE_SIZE),
        v = pos.slice().fill(0),
        m = v.slice(),
        l = v.slice(),
        cargo = v.slice(),
        species = v.slice();
      pos.set([0, 100.08, 0, 1]);
      v.set([-speed, -speed * 0.25, 0, 8]);
      m.set([0, 0.75, 3, 0.08]);
      l.set([750, 0, 0, 100.08]);
      cargo.set([0.2, 0.2, 0, 0]);
      species.set([0.13, 0.06, 0.01, 0]);
      for (const [key, data] of Object.entries({
        positions: pos,
        velocities: v,
        metadata: m,
        lifecycles: l,
        cargos: cargo,
        species,
      }))
        s.uploadTexture(s[key][0], ...S.PARTICLE_SIZE, data);
      s.initialMass += 0.2;
      await s.step(p, 8);
      rows.push(await s.audit());
    }
    return rows;
  });
  console.log(
    "Fine deposition: slow / fast",
    rows.map((r) => ({
      deposited: r.deposited,
      fine: r.refinement.deposited,
      carried: r.carried,
      massError: r.massError,
    })),
  );
  expect(rows[0].deposited).toBeGreaterThan(rows[1].deposited * 2);
  for (const r of rows) {
    expect(r.refinement.deposited).toBeGreaterThan(0);
    expect(Math.abs(r.deposited - r.refinement.deposited)).toBeLessThan(
      0.00001,
    );
    expect(Math.abs(r.ledgerError)).toBeLessThan(0.00001);
    expect(Math.abs(r.massError)).toBeLessThan(0.001);
  }
});

test("authored XYZ water feeds repeat hydraulic erosion, with no steady-state CPU transfers", async ({
  page,
}) => {
  test.setTimeout(240000);
  await lab(page, true);
  const result = await page.evaluate(async () => {
    const { s, p, gl, r, uniforms } = lab,
      { makePath } = await import("/src/splines.js");
    const base = await s.readVolume();
    Object.assign(p, {
      hydraulicSamples: 64,
      hydraulicBrickCapacity: 256,
      sourceMode: 2,
      rainfall: 0.8,
      riverEnabled: true,
      sceneObjects: [
        {
          ...makePath("proof-route", "water"),
          width: 2.5,
          speed: 3,
          points: [
            [15, 104, 0],
            [-15, 96.5, 0],
          ],
        },
      ],
    });
    s.upload(base);
    s.configureHydraulics(p);
    const before = await s.pick([14, 114, 0], [0, -1, 0]);
    await s.step(p, 4);
    let reads = 0,
      uploads = 0,
      allocations = 0;
    const read = gl.readPixels.bind(gl),
      upload = gl.texSubImage2D.bind(gl),
      allocate = gl.texStorage2D.bind(gl);
    gl.readPixels = (...a) => {
      reads++;
      return read(...a);
    };
    gl.texSubImage2D = (...a) => {
      uploads++;
      return upload(...a);
    };
    gl.texStorage2D = (...a) => {
      allocations++;
      return allocate(...a);
    };
    await s.step(p, 60);
    gl.readPixels = read;
    gl.texSubImage2D = upload;
    gl.texStorage2D = allocate;
    const after = await s.pick([14, 114, 0], [0, -1, 0]),
      audit = await s.audit();
    uniforms.set([18, 110, 16, 0, 8, 102, 0, 4 / 3], 0);
    r.draw(uniforms);
    return { before, after, audit, reads, uploads, allocations };
  });
  console.log("Authored hydraulic channel", result);
  expect(result.audit.refinement.removed).toBeGreaterThan(0.2);
  expect(result.after[1]).toBeLessThan(result.before[1] - 0.03);
  expect(Math.abs(result.audit.ledgerError)).toBeLessThan(0.001);
  expect(Math.abs(result.audit.massError)).toBeLessThan(0.005);
  expect(Math.abs(result.audit.rainWater.balanceError)).toBeLessThan(0.001);
  expect(result.reads + result.uploads + result.allocations).toBe(0);
  await page
    .locator("canvas")
    .screenshot({ path: "artifacts/hydraulic-channel-proof.png" });
});

test('switching to the weather study regenerates explicitly and leaves the renderer usable',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>window.frontier?.diagnostics.ready,{}, {timeout:120000});
 await page.locator('[data-tab=erosion]').click();page.on('dialog',d=>d.accept());
 await page.locator('#erosion-workflow').selectOption('weather');
 await page.waitForFunction(()=>frontier.diagnostics.ready&&!frontier.diagnostics.rebuilding&&!frontier.settings.hydraulicShaping,{}, {timeout:120000});
 await expect(page.locator('#erosion-resolution-status')).toContainText('weather workflow uses the coarse base grid');
 await page.locator('#step').click();await page.waitForFunction(()=>frontier.iterations===1,{}, {timeout:120000});
 const r=await page.evaluate(async()=>({audit:await frontier.auditErosion(),diagnostics:frontier.diagnostics}));
 expect(r.audit.refinement).toBeNull();expect(r.audit.rainWater.admitted).toBeGreaterThan(0);expect(r.diagnostics.lastError).toBeNull();
});

test('split GPU motion matches combined motion for births, transport, retirement and all source modes', async ({ page }) => {
  await lab(page);
  const result = await page.evaluate(async () => {
    const { s, p, S } = lab;
    const { program } = await import('/src/gpu-erosion.js');
    // Produce genuine fine contact geometry first, not only a coarse plane.
    await s.step(p, 8);
    s.programs.motionReference = program(s.gl, S.fullscreenVertex, S.motionFragment, 'Test-only combined motion');
    const targets = [s.positions[1], s.velocities[1], s.metadata[1], s.impacts];
    const positions = new Float32Array(256), velocities = new Float32Array(256),
      metadata = new Float32Array(256), lifecycle = new Float32Array(256), species = new Float32Array(256);
    for (let i = 0; i < 64; i++) {
      positions.set([-3+i*.1, 99.32, 0, i < 4 || i >= 10 ? -1 : 1], i*4);
      velocities.set([-.5, -1, .1, 1], i*4);
      metadata.set([0, .75, 3, i === 5 ? -1.08 : .08], i*4);
      lifecycle.set([100, 0, i === 6 ? 1 : i === 7 ? 3 : 0, 0], i*4);
      species.set([.01, .002, .001, 0], i*4);
    }
    positions[8*4] = s.domain.max[0] + 10; // retire, never rebirth this tick
    lifecycle[9*4] = 0; // captured lifetime ends this tick
    const inputs = { terrain: s.volume, flowPaths: s.flowPaths.texture,
      positions: s.positions[0], velocities: s.velocities[0], metadata: s.metadata[0],
      lifecycle: s.lifecycles[0], species: s.species[0] };
    const sentinel = new Float32Array(256).fill(999);
    let maxDifference = 0, births = 0, cases = 0;
    for (const shaping of [0, 1]) for (const mode of [0, 1, 2, 3, 4, 5]) {
      s.flowPaths.update({ sceneObjects: [{ type: 'water', visible: true, width: 4, speed: 2,
        points: [[-3, 100, 0], [-10, 98, 0]] }] });
      for (let i = 0; i < 64; i++) metadata[i*4] = mode;
      for (const [texture, data] of [[inputs.positions, positions], [inputs.velocities, velocities],
        [inputs.metadata, metadata], [inputs.lifecycle, lifecycle], [inputs.species, species]])
        s.uploadTexture(texture, 64, 1, data);
      const values = {
        hydraulicShaping: shaping, physics: [.125, 1, .08, .1], config: [.75, .15, 10, mode],
        environment: [-30, 0, 4821, 3], weather: [3, .45, .6, 1], river: [2, 4, .6, 0],
        windField: [5, 105, 4, 0], emitter: [-3, 0, 2, 2],
        lifeSettings: [30, .002, 10, .1], runoffSettings: [30, .001, .2, 0],
        hydraulic: [.002, .25, .01, 1],
      };
      const run = async name => {
        for (const target of targets) s.uploadTexture(target, 64, 1, sentinel);
        s.pass(name, targets, 64, 1, inputs, values);
        await s.complete();
        return targets.map(t => Array.from(s.read(t, 64, 1)));
      };
      const combined = await run('motionReference'), split = await run('motion');
      for (let t = 0; t < 4; t++) for (let i = 0; i < 256; i++) {
        if (!Number.isFinite(split[t][i]) || !Number.isFinite(combined[t][i]))
          throw new Error(`Nonfinite motion output: ${shaping}/${mode}/${t}/${i}`);
        maxDifference = Math.max(maxDifference, Math.abs(split[t][i] - combined[t][i]));
      }
      for (let i = 0; i < 4; i++) if (split[0][i*4+3] >= 0) {
        births++;
        if (split[0][i*4+3] !== 0) throw new Error('Newborn was integrated twice');
      }
      if (split[0][8*4+3] !== -1) throw new Error('Retired particle was reborn this tick');
      cases++;
    }
    return { maxDifference, births, cases, glError: s.gl.getError() };
  });
  console.log('Split/combined GPU motion equivalence', result);
  expect(result.cases).toBe(12);
  expect(result.births).toBeGreaterThan(0);
  expect(result.maxDifference).toBeLessThan(0.00002);
  expect(result.glError).toBe(0);
});

test('split viewport matches the frozen monolithic fine-XYZ viewport, including water, Satmaps and fracture overlays', async ({ page }) => {
  await lab(page, true);
  const result = await page.evaluate(async () => {
    const { r, s, p, gl, uniforms } = lab;
    const response = await fetch('/tests/fixtures/viewport-monolithic.glsl');
    if (!response.ok) throw new Error('Missing frozen viewport fixture');
    const source = await response.text();
    const { buildProgram } = await import('/src/gl-resources.js');
    const { vertexGLSL } = await import('/src/shaders.js');
    const { makePath } = await import('/src/splines.js');
    const reference = buildProgram(gl, vertexGLSL,
      s.linear ? source.replace('#version 300 es', '#version 300 es\n#define LINEAR_VOLUME') : source,
      'Test only / frozen monolithic viewport').handle;
    const locations = ['eye','target','viewport','light','surface','brush','extra'].map(n => gl.getUniformLocation(reference,n));
    const read = () => {
      const pixels = new Uint8Array(r.canvas.width*r.canvas.height*4);
      gl.readPixels(0,0,r.canvas.width,r.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      return pixels;
    };
    const cases=[];
    const compare = name => {
      r.draw(uniforms); const split=read();
      r.drawPass(uniforms,reference,locations); const old=read();
      let max=0, changed=0, overTwo=0;
      for(let i=0;i<old.length;i++) { const d=Math.abs(old[i]-split[i]); max=Math.max(max,d); changed+=d>0; overTwo+=d>2; }
      cases.push({name,max,changed,overTwo,components:old.length});
      return split;
    };
    compare('unmodified fine field');
    await s.step(p,16); compare('eroded fine field');
    p.satmapEnabled=true;
    for(let palette=0;palette<4;palette++){p.satmapPalette=palette;compare(`palette ${palette}`);}
    for(let view=1;view<=6;view++){p.satmapView=view;compare(`diagnostic ${view}`);}
    p.satmapView=0; uniforms[17]=.4; uniforms.set([-1,99.75,0,2],20);
    r.fractureGuides=[{center:[-1,99.75,0],u:[1,0,0],v:[0,1,0],halfSpan:5,halfDepth:5,width:.1}];
    const pattern={sites:[[-3,99,-2],[0,100,2],[3,101,0]],brushes:[{a:[-5,98,-2],b:[5,102,2],radius:5}],gap:.08,separate:false,intact:true};
    r.setCellPatterns(pattern,pattern); compare('brush + plane + both Voronoi overlays');
    uniforms[23]=-1; r.fractureGuides=[]; r.setCellPatterns(null,null);
    const dry=compare('dry rough material');
    p.sceneObjects=[{...makePath('viewport-test-water','water'),width:8,speed:3.2,points:[[-5,100.2,-12],[-1,100.2,0],[2,100.2,12]]}];
    p.riverEnabled=true; uniforms[15]=1;
    const wet=compare('water refraction + reflection');
    let waterPixels=0;
    for(let i=0;i<wet.length;i+=4) if(Math.abs(wet[i]-dry[i])+Math.abs(wet[i+1]-dry[i+1])+Math.abs(wet[i+2]-dry[i+2])>6)waterPixels++;
    uniforms[3]=3.5;compare('animated water');
    p.showTerrain=false;compare('hidden terrain, water and floor');
    uniforms.set([4,105,8],0);uniforms.set([4,120,8.1],4);compare('sky only');
    p.showTerrain=true;
    for(const [w,h] of [[128,192],[320,180],[256,192]]){
      r.canvas.width=w;r.canvas.height=h;uniforms[7]=w/h;uniforms[8]=w;uniforms[9]=h;
      uniforms.set([-1,99.75,0],4);compare(`resize ${w}x${h}`);
    }
    const errors=[gl.getError()]; const target=r.sceneTarget;
    const originalTexture=target.texture;
    let allocations=0;const allocate=gl.texStorage2D;
    gl.texStorage2D=function(...args){allocations++;return allocate.apply(this,args);};
    r.draw(uniforms);r.draw(uniforms);gl.texStorage2D=allocate;
    errors.push(gl.getError());
    gl.deleteProgram(reference);r.dispose();r.dispose();
    return {cases,waterPixels,allocations,disposed:!gl.isTexture(originalTexture)&&!target.framebuffer,errors};
  });
  console.log('Split viewport pixel/reference proof',JSON.stringify(result));
  expect(result.waterPixels).toBeGreaterThan(100);
  for(const row of result.cases) {
    // Preserve 8-bit output within rounding; tolerate only a tiny fraction of
    // derivative-dependent edge pixels after changing shader control flow.
    expect(row.overTwo/row.components,row.name).toBeLessThan(0.001);
  }
  expect(result.allocations).toBe(0);
  expect(result.disposed).toBe(true);
  expect(result.errors).toEqual([0,0]);
});

test('dense hydraulic counts create real fine-exchanging particles, not decorative markers, within the existing pool', async ({ page }) => {
  test.setTimeout(300000);
  await lab(page);
  const result = await page.evaluate(async () => {
    const { s, p, S, gl } = lab;
    const base = await s.readVolume();
    Object.assign(p, { hydraulicBrickCapacity:4096, rainfall:.55 });
    const rows=[];
    for(const count of [64,1024]) {
      s.upload(base); p.hydraulicSamples=count; s.configureHydraulics(p);
      await s.step(p,16);
      const audit=await s.audit();
      const cargo=s.read(s.cargos[s.cargoIndex],...S.PARTICLE_SIZE);
      let exchangingExtra=0;
      for(let id=64;id<count;id++) if(cargo[id*4+1]>0)exchangingExtra++;
      rows.push({count,active:audit.active,eroded:audit.eroded,carried:audit.carried,
        source:audit.rainWater.shapingSource,refinement:audit.refinement,
        ledgerError:audit.ledgerError,massError:audit.massError,exchangingExtra,
        waterError:audit.rainWater.balanceError,dt:s.timing.dt});
    }
    const fine=s.fine, positions=s.positions.slice();
    const calls={read:0,upload:0,allocate:0};
    const originals={readPixels:gl.readPixels,texSubImage2D:gl.texSubImage2D,texStorage2D:gl.texStorage2D};
    for(const [method,key] of [['readPixels','read'],['texSubImage2D','upload'],['texStorage2D','allocate']])
      gl[method]=function(...args){calls[key]++;return originals[method].apply(this,args);};
    p.hydraulicSamples=16384; await s.step(p,4);
    for(const [method,fn] of Object.entries(originals))gl[method]=fn;
    const live=s.read(s.positions[s.motionIndex],...S.PARTICLE_SIZE);
    let upperHalfActive=0;
    for(let id=8192;id<16384;id++)if(live[id*4+3]>=0)upperHalfActive++;
    const audit=await s.audit();
    const max={selected:audit.selectedParticles,active:audit.active,upperHalfActive,
      sameStorage:s.fine===fine&&s.positions.every((t,i)=>t===positions[i]),calls,
      refinement:audit.refinement,ledgerError:audit.ledgerError,massError:audit.massError,
      waterError:audit.rainWater.balanceError,error:gl.getError()};
    s.dispose();return {rows,max};
  });
  console.log('Dense hydraulic proof',JSON.stringify(result));
  const [old,dense]=result.rows;
  expect(dense.active).toBeGreaterThan(old.active*8);
  expect(dense.eroded).toBeGreaterThan(old.eroded*4);
  expect(dense.exchangingExtra).toBeGreaterThan(100);
  expect(dense.source).toBeGreaterThan(old.source*8);
  for(const row of result.rows) {
    expect(row.dt).toBeLessThanOrEqual(.125);
    expect(row.refinement.cellMetres).toBe(.5);
    expect(row.refinement.bricks).toBeLessThanOrEqual(4096);
    expect(Math.abs(row.ledgerError)).toBeLessThan(.001);
    expect(Math.abs(row.massError)).toBeLessThan(.005);
    expect(Math.abs(row.waterError)).toBeLessThan(.05);
  }
  expect(result.max.selected).toBe(16384);
  expect(result.max.upperHalfActive).toBeGreaterThan(1000);
  expect(result.max.sameStorage).toBe(true);
  expect(result.max.calls).toEqual({read:0,upload:0,allocate:0});
  expect(result.max.refinement.bricks).toBeLessThanOrEqual(4096);
  expect(Math.abs(result.max.ledgerError)).toBeLessThan(.002);
  expect(Math.abs(result.max.massError)).toBeLessThan(.005);
  expect(Math.abs(result.max.waterError)).toBeLessThan(.05);
  expect(result.max.error).toBe(0);
});

test('hydraulic density control defaults to 1024, reaches 16384 live without regenerating, and discloses draw/storage limits', async ({page}) => {
  await page.goto('/');
  await page.waitForFunction(()=>window.frontier?.diagnostics.ready,null,{timeout:120000});
  await page.locator('[data-tab=erosion]').click();
  const control=page.locator('#hydraulicSamples');
  await expect(control).toHaveValue('1024');
  await expect(control).toHaveAttribute('max','16384');
  await control.fill('16384');await control.dispatchEvent('input');
  await expect(page.locator('#hydraulic-particle-note')).toContainText('all selected slots are simulated');
  await expect(page.locator('#hydraulic-particle-note')).toContainText('unallocated contacts cannot erode');
  await page.locator('#step').click();
  await page.waitForFunction(()=>frontier.iterations===1&&!frontier.diagnostics.editing,null,{timeout:120000});
  const first=await page.evaluate(()=>frontier.auditErosion());
  expect(first.selectedParticles).toBe(16384);
  expect(first.active).toBeGreaterThan(1000);
  expect(first.refinement.cellMetres).toBe(.5);
  await expect(page.locator('#hydraulic-capacity-status')).toContainText('contact footprints complete');
  if (first.refinement.missingContacts > 0)
    await expect(page.locator('#hydraulic-capacity-status')).toContainText('contacts blocked');
  await control.fill('2048');await control.dispatchEvent('input');
  expect(await page.evaluate(()=>frontier.iterations)).toBe(1);
  expect(await page.evaluate(()=>frontier.settings.hydraulicSamples)).toBe(2048);
});
