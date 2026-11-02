# Planetary Surface Studio

A compact, source-cited planetary data viewer with a separate set of clearly labelled AI-generated moon UV textures. Sourced products, derived visualizations, and AI illustrations remain distinct. This is a **visualization prototype**, not a research-grade measurement or GIS package.

## Run and test

```sh
npm test --prefix Experimental/Editors/PlanetarySurfaceStudio
python3 Experimental/Editors/Serve.py
```

Open the shared editor portal and choose **Planetary Surface Studio**. It uses the pinned Three.js package shared with the Photometric Editor. A WebGL-capable browser is required for interactive globes and lighting.

## Catalog and sourced data

There are 16 objects: four planets, ten moons, and two dwarf planets. Ceres and Pluto remain in the catalog.

| Object | Source map | Elevation data | Important limit |
|---|---|---|---|
| Luna (Earth's Moon) | AI UV texture is a separate illustrative mode; no sourced colour map bundled | LRO LOLA LDEM_128 | Relief mode shows downsampled height-derived colour, not lunar albedo. |
| Earth | NASA Blue Marble topography/bathymetry composite (Dec. 2004) | NOAA ETOPO 2022 v1 | Older shaded composite, not current imagery or raw reflectance. |
| Mars | USGS Viking Color Mosaic 925 m | MGS MOLA global DEM 463 m | Viking is pseudo-colour; baked relief is retained and labelled. |
| Mercury | MESSENGER MDIS mosaic 665 m | MESSENGER DEM v2, 665 m | RGB uses 1,000/750/430 nm bands, not human-eye colour. |
| Venus | Magellan synthetic-colour C3-MDIR radar mosaic | Magellan global topography | Radar visualization, not visible-light photography/albedo. |
| Ceres | Dawn FC DLR 20 px/degree mosaic | Dawn FC HAMO DLR DTM 60 px/degree | Monochrome image; DTM about 98% coverage with polar interpolation. |
| Pluto | New Horizons LORRI–MVIC global mosaic | New Horizons stereo DEM | Terrain is principally the flyby hemisphere, not globally measured. |

Source-product records, citations, terms, native resolutions and caveats are in the Inspector's collapsed **Source & limits** cards and `planet-data.mjs`.

## AI moon UV textures

Ten individually generated, approximately 2:1 equirectangular textures are wrapped onto 3D spheres in the **AI UV** mode:

- **Luna** (Earth): maria and cratered highlands; its independent LOLA elevation view remains available.
- **Io, Europa, Ganymede, Callisto** (Jupiter).
- **Titan, Enceladus** (Saturn); **Triton** (Neptune); **Phobos, Deimos** (Mars).

The textures are illustrative only—not spacecraft imagery, measured albedo, source maps, or terrain data. Each image is shifted horizontally to place its lowest-contrast longitude seam at the UV wrap; its longitude origin is arbitrary and has no geographic meaning. AI-only moons have no elevation mode, coordinate readout, or invented sensor/product citation. Luna's LOLA data remains separately available. Texture detail and local dark features come from the generated illustration; the sphere's day/night terminator is produced by directional lighting. No moon surface texture is being presented as spacecraft-derived science imagery.

## Data derivatives and rendering

- Six sourced surface-map files are 4,096 × 2,048 lossy WebP derivatives. Upstream processing baked in `0.30 + 0.70 × hillshade` at 315° azimuth / 45° altitude. **SOURCE MAP** mode therefore avoids dynamic relighting to prevent double shading.
- Seven height files are 1,024 × 512 signed-int16 little-endian metres. They are downsampled derivatives (about 0.352° per cell, roughly 10.7–39 km at the equator depending on body), not native DEMs. Upstream filled missing/non-finite values with 0 m and retained no validity mask. Coordinate samples are approximate, bilinearly interpolated previews—not authoritative measurements.
- **ELEVATION** mode displaces the globe with the derivative and uses a computed display palette. The palette is not observed surface colour. Vertical exaggeration defaults to 1× and is adjustable.
- **AI UV** mode applies an AI texture to a sphere lit by the scene's directional light; the visible terminator is lighting, not a painted portrait silhouette. It is not a scientifically calibrated albedo response.
- Each body is normalized to fill the viewport; sizes are not comparable in this display.
- The source maps and height grids were extracted from [Planeteria](https://github.com/melvinchia3636/planeteria) `gh-pages` derivatives at `73c5610794371eeb7b47165984696c126d31c2dd`. Its pipeline code is MIT-licensed; the notice is in `assets/PLANETERIA-LICENSE.txt`. Underlying product attribution and terms still apply. `scripts/import_planeteria_assets.py` reproduces the local extraction.

## Atmosphere and clouds

The adjustable atmosphere is a restrained, shader-based limb glow that tapers smoothly into the background. It is a visual effect, not a scattering simulation. No cloud map or time series is bundled, so no cloud layer is shown or synthesized. Ring rendering is not offered without a sourced optical-depth model.

## Product citations and reuse

- **Earth:** NASA Earth Observatory, [Blue Marble: Next Generation with Topography and Bathymetry](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/) and NOAA NCEI [ETOPO 2022](https://www.ncei.noaa.gov/products/etopo-global-relief-model).
- **Luna elevation:** NASA PDS Geosciences Node [LOLA](https://pds-geosciences.wustl.edu/missions/lro/lola.htm), LDEM_128. Consult its PDS label and product documentation. Luna's AI UV texture is not a source-data asset.
- **Mars:** USGS [Viking Color Mosaic 925 m](https://astrogeology.usgs.gov/search/map/mars_viking_global_color_mosaic_925m) (public-domain access) and [MGS MOLA DEM 463 m](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m) (CC0/public domain).
- **Mercury:** USGS [MESSENGER MDIS colour mosaic](https://astrogeology.usgs.gov/search/map/mercury_messenger_mdis_global_color_mosaic_665m) and [global DEM v2](https://astrogeology.usgs.gov/search/map/mercury_messenger_global_dem_665m); cite the product authors/team.
- **Venus:** USGS [Magellan synthetic-colour mosaic](https://astrogeology.usgs.gov/search/map/venus_magellan_global_c3_mdir_synthetic_color_mosaic_4641m) and [global topography](https://astrogeology.usgs.gov/search/map/venus_magellan_global_topography_4641m); product records list public-domain access and request citation.
- **Ceres:** USGS [Dawn FC mosaic](https://astrogeology.usgs.gov/search/map/ceres_dawn_fc_global_mosaic_400m) and [HAMO global DTM](https://astrogeology.usgs.gov/search/map/ceres_dawn_fc2_hamo_global_dtm_137m); cite Dawn/DLR and USGS authors.
- **Pluto:** USGS [New Horizons mosaic](https://astrogeology.usgs.gov/search/map/pluto_new_horizons_lorri_mvic_global_mosaic_300m) and [stereo DEM](https://astrogeology.usgs.gov/search/map/pluto_new_horizons_lorri_mvic_global_dem_300m); cite New Horizons and USGS authors.

Consult provider pages for reuse and redistribution terms; do not imply NASA/USGS endorsement. The [Planeteria data register](https://github.com/melvinchia3636/planeteria/blob/main/DATA_SOURCES.md) documents raster inputs, but is not the licence for those source products.

## UI and scope

The interface follows the supplied segmented charcoal/gold reference, with responsive library, viewport, controls and concise object cards. The Photometric Editor remains untouched; Vector Field Studio remains removed. No native-resolution streaming, ephemerides, calibrated radiometry, scientific GIS, or production C++ scene serialization is implemented.
