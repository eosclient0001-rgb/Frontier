import { shader } from '../gpu/shaders';
import type { Resources } from '../gpu/resources';
import { VOLUME_FORMAT } from '../gpu/resources';
import type { GridConfig } from '../config';
import { simDims } from '../config';
import type { ParamStore } from '../params';

/**
 * Erosion simulation driver.
 *
 * Pass order per step, and why:
 *
 *   1. surface      extract the drainage surface from the SDF
 *   2. hydro_flux   rain + pipe-model outflow
 *   3. hydro_update apply flux, derive velocity
 *   4. hydro_erode  stream-power erosion / deposition
 *   5. hydro_advect move suspended sediment
 *   6. thermal      talus, angle of repose, commit advection
 *   7. apply_height write the 2.5D result back into the SDF (top surface only)
 *   8. erode3d      TRUE volumetric erosion: undercutting, alcoves, collapse
 *   9. redistance   restore |grad phi| = 1 so ray-marching stays safe
 *
 * Passes 1-6 touch only the sim buffer. Passes 7-9 write the volume, so those
 * are the only ones that need to ping-pong.
 */

type VolumePass = 'apply_height' | 'erode3d' | 'redistance';

export class Simulation {
  private device: GPUDevice;
  private res: Resources;
  private grid: GridConfig;

  private simLayout!: GPUBindGroupLayout;
  private simPipelines = new Map<string, GPUComputePipeline>();
  /** Bind groups for both ping-pong orientations. */
  private bgAB!: GPUBindGroup; // reads A, writes B
  private bgBA!: GPUBindGroup; // reads B, writes A

  private initLayout!: GPUBindGroupLayout;
  private initPipelineA!: GPUComputePipeline;
  private initBGA!: GPUBindGroup;
  private initBGB!: GPUBindGroup;

  private sculptLayout!: GPUBindGroupLayout;
  private sculptPipeline!: GPUComputePipeline;
  private sculptBGAB!: GPUBindGroup;
  private sculptBGBA!: GPUBindGroup;

  private pickLayout!: GPUBindGroupLayout;
  private pickPipeline!: GPUComputePipeline;
  private pickBGA!: GPUBindGroup;
  private pickBGB!: GPUBindGroup;
  private pickBusy = false;

  /** Which texture currently holds the authoritative volume. */
  private current: 'A' | 'B' = 'A';

  stepCount = 0;

  constructor(device: GPUDevice, res: Resources) {
    this.device = device;
    this.res = res;
    this.grid = res.grid;
    this.build();
  }

  /** Texture holding the live volume — what the renderer should sample. */
  get currentTexture(): GPUTexture {
    return this.current === 'A' ? this.res.volA : this.res.volB;
  }

  private build() {
    const d = this.device;

    // ---- layout shared by every simulation pass ---------------------------
    this.simLayout = d.createBindGroupLayout({
      label: 'sim layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: VOLUME_FORMAT, viewDimension: '3d' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      ],
    });

    const mkBG = (src: GPUTexture, dst: GPUTexture, label: string) =>
      d.createBindGroup({
        label,
        layout: this.simLayout,
        entries: [
          { binding: 0, resource: { buffer: this.res.paramBuf } },
          { binding: 1, resource: src.createView() },
          { binding: 2, resource: dst.createView() },
          { binding: 3, resource: { buffer: this.res.simBuf } },
          { binding: 4, resource: this.res.linSampler },
        ],
      });

    this.bgAB = mkBG(this.res.volA, this.res.volB, 'sim A->B');
    this.bgBA = mkBG(this.res.volB, this.res.volA, 'sim B->A');

    const pipeLayout = d.createPipelineLayout({ bindGroupLayouts: [this.simLayout] });

    const names = [
      'surface', 'hydro_flux', 'hydro_update', 'hydro_erode',
      'hydro_advect', 'thermal', 'apply_height', 'erode3d', 'redistance',
    ];
    for (const n of names) {
      const module = d.createShaderModule({ label: n, code: shader(`${n}.wgsl`) });
      this.simPipelines.set(n, d.createComputePipeline({
        label: n,
        layout: pipeLayout,
        compute: { module, entryPoint: 'main' },
      }));
    }

    // ---- terrain init (writes a volume, reads nothing) --------------------
    this.initLayout = d.createBindGroupLayout({
      label: 'init layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: VOLUME_FORMAT, viewDimension: '3d' } },
      ],
    });
    const initModule = d.createShaderModule({ label: 'init_terrain', code: shader('init_terrain.wgsl') });
    this.initPipelineA = d.createComputePipeline({
      label: 'init_terrain',
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.initLayout] }),
      compute: { module: initModule, entryPoint: 'main' },
    });
    const mkInitBG = (dst: GPUTexture, label: string) =>
      d.createBindGroup({
        label, layout: this.initLayout,
        entries: [
          { binding: 0, resource: { buffer: this.res.paramBuf } },
          { binding: 1, resource: dst.createView() },
        ],
      });
    this.initBGA = mkInitBG(this.res.volA, 'init -> A');
    this.initBGB = mkInitBG(this.res.volB, 'init -> B');

    // ---- sculpt -----------------------------------------------------------
    this.sculptLayout = d.createBindGroupLayout({
      label: 'sculpt layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: VOLUME_FORMAT, viewDimension: '3d' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    const sculptModule = d.createShaderModule({ label: 'sculpt', code: shader('sculpt.wgsl') });
    this.sculptPipeline = d.createComputePipeline({
      label: 'sculpt',
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.sculptLayout] }),
      compute: { module: sculptModule, entryPoint: 'main' },
    });
    const mkSculptBG = (src: GPUTexture, dst: GPUTexture, label: string) =>
      d.createBindGroup({
        label, layout: this.sculptLayout,
        entries: [
          { binding: 0, resource: { buffer: this.res.paramBuf } },
          { binding: 1, resource: src.createView() },
          { binding: 2, resource: dst.createView() },
          { binding: 3, resource: { buffer: this.res.brushBuf } },
        ],
      });
    this.sculptBGAB = mkSculptBG(this.res.volA, this.res.volB, 'sculpt A->B');
    this.sculptBGBA = mkSculptBG(this.res.volB, this.res.volA, 'sculpt B->A');

    // ---- GPU ray pick -----------------------------------------------------
    this.pickLayout = d.createBindGroupLayout({
      label: 'pick layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const pickModule = d.createShaderModule({ label: 'pick', code: shader('pick.wgsl') });
    this.pickPipeline = d.createComputePipeline({
      label: 'pick',
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.pickLayout] }),
      compute: { module: pickModule, entryPoint: 'main' },
    });
    const mkPickBG = (src: GPUTexture, label: string) =>
      d.createBindGroup({
        label, layout: this.pickLayout,
        entries: [
          { binding: 0, resource: { buffer: this.res.paramBuf } },
          { binding: 1, resource: src.createView() },
          { binding: 2, resource: this.res.linSampler },
          { binding: 3, resource: { buffer: this.res.pickReqBuf } },
          { binding: 4, resource: { buffer: this.res.pickResBuf } },
        ],
      });
    this.pickBGA = mkPickBG(this.res.volA, 'pick A');
    this.pickBGB = mkPickBG(this.res.volB, 'pick B');
  }

  /**
   * Ray-cast against the live SDF on the GPU. Encodes the march plus a copy
   * into the mapped staging buffer; the caller reads the result later via
   * readPick(). Never blocks the frame.
   */
  encodePick(encoder: GPUCommandEncoder, origin: [number, number, number], dir: [number, number, number]) {
    const req = new Float32Array(8);
    req[0] = origin[0]; req[1] = origin[1]; req[2] = origin[2];
    req[4] = dir[0]; req[5] = dir[1]; req[6] = dir[2];
    this.device.queue.writeBuffer(this.res.pickReqBuf, 0, req);

    const pass = encoder.beginComputePass({ label: 'pick' });
    pass.setPipeline(this.pickPipeline);
    pass.setBindGroup(0, this.current === 'A' ? this.pickBGA : this.pickBGB);
    pass.dispatchWorkgroups(1);
    pass.end();

    if (!this.pickBusy) {
      encoder.copyBufferToBuffer(this.res.pickResBuf, 0, this.res.pickStaging, 0, 32);
    }
  }

  /** Read the most recent pick result, or null if one is already in flight. */
  async readPick(): Promise<{ pos: [number, number, number]; hit: boolean; normal: [number, number, number] } | null> {
    if (this.pickBusy) return null;
    this.pickBusy = true;
    try {
      await this.res.pickStaging.mapAsync(GPUMapMode.READ);
      const f = new Float32Array(this.res.pickStaging.getMappedRange().slice(0));
      this.res.pickStaging.unmap();
      return {
        pos: [f[0], f[1], f[2]],
        hit: f[3] > 0.5,
        normal: [f[4], f[5], f[6]],
      };
    } catch {
      return null;
    } finally {
      this.pickBusy = false;
    }
  }

  private volGroups(): [number, number, number] {
    return [
      Math.ceil(this.grid.volX / 4),
      Math.ceil(this.grid.volY / 4),
      Math.ceil(this.grid.volZ / 4),
    ];
  }

  private simGroups(): [number, number] {
    const { simX, simZ } = simDims(this.grid);
    return [Math.ceil(simX / 8), Math.ceil(simZ / 8)];
  }

  /** Rebuild the terrain from scratch and clear all hydraulic state. */
  reset(encoder: GPUCommandEncoder) {
    const [gx, gy, gz] = this.volGroups();
    const pass = encoder.beginComputePass({ label: 'init terrain' });
    pass.setPipeline(this.initPipelineA);
    pass.setBindGroup(0, this.current === 'A' ? this.initBGA : this.initBGB);
    pass.dispatchWorkgroups(gx, gy, gz);
    pass.end();

    encoder.clearBuffer(this.res.simBuf);
    this.stepCount = 0;
  }

  /** One full erosion step. */
  step(encoder: GPUCommandEncoder) {
    const [sx, sz] = this.simGroups();
    const [gx, gy, gz] = this.volGroups();

    const run2D = (pass: GPUComputePassEncoder, name: string) => {
      pass.setPipeline(this.simPipelines.get(name)!);
      pass.setBindGroup(0, this.current === 'A' ? this.bgAB : this.bgBA);
      pass.dispatchWorkgroups(sx, sz, 1);
    };

    // --- 2D hydraulics: one compute pass, no volume writes, no ping-pong ---
    {
      const pass = encoder.beginComputePass({ label: 'hydraulics' });
      run2D(pass, 'surface');
      run2D(pass, 'hydro_flux');
      run2D(pass, 'hydro_update');
      run2D(pass, 'hydro_erode');
      run2D(pass, 'hydro_advect');
      run2D(pass, 'thermal');
      pass.end();
    }

    // --- volume passes: each reads one texture and writes the other -------
    const runVol = (name: VolumePass) => {
      const pass = encoder.beginComputePass({ label: name });
      pass.setPipeline(this.simPipelines.get(name)!);
      pass.setBindGroup(0, this.current === 'A' ? this.bgAB : this.bgBA);
      pass.dispatchWorkgroups(gx, gy, gz);
      pass.end();
      this.current = this.current === 'A' ? 'B' : 'A';
    };

    runVol('apply_height');
    runVol('erode3d');
    runVol('redistance');

    this.stepCount++;
  }

  /** Extra redistancing sweeps — used after sculpting. */
  redistance(encoder: GPUCommandEncoder, sweeps = 2) {
    const [gx, gy, gz] = this.volGroups();
    for (let i = 0; i < sweeps; i++) {
      const pass = encoder.beginComputePass({ label: 'redistance' });
      pass.setPipeline(this.simPipelines.get('redistance')!);
      pass.setBindGroup(0, this.current === 'A' ? this.bgAB : this.bgBA);
      pass.dispatchWorkgroups(gx, gy, gz);
      pass.end();
      this.current = this.current === 'A' ? 'B' : 'A';
    }
  }

  applyBrush(encoder: GPUCommandEncoder) {
    const [gx, gy, gz] = this.volGroups();
    const pass = encoder.beginComputePass({ label: 'sculpt' });
    pass.setPipeline(this.sculptPipeline);
    pass.setBindGroup(0, this.current === 'A' ? this.sculptBGAB : this.sculptBGBA);
    pass.dispatchWorkgroups(gx, gy, gz);
    pass.end();
    this.current = this.current === 'A' ? 'B' : 'A';
  }
}
