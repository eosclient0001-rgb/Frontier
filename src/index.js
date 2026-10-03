/**
 * Frontier Volumetric FX
 * ------------------------------------------------------------------------
 * Real-time fire / smoke / explosions for WebGPU: a GPU Eulerian fluid solver
 * on 3D textures (Niagara Grid3D style) plus a single-pass volumetric
 * raymarcher.
 *
 * Quick start:
 *
 *   import { createVolumetricFX } from './src/index.js';
 *
 *   const fx = await createVolumetricFX({ canvas, preset: 'campfire', quality: 'high' });
 *   fx.attachControls();
 *
 *   let last = performance.now();
 *   (function loop(now) {
 *     const dt = (now - last) / 1000; last = now;
 *     fx.frame(dt);
 *     requestAnimationFrame(loop);
 *   })(last);
 */

export { VolumetricFX, createVolumetricFX, createVolumetricFX as default } from './VolumetricFX.js';
export { FluidSolver } from './volumetric/FluidSolver.js';
export { VolumetricRenderer } from './volumetric/VolumetricRenderer.js';
export { EmitterSystem, makeEmitter, EMITTER_KIND } from './volumetric/EmitterSystem.js';
export { OrbitCamera, attachOrbitControls } from './volumetric/Camera.js';
export { PRESETS, PRESET_ORDER, QUALITY, QUALITY_ORDER } from './presets.js';
export { initWebGPU, Program, reflectBindings } from './gpu/WebGPU.js';
export { UniformPacker, SIM_LAYOUT, RENDER_LAYOUT, EmitterPacker, MAX_EMITTERS } from './gpu/UniformBuilder.js';
