# Terrain Authoring — 2D world plan + 3D SDF relief

Browser prototype (WebGL2, no build step) for real-time terrain landform authoring: an infinite 2D world plan where
shapes are drawn and terrain regions are boxed, spline layers (road, river, canyon, ridge, tunnel) that cut the
landform, and a 3D raymarched SDF view with unlimited GPU sculpting. Every region owns its own layer stack. Visual
language follows the ProjectZero editor (`unassignedinbox/Frontier` `arena/429d7dc7-frontier`,
`Experimental/ProjectZeroEditor`).
Evidence, timings and the SDF-versus-voxel decision:
[TerrainAuthoringValidation](../../Exhibits/TerrainAuthoringValidation/README.md).

## Run

```sh
cd Experimental/TerrainAuthoring
python -m http.server 8080 --bind 0.0.0.0     # Windows: py -m http.server 8080
```

Open `http://localhost:8080/` in Chrome or Edge (WebGL2 + `EXT_color_buffer_float` required).
`?example` forces the example world; otherwise the last document autosaved in this browser is restored.

## Regions and layer stacks

| Rule | Behaviour |
|---|---|
| Ownership | Each region (terrain cell) owns its layer stack, listed under it in the Outliner (caret collapses it) |
| Evaluation | A region evaluates only its own stack; editing region 2 never changes region 1 |
| New geometry | A shape stroke or new spline belongs to the region under its first point (active region where regions overlap) |
| Outside every region | Content goes to **Unassigned** (not evaluated); boxing it with Bounds `R` adopts every overlapping layer |
| Outliner add buttons | Add to the stack of the selected layer, else the active region (label shows the target) |
| Selection | Selecting a layer or spline makes its region active; reordering stays inside the owning stack |
| Delete region | Removes the region and its stack (undoable) |
| Coordinates | Layers stay in world space, so world-space noise and splines line up across neighbouring regions |
| Old files | Version 1 documents (one world-wide stack) migrate each layer to the first region it overlaps |

## Controls

| Input | 2D plan | 3D relief |
|---|---|---|
| `V` Select | Pick regions, splines, points; drag bound handles / label to resize / move a region | Drag spline points on their plane; `Alt`+drag = lift |
| `D` Shape | Drag a closed stroke (`X` toggles add / subtract) into the region under the cursor | — |
| `R` Bounds | Drag a box = new region with its own stack (`Shift` = square) | — |
| `P` Spline | Click to add points, `Enter` / RMB to finish | Click on terrain to add points |
| `B` Sculpt | Paint on the plan | Paint on the surface; `Ctrl` invert, `Shift` smooth |
| Navigation | RMB / MMB / `Space` drag pan, wheel zoom | RMB orbit, `Shift`+RMB / MMB pan, wheel dolly |
| Global | `1` 2D, `2` 3D, `3` split, `F` frame, `[` `]` brush radius, `Ctrl+Z` / `Ctrl+Y`, `Ctrl+S` save, `Delete` | |

## Architecture

| File | Responsibility |
|---|---|
| `Source/WorldDocument.js` | Regions owning layer stacks (shape, spline, sculpt), unassigned stack + adoption, JSON v2 encode/decode with v1 migration, edit history |
| `Source/SplineSampling.js` | Centripetal Catmull–Rom resampling, stroke condensation, spline sample/group atlases |
| `Source/TerrainStackEvaluation.js` | Per-cell GPU layer stack: JFA shape SDFs + cached shape noise, binned spline corridors, sculpt rasters, cached prefix restarts (warmed on selection), sculpt / spline region (scissored) evaluation, sparse tunnel SDF volume, derived normal/AO/shadow/tile-max fields, picking |
| `Source/ShaderLibrary.js` | GLSL ES 3.0 programs for every pass above plus the plan and relief renderers |
| `Source/PlanViewport.js` / `ReliefViewport.js` | 2D plan render + overlay; orbit camera, adaptive-resolution SDF raymarch + overlay |
| `Source/Application.js` / `InterfacePanels.js` | Session, tools, pointer routing, sculpt stroke spacing, persistence; ProjectZero dock panels |
| `Source/PerformanceProbe.js` | In-app edit-cost benchmark (World inspector → Performance) — run it on your GPU |
| `Source/GpuDevice.js` / `RasterArchive.js` | WebGL2 wrapper (programs, targets, readbacks, timer queries); IndexedDB sculpt autosave |

## Why there is no sculpting limit

The previous prototype stored each sculpt stroke as an analytic CSG primitive evaluated per ray step
(`MAX_CSG_NODES = 24`), so evaluation cost grew with every stroke until a hard cap. Here a stamp is one GPU quad
into a per-cell R32F delta raster: cost depends on brush area only, memory is fixed per cell, and the stack above
the edited layer is re-evaluated only inside the stamped rectangle while a stroke is in progress.

## Limits

- Browser prototype only — it does not demonstrate C++ / Vulkan / Slang editor parity.
- One active cell evaluates live; other cells refresh when the input is idle. Cells do not share borders yet.
- Tunnels are the only true 3D (overhang) feature; Rock Studio, erosion and simulation are out of scope.
- Sculpt and spline edits use exact region evaluation (spline footprints per spline, groups binned per 32² tile).
  Shape edits re-evaluate the full cell; their relief noise is cached per layer, but a stroke edit still rebuilds
  the jump-flood distance field over the whole cell (about 0.8 s of 2.0 s at 1024² under SwiftShader).
- GPU memory of the example cell at 1024² is 89 MB, including the per-layer noise and spline bin caches.
