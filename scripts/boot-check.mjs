// Boot the real app bundle inside jsdom with a stubbed WebGL2 context.
// Catches runtime errors: DOM wiring, three.js init, citygen, meshing, first renders.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { makeGL } from './glstub.mjs';

const glCalls = { n: 0 };
function makeGLOld() {
  const textures = new Map();
  const gl = {
    drawingBufferWidth: 1280, drawingBufferHeight: 800,
    canvas: null,
    getContextAttributes: () => ({ alpha: false, antialias: true, depth: true, stencil: true, failIfMajorPerformanceCaveat: false, powerPreference: 'high-performance', premultipliedAlpha: true, preserveDrawingBuffer: false }),
    getParameter: p => {
      // big-value params
      if ([0x0D33, 0x851C, 0x8073, 0x88FF, 0x8DFB, 0x8872, 0x8B4C, 0x8B4D, 0x8B4E, 0x8B4F, 0x8824, 0x8825, 0x80A9].includes(p)) return 4096;
      if ([0x0B31, 0x0D32, 0x0D3A, 0x0D39, 0x0D50, 0x0D52, 0x0D53, 0x0D54, 0x0D55, 0x0D56, 0x0D57, 0x846E, 0x846F, 0x9122, 0x9123].includes(p)) return 16;
      if (p === 0x1F02) return 'WebGL 2.0 (stub)';       // VERSION
      if (p === 0x8B8C) return 256;                      // MAX_VERTEX_UNIFORM_VECTORS etc.
      if (p === 0x0D37 || p === 0x0D38) return [0, 0, 1280, 800]; // viewport bounds
      return 0;
    },
    getIndexedParameter: () => 0,
    getExtension: () => null,
    getSupportedExtensions: () => [],
    createShader: () => ({}), shaderSource() {}, compileShader() {},
    getShaderParameter: (s, p) => (p === 0x8B81 ? true : 0), // COMPILE_STATUS
    getShaderInfoLog: () => '',
    createProgram: () => ({ __id: Math.random() }), attachShader() {}, linkProgram() {}, useProgram() {}, validateProgram() {},
    getProgramParameter: (pr, p) => { if (p === 0x8B82) return true; if (p === 0x8B86) return 0; if (p === 0x8A36) return 0; return 0; }, // LINK_STATUS, ACTIVE_UNIFORMS, ACTIVE_UNIFORM_BLOCKS
    getProgramInfoLog: () => '',
    getUniformLocation: () => ({}), getUniformBlockIndex: () => 0, getUniformIndices: () => [],
    getActiveUniform: () => null, getActiveAttrib: () => null, getAttribLocation: () => 0,
    createBuffer: () => ({}), bindBuffer() {}, bufferData() {}, bufferSubData() {},
    createTexture: () => { const t = { __id: textures.size }; textures.set(t.__id, t); return t; },
    bindTexture() {}, texParameteri() {}, texParameterf() {}, texImage2D() {}, texSubImage2D() {}, texStorage2D() {}, texImage3D() {}, texSubImage3D() {}, texStorage3D() {},
    pixelStorei() {}, activeTexture() {}, generateMipmap() {},
    createFramebuffer: () => ({}), bindFramebuffer() {}, framebufferTexture2D() {}, framebufferRenderbuffer() {},
    checkFramebufferStatus: () => 0x8CD5, // COMPLETE
    createRenderbuffer: () => ({}), bindRenderbuffer() {}, renderbufferStorage() {}, renderbufferStorageMultisample() {},
    createVertexArray: () => ({}), bindVertexArray() {}, deleteVertexArray() {},
    createQuery: () => ({}), beginQuery() {}, endQuery() {}, getQueryParameter: () => 1, deleteQuery() {},
    createSampler: () => ({}), bindSampler() {}, samplerParameteri() {}, samplerParameterf() {}, deleteSampler() {},
    createTransformFeedback() {}, bindTransformFeedback() {}, deleteTransformFeedback() {},
    enable() {}, disable() {}, depthFunc() {}, depthMask() {}, depthRange() {}, blendFunc() {}, blendFuncSeparate() {}, blendEquation() {}, blendEquationSeparate() {},
    cullFace() {}, frontFace() {}, polygonOffset() {}, lineWidth() {}, scissor() {}, viewport() {},
    clearColor() {}, clearDepth() {}, clearStencil() {}, clear() {},
    colorMask() {}, stencilFunc() {}, stencilOp() {}, stencilMask() {},
    drawArrays() { glCalls.n++; }, drawElements() { glCalls.n++; }, drawArraysInstanced() { glCalls.n++; }, drawElementsInstanced() { glCalls.n++; }, drawRangeElements() { glCalls.n++; },
    drawBuffers() {}, readBuffer() {}, blitFramebuffer() {}, invalidateFramebuffer() {},
    enableVertexAttribArray() {}, disableVertexAttribArray() {}, vertexAttribPointer() {}, vertexAttribIPointer() {}, vertexAttribDivisor() {},
    uniform1i() {}, uniform1f() {}, uniform1fv() {}, uniform1iv() {}, uniform2f() {}, uniform2fv() {}, uniform2iv() {},
    uniform3f() {}, uniform3fv() {}, uniform3iv() {}, uniform4f() {}, uniform4fv() {}, uniform4iv() {},
    uniformMatrix2fv() {}, uniformMatrix3fv() {}, uniformMatrix4fv() {},
    uniformBlockBinding() {},
    getBufferSubData() {}, copyBufferSubData() {},
    getInternalformatParameter: () => null,
    fenceSync: () => ({}), deleteSync() {}, clientWaitSync: () => 0x911D, waitSync() {},
    getSyncParameter: () => 0x9119,
    isContextLost: () => false,
    flush() {}, finish() {}, getError: () => 0,
    deleteBuffer() {}, deleteTexture() {}, deleteFramebuffer() {}, deleteRenderbuffer() {}, deleteProgram() {}, deleteShader() {},
  };
  // numeric enum properties used as gl.CONSTANT
  for (const k of ['TEXTURE_2D', 'TEXTURE0']) gl[k] = 0;
  return gl;
}

const html = readFileSync('public/index.html', 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:8080/', pretendToBeVisual: true });
const { window } = dom;

// size the viewport so the renderer gets non-zero dimensions
Object.defineProperty(window.document.getElementById('viewport'), 'clientWidth', { value: 1280 });
Object.defineProperty(window.document.getElementById('viewport'), 'clientHeight', { value: 800 });

window.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === 'webgl2' || type === 'webgl') {
    const gl = makeGL(this);
    const origDraw = gl.drawArrays;
    for (const m of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
      const f = gl[m];
      gl[m] = (...a) => { glCalls.n++; return f(...a); };
    }
    void origDraw;
    return gl;
  }
  if (type === '2d') {
    // canvas 2D for procedural textures
    return {
      fillStyle: '', strokeStyle: '', lineWidth: 1,
      fillRect() {}, strokeRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {},
      roundRect() {}, fill() {}, stroke() {}, closePath() {},
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {}, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      canvas: this,
    };
  }
  return null;
};

// jsdom lacks object URLs — stub them so download() works
window.URL.createObjectURL = () => 'blob:frontier-stub';
window.URL.revokeObjectURL = () => {};

// expose globals three + main.js expect
for (const k of ['document', 'navigator', 'HTMLElement', 'HTMLCanvasElement', 'CustomEvent', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent']) {
  try { globalThis[k] = window[k]; } catch { /* read-only */ }
}
globalThis.window = window;
globalThis.devicePixelRatio = 1;
let frames = 0;
globalThis.requestAnimationFrame = cb => {
  if (frames > 60) return 0; // stub GL leaks per-frame; cap frames, real browsers don't leak
  return setTimeout(() => { frames++; cb(Date.now()); }, 5);
};
globalThis.cancelAnimationFrame = id => clearTimeout(id);

const errors = [];
window.addEventListener('error', e => errors.push(String(e.error?.stack || e.message)));
process.on('uncaughtException', e => { errors.push('uncaught: ' + e.stack); });

console.log('> importing app bundle in jsdom…');
const bundleSrc = readFileSync('public/assets/app.bundle.js', 'utf8');
try {
  // write bundle to a temp .mjs so node executes it as ESM in our patched globals
  const { writeFileSync } = await import('node:fs');
  const { pathToFileURL } = await import('node:url');
  writeFileSync('/tmp/boot-bundle.mjs', bundleSrc);
  await import(pathToFileURL('/tmp/boot-bundle.mjs').href);
} catch (e) {
  errors.push('import failed: ' + (e.stack || e));
}

// let a few animation frames run
await new Promise(r => setTimeout(r, 400));

// exercise the UI programmatically: switch tools, generate a new city, undo
const doc = window.document;
const click = el => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
try {
  click(doc.querySelector('#toolMode button[data-tool="road"]'));
  click(doc.querySelector('#profileList .item'));
  click(doc.querySelector('#propList .item'));
  click(doc.querySelector('#btnCityGen'));
  await new Promise(r => setTimeout(r, 300));
  click(doc.querySelector('#btnUndo'));
  click(doc.querySelector('#btnExportObj'));
  await new Promise(r => setTimeout(r, 500));
} catch (e) {
  errors.push('ui exercise: ' + (e.stack || e));
}

console.log(`  draw calls seen by GL stub: ${glCalls.n}`);
if (errors.length) {
  console.log('\nERRORS:');
  for (const e of errors.slice(0, 6)) console.log('  ✗', e.split('\n').slice(0, 4).join('\n    '));
  process.exit(1);
}
console.log('BOOT OK — bundle executed, city generated, UI events handled, no runtime errors.');
process.exit(0);
