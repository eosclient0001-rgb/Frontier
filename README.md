# Frontier · Canyon Forge

A **realistic procedural canyon generator** that runs entirely in the browser.
No SDF, no low-poly, no downloaded textures — just carved heightfields,
simulated erosion, sedimentary strata and procedural PBR shading.

**Pipeline** (see [CANYON_PIPELINE.md](./CANYON_PIPELINE.md) for the full design):

1. Seeded river spline + terraced valley cross-section carve the plateau
2. Buttes, dunes and tributaries add large-scale variety
3. Hardness-aware **hydraulic droplet erosion** + **thermal (talus) erosion**
4. Cavity/AO bake from the eroded heightfield
5. Dense mesh (up to ~1.2M tris) with a fully procedural triplanar PBR
   shader: strata bands, bedding planes, cross-bedding, desert-varnish
   streaks, slope-based sand/rock blending, wet river band, micro bump
6. Rule-scattered talus boulders, riverside vegetation, animated river water,
   physical sky, sun + self-shadowing

Three canyon archetypes: **Grand** (wide, terraced), **Slot** (narrow,
swirling walls), **Wadi** (shallow, braided).

## Run it

Any static file server works (ES modules require `http://`, not `file://`):

```bash
cd Frontier
python3 -m http.server 8000
# open http://localhost:8000
```

No build step, no npm install — Three.js r160 is vendored under
`vendor/` so the app also works offline.

## Test the generator core

`js/terrain.js` has zero dependencies, so the heightfield pipeline can be
tested headless in node:

```bash
node /tmp/canyon-test.mjs   # (or point it at your own harness)
```

## Layout

| Path | What |
|---|---|
| `index.html` / `styles.css` | UI shell + control panel |
| `js/main.js` | Scene, sky, sun, water, render loop, UI wiring |
| `js/terrain.js` | Pure procedural core: noise, carving, erosion, strata, AO |
| `js/canyonMaterial.js` | Procedural PBR terrain + water shaders (GLSL injection) |
| `js/props.js` | Instanced boulders + vegetation scattering |
| `vendor/` | Vendored Three.js r160 (module, OrbitControls, Sky) |
| `CANYON_PIPELINE.md` | The full “how to design a realistic canyon” guide |
