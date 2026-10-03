# Frontier — Real-time Volumetric Fluids (WebGL2)

3D particle fluid simulation + Unreal/FleX-style screen-space fluid rendering. No build step.

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Simulation (`src/sim.js`)
- **Position Based Fluids** (Macklin & Müller) with an incompressibility constraint, tensile-instability correction, and uniform-grid neighbor search with spatial reordering.
- **Viscosity**: normalized XSPH, repeated for very viscous fluids (honey/chocolate/mud).
- **Cohesion**: negative-pressure clamp acts as surface tension, so viscous fluids hold together in strands.
- **Adhesion + surface friction**: particles near solids are pulled onto them and lose tangential speed relative to the surface, so fluid sticks to walls, obstacles and moving objects.
- **Yield stress** (mud): slow flow freezes like a Bingham plastic.
- **Rigid bodies**: two-way coupled spheres with buoyancy from the submerged volume, viscous drag and friction. Wood floats, steel sinks, and objects get stuck in honey.
- **Whitewater**: fast, under-dense particles generate foam/spray.
- Colliders: tank, static boxes, beach ramp, moving wave-maker piston, spheres. Plus a stream emitter.

## Two-fluid mixing
Each particle carries a concentration of fluid B. Viscosity, cohesion, adhesion, friction, yield stress and foam are interpolated per particle, and the concentration diffuses between neighbors, so milk poured into chocolate forms marbled swirls and slowly becomes chocolate milk. In the composite shader, a thickness-weighted concentration buffer blends the two materials' optical properties (absorption, scattering, albedo, roughness, refraction). Mixing rate is adjustable, and 0 keeps the fluids separate.

## Fluid lighting, caustics and wet surfaces
- **Colored volumetric shadows.** The fluid is rendered from the sun into light-space depth and thickness maps. Every surface measures how much fluid lies between it and the sun, then applies Beer–Lambert transmission. Honey casts amber light, water a blue-green tint, and chocolate and mud near-black shadows. The fluid also shadows itself.
- **Caustics.** An animated caustic pattern appears under clear liquids. It's strongest under thin layers and fades with depth and for scattering fluids.
- **Wetness and stains.** The solver records where fluid touched static surfaces in a grid that's uploaded as a 3D texture. Surfaces darken and turn glossy (water), or get coated with the fluid's color (chocolate, mud, honey). Each material dries at its own rate: water in seconds, honey practically never.

## Threading
The solver runs in a Web Worker (`src/worker.js`) on a fixed 120 Hz clock. The render thread draws the latest snapshot, so the camera and UI stay smooth even when the simulation is heavy. If the CPU can't keep up, the sim runs in slow motion instead of stalling.

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
