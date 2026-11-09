# Frontier — Experimental Remastered SDF Terrain & Clay Studios

Zero-build, real-time WebGL2 **Signed Distance Field (SDF)** studios styled in Frontier's **Experimental Remastered** (**Sun Inspector + Fluid Editor + Vehicle Lab**) dark warm-amber studio theme:

1. **[Open-World SDF Terrain Studio](./Experimental%20Remastered/TerrainWorldEditor/)** (`Experimental Remastered/TerrainWorldEditor/`)
   - **Infinite Sparse-Tile 2D World Mask Editor**: Paint continents, islands, bays, and fjords across an infinite kilometer coordinate space (`256×256` sparse tiles allocated only where painted) and draw independent, toggleable **Terrain Bounds Boxes** (`TerrainRegion`).
   - **Seamless 2D ↔ 3D + Ocean Workflow**: Switch instantly between `1 · 2D World Mask`, `2 · 3D Landscape + Ocean`, and `3 · Split 2D + 3D`, viewing and editing **one terrain individually, selected terrains, or all enabled terrains simultaneously** in a shared animated 3D Ocean.
   - **Space-Efficient Thin-Slab SDF Architecture**: 2D masks initialize as a thin flat surface near sea level (`-6.5 m` underside wafer) and build upward — zero SDF budget or triangles wasted deep under the ocean — while supporting 3D sculpting/overhangs, Catmull-Rom splines, and watertight `.OBJ` / binary `.STL` triangle mesh conversion.
   - **Composable Base Landform Layer Stack & Per-Layer Boundary Falloffs**: Includes `Hybrid Multifractal`, `Ridged Mountain Noise`, `Voronoi / Mesa Blocks`, `Billow Hills & Dunes`, `Terrace & Strata`, `Spline Landform`, and `SDF Sculpt`, each with configurable **Boundary Falloff** (`Soft Edge → Strong Center`, **`None — Full Cliff at Edge`**, `Continental Power`, `Plateau Rim`, `Coastal Rim Ring`, `Bounds Box Feather`, and `Custom Curve`).
   - **3 Pre-Built Demonstration Masks & Terrains**: `Highland Massif` (Soft + Continental falloffs + River Valley spline), `Basalt Sea Cliffs` (`None` falloff for sheer ocean cliffs + Voronoi mesa + strata benches), and `Caldera Atoll` (Coastal Rim Ring falloff + Canyon breach).

2. **[3D SDF Clay Sculpt Studio](./Experimental%20Remastered/SdfSculptEditor/)** (`Experimental Remastered/SdfSculptEditor/`)
   - Real-time hybrid `RGBA16F` 3D volumetric clay sculpting + 24 non-destructive analytical CSG primitives, elastic auto-expanding domain bounds, Dual Surface Nets meshing, and `.sdfspace` interchange.

## Launch

```bash
python3 "Experimental Remastered/SdfSculptEditor/Serve.py"
```

## Validation

```bash
node "Experimental Remastered/TerrainWorldEditor/TerrainWorldValidation.mjs"
node "Experimental Remastered/SdfSculptEditor/SdfSculptValidation.mjs"
```
