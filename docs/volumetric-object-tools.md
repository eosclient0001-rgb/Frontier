# 3D object transforms, brushes and local procedural shapes

The workspace layout is unchanged: **outliner left, viewport center, properties/tools right**. Everything described here changes the existing bounded XYZ SDF. There are no imported noise textures, no heightfield replacement and no Gaea dependency.

## Moving and scaling splines

Select a cut spline in the outliner. The right inspector now has **Object transform / gizmo**:

- **Move · G** displays red X, green Y and blue Z endpoint handles. Drag an endpoint. In particular, **Y moves the curve and its actual channel bed vertically**. Moving down or increasing Cut depth makes a deeper channel; a cut above the terrain may not intersect it at all.
- Numeric **X/Y/Z position** edits the centroid of the whole path. Choose **Selected spline point** to edit one control point instead. Select the point from the existing point list first. The old XZ handle drag and point XYZ fields remain available.
- **Scale · S** displays square axis handles. X/Z stretch the route horizontally; Y scales its elevation differences and cut depth. Horizontal axis scaling adjusts the scalar channel width by the geometric mean of the X and Z scale factors. Cross sections are still circular/graded, not arbitrarily elliptical.
- **Apply scale ×** is a relative, uniform scale operation. It scales point offsets, full width and cut depth about the path centroid. The factor resets to 1 after applying; repeated applications multiply the current geometry.
- Use **Full width** to widen/narrow the cross section **without** stretching the route. Full width and depth support up to 16 m. Spline coordinates and transforms are clamped to the finite editing region.
- **Off** disables the gizmo without deleting the selected object. Choosing a sculpt/fracture tool also disables transform interaction, so it does not intercept brush strokes.

The gizmo uses a ray/axis closest-point calculation, not screen-height offsets masquerading as world Y. Nearly view-aligned axes may not be draggable; use the numeric field or orbit to another view. Moving an object leaves the camera unchanged. Guides remain X-ray overlays.

Water paths can also move and scale, but **Y adjusts the one shared horizontal water level for all water paths**, between 0.1 and 5 m. It does not introduce independently sloping water. Surface rendering, current and emission still use that shared level. Width controls the routed footprint; direction controls the GPU current.

## Volumetric sculpting — not height painting

The former visible Raise/Lower tools have been replaced with **Ridge / Dent** (keys **5 / 6**). The public studio workflow does not rely on vertical height warping. Legacy solver methods remain only for compatibility/reference tests.

| Brush         | Actual operation                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Ridge         | Adds solid density in a compact, optionally elongated 3D footprint around the picked surface. Works on walls, tops and undersides. |
| Dent          | Removes density in the same local volume; it can indent a vertical wall or the underside without lowering the terrain above it.    |
| Smooth        | Blends toward neighboring XYZ SDF samples inside the brush footprint.                                                              |
| Flatten 3D    | Blends locally toward the plane through the picked surface with its surface normal. Not a global horizontal plane.                 |
| Noise brush   | Applies signed 3D fractal displacement inside the brush footprint.                                                                 |
| Carve / Build | Retain the older full CSG stamp behavior; the new detail controls apply to the five detail brushes above, not these legacy stamps. |

**3D brush strength / dab** sets the displacement amplitude (Smooth/Flatten clamp their blend weight). **Falloff exponent** controls the soft edge. **Stroke elongation** stretches the tangent direction. **Normal depth / radius** changes the support along the surface normal. The GPU derives the normal from the SDF, so the brush orientation follows walls rather than assuming world up.

**Dab spacing / radius** controls stroke sampling. A stroke interpolates at most eight dabs between picked samples to bound GPU work. Brush texture settings include influence, wavelength, octaves and fBm/ridged/ridged-multifractal/billow families. Noise is sampled in world XYZ rather than UV tiles. These are spatially sampled strokes, not airbrush accumulation while the pointer is stationary. Interpolation is in world space, not geodesic surface tracing across occluded/disconnected surfaces.

These artistic density operations are not volume-conserving elasticity, a physical rock-fracture solve, or an exact distance-preserving transform. Manual edits invalidate the erosion volume audit. GPU detail brushes require floating-point WebGL2 render targets; no CPU erosion or heightmap substitute is silently used.

## Land plot properties

The existing width, length and top elevation remain. Additional properties:

- **Bottom elevation**, with at least 0.8 m thickness;
- **Edge rounding**;
- XYZ translation and gizmo scaling (Y scales thickness above the configured bottom);
- **3D surface noise & terracing**: fBm, ridged, ridged multifractal or billow; displacement amplitude, feature wavelength, 1–5 octaves, persistence, lacunarity, domain warp and independent noise seed;
- Terrace step and strength.

Noise is applied to the **3D density around the bounded box**, including its sides and underside, not just the top elevation. Terracing warps the local Y coordinate through smooth plateaus before SDF evaluation. Plot creation/regeneration runs in the existing worker; live shape/cut composition and brushes remain GPU operations.

**Plot base-property changes regenerate the base and clear sculpting, erosion and fractures.** Remaining shape/cut guides are reactivated and reapplied. Plot gizmo changes apply on release; curve and boulder gizmos update their live modifiers during the drag. Controls correctly stay unavailable during queued/in-flight regeneration, preventing a new object or stroke from being lost to a pending base reset.

## Shape / boulder objects

Choose **+ Add → Shape** in the left outliner. A live ellipsoid appears above the plot center. Select it to edit:

- name and visibility;
- ellipsoid/boulder, rounded box, capsule/river stone, torus/rock ring, egg/teardrop, organic cluster, or rounded cylinder;
- **Organic profile** adjusts capsule cap length, torus thickness, egg asymmetry or cluster lobe blending (disabled for ellipsoid, box and cylinder);
- full XYZ size (0.8–20 m), XYZ position and numeric XYZ rotation;
- rounded-box edge radius;
- the same local 3D fractal noise controls;
- geometric terrace step/strength.

Noise is evaluated in the selected shape’s **local XYZ coordinates**. Moving/rotating it carries its noise with it; sizing the primitive does not automatically change the independent noise wavelength in meters. Noise/terracing modifies the shape’s own distance function before union with the scene, so distant terrain is unaffected. The available ridged multifractal uses octave-dependent weighting; these are Gaea-like procedural concepts, **not a Gaea node graph, asset import, or exact clone of proprietary nodes**.

Up to **six live/baked shape descriptors** can exist, alongside four cuts and four water routes. Shapes fuse into the common SDF first; enabled cut splines subtract afterward, so a channel can cut through boulders as well as the plot. A shape can be moved free of the ground, but it is not a rigid-body object with gravity/collision dynamics. Geometry is kept closed within the finite volume boundary; very large/off-center shapes are cropped by that bound.

### Live versus baked

The scene retains a GPU base checkpoint before live geometry. Editing, hiding or deleting a **live** shape/cut restores that checkpoint and recomposes the enabled modifiers. Hiding/deleting the final live object restores the original base exactly, including material channels.

**Sculpt brushes, erosion and geometric fractures bake live shapes and cuts first.** A boulder can therefore be sculpted in 3D, but afterward its old parametric guide is marked **baked** and its transform/noise controls are read-only. Brushes operate on the combined SDF, not isolated per-object sculpt layers. This avoids losing later sculpt/erosion work when replaying an old primitive. **Bake live geometry** also makes this transition explicitly.

Removing or hiding a baked guide does not remove its already-baked solid/cut. Regenerating the base clears destructive edits and reactivates remaining descriptors. There is no general nondestructive sculpt-layer stack or general transform undo; the existing one-edit fracture undo is separate.

The terrain visibility control hides the **combined SDF rendering**, not only the original plot, while preserving its collision volume. Live shape visibility actually adds/removes that primitive from the composed field. This follows from shapes being SDF modifiers rather than independently rendered meshes.

## Precision, cost and export

The volume remains **112 × 72 × 112**, roughly 0.36–0.39 m per voxel. Subvoxel detail and high noise octaves cannot become finely resolved geometry; they can alias. Large noise displacement/strong terracing is artistic density deformation, not an exact distance field. The renderer’s bounded ray marching and grid interpolation remain in use. Shape noise costs up to five octaves per voxel per live shape update; continuous dragging at maximum object/noise counts can be expensive.

The existing live checkpoint is reused (about 27.6 MiB for terrain/material atlases). Brush steps and live shape composition perform no full-volume CPU upload/readback; explicit picking, export and diagnostics remain separate. No native-GPU frame-rate claim is based on the sandbox’s software-renderer tests.

Export includes the current baked volume and all shape/spline/brush/plot settings. It **does not** include the pre-modifier checkpoint, a resumable sculpt history, water mesh or active particle state. `liveModifierBaseIncluded: false` remains explicit, and there is still no importer UI. Do not replay exported live descriptors on top of an already-baked exported field as if it were the original base.

## Tests

`tests/object-tools.test.js` covers seedable XYZ noise families, volumetric/rotated shapes, terracing, spline translation/scale/point mode, ray-axis math and plot dimensions/noise. `tests/browser/object-tools.spec.js` exercises real WebGL2 geometry and UI: rotated shape noise versus the CPU reference, distant occupancy unchanged, exact hide/restore, deeper spline cuts, vertical-wall and underside brushes, texture effects, no brush CPU transfers, boulder Y-gizmo and scaling, camera unchanged, plot-noise regeneration, and whole-spline Y/width/depth scaling.

For the reorganized controls, exact value entry and creation menus, see [Studio interface](interface.md). Brushes now live in the **Sculpt** tab; relative uniform scaling is under **Transform → More options**.

## Gizmo shortcuts and rotation

Select a live object in the left outliner, then press **G = Move**, **R = Rotate**, or **S = Scale**. The key selects a gizmo; drag its handles to apply a relative transform. Rotation uses red X, green Y and blue Z rings about world axes, with shape-local noise rotating with the solid. Rings nearly edge-on to the view may be hard to pick; orbit to another view. Shape rotation values remain editable in degrees under **Rotation & edge rounding**.

Shapes and plots rotate in XYZ. Plot rotation regenerates the base on release, with the same destructive-edit warning as plot size changes. Cut splines rotate their control positions about their centroid; their cutters remain world-Y, open-top channels, not rigidly rotated tunnels. Water paths rotate around Y only: the shared surface stays horizontal.

**Camera input is separate:** hold right mouse for look plus WASD/QE flight, with Shift boost. Release right mouse before using G/R/S; **Home** resets the camera. Shortcuts ignore text/number inputs, selects, contenteditable fields, modified shortcuts and key repeats. Gizmo changes are blocked during a transform drag or RMB flight. Blur/Escape ends the active gesture and clears flight keys; it does not undo the transform.

The added primitives are analytic XYZ density fields, not imported meshes or height-based stamps. Torus holes are real empty volume; high noise can fill them. Nonuniform size/profile and noise deformation are conservative/artistic field approximations, not globally exact signed distances. They retain live visibility, independent noise, terracing, rotation, and shape-first/cut-second composition.

Additional coverage: `tests/rotation-primitives.test.js` verifies hotkey guards, rotation composition including gimbal configurations, plot/path rotation and primitive geometry. `tests/browser/rotation-primitives.spec.js` compares all seven rotated GPU primitives against the CPU, verifies live profiles and a real torus hole, and drags a rotation ring while checking both SDF changes and camera invariance. Camera tests require RMB flight and Home reset.
