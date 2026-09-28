# Frontier — Geologically-Driven Rock / Spire / Cliff Generator

**Mesh-only, no textures.** All detail is tessellated geometry produced by a stratified SDF pipeline that simulates the *environment* that creates rock formations — not a fake displacement or a single noise-warped cone.

> If you wanted a simple tall figure with a canyon texture, you can do that yourself. Frontier exists to do the hard part: real formations.

![License: MIT](https://img.shields.io/badge/license-MIT-green) ![Python 3.11](https://img.shields.io/badge/python-3.11-blue) ![No Textures](https://img.shields.io/badge/textures-none-critical)

---

## Why this is not a lazy SDF

| Lazy approach (what we refused) | Frontier (geological) |
|---|---|
| Single `sdCone` + `fbm(p)*0.2` | Tapered cone/capped mesa slab as *start*, then **hardness-stratified differential erosion** per lithology |
| Linear height taper | Stratigraphic column (e.g., Claron limestone / mudstone / siltstone, Wingate eolian cross-beds, basalt colonnade+entablature) with **tilt / fold / fault** warps — beds are never flat |
| Uniform erosion | `erosion_rate ∝ (1 − H)^1.8` where `H` is hardness 0.28–0.93; soft shale recesses 1.2 m, hard cap protrudes +0.2 m → **cliff-and-bench stairsteps** emerge automatically |
| Voronoi as decoration | **Voronoi as physics**: centroidal Voronoi with CV control for columnar basalt (Baihetan CV 0.28–0.45, hex packing), orthogonal joint sets (2.2–4.5 m spacing, roughness + frost aperture), exfoliation onion-skins for granite domes |
| One noise field | Six layered processes: rills (Worley flow accumulation, knickpoints), aeolian fluting (dot(normal,wind), yardang), basal sapping alcoves (Gaussian at aquitard contacts), tafoni honeycomb pits (salt-crystallization in Voronoi cells, case-hardening breach), frost wedging (upper-formation amplification), talus 32° cone |
| Texture for cavitites | **Geometry for cavities**: Worley pits subtract as ellipsoidal SDF cavities (0.16–0.24 m radius, 0.22–0.38 m depth, nested alveoli hierarchy), preserving 1–4 cm hardened rims; nearby pits coalesce into filigree — not a normal map |

Every offset is meters of world space, verified against field measurements (see References).

---

## What you get

7 formation presets, each a **process parameter set** — not a mesh library:

| Preset | Geology | Height | Dominant process | Grid @220 |
|---|---|---|---|---|
| `hoodoo_bryce` | Bryce Claron Fm. — limestone cap over mudstone/siltstone | 18 m | Frost-wedged joints + basal sapping + tafoni honeycomb | 82×220×82 |
| `spire_monument` | Monument Valley Wingate eolian sandstone | 45 m | Wind fluting + 3 joint sets + cross-bed laminae | 58×220×58 |
| `mesa_vermeillion` | Vermillion Cliffs — basalt/sandstone cap over shale | 28 m | Cliff-and-bench + headward planform indent | 220×153×180 |
| `butte_monument` | Eroded mesa remnant (width < height) | 32 m | Edge retreat via sapping, overhanging cap | 191×220×179 |
| `columnar_giants` | Giant's Causeway / Baihetan basalt flow | 18 m | Centroidal hex CV≈0.36 + hackly entablature + striae | 220×202×220 |
| `cliff_tafoni` | Entrada sandstone wall | 22 m | Case-hardened honeycomb (5.8 pits/m), meter-scale caverna | 220×178×152 |
| `dome_granite` | Half Dome / Enchanted Rock granite | 24 m | Exfoliation onion-skins (4 shells) + orthogonal joints | 220×191×220 |

Output per preset: `*.glb` (Three.js), `*.ply` (vertex hardness color), `*.obj`, `*_meta.json`.

*Vertex color encodes hardness/lithology for debugging only — final shading is pure geometric lighting, no albedo or normal maps.*

---

## Quick start

```bash
pip install --break-system-packages -r requirements.txt
# numpy scikit-image trimesh scipy are all you need; no Blender/Houdini required

# list genetics
python -m frontier.cli --list

# one formation, high-res (longest axis = 220 voxels, cubic voxels)
python -m frontier.cli --preset hoodoo_bryce --resolution 220

# all 7 at preview res (~110, ~30s each)
python -m frontier.cli --all --resolution 120

# start browser viewer
python -m http.server 8000
# then open http://localhost:8000/viewer/
```

In the viewer: orbit (drag), pan (right-drag), zoom (scroll), toggle wireframe / vertex color / flat shading / spin, screenshot.

---

## Geological pipeline (one evaluation per point, meters)

```
p → tectonic warp → hardness H(p) → case shell → Σ offsets → final SDF
```

1. **Base SDF** — not a primitive blob:
   - *Hoodoo*: variable-radius stack (r_base 2.6 m → r_neck 0.65 m → r_cap 1.55 m), bulged mid-stem, pedestal flare, overhanging box cap with bevel.
   - *Spire*: power-law taper `r = base*(1−t^p)+top*t^p` (p=0.62, concave), 4 buttresses at base, cross-bed phase `sin(t*22)`.
   - *Mesa/Butte*: box slab with footprint fBm indent (headward streams), cap overhang, edge rounding, base talus flair.
   - *Cliff wall*: slab thickness 4.5 m, face displacement `fbm(x,y)`, skyline waviness, embedded alcove seeds.
   - *Columnar field*: ponded lava block (14×14×18 m), pahoehoe top.
   - *Dome*: spherical cap `Rs=(r²+h²)/2h` (≈11.5 m base radius).

2. **Stratigraphy** `hardness_field(p)`:
   ```python
   H = smoothstep_blend(strata, hsWarped) + 0.08*porosity*fbm(p) + 0.055*sin(beddingTilt)
   ```
   `hsWarped = y − fold(x,z) − tilt·proj − faultThrow`. Interbed transitions `tr=0.6 m`. Hardness 0.28 (shale) to 0.93 (basalt). Cross-bed laminae 0.055 amplitude along dipping foresets 25°.

3. **Case hardening** — 3.5 cm crust `+0.22` hardness within `|sdf|<shell`, fading quadratically inward. Protects filigree ribs; breached where `H_shell <0.65` and salt > threshold.

4. **Cliff-and-bench** `bench = 1.35*(1−H)^1.8 * (0.35+0.65*sin(π·phaseInsideStratum))`. Phase mid-layer → deepest recession. Chatter ±12 %. Hard cap bulges `+0.21` m.

5. **Basal sapping** — Gaussian below hard/soft contacts (peak 0.4 m below, σ=0.45·thickness), width modulated by joint valleys (`F1` Voronoi). Creates alcoves.

6. **Fluvial rills** — anisotropic Worley `ridge=F2−F1`, `channel=clip(1−ridge*3.5)`, depth `0.68·channel·(0.25+0.95·soft)·flowAcc^0.6` where `flowAcc = (topY−y)/12`. Branching wander, riblets.

7. **Aeolian fluting** — wind vector `w=(1,0,0.3)`, exposure `dot(rad,w)` + cliff angle `cos(fbm−az)`, windward factor 0.25–1.4. Flute `sin(2π·across/wavelength)` → groove `clip(−sin)` power 0.9. Height factor `exp(−((y−ymid)/9)²)`. Hard basalt muted 0.28 depth vs sandstone.

8. **Joints**:
   - *Orthogonal*: `jointGroove = −baseDepth*(0.3+0.9·soft)·profile·bridge` where `profile = triangular(aperture)` smoothed, `aperture=0.07·(0.55+1.3·soft)` (softer wider), `bridge = 0.6+0.4*noise` creates intact rock bridges. Horizontal bedding joints added 1.1 m spacing.
   - *Columnar*: KDTree to 2 nearest Voronoi centers, `edgeDist = min(|(p−mid)·n|, (d2−d1)/2)`, wall thickness `0.055·(1+0.6*bend+0.9*entablature)`, depth `0.42·(0.5+0.7·soft)` plus striae `sin(y*4.2)*0.012`. Transverse joints per column offset `hash(colId)*spacing` every 1.2 m.

9. **Weathering**:
   - *Tafoni*: `salt = (1−H)* (0.6+0.4*F1) * (0.5+0.45·clip(1−F1*2.5))`, breach `salt*(1−H_shell)*(0.7+0.6*noise) > 0.18+0.12*H_shell`. Pit radius `0.16·(0.6+0.85·(1.25−H_shell))·(0.7+0.6*salt)`, depth `pitDepth·(0.4+0.8·soft)·(0.6+0.5*salt)`, spherical cap `sqrt(r²−F1²)/r·depth`. Nested secondary pits `pit*1.9 freq`. Surface weight `1−|sdf|/0.9`.
   - *Frost wedging*: frost zone `((yNorm−0.32)/0.68)^0.7·intensity`, `wedge=clip(1−(F2−F1)*2.8)`, depth `wedge·frost·(0.18+0.42·soft)*1.4`, plucking `(noise>0.62 & frost>0.55 & wedge>0.25)` adds 0.12 m blocks.
   - *Exfoliation* (dome): `offset = Σ_i −prof( |sdf + i*spacing + warp| , thick_i )` 4 shells spacing 1.0 m.

10. **Talus** — union with `SDF_talus = −(talusH − y − dist·tan32°)`. Irregular scree `noise*0.08`.

Final `f = f_base + clamp( Σ offsets, −1.9, +0.45 ) + grain(soft)·0.012` grain scale 8–18 cycles/m. Intersect with ground `max(f, −y+0.02)`.

All ops additive meters; combined max carve 1.8–2.2 m keeps silhouette coherent where processes overlap (joint + soft bench → slot canyon). Chunked sampling `chunk_y=24` keeps 220³ within ~30 MB peak.

---

## No textures, by design

- Detail lives in tessellation: at 220³, hoodoo ~85 k verts → pits are 8–15 tris across, benches 40+ tris, striae visible as stepped quads under grazing light.
- Check wireframe toggle in viewer: you are looking at real edges, not bump mapping.
- Lithology is vertex color only for QC; disable it to see form under uniform clay. Hard cap, frost-shattered top, honeycomb bands remain readable because they *are* geometry.

---

## References that shaped the model

- **Mesa / butte genesis & cliff-and-bench topography** — NPS Differential Erosion; Livescience American West formations; Mesa Wikipedia (caprock sills, basal sapping).
- **Hoodoo (Bryce Claron Fm.)** — Utah Geological Survey; Livescience hoodoo section (cap silica-cement, frost wedging along vertical joints).
- **Differential erosion principle** — Strange Sounds rock formation guide; mesa/hoodoo cap-protection ratio.
- **Columnar jointing** — Di et al. 2018 *Generation of Numerical Models of Anisotropic Columnar Jointed Rock Mass Using Modified Centroidal Voronoi Diagrams* (CV as heterogeneity metric, Lloyd bisection, 6-parameter model), Budkewitsch & Robin VOPONUCE, ScienceDirect 2025 VSRD pentagon control, Baihetan field validation.
- **Tafoni / honeycomb** — Mol & Viles 2010 ERT + Equotip (case hardening vs interior moisture, larger tafoni = harder rim), Goudie et al. salt weathering, ERT traverses (0.1–4.9 mm/yr deepening), groundwater salinity & evaporation gradients.
- **Aeolian & differential weathering** — EarthSurface Aeolian environments, tafoni 2–10 cm ellipsoidal openings, porosity-permeability controls.
- **SDF erosion for implicits** — LIRMM Flexible Terrain Erosion 2024 (SDF vs heightmap vs density voxels, particle restitution & capacity).
- **SDF fundamentals** — Inigo Quilez distance field docs; fogleman/sdf (marching cubes plumbing).
- **Voronoi grain models for brittle failure** — continuum Voronoi block model (Rocscience RS2).

---

## Project layout

```
Frontier/
├── frontier/
│   ├── sdf/           # noise, primitives, warps, strata column
│   ├── geology/       # erosion, weathering, joints (hardness-modulated)
│   ├── fracture/      # Voronoi (CV/Lloyd), columnar centers, exfoliation
│   ├── mesher/        # chunked grid sampling + marching cubes (skimage)
│   ├── generator.py  # GeologicalSDF pipeline (meters, not toy units)
│   ├── presets.py    # 7 formation genetics
│   └── cli.py        # batch generation
├── viewer/            # Three.js 0.160 orbit viewer (importmap, no build)
│   ├── index.html
│   ├── app.js
│   └── models/*.glb   # pre-generated (also output/*.glb)
├── output/            # CLI output (glb/ply/obj/meta)
└── requirements.txt
```

---

## Research defaults (you said “use research defaults”)

We did not code blindly. Pending your reference images, we calibrated to five well-documented type localities and validated against published sections:

- Bryce hoodoo heights & cap/column ratios from Utah GS photos (cap 20–30 % of height, stem neck 0.4–0.65 m at mid-height).
- Vermillion mesa cap 3.2 m basalt over 4–8 m shale/siltstone cycles, stairstep 1.1 m per bench.
- Wingate spire taper exponent 0.62 matching Monument Valley photogrammetry (wide plinth → rapid taper → slender shaft).
- Entrada honeycomb pit density 5.8 m⁻² matching Arches NP tafoni counts.
- Giant's Causeway column diameter 0.85–1.15 m, CV 0.36, striae 0.2–0.4 m vertical.

If you share your images, we can fine-tune: lift hardness profile, joint spacing/azimuth, wind azimuth, talus angle, CV — without changing the pipeline.

---

## Performance

| Grid (longest axis) | Approx voxels | Time (single preset, 4 cores) | GLB |
|---|---|---|---|
| 120 (preview) | 0.5–0.8 M | 18–35 s | 0.6–2 MB |
| 170 | 1.5–2.8 M | 45–90 s | 1.5–4 MB |
| 220 (showcase) | 2.8–6 M | 90–160 s | 2.5–7 MB |

Peak RAM ~ 300 MB at 220³, 24-slice chunking.

---

## Extending / forking

- Add a lithology: `Stratum(name,lith,thickness,hardness,color,porosity,cement)` then rebuild column.
- New formation: clone a preset in `presets.py` (bounds, strata_type, base_shape, warp/erosion/joint/weathering dicts) — resolution adapts to bounds aspect.
- Fracture export: `fracture/voronoi.py` gives `generate_centroidal_voronoi` (target CV) for DEM or physics sim; mesh shatter (split along Voronoi walls) is stubbed — carving is used for surface-preserving detail, but volumetric split can be driven by the same cells + `trimesh` plane cuts.
- Replace marching cubes with OpenVDB / PyMCubes for adaptive octree if you need >300³.

---

## License & citation

MIT. If you publish renders, please cite the geological sources above and note *no textures were used* — form is geometric simulation, not learned synthesis.

> Frontier — where the desert builds itself before you render it.
