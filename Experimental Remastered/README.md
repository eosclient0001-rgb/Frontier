# Experimental Remastered Studio Suite

Unified dark-studio authoring suite following the shared layout, typography (`DM Sans` + `Font Awesome 6 Free`), custom slider-pill, searchable Outliner, and contextual Inspector rules documented in [UI_COMPONENT_GUIDELINES.md](./UI_COMPONENT_GUIDELINES.md).

- **Terrain Studio (`Experimental Remastered/TerrainWorldEditor/`)** — Stage-1 open-world terrain creation system featuring an **Infinite Sparse-Tile 2D Terrain Workspace**, **Separate Toggleable & Editable Terrain Bounds Layers**, a **3D Multi-Terrain Landscape & Ocean Workspace**, WebGL2-accelerated composable procedural landform generators (`Multifractal`, `Fractal fBm`, `Ridged`, `Voronoi`, `Billow`, `Aeolian Dunes`, `Fault Escarpment`, `Volcanic Caldera`, `Dipping Terrace Strata`, `Spline Landform`), **Soft Influence / Noise Falloff** vs **Hard Influence / No Falloff** boundary profiles, simultaneous multi-terrain authoring, space-efficient **Thin Base Surface** triangle meshing, IndexedDB persistence, and `.OBJ` / `.STL` / `.JSON` export (with **Erosion** and **Texturing** workspaces reserved for Stage 2).
- **SDF Sculpt Studio (`Experimental Remastered/SdfSculptEditor/`)** — Real-time WebGL2 hybrid `RGBA16F` 3D volumetric clay sculpting + 24 non-destructive analytical CSG primitives, 10 volumetric sculpting brushes, interactive brush falloff curve editor, 7 studio shading/diagnostic lenses, Dual Surface Nets watertight mesh extraction, and native Frontier `SDF1` `.sdfspace` / `.obj` / `.stl` / `.toml` interchange.

## Quick Start & Validation

```bash
# Serve Experimental Remastered studios on 0.0.0.0:8080
python3 -m http.server 8080 --bind 0.0.0.0

# Run headless validation suites
node "Experimental Remastered/TerrainWorldEditor/TerrainWorldValidation.mjs"
node "Experimental Remastered/SdfSculptEditor/SdfSculptValidation.mjs"
```
