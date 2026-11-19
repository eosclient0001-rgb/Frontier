# Celestial atmosphere experiment

Executable Slang/Vulkan prototype; **not production editor integration**. Source stays here; generating validation
and actual readbacks stay in [the exhibit](../../Exhibits/CelestialAtmosphere/README.md).

## Implemented paths

| File                         | Mechanism                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `CelestialAtmosphere.slang`  | Complete atmosphere, opaque bodies, catalogue/galaxy and inspection entries    |
| `AtmosphereScattering.slang` | Spherical optical depth, clipped surface/orbit transport, approximate multiple |
| `LunarScattering.slang`      | Same Moon texture, geometric phases, optical libration inputs, tenuous gas     |
| `SolarAtmosphere.slang`      | Finite solar disc, radial falloff, chromosphere, Thomson corona, five flares   |
| `StellarRadiance.slang`      | Measured Hipparcos stars, B-V colour, integrated PSFs, equatorial galaxy map   |
| `CelestialFootprint.slang`   | Typed input footprint, projection, ray/sphere intervals and density functions  |
| `CelestialScene.h`           | Reused engine coefficients, ephemeris, texture decoder and solar payload       |
| `CMakeLists.txt`             | Isolated native checks, ten Slang entries and explicit-driver Vulkan capture   |

The five selectable lens terms are **aperture ghosts, diffraction starburst, anamorphic streak, antipode halo
and veiling glare**. They reuse the existing engine solar/lens model, remain separately selectable and combine
linearly. They respond to the finite source's visibility and spectral atmospheric extinction. Coefficients describe
an unmeasured parametric photographic lens, not a calibrated commercial lens.

## Run

Install the validation dependencies from `../../Exhibits/CelestialAtmosphere/Requirements.txt`, provision a C++20
compiler, CMake, Slang and a Vulkan SDK/driver, then follow the
[reproduction commands](../../Exhibits/CelestialAtmosphere/README.md#reproduction).
`../../Exhibits/CelestialAtmosphere/RunCelestial.sh` builds, executes and verifies every requested view.
Use Ninja or another single-configuration generator with that Bash launcher. CMake targets also work independently.
No GitHub Actions, network access at rendering time, engine/editor target changes or binary delivery are required.

Open [the retained viewer](../../Exhibits/CelestialAtmosphere/Celestial.html) through a local HTTP server to inspect
real renders. It is a capture browser, **not a live JavaScript reimplementation of the shaders**.

## Physical interpretation

- Earth: engine Rayleigh, Cornette-Shanks aerosol and ozone parameters; 6360/6460 km radii. View-ray integration
  uses 192 surface / 256 orbit midpoints, a 256x64 optical-depth table and a 32x16 directional-average isotropic
  multiple-scattering closure. The closure is approximate, not a converged volumetric path trace.
- Moon: retained `EngineContent/CelestialMaps/MoonAlbedoSource2048.jpg`, decoded from sRGB before filtering.
  Lommel-Seeliger surface shading and empirical phase dimming reuse the engine convention. Optical libration is
  approximate Meeus ch.53; physical libration, lunar terrain and calibrated spectral reflectance are not supplied.
  Surface and orbit views use observer-appropriate topocentric positions and apparent radii.
- Lunar gas: an **optically thin nominal exosphere**, not an Earthlike atmosphere. The reference exponential
  number-density profile has 50 km scale height / 300 km cutoff and RGB ground scattering coefficients
  `[2.1e-17, 5e-17, 1.22e-16] / km`. These are representative Rayleigh-scale coefficients, **not measured LADEE
  densities or a full collisionless/chemical exosphere model**. Opaque lunar shadow clips incident sunlight.
  Physical-scale radiance is effectively invisible; the separately labelled x1e14 view amplifies **radiance only**.
- Sun: 0.0046524 rad mean apparent radius; quadratic limb coefficients 0.38/0.24; 35 microradian sensor-edge
  Gaussian falloff. The solar-atmosphere path integrates a quiet-corona electron density
  `1e8 * (2.99/r^16 + 1.55/r^6 + 0.036/r^1.5) cm^-3` with Thomson scattering to 8 solar radii. Chromospheric
  colour/height are a simple illustrative H-alpha-like radial component, not spectral plasma simulation.
  The coronal capture masks the photosphere and changes camera exposure, not density.
- Stars: the existing 41,359-row Hipparcos/XHIP J2000 CSV, magnitude <=8, with retained B-V values. First-order
  precession and UTC-as-UT1 rotation are the engine's approximations. Proper motion, nutation, refraction and
  interstellar spectral corrections are absent. The catalogue/accuracy scope is explicit in the exhibit.
- Galaxy: pinned Jose R. Vieira/d3-celestial equatorial Milky Way outlines, with correctly closed circumpolar
  rings. Surface brightness and 0.60-degree smoothing are assigned, **not a measured HDR photograph**. No random
  stars substitute for the measured catalogue. See [content provenance](Content/Provenance.md).

All radiance is linear relative to unit incident solar irradiance; RGB coefficients are a broadband approximation.
Photographic display exposures are recorded per capture and applied before fitted ACES and sRGB encoding.
Moon phase/solar closeups and flare images are prescribed optical fixtures, not claims about the actual 2026-11-18 sky.
The six time-of-day views use actual computed solar angles on that date. The 90-degree zenith case explicitly
uses a subsolar-latitude calibration site because the Sun does not reach zenith at Benoni that day.

## Host / shader footprint

Eight storage descriptors and a 128-byte push footprint are reflected and checked for all ten entries.
`CelestialScene::Compile` writes 64 float4 configuration slots, 48 padding floats and the existing solar payload.
The host sets `Primary.y=256`, placing that solar payload at float offset 304. All distances below are kilometres.

| Slots | Meaning                                                                                |
| ----- | -------------------------------------------------------------------------------------- |
| 0-3   | Planet-centred camera position, basis, vertical tangent, aspect, display exposure      |
| 4-9   | Sun direction/radius, incident RGB, Rayleigh/aerosol/ozone parameters and planet radii |
| 10    | Atmosphere, Moon, Sun and catalogue enable selections                                  |
| 11    | Galaxy, lens, exosphere radiance gain, opaque ground selections                        |
| 12-14 | Moon direction/radius, north/earthshine, optical sub-observer longitude/latitude       |
| 15-17 | J2000-equatorial-to-local orthogonal basis columns                                     |
| 18-22 | Lunar gas, lunar surface, solar gas, solar selections and texture dimensions           |
| 24-30 | Occlusion diagnostic, PSF width, step count, Galactic rotation, ground and star flux   |

Descriptors: 0 configuration; 1 linear lunar texels; 2 galactic scalar field; 3 48-byte stellar entries;
4 16x16 tile offsets/indices; 5 atmosphere tables; 6 output and finite-source samples; 7 counters/probe inputs.
Output radiance, atmosphere and transmission remain separate Float32 planes. Every allocation has a 64-byte
write guard. Explicit host/compute/readback barriers and synchronous fences are validation machinery, not an
asynchronous, device-local or real-time performance implementation.
