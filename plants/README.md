# FlorArc — procedural plant generator

Outliner · Viewport · Inspector for growing HQ procedural flora. Zero build step:
serve this folder over http and open `index.html` (three.js r160 is vendored in
`vendor/`, no CDN needed).

```sh
python3 -m http.server 8123   # then open http://localhost:8123/plants/
```

## What's inside

- **10 grass plants** in 1 category — Grasses (10: Meadow Tuft, Common Reed, Tussock,
  Creeping Lawn, Pampas Grass, Bamboo, Blue Fescue, Feather Grass, Blue Oat Grass, Fountain Grass).
  All smooth-shaded, indexed, welded geometry with vertex colours, baked sun-light and cavity AO.
  Per-specimen **Size** (0.2–8×) supports massive environments; exports bake it.
- **Texture atlas** — press `A`: a procedural 1024×512 PNG (11 cells: blades,
  plumes, leaves, awns, culm, stem, soil) with a JSON manifest. Both are
  downloadable from the modal and regenerate deterministically from seed.
- **Grow catalogue** (`Tab`) — tune seed / params / colours, then grow; double-click
  a tile to quick-grow. `+ add` (header) and per-category `+` (rail) grow instantly.
- **Inspector** — live parameter sliders rebuild the selected specimen in place
  (old mesh is disposed, never stacked).
- **Exports** — per-specimen `.obj` (baked vertex colours), whole-garden `.obj`,
  garden `.json` save/open, autosave to localStorage.
- **Command line** — `grow meadow · seed test-99 · atlas · wire · solo · help …`
- **Showcase links** — `?plant=meadow&seed=x` boots the app with one isolated plant.
- Every specimen gets a contact-shadow disc so nothing floats; soil mounds
  ground each plant.
