# Frontier — SDF Open-World Terrain Studio

**Frontier is an SDF-native (signed distance field) open-world terrain generator with
physics-driven 3D erosion, procedural satellite-style shading, and a node-based
realtime workflow.** It is designed to outmatch heightmap tools (Gaea, World Machine)
by never collapsing the world to a 2.5D heightfield: overhangs, cliffs, caves,
arches and true volumetric carving/deposition are first-class citizens.

> **Core rule: no heightmap erosion, ever.** Every erosive process is a 3D operation
> on the SDF (analytic CSG carving, mass-conservative voxel transfer, per-voxel
> dissolution). Heightfield relaxation is what turns terrain into smooth mud —
> Frontier does not do it (see `docs/SDF_EROSION_SPEC.md`).

## Quickstart (Studio web app)

```bash
cd apps/studio
npm install
npm run dev
# open the printed URL (default http://localhost:5173)
```

- **Generate** builds the SDF volume from the Terrain node stack.
- **▶ Simulate** runs rain / wind / thermal / chemical erosion live.
- **Paint** rain, hardness or eraser masks straight onto the 3D surface.
- **Remesh** is automatic (throttled); toggle wireframe / mask views on the right.

## What makes this different

| Axis | Heightmap tools (Gaea/WM) | Frontier |
|---|---|---|
| Representation | 2.5D height + layers | True 3D **SDF volume + attribute channels** (hardness, sediment, wetness, flow, erosion) |
| Rain erosion | Droplet moves height up/down (smooths) | Ballistic particles **carve capsules/spheres out of the SDF** with kinetic-energy, impact-angle, hardness physics; sediment is transported and **deposited as new SDF** |
| Wind | Directional blur / dune stamp | Saltation + abrasion on windward faces, deposition on lee faces, deflation of loose sediment |
| Thermal | Talus blur kernel | **3D mass-conservative collapse** along the SDF gradient (works on cliffs/overhangs, preserves volume) |
| Chemical | N/A or tint | Per-voxel dissolution driven by wetness × solubility × curvature (karst/pitting) + precipitation |
| Caves/overhangs | Impossible | Native (subtractive 3D noise + worm carving) |
| Color | Hand-painted / megascan blend | **Procedural sat-style synthesis**: strata geology + slope/elevation rules + AO + curvature + flow/erosion/sediment masks. Zero downloaded textures |
| Workflow | Node graph → 2D maps | Node pipeline → **live 3D SDF** with paintable simulator masks |

## Repository layout

```
docs/                        Design specs (read these first)
  ARCHITECTURE.md            System design: representation, pipeline, open-world scaling
  SDF_EROSION_SPEC.md        Math + algorithms for every erosion process
  SHADING_SPEC.md            Sat-style shading model + attribute channels
  ROADMAP_GAEA_PARITY.md     Competitive analysis + milestones
apps/studio/                 Realtime SDF terrain studio (Vite + Three.js + TS)
  src/core/                  SDF volume, 3D noise bank, terrain builders, fields
  src/erosion/               Rain / wind / thermal / chemical simulators
  src/mesher/                Surface-nets polygonizer + AO/curvature baking
  src/render/                Sat-style terrain shader, water, viewport
  src/graph/                 Node pipeline (params, presets, evaluation)
  src/ui/                    Panels, paint tools
```

## Key assumptions (tell me to change any)

1. **Node-based pipeline** — erosion/terrain/color are nodes with params. (Your brief
   mentions node-based twice; v0.1 ships a linear pipeline UI, the graph evaluator
   is designed for a full DAG next.)
2. **Web-first realtime core** (TypeScript + GPU-ready math) so it runs anywhere;
   the SDF/erosion math is written to port 1:1 to a native C++/CUDA backend later
   (see `ARCHITECTURE.md § Native port`).
3. **Procedural color only** — no downloaded satellite imagery; the "satmap look"
   is synthesized from geology + masks (legal + infinite + consistent at any zoom).
4. **Single-tile volume in v0.1** (default 96³, up to 192³) with chunk-ready
   coordinates; sparse chunk streaming is specified in `ARCHITECTURE.md § Open world`.

## Performance notes

- Terrain build is chunked async with progress (no UI freeze).
- Simulators are time-sliced per frame (configurable ms budget).
- Remeshing is throttled and only rebuilds when the SDF changed.

## License

Private — all rights reserved (for now).
