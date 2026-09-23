import { fineCapacityStatus } from "./fine-capacity-status.js";
import { SparseSDF } from "./sparse-sdf.js";
import * as H from "./fine-hydraulic-shaders.js";
import { fullscreenVertex, PARTICLE_SIZE } from "./erosion-shaders.js";
import { ATLAS_SIZE } from "./domain.js";

export class FineHydraulics extends SparseSDF {
  constructor(solver, options = {}) {
    super(solver.gl, solver.volume, solver.domain, options);
    this.solver = solver;
    try {
      this.limit = options.limit ?? 4;
      const gl = this.gl,
        L = this.layout;
      for (const [name, code] of Object.entries({
        fineRequest: H.requestFragment,
        fineEvent: H.eventFragment,
        fineCargo: H.cargoFragment,
        fineApply: H.applyFragment,
        fineDistance: H.distanceFragment,
        fineRebase: H.rebaseFragment,
        fineCopy: H.copyFragment,
        fineFlowApply: H.flowApply,
      })) {
        this.programs[name] = this.program(fullscreenVertex, code, `Fine hydraulics / ${name}`);
        solver.programs[name] = this.programs[name];
      }
      this.programs.fineSplat = this.program(H.splatVertex, H.splatFragment, "Fine hydraulics / splat");
      solver.programs.fineSplat = this.programs.fineSplat;
      this.programs.fineFlow = this.program(H.flowVertex, H.flowFragment, "Fine hydraulics / flow");
      solver.programs.fineFlow = this.programs.fineFlow;
      this.programs.fineMask = this.program(H.maskVertex, H.maskFragment, "Fine hydraulics / mask");
      this.baseCopy = this.texture(...ATLAS_SIZE, gl.RGBA32F);
      this.materials = [
        this.texture(L.width, L.height, gl.RGBA32F),
        this.texture(L.width, L.height, gl.RGBA32F),
      ];
      this.materialIndex = 0;
      this.mask = this.texture(128, 128, gl.R8);
      this.target(this.mask, 128, 128);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.requests = this.texture(L.width, L.height, gl.RGBA32F);
      this.speciesRequests = this.texture(L.width, L.height, gl.RGBA32F);
      this.acceptance = this.texture(L.width, L.height, gl.RGBA32F);
      this.contactRequests = this.texture(...PARTICLE_SIZE, gl.RGBA32F);
      solver.pass("fineCopy", [this.baseCopy], ...ATLAS_SIZE, {
        source: solver.volume,
      });
      this.baseTerrain = this.baseCopy;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  dispose() {
    // The parent solver aliases fine programs; never retain deleted handles.
    for (const [name, p] of Object.entries(this.programs))
      if (this.solver?.programs[name] === p) delete this.solver.programs[name];
    super.dispose();
  }

  bindings() {
    const L = this.layout;
    return {
      textures: {
        refineKeys: this.pageTable,
        refineValues: this.field,
        fineFields: this.field,
        refineMask: this.mask,
      },
      values: {
        refineEnabled: 1,
        refineCell: L.cell,
        refineLimit: this.limit,
        refineMaskSize: [
          Math.max(
            1,
            Math.min(
              128,
              Math.floor(
                (this.domain.max[0] - this.domain.min[0]) / (L.cell * 9),
              ),
            ),
          ),
          Math.max(
            1,
            Math.min(
              128,
              Math.floor(
                (this.domain.max[2] - this.domain.min[2]) / (L.cell * 9),
              ),
            ),
          ),
          0,
          0,
        ],
        refineLayout: [L.capacity, L.keyWidth, L.width, L.height],
      },
    };
  }
  rebase() {
    const s = this.solver,
      L = this.layout;
    s.pass(
      "fineRebase",
      [this.values[1 - this.index], this.materials[1 - this.materialIndex]],
      L.width,
      L.height,
      {
        ...this.bindings().textures,
        oldBase: this.baseCopy,
        newBase: s.volume,
        oldMaterial: this.materials[this.materialIndex],
      },
      this.bindings().values,
    );
    this.index = 1 - this.index;
    this.materialIndex = 1 - this.materialIndex;
    s.pass("fineCopy", [this.baseCopy], ...ATLAS_SIZE, { source: s.volume });
  }
  exchange(params, motion, previousPositions, values) {
    const s = this.solver,
      gl = this.gl,
      L = this.layout;
    const inputs = {
      terrain: s.volume,
      positions: s.positions[motion],
      velocities: s.velocities[motion],
      previousPositions,
      metadata: s.metadata[motion],
      impacts: s.impacts,
      lifecycle: s.lifecycles[motion],
      cargo: s.cargos[s.cargoIndex],
      species: s.species[s.cargoIndex],
      materials: this.materials[this.materialIndex],
      flowPaths: s.flowPaths.texture,
    };
    s.pass("fineRequest", [this.contactRequests], ...PARTICLE_SIZE, inputs, {
      carrierCount: s.activeCount,
    });
    this.refinePoints(
      this.contactRequests,
      ...PARTICLE_SIZE,
      s.activeCount,
      values.config[0] + L.cell * 0.5,
    );
    s.target([this.mask], 128, 128);
    s.use(
      this.programs.fineMask,
      { refineKeys: this.pageTable },
      this.bindings().values,
    );
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, L.capacity * 4);
    gl.disable(gl.BLEND);
    s.pass(
      "fineEvent",
      [s.contacts, s.exchanges, s.substrateFractions],
      ...PARTICLE_SIZE,
      { ...inputs, refinementStatus: this.status },
      values,
    );
    s.target([this.requests, this.speciesRequests], L.width, L.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    s.use(
      this.programs.fineSplat,
      { ...inputs, contacts: s.contacts, exchanges: s.exchanges },
      values,
    );
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, s.activeCount * 125);
    gl.disable(gl.BLEND);
    const v = 1 - this.index,
      m = 1 - this.materialIndex;
    s.pass(
      "fineApply",
      [this.values[v], this.acceptance, this.materials[m]],
      L.width,
      L.height,
      {
        ...inputs,
        requests: this.requests,
        speciesRequests: this.speciesRequests,
      },
      { maxFineChange: L.cell * 0.04 },
    );
    const cargo = 1 - s.cargoIndex;
    s.pass(
      "fineCargo",
      [s.cargos[cargo], s.species[cargo]],
      ...PARTICLE_SIZE,
      {
        ...inputs,
        contacts: s.contacts,
        exchanges: s.exchanges,
        acceptance: this.acceptance,
      },
      values,
    );
    s.cargoIndex = cargo;
    this.materialIndex = m;
    this.index = v;
    s.pass("fineDistance", [this.values[1 - this.index]], L.width, L.height, {
      terrain: s.volume,
    });
    this.index = 1 - this.index;
    // Flow diagnostics remain coarse, but record the actual fine-field trajectories.
    s.target([s.flowRequests], ...ATLAS_SIZE);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    s.use(
      this.programs.fineFlow,
      { ...inputs, contacts: s.contacts, exchanges: s.exchanges },
      {
        carrierCount: s.activeCount,
        waterLevel: params.waterLevel,
        flowWeight: (s.timing.dt * 1024) / s.activeCount,
      },
    );
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, s.activeCount * 9);
    gl.disable(gl.BLEND);
    s.pass("fineFlowApply", [s.flowHistories[1 - s.flowIndex]], ...ATLAS_SIZE, {
      oldFlow: s.flowField,
      flowRequests: s.flowRequests,
    });
    s.flowIndex = 1 - s.flowIndex;
  }
  sampleCapacityStatus(now = performance.now()) {
    // Called by the studio only AFTER a completed batch, at most once per
    // 16 updates AND two seconds. No full-field readback or new shader program.
    const previous = this.capacityStatus;
    if (previous && (this.solver.tick - previous.iteration < 16 || now - this.capacityStatusTime < 2000))
      return previous;
    const L = this.layout, count = this.solver.activeCount;
    const keys = this.read(this.pageTable, L.keyWidth, L.keyHeight);
    const status = this.read(this.status, 256, Math.max(1, Math.ceil(count / 256)));
    this.capacityStatus = fineCapacityStatus(keys, status, count, L.capacity, this.solver.tick);
    this.capacityStatusTime = now;
    return this.capacityStatus;
  }
  readMask() {
    const gl = this.gl;
    this.target(this.mask, 128, 128);
    const bytes = new Uint8Array(128 * 128 * 4);
    gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return Float32Array.from(bytes, (v) => v / 255);
  }
  snapshot() {
    return {
      ...super.snapshot(),
      limit: this.limit,
      mask: this.readMask(),
      materials: this.read(
        this.materials[this.materialIndex],
        this.layout.width,
        this.layout.height,
      ),
    };
  }
  restore(record, base) {
    super.restore(record, base);
    this.limit = record.limit ?? 4;
    this.materialIndex = 0;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.mask);
    const mask = new Uint8Array(128 * 128);
    for (let i = 0; i < mask.length; i++)
      mask[i] = record.mask[i * 4] > 0 ? 255 : 0;
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      128,
      128,
      gl.RED,
      gl.UNSIGNED_BYTE,
      mask,
    );
    this.upload(
      this.materials[0],
      this.layout.width,
      this.layout.height,
      record.materials,
    );
  }
  focusPoint() {
    const L = this.layout,
      keys = this.read(this.pageTable, L.keyWidth, L.keyHeight),
      values = this.read(this.field, L.width, L.height);
    let best = -1,
      score = 0;
    for (let i = 0; i < L.voxels; i++) {
      const k = i * 4,
        change = values[k + 1] + values[k + 2],
        candidate =
          change * (0.2 + Math.max(0, 1 - Math.abs(values[k + 3] - 0.5) * 2));
      if (candidate > score) {
        score = candidate;
        best = i;
      }
    }
    if (best < 0) return null;
    const slot = Math.floor(best / 512),
      local = best % 512,
      q = [local % 8, Math.floor(local / 8) % 8, Math.floor(local / 64)];
    return q.map(
      (v, k) =>
        this.domain.min[k] + (keys[slot * 4 + k] * 8 + v + 0.5) * L.cell,
    );
  }
  audit() {
    const a = super.audit(),
      status = this.read(this.status, 256, 256);
    let missing = 0;
    for (let i = 0; i < this.solver.activeCount; i++)
      if (status[i * 4 + 1] > 0) missing++;
    return {
      ...a,
      bytes:
        a.bytes +
        this.layout.voxels * 16 * 5 +
        ATLAS_SIZE[0] * ATLAS_SIZE[1] * 16 +
        PARTICLE_SIZE[0] * PARTICLE_SIZE[1] * 16,
      missingContacts: missing,
      maxDisplacement: this.limit,
    };
  }
}
