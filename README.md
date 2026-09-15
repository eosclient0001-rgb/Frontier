# Frontier · Canyon Forge

A **realistic procedural canyon generator** that runs entirely in the browser.
No SDF, no low-poly, no downloaded textures — just carved heightfields,
simulated erosion, sedimentary strata and procedural PBR shading.

**Pipeline** (see [CANYON_PIPELINE.md](./CANYON_PIPELINE.md) for the full design):

1. Seeded river spline + terraced valley cross-section carve the plateau
2. Buttes, dunes, a deepening tributary and plateau **lakes** add variety
3. Hardness-aware **hydraulic droplet erosion** + **thermal (talus) erosion**
4. Cavity/AO bake + **flow-map** bake (direction / speed / depth) from the result
5. Dense mesh (up to ~1.2M tris) with a fully procedural triplanar PBR
   shader: choosable **strata palettes**, bedding planes, cross-bedding,
   desert-varnish streaks, slope-based sand/rock blending, wet river band,
   micro bump — plus **flow-mapped river water** with foam and soft shores
6. Rule-scattered talus boulders, riverside vegetation, switchback/rim
   **hiking trails**, animated water, physical sky, low warm sun, self-shadowing
7. **Rainstorm mode**: animated rainfall, overcast atmosphere, soaked rock —
   and live droplet erosion that keeps reshaping the surface in real time

Three canyon archetypes: **Grand** (wide, terraced), **Slot** (narrow,
swirling walls), **Wadi** (shallow, braided). Six rock palettes: Canyon
Classic, Antelope Red, Sahara Gold, Painted Desert, Bryce Amphitheater,
Basalt Mono.

## Run it

Any static file server works (ES modules require `http://`, not `file://`):

```bash
cd Frontier
python3 -m http.server 8000
# open http://localhost:8000
```

No build step, no npm install — Three.js r160 is vendored under
`vendor/` so the app also works offline.

## Controls

| Input | Action |
|---|---|
| W / S (arrows ↑/↓) | Fly forward / back (Unreal style, pitch included) |
| A / D (arrows ←/→) | Strafe |
| Q / E | Move down / up |
| Shift | 4× fly speed |
| Left-drag / right-drag | Orbit / pan |
| Wheel / pinch | Smooth glide zoom |

## Test the generator core

`js/terrain.js` has zero dependencies, so the heightfield pipeline
(carving, strata, lakes, flow maps, erosion engine) is tested headless:

```bash
node test/canyon-test.mjs
```

## Layout

| Path | What |
|---|---|
| `index.html` / `styles.css` | UI shell + control panel |
| `js/main.js` | Scene, sky, sun, storm, render loop, UI wiring |
| `js/terrain.js` | Pure procedural core: noise, carving, erosion, strata, lakes, flow |
| `js/canyonMaterial.js` | Procedural PBR terrain + flow water + lake shaders (GLSL injection) |
| `js/props.js` | Instanced boulders + vegetation + trail ribbons |
| `test/canyon-test.mjs` | Headless node tests for the generator |
| `vendor/` | Vendored Three.js r160 (module, OrbitControls, Sky) |
| `CANYON_PIPELINE.md` | The full “how to design a realistic canyon” guide |
