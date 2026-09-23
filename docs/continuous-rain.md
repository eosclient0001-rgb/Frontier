# Physical rain and conservative runoff handoff

**Resolution correction:** these are representative parcels, not geometrically resolved millimetre drops. The handoff work does not fix the coarse erosion footprint. See [adaptive XYZ refinement status](adaptive-xyz-refinement.md); its storage is now connected in the separate Hydraulic shaping workflow.

## What changed

The impact-only recycling implementation was insufficient: it removed rain at contact and supplied a water-availability proxy rather than letting the drop itself transport sediment. Large-ID sine hashing could also quantize birth positions into recurring columns. Both mechanisms have been replaced.

- **2,048 rain slots** (IDs 16,384–18,431) feed a **4,096-default / 16,384-maximum carrier pool**. Combined particle storage is 64 × 288.
- A uint hash keyed by particle ID, simulation tick and seed supplies fresh birth samples. Per-empty-slot birth probability is `1 - exp(-4 * intensity * dt)`.
- Drops spawn in clear air above the actual XYZ SDF, fall under gravity, and latch their first real impact. Airborne drops cannot erode. Landing and subsequent runoff use the real hydraulic exchange, occupancy acceptance, cargo and species pipeline—not a cosmetic wetness handoff.
- Landing captures the independent runoff travel budget (600 simulated seconds by default). Water keeps flowing with slow evaporation; stationary collision jitter does not create repeated splash erosion.
- Primary slots do not spontaneously spawn rain. They receive landed parcels. Internal type −1 identifies the rain pool, not a sediment-free particle.

## GPU-only handoff and coalescence

After each erosion update, particle-sized GPU passes allocate landed rain to a free primary slot or coalesce it with nearby compatible water:

1. Two 128 × 128 R16F MAX-blended bucket passes select stable local owners. Separate high/low codes represent all 16,384 primary IDs exactly.
2. A rain donor looks in the neighboring buckets for a nearby surface-water parcel; absent one, it probes at most 32 free slots. Primary donors rotate through eight cohorts and may coalesce with a higher-ID owner in their own bucket.
3. Two R16F MAX claim buffers select exactly one donor per recipient, with rain priority. Claim codes never exceed 2,048; allocation does not require float32 blending.
4. A free-slot handoff copies the exact physical position, velocity, metadata and captured clock. A local merge preserves the recipient position, sums water, water-weights velocity and retains the minimum remaining lifetime/stillness and lowest-elevation history.
5. All sediment species and every cargo-ledger channel move/add together. Successful donors clear the moved inventory and history. A recipient cannot simultaneously donate: canonical owners remain stable during the update.

Local compatibility uses a 1.5-horizontal-cell radius, a bounded elevation difference and a midpoint SDF clearance check. This is resolution-scale parcel coalescence, not resolved droplet collisions or a pressure-based fluid simulation. It does not relocate water to arbitrary distant streams.

**Finite-capacity limitation:** if no free or nearby compatible destination is found, the drop remains real, visible, sediment-carrying runoff in its rain slot. This creates backpressure under extreme saturation instead of deleting sediment or teleporting parcels. Continuous rainfall is sustained at ordinary tested density, not guaranteed indefinitely for every sparse, fully occupied configuration. Higher carrier capacity or lower emission can help.

The existing scalar impact field is retained for diagnostics/checkpoints. It no longer recharges carriers: real rainwater is transferred by parcels, avoiding double-counting the same rainfall through a proxy. Rain water now uses m³ under a mm/hour supply budget; sediment conservation remains voxel-occupancy accounting.

## Controls, display and resources

- Zero emission or switching away from Rain stops rain births. Existing parcels finish their physical motion and captured lifecycle. Pause freezes the solver; hiding markers does not change it.
- Draw up to **4,096 carrier markers plus 2,048 rain/runoff markers** (6,144 total, excluding optional sediment-plume sprites). Higher primary counts are stride-sampled for display only.
- Surface markers receive a small normal-direction display lift above the coarse ray-hit threshold, a minimum 2.4-pixel size and a wet tint. Physical contact/erosion positions are unchanged. Airborne streaks follow actual velocity.
- Transfer adds **six bounded particle/bucket-sized draws**, approximately **0.20 MiB** of scratch textures, no additional full-volume pass, and no per-step CPU readbacks or runtime texture allocation.
- Total particle-state/scratch storage is approximately 4.42 MiB. The two retained scalar impact atlases use 5 MiB. The authoritative XYZ SDF grid is unchanged.
- Exact checkpoints include both populations and the impact field; layout is `rain-volume-v5-64x288`. Old layouts are rejected. Terrain exports omit live simulation state and declare `precipitationModel: "volume-budgeted-rain-v3"` and `rainFilmIncluded: false`.

## Validation

81 unit tests and 28 targeted browser/GPU checks passed across the continuous-rain, falling-rain, runoff-transport, lifecycle, performance and checkpoint suites. These use real WebGL2 under SwiftShader, not native-device FPS benchmarks. The full historical browser suite was not rerun.

The 160-update allocation/RNG regression at default carrier capacity sampled ten windows: approximately 1,350–1,640 airborne drops and 166–198 fresh births in each sampled update. All sampled births had unique X coordinates; tracked returning slots had no exact repeated XZ positions. More than 90% of tracked rebirths moved over 100 metres. This fixture isolates allocation by disabling erosion; separate coupled tests verify physical terrain exchange.

Coupled checks verify:

- A real falling drop cuts the SDF, carries sediment, transfers at the exact landing position and continues visibly downhill.
- Water, species and all cargo history survive competing transfers, including the highest primary/rain IDs; the transfer path works with float32 blending disabled.
- A full incompatible pool retains its loaded drop, which continues downhill after emission is stopped and the source is changed.
- One-time impacts, evaporation, finite captured lifetimes, stationary anti-crater behavior, genuine foot-of-slope deposition, aggregate cut limits, checkpoint equality and global material accounting remain intact.
- Rendering does not advance physics; steady updates add no CPU readbacks, allocations or full-volume passes.

The production build and standalone preview smoke check also passed: after 17 default-mountain updates, the audit reported 1,513 runoff carriers, 1,656 airborne drops, nonzero real erosion and no browser/solver errors. Screenshot: `artifacts/physical-rain-production.png` (ignored generated artifact). A larger 48-update software-rendered UI smoke attempt exceeded its wall-time budget; no native-performance claim is made.

The [subsequent realism correction](rain-realism-diagnosis.md) supersedes the former rain water-weight normalization, default evaporation and acceleration presets. Rain/legacy-runoff quantities cannot merge across incompatible units; GPU checkpoints include the new water ledger and occupancy remainder.
