/**
 * Frontier Terrain Forge — GPU services.
 *
 * One place that owns the device, the shader module cache, the samplers, the
 * field pool and the counters the status bar reports.
 */
import { initDevice } from './device.js';
import { FieldPool } from './field.js';
import { WgslLibrary } from '../vendor/wgsl/wgsl.js';
import { ComputePass } from './pass.js';

export class Gpu {
  constructor({ device, adapter, info, shaders, log }) {
    this.device = device;
    this.adapter = adapter;
    this.info = info;
    this.shaders = shaders;
    this.log = log;
    this.pool = new FieldPool(device, log);
    this.counters = { dispatches: 0, draws: 0, generates: 0, lastGenerateMs: 0 };
    this.passes = new Map();

    this.samplers = {
      linear: device.createSampler({
        label: 'linear-clamp',
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        maxAnisotropy: 4,
      }),
      nearest: device.createSampler({
        label: 'nearest-clamp',
        magFilter: 'nearest',
        minFilter: 'nearest',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      }),
      shadow: device.createSampler({
        label: 'shadow',
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        compare: 'less-equal',
      }),
      repeat: device.createSampler({
        label: 'linear-repeat',
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'repeat',
        addressModeV: 'repeat',
      }),
    };
    this.defaultSamplers = [this.samplers.linear, this.samplers.nearest];
  }

  field(spec) { return this.pool.acquire(spec); }
  release(field) { this.pool.release(field); }
  releaseAll() { this.pool.releaseAll(); }

  /** Get (or create) a compute pass for a shader path + template define set. */
  pass(spec) {
    const key = `${spec.wgsl}|${JSON.stringify(spec.defines || {})}|${spec.uniform || ''}`;
    let pass = this.passes.get(key);
    if (!pass) {
      pass = new ComputePass(this, spec);
      this.passes.set(key, pass);
    }
    return pass;
  }

  /** Await every pass created so far (module compile before the first frame). */
  async ready() {
    await Promise.all([...this.passes.values()].map((p) => p.whenReady()));
  }

  /** Forget every cached bind group — call after releasing or resizing fields. */
  clearCaches() {
    for (const pass of this.passes.values()) pass.clearCache();
  }

  memoryReport() {
    const stats = this.pool.stats();
    return {
      ...stats,
      megabytes: stats.liveBytes / (1024 * 1024),
      peakMegabytes: stats.peakBytes / (1024 * 1024),
    };
  }
}

export async function createGpu({ log } = {}) {
  const { device, adapter, info } = await initDevice({ onLog: log });
  const shaders = new WgslLibrary(async (path) => {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`shader ${path} → HTTP ${res.status}`);
    return res.text();
  }, new URL('src/vendor/wgsl', document.baseURI).pathname);
  return new Gpu({ device, adapter, info, shaders, log });
}
