# Candy City — procedural candy town

A prototype in `Experimental/`: a whole candy town built from candy geometry, with every texture
painted procedurally in the browser at load time. No models, images, or fonts are downloaded — the
only dependency is a vendored copy of [three.js r170](vendor/three.module.js) (MIT) plus a small
subset of its addons (see `vendor/README.md`).

Open `index.html` from a static server (ES modules need HTTP, not `file://`):

```bash
cd Experimental/CandyCity
python3 -m http.server 8099 --bind 0.0.0.0
# then open http://localhost:8099/
```

`npm run serve` is the same command. `npm test` runs the headless generator check; `npm run capture`
re-renders the retained gallery (needs a local Chromium and the `puppeteer-core` setup described in
[evidence/README.md](evidence/README.md)).

---

## What is generated

Everything is deterministic from one `seed`: the same seed always rebuilds the same town.

### The grid and the streets
- A jittered 7 × 7 node grid, joined by gently bent Catmull-Rom roads, so no two streets are identical.
- Roads are **liquorice asphalt with a sugar coat**: plum tarmac, pink edge lines, dashed cream
  centre line, scattered sugars. Kerbs are candy-cane ribbon strips that follow the curve.
- Pavements are **white chocolate slabs with pink icing grout**.
- Every junction has a bullseye **jelly-bean crosswalk** — 7 instanced beans per approach, 4 approaches.
- Twelve **strawberry-syrup country lanes** run out of town into the sugar hills.
- The whole ground is a **sprinkled sugar field**: a painted sprinkle map plus 9 832 instanced sugar
  rods scattered over the town and verges.

### Eight house styles
Each lot draws one style, with randomized sizes, palette, trims and props:

| Style | Candy construction |
| --- | --- |
| Gumdrop cottage | Wafer walls, corner candy-cane posts, a soft gumdrop dome roof with icing drip ring, sugar sprinkles on the roof, chocolate chimney with a marshmallow cap, peppermint gable window, striped awning |
| Candy-cane cabin | Striped drum walls, icing bands, peppermint cone lid, chocolate stovepipe, round porthole windows |
| Cupcake house | Fluted paper cup, three stacked soft-serve frosting coils, cherry on top, icing drips |
| Chocolate chalet | Chocolate block with bar grooves, wafer gable roof, chocolate gable ends, ridge cane, peppermint round window |
| Wafer apartment | 2–3 storeys of wafer, icing floor slabs, candy-cane balconies, gumdrop slab roof with a roof garden and marshmallow chimney |
| Ice-cream tower | Waffle-cone drum with three frosting scoops, cherry, wafer stick, mint awning |
| Lollipop pavilion | Wafer drum, six candy-cane columns, giant swirl-disc roof with jawbreaker finial |
| Candy-corn cottage | Banded gumdrop cone (yellow → orange → cream), icing seams, marshmallow tip |

Every house also gets a jawbreaker doorstep, candy-cane jambs and a ring arch around the door, a
jawbreaker stepping-stone path, icing-sill windows with **muntins** (cross bars), some with
chocolate flower boxes of gumdrops, plus fences with icing rails and gumdrop finials, mailboxes,
benches, and parked gummy cars with peppermint wheels.

### Trees, parks and street furniture
- **Cotton-candy trees**: candy-cane trunks, spun-sugar torus strands wrapped round the crown,
  pinned sugar beads and jimmies.
- **Lollipop trees**: icing stems with tilted, double-sided swirl discs.
- **Peppermint trees**: chocolate trunk, squashed peppermint sphere crown.
- **Candy-corn trees**, **marshmallow trees** (marshmallow clusters on chocolate trunks),
  **jelly-bean bushes** and **gumdrop shrubs**.
- Parks: gazebos with peppermint dome roofs, benches, gumdrop boulders, bean flower borders.
- Street furniture: **hooked candy-cane street lamps** with a hanging sugar globe, bollards,
  benches, mailboxes.
- The central block is replaced by a **plaza**: a bullseye peppermint pavement with a giant
  four-tier layer cake — frosting, icing drip rings, hundreds of candy beads, eight lit candles and
  a cherry — ringed with lollipop trees, lamps and benches.

### Sky and light
- A procedural sky shader: gradient, drifting candy-floss clouds, sun/moon, sprinkle stars at night,
  and a golden-hour pass that warms the horizon as the sun drops.
- 14 billowing marshmallow clouds, 900 sugar motes, up to 12 warm point lights at night.
- The **Sugar light** slider runs a full day: candy noon → golden sugar → strawberry sunset → sugar
  night (windows and lamps light up, stars appear).

### Textures (all painted at runtime)
Peppermint spiral, four lollipop swirls, three candy-cane stripe sets, sugar wafer ridges, waffle
lattice, tempered chocolate, buttercream frosting, sprinkled sugar field, liquorice road with road
markings, white-chocolate pavement, cotton candy, marshmallow, jelly-bean shell, gumdrop sugar,
jawbreaker sugar rings, gummy marble. Height-derived **normal maps** are generated for the wafer,
waffle, chocolate, frosting, sugar, road, pavement, gumdrop and cotton-candy surfaces (Sobel over
the painted luminance), so surfaces catch light up close.

### Performance approach
- All static candy is merged into **29 meshes**, one per surface family — 10 006 candy pieces in one
  bake. Measured in browser: **76–77 draw calls for a whole frame** (town, shadow pass, sky, 14 clouds,
  the two instanced layers, motes and the three post passes) at ~1.1 M town triangles.
- Per-candy colour rides on a **vertex-colour attribute**, so a thousand differently coloured sweets
  cost one material rather than one material each.
- Jelly beans and sprinkles are **instanced** (1 402 + 9 832).

## Controls

Drag to orbit · scroll to zoom · <kbd>space</kbd> toggles orbit · <kbd>H</kbd> hides the panels.
Buttons: camera presets, sugar-light slider, **New city** (new seed), **Save picture**.

URL parameters: `?seed=12345`, `?view=overview|street|plaza|aerial|closeup|homes`, `?tod=0.8`,
`?rotate=1`, `?ui=0`.

## Files

```text
index.html          HUD, loading screen and the candy-styled panels
js/textures.js      procedural canvas painting + Sobel normal maps
js/city.js          generator: grid, roads, 8 house styles, trees, props, plaza, clouds
js/sky.js           sky dome shader
js/main.js          renderer, lighting, day cycle, camera, post-processing, HUD wiring
test/city.test.mjs  headless generator checks (determinism, mesh integrity, budgets)
evidence/           retained captures, measurements and the capture script
vendor/             vendored three.js r170 + addons (MIT)
```

## Limits

- This is a prototype: it is not wired into the editor, the C++ renderer, or `EngineContent`.
- Validation is a headless Chromium run on **SwiftShader (CPU)** — no hardware-GPU or Windows run.
  The frame rate shown in retained captures is therefore not a performance claim.
- Desktop-first; touch works through OrbitControls but the HUD is not tuned for phones.
