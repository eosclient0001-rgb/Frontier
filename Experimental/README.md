# Experimental

Requested prototypes, experimental HTML, scripts, styles, assets, and launchers belong together here.
Do not place reusable production code or permanent validation reports here.
The approved C++ editor comparison mirror belongs in `Exhibits/EditorMirror/`.
Earlier prototypes are retained under `Documentation/Plans/References/InheritedEngine/Prototypes/`;
new prototypes belong here. Review launcher and asset references before relocating anything.

## Workspaces

- **SDF Terrain Studio (`Experimental Remastered/TerrainWorldEditor/`)** — Open-world SDF terrain authoring: infinite sparse-tile 2D world mask, independent toggleable Terrain Bounds Boxes, multi-terrain 3D Ocean landscape, Thin-Slab SDF, composable landform layer stack with per-layer falloffs, splines, sculpting, and `.OBJ` / `.STL` triangle export. Ships with 3 demonstration masks and terrains. Ported from `unassignedinbox/Frontier` at `9331bf3` (pre-erosion state). See [TerrainWorldEditor README](./Experimental%20Remastered/TerrainWorldEditor/README.md).
- **SDF Sculpt Studio (`Experimental Remastered/SdfSculptEditor/`)** — Real-time WebGL2 hybrid `RGBA16F` 3D volumetric clay sculpting with CSG primitives, brushes, Dual Surface Nets meshing, and `.sdfspace` interchange. Ported together with the Terrain Studio because the Terrain Studio CSS and fonts inherit from it. See [SdfSculptEditor README](./Experimental%20Remastered/SdfSculptEditor/README.md).
