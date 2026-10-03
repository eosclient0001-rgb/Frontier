import { Program } from '../gpu/WebGPU.js';
import { UniformPacker, RENDER_LAYOUT } from '../gpu/UniformBuilder.js';
import { WGSL_RENDER } from './shaders/render.wgsl.js';
import { normalize3 } from '../gpu/mat4.js';

/**
 * Draws the simulation volume with a single raymarching pass.
 *
 * Everything about the *look* lives in `settings`: extinction/emission, sun and
 * sky, ground, exposure, shadow taps, plus a debug slice mode for inspecting the
 * solver fields.
 */
export class VolumetricRenderer {
  constructor(device, context, format, solver, options = {}) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.solver = solver;

    this.settings = {
      // march quality
      steps: 96,
      jitter: 1.0,
      // volume response
      extinction: 1.9,
      emission: 42.0,
      flameScale: 1.0,
      smokeAlbedo: 0.9,
      scattering: 0.35,
      shadowTaps: 2,
      shadowDensity: 2.2,
      // environment
      sunDirection: [0.45, 0.72, 0.35],
      sunIntensity: 2.6,
      sunColor: [1.0, 0.96, 0.9],
      skyZenith: [0.055, 0.08, 0.13],
      skyHorizon: [0.16, 0.17, 0.21],
      sunSize: 900,
      ambient: 0.55,
      groundAlbedo: 0.42,
      groundFog: 0.05,
      // plume light (approximated, drives ground bounce + smoke bounce)
      fireLightPosition: [0, 1.5, 0],
      fireLightColor: [1.0, 0.55, 0.2],
      fireLightIntensity: 2.5,
      // output
      exposure: 0.0,
      exposureBias: 0.0,
      // debug: 0 beauty, 1 density, 2 heat, 3 fuel, 4 velocity, 5 SDF
      debugMode: 0,
      debugAxis: 1,
      debugSlice: 0.5,
      ...options,
    };

    this.packer = new UniformPacker(RENDER_LAYOUT, 'render');
    this.uniformBuffer = device.createBuffer({
      size: 512,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'render-uniforms',
    });

    this.program = new Program(device, WGSL_RENDER, { label: 'raymarch' });
    this.renderScale = options.renderScale ?? 1;
    this.canvasSize = [1, 1];
  }

  setSize(pixelWidth, pixelHeight) {
    this.canvasSize = [Math.max(1, pixelWidth), Math.max(1, pixelHeight)];
  }

  _pack(solver, camera, time) {
    const s = this.settings;
    const bounds = solver.volumeBounds;
    const min = bounds.min;
    const size = [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ];
    const p = this.packer;
    const light = normalize3(s.sunDirection);

    p.set('invViewProj', camera.invViewProj);
    p.set('camPos', camera.eye[0], camera.eye[1], camera.eye[2], s.exposureBias);
    p.set('volMin', min[0], min[1], min[2], 0);
    p.set('volSize', size[0], size[1], size[2], solver.settings.pressureIterations ? s.steps : s.steps);
    p.set('lightDir', light[0], light[1], light[2], s.sunIntensity);
    p.set('lightColor', s.sunColor[0], s.sunColor[1], s.sunColor[2], s.ambient);
    p.set('skyZenith', s.skyZenith[0], s.skyZenith[1], s.skyZenith[2], 0);
    p.set('skyHorizon', s.skyHorizon[0], s.skyHorizon[1], s.skyHorizon[2], s.sunSize);
    p.set('opt', s.extinction, s.emission, s.flameScale, s.smokeAlbedo);
    p.set('opt2', s.jitter, s.shadowDensity, time, s.debugMode);
    p.set('opt3', s.debugAxis, s.debugSlice, s.exposure, s.groundFog);
    p.set('fireLight', ...s.fireLightPosition, s.fireLightIntensity);
    p.set('fireLightColor', s.fireLightColor[0], s.fireLightColor[1], s.fireLightColor[2], s.shadowTaps);
    p.set('misc', s.scattering, s.groundAlbedo, 0, 0);
    const ob = solver.settings.obstacle ?? { center: [0, 0, 0], halfExtents: [0, 0, 0], mode: 0 };
    p.set('obstacle', ...(ob.center ?? [0, 0, 0]), 0);
    p.set('obstacleShape', ...(ob.halfExtents ?? [0, 0, 0]), ob.mode ?? 0);
    return p;
  }

  render(encoder, { camera, time = 0 } = {}) {
    const solver = this.solver;
    const p = this._pack(solver, camera, time);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, p.buffer, 0, p.byteLength);

    const view = this.context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.02, g: 0.024, b: 0.03, a: 1 },
        },
      ],
      label: 'raymarch',
    });
    pass.setPipeline(this.program.render({ format: this.format }));
    pass.setBindGroup(0, this.program.group(0, { rp: this.uniformBuffer }));
    pass.setBindGroup(
      1,
      this.program.group(1, {
        volScal: solver.scalarTexture,
        volVel: solver.velocityTexture,
        volSdf: solver.sdfTexture,
        samp: solver.samplerLinear,
      })
    );
    pass.draw(3);
    pass.end();
  }

  destroy() {
    this.program.destroy();
    this.uniformBuffer.destroy();
  }
}
