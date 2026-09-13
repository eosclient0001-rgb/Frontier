# SolidArc Panel — rewritten analytic B-rep kernel (HTML prototype)

Complete restart of the modelling core. The **UI shell is reused verbatim** from the previous
prototype (same glass panels, Outliner / Viewport / Inspector, same interactions); everything
that *models* was thrown away and rewritten from scratch as a proper boundary-representation
kernel, Plasticity-style: sketch a 2-D profile, extrude it into an exact solid, then edit the
solid through topology surgery — never through polygons.

Run: `python3 -m http.server 8080` in this folder → http://localhost:8080/ (add `?demo` for a
sample scene). No build step, no WebGL.

## Files

| File | Role |
|---|---|
| `kernel.js` | The kernel. Pure geometry + topology, no DOM. Loadable in Node (`require`) — this is the file that gets ported to C++ (`Kernel/`) once proven. |
| `app.js` | Panel wiring: viewport (canvas raster), outliner, inspector, tools, command line. Talks to the kernel only through its exported operations. |
| `index.html` | The reused UI shell + the two script tags. |
| `Verification/kernel_smoke.js` | `node Verification/kernel_smoke.js` — 103 checks of exact topology counts, Euler characteristic, shell validity and exact volumes for every operation. |
| `Verification/ui_smoke.js` | `node Verification/ui_smoke.js` — boots the page under jsdom and drives the tools end-to-end (needs `jsdom` on NODE_PATH). |

## Why the old kernel was wrong, and what the rewrite does instead

The old prototype modelled solids as a tessellation with per-feature patch-up code. Bevel /
chamfer offset *polygon rings*, which is why chamfering one edge bled around the loop,
neighbouring edges got dragged in, and the offset direction depended on winding accidents.

The new kernel stores what a real modeller stores:

- **Faces carry exact surfaces** — `plane`, `cylinder`, `cone`, `torus` — with an orientation
  sense. **Edges carry exact curves** — `line`, `circle` (plus traced intersection polylines
  for the one non-analytic closure case) — with parameter ranges and end vertices. Loops are
  ordered, sensed edge lists; every edge is used exactly twice with opposite senses.
- **Operations are topology surgery + surface∩surface intersection**, never mesh editing.
  Display triangles are generated *from* the B-rep after the fact.
- **Every mutating operation validates the shell** (edge use counts, loop vertex continuity)
  and refuses with a message instead of committing bad topology. All 2-manifold results keep
  `V − E + F = 2`.

## Blend (fillet / chamfer) — the researched algorithm

Modelled on how Parasolid/ACIS-class kernels do edge blending (rails/"spring curves" offset on
the two adjacent faces, cross-section swept along the edge, explicit end treatment):

1. **Scope = the picked edge only**, extended across *tangent* (G1) joints — the smooth chain
   a rolling ball physically cannot stop at (e.g. the top rim of a rounded-rectangle pad is
   one chain of 8 elements). Sharp neighbours are **never** dragged in: chamfering one cube
   edge yields exactly one new face, 7 faces total, the other three edges untouched.
2. **Per element, exact blend geometry by surface pair**:
   plane/plane edge → planar chamfer or cylindrical fillet; cap-circle edge (plane/cylinder) →
   cone chamfer or torus fillet; vertical wall/wall edge (plane or cylinder walls) → solved in
   the cross-section plane with a rolling-ball centre locus. Direction comes from the two
   *inward* face directions and edge convexity — material is removed on convex edges and added
   on concave ones, never mirrored.
3. **Rails** (`·r1`,`·r2`) replace the edge in each adjacent face's loop; **seam edges** (`·x`,
   marked smooth/tangent) join consecutive blend facets at chain joints, located by exact
   rail∩rail intersection with tangency clamping.
4. **Open ends close against the cross face** (`·c0`,`·c1`): the rails are intersected with
   the third face at the corner, the closure curve is the analytic blend∩cross-face curve, or
   a marched (Newton-projected) intersection trace when that curve is not a line/circle —
   e.g. a fillet dying against an earlier chamfer plane. Neighbour edges are shortened; if one
   degenerates to a point (equal-size blends meeting at a corner) it is **collapsed** properly;
   if the blend would overrun past the corner the operation **refuses** instead of producing
   garbage.
5. Tangent seams are not selectable as blend targets (they are not edges).

## The rest of the kernel

- **`profile(segs)`** — free 2-D segments (with arc bulges, full circles) chained into closed
  loops, nested by containment into regions with holes, orientation normalised (outer CCW).
- **`extrude(region, frame, h)`** — one face per profile segment: line → plane, arc/circle →
  cylinder. A cylinder is 3 faces / 2 closed edges / 0 vertices. Caps take multi-loop
  boundaries (holes become bores). Vertical joints between tangent profile segments are
  recorded as smooth seams.
- **`moveFace` / `offsetFace` / `moveEdge` / `moveVertex`** — the *surfaces* move; every
  touched edge curve is re-derived by surface∩surface and every touched vertex re-solved by
  3-surface Newton intersection. Push/pull a box wall and the box stays an exact box.
- **`transform`** — exact similarity (rotation, translation, uniform scale) applied to
  surfaces and curves analytically. **`scaleNonUniform`** works where every surface stays in
  the family (planar solids) and *refuses* on curved faces — because this is a B-rep, not
  polygon modelling; a non-uniformly scaled cylinder is not a cylinder.
- **`tessellate` / `measure`** — display mesh + exact-ish volume/area from the analytic
  normals; used for shading, picking and the Inspector stats only.

## Panel interactions (unchanged UI, new plumbing)

Sketch: `L` line · `⇧L` polyline · `R` rectangle · `C` circle · `A` arc · `P` polygon — sticky
tools, lattice snap, `⌃` endpoint snap. `E` extrude (drag/type height). `B` fillet · `⇧B`
chamfer: hover an edge, click, drag or type the radius/distance — live dashed preview straight
from a trial kernel run, `✗` in the HUD when the kernel refuses at that size. `G/⇧R/S`
move/rotate/scale modal with `X/Y/Z` axis lock and digit entry — on bodies it is an exact
transform, on faces/edges/vertices it is the analytic tweak. `1–4` body/face/edge/vertex pick
modes; command line understands `box`, `cylinder`, `extrude`, `fillet d`, `chamfer d`, `demo`,
`clear`. Bodies rebuild from their recipe (sketch → extrude → placement → ordered edits) on
every change; failed edits are flagged in the Inspector, removable with `×`; undo/redo,
autosave and save/open `.json` as before.

## Porting notes (HTML → C++)

`kernel.js` is deliberately structured like `Kernel/`: curves/surfaces are tagged records with
exact parameters (`CurveSpecification` / `SurfaceSpecification`), the solid is vertex/edge/face
stores with sensed loops (`TopologySpecification`), blending is a solver over rails + cross
sections (`ProfileSolver`/`SkinSolver` territory), and every operation returns ok/refusal
(`Deliver<T>`-shaped). Port operation by operation, replaying `Verification/kernel_smoke.js`
expectations as the C++ proof.
