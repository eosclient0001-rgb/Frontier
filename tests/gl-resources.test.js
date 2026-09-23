import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProgram, allocateTexture2D, graphicsProgramReport, capabilityError } from '../src/gl-resources.js';
import { GPUErosion } from '../src/gpu-erosion.js';
import { FineHydraulics } from '../src/fine-hydraulics.js';
import { terrainDomain, domainUniforms } from '../src/domain.js';

// Fault injection tests resource ownership, not GPU correctness (browser tests
// exercise real compilation, context loss, rendering and hydraulic exchange).
function fakeGL(options = {}) {
  const state = { lost: false, fragments: 0, allocations: 0, textures: new Set(),
    programs: new Set(), shaders: new Set(), framebuffers: new Set(), vaos: new Set() };
  const make = (set) => { const v = {}; state[set].add(v); return v; };
  const remove = (set) => (v) => state[set].delete(v);
  const methods = {
    NO_ERROR: 0, OUT_OF_MEMORY: 1285,
    isContextLost: () => state.lost,
    getExtension: () => ({}), getParameter: () => 16384,
    createProgram: () => make('programs'), deleteProgram: remove('programs'),
    createShader: (type) => { const s = make('shaders'); s.type = type; return s; },
    deleteShader: remove('shaders'),
    compileShader: (s) => {
      s.ok = !(s.type === 'FRAGMENT_SHADER' && ++state.fragments === options.failFragment);
      if (!s.ok && options.loseContext) state.lost = true;
    },
    getShaderParameter: (s) => s.ok, getShaderInfoLog: () => options.log ?? '',
    getProgramParameter: () => !options.failLink, getProgramInfoLog: () => options.log ?? '',
    createTexture: () => make('textures'), deleteTexture: remove('textures'),
    texStorage2D: () => { state.allocations++; },
    getError: () => state.allocations === options.failAllocation ? 1285 : 0,
    createFramebuffer: () => make('framebuffers'), deleteFramebuffer: remove('framebuffers'),
    createVertexArray: () => make('vaos'), deleteVertexArray: remove('vaos'),
    checkFramebufferStatus: () => 'FRAMEBUFFER_COMPLETE',
  };
  const gl = new Proxy(methods, { get: (obj, key) => obj[key] ?? (/^[A-Z0-9_]+$/.test(key) ? key : () => {}) });
  return { gl, state };
}
function empty(state) {
  for (const key of ['textures', 'programs', 'shaders', 'framebuffers', 'vaos'])
    assert.equal(state[key].size, 0, `${key} leaked`);
}

test('empty shader logs name the failing program and stage, and release resources', () => {
  const { gl, state } = fakeGL({ failFragment: 1 });
  assert.throws(() => buildProgram(gl, '', '', 'GPU erosion / motion'),
    /GPU erosion \/ motion \/ fragment compile:.*no diagnostic log/);
  empty(state);
});
test('context loss is distinguished from an unsupported shader and further compilation stops', () => {
  const { gl, state } = fakeGL({ failFragment: 1, loseContext: true });
  assert.throws(() => buildProgram(gl, '', '', 'motion'),
    (e) => e.code === 'WEBGL_CONTEXT_LOST' && /CONTEXT_LOST_WEBGL/.test(e.message));
  assert.throws(() => buildProgram(gl, '', '', 'fallback'), /fallback \/ program creation:.*context lost/);
  assert.equal(state.fragments, 1);
  empty(state);
});
test('link failure retains the driver message and deletes both shaders and the program', () => {
  const { gl, state } = fakeGL({ failLink: true, log: 'varying type mismatch' });
  assert.throws(() => buildProgram(gl, '', '', 'terrain'), /terrain \/ link:.*varying type mismatch/);
  empty(state);
});
test('successful compilation transfers only the linked program to its owner', () => {
  const { gl, state } = fakeGL();
  const p = buildProgram(gl, '', '', 'terrain');
  assert.equal(state.shaders.size, 0);
  assert.equal(state.programs.size, 1);
  gl.deleteProgram(p.handle);
  empty(state);
});
test('texture allocation reports out-of-memory and deletes the failed texture', () => {
  const { gl, state } = fakeGL({ failAllocation: 1 });
  assert.throws(() => allocateTexture2D(gl, 2048, 640, gl.RGBA32F, 'terrain'), /2048×640.*OUT_OF_MEMORY/);
  empty(state);
});
test('motion compile failure happens before full atlas allocation and cleans earlier programs', () => {
  const { gl, state } = fakeGL({ failFragment: 6 });
  assert.throws(() => new GPUErosion(gl), /GPU erosion \/ motion \/ fragment compile/);
  assert.equal(state.allocations, 0);
  empty(state);
});
test('partial erosion allocation failure cleans all previously allocated resources', () => {
  const { gl, state } = fakeGL({ failAllocation: 3 });
  assert.throws(() => new GPUErosion(gl), /OUT_OF_MEMORY/);
  assert.equal(state.allocations, 3);
  empty(state);
});
test('failed fine initialization cleans superclass resources and parent program aliases', () => {
  const { gl, state } = fakeGL({ failFragment: 10 });
  const solver = { gl, volume: {}, domain: terrainDomain(), programs: {} };
  assert.throws(() => new FineHydraulics(solver, { capacity: 16, cell: .5 }), /Fine hydraulics \/ fineCargo/);
  assert.deepEqual(solver.programs, {});
  empty(state);
});
test('runtime shader loop bounds preserve ray, projection and normal sample counts', () => {
  assert.deepEqual(domainUniforms(terrainDomain()).shaderLoopLimits, [256, 8, 3]);
});
test('context loss during fence completion does not hide behind a generic fence failure', async () => {
  const { gl, state } = fakeGL();
  let deleted = 0;
  gl.fenceSync = () => ({});
  gl.clientWaitSync = () => { state.lost = true; return gl.WAIT_FAILED; };
  gl.deleteSync = () => { deleted++; };
  await assert.rejects(GPUErosion.prototype.complete.call({ gl }),
    (e) => e.code === 'WEBGL_CONTEXT_LOST' && /completion:.*Graphics context lost/.test(e.message));
  assert.equal(deleted, 1);
});

test('an opaque linker failure is not a capability rejection and its report survives cleanup', () => {
  const { gl, state } = fakeGL({ failLink: true });
  assert.throws(() => buildProgram(gl, 'vertex', 'fragment', 'motion'),
    e => e.code === 'WEBGL_INITIALIZATION_FAILED');
  const reports = graphicsProgramReport(gl);
  assert.equal(reports.at(-1).stage, 'motion / link');
  assert.equal(reports.at(-1).status, 'failed');
  assert.equal(capabilityError('missing extension').code, 'WEBGL_CAPABILITY_MISSING');
  reports[0].status = 'modified';
  assert.equal(graphicsProgramReport(gl)[0].status, 'failed');
  empty(state);
});
test('null program creation is reported as a failed stage, not left compiling', () => {
  const { gl, state } = fakeGL();
  gl.createProgram = () => null;
  assert.throws(() => buildProgram(gl, '', '', 'motion'), /motion \/ program creation/);
  assert.equal(graphicsProgramReport(gl).at(-1).status, 'failed');
  empty(state);
});
