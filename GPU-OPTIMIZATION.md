# Measured GPU optimization — Python / WebGPU

**Subsequent solver experiment:** [GPU-DFSPH.md](GPU-DFSPH.md) documents the implemented DFSPH checkbox, slower equal-timestep A/B results, density trade-offs and removal of the fixed container-size maximum. The stages below retain the history of the earlier WCSPH optimization work.

The live editor remains on **port 8005**, `gpu-fluid.html`. The original pond is unchanged.

## Measurement first

Python (`benchmarks/profile.py`, Playwright) drove Chromium, issued repeatable workloads and saved raw JSON samples. The times below come from **WebGPU timestamp queries**, not Python timers presented as GPU time. Python wall time is recorded separately.

**Important:** this sandbox exposes **Google SwiftShader, a software WebGPU adapter**. These measurements identify costs and regressions on this backend. They do **not** establish GTX/RTX hardware performance or a portable FPS multiplier. Browser/device information is stored in each result.

Workload: 6,144 particles, Large 7.5 × 5 m tub, Balanced rendering, 1300 × 850 browser viewport, **eight fixed 2 ms substeps per measured frame**. Both implementations use the previous material coefficients for the performance A/B, so lighter damping is not credited as a performance optimization. Three warmup frames precede nine samples per fresh browser launch. Three baseline/optimized pairs were run in interleaved order: 27 samples per version.

### First optimization round: before / after, same workload

Independent medians aggregated by `python3 benchmarks/summarize.py`:

| GPU work | Before | After | Time reduction |
|---|---:|---:|---:|
| Compute | 279.02 ms | 158.35 ms | **43.2%** |
| Rendering, stationary camera/solids | 462.59 ms | 387.66 ms | **16.2%** |
| Whole submitted frame | 741.61 ms | 551.52 ms | **25.6%** |

These large absolute times are software-adapter results, not the expected timings of a hardware GPU. Independent medians need not sum exactly. Raw runs and p95 values are in `benchmarks/results/*-paired-*.json` and `summary.json`; all three pairs are retained rather than selecting the best run.

A separate **moving-camera** check measured 773.58 → 644.55 ms per submitted frame (16.7% reduction). Rendering itself was approximately unchanged (479.22 → 483.33 ms, within this backend's run variability); the compute improvement still applies. This check matters because a cache that helps a static screenshot can hurt interactive motion.

## Latest follow-up: density search and compression diagnostics

The density stage became the dominant simulation kernel after the accepted-neighbor cache: a fresh diagnostic measured **15.65 ms density versus 3.80 ms integration** per substep. This round tested three approaches rather than assuming every rewrite would help:

1. **General cell-AABB rejection:** about 15.60 ms density in the first diagnostic, effectively unchanged. Rejected.
2. **32-entry compact cell bins with linked-list overflow fallback:** about 17.48 ms density in its exploratory diagnostic, plus more grid-build work. Not promoted. Source is isolated in `benchmarks/experiments/cell-bins/`, not imported by the app. These are exploratory software-adapter tests, not proof that compact grids cannot help native hardware.
3. **Precomputed stencil distances:** retained. For each particle, compute squared distances to its current cell's lower/upper faces once, then reuse the appropriate three scalars to bound each of the 27 candidate cells. Skip only cells whose closest possible point lies beyond the kernel radius, with a conservative floating-point margin. All potentially contributing particles, original visited-cell order, the 96-neighbor cache and its original overflow traversal remain in place. No new buffers or binding requirements are introduced.

### Repeated performance comparison

`benchmarks/density-study.py` alternates before/after order over three pairs; 27 samples per variant for both stage and full-frame tests. The reference is the pre-change WGSL in `benchmarks/pre-cell-bins/`; all other runtime code is shared. Same 6,144 particles, tub, timestep, rendering and previous-reference material on both sides. This comparison does **not** use the pressure experiment below.

| Metric | Before this round | After | Reduction |
|---|---:|---:|---:|
| Density pass | 15.93 ms | 13.63 ms | **14.5%** |
| Whole-frame compute | 171.51 ms | 164.89 ms | **3.9%** |
| Whole frame | 532.01 ms | 527.15 ms | **0.9% — small relative to run variability** |

The unchanged integration kernel also varied in timing. Do not attribute that entire difference to the stencil or claim a meaningful overall FPS increase from this round. Rendering remains the main whole-frame cost. These are **SwiftShader software WebGPU** results; they are not native GPU forecasts and must not be compounded with historical percentages.

Raw pairs: `benchmarks/results/density-{stages,frame}-{before,after}-{1,2,3}.json`; aggregate: `density-summary.json`. Overridden source hashes are recorded. The general profiler now supports `--source-dir` for compute-stage comparisons as well as rendering, and `--stiffness` for explicitly separate stage/physics experiments.

### Interaction and regression checks

The GPU comparison against the unpruned shader covered nine cases: 6,144 / 12,000 / 24,000 particles; compact, large, maximum and narrow tubs; particles within 1e-6 m of cell boundaries; a dense 128-particle overflow case; and a 120-step trajectory. Largest observed differences were **1.67e-6 m position**, **4.56e-5 m/s velocity**, and **0.00257 kg/m³ density**, consistent with floating-point accumulation/order variation. The dense case retained all 128 cache fallbacks. Raw checks: `density-equivalence.json`.

A **2,400-substep / 4.8 simulated-second** Water stress run passed containment, finite-state and solid-contact checks at all 200 twelve-step batch boundaries, with no reported neighbor truncations, speed caps or invalid-state resets. This is longer than the earlier short stress, but is not a long-duration stability guarantee. Existing GPU regression, high-count sanity cases, resized-tub checks, UI validation and original-edition checksums also passed. `benchmarks/regression.py` additionally tests the real benchmark-button download.

### What the gelatin investigation found

`inspect()` and the downloaded JSON now expose `densityError`: minimum/median/p95/maximum estimated density ratios, mean positive compression, tail compression, and particle counts above 1% and 5% excess density. Under-dense surface particles no longer cancel compressed particles in the **positive-compression** metric. A synthetic diagnostic fixture explicitly verifies this distinction.

These are **SPH density estimates, including approximate solid-boundary support**, not a measurement of actual geometric volume loss. Tags are from the final density solve *before* the last integration step; `sampleTime` identifies that time. Reset values are placeholders and are marked `measured: false`. Readback remains optional and outside measured GPU passes. The benchmark inspector shows the last-solve p95 and maximum excess; its export includes the pressure coefficient and all diagnostics.

At the current pressure coefficient **100**, the 4.8-second stress had a **worst sampled local excess of 59.4%** and a worst sampled mean positive compression of **6.85%**. The final overall mean density was only **1.025 × rest density**, which alone would obscure the local errors. The final p95 excess was **12.68%**. Values are sampled at batch boundaries; larger errors between samples are not ruled out.

A separate coefficient-**400** experiment kept the same timestep, viscosity, XSPH, geometry, gravity and forcing. It reduced the worst sampled local excess to **36.3%**, but final kinetic energy increased from approximately **2,254 to 37,758** in the solver's units (**16.8×**), and final mean density fell to **0.917 × rest density**. Both runs remained finite and contained. This is not a calibrated realism comparison: changing pressure also changes the response to initial and boundary density error. It does show why less positive compression alone is not sufficient to declare better water.

**The pressure-400 experiment is not the default and has no production UI preset.** Default pressure remains 100, viscosity 0.003, XSPH 0.004, cohesion zero. This round does not claim to fix gelatin motion. A density/divergence constraint solver with explicit convergence diagnostics and consistent solid-boundary treatment is the next architectural experiment, rather than simply increasing explicit pressure stiffness or timestep.

Stress artifacts: `density-water-stress.json`, `density-pressure400-stress.json`; diagnostic/unit/download checks: `density-regression.json`. The two physics tests are separate from the performance A/B.

Reproduce in the configured sandbox (same environment variables as the wall study below):

```sh
/home/user/.venv/bin/python benchmarks/density-study.py
/home/user/.venv/bin/python benchmarks/density-validate.py
/home/user/.venv/bin/python benchmarks/regression.py
/home/user/.venv/bin/python benchmarks/profile.py --chromium /tmp/chromium \
  --software --mode stages --variant optimized --water --stress-steps 2400 \
  --output benchmarks/results/my-water-stress.json
# Explicitly experimental; does not alter production defaults:
/home/user/.venv/bin/python benchmarks/profile.py --chromium /tmp/chromium \
  --software --mode stages --variant optimized --water --stiffness 400 \
  --stress-steps 2400 --output benchmarks/results/my-pressure400-stress.json
```

## Follow-up: batched wall intersections

The remaining surface pass was still the largest rendering stage (a fresh diagnostic measured 204.67 ms, versus 138.14 ms particle depth and 57.03 ms filtering). This follow-up replaces four sequential wall-box intersections with one four-lane slab test. The reciprocal ray direction is shared; only the closest surviving box gets a normal calculation. Original wall order, strict distance tie-breaking, colors and dimensions are preserved. This is **not** the earlier rejected wall-skipping shortcut: all four walls are still tested, for primary and refracted rays.

A frozen pre-change shader is in `benchmarks/pre-wall-batch/`. Python routes that shader only into the comparison browser; the live preview stays on the new implementation. `benchmarks/wall-study.py` runs three alternating-order pairs for each workload, with three warmups and nine samples per run (**27 samples per variant per workload**). All other runtime sources, material settings, particle counts, timesteps and render resolutions are the same.

| Follow-up metric | Previous optimized renderer | Batched walls | Reduction |
|---|---:|---:|---:|
| Surface pass, separate stage test | 196.04 ms | 173.24 ms | **11.6%** |
| Stationary rendering, frame test | 403.93 ms | 374.41 ms | **7.3%** |
| Stationary whole frame | 578.94 ms | 552.36 ms | **4.6%** |
| Moving-camera rendering | 470.15 ms | 450.84 ms | **4.1%** |
| Moving-camera whole frame | 635.61 ms | 633.11 ms | **0.4% — effectively unchanged** |

These are again **SwiftShader software-adapter measurements**, not hardware GPU results. Compute code is untouched. In the moving-camera runs, compute medians varied by +6.8%, offsetting most of the rendering gain. The initial single-run surface improvement was larger than the repeated aggregate; the table reports the aggregate, not that best-looking result. Do not compound these percentages with the earlier round or compare absolute timings across separate runs as if host conditions were identical.

Raw data: `benchmarks/results/wall-{render,frame,moving}-{before,after}-{1,2,3}.json`; aggregate: `wall-summary.json`. Stage measurements are diagnostic and are not summed to predict full-frame time.

### Follow-up validation

`benchmarks/wall-equivalence.mjs` dispatches **actual GPU WGSL** for both complete scene-intersection functions on 65,536 deterministic rays across four tub sizes (5 × 3.4 through 14 × 10 m), including interior/refracted-like rays, axis-aligned directions, edge/corner targets, and moved duck positions. All tested distances, normals and colors matched numerically, with zero mismatches. Identical infinite-distance misses from the reference's horizontal floor-ray handling are accepted; unequal nonfinite values fail. This is a regression sample, not a mathematical proof for every possible ray.

The existing browser/cache validation also passed again: GPU startup, both display modes, material switching, tub resize, mobile layout and the 128-particle overflow fallback. No browser JavaScript errors. Original seven source checksums remain unchanged. No solver equations, damping coefficients or physics quality changed in this follow-up; it does not independently fix the remaining WCSPH compressibility/gelatin limitation.

To reproduce this follow-up on the configured sandbox:

```sh
VK_ICD_FILENAMES=/tmp/vk_swiftshader_icd.json \
LD_LIBRARY_PATH=/tmp:/tmp/al2023/lib \
CHROMIUM_PATH=/tmp/chromium \
/home/user/.venv/bin/python benchmarks/wall-study.py
```

Use `--validate-only` for just the ray-equivalence checks. This study runner deliberately selects software Vulkan and localhost:8005; it is not a native-GPU benchmark launcher. The general `profile.py` supports native browser testing without `--software`, and `--source-dir benchmarks/pre-wall-batch --variant optimized` overrides only the old shader for frame/render comparisons. New profile reports record hashes of overridden sources. The in-editor JSON export identifies the new renderer as `batched-walls-v1`.

## 1. Largest rendering cost: surface composition

The initial stage profile measured:

- Particle depth: **140.16 ms**.
- Four bilateral-filter passes: **52.29 ms**.
- Surface composition: **274.90 ms** — the largest individual rendering pass.

Changes:

- Cache the primary scene's **full-precision color and distance** when the camera, duck, dimensions and render target are unchanged. The primary scene used to repeat floor/wall/rock/duck intersections for every pixel, every frame.
- **Moving views or moving solids bypass this cache** and shade directly. Once the scene stops moving, one refresh populates the cache. That avoids continuously paying for an extra background pass during orbit/drag interaction.
- A conservative bounding sphere rejects rays missing the entire duck before testing its six visible component spheres.
- Fluid depth and normals are still rebuilt from the actual GPU particles every frame. Refracted rays still trace the current analytic scene; this does not freeze the water or replace it with a painted texture.
- No particle count, physics rate, pixel cap or blur quality was reduced for this A/B.

The first cache-stage experiment reduced the measured surface pass to about **199 ms**. A further convex-footprint wall-test shortcut did not show a convincing additional improvement here and was **reverted**, rather than kept merely because it sounded faster. Its experimental results remain labeled as such.

Primary-scene caching consumes one additional RGBA32Float render target (16 bytes per rendered pixel). Rapid camera/duck motion does not benefit from that cache. The benchmark warms up before steady-state timing; initial shader compilation and cache-fill cost are not included in those medians. Whole-frame timestamps include background cache refreshes when they occur.

## 2. Largest compute stage: force / integration

Initial single-substep medians: clear 0.09 ms, build 0.14 ms, density **10.86 ms**, force/integration **21.53 ms**.

The density pass already searches the neighborhood. Previously, integration walked the same 27 cell-linked lists again, including candidates outside the support radius. It now reuses a **GPU-resident list of accepted neighbors** built during density evaluation.

- Cache entries are transposed by neighbor slot, then particle ID, for contiguous accesses across adjacent GPU invocations.
- The cache is rebuilt **every substep**. Positions do not move between density and force evaluation, so this reuse does not rely on stale neighborhoods.
- Capacity is 96 accepted neighbors per particle. If a particle exceeds it, integration falls back to the original traversal: **neighbors are not silently discarded**.
- Memory: `97 × particleCount × 4` bytes, approximately 2.38 MB at 6,144 particles or 9.31 MB at 24,000.
- The inherited 256-visits-per-cell emergency bound remains; it is separate from the cache capacity and has a diagnostic counter.

Diagnostic stage measurements after the optimization were approximately **12.90 ms density + 3.11 ms integration**. Density gets more expensive because it writes the cache; integration gets dramatically cheaper. The end-to-end compute result in the table includes that extra density work. Stage tests use separate passes for timestamps and short single-step workloads, so their medians should not be summed to predict the frame benchmark exactly.

### Cache correctness

`benchmarks/validate.py` compares actual GPU readbacks with the cache enabled versus integration forced through the original neighbor traversal:

- Normal case: maximum position difference approximately **2.4e-7 m**, velocity difference below **3e-6 m/s** in the recorded test.
- A deliberately dense synthetic cluster triggered **128 cache fallbacks** and matched the forced-reference path within floating-point tolerance.
- The synthetic overflow case tests cache behavior, not realistic fluid stability; the cluster is intentionally over-compressed.

## 3. The gelatin-like motion

The old material combined relatively high viscosity, substantial XSPH velocity smoothing and artificial pair cohesion. This suppresses small-scale motion in addition to WCSPH's pressure response.

The default is now **Water · low damping**:

| Parameter | Previous reference | Water |
|---|---:|---:|
| Viscosity coefficient | 0.025 | **0.003** |
| XSPH coefficient per 2 ms | 0.030 | **0.004** |
| Artificial pair cohesion | 0.060 | **0** |

The Water inspector retains **Previous viscous reference** for comparison and a custom viscosity control. Resizing and quality changes preserve the selected settings.

An isolated GPU shear-decay test used the same positions and initial velocity field for both materials, disabled gravity, pressure and cohesion for **both**, and measured kinetic energy after 50 × 2 ms substeps:

- Previous settings retained **22.4%** of initial kinetic energy.
- Water settings retained **82.2%**.

This is evidence of substantially lower **numerical damping**, not a realism score, a calibrated physical-water viscosity, or proof of incompressibility. Collision handling is still active in that test. The performance A/B used the previous coefficients in both versions; the damping experiment is separate.

The livelier material exposed a contact defect: clamping a particle upward to the floor could put it slightly inside the submerged rock after its first rock check. A final rock projection now handles that junction. Body/head contact iteration also exits immediately when both constraints are satisfied, while allowing more iterations at their intersection.

### Physics validation

- Large-tub low-damping stress: **960 actual GPU substeps / 1.92 simulated seconds**, including moving duck and jet. Readbacks after **every 12-step batch** were finite and in bounds, with no solid penetration, neighbor truncation, speed-cap activation or invalid-state reset. Final mean density ratio was approximately **1.000**.
- Existing compact-tub GPU regression, larger-particle-count sanity checks and four resized-tub GPU smoke tests also passed.
- CPU initialization tests covered 18 dimension/count combinations; browser checks covered startup, material switching, both render modes, resizing and mobile layout.
- The original pond's numerical stability tests and seven source-file checksums passed unchanged.

These are short regression tests, not a guarantee of long-duration stability in every configuration. The water remains coarse-resolution WCSPH. Elastic-looking compression, unresolved thin sheets and screen-space surface artifacts can still occur. I am **not claiming the entire gelatin/realism problem is solved** by lower damping.

## Solver research and next decisions

- **DFSPH:** couples density and velocity-divergence constraints, which can support larger timesteps and fewer expensive neighborhood rebuilds. This directly addresses the next architectural limitation: WCSPH's stiff pressure response and small explicit steps. It requires real iterative solvers, convergence/error criteria and boundary treatment—not simply increasing this solver's timestep. [2](https://www.vci.rwth-aachen.de/publication/054/)
- **Position Based Fluids:** enforces density through positional constraints and supports larger timesteps, but its original presentation also addresses energy loss with vorticity confinement. It is not an automatic cure for over-damped-looking fluid. [1](https://history.siggraph.org/learning/position-based-fluids-by-macklin-and-muller-fischer/)

Neither replacement was implemented during this historical optimization stage. DFSPH has since been added as an optional experiment; see GPU-DFSPH.md. This iteration follows the measured priority: rendering first, repeated neighbor work second, and damping/contact corrections independently. DFSPH is a justified next solver experiment; any comparison should use equal simulated time, density error and collision checks—not FPS alone. A sorted/coherent grid is another future optimization, especially at higher particle counts; the current cache is not a claim that particle state has been spatially sorted.

## Reproduce with Python

With `python3 preview-gpu.py --port 8005` running:

```sh
python3 -m venv .venv
.venv/bin/pip install -r benchmarks/requirements.txt
.venv/bin/playwright install chromium

.venv/bin/python benchmarks/profile.py --mode frame --variant baseline \
  --output benchmarks/results/my-baseline.json
.venv/bin/python benchmarks/profile.py --mode frame --variant optimized \
  --output benchmarks/results/my-optimized.json
.venv/bin/python benchmarks/profile.py --mode stages --variant optimized
.venv/bin/python benchmarks/profile.py --mode damping --variant optimized
.venv/bin/python benchmarks/profile.py --mode stages --variant optimized \
  --water --stress-steps 960 --output benchmarks/results/my-stress.json
```

Use `--chromium /path/to/chrome` or `CHROMIUM_PATH` for an installed browser. The tool requires timestamp queries; it fails rather than substitute a wall-clock number and call it GPU time. `--moving-camera` exercises the direct-shading path. Shader and JavaScript errors fail the run. The frozen baseline in `benchmarks/baseline/` is a benchmark fixture, not runtime code; the Python route handler serves it only to the benchmark browser.

For this sandbox's deliberately configured software-Vulkan setup, the invocation also used `--software`, `VK_ICD_FILENAMES=/tmp/vk_swiftshader_icd.json` and `LD_LIBRARY_PATH=/tmp:/tmp/al2023/lib`, with a separately installed Chromium binary. Those environment paths are specific to this machine and are not a normal-user requirement. Python's standard browser download was unavailable here, so the Chromium binary/libraries were installed outside the repository.

### Measure your actual GPU

Select **Water → Measure GPU & save JSON**. It explicitly resets the volume, disables interaction during the fixed workload, pauses afterward and downloads the raw samples with adapter/material metadata. This measures the user's browser/device with their current material, unlike the controlled reference-material A/B above. Nothing is uploaded automatically.

The measured result can be analyzed in Python or attached for follow-up. Native GPU results are needed before choosing GTX/RTX quality tiers or claiming hardware speedups.
