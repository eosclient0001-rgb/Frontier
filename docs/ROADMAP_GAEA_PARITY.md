# Roadmap — outmatching Gaea (and friends)

## Competitive read (Sept 2026)

| Capability | Gaea 2 | World Machine | Houdini Heightfield | **Frontier v0.1** | **Frontier target** |
|---|---|---|---|---|---|
| True 3D (caves/overhangs) | ✗ (2.5D) | ✗ | ✗ (mostly) | ✅ SDF-native | ✅ + arches/karst systems |
| Rain erosion without smoothing | ~ (thermal/hydraulic blur) | ~ | ~ | ✅ CSG carve + sediment | ✅ + rill network growth |
| Realtime painted simulation | ✗ (build-based) | ✗ | ✗ | ✅ paint rain → simulate live | ✅ multi-chunk live |
| Node workflow | ✅ | ✅ | ✅ | ◐ linear pipeline | ✅ full DAG + subgraphs |
| Sat-style look, no assets | ◐ (needs texturing nodes) | ◐ | ✗ | ✅ procedural stack | ✅ + biome presets |
| Open-world streaming | ✗ (tiles export) | ✗ (tiled build) | ✗ | ✗ (single tile) | ✅ sparse chunks + LOD |
| Export (mesh/SDF/maps) | ✅ | ✅ | ✅ | ◐ OBJ+PNG | ✅ + VDB/USD/FBX |

Frontier's wedge: **realtime SDF carving + paintable simulators + zero-asset sat look**.
Nobody else lets you paint rain on a cliff and watch gullies carve in 3D, live.

## Milestones

### M1 — SDF core + rain carving (this build, v0.1) ✅
- [x] Dense SDF volume + channel set + 3D noise bank (ridged/fbm/warp/strata/terrace)
- [x] Rain particles: ballistic → impact capsule-carve → surface flow + sediment
- [x] Wind saltation/abrasion, 3D thermal talus, chemical dissolution
- [x] Surface-nets mesher + AO/curvature/attribute bake
- [x] Procedural sat-style shader + mask debug views + water plane
- [x] Node pipeline UI + paint tools + presets + OBJ/PNG export

### M2 — Quality + graph (next)
- [ ] Full DAG node editor (drag/drop, subgraphs, per-node 3D preview)
- [ ] Rill/gully network growth (flow-field guided carving, meander)
- [ ] GPU compute backend (WebGPU): SDF build + particles + narrow-band ops
- [ ] Chunked world 4×4 with LOD + dirty-rect remesh workers
- [ ] Shallow-water drape sim (ponds/lakes/rivers that sit in carved basins)
- [ ] Vegetation scatter from biome masks (instanced, procedural)

### M3 — Open world + parity
- [ ] Sparse octree SDF, streaming ring, out-of-core erosion gutters
- [ ] Snow/ice/glacier + coastal wave processes
- [ ] VDB + USD + tiled-mesh export; Unreal/Unity import path
- [ ] Deterministic builds + versioned node graphs (collab-ready)

### M4 — Native power tier
- [ ] C++/CUDA backend, same graphs, 10–100× sim throughput
- [ ] 8k-tile worlds, cinematic path-traced preview
- [ ] Marketplace: shared node subgraphs + biome presets

## Acceptance criteria for "outmatches Gaea" (M3)

1. Side-by-side canyon scene: Frontier shows undercut walls + alcoves Gaea cannot
   represent (impossible in 2.5D — automatic win).
2. Erosion-detail retention metric: after heavy rain sim, high-frequency surface
   energy must *increase* (carved detail), measured by spectral slope — Gaea-class
   tools decrease it (smoothing). Frontier tracks this in stats.
3. Iteration speed: paint rain → see carved result in < 2 s (Gaea: full rebuild).
4. Zero-asset sat look rated comparable in blind A/B from orbit distance.
