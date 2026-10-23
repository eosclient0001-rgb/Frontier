# Vehicle physics port — status report

**Date:** 2026-10-23 · **Branch:** `arena/248067c7-frontier` · **Base:** `eosclient0001-rgb/Frontier` @ `d878111` (README only)

---

## 1. What this session found

The lost tyre work is not lost. It was deleted on purpose.

| Finding | Evidence |
|---|---|
| `arena/215a6f39-frontier` @ `f2cfc57` — the branch the current port was taken from — is a **descendant** of the commit that holds the XPBD tyre | `git merge-base --is-ancestor ff77585 215a6f39` → true |
| The tyre was removed at `9ceb33c`, 2026-10-13 23:59 UTC, *"Remove XPBD from the vehicle stack"* | `git show --stat 9ceb33c` → `XPBDSoftTyre.cpp −888`, `.h −524`, validation `−209`, solver `−336` |
| The newest surviving revision is the commit **2 h before** the deletion | `ff77585` 22:04, 56 016 bytes |
| Seven branch tips still carry a copy — of the **12 October** revision, `8 077` bytes and two fixes older | blob `3ac28237` vs `ee2cfa3c` |
| There is **no C++ 3D FEM tyre anywhere**; only the WebGPU demo | `c7egoist/Frontier arena/3488daf0-frontier:Experimental/TyreVolumetricDemo/src/tyreCore.js` |
| The `JoltPhysicsExtension` rename the owner asked about is **already done** in the current WIP | `FrontierJoltPhysicsExtension` in `ec6ca01d:CMakeLists.txt` |

Full branch-by-branch map, with SHAs, byte sizes and the recovery command: `Docs/VehiclePort/RecoveryMap.md`.

---

## 2. What was done, in this tree

The checkout started from a repository containing one README. So the port lands as a **module tree** at the project's own
paths, with provenance pinned in `CLAUDE.md`.

### 2.1 Recovered — landed byte-identical

| Landed at | Origin |
|---|---|
| `Engine/PhysicalDynamics/Tyre/Xpbd/XPBDSoftTyre.{h,cpp}` | `SultanAladin/Frontier-` `ff77585` (56 016 B, the last revision) |
| `Engine/PhysicalDynamics/Tyre/Xpbd/XPBDTyreValidation.cpp` | same commit |
| `Engine/PhysicalDynamics/Tyre/Xpbd/XPBDTyreSolver.{h,cpp}` | same commit (Phase-0 skeleton, kept as reference) |
| `Experimental/TyreLattice/index.html` | same commit, the WebGPU lattice study |

Two mechanical edits, both commented in-file: namespace → `Frontier::Vehicle::Xpbd` (it collided with the vehicle stack's
own `TyreReaction` / `HubMotion` / `Vec3`), and its private vector maths replaced with the shared `VehicleMath.h`
(API-identical, so one `Vec3` in the engine instead of two that can drift). **No physics line changed.**

### 2.2 Ported — the current Phase-7 work

`Engine/PhysicalDynamics/{RigidBodySolver, RigidBodyCoordinates.h, Vehicle/*}` from
`c7egoist/Frontier arena/ec6ca01d-frontier` (`d99f5e5`), plus its `Exhibits/VehiclePhysics/*` validation programs and the
pinned Jolt restore script (`Automation/PrepareJolt.py`, Jolt 5.3.0 `0373ec0d`).

This is the complete car: drivetrain (engine → clutch → gearbox → diff), suspension specification, Pacejka MF6.1, tyre
slip dynamics, aerodynamics, braking/ABS, thermal, ControlVehicle geometry, Jolt binding, and
`VehiclePhysicsComponent` — the lifecycle object that owns the Jolt world, the road and the chassis.

### 2.3 New — the modular tyre seam

`Engine/PhysicalDynamics/Tyre/` — one contract, three backends:

```
TyreModel.h                     TyreModelKind{RigidTraceFan, XpbdSpringCarcass, VolumetricFem}
                                class TyreModel { Build, Step, Reaction, GatherNodes, CarcassAngle }
                                CreateTyreModel(kind) → unique_ptr<TyreModel>
Jolt/RigidTyreModel.*           trace-fan load + Magic Formula (the Jolt-side production path)
Xpbd/XpbdSpringTyreModel.*      adapter over the recovered carcass — every knob stays reachable
Fem/FemTyreModel.*              NEW: 3D corotational tetrahedral FEM, ported from the WebGPU reference
TyreModelFactory.cpp            the only place that knows all three
```

The seam is deliberately narrow: a backend answers *"given a kinematic hub pose and velocity, what force and moment does
the road put back?"* — force and moment, nothing else. That is why all three can be used with any component: the chassis
cannot tell which one it holds, and a fourth model costs one class.

### 2.4 The FEM port — what it is

`FemTyreModel.cpp` reproduces `tyreCore.js` equation for equation:

```
Ψ  = μ E:E + ½λ (tr E)²                        Green–Lagrange strain, rotation invariant
S  = 2μE + λ tr(E) I
P  = F·S − p·cof(F)                            volumetric inflation term
f_k = −V₀ P·G_{k−1},  f_0 = −Σ f_k             first Piola–Kirchhoff nodal forces
```

Mesh: the same `(circumferential × radial × lateral)` revolve and the same Kuhn 6-tet split, so element ordering matches
the reference and the two can be diffed. Contact: penalty spring + Coulomb-limited friction, driven through the shared
`GroundQuery` instead of the reference's straight-line heightfield. Integration: explicit semi-implicit Euler at the
reference's `dt = min(1e-4, 1e-4·√(ρ/1000 · 6e6/E))`, capped by `MaxSubsteps`.

Two deliberate departures, both integration rather than model:

1. **The hub is kinematic.** The reference integrates its own suspended rim and drives it down a fixed track. Here the
   vehicle stack already owns chassis and strut; a tyre that integrated a second rim would be a competing chassis.
2. **Ground is a surface query.** A kerb is expressible; a heightfield-only query cannot represent a vertical face.

Known limitation, recorded in the header: the reference advects only the bead anchors, so the tread does not roll
through the patch (friction is still correct, and `CarcassAngle()` lets a renderer pose a procedural tread). True material
advection is follow-up work — the same gap `XPBDSoftTyre` closed with its own spin integrator.

### 2.5 One bug worth recording

The WebGPU reference indexes a row-major copy `a[]` whose `a5` is `m7`. Translating the adjugate inverse straight into
column-major `m[]` transposes the cofactors. It does not fail loudly — it produces `NaN` element forces on the first
substep and a tyre that reports zero contact. It cost a build cycle; the comment in `Invert()` and check 2 now pin it.

---

## 3. Evidence

**Environment.** Debian 12, `g++ (Debian 12.2.0-14+deb12u1)`, `-std=c++20 -O2`, 2 vCPU, no GPU. `cmake` is not installed
in this sandbox, so the targets were built with the explicit `g++` command recorded in `CLAUDE.md` §3 and in
`Exhibits/VehiclePhysics/README.md`; the CMake lists are provided but were **not** executed here.

### 3.1 The three tyre backends, one contract — `TyreModelValidation`

Same wheel (R 0.34 m, rim 0.20 m, 0.245 m, 12 kg, 110 kPa), hub held 10 mm low on a flat plane, 60 steps at 60 Hz:

| backend | vertical reaction | contact samples | substep regime | wall time |
|---|---|---|---|---|
| `RigidTraceFan` | 2 500.0 N | 15 | — | 0.06 ms |
| `XpbdSpringCarcass` | 3 620.7 N | 21 | 16 × 1 sweep | 20.7 ms |
| `VolumetricFem` | 1 613.0 N | 12 nodes | ~167 explicit substeps | 840.8 ms |

These are **consistency** numbers, not calibrated tyre loads — each backend uses its own published parameters and none has
been compared to measured data. What they do establish:

- all three build, step and report through the same `Reaction()` record;
- the deformable backends stiffen with squash (`XPBD` 1 785.8 N @ 5 mm → 5 828.7 N @ 25 mm; `FEM` 925.6 → 5 136.0 N);
- the tread is held at the road instead of passing through it (XPBD lowest node −0.03 mm against an undeformed −10.0 mm);
- no FEM element inverts (`min det F = 1.000000` — the reference's INVERTED ELEMENTS warning stays clear);
- slip signs are right: free rolling 0.0 N, wheelspin +4 475.7 N forward, leftward slide −3 822.4 N.

Result: **ALL CHECKS PASSED (0 failed)**.

### 3.2 The ported car — `VehicleValidation` and `VehicleSceneValidation`

Built and run in this sandbox from the landed sources:

| Program | Result | What it covers |
|---|---|---|
| `PortedVehicleValidation` | **35 passed, 0 failed** | drivetrain torque paths, LSD, clutch lockup, Newton vs relaxation-length slip, standstill stability of the slip angle |
| `PortedVehicleSceneValidation` | **38 passed, 0 failed** | drive/brake/steer over 3 s, upright on a 6 % heightfield slope, no sink-through, 4 wheels in contact, ride height 0.878 m |

### 3.3 Not verified here

- Jolt itself, and therefore `JoltPhysicsValidation`, `JoltVehicleBindingValidation`,
  `VehiclePhysicsComponentValidation`. `ExternalPackages/JoltPhysics` is absent and `cmake` is not installed. The CMake
  skips them and says so rather than pretending they ran.
- Anything Windows/MSVC, Vulkan, or rendered. This sandbox has no display and no GPU.
- The KPI the owner actually wants — *a drivable car in the world* — because that needs the full application tree.

---

## 4. Answering the owner's two questions directly

**"I think we could've used Jolt Physics Extension, don't you think? — if so you need to rename."**
Yes. The current WIP already renamed it: `FrontierJoltPhysicsExtension` (the Jolt world) with `FrontierVehiclePhysics`
layered on top. This branch keeps those names. The name is now honest at the CMake level; the next step makes it honest
at the call site, because `VehicleSolver` still constructs the rigid tyre inline rather than selecting a `TyreModel`.

**"Are you porting that [Project-Drive]? We shouldn't port the HTML version nor compare its physics to Jolt."**
Confirmed and followed. The C++ `SultanAladin/Frontier-` tree is the authority for the car (paths listed in `CLAUDE.md`
§1). JS is used for exactly one thing: the volumetric tyre, where the JS *is* the only implementation, and it was ported
equation by equation — not copied, not compared to Jolt numbers.

---

## 5. How this continues

Ordered, each step with the check that proves it.

| # | Step | Done when |
|---|---|---|
| **1** | **Wire `VehicleSolver` to the seam.** Replace the inline rigid wheel with a `std::vector<std::unique_ptr<TyreModel>>` built from `VehicleSolverConfiguration::Tyre.Model`. The rigid trace-fan path becomes `RigidTyreModel`, so behaviour is unchanged at `TyreModelKind::RigidTraceFan`. | `VehicleSceneValidation` still 38/38 with the rigid backend; same run with `XpbdSpringCarcass` drives and steers without exploding; a per-backend A/B of Fz, Fx, Fy over the same manoeuvre is printed. |
| **2** | **Substep budget and threading.** The XPBD carcass at shipping resolution (9×128) is the expensive one; use `ActiveWindowEnabled`, `TyreSubsteps`, and the existing accumulator pattern from `RigidBodySolver` (already ported) rather than running it on the render thread. | Measured ms/step per backend at 1, 2 and 4 tyres, with the substep settings named. |
| **3** | **Materials.** `VehicleContactMaterial` already separates physical friction from the PBR `performance-rubber` appearance. Bind the tyre backends to it and add the road/wet/kerb pairs, so a rubber–asphalt pair is data, not a constant. | A validation that changing the pair changes measured grip, and a scene where the HMI shows the same value the solver uses. |
| **4** | **The world.** `VehiclePhysicsComponent` already owns the Jolt world, a flat road and the chassis — that is the integration point. Drive it from the app's fixed step, spawn the ControlVehicle at the authored ride height, and add the chase camera the HMI expects. | A headless run of the full component for 10 s of scripted input, then the same in the Windows application. |
| **5** | **FEM material advection.** Close the rolling gap so the tread rolls through the patch (spin the material frame with `CarcassAngle()` inside the contact region), which is what makes the FEM tyre usable for wear and tread-pattern work. | Contact-patch particles advance at rolling speed; a marked node returns after one revolution. |
| **6** | **Calibration.** Put all three backends on one axis: Fz vs deflection up to rim bottoming, Fx/Fy vs slip at 3 loads, and the relaxation transient. That is the table that decides which backend ships on which corner. | One table, three columns, same inputs — and the disagreements explained, not averaged. |
| **7** | **Full-tree merge.** This branch is a module. Merging it into `SultanAladin/Frontier arena/649fea90-frontier` needs the whole application tree (229 MB), which is over this workspace's artifact budget, so it is a separate, explicit step against the real checkout. | `FrontierJoltPhysicsExtension` + `FrontierVehiclePhysics` + `FrontierTyreModels` in the application's root CMake, app builds on MSVC, car drives. |

---

## 6. Reproducing everything in this report

```bash
# tyre seam (three backends, no Jolt)
g++ -std=c++20 -O2 -o build/TyreModelValidation \
    Exhibits/VehiclePhysics/TyreModelValidation.cpp \
    Engine/PhysicalDynamics/Tyre/TyreModelFactory.cpp \
    Engine/PhysicalDynamics/Tyre/Jolt/RigidTyreModel.cpp \
    Engine/PhysicalDynamics/Tyre/Xpbd/XpbdSpringTyreModel.cpp \
    Engine/PhysicalDynamics/Tyre/Xpbd/XPBDSoftTyre.cpp \
    Engine/PhysicalDynamics/Tyre/Fem/FemTyreModel.cpp \
    Engine/PhysicalDynamics/Vehicle/PacejkaMagicFormula.cpp \
    -IEngine -IEngine/PhysicalDynamics -IEngine/PhysicalDynamics/Vehicle
./build/TyreModelValidation

# the ported car
g++ -std=c++20 -O2 -o build/VehicleValidation Exhibits/VehiclePhysics/VehicleValidation.cpp \
    Engine/PhysicalDynamics/Vehicle/{Aerodynamics,Drivetrain,PacejkaMagicFormula,TyreSlipDynamics,VehicleGeometry,VehicleSolver}.cpp \
    -IEngine -IEngine/PhysicalDynamics -IEngine/PhysicalDynamics/Vehicle
./build/VehicleValidation
```
