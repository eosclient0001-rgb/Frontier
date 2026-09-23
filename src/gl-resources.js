export const GRAPHICS_PIPELINE = "split-viewport-v1";
const programReports = new WeakMap();
export function capabilityError(message) {
  const error = new Error(message);
  error.code = "WEBGL_CAPABILITY_MISSING";
  return error;
}
export function captureGraphicsInfo(gl) {
  const read = (name) => { try { return gl.getParameter(name); } catch { return null; } };
  let debug = null;
  try { debug = gl.getExtension("WEBGL_debug_renderer_info"); } catch { /* optional */ }
  return {
    pipeline: GRAPHICS_PIPELINE,
    version: read(gl.VERSION), shadingLanguage: read(gl.SHADING_LANGUAGE_VERSION),
    vendor: read(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR),
    renderer: read(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
    contextLostAtCapture: gl.isContextLost(), contextLossObserved: false,
    limits: Object.fromEntries(["MAX_TEXTURE_SIZE", "MAX_3D_TEXTURE_SIZE",
      "MAX_TEXTURE_IMAGE_UNITS", "MAX_VERTEX_TEXTURE_IMAGE_UNITS",
      "MAX_COMBINED_TEXTURE_IMAGE_UNITS", "MAX_DRAW_BUFFERS", "MAX_COLOR_ATTACHMENTS",
      "MAX_FRAGMENT_UNIFORM_VECTORS", "MAX_VARYING_VECTORS"].map(n => [n, read(gl[n])])),
  };
}
export function graphicsProgramReport(gl) {
  return (programReports.get(gl) ?? []).map(r => ({ ...r }));
}

// Shared startup diagnostics and ownership for WebGL2 resources. An empty
// driver log is not evidence that WebGL2 is unsupported.
export function graphicsError(gl, stage, detail = "", knownGlError) {
  const glError = knownGlError ?? gl.getError();
  const lost = gl.isContextLost() || glError === gl.CONTEXT_LOST_WEBGL;
  const explanation = lost
    ? "Graphics context lost (CONTEXT_LOST_WEBGL). The browser/GPU reset the context; reload to retry."
    : "WebGL operation failed.";
  const error = new Error(`${stage}: ${explanation} ${detail?.trim() || "The driver returned no diagnostic log."}`);
  error.code = lost ? "WEBGL_CONTEXT_LOST" : "WEBGL_INITIALIZATION_FAILED";
  error.stage = stage;
  error.glError = glError;
  return error;
}

export function assertContext(gl, stage) {
  if (gl.isContextLost()) throw graphicsError(gl, stage);
}

export function buildProgram(gl, vertex, fragment, label = "WebGL program") {
  assertContext(gl, `${label} / program creation`);
  const started = performance.now();
  const report = { label, vertexCharacters: vertex.length, fragmentCharacters: fragment.length, status: "compiling" };
  if (!programReports.has(gl)) programReports.set(gl, []);
  const reports = programReports.get(gl);
  reports.push(report);
  if (reports.length > 128) reports.shift();
  const handle = gl.createProgram(), shaders = [];
  try {
    if (!handle) throw graphicsError(gl, `${label} / program creation`);
    for (const [type, source, kind] of [
      [gl.VERTEX_SHADER, vertex, "vertex"],
      [gl.FRAGMENT_SHADER, fragment, "fragment"],
    ]) {
      const stage = `${label} / ${kind} compile`;
      assertContext(gl, stage);
      const shader = gl.createShader(type);
      if (!shader) throw graphicsError(gl, stage);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw graphicsError(gl, stage, gl.getShaderInfoLog(shader));
      assertContext(gl, stage);
      gl.attachShader(handle, shader);
    }
    gl.linkProgram(handle);
    if (!gl.getProgramParameter(handle, gl.LINK_STATUS))
      throw graphicsError(gl, `${label} / link`, gl.getProgramInfoLog(handle));
    assertContext(gl, `${label} / link`);
    report.status = "linked";
    return { handle, locations: new Map(), label };
  } catch (error) {
    Object.assign(report, { status: "failed", stage: error.stage, code: error.code, glError: error.glError });
    if (handle) gl.deleteProgram(handle);
    throw error;
  } finally {
    report.elapsedMs = Math.round(performance.now() - started);
    for (const shader of shaders) gl.deleteShader(shader);
  }
}

export function allocateTexture2D(gl, width, height, format, label) {
  const stage = `${label} / ${width}×${height} texture allocation`;
  assertContext(gl, stage);
  const texture = gl.createTexture();
  if (!texture) throw graphicsError(gl, stage);
  try {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const code = gl.getError();
    if (code !== gl.NO_ERROR || gl.isContextLost())
      throw graphicsError(gl, stage, code === gl.OUT_OF_MEMORY
        ? "OUT_OF_MEMORY: the GPU could not allocate this texture."
        : `WebGL error 0x${code.toString(16)} during allocation.`, code);
    return texture;
  } catch (error) {
    gl.deleteTexture(texture);
    throw error;
  }
}
