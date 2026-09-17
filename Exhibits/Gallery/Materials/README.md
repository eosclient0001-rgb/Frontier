# Materials gallery — shaderball sheet

`ShaderballSheet_GlassClothCoat.png` (1544×512): the CC0 shaderball path-traced on the CPU with the
proven `MaterialEvaluation.slang` BSDF — thin-wall glass (rough 0.06, η 1.5), deep-red velvet cloth
(fuzz 0.65), clearcoat car paint — under a 3-softbox studio rig. 256 spp/panel, BSDF sampling + NEE
with power-heuristic MIS, ACES + gamma 2.2. Deterministic: re-running the driver below reproduces it
pixel-for-pixel.

- Harness: `Exhibits/Workbench/Materials/ShaderballExhibit.cpp` · driver: `RunShaderballExhibit.sh`
  (smoke + full render; not part of the materials gate).
- Mesh: `shaderball.obj` (15,554 tris after quad split) + `shaderball-CC0-LICENSE.txt` — CC0 1.0
  Universal, Pseudopode/UnityShaderBall, credited with thanks.
- Kept-sheet values (linear means): glass 0.1913 · cloth 0.1509 · coat 0.1434 · 0 non-finite pixels.
- `sha256 2d6ddb48…9e66e2` (2026-09-16 re-render after the below-horizon mixture polish: cloth/coat panels
  bit-identical, 0.14 % of glass pixels shifted by the recovered paths; re-rendered again for M4b — bit-identical).

`ShaderballSheet_SolidGlass.png` (1028×512): thin-vs-solid diptych — the same clear glass as the triptych's
glass panel, once as foil and once traversed as solid glass (M4b medium tracking: true enter/exit + Beer +
TIR). Rendered with `RunShaderballExhibit.sh 512 256 solid` (or `both` for both sheets).

- Kept-sheet values (linear means): thin 0.1913 · solid 0.1886 · 0 non-finite pixels.
- `sha256 b432c15389b62552faa4b523bedddfda062c69956c0073d2a7c74bfb3dcb20ac` (2026-09-16, new for M4b).

## Denoiser sheets — M9 (2026-09-17)

Seven sheets from `bash Exhibits/Workbench/Materials/RunDenoiseExhibit.sh` (defaults: 192px tiles, 2048 spp
reference). They are rendered by `DenoiseExhibit.cpp`, which drives the **shipped** à-trous filter — the real
`Engine/Shaders/AtrousDenoise.slang` compiled 1:1 as C++ and called through its own `main()` — over a CPU
path-traced scene, and the **shipped** reprojection rule (`ReprojectionMirror.h`, the same header the materials
gate's §D checks). Deterministic: same seeds, same pixels, every run; re-running the driver reproduces every sheet
bit-for-bit.

Kept-sheet hashes (2026-09-17, driver defaults): `NoiseAndEdges 877776c6…` · `IdentityAtConvergence caa61b8f…` · `FadeOut 8e3d8964…` · `AtrasLevels 92845f34…` · `EdgeStops 278e6a2c…` · `Reprojection 0663cb06…` · `StreamAB 7fa51d1b…`.

The radiance is a real one-bounce path trace (checker ground, two spheres, wall, soft area light) accumulated by
the shader's own recursion (`ResolveSurface`'s running mean + first two luminance moments), so its per-sample
noise — flat-region speckle, contact shadow, colour bleed, glossy fireflies — is the scene's, not a model of it.
The integrator is **not** the ReSTIR kernel (no reservoirs, no reuse, no BVH, one bounce): these sheets are
evidence about the filter and the reprojection rule, which is what M9 set out to prove. The GPU-side end-to-end
A/B remains on the render-verification backlog.

| Sheet | Size | What it shows |
|---|---|---|
| `DenoiseSheet_NoiseAndEdges.png` | 624×524 | the A/B in one frame: reference (2048 spp) · raw 1 spp · filtered 1 spp, then \|raw − reference\| vs \|filtered − reference\| (each auto-exposed, gain printed) and the variance-of-the-mean the filter reads (log blue→red). Mean \|error\| vs reference: 0.1170 raw → 0.0295 filtered, **74.8 % removed**. |
| `DenoiseSheet_IdentityAtConvergence.png` | 624×480 | the other half of the A/B at 2048 spp: filtered vs unfiltered differ by 0 on **4566 of 36864 surface pixels** — every pixel the shipped early-out accepted — with a 4× crop of the worst difference and the early-out mask. |
| `DenoiseSheet_FadeOut.png` | 828×1012 | raw / filtered / \|filtered − raw\| ×16 / early-out mask at 1, 16, 128 and 2048 spp: the filter's fade-out measured on a real frame — 0 % → 2 % → 5 % → 12 % of surface pixels taken out of its hands as the estimate settles. |
| `DenoiseSheet_AtrasLevels.png` | 624×480 | one noisy 1-spp frame after 0, 1, 2, 3, 4 and 5 à-trous levels (tap step 1, 2, 4, 8, 16 px): the shipped chain's own progression, including the coarse blotching the widest levels trade speckle for. |
| `DenoiseSheet_EdgeStops.png` | 828×305 | the three edge-stopping terms, on/off, same input and same chain, with a 4× crop on the deepest depth edge: with the engine's σn/σz/σl the silhouette holds and the checker stays sharp; flattened, the ball bleeds into the wall. |
| `DenoiseSheet_Reprojection.png` | 624×480 | a 64-frame camera pan (0.012 m/frame, 4 spp/frame): pre-R7a same-pixel history vs R7a reprojection, the R2 motion vectors, the disocclusion map (25.2 % of surface pixels rejected at least once after frame 0) and the filtered R7a accumulation. |
| `DenoiseSheet_StreamAB.png` | 948×669 | the §E statistics as bars — presentation MSE at 1 spp (92 % / 69 % / 91 % lower filtered on lambertian / glass-BTDF / subsurface) and the early-out acceptance curve per hold (512 / 2048 / 8192), drawn from the *same* `MeasureStream` the gate's E1–E4c checks call. |

Headline numbers, all reproducible from the driver: raw 1-spp frame error to reference falls 74.8 %; the
firefly-heavy glass stream is still being filtered at 512 and 2048 spp because it has not converged there (36×
the diffuse per-sample variance) and only past the 8192-sample hold does the shader's own test take over 79 % of
the frame; and at every hold, every accepted pixel is returned bit-identical — 0 differing pixels in all nine
cells of the gate's E4.

## Material library level — the product's own scene, CPU-rendered (2026-09-17)

`MaterialLibrary_View.png` (960×540), `MaterialLibrary_GlassRow.png`, `MaterialLibrary_Specials.png` and
`MaterialLibrary_Wide.png` (480×270): the M10 level (`--scene materials`) drawn by Project-Zero's own CPU stack — the
engine's level builder and material records, the shipped `MaterialEvaluation.slang` BSDF compiled 1:1 as C++, the
engine's atmosphere core at the product's 17.93 h staging, the `GameExecution` materials camera and the engine's
single tone map (`ColourTransfer.h`, ACES, exposure 1.05). Not the ReSTIR kernel: a CPU render affords the samples the
GPU cannot, so these are the converged images ReSTIR + the M9 denoiser estimate. Physics for physics the two agree —
same shader text, same lights, same radiance.

- Harness: `Projects/Project-Zero/Host/MaterialLevelViewport.cpp` (Makefile target `MaterialLevelViewport`) ·
  driver: `Exhibits/Workbench/Materials/RunMaterialLibraryViewport.sh [fast|full]` (builds, renders, gates on
  non-finite samples and a plausible film mean, prints the sha256 of each sheet).
- Deterministic: fixed per (pixel, sample) seeds, no time-dependent state; re-running the driver reproduces each sheet
  bit-for-bit. Kept-sheet hashes (2026-09-17, driver defaults): `View 9761cdfb…` · `GlassRow 7a4ea7b9…` ·
  `Specials fcf22e2d…` · `Wide 44007e3e…`, film means 1.65 / 1.34 / 1.62 / 1.30, 0 non-finite samples in all four.
- Deliberately absent: the sky core's panel post (vignette/flare), the fog march (the level's scenario is Clear), and
  textures (the level is constants-only by design — see the M10 section of the proofs report). Below the sky horizon
  the atmosphere's dark planet ground shows, exactly as the engine returns it.

## ReSTIR sheet — the shipped kernel's direct block, CPU-simulated (2026-09-17)

`RestirSheet_StandardTier.png` (660×1040): six panels of the M10 level answering the question "what would I see if I
ran this on my GPU" without one. The Vulkan build draws the level with `Engine/Shaders/ReSTIRViewport.slang`
(bindless tables, a BVH in buffers, storage images); the CPU viewport mirrors that kernel line for line — RIS
candidates, temporal and spatial reservoir reuse, visibility re-traced at the shading pixel, and the running mean in
`ResolveSurface` — constants included (25°/10 % validation, the 20× M clamp, the sun-pick probability, radius 4–16 px
scaled by width/1280).

| panel | what it is | RMSE vs ① (display space) |
|---|---|---|
| ① reference | brute force, 192 spp | — |
| ② brute force | 4 spp × 16 frames (the same 64 samples) | 1268.26 (0.0194) |
| ③ ReSTIR | Standard tier: 4 candidates × 16 frames, 2 spatial taps | 2308.00 (0.0352) |
| ④ ReSTIR + à-trous | the product's actual pipeline (R7 filter over the R6 reuse) | 2272.37 (0.0347) |
| ⑤ + camera excursion | ±0.70 m triangular pan, out and back; R7a reprojection on | 6545.49 (0.0999) |
| ⑥ the same, pre-R7a | both history reads at the pixel's own address | 10186.5 (0.1554) |

- **The R7a A/B is the headline**: the closing frame of a ±0.70 m excursion sits back on the base pose, and the
  reprojected running mean gets there 36 % closer to the reference than the same-pixel read (6545 vs 10187), whose
  spheres are smeared into streaks. The film reports the mechanism per frame: ⑤ reprojects 98.0 % of surface pixels
  with 2.0 % disocclusion restarts and keeps 57 of its 64 samples; ⑥ reprojects 0 % and keeps 64 samples it never
  should have.
- **One measured caveat, stated plainly**: at equal sample budgets ③ is *noisier* than ② (2308 vs 1268). The cause is
  measured, not guessed — with the spatial taps off (`--taps 0`) the same estimator converges to 1952.52 by 128
  frames (240×135), while 2 taps stall at 4437.03 and 4 at 4660.38. The CPU mirror spends 100 % fidelity here, so the
  arithmetic is what the shader's arithmetic is; whether the GPU stalls the same way is exactly what the spatial-tap
  A/B on the Vulkan build should answer before any of this is called converged.
- Harness: `Projects/Project-Zero/Host/MaterialLevelViewport.cpp` · driver:
  `Exhibits/Workbench/Materials/RunRestirViewport.sh [fast|full]` (builds, renders, gates on non-finite samples,
  prints the RMSE table and the sheet's sha256).
- The plain path tracer is **kept on purpose** and is not superseded by the `--restir` mirror: it is the reference
  oracle every ReSTIR and denoiser number here is measured against (the ① panels), it is the bit-stability floor
  (AE = 1 on the 480×270 wide render), and it stays available for later cross-checks against the GPU frame.
- Kept-sheet hash (2026-09-17, `full`): `4cde5583…`. Deterministic — per (pixel, sample, frame) seeds, no
  time-dependent state.
