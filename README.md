# Frontier. — Experimental Remastered Terrain & SDF Studios

Zero-build, real-time WebGL2 authoring studios built in Frontier's **Experimental Remastered** dark-studio design system:

## 1. [Frontier. Terrain Studio](./Experimental%20Remastered/TerrainWorldEditor/) (`Experimental Remastered/TerrainWorldEditor/`)

Stage-1 Terrain Creation Studio organizing open-world landform authoring into a structured 4-workspace architecture (**1. 2D Terrain**, **2. 3D Landscape**, plus **Split 2D + 3D**, with **3. Erosion** and **4. Texturing** reserved for Stage 2):

- **Workspace 1 — Infinite 2D Terrain Canvas (`Engine/WorldMask2D.js`, `Engine/WorldMap2DCanvas.js`)**
  - Unbounded sparse-tile 2D mask coordinate space (`256×256` tiles at `1000 m` per tile, `O(visible)` viewport culling, automatic empty-tile pruning) supporting brush strokes, coastal bays/inlets, closed polygon landmasses, organic silhouette stamps (`Island`, `Archipelago`, `Atoll`, `Continental Block`), and non-destructive multi-mask boolean composition (`Union`, `Subtract`, `Intersect`).
  - **Separate Toggleable & Editable Terrain Bounds Layers**: Every terrain region owns an independent `boundsLayer` that toggles `ON/OFF` globally or per-region across 2D & 3D, locks, auto-expands to painted masks, or resizes/translates via 8-handle 2D gizmos and Inspector controls without destroying underlying 2D mask pixels.
- **Workspace 2 — 3D Landscape & Ocean Viewport (`Engine/TerrainLayerStack.js`, `Engine/GpuTerrainStackPipeline.js`, `Engine/TerrainOceanViewport.js`)**
  - **Composable Non-Destructive Layer Stack**: Stack, reorder (`↑`/`↓`), duplicate, toggle visibility, and blend (`add`, `subtract`, `max`, `min`, `lerp`, `multiply`) procedural geological generators (`Hybrid Multifractal`, `Fractal Noise (fBm)`, `Ridge Noise`, `Voronoi / Cellular`, `Billow Hills`, `Aeolian Dunes`, `Fault Escarpment`, `Volcanic Caldera`, `Dipping Terrace Strata`), `Spline Landforms` (ridge, graded corridor, carved valley), and `3D Relief Sculpt` layers — accelerated via WebGL2 `RGBA32F` ping-pong FBO evaluation with bit-compatible CPU fallback.
  - **Per-Layer Boundary Falloff & Influence**: Choose **Soft Influence / Noise Falloff** (gradual elevation taper from coastline to interior with organic fBm feathering) or **Hard Influence / No Falloff** (`100%` generator strength right up to the cliff boundary), plus `Continental`, `Plateau`, `Rim`, `Bounds`, and interactive `Custom Curve` modes.
  - **Simultaneous Multi-Terrain Selection & Authoring**: View and edit a single terrain (`Solo`), multi-selected terrains (`Shift+Click`, 2D marquee, or `Select All`), or all enabled terrains together in a shared 3D **Ocean** sea-level stage (toggleable `ON/OFF`). Supports simultaneous multi-terrain bounds dragging, synced layer/falloff edits, and cross-region 3D relief brushing.
  - **Space-Efficient Thin Base Surface & Triangle Export**: Terrains build upward from a thin flat base wafer near sea level with `0%` empty-ocean triangle waste, `4×4` coarse interior underside block decimation, watertight perimeter cliff skirts, IndexedDB auto-save (`Engine/WorldStorage.js`), `.JSON` project round-trip, and `.OBJ` / binary `.STL` triangle mesh export.
  - **3 Built-In Example Terrain Masks**: `Terrain 01 · Alpine Peninsula` (Soft Noise Falloff), `Terrain 02 · Basalt Headland` (Hard / No Falloff coastal cliffs), and `Terrain 03 · Caldera Archipelago` (mixed Volcanic Caldera + Aeolian Dunes + Spline stack).

## 2. [Frontier. SDF Sculpt Studio](./Experimental%20Remastered/SdfSculptEditor/) (`Experimental Remastered/SdfSculptEditor/`)

Real-time hybrid `RGBA16F` 3D volumetric clay sculpting + 24 non-destructive analytical CSG primitives, elastic auto-expanding domain bounds, Dual Surface Nets meshing, and native `.sdfspace` interchange.

## Launch

```bash
python3 -m http.server 8080 --bind 0.0.0.0
```

Then open `http://localhost:8080/Experimental%20Remastered/TerrainWorldEditor/`.

## Headless Validation

```bash
node "Experimental Remastered/TerrainWorldEditor/TerrainWorldValidation.mjs"
node "Experimental Remastered/SdfSculptEditor/SdfSculptValidation.mjs"
```
