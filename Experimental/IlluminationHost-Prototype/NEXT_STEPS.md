# Vehicle and VFX implementation status

The previous five-point plan is implemented in the **WebGPU browser prototype** on this branch. It does not change the separate React configurator or constitute a native C++ port.

| Plan item | Implementation |
| --- | --- |
| Remove tyre deformation | Removed 96-node visual carcass solver and deformation UI. `VehicleRecord.js` and `VehiclePose.wgsl` keep rigid tyre meshes, shredded-rubber rim remnant, live steering wheel and cockpit. Physical pressure, tyre compliance, grip and failure in `VehicleSolver.js` remain. |
| Sparks: realistic colour, world collision and illumination | `SparkSequence.js` uses a cooling Planck-ratio red/green/blue ramp with bounded intensity, swept course and box-body collisions with bounce, and up to three clustered spark lights. The direct and surface-card passes apply inverse-square light with distance-field shadows. |
| Derez/rez light | `EffectSequence.QueryLight()` adds one bounded vehicle VFX light (the fourth transient slot), fading with emitter lifetime. Nearby static cards are prioritised during the effect; when all transient lights stop, lighting is invalidated to prevent lingering bounce. |
| Shredded rim marks | `TyreMarkDepot.js` stops rubber deposition on shredded wheels, writes narrow rim scrapes into a separate texture and shades them with a metallic-grey family without tread grooves. Respawn resets stamp tracking while preserving existing marks. |
| Steering correction | Hands-off, grip- and speed-dependent self-centering is on by default. Optional bounded drift countersteer is off by default; both switches are in the Vehicle inspector. Manual A/D has priority. |

**Validation:** `npm --prefix Tools run validate`, `HOOKS=Tools/TransientValidation.mjs node Tools/HeadlessHarness.mjs . 12 '?capture=1&quality=low'`, `node --test Tools/*.test.mjs`, and `node Tools/VehicleStability.mjs .`. The Dawn null backend validates WebGPU programs/commands; visual calibration on a physical GPU remains advisable, especially spark brightness and night-scene indirect light. Dynamic debris use conservative AABBs for spark collision, not exact convex hull contact.

**Physics:** this prototype does **not** use Jolt Physics. `RigidBodyWorld.js` is a custom JavaScript 120 Hz sequential-impulse solver, while `VehicleSolver.js` handles the car. Migrating to Jolt would be a separate C++ integration task.
