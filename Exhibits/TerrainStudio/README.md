# Terrain Studio — Validation Evidence

Headless evidence for the ported SDF Terrain Studio workspace (`Experimental Remastered/TerrainWorldEditor/`). The studio itself is a zero-build WebGL2 app; this exhibit retains the engine validation output and CPU-rendered heightmaps generated from the same engine code, not browser screenshots.

## Reproduction

```bash
node "Experimental Remastered/TerrainWorldEditor/TerrainWorldValidation.mjs"
node "Experimental Remastered/SdfSculptEditor/SdfSculptValidation.mjs"
node Exhibits/TerrainStudio/Code/GenerateHeightmaps.mjs
```

Platform: Linux sandbox, Node v22.22.3, Python 3.11.2. Tested revision: port of `unassignedinbox/Frontier` at `9331bf3` into `eosclient0001-rgb/Frontier` on branch `arena/29706210-frontier`. No uncommitted engine changes; the ported JS is verbatim from `9331bf3`.

## Results

- Terrain Studio: 7/7 suites pass. See [Results/TerrainWorldValidation.txt](./Results/TerrainWorldValidation.txt).
- SDF Sculpt Studio: 9/9 suites pass. See [Results/SdfSculptValidation.txt](./Results/SdfSculptValidation.txt).

| Terrain | Grid | Max height | Land area | Triangles |
| ------- | ---- | ---------- | --------- | --------- |
| Terrain 01 · Highland Massif | 148x143 | 232.5 m | 1.60 km2 | 47,632 |
| Terrain 02 · Basalt Sea Cliffs | 140x130 | 198.7 m | 0.96 km2 | 38,428 |
| Terrain 03 · Caldera Atoll | 136x93 | 152.2 m | 1.11 km2 | 22,568 |

Triangle counts include the thin underside wafer (`includeUnderside: true`). Heights are CPU-evaluated from `EvaluateTerrainRegion` over each region's Bounds Box.

## Heightmaps

CPU-rendered from the engine's `heights`, `coverage`, and `sdf2D` fields. Ocean is depth-darkened blue; land is hypsometric (green lowland, brown highland, white peak).

- [Images/heightmap-highland.png](./Images/heightmap-highland.png) — Highland Massif: fjord bay on the east coast, white alpine peak.
- [Images/heightmap-cliffs.png](./Images/heightmap-cliffs.png) — Basalt Sea Cliffs: mesa blocks with sheer edges, two sea-stack islets west.
- [Images/heightmap-atoll.png](./Images/heightmap-atoll.png) — Caldera Atoll: coastal rim ring with central lagoon.

Grayscale companions (`height-gray-*.png`) are the same fields without hypsometric tint.

## Limitations

- Heightmaps are top-down CPU renders, not the WebGL2 ocean viewport. The 3D ocean, spline gizmo, and sculpting interactions require a browser and were not captured in this sandbox.
- No erosion, rock / cliff studio, seasonal climate, or Gaea texturing is included; those are the next step after this workspace is committed.
