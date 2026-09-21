# Flux — Fluid Playground

A browser-native 3D fluid laboratory built with TypeScript, Three.js, and WebGL 2. The liquid is simulated and rendered live—no pre-rendered simulation, video loops, or remote API. Physics and reconstruction analysis run on the **CPU**; the GPU renders the liquid.

## New in 0.3

- **Surface tension and wetting:** Akinci-style cohesion/repulsion, surface-normal differences and volume-weighted solid adhesion replace the old linear attraction.
- **Boundary-aware pressure:** sampled basin walls and an optional sphere contribute to density and constraint gradients. Adaptive PBF iteration budgets expose final mean/peak compression and report unmet targets.
- **Shear-/temperature-dependent viscosity:** local velocity-gradient fitting, a bounded Carreau thinning law and an Arrhenius temperature shift feed the implicit viscosity solver. Chocolate defaults to strong thinning at 40°C.
- **Sampled boundary viscosity:** stationary solid samples contribute symmetric positive matrix blocks instead of the previous distance-only wall penalty.
- **Three experiments:** a pouring basin, a reduced-gravity wetting drop and a zero-gravity suspended drop. All changed parameters remain visible and adjustable.
- **Diagnostics:** measured compression, pressure passes, neighbor overflow, local apparent-viscosity range, mean shear rate, viscosity iterations/residual, actual boundary samples and separate CPU timings.

Read [the research notes](docs/RESEARCH.md) for references, equations, test coverage, adaptations and limitations. These are browser-sized research adaptations, not calibrated material measurements or complete paper reproductions.

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Open the Vite URL (port 5173). The dev server binds to `0.0.0.0` and allows Arena's `.e2b.app` preview hosts. Browser code uses the same origin; no backend is needed. Fonts are bundled locally.

```sh
npm run build       # TypeScript validation + production build
npm test            # 37 numerical / physics / reconstruction tests
npx playwright install chromium
npm run test:e2e    # seven browser interaction / rendering / responsive tests
```

Set `CHROMIUM_EXECUTABLE=/path/to/chromium` to use an existing browser binary. Browser tests use software WebGL; their frame rates do not represent consumer GPU performance.

## Try the upgrades

1. **Wetting:** select *Wetting drop* in the viewport's upper-left. Compare Wall Wetting 0 and 2, resetting between trials. This experiment explicitly uses gravity **1 m/s²** and surface-tension scale **0.080** to make capillary behavior visible at the coarse scene scale.
2. **Droplet shape:** select *Suspended drop*. Gravity is **zero**. Compare surface tension on/off, resetting to the same elongated drop each time.
3. **Solid interaction:** in *Liquid basin*, scroll to **Boundaries & pressure**, enable **Sphere obstacle**, and optionally show solid samples.
4. **Pressure accuracy:** compare Fast / Balanced / Precise targets. Read actual mean and peak compression; `BUDGET LIMIT` means the target was not reached.
5. **Chocolate:** select Chocolate, then compare prescribed temperatures of 20°C and 60°C under **Material response**. Reset for matched trials; inspect the effective-viscosity and shear-rate readouts. The model does not simulate solidification or melting.
6. **Surface A/B:** pause and switch Rendering → Reconstruction between **Anisotropic** and **Spheres**, preserving exactly the same physics state.

Material selection changes presets without resetting particle motion. Reset preserves the current experiment/settings. Reset Scene Controls restores the default water basin.

## Other controls

- Water, milk, honey, and chocolate optical/motion presets.
- Pour, pause flow, stir, pause/resume simulation, reset, orbit, zoom, grid, camera reset, fullscreen.
- Surface, actual simulation particles and surface-normal inspection views.
- Real frame history, particle count, simulation clock and five-second local benchmarks.
- Viewport PNG and JSON configuration export, including new material/boundary settings and diagnostics. JSON is **not** a restorable simulation checkpoint; no import is implemented.
- Space: pause/resume. R: reset. S or double-click viewport: stir. Drag: orbit. Scroll: zoom.

The basin starts with 1,440 particles; drop experiments use 227. Pouring stops at 2,800. Reset to pour again. The UI advances fixed 1/60-second steps, at most two per frame: slow devices run in slow motion instead of taking unstable oversized steps.

## Architecture

| Module | Responsibility |
|---|---|
| `src/physics.ts` | CPU 3D spatial hashing, PBF projection, density diagnostics, collisions, local gradient fitting, vorticity and integration |
| `src/boundaries.ts` | Static surface sampling, normalized pseudo-masses and fluid/solid neighbor search |
| `src/surface-tension.ts` | Symmetric cohesion/normal-difference forces and solid adhesion |
| `src/rheology.ts` | Carreau response, Arrhenius temperature shift and strain-rate helpers |
| `src/viscosity.ts` | Matrix-free implicit radial SPH viscosity, variable pair coefficients and stationary-boundary blocks |
| `src/reconstruction.ts` | CPU weighted covariance/PCA, bounded ellipsoid axes and render-only center smoothing |
| `src/renderer.ts` | WebGL 2 ellipsoid depth/thickness, bilateral smoothing, reconstructed normals, refraction, absorption, studio Fresnel reflection and FXAA |
| `src/main.ts`, `src/style.css` | Responsive UI, timing, controls, experiments, exports, live diagnostics, documentation and benchmarks |

The renderer needs WebGL 2 with `EXT_color_buffer_float`. Unsupported browsers receive an explanation rather than a fake simulation fallback.

## Validation

Numerical tests cover all four fluids staying finite/bounded under pouring and stirring, sphere nonpenetration, boundary pseudo-mass normalization, pressure-error reduction, overflow reporting, capillary pair-force cancellation, droplet rounding, matched wetting/spreading, affine shear recovery, the Newtonian limit, warming/thinning response and cold-chocolate stress cases.

The isolated implicit-viscosity tests check an analytical pair solution, translation/rotation invariance, dissipation, momentum conservation and timestep refinement. Reconstruction tests check non-mutation of physics state, principal-axis orientation, bounded aspect ratios and nominal volume normalization. These tests are **not** comprehensive validation against measured fluids.

## Scope and honest limitations

**This remains a prototype, not an AAA engine or evidence that it surpasses Unreal Engine.** There is no engine-to-engine benchmark, fixed performance guarantee or WebGPU backend.

- Physics and PCA analysis run on the CPU; particle counts are deliberately modest.
- Surface tension, wetting and base viscosity are uncalibrated solver coefficients—not N/m, contact-angle degrees or Pa·s.
- Temperature is a prescribed uniform value. There is no heat equation, latent heat, melting, crystallization, tempering or thermal expansion. Cold chocolate remains a fluid in this model.
- Carreau thinning has no true yield-stress threshold or thixotropic memory. Named materials are qualitative presets, not measured product recipes.
- Pressure projection remains PBF. Fast/Balanced/Precise target 6%/3%/1% peak positive density error within 3/6/12 passes; these targets are not guaranteed.
- The basin and sphere are stationary, one-way-coupled solids. No arbitrary mesh/SDF input, moving rigid bodies, two-way coupling or spill-out over the rim is supported.
- Fixed capacities, bounded neighborhoods/iterations, explicit capillary-force limiting and velocity/displacement caps prioritize robustness over unrestricted physical accuracy.
- Surface reconstruction and optics are screen-space approximations. Blobby silhouettes, overlap artifacts, incorrect transparent-object ordering and thin-sheet undersampling remain possible. No exact combined-surface volume, caustics, multiple scattering or path tracing.
- No physically modeled foam, thermal transport or multiplayer determinism.
- Benchmarks measure CPU work and browser frame intervals, not GPU execution time. Keep the tab visible and compare identical settings on named hardware.

## Next research milestones

Calibrate surface tension/contact angles and rheology against experiments; test hydrostatic/divergence error; improve capillary timestep selection and nonlinear viscosity convergence; add thermal transport and phase behavior; moving/two-way solid coupling; worker scheduling and profiling; temporal surface reconstruction and physically motivated spray/foam. Details are in [the research notes](docs/RESEARCH.md).
