# Frontier — Real-time Volumetric Fluids (WebGL2)

3D particle fluid simulation + Unreal/FleX-style screen-space fluid rendering. No build step.

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Simulation: GPU FLIP/PIC (`src/gpusim.js`)
The whole solver runs on the GPU in WebGL2 fragment-shader passes. Particles live in float textures and never leave the GPU, so it handles hundreds of thousands of particles in real time (up to ~410k).

Per substep:
1. **P2G**: particles splat velocity, mass and concentration onto a staggered MAC grid (instanced points + additive float blending). The grid is stored as tiled 2D atlases.
2. **Normalize/classify**: cells are marked solid, fluid or air, with density.
3. **Extrapolate** velocities into air (kept as the "old" grid for FLIP).
4. **Forces + boundaries**: gravity, moving solids (wave piston, rigid spheres), and wall friction (no-slip for sticky fluids).
5. **Implicit viscosity** (Jacobi), with per-cell viscosity from the A/B mixture.
6. **Divergence + density correction**, then a warm-started **Jacobi pressure solve** and **projection**.
7. **G2P**: per-material FLIP/PIC blend (water splashes, honey is damped), RK2 advection, collisions, adhesion, yield stress (mud), foam generation and A/B mixing.
8. **Wetness** update on the grid.

Rigid spheres are integrated on the CPU. They're coupled through a tiny GPU reduction (submerged particle count + mean flow per sphere, one 16-pixel readback per frame) that gives buoyancy and viscous drag.

## Two-fluid mixing
Each particle carries a concentration of fluid B. Viscosity, cohesion, adhesion, friction, yield stress and foam are interpolated per particle, and the concentration diffuses between neighbors, so milk poured into chocolate forms marbled swirls and slowly becomes chocolate milk. In the composite shader, a thickness-weighted concentration buffer blends the two materials' optical properties (absorption, scattering, albedo, roughness, refraction). Mixing rate is adjustable, and 0 keeps the fluids separate.

## Fluid lighting, caustics and wet surfaces
- **Colored volumetric shadows.** The fluid is rendered from the sun into light-space depth and thickness maps. Every surface measures how much fluid lies between it and the sun, then applies Beer–Lambert transmission. Honey casts amber light, water a blue-green tint, and chocolate and mud near-black shadows. The fluid also shadows itself.
- **Caustics.** An animated caustic pattern appears under clear liquids. It's strongest under thin layers and fades with depth and for scattering fluids.
- **Wetness and stains.** The solver records where fluid touched static surfaces in a GPU grid texture. Surfaces darken and turn glossy (water), or get coated with the fluid's color (chocolate, mud, honey). Each material dries at its own rate: water in seconds, honey practically never.

## Rendering (`src/renderer.js`)
1. Scene pass (tiles, obstacles, objects, procedural sky, contact shadows/AO)
2. Particle sphere-impostor **depth** pass (linear eye depth, R32F)
3. Additive **thickness + foam** pass
4. Depth-aware **bilateral smoothing** (screen-space radius)
5. **Composite**: reconstructed normals, Fresnel, GGX specular, environment reflection, refraction with **Beer–Lambert absorption**, multiple-scattering body for opaque fluids, mud grain, foam, ACES tonemapping

| Material | Look | Behavior |
|---|---|---|
| Water | clear, refractive, blue-green absorption, foam | low viscosity, splashes |
| Milk | opaque white, soft subsurface | slightly viscous |
| Chocolate | glossy dark brown | viscous, sticky, coats surfaces |
| Honey | amber, translucent, glowing | very viscous, very sticky, coils |
| Mud | matte, grainy, wet patches | viscous with a yield stress, clumps |

Controls: drag to orbit, scroll to zoom, click to throw an object, keys 1–5 switch fluid A live, B pours fluid B, R resets, P shows raw particles.
