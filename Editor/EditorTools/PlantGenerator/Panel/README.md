# PlantGenerator Panel — ferns · banana plants · palms (SolidArc shell)

Procedural tropical flora for the game, generated in the same **Outliner · Viewport · Inspector** glass
UI as the SolidArc sketcher (`ParametricSketcher/Panel` — CSS tokens, panels, tiles, tree rows,
`trk-bar` sliders and the command line are reused verbatim).

Run: `python3 -m http.server 8080` in this folder → http://localhost:8080/ (`?demo` adds a banana and a
fern next to the palm, `?all` lines up the whole catalogue). No build step; three.js is vendored under `vendor/`.

## Construct → Outliner

**Construct · add plant** (or `Tab` / right-click the viewport) opens the catalogue popup. **Click a tile
and the plant is in the Outliner** (selected and focused). `⇧click` keeps the popup open for adding
several; the `⋯` corner of a tile opens options (seed, count, pinned sizes). `generate` makes another
of the last-used plant.

`Tab`, right-click in the viewport, the **Construct** pill or the current-plant chip opens the same
catalogue window as the sketcher (rail of families → tiles with live thumbnails → options slide).
Click a tile for options (seed, count, key dimensions, preview) and **Add to Outliner**; double-click
a tile to add it straight away. Command line also works: `date 42`, `heliconia`, `tree`, `list`.

| Family | Plants (52) |
|---|---|
| **Palms** (Arecaceae, tropical/subtropical) | Coconut, Royal, Date (boots + date strands), Mexican fan, Bismarck (silver fan), Queen (drooping plumose), Sago (cycad rosette), Areca clump |
| **Bananas** (Musaceae / Zingiberales, tropical) | Cavendish, Plantain, Red banana, Ensete, Heliconia, Bird of paradise (Strelitzia), Canna lily, Traveller's palm |
| **Aroids** (Araceae — the giant-leaf tropicals) | Elephant ear / taro, Giant taro (Alocasia), Monstera (split + fenestrated), Split-leaf philodendron, Xanadu, Calathea, Peace lily (spathe + spadix), Black taro |
| **Rosettes** | Bromeliad (Guzmania), Urn plant (Aechmea), Pineapple (with fruit + crown), Agave (century plant + flower stalk), Yucca, Dragon tree (Dracaena) |
| **Bamboo** | Golden, Giant timber, Black, Buddha's belly, Hedge bamboo — clumps of noded culms with branch leaf-fans |
| **Shrubs & trees** | Frangipani (flowers), Hibiscus (flowers), Croton, Ti plant, Umbrella tree (Schefflera), Papaya (fruit), Rubber fig, Bougainvillea |
| **Ferns** (tropical → temperate) | Wood, Boston, Bird's-nest, Tree fern, Maidenhair, Ostrich, Asparagus, Tassel, Staghorn |

Every plant is `family + variant`: the variant sets its own parameter ranges, palette and growth rules;
the seed randomises within them. All are still one merged mesh (verified per variant × 20 seeds).

## What comes out

| Species | Reference | Typical size | Tris (detail 0.8) |
|---|---|---|---|
| **Palm** — *Cocos nucifera* | coconut palm: ringed leaning trunk, basal bulge, 20–30 pinnate fronds with hanging leaflets, spear leaf, dead hanging fronds, coconut clusters | 6–13 m | ~20 k |
| **Banana** — *Musa × paradisiaca* | pseudostem, 7–12 broad paddle leaves (flat lamina, offset base, rounded tip) with wind tears, rolled cigar leaf, hanging peduncle with hands of fruit + purple bud | 2.2–4.5 m | ~7 k |
| **Fern** — *Dryopteris filix-mas* | rhizome crown, 8–18 arching bipinnate fronds (pinnae → pinnules), 3 croziers | 0.4–1.4 m | ~25 k |

Every generated plant:

* **is one merged mesh** — child parts are *extruded from parent faces* (the face is deleted and its
  four corners become the first ring of the child tube) or *grown from parent edges* (a leaflet strip
  starts on two ring vertices of its rachis). Nothing is a separate shell resting on the parent
  (**L, not |_**). `Verification/plant_smoke.mjs` proves every mesh is a single connected component.
* **has no textures / UVs** — colour is a per-vertex solid fill; each element (trunk ring, leaf, fruit…)
  gets one flat colour with per-plant hue/lightness variation. Palette is editable per plant.
* **has its own unique properties** — 9–11 parameters per species (height, radius, lean, frond count,
  lengths, droop, tearing, fruit, hue…), randomised per seed and editable live with sliders; same
  seed → identical mesh (deterministic).
* is Y-up, metres, with a 1.8 m human reference in the viewport for scale.

## Files

| File | Role |
|---|---|
| `plant.js` | Generator. Pure geometry, no DOM (runs in Node). `MeshBuilder` (tube / face-extrusion / edge-strip), the three species, parameter schemas, `connectedComponents`. |
| `app.js` | Panel wiring: WebGL viewport (flat / smooth / wire / parts shading, line-up, wind preview), outliner tree, inspector with live sliders + colour swatches, `.glb / .obj / .json` export, command line (`palm 42`, `fern`, `set height 1.2`, `export obj`, `clear`). |
| `index.html` | SolidArc UI shell. |
| `Verification/plant_smoke.mjs` | `node Verification/plant_smoke.mjs` — 52 plants × 20 seeds: single connected mesh, finite positions, valid indices, height range, colour attribute present, no UVs, determinism, uniqueness. |
| `Verification/render.mjs` | `node Verification/render.mjs palm.date 3 out.png [top]` — CPU rasteriser used to compare silhouettes against reference photos without a GPU. |

## Notes for the game pipeline

* Export is a single `Mesh` with a `COLOR_0` attribute and one vertex-colour material — drop-in for
  Unreal/Unity/Godot; use a vertex-colour shader (no texture sampler).
* Leaves are double-sided single-sheet strips (render with two-sided material or duplicate faces on import).
* Vertex counts stay < 65 535 per plant at default detail (16-bit indices); the builder switches to 32-bit
  automatically above that.
