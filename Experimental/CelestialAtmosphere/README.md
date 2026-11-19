# Celestial atmosphere experiment

Executable Slang/Vulkan prototype; **not production editor integration**. Source stays here; generating validation
and actual readbacks stay in [the exhibit](../../Exhibits/CelestialAtmosphere/README.md).

## Implemented paths

| File                         | Mechanism                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `CelestialAtmosphere.slang`  | Complete atmosphere, opaque bodies, catalogue/galaxy and inspection entries    |
| `AtmosphereScattering.slang` | Spherical optical depth, clipped surface/orbit transport, approximate multiple |
| `LunarScattering.slang`      | Same Moon texture, geometric phases, optical libration inputs, tenuous gas     |
| `SolarAtmosphere.slang`      | Finite solar disc, radial falloff, chromosphere, Thomson corona, six flares    |
| `StellarRadiance.slang`      | Pinned reference stars, B-V colour, Gaussian/Moffat PSFs, measured-only mode   |
| `GalacticBulge.slang`        | Requested bulge, star clouds, reddened Rift/dust, nebulae and satellites       |
| `CelestialLens.h/.slang`     | Finite anamorphic repair and independent eight-point star-filter response      |
| `CelestialFootprint.slang`   | Typed input footprint, projection, ray/sphere intervals and density functions  |
| `CelestialScene.h`           | Reused engine coefficients, ephemeris, texture decoder and solar payload       |
| `CMakeLists.txt`             | Isolated native checks, ten Slang entries and explicit-driver Vulkan capture   |

The six selectable lens terms are **aperture ghosts, six-ray aperture diffraction, anamorphic streak,
antipode halo, veiling glare and eight-point star-filter burst**. Ghosts, diffraction, halo and veil reuse the
existing engine solar/lens model. The experimental anamorphic repair adds finite tapered reach, transverse bloom,
blue coating response and 4x4 pixel coverage. The sixth term is a separate four-axis / eight-ray star filter,
not a renamed copy of the existing six-ray diffraction. All six are additive and driven by finite-source visibility
and spectral atmospheric extinction; their coefficients remain unmeasured lens parameters.

## Requested Milky Way and stars

The selected source is `SultanAladin/Frontier`, branch `arena/a1dad11b-frontier`, pinned to
`c519e983110100a9ed1c17bd3ff97a1c27bef3b9`. This is a Slang port of its actual native galactic model, not an
image pasted behind the sky. The port retains the source's quintic lattice hash, rotated fBm, thin/thick disc,
warm bulge, star clouds, Great Rift/Coalsack, domain-warped filamentary dust/reddening and seven nebular/satellite
profiles. The original 1280x720 reference image is retained separately and attributed in the exhibit.

All four night presentations use its **156 rounded bright-star entries + 15,200 authored deep-field stars**.
These 15,200 points are **not measured catalogue expansion**. The original **41,359 Hipparcos/XHIP rows** remain
unchanged in the additional `MeasuredCatalogueSpace` validation view; the two catalogues are not stacked together.
The main four views replace the old densely exposed, Gaussian-only appearance with the requested reference field
and 82% Gaussian (sigma .62 px) / 18% Moffat (alpha 2.4 px, beta 2.5) point-spread treatment.

The Gaussian is pixel-integrated analytically and the Moffat term with four-node Gauss-Legendre quadrature per axis.
A declared 25x25 support omits at most 0.0921% of infinite-profile flux; independent eight-node full-image integration
checks the finite image rather than silently calling the truncated PSF exactly flux conserving. The measured-only
view preserves the original strict Gaussian full-image flux and independent Astropy astrometric gates.

`Content/ReferenceSource.json` pins original Git blobs and content/fixture SHA-256 identities. Reproduction
compiles the original upstream evaluator outside Git and requires byte-identical exports before comparing the
Slang bulge, nebulae and PSF. See [content provenance](Content/Provenance.md) for ownership qualifications.

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
- Stars: selectable pinned reference field or the unmodified measured Hipparcos/XHIP J2000 CSV. The latter has
  magnitude <=8 and retained B-V values. First-order precession and UTC-as-UT1 rotation are the engine's
  approximations. Proper motion, nutation, refraction and interstellar spectral corrections are absent.
- Galaxy: the requested **authored** reference model, not calibrated HDR imagery. Real IAU equatorial/galactic
  orientation is checked independently. The older Vieira/d3-celestial outlines remain only as a retained
  orientation/negative-control fixture; they no longer determine the visible galactic brightness.

All radiance is linear relative to unit incident solar irradiance; RGB coefficients are a broadband approximation.
Photographic display exposures are recorded per capture and applied before fitted ACES and sRGB encoding.
Moon phase/solar closeups and flare images are prescribed optical fixtures, not claims about the actual 2026-11-18 sky.
The six time-of-day views use actual computed solar angles on that date. The 90-degree zenith case explicitly
uses a subsolar-latitude calibration site because the Sun does not reach zenith at Benoni that day.

## Host / shader footprint

Eight storage descriptors and a 128-byte push footprint are reflected and checked for all ten entries.
`CelestialScene::Compile` writes 64 float4 configuration slots, 48 padding floats and the existing solar payload.
The host sets `Primary.y=256`, placing that solar payload at float offset 304. All distances below are kilometres.

| Slots | Meaning                                                                                     |
| ----- | ------------------------------------------------------------------------------------------- |
| 0-3   | Planet-centred camera position, basis, vertical tangent, aspect, display exposure           |
| 4-9   | Sun direction/radius, incident RGB, Rayleigh/aerosol/ozone parameters and planet radii      |
| 10    | Atmosphere, Moon, Sun and catalogue enable selections                                       |
| 11    | Galaxy, lens, exosphere radiance gain, opaque ground selections                             |
| 12-14 | Moon direction/radius, north/earthshine, optical sub-observer longitude/latitude            |
| 15-17 | J2000-equatorial-to-local orthogonal basis columns                                          |
| 18-22 | Lunar gas, lunar surface, solar gas, solar selections and texture dimensions                |
| 24-30 | Occlusion diagnostic, legacy PSF width, step count, Galactic rotation, ground and star flux |
| 31-32 | Experimental anamorphic strength/angle/reach/width and separate star-filter parameters      |
| 33    | Rejected legacy anamorphic selection, enabled only for the before-repair diagnostic         |
| 34    | Reference-vs-Hipparcos catalogue and revised-vs-legacy stellar PSF selections               |

Descriptors: 0 configuration; 1 linear lunar texels; 2 galactic scalar field; 3 48-byte stellar entries;
4 16x16 tile offsets/indices; 5 atmosphere tables; 6 output and finite-source samples; 7 counters/probe inputs.
Output radiance, atmosphere and transmission remain separate Float32 planes. Every allocation has a 64-byte
write guard. Explicit host/compute/readback barriers and synchronous fences are validation machinery, not an
asynchronous, device-local or real-time performance implementation.
