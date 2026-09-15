# Realistic Procedural Canyon — Design Guide
> No SDF. No low-poly. Simulation-driven + high-density mesh + procedural PBR.

## 1. The core recipe (TL;DR)

Realistic canyons are **not** random noise. They are:

```
river path spline → carved valley profile → sedimentary strata (hard/soft layers)
→ hydraulic + thermal erosion simulation → 3D wall displacement
→ dense mesh (millions of polys) + micro-displacement
→ triplanar procedural PBR textured by slope / cavity / curvature / strata
```

The #1 realism secret: **differential erosion of horizontal rock layers.**
Hard sandstone layers jut out as cliffs, soft shale/mudstone layers recess as slopes.
If you get strata + differential erosion right, it reads as "real canyon" instantly.

## 2. Canyon anatomy (model each zone differently)

| Zone | Shape | Material |
|---|---|---|
| Plateau / rim | flat, cracked desert pavement | pale sandy soil, pebbles, sparse bushes |
| Rim edge | sharp break, fractured blocks | blocky, fallen boulders below |
| Cliff bands | near-vertical, layered | banded sandstone, desert varnish streaks |
| Slopes / talus | 30–40° scree ramps | loose gravel, soft shale colors |
| Inner gorge | narrow, dark, V-shaped | dark hard rock (schist/granite) |
| Riverbed | flat sand + cobbles + water | wet sand, rounded rocks, water plane |

You need **masks** to separate these zones: slope mask, height mask, strata-index mask, cavity/AO mask. Everything (geometry detail + texture) is driven by these masks.

## 3. Macro shape: spline-carved valley (not noise!)

Do NOT start from fractal noise. Start from intent:

1. **Draw the river path** as a spline (top view). Meandering = realistic. Use a few sine octaves + domain warp for meanders, or hand-draw 5–10 control points.
2. **Define the cross-section profile** (side view). This is the canyon shape:
   ```
   plateau ___                                      ___ plateau
                 \__rim__                        __/
                        \__cliff__      __cliff__/
                                 \__V__/
                                riverbed
   ```
   Implement as a function `depth(distance_from_river)` with terraces: each terrace = one cliff+slope pair.
3. **Carve**: base plateau height minus profile depth, plus large-scale rolling noise (±5%) so the plateau isn't perfectly flat.
4. **Tributaries**: 2–4 smaller side canyons joining the main one (same technique, shallower). This adds huge realism.

Resolution: heightfield 4096² minimum, 8192² for hero. World size ~4–8 km across, canyon depth ~300–800 m. Real proportions matter — too deep/narrow looks fake.

## 4. Base terrain + large displacement

Stack (in order):
1. **Ridged multifractal** for plateau undulation (low amplitude).
2. **Domain-warped FBM** for natural variation (warp strength ~100–200 m).
3. **Terraced strata displacement**: quantize height into bands matching rock layers (see §6), then push hard layers outward / soft layers inward.
4. **Faulting (optional)**: offset one side of a fault line by 10–50 m for drama.

## 5. Erosion simulation (this is what sells realism)

Noise alone always looks fake. You must **simulate erosion**:

### a) Hydraulic droplet erosion (rain + river)
- Classic Hans-Theobald-Beyer particle erosion: thousands–millions of droplets, each carries sediment downhill, deposits in flat areas.
- Effect: dendritic gullies on slopes, smoothed channels, sediment fans.
- Tools: Houdini `HeightField Erode`, Gaea/World Machine erosion, or implement droplet sim in Python/C++ (~200 lines).
- Run it **before** fine detail, on the 2–4k heightfield. 50–200k droplets minimum.

### b) Thermal erosion (talus / scree)
- Material above the angle of repose (~35°) slides down. Creates the characteristic 35° scree ramps between cliffs.
- Most heightfield tools have this built in. Run after hydraulic.

### c) Vertical cliff weathering (3D, not heightfield)
- Heightfields can't do overhangs/alcoves. For hero cliffs, build **separate wall meshes**: extrude dense grids along the canyon walls, displace along wall normal with:
  - horizontal bedding noise (thin, stretched X: 1, Y: 0.05)
  - vertical fracture noise (Worley cells stretched vertically → cracks)
  - alcove carving: low-frequency blobs subtracted where soft layers are (creates amphitheaters/alcoves like real slot canyons)
- Differential erosion: displacement amplitude × (1 - hardness). Soft layers carve deep, hard layers stay proud.

## 6. Strata system (the key to "real canyon")

Define ~8–15 sedimentary layers as a 1D function of elevation:

```
layer[i] = { thickness, baseColor, grainScale, hardness, roughness }
e.g. Kaibab limestone (pale, hard) / Coconino sandstone (red-white, hard, cross-bedded)
     / Hermit shale (dark red, soft) / Supai (banded orange) / Redwall (deep red, hard) ...
```

Implementation:
- `strataIndex(y) = which band contains height y` — warp y by low-freq noise first so layers undulate (±10–30 m over km scale), never perfectly flat.
- Each layer gets its own palette + grain + hardness.
- **Hardness drives**: erosion strength, cliff vs slope (hard → steep, soft → gentle), texture (hard → blocky fracture, soft → crumbly).
- Add **fault offset** and **dip** (layers tilted a few degrees) for geology credibility.

Grand Canyon reference palettes (sRGB albedo approx):
- Rim limestone: #C9BFA8 · Coconino: #D9B48C · Hermit shale: #8E4438
- Supai bands: #B4663F / #C98A5A · Redwall: #7E2F26 · Inner gorge: #3A3230

## 7. Dense mesh (killing the "low-poly look")

- **Density**: final render mesh in the millions of triangles. E.g. 8k heightfield → up to 134M quads; decimate adaptively: dense in canyon (0.5–2 m/quad), sparse on plateau (10–20 m/quad).
- **Micro-displacement at render time**: 0.1–1 m amplitude detail (cracks, bedding) as displacement maps, plus normal-map detail below that. In Unreal use Nanite + virtual displacement; in Blender use Adaptive Subdivision (Cycles) or just bake a dense mesh.
- **No smooth shading artifacts**: compute normals from the displaced high-res mesh, never from the low cage.
- **Boulders/talus blocks**: scatter 1000s of procedurally displaced rocks (icosphere + noise displacement + same sandstone shader) at cliff bases. Talus sells scale.

## 8. Realistic procedural PBR textures (no photo scans needed)

All textures computed in-shader (or baked to 4–8k UDIMs). Use **triplanar projection** everywhere (no UV seams on cliffs).

### 8.1 Required maps
Albedo, Normal (2 scales: macro + micro), Roughness, AO/cavity, Displacement. Optional: curvature (for edge wear).

### 8.2 Layer stack (bottom → top), blended by masks
1. **Strata base**: per-layer albedo from §6 + per-layer grain (FBM at 0.5–2 m + fine grain at 2–10 cm).
2. **Large mottling**: domain-warped FBM at 20–100 m scale, ±15% brightness — kills tiling.
3. **Bedding planes**: thin horizontal dark lines (high-freq 1D noise on Y, stretched), stronger in soft layers.
4. **Cross-bedding** (in dune sandstones like Coconino): diagonal sweeping bands — angled 1D noise, masked to those layers only.
5. **Vertical desert-varnish streaks**: dark brown/black streaks running down cliffs. Implementation: Worley streak noise stretched vertically (1×20), masked by (slope > 60°) × cavity × noise. This single detail adds enormous realism.
6. **Slope-based sand vs rock**: slope < 35° → sandy/gravelly (light, rough ~0.95, pebbly normal); slope > 50° → bare rock (darker, rough ~0.7–0.85). Blend smoothly 35–50°.
7. **Cavity darkening + dust in recesses**: AO from geometry (bake or SSAO) darkens albedo ×0.6 in deep cracks; upward-facing cavities collect light dust.
8. **Edge wear**: curvature-high edges get lighter, slightly less rough (exposed fresh rock).
9. **Wet band near river**: below waterline +2 m → darken albedo ×0.5, roughness → 0.25, slight spec. Plus white mineral ring at old waterlines.
10. **Micro detail**: 1–5 cm grain normal + roughness variation, tiled stochastically (hash-offset tiles to hide repetition).

### 8.3 Anti-tiling (critical for realism)
- Every tiled noise gets **macro variation** (large-scale multiply) + **stochastic tiling** (per-tile random rotation/offset via hash).
- Never let the eye catch a repeating pattern — always 2+ octaves of scale separation between detail layers.

### 8.4 Triplanar sketch (GLSL/HLSL-style)
```glsl
// sample procedural layer from 3 planes, blend by normal
vec3 wp = worldPos * scale;
vec3 bw = pow(abs(worldNormal), 4.0); bw /= (bw.x + bw.y + bw.z);
vec3 colX = strataAlbedo(vec2(wp.y, wp.z));
vec3 colY = strataAlbedo(vec2(wp.x, wp.z));
vec3 colZ = strataAlbedo(vec2(wp.x, wp.y));
vec3 albedo = colX * bw.x + colY * bw.y + colZ * bw.z;
// masks
float slope = 1.0 - worldNormal.y;      // 0 flat → 1 vertical
float cavity = texture(cavityMap, uv).r; // baked from mesh
```

## 9. Water, vegetation, atmosphere

- **River**: separate plane with flowing normal-map shader (2 scrolling noise layers), muddy-green albedo, fresnel reflection. Keep it simple — the canyon is the hero.
- **Vegetation**: scatter drought plants (sagebrush blobs, cottonwoods near water) by rules: density ∝ 1/slope, boosted within 30 m of river, zero on cliffs. Use billboard/impostor or low-poly-with-good-shader plants — terrain stays high-poly.
- **Sky/light**: warm low sun (morning/evening) raking across strata = instant realism. Cool sky fill. Dust haze in the air (exponential height fog, warm tint). ACES tone mapping.

## 10. Tooling options (pick one stack)

| Stack | Terrain + erosion | Cliffs/detail | Textures | Render |
|---|---|---|---|---|
| **A. Houdini (best quality)** | HeightField + Erode + Terraces | VDB-free: `HeightField Project` + point-displace walls | COPs / MaterialX, bake UDIMs | Karma / export to UE |
| **B. Blender (free)** | A.N.T. Landscape + `Erosion` (complexity ~60) or BPBake | Geometry Nodes wall displacement | Shader Nodes → bake 8k maps | Cycles + Adaptive Subdiv |
| **C. Unreal 5 (real-time)** | Landscape + `Erode` brush / import Houdini height | Nanite displaced wall meshes | Landscape layers + triplanar MF | Lumen + Nanite |
| **D. Custom code** | Python numpy droplet-erosion (~300 lines) → 16-bit PNG height | meshing via marching-squares grid → OBJ | procedural GLSL triplanar shader | three.js / Godot / custom GL |

Recommended MVP: **D (Python heightfield + erosion) → import into Blender → detail + bake → Cycles stills**. Cheapest path to a jaw-dropping image. Move to Houdini/UE5 when animating or going real-time.

## 11. Build order (MVP in ~5 steps)

1. **Silhouette**: spline path + profile carve → gray-shaded render. If the silhouette doesn't read as "canyon", stop — fix profile/meander first.
2. **Strata + differential erosion**: add layers, run erosion. Gray-shade again — cliffs vs slopes must alternate.
3. **Dense mesh + boulders**: subdivide, scatter talus. Check close-up: no faceting, no smooth blobs.
4. **PBR pass**: strata albedo → streaks → slope blend → wet band → micro. Compare against Grand Canyon photos side by side.
5. **Light + air**: low sun, haze, river, plants. Final color grade (warm highlights, teal-ish shadows).

## 12. Realism killers (avoid these)

1. Pure fractal noise with no strata → looks like crumpled paper, not geology.
2. Perfectly horizontal, constant-thickness layers → warp + vary them.
3. Same material on flat and cliff → always slope-blend.
4. Visible texture tiling → stochastic tiling + macro variation.
5. Overly smooth walls (no bedding/fracture) or overly spiky noise → layer detail at 3 scales: 100 m / 2 m / 5 cm.
6. Wrong proportions (slot canyon 2 km deep) → use real references: Grand Canyon ~1.6 km deep × ~16 km wide; slot canyons ~30 m deep × ~3 m wide. Pick one type!
7. Flat noon lighting → always low warm sun + haze for hero shots.

## 13. Decide: which canyon type?
- **Grand Canyon type** (wide, terraced, strata-driven) — recommended, most forgiving procedurally.
- **Slot canyon** (Antelope-style: narrow, smooth swirling walls) — needs 3D wall sculpting + water-polish shader, harder without SDF but doable with wall-mesh displacement.
- **Desert wash / wadi** (shallow, braided) — easiest, mostly heightfield + gravel shader.

---
Next step: tell me your stack (Blender / Houdini / Unreal / Unity / pure code) and canyon type, and I'll scaffold the actual generator (scripts + shader starter) in this repo.
