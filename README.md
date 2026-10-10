# Frontier — Terrain

A WebGPU terrain authoring tool that runs entirely in the browser. Two stacked
authoring passes, no node graph anywhere: you shape a height field layer by
layer, then paint physically-shaded materials onto it layer by layer.

```
open index.html from any static server   (Chrome/Edge 113+, Safari 18+)
    python3 -m http.server 8080
```

---

## The two stacks

**Terrain** (`Generate → Erode → Shape`) — 17 operators executed in order on a
GPU height field:

| Generate | Erode | Shape |
| --- | --- | --- |
| Fractal Noise · Cellular · Craters · Dunes · Constant | Hydraulic · Thermal · River Carve | Slope Blur · Smooth · Sharpen · Terrace · Strata · Curve · Warp · Snow · Clamp |

Hydraulic erosion is a real particle simulation — droplets walk the field, pick
up sediment against a velocity-based capacity, deposit where they slow, and
leave a flow and deposition map behind. Thermal erosion slumps anything above
the angle of repose. `River Carve` and every `Flow` mask read a proper
accumulation network, not a cheap slope proxy.

**Texture** — a stack of 19 material layers, each masked by the terrain. Every
material is a procedural BRDF surface (albedo, roughness, normal gradient,
occlusion, sparkle) evaluated per-pixel from the world position, so detail is
infinite and never tiles. Layers height-blend against each other so gravel
creeps up through sand and scree breaks through grass.

### Masks

Any layer can be restricted by up to eight multiplicative channels, each with
its own band and feathering: **Altitude, Slope, Curvature, Flow, Deposition,
Occlusion, Noise, Aspect**, plus a global gamma and an invert.

---

## Rendering

- Physically-based sky: a computed atmospheric LUT (Rayleigh + Mie + ozone)
  projected to spherical harmonics for ambient irradiance.
- Ray-marched soft sun shadows against the height field, plus horizon-based
  ambient occlusion, curvature and a wetness term driven by the flow map.
- Surface-gradient bump mapping from the material stack, snow subsurface,
  aerial perspective.
- Water surface with refraction, depth-based absorption and Fresnel.
- HDR pipeline: 16-bit scene → temporal AA → threshold bloom → auto exposure →
  ACES / Neutral / AgX / Filmic tone map → vignette and grain.
- Internal resolution can run at ½×, 1× or 2×.

## Export

`Export` bakes top-down maps to 16-bit PNG straight off the GPU — height,
normal, albedo, AO, flow, deposition, curvature, roughness — at 1024², 2048² or
4096².

---

## Layout

```
┌──────────────── top bar: preset · field/mesh res · live · build ────────────────┐
├───────────────────────────────────────────────────┬─────────────────────────────┤
│ viewport strip: quality | water/taa/shadows       │  LAYER STACK                │
│                 shaded/data · build status        │  [Terrain | Texture]        │
│ ─────────────────────────────────────────────────  │  ─────────────────────────  │
│                                                   │  INSPECTOR                  │
│                   the terrain                     │  layer params · materials   │
│                                        ☀ sun dial │  · masks · scene · sun      │
├───────────────────────────────────────────────────┴─────────────────────────────┤
│ status bar: world size · relief · seed · build time · fps                       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Drag in the viewport to orbit (shift-drag or right-drag also orbits), wheel to
zoom, `W/A/S/D/Q/E` to fly in fly mode. `B` rebuilds, `F` frames, `⌘Z` undoes.
Double-click a layer name to rename it. Drag the number next to any slider to
fine-tune, drag the track to sweep.

---

## Verification

The sandbox this was developed in has no GPU, so the engine is checked three
ways instead:

```
node tools/validate-wgsl.mjs     # every shader module through naga: 15/15 valid
node tools/check-bindings.mjs    # JS pipeline entry points ⇄ shader fns
node tools/smoke-build.mjs       # every preset through the compute graph
node tools/smoke-render.mjs      # every preset through the full post chain
```

`tools/mock-gpu.mjs` is a recording fake WebGPU device that enforces the rules a
real implementation enforces: pipeline entry points must exist, bind groups must
match their layouts, dynamic offsets must be 256-aligned, a texture may never be
bound while it is the render target, and no NaN may reach a uniform buffer.

Nothing here has been seen on a real screen — the shaders are provably valid and
the command graphs are provably well-formed, but **appearance has not been
verified** and will need a pass in a browser.

---

## Source

```
src/shaders/    lib · frame · atmosphere · terrain_gen · terrain_filter · erosion
                surface · materials · shading · index_gen · render · water · post
                sky_lut · pack
src/js/core/    state (project + GPU packing) · terrain (build graph) ·
                renderer (frame graph) · camera · math · png · shaders
src/js/schema/  layers.js — the single source of truth for every parameter,
                its GPU slot and how it is presented
src/js/ui/      widgets · layerstack · inspector · icons
```
