# Vehicle physics exhibits

Validation code for the ported vehicle stack and the three tyre backends. Every program is headless, prints PASS/FAIL per
check, and returns non-zero on failure — so it can gate CI without a GPU.

## Programs

| Target | Sources | Covers |
|---|---|---|
| `TyreModelValidation` | `TyreModelValidation.cpp` + `Engine/PhysicalDynamics/Tyre/**` | all three tyre backends through one `TyreModel` interface; load, contact, deformation, element inversion, slip signs |
| `PortedVehicleValidation` | `VehicleValidation.cpp` + the engine-agnostic vehicle sources | drivetrain, LSD, clutch, Newton vs relaxation-length slip, near-standstill stability |
| `PortedVehicleSceneValidation` | `VehicleSceneValidation.cpp` + same | a mocked chassis driven for 3 s: accelerate, brake to rest, steer, rest on a 6 % slope |
| `JoltPhysicsValidation` | needs `ExternalPackages/JoltPhysics` | the Jolt world: fixed-step accumulator, step cap, primitives, interpolation α |
| `JoltVehicleBindingValidation` | needs Jolt | vehicle forces applied to a Jolt chassis through the binding |
| `VehiclePhysicsComponentValidation` | needs Jolt | the full component lifecycle: bring up, four tyre contacts, drive, brake, retire |

## Build

```bash
cmake -S Exhibits/VehiclePhysics -B build/vehicle
cmake --build build/vehicle
ctest --test-dir build/vehicle --output-on-failure
```

The Jolt targets are added only when `ExternalPackages/JoltPhysics` exists; restore it with
`python Automation/PrepareJolt.py` (Jolt 5.3.0, revision `0373ec0d`, checksummed). When it is missing CMake prints a
status line and skips them — it never silently substitutes a different physics engine.

Without CMake (this sandbox), see `CLAUDE.md` §3 for the direct `g++` lines.

## Results — 2026-10-23

Environment: Debian 12, `g++ 12.2.0`, `-std=c++20 -O2`, 2 vCPU, no GPU, no Jolt.

```
TyreModelValidation        ALL CHECKS PASSED (0 failed checks)
PortedVehicleValidation          35 passed, 0 failed
PortedVehicleSceneValidation     38 passed, 0 failed
```

Tyre seam, hub held 10 mm low on a flat plane, 60 steps at 60 Hz (one tyre):

| backend | reaction | contact | substeps | wall |
|---|---|---|---|---|
| `RigidTraceFan` | 2 500.0 N | 15 samples | — | 0.06 ms |
| `XpbdSpringCarcass` | 3 620.7 N | 21 samples | 16 × 1 sweep | 20.7 ms |
| `VolumetricFem` | 1 613.0 N | 12 nodes | ~167 explicit | 840.8 ms |

Stiffening with squash — `XpbdSpringCarcass` 1 785.8 N @ 5 mm → 5 828.7 N @ 25 mm; `VolumetricFem` 925.6 N → 5 136.0 N.
Slip signs (rigid backend, 10 m/s): free rolling 0.0 N, wheelspin +4 475.7 N, leftward slide −3 822.4 N.

## What this does **not** prove

- No backend is calibrated against measured tyre data. The table above is a *consistency* comparison — same wheel, same
  ground, three solvers — not a validation of the magnitudes.
- The Jolt targets were not run: `ExternalPackages/JoltPhysics` is absent and `cmake` is not installed here.
- Nothing rendered, nothing on Windows/MSVC, no frame-time budget measured with four tyres at shipping mesh resolution.
- `PortedVehicle*` runs against the exhibit's mock chassis integrator, not against Jolt.

Retained evidence belongs here with the code that produced it; do not move these programs into `Engine/`.
