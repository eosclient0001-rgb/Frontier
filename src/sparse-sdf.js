import { buildProgram, allocateTexture2D } from './gl-resources.js';
import { sparseLayout, SPARSE_MAX_REQUESTS } from './sparse-sdf-layout.js';
import { domainUniforms } from './domain.js';
import * as S from './sparse-sdf-shaders.js';

/** Sparse storage foundation used by the live FineHydraulics solver. GPU allocation is append-only, bounded, and world-wide.
 * The owner must keep the supplied base terrain immutable until reset(). */
export class SparseSDF {
  constructor(gl, baseTerrain, domain, options = {}) {
    this.gl = gl;
    this.layout = sparseLayout(options);
    this.textures = [];
    this.programs = {};
    this.index = this.keyIndex = 0;
    if (!gl.getExtension('EXT_color_buffer_float'))
      throw new Error('Sparse XYZ refinement requires WebGL2 float render targets.');
    if (Math.max(this.layout.width, this.layout.height) > gl.getParameter(gl.MAX_TEXTURE_SIZE))
      throw new Error('Sparse XYZ refinement atlas exceeds this GPU texture limit.');
    try {
      this.framebuffer = gl.createFramebuffer();
      this.vao = gl.createVertexArray();
      this.programs.high = this.program(S.claimHighVertex, S.claimFragment);
      this.programs.low = this.program(S.claimLowVertex, S.claimFragment);
      for (const [key, fragment] of Object.entries({
        allocate: S.allocateFragment, initialize: S.initializeFragment,
        status: S.statusFragment, carve: S.carveFragment, query: S.queryFragment,
      })) this.programs[key] = this.program(S.fullscreenVertex, fragment, `Sparse XYZ / ${key}`);
      const L = this.layout;
      this.keys = [0, 1].map(() => this.texture(L.keyWidth, L.keyHeight, gl.RGBA32F));
      this.values = [0, 1].map(() => this.texture(L.width, L.height, gl.RGBA32F));
      this.claimHigh = this.texture(L.keyWidth, L.keyHeight, gl.R16F);
      this.claimLow = this.texture(L.keyWidth, L.keyHeight, gl.R16F);
      this.status = this.texture(256, 256, gl.RGBA32F);
      this.queryPoints = this.texture(32, 32, gl.RGBA32F);
      this.queryResult = this.texture(32, 32, gl.RGBA32F);
      this.reset(baseTerrain, domain);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  texture(width, height, format) {
    const texture = allocateTexture2D(this.gl, width, height, format, 'Sparse XYZ');
    this.textures.push(texture);
    return texture;
  }
  program(vertex, fragment, label = 'Sparse XYZ') {
    return buildProgram(this.gl, vertex, fragment, label);
  }
  target(texture, width, height) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, width, height);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('Sparse XYZ framebuffer is incomplete.');
  }
  use(program, textures, values = {}) {
    const gl = this.gl, L = this.layout;
    gl.useProgram(program.handle);
    const location = (name) => {
      if (!program.locations.has(name)) program.locations.set(name, gl.getUniformLocation(program.handle, name));
      return program.locations.get(name);
    };
    let unit = 0;
    for (const [name, texture] of Object.entries(textures)) {
      const loc = location(name);
      if (loc === null) continue;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(loc, unit++);
    }
    for (const [name, value] of Object.entries({
      ...domainUniforms(this.domain), sparseCell: L.cell,
      sparseLayout: [L.capacity, L.keyWidth, L.width, L.height], ...values,
    })) {
      const loc = location(name);
      if (loc === null) continue;
      if (typeof value === 'number') gl.uniform1f(loc, value);
      else if (value.length === 3) gl.uniform3fv(loc, value);
      else gl.uniform4fv(loc, value);
    }
  }
  pass(name, target, width, height, textures, values) {
    this.target(target, width, height);
    this.use(this.programs[name], textures, values);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }
  get field() { return this.values[this.index]; }
  get pageTable() { return this.keys[this.keyIndex]; }
  inputs() { return { baseTerrain: this.baseTerrain, sparseKeys: this.pageTable, sparseValues: this.field }; }
  reset(baseTerrain, domain) {
    this.baseTerrain = baseTerrain;
    this.domain = structuredClone(domain);
    this.index = this.keyIndex = 0;
    const gl = this.gl, L = this.layout;
    gl.clearColor(0, 0, 0, 0);
    for (const texture of this.keys) { this.target(texture, L.keyWidth, L.keyHeight); gl.clear(gl.COLOR_BUFFER_BIT); }
    for (const texture of this.values) { this.target(texture, L.width, L.height); gl.clear(gl.COLOR_BUFFER_BIT); }
    this.target(this.status, 256, 256); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  /** Read positions directly from an existing GPU RGBA texture; w<0 skips dead
   * points. Halo must fit in one brick, so eight corners cover the whole AABB.
   * Retry unresolved requests next update. Existing bricks are never evicted. */
  refinePoints(texture, width, height, count, halo = this.layout.cell * 2) {
    if (![width, height, count].every(Number.isInteger) || width < 1 || height < 1 || count < 0 || count > Math.min(width * height, SPARSE_MAX_REQUESTS))
      throw new Error('Invalid sparse GPU request extent.');
    if (!Number.isFinite(halo) || halo < 0 || halo * 2 >= this.layout.brickSize)
      throw new Error('Sparse request halo diameter must be smaller than a brick.');
    const gl = this.gl, L = this.layout;
    const config = { requestConfig: [width, height, count, halo] };
    const inputs = { sparseKeys: this.pageTable, requestPoints: texture };
    for (const [name, target] of [['high', this.claimHigh], ['low', this.claimLow]]) {
      this.target(target, L.keyWidth, L.keyHeight);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      this.use(this.programs[name], name === 'low' ? { ...inputs, claimHigh: this.claimHigh } : inputs, config);
      gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.POINTS, 0, count * 8);
      gl.disable(gl.BLEND);
    }
    const oldKeys = this.pageTable;
    this.pass('allocate', this.keys[1 - this.keyIndex], L.keyWidth, L.keyHeight,
      { ...inputs, claimHigh: this.claimHigh, claimLow: this.claimLow }, config);
    this.keyIndex = 1 - this.keyIndex;
    this.pass('initialize', this.values[1 - this.index], L.width, L.height, { ...this.inputs(), oldKeys });
    this.index = 1 - this.index;
    this.pass('status', this.status, 256, 256, { sparseKeys: this.pageTable, requestPoints: texture }, config);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  /** Reference storage test only; not a replacement for particle erosion. */
  carveSphere(center, radius) {
    if (center.length !== 3 || !center.every(Number.isFinite) || !Number.isFinite(radius) || radius <= 0 || radius * 2 >= this.layout.brickSize)
      throw new Error('Invalid reference CSG sphere.');
    const L = this.layout;
    this.pass('carve', this.values[1 - this.index], L.width, L.height, this.inputs(), { cutSphere: [...center, radius] });
    this.index = 1 - this.index;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }
  // Explicit diagnostics/checkpoint operations only: never part of a GPU step.
  read(texture, width, height) {
    const gl = this.gl, data = new Float32Array(width * height * 4);
    this.target(texture, width, height);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return data;
  }
  upload(texture, width, height, data) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.FLOAT, data);
  }
  sample(points) {
    if (points.length > 1024 || points.some(p => p.length !== 3 || !p.every(Number.isFinite)))
      throw new Error('Sparse diagnostic sample accepts at most 1024 finite XYZ points.');
    const data = new Float32Array(32 * 32 * 4);
    points.forEach((p, i) => data.set(p, i * 4));
    this.upload(this.queryPoints, 32, 32, data);
    this.pass('query', this.queryResult, 32, 32, { ...this.inputs(), queryPoints: this.queryPoints });
    const result = this.read(this.queryResult, 32, 32);
    return points.map((_, i) => ({ refined: result[i * 4], base: result[i * 4 + 1] }));
  }
  snapshot() {
    const L = this.layout;
    return { version: 1, layout: { capacity: L.capacity, cell: L.cell }, domain: structuredClone(this.domain),
      keys: this.read(this.pageTable, L.keyWidth, L.keyHeight), values: this.read(this.field, L.width, L.height) };
  }
  restore(record, baseTerrain) {
    const L = this.layout;
    if (record.version !== 1 || record.layout.capacity !== L.capacity || record.layout.cell !== L.cell ||
      record.keys?.length !== L.capacity * 4 || record.values?.length !== L.voxels * 4)
      throw new Error('Incompatible sparse XYZ checkpoint.');
    this.reset(baseTerrain, record.domain);
    this.upload(this.pageTable, L.keyWidth, L.keyHeight, record.keys);
    this.upload(this.field, L.width, L.height, record.values);
  }
  audit() {
    const record = this.snapshot();
    let bricks = 0, removed = 0, deposited = 0;
    for (let slot = 0; slot < this.layout.capacity; slot++) {
      if (record.keys[slot * 4 + 3] < 0.5) continue;
      bricks++;
      for (let j = 0; j < 512; j++) {
        const i = (slot * 512 + j) * 4;
        removed += record.values[i + 1]; deposited += record.values[i + 2];
      }
    }
    return { bricks, capacity: this.layout.capacity, cellMetres: this.layout.cell, removed, deposited, bytes: this.layout.bytes };
  }
  dispose() {
    const gl = this.gl;
    for (const texture of this.textures) gl.deleteTexture(texture);
    this.textures = [];
    for (const program of Object.values(this.programs)) gl.deleteProgram(program.handle);
    this.programs = {};
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.framebuffer = this.vao = null;
  }
}
