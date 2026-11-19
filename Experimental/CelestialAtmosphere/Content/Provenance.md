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
with B-V present. This experiment does not independently remeasure or expand that catalogue.

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
