# Vulkan light history and reconstruction

**Actual Vulkan execution:** shared Slang now performs clustered analytic lighting, temporal/spatial reservoir
reuse, reprojection rejection, temporal moments and edge-aware reconstruction on the original ControlVehicle.
The tested device is **SwiftShader Device (Subzero), CPU type 4**, Vulkan 1.3.0, Slang 2026.14.1.
No physical GPU, hardware ray-query or Windows execution is claimed.

![Moving pose: fresh sampling left, reconstructed lighting right](Images/HistoryComparison.png)

Left is fresh eight-candidate RIS; right uses reservoir history and reconstruction at the **same moving pose**.
The sequence begins with 16 static updates. The vehicle then rotates/translates through five further poses while
the camera pans. A point-light colour change at index 3 deliberately resets all old light histories.

![Six captured Vulkan poses, losslessly animated](Images/Motion.png)

Animation timing is illustrative, **not measured rendering time or a dynamics simulation**. The six images are
actual Vulkan readbacks; no generated illustration or browser renderer is involved.

## Executed sequence

```text
Original ControlVehicle + authored materials
    → native primary visibility, stable surface tokens, rigid motion projection
    → current float32 surfaces + current full-scene BVH + current sky/indirect/emissive residual
    → AssignLightCells
    → EvaluateLightReceivers       fresh RIS + reprojected temporal reservoir + current visibility
    → ReuseLightNeighbours         compatible surface neighbours, target and visibility reevaluation
    → ReconstructLightHistory      temporal colour/moments, variance-based neighbourhood clipping
    → FilterLightNeighbours × 2    edge-aware à-trous filtering, steps 1 and 2
    → FinalizeLightHistory         current residual, persistent reservoirs/surface metadata
    → shader/host dependency + fence → actual readback → native display encoding → PNG/APNG
```

All six computation entries are shared in `Frontier/Engine/Rendering/Shaders/LightInfluence.slang`. The host
retains pipelines/descriptors and uses eight storage buffers with a 112-byte push constant. Inter-dispatch,
inter-submission and host/readback dependencies are explicit. Prior metadata is never overwritten until all
reprojection and reconstruction reads have completed. Fifteen float4 surfaces occupy 61.44 MB at 640×400,
excluding receiver inputs and geometry; this is an unoptimized reference allocation, not measured GPU VRAM.

The uploaded native direct-answer channel is deliberately poisoned with NaNs. Unpoisoned native answers remain
only in host memory for numerical checks. The shader recomputes direct illumination and BVH shadow visibility;
primary raster, sky and indirect transport remain CPU inputs.

## Verified results

| Check | Observed result |
|---|---|
| Original vehicle | 25,068 vehicle facets; 28,276 full-scene facets; 640×400 receivers |
| Exact Vulkan all-light/clustered/forced-capacity routes | Identical float32 output buffers |
| Exact Vulkan versus native RGB | Mean absolute error 2.02268e-6; maximum 6.44028e-5 |
| Native/Vulkan display comparison | 183 pixels differ; maximum one 8-bit code step |
| Candidate-list visits in exact comparison | 8,107,704 → 2,682,703; 66.91% fewer, **not a speedup measurement** |
| Fresh RIS, 97 lights, 256 seeds | Mean luminance 1480.95; exact 1480.88; standard error 0.0842466 |
| Reuse: 64 independent chains × 4 updates | Mean 1480.78; exact 1480.88; standard error 0.123867 |
| Sixteen static updates | RGB RMSE 0.133629 → 0.0413195; **69.08% lower** |
| Five moving updates | Mean per-image RMSE 0.1303814 → 0.057318; **56.04% lower** |
| Moving index 1 | 152,328 accepted; 72,952 rejected; 1,212 sampled-visibility colour rejections |
| Moving light change, index 3 | Zero accepted histories; current light table used immediately |
| Changed material | Exactly 256 affected receivers rejected; 256 unchanged receivers accepted |
| Normal, invalid motion/camera cut, position mismatch | All 512 receivers rejected in each case |
| Camera-cut fallback | Exactly matches a cold restart with identical random seed |
| All lights off | History output exactly matches current exact image; no stale direct contribution |
| Residual refresh | Current exact image matched; no old residual accumulation |
| Triangle stack capacity forced to one | 49,664 exhaustive fallbacks; matches ordinary BVH visibility |
| Offscreen caster | Ten caster facets shadow synthetic receivers, independent of primary-frustum culling |

Errors compare the same current surfaces/lights/geometry. Static reconstruction has sixteen updates versus one
fresh image; the moving comparison uses the stated warmup and lighting reset. These are fixture-specific image
quality measurements, **not equal-cost performance comparisons**. Filtering/clipping is deliberately biased;
the unfiltered energy check is separate and does not certify arbitrary ReSTIR reuse as unbiased.

`Results/Vulkan.txt` has each moving pose's rejection counts, errors and native RGB comparison. `Results/History.json`
has the quality summary. `Images/MotionReject1.png` shows green accepted colour history, orange sampled-visibility
rejection, red rejected history and black uncovered pixels. The PNG animation is lossless and its frame payloads,
chunk sequence and checksums are independently checked by `Code/HistoryImages.py`.

## Mechanisms and limits

- Fresh proposals use receiver-dependent incoming irradiance power: range, angular profile and surface cosine,
  with a positive support floor. A permuted 32-bit congruential stream replaces plain LCG output. Native exact
  comparison, independent seeds and the separate unfiltered-reuse energy test validate this configuration.
- Overflow or outside-grid queries enumerate all global light IDs. No assignment is silently lost. The host
  uses an 8×8×4 grid and cell capacity 1–16; the shader preserves conservative float32 sphere/box padding.
- Reprojection checks stable surface token, previous world position and normal, roughness, albedo, metallic,
  index of refraction and specular level. Four projected neighbours are considered. The validation computes
  rigid motion and camera projection on CPU; deforming surfaces need appropriate motion inputs from their caller.
- Temporal/spatial reservoirs retain global light IDs. Targets and selected-light visibility are reevaluated
  against current geometry. A sampled visibility change rejects colour history. This is **not** a complete
  all-light visibility-change detector; difficult shadow/specular regions remain noisy and can exhibit filtering bias.
- Light/profile input bytes are compared exactly, not merely hashed. Changes reset history before sampling.
  Arbitrary topology/surface-token reassignment requires an explicit caller reset or submission recreation.
- Current sky/indirect/emissive residual is added after direct-light reconstruction every update. The refresh
  check demonstrates this path, **not** a GPU exitance-cache or multibounce transport implementation.
- Temporal moments use up to sixteen updates and neighbourhood variance clipping; two à-trous iterations reject
  incompatible material, normal and geometric neighbours. This is a reference reconstruction, not quality sign-off.
- `TriangleVisibilitySpace::PackFloat32` retains every facet and expands converted bounds outward. Bounded shader
  stacks fall back to exhaustive triangle scanning rather than dropping occluders.
- LM-63 remains the supported Type-C/TILT=NONE relative-peak subset. The fixture is synthetic, not manufacturer
  measurement or absolute lumen calibration. Existing emissive geometry remains present.
- Native surface export is opt-in and rejects filtering, fog, multiple accumulation updates and non-exact direct
  lighting. The private scratch `.bin` ABI is version 2 with 144-byte receivers. It is diagnostic buffer exchange,
  not a new persistent engine-authored content/configuration format; runtime authoring remains TOML.

## Reproduce

Requires C++17, CMake 3.20+, Node and Python 3.9+. On Linux x86-64:

```bash
PREPARE=1 bash Exhibits/LightCompute/Run.sh
# Subsequent runs:
bash Exhibits/LightCompute/Run.sh
```

The script builds all six Slang entries, renders one exact input plus six moving native inputs, then executes
numerical, sampling, rejection, history, motion and refresh tests. It may take several minutes on the software
device. Pinned downloads, executables, SPIR-V and large surface snapshots stay in ignored storage. Source,
compiled-shader, snapshot and product hashes are recorded in `Results/Manifest.json`.

Direct SPIR-V at `-O0` avoids downstream optimizers absent from the pinned wheel; no tuned performance is claimed.
For another driver use `VULKAN_LIBRARY` and its ICD configuration; `SLANGC` can name a compatible compiler.
Device identity is printed at runtime. The host selects its first compute-capable device, reports ray-query
extension presence, but does not enable hardware acceleration structures/ray queries. Missing limits or numerical
mismatches fail the run. Khronos validation layers were not executed.

`Run.ps1` supplies the Windows entry using MSVC, Vulkan SDK headers, compatible Slang, Node, Python and CMake.
It is supplied **but not executed here**; no Windows binary or GTX/RTX hardware result is claimed.

## Integration boundary

This executes shared shader lighting/history through a native Vulkan validation submission, not the production
editor viewport or a complete GPU renderer. Primary raster and sky/indirect transport remain CPU. Native rigid
motion is tested; deforming scenes, broader history/bias regressions, physical GTX/RTX, hardware ray queries,
Windows and interactive viewport acceptance remain open. Environment/Moon appearance requirements stay deferred.
