# Recovery map — where the lost tyre work actually is

Written 2026-10-23. Every claim here was produced by cloning the four candidate repositories and reading refs and trees,
not by trusting an earlier summary. Reproduce with:

```bash
git clone --bare --filter=blob:none https://github.com/<owner>/<repo>.git
git -C <repo>.git for-each-ref --format='%(refname:short)'
git -C <repo>.git log --all --format='%h %cd %s' --date=iso -- '<path>'
```

---

## 0. Verdict

The "lost" work was **not lost by a sandbox**. It was **deleted deliberately** by commit `9ceb33c` on 2026-10-13
23:59 UTC, titled *"Remove XPBD from the vehicle stack: rigid wheel on trace-fan contact"*. The file still exists in the
history of the same remote, two commits earlier.

| Item | Answer |
|---|---|
| Newest commit containing the XPBD tyre | `ff77585f17e5d4d672f49e9ebeaa3b7dacd69a17` — 2026-10-13 **22:04** |
| Commit that removed it | `9ceb33cefa243bfb52923e5cf0712d69e9ce3be8` — 2026-10-13 **23:59** |
| Size of the last `XPBDSoftTyre.cpp` | **56 016 bytes** (blob `ee2cfa3c…`) |
| Next-best surviving copy | 47 939 bytes (blob `3ac28237…`), still shipped on 7 branch tips — an **older** revision, missing the last two days of fixes |
| Where the current port looked | `arena/215a6f39-frontier` @ `f2cfc57` (2026-10-14) — a descendant of `ff77585`, so it *contains* the commit and *not* the file |

That last row is the whole failure mode: the port was taken from a branch tip that is a descendant of the recovery
commit, so a file-level diff against the tip shows nothing to copy. The file has to be read from the commit, not the tip.

---

## 1. Repositories and branches examined

Four remotes, 100% of heads (`refs/heads`), trees read with `git ls-tree -r`, not a shallow listing.

| Repo | Heads | Tyre / vehicle content found |
|---|---|---|
| `SultanAladin/Frontier` | 33 | No C++ vehicle stack on any head. `Experimental/SlateReference/**` JS vehicle prototypes only. `fcecd7f` is a *tracker note* that records a fork merge — it does not merge the code. |
| `c7egoist/Frontier` | 40 | `arena/ec6ca01d-frontier` — Phase 7 Jolt port (current WIP). `arena/3488daf0-frontier` — WebGPU volumetric tyre demo (the FEM reference). `arena/f3437631-frontier` — the older XPBD tyre copy. |
| `unassignedinbox/Frontier` | 6 | `Experimental/VehicleHmiPrototype/**` (JS/WGSL HMI + RESTIR). No C++ tyre physics. |
| `SultanAladin/Frontier-` | 63 | **The Project-Drive tree.** Full C++ vehicle dynamics, all revisions of the XPBD carcass, the deletion, and the volumetric research reports. |

`SultanAladin/Slate` and `unassignedinbox/Slate` were also checked: both are Slate (renderer/HMI) and carry no tyre
solver.

---

## 2. XPBD carcass — revision history on `SultanAladin/Frontier-`

`Engine/PhysicalDynamics/Vehicle/XPBDSoftTyre.cpp`, newest first:

| Commit | Date (UTC) | Bytes | Blob | Note |
|---|---|---|---|---|
| `9ceb33c` | 2026-10-13 23:59 | — | — | **deleted** (`888` lines of `.cpp`, `524` of `.h`, plus validation and solver) |
| `ff77585` | 2026-10-13 22:04 | **56 016** | `ee2cfa3c` | **← the recovery point.** Active window about the ground direction, 16 substeps × 1 sweep |
| `f99635a` | 2026-10-13 20:48 | 51 904 | `44018c2b` | hoist per-substep work; sample ground once per substep |
| `7fa53e5` | 2026-10-12 21:24 | 48 158 | `9670a86f` | per-wheel thermal coupling |
| `f38620d` | 2026-10-12 13:21 | 47 939 | `3ac28237` | *(this blob is the copy still present on 7 branch tips)* |
| `9bd9fbf` | 2026-10-12 11:23 | 47 973 | `f1400d5c` | conservative rim mass partition |
| `1859f6a` | 2026-10-12 11:16 | 46 890 | `29083f2f` | flight recorder, endpoint energy diagnostics |
| `a6ff435` | 2026-10-12 11:08 | 41 476 | `79dc90a1` | preserve approved pre-3e45285 source |
| `bae4a6b` | 2026-10-10 22:04 | 41 316 | `b4d9970b` | stability exhibit: curb strike, spin, energy audit |

Branches that still **ship** a working copy at their tip (all the `f38620d` revision):

`arena/9563020c`, `arena/5c85f535`, `arena/24db141b`, `arena/ca455774`, `arena/f4cc60b8`, `arena/10e50e56`,
`arena/561c913e` (all on `SultanAladin/Frontier-`), and `arena/f3437631` on `c7egoist/Frontier`.

⚠️ Copying from any of those gives you the 12 October revision and silently drops the 13 October work — the active
window (~4× on the edge/spoke sweeps, Fz unchanged to <1 %), the ground-sampling hoist, and the 16×1 substep
configuration whose measured numbers are in the header. Use `ff77585`.

Recovery command:

```bash
B=https://github.com/SultanAladin/Frontier-.git
P=Engine/PhysicalDynamics
git archive --remote=$B ff77585 $P/Vehicle/XPBDSoftTyre.h $P/Vehicle/XPBDSoftTyre.cpp \
                                 $P/Vehicle/XPBDTyreValidation.cpp \
                                 $P/XPBDTyreSolver.h $P/XPBDTyreSolver.cpp | tar -x
```

(If the server refuses `archive --remote`, `git clone --filter=blob:none` and `git show ff77585:<path>` produces the
identical bytes; that is what this branch used.)

---

## 3. What the recovered files are

| File | Role |
|---|---|
| `Vehicle/XPBDSoftTyre.{h,cpp}` | The production carcass: 9 rings × 128 segments, spoke / hoop / lateral / shear / tread-bristle constraints, a real closed-surface gas law, rim bottoming, Rayleigh damping authored as ratios, kinematic hub with linear and spin motion. ~1 100 lines with the measurements that justify each constant. |
| `Vehicle/XPBDTyreValidation.cpp` | Its calibration and regression program (static settle, kerb, ramp landing, energy). |
| `XPBDTyreSolver.{h,cpp}` | The Phase-0 single-ring skeleton the above evolved from. Kept as a reference implementation, not on the production path. |

The header carries the design rationale that makes the model *configurable* rather than fixed — this is the
"configurable XPBD tyre spring model" from the owner instruction:

`Radius, RimRadius, Width, RingCount, SegmentCount, TotalMass` · `SolverIterations, ActiveWindow*`
`SpokeCompliance, SpokeTangentialCompliance, SpokeLateralCompliance, HoopCompliance, LateralCompliance, ShearCompliance, ContactCompliance, TreadTangentialCompliance`
`InflationPressure, AtmosphericPressure, GasCompressible` · per-family damping **ratios** (ζ), not β
`SidewallTensionOnly, RimBottoming, RimBottomingClearance, RimBottomingCompliance, RimBottomingDampingRatio`

---

## 4. 3D FEM — where the reference lives, and why there was no C++

There is **no C++ tetrahedral tyre anywhere** in the four remotes. The only implementation is the WebGPU demo:

| Path | Repo / ref | What it is |
|---|---|---|
| `Experimental/TyreVolumetricDemo/src/tyreCore.js` | `c7egoist/Frontier` `arena/3488daf0-frontier` | 426 lines: mesh generation, `tetElementForces` (first Piola–Kirchhoff), Lamé parameters, road presets, CPU reference integrator |
| `Experimental/TyreVolumetricDemo/src/{gpuTyre.js,shaders.js}` | same | the WGSL compute passes that solve the same equations |
| `Experimental/TyreVolumetricDemo/README.md`, `tests/tyre.test.mjs` | same | limits and the tests the reference runs |
| `Docs/VolumetricTyreAssessment.md` | `SultanAladin/Frontier-` `arena/c6fa8143-frontier` | assessment: 4.85 ms/tick, inverted elements, "do not use as authoritative handling physics yet" |
| `Docs/TyreGpuHardening.md`, `Docs/TyreGpuSolverResearch.md` | same | what was hardened afterwards, and the solver research |
| `Docs/XPBDTyrePhysicsReport.md` | `SultanAladin/Frontier-` `arena/ee1dfef2-frontier` | the XPBD audit: what the published method requires, and that the code was already missing at that point |

The FEM backend on this branch is therefore a **port**, not a restore: `Engine/PhysicalDynamics/Tyre/Fem/FemTyreModel.cpp`
reproduces `tetElementForces` term for term and keeps the reference's element ordering so the two can be diffed.

---

## 5. The "Jolt Physics Extension" naming question

The owner's suggestion — that this should have been a Jolt Physics *extension* — is right, and the current WIP already
did it. `c7egoist/Frontier arena/ec6ca01d-frontier:CMakeLists.txt` defines:

```
add_library(FrontierJoltPhysicsExtension STATIC
    Frontier/Engine/PhysicalDynamics/RigidBodySolver.cpp)
target_link_libraries(FrontierJoltPhysicsExtension PUBLIC Jolt)
add_library(FrontierVehiclePhysics STATIC ...)
target_link_libraries(FrontierVehiclePhysics PUBLIC FrontierJoltPhysicsExtension)
```

So the rename is **done**, and this branch keeps it. What is *not* done is the layering the name promises: `VehicleSolver`
still holds the rigid tyre inline instead of selecting a `TyreModel`. That is the next step in `PortReport.md`.

Older names that must not be reintroduced: the pre-rename tree spelled the same module `PhysicalDynamics` at the repo
root (`SultanAladin/Frontier-` before `e5a33a8`), which is why path-based recovery searches miss it.

---

## 6. Checksum of the recovery, for the next agent

| File landed on this branch | Byte size | Source |
|---|---|---|
| `Engine/PhysicalDynamics/Tyre/Xpbd/XPBDSoftTyre.cpp` | 56 016 | `SultanAladin/Frontier-` `ff77585:Engine/PhysicalDynamics/Vehicle/XPBDSoftTyre.cpp` |
| `Engine/PhysicalDynamics/Tyre/Xpbd/XPBDSoftTyre.h` | 35 757 | same commit, `.h` |
| `Engine/PhysicalDynamics/Tyre/Xpbd/XPBDTyreValidation.cpp` | 13 525 | same commit |
| `Engine/PhysicalDynamics/Tyre/Xpbd/XPBDTyreSolver.{h,cpp}` | 7 378 / 11 415 | same commit, `Engine/PhysicalDynamics/XPBDTyreSolver.*` |
| `Experimental/TyreLattice/index.html` | 41 051 | same commit, the WebGPU lattice study shipped alongside |

Two mechanical edits were applied, both recorded in the files: the namespace moved to `Frontier::Vehicle::Xpbd` (so it
can coexist with the vehicle stack's own `TyreReaction` / `HubMotion` / `Vec3`), and its private vector maths was
replaced by `Vehicle/VehicleMath.h`, which is API-identical. **No physics line was changed.**
