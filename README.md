# Frontier — Terrain

A WebGPU terrain generator. Erosion is solved on the GPU, the sky is a physically based
single-scattering model, and texturing is a layer stack of procedural PBR materials evaluated per
pixel in world space — no textures to author, no seams, no resolution ceiling.

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # WGSL parse + symbol check + 1,500 engine assertions, no GPU needed
```

Requires WebGPU: Chrome/Edge 113+, Safari 18+, or Firefox 141+. There is no reduced mode — the
erosion solver and the sky integrator are the product.

## Layout

```
┌──────────────┬────────────────────────────────┬───────────────────────┐
│ rail         │ viewport                       │ layer stack (tabs)    │
│              │                                ├───────────────────────┤
│ objects      │  terrain + sky + water         │ inspector             │
│ history      │                                │                       │
└──────────────┴────────────────────────────────┴───────────────────────┘
```

Both stacks and the inspector live on the right. Clicking a row in a stack selects it and the
inspector below shows that layer. Clicking empty space deselects, and the inspector falls back to
the object's global settings.

There is no node graph. Authoring is a stack of operators with per-layer masks, the way image
editors have worked for thirty years, because that is the fastest way to author this.

## Camera

| input | action |
| --- | --- |
| left drag | orbit |
| middle / right drag | pan |
| wheel | dolly |
| double click | focus on the point under the cursor |
| `W` `A` `S` `D` | fly |
| `Q` `E` | down / up |
| `R` `F` | zoom in / out |
| `⌘Z` / `⇧⌘Z` | undo / redo |
| `Delete` | delete the selected layer |

## The terrain stack

Seventeen operators in five groups, applied bottom to top. Every layer carries an opacity, a blend
mode and a mask; the mask can be altitude, slope, curvature, fractal noise, flow/wetness or radial,
each with its own band and feather.

- **Generate** — Fractal Terrain (fBm, ridged, billow, Voronoi mesas, with domain warping),
  Volcano, Constant
- **Shape** — Domain Warp, Terrace, Plateau, Island, Cliff, Levels
- **Erode** — Hydraulic Erosion (the pipe model: rainfall, outflow flux, sediment capacity,
  dissolution, deposition, evaporation, thermal slumping), Thermal, River, Sediment
- **Filter** — Smooth, Sharpen, Detail
- **Deposit** — Snow

Erosion is chunked across frames and the surface is re-derived while it runs, so valleys deepen as
you watch instead of arriving all at once after a stall.

## The texture stack

Fifteen procedural materials — granite, sandstone, basalt, scree, cobble, cliff rock, soil, cracked
earth, sand, mud, ash, grass, moss, snow, ice — each with two albedos, roughness, metalness, a
detail scale in cycles per metre and a macro scale in metres.

Layers composite with a **height blend**: a layer wins where it physically sits higher, so gravel
settles into the hollows of the rock beneath rather than being painted over it. Masks can be
altitude, slope, curvature, noise, flow, aspect or below-water.

Every material is evaluated as 3D noise in world space, so there is no UV set to seam and no
texel density to manage. Octave count is derived from screen-space footprint, which means detail
fades out with distance instead of aliasing.

## Shading

- Cascaded shadow maps, three cascades fitted to the terrain bounds and snapped to shadow texels
- Rayleigh + Mie + ozone scattering in reciprocal metres, integrated per pixel, with a
  transmittance LUT and nine-coefficient spherical-harmonic sky for ambient light
- Cook-Torrance GGX with Smith visibility, Fresnel-Schlick, and a wrap term for subsurface
- Aerial perspective applied per fragment from the same scattering model that draws the sky
- Deferred water: Beer-Lambert absorption over the true underwater path length, heightfield-traced
  reflections, Fresnel, foam at the shore
- ACES filmic tone curve, bloom, vignette, grain — the only place anything is clamped

## Export

16-bit greyscale heightmap, normal map, OBJ mesh at the simulation resolution, and a viewport
capture. Projects save and load as JSON.

## Checks

```
npm run check:wgsl      every shader parses (wgsl_reflect)
npm run check:symbols   every call target and struct member resolves across all 12 shaders
npm run check:engine    1,531 assertions on the schema, presets, packing, math, camera, noise,
                        PNG/OBJ encoders and project round-trips — all headless
```

`scripts/check-wgsl-symbols.mjs` exists because wgsl_reflect only parses. It will happily accept a
call to a function that does not exist or a struct member that was renamed, and both of those fail
at pipeline creation with a black screen and no explanation.

## Design

`docs/tokens.md` records the palette, geometry and type scale. The short version: neutral graphite
surfaces, colour only as a semantic accent on icons and active states, and the viewport as the only
bright thing on screen.
