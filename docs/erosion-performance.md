# Erosion performance and preview acceleration

The kilometre grid made two different limits apparent: moving a metre per second is visually slow across a kilometre, and a 5 mm/s material-change ceiling is subtle on metre-scale voxels. More particle samples primarily improve spatial coverage; they also increase scatter/gather and collision work. They are not a direct erosion multiplier because representative catchment is normalized by sample count.

## Controls

| Preset | Requested transport time-lapse | Artistic weathering dose | GPU batch size |
|---|---:|---:|---:|
| Reference | 1× | 1× | 1 |
| Fast, default kilometre preview | 4× | 1× | 1 |
| Rapid | 8× | 1× | 1 |

These controls never silently increase the particle pool. The existing GPU particle-samples slider remains available for denser coverage, up to 16,384 slots (4,096 selected by default in the studio). New small land plots return to Reference settings. Switching presets does not clear terrain, material inventories, particle metadata or captured lifetimes.

### Transport

A terrain exchange pass advances `dt = min(0.04 × requested, max(0.04, smallestCell / 12))` seconds. Velocities remain in m/s. Gravity, collision and drag integrate in ≤10 ms substeps, with a hard maximum of 32. Thus a coarse-world pass covers more simulated time without repeating the expensive full-terrain passes. Fine plots automatically restrict the effective multiplier.

Particle clocks retain their existing 0.04-second units, independently of GPU pass duration. Active motion is clipped to the remaining captured phase budget (airborne at birth, runoff at first landing), so changing speed or the lifetime slider cannot extend that budget. Evaporation advances with particle time; terminal settling remains bounded and deposit-only. Rain records its actual first landing once, never an impact at birth or an impact per substep. Pausing stops simulation time.

Exchange samples the end of each macro interval against a frozen SDF; it is **not mathematically identical to performing all the smaller terrain updates**, especially near changing geometry. The grid-based travel limit and small collision steps constrain this approximation. The inspector reports effective speed, simulated seconds and the per-pass surface-change ceiling.

### Weathering dose

For rain, this now multiplies **erodibility only**, not representative water volume or sediment concentration. Rain supply is a separate mm/hour budget. Its numerical change ceiling is independent of artistic dose and additionally bounded to 1% of the smallest cell. The default Fast/Rapid presets leave erodibility at 1×. Other emitter closures remain heuristic; see [rain realism diagnosis](rain-realism-diagnosis.md).

## Less GPU work and bounded resources

- Compute voxel-centre bounds of the exact existing kernel, and visit only those indices in both normalization and acceptance feedback. Default kilometre support generally needs 8–36 candidates rather than a fixed 729; large support still has a bounded neighborhood.
- Airborne rain exits material exchange before doing surface-normal or gather reads. Its lifecycle also avoids unnecessary surface queries until landing.
- No added atlas or particle textures; no additional full-volume passes. The particle integrator does additional work, bounded to 32 microsteps.
- Submitted batches are fenced at most every four passes instead of queuing arbitrarily long work. The normal presets request just one pass per update.
- A per-parcel request ceiling prevents overflow when the device requires float16 scatter accumulation. Float16 still has lower numerical accuracy than float32.
- No CPU erosion and no per-step particle/volume readbacks. Diagnostics/export tests explicitly read back; the running solver does not.

## Historical pre-correction validation

Unit tests cover timestep/substep limits on fine, coarse and anisotropic grids, reference-rate equivalence, amplified aggregate caps, and exact support coverage.

GPU tests compare accelerated airborne motion against small reference steps, first impact, changed-speed captured lifetimes, deposit-only retirement and ledger balance. A controlled sloped-surface test measured 0.01379 m³ detached in Reference and 0.67913 m³ in Fast for the same particle count and one terrain update, with a maximum occupancy-derived displacement of 12.8 mm. This is a fixture result, not a universal speed factor or FPS claim. A whole-mountain comparison verifies greater slope erosion within the same pass budget.

Tight gathers match the previous full-cube GPU result. Warmed SwiftShader runs varied: approximately 296 versus 323 ms per reference pass in one run, and 376 versus 372 ms in another. This does not establish a reliable per-pass FPS improvement; hardware and workload results will differ. Acceleration's main benefit is more preview progress per terrain update, not a claim of 4× or 16× rendering FPS.

Latest validation: **77 unit tests and 18 targeted browser/GPU tests passed**, plus the production build. The whole historical browser suite was not rerun. Historical lifecycle fixtures were updated for real staggered rain births, the actual domain ceiling and current SI defaults; the former fixed-volume mountain threshold was replaced by a paired whole-mountain Fast/Reference test.

The later [runoff update](runoff-transport.md) separates airborne and surface-water lifetimes and revises suspension/impact behavior. The numerical fixture values above describe the earlier performance update, not a current physical calibration.

The subsequent [continuous-rain change](continuous-rain.md) adds a fixed precipitation pool and a bounded rainwater cache. The main terrain grid and pass count remain unchanged; additional particle work and a scalar MRT output are not free GPU work.

Current rain-model validation is in [rain realism proofs](rain-realism-diagnosis.md). Earlier Fast/Reference erosion figures above describe the rejected water-amplifying implementation, not the current presets.
