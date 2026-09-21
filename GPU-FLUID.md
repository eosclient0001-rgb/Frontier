# GPU Volume — actual 3D particle fluid

**New experiment:** [DFSPH checkbox, A/B measurements and uncapped container footprint](GPU-DFSPH.md). Select Water → **Use DFSPH · experimental**. Off remains WCSPH. The old 14 × 10 m maximum has been removed; actual GPU resource limits still apply.

**Measured optimization update:** see [GPU-OPTIMIZATION.md](GPU-OPTIMIZATION.md) for the Python-driven before/after profiles, neighbor-cache implementation, scene-rendering cache, low-damping Water preset, contact correction and current regression results. The earlier regression measurements below describe the first volumetric iteration.

Open **`gpu-fluid.html`**, or run:

```sh
python3 preview-gpu.py --port 8005
```

The new server opens this experiment at `/`. The original light pond stays at `/index.html`; the earlier whitewater experiments remain separate and unchanged. This is deliberately a new HTML entry point: the original heightfield is **not** used to simulate the new water.

## What runs on the GPU

The default mode is a **three-dimensional weakly-compressible smoothed particle hydrodynamics (WCSPH)** solver written in WGSL and dispatched through WebGPU. The particles represent the water volume, not decorative foam attached to a plane.

In WCSPH mode, every fixed substep executes four compute stages:

1. Clear a uniform **3D spatial grid**.
2. Insert particles into cell-linked lists with GPU atomic exchanges.
3. Traverse neighboring cells and compute particle **density and pressure**, caching accepted neighbor IDs for the force pass.
4. Compute pressure acceleration, viscosity, optional cohesion and XSPH velocity regularization; integrate gravity/velocity/position; resolve solid contacts into a second particle buffer.

The state buffers swap after each substep. Rendering reads those storage buffers directly. No CPU particle integration, heightfield coupling, or per-frame position readback is used. The CPU prepares initial particle positions and control uniforms, handles the camera/UI and the kinematic duck path, and submits GPU work.

**Collision response:** the fluid contacts the floor, domain walls, a spherical rock, and the moving duck's body/head sphere proxies. Position projection and velocity response use the collider's velocity, so dragging the duck displaces and accelerates surrounding water. Particles interact through SPH pressure, viscosity and kernel support—not rigid marble-to-marble bouncing. The duck's control path is kept away from the rock and walls.

The 3D kernels follow conventional particle-fluid techniques described by Müller, Charypar and Gross, *Particle-Based Fluid Simulation for Interactive Applications* (2003), including poly6 density, spiky pressure-gradient and viscosity kernels. [1](https://people.computing.clemson.edu/~dhouse/courses/817/papers/mueller03.pdf) This is a compact implementation with its own approximations, not a complete reproduction of that paper.

## Editor, tub sizing and GPU tiers

The page now uses an edge-to-edge two-column editor: **Outliner + Inspector | Viewport**. Select Tub, Water, Duck or Rock to inspect that object; the duck inspector also activates the move tool. The original light pond remains untouched.

The UI defaults to a **7.5 × 5 m** tub. Tub presets are Compact (5 × 3.4), Large (7.5 × 5), Wide (10 × 6.8), XL (14 × 10), XXL (30 × 20), and Huge (100 × 100). Custom widths ≥5 m and lengths ≥3.4 m have no fixed upper maximum. Device grid-buffer/dispatch limits and representable numeric values are checked before allocation. Apply dimensions rebuilds the GPU spatial grid, seeds a fresh fluid volume, resets the duck, and reframes the camera. It preserves the particle count, selected solver and paused/playing state.

At a fixed particle budget, spacing scales with the cube root of basin area and particle mass scales with spacing cubed. For ordinary aspect ratios nominal volume per floor area stays constant while larger tubs use coarser particles. Very narrow aspect ratios also constrain spacing to fit the width; huge footprints may have sparse coverage. Containment height and camera range grow as needed. Select Water to raise the particle budget if you need finer spatial resolution. No wave field is stretched.

**GTX/RTX are not automatic quality tiers.** Specific compute throughput, memory bandwidth, viewport size and the solver matter more than the branding. This solver does not use RTX ray-tracing cores. Halving particle spacing throughout the same volume requires roughly eight times as many particles and can require shorter timesteps. Quality is therefore explicit: Coarse / Medium / Fine, not a guessed GPU-name switch.

### Why it is expensive

This baseline WCSPH implementation uses a conservative fixed timestep: at 2 ms, a real-time 60 FPS frame needs about eight substeps, each with four compute dispatches and two neighborhood traversals. The density pass still uses atomic linked lists; the force pass now reuses a transposed accepted-neighbor cache. This is not yet a fully sorted particle grid. It also waits for completion of the submitted frame rather than deeply pipelining work. Screen-space depth filtering and analytic scene shading add rendering cost. Native engines can use different algorithms, better memory layouts, more optimized pipelines, or visual effects that are not equivalent full-volume solves; without the specific Unreal example, no like-for-like performance claim is justified.

The Water inspector now separates **GPU compute time** from **GPU render time** using timestamp queries. The substep readout belongs to that timing sample. Paused redraws have zero compute time. These measurements describe the current browser/adapter, not a universal GPU benchmark.

Render profiles are independent of physics: Fast caps width at 720 px with two depth-blur passes; Balanced (default) uses 960 px and four passes; High uses 1,400 px and six passes. Individual-particle display skips all blur passes. The former version always allowed 1,100 px and six passes. These are concrete work reductions at equivalent viewport dimensions, not a promised FPS multiplier.

## Parameters and bounds

The table below describes the **Compact** tub. Larger tub spacing is scaled as above and its fixed timestep is recomputed, capped at 2 ms. The solver library retains Compact as its default for existing regression tests; the editor explicitly requests Large.


| Preset | Fluid particles | Fixed substep | Nominal spacing |
|---|---:|---:|---:|
| Balanced | 6,144 | 2.00 ms | 0.120 m |
| Fine | 12,000 | 1.60 ms | 0.096 m |
| Heavy | 24,000 | 1.27 ms | 0.076 m |

- Basin footprint: adjustable, **7.5 × 5 m by default in the editor**. The simulation's closed containment domain extends to **3 m high**, including walls above the visible basin rim and a top containment plane. It does not support spilling away into an unbounded exterior.
- Rest density: 1,000 kg/m³; mass scales with spacing cubed, preserving the nominal fluid volume across presets.
- Smoothing radius: twice the nominal spacing.
- Pressure: a clamped linear equation of state, `p = 100 × max(density − restDensity, 0)`. This is weakly compressible, not an exact incompressibility projection.
- Approximate boundary kernel support helps density near solids. This is not a full sampled-boundary-particle pressure formulation.
- At most 12 substeps per submitted frame; slow devices lose wall-clock backlog rather than taking unstable large timesteps. Simulation can therefore run slower than real time under load.
- GPU linked-list traversal has an emergency 256-particle-per-cell visit bound. A 12 m/s emergency speed cap and invalid-state recovery also have diagnostic counters. These are robustness guards, not substitutes for stable physics; none activated in the inspected batches of the regression below.
- Particle number and mass are conserved. A jet applies force to the existing volume; it does not spawn visual particles to fake a splash.

## Rendering

The default mode reconstructs a visible water surface from the **actual GPU particle positions**:

1. Render analytic sphere depth, with real fragment depth testing.
2. Apply one, two or three separable bilateral depth-smoothing iterations according to the render profile.
3. Reconstruct surface normals and shade with approximate Fresnel reflection, refraction, absorption and direct-light highlights.

The depth textures here are *rendering intermediates*, not a foam coverage simulation. The simulation remains 3D SPH regardless of display mode. The alternative **Inspect individual particles** view skips smoothing and shows smaller individual particle spheres, making the interior layers, motion and contacts easier to inspect.

The floor, basin, rock and simplified duck use analytic rendering. A stable primary view is cached; moving views shade directly. Refracted rays still trace the analytic scene. Fluid/solid visibility is depth-compared. Optical effects and surface reconstruction are approximations: this is not ray-traced multiple scattering, a watertight exported surface mesh, or photorealistic foam. Separated drops and thin sheets are limited by particle resolution and screen-space reconstruction.

## Controls

- **Orbit:** drag to rotate; scroll/pinch to zoom.
- **Water jet:** press/drag over the water to apply upward force to actual fluid particles.
- **Move duck:** drag a target across the basin; the solid duck moves toward it while the simulation is playing.
- **Fire a water jet:** a short, preset force pulse.
- **Pause / Space:** freezes physics. Orbit and changing display still work.
- **Reset:** restores the volume and duck; preserves paused/playing state.
- Changing particle count rebuilds GPU buffers and resets the volume.
- **Fluid motion:** Water defaults to lower viscosity (0.003), weaker XSPH smoothing (0.004), and no artificial cohesion. Previous viscous reference restores the old values for comparison.
- **Measure GPU & save JSON:** resets the water, pauses and benchmarks fixed-size frames on the current device, then downloads the samples.
- Viscosity changes the simulated velocity diffusion. Values are illustrative, not a calibrated water-property experiment.

The duck is currently a **kinematic collider**, not a freely buoyant, two-way rigid-body pressure solve. The rock is spherical; duck body/head collisions use sphere proxies. The decorative beak and eyes do not have separate collision geometry. There are no lily rigid bodies, optical preset collection, or secondary foam/bubble phase in this new prototype; those older features remain in the original pages.

## Compatibility and performance

Requires a browser exposing **WebGPU** over HTTPS or localhost. Current Chrome/Edge with hardware acceleration and a compatible GPU/driver is the recommended starting point. The app reports missing WebGPU, missing adapters, shader errors and lost devices visibly, with a reload action. It does **not** silently substitute CPU SPH or the old heightfield.

A browser may expose a software WebGPU adapter. The UI identifies known software adapters; their timings are not representative of a hardware GPU. The sandbox validation used Chromium's SwiftShader WebGPU backend because this environment has no physical GPU.

The GPU-frame readout uses hardware timestamp queries when supported; otherwise it displays unavailable. It covers the submitted compute and rendering work, not CPU wall-clock frame timing. The FPS counter measures completed frames. Only one main frame is kept in flight, preventing an unbounded GPU command backlog. Render resolution is bounded by the selected profile, with no device-pixel-ratio multiplier.

This version is **not claimed to be faster than the old heightfield**. Solving a water volume costs substantially more than solving one height per surface cell. The purpose of WebGPU here is to parallelize the more demanding physical model; no hardware-FPS promise is made from software-adapter tests.

## Validation

`tests/gpu-sph.test.mjs` exports `runGPUSPHTests(device)`. It must run in a browser with an actual WebGPU device, not Node's ordinary JavaScript runtime. For example, on the preview origin, a developer-console invocation is:

```js
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
const { runGPUSPHTests } = await import('./tests/gpu-sph.test.mjs');
console.log(await runGPUSPHTests(device));
```

Pause the visible demo first to avoid competing workloads. This test creates its own solver/device buffers and executes the actual compute kernels.

Recorded default-resolution regression: **960 GPU substeps / 1.92 simulated seconds**, including a moving duck and a sustained jet, with four readback checkpoints:

- All 6,144 particles retained; all inspected values finite.
- **Zero** escaped particles or particles inside the rock/body/head collision proxies at the checkpoints.
- **Zero** neighbor-traversal truncations, speed-cap activations or invalid-state resets in the inspected batches.
- Mean density ratios at the checkpoints: approximately **1.016, 1.029, 1.017 and 1.030**.
- Solid contacts were recorded by GPU atomic counters, not inferred from images.
- Reset restored zero time, zero velocity and the full particle count.
- Additional 12-substep sanity checks passed for 12,000 and 24,000 particles. Those are not long-duration stability tests of the larger presets.

Browser checks also passed for actual rendering, shader/pipeline validation, fixed-step pause, particle inspection mode, moving-duck interaction, asynchronous GPU state readback, reset, resolution changes, mobile layout, and an intentionally unavailable WebGPU error path. The original pond's seven source-file checksums remain unchanged.

Runtime diagnostics:

```js
gpuFluidDiagnostics(); // Metadata only; no particle readback.
await inspectGPUFluid(); // Optional asynchronous state readback and finite/contact checks.
```

Readback is a validation tool, not part of the normal simulation loop. These tests demonstrate a working GPU volumetric prototype, not long-duration engineering accuracy or proven performance across all consumer GPUs.

The saved UI regression is `tests/gpu-fluid.browser.cjs` (requires an externally installed `playwright` package and Chromium). With the server running:

```sh
node tests/gpu-fluid.browser.cjs
```

`POND_URL` overrides the preview URL; `CHROMIUM_PATH` selects an installed Chromium binary. For a deliberately configured software-Vulkan CI environment, `GPU_SOFTWARE_TEST=1` adds the testing flags; driver/library paths still need to be configured by that environment. These flags are not a recommendation for normal users.


### Tub/editor regression checks

`node tests/gpu-tub.test.mjs` verifies initialization, finite/in-bounds positions, obstacle exclusion and constant nominal depth for six aspect ratios across all three particle budgets (18 combinations). These are CPU initialization checks, not substitutes for GPU tests.

`runGPUTubTests(device)` exported by `tests/gpu-sph.test.mjs` executes the real GPU kernels for 48 substeps in each of four larger/custom tubs. Readbacks were finite, with no escaped or solid-penetrating particles, and no safety guard activations. These are short smoke tests, not long-run stability guarantees. Browser checks also verified the selectable outliner/inspector, dimension presets and invalid input, unchanged particle budget and pause state after resizing, GPU timestamp validation, and a 390-pixel-wide split layout with no page overflow.

### Rendering follow-up

The current surface renderer batches all four wall intersections and calculates a normal only for the closest hit. A Python-driven, 27-sample-per-variant comparison measured 7.3% less stationary rendering time on **software SwiftShader**, with no particle-count or physics changes. Moving-camera whole-frame time was effectively unchanged. See `GPU-OPTIMIZATION.md` for raw-data paths, ray-equivalence tests and limitations.

### Density-search follow-up

The current density kernel conservatively rejects out-of-support grid cells using precomputed stencil distances. Repeated Python-driven software-WebGPU measurements found a 14.5% density-pass reduction but only a 0.9% whole-frame reduction; do not interpret this as a large FPS gain. Density/position comparisons, overflow fallback, 24,000-particle tests and a 4.8-second stress passed.

The GPU measurement JSON now includes local density-error statistics (last pre-integration solve, with approximate boundary support), not just a global mean. Substantial local errors remain. An experimental stronger-pressure setting reduced positive density excess but left much more kinetic energy, so it was **not** adopted. The default solver and pressure setting remain WCSPH / 100; the new optional DFSPH branch does not use that pressure coefficient. Full evidence and limitations are in `GPU-OPTIMIZATION.md`.

## Physical particle-size control

Select **Water → Particle size / detail**. The selector now has five budgets:

| Size | Particles | Collision diameter at the default 7.5 × 5 m footprint |
|---|---:|---:|
| Large | 6,144 | 12.5 cm |
| Medium | 12,000 | 10.0 cm |
| Small | 24,000 | 7.9 cm |
| Extra small | 48,000 | 6.3 cm |
| Tiny | 96,000 | 5.0 cm |

Labels recalculate for the active footprint. These are physical collision diameters; the surface reconstruction uses overlapping splats, not identical drawing diameters. Increasing count reduces spacing, collision radius, kernel radius and per-particle mass, and adjusts the safe fixed timestep. For ordinary footprints, total nominal water volume stays the same. Extreme narrow aspect ratios retain the existing width-limited spacing behavior, so this volume relationship is not guaranteed there.

Changing size resets the water and preserves the selected solver, material, container and play/pause state. The selected count persists when resizing. The largest options can be expensive, particularly with DFSPH, and are not automatically selected based on GPU branding. Allocation is checked against device storage and dispatch limits; a rejected request leaves the existing simulation active and shows an error beside the size selector.

Validation: 45 CPU seed/size combinations; monotonic size and nominal-volume checks; a pre-allocation resource-limit test; actual GPU 12-substep smoke tests at 48k and 96k in both WCSPH and DFSPH; browser checks for selector/reset, mode/material/pause preservation, dynamic centimetre labels, resizing and mobile layout. These short smoke tests are not long-duration stability or performance claims. See `benchmarks/results/particle-size-validation.json`, `benchmarks/particle-size-validate.py` and `tests/particle-size.test.mjs`.
