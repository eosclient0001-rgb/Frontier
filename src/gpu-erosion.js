import { assertSelectionMask } from "./selection-result.js";
import { shapeFragment, detailBrushFragment } from "./object-shaders.js";
import { noiseUniforms } from "./volume-noise.js";
import { FlowPathTexture, sampleSpline } from "./splines.js";
import { pathCutFragment, heightBrushFragment } from "./spline-shaders.js";
import { cellCutFragment } from "./cell-fracture-shaders.js";
import { uploadCellPatterns } from "./cell-fracture.js";
import * as F from "./fracture-shaders.js";
import { makePlane } from "./fractures.js";
import { SIZE, CELL } from "./field.js";
import { withDeadline } from "./render-health.js";
import * as S from "./erosion-shaders.js";

const WIDTH = SIZE[0] * S.ATLAS_COLS;
const HEIGHT = SIZE[1] * Math.ceil(SIZE[2] / S.ATLAS_COLS);
const VOLUME = CELL[0] * CELL[1] * CELL[2];

export function program(gl, vertex, fragment, label) {
  const p = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ]) {
    const shader = gl.createShader(type);
    gl.shaderSource(
      shader,
      gl.getExtension("OES_texture_float_linear")
        ? source.replace(
            "#version 300 es",
            "#version 300 es\n#define LINEAR_VOLUME",
          )
        : source,
    );
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      gl.deleteProgram(p);
      throw new Error(`${label}: ${message}`);
    }
    gl.attachShader(p, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(`${label}: ${gl.getProgramInfoLog(p)}`);
  return { handle: p, locations: new Map(), label };
}
function location(gl, p, name) {
  if (!p.locations.has(name))
    p.locations.set(name, gl.getUniformLocation(p.handle, name));
  return p.locations.get(name);
}

export class GPUErosion {
  constructor(gl) {
    this.gl = gl;
    this.flowPaths = new FlowPathTexture(gl);
    this.flowPaths.update({});
    this.tick = 0;
    this.volumeIndex = 0;
    this.motionIndex = 0;
    this.cargoIndex = 0;
    this.materialIndex = 0;
    this.activeCount = 1024;
    this.sculpted = false;
    if (!gl.getExtension("EXT_color_buffer_float"))
      throw new Error(
        "GPU erosion requires EXT_color_buffer_float. No CPU erosion is substituted.",
      );
    this.floatBlend = !!gl.getExtension("EXT_float_blend");
    if (gl.getParameter(gl.MAX_TEXTURE_SIZE) < WIDTH)
      throw new Error(`GPU erosion requires ${WIDTH}-pixel textures.`);
    this.fbo = gl.createFramebuffer();
    this.vao = gl.createVertexArray();
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
    if (this.linear)
      for (const t of this.materials) {
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
    this.acceptance = this.texture(WIDTH, HEIGHT);
    this.pickTarget = this.texture(1, 1);
    this.programs = {};
    for (const [name, code] of Object.entries({
      motion: S.motionFragment,
      event: S.eventFragment,
      apply: S.applyFragment,
      cargo: S.cargoFragment,
      distance: S.distanceFragment,
      sculpt: S.sculptFragment,
      pick: S.pickFragment,
    }))
      this.programs[name] = program(
        gl,
        S.fullscreenVertex,
        code,
        `GPU erosion / ${name}`,
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
    this.target([this.volumes[0]], WIDTH, HEIGHT);
    this.target(
      [this.positions[0], this.velocities[0], this.metadata[0], this.impacts],
      ...S.PARTICLE_SIZE,
    );
    this.target([this.requests], WIDTH, HEIGHT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  get material() {
    return this.materials[this.materialIndex];
  }
  get volume() {
    return this.volumes[this.volumeIndex];
  }
  texture(w, h, format = this.gl.RGBA32F) {
    const gl = this.gl,
      t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
    for (const pname of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
      gl.texParameteri(gl.TEXTURE_2D, pname, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  uploadTexture(texture, w, h, data) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data);
  }
  upload(data) {
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
          const solid = Math.max(0, Math.min(1, 0.5 - a[i] / (2 * S.BAND)));
          a[i + 3] = solid;
          mass += solid * VOLUME;
        }
      }
    this.volumeIndex = 0;
    this.uploadTexture(this.volume, WIDTH, HEIGHT, a);
    const empty = new Float32Array(S.MAX_PARTICLES * 4),
      p = empty.slice();
    for (let i = 3; i < p.length; i += 4) p[i] = -1;
    for (let i = 0; i < 2; i++) {
      this.uploadTexture(this.positions[i], ...S.PARTICLE_SIZE, p);
      this.uploadTexture(this.velocities[i], ...S.PARTICLE_SIZE, empty);
      this.uploadTexture(this.cargos[i], ...S.PARTICLE_SIZE, empty);
      this.uploadTexture(this.metadata[i], ...S.PARTICLE_SIZE, empty);
      this.uploadTexture(this.species[i], ...S.PARTICLE_SIZE, empty);
      this.target([this.materials[i]], WIDTH, HEIGHT);
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
    this.uploadTexture(this.contacts, ...S.PARTICLE_SIZE, empty);
    this.uploadTexture(this.exchanges, ...S.PARTICLE_SIZE, empty);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.materialIndex = 0;
    this.tick = 0;
    this.motionIndex = 0;
    this.cargoIndex = 0;
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
    this.target(targets, w, h);
    this.use(this.programs[name], textures, values);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }
  advance(params) {
    this.bakeSplineCuts();
    this.flowPaths.update(params);
    this.clearFractureSelection();
    this.fractureUndoValid = false;
    const gl = this.gl;
    this.activeCount = params.particleCount || 1024;
    const values = {
      physics: [0.04, params.rainfall, params.restitution ?? 0.08, params.wind],
      process: [
        params.erosion,
        params.hardness,
        params.deposition,
        params.capacity ?? 0.6,
      ],
      config: [
        params.footprint ?? 0.85,
        params.grainSize ?? 0.15,
        this.activeCount,
        params.sourceMode || 0,
      ],
      canyonShape: [
        params.canyonWidth ?? 6.1,
        params.canyonMeander ?? 1,
        params.canyonFlare ?? 0.105,
        0,
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
      environment: [params.waterLevel, params.strata, params.seed, this.tick],
    };
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
        flowPaths: this.flowPaths.texture,
        positions: previousPositions,
        velocities: previousVelocity,
        cargo: oldCargo,
        metadata: this.metadata[this.motionIndex],
        species: oldSpecies,
      },
      values,
    );
    this.pass(
      "event",
      [this.contacts, this.exchanges],
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
        materials: oldMaterial,
      },
      values,
    );
    this.target([this.requests, this.speciesRequests], WIDTH, HEIGHT);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.use(
      this.programs.splat,
      {
        terrain: oldVolume,
        contacts: this.contacts,
        exchanges: this.exchanges,
        species: oldSpecies,
        metadata: this.metadata[motion],
        positions: this.positions[motion],
      },
      { waterLevel: params.waterLevel },
    );
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArraysInstanced(
      gl.TRIANGLES,
      0,
      6,
      this.activeCount * S.SLICE_COUNT,
    );
    gl.disable(gl.BLEND);
    this.pass(
      "apply",
      [this.volumes[nextVolume], this.acceptance, this.materials[nextMaterial]],
      WIDTH,
      HEIGHT,
      {
        terrain: oldVolume,
        requests: this.requests,
        materials: oldMaterial,
        speciesRequests: this.speciesRequests,
      },
    );
    // Feedback reads the same old volume/kernel used in the scatter and the
    // per-voxel acceptance ratios, so overlapping agents don't invent sediment.
    this.pass(
      "cargo",
      [this.cargos[nextCargo], this.species[nextCargo]],
      ...S.PARTICLE_SIZE,
      {
        terrain: oldVolume,
        contacts: this.contacts,
        exchanges: this.exchanges,
        acceptance: this.acceptance,
        positions: this.positions[motion],
        previousPositions,
        cargo: oldCargo,
        metadata: this.metadata[motion],
        species: oldSpecies,
        impacts: this.impacts,
        materials: oldMaterial,
      },
      values,
    );
    this.pass("distance", [this.volumes[this.volumeIndex]], WIDTH, HEIGHT, {
      terrain: this.volumes[nextVolume],
    });
    this.materialIndex = nextMaterial;
    this.motionIndex = motion;
    this.cargoIndex = nextCargo;
    this.tick++;
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`GPU erosion GL error ${error}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  async complete() {
    const gl = this.gl,
      sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    let cancelled = false,
      timer;
    try {
      await withDeadline(
        new Promise((resolve, reject) => {
          const poll = () => {
            if (cancelled) return;
            const result = gl.clientWaitSync(sync, 0, 0);
            if (result === gl.WAIT_FAILED)
              reject(new Error("GPU erosion fence failed"));
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
    for (let i = 0; i < count; i++) this.advance(params);
    await this.complete();
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
    if (cuts.length) this.sculpted = true;
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
    for (let i = 3; i < volume.length; i += 4) solid += volume[i] * VOLUME;
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
    const composition = [0, 0, 0, 0],
      byMode = Array.from({ length: 6 }, () => ({
        active: 0,
        meanY: 0,
        meanVz: 0,
        meanDiameter: 0,
      }));
    for (let i = 0; i < mixes.length; i += 4) {
      for (let k = 0; k < 4; k++) composition[k] += mixes[i + k];
      if (i / 4 < this.activeCount && positions[i + 3] >= 0) {
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
    return {
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
      active,
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
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.bindVertexArray(this.vao);
    this.use(
      this.programs.grains,
      {
        terrain: this.volume,
        positions: this.positions[this.motionIndex],
        cargo: this.cargos[this.cargoIndex],
        exchanges: this.exchanges,
        metadata: this.metadata[this.motionIndex],
        species: this.species[this.cargoIndex],
      },
      {
        eye: uniforms.subarray(0, 4),
        target: uniforms.subarray(4, 8),
        activeCount: this.activeCount,
        visualMode: plumes ? 1 : 0,
        waterLevel: uniforms[14],
      },
    );
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, this.activeCount);
    gl.disable(gl.BLEND);
  }
}
