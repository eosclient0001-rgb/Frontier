# Ripple — Water garden & material lab

An interactive **resizable pond** (initially 12 × 8 m), rendered in 3D and simulated as a 2D wave surface. Inspired by the pond in [80 Level's article about Blenderesse / Jesse Miettinen and Seanterelle](https://80.lv/articles/2d-fluid-simulation-made-with-blender-s-geometry-nodes).

## What's included

- A rectangular basin with **width 8–20 m and length 6–14 m** controls. Apply dimensions rebuilds the basin and grid rather than stretching them.
- A draggable rubber duck with damped buoyancy, slope-following tilt, heading, inertial drift, and bow/stern wakes.
- Five water materials: **Clean water, Ocean water, Swamp water, Puddle, Dirty water**.
- Real scene reflection/refraction passes, depth-dependent attenuation, surface roughness and turbidity controls.
- Floating lilies, blossoms, reeds, rocks, rain, manual ripples, and a mesh inspection mode.
- Slope-triggered numerical refinement and conservative CFL-limited time steps.

All scene geometry and textures are procedural. Three.js and required helpers are vendored with their MIT license; no build or npm installation is needed to run the application.

## Run

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

Open the server on port 8000 in a modern WebGL2 browser. **Use HTTP rather than `file://`** because the application uses ES modules. Optional Google Fonts fall back to system fonts when offline.

## Controls

- **Orbit / 1:** drag to rotate; scroll or pinch to zoom.
- **Ripple / 2:** click or drag on the water.
- **Move lily / 3:** drag a leaf; its spring tether returns it toward its anchor.
- **Move duck / 4:** grab the yellow duck and drag across the water. Release it to coast and see its wake. The duck turns toward its direction of travel.
- **Reset duck:** return only the duck to its starting position.
- **Pond dimensions:** set Width and Length, then Apply dimensions. The water and floating objects reset; material and optical controls are preserved.
- **Automatic ripples & wind:** off by default. Switch on for recurring disturbances and shader motion; switch off to let waves settle. Choosing Gentle ripples or Rain explicitly enables it. Still water disables it.
- **Space:** pause/resume. **R:** reset the whole pond. Form controls and the help dialog take precedence over shortcuts.
- Select a **water material** in the inspector. Changing materials preserves waves, object positions, and the camera.
- Adjust **surface roughness** and the **turbidity multiplier** independently. Selecting a material restores that material's optical defaults.
- Water-level, wave-speed, damping, splash-strength, resolution, mesh, lilies, camera reset, fullscreen, and PNG snapshot controls remain available.

## Water optics

The water shader is physically informed rather than a flat tint. The rendering pipeline is:

1. Render the scene from a mirrored camera into a planar reflection texture, with an oblique clip plane to remove geometry below the mean water surface.
2. Render scene color and depth from the viewer, clipping geometry above the mean water plane. This supplies a real lit bed and submerged geometry without duplicating above-water objects in refraction.
3. Render the displaced water surface. Apply Snell's law using **IOR 1.333** to refract the view ray toward the known planar bed. Project that location into the scene-color buffer, with a depth guard against invalid foreground samples.
4. Apply **Beer–Lambert transmission** `exp(-(absorption + scattering) × optical path length)` per linear RGB channel. Approximate in-scattering with a preset asymptotic water color.
5. Blend transmission with reflection using **Schlick Fresnel**, derived from IOR (normal-incidence reflectance approximately 2%). Use **Cook–Torrance GGX / Smith** for direct sunlight specular response.
6. Apply roughness-dependent reflection filtering, then tone-map and encode the final image. Offscreen passes remain linear.

| Preset | Main differences |
|---|---|
| Clean | Low scattering; mild wavelength-dependent attenuation; visible pebble bed; crisp reflections |
| Ocean | Stronger red absorption; blue-green scattering; wind/capillary-scale shading detail; broader glints |
| Swamp | Tannin-like absorption; green/brown scattering; patchy procedural algae film |
| Puddle | Bed raised to 6.5 cm below the mean water level; low roughness; shallow transmission over wet stone |
| Dirty | Strong sediment-like scattering; brown backscatter; reduced bed visibility |

### Optical limits

These presets are **representative artistic coefficients, not measured spectral samples**. “Ocean,” “swamp,” and “dirty water” are not unique optical substances. Exact appearance depends on particle populations, dissolved matter, illumination, depth, and wavelength.

Reflections use the mean water plane plus normal distortion, not ray tracing of the displaced surface. Refraction intersects a known planar bed with screen-space sampling and a depth guard, not a full refracted-ray scene traversal. Screen-space normal derivatives broaden the specular lobe to reduce aliasing, and subpixel micro-normal detail is faded. Roughness filtering is a real-time approximation rather than a fully integrated microfacet environment BRDF. Scattering is single-pass and approximate, not volumetric multiple scattering. Caustic-like patterns, small-scale ocean normals, algae film, and duck contact-darkening are decorative shading approximations.

Puddle mode changes the **rendered bed depth**, not the numerical wave-speed model. Large waves can cross the shallow bed or basin coping; wet/dry fronts and overflow are not simulated. The scene is stylized, not a claim of photorealistic or calibrated underwater rendering.

## Duck coupling

`floating-body.mjs` contains a testable body model:

- Dragging sets a target; velocity responds smoothly with a 3 m/s target-speed cap.
- On release, drag damps motion and surface slope contributes a horizontal force.
- A damped spring follows sampled water height; the render model tilts toward the surface normal.
- While dragged, and for at most two seconds of coasting after release, distance-travelled triggers a bow mound and stern depression in the **actual solver height field**. Wakes propagate and reflect from banks and rock masks.
- Passive wave-driven bobbing does not create new wakes indefinitely. The finite wake tail prevents an unpowered body from continually feeding energy back into the water.
- Bounded substeps and a collision radius prevent the duck crossing banks or rocks.
- Pause freezes the body and solver. Reset cancels an active drag and resets buoyancy and wake state.

This is a lightweight coupled toy, **not a rigid-body pressure/displacement or volume-conserving buoyancy solve**. There is no mutual collision with lilies. The body does not become an impermeable dynamic solver obstacle; wake forcing approximates its interaction with the surface.

## Surface solver

`solver.mjs` integrates the damped linear wave equation:

```
h_tt = c² (h_xx + h_zz) − damping · h_t
```

Central differences on a rectangular, fixed-world-space grid and **velocity-Verlet with symmetric exponential damping** advance height and vertical velocity. Banks and two rock masks use reflecting boundaries.

Widening the pond adds columns rather than stretching the old mesh. At the initial 12 × 8 m size, base grids are **96 × 64, 144 × 96, and 192 × 128**. Changing dimensions recalculates both axis counts to keep the selected world-space spacing (approximately 127 / 84 / 63 mm), with small rounding differences. Horizontal and longitudinal spacing are nearly equal; the Laplacian and CFL bound account for their small difference explicitly:

```
dt ≤ min(1/90 s, 0.35 / (c · sqrt(1/dx² + 1/dz²)))
```

Maximum slope above 0.4 triggers approximately 1.5× base resolution along each axis; above 0.85 triggers 2×, up to **384 × 256** samples at the default size, with a **160,000-sample budget** across all pond sizes. Refinement stops at the budget rather than repeatedly reallocating the same capped grid. Height and vertical velocity are bilinearly resampled. The render mesh and timestep update together. Refinement remains until reset to avoid repeated resampling. It is global slope-triggered refinement, not a local adaptive mesh or strict error estimator.

Uniform water-level changes translate the surface without stretching its cells. Strong disturbances are bounded to ±0.55 m for robustness. A fixed-step accumulator retains leftover frame time. It never integrates the short remainder as a different-sized final step. The duck, its wakes, and automatic emitters advance on exactly the same fixed physics clock. At most 0.1 seconds / 32 steps are processed per rendered frame; excess backlog is discarded under load instead of taking an unsafe large step. Returning from a hidden tab resets the accumulator.

This is a surface-wave approximation, not a nonlinear shallow-water flux solver or volumetric fluid. It does not model horizontal bulk transport, breaking waves, overturning sheets, depth-derived wave speed, spray, or engineering-grade hydrodynamics. Remeshing and body forcing are not exactly energy- or volume-conserving. It does not implement or repair Blender's Geometry Nodes graph or production fluid solver.

## Verification

```sh
node tests/solver.test.cjs
node tests/pond.test.cjs
node tests/stability.test.cjs
node --input-type=module --check < app.js
```

### Spiky-water regression (v3.1)

The old integrator divided each animation frame into CFL-limited steps **plus a short remainder step**. A 192-row, 3 m/s, damping 0.05 case reached its ±0.55 m safety clamp after 45 simulated seconds at 60 FPS, while several other frame rates stayed bounded. Checking only finite values and bounds missed this failure: the clamp hid the growing high-frequency energy.

The regression suite now measures actual energy and clamp hits. With fixed-step velocity-Verlet, the same 45-second test has **zero clamp hits**, peak displacement below 0.30 m, and final energy about **10.5%** of the starting energy (consistent with damping). A coupled water/duck test produces **bit-identical numerical fields and body positions** at 30, 60, 75, 120, and 144 FPS, and with irregular frame durations. This comparison holds for scripted simulation-time input without refinement changes; it does not claim arbitrary real pointer events are frame-rate independent.

Additional tests cover long frame stalls, passive-bobbing wake suppression, all dimension/aspect-ratio extremes at every quality setting, fixed world-space spacing, and refinement budget enforcement. Browser checks exercised resizing to 20 × 14, 8 × 6, and 20 × 6 m, material/pause preservation, actual bed/grid dimensions, quiet startup/reset, and automatic ripple controls. Existing duck interaction, all material shaders, snapshot, and mobile checks passed again.

The numerical tests cover equilibrium, propagation, long-run damping, refinement/interpolation, timestep rejection, repeated disturbances, rectangular-domain sampling, duck wakes/coasting/containment/reset, and bounded optical transmission.

Browser smoke checks covered all five shader presets (distinct rendered output), a duck drag and release generating solver wakes, pause freezing the duck, body reset, optical overrides, PNG export, and a 390 px mobile layout without horizontal overflow. No JavaScript runtime or WebGL shader errors were observed. Material views were visually inspected. Headless software WebGL is slow and does not represent normal hardware-accelerated performance.

## Files

- `index.html`, `style.css` — responsive interface and in-app help
- `app.js` — scene, offscreen render passes, interaction, UI
- `solver.mjs` — rectangular numerical surface solver
- `floating-body.mjs` — duck motion and wake coupling
- `pond-config.mjs` — dimension bounds and spacing-preserving sample counts
- `water-materials.mjs` — optical presets and shader source
- `tests/` — dependency-free numerical tests
- `vendor/` — local Three.js modules and license
