# Foam field — replacement algorithm, September 2026

The **second page**, `whitewater.html`, now replaces surface-foam particles with a persistent Eulerian coverage texture. The original light pond and its shared solver/material files are unchanged. Run `python3 preview-whitewater.py --port 8002`; `/` opens the revised dark page and `/index.html` opens the original.

## Why replace the previous version?

The previous design sampled the water surface and gradient for every foam particle at every physics step, uploaded full-capacity instance buffers every rendered frame, and shaded overlapping bubble-ring quads. Those circles looked like separate decorative bubbles rather than connected froth. Reflection and refraction also rendered the entire scene two extra times per frame.

The replacement has **no surface-foam particles and no additional foam draw call**. Foam is a property of the existing water surface. It forms connected, irregular patches with porous edges, rather than floating ring sprites. Only airborne spray uses particles.

## Research that informed the change

- [Crest — water appearance](https://crest.readthedocs.io/en/stable/user/water-appearance.html) and [ocean simulation](https://crest.readthedocs.io/en/4.10/user/ocean-simulation.html): persistent foam amounts, crest/shallow-water sources, adjustable simulation frequency and dissipation; foam detail textures and surface lighting. Crest's default simulation frequency is 30 Hz; this small CPU implementation uses 20 Hz.
- [Whitecap Phenomenology for Ocean Surface Simulation](https://jtessen.people.clemson.edu/reports/papers_files/whitecap_fraction.pdf): persistence of whitecap coverage and exponential decay after generation. This project uses a coverage field and half-life, **not** the paper's deformation-eigenvalue breaking criterion.
- [Real-time Animation and Rendering of Ocean Whitecaps — implementation](https://github.com/jdupuy/whitecaps): prefilterable coverage/detail matters at a distance. Here, static detail is mipmapped and field coverage is bilinearly filtered with derivative-softened edges.

These are design references, not claims that this demo implements Crest's GPU ocean solver or a research paper in full.

## Actual algorithm

1. **Field:** 128 columns; rows follow the pond aspect ratio. The default 12 × 8 m pond uses 128 × 85 cells. Float32 ping-pong arrays hold density; an R8 texture sends it to the GPU. The largest supported aspect ratio uses 128 × 224 cells. Simulation resolution is independent of adaptive wave-mesh refinement.
2. **Sources:** overlapping anisotropic Gaussian deposits form irregular splash patches and continuous duck-wake ribbons. Descending spray deposits coverage at impact. Moving steep/curved wave regions add bounded density directly to nearby field cells. A static mound or flat water cannot emit crest foam.
3. **Transport:** semi-Lagrangian backtracing with bilinear interpolation at a fixed **20 Hz**, driven from the existing fixed physics clock. The velocity is a bounded *wave-phase motion proxy* computed from height gradients and vertical velocity. It is not a solved horizontal fluid velocity. This is intentionally one-way: effects never write to the water arrays.
4. **Decay:** exponential density half-life, adjustable from 2–14 seconds. This affects existing coverage immediately. Negligible density below 2.5% is pruned. Semi-Lagrangian interpolation is dissipative, not exactly mass-conserving.
5. **Masking:** wet cells and solver sample indices are cached; refinement remaps indices without discarding coverage. Pond dimensions clear and rebuild the field. Solid-bank/rock cells cannot retain coverage.
6. **Shading:** the original material's fragment source is extended only in the second app. One coverage lookup, followed by two detail lookups where foam exists, controls patch breakup, pores, diffuse scattering and replacement of glossy water highlights. A periodic procedural microtexture is baked once in JavaScript, then mipmapped. There is no fragment-shader Voronoi loop, foam geometry, or foam overdraw. This is approximate surface foam, not a volumetric microbubble model.
7. **Spray:** 256 default airborne droplets, selectable 128/256/512, versus the previous default 6,000 mixed particles. Ballistic gravity, drag, landing, finite lifespan and hard cap remain. Only live spray attributes are uploaded. Decorative procedural crowns remain optional, are **off by default**, and are capped at four.

### Rendering profiles

| Mode | Scene rendering | Resolution |
|---|---|---|
| Fast | One scene pass; environment reflection and approximate procedural bed | DPR capped at 0.85 |
| Balanced (default) | Main pass every frame. Smaller scene-reflection/refraction captures no more than 20 Hz and no more than every third rendered frame while the camera is stationary. Camera/material/dimension changes refresh immediately. | DPR ≤ 1; refraction width ≤ 640 px, reflection ≤ 384 px |
| Full | Main + both scene-optics passes every frame | DPR ≤ 1.5; refraction ≤ 850 px, reflection ≤ 600 px |

Fast preserves all foam/spray simulation but sacrifices accurate scene reflections and refracted object silhouettes. Balanced can show a short delay in reflected moving objects. Full is deliberately more expensive. The target buffers in Fast are allocated for valid sampler bindings without rendering those extra passes.

The UI reports **FX CPU milliseconds**, excluding the wave solver and GPU rendering; it is not GPU time. The pass count describes the most recently rendered frame. The area readout is density-weighted square metres above the residue cutoff, not a measurement of optically opaque white pixels.

## Measurements

Reproducible command:

```sh
node tests/benchmark-foam.mjs
```

One sandbox run, Node v22.22.3; median of seven runs, 180 updates per run, 90 Hz physics input:

| Seeded foam deposits | Old particle update / physics step | New field update / physics step | CPU ratio |
|---|---:|---:|---:|
| 1,000 | 0.2528 ms | 0.0651 ms | 3.88× |
| 6,000 | 1.5831 ms | 0.0806 ms | 19.63× |

This is an **isolated simulation CPU benchmark**, not a hardware FPS or GPU benchmark. Both versions use the same frozen disturbed water surface, no continuing crest emissions, no spray, and long decay times. The old implementation is preserved as a benchmark fixture. Particle count and raster coverage are different representations, so this is a scaling comparison, not a claim of numerically identical output. Input deposition time is not included. Small or empty workloads need not be faster with a field; it has a fixed grid overhead.

At default pond size, a field upload is **10,880 bytes**. At steady 20 Hz decay this is about 218 kB/s, excluding event-driven changes. Deposits can trigger additional render-rate uploads. The previous renderer uploaded about 624 kB of full-capacity particle attributes **per rendered frame**, even with few live particles. The new spray upload is 40 bytes per live droplet (10,240 bytes at the default cap), and the field uploads only when changed. The detail texture is a one-time upload.

The numerical comparison excludes rendering. The render-cost improvement comes separately from eliminating the foam draw/overdraw, reducing spray, limiting pixel ratio, and caching or removing scene-optics passes. Actual total FPS still depends on hardware, viewport, wave resolution, shadows and the chosen profile. Headless software-WebGL timings are not presented as hardware GPU performance.

## Validation and limitations

```sh
node tests/whitewater.test.cjs
node tests/stability.test.cjs
node tests/solver.test.cjs
node tests/pond.test.cjs
```

Field tests cover calm water, exact half-life, finite/saturated density, no water feedback, landing, spray limits, class toggles, render-rate-independent evolution, refinement preservation, resizing and reset. Browser smoke checks verified shader compilation, pause/clear, enabled classes, landing, budget/half-life controls, all three rendering profiles, one-pass Fast mode, resize, screenshot export, mobile layout, and the untouched original light page.

This remains a heightfield pond with approximate foam transport, sparse ballistic droplets and optional decorative sheets—not FLIP/SPH, a true breaking-water sheet simulation, or fully photorealistic foam. No shoreline foam is generated merely for being near a shore. Density breakup uses a world-anchored repeating microtexture, so the *large coverage pattern* advects while fine pores are not individually tracked. The field can lose detail and density through interpolation. This is the deliberate cost/appearance tradeoff for this real-time demo.
