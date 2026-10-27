# Night sky, Sun, Moon and lens flare exhibit

Native CPU renderer (no GPU, headless). Reproduce:
`PYTHON=<venv python with Pillow> bash Exhibits/NightSky/RunNightSky.sh`
(GCC, `-std=c++17 -Wall -Wextra -Werror`).

Production code under test, all in `Frontier/Engine/Rendering/`: `CelestialModel`
(solar position, lunar phase, photographic lunar surface sampling, Lommel–Seeliger disc
radiance), `AtmosphereModel` (Rayleigh/Mie/ozone transmittance LUT, single + factored
multiple scattering), `LensFlareModel` (ghost layout, limb-darkened sun disc with
Gaussian-blurred analytic limb, aperture ghosts, diffraction starburst, anamorphic
streak, halo, glow, veiling glare). Display mapping is the demonstration's own
Narkowicz ACES (`DisplayPresent.wgsl` `ProjectFilmic`) with the exact sRGB transfer.

## Demonstration parity (audited 2026-10-26)

| Demonstration source (`Experimental/SlateReference/…/VehicleProvingGrounds`) | Production form |
|---|---|
| `AtmosphereScattering.wgsl` Bruneton constants (5.802e-6/13.558e-6/33.1e-6 /m, Mie 3.996e-6/4.40e-6, H 8/1.2 km, ozone tent 25 km, R 6360/6460 km) | Identical in `AtmosphereParameters`; Mie extinction total pinned by check. The former production default double-counted Mie extinction (8.4e-3/km, albedo 0.48) — corrected to absorption 0.404e-3/km (albedo 0.908) |
| WGSL single-scattering quadrature into a 192×108 sky-view texture | `SingleScattering` + transmittance LUT on CPU; multiple scattering is the production factored approximation, sun-gated and calibrated to the 10–30% clear-sky range |
| `DirectRadiance.wgsl` hard solar disc (`cos > 0.99998 → +2500×`) | Replaced by `EvaluateSunDiscRadiance`: quadratic limb darkening (limb 0.38 of centre) with an erfc Gaussian-blurred analytic limb, disc flux checked against the analytic integral |
| Lens flare | **Absent from the demonstration tree** (no flare/streak code in either SlateReference copy or `ReSTIR.html`). `LensFlareModel`'s radiance layer is new production work, measured here; the pre-existing ghost placement table is unchanged |
| Moon | Light direction only in the demonstration; no disc, no texture files anywhere in the tree. The photographic surface map in `EngineContent/CelestialMaps` (see its provenance note) replaces the previous procedural-noise maria |

## Images

| Image | What it shows |
|---|---|
| `Images/SunDiskLensFlare.png` | 16:30 SAST sun in a 30° field: scattering sky + forward aureole, sun disc, six aperture ghosts, 6-spike starburst, horizontal anamorphic streak, antipode halo. Exposed for the sky (ACES ×1.15), as a real sun photograph must be |
| `Images/SunDiscClose.png` | Same sun at 3.2° field, flare-in-sky exposure (×0.5) |
| `Images/SunDiscFiltered.png` | The identical radiance at solar-filter exposure (centre at ACES input 0.6): the limb-darkening law and blurred analytic limb, sky black — the disc outshines the sky ~10⁵:1, no single exposure shows both |
| `Images/MoonClose.png` | Moon at 20:30 SAST (illuminated 0.995, alt 19.9°), photographic surface map, true pole orientation for Benoni (lunar north points left-down at moonrise), libration sub-observer (+4.86°, −6.50°), atmospheric tint |
| `Images/NightSkyMoonField.png` | Night field centred on the Moon at true angular size, Hipparcos stars |
| `Images/NightSkyCatalogueMilkyWay.png` | Night field aimed at the brightest Milky Way band point above 25° |
| `Images/MoonPhases.png` | New, first quarter, full, last quarter with the Sun's real lit side; earthshine on the dark side; no atmospheric tint (phase-geometry study) |
| `Images/DuskSequence.png` | Sun at +14, +2, −2, −6, −12, −18° at azimuth 270, one honest exposure across tiles (elevation sweep, not a time series) |

## Checks (33 PASS, `Results.txt`)

- Sun elevation vs `CelestialModel::SunPosition`: 1.7e-13°. Equatorial round trip 1.7e-16 rad.
- Hipparcos catalogue: 41,359 stars. Lunar map loads 1024×512; named-feature orientation
  samples (Tycho 0.916 > 2.9× Plato 0.318; Crisium 0.421 dark).
- Mie extinction total = 4.40e-3/km exactly (demonstration parity). LUT bakes; zenith blue
  (B/R 3.50); toward-sun brighter 3.10×; sunset horizon warm (R/B 547 at −2°). Multiple-
  scattering factor 0.256/0.187/0.117 (physical range, sun-gated).
- Moon: raster lit fraction vs geometry 9.5e-5; close disc area vs πr² 0.99998;
  Lommel–Seeliger full-disc flatness exact (1.0 at 0.7 radii, the property Lambert fails);
  earthshine present <2% of full; quarter dimming = exp(−1.10·π/2) = 0.1777; libration
  latitude vs independent pole geometry agrees 0.29°; longitude inside ±8.5°.
- Sun disc: integrated flux vs analytic limb integral = 1.00001; radiance at limb = 0.19
  (½ × 0.38 limb law under the Gaussian edge); blurred limb strictly falling; rendered
  centre/limb/outside = 1.509e5 / 2.846e4 / 2.106.
- Flare: zero visibility removes all ghosts; centres collinear 1.4e-17; isolated rendered
  ghost centroids ≤0.01 px (6/6); flare exactly linear in visibility; streak anisotropic
  (across < 1e-6 of along); starburst from 6 blades measures 6 spikes.
- Regression gate: `Exhibits/EnvironmentPipeline` still 73/73 with these production files.

## Limits, stated plainly

- **Clouds: unchanged.** Nothing here touches cloud appearance; the blocky-cloud issue stays open.
- **Lunar position** remains the Meeus low-precision series; optical libration is Meeus ch.53
  at matching precision (pole taken as the IAU mean pole RA 273.85°/Dec +66.54°). No topocentric
  parallax, no moonlight contribution to scene lighting, no eclipse/earthshine phase coupling.
- **Lunar map** is 1024×512 (~10 km/px at the sub-observer point): correct maria/crater layout,
  not relief shading. Licence position is documented in the provenance note; re-verify before
  commercial release, as with the Hipparcos catalogue (XHIP via d3-celestial, BSD-3).
- **Phase law** exp(−1.10|g|) is an empirical shadow-hiding fit, calibrated to full/quarter
  magnitudes, not a Hapke model. No opposition-surge spike.
- **Flare** is a parameterised photographic-lens model (blade count, coating tints, streak
  axis) with exact visibility/irradiance scaling — not a ray-traced multi-element lens, no
  sensor saturation/blooming simulation, no dust/scratch diffraction texture.
- **Atmosphere** stays a CPU precomputation: single scattering with a factored multiple-
  scattering approximation, not the demonstration's GPU sky-view texture and not Hillaire's
  full multi-scatter LUT chain. Sky colours are not verified against photographs.
- **Not verified:** physical GPU, Windows, real-time rendering, Slang/Vulkan forms of these
  models (the formulations here are the portable reference such a port must measure against).

## Clean-checkout restoration — 2026-10-27

The linked branch ignored `EngineContent/CelestialMaps`, so the claimed retained Moon source was absent.
The three.js `r170` source JPG and distribution licence are now tracked, with source/conversion hashes in
`EngineContent/CelestialMaps/MoonAlbedoProvenance.md`. The runner generates the PPM automatically.
All 33 checks re-ran successfully, and all eight retained PNGs reproduced byte-for-byte on GCC 12.2 / Pillow.
The image is **not absolutely calibrated lunar reflectance**; its earlier JPL/USGS attribution remains unverified.
This restoration does not establish texture parity with the user's other demo revision, nor physical-photo validation.
