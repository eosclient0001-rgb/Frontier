# Niagara Grid3D // Real-Time Pyro + Hydro Liquid Lab (WebGL2 & WebGPU)

A browser GPU laboratory for **3D Eulerian fire/smoke/explosion simulation** and a genuinely separate **GPU particle-liquid mode**. It is inspired by the workflow and visual language of Unreal Engine 5 Niagara Fluids and EmberGen, while keeping the implementation self-contained in WebGL2/WebGPU.

## Simulation modes

### Pyro / gas
The existing fire mode uses a 3D Eulerian voxel state and volumetric raymarcher:

- Continuous fuel/heat/smoke injection and multi-lobe detonations.
- MacCormack/BFECC-style advection, combustion, buoyancy, vorticity confinement, turbulent forces, divergence expansion, and Jacobi pressure projection.
- Dynamic world bounds, 16³–128³ tiled volume atlases, voxel DDA display, self-shadowing, fire irradiance, bloom, god-rays, embers, and lit solid obstacles.

### Hydro / liquid
Hydro is not a branch of the gas solver. Selecting Water replaces the Pyro engine with `ParticleFluidWebGL2Engine` and uses a persistent marker state:

- Two ping-pong floating-point textures store normalized particle position and velocity/foam for a fixed marker count. Markers are clamped into the physical container; they do not fade, evaporate, or disappear when displaced or outside the camera view.
- Each update performs compact GPU pairwise density/pressure separation, viscosity, gravity, surface tension/cohesion, and velocity integration. It is an intentionally practical SPH/PIC-style browser solver, not a full production FLIP implementation.
- A raised **3D dam-break** marker volume collapses, spreads across the floor, piles up, and produces an impulse-driven front. Pool volume is preserved because the same markers continue moving rather than being replaced by a smoke-density field.
- Analytic SDF response handles sphere, tyre, pillar, bar, and cube obstacles. Collision response pushes markers out of solids, retains tangential motion, damps relative velocity, and applies adhesion/wetting so water can stick and slide along a collider.
- Splash actions write a real expanding impulse into particle velocity. Emitters accelerate existing markers instead of spawning disposable gas dye; viscosity, gravity, adhesion, foam, absorption, roughness, refraction, and lighting remain water-specific controls.
- Rendering is a separate screen-space fluid pipeline: particle sphere depth, additive thickness/foam, reconstructed normals, clear-water absorption, refraction, Fresnel reflection, restrained specular/caustic light, and a dark floor/background. It is not volumetric gas accumulation.

This is designed for practical low-resolution browser execution while visibly retaining a coherent liquid body. See [Epic's fluid overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/fluid-simulation-in-unreal-engine---overview), the [Niagara liquid rendering notes](https://80.lv/articles/working-with-niagara-fluids-to-create-water-simulations), and the [real-time screen-space fluid pipeline overview](https://tympanus.net/codrops/2025/02/26/webgpu-fluid-simulations-high-performance-real-time-rendering/).

## Liquid presets

The preset dock includes:

- **3D Dam Breaker** — raised liquid column collapsing through the open domain.
- **Tire in Volumetric Water** — moving off-road tyre, wakes, splashes, foam, and wetting.
- **Surfing Barrel Wave** — travelling crest/shoulder, hollow surf-like wave, and whitewater.
- **Moving Ball in Water** — animated sphere with a crown splash and foam trail.
- **Melted Chocolate + Spinning Wheel** — high viscosity, strong adhesion, glossy cocoa shading.
- **Off-Road Tire in Thick Mud Bog** — viscous mud/clay, tread wetting, and heavy splatter.
- **Fire Tornado / Alchemical Vortex** — high-swirl rising column with strong vorticity confinement.
- **Ashfall / Grey Fireflies** — cooling smoke with adjustable grey ash motes.

The inspector exposes pool level, viscosity, adhesion/wetting, surface tension, particle pressure/rest density/neighbour radius, foam lifetime, splash energy, wave mode/height/speed, independent water tint/specular response, and water-only absorption/scattering/roughness/refraction controls. The `🌊 WATER SPLASH`, `🏄 SURF WAVE`, and `🧱 DAM BREAK` viewport actions provide quick demonstrations without opening the inspector.

## Performance notes

- **Dynamic bounds** change the physical box used by the Pyro solver and raymarcher, but they do not change the selected `N³` voxel count. Expansion normally costs about the same GPU simulation time; it prevents explosions from hitting the box boundary. The particle-liquid path deliberately keeps a stable container so markers remain persistent and pool collision behavior remains predictable.
- **Voxel Quantization** is primarily a rendering/debug control. `0%` trilinear sampling is usually the fastest. Intermediate quantization can be slightly slower because it adds sampling/blending work; the discrete DDA render mode has a different ray traversal cost and is not automatically faster.
- For FPS, reduce grid resolution first, then render scale/raymarch steps, enable the GPU governor, and reduce ember count. Dynamic bounds are for physical room, not an FPS optimization.

## Is this exactly what Unreal Engine uses?

No. The controls and concepts are Niagara-Fluids-inspired, not a copy of Unreal's private production implementation. Unreal projects can use Niagara Fluids 2D/3D grids, particle/FLIP-style liquid workflows, surface reconstruction, and dedicated render/material systems depending on the engine version and target effect. This project is better for a portable, inspectable browser demo with one-click shader changes and very small grids; Unreal is better for production-quality adaptive domains, particle-to-surface meshing, high-resolution collisions, art direction, caching, and large-scale foam/spray rendering.

## GPU architecture

- **Pyro:** WebGL2 and WebGPU keep the existing Eulerian voxel gas pipeline, with tiled `RGBA16F` atlases or compute storage buffers, combustion, buoyancy, smoke, and volumetric fire rendering.
- **Water:** Hydro always selects `ParticleFluidWebGL2Engine` for now. It owns its own GLSL programs, persistent ping-pong particle textures, pressure/viscosity update pass, particle depth/thickness passes, and water composite. The WebGPU Pyro backend is intentionally not used for Hydro until a separate particle WebGPU backend exists.
- Pyro grid resolutions remain `16³`, `24³`, `32³`, `48³`, `64³`, `96³`, and `128³`. They select practical fixed particle counts in Hydro (768–1536 markers) rather than allocating a voxel water atlas.

## Running locally

```bash
npm install
npm run dev
```

The Vite server binds to `0.0.0.0:5173` for the live preview. `npm run build` produces the production bundle in `dist/`.
