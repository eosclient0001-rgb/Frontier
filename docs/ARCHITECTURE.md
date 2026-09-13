# Frontier Architecture

## 1. Representation — SDF volume + attribute channels

The world is a scalar field `f(p) : R³ → R`, negative inside solid, positive outside,
with `|∇f| ≈ 1` near the surface (maintained by fast sweeping after bulk edits).

Each voxel stores:

| Channel | Type | Meaning |
|---|---|---|
| `sdf` | f32 | Signed distance (m). The ground truth surface is `f = 0` |
| `hard` | f32 0..1 | Rock hardness (resists carving; from strata + noise + paint) |
| `sed` | f32 ≥ 0 | Loose sediment thickness (available for pickup / wind deflation) |
| `wet` | f32 0..1 | Water saturation (drives chemical + softening + darkening) |
| `flow` | f32 ≥ 0 | Accumulated water flux (drives color streaks, capacity) |
| `erode` | f32 ≥ 0 | Cumulative erosion mask (exposes "fresh rock" color) |
| `rain` | f32 0..1 | Painted rain emitter mask (simulator input) |
| `sol` | f32 0..1 | Mineral solubility (chemical input, from strata id) |

v0.1: dense `Float32Array` volume per tile (96³ default, 192³ max ≈ 200 MB with all
channels — use 128³ for comfort). All coordinates are world-space; tiles carry an
`origin`, so chunking is a container change, not a math change.

### Why SDF and not heightmap / density / mesh

- Boolean + smooth CSG ops are trivial and exact (`union=min`, `subtract=max(f,-g)`).
- Gradient = surface normal anywhere; Hessian = curvature; cone tracing = AO —
  no neighborhood hacks.
- Particles collide by sphere tracing; carving is a local CSG op — no remeshing,
  no topology surgery, no smoothing.
- Narrow-band updates keep erosion O(surface), not O(volume).

## 2. Pipeline

```
 ┌────────────┐   ┌───────────┐   ┌──────────┐   ┌───────┐   ┌───────┐
 │ Terrain    │   │ Thermal   │   │ Rain     │   │ Wind  │   │ Chem  │
 │ SDF build  │──▶│ relax (3D)│──▶│ particles│──▶│ salt. │──▶│ karst │──▶ SDF+attrs
 └────────────┘   └───────────┘   └──────────┘   └───────┘   └───────┘
        ▲ paintable masks (rain / hardness / solubility) ──────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
              Surface-nets               Sat-style shader
              mesher + bake              (AO/curv/flow/…)
              (LOD, throttled)           zero bitmaps
```

- **Nodes** own params + enabled/bypass + their own state (particle pools).
  v0.1 evaluates a linear pipeline; the evaluator API (`graph/evaluator`) is shaped
  for a DAG (each node declares inputs/outputs; dirty propagation by version id).
- **Simulators are stateful and progressive**: each frame they consume a time budget,
  mutate the narrow band, and bump the SDF version. The mesher rebuilds (throttled)
  when the version changes inside the visible band.
- **Paint tools** write directly into mask channels (`rain`, `hard`, …) with a
  3D spherical stamp at the raycast hit — painting *is* node input.

## 3. Noise bank (shared by terrain + erosion + shading)

All noises are **3D, seeded, deterministic**, implemented once in TS (`core/noise`)
with identical WGSL/GLSL twins for the GPU path:

- `value3`, `perlin3` (improved), `fbm3`, `billow3`
- `ridged3` — Musgrave ridged-multifractal with per-octave weights
  (the mountain/carve workhorse)
- `domainWarp3` — fbm-warped coordinates (non-repetitive ranges)
- `terrace3`, `strata3` — stepped bands + warped geologic strata coordinates
- `voronoi3` (F1/F2) — crack/cell patterns for rock + karst seeding

Terrain SDF sketch:

```
base   = p.y - baseHeight
mount  = ridged(x,z) * mountainAmp          (domain-warped)
detail = fbm3(p) * detailAmp
terr   = terrace(...) blended by mask
caves  = smooth-subtract billow3(p) where below surface & caveMask
f(p)   = base - mount + detail  ...  (all true 3D, caves carve regardless of height)
hard   = strata bands + fbm, sol from band id
```

## 4. Erosion (SDF-native) — summary

Full math in `SDF_EROSION_SPEC.md`. Invariants every process obeys:

1. **Conservation**: removed solid mass becomes either carried sediment or deposited
   solid — tracked in `stats` (carved vs deposited vs in-flight). Nothing vanishes
   into a blur kernel.
2. **Locality**: ops touch voxels within a physical radius (crater, saltation hop,
   talus step). No global smoothing passes.
3. **Hardness-aware**: every removal rate is modulated by `hard` (and softened by `wet`).
4. **Mask-driven**: rain/wind/chemical all read painted + procedural masks, so
   "paint rain here, press simulate" works.

## 5. Meshing + baking

- **Surface Nets** over the narrow band (no MC tables, watertight-ish, smooth
  normals from SDF gradients). Per-vertex bake: normal, AO (Quilez 5-tap SDF AO),
  mean curvature (gradient divergence), and all attribute channels.
- Remesh triggers: SDF version change + throttle (default ≤ 1 rebuild / 250 ms,
  or on demand). Later: per-chunk dirty rects + async workers.
- LOD (specified, not in v0.1): chunked surface nets / Transvoxel with skirts;
  far chunks mesh a downsampled SDF (factor 2/4/8).

## 6. Shading — procedural sat-style

No image textures. The terrain shader layers (see `SHADING_SPEC.md`):

```
strata geology base → slope/elevation biome rules → curvature/AO sculpting
 → flow/sediment streaks → wetness darkening → erosion-mask fresh rock
 → triplanar micro grain → sun + hemisphere + wet specular + fog
```

Mask-debug views (flow/erode/wet/sed/AO/curvature) are one click — essential for
tuning erosion without guessing.

## 7. Open world (specified for v0.2+)

- **Sparse chunk grid**: 64 m chunks, voxel 0.5 m near → SDF stored per chunk in an
  octree; far chunks keep only coarse SDF + baked mesh.
- **Streaming**: ring buffer around camera; background workers build/mesh;
  deterministic seeds ⇒ chunks rebuild identically.
- **Erosion scope**: simulators run on active chunks + 1-ring gutter (particles can
  cross chunk borders via the gutter; carve ops lock the overlapped region).
- **Water**: separate shallow-water heightfield draped on the SDF surface per
  active chunk (rendered as one clipped mesh), fed by `flow` accumulation.

## 8. Native port (C++/CUDA, later)

The TS core is written port-first: flat typed arrays, no GC in hot loops, integer
lattice indexing, seeded value noise (bit-identical spec in `noise.ts` header).
Porting = transliterating `core/*` + `erosion/*` to C++ with GPU compute for the
particle + narrow-band loops; the node graph serializes to JSON understood by both.

## 9. Module map (apps/studio/src)

- `core/noise.ts` — seeded 3D noise bank
- `core/volume.ts` — SDF volume + channels, sampling, gradients
- `core/sdf.ts` — CSG combinators + terrain builders + presets
- `erosion/particles.ts` — pooled particle store + carve/deposit CSG ops
- `erosion/rain.ts` — ballistic rain → impact carve → surface flow + sediment
- `erosion/wind.ts` — saltation/abrasion/deflation/deposition
- `erosion/thermal.ts` — 3D mass-conservative talus
- `erosion/chemical.ts` — dissolution/precipitation (karst)
- `mesher/surfaceNets.ts` — polygonizer + AO/curvature/attribute bake
- `render/materials.ts` — sat-style terrain shader + water
- `render/viewport.ts` — three.js scene, lights, sky, rain points
- `graph/nodes.ts` — node defs, params, presets
- `ui/panels.ts`, `ui/paint.ts` — editor UI + 3D paint tools
- `main.ts` — app wiring, time-sliced loop, remesh scheduler
