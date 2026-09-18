/* Minimal WebGL2 helpers: programs, float textures, ping-pong framebuffers. */

export function createContext(canvas) {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!gl) throw new Error("WebGL2 is not available in this browser.");
  if (!gl.getExtension("EXT_color_buffer_float"))
    throw new Error("EXT_color_buffer_float is missing — float render targets are required.");
  return gl;
}

export function compile(gl, type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`${label} shader compile failed:\n${log}\n---- source ----\n${numberLines(source)}`);
  }
  return shader;
}

function numberLines(src) {
  return src
    .split("\n")
    .map((l, i) => `${String(i + 1).padStart(4)}  ${l}`)
    .join("\n");
}

export function program(gl, vertexSrc, fragmentSrc, label) {
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSrc, `${label}:vertex`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSrc, `${label}:fragment`);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error(`${label} link failed: ${gl.getProgramInfoLog(prog)}`);
  const cache = new Map();
  return {
    handle: prog,
    label,
    u(name) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(prog, name));
      return cache.get(name);
    },
  };
}

/** Fullscreen triangle — uses gl_VertexID, no buffers needed. */
export function drawFullscreen(gl, prog, viewportW, viewportH) {
  gl.useProgram(prog.handle);
  gl.viewport(0, 0, viewportW, viewportH);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export function makeTexture(gl, w, h, { internal = gl.RGBA16F, filter = gl.NEAREST, wrap = gl.CLAMP_TO_EDGE } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return tex;
}

export function uploadTexture(gl, tex, w, h, data, { internal = gl.RGBA32F } = {}) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // texStorage2D-made textures are immutable: fill via texSubImage2D
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
}

export function makeTarget(gl, w, h, attachments = 1, { internal = gl.RGBA16F } = {}) {
  const fbo = gl.createFramebuffer();
  const textures = [];
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const bufs = [];
  for (let i = 0; i < attachments; i++) {
    const tex = makeTexture(gl, w, h, { internal });
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
    textures.push(tex);
    bufs.push(gl.COLOR_ATTACHMENT0 + i);
  }
  gl.drawBuffers(bufs);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
  return { fbo, textures, w, h };
}

/** Two ping-pongable targets with identical layout. */
export function makePingPong(gl, w, h, attachments = 1, opts = {}) {
  const a = makeTarget(gl, w, h, attachments, opts);
  const b = makeTarget(gl, w, h, attachments, opts);
  const state = { a, b, flip: 0 };
  state.src = () => (state.flip === 0 ? state.a : state.b);
  state.dst = () => (state.flip === 0 ? state.b : state.a);
  state.swap = () => (state.flip ^= 1);
  return state;
}

export function bindTarget(gl, target) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
}
