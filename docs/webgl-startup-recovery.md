# WebGL2 startup context loss — 2026-09-16

## Report and confidence

The reported production bundle (`main-BsWt8-g3.js`) logged `GPU erosion / motion:` with an empty shader log, another empty renderer error, and `CONTEXT_LOST_WEBGL`. That establishes a graphics-context failure, not lack of WebGL2 hardware support. It does not establish which driver, resource limit, or watchdog caused the reset. Arena's report-only help/privacy CSP warnings are not evidence of application shader failure; no platform CSP was changed.

Local tests use Chromium 153 / ANGLE SwiftShader. The failure path is reproduced by deliberately losing a real WebGL2 context during motion compilation, not by reproducing the user's native GPU reset. Native-driver confirmation remains outstanding.

## Changes

- Core erosion programs compile before the large float atlases are allocated. Sparse storage programs compile before their atlases; fine hydraulic programs compile before their additional material/exchange textures.
- Motion's spawn-ray and inlet-projection loops use bounded runtime limits (still 256 and 8 iterations). The integrator retains its previous `min(32, substeps)` iterations and original timestep divisor, but no longer expresses this as a static 32-iteration loop with a dynamic break.
- The shared surface normal still takes six central-difference SDF samples. A runtime three-axis loop uses two refined-sampler call sites instead of six expanded call sites. Existing sparse interpolation and hash-loop optimizations remain intact. This is intended to reduce compiler expansion, not to lower sampling quality; native compiler memory usage was not measured.
- Shader creation, compilation and linking have shared, nonempty, stage-specific errors. Empty driver logs, context loss and texture `OUT_OF_MEMORY` are distinguishable.
- Failed core/sparse/fine initialization releases owned resources. Fine program aliases are removed from the parent solver when disposed. Failed shader linking also releases its program and shaders.
- The context-loss listener is registered before initialization. A lost context stops startup rather than attempting fallback shader compilation. Late context-loss events preserve the original startup error.
- Pending GPU completion fences report context loss rather than replacing it with the generic `GPU erosion fence failed` message. This race was found by the recovery regression test.

No terrain resolution, brick capacity, particle capacity, physical kernel width, hydraulic equations or workflow defaults were intentionally reduced. Default fine storage remains 4,096 bricks at 0.5 m cells; this change does not reduce steady-state storage requirements or guarantee that every GPU can accommodate them. No WebGPU, CPU erosion, or heightmap substitute was introduced.

## Verification

- **104 unit tests passed**, including 10 resource/error/loop-limit tests. Fault-injected tests cover empty compile logs, context loss, link cleanup, successful ownership transfer, allocation failure, failed fine initialization, and pending fences.
- **20 targeted browser tests passed**: 5 render recovery/startup, 8 fine hydraulics, 5 sparse XYZ, and 2 physical-rain checks (admission and diameter-dependent falling speed). This is not the entire historical browser suite.
- The motion-startup loss test observes **zero texture-storage allocations before the injected failure**, **zero shader creations afterward**, a prevented context-loss event, persistent recovery controls, and the motion/fragment stage in diagnostics.
- Fine geometry/picking proof: 1,506 changed pixels with particle effects hidden; picked Y changes from 99.75 to 99.6869812 m. Checkpoint and v3 export arrays match exactly.
- Authored-route shaping proof: 64 updates, 28.4497924 m³ fine removal, 0.028301398 m³ deposition, approximately 0.947 m sampled incision; ledger error 2.03e-8 m³. No measured steady-state CPU readbacks, texture uploads or allocations. These are authoring quantities, not calibrated natural rainfall.
- **Production build passed** (`main-8-y9JEWJ.js`). Production-preview smoke: default kilometre terrain, 8 updates, 4,096-brick capacity, 0.5 m cells, 0.293452837 m³ removed, zero measured ledger/mass residual and no browser errors.

Ignored local evidence is under `artifacts/startup-*.log`, `artifacts/startup-production-smoke.mjs`, and `artifacts/startup-production-smoke.json`.

## If the native browser still resets

Reload the updated preview (close an old duplicate preview first). Use **Error details** / **Copy diagnostics** if it fails. The new error should identify motion/fragment compilation, terrain compilation, allocation, or GPU completion rather than being empty. Browser/version and GPU model are useful follow-up information. Do not infer unsupported WebGL2 from a context reset, disable security policies, or claim the native GPU issue is confirmed fixed solely because SwiftShader tests pass.

## Follow-up: opaque link failure while context-loss flag is false — 2026-09-17

The user's next report (`main-8-y9JEWJ.js`) still failed: motion **linking** returned false with no log, followed by the fallback renderer's vertex compilation failing. The previous stop condition was insufficient: `isContextLost()` was false at the first reported failure. This does not prove the native driver reset's root cause.

### Current pipeline: `split-motion-v1`

- Unknown compilation/link/allocation failures are terminal. Only explicitly tagged capability rejections can enter static XYZ viewing. This preserves the first failure even if a context-loss notification arrives later. Unknown fine-initialization failures are not silently converted to weather mode either.
- Production no longer compiles the combined particle birth/transport program. Preprocessor-specialized birth and transport shaders write disjoint old-age subsets to the existing four motion outputs. Both read the same old state. Births cannot also integrate that tick, and retirement cannot immediately rebirth. No additional scratch textures or terrain-resolution reductions were introduced; there is one extra program and draw per motion update.
- Route scans keep their 64-segment cap but use runtime loop bounds. Motion reuses the same closest-route query for wetness and current within each substep. Drainage normals retain all six central-difference samples through a three-axis loop, reducing expanded refined-SDF call sites.
- GPU/ANGLE identification (where the optional browser extension permits it), WebGL/GLSL versions, limits, program outcomes/timings, pipeline identifier and first error survive failed startup and are included in **Show diagnostic details / Copy diagnostics**. No WebGPU probing or external diagnostic upload is used. Source character counts include preprocessor-disabled text and are not native binary-size measurements.
- Error text has higher contrast and readable sizing inside narrow previews. Removed page-load `autofocus` from the Add popover; it focuses the first item only when opened. The cross-origin autofocus message was incidental, not the shader failure's cause.

### Follow-up verification

- **106 unit tests passed.** The additional tests distinguish capability rejection from an opaque link error and verify persisted failure reports, including null program creation.
- **26 distinct targeted browser tests passed across batches**: 7 startup/recovery, 9 fine hydraulics (including split/combined equivalence), 5 sparse XYZ, 2 weather, 2 runoff (bounded-head pockets and 16,384 real particles), and 1 lifetime test.
- Fault injection reproduces the important reported state: link=false, empty log, `isContextLost()`=false. The app preserves `GPU erosion / motion / link`, creates zero subsequent shaders, and exposes the GPU/program diagnostics rather than replacing them with a fallback error.
- Split/combined GPU equivalence: 12 source/workflow cases, 41 births, **zero measured component difference** across the four motion outputs; births retain age zero, and expired/outside particles do not rebirth in the same tick. This is finite-case equivalence, not a proof for all possible input states.
- Authored-route fine-erosion evidence is unchanged: 28.4497924 m³ removed, 0.028301398 m³ deposited after 64 authoring updates, approximately 0.947 m sampled incision. No measured steady-state CPU readbacks, uploads or allocations.
- An older lifetime fixture initially failed because it expected 0.014 m³ (14 litres) of rain to be dry. An A/B rerun with the **pre-split motion source** failed at the same assertion. The fixture now asserts that 14 litres stays active and 1e-13 m³ settles; captured lifetime and retirement assertions remain. No production evaporation or dryness threshold was changed. The corrected test passed.
- Production cross-origin iframe smoke: eight updates, default kilometre terrain, 4,096-brick capacity, 0.5 m cells, 0.293452837 m³ removed, zero measured ledger/mass residual, no browser errors. Startup/readback performance warnings are separate from errors.

Tests still use Chromium 153 / ANGLE SwiftShader, not the user's Windows/native GPU. Shader splitting reduces the combined compilation workload structurally; its effect on that driver's linker and memory usage remains unmeasured. Confirmation on the user's browser is still required. Local logs and smoke results are `artifacts/link-*` (ignored generated evidence).

## Native AMD viewport link failure — 2026-09-17

The subsequent complete report identifies **AMD Radeon RX 9060 XT**, device
`0x00007590`, ANGLE **Direct3D11 vs_5_0 ps_5_0**, Windows/Chrome 153. All **23 core
and auxiliary erosion programs linked**. Motion took 12,281 ms and birth 31,336 ms.
The **Terrain renderer** (26,009 fragment-source characters) then failed **linking
after 84,007 ms**, with no driver log, GL error 0, and neither context loss at
capture nor a context-loss event observed in that report. It is not evidence of
missing WebGL2 or a confirmed context reset. The original native failure is real;
its compiler/driver root cause has not been established.

### Mitigation: `split-viewport-v1`

- GPU viewing now compiles **Terrain renderer / solid** and **Terrain renderer /
  water + composite** separately. The solid pass retains terrain tracing,
  shading, Satmaps, brush and fracture overlays. The second pass retains water
  intersections, full fine-XYZ reflected/refracted terrain shading, fog, tone
  mapping, vignette and dither. Particle/sediment overlays follow the composite.
- One **RGBA32F** target stores linear HDR RGB and signed ray distance. Distance
  sign preserves terrain versus floor/sky hit state; no intermediate tone
  mapping, filtering, distance quantization or geometry resampling is introduced.
  The target costs **16 bytes per rendered pixel** (about 9.92 MiB at the existing
  approximately 650,000-pixel viewport cap). Resize frees the old size first;
  same-size draws allocate nothing. An incomplete/failed target is an error,
  not permission to drop fine detail. Static viewing without float-render-target
  capability keeps the combined path and needs no extra float target.
- Raymarch/shadow/AO, waves, optical rays, route/fracture scans and normal/curvature
  helpers use bounded runtime loops. All original limits and samples remain:
  360 primary trace steps, 32 shadow steps, 4 AO samples, 28 optical terrain steps,
  64 route segments, 4 wave modes, 8 intersection refinements, both optical rays,
  six normal samples and seven curvature samples. Both water rock-light queries
  share one loop call site instead of two expanded call sites. Shared helper
  guards preserve standalone shader consumers with zero-default uniform bounds.
- Initialization or first-frame failure disposes the viewport programs and target
  as well as the solver. A composite link failure remains terminal and identifies
  the exact pass; no blind fallback recompilation follows it.
- No physics, erosion timestep, brick capacity, cell spacing, authoritative fine
  collision/picking/export, or terrain-domain limits were reduced. This is a
  compiler-workload mitigation, **not a verified fix on the native AMD driver**.
  Preprocessor-excluded source still contributes to diagnostic character counts;
  those counts do not measure native compiler memory or binary size.

### Verification and remaining failures

- **109 unit tests passed**, including viewport target resize, idempotent cleanup,
  incomplete-framebuffer handling and unchanged sample budgets.
- **28 distinct targeted browser tests passed across batches**: 10 fine hydraulic,
  8 startup/recovery, 3 fracture, 1 intact fracture GPU test, 4 Satmaps, and 2 water.
  This is **not a clean full-suite run**: two older intact-fracture UI tests time
  out waiting for the first painted preview. A rerun of the non-stale-worker case
  using all six **pre-change viewport modules** fails at the same wait, before
  applying or selecting any fracture. The stale-worker case fails at that same
  shared step; its separate worker-recovery assertions were not reached.
- The broader run also caught a standalone Satmap shader missing the new loop
  helper declarations. Shared guarded declarations fixed that actual regression;
  its six-axis convex/cavity GPU check passes again.
- A frozen **pre-change monolithic GPU shader** is compared against the new
  viewport: **21 view/configuration cases, zero differing 8-bit components** on
  SwiftShader. Cases include fine erosion, all four palettes, six diagnostics,
  brush/plane/both Voronoi overlays, water/reflection/refraction, animation, hidden
  terrain, sky and three resized targets. Water changes **12,461 pixels** relative
  to the dry case, so water is exercised rather than absent in both images.
- Fine viewport/picking/export still reports **1,506 changed pixels**,
  Y **99.75 → 99.6869812 m**, exact checkpoint/export arrays and GL error 0.
  The existing split-motion equivalence and conservative hydraulic tests pass.
- Fault-injected opaque **composite** link failure observes a successfully linked
  solid pass, preserves link=false/log-empty/context-not-lost diagnostics, leaves
  **zero live owned programs**, and creates **zero programs after failure**.
- Logs: `artifacts/viewport-{browser,equivalence,recovery-water,curvature,units}.log`.
  The old-renderer fracture reproduction is `artifacts/viewport-old-intact.log`.
  All GPU evidence here uses Chromium 153 / ANGLE **SwiftShader**, not D3D11.
- Final guarded-helper verification reruns the 21-case pixel comparison,
  composite-link recovery, static capability fallback and animated water checks:
  **4/4 passed**, with zero pixel differences again. `viewport-final-check.log`.
- Production build: **`main-B8FZ8s1X.js`**. Real cross-origin iframe smoke reports
  `split-viewport-v1`, ready, eight updates, 4,096-brick capacity, 0.5 m cells,
  **0.293452837 m³** removed, zero measured mass/ledger residual and no browser
  errors. `artifacts/viewport-production{.log,-smoke.json}`. The updated production
  preview was restarted on port 5174; no development server was left running.
