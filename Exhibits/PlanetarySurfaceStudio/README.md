# Planetary Surface Studio verification

## Validation

The app now uses rectangular, approximately 2:1 AI-generated moon UV textures wrapped on interactive 3D bodies. These are kept distinct from the six sourced surface maps and seven sourced elevation grids. The prior AI globe portraits and portrait-only CSS overlay have been removed.

- **Planetary source/data and editor suites:** 11/11 tests passed. Coverage includes catalog, all ten UV files and their JPEG dimensions/aspect ratios, source derivatives, elevation sampling, longitude wrapping, complete editor-directory links, responsive layout, texture lighting, atmosphere shader and disclosures.
- **Photometric Editor suite:** 11/11 tests passed; editor source files were left untouched.
- **Syntax/format checks:** JavaScript syntax checks, Python importer compile and `git diff --check` passed.
- **HTTP routes:** all eight hub destinations returned HTTP 200, along with the tested Three.js and Jolt runtime modules and planetary assets.
- **Browser verification:** headless Chromium rendered the eight-link hub at desktop and mobile sizes; all quick links were visible at 390 px. The four standalone-editor routes rendered; Light Studio and Fracture Editor showed their 3D canvases. Both core editors rendered without console/request errors; Callisto's AI UV texture appeared on a lit 3D sphere. Alloy and Project Browser loaded without console/request errors. The vehicle demos' files load after their documented `npm ci` setup, but this headless browser has no WebGPU adapter, so those scenes show their expected unavailable-adapter message. Responsive widths from 320 to 1,440 px had no horizontal overflow.

Vesta remains excluded because its published int16 derivative clips elevation values. Europa is included as an AI UV illustration only, not as sourced surface or terrain data. The aesthetic CGI Moon texture remains excluded; Luna's AI UV texture and LOLA elevation data are separate display modes.

## Reproduction

```sh
npm test --prefix Experimental/Editors/PlanetarySurfaceStudio
node --check Experimental/Editors/PlanetarySurfaceStudio/app.mjs
node --check Experimental/Editors/PlanetarySurfaceStudio/planet-data.mjs
python3 -m py_compile Experimental/Editors/PlanetarySurfaceStudio/scripts/import_planeteria_assets.py
python3 Experimental/Editors/Serve.py
```

Open `/` for the portal or `/Experimental/Editors/PlanetarySurfaceStudio/` directly. WebGL is required for interactive globes, textures and lighting. The old portrait assets have been retired; generated AI UV illustrations live under `assets/moon-uv/`.

## Visible data limits

The bundled 4,096 × 2,048 lossy WebP maps have DEM hillshade baked in and are not raw albedo. Elevation is a 1,024 × 512 int16 little-endian metre derivative with no retained NoData mask; upstream replaced missing/non-finite cells with zero. Readouts are approximate, not authoritative. Pluto terrain is principally limited to its flyby hemisphere, and some Ceres polar areas are interpolated. Mosaics vary in instrument/filter and are not all human-eye colour.

The approximately 2:1 AI moon textures are illustrations, not spacecraft imagery, measured albedo or scientific maps. Each is horizontally shifted to place the lowest-contrast longitude seam at the wrap; the prime meridian is arbitrary. Their surface details are generated; the visible day/night boundary is directional scene lighting. The atmospheric limb glow is a smooth visual effect, not physical scattering. There is no cloud map, cloud animation or sourced ring optical-depth layer. The responsive charcoal/gold cards follow the supplied segmented-button reference. The Photometric Editor remains untouched; Vector Field Studio remains removed.
