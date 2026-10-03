# Niagara Grid3D // Real-Time Pyro + Hydro Liquid Lab (WebGL2 & WebGPU)

A browser GPU laboratory for **3D Eulerian fire/smoke/explosion simulation** and a complementary **volumetric voxel-liquid mode**. It is inspired by the workflow and visual language of Unreal Engine 5 Niagara Fluids and EmberGen, while keeping the implementation self-contained in WebGL2/WebGPU.

## Simulation modes

### Pyro / gas
The existing fire mode uses a 3D Eulerian voxel state and volumetric raymarcher:

- Continuous fuel/heat/smoke injection and multi-lobe detonations.
- MacCormack/BFECC-style advection, combustion, buoyancy, vorticity confinement, turbulent forces, divergence expansion, and Jacobi pressure projection.
- Dynamic world bounds, 16³–128³ tiled volume atlases, voxel DDA display, self-shadowing, fire irradiance, bloom, god-rays, embers, and lit solid obstacles.

### Hydro / liquid
Hydro mode reuses the same GPU voxel memory with a different state layout:

- `R = liquid fraction / volume`, `G = whitewater foam`, `B = surface adhesion/wetting film`, `A = interface / pressure hint`.
- A seeded 3D liquid volume with semi-Lagrangian advection, gravity, viscosity, surface-tension force, divergence, Jacobi pressure projection, and pressure-gradient velocity correction.
- A kinematic moving **ball** and a rolling **treaded tyre** are available as animated voxel colliders. They push the liquid in three dimensions, generate wakes/foam/splash shells, and can carry a wet film.
- A true volumetric **3D dam-break** initial condition is available; the raised column collapses through the domain instead of simply changing a flat water shader.
- Viscosity changes the look from water to thick mud or melted chocolate. Surface tension gathers liquid into sheets and droplets; **surface adhesion/wetting** is the term for liquid sticking to a tyre, ball, or other surface.
- The liquid raymarcher adds volume absorption, free-surface normals, glossy Fresnel/specular highlights, foam shading, object shadows, and animated floor caustics.

This is still a deliberately compact real-time Eulerian/VOF-style solver rather than a full production FLIP solver, but the liquid is now an evolving 3D voxel field rather than a procedural screen-space water surface. It is designed to remain interactive at low resolutions while showing actual volume advection, dam-break motion, collider impulses, foam, and pressure projection.

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

The inspector exposes pool level, viscosity, adhesion/wetting, surface tension, foam lifetime, splash energy, wave mode/height/speed, and liquid specular response. The `🌊 WATER SPLASH` and `🏄 SURF WAVE` viewport actions provide quick demonstrations without opening the inspector.

## Performance notes

- **Dynamic bounds** change the physical box used by the solver and raymarcher, but they do not change the selected `N³` voxel count. Expansion normally costs about the same GPU simulation time; it prevents explosions/waves from hitting the box boundary. A larger box spreads the same voxels over more space, so it can reduce detail per metre.
- **Voxel Quantization** is primarily a rendering/debug control. `0%` trilinear sampling is usually the fastest. Intermediate quantization can be slightly slower because it adds sampling/blending work; the discrete DDA render mode has a different ray traversal cost and is not automatically faster.
- For FPS, reduce grid resolution first, then render scale/raymarch steps, enable the GPU governor, and reduce ember count. Dynamic bounds are for physical room, not an FPS optimization.

## Is this exactly what Unreal Engine uses?

No. The controls and concepts are Niagara-Fluids-inspired, not a copy of Unreal's private production implementation. Unreal projects can use Niagara Fluids 2D/3D grids, particle/FLIP-style liquid workflows, surface reconstruction, and dedicated render/material systems depending on the engine version and target effect. This project is better for a portable, inspectable browser demo with one-click shader changes and very small grids; Unreal is better for production-quality adaptive domains, particle-to-surface meshing, high-resolution collisions, art direction, caching, and large-scale foam/spray rendering.

## GPU architecture

- **WebGL2:** 2D tiled `RGBA16F` atlases store the 3D voxel state. Hydro runs separate injection, advection, divergence, Jacobi pressure, and gradient passes as fullscreen draws; pyro keeps its existing gas pipeline. Both share allocation and the liquid raymarcher.
- **WebGPU:** `@compute @workgroup_size(4, 4, 4)` updates storage buffers directly and retains the hydro/raymarch integration for compatible browsers.
- Resolutions include `16³`, `24³`, `32³`, `48³`, `64³`, `96³`, and `128³`; use 16³/24³ for integrated or low-end GPUs.

## Running locally

```bash
npm install
npm run dev
```

The Vite server binds to `0.0.0.0:5173` for the live preview. `npm run build` produces the production bundle in `dist/`.
