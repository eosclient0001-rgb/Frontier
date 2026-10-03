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

Controls: drag to orbit, scroll to zoom, click to throw an object, keys 1–5 switch material live, R resets, P shows raw particles.
