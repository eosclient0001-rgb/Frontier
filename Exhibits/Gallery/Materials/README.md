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
