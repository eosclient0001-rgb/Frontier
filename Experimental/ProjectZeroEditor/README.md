# Project Zero · Road Editor (Experimental)

A browser road editor for large, open-world, NFS-style maps. It handles roads only
(no buildings). It is built as an experimental prototype next to the other browser
studies in `Experimental/`, and it follows the same conventions: its own npm
package, Vite, and TypeScript.

## Run it

From the repository root:

```sh
npm --prefix Experimental/ProjectZeroEditor ci
npm --prefix Experimental/ProjectZeroEditor run dev -- --port 5173
npm --prefix Experimental/ProjectZeroEditor test
npm --prefix Experimental/ProjectZeroEditor run build
```

`dev` listens on `0.0.0.0`, so it can be used through a remote preview. `build`
type-checks and writes `dist/`.

## Controls

| Input | Action |
| --- | --- |
| **W / A / S / D** | Fly forward / left / back / right (Unreal style, follows the view pitch) |
| **Q / E** | Fly down / up |
| **Right mouse drag** | Look around |
| **Mouse wheel** | Change fly speed |
| **Shift / Ctrl** | ×4 / ×0.25 speed while moving |
| **1 · 2 · 3 · 4** | Select & move · Draw road · Place props · Delete |
| **Left click** | Use the active tool |
| **Enter / double-click** | Finish the road being drawn |
| **Esc** | Cancel drawing, or clear the selection |
| **Delete** | Delete the selection |
| **F** | Frame the selection, or the whole map |
| **Ctrl+Z / Ctrl+Shift+Z** | Undo / redo |
| **Ctrl+S** | Save to browser storage (also autosaves) |

Drag a junction (node) with the Select tool to move it. Bezier handles move with it,
so curves keep their shape.

## What it does

### Roads and lanes
Every road is a smooth cubic Bezier between two junctions. Its cross-section is an
ordered list of lanes on each side of the centreline. Lane types:

- driving, **bus lane** (red), **bike lane** (green), **parking**, shoulder
- **sidewalk** (raised kerb), **pedestrian path** (paved, with paving joints)
- **railway** ballast (with rails and sleepers), **subway** (violet surface ghost)

Centre options: none, double yellow, dashed white, or a raised median.

Templates: divided highway, arterial with bus lanes, boulevard with bike lanes and
parking, local street with parking, pedestrian path, railway, and subway. You can
also edit lanes one by one (type, width, add or remove) and see a to-scale
cross-section preview.

### Paint and kerbs
- Solid and dashed lane lines follow the rules for each neighbouring pair of lanes.
- Kerbs are drawn wherever a raised surface meets a flat one.
- Dashes are built along the arc length, so they follow curves.

### Props
Bollards, speed bumps, railway crossings (planked pad, rails, crossbuck posts and a
barrier arm), zebra crosswalks, stop lines, and subway entrances. Props are stored
as a fraction along the road plus a lateral offset, so they stay attached when the
road is reshaped.

### Procedural city
**Generate city…** builds a deterministic grid from a seed. It has jittered
junctions, a perimeter highway, arterials every 4th row and column, boulevards
between them, local streets, diagonal footpaths with bollards, a railway with
automatic crossings, and a subway line with entrances. It also places crosswalks,
stop lines and some speed bumps at the real junctions. The default is a 4 km × 4 km
map (about 2,600 road segments and 9,700 props). The same seed always produces the
same network.

### Large-map rendering
The world is split into 400 m chunks. Each chunk is one merged mesh, and only chunks
whose contents changed are rebuilt after an edit. Three.js frustum culling works per
chunk. Junction fills are convex hulls of the flat road edges.

## Data format

Networks are plain JSON (`version: 1`) with `nodes`, `segments` and `props` keyed
by id. See `src/model/types.ts`. **Open…** and **Save JSON** work with that format.
Files are validated on load and every problem is reported.

## Architecture

```
src/model/     pure data + geometry (no DOM, no three.js): types, geometry (Bezier, arc
               length, Douglas-Peucker simplification, hulls), profile (lanes, bands,
               paint rules, templates), network (CRUD, validation, IO), generator
               (seeded city), history (undo)
src/render/    batch (triangle buffer), roadBuilder (segments, kerbs, paint, junctions,
               props), world (chunked, incremental mesh sync)
src/editor/    editor (tools, input, picking, document state), flyCamera, overlay
               (selection and handles), ui (DOM panels), styles.css
tests/         vitest: geometry, network, generator, rendering
```

## Tests

`npm test` runs 32 unit tests. They cover Bezier sampling and simplification, lane
layout (no gaps between bands), marking and paint rules, network editing and
cascading deletes, JSON round trips and validation, undo/redo, generator determinism
and feature coverage, MeshBatch geometry, and chunk-level incremental rebuilds.

## Known limitations

These are real gaps in this first version. They are listed so nobody mistakes the
prototype for a finished product.

- **Not yet checked in a live browser.** The sandbox cannot download a browser, so
  the UI and 3D view have been type-checked, built, and unit tested, but not visually
  verified. Please open the preview and report anything that looks wrong.
- **Intersections are simple.** Each junction is a convex-hull fill of the flat road
  surface. There are no rounded kerb corners, no lane-to-lane turn geometry, no
  traffic-signal or sign props, and sidewalk corners are not filled.
- **No real elevation.** There are no bridges, overpasses, cuttings or real tunnels.
  Subways are a surface ghost line with entrance boxes.
- **Railway crossings are static.** The barrier is always drawn closed, and there are
  no flashing lights or animation.
- **Not "all the roads in the world".** There is no OpenStreetMap or other real-world
  import. The network allowlist for this environment does not include those sources,
  and the editor has no importer yet. Maps are built by hand or generated.
- **Performance.** The default 4 km city has about 471k triangles and builds in about
  1.6 s. A sync after one edit takes about 50 ms, because it still diffs every entity
  each frame. A spatial index and a finer diff are the next step for dragging on very
  large maps.
- **Arrows, road names, and road numbering** are not implemented.
