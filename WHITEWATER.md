> **Superseded implementation notes.** The particle-based surface foam described below was replaced after feedback about realism and performance. The current `whitewater.html` uses an advected coverage field. See [FOAM-FIELD.md](FOAM-FIELD.md) for the actual current algorithm, research, controls, measurements and limitations. The notes below document the previous iteration only.

# Whitewater Lab — separate dark edition

**Entry point: `whitewater.html`.** The original `index.html`, `style.css`, `app.js`, numerical solver, floating-body module, material shaders, and pond configuration are unchanged. The new page imports the existing stable physics and Three.js modules read-only; it has its own application script, dark stylesheet, and secondary-effect modules.

## Run

Use the existing server and navigate to `/whitewater.html`, or run:

```sh
python3 preview-whitewater.py --port 8002
```

This dedicated preview serves the new page at `/` and the original at `/index.html`. It does not replace or rename the original HTML. HTTP is required for browser ES modules; no npm install/build is needed.

## What to try

1. One opening splash demonstrates the particle layer. It is **not** a continuous source; it will settle and expire.
2. Click **Make a splash** for another burst, or select **Splash / 5** and click or drag on the water.
3. Use **Move duck / 4** to create a foamy wake with small spray droplets.
4. Pause with Space: the water, foam, spray, and crowns all pause.
5. Toggle surface foam, airborne spray, splash crowns, and crest emission independently.
6. Adjust emission amount, the lifetime of **new** foam, and the 2,000 / 6,000 / 12,000 particle budget.
7. **Clear foam & spray** removes the effects and queued splashes, without clearing the water's waves. If crest emission is still enabled, energetic existing waves can emit again after resuming.
8. Resizing/resetting the pond also resets its effects. Material presets, pond dimensions, optics, snapshots, and the original interaction tools remain available.

The header's **Original pond** link opens the unchanged first version.

## Research and design choices

### Heightfield + secondary particles

Thürey, Müller-Fischer, Schirm, and Gross describe a real-time extension to heightfields: detect steep wave fronts, generate connected particle sheets, and turn impacts into drops and foam. Their approach motivates keeping the efficient surface simulation and adding a bounded 3D secondary layer rather than replacing the entire pond with a volumetric solver. **Source:** [1](https://matthias-research.github.io/pages/publications/breakingWaves.pdf).

The related *Real-time Simulations of Bubbles and Foam within a Shallow Water Framework* combines a shallow-water representation with particle-based bubble/foam simulation and describes finite bubble lifetimes and surface foam. **Source:** [5](https://cgl.ethz.ch/Downloads/Publications/Papers/2007/Thue07a/Thue07a.pdf).

**Implemented here:** ballistic droplets, foam attached to the sampled surface, a finite particle lifecycle, and short-lived procedural splash crowns. **Not implemented:** the papers' connected-particle breaking-wave reconstruction, SPH bubble interactions, or complete two-way fluid/solid coupling.

### Source criteria, aging, and bounded density

SideFX describes whitewater emission using criteria such as acceleration, curvature, and vorticity; gravity affects spray, while foam is advected near the surface. It also describes aging and limiting emission using existing particle density. **Sources:** [3](https://www.sidefx.com/docs/houdini/news/20/fluids.html), [5](https://www.sidefx.com/docs/houdini/fluid/whitewater).

**Implemented here:** explicit splash/duck sources, plus a motion-and-shape proxy for active crests. This pond only has height and vertical velocity, so it does **not** claim to have a full horizontal flow field or vorticity-based emission. Local occupancy, cell cooldowns, hard capacity, and finite lifetimes limit accumulation.

### Rendering cost

GPU Gems 3 discusses particle fill-rate cost, reduced-resolution particle buffers, and depth-based soft particles. **Source:** [1](https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-23-high-speed-screen-particles).

For this smaller browser effect, the implementation uses **instanced geometry in the main pass** instead: at most one draw for combined foam/spray and one for the crowns. It uses normal depth testing, transparent blending, and no depth writes. It does **not** implement the chapter's offscreen upsampling or soft-depth intersection technique. Those would be useful future improvements for much larger spray clouds.

## Implementation

### Emission

- Splash requests are queued, capped at eight, and rate-limited to one per 0.22 simulated seconds. Each accepted request adds a bounded primary wave impulse and a separate particle burst.
- A burst emits droplets in an outward/upward distribution, some surface foam, and optionally one crown.
- Duck wake emission is tied to the existing body's wake events, not to rendered frame count.
- Crest probing happens every 0.08 simulated seconds on a fixed **0.38 m** probe lattice, independent of water mesh refinement.
- Probes require vertical speed above 0.12 m/s, slope above 0.16, and curvature magnitude above 0.65. Faster rising regions may emit spray. These thresholds are heuristics for this toy scale, **not measured breaking-wave criteria or Weber-number thresholds**.
- Each source cell has a cooldown; occupied foam cells suppress further local emission.

### Spray → foam

Spray integrates gravitational acceleration (9.81 m/s²) and exponential air drag on the same fixed substeps as the water. Downward-moving droplets that meet the sampled surface convert into foam. They inherit reduced horizontal momentum, get a new finite lifetime, and then drift and fade.

Foam follows water height and surface orientation. Horizontal movement uses a bounded local phase-motion proxy derived from height gradient and vertical velocity, blended with inherited splash momentum. This is **not advection through a solved horizontal liquid velocity field**.

Spray outside the wet footprint is culled. Foam stays inside banks and avoids the existing circular rock masks. This is not a full 3D rock-collision or submerged-bubble simulation.

### Splash crowns

A crown is a temporary instanced annular sheet with a fluted rim. Its rise/fall follows an analytic envelope and expires after 0.75 simulated seconds. It is **visual geometry**, not a solved liquid sheet, not volume-conserving, and not an overturning-wave mesh. Disabling crowns leaves spray and foam available.

### Rendering

- Foam uses surface-oriented quads with procedural clustered bubble-ring coverage and lifetime fading.
- Spray uses camera-facing, velocity-stretched droplet impostors with translucent bodies and highlights.
- Both kinds share one dense instanced particle buffer. Removing a particle swaps in the last live slot, avoiding array compaction/allocation each step.
- Materials use a slightly warmer foam tint for dirty/swamp water.
- The effects are omitted from the pond's offscreen reflection/refraction passes to keep cost bounded. They have main-scene depth occlusion but do not cast shadows or produce accurate reflections of every droplet.
- Transparent instances are not individually depth-sorted. Dense overlaps and intersections are approximate. The particles are not refractive spheres or a volumetric multiple-scattering foam model.

## Stability and performance boundaries

`whitewater-core.mjs` only **reads** the water solver. Particle landing, foam motion, and crown expiration do not inject water energy. Only explicit primary splash actions, and the pre-existing controlled duck/automatic-ripple sources, disturb the wave solver. This avoids a feedback loop in which secondary particles create increasingly energetic waves and further particles.

All effect ages, emission cooldowns, and integration use the existing fixed simulation clock. Pausing freezes the whole layer; under rendering load, effects slow together with simulation time instead of taking an oversized step.

The default budget is 6,000 particles, with an absolute pool capacity of 12,000 and at most 16 crowns. New emissions are dropped when the selected budget is full. This bounds memory and live-particle work; it is not a guaranteed frame rate on every device. Browser GPU support, resolution, and the existing reflection/refraction passes still matter. CPU simulations and instanced rendering are used here, not a GPU compute fluid solver.

## Verification

```sh
node tests/whitewater.test.cjs
node --input-type=module --check < whitewater-app.js
node --input-type=module --check < whitewater-render.mjs
```

Numerical tests cover:

- Quiet water and stationary mounds do not emit spontaneously.
- Spray lands as foam; crowns and particles expire.
- Particle/crown budgets and effect toggles are enforced.
- Active crests produce secondary particles.
- Whitewater does not modify the water height or velocity arrays.
- Identical scripted whitewater and water states at 30, 60, and 144 rendered FPS.
- Finite state, wet-footprint containment, and reset behavior.

Browser checks covered the dark page, synchronized particle/water stepping, pause, clear without changing water energy, class toggles, landing transitions, budget/lifetime controls, resize/reset, PNG export, and a 390 px mobile layout. No runtime or shader errors were observed. The original light page was also reopened successfully. SHA-256 comparisons verified that the seven original entry/style/app/physics/material/config files remained unchanged.

## New files only

- `whitewater.html` — second entry point, controls, counters, help
- `whitewater.css` — dark overrides; imports the original stylesheet without modifying it
- `whitewater-app.js` — separate scene/controller integration
- `whitewater-core.mjs` — bounded deterministic particle simulation
- `whitewater-render.mjs` — instanced particles and procedural crown rendering
- `preview-whitewater.py` — optional dedicated preview server
- `tests/whitewater.test.cjs` — numerical tests
- `WHITEWATER.md` — research, implementation, and limitations
