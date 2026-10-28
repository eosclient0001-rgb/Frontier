# Moving textured facet-mixture validation

This exhibit checks the opt-in uniform/power facet mixture, GGX direction proposal and balanced MIS
against independently seeded, four-hit CPU paths through moving rough-textured geometry. It adds no
production/editor integration and does not change the Engine shader. Vulkan runs on **SwiftShader CPU**,
not a physical GPU.

## Fixture and status

Two independently chosen textured primary pixels (an object and a floor) are checked after camera and
rigid-object motion, an atlas/material change, a `.30`-unit translation of two unequal-power radiant
triangles and a power swap, blocker insertion, and source relocation/reopening. The triangle BVH is
rebuilt after translation without replacing texture-coordinate `w` components. Every primary pixel is
also compared with independent double-precision ray/texture calculations. Three uniform/cosine history
submissions precede the first transition into the mixture/GGX proposal; all three transitions must
retain cap-one temporal history and positive spatial links.

The **8-batch, 12,000 CPU paths per reference smoke test passed** in release. This checks fixture
execution and transition guards, not convergence. The longer release and ASan/UBSan host runs are
in progress; no outcome is claimed yet. Their external Vulkan driver and Slang shaders are not
sanitizer-instrumented.

## Reproduce

```sh
# Structural smoke test only
CHECK=--replay-facet-mixture-motion-smoke Exhibits/LightCompute/RunReplayFacetMixtureMotion.sh

# Full validation (240,000 paths for each of six references, 96 GPU batches)
Exhibits/LightCompute/RunReplayFacetMixtureMotion.sh
SANITIZE=1 Exhibits/LightCompute/RunReplayFacetMixtureMotion.sh
```

Prepare the pinned tools using `python3 Exhibits/LightCompute/Code/Prepare.py`. The result files
contain source hashes. Scene-level coverage and sample standard errors are not a proof of general
unbiasedness, independent shader random streams, hardware performance or full ReSTIR GI.
