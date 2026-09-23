# Downhill runoff, suspension and the larger particle pool

The earlier preview accelerated incision but still treated landed water like a short-lived falling drop. Its 20%/s evaporation, eight-second clock and sub-second stillness timer could strand sediment close to the first cut. Gravity-only surface carriers could also stall in tiny pits created by their own erosion, and the settling closure did not account for turbulent suspension.

## Updated transport

- **Two captured budgets:** falling rain keeps its 2–15 s airborne limit (8 s default). Its first actual landing starts a separate runoff budget: **600 s default**, adjustable 10–1800 s. Runoff/river emitters also capture this travel budget. Editing the setting does not extend an already captured budget.
- **Runoff evaporation:** defaults to a fractional **0.1%/s** exponential loss, separate from the airborne drop-loss control. It no longer loses its initial water in five seconds after landing.
- **Still-water delay:** defaults to **8 s** before terminal settling. Actual movement, not collision jitter, determines whether a carrier is stationary.
- **Shallow-pit routing:** a filtered XYZ SDF normal supplies a downhill/free-surface gradient and a pressure-like correction near the bed. Routing uses an assumed roughness and shallow depth, and can climb at most the specified head above the lowest elevation visited by that carrier (**0.35 m default**). This crosses small numerical erosion pits, but cannot pump water out of a deep basin. Samples are clamped to the domain to avoid inventing slopes at the volume boundary.
- **Suspended fines:** the net fall speed is `ws / (1 + (0.4 * sqrt(tau/1000) / ws)^2)`. This is a chosen Rouse-inspired interpolation, not an exact Rouse-profile solution. It suppresses settling in fast sheared water and recovers full grain settling in still water. CPU reference and GPU equations agree.
- **No impact craters without transport:** the first rain impact remains a one-time event, but resolved splash removal is limited by available carrying capacity. A vertical drop on still, flat terrain does not repeatedly carve a crater.
- **No timer-shaped sediment pockets:** moving wet runoff reaching its numerical travel limit moves its remaining cargo into the explicit unresolved/outflow ledger, rather than painting a deposit at an arbitrary timeout. Real stagnation/drying still allows deposit-only settling. This is not a claim that retired material physically reached a river outlet.

This remains an artist-controlled **XYZ SDF particle approximation**, not a pressure-projected fluid solver, watershed model or heightmap. It does not force every particle to an outlet. Genuine basins, slopes, water availability, capacity and finite budgets still matter. Existing carved holes are not automatically healed; regenerate for a clean comparison with an older result.

## Actual particle capacity

- Carrier capacity: **16,384**, up from 2,048. The later [continuous-rain update](continuous-rain.md) appends 2,048 dedicated precipitation slots; combined particle textures are **64 × 288**.
- Studio default: **4,096** selected samples, up from 1,024. The backend's low-level default remains 1,024 for integrations.
- All selected samples run motion, lifecycle, exchange and sediment feedback. No per-step CPU volume or particle readback is added.
- Drawing uses a deterministic stride above 4,096 samples; at most **4,096 primary markers plus 2,048 rain/runoff markers** are drawn. This limits display work, not the simulation count.
- Combined particle-state/scratch storage is approximately **4.42 MiB** with dedicated precipitation. Two scalar rainwater atlases add 5 MiB. The primary terrain grid does not grow.
- More selected particles still cost more GPU computation. 4,096 is the recommended starting point; 8,192–16,384 are optional, not advertised as free.
- Reducing the count retains suspended-slot cargo, rather than discarding it. Old particle checkpoints are rejected explicitly because both dimensions and active lifecycle metadata changed. Terrain exports still omit live particles.

## Checks

Real WebGL2 tests cover:

1. A landed carrier travels over 600 m to a flat slope foot, remains wet after roughly 209 simulation seconds, and does not have its captured budget extended by a slider change.
2. A shallow erosion pocket is crossed, while a deeper closed basin still traps the carrier.
3. Moving numerical expiry creates no local deposit and preserves its cargo in the outflow ledger.
4. All **16,384** particle slots populate, including all 14,336 slots above the old limit, without per-step transfers.
5. Coupled erosion continues along a trail beyond the old expiry and keeps material in transport.
6. Coupled erosion reaches a flat foot and deposits there rather than in the uphill incision. In the test, about 6.36 m³ was deposited at the foot and zero above it; this is a fixture result in occupancy-volume units, not a calibrated field prediction.
7. UI defaults, the increased limit, and separate runoff controls are wired to the engine.

Validation: **80 unit tests and 25 targeted browser/GPU tests passed**, plus the production build and a standalone production startup/step check with 4,096 selected samples. The full historical browser suite was not rerun.

The subsequent [physical-rain handoff update](continuous-rain.md) replaces impact-only precipitation with real sediment carriers, conservative local coalescence and finite-capacity backpressure. Its validation supersedes the earlier rain architecture.
