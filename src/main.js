/**
 * Main Application Entry Point
 * Orchestrates the separate 3D voxel Pyro gas and GPU particle Hydro solvers,
 * liquid interactions, water surface renderer, dynamic bounds, and Studio UI.
 */

import {
  RESOLUTION_OPTIONS,
  DEBUG_CHANNELS,
  COLOR_PALETTES,
  OBSTACLE_TYPES,
  WAVE_MODES,
  HYDRO_SCENES,
  ATLAS_MINIMAP_FIELDS,
  createDefaultParams,
  PRESETS,
} from './presets.js';
import { OrbitCamera } from './camera.js';
import { WebGL2PyroEngine } from './engine-webgl2.js';
import { ParticleFluidWebGL2Engine } from './engine-fluid-webgl2.js';
import { WebGPUPyroEngine } from './engine-webgpu.js';

class PyroStudioApp {
  constructor() {
    this.params = createDefaultParams();
    this.camera = new OrbitCamera();
    this.engine = null;
    this.activeBackend = 'webgl2';
    this.preferredBackend = 'webgl2';
    this.activePresetKey = 'ue5_pyro_default';
    this.uiBindings = new Map();

    this.lastFrameTime = performance.now();
    this.fpsAccum = 0;
    this.fpsFrames = 0;
    this.displayedFps = 60;
    this.singleStepRequested = false;

    this.init();
  }

  async init() {
    this.setupHeaderControls();
    this.setupInspectorPanels();
    this.setupActionButtons();
    this.setupPresetChips();
    this.setupKeyboardShortcuts();

    this.webgpuSupported = await WebGPUPyroEngine.isAvailable();
    const btnWebGPU = document.getElementById('btn-backend-webgpu');
    if (!this.webgpuSupported && btnWebGPU) {
      btnWebGPU.title = 'WebGPU hardware adapter unavailable in this browser environment (using WebGL2)';
    }

    await this.initEngine('webgl2');
    this.triggerSignatureExplosion();

    window.addEventListener('resize', () => this.handleResize());
    this.handleResize();

    requestAnimationFrame((now) => this.frameLoop(now));
  }

  showToast(message) {
    const el = document.getElementById('viewport-toast');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      el.classList.add('hidden');
    }, 2400);
  }

  async switchSimulationMode(mode) {
    const nextMode = Number(mode) || 0;
    const previousMode = Number(this.params.simMode) || 0;
    this.setParam('simMode', nextMode);
    const needsFluidEngine = nextMode === 1 && !this.engine?.isParticleFluid;
    const needsPyroEngine = nextMode === 0 && this.engine?.isParticleFluid;
    if (previousMode !== nextMode || needsFluidEngine || needsPyroEngine || !this.engine) {
      const targetBackend = nextMode === 1 ? this.activeBackend : this.preferredBackend;
      await this.initEngine(targetBackend);
      this.showToast(nextMode === 1
        ? '💧 Dedicated particle liquid active: persistent markers + pressure + collisions'
        : '🔥 Dedicated Pyro gas solver active');
    }
  }

  async initEngine(targetBackend) {
    const oldCanvas = document.getElementById('pyro-canvas');

    if (this.engine) {
      this.engine.destroy();
      this.engine = null;
    }

    const newCanvas = document.createElement('canvas');
    newCanvas.id = 'pyro-canvas';
    oldCanvas.replaceWith(newCanvas);
    this.canvas = newCanvas;
    this.bindCanvasPointerEvents(newCanvas);
    this.handleResize();

    try {
      // Liquid is a separate marker/particle engine. It is intentionally not
      // routed through the Pyro gas atlas, gas pressure pass, or fire renderer.
      if (Number(this.params.simMode) === 1) {
        if (targetBackend === 'webgpu') {
          this.showToast('💧 Dedicated particle liquid uses the WebGL2 surface-fluid path');
        }
        this.engine = new ParticleFluidWebGL2Engine(newCanvas, this.params);
        this.activeBackend = 'webgl2';
      } else if (targetBackend === 'webgpu') {
        this.engine = await WebGPUPyroEngine.create(newCanvas, this.params);
        this.activeBackend = 'webgpu';
        this.preferredBackend = 'webgpu';
      } else {
        this.engine = new WebGL2PyroEngine(newCanvas, this.params);
        this.activeBackend = 'webgl2';
        this.preferredBackend = 'webgl2';
      }
    } catch (err) {
      console.warn(`Backend ${targetBackend} initialization failed:`, err);
      try {
        const fallbackCanvas = document.createElement('canvas');
        fallbackCanvas.id = 'pyro-canvas';
        newCanvas.replaceWith(fallbackCanvas);
        this.canvas = fallbackCanvas;
        this.bindCanvasPointerEvents(fallbackCanvas);
        this.handleResize();
        const liquidFallback = Number(this.params.simMode) === 1;
        this.engine = liquidFallback
          ? new ParticleFluidWebGL2Engine(fallbackCanvas, this.params)
          : new WebGL2PyroEngine(fallbackCanvas, this.params);
        this.activeBackend = 'webgl2';
        if (!liquidFallback) this.preferredBackend = 'webgl2';
        this.showToast(`GPU path recovered with ${liquidFallback ? 'particle liquid' : 'WebGL2 pyro'}`);
      } catch (fallbackError) {
        this.showToast(`GPU initialization error: ${fallbackError.message}`);
      }
    }

    document.querySelectorAll('#backend-switcher button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.backend === this.activeBackend);
    });
    const statBackend = document.getElementById('stat-backend');
    if (statBackend) {
      statBackend.textContent = this.activeBackend === 'webgpu' ? 'WebGPU' : 'WebGL2';
    }
    this.updateTelemetryBadges();
  }

  handleResize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * (this.params.renderScale || 1.0);
    const w = Math.max(320, Math.floor(rect.width * dpr));
    const h = Math.max(240, Math.floor(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.camera.aspect = rect.width / Math.max(1, rect.height);
    this.updateAtlasPipHeaderPosition();
  }

  updateAtlasPipHeaderPosition() {
    const pipHeader = document.getElementById('atlas-pip-header');
    if (!pipHeader || !this.canvas) return;
    const show = this.params.showAtlasMinimap
      && this.activeBackend === 'webgl2'
      && !this.engine?.isParticleFluid;
    pipHeader.classList.toggle('hidden', !show);

    if (show && this.engine) {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const pipWidthCss = Math.min(210, Math.floor(rect.width * 0.2));
      const pipHeightCss = Math.floor(pipWidthCss * (this.engine.tilesY / this.engine.tilesX));
      pipHeader.style.bottom = `${108 + pipHeightCss + 6}px`;
    }
  }

  bindCanvasPointerEvents(canvas) {
    let isDragging = false;
    let isPaintingPyro = false;
    let dragButton = 0;
    let lastX = 0;
    let lastY = 0;
    let prevUVW = null;

    const getRaycastUVW = (e) => {
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2.0 - 1.0;
      const ndcY = 1.0 - ((e.clientY - rect.top) / rect.height) * 2.0;
      if (this.engine && this.engine.getBoundsBox) {
        const { boxMin, boxMax } = this.engine.getBoundsBox();
        return this.camera.raycastVolumeUVW(ndcX, ndcY, boxMin, boxMax);
      }
      return this.camera.raycastVolumeUVW(ndcX, ndcY);
    };

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('pointerdown', (e) => {
      const tool = this.params.interactionMode;

      if ((tool === 'detonate' && e.button === 0) || (e.ctrlKey && e.button === 0)) {
        const hitUVW = getRaycastUVW(e);
        if (hitUVW && this.engine) {
          if (Number(this.params.simMode) === 1 && this.engine.triggerLiquidSplash) {
            this.engine.triggerLiquidSplash({ center: hitUVW, impulse: 1.8 });
            this.showToast(
              `🌊 Liquid impact at UVW (${hitUVW.map((v) => v.toFixed(2)).join(', ')}) — splash + foam`
            );
          } else {
            this.engine.triggerExplosion({ center: hitUVW });
            this.showToast(
              `💥 3D Raycast Detonation at Voxel UVW (${hitUVW.map((v) => v.toFixed(2)).join(', ')})`
            );
          }
        }
        return;
      }

      if ((tool === 'flamethrower' && e.button === 0) || (e.shiftKey && e.button === 0)) {
        const hitUVW = getRaycastUVW(e);
        if (hitUVW && this.engine) {
          isPaintingPyro = true;
          prevUVW = hitUVW;
          this.engine.setBrush(hitUVW, [0.0, 4.5, 0.0], true);
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }

      isDragging = true;
      dragButton = e.button;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (isPaintingPyro) {
        const hitUVW = getRaycastUVW(e);
        if (hitUVW && this.engine) {
          const vx = prevUVW ? (hitUVW[0] - prevUVW[0]) * 42.0 : 0.0;
          const vy = prevUVW ? (hitUVW[1] - prevUVW[1]) * 42.0 + 3.5 : 3.5;
          const vz = prevUVW ? (hitUVW[2] - prevUVW[2]) * 42.0 : 0.0;
          prevUVW = hitUVW;
          this.engine.setBrush(hitUVW, [vx, vy, vz], true);
        }
        return;
      }

      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (dragButton === 0 && !e.altKey) {
        this.camera.orbit(dx, dy);
      } else {
        this.camera.pan(dx, dy);
      }
    });

    const stopDrag = (e) => {
      if (isPaintingPyro) {
        isPaintingPyro = false;
        prevUVW = null;
        if (this.engine) this.engine.setBrush(null, null, false);
      }
      if (isDragging) {
        isDragging = false;
      }
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };

    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.camera.zoom(e.deltaY);
      },
      { passive: false }
    );

    canvas.addEventListener('dblclick', (e) => {
      const hitUVW = getRaycastUVW(e);
      if (hitUVW && this.engine) {
        if (Number(this.params.simMode) === 1 && this.engine.triggerLiquidSplash) {
          this.engine.triggerLiquidSplash({ center: hitUVW, impulse: 1.8 });
          this.showToast(`🌊 Splash at UVW (${hitUVW.map((v) => v.toFixed(2)).join(', ')})`);
        } else {
          this.engine.triggerExplosion({ center: hitUVW });
          this.showToast(`💥 Detonated at Voxel UVW (${hitUVW.map((v) => v.toFixed(2)).join(', ')})`);
        }
      }
    });
  }

  setupHeaderControls() {
    // 1. Voxel Grid Resolution Quick Bar (16³ up to 128³)
    const resButtons = document.querySelectorAll('#res-quick-bar button');
    resButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const res = Number(btn.dataset.res);
        this.setParam('gridResolution', res);
        if (this.engine) {
          this.engine.setGridResolution(res);
          this.triggerSignatureExplosion();
        }
        this.updateAtlasPipHeaderPosition();
        this.showToast(this.engine?.isParticleFluid
          ? `Particle liquid density set from ${res}³ preset (${this.engine.particleCount.toLocaleString()} persistent markers)`
          : `Voxel Grid Resolution set to ${res}³ (${(res ** 3).toLocaleString()} voxels)`);
      });
    });

    // 2. Render Channel Select
    const channelSelect = document.getElementById('header-channel-select');
    DEBUG_CHANNELS.forEach((ch) => {
      const opt = document.createElement('option');
      opt.value = ch.id;
      opt.textContent = ch.label;
      channelSelect.appendChild(opt);
    });
    channelSelect.value = this.params.renderChannel;
    channelSelect.addEventListener('change', () => {
      this.setParam('renderChannel', Number(channelSelect.value));
    });

    // 3. Pyro / Hydro domain switch
    document.querySelectorAll('#sim-mode-switcher button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const mode = Number(btn.dataset.simMode);
        document.querySelectorAll('#sim-mode-switcher button').forEach((b) => {
          b.classList.toggle('active', Number(b.dataset.simMode) === mode);
        });
        await this.switchSimulationMode(mode);
      });
    });

    // 4. Backend Switcher
    document.querySelectorAll('#backend-switcher button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const target = btn.dataset.backend;
        if (Number(this.params.simMode) === 1 && target === 'webgpu') {
          this.showToast('💧 Hydro currently runs on the dedicated WebGL2 particle-liquid backend');
          return;
        }
        if (target === this.activeBackend) return;
        await this.initEngine(target);
        this.triggerSignatureExplosion();
        this.showToast(`Switched GPU Backend to ${this.engine.backendName}`);
      });
    });

    // 4. Viewport Tool Switcher (Orbit / 3D Pyro Brush / Click Blast)
    document.querySelectorAll('#tool-switcher button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        this.setParam('interactionMode', tool);
        document.querySelectorAll('#tool-switcher button').forEach((b) => {
          b.classList.toggle('active', b.dataset.tool === tool);
        });
        if (tool === 'flamethrower') {
          this.showToast('🔥 3D Pyro Brush Active: Left-drag across the volume to paint live fire & smoke!');
        } else if (tool === 'detonate') {
          this.showToast('💥 Click Detonator Active: Left-click anywhere in the 3D volume to detonate!');
        } else {
          this.showToast('🎥 Orbit Camera Tool Active');
        }
      });
    });

    // 5. Dynamic Bounds Toggle
    document.getElementById('btn-toggle-dyn-bounds').addEventListener('click', () => {
      this.setParam('dynamicBounds', !this.params.dynamicBounds);
      this.showToast(
        this.params.dynamicBounds
          ? '📐 Dynamic Auto-Expanding Explosion Bounds: ON'
          : '📐 Dynamic Auto-Expanding Explosion Bounds: OFF (Fixed Bounds)'
      );
    });

    // 6. Sparse Voxel Octree Wireframe Toggle
    document.getElementById('btn-toggle-sparse').addEventListener('click', () => {
      this.setParam('showActiveVoxelCells', !this.params.showActiveVoxelCells);
      this.showToast(
        this.params.showActiveVoxelCells
          ? '📦 UE5 Sparse Voxel Octree Wireframe: ON'
          : '📦 UE5 Sparse Voxel Octree Wireframe: OFF'
      );
    });

    // 7. Voxel DDA Mode Toggle
    document.getElementById('btn-toggle-voxel-mode').addEventListener('click', () => {
      this.toggleVoxelDDAMode();
    });

    // 8. Auto-Turntable Camera Toggle
    const btnTurntable = document.getElementById('btn-toggle-turntable');
    if (btnTurntable) {
      btnTurntable.addEventListener('click', () => {
        this.setParam('autoTurntable', !this.params.autoTurntable);
        btnTurntable.classList.toggle('active', !!this.params.autoTurntable);
        this.showToast(
          this.params.autoTurntable ? '🔄 3D Turntable Orbit: ON' : '🔄 3D Turntable Orbit: OFF'
        );
      });
    }

    // 9. Reset Camera
    document.getElementById('btn-reset-camera').addEventListener('click', () => {
      this.camera.reset();
      this.showToast('🎥 Camera reset to default view');
    });

    // 9. Clickable 2D Voxel Atlas Minimap Header cycles displayed field
    document.getElementById('atlas-pip-header').addEventListener('click', () => {
      const nextField = ((this.params.atlasMinimapField || 0) + 1) % ATLAS_MINIMAP_FIELDS.length;
      this.setParam('atlasMinimapField', nextField);
      const label = ATLAS_MINIMAP_FIELDS[nextField].label;
      this.showToast(`🗺️ 3D Voxel Slice Atlas: ${label}`);
    });
  }

  toggleVoxelDDAMode() {
    if (this.params.renderChannel === 1) {
      this.setParam('renderChannel', 0);
      this.setParam('voxelQuantization', 0.0);
      this.showToast('Smooth Trilinear Volumetric Raymarching enabled');
    } else {
      this.setParam('renderChannel', 1);
      this.setParam('voxelQuantization', 0.9);
      this.showToast('Discrete Voxel DDA Cube Raymarching enabled');
    }
  }

  setupActionButtons() {
    document.getElementById('btn-detonate').addEventListener('click', () => {
      this.triggerSignatureExplosion();
      this.showToast(Number(this.params.simMode) === 1
        ? '🌊 Impact splash + radial pressure ring + foam burst!'
        : '💥 Multi-Lobe Fireball & Pressure Wave Detonated!');
    });

    const btnShrapnel = document.getElementById('btn-shrapnel');
    if (btnShrapnel) {
      btnShrapnel.addEventListener('click', () => {
        if (this.engine) {
          this.engine.triggerExplosion({
            center: [0.5, 0.25, 0.5],
            radius: this.params.blastRadius * 1.05,
            strength: this.params.blastStrength * 1.15,
            temp: this.params.blastTemperature * 1.1,
            fuel: this.params.blastFuel,
            smoke: this.params.blastSmoke,
            lobes: 7.0,
            spawnShrapnel: true,
          });
        }
        this.showToast('☄️ Airburst + 6 Ballistic Burning Shrapnel Streamers Launched!');
      });
    }

    document.getElementById('btn-salvo').addEventListener('click', () => {
      this.triggerClusterSalvo();
      this.showToast('🔥 4-Stage Cluster Ordnance Salvo Fired!');
    });

    document.getElementById('btn-collide').addEventListener('click', () => {
      this.triggerCollidingShockwaves();
      this.showToast('⚡ Dual Head-On Colliding Fireball Shockwaves Fired!');
    });

    document.getElementById('btn-thermobaric').addEventListener('click', () => {
      this.triggerThermobaricMushroom();
      this.showToast('☢️ High-Yield Thermobaric Mushroom Cloud Initiated!');
    });

    document.getElementById('btn-vortex').addEventListener('click', async () => {
      this.setParam('simMode', 0);
      await this.switchSimulationMode(0);
      this.setParam('colorPalette', 3);
      this.setParam('obstacleType', 0);
      this.setParam('emitterEnabled', true);
      this.setParam('emitterSwirl', 6.5);
      this.setParam('emitterUpwardVelocity', 4.8);
      this.setParam('vorticityConfinement', 9.5);
      this.setParam('turbulenceStrength', 4.8);
      this.triggerSignatureExplosion();
      this.showToast('🌪️ Fire tornado vortex column activated!');
    });

    document.getElementById('btn-collider-toggle').addEventListener('click', () => {
      const nextType = (this.params.obstacleType + 1) % OBSTACLE_TYPES.length;
      this.setParam('obstacleType', nextType);
      const label = OBSTACLE_TYPES.find((o) => o.id === nextType)?.label || 'None';
      this.showToast(`🧱 Voxel Collider: ${label}`);
    });

    document.getElementById('btn-water-splash')?.addEventListener('click', async () => {
      this.setParam('simMode', 1);
      this.setParam('obstacleType', this.params.obstacleType === 5 ? 5 : 1);
      await this.switchSimulationMode(1);
      if (this.engine?.triggerLiquidSplash) {
        this.engine.triggerLiquidSplash({ center: [0.5, this.params.waterPoolLevel + 0.04, 0.5], impulse: 1.8 });
      }
      this.showToast('🌊 Particle impact: crown splash + displaced-water impulse');
    });

    document.getElementById('btn-surf-wave')?.addEventListener('click', async () => {
      this.setParam('simMode', 1);
      this.setParam('waveMode', 2);
      this.setParam('waveHeight', Math.max(this.params.waveHeight || 0.0, 0.62));
      this.setParam('obstacleType', 0);
      await this.switchSimulationMode(1);
      this.showToast('🏄 Particle-liquid wave: travelling crest and restrained whitewater foam');
    });

    document.getElementById('btn-dam-break')?.addEventListener('click', () => {
      this.applyPreset('hydro_dam_breaker');
      this.showToast('🧱 3D dam break released: persistent marker column + pressure surge');
    });

    const btnPause = document.getElementById('btn-pause');
    btnPause.addEventListener('click', () => {
      this.setParam('paused', !this.params.paused);
      btnPause.textContent = this.params.paused ? '▶ Resume' : '⏸ Pause';
      btnPause.classList.toggle('active', this.params.paused);
    });

    document.getElementById('btn-step').addEventListener('click', () => {
      this.setParam('paused', true);
      btnPause.textContent = '▶ Resume';
      this.singleStepRequested = true;
    });

    document.getElementById('btn-clear').addEventListener('click', () => {
      if (this.engine) this.engine.clearGrid();
      this.showToast(Number(this.params.simMode) === 1 ? '🧹 Reset persistent liquid markers' : '🧹 Cleared all 3D voxel fields');
    });
  }

  triggerSignatureExplosion() {
    if (!this.engine) return;
    if (Number(this.params.simMode) === 1 && this.engine.triggerLiquidSplash) {
      this.engine.triggerLiquidSplash({
        center: [0.5, this.params.waterPoolLevel ?? 0.25, 0.5],
        impulse: Math.max(1.0, this.params.splashEnergy ?? 1.5),
      });
      return;
    }
    this.engine.triggerExplosion({
      center: [0.5 + (Math.random() - 0.5) * 0.12, 0.18, 0.5 + (Math.random() - 0.5) * 0.12],
      radius: this.params.blastRadius,
      strength: this.params.blastStrength,
      temp: this.params.blastTemperature,
      fuel: this.params.blastFuel,
      smoke: this.params.blastSmoke,
      lobes: this.params.blastLobes,
    });
  }

  triggerClusterSalvo() {
    if (!this.engine) return;
    const offsets = [
      [0.32, 0.16, 0.34],
      [0.68, 0.18, 0.33],
      [0.33, 0.20, 0.67],
      [0.66, 0.22, 0.66],
    ];
    offsets.forEach((center, idx) => {
      setTimeout(() => {
        if (!this.engine) return;
        this.engine.triggerExplosion({
          center,
          radius: this.params.blastRadius * 0.85,
          strength: this.params.blastStrength * 0.95,
          temp: this.params.blastTemperature * 1.05,
          fuel: this.params.blastFuel,
          smoke: this.params.blastSmoke * 1.1,
          lobes: 7.0,
        });
      }, idx * 170);
    });
  }

  triggerCollidingShockwaves() {
    if (!this.engine) return;
    this.engine.triggerExplosion({
      center: [0.22, 0.30, 0.5],
      radius: 0.16,
      strength: 7.5,
      temp: 6.2,
      fuel: 4.8,
      smoke: 2.5,
      lobes: 6.0,
      directionalVel: [14.0, 1.5, 0.0],
    });
    setTimeout(() => {
      if (!this.engine) return;
      this.engine.triggerExplosion({
        center: [0.78, 0.30, 0.5],
        radius: 0.16,
        strength: 7.5,
        temp: 6.2,
        fuel: 4.8,
        smoke: 2.5,
        lobes: 6.0,
        directionalVel: [-14.0, 1.5, 0.0],
      });
    }, 30);
  }

  triggerThermobaricMushroom() {
    if (!this.engine) return;
    this.engine.clearGrid();
    this.engine.triggerExplosion({
      center: [0.5, 0.14, 0.5],
      radius: 0.23,
      strength: 12.5,
      temp: 6.5,
      fuel: 5.5,
      smoke: 3.2,
      lobes: 8.0,
    });
    setTimeout(() => {
      if (!this.engine) return;
      this.engine.triggerExplosion({
        center: [0.5, 0.29, 0.5],
        radius: 0.19,
        strength: 9.5,
        temp: 6.8,
        fuel: 4.8,
        smoke: 2.4,
        lobes: 6.0,
      });
    }, 150);
  }

  setupPresetChips() {
    const list = document.getElementById('presets-list');
    Object.entries(PRESETS).forEach(([key, preset]) => {
      const chip = document.createElement('button');
      chip.className = `preset-chip ${key === this.activePresetKey ? 'active' : ''}`;
      chip.dataset.preset = key;
      chip.textContent = preset.name;
      chip.title = preset.description;

      chip.addEventListener('click', () => {
        this.applyPreset(key);
      });
      list.appendChild(chip);
    });
  }

  async applyPreset(key) {
    const preset = PRESETS[key];
    if (!preset) return;
    this.activePresetKey = key;

    document.querySelectorAll('.preset-chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.preset === key);
    });

    const prevRes = this.params.gridResolution;
    const prevMode = Number(this.params.simMode) || 0;
    Object.entries(preset.params).forEach(([k, v]) => {
      this.setParam(k, v);
    });

    if (this.engine) {
      const nextMode = Number(this.params.simMode) || 0;
      const modeChanged = prevMode !== nextMode
        || (nextMode === 1) !== !!this.engine.isParticleFluid;
      if (modeChanged) {
        await this.initEngine(nextMode === 1 ? this.activeBackend : this.preferredBackend);
      } else if (this.params.gridResolution !== prevRes) {
        this.engine.setGridResolution(this.params.gridResolution);
      } else {
        this.engine.clearGrid();
      }
      if (preset.triggerExplosionOnLoad) {
        this.triggerSignatureExplosion();
      }
    }
    this.handleResize();
    this.showToast(`Loaded Preset: ${preset.name}`);
  }

  setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      const code = e.code;
      if (code === 'Space') {
        e.preventDefault();
        this.triggerSignatureExplosion();
        this.showToast(Number(this.params.simMode) === 1 ? '🌊 Liquid splash detonated!' : '💥 Explosion Detonated!');
      } else if (code === 'KeyC') {
        if (this.engine) this.engine.clearGrid();
        this.showToast('🧹 Voxel Grid Cleared');
      } else if (code === 'KeyV') {
        this.toggleVoxelDDAMode();
      } else if (code === 'KeyB') {
        document.getElementById('btn-toggle-dyn-bounds')?.click();
      } else if (code === 'KeyO') {
        document.getElementById('btn-toggle-sparse')?.click();
      } else if (code === 'KeyT') {
        document.getElementById('btn-toggle-turntable')?.click();
      } else if (code === 'KeyP') {
        document.getElementById('btn-pause')?.click();
      } else if (code === 'KeyS') {
        document.getElementById('btn-step')?.click();
      } else if (code === 'KeyR') {
        this.camera.reset();
        this.showToast('🎥 Camera Reset');
      }
    });
  }

  registerBinding(key, fn) {
    if (!this.uiBindings.has(key)) {
      this.uiBindings.set(key, []);
    }
    this.uiBindings.get(key).push(fn);
  }

  setParam(key, value) {
    this.params[key] = value;
    const fns = this.uiBindings.get(key);
    if (fns) {
      fns.forEach((fn) => fn(value));
    }
    this.updateTelemetryBadges();
  }

  updateTelemetryBadges() {
    const res = this.params.gridResolution;
    const totalVoxels = res * res * res;

    document.querySelectorAll('#res-quick-bar button').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.res) === res);
    });
    document.querySelectorAll('#sim-mode-switcher button').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.simMode) === Number(this.params.simMode || 0));
    });

    const chSelect = document.getElementById('header-channel-select');
    if (chSelect && Number(chSelect.value) !== this.params.renderChannel) {
      chSelect.value = this.params.renderChannel;
    }

    const isVoxelDDA = this.params.renderChannel === 1 || this.params.voxelQuantization > 0.5;
    const btnVoxel = document.getElementById('btn-toggle-voxel-mode');
    const lblVoxel = document.getElementById('lbl-voxel-mode');
    if (btnVoxel && lblVoxel) {
      btnVoxel.classList.toggle('active', isVoxelDDA);
      lblVoxel.textContent = isVoxelDDA ? 'ON' : 'OFF';
    }

    const btnDyn = document.getElementById('btn-toggle-dyn-bounds');
    const lblDyn = document.getElementById('lbl-dyn-bounds');
    if (btnDyn && lblDyn) {
      btnDyn.classList.toggle('active', !!this.params.dynamicBounds);
      lblDyn.textContent = this.params.dynamicBounds ? 'ON' : 'OFF';
    }

    const btnSparse = document.getElementById('btn-toggle-sparse');
    if (btnSparse) {
      btnSparse.classList.toggle('active', !!this.params.showActiveVoxelCells);
    }

    const hudSolver = document.getElementById('hud-solver-desc');
    const hudShading = document.getElementById('hud-shader-desc');
    if (hudSolver && hudShading) {
      if (Number(this.params.simMode) === 1) {
        hudSolver.textContent = 'GPU Particle Liquid + SPH Pressure + Persistent Markers + Colliders';
        hudShading.textContent = 'Particle Depth/Thickness Surface + Clear-Water Absorption + Foam';
      } else {
        hudSolver.textContent = 'Eulerian 3D Grid + BFECC Advection + Jacobi Poisson + 3D Fire Irradiance';
        hudShading.textContent = 'Planckian Blackbody + Beer-Lambert + Henyey-Greenstein + Fireflies';
      }
    }

    const statVoxels = document.getElementById('stat-voxels');
    const statVoxelsLabel = document.getElementById('stat-voxels-label');
    if (statVoxels) {
      if (Number(this.params.simMode) === 1 && this.engine?.isParticleFluid) {
        statVoxels.textContent = `${this.engine.particleCount.toLocaleString()}`;
        if (statVoxelsLabel) statVoxelsLabel.textContent = 'MARKERS';
      } else {
        statVoxels.textContent =
          totalVoxels >= 1000000
            ? `${(totalVoxels / 1000000).toFixed(2)}M`
            : `${(totalVoxels / 1000).toFixed(1)}K`;
        if (statVoxelsLabel) statVoxelsLabel.textContent = 'VOXELS';
      }
    }

    const lblPip = document.getElementById('lbl-atlas-pip');
    if (lblPip) {
      if (Number(this.params.simMode) === 1) {
        lblPip.textContent = 'PARTICLE LIQUID: DEPTH · THICKNESS · FOAM';
      } else {
        const shortNames = ['THERMO', 'VELOCITY UVW', 'VORTICITY CURL', 'PRESSURE + IRRADIANCE'];
        const fieldName = shortNames[this.params.atlasMinimapField || 0];
        lblPip.textContent = `3D VOXEL ATLAS: ${fieldName} (${res} Z-SLICES)`;
      }
    }
    this.updateAtlasPipHeaderPosition();
  }

  createSection(parent, title, badgeText = '') {
    const card = document.createElement('div');
    card.className = 'section-card';
    const header = document.createElement('div');
    header.className = 'section-title';
    header.innerHTML = `<span>${title}</span>${badgeText ? `<span style="color:var(--text-muted);font-size:9.5px">${badgeText}</span>` : ''}`;
    card.appendChild(header);
    parent.appendChild(card);
    return card;
  }

  addSlider(card, { key, label, min, max, step, format = (v) => v.toFixed(2), onChange }) {
    const row = document.createElement('div');
    row.className = 'control-row';

    const hdr = document.createElement('div');
    hdr.className = 'control-header';
    const lbl = document.createElement('span');
    lbl.className = 'control-label';
    lbl.textContent = label;
    const valSpan = document.createElement('span');
    valSpan.className = 'control-val';
    valSpan.textContent = format(this.params[key]);
    hdr.append(lbl, valSpan);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = this.params[key];

    input.addEventListener('input', () => {
      const v = Number(input.value);
      this.params[key] = v;
      valSpan.textContent = format(v);
      this.updateTelemetryBadges();
      if (onChange) onChange(v);
    });

    this.registerBinding(key, (v) => {
      input.value = v;
      valSpan.textContent = format(Number(v));
    });

    row.append(hdr, input);
    card.appendChild(row);
  }

  addSelect(card, { key, label, options, onChange }) {
    const row = document.createElement('div');
    row.className = 'control-row';

    const hdr = document.createElement('div');
    hdr.className = 'control-header';
    const lbl = document.createElement('span');
    lbl.className = 'control-label';
    lbl.textContent = label;
    hdr.appendChild(lbl);

    const select = document.createElement('select');
    select.className = 'studio-select';
    options.forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt.value ?? opt.id;
      o.textContent = opt.label;
      select.appendChild(o);
    });
    select.value = this.params[key];

    select.addEventListener('change', () => {
      const v = Number(select.value);
      this.setParam(key, v);
      if (onChange) onChange(v);
    });

    this.registerBinding(key, (v) => {
      select.value = v;
    });

    row.append(hdr, select);
    card.appendChild(row);
  }

  addCheckbox(card, { key, label, onChange }) {
    const row = document.createElement('label');
    row.className = 'checkbox-row';
    const span = document.createElement('span');
    span.className = 'control-label';
    span.textContent = label;
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!this.params[key];

    chk.addEventListener('change', () => {
      this.setParam(key, chk.checked);
      if (onChange) onChange(chk.checked);
    });

    this.registerBinding(key, (v) => {
      chk.checked = !!v;
    });

    row.append(span, chk);
    card.appendChild(row);
  }

  setupInspectorPanels() {
    const tabBtns = document.querySelectorAll('.inspector-tabs .tab-btn');
    const tabPanes = document.querySelectorAll('.inspector-body .tab-pane');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        tabBtns.forEach((b) => b.classList.remove('active'));
        tabPanes.forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab)?.classList.add('active');
      });
    });

    // --- TAB 1: GRID & BOUNDS ---
    const tabGrid = document.getElementById('tab-grid');

    const secDomain = this.createSection(tabGrid, 'Domain Solver', 'PYRO ↔ HYDRO');
    this.addSelect(secDomain, {
      key: 'simMode',
      label: 'Simulation Family',
      options: [
        { id: 0, label: '🔥 Pyro / Gas (Eulerian Combustion)' },
        { id: 1, label: '💧 Water / Liquid (Particle + Pressure)' },
      ],
      onChange: (mode) => {
        void this.switchSimulationMode(mode);
      },
    });

    const secBounds = this.createSection(tabGrid, 'Dynamic World Bounds (Room)', 'ADAPTIVE');
    this.addCheckbox(secBounds, {
      key: 'dynamicBounds',
      label: 'Dynamic Auto-Expanding Blast Bounds',
    });
    this.addSlider(secBounds, {
      key: 'boundsWidth',
      label: 'Base Bounds Width X / Z (Room)',
      min: 1.0,
      max: 4.0,
      step: 0.05,
      format: (v) => `${v.toFixed(2)}m`,
    });
    this.addSlider(secBounds, {
      key: 'boundsHeight',
      label: 'Base Bounds Height Y (Ceiling)',
      min: 1.2,
      max: 4.0,
      step: 0.05,
      format: (v) => `${v.toFixed(2)}m`,
    });
    this.addSlider(secBounds, {
      key: 'dynamicBoundsMax',
      label: 'Dynamic Blast Surge Multiplier',
      min: 1.1,
      max: 2.2,
      step: 0.05,
      format: (v) => `${v.toFixed(2)}x`,
    });

    const secVoxel = this.createSection(tabGrid, '3D Voxel Grid Resolution', 'EULERIAN');
    this.addSelect(secVoxel, {
      key: 'gridResolution',
      label: 'Voxel Domain Dimensions (16³ – 128³)',
      options: RESOLUTION_OPTIONS,
      onChange: (res) => {
        if (this.engine) {
          this.engine.setGridResolution(res);
          this.triggerSignatureExplosion();
        }
        this.updateAtlasPipHeaderPosition();
      },
    });
    this.addSlider(secVoxel, {
      key: 'voxelQuantization',
      label: 'Voxel Quantization (Render-only; 0% usually fastest)',
      min: 0.0,
      max: 1.0,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    });
    this.addCheckbox(secVoxel, {
      key: 'autoGpuGovernor',
      label: 'Auto Low-End GPU FPS Governor',
    });
    this.addCheckbox(secVoxel, {
      key: 'showActiveVoxelCells',
      label: 'UE5 Sparse Voxel Octree Wireframe',
    });
    this.addCheckbox(secVoxel, {
      key: 'showAtlasMinimap',
      label: 'Show Live 2D Tiled 3D Voxel Atlas PiP',
      onChange: () => this.updateAtlasPipHeaderPosition(),
    });
    this.addSelect(secVoxel, {
      key: 'atlasMinimapField',
      label: 'Voxel Atlas Minimap Channel',
      options: ATLAS_MINIMAP_FIELDS,
    });

    const secSolver = this.createSection(tabGrid, 'Navier-Stokes Pressure Solver', 'POISSON');
    this.addSlider(secSolver, {
      key: 'pressureIterations',
      label: 'Jacobi Pressure + Irradiance Iterations',
      min: 6,
      max: 48,
      step: 2,
      format: (v) => `${Math.round(v)} iters`,
    });
    this.addSlider(secSolver, {
      key: 'timeScale',
      label: 'Simulation Time Scale (Δt)',
      min: 0.1,
      max: 2.0,
      step: 0.05,
      format: (v) => `${v.toFixed(2)}x`,
    });
    this.addCheckbox(secSolver, {
      key: 'macCormackAdvection',
      label: 'MacCormack / BFECC Sharp Advection',
    });
    this.addCheckbox(secSolver, {
      key: 'enclosedBox',
      label: 'Closed Top/Side Domain Walls',
    });

    const secSlice = this.createSection(tabGrid, '3D Grid Cross-Section Slice', 'DEBUG');
    this.addSelect(secSlice, {
      key: 'sliceAxis',
      label: 'Slice Plane Axis',
      options: [
        { id: 0, label: 'X-Axis Slice (YZ Plane)' },
        { id: 1, label: 'Y-Axis Slice (XZ Horizontal Plane)' },
        { id: 2, label: 'Z-Axis Slice (XY Center Plane)' },
      ],
    });
    this.addSlider(secSlice, {
      key: 'slicePosition',
      label: 'Slice Plane Depth',
      min: 0.05,
      max: 0.95,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
      onChange: () => {
        if (this.params.renderChannel !== 8) {
          this.setParam('renderChannel', 8);
        }
      },
    });

    // --- TAB 2: PYRO & COMBUSTION PHYSICS ---
    const tabPyro = document.getElementById('tab-pyro');
    const secVort = this.createSection(tabPyro, 'Vorticity & Buoyancy Forces', 'TURBULENCE');
    this.addSlider(secVort, {
      key: 'vorticityConfinement',
      label: 'Vorticity Confinement (Cauliflower Curl)',
      min: 0.0,
      max: 14.0,
      step: 0.1,
    });
    this.addSlider(secVort, {
      key: 'buoyancy',
      label: 'Thermal Buoyancy Lift',
      min: 0.0,
      max: 12.0,
      step: 0.1,
    });
    this.addSlider(secVort, {
      key: 'smokeWeight',
      label: 'Soot Weight / Downward Drag',
      min: 0.0,
      max: 3.5,
      step: 0.05,
    });
    this.addSlider(secVort, {
      key: 'turbulenceStrength',
      label: 'Sub-Grid Curl Noise Injection',
      min: 0.0,
      max: 8.0,
      step: 0.1,
    });
    this.addSlider(secVort, {
      key: 'turbulenceScale',
      label: 'Turbulence Noise Frequency',
      min: 1.0,
      max: 10.0,
      step: 0.1,
    });

    const secCombust = this.createSection(tabPyro, 'Combustion & Thermodynamics', 'EXOTHERMIC');
    this.addSlider(secCombust, {
      key: 'burnRate',
      label: 'Fuel Reaction / Burn Speed',
      min: 0.2,
      max: 4.5,
      step: 0.05,
    });
    this.addSlider(secCombust, {
      key: 'burnHeat',
      label: 'Exothermic Heat Release',
      min: 0.5,
      max: 5.0,
      step: 0.05,
    });
    this.addSlider(secCombust, {
      key: 'sootGeneration',
      label: 'Combustion Soot / Smoke Yield',
      min: 0.2,
      max: 4.0,
      step: 0.05,
    });
    this.addSlider(secCombust, {
      key: 'combustionExpansion',
      label: 'Gas Divergence Expansion (Blast Push)',
      min: 0.0,
      max: 10.0,
      step: 0.1,
    });
    this.addSlider(secCombust, {
      key: 'coolingRate',
      label: 'Stefan-Boltzmann Radiative Cooling',
      min: 0.2,
      max: 3.5,
      step: 0.05,
    });
    this.addSlider(secCombust, {
      key: 'smokeDissipation',
      label: 'Smoke Dissipation Rate',
      min: 0.02,
      max: 1.2,
      step: 0.02,
    });
    this.addSlider(secCombust, {
      key: 'windX',
      label: 'Crosswind Force X',
      min: -2.5,
      max: 2.5,
      step: 0.05,
    });

    const secHydro = this.createSection(tabPyro, 'Dedicated Particle Liquid Physics', 'WATER · GPU PARTICLES');
    this.addSelect(secHydro, {
      key: 'hydroScene',
      label: 'Liquid Scene / Initial Condition',
      options: HYDRO_SCENES,
      onChange: () => {
        if (this.engine && Number(this.params.simMode) === 1) this.engine.clearGrid();
      },
    });
    this.addSlider(secHydro, {
      key: 'damGateX',
      label: 'Dam Face X Position',
      min: 0.18, max: 0.62, step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    });
    this.addSlider(secHydro, {
      key: 'waterPoolLevel',
      label: 'Pool Depth / Free-Surface Level',
      min: 0.08, max: 0.55, step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    });
    this.addSlider(secHydro, {
      key: 'liquidViscosity',
      label: 'Viscosity (Water ↔ Mud ↔ Chocolate)',
      min: 0.01, max: 0.90, step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    });
    this.addSlider(secHydro, {
      key: 'surfaceAdhesion',
      label: 'Surface Adhesion / Wetting (Stick)',
      min: 0.0, max: 1.5, step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    });
    this.addSlider(secHydro, {
      key: 'surfaceTension',
      label: 'Surface Tension / Cohesion',
      min: 0.0, max: 1.2, step: 0.01,
    });
    this.addSlider(secHydro, {
      key: 'foamGeneration',
      label: 'Whitewater Foam Generation',
      min: 0.0, max: 3.0, step: 0.05,
    });
    this.addSlider(secHydro, {
      key: 'foamDissipation',
      label: 'Foam Dissipation / Bubble Lifetime',
      min: 0.02, max: 1.4, step: 0.02,
    });
    this.addSlider(secHydro, {
      key: 'splashEnergy',
      label: 'Collider Splash / Rooster-Tail Energy',
      min: 0.0, max: 3.0, step: 0.05,
    });
    this.addSelect(secHydro, {
      key: 'waveMode',
      label: 'Wave Generator',
      options: WAVE_MODES,
    });
    this.addSlider(secHydro, {
      key: 'waveHeight',
      label: 'Wave Height / Surf Crest',
      min: 0.0, max: 0.9, step: 0.01,
    });
    this.addSlider(secHydro, {
      key: 'waveSpeed',
      label: 'Wave Travel Speed',
      min: 0.1, max: 3.0, step: 0.05,
    });
    this.addSlider(secHydro, {
      key: 'liquidSpecular',
      label: 'Wet Gloss / Specular Highlight',
      min: 0.1, max: 2.5, step: 0.05,
    });
    this.addSlider(secHydro, {
      key: 'waterAbsorption',
      label: 'Water Absorption (Clear ↔ Deep)',
      min: 0.05, max: 2.5, step: 0.05,
    });
    this.addSlider(secHydro, {
      key: 'waterScattering',
      label: 'Water Scattering (Keep Low)',
      min: 0.0, max: 0.6, step: 0.01,
    });
    this.addSlider(secHydro, {
      key: 'waterTintR',
      label: 'Water Tint Red',
      min: 0.0, max: 0.5, step: 0.005,
    });
    this.addSlider(secHydro, {
      key: 'waterTintG',
      label: 'Water Tint Green',
      min: 0.0, max: 0.7, step: 0.005,
    });
    this.addSlider(secHydro, {
      key: 'waterTintB',
      label: 'Water Tint Blue',
      min: 0.0, max: 0.9, step: 0.005,
    });
    this.addSlider(secHydro, {
      key: 'waterRoughness',
      label: 'Water Surface Roughness',
      min: 0.02, max: 0.8, step: 0.01,
    });
    this.addSlider(secHydro, {
      key: 'waterSurfaceThreshold',
      label: 'Water Surface Coverage Threshold',
      min: 0.03, max: 0.6, step: 0.01,
    });
    this.addSlider(secHydro, {
      key: 'waterRefraction',
      label: 'Clear-Water Refraction / Reflection',
      min: 0.0, max: 1.0, step: 0.01,
    });
    this.addSlider(secHydro, {
      key: 'pressureStiffness',
      label: 'Particle Pressure / Incompressibility',
      min: 0.2, max: 5.0, step: 0.05,
    });
    this.addSlider(secHydro, {
      key: 'particleSmoothingRadius',
      label: 'Particle Neighbor Radius',
      min: 0.035, max: 0.14, step: 0.005,
    });
    this.addSlider(secHydro, {
      key: 'restDensity',
      label: 'Marker Rest Density',
      min: 0.2, max: 4.0, step: 0.05,
    });
    this.addSlider(secHydro, {
      key: 'particleRenderRadius',
      label: 'Surface Particle Radius',
      min: 0.012, max: 0.065, step: 0.001,
    });

    // --- TAB 3: VOLUMETRIC RAYMARCHING & SHADING ---
    const tabRay = document.getElementById('tab-raymarch');
    const secRay = this.createSection(tabRay, 'Volumetric Raymarcher', 'PARTICIPATING MEDIA');
    this.addSelect(secRay, {
      key: 'renderChannel',
      label: 'Render Mode / Diagnostic Field',
      options: DEBUG_CHANNELS,
    });
    this.addSelect(secRay, {
      key: 'colorPalette',
      label: 'Blackbody Radiation Palette',
      options: COLOR_PALETTES,
    });
    this.addSlider(secRay, {
      key: 'raymarchSteps',
      label: 'Primary Raymarch Steps',
      min: 32,
      max: 160,
      step: 4,
      format: (v) => `${Math.round(v)} steps`,
    });
    this.addSlider(secRay, {
      key: 'shadowSteps',
      label: 'Self-Shadow Light March Steps',
      min: 3,
      max: 12,
      step: 1,
      format: (v) => `${Math.round(v)} steps`,
    });
    this.addSlider(secRay, {
      key: 'renderScale',
      label: 'Viewport Render Resolution Scale',
      min: 0.5,
      max: 1.25,
      step: 0.05,
      format: (v) => `${Math.round(v * 100)}%`,
      onChange: () => this.handleResize(),
    });

    const secLight = this.createSection(tabRay, 'Pyro Emission & Scattering', 'BLACKBODY');
    this.addSlider(secLight, {
      key: 'fireIntensity',
      label: 'Blackbody Fire Core Intensity',
      min: 0.5,
      max: 12.0,
      step: 0.1,
    });
    this.addSlider(secLight, {
      key: 'bloomIntensity',
      label: '3D Volumetric Fire Bloom / Glare',
      min: 0.0,
      max: 2.0,
      step: 0.05,
    });
    this.addSlider(secLight, {
      key: 'godRaysIntensity',
      label: 'Crepuscular God-Ray Sun Shafts',
      min: 0.0,
      max: 1.5,
      step: 0.05,
    });
    this.addSlider(secLight, {
      key: 'shockwaveStrength',
      label: 'Supersonic Blast Refraction Wave',
      min: 0.0,
      max: 2.0,
      step: 0.05,
    });
    this.addSlider(secLight, {
      key: 'temperatureScale',
      label: 'Kelvin Temperature LUT Scale',
      min: 0.4,
      max: 2.2,
      step: 0.05,
    });
    this.addSlider(secLight, {
      key: 'internalScattering',
      label: '3D Internal Fire → Smoke Glow',
      min: 0.0,
      max: 6.0,
      step: 0.1,
    });
    this.addSlider(secLight, {
      key: 'densityExtinction',
      label: 'Smoke Optical Extinction (Opacity)',
      min: 4.0,
      max: 40.0,
      step: 0.5,
    });
    this.addSlider(secLight, {
      key: 'smokeAlbedo',
      label: 'Smoke Scattering Albedo (Soot ↔ Steam)',
      min: 0.04,
      max: 0.9,
      step: 0.01,
    });
    this.addSlider(secLight, {
      key: 'shadowDensity',
      label: 'Self-Shadow Optical Thickness',
      min: 2.0,
      max: 25.0,
      step: 0.5,
    });
    this.addSlider(secLight, {
      key: 'phaseAnisotropy',
      label: 'Henyey-Greenstein Silver-Lining (g)',
      min: -0.5,
      max: 0.85,
      step: 0.02,
    });
    this.addSlider(secLight, {
      key: 'sunElevation',
      label: 'Directional Sun Elevation',
      min: 10,
      max: 88,
      step: 1,
      format: (v) => `${Math.round(v)}°`,
    });
    this.addSlider(secLight, {
      key: 'sunAzimuth',
      label: 'Directional Sun Azimuth',
      min: 0,
      max: 360,
      step: 2,
      format: (v) => `${Math.round(v)}°`,
    });
    this.addSlider(secLight, {
      key: 'exposure',
      label: 'ACES Filmic Exposure',
      min: 0.5,
      max: 2.5,
      step: 0.05,
    });

    // --- TAB 4: EMITTERS, EXPLOSIONS & VOXEL COLLIDER ---
    const tabEmit = document.getElementById('tab-emitter');
    const secEmit = this.createSection(tabEmit, 'Continuous Fire Plume Emitter', 'SOURCE');
    this.addCheckbox(secEmit, {
      key: 'emitterEnabled',
      label: 'Enable Continuous Fuel/Fire Plume',
    });
    this.addSlider(secEmit, {
      key: 'emitterRate',
      label: 'Fuel & Heat Injection Rate',
      min: 0.1,
      max: 2.5,
      step: 0.05,
    });
    this.addSlider(secEmit, {
      key: 'emitterRadius',
      label: 'Nozzle / Burner Radius',
      min: 0.05,
      max: 0.25,
      step: 0.005,
    });
    this.addSlider(secEmit, {
      key: 'emitterUpwardVelocity',
      label: 'Jet Upward Velocity',
      min: 0.5,
      max: 8.0,
      step: 0.1,
    });
    this.addSlider(secEmit, {
      key: 'emitterSwirl',
      label: 'Vortex Swirl Impulse',
      min: 0.0,
      max: 8.0,
      step: 0.1,
    });

    const secBlast = this.createSection(tabEmit, 'Detonation / Explosion Generator', 'BLAST');
    this.addCheckbox(secBlast, {
      key: 'shrapnelEnabled',
      label: 'Eject 3D Ballistic Shrapnel Streamers',
    });
    this.addSlider(secBlast, {
      key: 'blastStrength',
      label: 'Radial Shockwave Velocity',
      min: 2.0,
      max: 18.0,
      step: 0.25,
    });
    this.addSlider(secBlast, {
      key: 'blastRadius',
      label: 'Fireball Detonation Radius',
      min: 0.1,
      max: 0.35,
      step: 0.01,
    });
    this.addSlider(secBlast, {
      key: 'blastTemperature',
      label: 'Detonation Core Temperature',
      min: 2.0,
      max: 9.0,
      step: 0.1,
    });
    this.addSlider(secBlast, {
      key: 'blastLobes',
      label: 'Cauliflower Lobe Frequency',
      min: 2.0,
      max: 12.0,
      step: 0.5,
    });

    const secObs = this.createSection(tabEmit, '3D Voxelized Solid Collider', 'OBSTACLE');
    this.addSelect(secObs, {
      key: 'obstacleType',
      label: 'Collider Geometry Shape',
      options: OBSTACLE_TYPES,
    });
    this.addSlider(secObs, {
      key: 'obstacleY',
      label: 'Collider Altitude (Y)',
      min: 0.2,
      max: 0.78,
      step: 0.01,
    });
    this.addSlider(secObs, {
      key: 'obstacleX',
      label: 'Collider Horizontal Offset (X)',
      min: 0.2,
      max: 0.8,
      step: 0.01,
    });
    this.addSlider(secObs, {
      key: 'obstacleZ',
      label: 'Collider Horizontal Offset (Z)',
      min: 0.2,
      max: 0.8,
      step: 0.01,
    });
    this.addCheckbox(secObs, {
      key: 'colliderAutoMove',
      label: 'Animate Ball / Tyre Through Liquid',
    });
    this.addSlider(secObs, {
      key: 'colliderSpeed',
      label: 'Moving Collider Speed',
      min: 0.1,
      max: 3.0,
      step: 0.05,
    });
    this.addSlider(secObs, {
      key: 'obstacleRadius',
      label: 'Collider Size / Radius',
      min: 0.08,
      max: 0.28,
      step: 0.005,
    });

    const secOverlays = this.createSection(tabEmit, 'Viewport Overlays & Embers', 'SCENE');
    this.addCheckbox(secOverlays, {
      key: 'showBoundingBox',
      label: 'Show 3D Voxel Domain Wireframe',
    });
    this.addCheckbox(secOverlays, {
      key: 'showVoxelGridLines',
      label: 'Show Voxel Resolution Cell Subdivisions',
    });
    this.addCheckbox(secOverlays, {
      key: 'showFloorGrid',
      label: 'Show Lit Studio Floor + Volumetric Shadows',
    });
    this.addCheckbox(secOverlays, {
      key: 'showEmbers',
      label: 'Show GPU-Advected Fireflies / Ash Motes',
    });
    this.addSlider(secOverlays, {
      key: 'emberCount',
      label: 'Firefly / Ash Mote Count',
      min: 0,
      max: 1000,
      step: 10,
      format: (v) => `${Math.round(v)}`,
    });
    this.addSlider(secOverlays, {
      key: 'emberSize',
      label: 'Firefly / Ash Mote Size',
      min: 0.35,
      max: 2.5,
      step: 0.05,
      format: (v) => `${v.toFixed(2)}x`,
    });
    this.addSlider(secOverlays, {
      key: 'emberIntensity',
      label: 'Firefly Brightness / Ash Visibility',
      min: 0.1,
      max: 3.0,
      step: 0.05,
      format: (v) => `${v.toFixed(2)}x`,
    });
    this.addSlider(secOverlays, {
      key: 'emberLifetime',
      label: 'Mote Lifetime / Drift Speed',
      min: 0.25,
      max: 3.0,
      step: 0.05,
      format: (v) => `${v.toFixed(2)}x`,
    });
    this.addSlider(secOverlays, {
      key: 'emberAshiness',
      label: 'Ashiness (Orange Firefly ↔ Grey Ash)',
      min: 0.0,
      max: 1.0,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    });
  }

  frameLoop(now) {
    const dt = Math.max(0.001, (now - this.lastFrameTime) * 0.001);
    this.lastFrameTime = now;

    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.25) {
      this.displayedFps = Math.min(144, Math.round(this.fpsFrames / this.fpsAccum));
      const statFps = document.getElementById('stat-fps');
      if (statFps) statFps.textContent = `${this.displayedFps}`;
      if (this.engine && this.engine.getBoundsBox) {
        const { effWidth, effHeight } = this.engine.getBoundsBox();
        const statBounds = document.getElementById('stat-bounds');
        if (statBounds) {
          statBounds.textContent = `${effWidth.toFixed(1)}×${effHeight.toFixed(1)}m`;
        }
      }
      // Automatic Low-End GPU FPS Governor
      if (this.params.autoGpuGovernor) {
        if (this.displayedFps < 42 && this.params.raymarchSteps > 40) {
          this.setParam('raymarchSteps', Math.max(36, this.params.raymarchSteps - 12));
        } else if (this.displayedFps >= 58 && this.params.raymarchSteps < 96) {
          this.setParam('raymarchSteps', Math.min(96, this.params.raymarchSteps + 4));
        }
      }
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    if (this.params.autoTurntable) {
      this.camera.targetTheta += dt * 0.35;
    }
    this.camera.update(dt);

    if (this.engine) {
      if (!this.params.paused || this.singleStepRequested) {
        this.engine.stepSimulation(dt);
        this.singleStepRequested = false;
      }
      this.engine.render(this.camera);
    }

    requestAnimationFrame((t) => this.frameLoop(t));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.pyroApp = new PyroStudioApp();
});
