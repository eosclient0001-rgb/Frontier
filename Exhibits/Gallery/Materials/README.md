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
