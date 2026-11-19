# Planetary cloud rendering study

Genuine three-dimensional condensate, spherical view/light integration and kinematic wind in shared Slang.
**The photographic target is not accepted. This is an experimental renderer, not completed editor integration.**

[Capture viewer](index.html) · [Matched before/after](Images/Morphology.jpg) ·
[Implementation](../../Experimental/PlanetaryClouds/README.md)

## Verification scope

| Check                       | Observed result                                                        |
|-----------------------------|------------------------------------------------------------------------|
| Release CMake / CTest       | 1/1; 1,475,747 scalar/texel assertions, not independent cases          |
| ASan / UBSan CTest          | 1/1; instrumented shared Slang-C++ execution, no findings              |
| Independent density probes  | 1,696; all twelve selections occupied; light/view densities identical  |
| Geometry / phase / noise    | Double-precision references, normalized HG and both mip chains checked |
| Wind                        | Spherical motion, shear/veer and lower/upper circulation checked       |
| Input rejection             | 25 malformed packets rejected before output writes                     |
| Rendered controls           | A/B/A and zero wind exact; solar-off black; linear relighting          |
| Software Vulkan             | 6,400 density, solar-depth, mip, wind and angular probes               |
| Complete Vulkan beauty      | One 64×36 cumulus fixture; not the complete gallery                    |
| Windows / editor / hardware | **Not verified**; no physical-GPU or real-time claim                   |
| Photographic appearance     | **Not accepted**                                                       |

[Native report](Results/NativeValidation.json) · [Vulkan report](Results/VulkanClouds.json) ·
[Failures and unrun configurations](Results/ExecutionScope.json) · [Evidence checks](Results/EvidenceValidation.json)

Tested on `arena/f2d37e4b-frontier` at `e3fe2313711c18b27a9d7ff3824573d0434dbf9c` with the uncommitted
`Experimental/PlanetaryClouds/`, `Exhibits/PlanetaryClouds/` and linked documentation changes.
Numerical source identity: `55cf319bc99e30f31168b3be7641311c8c525bee6f6f26b9078bf692c5c94e6b`.

The 22 gallery images are **actual Slang-generated C++ execution**, not Vulkan readbacks, browser cloud
simulations, photographs or generated illustrations. A separate 64×36 Vulkan fixture is identified below.
No blur, denoiser, upscaler or previous cloud-colour image supplies the gallery.
Multisampling integrates separate primary rays. PNGs use the reported exposure, ACES fitted curve, then IEC sRGB;
they are not calibrated HDR photography. The browser displays retained images and a six-picture wind timelapse.

### Targeted repetition and erosion repair

[Actual before/after renders](Images/Morphology.jpg) · [Focused measurements](Results/Morphology.json).
Camera, light, exposure and ray budgets match in each pair. The comparison is a JPEG preview at native pixel
sizes; current gallery PNGs remain exact. No image blur, denoising or temporal colour history hides the defects.

- Cirrocumulus now displaces its periodic shape coordinates with three unbounded, rotated/phase-shifted fields.
  Expanded approximate mip footprints account for the deformation; the previous 3,024 m repeat is broken.
- Cumulonimbus retains its broad thermal/anvil shape, with less fine displacement. Fine erosion cannot change
  the sign of a positive density carrier or create disconnected flecks outside it.
- The cyclone uses de-tiled billow coordinates, less small-scale height amplification and coherent spiral
  ice coverage rather than small cellular cutouts. Its eye, large convective relief and separated bands remain.

The fixed regression measures repeated-period density correlation, four-connected native silhouette fragments,
tiny canopy holes and resolved cyclone-top roughness. These are artifact checks, **not photographic scores**.

| Matched-fixture measurement              | Before   | After    |
|------------------------------------------|----------|----------|
| Cirrocumulus one-period correlation       | 0.999535 | 0.065073 |
| Tiny detached cumulonimbus fragments      | 78       | 0        |
| Tiny detached cyclone fragments          | 55       | 3        |
| Tiny enclosed cyclone canopy holes       | 88       | 17       |
| Cyclone-top second-difference RMS, metres | 244.475  | 185.005  |

Tiny means at most four four-connected native pixels, with cloud transmittance below 0.9 defining cloud support.
The top measurement uses four geodesic transects and the highest resolved extinction crossing, not image height.
It retains 6.27 km of large-scale relief. **The other 17 gallery captures remain byte-identical in both complete
Float32 output and PNG** to the pre-repair run; camera, light and transport were not retuned to hide the defects.
Complete density samples, top-crossing profiles and packed support masks are in `Results/Morphology.npz`.
`Code/CloudDensityBefore.slang.gz` retains the exact pre-repair density source; the generating test reconstructs
and authenticates that baseline in a temporary source copy. The other numerical source files are unchanged.

### Bounded complete-entry Vulkan comparison

The corrected source now **dispatches and reads back the full radiance entry** for one cumulus view at **64×36**,
96 view steps, 8 solar steps and one ray/pixel. This is separate from the 22 higher-resolution native gallery images.

| Full-image parity check          | Observed      | Required |
|----------------------------------|---------------|----------|
| Complete-image pixels            | 2,304         | 2,304    |
| Maximum absolute RGBA difference | 0.000634849   | < 0.002  |
| Linear RGB RMSE                  | 0.00000747124 | < 0.0001 |

[Full-entry report](Results/VulkanBeauty.json) · [Actual 64×36 readback](Images/VulkanCumulus.png).
Both complete Float32 arrays are retained in `Results/VulkanBeauty.npz`, not reconstructed from that PNG.
The refreshed run used a 150 s timeout and a 1,900 MiB process address-space cap; pipeline creation took 81.98 s.
This proves one small software-Vulkan execution/parity case, **not** all formations, the native-gallery resolution,
a physical GPU, interactive pacing or photographic quality. Earlier failed attempts remain in the execution report.

## Implemented mechanisms and limits

| Mechanism                 | Implementation                                                         |
|---------------------------|------------------------------------------------------------------------|
| Planetary condensate      | Radial altitude, Cartesian weather, advected shape and erosion         |
| Local shape               | Packed 128³ Perlin–Worley, 64³ erosion, 64² void-and-cluster rank tile |
| Footprint filtering       | Center-aligned 3D mips; native interpolation and Vulkan 3D sampling    |
| Twelve selections         | Ten conventional genera, towering cumulus and a tropical cyclone       |
| Deep convection           | Localized thermal columns with an attached thin anvil                  |
| Cyclone                   | Widening eye, eyewall, spiral rainbands and outer ice outflow          |
| Wind                      | Radial-preserving rotations, altitude shear/veer, differential cyclone |
| Direct scattering         | Normalized dual-lobe HG and Beer attenuation through the same density  |
| Redistributed solar light | Three fitted attenuated angular orders, approximate sky/bounce         |
| Air/cloud ordering        | Approximate atmosphere and optical-centroid ordering                   |
| Receiver illumination     | Position-dependent solar depth through actual condensate               |

One selection occupies one radial deck. These are procedural morphological settings, not coupled multi-deck
meteorological prediction. Advection is kinematic, not a water-mass-conserving fluid solver. The fitted light
orders are **not solved three-dimensional multiple scattering** or calibrated energy-conserving transport.
Footprint attenuation is not an exact integral over subpixel density and can change apparent coverage.

### Reproduced wind defect

A dedicated Vulkan check caught a defect hidden by native-only tests: generic software-ICD trigonometry moved
a planetary wind characteristic radially by up to **91 m**. Bounded sine/cosine and radial reprojection repair it.
The final 256 sheared/veered wind probes match native exactly. A separate four-configuration control retains
256 common positions per configuration: repaired radial error is at most **1 m**, with exact native agreement.
Independent native wind comparisons remain within **1.147 m** of double precision.

[Before/after report](Results/WindPrecision.json) and `WindPrecision.npz` retain rejected/current/native points.
`Code/RejectedWind.slang` reconstructs the rejected wind characteristic, not a complete original renderer.
Its native reference is repaired native code. Float32 planet coordinates still quantize at roughly half-metre
intervals; this is not arbitrary-scale precision certification. Earlier celestial precision code is unchanged.

### Reproduced solar-density defect

Actual solar integration previously interpolated weather from interval endpoints. Although point-density
functions agreed, solar rays traversed different condensate from the visible world field. Weather now evaluates
at every solar sample. The test compares 256 cumulus receivers with 32 identical Float32 quadratic segments
per receiver and matching footprints; it does not substitute a different density definition.

| Optical-depth measurement | Rejected endpoint weather | Corrected per-sample weather |
|---------------------------|---------------------------|------------------------------|
| Maximum absolute error    | 1.534573                  | 0.000332833                  |
| Mean absolute error       | 0.0851198                 | 0.000004192                  |
| Rays exceeding 0.01       | 84 / 256                  | 0 / 256                      |

[Corrected/rejected report](Results/SolarDensity.json) and `Results/SolarDensity.npz` retain all receiver positions,
8,192 direct density samples, segment lengths and expected/corrected/rejected depths. The control recompiles a
temporary source copy with only the solar integration function replaced, authenticates its source identity,
and requires identical reference density samples. Original source files are not overwritten.

The normal software-Vulkan suite also dispatches actual 32-step solar integration at these 256 receivers.
Maximum native/Vulkan optical-depth difference is **0.000083924**. These solar queries are not a complete-image
render, a physical-GPU check, or photographic acceptance. Host/shader coordinate roundoff is allowed; alternative
weather along the light ray is not.

## Sampling, volume and motion evidence

[Finite sampling](Results/CloudMeasurements.json) · [Sampling chart](Images/Sampling.png) ·
[Density sections](Images/DensitySections.png) · [Moving receiver illumination](Images/CloudShadowReceivers.png)

- Sampling compares 64/128/256/384 view budgets against finite 768-view/64-light quadrature at 96×54.
  Light budgets 8/16/32 use the same 768 view budget. This is **not ground truth or full convergence**.
- Light-segment length also changes its footprint. Light refinement changes filtering as well as sample count;
  this measures budget sensitivity, not pure fixed-integrand quadrature error.
- Coherence compares matched world rays from origins 150 km apart, with footprint fixed to 1 m.
  Maximum errors are 0.000359 for cumulus and 0.001251 for cyclone; not atmospheric photograph parity.
- Cross-sections query extinction at world positions, not heights inferred from a picture.
- Receiver panels use a curved-ground normal grid, Lambert albedo 0.4 and ambient 0.008.
  They are **not primary-camera ground beauty images**.
- Wind playback steps through six independent pictures, 30 simulated seconds apart, without interpolation or
  colour history. This is an offline timelapse, not a rendering frame-rate claim.

Timings are local wall time on a two-CPU Linux sandbox, including concurrent validation. They are not controlled
performance comparisons and do not establish a real-time budget.

## Retained precision and storage

[The capture manifest](Results/Captures.json) records inputs, source/library identities, display settings and
whole Float32/PNG hashes. Uninterpolated every-sixteenth-pixel Float32 beauty probes are retained in
`Results/RadianceProbes.npz`; positions and original extents are in `Results/ProbeLayout.json`.
They authenticate corresponding PNG samples, not every pixel of an archived full HDR image.

Complete point inputs/native/Vulkan readbacks are in `Results/VulkanProbes.npz`. Wind/solar-density controls retain
all point arrays and matched quadrature segments. The small Vulkan image retains both complete Float32 arrays.
Density sections are complete; sampling/receiver subsets are in `Results/PrecisionScope.json`.

The existing cumulative delivery is approximately 125.7 MiB before clouds; clouds have a 2.4 MB source/evidence
allocation below the cumulative ceiling. Full gallery HDR pictures and full quadrature image arrays,
generated bytecode, libraries and baked noise therefore stay ignored in `_ClaudeScratch/`, not Git. No earlier
shadow or celestial evidence was removed. [File identities](Results/Integrity.json) are an inventory, not an
external digital signature.

```sh
python Exhibits/PlanetaryClouds/Code/VerifyCloudEvidence.py
```

Default verification is read-only. It validates byte identities, exact Float32-to-PNG probe conversion, inputs
and readback/error statistics. Optional `--library ... --noise ...` replays native point queries.
`--generated-captures ...` and `--generated-measurements ...` verify complete generated images/measurements.
`--negative-controls` rejects altered PNGs, inconsistent Float32 display probes and 100 m wind drift even when
its hash/statistics are updated to match. A fourth control substitutes rejected solar weather and updates its
statistics; the actual density-agreement gate still rejects it. A fifth changes the Vulkan image and its
self-consistent hash/error statistics; fixed parity limits reject it. A sixth restores the original texture
repetition and matching statistics; the fixed repetition limit rejects it. All corruptions stay in a scratch copy.

## Local reproduction

### Prerequisites

- Linux x86-64, GNU C++ 12.2, C++20, Python 3.11.2, CMake 3.31.10 and Ninja were tested.
- NumPy 2.2.6, Pillow 11.3.0; `vulkan` 1.3.275.1 for software-Vulkan checks.
- Slang 2026.14.1 and SwiftShader: existing pinned
  [`Exhibits/LightCompute/Code/Prepare.py`](../LightCompute/Code/Prepare.py).
- Optional SPIRV-Tools v2025.1, revision `f289d047f49fb60488301ec62bafab85573668cc`, with required headers
  `09913f088a1197aba4aefd300a876b2ebbaa3391`. Standalone `spirv-opt` and `spirv-val` are needed for Vulkan checks.
- [Exact archives, binary identities and tested configurations](Results/Provenance.json).

```sh
python -m pip install -r Exhibits/PlanetaryClouds/Requirements.txt
python Exhibits/LightCompute/Code/Prepare.py
cmake -S Experimental/PlanetaryClouds -B _ClaudeScratch/build/CloudCmake \
  -DCMAKE_BUILD_TYPE=Release -DFRONTIER_CLOUD_VULKAN=OFF
cmake --build _ClaudeScratch/build/CloudCmake --parallel 2
ctest --test-dir _ClaudeScratch/build/CloudCmake --output-on-failure
python Exhibits/PlanetaryClouds/Code/CaptureCloudExhibit.py \
  --library _ClaudeScratch/build/CloudCmake/CloudNative.so \
  --noise _ClaudeScratch/build/CloudCmake/CloudNoise.volume \
  --out _ClaudeScratch/tmp/CloudMorphologyCaptures
python Exhibits/PlanetaryClouds/Code/MeasureClouds.py \
  --library _ClaudeScratch/build/CloudCmake/CloudNative.so \
  --noise _ClaudeScratch/build/CloudCmake/CloudNoise.volume \
  --out _ClaudeScratch/tmp/CloudMorphologyMeasurements
python Exhibits/PlanetaryClouds/Code/ValidateCloudMorphology.py \
  --library _ClaudeScratch/build/CloudCmake/CloudNative.so \
  --noise _ClaudeScratch/build/CloudCmake/CloudNoise.volume \
  --after-captures _ClaudeScratch/tmp/CloudMorphologyCaptures \
  --out _ClaudeScratch/tmp/CloudMorphology
python Experimental/PlanetaryClouds/Preview.py --port 4177
```

The capture sequence is offline and takes minutes. Cheaper iteration:

```sh
python Exhibits/PlanetaryClouds/Code/RenderClouds.py cumulus cyclone \
  --width 320 --height 180 --steps 128 --light-steps 12
```

For optional bytecode validation, configure `FRONTIER_CLOUD_OPTIMIZER` and `FRONTIER_CLOUD_VALIDATOR` with actual
executable paths. Both Vulkan tools accept `--slang`, `--optimizer`, `--validator`, paired `--library/--noise`
and `--out`. With the pinned standalone tools already built:

```sh
export LD_LIBRARY_PATH="$PWD/ExternalPackages/VulkanCompute/SwiftShader"
export VK_ICD_FILENAMES="$PWD/ExternalPackages/VulkanCompute/SwiftShader/vk_swiftshader_icd.json"
python Exhibits/PlanetaryClouds/Code/VulkanClouds.py \
  --library _ClaudeScratch/build/CloudCmake/CloudNative.so \
  --noise _ClaudeScratch/build/CloudCmake/CloudNoise.volume \
  --out _ClaudeScratch/tmp/CloudMorphologyVulkan
python Exhibits/PlanetaryClouds/Code/ValidateWindPrecision.py \
  --library _ClaudeScratch/build/CloudCmake/CloudNative.so \
  --noise _ClaudeScratch/build/CloudCmake/CloudNoise.volume \
  --out _ClaudeScratch/tmp/CloudMorphologyWind
python Exhibits/PlanetaryClouds/Code/ValidateSolarDensity.py \
  --library _ClaudeScratch/build/CloudCmake/CloudNative.so \
  --noise _ClaudeScratch/build/CloudCmake/CloudNoise.volume
python Exhibits/PlanetaryClouds/Code/VulkanClouds.py --beauty --views cumulus \
  --library _ClaudeScratch/build/CloudCmake/CloudNative.so \
  --noise _ClaudeScratch/build/CloudCmake/CloudNoise.volume \
  --out _ClaudeScratch/tmp/CloudMorphologyBeauty
```

**Do not invoke `--beauty` expecting photographic, all-formation or real-time acceptance.** Historical raw,
optimized, textured and specialized attempts failed before dispatch. The corrected-source cumulus fixture now
executes, but other formations and gallery-resolution Vulkan images have not been run. Bound resource usage.
The optional optimizer is not provisioned by `Prepare.py`; download the pinned tools/header archives in
`Provenance.json`, check their SHA-256, extract headers into the tools' `external/spirv-headers/`, then:

```sh
cmake -S ExternalPackages/VulkanCompute/SpirvNative/SPIRV-Tools-2025.1 \
  -B _ClaudeScratch/build/SpirvNative -G Ninja -DCMAKE_BUILD_TYPE=Release -DSPIRV_SKIP_TESTS=ON
cmake --build _ClaudeScratch/build/SpirvNative --target spirv-opt spirv-val --parallel 2
```

For instrumentation, configure a separate RelWithDebInfo build with `FRONTIER_CLOUD_SANITIZERS=ON` and
`FRONTIER_CLOUD_VULKAN=OFF`. When Python loads it on GNU/Linux, preload the compiler's `libasan.so`; use
`ASAN_OPTIONS=detect_leaks=0` for CPython-hosted checks and `UBSAN_OPTIONS=halt_on_error=1`. The recorded result is
an address/undefined check, not a CPython/driver leak certification.

`RetainCloudEvidence.py --help` lists the explicit capture, measurement, report, library and noise inputs used
to retain small evidence. Run `VerifyCloudEvidence.py --refresh` only when deliberately refreshing that inventory.

### Viewer checks

`ValidateCloudViewer.cjs` needs Node, `playwright-core` 1.56.1 and an installed Chromium. Pass the module directory
with `--playwright`, Chromium with `--executable` and the served URL with `--url`. It exercises all 22 images,
keyboard/timelapse/mobile behaviour and missing/modified captures/manifests. The visibility-event check is
synthetic and labelled as such. [Actual results](Results/ViewerValidation.json) are not native editor UI evidence.

The reported missing revised clouds were reproduced with warm browser PNG caches, not missing/corrupt disk files.
The viewer now retrieves fresh metadata on selection, requests PNGs with digest-versioned URLs and caches verified
Blobs by digest rather than capture name. The preview serves `no-store` responses and ignores stale conditional
validators. **Reload an already-open preview once to load this viewer fix.** SHA-256 rejection remains enabled.
Three real-HTTP cache regressions cover stale PNGs, stale manifests and updates to an already-open viewer,
authenticating all five revised captures in each case. No Playwright request routing disables caching in these
cases; synthetic prior PNG bytes append a harmless trailer, and Blob inspection does not weaken the page CSP.

On Windows, build through CMake and provide `CloudNative.dll` plus noise to Python. Automatic GNU-style
translation in `RenderClouds.py` is not MSVC. No Windows executable/run is claimed; no Linux binary is packaged.
No GitHub Actions run was requested or used.

## Remaining acceptance work

- Repetition, detached edge flecks and cyclone perforation are reduced in matched renders; visual approval
  of these revisions remains the user's decision. Some convection/cyclone relief still looks procedural.
- Cirrus can read as ribbons, and finite-march grain remains. No temporal smoothing was added to hide it.
- The noise header has been refactored for readability; complete naming/formatting conformance is not audited.
- Gallery-resolution/all-formation Vulkan beauty and a practical execution arrangement remain unverified.
- Windows, physical RTX/GTX, editor, coupled celestial light and real-time performance remain unverified.
  Production `CloudField`, previous celestial implementation and six shadow algorithms are unchanged.

The supplied root patch did not match this checkout and omitted five binary payloads; it was not applied
wholesale. Selected mechanisms were adapted into the isolated sources. Rejected baseline/development defects
and unrun configurations remain explicit in `Results/ExecutionScope.json`.
