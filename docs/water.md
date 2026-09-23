# Animated water and explicit routes

## Controls

**Water** now controls:

- Wave height, wavelength, animation speed and heading.
- Fine ripple strength, independent of the larger displaced waves.
- Foam coverage, shoreline reach and patch scale.
- Reflection strength, water clarity and route surface offset. Water follows individual point elevations.

The surface animates continuously from rendering time, including while erosion is paused. It does not require simulation iterations. The visible route's speed and the River transport enable switch supply the visual flow direction/advection speed; wave propagation and foam evolution are artistic effects rather than a validated hydraulic time scale.

Water and river transport require an **explicit visible XYZ route** anywhere on the terrain. Use **Water → Draw river route**. Fixed canyon scenes and canned routes have been removed. Nothing automatically spawns in a preset channel or pond. See [Satmaps and shared routes](satmaps-and-routes.md).

## Surface rendering

`src/water-shader.js` is inserted into the **active WebGL2 fragment shader**. The unused WGSL source has been removed. The renderer's original seven-vec4 camera interface is unchanged; named vec4 uniforms carry the water settings.

### Waves and intersections

Four differently oriented waves use non-commensurate frequencies, phase offsets, seed-dependent low-frequency world-space noise and a time-evolving phase warp. Their coordinates bend with the channel. This avoids a visibly repeated wave tile: there is no periodically wrapped water UV or repeating wave texture.

Wave height affects the **ray/surface intersection**, not just a normal map. Each finite inclined route segment supplies an intersection candidate, then up to eight bracketed Newton/bisection iterations refine the displaced surface. Primary slopes include route grade and flow-aligned waves; the small low-frequency warp's derivatives are omitted. Fine procedural ripples add normal detail without adding geometry. Height is bounded by `min(requestedHeight, wavelength × 0.15)` to limit very steep short waves and stabilize intersection.

This is a bounded procedural water surface, not an SDF fluid volume, FFT ocean, pressure projection, shallow-water solver, or dynamically conserved free surface. Rays nearly tangent to an inclined route (directional derivative below 0.005) are culled; very grazing views, tight bends and short/steep waves remain approximations. Erosion uses interpolated route elevation, not individual wave crests.

### Refraction, reflection and lighting

The water uses RGB exponential depth absorption, shallow-bed transmission, a deeper green tint, Fresnel reflection and sun glints. Two short terrain-only ray marches (up to 28 samples each) provide bed refraction and bank reflections from the current SDF. They include edits/fractures through the normal terrain material evaluation. Reflections do not recursively render other water, sky reflections remain analytic, and rays that miss their bounded budget fall back rather than claiming perfect mirror geometry.

Clarity changes artistic absorption coefficients, not a calibrated physical turbidity measurement. In shallow water, exposed bed and warm rock reflections can make the surface sandy/brown rather than uniformly blue. Edit route elevations/offset, or carve the bed, to cover exposed peaks. Raising the old placement fallback does not move existing water. Reflections and refraction do not allocate screen-space history buffers or read pixels back to the CPU during rendering.

### Foam without a foam tile

Foam is synthesized from world-space noise at several independent scales with domain warping and continuous flow advection. No foam image, periodic UV reset, or recycled foam tile is used. The current SDF determines rock proximity. A vertical-distance-gradient test reduces foam over a flat shallow bed, preserving broken foam near banks/obstacles instead of producing a uniformly white river. Shallowness/current and steeper crests contribute smaller amounts. Coarse patches, porous edges and fine shading form the visible foam; foam coverage zero disables it.

This is procedural **shading**, not a persistent foam-particle/density simulation. It has no foam mass budget or physically modelled bubble lifetime. Foam follows the guided channel coordinates, not a pressure-derived local eddy field, and it does not produce vessel wakes. The separate erosion-agent sediment plumes are unchanged.

## Export, cost and verification

All controls are included in the existing exported settings object; whole-terrain SDF geometry remains in the usual `.frontier` volume payload. The water is procedural metadata/shading, not a triangle mesh embedded in the export. No texture assets, external services or WebGPU were added.

Extra wave evaluations and short SDF optical rays cost fragment work only where the water can be visible. Rendering still uses the existing adaptive pixel budget. No native-device FPS claim is implied by SwiftShader tests.

Unit tests verify finite uniforms, wave steepness bounds and exported settings. Browser checks cover animation while erosion is paused, foam/optics pixel changes and opaque rendering from extreme views. See [current verification](kilometre-workspaces.md#verification).
