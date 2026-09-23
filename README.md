# Frontier — Tyre Forge

A **procedural racing-tyre & tread generator** built for racing-game art/tech pipelines.
It models the tyre from real ISO metric sizing (`WIDTH / ASPECT R RIM`), wraps
fully procedural tread patterns around a parametric 3D profile, simulates
new → worn condition, and ships with a draw-it-yourself tread editor.

Open `index.html` through any static server (or the live preview):

```bash
python3 -m http.server 8080 --bind 0.0.0.0
# → http://localhost:8080
```

Three.js is loaded from a CDN import-map in the browser; everything else is
dependency-free vanilla JS.

---

## Features

### 01 · Procedural tyre size & profile
- Sliders for **section width** (145–355 mm), **aspect ratio** (25–80 %) and
  **rim diameter** (13–22 in) — everything else derives from them:
  sidewall height, outer diameter, circumference, rev/km, tread width.
- The cross-section (bead → sidewall bulge → shoulder arc → crowned tread face)
  is generated analytically and lathed into the 3D mesh, so the 3D tyre,
  the dimensioned **blueprint drawing** and the spec readout always agree.

### 02 · Thirteen named tread patterns
| Name | Type | Idea |
|---|---|---|
| **GZero** | Slick | zero grooves, wear-indicator holes only |
| **Vapor R-Comp** | Semi-Slick | micro grooves + heat dimples |
| **NightHawk Street** | Street | 4 circumferential channels, sipe rows |
| **Apex GT Asym** | Street | asymmetric: wet inner / block outer |
| **Slipstream DK** | Drift | hard compound, shallow sipes |
| **Smokescreen** | Drift | dimple matrix for maximum haze |
| **HydroStorm V** | Wet / Grip | directional V-channels |
| **Monsoon 7** | Wet / Grip | 5 deep reservoirs + lateral scoops |
| **Grizzly Magnum** | Off-Road | chunky staggered lugs, shoulder claws |
| **MudRaptor X** | Off-Road | high-void self-cleaning mud claw |
| **IceFang** | Winter | dense alternating sipes |
| **HexCore** | Concept | honeycomb show tread |
| **Orbit Rings** | Concept | circular orbital grooves |

Category filters: slick / semi-slick / street / drift / wet / off-road / winter / concept.

### 03 · Condition & detail
- **Wear slider (NEW → BALD)**: grooves narrow and fade, rubber polishes
  glossy (roughness + bump maps react), streaks appear.
- **Tread depth** (2–14 mm), **pattern repeat** around the circumference,
  sidewall **accent stripe** colour, rim colour, 5-spoke procedural rim,
  turntable spin with RPM control, PNG screenshot.

### 04 · Tread editor
Draw your own tread on a wrapping tile — it is applied to the 3D tyre live:

- circumferential & angled grooves, V-chevrons, sipe rows, tread-block grids
- **circular** patterns, **hexagon** stamps, diamonds, dimple rows, eraser
- mirror-across-centreline symmetry, undo/clear, import any preset to remix it
- export as **PNG** texture strip or **JSON** (ops list — drop-in for game tools)

Pattern vocabulary follows real tyre design research: grooves, tread blocks,
sipes, void ratio, directional/asymmetric/symmetric layouts, and slick
wear-indicator holes.

---

## How it works

- **Treads are data, not bitmaps.** A tread = a list of normalised ops
  (`hgroove`, `vgroove`, `chevron`, `sipes`, `circle`, `hex`, `diamond`,
  `blocks`, `dimples`, `hexgrid`, `holes`, `erase`). One renderer draws the
  3D texture tile, bump map source, flat strip preview, thumbnails and editor.
- The tile canvas doubles as **color map + bump map**; wear scales groove width,
  bump strength and roughness.
- Geometry: `js/geometry.js` lathes the profile with two material groups —
  tread band (u = circumference × repeat, v = across tread) and sidewalls
  (planar UVs for the branding texture with real dimensions baked in).

## Files

```
index.html          UI shell
css/app.css         dark motorsport theme
js/tiremath.js      ISO sizing + parametric cross-section
js/patterns.js      tread op renderer + 13 presets
js/geometry.js      procedural tyre lathe + rim meshes
js/textures.js      sidewall branding + blueprint painter
js/editor.js        interactive tread editor
js/app.js           Three.js scene + UI wiring
tests/smoke.mjs     headless canvas/DOM-stub tests (node tests/smoke.mjs)
tests/geometry.mjs  geometry topology tests    (node tests/geometry.mjs)
```
