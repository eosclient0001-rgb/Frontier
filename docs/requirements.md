# Frontier SDF — Requirements Research

Why an SDF + node-graph + particle-erosion terrain tool, what the references do,
and what v1 covers vs. the roadmap to AAA production use.

## 1. What the pros use (reference tools)

| Tool | Representation | Erosion | Notes |
|---|---|---|---|
| Gaea | Heightfield + masks | Thermal, hydraulic, flow-maps | Node/graph hybrid, artist gold standard for heightfields |
| World Machine | Heightfield | Droplet + fluvial geomorphology | Macro/micro erosion, tiling |
| Houdini Heightfields | Heightfield volumes | Erode (thermal+hydraulic), flow | Fully procedural, sims are batch, not live agents |
| Houdini SDF / Labs | SDF volumes (VDB) | Boolean + noise workflows | True 3D but erosion is faked with noise |
| Claybook (game) | Dynamic SDF + raymarch | N/A (clay sim) | Proves SDF+raymarch ships in real games |
| Dreams (game) | SDF surfels ("fleas") | N/A | Proves SDF scales to authored AAA content |

Gap: nobody ships a **live, node-based, SDF-volume terrain tool with real
transporting particle agents** (rain, rivers, wind, rockfall) in the browser.
Heightfields cannot do caves, arches or overhangs; Houdini can but is offline
and expert-only. Frontier SDF fills that gap.

## 2. Representation decision: bounded SDF volume, not heightmap

- Every `(x, y, z)` stores signed distance to the rock surface (negative = solid).
- Union / subtract / intersect / smooth-blend give arches, tunnels, caves,
  cliffs and overhangs for free — impossible with `y = h(x, z)`.
- Cost: memory is cubic. v1 uses 128×80×128 (1.3M voxels) as a GPU atlas;
  the roadmap is sparse bricks (VDB-style) for 512³+ effective worlds.
- References: dynamic-SDF game engines and Claybook's GDC talk on GPU SDF
  rendering; SDF raymarching practice (iq, hg_sdf, "Rendering Worlds with Two
  Triangles"); SDF greedy-meshing threads in voxel gamedev.

## 3. Erosion science mapped to agents

Classic droplet model (Hans Theobald Beyer: rain → downhill flow → capacity-limited
erode/deposit → evaporation → lifetime/death) is the backbone of game erosion
(see the PCG/hydraulic-erosion survey and the `erodr` / Sebastian-Lague-lineage
implementations). Frontier extends it to 3D SDF with four agent kinds:

1. **Rain / hydraulic** — sky emitter, gravity + surface slide, capacity ∝
   water × speed × slope; evaporates and infiltrates; settles when slow.
2. **River** — inlet emitter on the surface, steered by SDF gradient (real
   downhill flow) + art-directable downstream bias; high capacity, scours bed
   and banks, dumps deltas underwater.
3. **Wind (aeolian)** — upwind-edge emitter, saltation hops, windward abrasion
   gated by facing (`dot(n, -wind)`), lee deposition → dunes; grain-size
   dependent settling.
4. **Thermal / rockfall** — spawns only above the repose angle, ballistic hops
   with high friction, deposits where slope < repose → talus cones.

Sediment is conserved cargo (sand / silt / gravel), deposited with
coarse-first settling. The ledger (rock now + deposited + carried + outflow)
is readable from the GPU at any time.

## 4. Water that follows the currents

- A flow field is baked from the same current model that steers river agents
  (river line + meander + wind drift over open water).
- The sea/lake shader advects its ripple normals along that field, so foam
  streaks and sparkle drift with the current instead of scrolling in UV.
- Rivers above the waterline render as ribbons rebuilt from **live agent
  trails** draped over the carved channel, with flow-advected foam stripes.

## 5. AAA production requirements (roadmap)

v1 is the live creative core. A GTA-scale pipeline additionally needs:

- **Scale-out**: sparse/tiled volumes, LOD + streaming, 64-bit coords, region graphs.
- **Export**: meshing (surface nets / dual contouring), height+mask bakes,
  splat/flow maps, collision (SDF is already collision-ready), engine plugins.
- **Determinism**: seeded runs, checkpoint/replay, regression diffs.
- **Materials**: layered PBR (albedo/normal/roughness from sediment + strata),
  decal/flow-map export for engine water.
- **Validation**: convergence across resolutions, calibrated rates, art-directable
  constraints (protected masks, spline-locked rivers).
- **Performance budgets**: fixed ms/frame sim cost, async compute, quality scalers.

## 6. v1 scope (this repo)

- Node graph → compiled GLSL SDF → GPU base volume (primitives, noise, warp,
  terrace, caves, CSG, transform).
- Live GPU agents (4 kinds) with settling/sleep — no infinite hole-cutting.
- Raymarched viewport: strata rock, sediment/wetness/snow shading, shadows, AO.
- Current-following sea shader + live river ribbons + foam.
- Small depth-tested particle + plume sprites.
- Sediment ledger, PNG + graph JSON export/import, diagnostics.
