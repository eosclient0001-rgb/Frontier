# Shading Spec — procedural satellite style, zero bitmaps

Goal: from orbit distance the terrain must read like satellite imagery (geologic
strata, drainage texture, scree/vegetation/snow logic); at ground level it must hold
up with grain + curvature + AO. Everything is synthesized from SDF attributes +
analytic noise in-shader. No downloaded textures — infinite zoom, no licensing, no
seams.

## 1. Inputs (per-vertex → interpolated)

| Varying | Source | Use |
|---|---|---|
| world pos | geometry | strata bands, elevation, triplanar grain |
| world normal | SDF gradient | slope biome rules, sun/sky light |
| `flow` | sim | drainage streaks, wet channels, sediment fans |
| `erode` | sim | fresh-rock exposure (darker/redder, rougher) |
| `wet` | sim | albedo darkening ×0.45, roughness → 0.25, spec boost |
| `sed` | sim | loose-soil lightening, dune ripple tint |
| `ao` | baked SDF cone trace | multiply (0.35..1), drives cavity dust |
| `curv` | baked divergence | convex +8% / concave −12% value; ridge highlight |
| strata coord | shader (world pos + warp) | banded geology base |

## 2. Layer stack (fragment, in order)

```
1. GEOLOGY BASE
   s  = strataCoord(wpos) = dot(wpos, dipDir)·freq + warp·fbm(wpos·wFreq)
   band palette: 6 rock tones (sandstone, shale, granite, limestone, basalt, silt)
   idx = floor(s), f = smooth frac(s) → mix(band[idx], band[idx+1], f)
   bandEdge darkening: thin dark seams at frac≈0 (sedimentary read)

2. LARGE PATCHINESS
   m = fbm(wpos·0.02) → hue/value jitter ±10% (breaks banding monotony)

3. SLOPE / ELEVATION BIOMES (blend by slope s = 1 - n.y, elev e = wpos.y)
   rock      : base geology, steep slopes
   scree     : mid slope + high curv-convex → desaturated warm gray + grain
   soil/veg  : low slope + low elev + moisture(flow,wet) → moss/grass gradient
               (arid preset shifts to scrub/desert varnish)
   sand      : low slope + high sed + low wet → pale ripple-tinted
   snow      : e > snowline - jitter·fbm + slope < 0.45 → white-blue, sparkle
   shoreline : |e - waterLevel| < band & low slope → wet sand ring

4. DRAINAGE & PROCESS READ
   flowStreak = log(1+flow·k) → dark wet channel center + pale levee edges
   sedFan     = sed·(1-slope) → pale alluvial tint
   freshRock  = clamp(erode·k) → mix toward dark/red unweathered tone, +rough

5. SCULPT
   albedo *= mix(1.0, ao, 0.75)
   albedo *= 1 + clamp(curv·k, -0.14, +0.10)
   wet: albedo *= mix(1, 0.45, wet); rough = mix(rough, 0.22, wet)

6. MICRO (triplanar, 2 scales)
   g1 = grain(wpos·14, n), g2 = grain(wpos·55, n)  // hashed value noise
   albedo *= 0.92 + 0.16·g1·g2 ; rough += 0.1·g2
   snow sparkle: glint = step(0.997, hash(floor(wpos·90)))·sunFace

7. LIGHT
   sun:  wrap diffuse (w=0.25) + shadowless AO-cavity term
   sky:  hemisphere by n.y ; wet spec: Blinn-Phong ·(0.2 + 0.8·wet)·sunFace
   distance haze → fog color (aerial perspective sells the sat look)
```

## 3. Debug mask views

One-click overrides: `flow` (blue), `erode` (red), `wet` (cyan), `sed` (yellow),
`ao` (gray), `curv` (red/blue), `hard` (green), `rain` (magenta). Rendered as
full-albedo replacement with the same lighting off — tuning erosion blind is
forbidden.

## 4. Water shader (v0.1 plane)

Translucent plane at `waterLevel`: normal-perturbed (2 scrolling sine/noise octaves),
fresnel mix of deep color → sky color, sun glint (specular streak), shore fade by
distance-to-terrain approximated with `wet` shoreline band sampled… v0.1: analytic
radial fade + `wet` tint where plane intersects terrain (depth test handles the
intersection line). v0.2: per-chunk drape mesh with real depth fade.

## 5. Quality bar (acceptance looks)

- Ridge-and-ravine texture visible from top-down at 200 m (flow streaks + strata).
- Gullies read as carved V-notches with fresh-rock interiors, not painted lines.
- Talus cones read as smooth aprons against craggy cliffs (thermal contrast).
- Wet channels glint when orbiting the sun (wet spec).
- No visible tiling at any zoom (all noise world-space, non-periodic).
