/**
 * Thin WebGPU layer: device bootstrapping, WGSL binding reflection and
 * pipeline + bind-group caching.
 *
 * Reflection keeps the shaders honest: the bind group layouts are derived from
 * the actual WGSL declarations, so a shader can add a texture binding without
 * anybody hand-editing a layout descriptor.
 */

const RESOURCE_IDS = new WeakMap();
const VIEW_CACHE = new WeakMap();
let NEXT_ID = 1;

/** Stable numeric id for any GPU resource (used for bind group cache keys). */
export function resourceId(obj) {
  if (obj === null || typeof obj !== 'object') return String(obj);
  let id = RESOURCE_IDS.get(obj);
  if (id === undefined) {
    id = NEXT_ID++;
    RESOURCE_IDS.set(obj, id);
  }
  return id;
}

/**
 * Build a `requiredLimits` dictionary that is safe to pass to requestDevice.
 *
 * Two rules matter here, and getting either wrong makes boot fail outright:
 *   - an unknown limit name is a hard error (the browser does not ignore it),
 *   - asking for more than the adapter supports is also a hard error.
 * So we only ever ask for a known key, only for values the adapter reports, and
 * only when we actually need more than the default.
 *
 * @param {GPUSupportedLimits} adapterLimits
 * @param {Record<string, number>} desired
 * @returns {Record<string, number>}
 */
export function buildRequiredLimits(adapterLimits, desired) {
  const required = {};
  for (const [key, value] of Object.entries(desired)) {
    // `key in adapterLimits` is the authoritative "is this a real limit" test:
    // GPUSupportedLimits exposes exactly the limits the implementation knows.
    if (!adapterLimits || !(key in adapterLimits)) continue;
    const supported = adapterLimits[key];
    if (typeof supported !== 'number' || Number.isNaN(supported)) continue;
    if (supported < value) continue; // adapter cannot go that high; defaults apply
    required[key] = value;
  }
  return required;
}

/** Everything Frontier needs beyond the WebGPU defaults. */
const DESIRED_LIMITS = {
  // largest grid we ever allocate is 192^3, and the default is 2048
  maxTextureDimension3D: 256,
  // the solver writes at most 4 storage textures per pass - this is also the default
  maxStorageTexturesPerShaderStage: 4,
};

export async function initWebGPU({ canvas, powerPreference = 'high-performance' } = {}) {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new Error(
      'WebGPU is not available in this browser. Frontier needs Chrome/Edge 113+, Safari 26+ or Firefox 141+.'
    );
  }
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference,
    // A discrete GPU with a real 3D texture budget is what we want; fall back
    // silently if the adapter does not exist.
  });
  if (!adapter) throw new Error('No suitable WebGPU adapter found.');

  let requiredLimits = buildRequiredLimits(adapter.limits, DESIRED_LIMITS);

  let device;
  try {
    device = await adapter.requestDevice({ requiredLimits });
  } catch (err) {
    // Never let a limit negotiation mistake be fatal: retry with pure defaults.
    if (Object.keys(requiredLimits).length === 0) throw err;
    console.warn('[frontier] falling back to default device limits:', err.message);
    device = await adapter.requestDevice();
    requiredLimits = {};
  }

  // Report what we actually ended up with - the grid resolution cap comes from
  // the device, not from the adapter request.
  const deviceLimits = device.limits ?? adapter.limits ?? {};
  const maxGrid = Math.min(deviceLimits.maxTextureDimension3D ?? 256, 256);
  if (maxGrid < 64) {
    throw new Error(
      `This GPU only supports ${maxGrid}³ 3D textures, which is too small for volumetric simulation.`
    );
  }

  let context = null;
  let format = 'bgra8unorm';
  if (canvas) {
    context = canvas.getContext('webgpu');
    if (!context) throw new Error('canvas.getContext("webgpu") returned null.');
    format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
  }

  const info = adapter.info ?? {};
  return {
    adapter,
    device,
    context,
    format,
    info: {
      vendor: info.vendor ?? 'unknown',
      architecture: info.architecture ?? 'unknown',
      description: info.description ?? 'unknown',
      maxGrid,
      limits: requiredLimits,
    },
  };
}

const BINDING_RE =
  /@group\((\d+)\)\s*@binding\((\d+)\)\s*var\s*(?:<([A-Za-z0-9_]+)(?:\s*,\s*([A-Za-z0-9_]+))?>)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^;]+);/g;

/**
 * Parse every `@group(n) @binding(m)` declaration out of a WGSL source.
 * Returns Map<group, Array<{binding, name, kind, info}>>.
 *
 * `kind` is one of 'uniform' | 'storage' | 'storageTexture' | 'texture' | 'sampler'.
 */
export function reflectBindings(code) {
  const groups = new Map();
  for (const m of code.matchAll(BINDING_RE)) {
    const group = Number(m[1]);
    const binding = Number(m[2]);
    const addressSpace = m[3];
    const access = m[4];
    const name = m[5];
    const rawType = m[6].trim();

    let kind = 'uniform';
    const info = { name, binding, rawType };

    if (addressSpace === 'storage') {
      kind = 'storage';
      info.access = access ?? 'read';
    } else if (addressSpace === 'uniform') {
      kind = 'uniform';
    } else if (rawType.startsWith('texture_storage_')) {
      kind = 'storageTexture';
      const inner = rawType.slice(rawType.indexOf('<') + 1, rawType.lastIndexOf('>')).split(',');
      info.format = inner[0].trim();
      info.access = (inner[1] ?? 'write').trim();
      info.viewDimension = rawType.includes('_3d') ? '3d' : rawType.includes('_2d') ? '2d' : '2d';
    } else if (rawType.startsWith('texture_')) {
      kind = 'texture';
      const inner = rawType.slice(rawType.indexOf('<') + 1, rawType.lastIndexOf('>')).trim();
      info.sampleType =
        inner === 'f32' ? 'float' : inner === 'i32' ? 'sint' : inner === 'u32' ? 'uint' : 'float';
      info.viewDimension = rawType.includes('_3d') ? '3d' : rawType.includes('_cube') ? 'cube' : '2d';
    } else if (rawType === 'sampler' || rawType === 'sampler_comparison') {
      kind = 'sampler';
      // Naming convention: samplers ending in NF are non-filtering, which lets a
      // single shader mix linear-sampled fp16 volumes with nearest-sampled fp32
      // pressure fields.
      info.samplerType = /NF$|NF\b/.test(name) ? 'non-filtering' : 'filtering';
    }

    info.kind = kind;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(info);
  }
  for (const list of groups.values()) list.sort((a, b) => a.binding - b.binding);
  return groups;
}

/** Cached compute / render pipelines + bind groups for one WGSL module. */
export class Program {
  /**
   * @param {GPUDevice} device
   * @param {string} code WGSL source
   * @param {object} [options]
   * @param {string[]} [options.unfilterable] texture binding names that need
   *   the 'unfilterable-float' sample type (32-bit float storage textures)
   */
  constructor(device, code, { label = 'program', unfilterable = [] } = {}) {
    this.device = device;
    this.code = code;
    this.label = label;
    this.bindings = reflectBindings(code);
    this.unfilterable = new Set(unfilterable);
    this._layouts = new Map();
    this._pipelines = new Map();
    this._groups = new Map();

    // Fail loudly and early with the WGSL error position if compilation fails.
    this.shaderModule = device.createShaderModule({ code, label });
  }

  async compileInfo() {
    if (!this.shaderModule.getCompilationInfo) return [];
    const info = await this.shaderModule.getCompilationInfo();
    return info.messages ?? [];
  }

  layout(groupIndex) {
    let layout = this._layouts.get(groupIndex);
    if (layout) return layout;
    const entries = [];
    for (const b of this.bindings.get(groupIndex) ?? []) {
      const visibility = GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT;
      switch (b.kind) {
        case 'uniform':
          entries.push({ binding: b.binding, visibility, buffer: { type: 'uniform' } });
          break;
        case 'storage':
          entries.push({ binding: b.binding, visibility, buffer: { type: 'storage' } });
          break;
        case 'storageTexture':
          entries.push({
            binding: b.binding,
            visibility,
            storageTexture: {
              access: b.access === 'read_write' ? 'read-write' : b.access === 'read' ? 'read-only' : 'write-only',
              format: b.format,
              viewDimension: b.viewDimension,
            },
          });
          break;
        case 'texture':
          entries.push({
            binding: b.binding,
            visibility,
            texture: {
              sampleType: this.unfilterable.has(b.name) ? 'unfilterable-float' : b.sampleType,
              viewDimension: b.viewDimension,
              multisampled: false,
            },
          });
          break;
        case 'sampler':
          entries.push({ binding: b.binding, visibility, sampler: { type: b.samplerType } });
          break;
        default:
          break;
      }
    }
    layout = this.device.createBindGroupLayout({ entries, label: `${this.label}.group${groupIndex}` });
    this._layouts.set(groupIndex, layout);
    return layout;
  }

  pipelineLayout() {
    const maxGroup = Math.max(0, ...this.bindings.keys());
    const layouts = [];
    for (let i = 0; i <= maxGroup; i += 1) layouts.push(this.layout(i));
    if (!this._pipelineLayout) {
      this._pipelineLayout = this.device.createPipelineLayout({
        bindGroupLayouts: layouts,
        label: `${this.label}.layout`,
      });
    }
    return this._pipelineLayout;
  }

  /** Create (and cache) a compute pipeline for `entryPoint`. */
  compute(entryPoint = 'main') {
    const key = 'c:' + entryPoint;
    let p = this._pipelines.get(key);
    if (!p) {
      p = this.device.createComputePipeline({
        layout: this.pipelineLayout(),
        compute: { module: this.shaderModule, entryPoint },
        label: `${this.label}.${entryPoint}`,
      });
      this._pipelines.set(key, p);
    }
    return p;
  }

  /** Create (and cache) a render pipeline. */
  render({
    vertex = 'vsMain',
    fragment = 'fsMain',
    format = 'bgra8unorm',
    primitive = { topology: 'triangle-list' },
    blend,
  } = {}) {
    const key = `r:${vertex}:${fragment}:${format}`;
    let p = this._pipelines.get(key);
    if (!p) {
      const target = { format };
      if (blend) {
        target.blend = {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        };
      }
      p = this.device.createRenderPipeline({
        layout: this.pipelineLayout(),
        vertex: { module: this.shaderModule, entryPoint: vertex },
        fragment: { module: this.shaderModule, entryPoint: fragment, targets: [target] },
        primitive,
        label: `${this.label}.render`,
      });
      this._pipelines.set(key, p);
    }
    return p;
  }

  /**
   * Bind group from a name -> resource map.
   * Textures are auto-viewed; samplers/buffers are used as-is.
   * Cached by (group, names, resource ids) so steady-state frames allocate nothing.
   */
  group(index, resources = {}) {
    const decls = this.bindings.get(index) ?? [];
    const parts = [];
    const entries = [];
    for (const b of decls) {
      const res = resources[b.name];
      if (!res) {
        throw new Error(
          `${this.label}: missing resource '${b.name}' (binding ${b.binding}) for group ${index}. ` +
            `Expected one of: ${decls.map((d) => d.name).join(', ')}`
        );
      }
      let bound = res;
      let view = res;
      if (typeof GPUTexture !== 'undefined' && res instanceof GPUTexture) {
        // cache views off-object: GPU resources are host objects and expando
        // properties are not guaranteed to be allowed on every implementation
        let views = VIEW_CACHE.get(res);
        if (!views) {
          views = new Map();
          VIEW_CACHE.set(res, views);
        }
        const key = b.viewDimension;
        view = views.get(key);
        if (!view) {
          view = res.createView({ dimension: key, label: `${res.label ?? 'tex'}.${key}` });
          views.set(key, view);
        }
      }
      bound = view;
      entries.push({ binding: b.binding, resource: bound });
      parts.push(`${b.name}:${resourceId(res)}`);
    }
    const cacheKey = `${index}|${parts.join(',')}`;
    let g = this._groups.get(cacheKey);
    if (!g) {
      g = this.device.createBindGroup({
        layout: this.layout(index),
        entries,
        label: `${this.label}.group${index}`,
      });
      this._groups.set(cacheKey, g);
      this._groupCacheOrder = this._groupCacheOrder ?? [];
      this._groupCacheOrder.push(cacheKey);
      // Bound the cache: ping-pong pairs and quality changes can churn keys.
      if (this._groupCacheOrder.length > 256) {
        const drop = this._groupCacheOrder.splice(0, 64);
        for (const k of drop) this._groups.delete(k);
      }
    }
    return g;
  }

  destroy() {
    this._pipelines.clear();
    this._groups.clear();
    this._layouts.clear();
    this._pipelineLayout = undefined;
  }
}
