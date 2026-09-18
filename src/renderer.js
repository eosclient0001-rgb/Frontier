import { FlowPathTexture } from "./splines.js";
import { waterUniformValues } from "./water.js";
import { uploadCellPatterns } from "./cell-fracture.js";
import { displayGLSL } from "./fracture-shaders.js";
import { GPUErosion } from "./gpu-erosion.js";
import { atlasGLSL } from "./erosion-shaders.js";
import { assertFrame, validateUniforms } from "./render-health.js";
import { SIZE } from "./field.js";
import { vertexGLSL, fragmentGLSL } from "./shaders.js";

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
    const floatLinear = gl.getExtension("OES_texture_float_linear");
    this.gpuErosion = false;
    try {
      this.solver = new GPUErosion(gl);
      this.gpuErosion = true;
    } catch (error) {
      this.erosionError = error.message;
      console.warn("GPU erosion unavailable:", error.message);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.BLEND);
    }
    this.flowPaths = this.solver?.flowPaths || new FlowPathTexture(gl);
    let renderFragment = fragmentGLSL;
    if (this.gpuErosion) {
      renderFragment = renderFragment.replace(
        "uniform sampler3D volume;",
        atlasGLSL + "\nuniform sampler2D volume;",
      );
      if (this.solver.linear)
        renderFragment = renderFragment.replace(
          "#version 300 es",
          "#version 300 es\n#define LINEAR_VOLUME",
        );
      renderFragment = renderFragment.replace(
        "uniform sampler2D volume;",
        "uniform sampler2D volume;\nuniform sampler2D materialAtlas;",
      );
      renderFragment = renderFragment.replace(
        "if(extra.x>.5)c=vec3(.58,.55,.47);return c;",
        `vec4 layer=atlasSample(materialAtlas,p);float lm=dot(layer,vec4(1));vec3 loose=(layer.x*vec3(.66,.45,.23)+layer.y*vec3(.38,.34,.25)+layer.z*vec3(.45,.39,.31))/max(lm,.000001);c=mix(c,loose,clamp(lm/(VOXEL_VOLUME*.45),0.,.85));if(extra.x>.5)c=vec3(.58,.55,.47);return c;`,
      );
      renderFragment = renderFragment.replace(
        "vec3 rockColor",
        displayGLSL + "\nvec3 rockColor",
      );
      renderFragment = renderFragment.replace(
        "if(extra.x>.5)c=vec3(.58,.55,.47);return c;",
        "if(extra.x>.5)c=vec3(.58,.55,.47);return fractureColor(p,c);",
      );
      const start = renderFragment.indexOf("float field(vec3 p)");
      const end = renderFragment.indexOf("\nfloat hash", start);
      renderFragment =
        renderFragment.slice(0, start) +
        "float field(vec3 p){return sdf(volume,p);}" +
        renderFragment.slice(end);
    }
    const shader = (type, code) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    this.program = gl.createProgram();
    gl.attachShader(this.program, shader(gl.VERTEX_SHADER, vertexGLSL));
    gl.attachShader(this.program, shader(gl.FRAGMENT_SHADER, renderFragment));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(this.program));
    gl.useProgram(this.program);
    this.uniforms = uniformNames.map((n) =>
      gl.getUniformLocation(this.program, n),
    );
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
    gl.bindVertexArray(gl.createVertexArray());
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.onError?.("Graphics context lost. Reload to restore your renderer.");
    });
    this.upload(data);
  }
  upload(data) {
    this.data = data;
    if (this.gpuErosion) {
      this.solver.upload(data);
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
  setCellPatterns(preview, detail) {
    this.cellPreview = preview;
    this.cellDetail = detail;
    this.cellPatternDirty = true;
  }
  draw(values) {
    validateUniforms(values);
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.flowPaths.update(this.settings));
    gl.uniform1i(gl.getUniformLocation(this.program, "flowPaths"), 4);
    gl.uniform1f(
      gl.getUniformLocation(this.program, "terrainShown"),
      this.settings?.showTerrain === false ? 0 : 1,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(
      this.gpuErosion ? gl.TEXTURE_2D : gl.TEXTURE_3D,
      this.gpuErosion ? this.solver.volume : this.texture,
    );
    if (this.gpuErosion) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.solver.material);
      gl.uniform1i(gl.getUniformLocation(this.program, "materialAtlas"), 1);
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
      gl.uniform1i(gl.getUniformLocation(this.program, "cellPatterns"), 3);
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
        gl.getUniformLocation(this.program, "fractureCount"),
        planes.length,
      );
      gl.uniform4fv(
        gl.getUniformLocation(this.program, "fractureCenter[0]"),
        c,
      );
      gl.uniform4fv(gl.getUniformLocation(this.program, "fractureU[0]"), u);
      gl.uniform4fv(gl.getUniformLocation(this.program, "fractureV[0]"), v);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(
        gl.TEXTURE_2D,
        this.solver.chunkMask || this.solver.volume,
      );
      gl.uniform1i(gl.getUniformLocation(this.program, "chunkMask"), 2);
      gl.uniform1i(
        gl.getUniformLocation(this.program, "chunkSelected"),
        this.solver.chunkSelected ? 1 : 0,
      );
    }
    for (let i = 0; i < 7; i++)
      gl.uniform4fv(this.uniforms[i], values.subarray(i * 4, i * 4 + 4));
    for (const [name, values] of Object.entries(
      waterUniformValues(this.settings),
    ))
      gl.uniform4fv(gl.getUniformLocation(this.program, name), values);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.gpuErosion && this.showSediment)
      this.solver.drawGrains(values, true);
    if (this.gpuErosion && this.showParticles) this.solver.drawGrains(values);
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
    if (this.gpuErosion) return this.solver.pick(origin, direction);
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
  renderer.settings = settings;
  await renderer.init(data);
  await renderer.checkFrame(initialUniforms);
  renderer.diagnostics = {
    ...diagnostics,
    gpuErosion: renderer.gpuErosion,
    simulation: renderer.gpuErosion
      ? "WebGL2 GPU particle transport"
      : "GPU erosion unavailable (no CPU substitute)",
    erosionError: renderer.erosionError || null,
    version: renderer.gl.getParameter(renderer.gl.VERSION),
  };
  return renderer;
}
