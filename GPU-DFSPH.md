# Experimental DFSPH comparison and larger containers

Open **GPU Fluid Preview, port 8005** (`gpu-fluid.html`). Select **Water** in the outliner, then toggle **Use DFSPH · experimental** at the top of the inspector.

- **Off (default):** existing WCSPH pressure solver.
- **On:** experimental DFSPH-style velocity-divergence and predicted-density constraint solves, all on the GPU.
- Every toggle resets the water and duck to the same initial state, clears the active jet, and preserves material, footprint, particle budget and rendering settings. It preserves the current play/pause state.
- The checkbox survives resizing and particle-budget changes. The footer identifies the active solver.
- **Measure GPU & save JSON** measures the selected solver, resets the scene and pauses afterward. It reports the selected mode, raw GPU timings, actual density estimates and DFSPH constraint residuals. The explicit pressure coefficient is reported but is **unused in DFSPH**.

The original pond and its seven shared source files remain unchanged. This work is confined to the separate GPU edition and its tests/docs.

## What is implemented

This is an experimental implementation of the two DFSPH constraint solves, not a drop-in port of the reference implementation and not a claim of engineering-grade incompressibility. The existing poly6 density kernel, contact projections and approximate solid-boundary support are retained.

For each fixed substep:

1. Build the spatial grid, density estimates and accepted-neighbor cache, as before.
2. Compute the normalized density gradient and inverse diagonal factor:
   `alpha_i = 1 / (|sum_j g_ij + g_boundary|² + sum_j |g_ij|²)`.
   Here `g_ij = (mass / restDensity) * gradient(poly6)`; near-singular factors are disabled.
3. Initialize working velocities, then perform **4 divergence iterations**. Each iteration computes nonnegative Jacobi multipliers from positive density rate and applies the velocity correction in a separate dispatch. A 0.5 relaxation factor is used. Divergence correction is disabled for particles with fewer than 20 neighbors, a free-surface deficiency heuristic.
4. Apply gravity, jet, viscosity, cohesion and XSPH explicitly. The WCSPH equation-of-state pressure term is zero in this branch.
5. Perform **8 density iterations** on the positive predicted excess:
   `max(0, density/restDensity - 1 + dt * densityRate)`.
6. Record linearized residuals, then advect positions and apply the same wall, rock and kinematic duck contacts as WCSPH.

The density-rate evaluation includes derivatives of the same approximate plane/body/rock support used by the density estimate, including moving-body velocity. It does not add a calibrated boundary-particle model. The duck head remains a contact proxy without a separate density-support term, as in the original solver.

The multiplier dispatch reads working velocities; the correction dispatch reads neighbor multipliers and only its **own** working velocity. There are no in-place neighbor-velocity read/write races. Positions and neighbor lists remain fixed throughout each substep's iterations. Overflow beyond the 96-neighbor cache still traverses the original grid lists; the existing 256-visits-per-cell emergency limit remains, with truncation diagnostics.

A single extra 16-byte-per-particle storage buffer holds factors, multipliers and diagnostics: 96 KiB at 6,144 particles, 375 KiB at 24,000. The compute pipeline uses eight storage bindings, within WebGPU's default limit. The original WCSPH branch still has four dispatches per substep; DFSPH has 31.

**Not implemented:** adaptive convergence stopping, warm-started pressure multipliers, larger adaptive timesteps, two-way rigid-body coupling or a new free-surface/boundary model. The timestep remains the same in both modes. Those omissions are important: this first DFSPH experiment is not faster merely because DFSPH can support larger timesteps in other implementations.

Reference: [DFSPH, Bender & Koschier (2015)](https://www.vci.rwth-aachen.de/publication/054/). The implementation above adapts the principle to this application's existing kernels and boundaries.

## Python-measured A/B

`benchmarks/dfsph-study.py` drives the actual checkbox via Playwright and uses WebGPU timestamp queries. Three alternating-order pairs, three warmups plus nine samples per run: **27 samples per solver**. Both use Water material, 6,144 particles, a 7.5 × 5 m footprint, Balanced rendering, and eight 2 ms substeps per frame. Same simulated time, not a larger timestep for one solver.

**Adapter: SwiftShader software WebGPU. These are not GTX/RTX timings.**

| Work | WCSPH median | DFSPH median | DFSPH / WCSPH |
|---|---:|---:|---:|
| Compute | 159.31 ms | 572.67 ms | **3.59×** |
| Rendering | 353.66 ms | 349.21 ms | 0.99× |
| Whole submitted frame | 519.99 ms | 927.64 ms | **1.78×** |

Independent medians need not sum. This experiment is **slower**, not a performance upgrade. Measure on your own device before drawing hardware conclusions. Raw reports: `benchmarks/results/dfsph-frame-{wcsph,dfsph}-{1,2,3}.json`; aggregate: `dfsph-summary.json`.

### Density and behavior: improvements and limitations

At the end of the first matched 960-step / 1.92-second moving-duck-plus-jet test:

| Last density estimate | WCSPH | DFSPH |
|---|---:|---:|
| Maximum positive excess | 36.87% | 0.0296% |
| P95 positive excess | 14.73% | 0.00217% |
| Mean density / rest density | 1.001 | 0.881 |

Both stayed finite, in bounds and outside colliders at every twelve-step readback; no emergency speed caps, invalid-state resets or neighbor truncations were reported. Raw exploratory trajectories are `dfsph-stress-False.json` and `dfsph-stress-True.json`; the later complete validation is in `dfsph-validation.json`.

**Lower positive excess is not proof of realistic or volume-preserving water.** DFSPH also produces more under-dense regions: the mean falls below one. Unilateral constraints, coarse free surfaces, initial relaxation and approximate boundaries all matter. Motion/energy differs between solvers, and this implementation may expand or lose motion. The new control is deliberately an experiment the user can inspect, not a promise that the entire gelatin problem is fixed.

`densityError` is an SPH density estimate before the last integration step, including approximate boundary support. `constraintDiagnostics` reports the **linearized pre-contact** predicted-density residual after the fixed iteration budget. It is not post-advection geometric volume error. The final density correction can reintroduce local positive divergence; its diagnostic is reported too. No residual threshold currently guarantees convergence. After reset, diagnostics are marked unmeasured.

## Larger containers: no fixed upper footprint

The previous **14 m width / 10 m length cap is removed** from both HTML and the solver. Type a custom size or use the new 30 × 20 and 100 × 100 presets. Minimum dimensions remain 5 × 3.4 m to accommodate the existing fixed colliders.

Practical safeguards remain, rather than pretending finite GPU resources are unlimited:

- Finite, representable numeric dimensions are required.
- The grid must fit the actual device's storage-buffer and dispatch limits.
- Invalid or unaffordable requests show an explanatory message and keep the existing solver, water and viewport intact; dimensions are not silently clamped.
- Camera near/far planes and ray background range scale with the footprint; the previous fixed 100 m invalid-position guard now scales with the domain.
- Containment height grows beyond 3 m when necessary for particle spacing. The visible rim scales with it and the active height is shown in the inspector.
- Particle count stays fixed. Bigger footprints become coarser and can have sparse/shallow coverage. Spacing is also constrained by the narrow dimension of extreme aspect ratios. Unlimited size input does **not** mean unlimited resolution or equal realism.

## Validation

`benchmarks/dfsph-validate.py` exercises the actual browser and GPU:

- Both solvers: 960 steps each, moving duck and jet, all 80 batch-boundary readbacks checked.
- DFSPH at 30 × 20 m for 120 steps, 100 × 100 m for 48, and 300 × 200 m for 24; finite, contained, no reported emergency guards.
- 12,000- and 24,000-particle DFSPH smoke tests.
- One-step DFSPH cached-neighbor versus forced full-traversal comparison, including natural 128-particle overflow. Latest max position difference: 2.39e-7 m; max velocity difference: 1.52e-5 m/s. All 128 overflow particles used fallback.
- Checkbox reset/on/off, mode preservation across resize, absence of HTML maximum attributes, safe rejection of an excessive aspect ratio, downloaded DFSPH report, and mobile layout.
- 27 CPU seed/size combinations, including 300 × 200 m.

An initial **24-step** cache-versus-full-traversal comparison exceeded the inherited WCSPH velocity tolerance (about 0.0434 m/s while position error was below 0.000090 m). The one-step comparison isolates the interaction math; it is **not** a claim of long-trajectory bitwise equivalence. Iterative corrections and contacts can amplify floating-point order differences. The longer stability runs are separate checks.

These tests do not establish long-duration stability at arbitrary sizes. Start with the default basin, compare motion, then enlarge it.

## Reproduce

With the preview on port 8005, Python Playwright installed and a configured Chromium:

```sh
# Use a native browser without --software for your own GPU.
python benchmarks/profile.py --mode frame --variant optimized --water \
  --output benchmarks/results/my-wcsph.json
python benchmarks/profile.py --mode frame --variant optimized --water --dfsph \
  --output benchmarks/results/my-dfsph.json
```

The sandbox scripts intentionally use software Vulkan:

```sh
export VK_ICD_FILENAMES=/tmp/vk_swiftshader_icd.json
export LD_LIBRARY_PATH=/tmp:/tmp/al2023/lib
export CHROMIUM_PATH=/tmp/chromium
/home/user/.venv/bin/python benchmarks/dfsph-study.py
/home/user/.venv/bin/python benchmarks/dfsph-validate.py
node tests/gpu-tub.test.mjs
```

The `/tmp` paths are sandbox-specific, not requirements for normal users. See `GPU-OPTIMIZATION.md` for the earlier optimization history.

### Smaller particle options

Water → **Particle size / detail** now includes 48,000 and 96,000 particles, with physical collision diameters shown in centimetres for the current footprint. The DFSPH checkbox is preserved when changing size. Both new budgets passed 12-substep GPU smoke tests in both solver modes; no long-duration or real-time performance claim is made for them. See `GPU-FLUID.md` for the size table and cost/volume caveats.
