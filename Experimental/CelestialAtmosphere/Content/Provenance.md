# Celestial content provenance

## Existing Moon and stars

The Moon texture is reused **without replacement** from
`EngineContent/CelestialMaps/MoonAlbedoSource2048.jpg`. Its SHA-256 is
`f8c57df90d2a6dce255614e577ef1d846f222fc549e94ba6809e695ab776b5ca`.
The existing [Moon provenance](../../../EngineContent/CelestialMaps/MoonAlbedoProvenance.md) identifies the actual
VehicleHMI texture, upstream revision and unresolved redistribution-rights qualification. No new lunar map is added.
The PPM and linear GPU texels are reproducible decodes of that JPEG; no AI-generated replacement is used.

Stars reuse `Exhibits/NightSky/Data/Hipparcos8.csv`: XHIP, Anderson and Francis (2012), VizieR V/137D, packaged in
`d3-celestial` 0.7.35. The retained CSV identifies the source in its header. There are 41,359 stars, magnitude <=8,
with B-V present. They remain unchanged in the measured-only validation view; authored points are never
reported as new measured catalogue rows.

## Milky Way outlines

| Property         | Pin                                                                         |
| ---------------- | --------------------------------------------------------------------------- |
| Repository       | `https://github.com/ofrohn/d3-celestial`                                    |
| Revision         | `7e720a3de062059d4c5400a379146a601d9010e0`                                  |
| Upstream path    | `data/mw.json`                                                              |
| Retained file    | `MilkyWayContours.json`                                                     |
| Git blob         | `ce06eaa01d80a4eed149c538d2d162c919b58a84`                                  |
| Bytes            | 534254                                                                      |
| SHA-256          | `aee221a7a0e879418e685de00c3e68fbdfac5667c0a8aab74929ef9cf4aab4fb`          |
| Source catalogue | Jose R. Vieira, Milky Way Outline Catalog; upstream readme source [5]       |
| Upstream licence | BSD-3-Clause, Olaf Frohn, original notice retained as `D3Celestial.LICENSE` |

The exact source and attribution can be inspected at the pinned revision:

- [Outline catalogue](https://github.com/ofrohn/d3-celestial/blob/7e720a3de062059d4c5400a379146a601d9010e0/data/mw.json)
- [Upstream source list](https://github.com/ofrohn/d3-celestial/blob/7e720a3de062059d4c5400a379146a601d9010e0/readme.md)
- [Upstream licence](https://github.com/ofrohn/d3-celestial/blob/7e720a3de062059d4c5400a379146a601d9010e0/LICENSE)

This is external astronomical content, not vendored JavaScript or a new rendering dependency. The source file is
byte-identical. `PrepareCelestial.py` converts its five brightness contours to a 1024x512 scalar field using
spherical right-ascension winding / parity and 0.60-degree Gaussian smoothing. Linear brightness weights and
surface photometry are assigned for this experiment; this is **not an absolutely calibrated panorama**.
Astropy checks its orientation and concentration about the real Galactic plane; a broken planar closure is
required to fail the same check. The original licence notice does not independently settle rights in every
underlying astronomical compilation or the already-retained Moon texture.

## Requested galactic bulge and reference star field

| Property             | Pin / ownership                                                          |
| -------------------- | ------------------------------------------------------------------------ |
| Repository           | `https://github.com/SultanAladin/Frontier`                               |
| Requested branch     | `arena/a1dad11b-frontier`                                                |
| Immutable revision   | `c519e983110100a9ed1c17bd3ff97a1c27bef3b9`                               |
| Galactic evaluator   | `Internal/Graphics/Atmosphere/CelestialFieldSolver.cpp`                  |
| Noise evaluator      | `Internal/Graphics/Atmosphere/AtmosphereProfile.h`                       |
| Exact source hashes  | [`ReferenceSource.json`](ReferenceSource.json)                           |
| Reference catalogue  | [`ReferenceStars.csv.gz`](ReferenceStars.csv.gz), deterministic gzip     |
| Reference image      | `Exhibits/CelestialAtmosphere/Images/ReferenceGalacticBulge.png`         |
| Reference image blob | `c687acdd0bec40e6b5da774618cca340e06f2088`                               |
| Project-wide licence | No grant found at the requested revision; permissions remain unconfirmed |

The visible galaxy adapts the native source's disc/bulge, star clouds, Great Rift/Coalsack, domain-warped dust,
reddening and deep-sky profiles to Slang. It is **authored procedural photometry**, not measured panorama content.
The original image is retained byte-identically from `Audit Proof/08_MilkyWayGalacticBulge.png`; it is an upstream
reference, **not** a new local Vulkan capture or evidence that this experiment runs at 1280x720.

The source's catalogue has **156 rounded bright-star entries** and **15,200 authored deep-field points**.
`CelestialUpstreamProbe.cpp` compiles against the original translation unit, validates each exported direction/flux
against the original constructed field, and exports J2000 coordinates, visual magnitude, B-V and provenance.
The compressed retained export does not add synthetic rows to the measured Hipparcos file. Main night views select
this reference field; the independent measured-only view selects all original Hipparcos rows instead.

The source is re-provisioned by pinned Git blob into ignored `ExternalPackages/CelestialReference/<revision>/`.
The original source is **not vendored into production**. Five native exports (stars, basis, galactic probes,
nebular probes and stellar PSF) must match their recorded SHA-256 before Slang/native comparisons are accepted.
The Slang adaptation and retained reference content preserve attribution; no new permission to redistribute,
relicense or commercially use the source's models/content is inferred from public GitHub access or this port.
