/**
 * Frontier Terrain Forge — compute pass abstraction.
 *
 * Every pass in the graph is created from its WGSL module path alone. The
 * generated layout metadata (src/gen/gpu_layout.js) tells the runtime which
 * bindings the module declares, what each uniform struct looks like and how big
 * it is, so bind group layouts, pipeline layouts and uniform packing are all
 * derived rather than hand-written. Adding a shader to the graph is therefore
 * "add a file and a spec", never "add a file and wire seven descriptors".
 */
import { SHADER_LAYOUTS, moduleBindings } from '../gen/gpu_layout.js';
import { UniformWriter } from './uniform.js';

export class ComputePass {
  /**
   * @param {object} gpu   the device bundle from createGpu()
   * @param {object} spec
   *   spec.wgsl      'passes/erosion_flow.wgsl'
   *   spec.entry     'main' (default)
   *   spec.defines   template values, e.g. { LAYER: 'mountain' }
   *   spec.label     human readable name for the profiler
   *   spec.uniform   struct name; defaults to the module's uniform binding
   */
  constructor(gpu, spec) {
    this.gpu = gpu;
    this.spec = spec;
    this.label = spec.label || spec.wgsl;
    this.entry = spec.entry || 'main';
    this.bindings = moduleBindings(spec.wgsl);
    if (!this.bindings.length && !spec.allowEmpty) {
      throw new Error(`pass ${spec.wgsl} declares no bindings — did the layout metadata go stale?`);
    }
    this.ready = false;
    this._pending = this._init();
  }

  async _init() {
    const { device } = this.gpu;
    const code = await this.gpu.shaders.module(this.spec.wgsl, this.spec.defines || {});
    this.code = code;
    this.module = device.createShaderModule({ label: this.label, code });

    const uniformEntry = this.bindings.find((b) => b.kind === 'uniform');
    const samplers = this.bindings.filter((b) => b.kind === 'sampler');
    const textures = this.bindings.filter((b) => b.kind === 'texture');
    const storage = this.bindings.filter((b) => b.kind === 'storage');

    this.uniform = uniformEntry
      ? new UniformWriter(device, this.spec.wgsl, this.spec.uniform || uniformEntry.struct, this.label)
      : null;

    // group 0: uniform + samplers (grouped so a pass can have either or both)
    const group0 = [];
    if (uniformEntry) {
      group0.push({
        binding: uniformEntry.binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' },
      });
    }
    for (const sampler of samplers) {
      group0.push({
        binding: sampler.binding,
        visibility: GPUShaderStage.COMPUTE,
        sampler: { type: sampler.type === 'comparison' ? 'comparison' : 'filtering' },
      });
    }
    const group1 = textures.map((t) => ({
      binding: t.binding,
      visibility: GPUShaderStage.COMPUTE,
      texture: { sampleType: 'unfilterable-float', viewDimension: '2d', multisampled: false },
    }));
    const group2 = storage.map((s) => ({
      binding: s.binding,
      visibility: GPUShaderStage.COMPUTE,
      storageTexture: { access: s.access === 'read' ? 'read-only' : 'write-only', format: s.format, viewDimension: '2d' },
    }));

    // Groups are created in the order the shader declares them, and the same
    // ordered plan is replayed at record time, so the layout index and the
    // setBindGroup index can never disagree.
    this.groupPlan = [];
    if (group0.length) this.groupPlan.push({ role: 'common', entries: group0 });
    if (group1.length) this.groupPlan.push({ role: 'textures', entries: group1 });
    if (group2.length) this.groupPlan.push({ role: 'storage', entries: group2 });
    this.bindGroupLayouts = this.groupPlan.map((plan, i) =>
      device.createBindGroupLayout({ label: `${this.label}:bgl${i}`, entries: plan.entries }),
    );
    // Bind groups are cached by resource identity: a solver loop that dispatches
    // the same pass 400 times against two ping-pong textures creates two groups,
    // not 1200. The cache is dropped whenever fields are released.
    this.groupCache = new Map();
    this.resourceIds = new WeakMap();
    this.nextResourceId = 1;

    const pipelineLayout = device.createPipelineLayout({
      label: `${this.label}:layout`,
      bindGroupLayouts: this.bindGroupLayouts,
    });
    this.pipeline = device.createComputePipeline({
      label: this.label,
      layout: pipelineLayout,
      compute: { module: this.module, entryPoint: this.entry },
    });

    this.textureBindings = textures;
    this.storageBindings = storage;
    this.samplerBindings = samplers;
    this.ready = true;
    return this;
  }

  async whenReady() { return this._pending; }

  /**
   * Record the pass.
   * @param {GPUCommandEncoder} encoder
   * @param {object} args
   *   args.uniform   plain object of uniform values
   *   args.textures  { [bindingName]: Field }
   *   args.storage   { [bindingName]: Field }
   *   args.groups    how many workgroups (x, y) or {x,y,z}
   *   args.samplers  optional override list of GPUSampler
   */
  record(encoder, args) {
    const { device } = this.gpu;
    if (!this.ready) throw new Error(`${this.label} used before its module finished loading`);
    if (this.gpu.strict) this._verify(args);
    if (this.uniform && args.uniform) this.uniform.write(args.uniform);

    const groups = [];
    this.groupPlan.forEach((plan, index) => {
      const entries = [];
      if (plan.role === 'common') {
        if (this.uniform) entries.push({ binding: this._uniformBinding(), resource: { buffer: this.uniform.buffer } });
        const samplerList = args.samplers && args.samplers.length ? args.samplers : this.gpu.defaultSamplers;
        this.samplerBindings.forEach((b, i) => {
          entries.push({ binding: b.binding, resource: samplerList[i % samplerList.length] });
        });
      } else {
        const list = plan.role === 'textures' ? this.textureBindings : this.storageBindings;
        const given = plan.role === 'textures' ? args.textures : args.storage;
        for (const binding of list) {
          const field = given?.[binding.name];
          if (!field) throw new Error(`${this.label}: missing ${plan.role} binding '${binding.name}'`);
          entries.push({ binding: binding.binding, resource: field.binding(binding) });
        }
      }
      const key = `${plan.role}|${entries.map((e) => `${e.binding}#${this._resourceId(e.resource)}`).join(',')}`;
      let group = this.groupCache.get(key);
      if (!group) {
        group = device.createBindGroup({
          label: `${this.label}:g${index}`,
          layout: this.bindGroupLayouts[index],
          entries,
        });
        this.groupCache.set(key, group);
        if (this.groupCache.size > 64) this.groupCache.clear();
      }
      groups.push(group);
    });

    const pass = encoder.beginComputePass({ label: this.label });
    pass.setPipeline(this.pipeline);
    groups.forEach((group, i) => pass.setBindGroup(i, group));
    const work = args.groups || { x: 1, y: 1, z: 1 };
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(work.x)), Math.max(1, Math.ceil(work.y)), work.z || 1);
    pass.end();
    this.gpu.counters.dispatches++;
  }

  /**
   * Development-time contract check. The graph is data-driven, so a typo in a
   * binding name or a uniform key would silently do nothing on the GPU; in
   * strict mode it is reported instead. tools/simulate.mjs runs the whole graph
   * with strict on, which is how the headless world catches these mistakes.
   */
  _verify(args) {
    const report = (message) => this.gpu.log?.({ level: 'warn', message: `${this.label}: ${message}` });
    const checkMap = (list, given, kind) => {
      const names = new Set(list.map((b) => b.name));
      for (const b of list) {
        if (!given || !(b.name in given)) report(`missing ${kind} binding '${b.name}'`);
      }
      for (const key of Object.keys(given || {})) {
        if (!names.has(key)) report(`unknown ${kind} binding '${key}'`);
      }
    };
    checkMap(this.textureBindings, args.textures, 'texture');
    checkMap(this.storageBindings, args.storage, 'storage');

    if (!this.uniform || !args.uniform) return;
    const uniform = args.uniform;
    if (ArrayBuffer.isView(uniform)) return;
    const scan = (value, path, depth) => {
      if (depth > 3 || value == null) return;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) report(`uniform ${path} is ${value}`);
        return;
      }
      if (Array.isArray(value) || typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) scan(item, path ? `${path}.${key}` : key, depth + 1);
      }
    };
    for (const [key, value] of Object.entries(uniform)) {
      if (!(key in this.uniform.struct.fields)) report(`unknown uniform field '${key}'`);
      scan(value, key, 0);
    }
  }

  _resourceId(resource) {
    const target = resource.buffer ?? resource.texture ?? resource;
    let id = this.resourceIds.get(target);
    if (id === undefined) {
      id = this.nextResourceId++;
      this.resourceIds.set(target, id);
    }
    return id;
  }

  /** Drop cached bind groups that may reference released fields. */
  clearCache() {
    this.groupCache.clear();
    this.resourceIds = new WeakMap();
    this.nextResourceId = 1;
  }

  _uniformBinding() {
    return this.bindings.find((b) => b.kind === 'uniform').binding;
  }

  /** Convenience: workgroup count for a texture of the given size. */
  static groups(width, height, workgroup = 8) {
    return { x: Math.ceil(width / workgroup), y: Math.ceil(height / workgroup), z: 1 };
  }

  destroy() {
    this.uniform?.destroy();
    this.pipeline = null;
    this.module = null;
  }
}

/** Everything a pass module declares, for tooling and diagnostics. */
export function describePass(wgslPath) {
  return SHADER_LAYOUTS[wgslPath] || null;
}
