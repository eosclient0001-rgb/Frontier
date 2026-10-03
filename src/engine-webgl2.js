/**
 * WebGL2 3D Eulerian Voxel Grid Pyro + Volumetric Hydro Solver
 * Uses 2D Tiled Volume Atlases (RGBA16F) so each 3D grid pass runs in a single draw call.
 * Supports liquid viscosity/foam/adhesion, 16³–128³ grids, and dynamic world bounds.
 */

import { RESOLUTION_OPTIONS } from './presets.js';
import {
  FULLSCREEN_VERT,
  EMITTER_SPLAT_FRAG,
  HYDRO_INJECT_FRAG,
  HYDRO_ADVECT_FRAG,
  HYDRO_DIVERGENCE_FRAG,
  HYDRO_PRESSURE_FRAG,
  HYDRO_GRADIENT_FRAG,
  ADVECTION_PYRO_FRAG,
  CURL_FRAG,
  FORCES_FRAG,
  DIVERGENCE_FRAG,
  PRESSURE_JACOBI_FRAG,
  GRADIENT_SUBTRACT_FRAG,
  VOLUMETRIC_RAYMARCH_FRAG,
  EMBER_PARTICLES_VERT,
  EMBER_PARTICLES_FRAG,
  ATLAS_MINIMAP_FRAG,
} from './shaders-glsl.js';

export class WebGL2PyroEngine {
  constructor(canvas, params) {
    this.canvas = canvas;
    this.params = params;
    this.backendName = 'WebGL2 (GLSL 300 es)';

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      throw new Error('WebGL2 is not supported on this browser/device.');
    }
    this.gl = gl;

    this.extColorBufferFloat = gl.getExtension('EXT_color_buffer_float');
    this.extFloatLinear = gl.getExtension('OES_texture_float_linear');

    this.time = 0.0;
    this.stepCount = 0;
    this.pendingBlasts = [];
    this.simDurationMs = 0.0;

    // Dynamic World-Space Bounding Box Surge State
    this.dynamicBoundsSurge = 0.0;
    this.dynamicBoundsTarget = 0.0;

    // Interactive 3D Flamethrower Brush state
    this.brushState = {
      active: false,
      pos: [0.5, 0.3, 0.5],
      vel: [0.0, 2.5, 0.0],
      radius: 0.1,
    };

    // Supersonic Shockwave state
    this.shockwaveAge = 99.0;
    this.shockwaveCenter = [0.5, 0.22, 0.5];

    // Ballistic Shrapnel / Debris Streamer Projectiles (up to 6 active)
    this.projectiles = [];
    this.liquidSplash = null;
    this.hydroInitialized = false;
    this.lastSimMode = Number(params.simMode) || 0;

    this.quadVAO = gl.createVertexArray();

    this.programs = {
      splat: this.createProgram(FULLSCREEN_VERT, EMITTER_SPLAT_FRAG),
      hydroInject: this.createProgram(FULLSCREEN_VERT, HYDRO_INJECT_FRAG),
      hydroAdvect: this.createProgram(FULLSCREEN_VERT, HYDRO_ADVECT_FRAG),
      hydroDivergence: this.createProgram(FULLSCREEN_VERT, HYDRO_DIVERGENCE_FRAG),
      hydroPressure: this.createProgram(FULLSCREEN_VERT, HYDRO_PRESSURE_FRAG),
      hydroGradient: this.createProgram(FULLSCREEN_VERT, HYDRO_GRADIENT_FRAG),
      advect: this.createProgram(FULLSCREEN_VERT, ADVECTION_PYRO_FRAG),
      curl: this.createProgram(FULLSCREEN_VERT, CURL_FRAG),
      forces: this.createProgram(FULLSCREEN_VERT, FORCES_FRAG),
      divergence: this.createProgram(FULLSCREEN_VERT, DIVERGENCE_FRAG),
      pressure: this.createProgram(FULLSCREEN_VERT, PRESSURE_JACOBI_FRAG),
      gradient: this.createProgram(FULLSCREEN_VERT, GRADIENT_SUBTRACT_FRAG),
      raymarch: this.createProgram(FULLSCREEN_VERT, VOLUMETRIC_RAYMARCH_FRAG),
      embers: this.createProgram(EMBER_PARTICLES_VERT, EMBER_PARTICLES_FRAG),
      atlasMinimap: this.createProgram(FULLSCREEN_VERT, ATLAS_MINIMAP_FRAG),
    };

    this.initEmberParticles(1000);
    this.initGridBuffers(params.gridResolution);
  }

  createShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`GLSL Compile Error:\n${info}`);
    }
    return shader;
  }

  createProgram(vsSource, fsSource) {
    const gl = this.gl;
    const vs = this.createShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.createShader(gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(`GLSL Link Error:\n${info}`);
    }

    const uniforms = {};
    const numUniforms = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < numUniforms; i++) {
      const info = gl.getActiveUniform(prog, i);
      const name = info.name.replace(/\[0\]$/, '');
      uniforms[name] = gl.getUniformLocation(prog, name);
    }

    return { prog, uniforms };
  }

  initEmberParticles(maxCount) {
    const gl = this.gl;
    this.maxEmbers = maxCount;
    const data = new Float32Array(maxCount * 4);
    for (let i = 0; i < maxCount; i++) {
      data[i * 4 + 0] = Math.random();
      data[i * 4 + 1] = Math.random();
      data[i * 4 + 2] = Math.random();
      data[i * 4 + 3] = Math.random();
    }

    this.emberVAO = gl.createVertexArray();
    this.emberVBO = gl.createBuffer();
    gl.bindVertexArray(this.emberVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.emberVBO);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    gl.bindVertexArray(null);
  }

  createVolumeTexture(width, height) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const internalFormat = this.extColorBufferFloat ? gl.RGBA16F : gl.RGBA8;
    const type = this.extColorBufferFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  createFBO(textures) {
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const drawBuffers = [];
    for (let i = 0; i < textures.length; i++) {
      const attachment = gl.COLOR_ATTACHMENT0 + i;
      gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, textures[i], 0);
      drawBuffers.push(attachment);
    }
    gl.drawBuffers(drawBuffers);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
  }

  initGridBuffers(resolution) {
    const gl = this.gl;
    const opt = RESOLUTION_OPTIONS.find((r) => r.value === Number(resolution)) || RESOLUTION_OPTIONS[4];
    this.gridRes = opt.value;
    this.tilesX = opt.tilesX;
    this.tilesY = opt.tilesY;
    this.atlasWidth = this.gridRes * this.tilesX;
    this.atlasHeight = this.gridRes * this.tilesY;

    if (this.buffers) {
      const { vel0, vel1, thermo0, thermo1, curl, div, pres0, pres1 } = this.buffers;
      [vel0, vel1, thermo0, thermo1, curl, div, pres0, pres1].forEach((t) => t && gl.deleteTexture(t));
      Object.values(this.fbos || {}).forEach((f) => f && gl.deleteFramebuffer(f));
    }

    const w = this.atlasWidth;
    const h = this.atlasHeight;

    this.buffers = {
      vel0: this.createVolumeTexture(w, h),
      vel1: this.createVolumeTexture(w, h),
      thermo0: this.createVolumeTexture(w, h),
      thermo1: this.createVolumeTexture(w, h),
      curl: this.createVolumeTexture(w, h),
      div: this.createVolumeTexture(w, h),
      pres0: this.createVolumeTexture(w, h),
      pres1: this.createVolumeTexture(w, h),
    };

    this.fbos = {
      velThermo0: this.createFBO([this.buffers.vel0, this.buffers.thermo0]),
      velThermo1: this.createFBO([this.buffers.vel1, this.buffers.thermo1]),
      vel0: this.createFBO([this.buffers.vel0]),
      vel1: this.createFBO([this.buffers.vel1]),
      curl: this.createFBO([this.buffers.curl]),
      div: this.createFBO([this.buffers.div]),
      pres0: this.createFBO([this.buffers.pres0]),
      pres1: this.createFBO([this.buffers.pres1]),
    };

    this.clearGrid();
  }

  setGridResolution(resolution) {
    if (Number(resolution) !== this.gridRes) {
      this.initGridBuffers(Number(resolution));
    }
  }

  clearGrid() {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    Object.values(this.fbos).forEach((fbo) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shockwaveAge = 99.0;
    this.dynamicBoundsSurge = 0.0;
    this.dynamicBoundsTarget = 0.0;
    this.projectiles = [];
    this.liquidSplash = null;
    this.hydroInitialized = false;
    this.hydroCollider = null;
  }

  setBrush(pos, vel, active = true) {
    this.brushState.active = active;
    if (pos) this.brushState.pos = pos;
    if (vel) this.brushState.vel = vel;
    if (active && this.params.dynamicBounds) {
      this.dynamicBoundsTarget = Math.max(this.dynamicBoundsTarget, 0.55);
    }
  }

  spawnShrapnelBurst(center = [0.5, 0.22, 0.5], count = 6) {
    this.projectiles = [];
    for (let i = 0; i < Math.min(6, count); i++) {
      const angle = (i / count) * Math.PI * 2.0 + (Math.random() - 0.5) * 0.45;
      const horizSpeed = 0.55 + Math.random() * 0.45;
      const upSpeed = 0.72 + Math.random() * 0.55;
      this.projectiles.push({
        pos: [center[0], Math.max(0.08, center[1]), center[2]],
        vel: [Math.cos(angle) * horizSpeed, upSpeed, Math.sin(angle) * horizSpeed],
        age: 0.0,
        maxLife: 1.55 + Math.random() * 0.65,
        radius: 0.052 + Math.random() * 0.018,
      });
    }
    this.dynamicBoundsTarget = Math.min(1.0, this.dynamicBoundsTarget + 0.75);
  }

  triggerLiquidSplash(options = {}) {
    const p = this.params;
    this.liquidSplash = {
      center: options.center || [0.5, p.waterPoolLevel ?? 0.25, 0.5],
      impulse: options.impulse ?? p.splashEnergy ?? 1.5,
      age: 0.0,
    };
    this.dynamicBoundsTarget = Math.min(1.0, this.dynamicBoundsTarget + 0.24);
  }

  triggerExplosion(options = {}) {
    const p = this.params;
    if (Number(p.simMode) === 1) {
      this.triggerLiquidSplash({
        center: options.center || [0.5, p.waterPoolLevel ?? 0.25, 0.5],
        impulse: options.impulse ?? Math.max(0.8, (options.strength ?? p.splashEnergy ?? 1.5) * 0.18),
      });
      return;
    }
    const center = options.center || [0.5, 0.18, 0.5];
    this.pendingBlasts.push({
      center,
      radius: options.radius ?? p.blastRadius,
      strength: options.strength ?? p.blastStrength,
      temp: options.temp ?? p.blastTemperature,
      fuel: options.fuel ?? p.blastFuel,
      smoke: options.smoke ?? p.blastSmoke,
      lobes: options.lobes ?? p.blastLobes,
      directionalVel: options.directionalVel || [0, 0, 0],
      seed: Math.random() * 100.0,
    });
    this.shockwaveCenter = [...center];
    this.shockwaveAge = 0.01;
    this.dynamicBoundsTarget = Math.min(1.0, this.dynamicBoundsTarget + 0.65);

    if (options.spawnShrapnel ?? p.shrapnelEnabled) {
      this.spawnShrapnelBurst(center, 6);
    }
  }

  /**
   * Computes the current active world-space bounding box [boxMin, boxMax] and domainScale
   */
  getBoundsBox() {
    const p = this.params;
    const maxMult = p.dynamicBoundsMax || 1.55;
    const surgeMult = p.dynamicBounds ? 1.0 + this.dynamicBoundsSurge * (maxMult - 1.0) : 1.0;

    const effWidth = (p.boundsWidth || 1.85) * surgeMult;
    const effHeight = (p.boundsHeight || 2.10) * (1.0 + (surgeMult - 1.0) * 1.15);

    const floorY = -0.6;
    const boxMin = [-0.5 * effWidth, floorY, -0.5 * effWidth];
    const boxMax = [0.5 * effWidth, floorY + effHeight, 0.5 * effWidth];
    const domainScale = [effWidth, effHeight / 1.2, effWidth];

    return { boxMin, boxMax, domainScale, effWidth, effHeight, surgeMult };
  }

  setCommonVolumeUniforms(u) {
    const gl = this.gl;
    if (u.uGridRes !== undefined) gl.uniform1i(u.uGridRes, this.gridRes);
    if (u.uTilesX !== undefined) gl.uniform1i(u.uTilesX, this.tilesX);
    if (u.uTilesY !== undefined) gl.uniform1i(u.uTilesY, this.tilesY);
    if (u.uAtlasSize !== undefined) gl.uniform2f(u.uAtlasSize, this.atlasWidth, this.atlasHeight);
  }

  bindTex(unit, tex, uniformLoc) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (uniformLoc !== undefined && uniformLoc !== null) {
      gl.uniform1i(uniformLoc, unit);
    }
  }

  getHydroColliderState() {
    const p = this.params;
    const type = Number(p.obstacleType) || 0;
    const speed = Math.max(0.05, Number(p.colliderSpeed) || 1.0);
    const baseX = Number.isFinite(p.obstacleX) ? p.obstacleX : 0.5;
    const baseZ = Number.isFinite(p.obstacleZ) ? p.obstacleZ : 0.5;
    const level = Number.isFinite(p.waterPoolLevel) ? p.waterPoolLevel : 0.25;
    const radius = Number.isFinite(p.obstacleRadius) ? p.obstacleRadius : 0.16;

    if (!p.colliderAutoMove || type === 0) {
      return {
        pos: [baseX, Number.isFinite(p.obstacleY) ? p.obstacleY : level + radius * 0.35, baseZ],
        vel: [0.0, 0.0, 0.0],
      };
    }

    const phase = this.time * speed * (type === 5 ? 0.72 : 0.58);
    const phaseZ = this.time * speed * (type === 5 ? 0.39 : 0.46) + 0.8;
    const ampX = type === 5 ? 0.29 : 0.25;
    const ampZ = type === 5 ? 0.075 : 0.17;
    const pos = [
      baseX + Math.sin(phase) * ampX,
      level + radius * (type === 5 ? 0.48 : 0.38),
      baseZ + Math.sin(phaseZ) * ampZ,
    ];
    const vel = [
      Math.cos(phase) * ampX * speed * (type === 5 ? 0.72 : 0.58),
      0.0,
      Math.cos(phaseZ) * ampZ * speed * (type === 5 ? 0.39 : 0.46),
    ];
    return { pos, vel };
  }

  swapHydroState() {
    [this.buffers.vel0, this.buffers.vel1] = [this.buffers.vel1, this.buffers.vel0];
    [this.buffers.thermo0, this.buffers.thermo1] = [this.buffers.thermo1, this.buffers.thermo0];
    [this.fbos.velThermo0, this.fbos.velThermo1] = [this.fbos.velThermo1, this.fbos.velThermo0];
    [this.fbos.vel0, this.fbos.vel1] = [this.fbos.vel1, this.fbos.vel0];
  }

  setHydroUniforms(u, dt, domainScale, collider, seedPool = 0) {
    const gl = this.gl;
    const p = this.params;
    const setI = (name, value) => {
      if (u[name] !== undefined && u[name] !== null) gl.uniform1i(u[name], value);
    };
    const setF = (name, value) => {
      if (u[name] !== undefined && u[name] !== null) gl.uniform1f(u[name], value);
    };
    const set3 = (name, value) => {
      if (u[name] !== undefined && u[name] !== null) gl.uniform3fv(u[name], value);
    };

    this.setCommonVolumeUniforms(u);
    setF('uDt', dt);
    setF('uTime', this.time);
    set3('uDomainScale', domainScale);
    setI('uHydroScene', p.hydroScene ?? 0);
    setI('uSeedPool', seedPool);
    setF('uWaterLevel', p.waterPoolLevel ?? 0.25);
    setF('uDamGateX', p.damGateX ?? 0.36);
    setF('uLiquidGravity', p.liquidGravity ?? 9.8);
    setF('uLiquidViscosity', p.liquidViscosity ?? 0.04);
    setF('uSurfaceAdhesion', p.surfaceAdhesion ?? 0.65);
    setF('uSurfaceTension', p.surfaceTension ?? 0.52);
    setF('uFoamGeneration', p.foamGeneration ?? 1.45);
    setF('uFoamDissipation', p.foamDissipation ?? 0.42);
    setF('uSplashEnergy', p.splashEnergy ?? 1.5);
    setI('uWaveMode', p.waveMode ?? 0);
    setF('uWaveHeight', p.waveHeight ?? 0.25);
    setF('uWaveSpeed', p.waveSpeed ?? 1.2);
    setI('uEnclosedBox', p.enclosedBox ? 1 : 0);

    setI('uObstacleType', Number(p.obstacleType) || 0);
    set3('uColliderPos', collider.pos);
    set3('uColliderVel', collider.vel);
    setF('uColliderRadius', p.obstacleRadius ?? 0.16);

    const splash = this.liquidSplash;
    set3('uSplashCenter', splash?.center || [0.5, p.waterPoolLevel ?? 0.25, 0.5]);
    setF('uSplashAge', splash?.age ?? 99.0);
    setF('uSplashImpulse', splash ? splash.impulse : 0.0);

    setI('uEmitterEnabled', p.emitterEnabled ? 1 : 0);
    setF('uEmitterRate', p.emitterRate ?? 1.0);
    setF('uEmitterRadius', p.emitterRadius ?? 0.09);
    setF('uEmitterPosY', p.emitterPosY ?? 0.76);
  }

  stepHydroSimulation(dt, domainScale) {
    const gl = this.gl;
    const p = this.params;
    const collider = this.getHydroColliderState();
    this.hydroCollider = collider;

    const drawStatePass = (programName, seedPool = 0, pressure = false) => {
      const { prog, uniforms: u } = this.programs[programName];
      gl.useProgram(prog);
      this.setHydroUniforms(u, dt, domainScale, collider, seedPool);
      this.bindTex(0, this.buffers.vel0, u.uVelocityTex);
      this.bindTex(1, this.buffers.thermo0, u.uThermoTex);
      if (pressure) {
        this.bindTex(2, this.buffers.pres0, u.uPressureTex);
        this.bindTex(3, this.buffers.div, u.uDivergenceTex);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.velThermo1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.swapHydroState();
    };

    // 1. Seed a real 3D liquid volume only once, then inject moving-body and
    // hand-triggered impulses into the evolving field.
    drawStatePass('hydroInject', this.hydroInitialized ? 0 : 1);

    // 2. Semi-Lagrangian advection + gravity + viscosity + surface tension.
    drawStatePass('hydroAdvect');

    // 3. Incompressibility projection.
    {
      const { prog, uniforms: u } = this.programs.hydroDivergence;
      gl.useProgram(prog);
      this.setHydroUniforms(u, dt, domainScale, collider, 0);
      this.bindTex(0, this.buffers.vel0, u.uVelocityTex);
      this.bindTex(1, this.buffers.thermo0, u.uThermoTex);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.div);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // 4. Jacobi pressure iterations. More iterations reduce compressibility in
    // the dam-break and make the splash volume behave less like a decal.
    {
      const { prog, uniforms: u } = this.programs.hydroPressure;
      gl.useProgram(prog);
      this.setHydroUniforms(u, dt, domainScale, collider, 0);
      this.bindTex(0, this.buffers.vel0, u.uVelocityTex);
      this.bindTex(1, this.buffers.thermo0, u.uThermoTex);
      this.bindTex(3, this.buffers.div, u.uDivergenceTex);
      const iterations = Math.max(6, Math.min(48, Math.round(p.pressureIterations)));
      for (let i = 0; i < iterations; i++) {
        const readTex = i % 2 === 0 ? this.buffers.pres0 : this.buffers.pres1;
        const writeFbo = i % 2 === 0 ? this.fbos.pres1 : this.fbos.pres0;
        this.bindTex(2, readTex, u.uPressureTex);
        gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (iterations % 2 === 1) {
        [this.buffers.pres0, this.buffers.pres1] = [this.buffers.pres1, this.buffers.pres0];
        [this.fbos.pres0, this.fbos.pres1] = [this.fbos.pres1, this.fbos.pres0];
      }
    }

    // 5. Subtract pressure gradient and keep the liquid fraction/foam state.
    {
      const { prog, uniforms: u } = this.programs.hydroGradient;
      gl.useProgram(prog);
      this.setHydroUniforms(u, dt, domainScale, collider, 0);
      this.bindTex(0, this.buffers.vel0, u.uVelocityTex);
      this.bindTex(1, this.buffers.thermo0, u.uThermoTex);
      this.bindTex(2, this.buffers.pres0, u.uPressureTex);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.velThermo1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.swapHydroState();
    }

    this.hydroInitialized = true;
    if (this.liquidSplash) {
      this.liquidSplash.age += dt;
      if (this.liquidSplash.age > 2.75) this.liquidSplash = null;
    }
  }

  stepSimulation(rawDt) {
    const gl = this.gl;
    const p = this.params;
    const t0 = performance.now();

    const dt = Math.min(rawDt, 0.033) * p.timeScale;
    this.time += dt;
    this.stepCount++;

    const simMode = Number(p.simMode) || 0;
    if (simMode !== this.lastSimMode) {
      // Pyro and hydro share atlas memory but encode completely different
      // channels. Clearing on a mode switch prevents soot from becoming
      // chocolate or stale fire from appearing as foam.
      const preserveSplash = this.liquidSplash;
      const preserveBlasts = this.pendingBlasts;
      this.clearGrid();
      this.liquidSplash = simMode === 1 ? preserveSplash : null;
      this.pendingBlasts = simMode === 0 ? preserveBlasts : [];
      this.lastSimMode = simMode;
    }
    if (this.shockwaveAge < 2.0) {
      this.shockwaveAge += dt * 1.45;
    }

    // Update Dynamic Bounds Surge (expands fast on blast, relaxes gently over time)
    if (p.dynamicBounds) {
      const riseSpeed = this.dynamicBoundsTarget > this.dynamicBoundsSurge ? 2.8 : 0.45;
      this.dynamicBoundsSurge += (this.dynamicBoundsTarget - this.dynamicBoundsSurge) * Math.min(1.0, dt * riseSpeed);
      this.dynamicBoundsTarget = Math.max(0.0, this.dynamicBoundsTarget - dt * 0.22);
    } else {
      this.dynamicBoundsSurge = 0.0;
      this.dynamicBoundsTarget = 0.0;
    }

    const { domainScale } = this.getBoundsBox();

    if (simMode === 1) {
      gl.bindVertexArray(this.quadVAO);
      gl.viewport(0, 0, this.atlasWidth, this.atlasHeight);
      gl.disable(gl.BLEND);
      this.stepHydroSimulation(dt, domainScale);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.simDurationMs = performance.now() - t0;
      return;
    }

    // Update Ballistic Shrapnel Projectiles (Parabolic arcs + floor bounce)
    const projPosData = new Float32Array(24);
    const projVelData = new Float32Array(24);
    let activeProjCount = 0;

    for (let i = 0; i < this.projectiles.length; i++) {
      const pr = this.projectiles[i];
      pr.age += dt;
      if (pr.age >= pr.maxLife) continue;

      pr.pos[0] += (pr.vel[0] / Math.max(1.0, domainScale[0] * 0.7)) * dt;
      pr.pos[1] += (pr.vel[1] / Math.max(1.0, domainScale[1] * 0.7)) * dt;
      pr.pos[2] += (pr.vel[2] / Math.max(1.0, domainScale[2] * 0.7)) * dt;
      pr.vel[1] -= 1.28 * dt; // Gravity pulling shrapnel into a ballistic arc

      // Bounce off the studio floor at y = 0.04
      if (pr.pos[1] < 0.04 && pr.vel[1] < 0.0) {
        pr.pos[1] = 0.04;
        pr.vel[1] = -pr.vel[1] * 0.48;
        pr.vel[0] *= 0.72;
        pr.vel[2] *= 0.72;
      }

      if (pr.pos[0] > 0.04 && pr.pos[0] < 0.96 && pr.pos[2] > 0.04 && pr.pos[2] < 0.96 && pr.pos[1] < 0.95) {
        const lifeFade = Math.max(0.0, 1.0 - pr.age / pr.maxLife);
        projPosData[activeProjCount * 4 + 0] = pr.pos[0];
        projPosData[activeProjCount * 4 + 1] = pr.pos[1];
        projPosData[activeProjCount * 4 + 2] = pr.pos[2];
        projPosData[activeProjCount * 4 + 3] = lifeFade;

        projVelData[activeProjCount * 4 + 0] = pr.vel[0] * 6.5;
        projVelData[activeProjCount * 4 + 1] = pr.vel[1] * 6.5;
        projVelData[activeProjCount * 4 + 2] = pr.vel[2] * 6.5;
        projVelData[activeProjCount * 4 + 3] = pr.radius * (0.65 + 0.35 * lifeFade);
        activeProjCount++;
      }
    }

    gl.bindVertexArray(this.quadVAO);
    gl.viewport(0, 0, this.atlasWidth, this.atlasHeight);
    gl.disable(gl.BLEND);

    // --- PASS 1: Emitter Splat + Detonation + 3D Flamethrower Brush + Shrapnel + Obstacle ---
    {
      const { prog, uniforms: u } = this.programs.splat;
      gl.useProgram(prog);
      this.setCommonVolumeUniforms(u);
      gl.uniform1f(u.uDt, dt);
      gl.uniform1f(u.uTime, this.time);
      gl.uniform3fv(u.uDomainScale, domainScale);

      gl.uniform1i(u.uEmitterEnabled, p.emitterEnabled ? 1 : 0);
      gl.uniform1f(u.uEmitterRate, p.emitterRate);
      gl.uniform1f(u.uEmitterRadius, p.emitterRadius);
      gl.uniform1f(u.uEmitterHeight, p.emitterHeight);
      gl.uniform1f(u.uEmitterUpwardVel, p.emitterUpwardVelocity);
      gl.uniform1f(u.uEmitterSwirl, p.emitterSwirl);
      gl.uniform1f(u.uEmitterTemp, p.emitterTemperature);
      gl.uniform1f(u.uEmitterFuel, p.emitterFuel);
      gl.uniform1f(u.uEmitterSmoke, p.emitterSmoke);

      gl.uniform1i(u.uBrushActive, this.brushState.active ? 1 : 0);
      gl.uniform3fv(u.uBrushPos, this.brushState.pos);
      gl.uniform3fv(u.uBrushVel, this.brushState.vel);
      gl.uniform1f(u.uBrushRadius, this.brushState.radius);

      gl.uniform1i(u.uProjectilesActive, activeProjCount > 0 ? 1 : 0);
      if (activeProjCount > 0) {
        gl.uniform4fv(u.uProjectiles, projPosData);
        gl.uniform4fv(u.uProjectileVels, projVelData);
      }

      const blast = this.pendingBlasts.shift();
      if (blast) {
        gl.uniform1i(u.uBlastActive, 1);
        gl.uniform3f(u.uBlastCenter, blast.center[0], blast.center[1], blast.center[2]);
        gl.uniform1f(u.uBlastRadius, blast.radius);
        gl.uniform1f(u.uBlastStrength, blast.strength);
        gl.uniform1f(u.uBlastTemp, blast.temp);
        gl.uniform1f(u.uBlastFuel, blast.fuel);
        gl.uniform1f(u.uBlastSmoke, blast.smoke);
        gl.uniform1f(u.uBlastLobes, blast.lobes);
        gl.uniform1f(u.uBlastSeed, blast.seed);
        gl.uniform3f(
          u.uBlastDirectionalVel,
          blast.directionalVel[0],
          blast.directionalVel[1],
          blast.directionalVel[2]
        );
      } else {
        gl.uniform1i(u.uBlastActive, 0);
      }

      gl.uniform1i(u.uObstacleType, p.obstacleType);
      gl.uniform3f(u.uObstaclePos, p.obstacleX, p.obstacleY, p.obstacleZ);
      gl.uniform1f(u.uObstacleRadius, p.obstacleRadius);

      this.bindTex(0, this.buffers.vel0, u.uVelocityTex);
      this.bindTex(1, this.buffers.thermo0, u.uThermoTex);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.velThermo1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // --- PASS 2: Semi-Lagrangian / MacCormack Advection + Pyro Chemistry ---
    {
      const { prog, uniforms: u } = this.programs.advect;
      gl.useProgram(prog);
      this.setCommonVolumeUniforms(u);
      gl.uniform1f(u.uDt, dt);
      gl.uniform1f(u.uTime, this.time);
      gl.uniform1i(u.uMacCormack, p.macCormackAdvection ? 1 : 0);
      gl.uniform1i(u.uEnclosedBox, p.enclosedBox ? 1 : 0);
      gl.uniform3fv(u.uDomainScale, domainScale);

      gl.uniform1f(u.uBurnRate, p.burnRate);
      gl.uniform1f(u.uBurnHeat, p.burnHeat);
      gl.uniform1f(u.uSootGen, p.sootGeneration);
      gl.uniform1f(u.uCoolingRate, p.coolingRate);
      gl.uniform1f(u.uSmokeDissipation, p.smokeDissipation);
      gl.uniform1f(u.uVelocityDamping, p.velocityDamping);

      this.bindTex(0, this.buffers.vel1, u.uVelocityTex);
      this.bindTex(1, this.buffers.thermo1, u.uThermoTex);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.velThermo0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // --- PASS 3: 3D Curl (Vorticity) ---
    {
      const { prog, uniforms: u } = this.programs.curl;
      gl.useProgram(prog);
      this.setCommonVolumeUniforms(u);
      this.bindTex(0, this.buffers.vel0, u.uVelocityTex);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.curl);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // --- PASS 4: Vorticity Confinement + Buoyancy + Baroclinic Roll + Turbulence ---
    {
      const { prog, uniforms: u } = this.programs.forces;
      gl.useProgram(prog);
      this.setCommonVolumeUniforms(u);
      gl.uniform1f(u.uDt, dt);
      gl.uniform1f(u.uTime, this.time);
      gl.uniform1f(u.uVorticityConfinement, p.vorticityConfinement);
      gl.uniform1f(u.uBuoyancy, p.buoyancy);
      gl.uniform1f(u.uSmokeWeight, p.smokeWeight);
      gl.uniform1f(u.uTurbulenceStrength, p.turbulenceStrength);
      gl.uniform1f(u.uTurbulenceScale, p.turbulenceScale);
      gl.uniform2f(u.uWindXZ, p.windX, p.windZ);

      this.bindTex(0, this.buffers.vel0, u.uVelocityTex);
      this.bindTex(1, this.buffers.thermo0, u.uThermoTex);
      this.bindTex(2, this.buffers.curl, u.uCurlTex);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.vel1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // --- PASS 5: Velocity Divergence + Combustion Gas Expansion ---
    {
      const { prog, uniforms: u } = this.programs.divergence;
      gl.useProgram(prog);
      this.setCommonVolumeUniforms(u);
      gl.uniform1f(u.uCombustionExpansion, p.combustionExpansion);

      this.bindTex(0, this.buffers.vel1, u.uVelocityTex);
      this.bindTex(1, this.buffers.thermo0, u.uThermoTex);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.div);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // --- PASS 6: Jacobi Poisson Pressure + 3D Fire Irradiance Solver ---
    {
      const { prog, uniforms: u } = this.programs.pressure;
      gl.useProgram(prog);
      this.setCommonVolumeUniforms(u);
      this.bindTex(1, this.buffers.div, u.uDivergenceTex);
      this.bindTex(2, this.buffers.vel1, u.uVelocityTex);

      const iterations = Math.max(4, Math.min(50, Math.round(p.pressureIterations)));
      for (let i = 0; i < iterations; i++) {
        const readTex = i % 2 === 0 ? this.buffers.pres0 : this.buffers.pres1;
        const writeFbo = i % 2 === 0 ? this.fbos.pres1 : this.fbos.pres0;
        this.bindTex(0, readTex, u.uPressureTex);
        gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (iterations % 2 === 1) {
        const tmpTex = this.buffers.pres0;
        this.buffers.pres0 = this.buffers.pres1;
        this.buffers.pres1 = tmpTex;
        const tmpFbo = this.fbos.pres0;
        this.fbos.pres0 = this.fbos.pres1;
        this.fbos.pres1 = tmpFbo;
      }
    }

    // --- PASS 7: Pressure Gradient Subtraction ---
    {
      const { prog, uniforms: u } = this.programs.gradient;
      gl.useProgram(prog);
      this.setCommonVolumeUniforms(u);
      this.bindTex(0, this.buffers.vel1, u.uVelocityTex);
      this.bindTex(1, this.buffers.pres0, u.uPressureTex);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.vel0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.simDurationMs = performance.now() - t0;
  }

  render(camera) {
    const gl = this.gl;
    const p = this.params;
    const width = this.canvas.width;
    const height = this.canvas.height;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);

    const az = (p.sunAzimuth * Math.PI) / 180;
    const el = (p.sunElevation * Math.PI) / 180;
    const sunX = Math.cos(el) * Math.sin(az);
    const sunY = Math.sin(el);
    const sunZ = Math.cos(el) * Math.cos(az);

    const tanHalfFov = Math.tan(camera.fovY * 0.5);
    const { boxMin, boxMax, domainScale } = this.getBoundsBox();
    const renderCollider = Number(p.simMode) === 1 ? (this.hydroCollider || this.getHydroColliderState()) : null;

    // --- PASS 8: Full-Viewport Volumetric Raymarching ---
    {
      const { prog, uniforms: u } = this.programs.raymarch;
      gl.useProgram(prog);
      this.setCommonVolumeUniforms(u);

      gl.uniform3fv(u.uBoxMin, boxMin);
      gl.uniform3fv(u.uBoxMax, boxMax);
      gl.uniform3fv(u.uDomainScale, domainScale);
      gl.uniform1i(u.uSimMode, Number(p.simMode) || 0);
      gl.uniform1f(u.uLiquidViscosity, p.liquidViscosity ?? 0.04);
      gl.uniform1f(u.uSurfaceAdhesion, p.surfaceAdhesion ?? 0.65);
      gl.uniform1f(u.uSurfaceTension, p.surfaceTension ?? 0.52);
      gl.uniform1f(u.uLiquidSpecular, p.liquidSpecular ?? 1.35);
      gl.uniform1f(u.uWaterAbsorption, p.waterAbsorption ?? 0.72);
      gl.uniform1f(u.uWaterScattering, p.waterScattering ?? 0.08);
      gl.uniform1f(u.uWaterRoughness, p.waterRoughness ?? 0.14);
      gl.uniform1f(u.uWaterSurfaceThreshold, p.waterSurfaceThreshold ?? 0.18);
      gl.uniform1f(u.uWaterRefraction, p.waterRefraction ?? 0.78);
      gl.uniform1f(u.uWaterLightIntensity, p.waterLightIntensity ?? 1.15);
      gl.uniform1f(u.uWaterAmbientIntensity, p.waterAmbientIntensity ?? 0.34);
      gl.uniform1f(u.uWaterExposure, p.waterExposure ?? 1.0);
      gl.uniform1f(u.uCausticsIntensity, p.causticsIntensity ?? 0.70);
      gl.uniform1f(u.uWaterPoolLevel, p.waterPoolLevel ?? 0.25);

      gl.uniform3fv(u.uCamPos, camera.position);
      gl.uniform3fv(u.uCamForward, camera.forward);
      gl.uniform3fv(u.uCamRight, camera.right);
      gl.uniform3fv(u.uCamUp, camera.up);
      gl.uniform1f(u.uTanHalfFov, tanHalfFov);
      gl.uniform1f(u.uAspect, camera.aspect);
      gl.uniform2f(u.uResolution, width, height);
      gl.uniform1f(u.uTime, this.time);

      gl.uniform1i(u.uRenderChannel, p.renderChannel);
      gl.uniform1i(u.uColorPalette, p.colorPalette);
      gl.uniform1i(u.uRaymarchSteps, p.raymarchSteps);
      gl.uniform1i(u.uShadowSteps, p.shadowSteps);
      gl.uniform1f(u.uVoxelQuantization, p.voxelQuantization);
      gl.uniform1f(u.uDensityExtinction, p.densityExtinction);
      gl.uniform1f(u.uSmokeAlbedo, p.smokeAlbedo);
      gl.uniform1f(u.uShadowDensity, p.shadowDensity);
      gl.uniform1f(u.uFireIntensity, p.fireIntensity);
      gl.uniform1f(u.uTemperatureScale, p.temperatureScale);
      gl.uniform1f(u.uInternalScattering, p.internalScattering);
      gl.uniform1f(u.uPhaseAnisotropy, p.phaseAnisotropy);
      gl.uniform1f(u.uAmbientIntensity, p.ambientIntensity);
      gl.uniform1f(u.uSunIntensity, p.sunIntensity);
      gl.uniform3f(u.uSunDir, sunX, sunY, sunZ);
      gl.uniform1f(u.uExposure, p.exposure);
      gl.uniform1f(u.uBloomIntensity, p.bloomIntensity ?? 0.55);
      gl.uniform1f(u.uGodRaysIntensity, p.godRaysIntensity ?? 0.45);

      gl.uniform1f(u.uShockwaveAge, this.shockwaveAge);
      gl.uniform3fv(u.uShockwaveCenter, this.shockwaveCenter);
      gl.uniform1f(u.uShockwaveStrength, p.shockwaveStrength ?? 1.0);

      gl.uniform1i(u.uSliceAxis, p.sliceAxis);
      gl.uniform1f(u.uSlicePos, p.slicePosition);

      gl.uniform1i(u.uObstacleType, p.obstacleType);
      gl.uniform3f(u.uObstaclePos, p.obstacleX, p.obstacleY, p.obstacleZ);
      gl.uniform1f(u.uObstacleRadius, p.obstacleRadius);
      gl.uniform1i(u.uShowBoundingBox, p.showBoundingBox ? 1 : 0);
      gl.uniform1i(u.uShowVoxelGridLines, p.showVoxelGridLines ? 1 : 0);
      gl.uniform1i(u.uShowActiveVoxelCells, p.showActiveVoxelCells ? 1 : 0);
      gl.uniform1i(u.uShowFloorGrid, p.showFloorGrid ? 1 : 0);

      this.bindTex(0, this.buffers.thermo0, u.uThermoTex);
      this.bindTex(1, this.buffers.vel0, u.uVelocityTex);
      this.bindTex(2, this.buffers.curl, u.uCurlTex);
      this.bindTex(3, this.buffers.pres0, u.uPressureTex);

      gl.bindVertexArray(this.quadVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // --- PASS 9: GPU Advected Hot Ember Particles (Additive Blend) ---
    if (Number(p.simMode) === 0 && p.showEmbers && p.emberCount > 0 && p.renderChannel <= 1) {
      const { prog, uniforms: u } = this.programs.embers;
      gl.useProgram(prog);
      this.setCommonVolumeUniforms(u);
      gl.uniform1f(u.uTime, this.time);
      gl.uniform3fv(u.uBoxMin, boxMin);
      gl.uniform3fv(u.uBoxMax, boxMax);
      gl.uniform3fv(u.uCamPos, camera.position);
      gl.uniform3fv(u.uCamForward, camera.forward);
      gl.uniform3fv(u.uCamRight, camera.right);
      gl.uniform3fv(u.uCamUp, camera.up);
      gl.uniform1f(u.uTanHalfFov, tanHalfFov);
      gl.uniform1f(u.uAspect, camera.aspect);
      gl.uniform1f(u.uEmberSize, p.emberSize ?? 1.0);
      gl.uniform1f(u.uEmberLifetime, p.emberLifetime ?? 1.0);
      gl.uniform1f(u.uEmberIntensity, p.emberIntensity ?? 1.4);
      gl.uniform1f(u.uEmberAshiness, p.emberAshiness ?? 0.0);

      this.bindTex(0, this.buffers.vel0, u.uVelocityTex);
      this.bindTex(1, this.buffers.thermo0, u.uThermoTex);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.bindVertexArray(this.emberVAO);
      gl.drawArrays(gl.POINTS, 0, Math.min(this.maxEmbers, p.emberCount));
      gl.disable(gl.BLEND);
    }

    // --- PASS 10: Live 2D Tiled 3D Voxel Atlas Picture-in-Picture (PiP) Minimap ---
    if (p.showAtlasMinimap) {
      const pipWidth = Math.min(210, Math.floor(width * 0.2));
      const pipHeight = Math.floor(pipWidth * (this.tilesY / this.tilesX));
      const margin = 14;
      const bottomOffset = 108;

      gl.viewport(width - pipWidth - margin, bottomOffset, pipWidth, pipHeight);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      const { prog, uniforms: u } = this.programs.atlasMinimap;
      gl.useProgram(prog);
      gl.uniform1i(u.uFieldMode, p.atlasMinimapField || 0);
      gl.uniform1i(u.uSimMode, Number(p.simMode) || 0);
      gl.uniform1i(u.uTilesX, this.tilesX);
      gl.uniform1i(u.uTilesY, this.tilesY);

      let targetTex = this.buffers.thermo0;
      if (p.atlasMinimapField === 1) targetTex = this.buffers.vel0;
      if (p.atlasMinimapField === 2) targetTex = this.buffers.curl;
      if (p.atlasMinimapField === 3) targetTex = this.buffers.pres0;

      this.bindTex(0, targetTex, u.uAtlasTex);
      gl.bindVertexArray(this.quadVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.disable(gl.BLEND);
      gl.viewport(0, 0, width, height);
    }
  }

  destroy() {
    const gl = this.gl;
    if (this.buffers) {
      Object.values(this.buffers).forEach((t) => t && gl.deleteTexture(t));
    }
    if (this.fbos) {
      Object.values(this.fbos).forEach((f) => f && gl.deleteFramebuffer(f));
    }
    if (this.programs) {
      Object.values(this.programs).forEach((p) => p && gl.deleteProgram(p.prog));
    }
  }
}
