# FlorArc — procedural plant generator

Outliner · Viewport · Inspector for growing HQ procedural flora. Zero build step:
serve this folder over http and open `index.html` (three.js r160 is vendored in
`vendor/`, no CDN needed).

```sh
python3 -m http.server 8123   # then open http://localhost:8123/plants/
```

## What's inside

- **45 plants** in 8 categories — Grasses (10), Shrubs (9), Flowers (4),
  Vegetables (6), Weeds (4), Ferns (3), Desert (5), Alpine (4). All smooth-shaded,
  indexed, welded geometry with vertex colours, baked sun-light and cavity AO.
  Per-specimen **Size** (0.2–8×) supports massive environments; exports bake it.
- **Texture atlas** — press `A`: a procedural 1024×512 PNG (32 cells: blades,
  leaves, petals, pinnae, bark, soil, berries…) with a JSON manifest. Both are
  downloadable from the modal and regenerate deterministically from seed.
- **Grow catalogue** (`Tab`) — tune seed / params / colours, then grow; double-click
  a tile to quick-grow. `+ add` (header) and per-category `+` (rail) grow instantly.
- **Inspector** — live parameter sliders rebuild the selected specimen in place
  (old mesh is disposed, never stacked).
- **Exports** — per-specimen `.obj` (baked vertex colours), whole-garden `.obj`,
  garden `.json` save/open, autosave to localStorage.
- **Command line** — `grow rose · seed test-99 · atlas · wire · solo · help …`
- **Showcase links** — `?plant=tomato&seed=x` boots the app with one isolated plant.
- Every specimen gets a contact-shadow disc so nothing floats; soil mounds
  ground each plant.

## Tests ( throwaway harnesses, not committed)

- `node /tmp/geotest.mjs` — every builder × default/min/max params: indexed,
  NaN-free, zero degenerate tris (135 checks).
- `node /tmp/shot/render.mjs <id> [seed] [out.png] [k=v…]` — software-rasterized
  verification renders (this is how each plant is visually checked).
- `node /tmp/uitest/run.mjs` — jsdom + real three.js: boot, catalogue, `+` buttons,
  atlas modal + manifest, param-edit duplicate regression, commands, keys (49 checks).
