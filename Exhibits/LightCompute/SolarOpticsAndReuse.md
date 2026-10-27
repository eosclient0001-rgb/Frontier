# Vulkan solar optics and reuse audit

## Status

| Area | Status |
|---|---|
| Sun disc and mixed flares | Opt-in Vulkan compute in the **LightCompute validation host**, not the editor viewport. |
| Calibration | Angular-size check against NASA; the Gaussian sensor-FWHM conversion is provided, but no measured lens PSF or flare data has been supplied or fitted. |
| ReSTIR GI | Incomplete. The editor viewport is a placeholder; general dynamic reprojection, spatial GI reconnection and multibounce integration are not demonstrated. |
| Device | Linux SwiftShader CPU Vulkan, not a physical GPU, Windows, hardware ray tracing, performance or real-time acceptance. |

## Solar optics

`ResolveSolarVisibility` tests 1,536 limb-weighted source samples against the triangle BVH. `CompositeSolarOptics`
adds a finite-pixel Sun and all enabled flare layers to HDR output. Small discs integrate a Gaussian over each
pixel; resolved discs use a four-by-four midpoint approximation to a blurred limb. The caller supplies
atmospherically attenuated source irradiance, scalar cloud transmission and an optional geometric planet
horizon. Opaque triangles, not glass, fog, per-ray cloud extinction, lunar occlusion or terrain refraction,
are modeled. Off-axis pixel shear is approximated. The PSF and flare parameters are unmeasured.

The six radii `0.4–16 px` gave worst flux error `0.000328`; small-disc samples agreed with an independent
500×500 Cartesian integration within `0.001183` of peak. A half-disc horizon returned `0.50000006`; multiplying
by cloud transmission `0.3` gave flux `0.150000005`. An opaque half-plane at half a solar radius returned
visibility `0.824410`, versus independent chord integration `0.821583`. Warm and anamorphic layers were both
nonzero and additive within `3e-8` of peak. An illuminated scene test preserved the checked geometry pixel
while adding solar light to the sky. These are model/invariant tests, not photographic fidelity or lens
measurements. Exact output and source hashes: [release](Results/SolarOptics-vulkan-release.txt) and
[sanitized host](Results/SolarOptics-vulkan-sanitized.txt); the external driver is not sanitizer-instrumented.

The default solar diameter is `1919.253` arcseconds, consistent with NASA's mean `1919` arcseconds at 1 AU
([NASA Sun fact sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html)). Size varies with distance.
For an on-axis Gaussian core, `CalibrateSolarBlur` converts sensor FWHM to angular sigma using
`FWHM_pixels × pitch_mm / (focal_length_mm × 2√(2 ln 2))`. The 50 mm, 4 µm, 2-pixel example is synthetic.
No lens calibration is implied. Payload normalization and invalid-domain checks passed in
[release](Results/SolarPayload-release.txt) and [ASan/UBSan](Results/SolarPayload-sanitized.txt).

The validation buffer ABI reserves `25 × pixelCount + 13889 + 1536` float4s: 1,536 source samples follow the
old `24 × pixelCount + 13889` region, with a further pixel-sized reserved tail for direct-history metadata.
The solar payload follows the camera's 12 float4s in the angle buffer; counters 20–22 contain RGB visibility.
A future production host must allocate these regions and perform the compute barriers and dispatches explicitly.

## Retained demo temporal counterexample

The retained temporal WGSL merges `Target × Prior.Weight × Tally` without the reconnection Jacobian used in its
spatial pass. An independently area-integrated unit-height square emitter gives receiver shift 1 m: exact
`0.265005`, without the Jacobian `0.563210` (`+112.5%`), with it `0.265005`.
[Release](Results/TemporalReconnection-release.txt) and [ASan/UBSan](Results/TemporalReconnection-sanitized.txt)
are mathematical audits of the retained equation, **not WGSL execution and not a completed GI fix**.

## Reproduce

```bash
python3 Exhibits/LightCompute/Code/Prepare.py  # pinned tools, ignored locally
bash Exhibits/LightCompute/RunSolarOptics.sh
SANITIZE=1 bash Exhibits/LightCompute/RunSolarOptics.sh
bash Exhibits/LightCompute/RunSolarPayloadValidation.sh
SANITIZE=1 bash Exhibits/LightCompute/RunSolarPayloadValidation.sh
bash Exhibits/LightCompute/RunTemporalReconnectionAudit.sh
SANITIZE=1 bash Exhibits/LightCompute/RunTemporalReconnectionAudit.sh
```
