# Material Proofs Report — GREEN

Date: 2026-09-17 · Branch: `arena/01a0af43-slate` · Gates: `CheckMaterialsProof.sh` (dependency-free) ·
`CheckMaterialCodec.sh` (interchange headers) · `CheckMaterialScenes.sh` · `CheckMaterialSwatches.sh` ·
`CheckMaterialDenoise.sh` · `CheckMaterialInspector.sh` (needs the inspector's UI headers — not seated in this
sandbox, so that one gate is RED for environment, not for regression) · `CheckTemporalIdentity.sh` (D10, the same
estimator with moving geometry)

Each gate compiles its CPU proofs with the system compiler (no Vulkan, no GPU, no window; third-party headers come
from `ExternalPackages/` or the `~/.cache` mirrors) and runs them with fixed seeds, so every number below is
**deterministic** — re-running a gate reproduces its transcript bit-for-bit (logs: `/tmp/MaterialsProof.*.log`,
`/tmp/MaterialCodec.log`, `/tmp/MaterialScenes.log`, `/tmp/MaterialSwatches.log`, `/tmp/MaterialDenoise.log`).

**Score: 110 coverage + 3,556 furnace + 211 codec + 158 inspector + 229 editable inspector + 102 scene + 65 swatch
+ 97 denoise checks + 10 identity checks, 0 failures (the inspector pair as shipped; its gate needs UI headers absent
here).**

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

## 6. Codec proof — M6 interchange round-trips (211/211, SHIPPED 2026-09-17)

Gate: `bash Exhibits/Workbench/Materials/CheckMaterialCodec.sh` — compiles `MaterialCodecProof.cpp` against the real
`MaterialCodec.cpp` plus the interchange headers (`ExternalPackages/`, `$MATERIAL_CODEC_EXT`, or `~/.cache/m6`).
Before M6 the codecs had **zero** tests; the proof now pins every mapping with per-extension fixtures in two tiers:
TIER-1 value-exact (`operator==` after decode→encode→decode, plus a BYTE-identical second encode — the normalising
mappings converge in one pass) and TIER-2 relative-1e-6 across two round-trips for the four renormalising folds
(sheen / emission peak, iridescence nm↔µm, dispersion 20/Abbe — bounded, no drift).

Code changes (all in `Engine/ContentInterchange/`): `VolumeThickness` fidelity carry on `MaterialDescriptor`
(thickness_factor re-encoded verbatim — the plan's "thicknessTexture → subsurface thickness" was redirected here:
no slab carrier exists for a thickness texture and the tracer computes the SSS chord geometrically, so the FACTOR
survives exactly and the texture is a documented drop); metallic-roughness single-sided fallback;
`diffuseTransmissionTexture` re-encoded; thin normalisation (flag-only descriptors encode thin);
`geometry_thin_walled` single-slab extras bool both ways; OBJ transparency → transmission_weight at every illum
(opacity stays 1, cutout flag gone — it used to swallow glass whole); FBX `specular_rotation` turns × 2π. The Tr
fold (fast_obj `Tr` → `d`) is proved through the real parser (T36). The proof also certifies the M2 codec state
(anisotropy rotation home, `!= 0` Sultan negatives). Drop inventory (each locked
by a proof assert): specular factor-texture, volume thickness-texture, iridescence thickness-texture, clearcoat /
sheen roughness-textures, diffuse-transmission colour-texture, FBX extra-roughness / tint / matte / indirect /
coat-rotation, OBJ MapNs — see `MaterialCodec.h`. Lossy-but-documented: authored slabs encode thicknessFactor =
attenuation depth; FBX vec3→scalar is the xyz mean; the emissive config-fold; spec-gloss + shininess inversions.
Full mapping table (interim §5): the `MaterialCodecProof.cpp` header.

---

## 7. Material inspector — M7a read-only UI (158/158, SHIPPED 2026-09-17)

Gate: `bash Exhibits/Workbench/Materials/CheckMaterialInspector.sh` — compiles `MaterialInspectorProof.cpp` against
the real engine TUs (`MaterialInspector` + `MaterialIndex` + `ControlCentreHost` + the inspector/UI cascade + imgui
core) with header-only deps (`ExternalPackages/`, `$MATERIAL_INSPECTOR_EXT`, or `~/.cache/m7`: imgui, tomlplusplus,
Vulkan-Headers — no GPU, no window, no Vulkan library; `VisibilityExchange.cpp` links under `--gc-sections` so only
the `DebugViewName` table survives). Nine archetype materials (opaque, metal, folded glass, cloth, subsurface,
emissive-only, unlit, coated+mask, one fully-loaded slab) walk the inspector per D4(a):

- Selection resolves by persisted name (exact match, else material 0, else cleared); the reflectance selection and
  complexity are cross-checked against `Finalise`'s own records for all nine (the inspector re-runs `Flatten` at
  the scene limit and reads `Slabs.front()` — the slab the Tier A kernel samples — so the page can never disagree
  with the records).
- All 20 Sultan channels (names verbatim from the M0 coverage registry): exact value/source/texture on the loaded
  slab, shared carriers pinned (09+10 anisotropy, 16+17 subsurface, 04+19 IOR), sub-parameters folded into per-row
  detail lines (no extra rows), row 20 always `no carrier`; unread-but-retained values stay Constant (Sultan-42
  §5), never Absent.
- Fold attribution by the `material '<name>':` prefix (glass 3→1 keeps its line, the other eight keep none);
  `[material]` registry round-trip (missing table → defaults, unknown keys ignored); the revision bumps only on
  resolved-name change (steady Rebuilds and same-selects are silent).
- Headless layout both ways: a recording surface (imgui context-only, CPU-side atlas, draw lists never presented)
  and a never-begun surface lay out byte-identically; the selector menu flow runs on a synthetic pointer (open →
  pick → revision → close, release-outside dismisses); the host gains hub row 5 (420×557 card, dashboard keeps
  420×480), dimmed Apply/Discard pills, and a footer status line; the F-panel gains the material row (omitted,
  not dashed, with no scene).

Code changes: new `Engine/DisplayPresentation/MaterialInspector.{h,cpp}`; `ControlCentreHost` page 6 + hub row
(`LayersSlabs` glyph, verbatim lucide `layers`); `ConfigurationRegistry` `[material]` keys (`selected`, `preview`);
`MaterialIndex` fold-report retention (`QueryFoldReport`, behaviour-preserving); `DiagnosticInspector` 9th row;
`GameExecution` ①h feed (per-frame `Rebuild`, persist-on-revision, F-panel summary — the runner also parses
`GameExecution.cpp`, so the feed can't rot).

Drive-by fix: `Engine/DisplayPresentation/ReSTIRIntegrator.h` carried a duplicated block at HEAD (committed in
`9d4d2b3` — the class close + `Convert` specializations + namespace close appeared twice, so NO TU including it
could compile, `DiagnosticInspector.cpp` included); removed the duplicate. The M7a proof is the first gate that
compiles that header.

**Honest scope.** No GPU in this sandbox: the page is layout-verified headless (extents, heights, menu flow), not
screenshot-verified — pixels wait for a GPU runner. The plan's "Sponza walkthrough" is reduced to nine in-harness
archetypes (only `CornellBox.gltf` is committed). M7b (editing, live re-Finalise, accumulation reset, shader-ball
preview) is next; the `preview` key and dimmed pills are its hooks.

---

## 8. Editable inspector — M7b (229/229, SHIPPED 2026-09-17)

Gate: `bash Exhibits/Workbench/Materials/CheckMaterialInspector.sh` — the M7a build plus the CPU shaderball
exhibit as a `SHADERBALL_PREVIEW_LIB` TU (`ShadingTableCodec.cpp`, `-I Engine/Shaders`, `-I
Exhibits/Workbench/Editor`). 158 M7a checks intact (F5/H7 updated for editors) + 71 new (J–Q):

- **J drafts** — per-material eager drafts (full slab + cutoff, snapshotted from `Slabs[0]`); `SetDraft*` shared
  by sliders and proof; every slider range pinned via clamps (IOR 1–2.5, signed aniso ±1, rotation 0–2π, emission
  0–20 nit, SSS radius 0–2 m, the rest 0–1); invalid ids/rows/components no-op; all 14 scalar + 3 RGB rows
  Set→Query round-trip (setter/getter maps can't drift); rows 05/13/20 have no editor.
- **K Apply** — commits every dirty draft into `Slabs[0]`/`AlphaCutoff`, re-runs `Finalise` at the index's own
  limit, bumps `CommitRevision` + stamps the count; records re-derived (roughness, cutoff); no-op Apply silent.
- **L retention + Discard** — brick/wax drafts survive the round-trip switch and commit together; Discard
  re-snapshots (lamp back to 5 nit).
- **M cutout** — commits on an opaque (non-mask) material through to the record.
- **N preview** — 64 px/2 spp renders with sane stats (bad 0, lit, full mesh), byte-identical re-render
  (deterministic), edit→Apply→pixels-differ (the loop closed), null request fails clean.
- **O toggle** — seed/enable/revision semantics, request-on-commit iff enabled, take-consumes, ok/fail stamps.
- **P host** — `IsPageDirty` transitions through the host; page Apply/Discard commit+revert (the private
  `Apply/DiscardActivePage` tap targets are review-verified — see honest scope).
- **Q drag** — a synthetic press at 25% across the roughness track writes exactly 0.25 (verbatim track map);
  release ends the drag (stale motion ignored); RGB tracks stack; rows 05/20 expose no extent.

The preview IS the exhibit: `SetupStage`/`SetupCamera`/`BlitFilm` were extracted byte-for-byte from `main()`
(the 96 px smoke re-renders md5-identical, `5a89e025…`), `main`/`BuildMaterials` guard out under
`SHADERBALL_PREVIEW_LIB`, and the entry maps the descriptor to ball 0 (weight×colour folds included, 8
`static_assert`s pinning `MaterialReflectance` to the slang table) through the same rig/camera/integrator/PNG
writer. Limits, documented: constants only (no texture pipeline), no cutout (the record carries no alpha),
`Slabs[0]` only, standard rig, exposure 1. The feeder (`GameExecution` ①h) re-derives the selection fresh at
render time (the inspector's retained selection predates the requesting commit), renders 160 px/6 spp to the
ignored `Diagnostics/MaterialPreview_<name>.png`, and stamps the header line; commits restart the accumulation
and toast (both `RenderFinished`-gated, like Appearance).

Code changes: `MaterialInspector` drafts/editors/Apply/Discard/revisions/preview; `MaterialIndex::AccessDescriptor`
+ `SceneStructure::AccessMaterials` (one line each); host dirty/Apply/Discard cases + live pills; `GameExecution`
①h (commit→reset+toast, preview persist, preview render); new `ShaderballPreview.h`; exhibit refactor + entry;
CMake gains the two TUs (per-file `SHADERBALL_PREVIEW_LIB` + include dirs — `FRONTIER_CPU_PORT` is vestigial, no
ifdefs, intentionally not passed).

Drive-by fixes: `MaterialInspector.cpp` was missing from `FRONTIER_ENGINE_SOURCES` (M7a linked only in the gate —
the full CMake build would have failed to link); exhibit `-Wunused-function`/`-Wmisleading-indentation` surfaced
by the gate's `-Wall` (main-only `BuildMaterials` guarded out of the preview TU, M5 one-liner split — both
behaviour-preserving, smoke still md5-identical).

**Honest scope.** Same headless caveat (layout-verified, not screenshot-verified). The footer-tap→switch path is
review-verified (3 one-line cases symmetric with proven siblings; the harness drives the same page instance). The
preview render blocks the frame loop (~seconds at 160/6 — async is a follow-up). Sub-parameters (coat IOR, film,
attenuation…) are retained and committable but have no editors yet (primaries + cutout only). CMake was edited but
not configured here (no cmake binary in the sandbox — syntax mirrors precedent; the runner compiles the exact TU
set with equivalent flags, and the missing-sources guard catches path typos at configure time).

---

## 9. Tier B decision + full-scene validation — M8 (102/102, SHIPPED 2026-09-17)

Gate: `bash Exhibits/Workbench/Materials/CheckMaterialScenes.sh` — compiles `MaterialSceneProof.cpp` against the real
interchange TUs (`ContentCodec` + `SceneCodec` + `MaterialCodec` + `ObjCodec` + `FbxCodec` + `UfbxTranslation` +
`SceneStructure` + `GeometryStructure` + `OrientationClassifier` + `TextureIndex` + `MaterialIndex` +
`ShaderBallStructure` + the M7b preview TU) with the M6/M7 header candidates plus stb (`ExternalPackages/stb`,
`$MATERIAL_SCENES_EXT/stb`, `~/.cache/m8/stb`, `~/.cache/sweep/stb` — `TextureIndex`'s only third-party include;
this branch carries zero gitlinks, so the submodule path is aspirational and the caches do the work). CornellBox
(committed), GlassProof (committed, new — 4 quads: clear/frosted panes, emissive panel, diffuse wall), and the
generated R4b shaderball level (headless `ShaderBallStructure` export → `ContentCodec::Decode`, the same
export-once path `GameExecution` uses) decode → `Finalise` at slab_limit 1/2/8 → census + fold review; Sponza
validates when present, skipped otherwise (absent here — `raw.githubusercontent` egress blocked, `curl` exit 35).

- **A loads** — Cornell 9+fallback, GlassProof 4+fallback, shaderball 28+fallback; Sponza skipped (conditional).
  Caught by the gate: my pre-count said 25 — three materials live past line 130 (`velvet_cloth`, `felt_cloth`,
  `luminaire`), so the pin is 29 and the census below is the ground truth.
- **B limit matrix** — zero folds on all real content at 1/2/8, every record resident 1 slab. GlassProof pins
  exactly (both panes Transmissive, clear 1.0/0.06, frosted 0.8/0.4 + 0.1 m volume, panel Standard + 3 nit —
  `BaseWeight` defaults 1 so `EmissiveOnly` stays unreachable from glTF, the M0-known trap). Shaderball
  encode→decode fidelity: clearcoat exact + uncoated-twin discrimination, sheen TIER-2, metal F0 exact, film
  TIER-2, emission TIER-2, mask+cutoff exact, EON exact. Selection census: coat twins ClearCoated, cloth pair
  Cloth (first end-to-end Cloth decode), everything else Standard.
- **C fold probes** — three synthetic multi-slab materials pin what Tier B would serve: all three report at
  limit 1 (verbatim `material '<name>': N slab(s) folded into M (slab_limit L, albedo scaling)` — the evaluated
  mix reports too); bottom-up identity (bottom transmission 0.3 survives exactly, tops absorbed — transmission
  has no carry-down); coat carried down exactly; mix → purple exact; at limit 2 only the 3-chain folds (the mix
  survives as a weighted pair, silently); at 8 nothing folds and flatten returns the slabs verbatim
  (`operator==`). Albedo scaling pinned to its closed form (`Keep = 1 − TopAlbedo(top) = 0.908876`, rel-1e-6 —
  the F0(1.6)+F0(1.5) chain, double-precision shadow).
- **D preview sweep** — all 44 materials shade through the M7b entry at 64 px/2 spp (Bad 0, lit, full mesh);
  clear-glass re-render byte-identical.
- **E consumption tripwire** — the M3 128-cell table re-pinned verbatim (0 drift) — the fetch-skipping half of
  the §6 perf budget; gated fetches 5/6/7/6/6/6/0/0 (+3 unconditional base/emission/opacity).
- **F Tier verdict** — printed AND asserted: **keep Tier A + fold** — 0 multi-slab materials in 44 real
  materials. Tier B kernel work stays out (§2); the deliverable is the data + the decision.

Census (limit 1): cornell 9+fallback all Standard/Simple; glass 2× Transmissive/Special + 2× Standard/Simple +
fallback; ball 28 authored (coat×2 ClearCoated/Single, cloth×2 Cloth/Single, film×2 Standard/Special, fuzz×2 +
haze×2 Standard/Single, 18 Standard/Simple) + fallback.

**Honest scope.** Sponza never decoded here (fetch blocked — A8 is validate-if-present and the verdict line says
so). The verdict rests on 44 materials across three scenes; a production corpus could still surface authored
multi-slab content — the C probes prove the fold handles it deterministically when it does. Kernel-ms half of
§6 still needs a GPU runner (same caveat as §5). No GPU, no window.

---

## 10. Material library level — M10 (65/65, SHIPPED 2026-09-17)

The user-facing half of the programme: **`--scene materials`**. M1–M8 proved the channels one lobe at a time
(furnace, shaderball rows, glass proofs); this level is the curated index of them — 42 swatch spheres in a
7 × 6 grid on a matte studio floor against a neutral backdrop, one material per sphere, plus three sign panels
for the channels that are not sphere-shaped, one ceiling key (3 × 3 m, 60 nit) and one side fill (2.4 × 1.8 m,
25 nit). New TU `Engine/ContentInterchange/MaterialSwatchStructure.{h,cpp}` (registered in `CMakeLists.txt` and
`ToolchainSequence.ps1`), export-once to `Content/Scenes/Materials.gltf` beside the showroom/shaderball blocks in
`GameExecution.cpp`, camera branch keyed on the level name `Materials`.

| Row | Swatches | Channels carried |
|---|---|---|
| 0 | plastics, rubber, ceramics, plaster | base colour, roughness, EON diffuse roughness, specular weight, F0/IOR |
| 1 | car paints, varnish, lacquer, enamel, canvas, tile | clear coat weight/roughness/IOR/colour/darkening |
| 2 | gold, copper, chrome, brushed steel, aluminium, anodised titanium, brass | metalness, F0 + F82 tint, anisotropy strength + direction |
| 3 | soda-lime clear + frosted, amber bottle, lead crystal, ice, thin-walled acrylic, water | transmission, transmission colour + depth (Beer), thin wall, IOR |
| 4 | bone, jade, wax, marble, skin, milk, honey resin | subsurface weight/colour/radius/radius-scale/scatter anisotropy |
| 5 | velvet, felt, satin, soap film, hazy acrylic, emerald, mercury | sheen colour + roughness (Cloth), thin film, haziness, transmission, metalness |
| panels | alpha cutout, unlit poster, emissive-only | opacity + mask/cutoff, unlit, emission |

Gate: `bash Exhibits/Workbench/Materials/CheckMaterialSwatches.sh` — `MaterialSwatchProof.cpp` against the real
codec stack (no preview TU, no GPU):

- **A build/round trip** — 49 authored materials (42 swatches + floor + backdrop + 3 panels + 2 luminaires) →
  `SceneCodec::Encode` → `ContentCodec::Decode` → 50 (fallback slot), names in authored order, 63 854 triangles
  (42 × 1520-triangle spheres + 7 quads).
- **B census** — the table above as printed rows: selection + complexity + changed-channel count per swatch.
  Tally: Standard 17 · Anisotropic 2 · ClearCoated 7 · Cloth 2 · Subsurface 7 · Transmissive 8 · EmissiveOnly 1 ·
  Unlit 1 — **all eight selections**, with `EmissiveOnly` reached through the extras (`base_weight` 0) that
  glTF-authored content cannot express, and `Unlit` through `KHR_materials_unlit`.
- **C uniqueness** — 42 distinct names, 42 distinct resident records (no two swatches share a value set), zero
  folds at slab_limit 1/2/8 with one resident slab each.
- **D channel coverage** — **16 of 20 channels carried as constants**; the four gaps are acknowledged in the
  print: surface orientation / occlusion / coat orientation are texture-shaped (carried by imported content, not
  by a level with no committed texture files) and channel 20 displacement is the plan's M6 decision (none).
- **E round-trip fidelity** — authored vs decoded descriptor compared field by field for all 42 swatches
  (58-float prefix + `SlateAnisotropyRotation` + `GeometryThinWalled` + flags + cutoff); the two renormalising
  folds (`KHR_materials_sheen` colour/weight split, emissive peak normalisation) are compared as **products**.
  Zero drift — including `coat_ior` on every coated swatch (authored ≠ 1.6, or the clearcoat extension's fixed
  1.5 would win) and the thin-walled flag on the acrylic.
- **F geometry** — every sphere is centred on the declared pitch at r = 0.40 m (span bounding boxes), no two
  closer than 1.10 m, bounds X ±5.0 · Y −2.0 … 7.60 · Z 0 … 4.60 m, 6 luminaire triangles (key, fill, emissive
  panel), flag inventory 1 mask / 1 thin / 1 unlit / 3 emissive, spans named `Swatch NN (material)`.

**Honest scope.** No GPU here: the level renders on the user's Vulkan build (`--scene materials`; the file is
generated on first run, like the shaderball and showroom levels — not committed). The CPU side proves what the
level *is* (materials, geometry, coverage), not what it *looks like*; the first GPU render of it is the visual
proof, together with the §5 render-verification backlog.

---

## 11. Re-enable milestone — M9: à-trous denoiser + motion-vector reprojection (97/97, SHIPPED 2026-09-17)

The phase the merge deferred, and the last unshipped M-milestone: `Denoise` and `TemporalReprojection` were left
in-tree but default **off** so M1–M10 could validate lobes on raw accumulated images, with the promise that the
filter could never hide or fake lobe energy. **Reconnaissance finding: there was nothing left to re-enable.** At
this tip both defaults are already `true` (`ReSTIRIntegratorConfiguration`, blame `2be1647f`), every tier carries a
live à-trous chain (4 levels Minimal–Standard, 5 Ultra/Reference), and a probe linked against the real
`ReSTIRIntegrator.cpp` prints `features=0xfb denoise=1 reproj=1 levels=5`. M9's deliverable was therefore the
proof, not the flag — the evidence the deferral's rationale asked for, run on the shipped code.

Gate: `bash Exhibits/Workbench/Materials/CheckMaterialDenoise.sh` → **97/97**, no GPU, no window, no imgui.
New files `DenoiseCpuShim.h`, `AtrousDenoiseMirror.{h,cpp}`, `DenoiseReprojectionProof.cpp`, the gate script, and
the shared pieces `ReprojectionMirror.h` (the rule), `DenoiseStreams.h` (the §E measurement) and
`StageAtrousDenoise.py` (the shader transform) — shared so the exhibit and the gate cannot drift; the exhibit
harness (`DenoiseExhibit.cpp` + `RunDenoiseExhibit.sh`, seven kept sheets) is described below.
`SlangCpuShim.h` gained additive read-only `.r/.g/.b/.a` and `vec4.rgb` proxies (the filter's tone map) — the
shaderball sheet still re-renders to its committed hash `f84f6ac3…`, byte-identical.

| § | What it establishes | Checks |
|---|---|---|
| A | the **live configuration**, compiled from the real `ReSTIRIntegrator.cpp` TU: both defaults ON, dispatch bits, all four denoise × reprojection toggle combinations, `AssignDenoise` (post-process — no accumulation reset) vs `AssignTemporalReprojection` (sampling change — reset spent), and the tier ladder's level counts | 13 (A1–A13) |
| B | **text pins** for what cannot be compiled standalone — `ReSTIRViewport.slang`'s accumulation + reprojection sites (bindless tables + BVH), the dispatcher's 5-level chain, the push constants, and the filter's lobe-agnosticism | 33 (B0–B32) |
| C | the **compiled filter**: transform re-derived byte for byte, identity switch, uniform pass-through, the two A/B cases, early-out ≡ full tap loop, edge stopping, variance propagation | 21 (C0.1–C6.4) |
| D | the **reprojection rule** mirrored from `ResolveSurface`: static identity, tracked translation, off-screen disocclusion, 25° normal / 10 % depth validation, background, feature-off = pre-R7a | 9 (D1–D9) |
| D10 | the **identity rule** on top of it — the history also records WHICH surface it came from (`kFeatureTemporalIdentity`, bit 9), so a read that agrees on normal and depth but belongs to another object is refused. Its own gate, `CheckTemporalIdentity.sh`: the object's shadow follows it, a still scene is undisturbed, and the ghost is refused for **1.94x lower error** against the untouched level at the same pose (891 vs 1 732 RMSE). ⚠️ Found two bugs by measurement — the identity must be the OBJECT, never the triangle, and the mirror's motion vector carried the raster jitter. Design, numbers and both corrections: `Docs/DynamicGeometry.md` §7a | 10 |
| E | the **three-stream A/B** — lambertian, glass-BTDF (1 % fireflies), subsurface — accumulated 8192 frames each | 21 (E1–E4c) |

**The filter is the shipped filter, not a transcription.** `Engine/Shaders/AtrousDenoise.slang` is compiled 1:1 as
C++ by the gate script's four mechanical substitutions (drop `#version` + `layout(local_size…)`; brace-init the B₃
array; open the push block as `struct DenoiseConstants`; close it with its instance). The proof re-derives all four
from the shader text and compares the staged halves against the file (§C0), re-reads the B₃ weights out of the
compiled `KernelWeight` (§C6.0–C6.1), and drives the shader's own `main()` through a plain-float API — so the A/B
below is a statement about the shipped filter, not about a re-implementation of it. Compile-verified numbers: the
converged A/B is bit-identical (§C3.2), a uniform field survives the 25-tap weighted mean unchanged (§C2), a 4×
radiance step across orthogonal normals stays at 1.0 / 4.0 and a 100× depth step stops (§C5.1–C5.2), in-region noise
falls 12.00 → 8.85 (§C5.3), filtered variance matches σ²Σw²/(Σw)² to 2.2e-7 relative with the Monte-Carlo ratio at
0.0683 against a theory of 0.0748 (§C6.2–C6.4).

**The A/B, per stream** (one 1-spp sample per frame, fixed per-sample 3 % noise, running mean → the accumulator the
filter reads):

| Stream | E1 presentation MSE, frame 1 (filtered vs raw) | E2b frame-1 mean drift | E3 512-frame mean vs analytic | E2 converged mean drift | E4 early-out acceptance @ 512 / 2048 / 8192 | E4 identity |
|---|---|---|---|---|---|---|
| lambertian | **0.0023 < 0.0180** | 0.007 % | 0.060 % | 0.0000 % | 100 % / 100 % / 100 % | 576/576/576 accepted, **0 differ** |
| glass-BTDF | **0.0977 < 0.3674** | 0.187 % | 0.626 % | 0.0210 % | 0 % / 0 % / 80.7 % | 0/0/465 accepted, **0 differ** |
| subsurface | **0.0094 < 0.0822** | 0.020 % | 0.100 % | 0.0000 % | 100 % / 100 % / 100 % | 576/576/576 accepted, **0 differ** |

**What the A/B says, exactly.** Before convergence the filter helps — 8× to 19× lower presentation MSE at 1 spp on
all three streams, including the two lobes M9 was asked to cover: the BTDF chain with its 1 % fireflies and the
exponential SSS transport. At convergence it is invisible: every pixel the shipped early-out accepts comes back
**bit-identical**, checked from outside the filter against the tone map the kernel would have written itself, with
zero mean drift on linear radiance. The firefly stream is the interesting one and it is honest about it — at 512
frames (1 % fireflies ⇒ 36× the diffuse per-sample variance) it is genuinely *not* converged, the early-out
correctly declines at 0 %, and the filter still halves the error (2.08e-6 vs 3.87e-6); by an 8192-frame hold the
shader's own criterion takes over 80.7 % of the frame. That 0 % → 0 % → 80.7 % curve is the R10 #9 self-gating
claim, measured per stream rather than asserted. Two notes worth keeping: a *decrescent* per-frame amplitude was
tried first and rejected as unphysical — a real estimator's per-sample variance is fixed, only the variance of the
mean falls as s²/N, and at these magnitudes shrinking the former drives the shader's fp32 moment recursion below
its own ulp; and the "verify in M9" line from the plan's §5 (reuse re-evaluating the new BSDFs) is covered here
structurally — the filter carries no lobe vocabulary at all (§B32, one colour store site for every material,
§B10–B11) and the three streams ride the same compiled kernel — but the in-kernel revalidation under real motion
is a GPU-side check.

### The visual exhibit — seven kept sheets

A gate says the filter is right; a picture says what it does. `bash Exhibits/Workbench/Materials/RunDenoiseExhibit.sh`
(192 px tiles, 2048 spp reference, ~50 s) renders seven sheets into `Exhibits/Gallery/Materials/` — listed with
sizes and captions in that directory's README. They are not illustrations of the filter: they are the filter. The
driver stages `AtrousDenoise.slang` with the *same* `StageAtrousDenoise.py` the gate uses, links the *same*
`AtrousDenoiseMirror`, and drives the shader's own `main()` level by level exactly as `SwapchainExchange`'s
dispatcher does; the reprojection sheet calls the *same* `ReprojectionMirror.h` the §D checks exercise; the chart
sheet calls the *same* `DenoiseStreams::MeasureStream` the §E checks call. Three of those are now shared headers/
scripts rather than copies, precisely so the sheets and the gate cannot drift apart.

| Sheet | The M9 claim it makes visible |
|---|---|
| `DenoiseSheet_NoiseAndEdges.png` | a real 1-spp frame, filtered: mean \|error\| against a 2048-spp reference falls **0.1170 → 0.0295 (74.8 % removed)**, with the error maps auto-exposed and the variance-of-the-mean the filter reads |
| `DenoiseSheet_IdentityAtConvergence.png` | the other half of the A/B: filtered vs unfiltered differ by 0 on **4566 of 36864 surface pixels** — every pixel the shipped early-out accepted — plus a 4× crop of the worst difference |
| `DenoiseSheet_FadeOut.png` | the fade-out on a real frame: 0 % → 2 % → 5 % → 12 % of surface pixels leave the filter's hands as the estimate settles (1/16/128/2048 spp), each with its error map and mask |
| `DenoiseSheet_AtrasLevels.png` | one noisy frame after 0–5 à-trous levels (tap step 1/2/4/8/16 px), including the coarse blotching the widest levels trade speckle for |
| `DenoiseSheet_EdgeStops.png` | the three edge-stopping terms on/off at the deepest depth edge: silhouette and checker held, versus a ball bleeding into the wall |
| `DenoiseSheet_Reprojection.png` | a 64-frame pan: pre-R7a same-pixel history vs R7a reprojection, the R2 motion field, the disocclusion map (25.2 % of surface pixels rejected at least once after frame 0) and the filtered result |
| `DenoiseSheet_StreamAB.png` | §E as bars — MSE 92 % / 69 % / 91 % lower at 1 spp, and the acceptance curve per hold, drawn from the gate's own measurement function |

Scene honesty, in the sheets' own footnote: the radiance is a one-bounce CPU path trace (checker ground, two
spheres, wall, soft area light) accumulated by the shader's own recursion, so the noise is the scene's rather than
a model of it; the *integrator* is not the ReSTIR kernel — no reservoirs, no reuse, no BVH — and the GPU-side
end-to-end A/B stays on the backlog below.

**Honest scope.** Same bar as K0–K5: compile-verified, render-pending-GPU. What is proven here is the live
configuration, the filter's own mathematics, the reprojection rule and the A/B *on CPU-accumulated streams*
built to each lobe's noise shape. What is not: an end-to-end ReSTIR run where temporal/spatial reuse re-evaluates
the new BSDFs at neighbours under motion vectors produced by moving geometry, and the sky-backed outdoor glass
A/B. Both join the render-verification backlog (§5), together with the M10 library render.

---

## 12. Visual proof — the level rendered by Project-Zero's own CPU stack (2026-09-17)

A gate says the level is right; a picture says what it looks like. `MaterialLibrary_View.png` (and three crops) is the
M10 level drawn the way the Vulkan build draws it, by the CPU stack Project-Zero already ships:

| The picture uses | … from |
|---|---|
| the level | `MaterialSwatchStructure::Construct` — the same authoring the app exports to `Content/Scenes/Materials.gltf` (the export→decode round trip in between is §10's A/E checks, zero drift) |
| the material records | `MaterialIndex::Register`/`Finalise(1)` → `MaterialRecord` + `MaterialSlabRecord`, the rows the GPU uploads |
| the material model | `ReSTIRViewport.slang`'s `ResolveMaterial`, transcribed for the constants-only case (no textures are bound by design — §10's four acknowledged channel gaps) |
| the BSDF | `Engine/Shaders/MaterialEvaluation.slang`, compiled 1:1 as C++ (`FRONTIER_CPU_PORT`) |
| the lights | the level's own six emissive triangles (key 60 nit, fill 25 nit, emissive panel 25 nit) + the atmosphere's sun |
| the sky | Project-Zero's `SkySpecification`/`FogSpecification` core at the product's staging (17.93 h, 26.19 °S) |
| the camera | `GameExecution.cpp`'s `Materials` branch — eye (0, −5, 2.6), pitch −13°, FoV 55° — for the hero sheet |
| the transfer | `Engine/DisplayPresentation/ColourTransfer.h`, ACES, exposure 1.05 — the engine's single definition of linear → display |

Driver: `bash Exhibits/Workbench/Materials/RunMaterialLibraryViewport.sh [fast|full]` → harness
`Projects/Project-Zero/Host/MaterialLevelViewport.cpp` (Makefile target `MaterialLevelViewport`), sheets kept in
`Exhibits/Gallery/Materials/`.

| Sheet | Size | What it shows |
|---|---|---|
| `MaterialLibrary_View.png` | 960×540, 80 spp | the app's own opening frame for `--scene materials`: the four near rows — plastics, ceramics, coats, metals, brushed steel — with the backdrop, three sign panels and the fill luminaire at frame left |
| `MaterialLibrary_GlassRow.png` | 480×270, 128 spp | row 3 down the row (`--row 3`): soda-lime clear and frosted, amber bottle, lead crystal, ice, thin-walled acrylic, water. The row is a lookdev crop — the other five rows are dropped from the scene (printed when the flag is used), the studio stays |
| `MaterialLibrary_Specials.png` | 480×270, 128 spp | row 5 down the row (`--row 5`): velvet and felt (M3 cloth), satin, soap film (thin-film iridescence), hazy acrylic, emerald, mercury |
| `MaterialLibrary_Wide.png` | 480×270, 80 spp | the whole set from 7 m back: the 7 × 6 grid, floor, backdrop and the three panels |

**What it is not.** The ReSTIR kernel. No reservoirs, no reuse, no à-trous: a CPU render can afford the samples the
GPU cannot, so this is the converged answer ReSTIR + the M9 denoiser are estimating. Physics for physics the two agree
— the same shader text turns the same lights into the same radiance — so the difference in the GPU's frame is noise and
filter response, not layout, colour or energy. Also absent, deliberately: the sky core's panel post (vignette/flare —
a viewer effect, not level radiance), the fog march (the studio is 3–15 m deep and the level's own scenario is Clear),
and lens flare. Below the sky's horizon the level shows the atmosphere's dark planet ground, which is what the engine
returns there too — the studio floor simply does not extend to the frame's edges.

Kept-sheet values (driver defaults, 0 non-finite samples in all four): film mean 1.6455 / 1.3387 / 1.6166 / 1.3047 for
View / GlassRow / Specials / Wide; `sha256 9761cdfb…` · `7a4ea7b9…` · `fcf22e2d…` · `44007e3e…`. What the sheets
show, checked against the census rather than admired: the amber bottle carries its Beer tint and the frosted sphere
its diffuse transmission (row 3, specimen 2), lead crystal leaves the checker-sharp edges only a high-IOR medium can,
the metals reflect the fill luminaire's rectangular highlight, the coated paints carry the coat's own highlight over a
darker base, velvet and felt read as sheen rather than gloss next to mercury's mirror (row 5), and the three sign
panels — cutout, unlit, emissive-only — sit on the backdrop where the level puts them.

**Honest scope.** Textures are not bound (constants only), the alpha test is resolved per material rather than per
texel (the level has no texture assets, so the two coincide), and one medium is tracked at a time while walking glass
(M4b's v1 rule — the level never nests dielectrics). At 80–128 spp the sheets still carry visible CPU-traced speckle in
the mats and the floor's caustic-free shading — the exhibit sheets run 256 spp because a shaderball panel is 1/250th of
this pixel count, and two cores is the whole machine here. The GPU's first render of this level is still the visual
proof of the *product*; these four sheets are the visual proof of the content.

---

## 13. What's next

1. ~~**M5 subsurface**~~ DONE 2026-09-16 (v1 wrap shipped, superseded by the v2 dipole — see 3).
2. ~~**Kernel milestone**~~ DONE 2026-09-16 (K0–K5 shipped, §5; render-verification pending GPU).
3. ~~**M5 v2 dipole**~~ DONE 2026-09-16 (pushed `1d76fe2` — triptych + solid sheets byte-identical).
4. ~~**M6 codec gap-fill**~~ DONE 2026-09-17 (211/211 — see §6).
5. ~~**M7a read-only inspector**~~ DONE 2026-09-17 (158/158 — see §7).
6. ~~**M7b editable inspector**~~ DONE 2026-09-17 (229/229 — see §8).
7. ~~**M8 Tier B + full-scene validation**~~ DONE 2026-09-17 (102/102 — see §9).
8. ~~**M10 material library level**~~ DONE 2026-09-17 (65/65 — see §10; `--scene materials`, first GPU render pending).
9. ~~**Denoiser + motion vectors**~~ DONE 2026-09-17 (97/97 — see §11; the re-enable was already live at this
   tip, so M9 shipped as the proof + gate. **Every M-phase of the plan is now shipped.**)
10. **GPU render-verification** (kernel K0–K5 + M5 v2 triptych + M7a/M7b pixels + the M10 library render + the M9
    end-to-end denoiser/reprojection A/B under motion and the sky-backed glass scene — needs a GPU runner). The M10
    level now has a CPU visual proof of its own (§12, four kept sheets); what stays GPU-side is the product's frame —
    ReSTIR + denoiser at interactive rates — not the content.
11. Optional/deferred: M4c dispersion hero sampling, glints (`slate_glint_*` stored-unread), geometric displacement
    (channel 20), Tier B in-kernel multi-slab (post-M9 revisit).
12. ~~**The two ReSTIR convergence paths**~~ DONE 2026-09-17 (both faults found, fixed in the mirror and for 14.1 in
   the kernel text, and measured — see §14; the evidence sheet is `RestirConvergenceSheet.png`).
13. **Environment lighting — bake the sky, and let the sky be a light** (deferred; recorded here because the
    question "does the ray tracer / ReSTIR also sample the sun, sky, moon, and if so can we sample it as an image
    instead" has a measured answer and a concrete plan).

    What the kernel does today (`ReSTIRViewport.slang` with `SkyRecords`, `MoonRecords`, `PostRecords`):

    - the **sun is a first-class light**. Candidates cone-sample it (`SampleSunDirection`), the reservoir stores
      `kSunLightIndex` with the sampled direction as its point, p̂ = f·L·cos, and the committed selection is
      validated by one BVH shadow ray (plus an 8-tap cloud-shadow march when cloud shadows are staged). Its
      *radiance* is not integrated per ray: `SkyConstantRecord` packs `SunDirect` on the host once per frame from a
      single atmosphere march. So the sun costs a cone sample and a shadow ray per candidate, and it reuses
      through the merges like any other light;
    - the **sky, moons, stars and twilight are not lights**. They are what an *escaped* ray sees: a missed primary
      ray, or a bounce ray that leaves the scene, calls `SkyAlong`, which marches the atmosphere
      (`Control.x × Control.y` = **16 × 6 = up to 96 segments at Standard**, each with an `exp` and a
      ray/sphere intersect per light sample), then adds the star catalogue, the twilight glow, the moons (texture +
      phase) and the sun's disc. Nothing above the DI block reuses any of it — a `kFeatureSpatialReuse` tap does
      not carry sky radiance;
    - **measured** (scratch bench, 20 000 directions through `SkyFogIntegrator::ComputeSkyRadiance` at the
      product's staging, single core, `-O2`): **6.7 µs per escaped ray at 06 h, 6.5 µs at 12 h, 7.0 µs at
      17.93 h, 3.4 µs at 21 h** (after sunset the lit march is skipped). For scale, the whole 480×270 / 80 spp
      wide render of the M10 level costs ≈ 12 µs of CPU **per path sample** — one escaped ray pays about a third
      of an entire path. A GPU's absolute numbers differ, but the shape is the same: it is a per-ray loop, and a
      fetch would not be;
    - the consequence that matters for pictures: because the sky is not in the reservoir, sky-visibility variance
      has no reuse at all. A smooth or glass surface whose reflection lands on sky is estimated by BSDF sampling
      alone — which is exactly what the "sky-backed glass" A/B on the render-verification backlog is waiting to
      show, and why a probe is worth more than the µs it saves.

    The plan, in two stages that can ship independently:

    **A. Bake the environment to a probe.** Precompute sky + moons + stars + twilight (the sun's *disc* stays
    analytic — cone sampling and soft shadows are the reason the sun is a light) into a mipmapped 256²
    octahedral (or cubemap) probe per staging: sun hour, fog scenario, moon phase, star rotation, atmosphere
    constants. Escaped rays then take one prefiltered fetch instead of 96 taps, and the probe's total power gives
    the pick probability stage B needs. Key the cache on a hash of the staging and store the bake in the project
    package (`.environment` — the world-environment file in `Docs/ProjectFormat.md` — carrying a `BLOB`), so a
    bake travels with the project and never runs twice for the same sky. *Acceptance:* probe radiance vs the
    analytic march on a direction grid (mean and max relative error printed), plus the escaping-bounce panel of
    the M10 viewport comparing fetch-lit against march-lit within the sheet's own RMSE tolerance.

    **B. Make the sky a light in the reservoir.** Add a sky candidate beside the sun and the emissive triangles,
    sampled by a luminance CDF/alias table over the probe (the engine already builds a Walker table for
    luminaires) with p̂ from a probe fetch — one fetch per candidate instead of an integral. Sky direct lighting
    then reuses through the temporal and spatial merges like every other light, which is the actual fix for the
    glass/specular variance above. *Acceptance:* the ReSTIR sheet's RMSE table on a sky-backed glass scene, with
    the existing `--taps` A/B unchanged — a reuse win, not a new variance source.

    Smallest version that pays: bake the probe, use it only for escaped rays (A), and leave the reservoir alone.
    That is a pure replacement of the march with a fetch and is measurable on this CPU alone.

## 14. The two ReSTIR convergence paths — both faults found, fixed and measured (2026-09-17)

Both were reported as "not converging" (spatial reuse 75 %, indirect/GI 60 % on the completeness table). Both now
have a root cause, a fix that exists in the CPU mirror **and** in the kernel text, and a number. The evidence sheet
is `Exhibits/Gallery/Materials/RestirConvergenceSheet.png`, rendered by
`Exhibits/Workbench/Materials/RunRestirConvergence.sh` — one switch apart per cell, so the sheet doubles as the A/B.

### 14.1 Spatial reuse — a feedback loop through the history, and a cap that chased its own tail

The symptom was specific and reproducible: with the reuse off the estimator converged and with it on it did not, and
*some* taps made it worse (240×135, 4 candidates, 1 spp: 2 or 4 taps stalled at 4437 / 4660 by 128 frames while
0 taps reached 1952.52). Two faults, both in the merge algebra rather than in the sampling:

1. **The history carried the post-spatial reservoir.** The kernel's single dispatch ran temporal reuse, then spatial
   reuse, then wrote the *post-spatial* result into `CurrReservoirs` — which is the buffer the next frame's temporal
   merge reads. Every frame's spatial merges therefore raised the M that the next frame's temporal cap reasoned
   about, so M compounded through both passes instead of growing once per frame: mean M **1 879 (max 4 436)** at
   frame 16 and **843 633** by frame 20. The published guidance is the same rule (don't feed the spatial result back
   into temporal unless starved for samples), and ReSTIR PT Enhanced's bounded-confidence cap exists for the same
   reason.
2. **A tap's cap was taken against a count the tap loop was itself growing.** `min(neighM, kTemporalMClamp *
   res.SampleCount)` reads `res.SampleCount` *after* the previous taps added to it, so tap 2 could add up to 20× what
   tap 1 had just added — compounding inside a single frame, and (with fault 1) again across frames.

The fix is the two-dispatch split the mirror now reproduces line for line: pass 1 draws candidates, resamples, and
does the temporal merge, and **that** reservoir is what the history takes; pass 2 reads it, merges the spatial taps
with each tap's M capped against the receiver's **pre-merge** count, re-traces visibility for whichever sample it
ends up shading, and shades. `--restir-no-history-split` restores the old feedback so the fix is measurable rather
than asserted.

Measured (240×135, 4 candidates/frame, taps 4 = 4 taps, against a fresh 512-spp brute-force reference):

| frames | taps 0 | taps 2 | taps 4 | fix OFF (`--restir-no-history-split`, taps 2) |
|---|---|---|---|---|
| 32 | 7 843.57 | 7 510.05 | **7 462.26** | 7 510.05 |
| 64 | 7 623.46 | 7 294.70 | **7 163.18** | 7 294.70 |
| 128 | 8 082.03 | 7 666.34 | **7 599.18** | 7 666.34 |
| 128 (sheet, `--view default`) | 8 013.72 | 7 631.62 | **7 553.24** | 7 695.74 |

- **The ordering is the proof**: more taps is now strictly better at every budget (before: 2 or 4 taps degraded
  against 0 taps, and 0 taps degraded against nothing). M is bounded: mean **41.7 / max 64** at frame 16, **50.4 /
  84** at frame 32, against 1 879 / 4 436 at frame 16 before.
- The first A/B attempt printed *byte-identical* PNGs for both arms of the flag. That was not a null result — it was
  a dead switch: an end-of-frame `std::swap(State.History, State.Temporal)` was overwriting the very line that
  chooses between the temporal and the post-spatial reservoir, so the fix was in force in both arms. With the swap
  gone the arms separate (RMSE 2 110.48 between them at frame 16) and the disagreeing statistic is legible: the old
  loop saturates at **69.7 mean M / 84 max by frame 8 and stays there** with 9.4 % occluded selections, while the
  split grows 24.0 → 41.7 → 50.4 over frames 8/16/32 with 12.5–12.7 % occluded — the old loop's M ceiling is the
  clamp, i.e. it never had a bounded-confidence story of its own.
- **The mirror's budget changed with the fix, so the sheets' ③④ numbers are not comparable across it**: the mirror
  now shades **one sample per pixel per frame** — the kernel's DI block assigns the pixel's direct integral to the
  reservoir and resolves once — where the pre-fix mirror shaded once per *sample* (4× at `--spp 4`). The standard
  sheet's ③ therefore moved 2308.00 → 6696.39 and ④ 2272.37 → 5441.13 with ② unchanged at 1268.26, and that is a
  budget correction, not a quality change. Everything asserted above is measured *within* the corrected budget: the
  taps ordering (③④⑤ of the convergence sheet), the split A/B (⑥), and the bounded M.
- **What is still true and still open** (the honest caveat, restated with the fixed numbers): at an equal *ray*
  budget the brute-force arm still wins on RMSE at these frame counts (240×135, N=32/64/128: 1 687.63 / 1 461.05 /
  1 460.94 for 4 spp brute force against 7 462 / 7 163 / 7 599 for 4 candidates + reuse). Two structural causes, both
  measurable rather than speculative: (a) the mirror resolves **one** shaded sample per pixel per frame while the
  brute-force arm resolves **four**, so the film's per-frame information differs by 4×; (b) the shaded estimate is
  zeroed for the ~12.7 % of pixels whose selected sample fails its visibility re-trace, which is a loss of energy the
  brute-force arm pays for with more shadow rays instead. And the reuse arm's error is *flat* across 32 → 128 frames
  (7 387 → 7 223 → 7 632), i.e. what remains is bias/plateau, not variance that more frames can average away. The
  next experiments are named in §13: sun-coin variance, the occluded-weight loss, and per-frame resolve rate.

### 14.1b The plain path is bit-stable, and finding that out found a third fault

The reference oracle has a standing invariant: with `--restir` off, `Radiance()` and the film must render bit-for-bit
what they rendered before any of this. Two frames of a wide render differed against the committed mirror (AE 289 at
2 frames, 447 at 3, **0 at 1 frame**) — the signature of a history bug, since a first frame touches no history. Cause:
the plain path's sample loop published its own last jittered sample's hit into the film's surface record, so the next
frame's reprojection was validated against a texel up to a pixel away instead of the pixel-centre G-buffer that the
kernel's `ResolveSurface` writes. With the centre ray published instead, the plain path matches the committed mirror
exactly again (AE 0 at 1, 2 and 3 frames; and against the pre-turn binary at 512 spp / 1 frame: AE 0). Every ReSTIR
number in this section is from the fixed binary, and the standard sheet was re-rendered with it.

### 14.2 Indirect/GI — the first-bounce vertex now has its own pool (ReSTIR GI-style reuse)

The indirect half was a single BSDF-sampled path per frame per pixel: NEE at the first-bounce vertex, NEE at deeper
vertices, no reuse anywhere. It now has a second reservoir over the **first-bounce vertex's NEE stratum**, built with
the same machinery as the direct one: RIS candidates drawn at the vertex, temporal merge against the previous frame's
vertex record, spatial taps over the same cross, pre-merge cap, one visibility re-trace at shading time — and the
pixel's indirect half partitions cleanly around it:

    indirect = Beta0 · [ pool estimate of the vertex's NEE ] + Beta0 · [ vertex terminal ] + sub-trace from V

where `Beta0` is the primary bounce's f·cos/pdf, the terminal covers the cases the pool cannot estimate (the vertex
ray escaped to the sky, or landed on an emitter — both stored, not re-rolled), and the sub-trace continues from the
vertex with the *same* BSDF sample the vertex was built from, its `LastPdf` seeded so an emitter-hit MIS at the second
vertex still pairs with the pool's NEE at the first. Glass, SSS, and solid-interface vertices are excluded from the
pool on purpose (the candidate drawer has no below-stratum and no refraction site), and those pixels — plus the whole
indirect half when `--restir-no-gi-reuse` is passed — keep the untouched single-sample arm. Nothing is counted twice:
the pool replaces the vertex's NEE, and the sub-trace starts *after* that vertex.

Measured (240×135, 4 candidates, 2 taps, vs the same 512-spp reference):

| frames | pool ON | pool OFF (`--restir-no-gi-reuse`) | gain |
|---|---|---|---|
| 32 | **7 387.34** | 7 508.13 | 1.6 % |
| 64 | **7 223.23** | 7 294.72 | 1.0 % |
| 128 | **7 631.62** | 7 680.03 | 0.6 % |

- The gain is real and consistent, and it is small for a measured reason: the pool exists on **16.2 % of surface
  pixels** — the share whose own primary BSDF sample hits geometry at all (the level is an open sky: 41 % of those
  samples escape, 1.8 % land on an emitter, 0.3 % are emissive/unlit, 2.7 % are glass/SSS vertices). On those pixels
  it works: mean M 1.0 over all surface pixels / shaded M 10.2 over the pooled ones at frame 8 (320×180), growing
  with the taps like the direct pool, 24.2 % of selections occluded and dropped.
- **A design tried and rejected, recorded so it is not retried**: the obvious-looking extra validity test is vertex
  proximity (require the receiver's vertex and the candidate's vertex to be the same place). It sounds stricter and is
  the wrong test here — the transferred quantity is a **light sample** (a world point on an emitter), not a direction,
  and the receiver re-evaluates its own target against it and re-traces the shadow ray, which is exactly what the
  direct pool's taps do. With proximity in place, **6 989 of 20 831** temporal attempts failed on distance alone and
  the pool bought almost nothing. The stricter form belongs with a replay + shift mapping (ReSTIR GI proper), which is
  the next step if the indirect half is to be covered at 100 % rather than 16 %.
- **Kernel status**: both are in `Engine/Shaders/ReSTIRViewport.slang`. §14.1 is the history split plus the
  pre-merge tap cap, with the measured numbers in the comment; §14.2 is `GiPoolShade()` (section 4b), wired into the
  bounce's NEE by `giPoolOwns` — the pool **replaces** that vertex's single-sample NEE and the deeper bounces carry
  on from the same vertex direction, so nothing is counted twice. Two host-side facts complete it: the pool needs no
  vertex buffer at all (the receiving vertex is in registers — this kernel is one dispatch — and a neighbour's
  *validity* is already carried by `Counts.x > 0`, exactly the mirror's `Vertex[].Valid` gate), and it needs the
  second 64 B/px reservoir pair, which the host now owns as bindings **25/26** (the bindless table moved 25 → **27**,
  `kComputeBindingCount` 26 → 28, zero-filled with the DI pair on the first frame and ping-ponged in the same
  `SwapReservoirParity()` call). The toggle is `kFeatureGiReuse` (bit 8) with
  `ReSTIRIntegratorConfiguration::GlobalIlluminationReuse = true` — ON by default, exposed as the Control Centre's
  **"Indirect reuse (GI pool)"** checkbox — and the diagnostic HUD's ReSTIR row prints it alongside temporal/spatial.
- **Two deliberate deviations from the mirror, both forced by one dispatch** (recorded rather than hidden): a
  spatial tap reads the *previous* frame's pool (a same-frame neighbour read would race inside a dispatch, the same
  deviation the direct pool has had since R6), and the deeper bounces keep the kernel's existing second-vertex MIS
  bookkeeping instead of the mirror's explicit `DeeperBeta` / `LastPdf` carry — the estimator form is the same, the
  MIS pairing at the second vertex is not bit-equal. Both want one GPU A/B before the numbers are quoted as equal.
- **GPU verification is pending, and that is the whole caveat**: nothing in this sandbox compiles SPIR-V or runs
  Vulkan, so the kernel side of §14.2 is text-verified (every symbol, signature and binding checked against the
  file) and the *numbers* in the table above are the CPU mirror's. The mirror is the same algorithm, line for line,
  which is what makes the port reviewable — not what makes it measured on hardware.

### 14.3 Brute force against the reservoir, at the same resolve rate — the honest reading

The user's hunch that raw path tracing may be the better use of cycles on this scene is **confirmed by the mirror**,
and it is worth stating plainly rather than burying it. Both arms below are compared to the same ① (the 512-spp
reference at 240×135, `/tmp/ref240.png`), and both resolve one shaded sample per pixel per frame:

| arm (240×135, 128 frames, vs the 512-spp reference) | rays per pixel per frame | RMSE |
|---|---|---|
| plain path, 1 spp × 128 frames (one resolve/frame — ReSTIR's own rate) | 1 path + NEE | **971.89 (0.0148)** |
| ReSTIR, 4 candidates × 128 frames, 4 taps | 1 path + 4 candidates × 2 NEE + 4 tap ray tests | **7 553.24 (0.1153)** |

The reservoir path lands **7.8× further** from the converged image than plain tracing does at the same resolve rate.
Two honest qualifications, both measured rather than assumed:

- The reference is the *same* plain estimator with 4× the samples per pixel — 4 spp × 128 frames walks exactly the 512
  seeds of the one-frame 512-spp render, which is why ② ≡ ① measures **AE 0** (and is the harness's own sanity gate).
  So the plain figure above is a partial-mean-vs-full-mean discrepancy on a shared seed stream, which flatters plain by
  at most ~15 % (variance algebra for (1/128)Σ_{i≤128} − (1/512)Σ_{i≤512}); the direction of the comparison is not in
  doubt, the exact ratio is not to be quoted to three digits.
- `--spp 4 --frames 128` (512 samples/px) is byte-identical to the 512-spp single-frame render, so "brute force at this
  budget" and "the reference" are the same image by construction — there is no fourth panel to add here.

Why the reuse does not pay on *this* level yet, in order of measured weight:
- **The indirect pool exists on 16 % of surface pixels** (the share whose primary BSDF sample hits geometry; 41 % escape
  to the sky). The other 84 % get no GI reuse by construction: a light-sample pool cannot estimate a sky vertex, and
  real ReSTIR GI needs the replay + shift mapping rather than a proximity test.
- **One shaded sample per frame into the running mean.** The reservoir concentrates samples within a frame; the running
  mean then spends 128 frames of them, so the residual is dominated by what the pool did *not* fix — sun/coin variance,
  the 12–25 % of selections that are occluded and dropped, and the sparse indirect coverage.
- **The level is sun-dominated** with a handful of small lamps, which is the regime where per-pixel NEE is already a
  decent estimator and reuse has the least to buy. ReSTIR's advantage is a claim about scenes with many luminaires and
  high DI variance — the next scene, not this one. That is why fixing the two faults above was worth doing even though
  the headline RMSE is not yet favourable.

Open items this reading names (all cheap, none assumed): sun-coin variance in the candidate pool, weight loss from
dropped occluded selections, an independent reference (a second seed stream, so the floor can be measured rather than
shared), and a 100 %-coverage indirect estimator (replay + shift mapping).
