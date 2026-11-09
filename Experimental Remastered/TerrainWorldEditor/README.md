# SDF Terrain Studio (`Experimental Remastered/TerrainWorldEditor/`)

Open-world SDF terrain authoring in Frontier's **Experimental Remastered** studio theme. Zero-build, real-time WebGL2, no external dependencies.

## Workflow

- **Infinite 2D world mask** — Paint continents, islands, bays, and fjords across an unbounded kilometer coordinate space. Mask tiles are `256x256` sparse tiles (`1 tile = 1000 m x 1000 m`); tiles allocate only where painted and prune when erased, so empty ocean costs zero bytes.
- **Terrain Bounds Boxes** — Draw a box around a painted shape to define one terrain. Each box is a separate `TerrainRegion` layer with its own on/off toggle, so terrains simulate and export independently for massive open-world games. Work on one terrain, selected terrains, or all enabled terrains at once.
- **3D Landscape + Ocean** — Switch between `1 · 2D Mask`, `2 · 3D Landscape`, and `3 · Split 2D + 3D`. The 3D view shows all enabled terrains in one shared animated ocean with ACES tone mapping.
- **Thin-Slab SDF** — 2D masks initialize as a thin flat surface near sea level (`-6.5 m` underside wafer) and build upward. No SDF budget or triangles are wasted deep under the ocean. The slab is authoring-only; export converts to triangles (`.OBJ` / binary `.STL`).

## Layer stack and falloffs

Each terrain owns a composable bottom-to-top layer stack. Base landform generators include Hybrid Multifractal, Ridged Mountain Noise, Voronoi / Mesa Blocks, Billow Hills and Dunes, Terrace and Strata, Spline Landform, and SDF Sculpt. Spline modes cover elevation ramps, rock bridges / overhang arches, mountain crests, river valleys, canyon gorges, and lake basins. Sculpting supports 2.5D height dabs and true 3D overhang / cave SDF.

Every layer has a per-layer Boundary Falloff driven by exact metric distance-from-coastline (Meijster O(N) Euclidean SDF):

- `Soft Edge to Strong Center` — influence fades to zero at the coastline and reaches full strength inland.
- `None — Full Cliff at Edge` — full strength right at the coastline, for sheer sea cliffs. Use this when no falloff is wanted.
- `Continental Power`, `Plateau Rim`, `Coastal Rim Ring`, `Bounds Box Feather`, and `Custom Curve` for plateau, atoll, and box-edge blends.

## Demonstration terrains

Three pre-built masks and terrains ship with the studio:

- `Terrain 01 · Highland Massif` — Soft + Continental falloffs with a Glacial River Valley spline.
- `Terrain 02 · Basalt Sea Cliffs` — `None` falloff for sheer ocean cliffs, Voronoi mesa blocks, and strata benches.
- `Terrain 03 · Caldera Atoll` — Coastal Rim Ring falloff with a canyon breach.

## Quick start and validation

```bash
python3 "Experimental Remastered/SdfSculptEditor/Serve.py"
node "Experimental Remastered/TerrainWorldEditor/TerrainWorldValidation.mjs"
```

## Scope

This workspace covers the 2D mask editor and 3D landscape with ocean, base landforms, splines, and sculpting only. Terrain simulation (erosion, rock / cliff studio, seasonal climate) and Gaea-style texturing are not included yet; they follow as the next step after this workspace is committed. Retained validation results and heightmap evidence live under `Exhibits/TerrainStudio/`.
