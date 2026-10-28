# Subpixel diffuse replay using retraced sample seeds

This **default-off** experiment keeps up to three previously generated, unselected random seeds. It retraces
those seeds at the **current** surface, then averages the resulting paths with one current fresh path. It does
not interpolate or accumulate old radiance, so a retained seed's shadow answer is recomputed in the current
triangle BVH. This is software ray tracing, not hardware RT, non-ray-traced GI, completed ReSTIR GI, an editor
viewport or general animated reconstruction. It does not yet combine with temporal/spatial reservoir reuse.

## Contract and cost

| Requirement | Scope |
|---|---|
| Scene | Validated, static, untextured opaque diffuse scene and primary visibility; changed geometry, lights, material, environment or sampling reset the seed bank. |
| Camera | The same `PathReplayDomainSpecification::DiffuseCameraReprojection` validation and `PathReplayHistoryDomain` camera-only decision used by [strict colour reprojection](ReplayCameraReprojection.md). The previous projection must identify the last completed frame. |
| Opt-in | `PathReplaySampleHistory`, with `PathReplayResetSampleHistory` on first use, reallocation, toggling, failed submission, incompatible revision or policy change. |
| Exclusions | No colour reconstruction, rough/textured mode, adaptive reservoir reuse or multi-candidate selection. One initial fresh candidate; temporal and spatial reservoir options must be off. |
| Recorder | Two additional pipelines, 24 counter words, and `PathReplayRequiredSampleHistoryOutputRecords(N)` float4 records. The recorder validates ranges and incompatible flags, but cannot validate GPU buffer contents or whether a submission succeeded. |
| Work | One current path plus up to three **new current-frame retraces**. The three old seeds are not free path results; the shader may trace four paths per pixel and adds buffer traffic. |

The gather accepts a previous pixel only if its surface token, bounded world-space distance and normal are
compatible, the current/motion world guides agree exactly, and every retained seed half/count is finite and
valid. It reads the old banks into scratch before resolve overwrites position/normal guides; finalize reads the
scratch and writes a shifted bank. A rejected pixel preserves the current fresh result bit-for-bit. Seeds are
stored as exact 16-bit halves, not NaN-prone float bitcasts. The radius is capped at `0.25` world units and is
scale-dependent. A matching token and position are not a general disocclusion proof.

The bank holds fresh draws, not reservoir-selected samples or previous path colours. This avoids reusing a
selection based on old radiance, but neither the seed generator nor cross-pixel/frame streams are proven
independent. Multiple pixels may trace the same donor seed. Correct caller-managed scene revisions, history
ownership, buffer barriers and reset after failed submission remain mandatory; the domain snapshot alone cannot
certify every external resource. This is not a claim of unbiasedness, an equal-time improvement, arbitrary
camera/scene support, real-time performance or physical-GPU validation.

## One-bounce subpixel check

A `32 × 32` fixture contains a diffuse plane, an opaque blocker and a two-triangle emissive rectangle. After
three stationary frames, the camera translates by half a pixel (`0.03125` world units). The current frame uses
one cosine-sampled path and no explicit facet sampling. An independent C++ rectangle-intersection oracle mirrors
the PRNG only to reconstruct each seed; it does not use the shader's BVH. Separately, a numerical emitter-area
integral provides a per-point mean reference. The comparison remains a model fixture, not measured light.

| Check | SwiftShader CPU Vulkan result |
|---|---:|
| Accepted seed banks / rejected pixels | `970 / 54` |
| Changed-token disocclusions | `22`, all rejected to fresh output |
| Accepted full three-seed banks | `970` |
| Independent per-seed oracle | `783` plane pixels agree; maximum RGB error `0`; `11` edge-ambiguous pixels excluded |
| Retained seeds whose visibility changes between donor and current point | `10`; evaluated using the **current** answer |
| Plane red RMSE vs area integral, 794 accepted points | one fresh path `0.292290`; up to four retraced paths `0.154939` |
| `128×128` vs `64×64` quadrature RMSE | `0.000290` |
| Blocker + camera change, then reopen | bank reset; both results bit-identical to fresh |
| Corrupt seed-bank fields | seven rejected to fresh; `1,017` unaffected histories retained |
| Invalid requests / mode re-enable | seven rejected before submission; history sequence unchanged; re-enable resets |

The RMSE numbers are **not equal work**: the second image retraces three additional paths and uses prior frames.
Near a source edge, SwiftShader's direction approximation shifted one tested intersection by approximately
`0.00028 m` relative to host trigonometry. The individual-path oracle consequently excludes points within
`0.001 m` of a rectangle edge; the excluded count is reported above. This threshold is specific to this fixture,
not a bound on other hardware or scenes. At this checkpoint the new mode has not yet been checked against the
independent four-bounce CPU model or an equal-path-count fresh comparison.

Release and host ASan/UBSan numerical rows agree on SwiftShader CPU Vulkan; the external driver and shader are
not sanitizer-instrumented. Five CTests pass. Existing strict camera-reconstruction numerical rows match the
previous release results after the recorder change. These checks do not cover Windows, physical GPUs or editor
integration.

## Reproduce

Requires Slang, Vulkan headers, SwiftShader, CMake and a C++20 compiler. The retained logs identify the exact
source and driver hashes.

```sh
bash Exhibits/LightCompute/RunReplaySampleHistory.sh
SANITIZE=1 BUILD_JOBS=1 bash Exhibits/LightCompute/RunReplaySampleHistory.sh
```

[Release](Results/ReplaySampleHistory-release.txt) · [Host ASan/UBSan](Results/ReplaySampleHistory-sanitized.txt) ·
[Existing camera regression](Results/ReplaySampleHistory-regression.txt).
