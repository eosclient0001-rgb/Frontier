import { shader } from '../gpu/shaders';
import type { Resources } from '../gpu/resources';

/** Full-screen SDF ray-marching renderer. */
export class Renderer {
  private device: GPUDevice;
  private res: Resources;
  private format: GPUTextureFormat;

  private pipeline!: GPURenderPipeline;
  private layout0!: GPUBindGroupLayout;
  private layout1!: GPUBindGroupLayout;
  private bgA!: GPUBindGroup;
  private bgB!: GPUBindGroup;
  private bgCam!: GPUBindGroup;

  constructor(device: GPUDevice, res: Resources, format: GPUTextureFormat) {
    this.device = device;
    this.res = res;
    this.format = format;
    this.build();
  }

  private build() {
    const d = this.device;

    this.layout0 = d.createBindGroupLayout({
      label: 'render g0',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '3d' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });

    this.layout1 = d.createBindGroupLayout({
      label: 'render g1',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    const module = d.createShaderModule({ label: 'render', code: shader('render.wgsl') });

    this.pipeline = d.createRenderPipeline({
      label: 'sdf raymarch',
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.layout0, this.layout1] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });

    const mkBG = (tex: GPUTexture, label: string) =>
      d.createBindGroup({
        label, layout: this.layout0,
        entries: [
          { binding: 0, resource: { buffer: this.res.paramBuf } },
          { binding: 1, resource: tex.createView() },
          { binding: 2, resource: this.res.linSampler },
          { binding: 3, resource: { buffer: this.res.simBuf } },
        ],
      });

    this.bgA = mkBG(this.res.volA, 'render A');
    this.bgB = mkBG(this.res.volB, 'render B');

    this.bgCam = d.createBindGroup({
      label: 'camera',
      layout: this.layout1,
      entries: [{ binding: 0, resource: { buffer: this.res.cameraBuf } }],
    });
  }

  render(encoder: GPUCommandEncoder, target: GPUTextureView, volume: GPUTexture) {
    const pass = encoder.beginRenderPass({
      label: 'main',
      colorAttachments: [{
        view: target,
        clearValue: { r: 0.02, g: 0.02, b: 0.03, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, volume === this.res.volA ? this.bgA : this.bgB);
    pass.setBindGroup(1, this.bgCam);
    pass.draw(3);
    pass.end();
  }
}
