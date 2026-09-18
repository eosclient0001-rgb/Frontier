# Animated water and canyon shape

## Controls

**Water** now controls:

- Wave height, wavelength, animation speed and heading.
- Fine ripple strength, independent of the larger displaced waves.
- Foam coverage, shoreline reach and patch scale.
- Reflection strength, water clarity and mean water level.

The surface animates continuously from rendering time, including while erosion is paused. It does not require simulation iterations. The guided river's speed and enable switch, under **Erosion → River**, supply the visual flow direction/advection speed; wave propagation and foam evolution are artistic effects rather than a validated hydraulic time scale.

**Terrain → Canyon shape** appears for the Desert canyon preset:

- **Wall spacing / base gap:** nominal full gap before procedural variations, default 6.1 m. The finite outer formation is retained; increasing the gap makes the remaining walls thinner rather than expanding the entire world.
- **Channel bends:** multiplier on the existing meandering centerline, including zero for a straight channel.
- **Wall flare with height:** how much the gap's half-width widens per vertical meter.

These controls regenerate the actual XYZ SDF and clear sculpting, fracture edits, loose material and erosion state. They are not view-only adjustments or a switch to a heightmap. Caves, undercuts, the bounded bed and other CSG features remain. The nominal gap is modified by existing noise and cavities; extreme settings can remove much of a wall. Badlands and Monument valley keep their own formation rules and hide these canyon-specific controls.

The water footprint and GPU river centerline use the same canyon settings. The separate river-current half-width remains an independent transport control. The common centerline is:

```text
center(z) = meander × (2.5 sin(0.15 z) + sin(0.36 z + 1)) + riverOffset
```

The terrain's base curve does not use the optional riverOffset: that control deliberately shifts the guided river/water relative to the carved canyon. The terrain gap and water width follow canyonWidth and canyonFlare. As before, the other presets use a bounded pond footprint rather than a canyon-width mask.

## Surface rendering

`src/water-shader.js` is inserted into the **active WebGL2 fragment shader**. Old WGSL source remains inactive. The renderer's original seven-vec4 camera interface is unchanged; four additional named vec4 uniforms carry the water/canyon settings.

### Waves and intersections

Four differently oriented waves use non-commensurate frequencies, phase offsets, seed-dependent low-frequency world-space noise and a time-evolving phase warp. Their coordinates bend with the channel. This avoids a visibly repeated wave tile: there is no periodically wrapped water UV or repeating wave texture.

Wave height affects the **ray/surface intersection**, not just a normal map. Eight bracketed Newton/bisection iterations intersect the displaced surface between its bounded high and low planes. Primary slopes are analytic and include the canyon bend; the small low-frequency warp's derivatives are omitted. Fine procedural ripples add normal detail without adding geometry. Height is bounded by `min(requestedHeight, wavelength × 0.15)` to limit very steep short waves and stabilize intersection.

This is a bounded procedural water surface, not an SDF fluid volume, FFT ocean, pressure projection, shallow-water solver, or dynamically conserved free surface. Near-horizontal rays are culled below an absolute vertical direction of 0.025; very grazing views and short/steep waves are approximations. The erosion solver continues to use the mean water level, not individual wave crests.

### Refraction, reflection and lighting

The water uses RGB exponential depth absorption, shallow-bed transmission, a deeper green tint, Fresnel reflection and sun glints. Two short terrain-only ray marches (up to 28 samples each) provide bed refraction and bank reflections from the current SDF. They include edits/fractures through the normal terrain material evaluation. Reflections do not recursively render other water, sky reflections remain analytic, and rays that miss their bounded budget fall back rather than claiming perfect mirror geometry.

Clarity changes artistic absorption coefficients, not a calibrated physical turbidity measurement. In shallow water, exposed bed and the warm canyon's reflections can make the surface sandy/brown rather than uniformly blue. Raise Water level to cover exposed bed peaks if a continuous river surface is wanted. Reflections and refraction do not allocate screen-space history buffers or read pixels back to the CPU during rendering.

### Foam without a foam tile

Foam is synthesized from world-space noise at several independent scales with domain warping and continuous flow advection. No foam image, periodic UV reset, or recycled foam tile is used. The current SDF determines rock proximity. A vertical-distance-gradient test reduces foam over a flat shallow bed, preserving broken foam near banks/obstacles instead of producing a uniformly white river. Shallowness/current and steeper crests contribute smaller amounts. Coarse patches, porous edges and fine shading form the visible foam; foam coverage zero disables it.

This is procedural **shading**, not a persistent foam-particle/density simulation. It has no foam mass budget or physically modelled bubble lifetime. Foam follows the guided channel coordinates, not a pressure-derived local eddy field, and it does not produce vessel wakes. The separate erosion-agent sediment plumes are unchanged.

## Export, cost and verification

All controls are included in the existing exported settings object; baked canyon geometry remains in the usual `.frontier` volume payload. The water is procedural metadata/shading, not a triangle mesh embedded in the export. No texture assets, external services or WebGPU were added.

Extra wave evaluations and short SDF optical rays cost fragment work only where the water can be visible. Rendering still uses the existing adaptive pixel budget. No native-device FPS claim is implied by SwiftShader tests.

Unit tests verify monotonic gap opening, bounded-bed preservation, independent meander/flare behavior, matching centerline derivatives, finite water uniforms, steepness bounds and exported settings. Browser tests verify animation while simulation remains at zero steps, nonzero foam/optics pixel effects, opaque rendering from an extreme view, actual SDF changes after the spacing slider, live water controls and responsive layout. Existing erosion, camera, fracture, export and recovery tests remain part of the regression suite.
