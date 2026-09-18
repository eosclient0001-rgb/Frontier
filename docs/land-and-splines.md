# Land plots, sculpting and scene splines

Frontier is still a bounded **WebGL2 3D SDF editor**. The new land workflow does not replace the volume with a heightmap. Existing desert presets and painted Voronoi fracture tools remain available.

See [volumetric object tools](volumetric-object-tools.md) for the new XYZ gizmo, boulders, shape/plot noise, and surface-oriented Ridge/Dent brushes.

## Quick workflow

1. Click **New land plot** at the top of the left outliner. The default plot is 38 × 34 m, top elevation 2.5 m, base −2 m. This clears previous objects and edits; export first when prompted.
2. Use **Ridge** and **Dent** on the right, or keys **5 / 6**. These affect a compact XYZ volume around the picked surface and work on walls and undersides, not only the top. Strength, falloff, elongation, normal depth, stroke spacing and fractal texture are adjustable. Smooth, Flatten 3D and Noise brushes are also available; Carve/Build remain CSG stamps. Hold Alt to orbit while a brush is selected.
3. Click **Cut spline**, then click the terrain to place points. At least two points are required. Click **Finish / edit** to stop appending. Drag the numbered handles in X/Z; choose a point and edit its numeric Y to grade the channel. Width is full width, Depth is measured below the spline, and Bank slope widens the cut above its bed.
4. Rename the cut in its right-hand inspector. Hiding or deleting a _live_ cut restores the underlying volume and reapplies the other enabled live cuts.
5. Click **Create water from this cut** for an independent water object, or create a Water spline and place its points separately. The convenience action copies XZ points and suggests a shared water level near the average bed plus 0.55 m. It does not maintain a dependency: moving the cut afterward does **not** move the water spline.
6. Adjust the water spline's width and speed. **Reverse direction** reverses its arrow, advected surface coordinates and GPU river current. In **Erosion**, choose the **River current** source to emit water agents along the route. Existing rain and sediment agents are also steered by the route when inside its current region.
7. The **Water** tab / **Water material** button retains shared level, waves, foam, reflection, clarity and wind controls. Water below terrain is occluded: cut a sufficiently deep channel or raise the shared level to see it.

## Outliner and interaction

The **outliner stays docked on the left**, the **viewport in the center**, and **properties/tools on the right**, at all window sizes. Both panels start visible. Resizing, choosing a tool, and Escape do not automatically collapse or move panels. The **Outliner** / **Properties** header buttons explicitly hide or restore their own panel, always on its original side. Contents scroll independently. At heights of 600 px or less the preset strip is hidden to prioritize the viewport.

The left outliner contains the terrain, channel-cut objects and separate water-path objects. Select a row to open its properties on the right. Visibility buttons enable/disable live cuts and water routes. Terrain visibility hides its rendering and shadows, but intentionally retains its collision volume. Guides are X-ray overlays, not additional geometry.

The terrain actor itself cannot be deleted; start another plot or use the existing CSG tools. Erosion, fracture and water-material buttons are workspace shortcuts, not pretend independent terrain objects. Legacy scenes show a procedural-water entry until a custom water spline is created. Deleting all custom water paths in a legacy desert preset restores its procedural-water fallback; a land plot has no fallback water.

Control-point dragging uses the selected point's horizontal plane. Numeric elevation is available for cut paths. A placement click first uses an actual GPU SDF pick. A miss falls back to the plot's top plane (or the shared water plane for water), clamped to the bounded editing region. No curve-point placement requires reading the full volume back to the CPU. Up/Down navigate outliner rows; F2 focuses a selected spline's name. Escape exits point placement. Hold RMB to look and fly with WASD/QE. Release RMB for G/R/S (Move/Rotate/Scale); Home resets the camera.

Limits are **12 control points**, **four cut splines**, **four water splines** and **six shape objects**. Curves are clamped Catmull–Rom sampled as bounded polylines, not arbitrary Bézier handles. The cut pass uses up to 32 segments per path; flow paths use up to 16 each, 64 total. Very tight curves, crossings and abrupt width changes can reveal nearest-segment transitions. Resolution remains 112 × 72 × 112; narrow features below roughly a voxel are not reliably resolved.

## Geometric operations and live/baked distinction

A land plot is a rounded-box SDF with a finite underside, adjustable bottom/bevel and XYZ density noise/terracing. Ridge/Dent modify signed density around a picked surface normal, preserving the full 3D representation. These are artistic local operations, not a globally volume-conserving elastic solve or an exact distance-preserving transform. The former Raise/Lower methods remain backend compatibility references, not visible studio brushes.

Cut splines subtract an open-top swept channel from the SDF. For a sampled centerline position `q`, the bed is `q.y − depth`; the lateral half-width increases by `bankSlope × max(0, y − bed)`. The GPU takes the union of the segment cutters and performs the actual SDF subtraction. Solid occupancy and loose-material channels are updated where terrain is removed.

The first active shape or cut takes a lazy **GPU-only base checkpoint** of the terrain and material atlases (about 27.6 MiB). Editing a live cut restores this checkpoint and replays enabled shapes followed by enabled cuts. Hiding the final cut restores the pre-cut field exactly. Detail brushes bake the live objects first, then sculpt the combined SDF.

**All visible sculpt brushes, erosion and geometric fracture/deletion bake live objects first.** Their descriptors become explicitly marked **baked**, with read-only shape controls. Hiding/deleting a baked guide does not heal its cut. This avoids silently undoing subsequent erosion or fractures when editing an old spline. Bake live geometry provides the same transition explicitly. There is no general scene-modifier undo/history; the existing single fracture undo remains separate.

Regenerating the base plot clears sculpting, erosion and fracture edits and reactivates/reapplies remaining cut guides, including previously baked ones. Choosing a different preset or New land plot clears the object list. Editing plot dimensions is therefore a regeneration operation, not a nondestructive scale transform.

## Water model and limitations

A water spline drives both:

- the **visible water footprint**, flow-aligned procedural wave/foam coordinates, speed and direction;
- **GPU particle current direction and emission**: the initial batch fills the routes, replenishment enters route inlets, and water/sediment agents are guided by nearest-route tangents and lateral attraction.

All water splines share one horizontal **Water level**. Their Y handles display that level and are read-only. This is artist-guided transport over a rendered displaced water surface, **not pressure-based hydraulics, a free-surface solver, waterfalls or independently sloping rivers**. Route speed is per object; legacy river speed/width/offset describe the old procedural river, not custom path shape. River enable gates transport and surface advection; the separate Water switch controls surface visibility. Wave animation may remain active while transport is disabled or erosion is paused.

Hiding the last route disables custom water and new river-source births. Existing particles are not deleted merely because their guide is hidden; they continue under the remaining forces until retirement. At intersections the nearest route wins rather than conserving discharge at a simulated junction. Incoming path widths and speed are artistic values, not a flux constraint. Paths outside a carved channel can appear as bounded water over the terrain when their common level is higher than it.

The shared 256 × 1 RGBA32F route texture uploads only when water routing settings change. Ordinary solver steps do not read terrain/particles back to the CPU or upload the volume. Rendering retains procedural displaced waves, non-tiled foam, refraction/absorption and bounded SDF bank reflections; there are no imported water textures.

## Export

The existing `.frontier` export waits for pending cut recomputation and includes the current **baked SDF**, camera and all object/settings descriptors. `liveModifierBaseIncluded: false` explicitly declares that the pre-cut checkpoint is not exported. This is **not a resumable modifier stack**: replaying the descriptors on top of the exported already-cut field would double-apply edits. There is still no importer UI. Water is represented by settings/curves, not a water mesh; loose-material atlas, active agents and undo history are not included.

## Validation

`tests/splines.test.js` checks bounded land geometry, curve sampling, graded/open-top cuts, route packing, inlets and visibility semantics. `tests/browser/land-splines.spec.js` exercises real WebGL2:

- the retained backend height-deformation reference preserves a 3D cavity and leaves distant terrain unchanged;
- GPU cut values match the CPU swept-channel reference; lost solid occupancy is real;
- hiding a live cut restores the volume exactly; height edits survive live-cut replay; baked cuts cannot be healed by deleting their guide;
- GPU river births and velocities follow a horizontal custom route, reverse correctly, and disappear on reset with a hidden route;
- steady-state routed simulation performs no CPU readback or texture upload;
- actual rendered water pixels move with the path; hiding it matches disabling water; terrain visibility changes rendering but not the volume;
- real viewport placement/handle dragging, object naming, visibility, water creation, left/right layout and 650 px no-overflow behavior.

Browser tests use SwiftShader in the sandbox; they are correctness checks, not native-hardware performance or photorealism benchmarks.

## Updated interface

Use **New scene → Empty land plot** to replace the scene. Use **+ Add → Cut spline / Water spline / Shape** to create an object without replacing the scene. Brush controls are in **Sculpt**; **Object** returns to the selected object’s properties. See the [Studio interface guide](interface.md).
