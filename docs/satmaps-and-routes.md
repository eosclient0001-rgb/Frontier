# Satmaps and explicit shared river routes

## Satmaps: after Fracture in the workspace navigation

Satmaps is a procedural, satellite-style material system, **not imported satellite photography** and not a terrain heightfield. Choose Weathered sandstone, Alpine mineral, Volcanic basalt or Layered limestone. Material blend and individual map influences are live shader settings; they never regenerate, flatten or otherwise modify the SDF. Disable Satmaps to return to the previous material.

The surface is evaluated at the actual XYZ ray/SDF intersection, including cliffs, undercuts, caves and newly exposed fracture faces. All colour noise is world-space 3D noise at several scales; there is no periodically wrapped UV texture. The existing material-normal detail, lighting and fracture detail remain in the rendering path.

### Map inputs

| Input     | Source and interpretation                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Elevation | Actual world Y, normalized over the volume bounds. A colouring attribute, **not** an XZ → terrain-height lookup.                                                                                              |
| Slope     | Geometric SDF normal. Vertical exposure uses `1 − abs(normal.y)`; loose-dust bias distinguishes upward from downward faces.                                                                                   |
| Curvature | Tangential second differences of the current SDF at a 0.62 m stencil, divided by an estimate of local distance gradient magnitude. Positive is convex; negative is sheltered/concave.                         |
| AO        | Four bounded samples along the actual SDF surface normal. This is local occlusion, not baked lighting or global illumination.                                                                                 |
| Sediment  | Current deposited sand/fines/coarse inventory from the GPU material atlas, not a guessed elevation band or cumulative deposition counter.                                                                     |
| Flow      | GPU water-contact exposure and weighted XYZ carrier velocities, accumulated in the same 3D surface stencil as the erosion requests. It is a contact-history proxy, **not** a solved drainage/discharge field. |

**Inspect surface maps** switches between composite material, flow direction/contact history, deposited sediment, AO, signed curvature, elevation and slope. Flow direction uses RGB-encoded XYZ direction with exposure controlling visibility; curvature is orange for convex and blue for concave. Flow/sediment are initially empty: run erosion to develop them. Dry wind and rock particles do not write the hydraulic flow-history atlas.

The material uses broad mineral variation, strata, exposed edges, sheltered dust, actual deposited material and flow-aligned dark streaks. The controls are artistic material influences, not calibrated chemical staining, vegetation growth or physical satellite spectral bands.

### GPU storage and performance scope

Two RGBA32F XYZ atlases retain flow history, plus one request atlas (RGBA32F when float blending is supported, otherwise RGBA16F). At this resolution the additional storage is about 41.3 MiB with float32 requests, or 34.5 MiB with float16 requests. The 2D atlas layout is storage for XYZ voxels, not a heightmap.

Scatter writes a third target for weighted velocity/exposure. The existing apply pass writes a fourth target for history, decaying it by 0.996 per 0.04 s tick and bounding exposure at 128 while preserving weighted direction. It does **not** alter material acceptance, the sediment ledger, particle lifetimes or erosion strength. Reset/regenerate clears history. Manual edits retain world-space historical contact values; newly exposed surfaces normally have no contact history. History is not an advected fluid or a resumable flow simulation.

All steady-state processing stays on WebGL2. No per-step CPU particle/volume transfer or additional full-volume solver pass was introduced. Rendering adds SDF samples and atlas reads, so this is not a claim of zero GPU cost. Browser checks use SwiftShader, not native-GPU performance benchmarks.

## River and rendered water: one visible path

1. Open **Water → Draw river route**, or **Erosion → River → Draw river route**.
2. Click terrain **upstream to downstream**. Points start 0.22 m above the picked surface. At least two are required.
3. Click **Finish / edit**. The numbered handles, **INLET** label and direction arrow remain visible.
4. Edit **width, speed and individual point Y** in the route inspector. Drag handles in XZ, or use G/R/S. Y translation moves only the selected point/route; it no longer changes all rivers. Rotation around Y retains the route's grade.
5. Run the River emitter. Every generation enters at point 1 of a visible route, with bounded lateral spreading across its width. With several routes, inlet selection is weighted by route length.

**No route means no river births and no rendered water, on every terrain preset.** There is no hidden pond or canyon fallback. Hiding/deleting the last route also removes rendered water and stops new river births; existing carriers keep their inventory and retire normally.

The fixed canyon route action is removed. Width and speed are edited directly on each drawn route, without duplicated template controls. Routes, material history and sediment share the full [terrain domain](kilometre-workspaces.md).

A channel-cut spline can still create a separate water path. That action copies each point's XYZ grade and sets water elevation to its local bed plus 0.55 m, instead of flattening all points to an average level. The copied route is independent: later edits do not silently modify the other object. A water path by itself does **not** cut a channel; use a cut spline, sculpting or river erosion for geometry.

### Shared elevations, not a hidden flat plane

The shared 320 × 1 route texture stores segment endpoints, width, speed, arc distance, inlet and endpoint elevations. Rendering and particle transport read this same texture. Each segment has a linearly interpolated surface elevation; **Route surface offset** adds a common offset without erasing the individual grades. **Fallback elevation** is only a placement/template setting, not the height of existing routes.

The water shader intersects bounded inclined ribbons, then refines the displaced-wave intersection in a bounded interval. Surface normals include route grade and wave slopes. River births, current influence and hydraulic film depth use interpolated route elevation too. Wave crests remain a rendering effect rather than forces in the erosion solver.

This is still **artist-guided flow**, not a pressure solve, conserved free-surface hydrodynamics or a waterfall solver. Draw sensible downhill routes. An uphill path is not automatically repaired or physically validated. Elevating water well above the bed can create an unsupported water sheet; buried water is occluded and invalid buried births are rejected rather than moved to an unrelated location. Tight bends/segment transitions are approximate; crossing or vertically overlapping rivers do not solve junction discharge or independent fluid layers. The underlying terrain remains a fully 3D SDF.

## Persistence and verification

The existing `.frontier` export includes palette/mask settings and XYZ route descriptors, with `satmapModel: "volumetric-surface-material-v1"` and `flowHistoryIncluded: false`. Current loose-material inventory, particle state and flow history are not saved. An export is not a resumable simulation or material-layer checkpoint; no new importer is claimed.

Original validation for this version: **65 unit tests and 34 targeted browser/GPU tests passed**, including:

- palettes and all six diagnostic views change actual rendered pixels without changing SDF geometry;
- signed curvature recognizes exposed and cavity surfaces along all six XYZ axis directions;
- flow history records real water motion, excludes dry rock/wind, resets cleanly and introduces no steady-state CPU transfer;
- river births start at the declared inlet, reverse with the route and stop with hidden routes;
- rendered water follows route XZ and Y, and ignores changes to the old fallback level;
- percentage editing, category order, visible route creation, independent elevation editing and responsive left/right docking;
- sediment conservation, bounded lifetimes, aggregate cutting limits, water optics/animation, live cuts and intact fracture removal/undo.

These are implementation and rendering checks, not experimental physical validation or a guarantee of photorealism.
