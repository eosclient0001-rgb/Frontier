# Candy City — validation evidence

Claim under test: **`Experimental/CandyCity/` builds a complete candy town (roads, eight house
styles, candy trees, street furniture, jelly beans and sprinkles) entirely from procedural code, and
renders it in a browser.**

## Environment and revision

| Item | Value |
| --- | --- |
| Revision tested | session branch `arena/b3098980-frontier`, uncommitted Candy City prototype (three.js r170 vendored) |
| Generator checks | Node 22.22.3, headless (`node test/city.test.mjs`, `node test/seed-sweep.mjs`) |
| Rendering capture | Chromium 130 (build v1140 via `@sparticuz/chromium`), headed-off browser, **ANGLE / Vulkan 1.3 on SwiftShader — CPU rasterisation, no hardware GPU** |
| Display | 1600 × 900 CSS px, device scale factor 1 |
| Server | `python3 -m http.server 8099 --bind 0.0.0.0` in `Experimental/CandyCity` |
| Windows / editor | not involved: this prototype is not wired into the C++ editor, `EngineContent` or the renderer |

## Commands

```bash
cd Experimental/CandyCity
node test/city.test.mjs        # 20 generator checks
node test/seed-sweep.mjs       # 12-seed sweep
# rendering: see test/capture.mjs, prerequisite packages noted in its header
node capture.mjs http://127.0.0.1:8099/ ./Images
```

Captures were taken through `test/capture.mjs` (same code, run from outside the repo to keep
`node_modules` untracked). `?ui=1` HUD is included so the panels, counters and sugar-light label are
part of the retained frames.

## Results — generator (`Results: generator-checks.txt`, `seed-sweep.txt`)

Seed `20260101`, observed:

```text
blocks 36 · lots built 35 (the last grid cell is the plaza) · houses 32 · parks 3
trees 342 · street lamps 64 · candy cars 20
jelly beans 1402 (instanced, = instanced count)
sprinkles 9832 (instanced)
merged static meshes 29 · merged candy pieces 10006 · triangles 1 117 706
```

All checks passed:

- grid/blocks/houses/parks/trees/lamps/beans/sprinkles/cars present above their floors;
- `houses + parks === lots`, `lots === blocks - 1`;
- bean bookkeeping matches the instanced count exactly;
- triangle budget inside 150 k – 2.5 M;
- merged buckets 8 – 40 (29 observed, i.e. one material per candy surface family);
- **determinism**: two builds of the same seed produce identical statistics; a different seed changes them;
- **mesh integrity**: every mesh (45 in the scene graph, including clouds and 2 instanced layers) has
  finite positions and a valid bounding sphere; all candy materials resolve to
  `MeshStandardMaterial`/`MeshPhysicalMaterial`; the animation hook runs without error.

The 12-seed sweep (seeds 1, 7, 42, 99, 1234, 20260101, 555555, 888888, 31337, 2024, 777, 900001)
produced complete towns every time: 25–32 houses, 3–10 parks, 323–397 trees, 54–64 lamps,
1.00 M – 1.16 M triangles, 29 merged meshes.

## Results — rendering

| Capture | What it shows |
| --- | --- |
| `Images/CandyCityOverview.jpg` | full town: liquorice streets with candy-cane kerbs, 32 houses, street-tree rows, jelly-bean crosswalks, central layer-cake plaza, gumdrop hills beyond |
| `Images/CandyCityStreet.jpg` | street level: hooked candy-cane lamps, candy-corn trees, ice-cream tower, gummy car, sprinkled pavements |
| `Images/CandyCityHomes.jpg` | close house detail: candy-cane cabin, lollipop pavilion, wafer ridges, icing rails, fences, gumdrop shrubs |
| `Images/CandyCityPlazaCake.jpg` | the four-tier layer cake with icing drips, candy beads, candles, cherry, on a peppermint bullseye |
| `Images/CandyCityDetail.jpg` | material/texture detail: frosting, wafer, waffle cone, peppermint, cotton candy, pavement grout |
| `Images/CandyCityAerial.jpg` | plan view: grid, lot lawns, crosswalks, street trees |
| `Images/CandyCityGolden.jpg` / `CandyCitySunset.jpg` | golden-hour lighting pass |
| `Images/CandyCityNight.jpg` | sugar night: lit windows, lamp pools, stars |

Observed frame cost in the browser (`renderer.info.autoReset = false`, summed across every pass of
one frame, 1600 × 900 viewport): **76–77 draw calls per frame**, HUD `10 fps · 76 draws/frame`
(the figure varies by one with frustum culling of clouds/instances). The frame includes the town bake (29 merged meshes + 2 instanced layers),
the shadow-map pass, the sky dome, 14 cloud clusters, the sugar motes and the bloom + Output passes;
the triangle count therefore roughly doubles the 1.12 M town geometry.

## Limits (honest)

- Rendered on **SwiftShader CPU**; the on-screen `fps` in the HUD (≈10 fps at 1600 × 900) is CPU
  rasterisation and says nothing about GPU performance.
- No Windows, hardware-GPU or native-editor run. This is an `Experimental/` HTML prototype, not a
  renderer integration and not a `Exhibits/` native claim.
- Draw calls could only be measured by disabling three's automatic per-pass reset; the number is a
  CPU submission count on SwiftShader, not a GPU cost model.
- Screenshots are real browser frames of this prototype (JPG re-encode at quality 84, resized from
  1600 × 900 to 1400 × 788).
