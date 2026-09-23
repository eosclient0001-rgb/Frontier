import { test, expect } from "@playwright/test";

test("default startup does not access WebGPU, even if it is broken", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.webgpuAccesses = 0;
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      get() {
        window.webgpuAccesses++;
        throw new Error("WebGPU must not be probed");
      },
    });
  });
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  expect(await page.evaluate(() => window.webgpuAccesses)).toBe(0);
  expect(await page.evaluate(() => frontier.backend)).toBe("WebGL2");
  expect(await page.evaluate(() => frontier.diagnostics.frameHealth.ok)).toBe(
    true,
  );
  await expect(page.locator("#renderer-info")).toHaveText("WebGL2 ✓");
  await expect(page.locator("#loading")).toBeHidden();
});

test("blank WebGL2 output shows persistent recovery, not an active white canvas", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const source = WebGL2RenderingContext.prototype.shaderSource;
    WebGL2RenderingContext.prototype.shaderSource = function (shader, code) {
      return source.call(
        this,
        shader,
        code.replace(
          "fragColor=vec4(color+dither,1);",
          "fragColor=vec4(clamp(color+dither+vec3(100),vec3(1),vec3(1)),1);",
        ),
      );
    };
  });
  await page.goto("/");
  await expect(page.locator("#loading>span")).toContainText(
    "blank or invalid",
    { timeout: 60000 },
  );
  await expect(page.locator("#renderer-label")).toHaveText(
    "Graphics unavailable",
  );
  await expect(
    page.locator("#render-recovery .compatibility-link"),
  ).toBeVisible();
  await page.locator("#error-details").click();
  await expect(page.locator("#renderer-diagnostics")).toContainText(
    "blank or invalid",
  );
});

test("lost WebGL2 context shows recovery and can restart", async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      const context = get.call(this, type, ...args);
      if (type === "webgl2") window.testGL = context;
      return context;
    };
  });
  await page.goto("/");
  await page.waitForFunction(() => window.frontier, null, { timeout: 60000 });
  await page.evaluate(() => {
    const extension = window.testGL.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("Context-loss test extension unavailable");
    extension.loseContext();
  });
  await expect(page.locator("#loading")).toBeVisible();
  await expect(page.locator("#loading>span")).toContainText(
    "Graphics context lost",
  );
  await expect(page.locator("#renderer-label")).toHaveText(
    "Renderer interrupted",
  );
  expect(await page.evaluate(() => frontier.diagnostics.ready)).toBe(false);
  await page.locator("#render-recovery .compatibility-link").click();
  await page.waitForFunction(
    () => window.frontier?.backend === "WebGL2",
    null,
    { timeout: 60000 },
  );
  await expect(page.locator("#loading")).toBeHidden();
});

test("context lost during motion compilation preserves the stage and never compiles a fallback", async ({ page }) => {
  await page.addInitScript(() => {
    const proto = WebGL2RenderingContext.prototype;
    const source = proto.shaderSource, compile = proto.compileShader;
    const create = proto.createShader, storage = proto.texStorage2D;
    const motion = new WeakSet();
    window.startupFault = { injected: false, shadersAfterLoss: 0, allocations: 0, prevented: false };
    proto.shaderSource = function (shader, code) {
      if (code.includes('layout(location=0) out vec4 nextPosition;') &&
          code.includes('layout(location=3) out vec4 impact;')) motion.add(shader);
      return source.call(this, shader, code);
    };
    proto.createShader = function (...args) {
      if (window.startupFault.injected) window.startupFault.shadersAfterLoss++;
      return create.apply(this, args);
    };
    proto.texStorage2D = function (...args) {
      window.startupFault.allocations++;
      return storage.apply(this, args);
    };
    proto.compileShader = function (shader) {
      if (motion.has(shader) && !window.startupFault.injected) {
        window.startupFault.injected = true;
        this.canvas.addEventListener('webglcontextlost', (event) => {
          queueMicrotask(() => { window.startupFault.prevented = event.defaultPrevented; });
        });
        const extension = this.getExtension('WEBGL_lose_context');
        if (!extension) throw new Error('Context-loss test extension unavailable');
        extension.loseContext();
      }
      return compile.call(this, shader);
    };
  });
  await page.goto('/');
  await expect(page.locator('#loading>span')).toContainText('GPU erosion / motion / fragment compile', { timeout: 60000 });
  await expect(page.locator('#loading>span')).toContainText('CONTEXT_LOST_WEBGL');
  await expect(page.locator('#render-recovery .compatibility-link')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.startupFault.prevented)).toBe(true);
  expect(await page.evaluate(() => window.startupFault)).toEqual({
    injected: true, shadersAfterLoss: 0, allocations: 0, prevented: true,
  });
  await page.locator('#error-details').click();
  await expect(page.locator('#renderer-diagnostics')).toContainText('GPU erosion / motion / fragment compile');
});

test("an empty terrain shader log still gives a named, actionable startup error", async ({ page }) => {
  await page.addInitScript(() => {
    const proto = WebGL2RenderingContext.prototype;
    const source = proto.shaderSource, status = proto.getShaderParameter, log = proto.getShaderInfoLog;
    const broken = new WeakSet();
    proto.shaderSource = function (shader, code) {
      if (code.includes('fragColor=vec4(color+dither,1);')) broken.add(shader);
      return source.call(this, shader, code);
    };
    proto.getShaderParameter = function (shader, name) {
      return broken.has(shader) && name === this.COMPILE_STATUS ? false : status.call(this, shader, name);
    };
    proto.getShaderInfoLog = function (shader) {
      return broken.has(shader) ? '' : log.call(this, shader);
    };
  });
  await page.goto('/');
  await expect(page.locator('#loading>span')).toContainText('Terrain renderer / solid / fragment compile', { timeout: 60000 });
  await expect(page.locator('#loading>span')).toContainText('no diagnostic log');
  await expect(page.locator('#render-recovery .compatibility-link')).toBeVisible();
});

test('opaque motion link failure is terminal even while isContextLost is false, and diagnostics survive', async ({ page }) => {
  await page.addInitScript(() => {
    const proto = WebGL2RenderingContext.prototype;
    const source = proto.shaderSource, attach = proto.attachShader;
    const status = proto.getProgramParameter, info = proto.getProgramInfoLog;
    const create = proto.createShader;
    const motion = new WeakSet(), programs = new WeakSet();
    window.linkFault = { injected: false, shadersAfterFailure: 0, contextLost: null };
    proto.shaderSource = function (shader, code) {
      if (code.includes('#define MOTION_TRANSPORT_ONLY')) motion.add(shader);
      return source.call(this, shader, code);
    };
    proto.attachShader = function (program, shader) {
      if (motion.has(shader)) programs.add(program);
      return attach.call(this, program, shader);
    };
    proto.getProgramParameter = function (program, name) {
      if (programs.has(program) && name === this.LINK_STATUS) {
        window.linkFault.injected = true;
        window.linkFault.contextLost = this.isContextLost();
        return false;
      }
      return status.call(this, program, name);
    };
    proto.getProgramInfoLog = function (program) {
      return programs.has(program) ? '' : info.call(this, program);
    };
    proto.createShader = function (...args) {
      if (window.linkFault.injected) window.linkFault.shadersAfterFailure++;
      return create.apply(this, args);
    };
  });
  await page.goto('/');
  await expect(page.locator('#loading>span')).toContainText('GPU erosion / motion / link', { timeout: 60000 });
  await expect(page.locator('#renderer-label')).toHaveText('Graphics unavailable');
  expect(await page.evaluate(() => window.linkFault)).toEqual({ injected: true, shadersAfterFailure: 0, contextLost: false });
  await page.locator('#error-details').click();
  const report = JSON.parse(await page.locator('#renderer-diagnostics').textContent());
  expect(report.pipeline).toBe('split-viewport-v1');
  expect(report.graphics.renderer).toBeTruthy();
  expect(report.graphics.limits.MAX_DRAW_BUFFERS).toBeGreaterThanOrEqual(4);
  expect(report.failure.stage).toBe('GPU erosion / motion / link');
  expect(report.programs.at(-1).status).toBe('failed');
  expect(report.programs.some(p => p.label === 'Terrain renderer')).toBe(false);
});

test('an explicit missing float-render-target capability still permits static XYZ viewing', async ({ page }) => {
  await page.addInitScript(() => {
    const get = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function (name) {
      return name === 'EXT_color_buffer_float' ? null : get.call(this, name);
    };
  });
  await page.goto('/');
  await page.waitForFunction(() => window.frontier?.diagnostics.ready, null, { timeout: 60000 });
  const report = await page.evaluate(() => frontier.diagnostics);
  expect(report.gpuErosion).toBe(false);
  expect(report.erosionError).toContain('EXT_color_buffer_float');
  expect(report.frameHealth.ok).toBe(true);
  await expect(page.locator('#run')).toBeDisabled();
});

test('opaque water/composite link failure preserves the exact pass and releases the already linked solid pass', async ({ page }) => {
  await page.addInitScript(() => {
    const proto=WebGL2RenderingContext.prototype;
    const source=proto.shaderSource,attach=proto.attachShader,status=proto.getProgramParameter,log=proto.getProgramInfoLog;
    const create=proto.createProgram,remove=proto.deleteProgram;
    const compositeShaders=new WeakSet(),compositePrograms=new WeakSet(),live=new Set();
    window.viewportFault={injected:false,afterFailure:0,live:0};
    proto.createProgram=function(){if(viewportFault.injected)viewportFault.afterFailure++;const p=create.call(this);live.add(p);viewportFault.live=live.size;return p;};
    proto.deleteProgram=function(p){live.delete(p);viewportFault.live=live.size;return remove.call(this,p);};
    proto.shaderSource=function(shader,code){if(code.includes('#define VIEWPORT_COMPOSITE'))compositeShaders.add(shader);return source.call(this,shader,code);};
    proto.attachShader=function(program,shader){if(compositeShaders.has(shader))compositePrograms.add(program);return attach.call(this,program,shader);};
    proto.getProgramParameter=function(program,name){if(compositePrograms.has(program)&&name===this.LINK_STATUS){viewportFault.injected=true;return false;}return status.call(this,program,name);};
    proto.getProgramInfoLog=function(program){return compositePrograms.has(program)?'':log.call(this,program);};
  });
  await page.goto('/');
  await expect(page.locator('#loading>span')).toContainText('Terrain renderer / water + composite / link',{timeout:60000});
  await page.locator('#error-details').click();
  const report=JSON.parse(await page.locator('#renderer-diagnostics').textContent());
  expect(report.pipeline).toBe('split-viewport-v1');
  expect(report.programs.find(p=>p.label==='Terrain renderer / solid')?.status).toBe('linked');
  expect(report.programs.at(-1).status).toBe('failed');
  expect(report.graphics.contextLostAtCapture).toBe(false);
  expect(await page.evaluate(()=>viewportFault)).toEqual({injected:true,afterFailure:0,live:0});
});
