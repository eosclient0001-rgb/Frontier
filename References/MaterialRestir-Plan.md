# 🧩 Material ↔ ReSTIR completion plan (for approval)

**Goal:** finish the material system — all twenty channels of SultanAladin/Slate doc `42` /
`18` §2 — and wire every one of them through the ReSTIR integrator (direct term, shadow
rays, GI bounce, reservoirs). This plan does not redesign the material core: the OpenPBR-slab
records already carry a superset of the twenty channels. The work is **sampling + shading +
ReSTIR wiring** for what is stored but never read, plus the **reflectance-selection**
dispatch rule (`18` §3 / `42` §5) and a **material inspector**.

**Authority docs (SultanAladin/Slate, `AgenticInstuctions/ConstructionSequence/Completed/`):**
`42-MaterialSpecification.md` (20 channels, 8 selections, absent-is-not-zero, selection per
material, retained channels, per-material cutout), `18-ReflectanceIntegrator.md` (channel
inventory, shading models, GGX+EON+MS-compensation direct term, unread-channels-not-sampled),
`62-TransmissionSequence.md` (cutout ≠ transmission, per-material threshold),
`PhysicalSurfaceSpecification.h` (closures + feature bits), `PhysicalSurfacePacket.h` (GPU
payload pattern). Local baseline: R4b (this branch) + `MaterialSystemResearch-2026.md` §7.

## 0. Where we are (verified, not assumed)

| # | Sultan channel | Local carrier (slab / record) | Stored | Resolved¹ | Shaded | In ReSTIR |
|---|---|---|---|---|---|---|
| 1 | Base colour | `base_color` + ch0 tex | ✅ | ✅ | ✅ EON | ✅ |
| 2 | Metallic | `base_metalness` + ch1 | ✅ | ✅ | ✅ F82 | ✅ |
| 3 | Roughness | `specular_roughness` + ch2 | ✅ | ✅ | ✅ | ✅ |
| 4 | Reflectance (F0) | `specular_ior` + `specular_weight/color` | ✅ IOR form | ✅ | ✅ exact dielectric | ✅ reflection |
| 5 | Surface orientation | `geometry_normal` ch4 | ✅ | ✅ | ✅ | ✅ |
| 6 | Ambient occlusion | `occlusion` ch14 | ✅ | ✅ | ⚠️ ambient-floor only | n/a — correct for a path tracer² |
| 7 | Emission | `emission_*` + ch6 | ✅ | ✅ | ✅ direct | ✅ (+ emissive short-circuit) |
| 8 | Opacity | `geometry_opacity` + ch7, `AlphaCutoff` | ✅ | ✅ | ✅ cutout | ✅ cutout; ❌ blend / transmissive |
| 9 | Anisotropy | `specular_roughness_anisotropy` | ✅ | ✅ signed (`!= 0`, M2) | ✅ GGX aniso | ✅ (M2) |
| 10 | Anisotropy direction | `anisotropy` ch13 tex + `SlateAnisotropyRotation`→`Slate2.x` | ✅ | ✅ M2: RG dir × B strength + slab rotation | ✅ rotated frame | ✅ |
| 11 | Clear coat | `coat_weight` + ch10 | ✅ | ✅ | ✅ | ✅ |
| 12 | Clear coat roughness | `coat_roughness` | ✅ | ✅ | ✅ | ✅ |
| 13 | Clear coat orientation | `geometry_coat_normal` ch5 | ✅ | ✅ M2: post-normal-map frame + ch5 | ✅ coat frame | ✅ |
| 14 | Sheen colour | `fuzz_color` + ch11 (glTF sheen→fuzz mapped) | ✅ | ✅ | ✅ LTC sheen | ✅ |
| 15 | Sheen roughness | `fuzz_roughness` | ✅ | ✅ | ✅ | ✅ |
| 16 | Subsurface colour | `subsurface_color` + ch9 | ✅ | ❌ | ❌ R4b scope line | ❌ |
| 17 | Subsurface thickness | `subsurface_radius/scale` (**[m]** here vs [mm] there) | ✅ | ❌ | ❌ | ❌ |
| 18 | Transmission | `transmission_*` + ch8 (glTF transmission+volume mapped) | ✅ | ❌ | ❌ R4b scope line | ❌ |
| 19 | IOR | `specular_ior` | ✅ | ✅ | ✅ Fresnel | ✅ reflection; ❌ refraction |
| 20 | Displacement | — | ❌ | ❌ | ❌ | — (decision M6: bump-only, later) |

¹ `ResolveMaterial` in `ReSTIRViewport.slang` samples ch 0,1,2,3,4,5,6,7,10,11,12,13,14 (M2 wired +5,+13; ch 8/9 arrive with M4/M5).
² Doc `18` §7: occlusion attenuates ambient only. The kernel has no ambient term (only the
debug floor), so occlusion correctly does nothing in the path — keep it that way.

**The 8 reflectance selections** (`18` §3) have no local counterpart yet. The closest thing
is `ClassifyComplexity` (Simple/Single/Complex/Special) — a cost class, not a channel mask.
**Emissive-only** exists implicitly (emission short-circuit, kernel line ~551); **Unlit** has
a flag bit nobody reads.

**Branch situation.** `arena/01a0a578-slate` has *byte-identical* material files
(`MaterialCodec.*`, `MaterialDescriptor.h`, `MaterialEvaluation.slang`, `SceneRecords.slang`;
`MaterialIndex.*` differ by 1 line) but a much further ReSTIR (`ReSTIRViewport.slang`
753 → 1298 lines: temporal + spatial reuse, alias pick, à-trous denoise, adaptive exposure)
**and** a real sky/sun/atmosphere (`SkyAlong`, sun direct, moons) where this branch has pure
black background. Nothing about the new lobes depends on that branch's editor/sky/ocean
transplant — but glass *proofs* are far more convincing with a sky behind them, and the new
lobes must be validated under temporal/spatial reuse. Strategy: §1, decision D1.

## 1. Branch strategy (DECIDED — merged `01a0a578` in full, fbceb82)

This branch now continues directly from `arena/01a0a578-slate` (merge commit fbceb82):
the R6/R7 ReSTIR (temporal + spatial reuse, alias pick, à-trous, adaptive exposure) and the
sky/sun/atmosphere are in-tree. No cherry-pick portability discipline is needed anymore —
but the kernel-wiring diffs vs the old R4b kernel are still recorded per phase where they matter.

**Deferral (decided with the merge):** the à-trous **denoiser** and **motion-vector**
temporal reprojection stay in-tree but default **off**
(`ReSTIRIntegratorConfiguration::Denoise = false`, `TemporalReprojection = false`, with the
previously-missing `AssignTemporalReprojection` setter added). Rationale: new lobes are
validated on raw accumulated images so the filter can never hide or fake lobe energy; motion
vectors are still *produced* by R2, only their consumption is off. Both re-enable at M9 with
the A/B proofs (converged image must match with and without). M9 is therefore a
re-enable-and-validate milestone, not a branch sync.

## 2. Scope line

**In:** reflectance selection + unread-channel gating; anisotropy-direction + coat-normal
resolve; cloth selection (sheen-primary); thin- + thick-walled transmission/BTDF with IOR
refraction; SSS v1 (thickness wrap) → v2 (dipole at the bounce); ReSTIR wiring for all of
it (RIS target, shadow rays, bounce, reservoirs); codec gap-fill; material inspector UI;
CPU-port proofs + shader-ball rows + perf budget.
**Out (explicit):** nested dielectrics (v1 = one enter/exit pair); spectral dispersion hero
sampling (record the hook, default off — or M4c if time); glints (`slate_glint_*` stays
stored-but-unread); volumetric interiors / random-walk SSS; geometric displacement (rejected
— no tessellation stage; bump-from-height is a later optional); Tier B multi-slab kernel
evaluation (data path already folds; revisit after M9); Sultan `56` paint layers / `70`
analytic resolution (the `Imported`/`Constant` sources only — layered content is an editor
project of its own).

## 3. Design decisions (locked by this plan unless D-questions say otherwise)

- **D-sel — selection is derived, per material, never per texel** (`42` §5 gate). Derived in
  `MaterialIndex::Finalise` from flattened slab weights; packed into spare `MaterialRecord.Flags`
  bits (8–11 = `ReflectanceSelection`, 12–15 = closure hints) — **no record layout change**.
  All 20 channel declarations are retained on the descriptor regardless of selection.
- **D-f0 — IOR stays canonical; direct-F0 arrives as a `slate_` extension**, not a second
  truth: `slate_direct_f0_weight` lerps `specular_ior`-derived F0 toward `specular_color`
  as an absolute F0 (covers Sultan `InterfaceParameterization::DirectF0`). Records grow by
  1 float → `MaterialSlabRecord` 288 B → 292 B… **not** a whole vec4: instead pack into the
  `Runtime` vec4's spare lane? `Runtime` is full (uvsets/normal/occlusion/mixweight). So:
  steal from `Slate` vec4 — it holds 2 floats + 2 packed uints = full. Cleanest: new
  `vec4 Slate2` → record becomes **304 B = 19 vec4**, descriptor float prefix 58 → 59
  (`kSlabFloatCount` assert updated). One controlled layout bump, mirrored in
  `SceneRecords.slang`, done once in M1 together with any other scalar additions.
- **D-units — metres inside, millimetres at the Sultan boundary.** `subsurface_radius` and
  any Sultan-side thickness import multiply by 0.001 at the codec; displacement (if a height
  texture ever arrives) likewise.
- **D-cutout — cutout stays in visibility** (`62` §2, already true: raster discard +
  shadow re-trace). Transmission never touches `VisibilityIndex`; the path tracer resolves
  transmissive surfaces by tracing *through* them — no sorted `TransmissionIndex` needed
  (raster-only mechanism; explicitly substituted).
- **D-charlie — Charlie albedo goes in `SheenLut.w`** (currently unused; `EnergyLut.z` is
  `E_avg` and Kulla–Conty needs it — doc `18` §4.1's `.z` assignment is declined with reason).
- **D-bg — black background stands until M9.** Glass/SSS proofs use area-light Cornell-style
  scenes. Sky sync is a milestone, not a dependency.

## 4. Phases (one commit row each; proofs run in the CPU port first, kernel second)

### M0 — Coverage harness + audit (baseline, no behaviour change)
Files: `Scratchpad/MaterialChannelCoverageTest.cpp` (new), `References/` note.
- A test that walks all 20 channels × (descriptor → record → resolve-sampled → shaded →
  ReSTIR-consumed) and fails on any *unacknowledged* gap — the §0 table as executable code.
- Audit `MaterialCodec.cpp` KHR coverage (`specular`/`ior`/`sheen`/`clearcoat`/`anisotropy`/
  `transmission`/`volume`/`emissive_strength`/`dispersion`?) and record the M6 hit-list.
- Portability check: `git cherry-pick --no-commit` dry-run of material files onto `01a0a578`.
Proof: coverage test green-with-acknowledged-gaps; audit table in the commit note.

### M1 — Reflectance selection + unread-channel gating (the 8 Sultan models)
Files: `MaterialIndex.h/.cpp` (derive + pack selection/closure bits), `SceneRecords.slang`
(bit constants), `MaterialEvaluation.slang` (mask-gated helpers), `ReSTIRViewport.slang`
(both branches' `ResolveMaterial`: skip texture fetches for unconsumed channels;
`Unlit` → albedo-out fast path; `EmissiveOnly` → existing emission path explicitly).
- Mapping: Standard | Anisotropic (α>0 or aniso tex) | ClearCoated (coat>0) | Cloth
  (fuzz-dominant + no specular — see M3) | Subsurface (sss>0) | Transmissive (tr>0) |
  EmissiveOnly (emission>0, all else ~0) | Unlit (flag).
- `ClassifyComplexity` stays (cost), selection is *which channels to sample* (doc `18` §9 gate).
Proof: selection unit test (all 8 from descriptors); resolve texture-fetch counter test
(unread ⇒ zero fetches); Cornell + Sponza pixel-identical (gating must be behaviour-free).

### M2 — Sampled-channel completion (anisotropy direction, coat normal)
Files: `MaterialEvaluation.slang` (`ShadingRecord` += aniso frame angle / coat frame;
`ResolveLayers` rotates the GGX frame; coat lobe evaluated in the coat frame),
`ReSTIRViewport.slang` (sample ch13 RGB + `Scalar` rotation; sample ch5 coat normal),
CPU port + tests.
- Anisotropy direction texture: tangent-space direction rotates αx/αy axes; scalar rotation
  (already in `Scalar`) composes. Coat normal: independent TBN for the coat lobe only.
Proof: furnace still 1.0 under rotation; aniso-highlight rotation render test (brushed-metal
ball row); coat-normal-perturbation test; reciprocity holds in both frames.

✅ **SHIPPED.** Kernel formula `strength = P2.w × tex.B`,
`angle = atan(dir.y, dir.x) + Slate2.x` (fallback texel `(1, 0.5, 1, 1)` = +tangent);
coat frame from the post-normal-map `(t, b, n)` + ch5, hemisphere flip-guarded, expressed
in local coords; single layout bump 288→304 B (appended `Slate2`, float prefix untouched).
Furnace: ① equivariance <1e-3, ② μo=1 energy invariance ±1.5%, ③ rotated sampling ±3%,
④ isolated-specular reciprocity (full-stack dielectric BSDF is non-reciprocal by design,
OpenPBR §3.10), ⑤/⑦ tilted-coat energy ≤1.01 + sampling ±3.5%, ⑥ 2° continuity ±3%.
Signed anisotropy supported in shading; encode + complexity gate on `!= 0`. Identity frames
are FP-exact, so pre-M2 scenes are bit-stable. (Codec: real-header `g++ -fsyntax-only` +
one-off driver PASS for rotation/slots/native encode; the committed stub harness lands M6.)

### M3 — Cloth selection (sheen-primary)
Files: `ShadingTableCodec.*` (bake Charlie directional albedo into `SheenLut.w`),
`MaterialEvaluation.slang` (Cloth path: Charlie-or-EON diffuse + LTC sheen as the *primary*
lobe, GGX suppressed by selection, F0 from `specular_color` at low weight), shader-ball row.
- Cloth consumes ch 1,3,5,6,8,14,15 (`18` §3) — metallic/emission/opacity rules per selection.
Proof: cloth furnace ≤ 1 (retroreflective peak allowed >1 *directionally*, albedo ≤ 1);
velvet/felt ball renders; selection test covers Cloth entry/exit with retained channels.

✅ **SHIPPED.** Cloth = parameter forcing in `ResolveLayers`, not a second evaluator: EON diffuse
(same `P1.y` roughness lane as ever) + LTC sheen as primary + weak dielectric GGX
(F0 = `specular_color` × f0(η) ≈ 4 %, MS-compensated per `18` §9), aniso forced out; coat/haze/
/metal/spec-weight are structurally 0 under Cloth so their guarded blocks skip untouched (Pdf/Sample
need NO changes — forcing flows through `ResolvedLayers`). `SheenLut.w` = true Charlie albedo
(Gauss–Legendre product rule, φ-halved, +~60 ms bake); cloth-only rescale E_c/R ∈ [0.5, 2], always
* toward* truth, rescale·R ≤ 1 per texel and per lerp (proven, not hoped). `ReflectanceConsumes`
moved into `MaterialEvaluation.slang` (one source of truth, CPU-tested 1:1); Cloth arm += opacity.
Per-selection rules, verified against Sultan's `ReflectanceIntegrator.cpp`: emission stays additive
under ALL selections (their ambient recording writes it unconditionally — consumption governs
reflectance only), metallic is 0 under Cloth (structural via derivation), opacity retained (cutout
works). Entry gains `HazinessWeight == 0` (hazy fuzz → Standard, nothing silently dropped);
priority cloth > aniso kept (sheen kept, aniso dropped — furnace ⑦ proves the drop bit-inert).
Furnace: ① ≤ 1 (velvet + felt, white), ② retro ordering + velvet grazing signature (sheen weight
×3.4–98.6 grazing/normal, analytic), ③ cloth sampling ±3 %, ④ per-lobe reciprocity (LTC asymmetry
< 1.6 on a Fibonacci grid — pre-existing fit artifact, worst at grazing pairs; true Charlie is
reciprocal), ⑤ weak F0 exactly 0.04 + non-cloth collapse intact, ⑥ rescale end-to-end 0.5 % both
regimes, ⑦ aniso bit-inert, ⑧ branch live by selection; table proof (ranges + rescale·R ≤ 1 ∀
texels); full 8×16 consumption matrix; coverage entry/exit/retention. Balls 25–26 (`velvet_cloth`
= exact control for `velvet_fuzz_10` differing ONLY in specular weight, `felt_cloth` at fuzz 0.9;
luminaire → 27) — user re-exports `--scene shaderball` and renders GPU-side. NO layout change
(`Selection`/`SheenRescale` are stack-local). Deliberately untouched: thin-film (selection-
-independent extension), Unlit+emission interaction, EON roughness source (stays `P1.y`).

### M4 — Transmission / refraction (the big one)
Files: `MaterialEvaluation.slang` (BTDF: Walter et al. GGX transmission, VNDF sampling over
the *transmission* hemisphere with η = `specular_ior`, exact-dielectric Fresnel split,
Beer–Lambert absorption from `transmission_color` × `transmission_depth` or thin-wall
thickness; `EvaluateBsdf`/`SampleBsdf`/`PdfBsdf` extended to wi.z < 0 with the η² reciprocity
form; thin-walled = single-slab analytic, thick = enter/exit pair), `ReSTIRViewport.slang`
(bounce refracts: relax the `dot(bounceDir,hitNormal) > 0` gate for transmissive; RIS target
uses full BSDF incl. BTDF; shadow rays accumulate Beer tint through transmissive hits,
bounded 4 steps, then opaque), `SurfaceResolve.slang` (Transmission debug view), codecs
(thickness_texture → ch9/ch17 path — shared with M5).
- M4a thin-walled glass/foil/feather-translucency; M4b thick glass + absorption; M4c
  dispersion hero-sampling (optional, default off, `transmission_dispersion_*` already stored).
Proof: glass-slab furnace = 1.0 (R+T); η²-reciprocity test; Beer-vs-depth analytic test;
Cornell-glass proof scene (sphere + pane + area light); tinted-shadow test; perf: glass
pixels ≤ 2× Simple cost (gated lobe).

### M5 — Subsurface / SSS
Files: `MaterialEvaluation.slang` (v1: thickness-wrap backlight —
`subsurface_color` × exp(−thickness/radius) added at direct lighting, no new ray; v2:
Christensen–Burley dipole sampled at the GI bounce with thickness from ch17 ×
`subsurface_radius_scale`), `ReSTIRViewport.slang` (v2 bounce branch; SSS participates in
throughput, never spawns its own reservoir), codecs (M6: thickness/attenuation sources).
- v1 ships first (wax/jade look, ~free); v2 behind the `Subsurface` selection + complexity
  Special. Random-walk interiors explicitly out.
Proof: SSS energy ≤ 1 (albedo test); backlit-thickness gradient analytic test; shader-ball
SSS row (skin/wax/jade); dipole sampling-consistency test.

### M6 — Codec gap-fill (interchange for the new channels)
Files: `MaterialCodec.cpp` (+ `.h` if new `slate_*` keys), glTF fixtures, round-trip tests.
- From the M0 audit: close whatever of `KHR_materials_{specular,ior,dispersion,sheen,
  clearcoat,anisotropy,transmission,volume,emissive_strength}` is missing; map
  `thicknessTexture` → subsurface thickness; FBX/OBJ best-effort (diffuse→base,
  transparency→transmission_weight, shininess→roughness inversion — documented, lossy);
  `extras.slate_*` round-trip for non-glTF scalars (established R4b-3 pattern), incl.
  `slate_direct_f0_weight` (D-f0).
Proof: per-extension fixture round-trips byte-stable where native, extras-stable otherwise.

### M7 — Material inspector UI (the material editor surface)
Files: `Engine/DisplayPresentation/MaterialInspector.{h,cpp}` (new, ControlKit patterns),
`ControlCentreHost` tab wiring, `ConfigurationRegistry` keys (`material.selected`,
`material.preview`).
- M7a read-only: selected material's selection + all 20 channels (value/source/texture),
  complexity, slab count, fold report; F-panel hook. M7b editable: constant editing +
  selection switch (channels retained per `42` §5) + cutout threshold + live `Finalise` and
  accumulation reset; shader-ball preview hook (reuse `--scene shaderball`).
- Sultan `56` paint layers are out of scope; sources covered: Constant / Imported / Absent.
Proof: UI walkthrough on Sponza materials; edit→re-Finalise→re-render loop test (headless);
selection-switch retention test.

### M8 — Tier B decision + full-scene validation
- Decide with data: keep Tier A + fold (recommended unless a scene needs true 2-slab) or
  evaluate 2 slabs in-kernel. Either way: Sponza + Cornell + shaderball + glass-proof at
  `slab_limit` 1/2/8, fold-report review, perf budget (§6).

### M9 — Re-enable milestone (denoiser + motion vectors back on)
- Re-enable `Denoise` and `TemporalReprojection` (defaults back to true); validate the new
  lobes under temporal + spatial reuse + à-trous (revalidation re-evaluates the BSDF — must
  pick up BTDF/SSS automatically); A/B proofs (converged image identical with and without);
  sky-backed outdoor glass proof.

## 5. How each channel meets ReSTIR (integration points, all phases)

| ReSTIR site | What changes | Notes |
|---|---|---|
| RIS target `p̂ = f·L·cosθ/d²` | full BSDF incl. BTDF + SSS-v1 term | Transmissive candidates sample lights *behind* the surface — uniform triangle pick + MIS already handles it; no new sampler |
| Reservoirs (M/W/Age) | **unchanged layout** | Target-function-only change; validity/revalidation logic untouched |
| Temporal/spatial reuse (01a0a578) | free via BSDF re-evaluation | DI reservoirs re-evaluate the target at neighbours — new lobes ride along; verify in M9, no Jacobian needed for DI |
| Shadow rays | cutout re-trace (exists) + transmissive Beer-tint walk (M4, ≤4 steps) | Tinted shadows, not binary; thin-walled never flips the offset |
| GI bounce | refract (M4), dipole branch (M5), SSS-v1 in throughput | The `dot>0` gate becomes selection-aware; one bounce stays one bounce |
| Background | black until M9 | sky in-tree since the merge; glass proofs use sky and/or area-light Cornell scenes |
| Accumulation/denoise | lobes are per-sample; reuse + à-trous agnostic | No per-lobe history; BTDF noise converges like specular |

## 6. Budgets and gates

- Perf: non-transmissive pixels unchanged (gating is fetch-skipping, M1 proves identity);
  glass ≤ 2× Simple, SSS-v2 ≤ 1.5×, at 1080p on the 1060; kernel ms in the F3 popup per phase.
- Proofs per phase: white-furnace (R+T=1 for glass), η²-reciprocity, sampling consistency
  `E[f·cosθ/pdf]`, all in the `FRONTIER_CPU_PORT` harness on the *same* `.slang` text
  (established R4b discipline) + one shader-ball row + one proof scene each for M4/M5.
- Records: one layout bump only (landed M2, not M1: M1 shipped with no layout change;
  M2 appended `Slate2`, 288→304 B); std430 mirrors + `static_assert` updated same-commit;
  the append sits after the float prefix so `kSlabFloatCount` stays 58 (plan said 58→59 —
  wrong guess, prefix untouched).

## 7. Order of work

M0 audit → M1 selection/gating → M2 sampled channels → M3 cloth → M4a thin glass →
M4b thick glass → M5 SSS v1 → v2 → M6 codecs → M7a inspector → M7b editing → M8 Tier B
call → M9 ReSTIR-sync. M6 can interleave any time after M0. M4c dispersion only if M4a/b
come in under budget.

## 8. Open decisions for you

- **D1 — branch strategy:** (a) stay on `01a0aa50`, keep material files cherry-pick-clean,
  sync at M9 *(recommended)*; (b) cherry-pick `01a0a578`'s ReSTIR+sky first, build on top
  (bigger upfront port, prettier glass proofs sooner); (c) full merge of `01a0a578`
  (not recommended — drags the editor/sky/ocean transplant + 429-file restructure).
- **D2 — scope order:** (a) ReSTIR-critical first — M1+M2+M4+M5, then cloth/codecs/editor
  *(recommended)*; (b) strict doc order M1→M7; (c) shading only, no M7 editor UI.
- **D3 — SSS depth:** (a) v1 wrap now, v2 dipole next *(recommended)*; (b) straight to dipole;
  (c) skip SSS, transmission only.
- **D4 — M7 editor:** (a) read-only inspector now, editing later *(recommended)*;
  (b) full editable in this phase; (c) no UI work.
ull editable in this phase; (c) no UI work.
