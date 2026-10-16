# Vehicle prototype follow-up plan

**Status:** planned work for a later iteration. This change only reconstructs the WebGPU prototype and integrates the live Garage material/view controls; the items below are not implemented yet.

## 1. Remove the unsatisfactory tyre deformation

- Remove the current visual carcass deformation from the tyre vertex path and the inspector's `Deformation ×` controls.
- Keep the tyres' intended physical support, pressure, wear, puncture, burst and shredded-rim states unless a separate physics decision says otherwise; removing the visual deformation does not automatically mean removing tyre pressure or failure simulation.
- Rebaseline the static tyre shape, contact patch, wheel shadows, camera rigs and tyre telemetry against the authored model. Check inflated, low-pressure, airborne and shredded cases.

## 2. Rework sparks and their interaction with the world

- Give sparks a genuinely emissive hot core and a short-lived, energy-limited local light contribution; avoid spawning an expensive full light for every particle.
- Add collision against world geometry, with bounded bounce/slide and lifetime loss, using the existing course/world collision representation where possible.
- Replace the current colour ramp with a temperature/age-based progression validated against reference footage: hottest core near white/yellow, cooling through orange toward red/dark before extinction. The current yellow-to-orange progression needs review rather than a cosmetic hue tweak.
- Keep spark emission, collision and lighting togglable for performance testing; validate night and daytime exposure.

## 3. Use rim marks after a tyre is shredded

- Stop depositing rubber skid marks from a shredded wheel.
- Add a separate rim-contact mark/deposit path with a metallic abrasion colour and width tied to rim contact, preserving ordinary rubber tread marks for intact tyres.
- Test transitions at the exact shred event, wheel lift/recontact, stationary scraping and steering; ensure old tyre marks are not rewritten as rim marks.

## 4. Add steering self-correction / assist

- Prototype a low-speed- and speed-aware steering return-to-centre / yaw-stability assist (the likely meaning of “auto-correct”), with a user-adjustable strength and a clear off switch.
- Do not fight deliberate steering: fade assistance with steering input, avoid injecting torque while stationary, and clamp the correction so it cannot create oscillation.
- Compare straight-line release, lane-change, drift recovery, reverse and handbrake tests; tune against steering-wheel animation and front-wheel angle.

## 5. Physics backend decision: Jolt

- **Current status:** this prototype is not using Jolt Physics. `VehicleSolver.js` and `RigidBodyWorld.js` are custom JavaScript solvers; the package manifests do not include Jolt.
- For the next physics pass, evaluate a supported Jolt WebAssembly binding for rigid bodies, collision queries and vehicle constraints. First document which systems must migrate (vehicle/chassis, debris/cones, world queries), then build a small parity test before replacing the current solver.
- Preserve deterministic scripted regressions and compare contacts, stopping distance, rollover recovery, debris behavior and frame cost before deciding to migrate. Do not silently mix Jolt and custom collision semantics.

## Acceptance checks for the next pass

- No unwanted tyre mesh deformation in any camera or shadow pass; pressure/failure behaviors remain intentional.
- Sparks visibly illuminate nearby surfaces, collide with world geometry and cool with a plausible colour curve without unbounded light or particle cost.
- Shredded tyres leave rim marks only; intact tyres still lay rubber marks.
- Steering assist is stable, optional and does not override deliberate input.
- Physics-backend choice (retain custom solver or migrate to Jolt) is documented with a reproducible benchmark and regression results.
