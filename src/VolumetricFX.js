import { initWebGPU } from './gpu/WebGPU.js';
import { FluidSolver } from './volumetric/FluidSolver.js';
import { VolumetricRenderer } from './volumetric/VolumetricRenderer.js';
import { EmitterSystem, makeEmitter } from './volumetric/EmitterSystem.js';
import { OrbitCamera, attachOrbitControls } from './volumetric/Camera.js';
import { PRESETS, QUALITY } from './presets.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Frontier Volumetric FX - the whole thing in one object.
 *
 *   const fx = await createVolumetricFX({ canvas, preset: 'campfire' });
 *   fx.onClickDetonate = true;
 *   function loop(t) { fx.frame(dt); requestAnimationFrame(loop); }
 *
 * Public surface:
 *   fx.setPreset(name)        switch look / simulation setup
 *   fx.setQuality(preset|{})  grid resolution, pressure iters, march steps
 *   fx.detonate({position})   spawn an explosion (also bound to clicking)
 *   fx.emit(options)          add a custom emitter
 *   fx.settings.solver / fx.settings.render   live tweakable parameters
 *   fx.stats                  grid, cells, timings
 */
export class VolumetricFX {
  constructor({ gpu, canvas, preset = 'campfire', quality = 'medium', autoResize = true }) {
    this.gpu = gpu;
    this.device = gpu.device;
    this.canvas = canvas;

    this.solver = new FluidSolver(this.device);
    this.renderer = new VolumetricRenderer(this.device, gpu.context, gpu.format, this.solver);
    this.emitters = new EmitterSystem({ max: 16 });
    this.camera = new OrbitCamera();
    this.controls = null;

    this.time = 0;
    this.frameIndex = 0;
    this.lastFrameTime = 0;
    this.paused = false;
    this.autoQuality = false;
    this._qualityKey = quality;
    this._frameTimes = [];
    this.stats = { simMs: 0, frameMs: 0, fps: 0, grid: 0, cells: 0, renderScale: 1 };

    this.clickAction = 'detonate';
    this.preset = null;
    this.setQuality(quality);
    this.setPreset(preset);

    this._onResize = () => this.resize();
    if (autoResize && typeof ResizeObserver !== 'undefined') {
      this._observer = new ResizeObserver(this._onResize);
      this._observer.observe(canvas.parentElement ?? canvas);
    }
    if (typeof window !== 'undefined') window.addEventListener('resize', this._onResize);
    this.resize();

    this._onLost = null;
    if (this.device.lost) {
      this.device.lost.then((info) => {
        this._onLost?.(info);
      });
    }
  }

  /**
   * Compile every WGSL module and return any hard errors with positions.
   * Call this once after construction: it is the difference between "black
   * screen" and an actionable message.
   * @returns {Promise<string[]>} list of problems (empty == healthy)
   */
  async validateShaders() {
    const problems = [];
    const programs = [...Object.values(this.solver.programs), this.renderer.program];
    for (const program of programs) {
      let messages = [];
      try {
        messages = await program.compileInfo();
      } catch (err) {
        problems.push(`${program.label}: ${err.message}`);
        continue;
      }
      for (const m of messages) {
        if (m.type === 'error') {
          problems.push(`${program.label} line ${m.lineNum}:${m.linePos} - ${m.message}`);
        } else if (m.type === 'warning') {
          console.warn(`[frontier] ${program.label}: ${m.message}`);
        }
      }
    }
    return problems;
  }

  /**
   * Report GPU-level validation errors (bad bindings, oversized textures, ...)
   * instead of letting them fail silently.
   */
  onDeviceError(handler) {
    this.device.addEventListener?.('uncapturederror', (event) => {
      handler(event.error?.message ?? String(event.error));
    });
    return this;
  }

  // ------------------------------------------------------------------ setup --
  setQuality(quality) {
    const q = typeof quality === 'string' ? QUALITY[quality] : quality;
    if (!q) throw new Error(`Unknown quality preset: ${quality}`);
    if (typeof quality === 'string') this._qualityKey = quality;
    else this._qualityKey = null;
    this.solver.settings.resolution = q.resolution;
    this.solver.settings.pressureIterations = q.pressureIterations;
    this.solver.settings.substeps = q.substeps;
    this.solver.resize(q.resolution);
    this.renderer.settings.steps = q.steps;
    this.renderer.settings.shadowTaps = q.shadowTaps;
    this.renderScale = q.renderScale ?? 1;
    this.solver.requestClear();
    this.resize();
    return q;
  }

  setPreset(name, { keepCamera = false } = {}) {
    const preset = PRESETS[name];
    if (!preset) throw new Error(`Unknown preset: ${name}`);
    this.presetName = name;
    this.preset = preset;

    Object.assign(this.solver.settings, preset.solver ?? {});
    // obstacle / blast are whole-object settings: always reset them, otherwise a
    // collider from the previous preset would leak into the next one
    this.solver.settings.obstacle = preset.solver?.obstacle
      ? { ...preset.solver.obstacle }
      : { mode: 0, center: [0, 1.2, 0], halfExtents: [0.5, 0.5, 0.5], radius: 0 };
    if (preset.solver?.blast) this.solver.settings.blast = { ...preset.solver.blast };
    else this.solver.settings.blast = { center: [0, 1.5, 0], strength: 0 };
    Object.assign(this.renderer.settings, preset.render ?? {});
    this.solver.markSdfDirty();

    preset.emitters?.(this.emitters, this);
    this.solver.requestClear();

    if (!keepCamera && preset.camera) {
      this.camera.setTarget(preset.camera.target);
      this.camera.desiredDistance = preset.camera.distance;
      this.camera.distance = preset.camera.distance;
      this.camera.desiredYaw = preset.camera.yaw;
      this.camera.yaw = preset.camera.yaw;
      this.camera.desiredPitch = preset.camera.pitch;
      this.camera.pitch = preset.camera.pitch;
      if (preset.camera.fov) this.camera.fov = (preset.camera.fov * Math.PI) / 180;
    }
    this.emitters.update(0);
    return preset;
  }

  /** One-shot explosion at a world position (defaults to the volume centre). */
  detonate({ position = null, power = 1 } = {}) {
    const bounds = this.solver.volumeBounds;
    const center = position ?? [
      (bounds.min[0] + bounds.max[0]) / 2,
      bounds.min[1] + (bounds.max[1] - bounds.min[1]) * 0.35,
      (bounds.min[2] + bounds.max[2]) / 2,
    ];
    // clamp into the volume so a click near the edge still works
    for (let i = 0; i < 3; i += 1) {
      center[i] = clamp(center[i], bounds.min[i] + 0.05, bounds.max[i] - 0.05);
    }

    const presetBurst = this.preset?.detonate?.({ center, power }, this) ?? [];
    const burst =
      presetBurst.length > 0
        ? presetBurst
        : [
            {
              kind: 2,
              position: center,
              radius: 0.6 * power,
              size: [0.6, 0.55, 0.6],
              velocity: [0, 1.2, 0],
              densityRate: 0.5,
              temperatureRate: 7.0 * power,
              fuelRate: 5.0 * power,
              emberRate: 2.0 * power,
              color: [1.0, 0.5, 0.15],
              softness: 0.5,
              flicker: 0.8,
              swirl: 1.3,
              life: 0.38,
              fadeOut: 0.5,
            },
          ];
    for (const b of burst) this.emitters.add(makeEmitter(b));

    // thermal expansion: the blast field pushes hot gas outward for a moment
    this.solver.settings.blast = { center: [...center], strength: 1.0 * power };
    this._blastDecay = 0.55;
    this._blastPosition = [...center];
    this.renderer.settings.fireLightPosition = [...center];
    this.renderer.settings.fireLightIntensity = (this.renderer.settings.fireLightIntensity ?? 2) * 1.0 + 4 * power;
    this._fireLightBoost = 6 * power;
    return this;
  }

  emit(options) {
    const e = makeEmitter({ position: this.camera.target.slice(), ...options });
    this.emitters.add(e);
    return e;
  }

  /** Bind orbit controls + click-to-detonate to the canvas. */
  attachControls(handlers = {}) {
    this.controls?.();
    this.controls = attachOrbitControls(this.camera, this.canvas, {
      onClick: (ndcX, ndcY) => {
        if (handlers.onClick) {
          handlers.onClick(ndcX, ndcY);
          return;
        }
        if (this.clickAction === 'detonate') {
          const bounds = this.solver.volumeBounds;
          const p = this.camera.pickInVolume(ndcX, ndcY, bounds.min, bounds.max, 0.4);
          this.detonate({ position: p });
        }
      },
    });
    return this;
  }

  resize() {
    const canvas = this.canvas;
    const parent = canvas.parentElement ?? canvas;
    const rect = parent.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = (this.renderScale ?? 1) * dpr;
    const w = Math.max(2, Math.floor((rect.width || canvas.width) * scale));
    const h = Math.max(2, Math.floor((rect.height || canvas.height) * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.camera.aspect = w / h;
    this.renderer.setSize(w, h);
  }

  // ------------------------------------------------------------------ frame --
  /**
   * Advance and draw one frame.
   * @param {number} dt seconds since the previous frame
   */
  frame(dt) {
    dt = clamp(dt || 1 / 60, 1 / 240, 1 / 15);
    const t0 = performance.now();

    if (!this.paused) {
      this.time += dt;
      this.frameIndex += 1;
      this.emitters.update(dt);

      // decay the blast push + the temporary fire light boost
      const blast = this.solver.settings.blast;
      if (blast.strength > 0) {
        blast.strength = Math.max(0, blast.strength - dt * (this._blastDecay ?? 0.6) * 4);
        if (this._blastPosition) blast.center = this._blastPosition;
      }
      if (this._fireLightBoost > 0) {
        this._fireLightBoost = Math.max(0, this._fireLightBoost - dt * 6);
      }

      this.camera.update(dt);
    } else {
      this.camera.update(dt);
    }

    {
      const encoder = this.device.createCommandEncoder({ label: 'frame' });
      const tSim = performance.now();
      if (!this.paused) {
        this.solver.encode(encoder, {
          dt,
          time: this.time,
          frame: this.frameIndex,
          emitters: this.emitters.packed(),
        });
      }
      const tAfterSim = performance.now();

      // approximate plume light: emitters weighted + detonation boost
      const lightPos = this.emitters.lightPosition(this.camera.target);
      const rs = this.renderer.settings;
      if (this.emitters.emitters.length > 0) {
        rs.fireLightPosition = lightPos;
      }
      const baseLight = this.preset?.render?.fireLightIntensity ?? 2.5;
      rs.fireLightIntensity = baseLight + (this._fireLightBoost ?? 0);

      this.renderer.render(encoder, { camera: this.camera, time: this.time });
      this.device.queue.submit([encoder.finish()]);

      this.stats.simMs = tAfterSim - tSim;
      this.stats.encodeMs = performance.now() - t0;
      this.stats.grid = this.solver.resolution;
      this.stats.cells = this.solver.resolution ** 3;
      this.stats.renderScale = this.renderScale ?? 1;
      this.stats.emitters = this.emitters.emitters.length;
      this.stats.substeps = this.solver.substepsUsed ?? this.solver.settings.substeps;
    }

    // adaptive resolution (UE-style dynamic screen percentage)
    if (this.autoQuality && dt > 0) {
      this._frameTimes.push(dt * 1000);
      if (this._frameTimes.length > 30) this._frameTimes.shift();
      if (this._frameTimes.length === 30) {
        const avg = this._frameTimes.reduce((a, b) => a + b, 0) / 30;
        const before = this.renderScale;
        if (avg > 23 && this.renderScale > 0.5) this.renderScale = Math.max(0.5, this.renderScale - 0.06);
        else if (avg < 12 && this.renderScale < 1) this.renderScale = Math.min(1, this.renderScale + 0.04);
        if (before !== this.renderScale) this.resize();
      }
    }

    this.stats.frameMs = this.lastFrameTime;
    if (dt > 0) this.stats.fps = this.stats.fps * 0.9 + (1 / dt) * 0.1;
    return this.stats;
  }

  destroy() {
    this.controls?.();
    this._observer?.disconnect();
    if (typeof window !== 'undefined') window.removeEventListener('resize', this._onResize);
    this.solver.destroy();
    this.renderer.destroy();
  }
}

/**
 * Boot WebGPU and build a ready-to-render instance.
 * @returns {Promise<VolumetricFX>}
 */
export async function createVolumetricFX(options = {}) {
  const gpu = await initWebGPU({ canvas: options.canvas, powerPreference: options.powerPreference });
  return new VolumetricFX({ ...options, gpu });
}

export default createVolumetricFX;
