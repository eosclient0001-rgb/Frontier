const halfToFloat = (h) => {
  const sign = (h & 0x8000) >> 15 ? -1 : 1;
  const exp = (h & 0x7c00) >> 10;
  const frac = h & 0x03ff;
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
  if (exp === 0x1f) return frac ? NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
};

import { Program } from '../gpu/WebGPU.js';
import { UniformPacker, SIM_LAYOUT, EmitterPacker } from '../gpu/UniformBuilder.js';
import { WGSL_ADVECT } from './shaders/advect.wgsl.js';
import { WGSL_SOURCES } from './shaders/sources.wgsl.js';
import { WGSL_CURL } from './shaders/curl.wgsl.js';
import { WGSL_VORTICITY } from './shaders/vorticity.wgsl.js';
import { WGSL_DIVERGENCE, WGSL_JACOBI, WGSL_PROJECT } from './shaders/projection.wgsl.js';
import { WGSL_CLEAR_STATE, WGSL_CLEAR_SOLVER } from './shaders/clear.wgsl.js';
import { WGSL_SDF } from './shaders/sdf.wgsl.js';

const WORKGROUP = 4;

/**
 * GPU Eulerian fluid solver (Niagara "Grid3D" style).
 *
 * Fields live in 3D textures and every pass is a compute shader over the voxel
 * grid. Storage textures can be written but not read inside a pass, so the
 * solver is built entirely from sampled-texture -> storage-texture pass pairs.
 * That constraint is a feature: it means hardware trilinear filtering performs
 * every interpolation in the solver for free, and the same textures can be
 * handed straight to the raymarcher.
 *
 *   advect      RK2 semi-Lagrangian transport of velocity + scalars
 *   sources     emitters, combustion, buoyancy, wind, blast, turbulence, cooling
 *   curl        curl of velocity
 *   vorticity   confinement force (puts the wispiness back into smoke)
 *   divergence  div(v) -> Poisson RHS
 *   jacobi      pressure Poisson iterations (fp32 ping-pong, nearest sampled)
 *   project     v -= grad(p) -> divergence-free velocity
 *
 * Scalar channels are R = density/soot, G = temperature, B = fuel, A = embers.
 */
export class FluidSolver {
  constructor(device, options = {}) {
    this.device = device;
    this.resolution = 0;
    this.gridSize = [0, 0, 0];

    this.settings = {
      resolution: 96,
      volumeSize: [4, 4, 4],
      volumeCenter: [0, 2, 0],
      pressureIterations: 24,
      substeps: 1,
      adaptiveSubsteps: true,
      // forces
      buoyancy: 7.0,
      smokeBuoyancy: 0.9,
      ambientCooling: 1.1,
      turbulence: 1.4,
      wind: [0, 0, 0],
      windResponse: 0.2,
      vorticity: 3.2,
      velocityDamping: 0.06,
      dissipation: 0.05,
      // combustion
      fuelBurnRate: 3.2,
      ignitionTemp: 0.35,
      heatOfCombustion: 2.1,
      sootYield: 0.32,
      emberGain: 0.5,
      emberDecay: 1.3,
      thermalExpansion: 7.0,
      // noise shaping
      swirlScale: 0.30,
      swirlSpeed: 0.35,
      // limits
      ambientTemp: 0.0,
      maxSpeed: 14.0,
      obstacle: { mode: 0, center: [0, 1.2, 0], halfExtents: [0.9, 0.9, 0.9], radius: 0.0 },
      blast: { center: [0, 1.5, 0], strength: 0 },
      ...options,
    };

    this.simPacker = new UniformPacker(SIM_LAYOUT, 'sim');
    this.emitterPacker = new EmitterPacker();

    this.simBuffer = device.createBuffer({
      size: 1024,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'sim-uniforms',
    });
    this.emitterBuffer = device.createBuffer({
      size: this.emitterPacker.bytes + 512,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'emitter-uniforms',
    });

    this.samplerLinear = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
      label: 'sampler-linear-clamp',
    });
    this.samplerNearest = device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
      label: 'sampler-nearest-clamp',
    });

    this.programs = {
      advect: new Program(device, WGSL_ADVECT, { label: 'advect' }),
      sources: new Program(device, WGSL_SOURCES, { label: 'sources' }),
      curl: new Program(device, WGSL_CURL, { label: 'curl' }),
      vorticity: new Program(device, WGSL_VORTICITY, { label: 'vorticity' }),
      divergence: new Program(device, WGSL_DIVERGENCE, { label: 'divergence' }),
      jacobi: new Program(device, WGSL_JACOBI, { label: 'jacobi', unfilterable: ['inPressure', 'inDiv'] }),
      project: new Program(device, WGSL_PROJECT, { label: 'project', unfilterable: ['inPressure'] }),
      clearState: new Program(device, WGSL_CLEAR_STATE, { label: 'clearState' }),
      clearSolver: new Program(device, WGSL_CLEAR_SOLVER, { label: 'clearSolver' }),
      sdf: new Program(device, WGSL_SDF, { label: 'sdf' }),
    };

    this.resize(this.settings.resolution);
  }

  // ------------------------------------------------------------------ setup --
  resize(resolution) {
    const res = Math.max(16, Math.min(256, Math.round(resolution)));
    if (res === this.resolution) return;
    this.destroyTextures();
    this.resolution = res;
    this.gridSize = [res, res, res];

    const make = (format, label) =>
      this.device.createTexture({
        size: [res, res, res],
        dimension: '3d',
        format,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.STORAGE_BINDING |
          GPUTextureUsage.COPY_SRC,
        label,
      });

    this.textures = {
      velA: make('rgba16float', 'vol-velocity-a'),
      velB: make('rgba16float', 'vol-velocity-b'),
      scalA: make('rgba16float', 'vol-scalars-a'),
      scalB: make('rgba16float', 'vol-scalars-b'),
      curl: make('rgba16float', 'vol-curl'),
      presA: make('rg32float', 'vol-pressure-a'),
      presB: make('rg32float', 'vol-pressure-b'),
      div: make('rg32float', 'vol-divergence'),
      sdf: make('rgba16float', 'vol-sdf'),
    };
    this.velIndex = 0;
    this.scalIndex = 0;
    this._sdfDirty = true;
    this._needsClear = true;
  }

  get velocityTexture() {
    return this.velIndex === 0 ? this.textures.velA : this.textures.velB;
  }

  get scalarTexture() {
    return this.scalIndex === 0 ? this.textures.scalA : this.textures.scalB;
  }

  get sdfTexture() {
    return this.textures.sdf;
  }

  destroyTextures() {
    for (const t of Object.values(this.textures ?? {})) t.destroy();
    this.textures = {};
  }

  /** World-space AABB of the simulation volume. */
  get volumeBounds() {
    const { volumeSize, volumeCenter } = this.settings;
    return {
      min: [
        volumeCenter[0] - volumeSize[0] / 2,
        volumeCenter[1] - volumeSize[1] / 2,
        volumeCenter[2] - volumeSize[2] / 2,
      ],
      max: [
        volumeCenter[0] + volumeSize[0] / 2,
        volumeCenter[1] + volumeSize[1] / 2,
        volumeCenter[2] + volumeSize[2] / 2,
      ],
    };
  }

  markSdfDirty() {
    this._sdfDirty = true;
  }

  /** Zero every field (used on reset / resolution change). */
  requestClear() {
    this._needsClear = true;
  }

  // ------------------------------------------------------------------ frame --
  _writeUniforms(dt, time, frame, substeps) {
    const s = this.settings;
    const [nx, ny, nz] = this.gridSize;
    const [sx, sy, sz] = s.volumeSize;
    const b = this.volumeBounds;
    const p = this.simPacker;

    p.set('grid', nx, ny, nz, 0);
    p.set('dt', dt, dt / Math.max(1, substeps), time, frame);
    p.set('volMin', b.min[0], b.min[1], b.min[2], 0);
    p.set('volSize', sx, sy, sz, sx / nx);
    p.set('force', s.buoyancy, s.smokeBuoyancy, s.ambientCooling, s.turbulence);
    p.set('wind', s.wind[0], s.wind[1], s.wind[2], s.vorticity);
    p.set('drag', s.velocityDamping, s.dissipation, s.fuelBurnRate, s.ignitionTemp);
    p.set('fire', s.heatOfCombustion, s.sootYield, s.thermalExpansion, s.emberGain);
    p.set('misc', s.ambientTemp, s.maxSpeed, 0, s.windResponse);
    p.set('obstacle', ...s.obstacle.center, s.obstacle.radius);
    p.set(
      'obstacleShape',
      s.obstacle.halfExtents[0],
      s.obstacle.halfExtents[1],
      s.obstacle.halfExtents[2],
      s.obstacle.mode
    );
    p.set('blast', ...s.blast.center, s.blast.strength);
    p.set('quality', s.pressureIterations, substeps, 0, 0);
    p.set('swirls', 0, s.swirlScale, s.swirlSpeed, s.emberDecay);
    return p;
  }

  /**
   * Encode one frame of simulation.
   * @returns {{simMs: number}} wall-clock hint of how much work was queued
   */
  encode(encoder, { dt, time, frame = 0, emitters = [] } = {}) {
    const s = this.settings;
    let substeps = Math.max(1, Math.round(s.substeps));
    if (s.adaptiveSubsteps) {
      // Semi-Lagrangian advection is unconditionally stable but smears detail
      // once a parcel crosses several cells per step, which is exactly what an
      // explosion does. Estimate the CFL number and add substeps when needed.
      const cellSize = s.volumeSize[0] / this.resolution;
      const estSpeed = Math.min(s.maxSpeed, 12);
      const needed = Math.ceil((estSpeed * dt) / (cellSize * 2.5));
      substeps = Math.max(substeps, Math.min(needed, 3));
    }
    this.substepsUsed = substeps;
    const p = this._writeUniforms(dt, time, frame, substeps);
    this.device.queue.writeBuffer(this.simBuffer, 0, p.buffer, 0, p.byteLength);

    const emitterData = this.emitterPacker.pack(emitters);
    this.device.queue.writeBuffer(this.emitterBuffer, 0, emitterData, 0, emitterData.byteLength);

    const [nx, ny, nz] = this.gridSize;
    this.dispatchSize = [
      Math.ceil(nx / WORKGROUP),
      Math.ceil(ny / WORKGROUP),
      Math.ceil(nz / WORKGROUP),
    ];

    if (this._needsClear) {
      this._encodeClear(encoder);
      this._needsClear = false;
    }

    if (this._sdfDirty) {
      this._encodeSdf(encoder);
      this._sdfDirty = false;
    }

    const simGroup = { sim: this.simBuffer };
    for (let step = 0; step < substeps; step += 1) {
      this._encodeSubstep(encoder, simGroup);
    }
    return this;
  }

  _dispatch(encoder, program, group1, label) {
    const pass = encoder.beginComputePass({ label });
    pass.setPipeline(program.compute('main'));
    pass.setBindGroup(0, program.group(0, { sim: this.simBuffer }));
    pass.setBindGroup(1, program.group(1, group1));
    pass.dispatchWorkgroups(this.dispatchSize[0], this.dispatchSize[1], this.dispatchSize[2]);
    pass.end();
  }

  _encodeClear(encoder) {
    const t = this.textures;
    // two dispatches: 4 storage textures per shader is the WebGPU default limit
    this._dispatch(
      encoder,
      this.programs.clearState,
      { outVelA: t.velA, outVelB: t.velB, outScalA: t.scalA, outScalB: t.scalB },
      'solver.clearState'
    );
    this._dispatch(
      encoder,
      this.programs.clearSolver,
      { outCurl: t.curl, outPresA: t.presA, outPresB: t.presB, outDiv: t.div },
      'solver.clearSolver'
    );
    this.velIndex = 0;
    this.scalIndex = 0;
  }

  _encodeSdf(encoder) {
    this._dispatch(encoder, this.programs.sdf, { outSdf: this.textures.sdf }, 'solver.sdf');
  }

  _encodeSubstep(encoder, simGroup) {
    const t = this.textures;
    const { samplerLinear, samplerNearest } = this;

    // --- advect ------------------------------------------------------------
    let velIn = this.velIndex === 0 ? t.velA : t.velB;
    let velOut = this.velIndex === 0 ? t.velB : t.velA;
    let scalIn = this.scalIndex === 0 ? t.scalA : t.scalB;
    let scalOut = this.scalIndex === 0 ? t.scalB : t.scalA;

    this._dispatch(
      encoder,
      this.programs.advect,
      { inVel: velIn, inScal: scalIn, samp: samplerLinear, outVel: velOut, outScal: scalOut },
      'solver.advect'
    );
    this.velIndex ^= 1;
    this.scalIndex ^= 1;
    [velIn, velOut] = [velOut, velIn];
    [scalIn, scalOut] = [scalOut, scalIn];

    // --- sources (emitters / combustion / forces) --------------------------
    this._dispatch(
      encoder,
      this.programs.sources,
      {
        emitters: this.emitterBuffer,
        inVel: velIn,
        inScal: scalIn,
        samp: samplerLinear,
        outVel: velOut,
        outScal: scalOut,
      },
      'solver.sources'
    );
    this.velIndex ^= 1;
    this.scalIndex ^= 1;
    [velIn, velOut] = [velOut, velIn];
    [scalIn, scalOut] = [scalOut, scalIn];

    // --- vorticity confinement --------------------------------------------
    this._dispatch(encoder, this.programs.curl, { inVel: velIn, samp: samplerLinear, outCurl: t.curl }, 'solver.curl');
    this._dispatch(
      encoder,
      this.programs.vorticity,
      { inVel: velIn, inCurl: t.curl, samp: samplerLinear, outVel: velOut },
      'solver.vorticity'
    );
    this.velIndex ^= 1;
    [velIn, velOut] = [velOut, velIn];

    // --- pressure projection ----------------------------------------------
    this._dispatch(
      encoder,
      this.programs.divergence,
      { inVel: velIn, samp: samplerLinear, outDiv: t.div },
      'solver.divergence'
    );

    const iterations = Math.max(1, Math.round(this.settings.pressureIterations));
    let presIn = t.presA;
    let presOut = t.presB;
    for (let i = 0; i < iterations; i += 1) {
      this._dispatch(
        encoder,
        this.programs.jacobi,
        { inPressure: presIn, inDiv: t.div, sampNF: samplerNearest, outPressure: presOut },
        'solver.jacobi'
      );
      const swap = presIn;
      presIn = presOut;
      presOut = swap;
    }

    this._dispatch(
      encoder,
      this.programs.project,
      { inVel: velIn, inPressure: presIn, samp: samplerLinear, sampNF: samplerNearest, outVel: velOut },
      'solver.project'
    );
    this.velIndex ^= 1;
  }

  /**
   * Read a small slab of the fields back to the CPU.
   *
   * This exists mostly as a diagnostic: it answers "is the solver actually
   * producing heat and smoke?" without eyeballing the render, which makes a
   * black screen immediately actionable.
   *
   * @returns {Promise<{density:number,heat:number,fuel:number,embers:number,speed:number}>}
   */
  async probeVolume() {
    if (this._probing) return this._lastProbe;
    this._probing = true;
    try {
      const res = this.resolution;
      const origin = [Math.max(0, (res >> 1) - 1), Math.max(0, Math.round(res * 0.3)), Math.max(0, (res >> 1) - 1)];
      const size = 2;
      const bytesPerRow = 256; // must be a multiple of 256 for buffer copies
      const bytes = bytesPerRow * size * size;
      const buffer = this.device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        label: 'probe',
      });
      const encoder = this.device.createCommandEncoder({ label: 'probe' });
      for (const tex of [this.scalarTexture, this.velocityTexture]) {
        encoder.copyTextureToBuffer(
          { texture: tex, origin },
          { buffer, bytesPerRow, rowsPerImage: size },
          { width: size, height: size, depth: size }
        );
      }
      this.device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const view = new DataView(buffer.getMappedRange());

      const acc = { density: 0, heat: 0, fuel: 0, embers: 0, speed: 0 };
      let n = 0;
      for (let z = 0; z < size; z += 1) {
        for (let y = 0; y < size; y += 1) {
          const rowStart = z * bytesPerRow * size + y * bytesPerRow;
          for (let x = 0; x < size; x += 1) {
            const off = rowStart + x * 8;
            acc.density += halfToFloat(view.getUint16(off, true));
            acc.heat += halfToFloat(view.getUint16(off + 2, true));
            acc.fuel += halfToFloat(view.getUint16(off + 4, true));
            acc.embers += halfToFloat(view.getUint16(off + 6, true));
            const vx = halfToFloat(view.getUint16(off + 8, true));
            const vy = halfToFloat(view.getUint16(off + 10, true));
            const vz = halfToFloat(view.getUint16(off + 12, true));
            acc.speed += Math.hypot(vx, vy, vz);
            n += 1;
          }
        }
      }
      buffer.unmap();
      buffer.destroy();
      const out = {};
      for (const k of Object.keys(acc)) out[k] = acc[k] / Math.max(1, n);
      this._lastProbe = out;
      return out;
    } catch (err) {
      return { error: err.message };
    } finally {
      this._probing = false;
    }
  }

  destroy() {
    this.destroyTextures();
    this.simBuffer?.destroy();
    this.emitterBuffer?.destroy();
    for (const p of Object.values(this.programs)) p.destroy();
  }
}
