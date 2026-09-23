import { buildProgram, allocateTexture2D, assertContext, graphicsError, capabilityError } from "./gl-resources.js";
import { FineHydraulics } from "./fine-hydraulics.js";
import * as R from "./rain-budget-shaders.js";
import { rainParameters, rainStepVolume } from "./rain-physics.js";
import * as T from "./rain-transfer-shaders.js";
import { particleCount, hydraulicParticleCount, particleDrawPlan } from "./particle-pool.js";
import {
  erosionTiming,
  acceleratedSolidChange,
} from "./erosion-performance.js";
import { currentDomain, domainUniforms, footprintLimits } from "./domain.js";
import {
  hydraulicUniforms,
  sampleArea,
  maxSolidChange,
} from "./hydraulic-transport.js";
import {
  PARTICLE_DT,
  lifecycleUniforms,
  runoffUniforms,
} from "./particle-lifecycle.js";
import { assertSelectionMask } from "./selection-result.js";
import { shapeFragment, detailBrushFragment } from "./object-shaders.js";
import { noiseUniforms } from "./volume-noise.js";
import { FlowPathTexture, sampleSpline } from "./splines.js";
import { pathCutFragment, heightBrushFragment } from "./spline-shaders.js";
import { cellCutFragment } from "./cell-fracture-shaders.js";
import { uploadCellPatterns } from "./cell-fracture.js";
import * as F from "./fracture-shaders.js";
import { makePlane } from "./fractures.js";
import { SIZE, CELL, MAX } from "./field.js";
import { withDeadline } from "./render-health.js";
import * as S from "./erosion-shaders.js";

const WIDTH = SIZE[0] * S.ATLAS_COLS;
const HEIGHT = SIZE[1] * Math.ceil(SIZE[2] / S.ATLAS_COLS);

export function program(gl, vertex, fragment, label) {
  const linear = !!gl.getExtension("OES_texture_float_linear");
  const source = (code) => linear
    ? code.replace("#version 300 es", "#version 300 es\n#define LINEAR_VOLUME")
    : code;
  return buildProgram(gl, source(vertex), source(fragment), label);
}

function location(gl, p, name) {
  if (!p.locations.has(name))
    p.locations.set(name, gl.getUniformLocation(p.handle, name));
  return p.locations.get(name);
}

export class GPUErosion {
  constructor(gl) {
    this.gl = gl;
    this.textures = [];
    this.programs = {};
    try {
      assertContext(gl, "GPU erosion startup");
      this.domain = currentDomain();
      this.tick = 0;
      this.hydraulicShaping = false;
      this.simulatedSeconds = 0;
      this.volumeIndex = 0;
      this.motionIndex = 0;
      this.cargoIndex = 0;
      this.materialIndex = 0;
      this.activeCount = 1024;
      this.sculpted = false;
      if (!gl.getExtension("EXT_color_buffer_float"))
        throw capabilityError(
          "GPU erosion requires EXT_color_buffer_float. No CPU erosion is substituted.",
        );
      this.floatBlend = !!gl.getExtension("EXT_float_blend");
      if (gl.getParameter(gl.MAX_TEXTURE_SIZE) < WIDTH)
        throw capabilityError(`GPU erosion requires ${WIDTH}-pixel textures.`);
      this.fbo = gl.createFramebuffer();
      this.vao = gl.createVertexArray();
      // Compile before allocating the full float atlases: shader translation can
      // have a substantial temporary memory footprint on native GPU drivers.
      this.programs = {};
      for (const [name, code] of Object.entries({
        rainReduceParticles: R.reduceParticles,
        rainReduceGroups: R.reduceGroups,
        rainReduceTotal: R.reduceTotal,
        rainLedger: R.ledger,
        rainNormalize: R.normalize,
        motion: S.motionTransportFragment,
        motionBirth: S.motionBirthFragment,
        lifecycle: S.lifecycleFragment,
        event: S.eventFragment,
        apply: S.applyFragment,
        cargo: S.cargoFragment,
        distance: S.distanceFragment,
        distanceRain: S.distanceRainFragment,
        transferProposal: T.proposalFragment,
        transferMotion: T.transferMotionFragment,
        transferCargo: T.transferCargoFragment,
        sculpt: S.sculptFragment,
        pick: S.pickFragment,
      }))
        this.programs[name] = program(
          gl,
          S.fullscreenVertex,
          code,
          `GPU erosion / ${name}`,
        );
      this.programs.transferBucketHigh = program(
        gl,
        T.bucketHighVertex,
        T.bucketFragment,
        "Runoff bucket high IDs",
      );
      this.programs.transferBucket = program(
        gl,
        T.bucketVertex,
        T.bucketFragment,
        "Runoff spatial buckets",
      );
      this.programs.transferClaim = program(
        gl,
        T.claimVertex,
        T.claimFragment,
        "Rain handoff arbitration",
      );
      this.programs.splat = program(
        gl,
        S.splatVertex,
        S.splatFragment,
        "GPU erosion / brush scatter",
      );
      this.programs.grains = program(
        gl,
        S.grainVertex,
        S.grainFragment,
        "GPU erosion / visible agents",
      );
      this.flowPaths = new FlowPathTexture(gl);
      this.flowPaths.update({});
      this.volumes = [this.texture(WIDTH, HEIGHT), this.texture(WIDTH, HEIGHT)];
      this.linear = !!gl.getExtension("OES_texture_float_linear");
      if (this.linear)
        for (const t of this.volumes) {
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        }
      this.positions = [
        this.texture(...S.PARTICLE_SIZE),
        this.texture(...S.PARTICLE_SIZE),
      ];
      this.lifecycles = [
        this.texture(...S.PARTICLE_SIZE),
        this.texture(...S.PARTICLE_SIZE),
      ];
      this.velocities = [
        this.texture(...S.PARTICLE_SIZE),
        this.texture(...S.PARTICLE_SIZE),
      ];
      this.cargos = [
        this.texture(...S.PARTICLE_SIZE),
        this.texture(...S.PARTICLE_SIZE),
      ];
      this.metadata = [
        this.texture(...S.PARTICLE_SIZE),
        this.texture(...S.PARTICLE_SIZE),
      ];
      this.species = [
        this.texture(...S.PARTICLE_SIZE),
        this.texture(...S.PARTICLE_SIZE),
      ];
      this.materials = [this.texture(WIDTH, HEIGHT), this.texture(WIDTH, HEIGHT)];
      this.flowHistories = [
        this.texture(WIDTH, HEIGHT),
        this.texture(WIDTH, HEIGHT),
      ];
      this.flowIndex = 0;
      this.rainIndex = 0;
      this.rainVisibleUntil = 0;
      this.rainFilms = [
        this.texture(WIDTH, HEIGHT, gl.R16F),
        this.texture(WIDTH, HEIGHT, gl.R16F),
      ];
      if (this.linear)
        for (const t of this.rainFilms) {
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        }
      this.flowRequests = this.texture(
        WIDTH,
        HEIGHT,
        this.floatBlend ? gl.RGBA32F : gl.RGBA16F,
      );
      if (this.linear)
        for (const t of [...this.materials, ...this.flowHistories]) {
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        }
      this.impacts = this.texture(...S.PARTICLE_SIZE);
      this.speciesRequests = this.texture(
        WIDTH,
        HEIGHT,
        this.floatBlend ? gl.RGBA32F : gl.RGBA16F,
      );
      this.contacts = this.texture(...S.PARTICLE_SIZE);
      this.exchanges = this.texture(...S.PARTICLE_SIZE);
      this.requests = this.texture(
        WIDTH,
        HEIGHT,
        this.floatBlend ? gl.RGBA32F : gl.RGBA16F,
      );
      this.acceptances = [
        this.texture(WIDTH, HEIGHT),
        this.texture(WIDTH, HEIGHT),
      ];
      this.acceptanceIndex = 0;
      this.pickTarget = this.texture(1, 1);
      this.substrateFractions = this.texture(...S.PARTICLE_SIZE, gl.R32F);
      this.substrateRequests = this.texture(
        WIDTH,
        HEIGHT,
        this.floatBlend ? gl.R32F : gl.R16F,
      );
      this.rainReductions = [
        this.texture(16, 72),
        this.texture(4, 18),
        this.texture(1, 1),
      ];
      this.rainLedgers = [this.texture(1, 1), this.texture(1, 1)];
      this.waterSources = [this.texture(1, 1), this.texture(1, 1)];
      this.rainLedgerIndex = 0;
      this.rainVelocity = this.texture(...S.PARTICLE_SIZE);
      this.transferBuckets = this.texture(128, 128, gl.R16F);
      this.transferBucketHigh = this.texture(128, 128, gl.R16F);
      this.transferProposals = this.texture(...S.PARTICLE_SIZE, gl.R32F);
      this.transferClaimsRain = this.texture(64, 256, gl.R16F);
      this.transferClaimsRunoff = this.texture(64, 256, gl.R16F);

      this.target([this.volumes[0]], WIDTH, HEIGHT);
      this.target(
        [this.positions[0], this.velocities[0], this.metadata[0], this.impacts],
        ...S.PARTICLE_SIZE,
      );
      this.target([this.requests], WIDTH, HEIGHT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  dispose() {
    const gl = this.gl;
    this.fine?.dispose();
    this.fine = null;
    for (const t of this.textures) gl.deleteTexture(t);
    this.textures = [];
    for (const p of new Set(Object.values(this.programs))) gl.deleteProgram(p.handle);
    this.programs = {};
    if (this.flowPaths?.texture) gl.deleteTexture(this.flowPaths.texture);
    this.flowPaths = null;
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.fbo = this.vao = null;
  }

  get flowField() {
    return this.flowHistories[this.flowIndex];
  }
  get rainFilm() {
    return this.rainFilms[this.rainIndex];
  }
  get material() {
    return this.materials[this.materialIndex];
  }
  get volume() {
    return this.volumes[this.volumeIndex];
  }
  texture(w, h, format = this.gl.RGBA32F) {
    const t = allocateTexture2D(this.gl, w, h, format, "GPU erosion");
    this.textures.push(t);
    return t;
  }

  uploadTexture(texture, w, h, data) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data);
  }
  get acceptance() {
    return this.acceptances[this.acceptanceIndex];
  }
  configureHydraulics(p = {}) {
    if (this.tick === 0) this.hydraulicShaping = !!p.hydraulicShaping;
    if (p.hydraulicShaping && !this.fine) {
      if (!this.floatBlend)
        throw capabilityError(
          "Fine hydraulic shaping requires EXT_float_blend; weather erosion remains available.",
        );
      this.fine = new FineHydraulics(this, {
        cell: p.hydraulicCell ?? 0.5,
        capacity: p.hydraulicBrickCapacity ?? 4096,
        limit: 4,
      });
    }
  }
  clearExchangeResidual() {
    if (this.fine) this.fine.rebase();
    this.acceptanceIndex = 0;
    for (const texture of this.acceptances) {
      this.target([texture], WIDTH, HEIGHT);
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
  }
  upload(data, domain = currentDomain()) {
    if (this.fine) {
      this.fine.dispose();
      this.fine = null;
    }
    this.domain = structuredClone(domain);
    this.splineBaseActive = false;
    this.liveSplineCuts = [];
    this.clearFractureSelection();
    this.fractureUndoValid = false;
    const a = new Float32Array(WIDTH * HEIGHT * 4);
    let mass = 0;
    for (let z = 0; z < SIZE[2]; z++)
      for (let y = 0; y < SIZE[1]; y++) {
        const source = (z * SIZE[1] + y) * SIZE[0] * 4,
          dest =
            ((Math.floor(z / 16) * SIZE[1] + y) * WIDTH + (z % 16) * SIZE[0]) *
            4;
        a.set(data.subarray(source, source + SIZE[0] * 4), dest);
        for (let x = 0; x < SIZE[0]; x++) {
          const i = dest + x * 4;
          const solid = Math.max(
            0,
            Math.min(1, 0.5 - a[i] / (2 * this.domain.band)),
          );
          a[i + 3] = solid;
          mass += a[i + 3] * this.domain.voxelVolume;
        }
      }
    this.volumeIndex = 0;
    this.uploadTexture(this.volume, WIDTH, HEIGHT, a);
    const empty = new Float32Array(S.TOTAL_PARTICLE_SLOTS * 4),
      p = empty.slice();
    for (let i = 3; i < p.length; i += 4) p[i] = -1;
    for (let i = 0; i < 2; i++) {
      this.uploadTexture(this.positions[i], ...S.PARTICLE_SIZE, p);
      this.uploadTexture(this.velocities[i], ...S.PARTICLE_SIZE, empty);
      this.uploadTexture(this.lifecycles[i], ...S.PARTICLE_SIZE, empty);
      this.uploadTexture(this.cargos[i], ...S.PARTICLE_SIZE, empty);
      this.uploadTexture(this.metadata[i], ...S.PARTICLE_SIZE, empty);
      this.uploadTexture(this.species[i], ...S.PARTICLE_SIZE, empty);
      this.target([this.materials[i], this.flowHistories[i]], WIDTH, HEIGHT);
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
    this.uploadTexture(this.contacts, ...S.PARTICLE_SIZE, empty);
    this.uploadTexture(this.exchanges, ...S.PARTICLE_SIZE, empty);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.materialIndex = 0;
    this.flowIndex = 0;
    this.tick = 0;
    this.hydraulicShaping = false;
    this.simulatedSeconds = 0;
    this.motionIndex = 0;
    this.cargoIndex = 0;
    this.rainIndex = 0;
    this.rainVisibleUntil = 0;
    this.rainLedgerIndex = 0;
    this.requestedRainVolume = 0;
    this.rainNominalRate = 0;
    for (const texture of [...this.rainLedgers, ...this.waterSources]) {
      this.target([texture], 1, 1);
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
    for (const texture of this.rainFilms) {
      this.target([texture], WIDTH, HEIGHT);
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.clearExchangeResidual();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.initialMass = mass;
    this.sculpted = false;
  }
  target(textures, w, h) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    for (let i = 0; i < 4; i++)
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0 + i,
        gl.TEXTURE_2D,
        textures[i] || null,
        0,
      );
    gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error("GPU erosion framebuffer is incomplete.");
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
  }
  use(p, textures = {}, values = {}) {
    textures = {
      ...(this.fine?.bindings().textures ?? {}),
      rainFilm: this.rainFilm,
      occupancyResidual: this.acceptance,
      ...textures,
    };
    values = {
      ...domainUniforms(this.domain),
      refineEnabled: 0,
      ...(this.fine?.bindings().values ?? {}),
      ...values,
    };
    const gl = this.gl;
    gl.useProgram(p.handle);
    let unit = 0;
    for (const [name, t] of Object.entries(textures)) {
      const l = location(gl, p, name);
      if (l === null) continue;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(l, unit++);
    }
    for (const [name, v] of Object.entries(values)) {
      const l = location(gl, p, name);
      if (l === null) continue;
      if (typeof v === "number") {
        if (name === "tool") gl.uniform1i(l, v);
        else gl.uniform1f(l, v);
      } else if (v.length === 3) gl.uniform3fv(l, v);
      else gl.uniform4fv(l, v);
    }
  }
  pass(name, targets, w, h, textures, values = {}) {
    // These draws partition old particle ages and share the existing MRTs.
    // No scratch textures, extra water births, or additional integration ticks.
    if (name === "motion") this.pass("motionBirth", targets, w, h, textures, values);
    this.target(targets, w, h);
    this.use(this.programs[name], textures, values);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }
  advance(params) {
    if (this.tick > 0 && !!this.hydraulicShaping !== !!params.hydraulicShaping)
      throw new Error(
        "Changing hydraulic workflow requires terrain regeneration; export first to keep the result.",
      );
    this.bakeSplineCuts();
    this.flowPaths.update(params);
    this.clearFractureSelection();
    this.fractureUndoValid = false;
    const gl = this.gl;
    this.configureHydraulics(params);
    const shaping = !!params.hydraulicShaping;
    this.hydraulicShaping = shaping;
    this.activeCount = shaping
      ? hydraulicParticleCount(params.hydraulicSamples)
      : particleCount(params.particleCount ?? 1024);
    this.timing = erosionTiming(params, this.domain);
    if (shaping) {
      this.timing.dt = Math.min(this.timing.dt, this.fine.layout.cell / 4);
      this.timing.effective = this.timing.dt / 0.04;
      this.timing.substeps = Math.ceil(this.timing.dt / 0.01);
    }
    if (!shaping && (params.sourceMode ?? 0) === 0 && params.rainfall > 0)
      this.rainVisibleUntil =
        this.simulatedSeconds +
        lifecycleUniforms(params)[0] +
        this.timing.dt * 2;
    const values = {
      hydraulicShaping: shaping ? 1 : 0,
      rainPhysics: rainParameters(params),
      erosionExposure: this.timing.exposure,
      scatterLimit: this.floatBlend ? 1e30 : 30000 / this.activeCount,
      physics: [
        this.timing.dt,
        (params.sourceMode ?? 0) === 0 && rainParameters(params)[0] === 0
          ? 0
          : params.rainfall,
        params.restitution ?? 0.08,
        params.wind,
      ],
      lifeSettings: lifecycleUniforms(params),
      runoffSettings: runoffUniforms(params),
      hydraulic: hydraulicUniforms(params),
      representativeArea: sampleArea(params, this.activeCount),
      process: [
        params.erosion,
        params.hardness,
        params.deposition,
        params.capacity ?? 0.6,
      ],
      config: [
        Math.max(
          footprintLimits(this.domain)[0],
          Math.min(footprintLimits(this.domain)[1], params.footprint ?? 0.45),
        ),
        params.grainSize ?? 0.15,
        this.activeCount,
        params.sourceMode || 0,
      ],
      river: [
        params.riverSpeed ?? 3.2,
        params.riverWidth ?? 3,
        params.riverDepth ?? 0.6,
        params.riverOffset ?? 0,
      ],
      windField: [
        params.windSpeed ?? 5.5,
        params.windHeight ?? 6,
        params.windSpread ?? 2,
        ((params.windDirection ?? 0) * Math.PI) / 180,
      ],
      weather: [
        params.agentDiameter ?? 3,
        params.chemicalRate ?? 0.45,
        params.solubility ?? 0.6,
        params.riverEnabled === false ? 0 : 1,
      ],
      emitter: [
        0,
        0,
        Math.min(
          (this.domain.max[0] - this.domain.min[0]) * 0.48,
          (params.preset === 3
            ? params.plotWidth
            : (params.terrainWidth ?? 28)) * 0.49,
        ),
        Math.min(
          (this.domain.max[2] - this.domain.min[2]) * 0.48,
          (params.preset === 3
            ? params.plotLength
            : (params.terrainLength ?? 28)) * 0.49,
        ),
      ],
      environment: [params.waterLevel, params.strata, params.seed, this.tick],
    };
    if (shaping) {
      values.config[0] = this.fine.layout.cell * 1.5;
      values.config[2] = this.activeCount;
      values.config[3] = params.sourceMode === 2 ? 2 : 0;
      values.physics[1] = params.rainfall ?? 0.55;
      values.physics[3] = 0;
      values.lifeSettings[0] = 30;
      values.runoffSettings[0] = 30;
      values.hydraulic = [0.002, 0.25, 0.01, 1];
    }
    const previousPositions = this.positions[this.motionIndex],
      previousVelocity = this.velocities[this.motionIndex],
      oldCargo = this.cargos[this.cargoIndex],
      oldVolume = this.volume,
      oldMaterial = this.material,
      oldSpecies = this.species[this.cargoIndex];
    const motion = 1 - this.motionIndex,
      nextCargo = 1 - this.cargoIndex,
      nextVolume = 1 - this.volumeIndex,
      nextMaterial = 1 - this.materialIndex;
    this.pass(
      "motion",
      [
        this.positions[motion],
        this.velocities[motion],
        this.metadata[motion],
        this.impacts,
      ],
      ...S.PARTICLE_SIZE,
      {
        terrain: oldVolume,
        rainFilm: this.rainFilm,
        flowPaths: this.flowPaths.texture,
        positions: previousPositions,
        velocities: previousVelocity,
        cargo: oldCargo,
        metadata: this.metadata[this.motionIndex],
        species: oldSpecies,
        lifecycle: this.lifecycles[this.motionIndex],
      },
      values,
    );
    this.budgetRain(
      params,
      motion,
      previousPositions,
      previousVelocity,
      values,
    );
    this.pass(
      "lifecycle",
      [this.lifecycles[motion]],
      ...S.PARTICLE_SIZE,
      {
        terrain: oldVolume,
        positions: this.positions[motion],
        velocities: this.velocities[motion],
        previousPositions,
        metadata: this.metadata[motion],
        impacts: this.impacts,
        lifecycle: this.lifecycles[this.motionIndex],
      },
      values,
    );
    if (shaping) {
      this.fine.exchange(params, motion, previousPositions, values);
      this.motionIndex = motion;
      this.transferRain();
      this.tick++;
      this.simulatedSeconds += this.timing.dt;
      const error = gl.getError();
      if (error !== gl.NO_ERROR)
        throw new Error(`Fine hydraulic GL error ${error}`);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return;
    }
    this.pass(
      "event",
      [this.contacts, this.exchanges, this.substrateFractions],
      ...S.PARTICLE_SIZE,
      {
        terrain: oldVolume,
        positions: this.positions[motion],
        velocities: this.velocities[motion],
        cargo: oldCargo,
        previousPositions,
        metadata: this.metadata[motion],
        species: oldSpecies,
        impacts: this.impacts,
        lifecycle: this.lifecycles[motion],
        materials: oldMaterial,
        flowPaths: this.flowPaths.texture,
      },
      values,
    );
    this.target(
      [
        this.requests,
        this.speciesRequests,
        this.flowRequests,
        this.substrateRequests,
      ],
      WIDTH,
      HEIGHT,
    );
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.use(
      this.programs.splat,
      {
        terrain: oldVolume,
        substrateFractions: this.substrateFractions,
        contacts: this.contacts,
        exchanges: this.exchanges,
        species: oldSpecies,
        metadata: this.metadata[motion],
        positions: this.positions[motion],
        lifecycle: this.lifecycles[motion],
        velocities: this.velocities[motion],
        impacts: this.impacts,
      },
      {
        waterLevel: params.waterLevel,
        flowWeight: (this.timing.dt * 1024) / this.activeCount,
        carrierCount: this.activeCount,
      },
    );
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArraysInstanced(
      gl.TRIANGLES,
      0,
      6,
      (this.activeCount + S.RAIN_PARTICLES) * S.SLICE_COUNT,
    );
    gl.disable(gl.BLEND);
    this.pass(
      "apply",
      [
        this.volumes[nextVolume],
        this.acceptances[1 - this.acceptanceIndex],
        this.materials[nextMaterial],
        this.flowHistories[1 - this.flowIndex],
      ],
      WIDTH,
      HEIGHT,
      {
        terrain: oldVolume,
        previousAcceptance: this.acceptance,
        substrateRequests: this.substrateRequests,
        requests: this.requests,
        materials: oldMaterial,
        speciesRequests: this.speciesRequests,
        previousFlow: this.flowField,
        flowRequests: this.flowRequests,
      },
      {
        maxSolidChange: acceleratedSolidChange(params, this.domain),
        stepTicks: this.timing.dt / PARTICLE_DT,
      },
    );
    this.acceptanceIndex = 1 - this.acceptanceIndex;
    // Feedback reads the same old volume/kernel used in the scatter and the
    // per-voxel acceptance ratios, so overlapping agents don't invent sediment.
    this.pass(
      "cargo",
      [this.cargos[nextCargo], this.species[nextCargo]],
      ...S.PARTICLE_SIZE,
      {
        terrain: oldVolume,
        substrateFractions: this.substrateFractions,
        contacts: this.contacts,
        exchanges: this.exchanges,
        acceptance: this.acceptance,
        positions: this.positions[motion],
        previousPositions,
        cargo: oldCargo,
        metadata: this.metadata[motion],
        species: oldSpecies,
        impacts: this.impacts,
        lifecycle: this.lifecycles[motion],
        materials: oldMaterial,
        flowPaths: this.flowPaths.texture,
      },
      values,
    );
    this.pass(
      "distanceRain",
      [this.volumes[this.volumeIndex], this.rainFilms[1 - this.rainIndex]],
      WIDTH,
      HEIGHT,
      {
        terrain: this.volumes[nextVolume],
        rainFilm: this.rainFilm,
        rainRequests: this.requests,
      },
      { rainStep: this.timing.dt },
    );
    this.rainIndex = 1 - this.rainIndex;
    this.flowIndex = 1 - this.flowIndex;
    this.materialIndex = nextMaterial;
    this.motionIndex = motion;
    this.cargoIndex = nextCargo;
    this.transferRain();
    if (this.fine) this.fine.rebase();
    this.tick++;
    this.simulatedSeconds += this.timing.dt;
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`GPU erosion GL error ${error}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  budgetRain(params, motion, previousPositions, previousVelocity, values) {
    const textures = {
      positions: this.positions[motion],
      velocities: this.velocities[motion],
      metadata: this.metadata[motion],
      previousPositions,
      previousVelocity,
      previousMetadata: this.metadata[this.motionIndex],
      previousLife: this.lifecycles[this.motionIndex],
      impacts: this.impacts,
    };
    this.pass(
      "rainReduceParticles",
      [this.rainReductions[0]],
      16,
      72,
      textures,
    );
    this.pass("rainReduceGroups", [this.rainReductions[1]], 4, 18, {
      groups: this.rainReductions[0],
    });
    this.pass("rainReduceTotal", [this.rainReductions[2]], 1, 1, {
      groups: this.rainReductions[1],
    });
    const stepRainVolume =
      !params.hydraulicShaping && (params.sourceMode ?? 0) === 0
        ? rainStepVolume(
            params,
            this.timing.dt,
            4 * values.emitter[2] * values.emitter[3],
          )
        : 0;
    this.requestedRainVolume = (this.requestedRainVolume ?? 0) + stepRainVolume;
    this.rainNominalRate = params.hydraulicShaping
      ? 0
      : rainParameters(params)[0] *
        Math.max(0, Math.min(1, params.rainfall ?? 0));
    this.pass(
      "rainLedger",
      [
        this.rainLedgers[1 - this.rainLedgerIndex],
        this.waterSources[1 - this.rainLedgerIndex],
      ],
      1,
      1,
      {
        previousLedger: this.rainLedgers[this.rainLedgerIndex],
        previousSources: this.waterSources[this.rainLedgerIndex],
        totals: this.rainReductions[2],
      },
      {
        stepRainVolume,
        shapingVolume: params.hydraulicShaping
          ? (params.hydraulicWater ?? 8)
          : 0,
      },
    );
    this.rainLedgerIndex = 1 - this.rainLedgerIndex;
    this.pass(
      "rainNormalize",
      [this.rainVelocity],
      ...S.PARTICLE_SIZE,
      { ...textures, totals: this.rainReductions[2] },
      {
        stepRainVolume,
        shapingVolume: params.hydraulicShaping
          ? (params.hydraulicWater ?? 8)
          : 0,
      },
    );
    const raw = this.velocities[motion];
    this.velocities[motion] = this.rainVelocity;
    this.rainVelocity = raw;
  }
  transferRain() {
    // One winner per destination, exact FP32 state addition. The R16F claim
    // codes stay <=2048; no floating-point additive blending is required.
    const gl = this.gl,
      values = { carrierCount: this.activeCount, transferTick: this.tick };
    const textures = {
      terrain: this.volume,
      positions: this.positions[this.motionIndex],
      velocities: this.velocities[this.motionIndex],
      metadata: this.metadata[this.motionIndex],
      lifecycle: this.lifecycles[this.motionIndex],
      buckets: this.transferBuckets,
      bucketHigh: this.transferBucketHigh,
      proposals: this.transferProposals,
      claimsRain: this.transferClaimsRain,
      claimsRunoff: this.transferClaimsRunoff,
    };
    const waterState = {
      positions: textures.positions,
      velocities: textures.velocities,
      metadata: textures.metadata,
      lifecycle: textures.lifecycle,
    };
    // Never bind a render target as an input, even to an unused helper sampler.
    this.target([this.transferBucketHigh], 128, 128);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.use(this.programs.transferBucketHigh, waterState, values);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, this.activeCount);
    gl.disable(gl.BLEND);
    this.target([this.transferBuckets], 128, 128);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.use(
      this.programs.transferBucket,
      { ...waterState, bucketHigh: this.transferBucketHigh },
      values,
    );
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, this.activeCount);
    gl.disable(gl.BLEND);
    this.pass(
      "transferProposal",
      [this.transferProposals],
      ...S.PARTICLE_SIZE,
      {
        ...waterState,
        terrain: textures.terrain,
        buckets: textures.buckets,
        bucketHigh: textures.bucketHigh,
      },
      values,
    );
    this.target([this.transferClaimsRain, this.transferClaimsRunoff], 64, 256);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.use(
      this.programs.transferClaim,
      { proposals: this.transferProposals },
      values,
    );
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.drawArrays(gl.POINTS, 0, this.activeCount + S.RAIN_PARTICLES);
    gl.disable(gl.BLEND);
    const m = 1 - this.motionIndex,
      c = 1 - this.cargoIndex;
    this.pass(
      "transferMotion",
      [
        this.positions[m],
        this.velocities[m],
        this.metadata[m],
        this.lifecycles[m],
      ],
      ...S.PARTICLE_SIZE,
      textures,
      values,
    );
    this.pass(
      "transferCargo",
      [this.cargos[c], this.species[c]],
      ...S.PARTICLE_SIZE,
      {
        ...textures,
        cargo: this.cargos[this.cargoIndex],
        species: this.species[this.cargoIndex],
      },
      values,
    );
    this.motionIndex = m;
    this.cargoIndex = c;
  }
  async complete() {
    const gl = this.gl;
    assertContext(gl, "GPU erosion / completion");
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) throw graphicsError(gl, "GPU erosion / fence creation");
    gl.flush();
    let cancelled = false,
      timer;
    try {
      await withDeadline(
        new Promise((resolve, reject) => {
          const poll = () => {
            if (cancelled) return;
            if (gl.isContextLost()) {
              reject(graphicsError(gl, "GPU erosion / completion"));
              return;
            }
            const result = gl.clientWaitSync(sync, 0, 0);
            if (result === gl.WAIT_FAILED)
              reject(graphicsError(gl, "GPU erosion / completion", "GPU fence returned WAIT_FAILED."));
            else if (result === gl.TIMEOUT_EXPIRED) timer = setTimeout(poll, 8);
            else resolve();
          };
          poll();
        }),
        30000,
        "WebGL2 erosion",
      );
    } finally {
      cancelled = true;
      clearTimeout(timer);
      gl.deleteSync(sync);
    }
  }
  async step(params, count = 1) {
    const started = performance.now();
    // Bound queued work, even for integrations asking for a long batch.
    if (!Number.isSafeInteger(count) || count < 0 || count > 10000)
      throw new Error("Simulation batch must contain 0–10000 passes.");
    for (let i = 0; i < count; i++) {
      this.advance(params);
      if ((i + 1) % 4 === 0) await this.complete();
    }
    if (count % 4) await this.complete();
    this.lastPassMs = (performance.now() - started) / count;
  }
  async sculpt(point, radius, tool, params = {}) {
    if (
      ["ridge", "dent", "flatten", "texture"].includes(tool) ||
      (tool === "smooth" && params.brushStrength !== undefined)
    )
      return this.sculptDetail(point, radius, tool, params);
    if (tool === "raise" || tool === "lower")
      return this.sculptHeight(
        point,
        radius,
        tool,
        params.heightStrength ?? 0.25,
      );
    this.bakeSplineCuts();
    this.clearFractureSelection();
    this.fractureUndoValid = false;
    const other = 1 - this.volumeIndex,
      otherMaterial = 1 - this.materialIndex;
    this.pass(
      "sculpt",
      [this.volumes[other], this.materials[otherMaterial]],
      WIDTH,
      HEIGHT,
      { terrain: this.volume, materials: this.material },
      {
        brush: [...point, radius],
        tool: { carve: 1, add: 2, smooth: 3 }[tool],
      },
    );
    this.volumeIndex = other;
    this.materialIndex = otherMaterial;
    this.clearExchangeResidual();
    this.sculpted = true;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    await this.complete();
  }
  fractureProgram(name, fragment) {
    if (!this.programs[name])
      this.programs[name] = program(
        this.gl,
        S.fullscreenVertex,
        fragment,
        name,
      );
  }
  async saveFractureUndo() {
    this.fractureProgram("fractureCopy", F.copyFragment);
    this.fractureUndoTextures ??= [
      this.texture(WIDTH, HEIGHT),
      this.texture(WIDTH, HEIGHT),
    ];
    this.pass("fractureCopy", this.fractureUndoTextures, WIDTH, HEIGHT, {
      terrain: this.volume,
      materials: this.material,
    });
    this.fractureUndoSculpted = this.sculpted;
    this.fractureUndoValid = true;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    await this.complete();
  }
  async undoFracture() {
    if (!this.fractureUndoValid)
      throw new Error("Undo was cleared by a later terrain edit or erosion.");
    this.pass("fractureCopy", [this.volume, this.material], WIDTH, HEIGHT, {
      terrain: this.fractureUndoTextures[0],
      materials: this.fractureUndoTextures[1],
    });
    this.sculpted = this.fractureUndoSculpted;
    this.fractureUndoValid = false;
    this.clearFractureSelection();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    await this.complete();
  }
  bakeSplineCuts() {
    if (!this.splineBaseActive) return;
    const ids = (this.liveSplineCuts || []).map((n) => n.id);
    this.splineBaseActive = false;
    this.liveSplineCuts = [];
    this.onSplineBake?.(ids);
  }
  copySplineBase(restore = false) {
    this.fractureProgram("fractureCopy", F.copyFragment);
    this.splineBase ??= [
      this.texture(WIDTH, HEIGHT),
      this.texture(WIDTH, HEIGHT),
    ];
    this.pass(
      "fractureCopy",
      restore ? [this.volume, this.material] : this.splineBase,
      WIDTH,
      HEIGHT,
      {
        terrain: restore ? this.splineBase[0] : this.volume,
        materials: restore ? this.splineBase[1] : this.material,
      },
    );
  }
  applySplineCut(node) {
    const points = sampleSpline(node.points, 32);
    if (points.length < 2) return;
    this.fractureProgram("splineCut", pathCutFragment);
    const gl = this.gl;
    this.pathPoints ??= gl.createTexture();
    const data = new Float32Array(33 * 4);
    points.forEach((p, i) => data.set([...p, 0], i * 4));
    gl.bindTexture(gl.TEXTURE_2D, this.pathPoints);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      33,
      1,
      0,
      gl.RGBA,
      gl.FLOAT,
      data,
    );
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
      gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
    const v = 1 - this.volumeIndex,
      m = 1 - this.materialIndex;
    this.pass(
      "splineCut",
      [this.volumes[v], this.materials[m]],
      WIDTH,
      HEIGHT,
      {
        terrain: this.volume,
        materials: this.material,
        pathPoints: this.pathPoints,
      },
      {
        pathSettings: [
          points.length - 1,
          node.width,
          node.depth,
          node.bankSlope ?? 0.25,
        ],
      },
    );
    this.volumeIndex = v;
    this.materialIndex = m;
  }
  applyShape(node) {
    this.fractureProgram("shape", shapeFragment);
    const v = 1 - this.volumeIndex,
      m = 1 - this.materialIndex;
    this.pass(
      "shape",
      [this.volumes[v], this.materials[m]],
      WIDTH,
      HEIGHT,
      { terrain: this.volume, materials: this.material },
      {
        shapePosition: [...node.position, node.primitive],
        shapeSize: [...node.size, 0],
        shapeRotation: [...node.rotation.map((v) => (v * Math.PI) / 180), 0],
        shapeDetail: [
          node.rounding,
          node.terraceHeight,
          node.terraceStrength,
          node.profile ?? 0.5,
        ],
        ...noiseUniforms(node),
      },
    );
    this.volumeIndex = v;
    this.materialIndex = m;
  }
  applySceneModifier(node) {
    if (node.type === "shape") this.applyShape(node);
    else this.applySplineCut(node);
  }
  async sculptDetail(point, radius, tool, p) {
    this.bakeSplineCuts();
    this.clearFractureSelection();
    this.fractureUndoValid = false;
    this.fractureProgram("detailBrush", detailBrushFragment);
    const v = 1 - this.volumeIndex,
      m = 1 - this.materialIndex;
    this.pass(
      "detailBrush",
      [this.volumes[v], this.materials[m]],
      WIDTH,
      HEIGHT,
      { terrain: this.volume, materials: this.material },
      {
        brush: [...point, radius],
        brushDetail: [
          { ridge: 1, dent: 2, smooth: 3, flatten: 4, texture: 5 }[tool],
          p.brushStrength ?? 0.35,
          p.brushFalloff ?? 2,
          p.brushTexture ?? 0,
        ],
        brushShape: [p.brushAspect ?? 1.8, p.brushDepth ?? 1, 0, 0],
        brushDirection: [...(p.brushDirection ?? [1, 0, 0]), 0],
        ...noiseUniforms({
          noiseType: p.brushNoiseType ?? 1,
          noiseScale: p.brushNoiseScale ?? 1.5,
          noiseOctaves: p.brushOctaves ?? 3,
          noiseSeed: p.seed ?? 4821,
        }),
      },
    );
    this.volumeIndex = v;
    this.materialIndex = m;
    this.clearExchangeResidual();
    this.sculpted = true;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    await this.complete();
  }
  async refreshSplineCuts(nodes) {
    const cuts = nodes.filter(
      (n) =>
        !n.baked &&
        n.visible &&
        (n.type === "shape" || (n.type === "cut" && n.points.length >= 2)),
    );
    if (this.splineBaseActive) this.copySplineBase(true);
    else if (cuts.length) this.copySplineBase();
    this.liveSplineCuts = structuredClone(cuts);
    this.splineBaseActive = cuts.length > 0;
    // Shapes fuse first, then channel cuts affect both plot and boulders.
    cuts.sort(
      (a, b) => (a.type === "shape" ? 0 : 1) - (b.type === "shape" ? 0 : 1),
    );
    this.liveSplineCuts = structuredClone(cuts);
    for (const cut of cuts) this.applySceneModifier(cut);
    if (cuts.length) {
      this.fine?.rebase();
      this.sculpted = true;
    }
    this.clearFractureSelection();
    this.fractureUndoValid = false;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    await this.complete();
  }
  async sculptHeight(point, radius, tool, strength) {
    this.fractureUndoValid = false;
    this.clearFractureSelection();
    if (this.splineBaseActive) this.copySplineBase(true);
    this.fractureProgram("heightBrush", heightBrushFragment);
    const v = 1 - this.volumeIndex,
      m = 1 - this.materialIndex;
    this.pass(
      "heightBrush",
      [this.volumes[v], this.materials[m]],
      WIDTH,
      HEIGHT,
      { terrain: this.volume, materials: this.material },
      {
        brush: [...point, radius],
        heightSettings: [tool === "raise" ? 1 : -1, strength, 0, 0],
      },
    );
    this.volumeIndex = v;
    this.materialIndex = m;
    this.clearExchangeResidual();
    this.sculpted = true;
    if (this.splineBaseActive) {
      this.copySplineBase();
      for (const cut of this.liveSplineCuts) this.applySceneModifier(cut);
    }
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    await this.complete();
  }
  async fractureCells(pattern) {
    if (pattern && !pattern.detail && !pattern.intact) this.bakeSplineCuts();
    if (!pattern || pattern.sites.length < 2)
      throw new Error("Paint a larger region to create multiple cells.");
    if (pattern.detail || pattern.intact) return;
    this.fractureProgram("cellFracture", cellCutFragment);
    this.cellPatternTexture ??= this.gl.createTexture();
    uploadCellPatterns(this.gl, this.cellPatternTexture, [pattern]);
    const v = 1 - this.volumeIndex,
      m = 1 - this.materialIndex;
    this.pass(
      "cellFracture",
      [this.volumes[v], this.materials[m]],
      WIDTH,
      HEIGHT,
      {
        terrain: this.volume,
        materials: this.material,
        cellPatterns: this.cellPatternTexture,
      },
    );
    this.volumeIndex = v;
    this.materialIndex = m;
    this.clearExchangeResidual();
    this.sculpted = true;
    this.clearFractureSelection();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    await this.complete();
  }
  async cutPlanes(planes) {
    if (planes.some((p) => !p.detail)) this.bakeSplineCuts();
    this.fractureProgram("fractureCut", F.cutFragment);
    for (const descriptor of planes) {
      if (descriptor.detail) continue;
      const p = makePlane(
        descriptor.a,
        descriptor.b,
        descriptor.view,
        descriptor,
      );
      const v = 1 - this.volumeIndex,
        m = 1 - this.materialIndex;
      this.pass(
        "fractureCut",
        [this.volumes[v], this.materials[m]],
        WIDTH,
        HEIGHT,
        { terrain: this.volume, materials: this.material },
        {
          cutCenter: [...p.center, p.width],
          cutU: [...p.u, p.halfSpan],
          cutV: [...p.v, p.halfDepth],
        },
      );
      this.volumeIndex = v;
      this.materialIndex = m;
      this.clearExchangeResidual();
      this.sculpted = true;
    }
    this.clearFractureSelection();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    await this.complete();
  }
  clearFractureSelection() {
    this.chunkSelected = false;
  }
  setChunkSelection(mask) {
    this.clearFractureSelection();
    assertSelectionMask(mask);
    const atlas = new Uint8Array(WIDTH * HEIGHT);
    for (let z = 0; z < SIZE[2]; z++)
      for (let y = 0; y < SIZE[1]; y++) {
        const source = (z * SIZE[1] + y) * SIZE[0],
          dest =
            (Math.floor(z / 16) * SIZE[1] + y) * WIDTH + (z % 16) * SIZE[0];
        atlas.set(mask.subarray(source, source + SIZE[0]), dest);
      }
    const gl = this.gl;
    this.chunkMask ??= gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.chunkMask);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      WIDTH,
      HEIGHT,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      atlas,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.chunkSelected = true;
  }
  async deleteChunk() {
    if (!this.chunkSelected || !this.chunkMask)
      throw new Error("Select a fracture piece first.");
    this.bakeSplineCuts();
    this.fractureProgram("fractureDelete", F.deleteFragment);
    const v = 1 - this.volumeIndex,
      m = 1 - this.materialIndex;
    this.pass(
      "fractureDelete",
      [this.volumes[v], this.materials[m]],
      WIDTH,
      HEIGHT,
      {
        terrain: this.volume,
        materials: this.material,
        chunkMask: this.chunkMask,
      },
    );
    this.volumeIndex = v;
    this.materialIndex = m;
    this.clearExchangeResidual();
    this.sculpted = true;
    // Repair obsolete positive distances around the removed surface. Do not
    // modify remaining occupancy or reset the particle/material state.
    for (let i = 0; i < 4; i++) {
      const next = 1 - this.volumeIndex;
      this.pass("distance", [this.volumes[next]], WIDTH, HEIGHT, {
        terrain: this.volume,
      });
      this.volumeIndex = next;
    }
    this.clearFractureSelection();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    await this.complete();
  }
  read(texture, w, h) {
    const gl = this.gl;
    this.target([texture], w, h);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    const a = new Float32Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, a);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return a;
  }
  async pick(origin, direction) {
    this.pass(
      "pick",
      [this.pickTarget],
      1,
      1,
      { terrain: this.volume },
      { origin, direction },
    );
    await this.complete();
    const p = this.read(this.pickTarget, 1, 1);
    return p[3] > 0.5 ? Array.from(p.slice(0, 3)) : null;
  }
  async checkpoint() {
    this.bakeSplineCuts();
    const fields = {};
    for (const [name, texture] of Object.entries({
      volume: this.volume,
      material: this.material,
      flow: this.flowField,
      rainFilm: this.rainFilm,
      acceptance: this.acceptance,
    }))
      fields[name] = this.read(texture, WIDTH, HEIGHT);
    for (const [name, textures, index] of [
      ["positions", this.positions, this.motionIndex],
      ["velocities", this.velocities, this.motionIndex],
      ["metadata", this.metadata, this.motionIndex],
      ["lifecycles", this.lifecycles, this.motionIndex],
      ["cargos", this.cargos, this.cargoIndex],
      ["species", this.species, this.cargoIndex],
    ])
      fields[name] = this.read(textures[index], ...S.PARTICLE_SIZE);
    return {
      fields,
      fine: this.fine?.snapshot() ?? null,
      hydraulicShaping: this.hydraulicShaping ?? false,
      rainNominalRate: this.rainNominalRate ?? 0,
      requestedRainVolume: this.requestedRainVolume ?? 0,
      rainLedger: this.read(this.rainLedgers[this.rainLedgerIndex], 1, 1),
      waterSources: this.read(this.waterSources[this.rainLedgerIndex], 1, 1),
      particleLayout: "rain-volume-v5-64x288",
      rainVisibleUntil: this.rainVisibleUntil,
      domain: structuredClone(this.domain),
      tick: this.tick,
      simulatedSeconds: this.simulatedSeconds,
      initialMass: this.initialMass,
      sculpted: this.sculpted,
      activeCount: this.activeCount,
    };
  }
  restoreCheckpoint(record) {
    if (this.fine) {
      this.fine.dispose();
      this.fine = null;
    }
    if (record.particleLayout !== "rain-volume-v5-64x288")
      throw new Error(
        "This particle checkpoint uses an older layout. Export its terrain before upgrading.",
      );
    this.acceptanceIndex = 0;
    this.uploadTexture(
      this.acceptance,
      WIDTH,
      HEIGHT,
      record.fields.acceptance,
    );
    this.requestedRainVolume = record.requestedRainVolume ?? 0;
    this.rainNominalRate = record.rainNominalRate ?? 0;
    this.rainLedgerIndex = 0;
    this.uploadTexture(
      this.waterSources[0],
      1,
      1,
      record.waterSources ??
        new Float32Array([record.requestedRainVolume ?? 0, 0, 0, 0]),
    );
    this.uploadTexture(this.rainLedgers[0], 1, 1, record.rainLedger);
    this.rainVisibleUntil = record.rainVisibleUntil ?? 0;
    this.rainIndex = 0;
    const film = new Float32Array(WIDTH * HEIGHT);
    for (let i = 0; i < film.length; i++)
      film[i] = record.fields.rainFilm[i * 4];
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.rainFilm);
    this.gl.texSubImage2D(
      this.gl.TEXTURE_2D,
      0,
      0,
      0,
      WIDTH,
      HEIGHT,
      this.gl.RED,
      this.gl.FLOAT,
      film,
    );
    this.simulatedSeconds =
      record.simulatedSeconds ?? record.tick * PARTICLE_DT;
    if (record.domain) this.domain = structuredClone(record.domain);
    this.splineBaseActive = false;
    this.liveSplineCuts = [];
    this.clearFractureSelection();
    this.fractureUndoValid = false;
    this.volumeIndex =
      this.materialIndex =
      this.flowIndex =
      this.motionIndex =
      this.cargoIndex =
        0;
    for (const [key, texture] of Object.entries({
      volume: this.volume,
      material: this.material,
      flow: this.flowField,
    }))
      this.uploadTexture(texture, WIDTH, HEIGHT, record.fields[key]);
    for (const key of [
      "positions",
      "velocities",
      "metadata",
      "lifecycles",
      "cargos",
      "species",
    ])
      this.uploadTexture(this[key][0], ...S.PARTICLE_SIZE, record.fields[key]);
    for (const key of ["tick", "initialMass", "sculpted", "activeCount"])
      this[key] = record[key];
    this.hydraulicShaping = record.hydraulicShaping ?? false;
    if (record.fine) {
      this.configureHydraulics({
        hydraulicShaping: true,
        hydraulicCell: record.fine.layout.cell,
        hydraulicBrickCapacity: record.fine.layout.capacity,
      });
      this.fine.restore(record.fine, this.fine.baseCopy);
    }
  }
  async readVolume() {
    await this.complete();
    const atlas = this.read(this.volume, WIDTH, HEIGHT),
      a = new Float32Array(SIZE[0] * SIZE[1] * SIZE[2] * 4);
    for (let z = 0; z < SIZE[2]; z++)
      for (let y = 0; y < SIZE[1]; y++) {
        const source =
            ((Math.floor(z / 16) * SIZE[1] + y) * WIDTH + (z % 16) * SIZE[0]) *
            4,
          dest = (z * SIZE[1] + y) * SIZE[0] * 4;
        a.set(atlas.subarray(source, source + SIZE[0] * 4), dest);
      }
    return a;
  }
  async audit() {
    const volume = await this.readVolume(),
      load = this.read(this.cargos[this.cargoIndex], ...S.PARTICLE_SIZE),
      positions = this.read(
        this.positions[this.motionIndex],
        ...S.PARTICLE_SIZE,
      );
    let solid = 0,
      carried = 0,
      eroded = 0,
      deposited = 0,
      retired = 0,
      active = 0;
    for (let i = 3; i < volume.length; i += 4)
      solid += volume[i] * this.domain.voxelVolume;
    for (let i = 0; i < load.length; i += 4) {
      carried += load[i];
      eroded += load[i + 1];
      deposited += load[i + 2];
      retired += load[i + 3];
      if (i / 4 < this.activeCount && positions[i + 3] >= 0) active++;
    }
    const mixes = this.read(this.species[this.cargoIndex], ...S.PARTICLE_SIZE),
      metas = this.read(this.metadata[this.motionIndex], ...S.PARTICLE_SIZE),
      velocities = this.read(
        this.velocities[this.motionIndex],
        ...S.PARTICLE_SIZE,
      );
    const clocks = this.read(
      this.lifecycles[this.motionIndex],
      ...S.PARTICLE_SIZE,
    );
    const residual = this.read(this.acceptance, WIDTH, HEIGHT);
    let residualMass = 0;
    for (let i = 3; i < residual.length; i += 4)
      residualMass += residual[i] * this.domain.voxelVolume;
    solid += residualMass;
    const rainLedger = this.read(this.rainLedgers[this.rainLedgerIndex], 1, 1);
    let rainWater = 0;
    for (let i = 0; i < positions.length; i += 4)
      if (positions[i + 3] >= 0 && metas[i] < 0.5)
        rainWater += velocities[i + 3];
    let settling = 0,
      maxAge = 0,
      airborneRain = 0,
      runoffAgents = 0,
      precipitationActive = 0,
      precipitationAirborne = 0;
    const composition = [0, 0, 0, 0],
      byMode = Array.from({ length: 6 }, () => ({
        active: 0,
        meanY: 0,
        meanVz: 0,
        meanDiameter: 0,
      }));
    for (let i = 0; i < mixes.length; i += 4) {
      for (let k = 0; k < 4; k++) composition[k] += mixes[i + k];
      if (i / 4 >= S.RAIN_START && positions[i + 3] >= 0) {
        precipitationActive++;
        if (metas[i + 3] < 0) precipitationAirborne++;
      }
      if (i / 4 < this.activeCount && positions[i + 3] >= 0) {
        if (clocks[i + 2] > 0.5 && clocks[i + 2] < 1.5) settling++;
        if (metas[i] < 0.5) {
          if (metas[i + 3] < 0) airborneRain++;
          else runoffAgents++;
        } else if (metas[i] === 1 || metas[i] === 2) runoffAgents++;
        maxAge = Math.max(maxAge, positions[i + 3]);
        const m = byMode[Math.round(metas[i])] || byMode[0];
        m.active++;
        m.meanY += positions[i + 1];
        m.meanVz += velocities[i + 2];
        m.meanDiameter += metas[i + 2];
      }
    }
    for (const m of byMode)
      if (m.active) {
        m.meanY /= m.active;
        m.meanVz /= m.active;
        m.meanDiameter /= m.active;
      }
    const sources = this.read(this.waterSources[this.rainLedgerIndex], 1, 1);
    const fine = this.fine?.audit() ?? null;
    if (fine) solid += fine.deposited - fine.removed;
    return {
      hydraulicShaping: this.hydraulicShaping ?? false,
      refinement: fine,
      rainWater: {
        units: "m³",
        requested: sources[0] + sources[1],
        shapingSource: sources[1],
        weatherRequested: sources[0],
        unrepresented: Math.max(0, sources[0] + sources[1] - rainLedger[0]),
        admitted: rainLedger[0],
        evaporated: rainLedger[1],
        unresolvedOutflow: rainLedger[2],
        stored: rainWater,
        balanceError: rainLedger[0] - rainLedger[1] - rainLedger[2] - rainWater,
        births: rainLedger[3],
        nominalRateMmHour: this.rainNominalRate ?? 0,
      },
      composition: {
        sand: composition[0],
        fines: composition[1],
        coarse: composition[2],
        dissolved: composition[3],
      },
      compositionError: composition.reduce((a, b) => a + b, 0) - carried,
      byMode,
      solver: "WebGL2 GPU multi-agent transport",
      steps: this.tick,
      simulatedSeconds: this.simulatedSeconds,
      acceleration: this.timing,
      active,
      settling,
      maxAge,
      airborneRain,
      runoffAgents,
      selectedParticles: this.activeCount,
      particleCapacity: S.MAX_PARTICLES,
      precipitationActive,
      precipitationAirborne,
      rainSurfaceCarriers: precipitationActive - precipitationAirborne,
      rainCapacity: S.RAIN_PARTICLES,
      totalActive: active + precipitationActive,
      carried,
      eroded,
      deposited,
      retired,
      solid,
      initialSolid: this.initialMass,
      ledgerError: eroded - deposited - carried - retired,
      massError: this.sculpted
        ? null
        : solid + carried + retired - this.initialMass,
      sculpted: this.sculpted,
      accumulation: this.floatBlend ? "float32" : "float16",
      units: "m³ of voxel occupancy; not calibrated physical sediment mass",
    };
  }
  drawGrains(uniforms, plumes = false) {
    const showRain = this.rainVisibleUntil > this.simulatedSeconds;
    const plan = particleDrawPlan(this.activeCount);
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.bindVertexArray(this.vao);
    this.use(
      this.programs.grains,
      {
        terrain: this.volume,
        positions: this.positions[this.motionIndex],
        velocities: this.velocities[this.motionIndex],
        cargo: this.cargos[this.cargoIndex],
        exchanges: this.exchanges,
        metadata: this.metadata[this.motionIndex],
        species: this.species[this.cargoIndex],
        lifecycle: this.lifecycles[this.motionIndex],
        flowPaths: this.flowPaths.texture,
      },
      {
        eye: uniforms.subarray(0, 4),
        target: uniforms.subarray(4, 8),
        activeCount: this.activeCount,
        particleDrawStride: plan.stride,
        particleBase: 0,
        particleViewportHeight: uniforms[9],
        visualMode: plumes ? 1 : 0,
        waterLevel: uniforms[14],
      },
    );
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, plan.count);
    if (showRain && !plumes) {
      const p = this.programs.grains;
      gl.uniform1f(location(gl, p, "particleBase"), S.RAIN_START);
      gl.uniform1f(location(gl, p, "particleDrawStride"), 1);
      gl.drawArrays(gl.POINTS, 0, S.RAIN_PARTICLES);
    }
    gl.disable(gl.BLEND);
  }
}
