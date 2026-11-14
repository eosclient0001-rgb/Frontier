# Deterministic path tracer — WebGPU prototype validation

Evidence for [`Experimental/DeterministicPathTracer/`](../../Experimental/DeterministicPathTracer/README.md):
a compute-shader path tracer with **no** random numbers, Russian roulette or stochastic branch selection,
rendering the ControlVehicle (VehicleHMI / UV editor vehicle) in a material studio.

## Claim

| # | Claim | Test | Result |
|---|---|---|---|
| 1 | Every integration coordinate is a fixed, structured point, identical on GPU and host | `quadrature` | 147,456 GPU-vs-host coordinates, **0 mismatches** |
| 2 | Each 2-D quadrature pair is a (0,m,2)-net, so prefixes of 2^k samples are stratified | `quadrature` | 66 pairs, all nets up to 2^14; worst cross-pair correlation 0.044 |
| 3 | The estimator converges to the exact answer (no bias) | `analytic` | Softbox on a Lambert floor vs closed-form polygon irradiance: **RMS 0.034 %**, max 0.10 % at 1024 spp |
| 4 | Output is bit-exact on repeat, regardless of batching, reconfiguration or process | `determinism` | 5 runs (batch 1/4/32, after reconfig, 2nd browser): **1 distinct digest** `2dc6f6ca` |
| 5 | Error falls faster than Monte Carlo's N^-1/2 | `convergence` | Full Hero scene ≈ N^-0.76; analytic softbox ≈ N^-1 |

## Evidence

![Convergence chart](Images/ConvergenceChart.png)

| Hero, 640×360, 128 spp | Material spheres, 128 spp | Rear, Racing paint, 64 spp |
|---|---|---|
| ![Hero](Images/Hero_Authored_128spp.png) | ![Spheres](Images/Spheres_Authored_128spp.png) | ![Rear](Images/Rear_Racing_64spp.png) |

Progression (320×180) — structured, not grainy, at low counts:

| 1 spp | 4 spp | 16 spp | 64 spp |
|---|---|---|---|
| ![1](Images/HeroProgression_001spp.png) | ![4](Images/HeroProgression_004spp.png) | ![16](Images/HeroProgression_016spp.png) | ![64](Images/HeroProgression_064spp.png) |

Interface (1440×860, render scale 0.4, 16 spp, `present=readback`):

![Interface](Images/WorkspaceInterface.png)

Raw numbers: `Results/*.json` (per-checkpoint curves, digests, worst pixel, timings). Capture digests:
Hero `b19096e3`, Spheres `938371a7`, Rear `fba37cb8`.

### Analytic test, relative RMS vs spp (160×120, key softbox only, one bounce)

| spp | 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 | 256 | 1024 |
|---|---|---|---|---|---|---|---|---|---|---|
| RMS | 2.4e-1 | 3.7e-2 | 5.7e-2 | 1.3e-2 | 1.1e-2 | 3.6e-3 | 1.8e-3 | 1.1e-3 | 7.2e-4 | 3.4e-4 |

### 🐞 Bias found and fixed by claim 3

| | Before | After |
|---|---|---|
| `FresnelSchlick` | F90 = 1 | F90 = saturate(50·F0) |
| RMS @ 1024 spp | 3.8e-3 (plateau) | 3.4e-4 (still falling) |
| Worst pixel | 4.6 % (grazing rows) | 0.10 % |

With F90 = 1 a material with F0 = 0 (the Lambert reference) still reflected at grazing angles and lost
diffuse energy. Clamping F90 by F0 is the standard fix; F0 ≥ 0.02 materials are unaffected.

## Reproduce

```sh
cd Exhibits/DeterministicPathTracer/Code
npm install                      # puppeteer-core + @sparticuz/chromium (unpacked to ChromiumRuntime/)
node RunValidation.mjs all       # or: quadrature | analytic | determinism | convergence | chart | captures | interface
ANALYTIC_SAMPLES=256 node RunValidation.mjs analytic   # shorter analytic run
```

`all` takes about 35 min on 2 CPU cores (SwiftShader). Writes `Results/` and `Images/`.

## Environment

| Item | Value |
|---|---|
| Revision | branch `arena/7afbeba9-frontier` from `96f31ec`, uncommitted working tree |
| Browser | headless Chromium from `@sparticuz/chromium`, `--enable-unsafe-webgpu` |
| WebGPU adapter | **SwiftShader** (CPU), 2 cores — no physical GPU |
| Hero cost | 0.26 s per spp at 160×90 on SwiftShader (not a GPU timing) |

## Limitations

- ⚠️ **No GTX or RTX run.** Portability rests on design (plain compute shader, software bounds tree, no
  ray-tracing extension, 8 storage buffers), not on a measurement. No GPU performance claim.
- Bit-exactness is shown for one device/driver. WGSL leaves transcendental precision to the implementation,
  so two GPUs need not match each other; each should repeat itself exactly (re-run `determinism` there).
- Claim 3 covers direct lighting from one rectangular light on a diffuse floor. Glossy, coat, conductor,
  glass and multi-bounce transport are checked only by self-convergence (claim 5) and visual inspection.
- The interface capture uses the readback display. The default WebGPU-canvas display could not be exercised:
  this SwiftShader build has no shared-image backing for a WebGPU swap chain and loses the device on the
  first present. Capturing it also exposed a real CSS bug (the hidden failure notice was drawn as a 92 %
  dark veil over the viewport); fixed in `Styles.css`.
- Deterministic is not instant: low spp shows structured artefacts instead of grain.
- The bright rectangle on the floor at the lower right of Hero is the rim softbox mirrored in the coated
  epoxy (gone on matte Concrete, unchanged with spheres removed); correct, not an artefact.
