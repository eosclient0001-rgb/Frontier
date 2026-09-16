# Material Proofs Report — GREEN

Date: 2026-09-16 · Branch: `arena/01a0aa50-slate` · Gate: `bash Exhibits/Workbench/Materials/CheckMaterialsProof.sh`

The gate compiles the two dependency-free CPU proofs with the system compiler (no Vulkan, no submodules) and
runs them with a fixed splitmix64 seed, so every number below is **deterministic** — re-running the gate
reproduces this transcript bit-for-bit (full logs: `/tmp/MaterialsProof.coverage.log`,
`/tmp/MaterialsProof.furnace.log`).

**Score: 3,548 furnace checks + 110 coverage checks, 0 failures.**

---

## 1. Coverage proof — the plan §0 table as code (110/110)

Proves the CPU `MaterialIndex` (records, flags, fold/mix, channel×stage registry) matches the plan. Highlights:

- **Record mirror** — 58-float descriptor prefix memcpy-identical into the slab record; 16/16 texture
  slots + uvsets; thin-walled bit, rotation lane, reserved-lanes-zero; record is 304 B with pinned offsets.
- **Flags + complexity** — plain→Simple, coat→Single, transmission→Special, 2 slabs→Complex.
- **Retention (Sultan-42 §5)** — `Finalise` never mutates the descriptor (unread channels retained).
- **Flatten** — 3→1 folds two, top coat/rotation carried down, fractional mix at limit 2, Weight/Coverage ops.
- **Channel × stage registry** — 19 wired-or-partial, 1 acked gap (verbatim):

```
01 base colour           record=WIRED resolve=WIRED     shaded=WIRED(EON) restir=WIRED
02 metallic              record=WIRED resolve=WIRED     shaded=WIRED(F82) restir=WIRED
03 roughness             record=WIRED resolve=WIRED     shaded=WIRED      restir=WIRED
04 reflectance/IOR       record=WIRED resolve=WIRED     shaded=WIRED(F)   restir=WIRED(refl)
05 orientation           record=WIRED resolve=WIRED     shaded=WIRED      restir=WIRED
06 occlusion             record=WIRED resolve=WIRED     shaded=floor-only restir=n/a(path)
07 emission              record=WIRED resolve=WIRED     shaded=WIRED      restir=WIRED
08 opacity               record=WIRED resolve=WIRED     shaded=cutout     restir=cutout
09 anisotropy            record=WIRED resolve=WIRED     shaded=WIRED(GGX) restir=WIRED
10 anisotropy direction  record=WIRED resolve=WIRED     shaded=WIRED(rot) restir=WIRED
11 clear coat            record=WIRED resolve=WIRED     shaded=WIRED      restir=WIRED
12 coat roughness        record=WIRED resolve=WIRED     shaded=WIRED      restir=WIRED
13 coat orientation      record=WIRED resolve=WIRED     shaded=WIRED(frame) restir=WIRED
14 sheen colour          record=WIRED resolve=WIRED     shaded=WIRED(LTC) restir=WIRED
15 sheen roughness       record=WIRED resolve=WIRED     shaded=WIRED(LTC) restir=WIRED
16 subsurface colour     record=WIRED resolve=WIRED     shaded=WIRED(wrap) restir=WIRED
17 subsurface thickness  record=WIRED resolve=WIRED     shaded=WIRED(ray) restir=WIRED
18 transmission          record=WIRED resolve=WIRED     shaded=WIRED(BTDF) restir=WIRED
19 IOR (refraction)      record=WIRED resolve=WIRED     shaded=WIRED(Snell) restir=WIRED
20 displacement          record=ACK:M6-none resolve=ACK:M6-none shaded=ACK:M6-none restir=ACK:M6-none
```

- **Selection** — all 8 reflectance selections + priority (transmission beats coat, cloth beats aniso),
  M3 cloth entry/exit/retention, emissive lamp stays Standard.

## 2. Furnace proof — `MaterialEvaluation.slang` compiled 1:1 as C++ (3556/3556)

The shader under test is `#include`d as C++ through `SlangCpuShim.h`, so these numbers are the shipped
shading code, not a model of it. Tables are baked fresh each run (32×32, 1024 spp/cell).

### EON diffuse — furnace vs analytic, ceiling, multi-scatter floor

```
ok EON r=0 == Lambert at mu=0.05/0.30/0.60/1.00 (0.50000 ×4)
ok EON furnace r=0.5 mu=0.25 num=0.4888 ana=0.4902 | mu=0.60 num=0.4768 ana=0.4764 | mu=1.00 num=0.4670 ana=0.4670
ok EON furnace r=1.0 mu=0.25 num=0.4827 ana=0.4818 | mu=0.60 num=0.4563 ana=0.4564 | mu=1.00 num=0.4390 ana=0.4390
ok EON never exceeds rho (6/6) · ok EON MS floor (6/6)
```

### GGX + Kulla–Conty (white F0) — single-scatter vs table, compensated = 1

```
r=0.15: ss=0.9703/0.9992/0.9996 vs table, compensated E=1.0015/1.0010/1.0001
r=0.55: ss=0.8888/0.8209/0.8747 vs table, compensated E=0.9993/1.0000/1.0006
r=1.00: ss=0.7604/0.4500/0.3057 vs table, compensated E=0.9957/0.9925/0.9873
```

The Kulla–Conty compensation restores unity even at r=1.0 (worst 0.9873, within the ±0.02 furnace tolerance).

### Fuzz bound + coat stack — sheen albedo grid + stack ceiling

- 100/100 sheen albedos ≤ 1 over (a × μ) grid; worst R = 0.7307 (a=0.9, μ=0.02, grazing).
- `coat+fuzz+base stack albedo ≤ 1 (mu=0.3 E=0.5184, mu=0.8 E=0.4194)`.

### Reciprocity — Helmholtz, exact to float noise

```
ok EON reciprocal (worst 1.19e-07) · ok GGX single-scatter reciprocal (0.00e+00) · ok Kulla–Conty reciprocal (0.00e+00)
```

(Coat stack excluded by design — a tilted coat frame is not a reciprocal configuration.)

### Sampling consistency — E[f·cosθ/pdf] reproduces the furnace

```
ok VNDF E[f·cos/pdf]=0.9811 table=0.9801 · ok CLTC E[f·cos/pdf]=0.4620 ana=0.4623
ok mixture E[f·cos/pdf]=0.5208 furnace=0.5204
```

### M2 aniso rotation + coat frame

```
ok aniso equivariance (worst 4.79e-06)
ok aniso energy θ=45° (0.5187 vs 0.5190) · θ=90° (0.5191 vs 0.5190)   ← rotation preserves energy
ok rotated mixture E[f·cos/pdf]=0.5203 furnace=0.5198
ok rotated specular reciprocity metal=0/1 (worst 2.80e-06 / 2.75e-06)
ok tilted coat albedo ≤ 1 (0.4234 / 0.3765 / 0.4027 / 0.3774)
ok coat continuity 2° (0.3868 vs 0.3844) · ok tilted-coat mixture E[f·cos/pdf]=0.3812 furnace=0.3813
```

### M3 Charlie bake + rescale safety — all 1024 texels in [0,1]

```
1024/1024 texels E_c ∈ [0,1] (min 0.0000, max 1.0000)
max E_c=1.0000 max R=0.7497 max rescale·R=1.0000 clamps hi=433 lo=21
```

### M3 consumption matrix — 128/128 (8 selections × 16 channels)

Every selection consumes exactly its documented channels — the wiring the renderer branches on.

### M3 cloth path — velvet signatures + LTC-sheen closure

```
ok cloth albedo ≤ 1 (1.0064 / 1.0002 / 1.0031 / 1.0004)          ← ≤ 1.01 tolerance (MC noise)
ok sheen lobe retro-ordered (0.1368 > 0.1161 > 0.0998)
    retro=0.3015 side=0.1603 fwd=0.0893 → ok cloth stack retro-dominant
    grazing/normal sheen weight ×98.6 / ×3.9 / ×3.4 → ok velvet signature (fuzzR=0.35/0.65/0.80)
ok cloth mixture E[f·cos/pdf]=0.6759 furnace=0.6755
ok weak-GGX reciprocal (2.71e-06) · ok EON reciprocal (1.17e-07)
ok LTC sheen asymmetry bounded (grid-worst 1.24 — documented fit artifact, grazing-driven)
ok cloth eta unmodulated (1.5) · cloth F0 = 0.04 · rescale matches bake · layer weight = F·rescale·R
ok sheen E[f·cos/pdf]=0.04188 albedo=0.04189 / 0.24519 vs 0.24532  ← sampler reproduces albedo
ok cloth spec
ok cloth specular alpha isotropic · aniso basis identity · aniso+angle bit-inert under Cloth
ok cloth ≠ standard by selection (rel 1.23e-01)
```

### M4 single-interface BTDF — η² reciprocity + R+T bounds + smooth anchor

```
ok eta2 reciprocity ior=1.1/1.5/2.0 worst-rel-diff=1.17e-07/9.77e-08/0.00e+00 (~4500 pairs each)
ok R_ss+T_ss ceiling/floor r=0.15 mu=0.5 E=0.9997 Ess=0.9982 · mu=1.0 E=1.0000 Ess=0.9996
ok R_ss+T_ss ceiling/floor r=0.50 mu=0.5 E=0.9600 Ess=0.8579 · mu=1.0 E=0.9921 Ess=0.9147
ok single smooth anchor mu=0.5/1.0 E=1.0000/1.0000   ← G→1, micro→macro: MUST be 1, no tables
ok T-branch dominates smooth glass (19182/20000) · smooth T clusters at Snell (19167/19182)
ok single numeric over-closure E=1.0363/1.0179 + invisible-facet gap=0.0763/0.0257 (mu=0.5/1.0, r=0.5)
ok off-eta bounded ior=1.1/2.0 E=0.9627/0.9558 (single-eta approx: bounded, not tight)
```

The `R+T=E_ss` equality was REJECTED by data+theory (transmitted rays bend toward the normal and shadow
less, +4–12% at rough-oblique) and replaced by the rigorous ceiling + empirical floor above.
The numeric bounds pin the invisible-facet mass (opposed-facet T + underside-facet R — see the T_ms note).

### M4 thin-wall compound — sampling, Beer, smooth limit, weight sweep

```
ok thin-wall E[f·cos/p]=0.9596 Ess-split=0.9608 (r=0.15)   ← theory exact to 4 digits smooth-ish
ok sampler ceiling/floor r=0.15 E=0.9596 · r=0.50 E=0.9434 (split=0.8747, T-shadows-less excess)
ok exit-TIR trap rate sane (rej=0.000 / 0.012)
ok numeric cross-check sampler=0.9434 furnace=0.9421 (r=0.50) · numeric ≤ 1 · trap-loss floor
ok thin-wall smooth anchor E=0.9602 split=0.9612 (r=0.08, no tables)
ok f/p identity G₁(−d1)·(1−F_x)·Beer on all 6 pairs (to 5 digits, with σ + thickness)
ok smooth thin glass transmits (18792/20000) · antipodal (18764/18792)
ok clear-glass throughput 0.9596 vs 0.9616
ok Beer T-only, 3 channels × 3 depths, ratios match exp(−σt) to ≤0.003 (nT≈110k each)
ok weight sweep sw=0/0.25/0.5/1: sampler E=1.0012/0.9889/0.9788/0.9592, all ≤ 1.01
ok tw sweep tw=0/0.25/0.5/0.75/1: numeric E=0.0399/0.2746/0.5037/0.7175/1.0722 (tw=1 sees wall-level invisible mass)
ok weight-0 film invisible (E=1.0012) + straight-through (19607/19607)
ok u.w dead when opaque (2000/2000 bitwise) · metal kills the transmit mix · metal transmits nothing
```

Caught & fixed this run: the glass-side inversion passed −d1 where Walter's ht takes the outward
direction d1 — f/p self-consistent but jointly wrong (+30% at r=0.5). Proven by Riemann ∫f·cos +
sampler-vs-pdf histogram (all 10 |cos| bins match to MC noise after the fix).

### M4b solid glass — single-interface entry/exit + slab walk + Beer (SHIPPED 2026-09-16)

```
ok solid-entry E=0.9833/0.9931 + gap=0.0425/0.0143 (mu=0.5/1.0 — EON fills underside-R + grazing-T)
ok solid-exit E=0.8238/0.9434 (TIR-regime tracks Ess=0.8579; Enum=0.8468/0.9564, gap=0.0230/0.0130)
ok solid-exit smooth anchors E=1.0008/1.0005 (mu=0.5 all-TIR, mu=1.0 sub-critical — both MUST be 1)
ok slab clear T=0.8362/0.9234 R=0.1636/0.0766 (mu=0.5/1.0 — closed form incl. internal series, 4 digits)
ok slab tinted T=0.355/0.537/0.733 R=0.103/0.120/0.147 (mu=0.5) · T=0.461/0.645/0.829 R=0.050/0.058/0.070 (mu=1.0)
ok slab Beer sweep depth=0.5/1/2 T=0.4763/0.6452/0.7675 (the T(σ) curve through the −ln/depth resolve)
ok rough-slab E=0.7834/0.9607 + trapped≈0 (TIR-loop shadowing + reachable-only drops compound at oblique)
ok slab trapped=2.5e-4/1.5e-9/0/0 (rare smooth-TIR-loop; Beer-decayed when tinted; exact 0 at normal)
ok single f/p identity entry+exit to 6 digits (exit: 5 pairs, 3 TIR-skips — T = 0 exactly there)
```

Solid mode = tracer context, not material data: `ResolvedLayers` gains `SolidInterface` + `IncidentIor`
(stack-local, no layout change; foil defaults keep every legacy path bit-identical — the furnace log
diffed byte-for-byte before/after). The R Fresnel follows the relative eta (TIR-aware from inside);
thin-film gates to outer surfaces; Beer lives tracer-side over true segments (doubling it in the BSDF
would double-count). v1 limits: one medium (nested transmissives shade R-only), no refracted NEE
(interior vertices take 0 light samples — power-heuristic weight exactly 1, still unbiased), coat /
fuzz / diffuse ride along approximately at interior hits (the solid exhibits are bare glass).
Caught & fixed this run: the exit-TIR floor guess (0.90) was wrong — TIR energy tracks the F0 = 1
albedo (E = 0.8238 vs Ess = 0.8579, bounded both sides); and two independent runs of the identical
cosine numeric differ by 0.0105 (Snell-cone D-peak events, weights ~12 — σ_num ≈ 0.007, heavy-tailed),
so the ② numeric/gap upper margins hardened to 3.4σ (1.05→1.06, 0.09→0.10; deterministic today).

### M5 subsurface dipole — C-B transport, exit shape, sampler branch, MIS (v2 SHIPPED 2026-09-16, supersedes v1 wrap)

```
ok dipole CCDF per-channel d (0.786494 0.629368 0.418897) · opaque at r=0 (0/0 guarded) · foil at t=0 (bitwise 1) · miss→0 · scale≤0 opaque
ok front-glow f = mix·ρ·T·6/(5π)·T_exit (0.216301 vs 0.216301)   ← direct-eval, 6 digits, no MC
ok SSS follows the exit-transmission shape (288/288) · SSS view-dependent (288/288 differ — v1 lock superseded)
ok uniform-backlight E = mix·ρ·T·T_exit (0.4964 0.1839 0.0536)   ← per-view exact close, proved not assumed
ok SSS-off below-branch exactly 0 (2000/2000, NaN-poisoned fields untouched) · above stack finite under NaN-poison
ok metal kills the SSS mix · metal scatters nothing below
ok dielectric albedo SSS-blind (bitwise) · diffuse ×(1−w) partition (200/200) · specular SSS-blind (200/200 bitwise)
ok coat scale non-vacuous (0.0533) · coated SSS takes the exit scale (200/200)
ok dipole mass positive (0.9167) · lands below at wSss (0.9182 vs 0.9167) · pdf = wSss·|cos|/π (2000/2000 bitwise)
ok SSS-off pdf 0 below (2000/2000 bitwise) · SSS-off sampler never lands below (20000/20000, v1 negative kept)
ok mixed T+SSS dipole mass 0 (exclusivity, bitwise) · mixed below-samples are T-real (18816/20000)
ok dipole E[f·|cos|/p] closes (0.4957 0.1836 0.0535) · dipole MIS two-stratum closes (0.4965 0.1839 0.0536)
```

v2 = Christensen–Burley dipole, full lobe: f_sss = mix·ρ·T_dip(t,r,s)·B(μi)·T_exit(μo)·6/(5π), B = (1−μ)/2,
T_dip = ¼e^{−t/d} + ¾e^{−t/3d} (the normalised profile's CCDF at the chord — foil-transparent at t = 0, null
at t = +∞), T_exit(μo) = 1 − F(μo, η) (view-dependent slab exit through the base interface). A uniform
below-hemisphere backlight closes EXACTLY per view (E(wo) = mix·ρ·T·T_exit(μo)); still non-reciprocal
(coat-albedo-scaling class, excluded with it). The sampler gains the dipole branch (5th lobe weight, cosine-below
for pure-SSS mats; mixed T+SSS keeps the T arm owning below by exact-zero exclusivity — no flag needed, the
dipole eval rides along in f); the opaque-below rule is selection-aware. The exhibit consumes dipole-virtuals
by translucent see-through (skip non-emitters, bound 4, then environment — the BSDF-sampled twin of the
light-sampled NEE-below, meeting in MIS); the kernel kills virtuals (its K5 light-stratum owns SSS-direct —
collecting both without MIS would double-count; kernel MIS is M9+). v1's wrap is fully superseded (SssBeer /
SssWrapBacklight removed — git keeps them); v1's ③ view-independence lock is deliberately replaced by the
exit-shape lock. Bonus fix: v1's NEE-below ran at MIS 1, which silently double-counted mixed T+SSS (the T
stratum also sampled below) — v2's two-strategy MIS closes that hole. Thickness stays the tracer-side per-hit
chord (reused unchanged, open-plane rule intact); r·s ≤ 0 stays opaque (the r = 0 limit is Lambert, not foil).

## 3. Known gaps (acknowledged, by design)

- ~~**T_ms**~~ TERMINATED 2026-09-16 (implemented, measured, reverted — SS-only is minimax-optimal). The full
  story: a second lobe WAS built (M(μ,α) baked into `Energy.w`, S(μo)·S(μi)·η²/(π·Q) shape, η²-exact to 1e-7,
  ①b MS-decomposition identity proven) — then killed by measurement. The T-sampler covers only VNDF-reachable
  wi (p_T = 0 where wo·ht < 0); the D·G lobe form assigns ~6.8 % to unreachable wi (opposed-facet T +
  underside-facet R — the η²-required |wo·m|·|wi·m| symmetry FORBIDS gating it out, and any μo-dependent
  normaliser breaks the η² exchange too). Rendering energy is therefore environment-dependent: BSDF-only
  paths see E ≈ 0.96 while a furnace environment (NEE covering unreachable wi at MIS weight exactly 1) sees
  E_num ≈ 1.036 (gap 0.0763 at r=0.5/mu=0.5, 25σ). A uniform second lobe adds to the over-end 4× faster than
  to the under-end (reachable fraction ≈ 0.23) — SS-only spread [0.959, 1.028] (centre 0.993) beats SS+MS
  [0.968, 1.064] (centre 1.018) on width AND centring. Kept from the expedition: the numeric over-closure +
  invisible-mass bounds (block ②), the eta sweep (②c), the tw sweep (④b). Sheet re-rendered bit-identical
  (sha unchanged — the BSDF is back to its pre-expedition bytes).
- ~~**M4b thick glass**~~ SHIPPED 2026-09-16 (was mislabelled M9 in this report — plan-M9 is the denoiser /
  motion-vector re-enable, still parked per direction). True enter/exit + Beer over true segments + full
  internal series, slab-analytic to 4 digits; thin-vs-solid diptych kept below.
- ~~**M5 subsurface v1**~~ SHIPPED 2026-09-16: thickness-wrap backlight (eval-only) + furnace normalisation /
  gate proofs + backlit SSS quad exhibit (opaque-red ref + skin/wax/jade). v2 dipole queued (view-dependent,
  reuses the chord exit finder). Kernel slab-resolve deferred to the kernel milestone (K5 below); the kernel
  carries SSS-off defaults (branch-gated, behaviour-free).
- ~~**Exhibit BVH corruption**~~ CAUGHT+FIXED 2026-09-16 (M5): `BuildBvh` held a node reference across
  `emplace_back` — `root.Right` was silently lost (capacity 1→2 realloc) and half the scene (the y>0 half:
  backfaces + the blue/fill/backlight softboxes) was invisible to every ray. Camera rays only ever needed
  frontfaces so no sheet showed it; M4b's "open mesh / numeric leak" fallback was actually firing on the lost
  back-half (the mesh audits closed to a 3-edge crack). Fixed (index-based child assignment) + an always-on
  BVH audit (reachable-tris == total, else exit 1). ALL kept sheets re-rendered (brighter honest indirect —
  half the lights were missing from bounce rays); M4b's thin-vs-solid numbers below are SUPERSEDED (recomputed
  post-fix).
- **Kernel milestone backlog** (shared-file work has outrun the kernel — it needs its own milestone WITH a
  slangc compile story first, else flying blind again): K0 get slangc (no binary in the sandbox — every
  `.slang` kernel edit since M2 is compile-unverified); K1 `ReSTIRViewport:1233` passes vec3 to `SampleBsdf`'s
  vec4 (M4-signature fallout — likely a compile error); K2 `m.Transmission*` never defaulted in the kernel's
  `ResolveMaterial` (garbage-read UB); K3 below-horizon bounce gate + NEE-below for T; K4 M4b medium-stack
  tracing; K5 SSS/ch9 resolve + thickness raycast + the open-plane thickness rule.
- **M6 displacement** (channel 20, acked as none).
- **Denoiser + motion vectors** — parked by direction; after the material system, not inside it.
- ~~R-below-horizon mixture~~ DONE 2026-09-16 (block ①c): transmissive keeps below-horizon R/EON/coat samples
  with the full-mixture pdf (degenerate half-vector at wi = −wo guarded — old code NaN'd there). Post-fix
  analysis showed rejection was unbiased all along (the T-sampler covers every below-wi), so this was variance
  recovery, not a bias fix — confirmed: closures unchanged to 4 digits, exhibit cloth/coat panels bit-identical,
  0.14 % of glass pixels shifted. Opaque still exactly 0 below / rejects below (regression-guarded).

## 4. Visual exhibit — shaderball sheet (kept in `Exhibits/Gallery/Materials/`)

`ShaderballSheet_GlassClothCoat.png` (1544×512): the CC0 shaderball (Pseudopode/UnityShaderBall,
15,554 tris) path-traced on the CPU through the same `MaterialEvaluation.slang` the furnace proves —
thin-wall glass (rough 0.06, η 1.5) · deep-red velvet (fuzz 0.65) · clearcoat car paint — under a
3-softbox studio rig. 256 spp/panel, BSDF sampling + NEE with power-heuristic MIS, ACES + gamma 2.2,
row striping with per-(panel, frame, pixel) seeds: **deterministic, byte-stable under regeneration**
(`sha256 f84f6ac3…40358`, canonical `-strip` compression; re-rendered after the ①c polish; re-rendered
again for M4b — bit-identical; re-rendered for M5's BVH fix — brighter honest indirect; re-rendered once
more when the fill light was nudged out of frame — see below).

`ShaderballSheet_SolidGlass.png` (1028×512 thin-vs-solid diptych, `sha256 45cb1069…61c4fb`): the SAME
clear-glass bytes as the triptych's glass panel, once as foil (skip-ball) and once traversed as solid
(entry refraction + Beer + exit refraction/TIR + TIR bounces). Traversal isolated: linear means thin
0.2845 vs solid 0.3230 (≈230σ apart — Δ = 0.0385 vs SEM ≈ 1.7e-4), per-pixel RMSE 0.118, 0 non-finite
pixels. (M4b's numbers — 0.1913 vs 0.1886, RMSE 0.058 — are SUPERSEDED: the BVH bug leaked most solid
exits through the missing back-half, so solid rendered near-transparent and ≈ thin; with real exits the
solid panel runs BRIGHTER (TIR bounces collect the previously-missing lights). A throwaway tinted probe
(not kept) confirmed Beer-over-true-distance in the exhibit loop (green solid vs clear thin).)

`ShaderballSheet_Subsurface.png` (2060×512 SSS quad, `sha256 4af6d23e…9a8e672`): opaque-red reference
(byte-twin base of skin — subsurface isolated) + skin (r = 0.45, red-shifted MFP scale (1, 0.37, 0.3)) + wax
(r = 1.0, spectrally neutral) + jade (r = 0.25, green) under the studio rig plus an out-of-frame tungsten
backlight high behind the ball. The v2 dipole fires through TWO below-strata in MIS — the light-sampled
NEE-below (no occlusion test: the chord transport replaces visibility) and the sampler's dipole branch
(consumed by translucent see-through: skip non-emitters, bound 4, then environment). Thickness stays one
inward raycast per SSS hit, miss ⟹ transport 0 (open-plane rule). Linear means ref 0.3493 · skin 0.3173 ·
wax 0.5515 · jade 0.2744, 0 non-finite pixels. v1's means (0efad7fc…: 0.3493/0.2686/0.3345/0.2531) are
SUPERSEDED — the dipole CCDF tail transports far more than single-exp Beer at t/d ≳ 1 (wax nearly doubles),
and the exit transmission reshapes every view; the ref panel reproduces 0.3493 exactly (SSS-off paths are
bit-identical by construction — same proof the triptych/solid SHAs verify at the file level). Caught & fixed
this run (v1): a 1/Pl firefly ridge along the backlight's silhouette locus (the MIS-less below-stratum can't
bound CosL→0+ — both NEE strata now take a 1e-3 grazing-epsilon (a ~0.06° sliver, ≈1e-6 of solid angle — bias
negligible); and the BVH fix revealed the fill softbox grazing 4px in-frame in every sheet (nudged out,
all re-rendered).

- Kept-sheet linear means: glass 0.2845 · cloth 0.1723 · coat 0.1707 · solid 0.3230 · sss ref 0.3493 ·
  skin 0.3173 · wax 0.5515 · jade 0.2744 · 0 non-finite pixels.
- Harness `Exhibits/Workbench/Materials/ShaderballExhibit.cpp` + driver `RunShaderballExhibit.sh`
  (build → smoke → full render; not part of the gate — the sheet is ~5 min).

## 5. Kernel integration — K0–K5 (SHIPPED 2026-09-16, compile-verified, render pending GPU)

`ReSTIRViewport` never compiled post-M4 (K1) and read garbage transmission state (K2). All fixes are
CPU-mirrors of furnace-proven code, gated so opaque paths are bit-identical by construction.

- **K0 compile story.** No SDK in the sandbox (Vulkan SDK / slangc / glslc all absent; release-asset egress
  blocked). `glslang` built from source (KhronosGroup/glslang @ 31b9aac, cmake+ninja from PyPI) — the same
  frontend `glslc` uses. All 13 CMake-table shaders lower to SPIR-V clean (`-V --target-env vulkan1.2`,
  same `-D`/`-I` as the build). Note: the files are pure GLSL dialect (`#version 460`); the CMake `slangc`
  path passes no `-source glsl`, so it cannot lower them — the `glslc` path is the working one.
- **K1** call-site: `SampleBsdf` takes `vec4 u` (u.w seeds the M4 R/T branch) but got `vec3` → hard error
  (negative control: reverting one site fails with `no matching overloaded function found`).
- **K2** transmission/SSS: the `ShadingRecord` transmission quartet was never set (garbage `TransmitMix`).
  Defaults added, then the full slab resolve — P3.yzw/P4 (weight × `kChannelTransmission.x`, colour, depth)
  and P6/P7 (SSS weight × `kChannelSubsurface.x`, colour, radius, scale) were already resident, zero CPU
  change. Limits: thickness is not in the slab (foil Beer = 1); scatter/dispersion/anisotropy v1-out.
- **K3** below-horizon transport: `|cosθ|` throughput (was signed — negative for T-samples), ray-side ray
  offset, above-horizon gates dropped on bounce escape/hit. Primary-DI-below deliberately deferred (variance
  only — T-direct converges via the bounce; touching the reservoir unverified was the bigger risk).
- **K4** medium stack: `ThinWalled` from `SlabFlags` bit0 (P14.z) → solid entry (one-step refraction),
  `enteredSolid` carry (below-horizon exit, EON/coat-below included — CPU-mirrored), interior Beer over the
  true segment, exit override (`IncidentIor` = entry eta), embedded-transmissive R-only (v1 no-nesting),
  interior NEE skip (shadow rays treat glass as opaque), nominal-Thickness miss fallback, firefly clamp 8.
- **K5** SSS: ch9 = K2's resolve (verified indices); `SssChord` inward raycast per hit (SSS-gated, double-sided
  traversal catches backfaces); **open-plane rule**: a chord with no exit misses → t = 1e30 → Beer 0 (no volume
  behind an open sheet — the arm goes dark, correctly); below-stratum NEE (primary + endpoint, sun + lamps,
  NO shadow ray — chord Beer is the visibility; interior-SSS future work).
- **Honest scope.** Compile-verified only — no GPU in this sandbox, so no kernel frame has rendered; the
  render-verification (glass pane through-path, solid-ball exit, wax backlight) is pending a GPU runner. The
  T/SSS paths are line-mirrors of CPU code the furnace + kept sheets prove, but in-kernel they are UNRENDERED.

## 6. What's next

1. ~~**M5 subsurface**~~ DONE 2026-09-16 (v1 wrap shipped, superseded by the v2 dipole — see 3).
2. ~~**Kernel milestone**~~ DONE 2026-09-16 (K0–K5 shipped, §6; render-verification pending GPU).
3. **M5 v2 dipole** (view-dependent, reuses the chord exit finder; deliberately updates the ③ lock). ← NEXT
4. **M6 codec gap-fill** (thickness/attenuation sources, transmission/volume round-trips).
5. **Denoiser + motion vectors** (parked per direction).
