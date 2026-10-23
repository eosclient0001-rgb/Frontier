# Frontier — Vehicle Physics Port (agent instructions)

This repository is the **vehicle-physics port branch**: the C++ drivetrain / suspension / tyre stack, the Jolt rigid-body
extension, and the three modular tyre models, landed with pinned provenance. Read this file before touching anything here.

The production project lives upstream — this branch exists so a port can be reviewed and rebuilt in isolation, and so
work that was deleted upstream cannot be lost again.

---

## 1. Authoritative sources — do not re-derive, re-read

| What | Repository | Branch | Commit | Date (UTC) |
|---|---|---|---|---|
| **Main project** (CLAUDE.md, house rules, folder map) | `SultanAladin/Frontier` | `arena/649fea90-frontier` | `4ef9f213fb9fb8728bd384d4f7f62e9de5aba07f` | 2026-10-23 |
| **Current porting work-in-progress** (Phase 7: Jolt + vehicle) | `c7egoist/Frontier` | `arena/ec6ca01d-frontier` | `d99f5e51aa11874deaf0ac37eebdfb7d463de4ce` | 2026-10-23 10:06 |
| **Project-Drive vehicle dynamics reference** (C++ truth for the car) | `SultanAladin/Frontier-` | `arena/215a6f39-frontier` | `f2cfc57daaaf1fafc9a01a2002af6cad8cbd0f0f` | 2026-10-14 |
| **Recovered XPBD carcass tyre** (last commit before deletion) | `SultanAladin/Frontier-` | commit | `ff77585f17e5d4d672f49e9ebeaa3b7dacd69a17` | 2026-10-13 22:04 |
| **The commit that deleted the XPBD tyre** | `SultanAladin/Frontier-` | commit | `9ceb33cefa243bfb52923e5cf0712d69e9ce3be8` | 2026-10-13 23:59 |
| **3D FEM (volumetric) tyre reference** — JS/WGSL | `c7egoist/Frontier` | `arena/3488daf0-frontier` | `a9f66fb699f7a6f278f4b7b7e06a6993f1d80fd6` | 2026-10-16 |
| **Volumetric tyre research + hardening reports** | `SultanAladin/Frontier-` | `arena/c6fa8143-frontier` | `f70ceed418ecf227f95e95539c4e76fc449c104d` | 2026-10-16 |

Full detail, including the branches that still carry an older copy of the deleted tyre, is in
`Docs/VehiclePort/RecoveryMap.md`. The plan and current status are in `Docs/VehiclePort/PortReport.md`.

### Project-Drive — the reference the vehicle physics is ported from

`SultanAladin/Frontier-` is the Project-Drive tree. Its vehicle layer is the authority for everything below the HMI:

```
Engine/PhysicalDynamics/RigidBodySolver.{h,cpp}            Jolt world: fixed 60 Hz accumulator, step cap, interpolation
Engine/PhysicalDynamics/VehiclePhysicsThread.{h,cpp}       physics on a worker, decoupled from the render frame
Engine/PhysicalDynamics/Vehicle/VehicleSolver.{h,cpp}      the car: chassis hooks, struts, four tyres, telemetry
Engine/PhysicalDynamics/Vehicle/Drivetrain.{h,cpp}         engine → clutch → gearbox → differential
Engine/PhysicalDynamics/Vehicle/SuspensionSpecification.h  struts, rates, anti-roll bars, calibration
Engine/PhysicalDynamics/Vehicle/PacejkaMagicFormula.{h,cpp} MF6.1 with combined-slip weighting
Engine/PhysicalDynamics/Vehicle/TyreSlipDynamics.{h,cpp}   transient slip (relaxation length)
Engine/PhysicalDynamics/Vehicle/Aerodynamics.{h,cpp}       drag/lift/downforce
Engine/PhysicalDynamics/Vehicle/BrakingSystem.h            brakes/ABS
Engine/PhysicalDynamics/Vehicle/ThermalIntegrator.h        tyre thermal state
Engine/PhysicalDynamics/Vehicle/VehicleGeometry.{h,cpp}    ControlVehicle chassis/corner geometry
Engine/PhysicalDynamics/Vehicle/RigidWheel.h               trace-fan contact + TyreReaction record
```

Rules that follow from that:

- **Jolt is the physics engine and it is C++.** Port physics from the C++ (`SultanAladin/Frontier-`), never from an HTML
  or JS prototype, and never compare an HTML demo's numbers to Jolt's. JS/WGSL prototypes are *algorithm references*
  only — the volumetric tyre is the one case where the JS is the only implementation, and it is ported equation by
  equation, not copied.
- **`RigidBodySolver` is the only Jolt surface.** Nothing above it includes a Jolt header; the vehicle layer reaches the
  chassis through `Hooks` and `JoltVehicleBinding`.
- **The module is `FrontierJoltPhysicsExtension`** (Jolt world + `RigidBodySolver`) and `FrontierVehiclePhysics`
  (drivetrain, suspension, tyres) — the names the current port already uses. Do not reintroduce a parallel
  `PhysicalDynamics` library name for the same code.
- **Jolt is pinned**: 5.3.0 at revision `0373ec0dd762e4bc2f6acdb08371ee84fa23c6db`, restored by
  `python Automation/PrepareJolt.py` into the ignored `ExternalPackages/`. Do not vendor it.
- **Physical tyre/road coefficients are not PBR material values.** `VehicleContactMaterial.h` holds the friction pair;
  `performance-rubber.material` is appearance only.

---

## 2. House rules inherited from the main project

Read `CLAUDE.md` at the main-project branch above before changing naming, formatting or folder placement. The points
that matter most here:

- Units are SI and are written in comments: `[m] [kg] [s] [N] [N·m] [Pa] [rad]`.
- Frame: right-handed, **+Z up**, chassis-local **+X forward**, **+Y left**, axle **+Y**; positive spin rolls toward +X.
- `Engine/` is production code; `Exhibits/` is validation code and retained evidence; `Experimental/` is prototypes;
  `_ClaudeScratch/` is disposable and ignored. Do not put a proof in `Engine/`.
- Validation must exercise the changed behaviour and must state what it does **not** prove. "It compiles" is not
  evidence. Numbers in a report must come from a run that is reproducible from this tree.
- Do not silently weaken a rule or a check to make it pass. If a check is wrong, say so and fix the check explicitly.

---

## 3. Building and verifying here

There is no root `CMakeLists.txt` on this branch — it is a module port, not the application. Build the module:

```bash
cmake -S Exhibits/VehiclePhysics -B build/vehicle
cmake --build build/vehicle
ctest --test-dir build/vehicle --output-on-failure
```

Without `cmake`, the headless targets build directly (this is what the sandbox runs):

```bash
g++ -std=c++20 -O2 -o build/TyreModelValidation \
    Exhibits/VehiclePhysics/TyreModelValidation.cpp \
    Engine/PhysicalDynamics/Tyre/TyreModelFactory.cpp \
    Engine/PhysicalDynamics/Tyre/Jolt/RigidTyreModel.cpp \
    Engine/PhysicalDynamics/Tyre/Xpbd/XpbdSpringTyreModel.cpp \
    Engine/PhysicalDynamics/Tyre/Xpbd/XPBDSoftTyre.cpp \
    Engine/PhysicalDynamics/Tyre/Fem/FemTyreModel.cpp \
    Engine/PhysicalDynamics/Vehicle/PacejkaMagicFormula.cpp \
    -IEngine -IEngine/PhysicalDynamics -IEngine/PhysicalDynamics/Vehicle
```

The Jolt targets (`JoltPhysicsValidation`, `JoltVehicleBindingValidation`, `VehiclePhysicsComponentValidation`) need
`ExternalPackages/JoltPhysics`; the CMake skips them when it is absent and says so.

---

## 4. Current state — read before you start

`Docs/VehiclePort/PortReport.md` is the status, the evidence and the remaining plan. Summary:

- ✅ Drivetrain, suspension, Pacejka, slip, aero, braking, thermal, geometry and the Jolt binding are landed and pass
  their headless checks (35/35 and 38/38).
- ✅ The three tyre backends exist behind one interface and pass `TyreModelValidation`.
- ⛔ `VehicleSolver` still constructs the rigid path directly; wiring it to choose a `TyreModel` backend is the next
  step, and the reason it is a step and not a switch is documented there.
