# Ocean redo — research verdict and new architecture (2026-09-07)

User verdict on O0: not good enough. Fresh research round confirms it — and names exactly
what is missing. This doc records the verdict, the evidence, and the rebuilt plan.

## 1. Why O0's approach cannot reach the bar (three structural gaps)

**G1 — No true reflection.** O0 reflects a vertical gradient approximation, not the world.
Every good realtime ocean centers real reflection: UE's SingleLayerWater composites screen-space
reflections + reflection captures on top of the volume in a dedicated pass
[3](https://dev.epicgames.com/documentation/en-us/unreal-engine/single-layer-water-shading-model?application_version=4.27),
Sea of Thieves ships an area specular on top of its scattering water
[3](https://history.siggraph.org/wp-content/uploads/2022/09/2018-Talks-Ang_The-Technical-Art-of-Sea-of-Thieves.pdf),
and the standard technique for terrain mirrors is a planar-reflection texture with
per-pixel projective distortion by the water normals
[1](https://gamedev.net/tutorials/programming/graphics/realistic-natural-effect-rendering-water-i-r2138).
Without a mirror there is no sun glitter path, no horizon continuity, no life. This is
the single biggest O0 gap — bigger than the waves themselves.

**G2 — Parametric waves, not a spectrum.** 8 Gerstner sines are a fixed chord; a real sea is
a spectrum with hundreds of random-phase modes. Sea of Thieves' own foundation is Tessendorf
FFT [3](https://history.siggraph.org/wp-content/uploads/2022/09/2018-Talks-Ang_The-Technical-Art-of-Sea-of-Thieves.pdf);
the non-harmonic O0 set only hides looping, it cannot produce spectrum richness, and every
whitecap needs spectrum energy behind it (Jacobian), not a crest hack.

**G3 — Foam without an energy source is decoration.** O0 foam keys off crest height. Shipped
foam keys off physics: Jacobian crest foam from the FFT plus foam around intersecting objects
from depth-buffer comparisons in a camera-centered window, progressively blurred with feedback
to simulate dispersion (SoT)
[3](https://history.siggraph.org/wp-content/uploads/2022/09/2018-Talks-Ang_The-Technical-Art-of-Sea-of-Thieves.pdf).

## 2. What the new approach is (evidence-backed, still ours)

| Layer | Redo decision | Evidence | Ours, not UE's |
|---|---|---|---|
| Displacement | Tessendorf FFT over Phillips/JONSWAP, 256²×3 cascades | SoT foundation; Godot/CDLOD ports exist [4](https://github.com/tessarakkt/godot4-oceanfft) | Deterministic spectrum → CPU-reconstructible for gameplay (SoT does exactly this for multiplayer sync [5](https://www.reddit.com/r/Seaofthieves/comments/84ugkm/does_anyone_actually_know_how_the_water_is_done/)) — our B3 bet, validated |
| Reflection | Exact mirror of the analytic sky along R (R1); planar-reflection texture for terrain in O2 | Planar mirror + projective distortion is the standard [1](https://gamedev.net/tutorials/programming/graphics/realistic-natural-effect-rendering-water-i-r2138); SLW composites real reflections, never a gradient [3](https://dev.epicgames.com/documentation/en-us/unreal-engine/single-layer-water-shading-model?application_version=4.27) | Mirror evaluated in-shader while the sky is analytic: identical pixels to a texture mirror at zero pass cost |
| Body | SoT-style: deep ↔ subsurface by view angle + sun + peak mask; Beer–Lambert per-channel extinction (SLW-style) where depth exists | SoT peak-mask subsurface [3](https://history.siggraph.org/wp-content/uploads/2022/09/2018-Talks-Ang_The-Technical-Art-of-Sea-of-Thieves.pdf); SLW scatter/absorb/PhaseG model [4](https://dev.epicgames.com/documentation/en-us/unreal-engine/single-layer-water-shading-model-in-unreal-engine) | Same optics, cheap analytic form; full volume when terrain gives us depth |
| Foam | Jacobian crest foam + feedback-blurred foam buffer | SoT reference-paper foam + dispersion feedback [3](https://history.siggraph.org/wp-content/uploads/2022/09/2018-Talks-Ang_The-Technical-Art-of-Sea-of-Thieves.pdf) | Foam energy budgeted against the spectrum; coverage proof vs Monahan |
| Detail | Domain-warped noise (kept) + flow-advected breakup | De-tiling is table stakes; SoT blends artist textures the same way | Procedural "texture set" until authored ones exist |

What stays from the charter: real spectra (B1), accountable water (B2), synchronous queries
(B3 — now with SoT's determinism precedent), cost-first scaling (B4), self-proving (B5).
The optics we now match are physics, not Epic's IP.

## 3. Rebuilt milestones

- **R1 — True mirror + researched body (THIS increment).** Water evaluates the full sky
  (gradient + sun disc + glow + haze) along the reflection vector: real glitter path, real
  sun mirror. Body becomes SoT-style peak/sun subsurface. No new bindings, no new passes.
- **R2 — FFT core.** Stockham compute FFT, Phillips spectrum, 3 cascades, choppiness offsets,
  staggered updates; Gerstner deleted. Proofs: finite values, spectrum energy, determinism hash.
- **R3 — Jacobian foam + feedback buffer.** Crest foam from the displacement Jacobian,
  feedback-blurred dispersion buffer, lace shading; coverage proof vs Monahan.
- **O2/O3/O4** unchanged (shore SDF + SWE, interaction + spray, smoke/fire), now standing on
  the redo instead of the placeholder.
