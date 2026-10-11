/**
 * Frontier Terrain Forge — GPU fields.
 *
 * A Field is one texture plus every view of it the graph ever needs:
 *
 *   storageView  storage binding (read or write)   — pass inputs/outputs
 *   sampledView  texture_2d<f32> binding           — textureLoad inputs
 *   srgbView     texture_2d<f32>, sRGB decoding    — colour on the GPU
 *
 * Fields are pooled by spec so a regenerate on a 4K project does not thrash the
 * allocator: acquire() reuses a released field with an identical description and
 * reset() returns everything to the pool at the end of a run.
 */

const FORMATS = {
  r32float: { bytes: 4, filterable: false, storage: true, srgb: false },
  rg32float: { bytes: 8, filterable: false, storage: true, srgb: false },
  rgba32float: { bytes: 16, filterable: false, storage: true, srgb: false },
  rgba16float: { bytes: 8, filterable: true, storage: true, srgb: false },
  rgba8unorm: { bytes: 4, filterable: true, storage: true, srgb: true },
  rg8unorm: { bytes: 2, filterable: true, storage: true, srgb: false },
  r8unorm: { bytes: 1, filterable: true, storage: true, srgb: false },
};

export class Field {
  constructor(device, { width, height, format = 'r32float', label = 'field', srgb = false, mips = false }) {
    const spec = FORMATS[format];
    if (!spec) throw new Error(`unknown field format ${format}`);
    this.device = device;
    this.label = label;
    this.format = format;
    this.width = width;
    this.height = height;
    this.srgb = srgb && spec.srgb;
    this.key = `${label}|${width}x${height}|${format}|${this.srgb}`;
    this._viewCache = new Map();

    const usage =
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT;

    this.texture = device.createTexture({
      label,
      size: { width, height, depthOrArrayLayers: 1 },
      format,
      mipLevelCount: mips ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1,
      sampleCount: 1,
      viewFormats: this.srgb ? [`${format}-srgb`] : undefined,
      usage,
    });
  }

  view(kind) {
    if (this._viewCache.has(kind)) return this._viewCache.get(kind);
    let view;
    if (kind === 'read') view = this.texture.createView({ format: this.format, aspect: 'all' });
    else if (kind === 'write') view = this.texture.createView({ format: this.format, aspect: 'all' });
    else if (kind === 'sampled') view = this.texture.createView({ format: this.format, aspect: 'all' });
    else if (kind === 'srgb') view = this.texture.createView({ format: `${this.format}-srgb`, aspect: 'all' });
    else if (kind === 'depth') view = this.texture.createView({ format: this.format, aspect: 'depth-only' });
    else throw new Error(`unknown view ${kind}`);
    this._viewCache.set(kind, view);
    return view;
  }

  get storageRead() { return this.view('read'); }
  get storageWrite() { return this.view('write'); }
  get sampled() { return this.view('sampled'); }
  get colorSampled() { return this.srgb ? this.view('srgb') : this.view('sampled'); }

  /** Bind a resource for a shader binding described by gpu_layout metadata. */
  binding(entry) {
    if (entry.kind === 'texture') {
      if (String(entry.format || '').startsWith('depth')) return this.view('depth');
      return this.colorSampled;
    }
    if (entry.kind === 'storage') return entry.access === 'read' ? this.storageRead : this.storageWrite;
    throw new Error(`cannot bind a Field to ${entry.kind}`);
  }

  bytes() {
    return this.width * this.height * FORMATS[this.format].bytes;
  }

  destroy() {
    this._viewCache.clear();
    this.texture.destroy();
  }
}

export class FieldPool {
  constructor(device, log = () => {}) {
    this.device = device;
    this.log = log;
    this.live = new Map();     // key -> array of free fields
    this.inUse = new Set();
    this.peakBytes = 0;
    this.liveBytes = 0;
  }

  acquire({ width, height, format = 'r32float', label = 'tmp', srgb = false }) {
    const key = `${label}|${width}x${height}|${format}|${srgb}`;
    const bucket = this.live.get(key);
    let field;
    if (bucket && bucket.length) {
      field = bucket.pop();
    } else {
      field = new Field(this.device, { width, height, format, label, srgb });
    }
    this.inUse.add(field);
    this.liveBytes += field.bytes();
    this.peakBytes = Math.max(this.peakBytes, this.liveBytes);
    return field;
  }

  release(field) {
    if (!field || !this.inUse.delete(field)) return;
    this.liveBytes -= field.bytes();
    const bucket = this.live.get(field.key) || [];
    bucket.push(field);
    this.live.set(field.key, bucket);
  }

  releaseAll() {
    for (const field of [...this.inUse]) this.release(field);
  }

  /** Drop everything — used when the working resolution changes. */
  clear() {
    for (const bucket of this.live.values()) for (const field of bucket) field.destroy();
    this.live.clear();
    this.liveBytes = 0;
  }

  stats() {
    let pooled = 0;
    for (const bucket of this.live.values()) pooled += bucket.length;
    return { pooled, inUse: this.inUse.size, liveBytes: this.liveBytes, peakBytes: this.peakBytes };
  }
}
