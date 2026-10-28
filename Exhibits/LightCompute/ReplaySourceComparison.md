# VehicleHMI spatial source and replay intake — 2026-10-28

## Scope

This checkpoint starts from `3de9061`. It does **not** complete ReSTIR GI or compare frame times, full images,
GPU hardware, or equivalent entire renderers. The retained VehicleHMI reference is a **WebGPU/WGSL** renderer,
not a WebGL implementation. The original browser application has not been rendered in this environment.

## Execute the original spatial shader

The [validation](Code/SpatialSourceValidation.py) concatenates the **unchanged** upstream
`PackingCodec.wgsl`, `ReservoirRecords.wgsl`, and `ReservoirSpatial.wgsl`. Their Git blob identities are checked
by the runner against upstream `SultanAladin/Frontier` commit `6afb6f00b5f25c45f7cda92c7da65b64845768f3`.
It runs the original `ResampleSpatial` entry through wgpu-native on SwiftShader CPU Vulkan. The remaining
scene, frame, visibility and random-disk helpers are **test stubs**: two coincident diffuse receiver positions,
identical guides, sky-direction samples, a forced proposal of the other pixel, visibility reuse off, and no
active luminance clamp. The four possible bright/dark inputs are uploaded as real packed reservoir records.
The output is read from the original `rgba16float` storage texture. The host weights these four readbacks by
independent Bernoulli probabilities; this is an exhaustive discrete fixture, not a measured browser frame.

| Bright event probability | Exact mean | Original shader mean | Counterfactual mean |
|---:|---:|---:|---:|
| 1/2 | 1 | 1.25 | 1 |
| 1/8 | 1 | 1.4375 | 1 |
| 1/16 | 1 | 1.46875 | 1 |

The previously documented [algebraic counterexample](StaticIndirect.md#exact-spatial-counterexample-in-the-retained-demo)
therefore reproduces in **actual WGSL execution** under these controlled substitutions. The counterfactual
changes only the test copy: it keeps a geometrically eligible zero-weight donor's domain in `Z`. It is not a
production fix; sample-dependent Jacobian rejection, visibility, different surfaces and correlations require
additional analysis. Neither version here is a complete scene, an original unmodified browser runtime, or an
image-quality/performance comparison with native replay. [Full readback](Results/SpatialSourceValidation.txt).

The original upstream `Tools/RestirPathTracer.test.mjs` also ran **5/5** on Node using restored upstream source
and archives. It checks CPU geometry, settings and shader text; it does **not** execute the browser GI shaders or
measure visual quality. [TAP output](Results/VehicleHmiRestirSourceTests.txt).

## Native change: temporal reservoir intake

The Engine's replay shader previously converted temporal seed halves without validating them, and accepted
positive infinite normalization weights and counts. It now requires finite, integral seed halves in `[0, 65535]`,
a finite positive weight, and a finite integral represented count of at least one. A replay weight or updated
sum that overflows or is non-finite is rejected before reservoir merging. Rejected history falls back to the
fresh path and increments the existing rejection counter. The seed-half predicate is shared with the existing
subpixel seed-bank shader. This is a bounded corruption guard, **not** a substitute for correct caller-managed
buffer synchronization, resource revisions, submission failure handling or general estimator verification.

| SwiftShader CPU Vulkan fixture | Prior `3de9061` shader | Changed shader |
|---|---:|---:|
| Invalid/overflow cases falling back exactly to fresh | 2/10 | 10/10 |
| Histories accepted, including any corrupt inputs | 1,022 | 1,014 |

The ten inputs are NaN, negative, out-of-range and fractional seed halves; infinite and NaN weight; infinite,
fractional and NaN count; and a finite maximum weight whose product overflows on a bright retraced path.
The changed shader retains 1,014 unmodified histories. The previous version is an **expected failing negative
control**, not a passing test. These injected values do
not assert that ordinary synchronized histories spontaneously become corrupt.

Valid-history regression against the previous shader covers 20 uniform/power and cosine/GGX images with mixture
disabled: **655,360 float components and eight history summaries match bit-for-bit**. The subpixel seed-bank
suite also passed after the shared predicate move; its numerical results match the retained baseline. These
comparisons do not exhaust every history or establish equal-time speed or universal estimator correctness.

[Before / expected failure](Results/ReplayReservoirIntake-before.txt) ·
[Release and parity](Results/ReplayReservoirIntake-release.txt) ·
[Host ASan/UBSan](Results/ReplayReservoirIntake-sanitized.txt) ·
[Post-change seed-bank regression](Results/ReplaySamplePostguard-release.txt).

## Reproduce

Linux x86-64, GCC 12.2, CMake 3.31.6, Slang 2026.14.1, Node 22 and SwiftShader CPU Vulkan were used here;
these are host validation programs, not delivered Linux application binaries. No Windows or physical-GPU
execution is claimed. Restore the project's pinned Vulkan tools with
`python3 Exhibits/LightCompute/Code/Prepare.py`. For the WGSL fixture, install `wgpu==0.32.0` and
`numpy==2.3.5` into `ExternalPackages/WebGpuTools`, then run:

```sh
python3 -m pip install --target ExternalPackages/WebGpuTools wgpu==0.32.0 numpy==2.3.5
bash Exhibits/LightCompute/RunSpatialSourceValidation.sh
bash Exhibits/LightCompute/RunVehicleHmiRestirSource.sh
PARITY=1 bash Exhibits/LightCompute/RunReplayReservoirIntake.sh
SANITIZE=1 BUILD_JOBS=1 bash Exhibits/LightCompute/RunReplayReservoirIntake.sh
RESULTS="$PWD/_ClaudeScratch/replay-sample-postguard.txt" bash Exhibits/LightCompute/RunReplaySampleHistory.sh
```

Set `CMAKE` and `CTEST` to executable paths if they are not on `PATH`. `PARITY=1` requires Git object `3de9061`.
The sanitizer instruments the native host only, not the external driver or the shaders.

The upstream suite runner downloads the pinned codeload archive if absent, extracts `Source`, `Shader`, `Archive`,
`package.json` and the original test to ignored scratch, checks the three reservoir shader Git blobs, and runs
`node --test` from the restored `VehicleHmiPrototype` directory. The archive contains additional material that
is not needed by that suite and should not be committed.

## Remaining acceptance

A like-for-like original WebGPU versus native Vulkan comparison still needs matching geometry, lights, materials,
camera, resolution, sample and warm-up budgets, display transforms, convergence references, and physical-GPU
timestamps over repeated runs. Compare both equal-time quality and equal-quality cost; distinguish CPU time, GPU
time and memory. The original source shader counterexample does not prove that the native replay implementation
is generally unbiased or faster. Dynamic/deforming scenes, broad PBR and reflections, temporal/spatial reuse,
production Vulkan resource ownership, editor integration and physical GPU/Windows checks remain incomplete.
