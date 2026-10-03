/**
 * Uniform packing.
 *
 * Every WGSL uniform struct in this project is built exclusively from vec4s, so
 * the memory layout is simply "16 bytes per member, in declaration order". The
 * packer mirrors that exactly - no alignment tables, no std140 surprises.
 *
 * Layout entry form: [name, kind] where kind is 'vec4f' | 'vec4u' | 'mat4'.
 */
export class UniformPacker {
  /**
   * @param {Array<[string, string]>} layout
   */
  constructor(layout, label = 'uniform') {
    this.label = label;
    this.fields = new Map();
    let floats = 0;
    let uints = 0;
    let offset = 0;
    for (const [name, kind] of layout) {
      const size = kind === 'mat4' ? 64 : 16;
      this.fields.set(name, { offset, kind, size });
      if (kind === 'mat4') floats += 16;
      if (kind === 'vec4f') floats += 4;
      if (kind === 'vec4u') uints += 4;
      offset += size;
    }
    this.byteLength = offset;
    // The buffer holds both views; float and uint data are laid out by field,
    // so a mixed struct needs a raw ArrayBuffer with two typed views.
    this.buffer = new ArrayBuffer(offset);
    this.f32 = new Float32Array(this.buffer);
    this.u32 = new Uint32Array(this.buffer);
  }

  _loc(name) {
    const f = this.fields.get(name);
    if (!f) throw new Error(`${this.label}: unknown uniform field '${name}'`);
    return f;
  }

  /** set('dt', dt, subDt, time, frame) - missing values default to 0. */
  set(name, ...values) {
    const f = this._loc(name);
    if (f.kind === 'mat4') {
      const m = values[0];
      for (let i = 0; i < 16; i += 1) this.f32[f.offset / 4 + i] = m[i] ?? 0;
      return this;
    }
    for (let i = 0; i < 4; i += 1) {
      const v = values[i] ?? 0;
      const idx = f.offset / 4 + i;
      if (f.kind === 'vec4u') this.u32[idx] = v >>> 0;
      else this.f32[idx] = v;
    }
    return this;
  }

  /** Bulk set from an object: { dt: [a,b,c,d], grid: [x,y,z,0] }. */
  setAll(obj) {
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      this.set(key, ...(Array.isArray(v) ? v : [v]));
    }
    return this;
  }
}

/** Fixed layouts, mirrored in the WGSL (see shaders/common.wgsl.js). */
export const SIM_LAYOUT = [
  ['grid', 'vec4u'], // xyz = cells, w unused
  ['dt', 'vec4f'], // x frame dt, y substep dt, z time, w frame
  ['volMin', 'vec4f'],
  ['volSize', 'vec4f'],
  ['force', 'vec4f'],
  ['wind', 'vec4f'],
  ['drag', 'vec4f'],
  ['fire', 'vec4f'],
  ['misc', 'vec4f'],
  ['obstacle', 'vec4f'],
  ['obstacleShape', 'vec4f'],
  ['blast', 'vec4f'],
  ['quality', 'vec4u'],
  ['swirls', 'vec4f'],
];

export const RENDER_LAYOUT = [
  ['invViewProj', 'mat4'],
  ['camPos', 'vec4f'],
  ['volMin', 'vec4f'],
  ['volSize', 'vec4f'],
  ['lightDir', 'vec4f'],
  ['lightColor', 'vec4f'],
  ['skyZenith', 'vec4f'],
  ['skyHorizon', 'vec4f'],
  ['opt', 'vec4f'],
  ['opt2', 'vec4f'],
  ['opt3', 'vec4f'],
  ['fireLight', 'vec4f'],
  ['fireLightColor', 'vec4f'],
  ['misc', 'vec4f'],
  ['obstacle', 'vec4f'],
  ['obstacleShape', 'vec4f'],
];

export const EMITTER_STRIDE = 24; // floats per item (6 vec4s)
export const MAX_EMITTERS = 16;

/**
 * Packs the emitter array.
 * Header: count (vec4<u32>), then MAX_EMITTERS * 6 vec4<f32> items.
 */
export class EmitterPacker {
  constructor() {
    this.count = 0;
    this.bytes = 16 + MAX_EMITTERS * 6 * 16;
    this.buffer = new ArrayBuffer(this.bytes);
    this.f32 = new Float32Array(this.buffer);
    this.u32 = new Uint32Array(this.buffer);
  }

  pack(emitters) {
    this.f32.fill(0);
    const n = Math.min(emitters.length, MAX_EMITTERS);
    this.u32[0] = n;
    for (let i = 0; i < n; i += 1) {
      const e = emitters[i];
      const base = (16 + i * 6 * 16) / 4;
      // posRadius
      this.f32[base + 0] = e.position[0];
      this.f32[base + 1] = e.position[1];
      this.f32[base + 2] = e.position[2];
      this.f32[base + 3] = e.radius;
      // velDensity
      this.f32[base + 4] = e.velocity[0];
      this.f32[base + 5] = e.velocity[1];
      this.f32[base + 6] = e.velocity[2];
      this.f32[base + 7] = e.densityRate;
      // sizeTemp
      this.f32[base + 8] = e.size[0];
      this.f32[base + 9] = e.size[1];
      this.f32[base + 10] = e.size[2];
      this.f32[base + 11] = e.temperatureRate;
      // fuelColor (xyz fuel rate, w soot rate)
      this.f32[base + 12] = e.fuelRate;
      this.f32[base + 13] = e.fuelRate;
      this.f32[base + 14] = e.fuelRate;
      this.f32[base + 15] = e.emberRate;
      // colorKind (xyz tint, w kind)
      this.f32[base + 16] = e.color[0];
      this.f32[base + 17] = e.color[1];
      this.f32[base + 18] = e.color[2];
      this.f32[base + 19] = e.kind;
      // shape (x softness, y flicker, z swirl, w life)
      this.f32[base + 20] = e.softness;
      this.f32[base + 21] = e.flicker;
      this.f32[base + 22] = e.swirl;
      this.f32[base + 23] = e.life;
    }
    return this.buffer;
  }
}
