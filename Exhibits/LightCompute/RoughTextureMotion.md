# Rough-textured moving-primary reference

The bounded replay is **not complete ReSTIR GI**. This test combines rough/metallic atlas materials, primary
camera and rigid-object motion, a texture/material change and a subsequent moving blocker. It compares two
moving primary pixels with independent four-hit CPU paths, rather than relying on the appearance of renders.

## Fixture and method

- A 64×64 synthetic room starts with atlas roughness/metallic `0.65/0.35`; a cuboid rotates `0.12` rad and
  translates `0.096` world units as the camera moves `0.07`. The next submission changes the texture palette
  and atlas coefficients to `0.48/0.70`. The following submission inserts a blocker under the light.
- An independent double-precision brute-force primary intersection and texture filter compares every camera
  pixel in the previous, moved and blocked scenes against Vulkan. The authored scene and atlas are shared
  inputs, not GPU ray-hit outputs. A separate check verifies the roughness, metallic, IOR and material address
  at every textured primary hit; rigidly attached UVs are checked on the cuboid's 30 vertex instances.
- For each of an object and a floor pixel, separate open and blocked references use **240,000** CPU paths with
  `mt19937_64` and four surface hits. The CPU uses cosine-direction sampling, an independent triangle
  intersection and a double-precision implementation of the guarded single-stratum atlas BRDF. The GPU uses
  cosine and emissive-facet proposals with balance weighting and a `0.025` RGB uniform environment.
- Each of 128 GPU batches has a fresh comparison and then three previous-scene warmups, followed by the actual
  combined motion/material transition and blocker insertion. The two probes are selected for compatible
  reprojection, and the pre-spatial reservoir's represented count confirms that each retained one temporal
  candidate for each transition. Global counters additionally measure accepted temporal/spatial links.

| Check                                   | Release result                                       |
| --------------------------------------- | ---------------------------------------------------- |
| Previous / moved / blocked hits         | 3,840 each; no hit or surface-token disagreements    |
| Textured primary hits                   | 1,172 / 1,173 / 1,173                                |
| Max primary position / albedo error     | `3.82e-6` / `7.16e-7`                                |
| Max textured material coefficient error | `0` for the compared fields                          |
| Rigid UV max component error            | `1.20e-7`                                            |
| Moved / blocked temporal accepts        | 475,904 / 465,024 across 128 batches                 |
| Spatial links                           | 3,868,672 across both transitions                    |
| Probe accepts                           | Each probe accepted `128 / 128` on each transition   |

Selected linear-RGB means ± **sample-variance** standard error:

| Probe / condition                 | Independent CPU              | SwiftShader replay          |
| --------------------------------- | ---------------------------: | --------------------------: |
| Object green, moved and reused    | `0.0253971 ± 0.0002446`      | `0.0254902 ± 0.0012827`     |
| Object green, blocker inserted    | `0.0096633 ± 0.0000310`      | `0.0101475 ± 0.0005930`     |
| Floor red, moved and reused       | `0.1889130 ± 0.0034800`      | `0.1868714 ± 0.0079735`     |
| Floor red, blocker inserted       | `0.0147738 ± 0.0008796`      | `0.0132018 ± 0.0025067`     |

All 18 RGB comparisons passed the stated acceptance threshold of `6 × combined SE + 1% of CPU mean + 1e-4`.
The fresh floor blue channel differed by `0.01257`, or about **3.65 combined SE**, although it passed that broad
threshold; it warrants a larger, independently seeded follow-up. GPU uncertainty is calculated across batch
outputs, not neighbouring pixels. The finite GPU streams are not proven independent, and the two probes do not
establish general unbiasedness, deformable-mesh reprojection, equal-time performance or absence of ghosting.

## Reproduce

```bash
bash Exhibits/LightCompute/RunRoughTextureMotion.sh
SANITIZE=1 bash Exhibits/LightCompute/RunRoughTextureMotion.sh
```

Preparation: `python3 Exhibits/LightCompute/Code/Prepare.py`. The retained logs use Linux x86-64, GCC 12.2,
Slang 2026.14.1 (`-O0` SPIR-V), and **SwiftShader CPU Vulkan**. Sanitizers instrument the host, not the external
Vulkan driver. Source hashes, all channels and counts are in the
[release](Results/RoughTextureMotion-release.txt) and [sanitized-host](Results/RoughTextureMotion-sanitized.txt)
logs; [release regressions](Results/RoughTextureMotion-regression.txt) cover earlier replay modes. Physical
GPUs, Windows, production integration and Khronos validation layers were not run.

[Rough-textured static and dynamic-secondary checks](RoughTextureReplay.md) ·
[Rough-textured motion gallery](RoughTextureReplayCaptures.md) ·
[Diffuse moving-primary reference](ReplayTextureMotion.md).
