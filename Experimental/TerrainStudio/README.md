# Terrain Studio

Real-time 2D authoring + 3D GPU sculpting of landform terrain. Zero-build ES modules — serve the folder and open
`index.html`. UI reuses the ProjectZero editor look; fonts and icons are self-hosted in `Fonts/`.

```
python3 -m http.server 8080 --bind 0.0.0.0 --directory Experimental/TerrainStudio
# open http://localhost:8080            (project from browser storage, if any)
# open http://localhost:8080/?example   (always load the example island)
```

## Workspaces

| Workspace   | Keys | Purpose |
|-------------|------|---------|
| 2D World    | `1`  | infinite pan/zoom world; draw landmass shapes (Lasso `L`, Polygon `P`, Stroke `B`), box a Region `R`, draw splines `S` |
| 3D Landform | `2`  | ray-marched live view of the active region; sculpt with height and volume brushes |
| Split       | `3`  | both panes side by side |

Only the **active region** is evaluated and rendered (world-partition bounds): anything outside its box is not
simulated. One region at a time; `F` focuses both views on it.

## Layers

- **Spline layers** — roads, rivers, canyons, ridges, tunnels; analytic centrelines baked to GPU fields every edit.
  Tunnels carve enclosed tubes through the heightfield via the volume composite.
- **Height sculpt layers** — Raise / Lower / Smooth / Flatten / Noise / Terrace / Erase brushes on a fixed-size
  world-anchored texture per layer per region: unlimited strokes, no "sculpt limit", no mesh rebake.
- **Volume sculpt layers** — Add / Carve / Restore in a dense FLOAT volume for overhangs and caves, composited with
  MIN blending against tunnels and splines.

## Editing model

- Every brush dab is a GPU draw; undo/redo swaps texture snapshots (≤24 snapshots, ≤80 document entries).
- Spline/shape edits re-evaluate only from the dirty layer upward (foundation → stack → tunnels → volume).
- Autosave: document → localStorage instantly, sculpt textures → IndexedDB after 2.5 s idle; export/import as JSON.

## Engine layout (`Engine/`)

| File | Role |
|------|------|
| `WorldDocument.js`      | document format, regions/shapes/layers/splines, (de)serialisation, example island |
| `CurveSampling.js`      | Catmull-Rom centrelines, arc-length resampling |
| `GpuContext.js`         | WebGL2 wrapper, programs, FBO ping-pong, timer query |
| `LandformShaders.js`    | all GLSL: jump-flood coast distance, foundation, spline fields, brush dabs, tunnels, volume composite, ray-march |
| `LandformEvaluation.js` | evaluation pipeline, batched brushes, snapshots, readback/archive |
| `TerrainViewport.js`    | 3D orbit camera, ray-marched landform (lenses: shaded/wire/contour/slope/height), brush picking |
| `PlanarCanvas.js`       | 2D world canvas: grid, shapes, region rects, spline editing, hillshade raster |
| `StudioStorage.js`      | localStorage + IndexedDB persistence, project archive codec |

## Validation

`Validation/TerrainStudio.Validation.mjs` drives the studio headless (real mouse strokes, undo/redo, live spline
edits) and writes captures + `Report.json` to `Exhibits/TerrainStudio/ValidationRun/`. See
`Exhibits/TerrainStudio/README.md` for the measured numbers.
