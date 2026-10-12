# Frontier — Road Editor (design prototype)

A working prototype of the Road Editor UI: a city-scale road network, lane-level cross-sections,
junction topology, structures, rail crossings and a decoration layer — all generated deterministically
and validated by a headless gate.

**The written design lives in [`Docs/Design/RoadEditor.md`](../../Docs/Design/RoadEditor.md).** This
folder is the artefact that document measures.

```bash
npm install
npm run check     # headless gate — 85 checks, exits non-zero if the topology story breaks
npm run dev       # the editor, bound to 0.0.0.0 so a preview proxy can reach it
npm run build
```

## What is in the box

```
src/viewport3d.js      software perspective renderer: near-plane clipping, frustum culling,
                       painter's-algorithm passes, world-space dash patterns, distance fog,
                       fly camera (WASD + Q/E, RMB look), picking, minimap
src/panels.jsx         Network · Generate · Layers · Road inspector · Cross-section ·
                       Junction inspector · Catalogue · Gates · Status bar
src/ui.jsx             the widget set (rows, metrics, steppers, toggles, strip bar)
src/core/standards.js  the engineering catalogue: 14 classes, 22 strips, 6 kerbs, 14 surfaces,
                       37 markings, 19 detail types, 27 junction families, 4 structure families
src/core/profiles.js   23 cross-section presets and their arithmetic
src/core/network.js    the model: sampling, junction plans, lane movements, and every cleanup op
                       (split, project, join dead ends, clip water, rebuild arms, snap heights,
                       sanitise, fold duplicates, stitch crossings, densify)
src/core/generate.js   seeded city generator: terrain, charters, layouts, stitching, elevation,
                       grade separation, interchange ramps, rail, design-speed fitting
src/core/details.js    the decoration layer: crossings, humps, bollards, bays, lighting, subway
                       mouths, guardrail, wear
src/core/geometry.js   model → render primitives (polys, lines, props, rings) with bounding boxes
src/core/topology.js   the validator: 18 rule families with severities and located offenders
scripts/check.mjs      the gate
```

## What the gate proves

Run it from this folder. It checks, in order: profile arithmetic (all 23 presets, contiguous strips),
generation across 5 layouts × 2 charters (no orphan ends, no dangling node references), the detail and
geometry layers (primitives exist, markings are finite, bounding boxes are finite), the viewport's
projection algebra (orthonormal basis, crosshair centring, near-plane rejection), determinism
(same seed → same network), edit round-trips (split and delete then re-sanitise keeps the graph
closed), and dumps the reference-city report.

Latest reference city (seed 20261012, 3 000 m, ring + spine / NFS-arterial): **155 roads · 148 nodes ·
65 junctions · 53.6 km · 3 753 polys · 8 124 lines · 14 869 props · 170 703 triangles · 3 186 per km**,
with 6 grade-separated interchanges and a whole-pipeline time just over 400 ms in node.

`npm run check` currently reports **85/85 gates passed**. The validation gate deliberately allows a
generator's first pass to carry findings — the editor's job is to locate them, and the Gates panel
flies the camera to each one.
