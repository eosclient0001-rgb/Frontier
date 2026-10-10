// ---------------------------------------------------------------------------
// GPU engine: runs the generation stack, analysis, texturing and renders the
// terrain. Every pass is a compute dispatch or a render draw; heights stay on
// the GPU and only small results (histograms, thumbnails) are read back.
// ---------------------------------------------------------------------------
import { KINDS, BLENDS } from './model';
import type { Project, Settings, TexLayer } from './model';
import { perspective, lookAt, mul, invert, hexToRgb } from './math';
import type { Vec3 } from './math';
import { initGPU, makeBuffer, STORAGE, readBack } from './gpu';
import type { GPUContext } from './gpu';

import noiseSrc from './shaders/noise.wgsl?raw';
import generateSrc from './shaders/generate.wgsl?raw';
import erodeSrc from './shaders/erode.wgsl?raw';
import analysisSrc from './shaders/analysis.wgsl?raw';
import probeSrc from './shaders/probe.wgsl?raw';
import atmosSrc from './shaders/atmos.wgsl?raw';
import skySrc from './shaders/sky.wgsl?raw';
import terrainSrc from './shaders/terrain.wgsl?raw';
import materialsSrc from './shaders/materials.wgsl?raw';
import bakeSrc from './shaders/bake.wgsl?raw';

const THUMB = 96;          // thumbnail size (px)
const CHUNK = 32;          // cells per terrain chunk
const GEN_CODE: Record<string, number> = { fractal: 0, cells: 1, continent: 2, terrace: 3, curve: 4 };
const MASK_CODE: Record<string, number> = { none: 0, height: 1, slope: 2, noise: 3 };
const TEX_UNI_FLOATS = 8 + 8 * 32;

export interface RunOpts {
  /** Re-run the whole generation stack (heights, erosion, flow). */
  gen: boolean;
  /** Re-bake sun-dependent data (shadows and sky probe). */
  sun: boolean;
  /** Re-evaluate texture layers (weights and thumbnails). */
  tex: boolean;
}

export interface RunResult {
  thumbs: Record<string, string>;
  hist: number[];
  hasFlow: boolean;
  ms: number;
}

export interface CamState {
  yaw: number;
  pitch: number;
  dist: number;
  target: Vec3;
  fov: number;
}

export interface ViewFlags {
  viewMode: number;
  showWater: boolean;
  showRivers: boolean;
}

interface UniVals {
  n: number;
  kind?: number;
  mode?: number;
  mtype?: number;
  cell: number;
  maxH: number;
  seed: number;
  opacity?: number;
  p?: number[];
}

function packUni(u: UniVals): ArrayBuffer {
  const buf = new ArrayBuffer(96);
  const dv = new DataView(buf);
  dv.setUint32(0, u.n, true);
  dv.setUint32(4, u.kind ?? 0, true);
  dv.setUint32(8, u.mode ?? 0, true);
  dv.setUint32(12, u.mtype ?? 0, true);
  dv.setFloat32(16, u.cell, true);
  dv.setFloat32(20, u.maxH, true);
  dv.setFloat32(24, u.seed, true);
  dv.setFloat32(28, u.opacity ?? 1, true);
  const p = u.p ?? [];
  for (let i = 0; i < 16; i++) dv.setFloat32(32 + i * 4, p[i] ?? 0, true);
  return buf;
}

type Entry = [number, GPUBuffer | GPUTextureView | GPUSampler];

const toResource = (r: GPUBuffer | GPUTextureView | GPUSampler): GPUBindingResource =>
  (r instanceof GPUBuffer ? { buffer: r } : r);

export class Engine {
  readonly device: GPUDevice;
  readonly info: string;
  private canvas: HTMLCanvasElement;
  private ctx: GPUCanvasContext;
  private format: GPUTextureFormat;

  private n = 0;
  private cell = 1;
  private worldSize = 4096;
  private maxH = 1200;
  private sea = 120;
  private pool: GPUBuffer[] = [];
  private A!: GPUBuffer;
  private SH!: GPUBuffer;
  private S0!: GPUBuffer;
  private S1!: GPUBuffer;
  private hist!: GPUBuffer;
  private flowA!: GPUBuffer;
  private fmaxA!: GPUBuffer;
  private TX!: GPUBuffer;
  private PR!: GPUBuffer;
  private PU!: GPUBuffer;
  private V!: GPUBuffer;
  private chunkBuf!: GPUBuffer;
  private indexBuf!: GPUBuffer;
  private indexCount = 0;
  private chunkCount = 0;
  private heightBuf: GPUBuffer | null = null;
  private hasFlow = false;
  private frameBusy = false;

  // per-run scratch pools (indexed; reset at the start of each run)
  private uniPool: GPUBuffer[] = [];
  private brushPool: GPUBuffer[] = [];
  private tbPool: GPUBuffer[] = [];
  private uiIdx = 0;
  private brIdx = 0;
  private tbIdx = 0;

  // baked material textures (world-aligned, with mips) and their sampler
  private bakeT = 0;
  private albTex!: GPUTexture;
  private detTex!: GPUTexture;
  private albView!: GPUTextureView;
  private detView!: GPUTextureView;
  private smp!: GPUSampler;
  private BU!: GPUBuffer;

  private depthTex: GPUTexture | null = null;
  private depthView: GPUTextureView | null = null;

  private pipes!: {
    gen: GPUComputePipeline; blur: GPUComputePipeline; thermal: GPUComputePipeline;
    rivers: GPUComputePipeline; combine: GPUComputePipeline;
    hydro: GPUComputePipeline; flowmax: GPUComputePipeline;
    attr: GPUComputePipeline; shadow: GPUComputePipeline; splat: GPUComputePipeline; thumb: GPUComputePipeline;
    probe: GPUComputePipeline; bake: GPUComputePipeline; mip: GPUComputePipeline;
    sky: GPURenderPipeline; terrain: GPURenderPipeline; sea: GPURenderPipeline;
  };

  private constructor(ctxG: GPUContext, canvas: HTMLCanvasElement, gpuCtx: GPUCanvasContext, format: GPUTextureFormat) {
    this.device = ctxG.device;
    this.info = ctxG.info;
    this.canvas = canvas;
    this.ctx = gpuCtx;
    this.format = format;
    this.smp = this.device.createSampler({
      label: 'material', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', maxAnisotropy: 8,
    });
    this.BU = makeBuffer(this.device, 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'bakeU');
  }

  /** Baked-material texture size for a quality multiplier of the cell grid. */
  static bakeSize(n: number, scale: number): number {
    let t = Math.round((n * scale) / 64) * 64;
    return Math.max(256, Math.min(4096, t));
  }

  private ensureBake(T: number) {
    if (T === this.bakeT) return;
    this.albTex?.destroy();
    this.detTex?.destroy();
    const mips = Math.floor(Math.log2(T)) + 1;
    const mk = (label: string) => this.device.createTexture({
      label, size: [T, T], format: 'rgba16float', mipLevelCount: mips,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.albTex = mk('albedo');
    this.detTex = mk('detail');
    this.albView = this.albTex.createView();
    this.detView = this.detTex.createView();
    this.bakeT = T;
  }

  static async create(canvas: HTMLCanvasElement): Promise<Engine> {
    const g = await initGPU();
    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('Could not create a WebGPU canvas context.');
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device: g.device, format, alphaMode: 'opaque' });
    const eng = new Engine(g, canvas, ctx, format);
    await eng.buildPipelines();
    return eng;
  }

  private async module(code: string, label: string): Promise<GPUShaderModule> {
    const mod = this.device.createShaderModule({ code, label });
    const info = await mod.getCompilationInfo();
    const errs = info.messages.filter((m) => m.type === 'error');
    if (errs.length) {
      const lines = errs.map((m) => `${label}:${m.lineNum}:${m.linePos} ${m.message}`).join('\n');
      throw new Error(`WGSL compile failed\n${lines}`);
    }
    return mod;
  }

  private async buildPipelines() {
    const d = this.device;
    const genMod = await this.module(noiseSrc + '\n' + generateSrc, 'generate');
    const erodeMod = await this.module(noiseSrc + '\n' + erodeSrc, 'erode');
    const anaMod = await this.module(noiseSrc + '\n' + analysisSrc, 'analysis');
    const probeMod = await this.module(atmosSrc + '\n' + probeSrc, 'probe');
    const skyMod = await this.module(atmosSrc + '\n' + skySrc, 'sky');
    const terrMod = await this.module(atmosSrc + '\n' + noiseSrc + '\n' + terrainSrc, 'terrain');
    const bakeMod = await this.module(noiseSrc + '\n' + materialsSrc + '\n' + bakeSrc, 'bake');
    const cp = (m: GPUShaderModule, entryPoint: string) =>
      d.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint }, label: entryPoint });
    this.pipes = {
      gen: cp(genMod, 'gen_main'),
      blur: cp(genMod, 'blur_main'),
      thermal: cp(genMod, 'thermal_main'),
      rivers: cp(genMod, 'rivers_main'),
      combine: cp(genMod, 'combine_main'),
      hydro: cp(erodeMod, 'hydro_main'),
      flowmax: cp(erodeMod, 'flowmax_main'),
      attr: cp(anaMod, 'attr_main'),
      shadow: cp(anaMod, 'shadow_main'),
      splat: cp(anaMod, 'splat_main'),
      thumb: cp(anaMod, 'thumb_main'),
      probe: cp(probeMod, 'probe_main'),
      bake: cp(bakeMod, 'bake_main'),
      mip: cp(bakeMod, 'mip_main'),
      sky: d.createRenderPipeline({
        layout: 'auto', label: 'sky',
        vertex: { module: skyMod, entryPoint: 'vs_sky' },
        fragment: { module: skyMod, entryPoint: 'fs_sky', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
      }),
      terrain: d.createRenderPipeline({
        layout: 'auto', label: 'terrain',
        vertex: {
          module: terrMod, entryPoint: 'vs_terrain',
          buffers: [{ arrayStride: 8, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'uint32x2' }] }],
        },
        fragment: { module: terrMod, entryPoint: 'fs_terrain', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      }),
      sea: d.createRenderPipeline({
        layout: 'auto', label: 'sea',
        vertex: { module: terrMod, entryPoint: 'vs_sea' },
        fragment: { module: terrMod, entryPoint: 'fs_sea', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
      }),
    };
  }

  // -------------------------------------------------------------------------
  // resources
  // -------------------------------------------------------------------------
  setResolution(n: number) {
    if (n === this.n) return;
    for (const b of [...this.pool, this.A, this.SH, this.S0, this.S1, this.hist, this.flowA, this.fmaxA,
      this.TX, this.PR, this.PU, this.V, this.chunkBuf, this.indexBuf]) {
      if (b) b.destroy();
    }
    this.n = n;
    this.cell = this.worldSize / (n - 1);
    const cells = n * n;
    this.pool = [0, 1, 2, 3].map(() => makeBuffer(this.device, cells * 4, STORAGE, 'height'));
    this.A = makeBuffer(this.device, cells * 16, STORAGE, 'attr');
    this.SH = makeBuffer(this.device, cells * 4, STORAGE, 'shadow');
    this.S0 = makeBuffer(this.device, cells * 4, STORAGE, 'splat0');
    this.S1 = makeBuffer(this.device, cells * 4, STORAGE, 'splat1');
    this.hist = makeBuffer(this.device, 128 * 4, STORAGE, 'hist');
    this.flowA = makeBuffer(this.device, cells * 4, STORAGE, 'flow');
    this.fmaxA = makeBuffer(this.device, 16, STORAGE, 'flowmax');
    this.TX = makeBuffer(this.device, TEX_UNI_FLOATS * 4, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'tex');
    this.PR = makeBuffer(this.device, 64, STORAGE, 'probe');
    this.PU = makeBuffer(this.device, 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'probeU');
    this.V = makeBuffer(this.device, 224, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'view');
    this.heightBuf = null;
    this.hasFlow = false;
    this.ensureBake(Engine.bakeSize(n, 2));

    // Terrain chunks: one instance per 32x32-cell tile, plus an index buffer
    // that wires the 33x33 grid and the 4 skirt strips.
    const cc = Math.ceil((n - 1) / CHUNK);
    this.chunkCount = cc * cc;
    const inst = new Uint32Array(this.chunkCount * 2);
    for (let cy = 0, k = 0; cy < cc; cy++) {
      for (let cx = 0; cx < cc; cx++, k++) {
        inst[k * 2] = cx * CHUNK;
        inst[k * 2 + 1] = cy * CHUNK;
      }
    }
    this.chunkBuf = this.device.createBuffer({ size: inst.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.chunkBuf, 0, inst);

    const idx: number[] = [];
    const g = (i: number, j: number) => j * 33 + i;
    for (let j = 0; j < 32; j++) {
      for (let i = 0; i < 32; i++) {
        const a = g(i, j), b = g(i + 1, j), c = g(i, j + 1), d = g(i + 1, j + 1);
        idx.push(a, c, b, b, c, d);
      }
    }
    const edge = (side: number, t: number): number =>
      side === 0 ? t : side === 1 ? 32 * 33 + t : side === 2 ? t * 33 : t * 33 + 32;
    for (let side = 0; side < 4; side++) {
      for (let t = 0; t < 32; t++) {
        const a = edge(side, t), b = edge(side, t + 1);
        const c = 1089 + side * 33 + t, d = 1089 + side * 33 + t + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const ia = new Uint16Array(idx);
    this.indexCount = ia.length;
    this.indexBuf = this.device.createBuffer({ size: ia.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.indexBuf, 0, ia);
  }

  private uni(vals: UniVals): GPUBuffer {
    const i = this.uiIdx++;
    if (!this.uniPool[i]) {
      this.uniPool[i] = this.device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    }
    this.device.queue.writeBuffer(this.uniPool[i], 0, packUni(vals));
    return this.uniPool[i];
  }

  private brushBuf(data: Float32Array<ArrayBuffer>): GPUBuffer {
    const i = this.brIdx++;
    if (!this.brushPool[i] || this.brushPool[i].size < data.byteLength) {
      this.brushPool[i]?.destroy();
      this.brushPool[i] = this.device.createBuffer({ size: Math.max(16, data.byteLength), usage: STORAGE });
    }
    this.device.queue.writeBuffer(this.brushPool[i], 0, data);
    return this.brushPool[i];
  }

  private pass(enc: GPUCommandEncoder, pipe: GPUComputePipeline, entries: Entry[], x: number, y = 1, z = 1) {
    const bg = this.device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: entries.map(([b, r]) => ({ binding: b, resource: toResource(r) })),
    });
    const p = enc.beginComputePass();
    p.setPipeline(pipe);
    p.setBindGroup(0, bg);
    p.dispatchWorkgroups(x, y, z);
    p.end();
  }

  private groups(count: number): [number, number] {
    const g = Math.ceil(count / 64);
    return [Math.min(g, 65535), Math.ceil(g / 65535)];
  }

  private thumb(enc: GPUCommandEncoder, src: GPUBuffer, mode: number, kind: number, tint: Vec3, key: string, out: { key: string; tb: GPUBuffer }[]) {
    const i = this.tbIdx++;
    const size = THUMB * THUMB * 4;
    if (!this.tbPool[i]) this.tbPool[i] = this.device.createBuffer({ size, usage: STORAGE });
    const tb = this.tbPool[i];
    const cells = Math.ceil(THUMB / 8);
    this.pass(enc, this.pipes.thumb, [
      [0, this.uni({ n: this.n, mode, kind, cell: this.cell, maxH: this.maxH, seed: 0, p: [THUMB, 0, 0, 0, tint[0], tint[1], tint[2], 0] })],
      [1, src], [4, this.A], [7, this.S0], [8, this.S1], [10, tb],
    ], cells, cells);
    out.push({ key, tb });
  }

  // -------------------------------------------------------------------------
  // generation stack
  // -------------------------------------------------------------------------
  private genStack(proj: Project, enc: GPUCommandEncoder, thumbs: { key: string; tb: GPUBuffer }[]) {
    const s = proj.settings;
    const n = this.n;
    const wg = Math.ceil(n / 8);
    const bytes = n * n * 4;
    const { gen, blur, thermal, rivers, combine, hydro, flowmax } = this.pipes;
    enc.clearBuffer(this.flowA);
    enc.clearBuffer(this.fmaxA);
    const pool = this.pool;
    let cur = pool[0];
    enc.clearBuffer(cur);
    this.hasFlow = false;
    let layerNo = 0;
    for (const L of proj.gen) {
      if (!L.enabled) continue;
      layerNo++;
      const others = pool.filter((b) => b !== cur);
      const spec = KINDS[L.kind];
      let cand: GPUBuffer;
      const seedU = s.seed;
      if (L.kind === 'fractal' || L.kind === 'cells' || L.kind === 'continent' || L.kind === 'terrace' || L.kind === 'curve') {
        cand = others[0];
        const pv = spec.params.map((pp) => L.params[pp.key]);
        this.pass(enc, gen, [
          [0, this.uni({ n, kind: GEN_CODE[L.kind], cell: this.cell, maxH: this.maxH, seed: seedU, p: pv })],
          [1, cur], [2, cand],
        ], wg, wg);
      } else if (L.kind === 'smooth') {
        const [t0, t1] = others;
        const u = this.uni({ n, mode: 0, cell: this.cell, maxH: this.maxH, seed: seedU, p: [L.params.radius] });
        const v = this.uni({ n, mode: 1, cell: this.cell, maxH: this.maxH, seed: seedU, p: [L.params.radius] });
        let src = cur;
        for (let k = 0; k < Math.round(L.params.passes); k++) {
          this.pass(enc, blur, [[0, u], [1, src], [2, t0]], wg, wg);
          this.pass(enc, blur, [[0, v], [1, t0], [2, t1]], wg, wg);
          src = t1;
        }
        cand = t1;
      } else if (L.kind === 'thermal') {
        const [t0, t1] = others;
        enc.copyBufferToBuffer(cur, 0, t0, 0, bytes);
        const u = this.uni({
          n, cell: this.cell, maxH: this.maxH, seed: seedU,
          p: [Math.tan((L.params.talus * Math.PI) / 180) * this.cell / this.maxH, L.params.rate],
        });
        let src = t0, dst = t1;
        const iters = Math.round(L.params.iterations);
        for (let k = 0; k < iters; k++) {
          this.pass(enc, thermal, [[0, u], [1, src], [2, dst]], wg, wg);
          [src, dst] = [dst, src];
        }
        cand = src;
      } else if (L.kind === 'hydraulic') {
        const w = others[0];
        enc.copyBufferToBuffer(cur, 0, w, 0, bytes);
        enc.clearBuffer(this.flowA);
        enc.clearBuffer(this.fmaxA);
        const r = Math.max(1, Math.round(L.params.radius));
        const br: number[] = [];
        let wsum = 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const d = Math.hypot(dx, dy);
            if (d > r) continue;
            const wgt = r - d + 0.25;
            br.push(dx, dy, wgt, 0);
            wsum += wgt;
          }
        }
        for (let k = 2; k < br.length; k += 4) br[k] /= wsum;
        const brush = this.brushBuf(new Float32Array(br) as Float32Array<ArrayBuffer>);
        const count = Math.max(1, Math.floor(L.params.droplets * n * n));
        const [gx, gy] = this.groups(count);
        const pv = [
          0, L.params.lifetime, L.params.inertia, L.params.capacity, L.params.erosion, L.params.deposition,
          L.params.evaporation, L.params.gravity, L.params.radius, s.seed * 7 + layerNo, count, br.length / 4,
        ];
        this.pass(enc, hydro, [[0, this.uni({ n, cell: this.cell, maxH: this.maxH, seed: seedU, p: pv })], [1, w], [2, this.flowA], [3, brush]], gx, gy);
        this.pass(enc, flowmax, [[0, this.uni({ n, cell: this.cell, maxH: this.maxH, seed: seedU })], [2, this.flowA], [4, this.fmaxA]], wg, wg);
        this.hasFlow = true;
        cand = w;
      } else {
        // rivers: carve along the flow network left by the last hydraulic pass
        cand = others[0];
        this.pass(enc, rivers, [
          [0, this.uni({ n, cell: this.cell, maxH: this.maxH, seed: seedU, p: [L.params.depth, L.params.threshold, L.params.width] })],
          [1, cur], [2, cand], [4, this.flowA], [5, this.fmaxA],
        ], wg, wg);
      }
      // blend into the stack with mask and opacity
      const out = others.find((b) => b !== cand)!;
      const mk = L.mask;
      const mp = mk.kind === 'none' ? [0, 1, 0, 0, 0] : [mk.lo, mk.hi, mk.feather, mk.invert ? 1 : 0, mk.scale];
      this.pass(enc, combine, [
        [0, this.uni({
          n, mode: BLENDS.find((b) => b.id === L.blend)!.code, mtype: MASK_CODE[mk.kind], opacity: L.opacity,
          cell: this.cell, maxH: this.maxH, seed: seedU, p: mp,
        })],
        [1, cur], [2, out], [3, cand],
      ], wg, wg);
      cur = out;
      this.thumb(enc, cur, 0, 0, [0, 0, 0], `g:${L.id}`, thumbs);
    }
    this.heightBuf = cur;
  }

  // -------------------------------------------------------------------------
  // analysis, texturing
  // -------------------------------------------------------------------------
  private sunVec(s: Settings): Vec3 {
    const az = (s.sunAz * Math.PI) / 180;
    const el = (s.sunEl * Math.PI) / 180;
    return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
  }

  private analysis(proj: Project, enc: GPUCommandEncoder, full: boolean) {
    const s = proj.settings;
    const n = this.n;
    const wg = Math.ceil(n / 8);
    const H = this.heightBuf!;
    if (full) {
      enc.clearBuffer(this.hist);
      this.pass(enc, this.pipes.attr, [
        [0, this.uni({ n, mode: this.hasFlow ? 1 : 0, cell: this.cell, maxH: this.maxH, seed: s.seed })],
        [1, H], [2, this.flowA], [3, this.fmaxA], [4, this.A], [5, this.hist],
      ], wg, wg);
    }
    const sv = this.sunVec(s);
    const hl = Math.hypot(sv[0], sv[2]) || 1e-4;
    this.pass(enc, this.pipes.shadow, [
      [0, this.uni({ n, cell: this.cell, maxH: this.maxH, seed: s.seed, p: [sv[0] / hl, sv[2] / hl, sv[1] / hl, 0.05] })],
      [1, H], [6, this.SH],
    ], wg, wg);
    this.device.queue.writeBuffer(this.PU, 0, new Float32Array([sv[0], sv[1], sv[2], 0, s.haze, 0, 0, 0]));
    this.pass(enc, this.pipes.probe, [[0, this.PU], [1, this.PR]], 1);
  }

  private texture(proj: Project, enc: GPUCommandEncoder, thumbs: { key: string; tb: GPUBuffer }[]) {
    const s = proj.settings;
    const n = this.n;
    const wg = Math.ceil(n / 8);
    const H = this.heightBuf!;
    const data = new Float32Array(TEX_UNI_FLOATS);
    const base = proj.tex.findIndex((l) => l.enabled);
    data[0] = n; data[1] = base < 0 ? 99 : base; data[2] = this.cell; data[3] = this.maxH;
    const layers = proj.tex.slice(0, 8);
    layers.forEach((L: TexLayer, i: number) => {
      const o = 8 + i * 32;
      const p = L.p;
      const tint = hexToRgb(L.tint);
      const v = [
        L.enabled ? 1 : 0, p.opacity, p.sharp, p.heightBlend,
        p.altOn, p.altMin, p.altMax, p.altFeather,
        p.slopeOn, p.slopeMin, p.slopeMax, p.slopeFeather,
        p.curvOn, p.curvMode, p.curvThr, p.curvFeather,
        p.flowOn, p.flowMin, p.cavOn, p.cavMin,
        p.noiseAmt, p.noiseScale, L.mat, p.scale,
        tint[0], tint[1], tint[2], p.detail,
        p.roughness, i * 13.7, 0, 0,
      ];
      data.set(v, o);
    });
    this.device.queue.writeBuffer(this.TX, 0, data);
    this.pass(enc, this.pipes.splat, [
      [0, this.uni({ n, cell: this.cell, maxH: this.maxH, seed: 0 })],
      [1, H], [4, this.A], [7, this.S0], [8, this.S1], [9, this.TX],
    ], wg, wg);
    // Bake the material stack into world-aligned textures, then build the mip chain.
    const T = Engine.bakeSize(n, s.texScale);
    this.ensureBake(T);
    this.device.queue.writeBuffer(this.BU, 0, new Float32Array([n, T, this.cell, this.maxH, this.worldSize / 2, this.sea, 0, 0]));
    const bw = Math.ceil(T / 8);
    this.pass(enc, this.pipes.bake, [
      [0, this.BU], [1, H], [2, this.S0], [3, this.S1], [4, this.TX],
      [5, this.albTex.createView({ baseMipLevel: 0, mipLevelCount: 1 })],
      [6, this.detTex.createView({ baseMipLevel: 0, mipLevelCount: 1 })],
    ], bw, bw);
    const mips = Math.floor(Math.log2(T)) + 1;
    for (let L = 1; L < mips; L++) {
      const w = Math.max(1, T >> L);
      this.pass(enc, this.pipes.mip, [
        [10, this.albTex.createView({ baseMipLevel: L - 1, mipLevelCount: 1 })],
        [11, this.detTex.createView({ baseMipLevel: L - 1, mipLevelCount: 1 })],
        [12, this.albTex.createView({ baseMipLevel: L, mipLevelCount: 1 })],
        [13, this.detTex.createView({ baseMipLevel: L, mipLevelCount: 1 })],
      ], Math.ceil(w / 8), Math.ceil(w / 8));
    }

    layers.forEach((L, i) => {
      if (!L.enabled) return;
      this.thumb(enc, H, 1, i, hexToRgb(L.tint), `t:${L.id}`, thumbs);
    });
  }

  /** Runs the requested parts of the pipeline in one command submission. */
  async run(proj: Project, opts: RunOpts): Promise<RunResult> {
    const t0 = performance.now();
    const s = proj.settings;
    this.worldSize = s.worldSize;
    this.maxH = s.maxH;
    this.sea = s.sea;
    this.setResolution(s.res);
    this.ensureBake(Engine.bakeSize(s.res, s.texScale));
    this.cell = this.worldSize / (this.n - 1);
    this.uiIdx = 0; this.brIdx = 0; this.tbIdx = 0;
    const enc = this.device.createCommandEncoder({ label: 'run' });
    const thumbs: { key: string; tb: GPUBuffer }[] = [];
    if (opts.gen || !this.heightBuf) {
      this.genStack(proj, enc, thumbs);
      this.analysis(proj, enc, true);
    } else if (opts.sun) {
      this.analysis(proj, enc, false);
    }
    if (opts.gen || opts.tex) this.texture(proj, enc, thumbs);

    // Read back the histogram and all thumbnails in one staging buffer.
    const thumbBytes = THUMB * THUMB * 4;
    const stage = this.device.createBuffer({ size: 512 + thumbs.length * thumbBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    enc.copyBufferToBuffer(this.hist, 0, stage, 0, 512);
    thumbs.forEach((t, i) => enc.copyBufferToBuffer(t.tb, 0, stage, 512 + i * thumbBytes, thumbBytes));
    this.device.queue.submit([enc.finish()]);
    await stage.mapAsync(GPUMapMode.READ);
    const raw = stage.getMappedRange().slice(0);
    stage.unmap();
    stage.destroy();

    const hist = Array.from(new Uint32Array(raw, 0, 128));
    const out: Record<string, string> = {};
    const cv = document.createElement('canvas');
    cv.width = THUMB; cv.height = THUMB;
    const cx = cv.getContext('2d')!;
    thumbs.forEach((t, i) => {
      const px = new Uint8ClampedArray(raw.slice(512 + i * thumbBytes, 512 + (i + 1) * thumbBytes));
      cx.putImageData(new ImageData(px, THUMB, THUMB), 0, 0);
      out[t.key] = cv.toDataURL('image/png');
    });
    return { thumbs: out, hist, hasFlow: this.hasFlow, ms: performance.now() - t0 };
  }

  /** Copy of the final height field, normalised 0..1, row-major (y * n + x). */
  async readHeights(): Promise<Float32Array> {
    if (!this.heightBuf) throw new Error('Nothing generated yet.');
    const buf = await readBack(this.device, this.heightBuf, 0, this.n * this.n * 4);
    return new Float32Array(buf);
  }

  get resolution() { return this.n; }

  // -------------------------------------------------------------------------
  // rendering
  // -------------------------------------------------------------------------
  private ensureDepth() {
    const w = this.canvas.width, h = this.canvas.height;
    if (this.depthTex && this.depthTex.width === w && this.depthTex.height === h) return;
    this.depthTex?.destroy();
    this.depthTex = this.device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.depthView = this.depthTex.createView();
  }

  /** Draws one frame. Frames are gated so only one is in flight, which keeps
   *  compute runs (generation, erosion, bakes) from queuing behind rendering. */
  render(cam: CamState, s: Settings, flags: ViewFlags, time: number): boolean {
    if (!this.heightBuf || !this.canvas.width || this.frameBusy) return false;
    this.frameBusy = true;
    this.device.queue.onSubmittedWorkDone().then(() => { this.frameBusy = false; });
    this.ensureDepth();
    const w = this.canvas.width, h = this.canvas.height;
    const aspect = w / h;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const eye: Vec3 = [
      cam.target[0] + cam.dist * cp * Math.sin(cam.yaw),
      cam.target[1] + cam.dist * sp,
      cam.target[2] + cam.dist * cp * Math.cos(cam.yaw),
    ];
    const near = Math.max(1.5, cam.dist * 0.004);
    const far = Math.max(60000, cam.dist * 8);
    const proj = perspective(cam.fov, aspect, near, far);
    const view = lookAt(eye, cam.target, [0, 1, 0]);
    const vp = mul(proj, view);
    const inv = invert(vp);
    const sv = this.sunVec(s);
    const hw = this.worldSize / 2;
    const vd = new Float32Array(56);
    vd.set(vp, 0);
    vd.set(inv, 16);
    vd.set([eye[0], eye[1], eye[2], time], 32);
    vd.set([sv[0], sv[1], sv[2], 0], 36);
    vd.set([this.n, this.cell, this.maxH, this.sea], 40);
    vd.set([hw, s.haze, s.exposure, 0], 44);
    vd.set([flags.viewMode, Math.max(40, this.maxH * 0.05), flags.showWater ? 1 : 0, flags.showRivers ? 1 : 0], 48);
    vd.set([w, h, 0, 0], 52);
    this.device.queue.writeBuffer(this.V, 0, vd);

    const H = this.heightBuf;
    const p = this.pipes;
    const enc = this.device.createCommandEncoder({ label: 'frame' });
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: this.depthView!, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    const bind = (pipe: GPURenderPipeline, entries: Entry[]) => this.device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: entries.map(([b, r]) => ({ binding: b, resource: toResource(r) })),
    });
    pass.setPipeline(p.sky);
    pass.setBindGroup(0, bind(p.sky, [[0, this.V], [1, this.PR]]));
    pass.draw(3);

    pass.setPipeline(p.terrain);
    pass.setBindGroup(0, bind(p.terrain, [[0, this.V], [1, H], [2, this.A], [3, this.SH], [7, this.PR], [8, this.albView], [9, this.detView], [10, this.smp]]));
    pass.setVertexBuffer(0, this.chunkBuf);
    pass.setIndexBuffer(this.indexBuf, 'uint16');
    pass.drawIndexed(this.indexCount, this.chunkCount);

    pass.setPipeline(p.sea);
    pass.setBindGroup(0, bind(p.sea, [[0, this.V], [1, H], [7, this.PR]]));
    pass.draw(6);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    return true;
  }
}
