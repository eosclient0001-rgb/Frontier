# Frontier · SDF Terrain Lab

A procedural **SDF terrain generator** with a professional, Gaea-style UI.
It builds a **100 m × 100 m** test terrain in three stages:

```
MULTIFRACTAL MOUNTAIN  →  HYDRAULIC SDF EROSION  →  SPLATMAPS
```

## Pipeline

### 1. Multifractal mountain
* Seeded **Perlin gradient noise** with **multifractal fBm** (octaves,
  lacunarity, persistence gain) blended with a **ridged multifractal**.
* Shaped by a **radial peak gradient**: a steep super-ellipse **core**
  (flat-topped summit → steep shoulder) plus a broad, gentle **foothill
  skirt**, so the mountain has low grasslands at its base and a dramatic
  summit.
* **Domain warping** for organic form, a per-seed **flank tilt** (long
  valley side) and a small per-seed summit offset.
* The result is a scalar **SDF height field** `h(x,z)` — signed distance
  from the sea plane to the implicit surface. The mesh is never part of
  the simulation; it is only a visualization.

### 2. Hydraulic erosion (SDF-domain, no mesh)
A single physically-based **landscape-evolution** engine operates
**directly on the SDF field**. It is the standard geomorphological
equation used by every reference implementation (INRIA analytical
stream power, OpenLEM, Landlab `SharedStreamPower`):

```
dh/dt = -K · A^m · S^n     fluvial incision (stream power law)
        + D · ∇²h           hillslope diffusion (Laplacian)
        + sediment capacity routing
```

where **A** is the D8 drainage area through the cell (contributing
cells × voxel², in m²) and **S** is the local slope to the
steepest-descent neighbour (m/m).

* **Stream power incision** — `e = K·A^m·S^n` per iteration, clamped to
  a voxel-matched cap. Fully slope-controlled: where the gradient
  relaxes the channel stops cutting and a flat valley floor forms.
  A canyon attractor (from the mountain's sector mask) boosts the
  guided main canyons.
* **Hillslope diffusion** — the full 4-neighbour Laplacian runs every
  iteration. This is the *maturity* term: fine carve patterns decay as
  `(1-D)^iterations` while real channels re-incise faster, so only the
  true drainage network survives and the interfluves smooth to convex
  hillslopes (the look Gaea renders).
* **Sediment** — yield-limited bedload routed downstream each iteration;
  where the load exceeds transport capacity `∝ A^0.6·(0.25+S)` the
  excess deposits, and diffusion spreads it into smooth alluvial fans
  at piedmonts and confluences.
* **Water bodies** — enclosed basins are found by "pouring water"
  (Dijkstra from the map rim) and filled to a flat lake surface; the
  most-concentrated flow on land is marked as rivers.

Flow is a D8 **flow-accumulation** (O'Callaghan & Mark) with a coherent
meander field so streams wander and braid rather than run as straight
radial spokes; the meander fades near the coast so rivers run straight
to the waterline. Flow is recomputed every 4 iterations as the network
evolves.

**SDF conversion:** the standard algorithm is defined on a scalar
elevation field; the SDF `h[]` *is* that field (signed metres from the
sea plane), so areas are in m² (`flow × voxel²`), slopes in m/m over
true neighbour distances, and every per-iteration cut is clamped to
`cutFraction × voxel` — the cut depth stays proportional to grid
resolution (fine grids cut finer slices and never alias). The UI shows
the live `voxel size` and `cut ↔ voxel match` readouts.

### 3. Splatmaps (Gaea-style channels → 5 layers)
Channels derived from the eroded SDF: **height · slope · curvature ·
flow · erosion · sediment · peaks · points**. A channel **preview**
selector renders any channel as a grayscale splatmap over the terrain.

Blended into five procedural (mirrored-repeat seamless) texture layers:

| layer | driven by |
|---|---|
| grass | flat, dry, low |
| dirt  | mid-slope belt + erosion/sediment/flow |
| rock  | steep walls + dominant peaks |
| sand  | narrow waterline beach band |
| snow  | above the snow line, not too steep |

Wet flow channels darken and gloss the surface in the shader.

## Controls

* **Generate Mountain** `G` — rebuild the multifractal mountain
* **Run Erosion** `E` — re-run hydraulic erosion (from the fresh mountain)
* **Full Pipeline** `P` / `Space` — mountain → erosion → splatmaps
* **Reset View** `R` — reset the camera · `W` toggles wireframe

Left panel: **Mountain** (seed, grid resolution, frequency, octaves,
multifractal gain, ridged blend, peak height/radius/gradient, domain
warp, flank tilt, sea level) · **Hydraulic Erosion** (erosion seed,
iterations/maturity, hillslope diffusion, discharge exponent *m*, slope
exponent *n*, erodibility, max cut/step, sedimentation) · **Splatmaps**
(channel preview, snow line) · **View** (water, wireframe, auto orbit).

Right panel: terrain stats (grid, voxel, verts, min/max/mean elevation),
erosion stats (carved/deposited m³, iterations, max flow, water bodies,
timings) and a live elevation histogram with sea-line / snow-line
markers.

Hover the terrain for a probe readout (x, z, elevation, local slope).

## Run

Any static file server from the repo root:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Three.js (r160) is vendored in `vendor/` and loaded via an import map —
no build step, no CDN.

## Structure

```
index.html        app shell + import map
css/app.css       professional dark UI theme
js/noise.js       seeded Perlin noise, fBm, ridged multifractal
js/mountain.js    SDF mountain builder (peak gradient + spurs + warp)
js/erosion.js     stream power + hillslope diffusion erosion on the SDF
js/splats.js      Gaea-style channels + layer weights
js/textures.js    procedural 512² layer textures (seamless)
js/terrain.js     Three.js viewport, splat shader, water, probe
js/ui.js          control-panel DOM kit
js/main.js        pipeline orchestration + panel layout
vendor/           three.module.js, OrbitControls.js
```
