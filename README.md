# Frontier — Road Editor

An experimental, **ProjectZero-style browser editor** for building **NFS-scale road networks** —
roads only, clean topology, full street detail. Inspired by the quiet, charcoal dashboard-card
design language of the Frontier / ProjectZero native editor.

No buildings, no engine backend, no external assets. Everything — every texture, every prop,
every road profile — is generated procedurally in the browser. Drop the exported map into
Unreal / Blender and drive it.

---

## Run

```sh
npm install
npm run build      # bundle src/ -> public/assets/app.bundle.js
npm run serve      # static server on http://0.0.0.0:8080
```

Then open the printed URL. For live development:

```sh
npm run dev        # esbuild --watch
npm run serve
```

`npm test` runs the headless suite (logic smoke test, DOM cross-check, and a full jsdom boot
of the real bundle against a stubbed WebGL2 context).

---

## What you get

### Road library (13 cross-section presets)
Each preset is a real profiled cross-section with curbs, raised medians, lane directions and
automatic paint. Pick one, then click the ground to lay a Catmull-Rom spline.

| Category | Presets |
|---|---|
| Highways | Motorway / Interstate (3+3, concrete median barrier, hard shoulders), Expressway (2+2, guardrail median) |
| City streets | Arterial Avenue (bus + cycle + parking + raised median), Grand Boulevard (tree verges, planted median), Residential Street, One-Way Street, Alley / Service Lane |
| Rural | Country Road, Mountain Pass (guardrails), Historic Cobblestone Street |
| Paths | Waterfront Promenade, Cycle Path |
| Unpaved | Dirt Track |

### Detail layer (the intricate stuff)
- **Road markings** — dashed/solid white lane lines, double-yellow centerlines, edge lines,
  all derived automatically from the cross-section.
- **Curbs & paving** — raised sidewalks, verges and medians with true vertical curb faces.
- **Bollards** at crossing corners, **speed bumps** on residential streets, **street lamps**,
  **trees** along verges, **guardrails** on highways/mountain roads.
- **Traffic signals** at major junctions, **stop signs** at minor ones, **zebra crosswalks**
  and **stop lines** on every approach.
- **Railway crossings** — sleepers, twin rails, ballast bed, crossbuck X-signs and raised
  striped level-crossing gates, placed automatically where a rail line meets a road.
- **Bridges / overpasses** — raise nodes or set a per-edge *Bridge lift* and the deck gets
  side fascia, parapets, an underside, and automatic piers.
- **Subways** — metro tunnel portals and vent shafts as placeable props.

### City generator (seeded)
One click generates a full city: street grid, arterial avenues with bus/cycle/parking lanes,
a diagonal grand boulevard, perimeter ring road, a motorway spine, a railway that splits every
road it crosses into a level crossing, and subway portals. Deterministic per seed. Tune size,
block size, avenue spacing and every feature toggle.

### Navigation — Unreal-style fly camera
- **Right-drag** look · **W A S D** fly · **Q / E** down / up
- **Shift** boost · **mouse wheel** base speed · **F** focus selection · **T** top-down

### Editing tools
`1` Select · `2` Roads · `3` Rails · `4` Props · `5` Erase · `Ctrl+Z` undo · `Del` delete selection.

### Export
- **Export OBJ** (+MTL) — bakes roads, curbs, markings and every instanced prop into one mesh
  you can import into Unreal / Blender.
- **Export GLB** — binary glTF of the same scene.

Both are intended as the hand-off for a larger game-engine / NFS-style map pipeline.

---

## Architecture

```
src/
  main.js            app shell: renderer, camera, tools, UI wiring, render loop
  core/
    network.js       road graph (nodes + spline edges), undo stack
    profiles.js      cross-section preset library + lane-marking rules
    mesher.js        graph -> merged indexed geometry + InstancedMesh props
    citygen.js       seeded procedural city generator
    props.js         street-furniture geometry (bollards, lamps, portals, …)
    textures.js      procedural canvas textures + materials (no external assets)
    camera.js        Unreal-style fly camera
    exporter.js      OBJ + GLB export
    util.js          math / PRNG / geometry bins
scripts/
  build.mjs          esbuild bundler
  smoke.mjs          headless logic test (citygen -> mesh, no DOM/WebGL)
  dom-check.mjs      DOM id / css / asset cross-checks + bundle parse
  boot-check.mjs     full jsdom boot of the bundle against a WebGL2 stub
  glstub.mjs         minimal WebGL2 stub for the boot test
```

### Design decisions
- **Clean topology, minimal draw calls.** Every surface is merged into per-material
  indexed `BufferGeometry`; repeated furniture is drawn with `InstancedMesh`. A ~2 km² city
  is ~1.5 M triangles in a few dozen draw calls.
- **Procedural everything.** Asphalt, concrete, cobble, dirt, gravel, grass and paint are
  generated on `<canvas>` at load — no texture downloads, no raster assets.
- **Graph-first.** Roads are splines over a node graph; junction plates, crosswalks, stop
  lines, signals and crossings are derived at mesh time, so edits stay cheap and undo is trivial.
- **Headless-testable core.** The meshing/generation core has zero DOM/WebGL dependencies, so it
  runs under plain Node for fast regression tests.

---

## Notes
- This is an **experimental UI/UX exploration**: roads and street detail only, buildings out of scope.
- Lighting uses a single directional sun with a camera-following shadow frustum; switch Time of
  Day (Noon / Golden hour / Overcast) in the Viewport panel.
