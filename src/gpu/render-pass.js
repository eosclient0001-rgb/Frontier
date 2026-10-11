/**
 * Frontier Terrain Forge — render pass abstraction.
 *
 * The compute side derives everything from the generated layout metadata; render
 * pipelines do the same here. A pass is declared as a WGSL module plus its
 * targets, and its bind group layouts, uniform buffers, pipeline and draw calls
 * all follow from the reflected bindings. Adding the water pass, the shadow pass
 * or a new post effect is therefore a shader and ten lines, not descriptor
 * plumbing spread across three files.
 */
import { moduleBindings } from '../gen/gpu_layout.js';
import { UniformWriter } from './uniform.js';

const isField = (resource) => resource && typeof resource.binding === 'function';

function resolveTexture(resource, binding) {
  if (isField(resource)) return resource.binding(binding);
  if (resource && resource.view) return typeof resource.view === 'function' ? resource.view() : resource.view;
  if (resource && resource.texture) return resource.texture.createView();
  return resource;
}

export class RenderPass {
  /**
   * @param {object} gpu
   * @param {object} spec
   *   spec.wgsl      shader module path
   *   spec.label     human readable name
   *   spec.defines   template values
   *   spec.targets   [{ format, blend }] colour targets (default: the scene format)
   *   spec.depth     depth format or null
   *   spec.depthWrite, spec.depthCompare, spec.topology, spec.cullMode
   */
  constructor(gpu, spec) {
    this.gpu = gpu;
    this.spec = spec;
    this.label = spec.label || spec.wgsl;
    this.ready = false;
    this.groupCache = new Map();
    this.resourceIds = new WeakMap();
    this.nextResourceId = 1;
    this._pending = this._init();
  }

  async _init() {
    const { device } = this.gpu;
    const spec = this.spec;
    const code = await this.gpu.shaders.module(spec.wgsl, spec.defines || {});
    this.code = code;
    this.module = device.createShaderModule({ label: this.label, code });
    this.bindings = moduleBindings(spec.wgsl);

    const byGroup = new Map();
    for (const binding of this.bindings) {
      if (!byGroup.has(binding.group)) byGroup.set(binding.group, []);
      byGroup.get(binding.group).push(binding);
    }

    const stages = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.groupPlan = [];
    for (const group of [...byGroup.keys()].sort((a, b) => a - b)) {
      const list = byGroup.get(group);
      const hasDepth = list.some((b) => b.kind === 'texture' && String(b.format || '').startsWith('depth'));
      const entries = list.map((binding) => {
        if (binding.kind === 'uniform') {
          return { binding: binding.binding, visibility: stages, buffer: { type: 'uniform' } };
        }
        if (binding.kind === 'sampler') {
          return {
            binding: binding.binding,
            visibility: stages,
            sampler: { type: binding.type === 'comparison' ? 'comparison' : hasDepth ? 'non-filtering' : 'filtering' },
          };
        }
        if (String(binding.format || '').startsWith('depth')) {
          return { binding: binding.binding, visibility: stages, texture: { sampleType: 'depth', viewDimension: '2d' } };
        }
        return {
          binding: binding.binding,
          visibility: stages,
          texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
        };
      });
      this.groupPlan.push({ index: group, role: group === 0 ? 'common' : 'textures', bindings: list, entries });
    }

    this.bindGroupLayouts = this.groupPlan.map((plan, i) =>
      device.createBindGroupLayout({ label: `${this.label}:bgl${i}`, entries: plan.entries }),
    );
    const pipelineLayout = device.createPipelineLayout({
      label: `${this.label}:layout`,
      bindGroupLayouts: this.bindGroupLayouts,
    });

    const targets = (spec.targets || [{ format: spec.format || 'rgba16float' }]).map((target) => ({
      format: target.format,
      blend: target.blend || undefined,
    }));

    this.pipeline = device.createRenderPipeline({
      label: this.label,
      layout: pipelineLayout,
      vertex: { module: this.module, entryPoint: spec.vs || 'vs' },
      fragment: { module: this.module, entryPoint: spec.fs || 'fs', targets },
      primitive: {
        topology: spec.topology || 'triangle-list',
        stripIndexFormat: spec.topology === 'triangle-strip' ? 'uint32' : undefined,
        cullMode: spec.cullMode || 'none',
        frontFace: spec.frontFace || 'ccw',
      },
      depthStencil: spec.depth
        ? {
          format: spec.depth,
          depthWriteEnabled: spec.depthWrite !== false,
          depthCompare: spec.depthCompare || 'less-equal',
        }
        : undefined,
      multisample: { count: 1 },
    });

    // One uniform buffer per uniform binding in the module.
    this.uniforms = {};
    for (const binding of this.bindings) {
      if (binding.kind !== 'uniform') continue;
      this.uniforms[binding.name] = new UniformWriter(device, spec.wgsl, binding.struct, `${this.label}:${binding.name}`);
    }
    this.ready = true;
    return this;
  }

  whenReady() { return this._pending; }

  writeUniform(name, values) {
    const writer = this.uniforms[name];
    if (writer) writer.write(values);
    return writer;
  }

  /**
   * Build and set the bind groups for this pass.
   * resources: { uniforms: {name: writer}, samplers: {name: sampler}, textures: {name: Field|{view}} }
   */
  bind(pass, resources = {}) {
    const { device } = this.gpu;
    this.groupPlan.forEach((plan, index) => {
      const entries = [];
      for (const binding of plan.bindings) {
        let resource = null;
        if (binding.kind === 'uniform') {
          const writer = resources.uniforms?.[binding.name] ?? this.uniforms[binding.name];
          if (!writer) throw new Error(`${this.label}: no uniform for ${binding.name}`);
          resource = { buffer: writer.buffer };
        } else if (binding.kind === 'sampler') {
          resource = resources.samplers?.[binding.name];
          if (!resource) throw new Error(`${this.label}: no sampler for ${binding.name}`);
        } else {
          const texture = resources.textures?.[binding.name];
          if (!texture) throw new Error(`${this.label}: no texture for ${binding.name}`);
          resource = resolveTexture(texture, binding);
        }
        entries.push({ binding: binding.binding, resource });
      }
      const key = `${index}|${entries.map((e) => `${e.binding}#${this._resourceId(e.resource)}`).join(',')}`;
      let group = this.groupCache.get(key);
      if (!group) {
        group = device.createBindGroup({ label: `${this.label}:g${index}`, layout: this.bindGroupLayouts[index], entries });
        this.groupCache.set(key, group);
        if (this.groupCache.size > 24) this.groupCache.clear();
      }
      pass.setBindGroup(index, group);
    });
    return this;
  }

  draw(pass, { indexCount = 0, vertexCount = 0, instances = 1, firstIndex = 0, firstVertex = 0 } = {}) {
    if (indexCount > 0) pass.drawIndexed(indexCount, instances, firstIndex, 0, 0);
    else if (vertexCount > 0) pass.draw(vertexCount, instances, firstVertex);
    this.gpu.counters.draws++;
    return this;
  }

  drawFullscreen(pass) { return this.draw(pass, { vertexCount: 3 }); }

  _resourceId(resource) {
    const target = resource.buffer ?? resource.texture ?? resource;
    let id = this.resourceIds.get(target);
    if (id === undefined) { id = this.nextResourceId++; this.resourceIds.set(target, id); }
    return id;
  }

  clearCache() { this.groupCache.clear(); }

  destroy() {
    for (const writer of Object.values(this.uniforms || {})) writer.destroy();
  }
}
