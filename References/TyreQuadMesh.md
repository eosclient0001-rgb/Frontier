# Pure-quad tyre mesh — design notes

`TyreGenerator.html` builds the tyre as a **pure-quad, watertight, low-poly mesh directly from the
vector tread pattern**. No heightmap is involved in the geometry at any point, there are no
triangles and no ngons in the exported mesh, and every build is proven by a topology validator
before the OBJ leaves the page.

## Why not a quad remesher (ZRemesher / QuadriFlow / Instant Meshes)?

Those tools solve a different problem: turning an arbitrary, dense, triangulated sculpt/scan into
quads. For a tyre they are the wrong tool:

- They **require a high-poly triangulated input** — exactly the heightmap/high-poly pipeline we
  don't want. You would first build a dense displaced mesh, then pay to remesh it back down.
- Their output is only *mostly* quad, with **poles, spirals and T-junction-like flow** wherever the
  field solver puts them. Flow does not follow the tyre's circumference/across axes, which is what
  you need for clean deformation (contact-patch flattening, sidewall flex, camber).
- They don't guarantee a manifold, watertight result, and groove walls/floors are approximated from
  the dense surface, so sharp tread features soften or vanish.
- They are another heavy external dependency for a shape we can describe exactly.

A tyre is not an arbitrary surface. Unwrapped, the tread is a **rectangle that is periodic around
the circumference (U) × the cross-section profile (V)**, and a tread pattern is a set of grooves at
discrete depths on that rectangle. That domain can be meshed *by construction* — no remeshing step
is needed at all.

## How the mesh is built (all inside `<script id="quad-core">` in the HTML)

1. **Vector field, never a raster.** Each pattern layer is compiled to an exact level test:
   circumferential grooves are bands (with exact rows inserted at their edges), lateral/chevron/sipe
   grooves are centreline-graph distances, dimples and hex cells are distance tests, drawn shapes are
   point-in-polygon / distance-to-polyline tests — all folded periodically around the circumference.
   The returned level is the discrete groove depth (0 = land) at any unwrapped point.
2. **Structured grid.** Columns wrap the circumference (`N = circumference / pitch`, so the seam is
   exact), rows run across the crown and around the shoulder arc, with extra rows snapped exactly
   onto circumferential groove edges. Grid nodes may snap onto groove boundaries (bounded,
   quality-guarded); any node that would fold a quad is reverted to the regular grid.
3. **Cell complex.** Every grid cell gets one top quad at its level. Wherever neighbouring cells
   differ in level, vertical **wall quads** connect them (terraced through intermediate levels, so
   multi-depth crossings stay manifold). Sidewalls are lathe rings with the same `N`, and an inner
   liner closes the shell between the beads. All faces are quads; vertices are shared by
   (column, row, level), so the shell is welded by construction.
4. **Topology cleanup.** Diagonal "checkerboard" cell blocks — the one configuration that would
   pinch the surface at a single vertex — are resolved using the exact groove level at the saddle
   point. Degenerate and duplicate faces are removed, then faces are re-oriented consistently
   (shared-edge BFS) and flipped outward per component by signed volume.
5. **Proof, every build.** The validator counts boundary edges, non-manifold edges, inconsistent
   orientations, degenerate faces, Euler characteristic (0 for this torus-topology shell), signed
   volume, corner angles, warp and poor quads. The Export card in the page shows the live report;
   the OBJ header carries its summary.

Grooves thinner than the grid can resolve (e.g. 1.2 mm sipes at a 6 mm pitch) **cannot** become
geometry without exploding the poly count. They are never silently faked into the mesh — they are
listed in the Export report with the pitch you would need to mesh them. Lower the pitch and they
become real geometry.

## Controls that matter

| Control | Effect |
|---|---|
| Quad pitch (2–12 mm) | The one resolution knob. `8 mm` ≈ deform proxy (~20–35k quads), `6 mm` standard, `4 mm` fine. Around-count and across-rows both derive from it. |
| Snap nodes to groove edges | Pulls grid nodes onto exact vector boundaries (guarded; bad snaps revert). Off = perfectly regular grid, stair-stepped groove edges. |
| Inner liner | Closes the shell bead-to-bead (watertight). Off leaves exactly the two bead loops open. |

## Exports

- **OBJ (pure quads)** — the deliverable. Metres, grouped `top / wall / side / liner`, with the
  validation summary in the header.
- **Quad report JSON** — full validator output, dropped-feature list, cleanup stats.
- **Pattern JSON** — the vector tread design (re-importable).
- **GLB** — preview only. glTF has no quad primitive, so it is triangulated; never use it where
  quads are required.

Verify any exported OBJ outside the browser:

```bash
node References/ValidateQuadOBJ.mjs path/to/tyre.obj
node References/TestQuadMesh.mjs        # builds + asserts every case and every preset, headless
```

## Designing a tread in the 2D designer

Open **✎ Tread designer**. The pattern is designed as **one repeating tile** that wraps around the
tyre: use View → *One tile* to design it and *Tile ×3 (wrap check)* to confirm shapes cross the seam
cleanly (blue guides are tile boundaries, the cyan seam is the tyre wrap). Tools: groove paths,
polygons, rect/circle/hex blocks, parametric-layer handles, per-layer select/hide/duplicate/mirror,
point insert (double-click a segment), numeric point editing, arrow-key nudge, undo/redo.
"Update 3D" rebuilds the quad mesh from the vectors and re-validates it.

## Deformation notes

- Edge flow is the point of this mesh: continuous loops run **around** the tyre and **across** the
  profile, with no poles on the tread — bending, contact-patch flattening and sidewall flex follow
  the grid instead of fighting it.
- Keep the pitch uniform for deformation work; use the 8 mm proxy while animating/rigging and
  rebuild at 6/4 mm for finals — same topology family, same UVs (`U` around, `V` across).
- If you subdivide (Catmull-Clark), groove walls will round. Crease the `wall` group edges, or
  subdivide the land only, if you need the groove profile to survive smoothing.
