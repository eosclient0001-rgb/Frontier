# Moving-primary GI: disjoint-seed repeat

This follow-up investigates the previous moving-primary fixture's noisy rigid-surface green channel
and compares fresh and reused mixture samples after motion, blocker insertion and reopening. The
production Engine shader is unchanged. Vulkan executes on **SwiftShader CPU**, not a physical GPU.

## Method and current status

The `64 × 64` rough-textured scene, camera/rigid motion, translated unequal-power radiant triangles,
blocker, two independently selected primary probes and four-hit reference path are the same as the
[prior motion validation](ReplayFacetMixtureMotion.md). Fresh uniform and mixture proposals both use
spatial reuse, GGX directions and balanced MIS. Fresh mixture and cap-one temporal/spatial reuse are
also paired by frame seed for the moved, blocked and reopened scenes.

For speed, an exhibit-only compute dispatch retains two `13 × 13` primary-guide regions; the original
camera resolution, primary rays, selected pixel indices, textures and Engine replay shader remain
unchanged. A complete-versus-restricted audit compares both probes, seven modes, three seeds and RGBA
outputs: **168 float components were bit-identical**, and nine transition histories matched. This is a
finite parity check, not a proof for every seed or scene. Production submission never enables this audit.

Release and ASan/UBSan host smoke tests passed with two disjoint groups of eight frame seeds and
12,000 CPU paths per reference. Their CSV hashes matched; the small sample is insufficient for a
convergence conclusion. The full 256-batch release and sanitized-host runs are not yet complete.
No physical-GPU, unbiasedness, independent-stream or universal variance claim is made.
[Release smoke](Results/ReplayFacetMixtureMotionRepeatSmoke-release.txt) ·
[sanitized smoke](Results/ReplayFacetMixtureMotionRepeatSmoke-sanitized.txt) ·
[smoke samples](Results/ReplayFacetMixtureMotionRepeatSmokeSamples.csv).

## Reproduce

```sh
# Structural smoke test; not a convergence measurement
CHECK=--replay-facet-mixture-motion-repeat-smoke Exhibits/LightCompute/RunReplayFacetMixtureMotionRepeat.sh

# Four disjoint seed groups × 64 batches; six independently seeded 240,000-path CPU references
Exhibits/LightCompute/RunReplayFacetMixtureMotionRepeat.sh
SANITIZE=1 BUILD_JOBS=1 Exhibits/LightCompute/RunReplayFacetMixtureMotionRepeat.sh
```

Prepare the pinned tools with `python3 Exhibits/LightCompute/Code/Prepare.py`. The external Vulkan
driver and shaders are not sanitizer-instrumented. `CMAKE`, `VULKAN_TOOLS`, `SLANGC`, `VULKAN_LIBRARY`,
`BUILD_JOBS`, `RESULTS` and `TABLE` can select alternate tools and output paths.
