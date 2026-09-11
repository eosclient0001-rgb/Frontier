# Frontier SDF — Nodal Terrain Studio

A Gaea-style **node-graph terrain tool** built on a true **3D signed-distance
volume** (real caves, arches, overhangs, cliffs — no heightmap), eroded live by
**GPU particle agents** (rain, rivers, wind, rockfall) with capacity-limited,
settling transport. Rivers carve real channels and render as flow-following
ribbons; the sea shader advects along the same current field.

Single-page web app, zero dependencies, zero build step. WebGL2 only.

## Run

```sh
python3 server.py 8000
# open http://localhost:8000
```

Requires a browser with WebGL2 + float render targets (`EXT_color_buffer_float`,
universal on desktop hardware acceleration). No CDN, fonts, or assets — works offline.

## Workflow

1. Bottom dock: build **sources → modify → combine → erosion → Terrain Output**
   (double-click canvas to add, drag ○→○ to wire, Del removes).
2. Press Run (Space). Watch small agents rain, flow, saltate and settle while
   the terrain, sediment fans, deltas and dunes evolve live.
3. Tune the selected node in the right inspector; layers + presets on the left.
4. **Audit sediment balance** any time — rock + deposited + carried + outflow.
5. Export PNG snapshots or the graph JSON; re-import to continue.

Docs: `docs/requirements.md` (research + AAA roadmap) · `docs/erosion-model.md`
(sim passes + no-holes guarantee) · `docs/nodes.md` (node reference).

## Architecture

| Path | Role |
|---|---|
| `index.html` / `styles.css` | Studio shell (outliner · viewport · inspector · graph dock) |
| `js/graph.js` | Node defs, graph model, GLSL SDF compiler, presets |
| `js/glsl-lib.js` | Volume atlas + noise + SDF GLSL shared by sim and renderer |
| `js/sim-shaders.js` / `js/sim.js` | GPU base-gen, agent passes, ledger, flow bake |
| `js/render-shaders.js` / `js/render.js` | Raymarched SDF + current water, ribbons, sprites |
| `js/nodes-ui.js` | Graph canvas UI |
| `js/panels.js` | Outliner + inspector builders |
| `js/app.js` | Boot, loop, camera, export, diagnostics |

## Limits (honest v1)

128×80×128 bounded volume · 4096 agents · single river inlet · sea is a level
plane (rivers are trail ribbons, not a free-surface solve) · no mesh/scene
export yet (PNG + graph JSON) · float readback required for ledger/ribbons.
See `docs/requirements.md §5` for the production roadmap.
