# Opaque diffuse texture replay

An opt-in replay mode evaluates the existing float-atlas albedo pyramid at every secondary triangle hit. Primary
camera strikes already use the same `ApplyRayMaterial` path. The replay estimator remains Lambertian; this does
**not** enable the atlas's authored GGX, normal maps, automotive paint, glass, layered materials or analytic lights.

## Bounded domain

- One opaque, non-metallic, uncoated stratum with a power-of-two RGB albedo pyramid, up to 1,024 texels per side.
- Float atlas material and mip spans, finite `[0,1]` texels, finite bounded UVs/mapping and triangle/BVH XYZ are
  checked before submission. Textured vertices keep UVs in the `.w` channels, which need not equal BVH padding.
- The camera and triangle coordinates are bounded; primary cameras must have finite orthonormal current and
  previous axes. The experiment rejects a light CDF, so the entire atlas participates in the revision.
- The production sampler wraps UVs, uses bilinear interpolation within a selected mip and estimates footprint
  from camera distance, view angle and vertical pixel size. It is not a ray-differential or anisotropic filter.
- Atlas changes are compared by contents, not pointer. Replay retraces retained seeds and caps their represented
  history at one for the changed submission. A separate pending reset preserves the original hard-reset policy
  for ordinary pipelines. Unrelated geometric, camera and estimator changes retain their existing guards.

## Validation

SwiftShader CPU Vulkan, Slang 2026.14.1, Linux release host and ASan/UBSan host; the external Vulkan driver is not
sanitizer-instrumented. Expected plane values are effectively exact for these 2,000-unit-wide fixtures; extremely
rare rays can miss their finite boundaries.

| Check | Result |
| --- | --- |
| Malformed atlas, UV, camera and domain inputs | 28 cases rejected; opt-in and rough-material guards held |
| Two-hit planes, RGB analytic `(0.8, 0.2, 0.1)` | Fresh `(0.8000000, 0.2000000, 0.1000000)` |
| Black → coloured atlas with reused candidates | `(0.7999905, 0.1999976, 0.0999988)` |
| Moving blocker / reopened | `0` / `(0.7999882, 0.1999970, 0.0999985)` |
| Changed atlas, blocked, reopened | 40,960 temporal accepts each; changed-atlas test 97,280 spatial links |
| Secondary texture probes | Texel centre, bilinear interpolation, negative wrap, seam and 1×1 mip matched analytic RGB |
| Primary CPU filter comparison | 8,625 strikes, 7,858 wrapped; mips 0/1/2/3: 1,236/5,098/2,007/284; max RGB error `7.28e-7` |
| Other pipeline reset | Pending ordinary-history reset tested after the replay atlas change |

Primary filtering comparison uses Vulkan's hit positions and barycentrics with an independent double-precision
CPU sampler; it is not an independent primary-intersection test. The secondary plane probes independently specify
the expected texel colours and transport. Earlier diffuse, rough, balance, motion and direct-light regression
fixtures still pass; see the retained logs. A four-hit textured-room CPU comparison and multiple rendered views are
the next acceptance checks, not yet implied by this table.

```bash
bash Exhibits/LightCompute/RunReplayTexture.sh
SANITIZE=1 bash Exhibits/LightCompute/RunReplayTexture.sh
```

[Release](Results/ReplayTexture-release.txt) · [sanitized host](Results/ReplayTexture-sanitized.txt) ·
[replay regressions](Results/ReplayTexture-regression.txt) ·
[direct-light regression](Results/ReplayTexture-direct-regression.txt) · [prior sampling audit](ReplayBalance.md).

The validation host uses full CPU-Vulkan retracing, not hardware ray queries or the editor. Finite random-sequence
correlations, scale-dependent motion guides, origin offsets and general adaptive-reuse bias remain open. No
real-time, physical-material or complete ReSTIR GI claim is made.
