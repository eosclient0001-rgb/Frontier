# Random-domain path replay — work in progress

## Why source support matters

A reservoir weighted only by its previous radiance cannot choose a previously dark path, even if that
path would be bright after an occluder moves. Reusing it as if it covered all current paths can therefore
darken disocclusions. `PathDomainSupportAudit.cpp` **exhaustively enumerates a finite toy domain**: two
previous draws, one current draw and both weighted selections. With visibility inverted between two equal
samples, the exact current mean is `0.5`; zero-floor reuse gives `0.1666667`, while a strictly positive
importance floor recovers `0.5`. For an entirely dark source becoming bright, the corresponding values are
`1`, `0.3333333` and `1`.

The contemplated alternative stores a random-number seed rather than only the resulting path vertex. At a
new receiver or scene, the same seed is fully retraced, and the new contribution is evaluated there. Its
importance target is `luminance + positive_floor`, so every random sequence has nonzero selection support,
including paths that were previously dark. For a reservoir of `M` draws with weight sum `S` and selected
source target `p`, its aggregate multiplier is `S / (M p)`. Re-evaluating the selected seed with target
`p'` gives a merge weight `p' * multiplier * M`. This is an identity mapping in the random-number domain,
not geometric endpoint reconnection; no geometric reconnection Jacobian is used. It can cost substantially
more because every reused seed must be retraced in the current scene.

The finite enumeration assumes uniform independent input draws, independent weighted selections, fixed
counts and a positive target. It is **not** proof of random-generator independence, unbiasedness under all
adaptive reuse, or full ReSTIR GI.

## Bounded Vulkan implementation

`PathReplayReservoir.slang` now runs the replay idea through the LightCompute Vulkan host. It traces opaque,
untextured Lambertian triangles against the current BVH, up to eight hits, with two-sided constant facet
radiance and an optional uniform environment. Temporal candidates use the supplied prior-pixel/position/token
guide; spatial candidates may originate on different surfaces. Each reused seed is fully retraced through the
**current** scene, including its occluders, rather than carrying a stale visibility result. Pre-spatial
reservoirs are retained; the selection floor is positive (`0.01` in the tests), and the history count is
bounded. On a scene, receiver, camera, environment or integrator change, the host deterministically limits the
previous reservoir's represented count to one for that frame while retaining its seed and per-sample weight.
This reduces reliance on a single stale-domain candidate without a global reset; the count can grow again in
subsequent unchanged frames. A changed source, blocker, receiver or bounce budget can therefore be replayed
without blindly copying the old radiance. The host rejects corrupt BVHs, zero selection floor, metallic and
textured facets.

| SwiftShader CPU Vulkan fixture | Independent target | Reused result |
|---|---:|---:|
| Fully blocked → half visible emitter | 0.1199091 | 0.1203033 ± 0.0036068 SE |
| Moving receiver + blocker + spatial donors | 0.0178338 | 0.0213990 ± 0.0036185 SE |
| Dark emitter → lit emitter | 0.1199091 | 0.1224039 ± 0.0036172 SE |
| Revealed two-hit parallel-plane path | approximately 0.5 | 0.5 |
| Four-hit reflective parallel planes | approximately 0.625 | 0.625 |

Each statistical case uses 4,096 centre samples across four seeds; SE is the sample standard deviation divided
by √4,096 and assumes independent centres. The first area integral converges within `6.86e-8` between 500²
and 1,000² midpoint grids. Moving an occluder into the path returned exactly zero in the tested fixture.
A coloured two-hit case matched `(0.5, 0.25, 0.125)`. In this disocclusion fixture the count cap reduced
standard deviation to 77% of an otherwise identical long-history control; the finite-domain audit also
recovers the exact toy mean after capping. This is not a general convergence or performance guarantee. Each
spatial candidate requires another full path trace, and scene-change checks copy/compare host buffers; no
real-time or hardware-GPU claim is made. Release and sanitized-host checks pass; the external Vulkan driver
is not sanitizer-instrumented.

The rendered 24-triangle room also has an independent **double-precision CPU Monte Carlo** reference: it uses
brute-force Möller–Trumbore intersections, a different cosine basis and `mt19937_64`, rather than the GPU BVH
and RNG. Three reference cases each used 400,000 paths; 16 Vulkan batches supplied 16,384 sampled centres per
case. All RGB channels passed the specified six-combined-SE-plus-tolerance test for one-hit open, four-hit open,
four-hit blocked fresh, and four-hit blocked after temporal/spatial reuse. For example, blocked/reused red was
`0.025697 ± 0.000633` batch SE versus CPU `0.027512 ± 0.000438` SE. The GPU pixel and batch standard errors
are both recorded; independence and finite-sample tails remain assumptions. Both implementations deliberately
share the same diffuse scene, ray offset and transport model, so this is an independent implementation check,
not measured real-world ground truth. [Release](Results/ReplayRoomReference-release.txt) ·
[sanitized host](Results/ReplayRoomReference-sanitized.txt).

This does **not** yet handle general materials, direct analytic lights, textured geometry, refraction, volumes,
arbitrary motion-vector generation or production/editor integration. Replay is a path-sampling experiment,
not the retained demo's endpoint-reconnection algorithm, and rare-event variance may be large. Four noisy
actual captures are shown in [ReplayCaptures.md](ReplayCaptures.md).

[Release Vulkan output](Results/PathReplay-vulkan-release.txt) ·
[sanitized Vulkan output](Results/PathReplay-vulkan-sanitized.txt)

```bash
bash Exhibits/LightCompute/RunPathDomainSupportAudit.sh
SANITIZE=1 bash Exhibits/LightCompute/RunPathDomainSupportAudit.sh
bash Exhibits/LightCompute/RunPathReplayGpu.sh
SANITIZE=1 bash Exhibits/LightCompute/RunPathReplayGpu.sh
bash Exhibits/LightCompute/RunReplayRoomReference.sh
SANITIZE=1 bash Exhibits/LightCompute/RunReplayRoomReference.sh
```

[Release output](Results/PathDomainSupport-release.txt) · [sanitized output](Results/PathDomainSupport-sanitized.txt)
