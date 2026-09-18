# Roadmap — what is left, in one place

Written 2026-09-17. Supersedes the "what's next" list in the proofs report (§13) as the *index* of outstanding work;
the report keeps the evidence, this file keeps the queue. Percentages are engineering estimates of the work
*remaining-to-done*, not metrics: 100 % means shipped and measured, not "code exists".

**Legend** ✅ shipped & measured · ⚠️ landed but unverified where it matters · ❌ not started

## A. Renderer / ReSTIR — ≈ 86 %

| # | Item | | % | What's left → next step |
|---|---|---|:--:|---|
| 1 | Spatial-reuse convergence fix (history split + pre-merge cap) | ✅ | 95 % | One GPU A/B on the owner's card |
| 2 | Temporal reuse, M growth bounded | ✅ | 92 % | 1 000-frame M-clamp soak (ticket open) |
| 3 | Indirect/GI pool in the CPU mirror | ✅ | 100 % | — (A/B: 7 387 vs 7 508 · 7 223 vs 7 295 · 7 632 vs 7 680) |
| 4 | Indirect/GI pool in the kernel (`kFeatureGiReuse`, ON by default) | ⚠️ | 85 % | Landed text-verified; **needs the GPU run** |
| 5 | Indirect coverage 16 % → 100 % (replay + shift mapping) | ❌ | 0 % | Design note only; the pool is blind to sky vertices |
| 6 | Sun-coin variance, occluded-selection weight loss | ❌ | 10 % | Named and measured as the residual; no fix attempted |
| 7 | Independent reference (second seed stream) for the RMSE floor | ❌ | 0 % | Today ② ≡ ① shares the plain seed stream |
| 8 | Quality dials (render scale, candidates, extra, taps slider, GI toggle) | ✅ | 100 % | Exposed and documented |
| 9 | Materials M1–M10 + kernel K0–K5 | ✅ | 96 % | GPU pixels for the triptych, M10 level, denoiser A/B |
| 10 | Deferred material work (M4c dispersion, glints, displacement ch20, Tier-B multi-slab) | ❌ | 0 % | Queued, unscheduled |

## B. GPU verification — ≈ 5 % (no GPU, no SPIR-V compiler in the sandbox)

| # | Item | | % | What's left → next step |
|---|---|---|:--:|---|
| 11 | GPU render-verification (K0–K5, GI pool, M10 level, denoiser under motion) | ❌ | 0 % | **The single biggest open item** |
| 12 | Owner's fullscale blur + fireflies report closed | ❌ | 0 % | Needs commit + tier + denoise setting from the test |
| 13 | Brute-force-vs-reservoir budget study on GPU | ❌ | 0 % | Mirror says plain wins 7.8× at equal resolve rate (§14.3) |

## C. Dynamic geometry (BVH for moving and animated objects) — D6/D7 delivered · D8 refit · D9/D9b device path · D10 temporal identity

See `Docs/DynamicGeometry.md` for the plan, the measured budget table and the decision record.

| # | Item | | % | What's left → next step |
|---|---|---|:--:|---|
| 14 | D6 object-space BLAS + per-instance transforms in the kernel | ⚠️ | 90 % | Built and CPU-proven (`Exhibits/Workbench/Traversal`, 103 gates: identity bit-identical, transform agreement, payload, wiring pins). Left: **one GPU run** |
| 15 | D7 TLAS over instances (build at load, rebuild per frame) | ⚠️ | 85 % | Measured **0.07 / 0.32 / 1.42 ms** at 256 / 1 024 / 4 096 all-moving instances (TLAS alone 0.05 / 0.23 / 1.06). ⚠️ 4 096 misses the ≤1 ms plan number on the 2-core proof host |
| 16 | D8 dynamic BLAS update path (refit for deforming meshes) | ✅ | 90 % | **In-place refit of the packed layout**: 4.39 ms for 31 927 triangles (vs 74.84 ms rebuild; the packed re-emit is 7.76 ms and no longer fits the uploaded slice). 116 gates, 0 failed — refit ≡ rebuild on 20 000 rays, the blob reaches its own geometry, untouched BLAS slices byte-identical. ⚠️ Left: one GPU run (kernel-side refit + rendered frame) |
| 17 | D9 GPU refit / GPU build kernels (wide-AABB refit; a build for topology changes) | ⚠️ | 95 % | **Both kernels written, gated, and now with their whole host and Vulkan halves; the RUN is the one thing left.** `BlasBuild.slang` (Morton prepass · per-level octant partition, which is also the sort · childBase scan · emit · leaf runs) and `BlasRefit.slang` (leaf rewrite + one dispatch per level, deepest first) — 15/15 lowered, §⑩ pins B1–B115. **The build rule was chosen by measurement** (§⑨g, four builds, same 12 000 rays): D9 v1 (octant, no pack) 17 835 nodes / 17.9 ms / 10.93 ms walk · clustered (bins + SAH merge) 4 681 / 15.8 ms / **19.73 ms** · collapse (uniform 8-way) 4 681 / 12.1 ms / **24.72 ms** · **shipped (octant + the format rule) 7 185 / 12.5 ms / 10.11 ms**. The two clustering rules produce the SAME tree here, so the SAH merge never fires — and both walk 2.4× slower than the shipped rule at 26 % empty slots against 46.7 %: in a wide format **a full node is not a faster node**, because filling the eight slots forces each box to be a union of slices the octant rule keeps apart. **The serial stages are gone**: the level's childBase sum and the arena's run sum are block-local scans plus a block prefix (§⑨j checks that arithmetic against the serial one over the shipped build's 7 185 nodes, block boundaries included). **The device path is written**: `BlasDevicePayload` (push blocks, soup, level table, dispatch plan — §⑨i checks 60 build dispatches and 9 refit dispatches against the tree that exists), `BlasBuildPipeline` (pipelines, buffers, barriers, readback verification against the mirror — links no Vulkan loader, so it compiles and is gated where no libvulkan exists), and `Exhibits/Workbench/Traversal/BlasDeviceRun.cpp` + `RunBlasDevice.sh` (`--refit` checks the refit against a mirror refit of the same deformation). 236 gates, 0 failed. ⚠️ **Nothing has been executed on a device** — this sandbox has no GPU: `RunBlasDevice.sh` reports SKIPPED here and is the command to run elsewhere. Left: that run |
| 18 | D10 ReSTIR/temporal integration for moving geometry | ✅ | 100 % | Delivered and gated (`CheckTemporalIdentity.sh`, GREEN): the history records WHICH surface it came from (bit 9, the OBJECT — never the triangle), stored in the moment image's reserved z/w and in an 80 B reservoir record, validated in the mean and in both pools. The shadow follows the object (865 / 1 072 floor points, footprint moves), a still scene is left alone (0.8 % of pixels), and the ghost is refused — **1.94× lower error** against the untouched level at the same pose (891 vs 1 732 RMSE). ⚠️ Left: one GPU run |

## D. Project format — P1–P6 shipped and gated

See `Docs/ProjectFormat.md` for the plan, the divergences and the measured sizes.

| # | Item | | % | What's left → next step |
|---|---|---|:--:|---|
| 19 | P1 header + directory + `TYPE`/`META` + checksum + gate | ✅ | 100 % | `SpaceFormat.h`/`SpaceCodec.{h,cpp}`; `CheckSpaceFamily.sh` GREEN (19 claims, 2 GPU skips) |
| 20 | P2 `.geometry` / `.material` / `.instance` + `MaterialSlot` | ✅ | 100 % | `SpaceExport.{h,cpp}`; 49/49 record sets identical by memcmp (CPU half) — AE=0 on device still owed |
| 21 | P3 `REFS` + `BLOB` + five modes + `-Pack`/`-Explode` | ✅ | 100 % | Dedup flat at 136 B/copy; `Pack(Explode(X)) == X` (`SpaceTool`, `Tools/Scripts/*.sh`) |
| 22 | P4 Unreal-style CLI, migrate Project-Zero, glTF → interchange | ✅ | 100 % | `CommandLine.{h,cpp}` + `SpaceTool`; CPU parity by memcmp (49 geometry + 49 material record sets) |
| 23 | P5 `.runtime` (`.state` family deferred by the owner's call) | ✅ | 100 % | Written by `SpaceTool`; a file claiming the state-embedding policy is refused by name |
| 24 | P6 `.environment` / `.pigment` / `.uvspace` / `.workflow` / `.archive` | ✅ | 100 % | Six exporters in `SpaceExport.cpp`; `-Bake=Sky` probes from `AtmosphereModel`; editors deferred (§11.3) |
| 25 | §10 open questions (8), esp. material assignment copy vs share | ✅ | 100 % | q4 answered **CopyOnWrite** and taken in code (project export slots); the rest documented defaults |
| 26 | Environment lighting stage A — bake the sky probe | ❌ | 0 % | CPU-measurable; the smallest version that pays |
| 27 | Environment lighting stage B — sky as a reservoir candidate | ❌ | 0 % | After A; fixes glass/specular sky variance |
| 28 | "This is the new master branch" designation | ⚠️ | 0 % | Unanswered; work currently sits on `arena/01a0af43-slate` |

## Weighted summary

- Renderer/ReSTIR ≈ 86 % — everything left is GPU-verified or a deliberate research step (#5–7).
- GPU verification ≈ 5 % — nothing in the sandbox can move it; it gates all remaining confidence.
- Dynamic geometry ≈ 40 % — D6/D7 are built, CPU-proven and wired end to end; the remainder is D8/D9 (deformation and
  GPU build) plus the GPU run that closes D6/D7.
- Project format ≈ 8 % — deliberately unstarted; blocked on decisions, not on code.
- Whole product ≈ 62 %.

## Next three, in order

1. 🔎 Run the current tip on the GPU with the HUD's ReSTIR row open ("indirect pool on/off · N taps") and report
   commit + tier + whether the blur/fireflies survive — closes #4 and #12 together.
2. 📝 §10 answered (q4 = **CopyOnWrite**, taken in code) — P1–P6 shipped and gated; the only item left is the device-side AE=0 parity run.
3. 🧭 Pick the next CPU-measurable build: **D8/D9** (dynamic BLAS update policy + GPU build for topology changes, next
   per `Docs/DynamicGeometry.md` §6), replay + shift mapping (indirect 16 % → 100 %), or the sky probe bake.
