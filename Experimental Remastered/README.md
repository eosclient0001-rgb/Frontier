# Experimental Remastered

Unified **Sun Inspector + Fluid Editor + Vehicle Lab** studio interface across Frontier's interactive authoring workspaces. Shared layout, control, typography, and diagnostic rules are documented in [UI_COMPONENT_GUIDELINES.md](./UI_COMPONENT_GUIDELINES.md).

- **SDF Terrain Studio (`Experimental Remastered/TerrainWorldEditor/`)** — Open-world SDF terrain authoring: infinite sparse-tile 2D world mask, independent toggleable Terrain Bounds Boxes, multi-terrain 3D Ocean landscape, space-efficient Thin-Slab SDF, composable fractal / cellular / ridged / spline layer stack, per-layer Edge-to-Center and Cliff Falloff modes, and `.OBJ` / binary `.STL` triangle export. Ships with 3 demonstration masks and terrains. See [TerrainWorldEditor README](./TerrainWorldEditor/README.md).
- **SDF Sculpt Studio (`Experimental Remastered/SdfSculptEditor/`)** — Real-time WebGL2 hybrid `RGBA16F` 3D volumetric clay sculpting + 24 non-destructive analytical CSG primitives, 10 volumetric sculpting brushes, interactive brush falloff curve editor, 7 studio shading/diagnostic lenses, Dual Surface Nets watertight mesh extraction, and native Frontier `SDF1` `.sdfspace` / `.obj` / `.stl` / `.toml` interchange.

## Provenance

Ported verbatim from `unassignedinbox/Frontier` at `9331bf3` (`feat: add 3D Clay Studio and Open-World Thin-Slab SDF Terrain Studio`), which is the pre-erosion state requested for this workspace. Newer commits on that branch (`63351d9` and later, physically based multi-process erosion, presets, Gaea texturing) are intentionally not included here; erosion is the next step after this workspace is committed.

The Terrain Studio CSS inherits the Clay Studio design system (`SdfSculptEditor.css`) and its self-hosted fonts, so both studios are ported together. No external CDN links are used.

## Quick start

```bash
# SDF Terrain Studio + SDF Sculpt Studio (port 8087, bound to 0.0.0.0)
python3 "Experimental Remastered/SdfSculptEditor/Serve.py"
```

Open `http://0.0.0.0:8087/` in a browser. The server redirects to the Terrain Studio. Use the hub at `Experimental Remastered/index.html` to switch studios.

## Validation

```bash
node "Experimental Remastered/TerrainWorldEditor/TerrainWorldValidation.mjs"
node "Experimental Remastered/SdfSculptEditor/SdfSculptValidation.mjs"
```

Both suites run headless in Node with no build step. Retained results and heightmap evidence live under `Exhibits/TerrainStudio/`.
