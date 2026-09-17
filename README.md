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
Two particle/flow solvers operate **directly on the SDF field**:

* **Thermal (drop) erosion** — thousands of water drops fall on the
  surface, follow steepest descent, carry **slope-limited sediment**
  (Taylor-style transport capacity) and deposit it where they slow down.
  Carves gullies, rills and headwalls. Each drop has a per-drop erosion
  budget so gorges stay finite.
* **Hydraulic flow** — **D8 flow-accumulation** routes every cell's water
  to its lowest neighbour (pits collect, near-flat jitter breaks sticky
  channels). Concentrated flow on steep cells is carved; flat wet cells
  receive deposited sediment (valley floors / alluvial fans). Flow is
  recomputed each pass so rivers re-route as they incise.

**Resolution match:** every cut per step is clamped to
`maxCut = cutFraction × voxel`, so the depth carved is always
proportional to the grid resolution — fine grids cut finer slices and
never alias. Drop path length is given in *meters* and converted to grid
steps via the voxel size, so erosion is comparable across resolutions.
The UI shows the live `voxel size` and `cut ↔ voxel match` readouts.

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
warp, flank tilt, sea level) · **Hydraulic Erosion** (thermal drops,
hydraulic flow, drops, drop size, erodibility, drop path, max cut/step,
flow passes, flow exponent, sediment transport) · **Splatmaps**
(channel preview, snow line) · **View** (water, wireframe, auto orbit).

Right panel: terrain stats (grid, voxel, verts, min/max/mean elevation),
erosion stats (carved/deposited m³, drop stops, max flow, timings) and a
live elevation histogram with sea-line / snow-line markers.

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
js/mountain.js    SDF mountain builder (peak gradient + warp + tilt)
js/erosion.js     hydraulic erosion (thermal drops + D8 flow) on the SDF
js/splats.js      Gaea-style channels + layer weights
js/textures.js    procedural 512² layer textures (seamless)
js/terrain.js     Three.js viewport, splat shader, water, probe
js/ui.js          control-panel DOM kit
js/main.js        pipeline orchestration + panel layout
vendor/           three.module.js, OrbitControls.js
```
