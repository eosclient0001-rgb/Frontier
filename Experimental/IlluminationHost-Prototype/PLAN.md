# Vehicle, sparks and steering: plan and status

Status key: **Done** = in this change and exercised by the headless harness on the Vulkan (SwiftShader) path; **Planned** = not yet built.

## 1. Remove tyre deformation — Done
- The carcass is no longer drawn deformed. `DeformTyre` and `DeformTyrePosition` in `Shader/TyreCarcass.wgsl` now only reshape a *shredded* tyre (`Shape.w > 0.5`), which keeps the rigid rim, hub and bead seat.
- `TyreCarcassSolver.EncodeRecord` sends zero deflections. The soft-tyre dynamics in `VehicleSolver.js` are untouched.
- Removed the "Soft tyres" switch, the "Deformation ×" slider and the exaggeration note from `InspectorPages.js`, and the `TyreDeformation`/`DeformationScale` settings from `IlluminationHost.js`.

## 2. Sparks: emissive light and derez fade — Done
- **Emissive light:** each spark has a hot core and a halo three times its width (`Shader/SparkRaster.wgsl`), so it throws glow onto its surroundings.
- **Derez:** below 1350 K the spark breaks into 2.5 px blocks. Each block drops out when its seeded hash falls below the derez progress, so the spark dissolves rather than fading. It is gone at 950 K.

## 3. Sparks colliding with world geometry — Done
- `SparkSequence.CollideWithWorld` tests each spark against the rigid-body world's obstacle boxes (`Bodies.Obstacles`: walls, barriers, props, containers). On a strike it pushes the spark out through the nearest face and reflects the normal velocity (restitution 0.35), keeping 80 % of the tangential speed.
- The ground was already handled by `ResolveCourseHeight`.

## 4. Realistic spark colour — Done
- The old look was yellow because the brightness scaled as T⁴ with a peak of about 120 × (T/1500)⁴. The post tonemapper (ACES, per channel) then flattened it, so every channel saturated and the spark read as a yellow-white blob.
- The new radiance keeps the Helland blackbody hue and sets intensity to 2.2 × (span)² with span = (T − 950)/(3100 − 950). A spark is born at 2600–3100 K (white-yellow), passes orange near 2300 K and ends red near 1500 K, dimming as it cools.
- Verify on a real scrape: the colour should walk white → orange → dark red, not stay yellow.

## 5. Rim marks instead of skid marks when tyres are shredded — Planned
- `TyreMarkDepot.js` lays skid (rubber) marks. When a tyre is shredded, the rubber is gone and the rim is what touches the road.
- Plan: while a wheel's `Shape.w` is set, emit a rim-scuff mark (a rim-family deposit) instead of a rubber one, and keep the deposit on the rim family.
- Risk to check first: `ControlVehicleRim.facet` uses family 9 (the tyre family) for 1296 facets, so rim and tyre share a family and the mark family must be chosen per wheel, not per material.

## 6. Steering — already exists (no rebuild)
- The "ato" in the request is most likely **Ackermann**. Ackermann steering and steering input both exist:
  - A/D keys go through `DriverInputIntegrator.js`.
  - `VehicleSolver.js` lines ~342–349 apply a speed-scaled lock (`MaxSteerAngleRad` 0.52 rad) with an Ackermann split between the inner and outer wheels.
  - The cabin wheel uses `Steering.Ratio` 13.5 (`CabinStructure.js` line ~230).
- Action: review and tune the existing values if the steering feel needs changing. Do not add a second steering system.

## Added in this change (not in the plan list): body finish and ghost view
- **Finish:** the HMI's "Body finish & ghost view" card (Inspector → Body) applies a finish to the body's coat in the material table. Presets: Pearl, Graphite, Signal red, Ice flake; Custom uses hue and gloss sliders. The coat record is rewritten in place (`ApplyBodyMaterial`), so the real car changes on the next frame. Verified: `?finish=3` renders the body in Signal red.
- **Ghost view:** screen-door transparency on the body, with an opacity slider. Verified: `?view=1` renders a dithered body.
- **Wireframe view:** only the triangle edges of every facet are drawn. Verified: `?view=2` renders the car as a wire frame. Facets are non-indexed triangles, so the barycentric weight comes from `vertex_index % 3`.
- Shared helper: `Shader/GhostView.wgsl`, included by `SurfaceRaster.wgsl` (main scene) and `ForwardRaster.wgsl` (cabin preview and Studio).

## Question: does the physics use Jolt?
No. The prototype has no Jolt reference. Its physics is the custom `Source/RigidBodyWorld.js` (about 976 lines), with `VehicleSolver.js` for the vehicle. The Jolt question is answered here only as far as the prototype goes.
