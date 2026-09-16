# Material Proofs Report — GREEN

Date: 2026-09-16 · Branch: `arena/01a0aa50-slate` · Gate: `bash Exhibits/Workbench/Materials/CheckMaterialsProof.sh`

The gate compiles the two dependency-free CPU proofs with the system compiler (no Vulkan, no submodules) and
runs them with a fixed splitmix64 seed, so every number below is **deterministic** — re-running the gate
reproduces this transcript bit-for-bit (full logs: `/tmp/MaterialsProof.coverage.log`,
`/tmp/MaterialsProof.furnace.log`).

**Score: 3,451 furnace checks + 110 coverage checks, 0 failures.**

---

## 1. Coverage proof — the plan §0 table as code (110/110)

Proves the CPU `MaterialIndex` (records, flags, fold/mix, channel×stage registry) matches the plan. Highlights:

- **Record mirror** — 58-float descriptor prefix memcpy-identical into the slab record; 16/16 texture
  slots + uvsets; thin-walled bit, rotation lane, reserved-lanes-zero; record is 304 B with pinned offsets.
- **Flags + complexity** — plain→Simple, coat→Single, transmission→Special, 2 slabs→Complex.
- **Retention (Sultan-42 §5)** — `Finalise` never mutates the descriptor (unread channels retained).
- **Flatten** — 3→1 folds two, top coat/rotation carried down, fractional mix at limit 2, Weight/Coverage ops.
- **Channel × stage registry** — 17 wired-or-partial, 3 acked gaps (verbatim):

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
16 subsurface colour     record=WIRED resolve=ACK:M5    shaded=ACK:M5     restir=ACK:M5
17 subsurface thickness  record=WIRED resolve=ACK:M5    shaded=ACK:M5     restir=ACK:M5
18 transmission          record=WIRED resolve=WIRED     shaded=WIRED(BTDF) restir=WIRED
19 IOR (refraction)      record=WIRED resolve=WIRED     shaded=WIRED(Snell) restir=WIRED
20 displacement          record=ACK:M6-none resolve=ACK:M6-none shaded=ACK:M6-none restir=ACK:M6-none
```

- **Selection** — all 8 reflectance selections + priority (transmission beats coat, cloth beats aniso),
  M3 cloth entry/exit/retention, emissive lamp stays Standard.

## 2. Furnace proof — `MaterialEvaluation.slang` compiled 1:1 as C++ (3451/3451)

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
```

The `R+T=E_ss` equality was REJECTED by data+theory (transmitted rays bend toward the normal and shadow
less, +4–12% at rough-oblique) and replaced by the rigorous ceiling + empirical floor above.

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
ok weight-0 film invisible (E=1.0012) + straight-through (19607/19607)
ok u.w dead when opaque (2000/2000 bitwise) · metal kills the transmit mix · metal transmits nothing
```

Caught & fixed this run: the glass-side inversion passed −d1 where Walter's ht takes the outward
direction d1 — f/p self-consistent but jointly wrong (+30% at r=0.5). Proven by Riemann ∫f·cos +
sampler-vs-pdf histogram (all 10 |cos| bins match to MC noise after the fix).

## 3. Known gaps (acknowledged, by design)

- **T_ms** — transmission multiple scattering (≤4% at rough-oblique); needs a second-lobe model + bounds.
- **M9 thick-glass tracking** — solid-glass interior traversal (exhibit renders the honest thin-wall look).
- **M5 subsurface** (channels 16–17) · **M6 displacement** (channel 20, acked as none).
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
(`sha256 2d6ddb48…9e66e2`, canonical `-strip` compression; re-rendered after the ①c polish).

- Kept-sheet linear means: glass 0.1913 · cloth 0.1509 · coat 0.1434 · 0 non-finite pixels.
- Harness `Exhibits/Workbench/Materials/ShaderballExhibit.cpp` + driver `RunShaderballExhibit.sh`
  (build → smoke → full render; not part of the gate — the sheet is ~5 min).

## 5. What's next

1. **T_ms** second-lobe model + furnace bounds — the ≤4% rough-oblique transmission gap. ← NEXT
2. **M9 thick-glass tracking** + solid-glass shaderball panel.
3. **M5 subsurface** (channels 16–17) and its ReSTIR/shaded wiring.
4. **Denoiser + motion vectors** (parked per direction).
