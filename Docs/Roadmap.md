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

## C. Dynamic geometry (BVH for moving and animated objects) — D6/D7 delivered

See `Docs/DynamicGeometry.md` for the plan, the measured budget table and the decision record.

| # | Item | | % | What's left → next step |
|---|---|---|:--:|---|
| 14 | D6 object-space BLAS + per-instance transforms in the kernel | ⚠️ | 90 % | Built and CPU-proven (`Exhibits/Workbench/Traversal`, 103 gates: identity bit-identical, transform agreement, payload, wiring pins). Left: **one GPU run** |
| 15 | D7 TLAS over instances (build at load, rebuild per frame) | ⚠️ | 85 % | Measured **0.07 / 0.32 / 1.42 ms** at 256 / 1 024 / 4 096 all-moving instances (TLAS alone 0.05 / 0.23 / 1.06). ⚠️ 4 096 misses the ≤1 ms plan number on the 2-core proof host |
| 16 | D8 dynamic BLAS update path (refit for deforming meshes) | ❌ | 0 % | Layout decision first: the packed CWBVH re-quantize is the cost (5.2 ms per 16 k-tri character) |
| 17 | D9 GPU refit / GPU build kernels (wide-AABB refit; H-PLOC for topology changes) | ❌ | 0 % | Needs the layout from D8 and a GPU runner |
| 18 | D10 ReSTIR/temporal integration for moving geometry | ❌ | 0 % | Motion vectors exist (`PreviousWorld`); identity-based validation is the new part |

## D. Project format — ≈ 8 % (plan complete, nothing built)

| # | Item | | % | What's left → next step |
|---|---|---|:--:|---|
| 19 | P1 header + directory + `TYPE`/`META` + checksum + gate | ❌ | 0 % | Round-trip / truncation / unknown-table tests |
| 20 | P2 `.geometry` / `.material` / `.instance` + `MaterialSlot` | ❌ | 0 % | Bit-identical to the glTF path on the M10 level |
| 21 | P3 `REFS` + `BLOB` + five modes + `-Pack`/`-Explode` | ❌ | 0 % | Dedup, engine-content resolution |
| 22 | P4 Unreal-style CLI, migrate Project-Zero, glTF → interchange | ❌ | 0 % | Package run == `--scene` run |
| 23 | P5 `.runtime` (`.state` family deferred by the owner's call) | ❌ | 0 % | Write/read-back only |
| 24 | P6 `.environment` / `.pigment` / `.uvspace` / `.workflow` / `.archive` | ❌ | 0 % | Each gets its own exhibit pair |
| 25 | §10 open questions (8), esp. material assignment copy vs share | ⚠️ | 0 % | **Blocks P2** — needs decisions, not code |
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
2. 📝 Answer the §10 questions (the one that matters: material assignment copy vs share / CopyOnWrite) — unlocks P1/P2.
3. 🧭 Pick the next CPU-measurable build: **D8/D9** (dynamic BLAS update policy + GPU build for topology changes, next
   per `Docs/DynamicGeometry.md` §6), replay + shift mapping (indirect 16 % → 100 %), or the sky probe bake.
