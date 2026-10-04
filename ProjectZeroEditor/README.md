# Project-Zero editor — the native UI in the browser

A self-contained HTML/CSS/JS replica of the **Project-Zero development editor** (the native C++ / ImGui editor in
`Engine/Editor/`), plus the families of entity, sheet and icon the native list never got to: **tyres, wheels, vehicles and
cloth**.

Nothing here is a framework port and nothing is imported: plain HTML, one stylesheet and eight scripts, no build step, no
external assets. Open `index.html` — with a static server, so the browser resolves the script paths — and the whole editor
is there.

## What is replicated, and from where

Every figure in the page is read out of the native sources rather than invented. The file that answers for each panel is
named at the head of the block that draws it.

| Panel | Native source | What was copied |
|---|---|---|
| Tab band | `Engine/Editor/EditorStyleSpecification.h` | the trapezoid tab sheet: slant 14, height 24/26, overlap 24, strip pad 4, min width 110, no rounding; `#26262c` idle, `#32323a` hover, `#121212` active, `#1e1e24` dimmed |
| Outliner | `Engine/Editor/OutlinerPanel.cpp` | head pads 22 / 22 / 12 with the 20 px title and the 28 px round compact button; the "Scene · N nodes" sub; the two 18 px census tiles with their 22 px disc and 30 px light numeral; the 40 px search pill ("Search  Ctrl+Shift+F"); the 92 px Filter button and its 170 px popup with its 6 px tint dots; the 26 px narrowing chips; rows 39 px (34 compact) indented 8 + 13 × depth with a 7 px radius, a 30 px tile, a 14 px chevron, a 16 px standing dot and a 24 px eye; the five-column foot (REALTIME · QUALITY · SUN · MOONS · CAM) |
| Viewport | `Engine/Editor/ViewportPanel.cpp`, `ViewportBillboards.h` | the 44 px rail over the 2 px convergence hairline: the 28 px brand tile, the 56 px dock pair, Add (the native Lights / World & Celestial / Cameras / Geometry Primitives menus, plus the new families), the Edit · Simulate · Play mode pill (Edit `#2e2e2e`, Simulate `108,119,255`, Play `34,197,94`, Paused `245,158,11`) with its run-only pause / step / stop, the projection pill and its Perspective / Orthographic + six-snap menu, Markers, the Live / Running / Held / Static status with its sample count, the gear; the r12 `#07090C` plate; the four-counter foot (FPS + ms · TRIS · INSTANCES + visible · CAMERA, the camera cell retiring first); the command line (Ctrl+K) with its verbs, quick rows, ghost completion and the red no-answer row |
| Inspector | `Engine/Editor/InspectorPanel.cpp`, `ControlPanel.cpp`, per-domain panels | the 56 px ident head (36 px tint tile, CAPS category with "· locked · hidden", the two 28 px discs); the r18 cards with their 24 px head, 78 px label column and prow heights (slider 30, select 32, switch / axes / colour 26, read-out 18); the 92 px split slider pill beside the 26 px track and its 12 px thumb; the 44 × 25 switch; the three 26 px axis cells (X `#EF5350`, Y `#69D06D`, Z `#5B8CFF`); the 52 px colour chip; the 32 px dropdown with its 36 px caret cell and 28 px menu rows; the 130 px Instance standing card (VISIBLE · LOCKED · DYNAMIC · PHYSICS, TYPE, ID #nnn); the 64 px Notes field; the foot "Category · dynamic\|static" with the tinted FPS and TRIS |
| Construct | `Engine/Editor/NativeConstructPanel.h` | the 860 × 760 sheet over `#171717`, "CONSTRUCT / FRONTIER" and "01 Entities > 02 Properties", the "Search existing engine entities…" field, the index of groups, the 116 px tiles with their 52 px artwork, the note under them ("Existing scene records only…"), "‹ Entities", "Enable in world" when a parent hides a row, and the same inspector sheet rather than a copy of it; Esc steps back one page, and the pages slide on the native 0.28 s |
| Control Centre | `DisplayPresentation/ControlCentreHost.cpp` | the eight quick tiles (Global Illumination · Reflections · Anti-Aliasing · FPS Overlay · Notifications · Quality · Patch Geometry · Raytracing) and the render-scale pill, behind the viewport gear |

The scene itself is Project-Zero's celestial roster, copied from `Engine/Host/CelestialSequence.cpp`: the same records in
the same order — Atmosphere, Sun, Sky, Stars, Moons, Lens Flare, Wind, Cloud Layer, Precipitation, Local Cloud, Height Fog,
Atmospheric Fog, Local Volumetric Fog, Rainbow — with the same display names (Sun is *Directional Light*, Sky is *Sky
Atmosphere*, Stars is *Star Field*, Moons is *Atlas*, Height Fog is *Volumetrics*, Atmospheric Fog is *Aerial
Perspective*, Cloud Layer is *Clouds*, Local Cloud is *Cloud Volume*, Local Fog is *Fog Volume*, Wind is *Wind Field*,
Rainbow is *Optics*), the same metas ("AM 10.2", "5.2°", "5.08 kcd", "mag +1.3", "1/4", "6 ghosts", "4.2 m/s SW",
"Cumulus · 44%", "Rain 27 mm/h", "391 m", "56 km") and the same thirteen sheets, group for group, with each control's own
range, unit and decimals. Two of the native round-trips are honoured rather than smoothed over: the **24-hour local
clock** on the Sun sheet (a dial, with manual azimuth/elevation deliberately unexposed) and the solved astronomy
read-outs.

## What this redesign adds

* **Tyres** — the Tyre, its Carcass, Tread and XPBD Lattice (16×72), the Rim and the Wheel Assembly, each with its own
  sheet, its own outliner row and its own artwork.
* **Vehicles** — Car Body, Chassis, Suspension, Engine and Brake Disc.
* **Cloth and soft bodies** — Cloth Panel, Rope and Soft Body (XPBD, pinning, weave, tear threshold).
* **The tyre generator panel** — the fourteen presets (GZero SLICK … Talon Trail OFF-RAD), the size chips
  (285/70 R17 …), the four tabs (Tyre · Rim · Look · Export), the view strip (Iso · Side · Tread · Front · Spin · X-ray
  cords) and the statistics block (Overall Ø 831 mm, Tread left 15.0 mm, Circumference 2.61 m, Tread mesh 138 k tris).
* **Icons** — 120 inline vectors in total: the native chrome and celestial glyphs, and the set the native list never had
  for tyres, rims, tread, lattice, vehicles and their parts, cloth, rope and soft bodies. No font, no sprite, no network.
* **The viewport scene** — every row of the roster is drawn in the plate as a wireframe box in **its own colour** (each
  entry steps its family hue so no two entries read alike), behind the editor's own orbit compass. The picked row wears
  the **translate gizmo at the engine's figures**: cones at TIP 0.95 of a 1.0 reach, 0.06 radius and 0.18 tall, corner
  quads at 0.08 half, the white 0.16 ring, X `#e01414` / Y `#12d40a` / Z `#1560e0` and the cyan / magenta / yellow quads
  (`Engine/Editor/GizmoFigures.h`, "verbatim from References/Gizmo.html").
* **More of the editor** — the dock pair and the Add menu gained the new families; the filter row gained Tyres, Cloth and
  Hidden pills; the command line answers with entries, verbs and quick rows as the native one does.

## Keys

`Tab` compact outliner · `Ctrl+Shift+F` search · `Ctrl+K` command line · `Shift+A` Construct · `Alt+S` Simulate ·
`Alt+P` Play · `P` pause · `.` step · `Esc` back to Edit (or back one page in Construct) · `Ctrl+R` hold the clock.

## Files

```
index.html            the shell: tab band, three columns, the shade, the Construct sheet, the toasts
css/editor.css        every token and every figure, each block naming the native file it was read from
js/icons.js           the inline vector set (120 glyphs)
js/data.js            the roster, the 33 sheets and their 343 controls, the catalogue, the tyre presets
js/controls.js        the control panel: split pill, switch, axis row, colour chip, dropdown, card, clock
js/outliner.js        the outliner: head, census, search, filters, rows, foot
js/viewport.js        the rail, the plate with its boxes and gizmo, the command line, the counters
js/inspector.js       the ident, the sheets, the standing card, the notes, the tyre generator
js/construct.js       the Construct catalogue and its properties page
js/app.js             the tab band, the splitters, the keys, the shade, the toasts
```

## Serving it

Any static server will do; the scripts are plain `<script>` tags, so `file://` works too but a server is tidier:

```
python3 -m http.server 8080     # then open http://localhost:8080/index.html
```
