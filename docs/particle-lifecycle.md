# Rain contact and bounded particle lifetimes

## What changed

The previous solver already had age limits, but a rain parcel could spend much of that lifetime bouncing against the same surface. Total velocity contributed to water erosion, including normal collision response rather than useful transport. Expired slots could respawn immediately, with their remaining cargo retired without a final deposition opportunity. That combination encouraged local excavation and remove/redeposit oscillation.

The current WebGL2 pipeline separates **airborne rain → long-lived runoff → physical settling or numerical outflow → retirement → later respawn**. See the [runoff update](runoff-transport.md). It keeps the existing volume/material acceptance and cargo ledger; it does not switch erosion to the CPU.

## Controls

Open **Erosion → Rain → runoff & settling**:

| Setting | Default | Meaning |
|---|---|---|
| Falling-drop time limit | 8 s | 2–15 s, captured at birth |
| Airborne water loss | 20%/s | Separate from surface runoff |
| Runoff travel budget | 600 s | 10–1800 s, captured at first landing or direct runoff/river birth |
| Runoff evaporation | 0.1%/s | Fractional exponential water loss |
| Still-water delay | 8 s | 0.2–30 s of stationary surface contact |
| Shallow-pit routing head | 0.35 m | Bounded pressure-like routing, not a full fluid solve |
| Terminal settling | ≤1 s | Deposit-only, with unplaced cargo accounted on retirement |

All budgets use simulation time and existing 0.04 s clock units. Pausing freezes time. Changing a limit does not extend an already captured phase budget. A rain parcel deliberately captures a **new** runoff budget at its first landing; the short airborne limit is not reused for surface transport. Reducing the selected particle count suspends extra slots without discarding their inventory.

Moving runoff that reaches the numerical travel limit is retired to the explicit unresolved/outflow ledger, **not forced to deposit in place**. Stagnation and drying can still cause real local deposition.

**Continuous rain emits new drops.** To see a batch drain, set **Emission rate** to zero and leave the simulation running. Pause freezes the batch; it does not drain it. Existing dents are not filled automatically by this fix.

## Contact and erosion rules

- Liquid carriers (rain, runoff, river, chemical) use **inelastic contact**: normal velocity is removed, not reflected. The bounce control continues to affect solid projectiles.
- Penetration correction is capped per substep, preventing a single correction from launching a parcel far away.
- Water's mechanical erosion uses the lesser of tangential velocity and actual tangential displacement per time step. Normal bounce and constraint displacement are not substitutes for surface travel.
- Non-chemical water below 0.12 m/s surface travel cannot mechanically detach material, with the one-time first landing also limited by carrying capacity.
- A first rain impact can still dislodge a bounded amount. Subsequent resting collision impulses cannot repeat that impact term. Rain now spawns in clear air above the local surface across the entire terrain, falls under gravity, and switches to inelastic runoff at its first actual contact. Short velocity-aligned streaks visualize airborne parcels; this is not a resolved splash-fluid simulation.
- Hydraulic transport now solves capacity/settling relaxation before its bounds (see [hydraulic equations](erosion-model.md#detachment-settling-and-discrete-accounting)). Final competing requests resolve by **net exchange**: `net = detachment − deposition`; positive net removes material, negative net deposits it. A tiny settling request cannot veto all erosion from a moving, unsaturated carrier. Each carrier still exchanges in only one direction per step.
- A stalled or dry carrier freezes into settling. Moving runoff expiry takes the separate outflow path. It cannot erode or resume motion. It fades visually, then retires within the fixed settling budget. Boundary exits retire immediately.

## Water and sediment are different inventories

Evaporated water does **not** turn into terrain. Settling drops can deposit only their carried sand, fines and coarse fragments. Terminal settlement includes fine material and operates even when the artistic deposition slider is zero. It remains constrained by local empty occupancy and the exact scatter/acceptance/feedback loop.

During terminal settlement, composition proportions are shared by the event, scatter and cargo shaders. Accepted deposits subtract exactly their accepted volume from the carrier. At retirement, any unplaceable remainder and dissolved load move once into the existing retired/outflow ledger. Dissolved load is not silently precipitated into rock, and retired material is not claimed to have been physically deposited or to have reached a real river outlet.

A zero-cargo resting drop changes no solid occupancy. Settling carriers can only increase it. Once all carriers have retired and emission is zero, their erosion and retirement counters stop changing.

## Implementation

- `src/particle-lifecycle.js`: bounded settings, timestep and shared GPU policy/composition helpers.
- `src/gpu-erosion.js`: two small lifecycle textures and one additional particle-sized GPU pass. No new per-step particle/volume readback; WebGL2 still needs at most four MRT attachments. At the enlarged 16,384-slot capacity, the two lifecycle textures occupy 512 KiB. Active lifecycle W stores the lowest visited elevation; during settling it stores elapsed settle ticks.
- `src/erosion-shaders.js`: inelastic liquid contact, tangent-travel shear, bounded clock transitions, deposit-only terminal state, consistent sediment composition and fading markers.
- `src/main.js`, `src/studio-ui.js`, `index.html`: simulation-time controls, correct percentage value editing and audit output.
- Exports retain volume format version 2, add `particleLifecycleModel: "rain-runoff-captured-v2"`, and record the applied controls. Particle state is still omitted; an export is not a resumable simulation checkpoint.

## Historical verification (before the separate runoff phase)

The lifecycle and earlier net-exchange corrections were validated separately. Current hydraulic validation adds closure unit tests, production GLSL/reference agreement, an overlapping-carrier erosion/deposition ceiling regression, and physical-unit UI/export checks. **Hydraulic-stage validation (before the later Satmaps/shared-route change): 61 unit tests, 17 targeted browser/GPU tests and the production build passed.** Targeted browser coverage includes:

- Ten lifecycle/exchange regressions: GPU/reference equation agreement, aggregate overlap limits, moving loaded rain continues eroding, saturated moving rain still deposits, sustained default-mountain erosion stays within a two-sided regression envelope, plus the five lifecycle checks: stationary rain with restitution set to one cannot erode; deposit-only terminal material is conserved; captured tick budgets cannot be extended and drying terminates earlier; UI seconds/percentage edits use correct units; a staggered rain batch drains fully after emission stops.
- Four existing weather tests cover river travel and material transport, wind abrasion, rockfall/chemical behavior and suspended-slot inventory.
- Three existing GPU erosion tests cover genuine volume exchange without per-step CPU transfer, zero births, and missing float-target handling.
- The default mountain is tested over 128 complete production steps at unchanged settings. The earlier scene-switching checks were not rerun for the net-exchange correction.

Tests use real WebGL2 passes under SwiftShader. These are functional and accounting checks, not native GPU FPS benchmarks or a claim of calibrated hydrology. The solver remains an artist-controlled volumetric erosion model without pressure-projected water, droplet coalescence or a geological timescale.

### Erosion-rate regression and correction

The first lifecycle patch used `if (deposit > 1e-10) detach = 0`. Once a moving carrier acquired sediment, even tiny Stokes settling therefore suppressed its entire erosion demand. A focused moving-carrier test reproduced zero detachment before the fix and passes with net exchange. The lifespan, evaporation, stationary-speed threshold, bounce suppression, terminal-settling budget, hardness and strength defaults were not relaxed.

Controlled comparison: default noise mountain, seed 4821, 1,024-particle pool, emission 0.55, strength 0.45, hardness 0.6, 128 steps (5.12 simulation seconds), river transport off. Real WebGL2 passes under SwiftShader:

| Occupancy-volume measure                    | Deposition veto | Former net brush | Capacity relaxation, 50× preview |
| ------------------------------------------- | --------------: | ---------------: | -------------------------------: |
| Cumulative detached                         |        10.98 m³ |        138.52 m³ |                         16.76 m³ |
| Cumulative deposited                        |         7.32 m³ |         96.02 m³ |                          7.15 m³ |
| Positive local occupancy loss above Y = 1 m |         4.08 m³ |         87.56 m³ |                         14.36 m³ |

All three material-ledger residuals stayed below 0.000001 m³ and world-balance residuals below 0.0001 m³ in this comparison. These are voxel-accounting measurements, not calibrated geological rates or native-GPU performance results. The current river fixture checks entrainment and downstream transport at high speed, then lowers the guided flow and checks deposition and deposited inventory. It does not force newly loaded, deep, fast water to deposit immediately. The saturated-rain fixture uses a 128-slot, 1× representative parcel whose load is demonstrably above its maximum concentration capacity. The default mountain regression rejects both absent slope exchange and a return to excessive cubic-brush erosion; its numerical envelope is an implementation guard, not a physical calibration target.

### Visible falling rain

Births are staggered using `1 - exp(-4 * emission * dt)` per empty rain slot. No rain is emitted when emission is zero. Spawn altitude is jittered below the active volume ceiling and checked for air clearance; the surface ray projection remains only for the other surface-source agents. A negative rain metadata restitution slot encodes “not yet landed”; rain never uses elastic restitution. The first collision consumes that latch and emits contact flag 2 for that tick. Later contacts emit flag 1 and cannot repeat splash detachment. Birth flag and cargo reset remain separate from landing. Lifetimes count from birth, including the flight.

Airborne streaks use actual GPU position and velocity, not an unrelated rain overlay. Visibility changes do not alter the solver, and pause freezes the rain along with erosion. See `tests/browser/falling-rain.spec.js` for flight, one-time landing, dry-air invariance, conservation and rendered-pixel checks.

### Physical rain-pool handoff

The additional rain slots now capture the same runoff phase and carry actual sediment after landing. GPU allocation preserves exact positions for free-slot handoff; local coalescence moves water and the complete species/ledger state. A donor clears only after a winning transfer. If no safe recipient exists, it keeps flowing in its original slot. See [physical rain and limits](continuous-rain.md).
