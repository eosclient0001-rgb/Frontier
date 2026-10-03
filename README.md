# Niagara Grid3D // Real-Time Pyro + Hydro Liquid Lab (WebGL2 & WebGPU)

A browser GPU laboratory for **3D Eulerian fire/smoke/explosion simulation** and a complementary **shallow-water / voxel liquid mode**. It is inspired by the workflow and visual language of Unreal Engine 5 Niagara Fluids and EmberGen, while keeping the implementation self-contained in WebGL2/WebGPU.

## Simulation modes

### Pyro / gas
The existing fire mode uses a 3D Eulerian voxel state and volumetric raymarcher:

- Continuous fuel/heat/smoke injection and multi-lobe detonations.
- MacCormack/BFECC-style advection, combustion, buoyancy, vorticity confinement, turbulent forces, divergence expansion, and Jacobi pressure projection.
- Dynamic world bounds, 16³–128³ tiled volume atlases, voxel DDA display, self-shadowing, fire irradiance, bloom, god-rays, embers, and lit solid obstacles.

### Hydro / liquid
Hydro mode reuses the same GPU voxel memory with a different state layout:

- `R = liquid fraction`, `G = whitewater foam`, `B = surface adhesion/wetting film`, `A = shallow-water slope/pressure`.
- A primary shallow-water free surface with travelling swells, a compact plunging/surfing crest, moving-collider wakes, crown splashes, rooster tails, and decaying foam.
- A kinematic moving **ball** and a rolling **treaded tyre** are available as animated voxel colliders. They push the liquid, generate wakes/foam, and can carry a wet film.
- Viscosity changes the look from water to thick mud or melted chocolate. Surface tension gathers liquid into sheets and droplets; **surface adhesion/wetting** is the term for liquid sticking to a tyre, ball, or other surface.
- The liquid raymarcher adds volume absorption, free-surface normals, glossy Fresnel/specular highlights, foam shading, object shadows, and animated floor caustics.

The hydro pass is a deliberately compact real-time shallow-water/VOF-style approximation rather than a full production FLIP solver. It is designed to remain interactive at low resolutions and to demonstrate the correct controls and visual behaviours.

## Liquid presets

The preset dock includes:

- **Tire in Shallow Water** — moving off-road tyre, wakes, splashes, foam, and wetting.
- **Surfing Barrel Wave** — travelling crest/shoulder, hollow surf-like wave, and whitewater.
- **Moving Ball in Water** — animated sphere with a crown splash and foam trail.
- **Melted Chocolate + Spinning Wheel** — high viscosity, strong adhesion, glossy cocoa shading.
- **Off-Road Tire in Thick Mud Bog** — viscous mud/clay, tread wetting, and heavy splatter.

The inspector exposes pool level, viscosity, adhesion/wetting, surface tension, foam lifetime, splash energy, wave mode/height/speed, and liquid specular response. The `🌊 WATER SPLASH` and `🏄 SURF WAVE` viewport actions provide quick demonstrations without opening the inspector.

## Is this exactly what Unreal Engine uses?

No. The controls and concepts are Niagara-Fluids-inspired, not a copy of Unreal's private production implementation. Unreal projects can use Niagara Fluids 2D/3D grids, particle/FLIP-style liquid workflows, surface reconstruction, and dedicated render/material systems depending on the engine version and target effect. This project is better for a portable, inspectable browser demo with one-click shader changes and very small grids; Unreal is better for production-quality adaptive domains, particle-to-surface meshing, high-resolution collisions, art direction, caching, and large-scale foam/spray rendering.

## GPU architecture

- **WebGL2:** 2D tiled `RGBA16F` atlases store the 3D voxel state. Each simulation pass is a fullscreen draw over the atlas. Hydro and pyro share allocation but switch to separate update/render logic when the user changes mode.
- **WebGPU:** `@compute @workgroup_size(4, 4, 4)` updates storage buffers directly. The hydro compute path and liquid raymarcher use the same controls as WebGL2.
- Resolutions include `16³`, `24³`, `32³`, `48³`, `64³`, `96³`, and `128³`; use 16³/24³ for integrated or low-end GPUs.

## Running locally

```bash
npm install
npm run dev
```

The Vite server binds to `0.0.0.0:5173` for the live preview. `npm run build` produces the production bundle in `dist/`.
