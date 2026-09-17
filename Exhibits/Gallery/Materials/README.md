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
