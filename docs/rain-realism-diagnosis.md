# Rain erosion: research, diagnosis and measured corrections

## Status

The **live WebGL2 rain solver has been changed**, not just the markers. It now budgets rainwater in m³ from mm/hour, uses a slope/shear and sediment-capacity constraint, distinguishes available loose sediment from resistant substrate, and preserves small material changes with compensated occupancy accounting.

**This is not a calibrated landscape-evolution or hydrodynamic solver.** This report describes the **Weather / rainfall study** correction. The subsequent [Hydraulic shaping workflow](hydraulic-shaping.md) connects fine XYZ exchange, rendering, picking and export for terrain authoring. The two workflows have deliberately different purposes.

## 1. Research used

- **WEPP hillslope erosion:** detachment requires shear stress above the material threshold and sediment load below transport capacity; deposition occurs when the flow cannot transport the load. This supports separating detachment potential from transport capacity, not continually excavating every contact. The model also treats interrill/rill processes separately. [3](https://milford.nserl.purdue.edu/weppdocs/sdau-workshop/docs/chap11.pdf) [2](https://www.tucson.ars.ag.gov/unit/publications/pdffiles/1049.pdf)
- **Splash detachment:** rainfall intensity/kinetic energy matter, and surface-water depth changes splash effectiveness. Soil-specific experimental fits are not transferable measured rock properties. The new splash term is limited to available loose material and remaining transport capacity, with an explicit water-depth attenuation assumption. [2](https://www.sciencedirect.com/science/article/abs/pii/S0341816219300098) [3](https://www.sciencedirect.com/science/article/abs/pii/S0341816222008499)
- **Drop size and falling speed:** the empirical Atlas-type relation `v(D) = 9.65 − 10.3 exp(−0.6D)` uses diameter D in mm and velocity in m/s. It now constrains actual airborne motion rather than only marker appearance. The implementation caps the asymptote at 9.2 m/s and uses bounded integration; it is not an atmospheric drag/air-density solver. [3](https://amt.copernicus.org/articles/16/707/2023/) [1](https://doi.org/10.3390/rs17060983)

These sources justify the process constraints. They do **not** calibrate this procedural terrain, establish a universal bedrock erodibility, or validate the resulting landforms. The full WEPP model was not implemented. The USDA-hosted Chapter 11 fetch failed; the search-accessible WEPP equations and supporting USDA overview were available. The AMT article was also fetched.

## 2. Diagnosis of the disappearing terrain

### Unbudgeted water and multiple amplifiers

The old rain closure inferred water volume from `representative area × film depth × water weight × hydraulic preview × weathering dose`. Representative area grew with terrain size and increased when fewer carriers were selected. The separate rain pool did not follow that normalization.

For the approximately 1 km² scene, 256 carriers, 20 mm film, 10× preview and 64× dose, the inferred water volume was approximately **49,000 m³ per unit-weight parcel**. That is an algebraic diagnosis of the former formula, not a measurement of a physical rainstorm. Rainfall intensity was not a volumetric supply constraint. Coalescence could further increase a parcel's water weight.

### Wrong physical interpretation of contacts

The velocity-based shear proxy could interpret numerically driven tangential movement as an unlimited supply of erosive flow. The generated solid also used a soil-like resistance approximation rather than distinguishing a loose surface inventory from harder underlying substrate. A finite per-pass voxel cap limited numerical damage, not the physical amount of rain or total long-run removal.

### Coarse resolution and lost small changes

The default cells remain approximately **8.06 × 4.06 × 8.06 m**. The compact numerical kernel spans at least 15.32 m horizontally. That is unrelated to the nominal 3 mm incoming diameter. Large representative demands therefore produced broad removals.

Conversely, realistic small demands can be below one float32 occupancy increment in a large voxel. Simply reducing the demand could create carried sediment while rounding the terrain change away. This required an accounting correction, not only a smaller multiplier.

## 3. Live implementation changes

### Water supply and accounting

`ΔV_requested = rainRate_mm_h × 0.001 / 3600 × emitterArea_m² × Δt_s × emitterIntensity`

- Default full-emitter rate is **20 mm/hour**. The existing emitter-intensity control scales it; 55% therefore requests 11 mm/hour.
- GPU reductions count successful births, and the current step's water budget is divided between them. Rain particle velocity `.w` now stores **actual m³**, not a unitless surrogate water fraction.
- A frame with no successful births admits no new water. Missing rain is not saved and dumped into a later frame. Diagnostics report requested, admitted, unrepresented, stored, evaporated and unresolved/outflow volumes.
- Rain coalesces only with other volume-based rain/runoff parcels. It cannot merge its m³ with the legacy independently authored Runoff/River emitter's differently normalized water weights.
- Rain rate is independent of carrier count, weathering dose and the legacy hydraulic-preview multiplier. Changing carrier count affects sampling coverage/capacity, not water per storm by construction.
- The airborne loss default is now 0.2%/s and applied fractionally, rather than subtracting a fixed amount from every parcel. Existing runoff-loss controls remain fractional and heuristic.

### Detachment, transport and substrate

For rain-origin flow, the implemented driving-stress bound is:

`τ = min(0.5 ρ Cd u², ρ g h sinθ)`

This uses a smoothed SDF drainage direction, an assumed film depth and local velocity. It is a bounded shallow-flow approximation, not a solved hydraulic head field. A level, undriven surface cannot continuously excavate itself just because particles jitter or drift across it.

- A grain-mobility threshold and physical water volume set transport capacity.
- At default sediment capacity 0.6, the maximum volumetric concentration is **0.006 m³ sediment per m³ water**. This is an explicit model ceiling, not a measured universal concentration.
- A separate substrate threshold and erodibility factor govern bedrock-like removal. Defaults of **100 Pa** and **0.001× loose-material erodibility**, with hardness adjustment, are exposed assumptions—not a measured rock classification.
- Loose sediment is consumed first. An additional aggregate substrate-request channel prevents many overlapping soil requests from silently continuing into resistant material after the loose inventory is exhausted.
- Splash can mobilize available loose material, subject to water-depth attenuation and remaining capacity. It does not create bare-rock impact craters from an unlimited representative water volume.
- Loaded water can continue moving without continually cutting: once it is saturated, further detachment is physically constrained. At a flat foot, reduced transport capacity allows deposition.

### Acceleration and precision

- **Fast = 4× transport / 1× erodibility; Rapid = 8× / 1×.** The separate slider is labelled **Artistic erodibility multiplier**. Values above 1× are explicitly not a physically timed storm.
- Artistic rain erodibility does not multiply water volume, sediment concentration or the rain numerical surface-change ceiling. The latter remains an SI-rate bound with a voxel safety limit.
- A ping-pong acceptance texture retains the sub-ULP occupancy remainder. Accepted material changes accumulate instead of being rounded away. Distance reconstruction includes the remainder; the audit sums it in double precision.
- The five new water-budget passes are particle/reduction-sized. The existing terrain passes use extra outputs/state, but no additional full-volume pass or per-step CPU volume/particle transfer is added. Added persistent storage is approximately **25.4 MiB** on the float32 path. This is not a free-performance claim.
- Checkpoints use `rain-volume-v5-64x288` and include the water ledger and occupancy remainder. Old unitless-rain checkpoints are rejected. Terrain exports are still not resumable simulation checkpoints.

## 4. Reproducible GPU results

Real WebGL2 tests under Chromium/SwiftShader; these are functional/conservation checks, **not native GPU FPS benchmarks**.

| Test | Measured result |
|---|---|
| Rain budget, 256 vs 4,096 carriers, 2.56 s, 20 mm/h over 980 × 980 m | Both admitted **13.659021 m³**; water-balance errors below **0.000001 m³** |
| Flat ground, 128 updates / 40.96 s, 256 carriers, wind, 64× artistic dose, 200× legacy preview | **0 m³ eroded; no occupancy change** |
| Same flat-ground test, capacity limitation | Requested **218.544356 m³**, admitted **68.295120 m³**, unrepresented **150.249235 m³**. The finite pool saturated; this was not a fully represented continuous storm. Water-balance error **0.00000805 m³** |
| Real procedural mountain, 96 updates / 30.72 s, 256 carriers, same stress multipliers | **0.364435 m³ detached**, **0.030804 m³ deposited**, **0.313224 m³ carried**, **0.020408 m³ retired/unresolved sediment** |
| Mountain, geometry/accounting | Maximum **occupancy-equivalent** change **0.105916 mm**; material-ledger error **1.85×10⁻⁹ m³**; solid-balance error magnitude **8.94×10⁻⁸ m³** |
| Mountain, water | **163.908264 m³ admitted**; water-balance error magnitude **0.00000466 m³**; checkpoint restore exact |
| Drop diameter: 0.5 vs 5 mm | Actual mean falling speeds **1.972 vs 7.215 m/s** in the sampled flight interval |
| Aggregate substrate guard | 10 m³ loose-material demand with only 0.2 m³ loose stock accepted **0.2 m³**; adding a 0.05 m³ substrate allowance accepted **0.25 m³**, not 10 m³ |
| Weak-substrate runoff reaching a flat foot | **0.004289 m³** deposited at the foot versus **0.0000328 m³** uphill; water and sediment budgets remain closed |

Further checks compare the production rain GLSL directly against the double-precision closure for dry, loose, resistant and saturated cases; verify actual terrain changes against a zero-erodibility control; and retain the falling/landing, random births, conservative handoff, downstream travel and checkpoint tests.

**92 unit tests and 22 distinct targeted browser/GPU checks passed** across the rain physics, continuous rain, falling rain, runoff transport, checkpoint and preset-UI checks. Some older fixtures encoded the rejected unlimited-incision model; they were updated to specify weak substrate and check finite-water capacity rather than demand new erosion forever from a loaded parcel. The entire historical browser suite was not rerun. The production build and standalone preview smoke check also passed: eight Rapid updates used 1× erodibility, admitted 7.512462 m³ at the default 11 mm/hour effective rate, retained 1,371 primary runoff parcels plus 1,144 airborne drops, and reported no browser/solver errors. The visible water/sediment audit was separately browser-tested.

Commands:

```sh
npm test
CHROMIUM_PATH=/tmp/chromium SOFTWARE_GPU=1 \
  LD_LIBRARY_PATH=/tmp/al2023/lib:/tmp npm run test:browser -- \
  tests/browser/rain-physics.spec.js tests/browser/continuous-rain.spec.js \
  tests/browser/falling-rain.spec.js tests/browser/runoff-transport.spec.js \
  tests/browser/world.spec.js
npm run build
```

The 40.96 s and 30.72 s runs are **not** a replay of the screenshots' 800–1,200 simulated seconds. An additional analytic bound follows from the concentration ceiling: for rain-only, initially unloaded water with no imported sediment, net solid loss cannot exceed 0.006 times cumulative admitted water at default capacity. At 20 mm/h for 800 s, this corresponds to at most **0.0267 mm area-mean loss** if all requested rain is admitted. This is a model bound, not an empirical prediction and not a bound on an individual concentrated channel's depth.

## 5. Remaining limitations

- The broad coarse kernel remains part of the Weather / rainfall study described here. Use the subsequent Hydraulic shaping workflow for fine-grid authoring. Neither workflow resolves individual millimetre grains.
- No pressure/free-surface solve, resolved interrill/rill hydraulics, infiltration, vegetation shielding, calibrated weathered-soil thickness, or gravitational collapse/fracture of undermined rock is implemented. Ordinary soil can splash even on a level surface; the current model omits unresolved local splash redistribution there rather than exporting the whole floor away.
- Film depth, material resistance, evaporation and numerical retirement policies are assumptions/controls. A user-selected artistic dose, weak substrate or extreme rainfall is not a validated geological scenario.
- The solid ledger measures voxel occupancy, not exact volume of the interpolated zero-isosurface. The reported sub-millimetre changes are accounting-derived; metre-spaced cells cannot display that as genuine sub-millimetre detail.
- Sparse storage is bounded. Exhaustion must not silently erase existing cuts or switch back to a large brush. That integration is still required.
- Existing fragmented terrain is not healed automatically. Regenerate/reset to test the corrected storm from intact terrain.
