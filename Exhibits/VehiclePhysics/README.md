# 🧩 VehiclePhysics — Phase 7: three tyre models, vehicle dynamics, Jolt collisions

Proves the production physics in `Frontier/Engine/Physics/` against the HTML demonstration's own code and numbers, then
drives the car on it. Run everything (Jolt 5.2.0 is fetched/built once into `_ClaudeScratch/`, node runs the demo's
JS oracles):

```
PYTHON=<pillow python> bash Exhibits/VehiclePhysics/RunVehiclePhysics.sh
```

## ⭐ What was ported, and what was not in the demo to port

| Model | Demo source | Verdict | Production file |
|---|---|---|---|
| Tyre force (Pacejka MF6.1) | `TyreSlipSolver.js` ✔️ real | ported 1:1 | `TyreSlipSolver.{h,cpp}` |
| Carcass spring K = 25 kN/m + 0.9·p + vehicle | `VehicleSolver.js` ✔️ real | ported 1:1 | `VehicleSolver.{h,cpp}`, `VehicleSpecification.h` |
| Tyre heat / gas law / grip / wear | `TyreThermalSolver.js` ✔️ real | core ported 1:1 (smoke emission excluded, stated) | `TyreThermalSolver.{h,cpp}` |
| "3D FEM" deformation | `VehicleVisual.wgsl ResolveWheelVertex` ✔️ GPU PB-FEM *deformation* | ported 1:1 (vertex math + encoder) | `TyreDeformation.h` |
| XPBD soft-body lattice | 🔴 **not in the demo** ("there is no XPBD carcass here") and not in this repo | **implemented new**, calibrated to the same tyre | `TyreCarcassLattice.{h,cpp}` |
| Collisions | `JoltWorld.js` (Jolt WASM loose bodies + chassis proxy) | same architecture on Jolt C++ 5.2.0 | exhibit `Code/JoltScene.cpp` |

Stated deviations of the vehicle port: the driving surface is a caller height function (flat here) instead of the demo's
sculpted course; wheels do not ride loose debris (the demo's `RigidBodyWorld` support query); the 700-point hull is not
assigned, so the demo's sphere hull stands in; scrape/spark bookkeeping (visual only) is omitted. The car is *not*
Jolt-driven — exactly as in the demo, its own 480 Hz solver drives, and Jolt owns loose bodies plus a zero-gravity
chassis proxy that exchanges only collision velocity deltas.

## ✔️ Checks (29/29, see Results.txt)

- **A1–A4** MF6.1 Fx/Fy/combined/relaxation vs `Code/TyreOracle.mjs` running the demo's unmodified JS under node:
  max relative error **1.8e-15** (bit-exact port). **A5** PB-FEM vertices vs a WGSL transliteration: 8.7e-08 m.
  **A6** thermal trajectory (25 kW slide, 8 s): error **0.0** — the conduction/gas-law/grip port is exact.
- **B** Static settle vs the demo's `VolumetricTyrePhysics.test.mjs`: deflection 14.0–14.5 mm (band 10–25), contact
  angle −π/2, 220 kPa, corner loads sum to weight within **0.00 %**.
- **C** XPBD lattice rig vs the spring curve: within **0.75–1.30×** at 220 kPa for 10–40 mm deflection, force ordered
  by pressure, enclosed volume conserved to +0.31 % under 20 mm load. ⚠️ Disclosed residual: at 0 kPa gauge the
  lattice runs ~2× stiff past 20 mm (belt geometric floor; the spring model's flat-tyre regime is softer) — visible
  in `CarcassCurves.png`, not hidden by the tolerance choice.
- **D** The whole car on the lattice carcass: settles at 13.6 mm mean deflection (spring: 14 mm) and drives
  (20.4 m, 12.5 m/s in 3 s WOT).
- **E** Scripted drive on the 1:1 spring model: launch to **36.8 m/s in 7 s** with AMT upshifts and 1.17 bar boost;
  governed slalom (4 yaw sign changes, 0.064 rad peak slip angles); full brake stop; **line-lock burnout** — rear slip
  pegged at the 1.5 clamp while the car stays under 0.12 m/s and rear tread climbs **+78 K** through the thermal
  model; release launches the car.
- **F** Jolt scene: **10/10 cones** displaced/tipped with 12.24 m/s of velocity exchanged back into the car; wall
  impact at 12.3 m/s stopped to 0.24 m/s by the proxy exchange, nose penetration 0.023 m.

## Evidence files

`Results.txt`, `PacejkaCurves.png`, `CarcassCurves.png`, `TyreDeformation.png` (FEM outlines + lattice particles),
`DriveTrace.png`, `JoltScene.png`, and the CSVs they render (`pacejka.csv`, `lattice.csv`, `lattice_particles.csv`,
`fem_outline.csv`, `drive.csv`, `jolt_trace.csv`). Code lives in `Code/` per exhibit convention and links only
production physics + Jolt — no exhibit-local physics.
