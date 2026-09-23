import { ViewportTarget } from "./viewport-target.js";
import { buildProgram, assertContext, captureGraphicsInfo, graphicsProgramReport, GRAPHICS_PIPELINE } from "./gl-resources.js";
import {
  configureDomain,
  currentDomain,
  uploadDomainUniforms,
} from "./domain.js";
import { satmapUniforms } from "./satmaps.js";
import { FlowPathTexture } from "./splines.js";
import { waterUniformValues } from "./water.js";
import { uploadCellPatterns } from "./cell-fracture.js";
import { displayGLSL } from "./fracture-shaders.js";
import { GPUErosion } from "./gpu-erosion.js";
import { atlasGLSL } from "./erosion-shaders.js";
import { assertFrame, validateUniforms } from "./render-health.js";
import { SIZE } from "./field.js";
import { vertexGLSL, fragmentGLSL, viewportUniforms } from "./shaders.js";

export { FieldWorker } from "./field-worker.js";
const floatView = new Float32Array(1),
  intView = new Uint32Array(floatView.buffer);
export function toHalf(value) {
  floatView[0] = value;
  const b = intView[0],
    sign = (b >>> 16) & 0x8000;
  let exp = ((b >>> 23) & 255) - 127 + 15,
    mant = b & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >> (1 - exp);
    return sign | ((mant + 0x1000) >> 13);
  }
  if (exp >= 31) return sign | 0x7bff;
  let rounded = (mant + 0x1000) >> 13;
  if (rounded === 0x400) {
    exp++;
    rounded = 0;
  }
  return sign | (exp << 10) | rounded;
}
export function fromHalf(h) {
  const sign = h & 0x8000 ? -1 : 1,
    e = (h >> 10) & 31,
    m = h & 1023;
  return (
    sign *
    (e === 0
      ? m * 2 ** -24
      : e === 31
        ? m
          ? NaN
          : Infinity
        : (1 + m / 1024) * 2 ** (e - 15))
  );
}
const uniformNames = [
  "eye",
  "target",
  "viewport",
  "light",
  "surface",
  "brush",
  "extra",
];

export function buildViewportFragment(gpuErosion, linear) {
  let renderFragment = fragmentGLSL;
  if (gpuErosion)
    renderFragment = renderFragment.replace(
      "#version 300 es",
      "#version 300 es\n#define SATMAP_GPU\nprecision highp int;\nprecision highp sampler2D;",
    );
  if (gpuErosion) {
    renderFragment = renderFragment.replace(
      "uniform sampler3D volume;",
      atlasGLSL + "\nuniform sampler2D volume;",
    );
    if (linear)
      renderFragment = renderFragment.replace(
        "#version 300 es",
        "#version 300 es\n#define LINEAR_VOLUME",
      );
    renderFragment = renderFragment.replace(
      "uniform sampler2D volume;",
      "uniform sampler2D volume;\nuniform sampler2D materialAtlas,refineMaterial;",
    );
    renderFragment = renderFragment.replace(
      "if(extra.x>.5)c=vec3(.58,.55,.47);return c;",
      `vec4 layer=atlasSample(materialAtlas,p);float layerVolume=VOXEL_VOLUME;if(refineEnabled>.5){ivec3 q=ivec3(floor((p-LO)/refineCell));int slot=rfSlot(q/8);if(slot>=0){layer=texelFetch(refineMaterial,rfUV(slot,q-(q/8)*8),0);layerVolume=refineCell*refineCell*refineCell;}}float lm=dot(layer,vec4(1));vec3 loose=(layer.x*vec3(.66,.45,.23)+layer.y*vec3(.38,.34,.25)+layer.z*vec3(.45,.39,.31))/max(lm,.000001);if(satControl.x<.5)c=mix(c,loose,clamp(lm/(layerVolume*.45),0.,.85));if(extra.x>.5)c=vec3(.58,.55,.47);return c;`,
    );
    renderFragment = renderFragment.replace(
      "vec3 rockColor",
      displayGLSL + "\nvec3 rockColor",
    );
    renderFragment = renderFragment.replace(
      "if(extra.x>.5)c=vec3(.58,.55,.47);return c;",
      "if(extra.x>.5)c=vec3(.58,.55,.47);return fractureColor(p,c);",
    );
    renderFragment = renderFragment
      .replace(
        "float t=.18*sceneScale,s=1.;",
        "float scale=refineEnabled>.5?max(.5,refineCell*2.):sceneScale;float t=.18*scale,s=1.;",
      )
      .replace(
        "clamp(h,.16*sceneScale,1.6*sceneScale)",
        "clamp(h,.16*scale,1.6*scale)",
      )
      .replace(
        "h<.04*sceneScale||t>29.*sceneScale",
        "h<.04*scale||t>29.*scale",
      )
      .replace(
        "float a=0.,w=1.;",
        "float scale=refineEnabled>.5?max(.5,refineCell*2.):sceneScale;float a=0.,w=1.;",
      )
      .replace("float(i)*.48*sceneScale", "float(i)*.48*scale")
      .replace("*w/sceneScale", "*w/scale")
      .replace("surface.y*.72", "surface.y*(refineEnabled>.5?.08:.72)");
    renderFragment = renderFragment
      .replace(
        "float e=.13*sceneScale;",
        "float e=refineEnabled>.5?refineCell*.35:.13*sceneScale;",
      )
      .replace(
        "max(.04*sceneScale,t*.00008)",
        "(refineEnabled>.5?max(refineCell*.025,t*.2/max(1.,viewport.y)):max(.04*sceneScale,t*.00008))",
      )
      .replace(
        "float stepSize=max(.02*sceneScale,d*.55);",
        "float stepSize=refineEnabled>.5?refinedRayStep(volume,p,rd,d):max(.02*sceneScale,d*.55);",
      );
    {
      const start = renderFragment.indexOf("vec3 normalAt(vec3 p)"),
        end = renderFragment.indexOf("\nvec3 materialNormal", start);
      renderFragment =
        renderFragment.slice(0, start) +
        "vec3 normalAt(vec3 p){return surfaceNormal(volume,p);}" +
        renderFragment.slice(end);
    }
    renderFragment = renderFragment
      .replace(
        "float r=.62*sceneScale;",
        "float r=refineEnabled>.5?refineCell*1.5:.62*sceneScale;",
      )
      .replace(
        "return detailWeight(p)*clamp(dot(atlasSample(materialAtlas,p).xyz,vec3(1))/(VOXEL_VOLUME*.35),0.,1.);",
        "if(refineEnabled>.5){ivec3 q=ivec3(floor((p-LO)/refineCell));int slot=rfSlot(q/8);if(slot>=0)return clamp(dot(texelFetch(refineMaterial,rfUV(slot,q-(q/8)*8),0).xyz,vec3(1))/(refineCell*refineCell*refineCell*.35),0.,1.);}return detailWeight(p)*clamp(dot(atlasSample(materialAtlas,p).xyz,vec3(1))/(VOXEL_VOLUME*.35),0.,1.);",
      );
    const start = renderFragment.indexOf("float field(vec3 p)");
    const end = renderFragment.indexOf("\nfloat hash", start);
    renderFragment =
      renderFragment.slice(0, start) +
      "float field(vec3 p){return sdf(volume,p);}" +
      renderFragment.slice(end);
  }
  return renderFragment;
}

class WebGLRenderer {
  constructor(canvas, worker, onError) {
    this.canvas = canvas;
    this.worker = worker;
    this.backend = "WebGL2";
    this.gpu = false;
    this.onError = onError;
    this.fractureGuides = [];
    this.fractureDetails = [];
  }
  async init(data) {
    try {
      await this.initialize(data);
    } catch (error) {
      this.startupError = error;
      this.dispose();
      throw error;
    }
  }
  dispose() {
    if (this.disposed || !this.gl) return;
    this.disposed = true;
    const gl = this.gl;
    if (this.flowPaths && this.flowPaths !== this.solver?.flowPaths) gl.deleteTexture(this.flowPaths.texture);
    this.sceneTarget?.dispose();
    this.solver?.dispose();
    for (const p of [this.program, this.compositeProgram]) if (p) gl.deleteProgram(p);
    for (const t of [this.texture, this.cellPatternTexture]) if (t) gl.deleteTexture(t);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
  async initialize(data) {
    // Listen before any shader compilation or GPU allocation, not only after
    // successful startup. The original failure must survive the later event.
    this.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.contextLost = true;
      if (this.graphicsInfo) this.graphicsInfo.contextLossObserved = true;
      if (!this.startupError)
        this.onError?.("Graphics context lost. Reload to restore your renderer.");
    });
    const gl = (this.gl = this.canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    }));
    if (!gl)
      throw new Error(
        "WebGL2 is unavailable. Enable hardware acceleration in your browser and reload.",
      );
    // Capture before a reset can make GPU queries return null. This survives
    // failed construction and is available from the recovery dialog.
    this.graphicsInfo = captureGraphicsInfo(gl);
    const floatLinear = gl.getExtension("OES_texture_float_linear");
    this.gpuErosion = false;
    try {
      this.solver = new GPUErosion(gl);
      this.gpuErosion = true;
    } catch (error) {
      // isContextLost can still be false when a driver/linker failure arrives.
      // Only an explicit capability rejection may use static rendering; never
      // submit a second shader workload after an unexplained pipeline failure.
      if (gl.isContextLost() || error.code !== "WEBGL_CAPABILITY_MISSING") throw error;
      this.erosionError = error.message;
      console.warn("GPU erosion unavailable:", error.message);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.BLEND);
    }
    this.flowPaths = this.solver?.flowPaths || new FlowPathTexture(gl);
    const renderFragment = buildViewportFragment(this.gpuErosion, this.solver?.linear);
    assertContext(gl, "Terrain renderer startup");
    if (this.gpuErosion) {
      const variant = (define) => renderFragment.replace("#version 300 es", `#version 300 es\n#define ${define}`);
      this.program = buildProgram(gl, vertexGLSL, variant("VIEWPORT_SOLID"), "Terrain renderer / solid").handle;
      this.compositeProgram = buildProgram(gl, vertexGLSL, variant("VIEWPORT_COMPOSITE"), "Terrain renderer / water + composite").handle;
      this.sceneTarget = new ViewportTarget(gl);
      this.compositeUniforms = uniformNames.map(n => gl.getUniformLocation(this.compositeProgram, n));
    } else {
      this.program = buildProgram(gl, vertexGLSL, renderFragment, "Terrain renderer").handle;
    }
    gl.useProgram(this.program);
    this.uniforms = uniformNames.map(n => gl.getUniformLocation(this.program, n));
    this.texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, this.texture);
    gl.texParameteri(
      gl.TEXTURE_3D,
      gl.TEXTURE_MIN_FILTER,
      floatLinear ? gl.LINEAR : gl.NEAREST,
    );
    gl.texParameteri(
      gl.TEXTURE_3D,
      gl.TEXTURE_MAG_FILTER,
      floatLinear ? gl.LINEAR : gl.NEAREST,
    );
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(this.program, "volume"), 0);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.upload(data);
  }
  upload(data) {
    this.data = data;
    if (this.gpuErosion) {
      this.solver.upload(data);
      try {
        this.solver.configureHydraulics(this.settings);
      } catch (error) {
        if (this.gl.isContextLost() || error.code !== "WEBGL_CAPABILITY_MISSING") throw error;
        this.refinementError = error.message;
        this.settings.hydraulicShaping = false;
        this.solver.hydraulicShaping = false;
        console.warn(error.message);
      }
      return;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_3D, this.texture);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGBA32F,
      ...SIZE,
      0,
      gl.RGBA,
      gl.FLOAT,
      data,
    );
  }
  setDomain(params) {
    this.domain = configureDomain(params);
    if (this.solver) this.solver.domain = this.domain;
  }
  setCellPatterns(preview, detail) {
    this.cellPreview = preview;
    this.cellDetail = detail;
    this.cellPatternDirty = true;
  }
  draw(values, waitForGPU = false) {
    validateUniforms(values);
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao);
    if (this.sceneTarget) {
      this.sceneTarget.resize(this.canvas.width, this.canvas.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget.framebuffer);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.drawPass(values, this.program, this.uniforms);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.drawPass(values, this.compositeProgram, this.compositeUniforms);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.drawPass(values, this.program, this.uniforms);
    }
    if (this.gpuErosion && this.showSediment) this.solver.drawGrains(values, true);
    if (this.gpuErosion && this.showParticles) this.solver.drawGrains(values);
    if (waitForGPU && this.gpuErosion) return this.solver.complete();
  }
  drawPass(values, program, uniforms) {
    const gl = this.gl;
    gl.useProgram(program);
    uploadDomainUniforms(gl, program, this.domain ?? currentDomain());
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.flowPaths.update(this.settings));
    gl.uniform1i(gl.getUniformLocation(program, "flowPaths"), 4);
    gl.uniform1f(
      gl.getUniformLocation(program, "terrainShown"),
      this.settings?.showTerrain === false ? 0 : 1,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(
      this.gpuErosion ? gl.TEXTURE_2D : gl.TEXTURE_3D,
      this.gpuErosion ? this.solver.volume : this.texture,
    );
    if (this.gpuErosion) {
      const fine = this.solver.fine,
        bindings = fine?.bindings();
      gl.uniform1f(
        gl.getUniformLocation(program, "refineEnabled"),
        fine ? 1 : 0,
      );
      if (fine) {
        gl.activeTexture(gl.TEXTURE9);
        gl.bindTexture(gl.TEXTURE_2D, fine.mask);
        gl.uniform1i(gl.getUniformLocation(program, "refineMask"), 9);
        gl.activeTexture(gl.TEXTURE8);
        gl.bindTexture(gl.TEXTURE_2D, fine.materials[fine.materialIndex]);
        gl.uniform1i(gl.getUniformLocation(program, "refineMaterial"), 8);
        for (const [i, name] of ["refineKeys", "refineValues"].entries()) {
          gl.activeTexture(gl.TEXTURE0 + 6 + i);
          gl.bindTexture(gl.TEXTURE_2D, bindings.textures[name]);
          gl.uniform1i(gl.getUniformLocation(program, name), 6 + i);
        }
        for (const [name, v] of Object.entries(bindings.values)) {
          const location = gl.getUniformLocation(program, name);
          if (Array.isArray(v)) gl.uniform4fv(location, v);
          else gl.uniform1f(location, v);
        }
      }
      if (!fine) {
        for (const [i, name] of [
          "refineKeys",
          "refineValues",
          "refineMaterial",
          "refineMask",
        ].entries()) {
          gl.activeTexture(gl.TEXTURE0 + 6 + i);
          gl.bindTexture(gl.TEXTURE_2D, this.solver.volume);
          gl.uniform1i(gl.getUniformLocation(program, name), 6 + i);
        }
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.solver.material);
      gl.uniform1i(gl.getUniformLocation(program, "materialAtlas"), 1);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, this.solver.flowField);
      gl.uniform1i(gl.getUniformLocation(program, "flowAtlas"), 5);
    }
    if (this.gpuErosion) {
      this.cellPatternTexture ??= gl.createTexture();
      gl.activeTexture(gl.TEXTURE3);
      if (!this.cellPatternInitialized || this.cellPatternDirty) {
        uploadCellPatterns(gl, this.cellPatternTexture, [
          this.cellPreview,
          this.cellDetail,
        ]);
        this.cellPatternInitialized = true;
        this.cellPatternDirty = false;
      }
      gl.bindTexture(gl.TEXTURE_2D, this.cellPatternTexture);
      gl.uniform1i(gl.getUniformLocation(program, "cellPatterns"), 3);
      const planes = [
        ...this.fractureDetails.map((p) => ({ ...p, pending: false })),
        ...this.fractureGuides.map((p) => ({ ...p, pending: true })),
      ].slice(0, 24);
      const c = new Float32Array(96),
        u = new Float32Array(96),
        v = new Float32Array(96);
      planes.forEach((p, i) => {
        c.set(
          [...p.center, p.pending ? -Math.max(0.25, p.width) : p.width],
          i * 4,
        );
        u.set([...p.u, p.halfSpan], i * 4);
        v.set([...p.v, p.halfDepth], i * 4);
      });
      gl.uniform1i(
        gl.getUniformLocation(program, "fractureCount"),
        planes.length,
      );
      gl.uniform4fv(
        gl.getUniformLocation(program, "fractureCenter[0]"),
        c,
      );
      gl.uniform4fv(gl.getUniformLocation(program, "fractureU[0]"), u);
      gl.uniform4fv(gl.getUniformLocation(program, "fractureV[0]"), v);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(
        gl.TEXTURE_2D,
        this.solver.chunkMask || this.solver.volume,
      );
      gl.uniform1i(gl.getUniformLocation(program, "chunkMask"), 2);
      gl.uniform1i(
        gl.getUniformLocation(program, "chunkSelected"),
        this.solver.chunkSelected ? 1 : 0,
      );
    }
    for (let i = 0; i < 7; i++)
      gl.uniform4fv(uniforms[i], values.subarray(i * 4, i * 4 + 4));
    for (const [name, values] of Object.entries({
      ...viewportUniforms,
      ...waterUniformValues(this.settings),
      ...satmapUniforms(this.settings),
    }))
      gl.uniform4fv(gl.getUniformLocation(program, name), values);
    if (program === this.compositeProgram) {
      gl.activeTexture(gl.TEXTURE10);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.texture);
      gl.uniform1i(gl.getUniformLocation(program, "opaqueFrame"), 10);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  async checkFrame(uniforms) {
    this.draw(uniforms);
    const gl = this.gl;
    const pixels = new Uint8Array(this.canvas.width * this.canvas.height * 4);
    gl.readPixels(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    const error = gl.getError();
    if (error !== gl.NO_ERROR)
      throw new Error(`WebGL frame failed (error ${error}).`);
    this.frameHealth = assertFrame(pixels);
    return this.frameHealth;
  }
  async step(params, count = 1) {
    if (!this.gpuErosion)
      throw new Error(this.erosionError || "GPU erosion is unavailable");
    return this.solver.step(params, count);
  }
  async sculpt(point, radius, tool, params = {}) {
    if (this.gpuErosion) return this.solver.sculpt(point, radius, tool, params);
    if (["ridge", "dent", "flatten", "texture"].includes(tool))
      throw new Error(
        "3D detail brushes require WebGL2 floating-point render targets.",
      );
    const result = await this.worker.request("sculpt", { point, radius, tool });
    this.upload(result.volume);
  }
  async pick(origin, direction) {
    if (this.gpuErosion) {
      const p = await this.solver.pick(origin, direction);
      return p;
    }
    return (await this.worker.request("pick", { origin, direction })).point;
  }
  async readVolume() {
    if (this.gpuErosion) return this.solver.readVolume();
    return this.data.slice();
  }
  async auditErosion() {
    if (!this.gpuErosion) throw new Error(this.erosionError);
    return this.solver.audit();
  }
}
export async function createRenderer(
  canvas,
  worker,
  data,
  onError,
  initialUniforms,
  settings = {},
) {
  // WebGL2 is the only active backend. Do not even probe navigator.gpu:
  // availability/driver problems must not delay or block this renderer.
  const diagnostics = {
    requested: "WebGL2",
    webgpuEnabled: false,
    simulation: "WebGL2 GPU particle transport",
  };
  // Start with a small real frame. A full-resolution first raymarch can trigger
  // a driver watchdog before the adaptive resolution controller gets to run.
  const rect = canvas.getBoundingClientRect();
  canvas.width = 192;
  canvas.height = Math.max(
    64,
    Math.min(
      256,
      Math.round((192 * Math.max(rect.height, 1)) / Math.max(rect.width, 1)),
    ),
  );
  initialUniforms = new Float32Array(initialUniforms);
  initialUniforms[8] = canvas.width;
  initialUniforms[9] = canvas.height;
  const renderer = new WebGLRenderer(canvas, worker, onError);
  renderer.setDomain(settings);
  renderer.settings = settings;
  try {
    await renderer.init(data);
    await renderer.checkFrame(initialUniforms);
  } catch (error) {
    renderer.startupError = error;
    renderer.dispose();
    error.graphicsDiagnostics = {
      ...diagnostics, pipeline: GRAPHICS_PIPELINE,
      graphics: renderer.graphicsInfo ?? null,
      programs: renderer.gl ? graphicsProgramReport(renderer.gl) : [],
      failure: { stage: error.stage ?? "startup frame", code: error.code ?? "RENDER_STARTUP_FAILED", glError: error.glError ?? null, message: error.message },
    };
    throw error;
  }
  renderer.diagnostics = {
    ...diagnostics,
    pipeline: GRAPHICS_PIPELINE,
    graphics: renderer.graphicsInfo,
    programs: graphicsProgramReport(renderer.gl),
    gpuErosion: renderer.gpuErosion,
    simulation: renderer.gpuErosion
      ? "WebGL2 GPU particle transport"
      : "GPU erosion unavailable (no CPU substitute)",
    erosionError: renderer.erosionError || null,
    version: renderer.gl.getParameter(renderer.gl.VERSION),
  };
  return renderer;
}
