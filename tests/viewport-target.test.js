import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewportTarget } from '../src/viewport-target.js';
import { viewportUniforms } from '../src/shaders.js';
function fixture() {
  const textures = new Set(), frames = new Set();
  const state = { allocations: 0, fail: false, maxLive: 0 };
  const gl = new Proxy({
    NO_ERROR: 0, isContextLost: () => false, getError: () => 0,
    createTexture() { const t = {}; textures.add(t); state.maxLive = Math.max(state.maxLive, textures.size); return t; },
    deleteTexture: t => textures.delete(t),
    createFramebuffer() { const f = {}; frames.add(f); return f; },
    deleteFramebuffer: f => frames.delete(f),
    texStorage2D() { state.allocations++; },
    checkFramebufferStatus: () => state.fail ? 'INCOMPLETE' : 'FRAMEBUFFER_COMPLETE',
  }, { get: (o,k) => o[k] ?? (/^[A-Z0-9_]+$/.test(k) ? k : () => {}) });
  return { target: new ViewportTarget(gl), textures, frames, state };
}
test('viewport target uses one allocation per size, releases old size first and disposes idempotently', () => {
  const { target, textures, frames, state } = fixture();
  target.resize(192,256); const first = target.texture;
  target.resize(192,256); assert.equal(state.allocations,1); assert.equal(target.texture,first);
  target.resize(384,256); assert.equal(state.allocations,2); assert.equal(state.maxLive,1);
  assert.equal(textures.has(first),false); assert.equal(frames.size,1);
  target.dispose(); target.dispose(); assert.equal(textures.size,0); assert.equal(frames.size,0);
});
test('incomplete viewport target releases partial resources without silently lowering precision', () => {
  const { target, textures, frames, state } = fixture(); state.fail=true;
  assert.throws(() => target.resize(10,10),/RGBA32F/);
  assert.equal(textures.size,0); assert.equal(frames.size,0); assert.equal(target.width,0);
});
test('viewport compiler-workload bounds retain the original sample counts', () => {
  assert.deepEqual(viewportUniforms.renderLoopLimits,[360,32,4,28]);
  assert.deepEqual(viewportUniforms.waterLoopLimits,[64,4,8,2]);
  assert.deepEqual(viewportUniforms.sampleLoopLimits,[3,3,2,0]);
});
